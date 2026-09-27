"""R29/R30 (gate §7-tresexagies): xG e xA come FORTUNA da togliere alla fantamedia.

Quattro affermazioni. I punti per gol e per assist sono quelli del regolamento dichiarato, non una
copia che puo' divergere. R30 e' R25 con la fantamedia vista depurata: su chi il livello per-partita
non vede, e' R25 al decimale; su chi ha segnato sopra il suo xG, scende; su chi sotto, sale. R29 tace
dove la stagione di input non ha gli attesi («vuoto = ignoto»), cioe' su sette finestre pubblicate su
dieci - ed e' la ragione per cui `backtest --verify` non si muove.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.engine import evaluate, features, model

CONFIG = Path(__file__).resolve().parents[2] / "config" / "scoring_config.json"


def test_i_punti_per_gol_e_assist_sono_quelli_del_regolamento():
    scoring = json.loads(CONFIG.read_text(encoding="utf-8"))
    assert model.GOAL_BONUS == scoring["default"]["goal_bonus"]
    assert model.ASSIST_BONUS == scoring["default"]["assist_bonus"]
    for league, overrides in scoring["leagues"].items():
        assert "goal_bonus" not in overrides and "assist_bonus" not in overrides, league


def test_lo_scarto_e_in_fantapunti_per_presenza_e_non_esiste_su_zero_presenze():
    # 1 gol su 3 xG e 0 assist su 1 xA in 10 presenze: gli mancano 6 + 1 = 7 punti, 0,7 a presenza.
    assert model.bonus_luck(1, 0, 3.0, 1.0, 10) == pytest.approx(0.7)
    assert model.bonus_luck(4, 0, 1.0, 0.0, 10) == pytest.approx(-0.9)
    assert model.bonus_luck(0, 0, 0.0, 0.0, 0) is None


def _db(tmp_path, *, with_xg: bool = True):
    conn = init_db(tmp_path / "t.db")
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (10, 'Inter', 'serie_a')")
    # 1 = segna SOPRA il suo xG · 2 = segna SOTTO · 3 = nessuna riga nel livello per-partita
    for fc_id, name in ((1, 'Fortunato'), (2, 'Sfortunato'), (3, 'Mai visto')):
        conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)", (fc_id, name))
        for season in ("2024-25", "2025-26"):
            conn.execute(
                "INSERT INTO rosters(fc_id, season, fc_club_id, league, role_classic, price_initial) "
                "VALUES (?, ?, 10, 'serie_a', 'A', 20)", (fc_id, season))
            conn.execute(
                "INSERT INTO listone_quotes(fc_id, season, platform, price_initial) "
                "VALUES (?, ?, 'default', 20)", (fc_id, season))
        conn.execute("INSERT INTO season_stats(fc_id, season, platform, pv, mv, fm) "
                     "VALUES (?, '2024-25', 'default', 30, 6.0, 6.5)", (fc_id,))
    for md, date in ((1, "2025-08-24"), (2, "2025-08-31"), (3, "2025-09-14")):
        for fc_id in (1, 2, 3):
            conn.execute(
                "INSERT INTO match_ratings(fc_id, season, matchday, platform, status, mv, fantavoto) "
                "VALUES (?, '2025-26', ?, 'default', 'played', 6.0, 7.5)", (fc_id, md))
        for fc_id, goals, xg in ((1, 1, 0.1), (2, 0, 0.9)):
            conn.execute(
                "INSERT INTO external_match_stats(fc_id, match_id, season, source, competition, "
                "real_md, match_date, started, minutes, goals, xg, xa) VALUES (?, ?, '2025-26', "
                "'sofascore', 'serie_a', ?, ?, 1, 90, ?, ?, ?)",
                (fc_id, 900 + md * 10 + fc_id, md, date, goals,
                 xg if with_xg else None, 0.0 if with_xg else None))
    conn.commit()
    return conn


def _prepare(conn, auction_date="2025-09-05"):
    return features.prepare(conn, features.Window("W", "2024-25", "2025-26", auction_date),
                            "default", "classic")


def _fm(data, rules):
    return {p.obs.fc_id: p.fm_pred for p in evaluate.predict_window(data, ("R0", *rules), params=evaluate.Params())}


def test_la_fortuna_vista_viene_dalla_stessa_riga_delle_partite(tmp_path):
    data = _prepare(_db(tmp_path))
    obs = {o.fc_id: o for o in data.observations}
    assert (obs[1].goals_ext_seen, obs[1].xg_seen, obs[1].played_seen) == (2, pytest.approx(0.2), 2)
    assert (obs[3].goals_ext_seen, obs[3].xg_seen) == (None, None)
    luck = evaluate.derive(data).luck_seen
    assert luck[1] == pytest.approx(3 * (0.2 - 2) / 2)
    assert luck[2] == pytest.approx(3 * (1.8 - 0) / 2)
    assert 3 not in luck


@pytest.mark.parametrize("k30, k25", list(zip(evaluate.R30_MATCHES, evaluate.R25_MATCHES)))
def test_r30_e_r25_depurata(tmp_path, k30, k25):
    data = _prepare(_db(tmp_path))
    r30, r25 = _fm(data, (k30,)), _fm(data, (k25,))
    assert r30[3] == pytest.approx(r25[3])      # nessuna riga: R30 e' R25
    assert r30[1] < r25[1]                      # ha segnato sopra il suo xG
    assert r30[2] > r25[2]                      # ...e sotto


def test_r30_sostituisce_r25_e_non_si_somma(tmp_path):
    data = _prepare(_db(tmp_path))
    assert _fm(data, ("R25K40", "R30K40")) == pytest.approx(_fm(data, ("R30K40",)))


def test_senza_attesi_nella_stagione_r30_e_r25(tmp_path):
    """Una stagione in cui la fonte non pubblica gli attesi: nessuno scarto inventato dagli zeri."""
    data = _prepare(_db(tmp_path, with_xg=False))
    assert evaluate.derive(data).luck_seen == {}
    assert _fm(data, ("R30K10",)) == pytest.approx(_fm(data, ("R25K10",)))


def test_r29_tace_dove_la_stagione_di_input_non_ha_gli_attesi(tmp_path):
    data = _prepare(_db(tmp_path), "2025-08-01")      # pre-stagione, e external_stats vuota
    assert evaluate.derive(data).luck_prev == {}
    params = evaluate.fit_params(data, ("R0", "R29"))
    assert _fm(data, ()) == pytest.approx(
        {p.obs.fc_id: p.fm_pred for p in evaluate.predict_window(data, ("R0", "R29"), params=params)})


def test_dichiarate_e_nessuna_adottata():
    declared = {rule.key for rule in evaluate.RULES}
    assert {"R29", *evaluate.R30_MATCHES} <= declared
    assert {"R29", *evaluate.R30_MATCHES} <= set(evaluate.CANDIDATES)
    for adopted in evaluate.ADOPTED.values():
        assert not any(key == "R29" or key.startswith("R30") for key in adopted)
