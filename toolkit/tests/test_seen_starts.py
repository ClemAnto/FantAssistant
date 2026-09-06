"""R24: una PARTENZA DA TITOLARE non e' una presenza, e le due cifre vengono dalla stessa fonte.

Tre affermazioni che nessun altro test copre, e la prima e' quella che protegge i numeri pubblicati:
la regola dev'essere INERTE su ogni finestra pre-stagione (senza giornate viste non c'e' segnale da
scontare), dev'essere inerte su chi il livello per-partita non vede giocare («vuoto = ignoto, mai
zero»), e il taglio del suo conteggio dev'essere una DATA - le due tabelle numerano le giornate in due
modi e giuntarle per numero sarebbe un join su una chiave che non e' la stessa chiave.
"""

from __future__ import annotations

import pytest

from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.engine import evaluate, features


def _db(tmp_path):
    conn = init_db(tmp_path / "t.db")
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (10, 'Inter', 'serie_a')")
    # 1 = titolare pieno · 2 = subentrante che prende comunque il voto · 3 = mai sceso in campo
    for fc_id, name in ((1, 'Titolare'), (2, 'Subentrante'), (3, 'Mai visto')):
        conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)", (fc_id, name))
        for season in ("2024-25", "2025-26"):
            conn.execute(
                "INSERT INTO rosters(fc_id, season, fc_club_id, league, role_classic, price_initial) "
                "VALUES (?, ?, 10, 'serie_a', 'C', 20)", (fc_id, season))
            conn.execute(
                "INSERT INTO listone_quotes(fc_id, season, platform, price_initial) "
                "VALUES (?, ?, 'default', 20)", (fc_id, season))
        conn.execute("INSERT INTO season_stats(fc_id, season, platform, pv, mv, fm) "
                     "VALUES (?, '2024-25', 'default', 30, 6.0, 6.5)", (fc_id,))
    for md, date in ((1, "2025-08-24"), (2, "2025-08-31"), (3, "2025-09-14"), (4, "2025-09-21")):
        for fc_id in (1, 2):
            conn.execute(
                "INSERT INTO match_ratings(fc_id, season, matchday, platform, status, mv, fantavoto) "
                "VALUES (?, '2025-26', ?, 'default', 'played', 6.0, 6.0)", (fc_id, md))
        # Il livello per-partita: il 2 entra sempre dalla panchina, il 3 non ha nessuna riga.
        for fc_id, started in ((1, 1), (2, 0)):
            conn.execute(
                "INSERT INTO external_match_stats(fc_id, match_id, season, source, competition, "
                "real_md, match_date, started, minutes) VALUES (?, ?, '2025-26', 'sofascore', "
                "'serie_a', ?, ?, ?, 70)", (fc_id, 900 + md * 10 + fc_id, md, date, started))
    for fc_id, pv in ((1, 4), (2, 4), (3, 0)):
        conn.execute("INSERT INTO season_stats(fc_id, season, platform, pv, mv, fm) "
                     "VALUES (?, '2025-26', 'default', ?, 6.0, 6.0)", (fc_id, pv))
    conn.commit()
    return conn


def _prepare(conn, auction_date):
    window = features.Window("W", "2024-25", "2025-26", auction_date)
    return features.prepare(conn, window, "default", "classic")


def test_le_due_cifre_vengono_dalla_stessa_fonte_e_il_taglio_e_una_data(tmp_path):
    """Due giornate viste: il titolare ne ha cominciate 2 su 2, il subentrante 0 su 2."""
    data = _prepare(_db(tmp_path), "2025-09-05")
    seen = {obs.fc_id: (obs.starts_seen, obs.played_seen) for obs in data.observations}
    assert seen[1] == (2, 2)
    assert seen[2] == (0, 2)
    # ...e la giornata del 14 settembre non e' entrata: il taglio e' il giorno, non il numero.
    assert data.matchdays_seen == 2


def test_chi_non_e_mai_sceso_in_campo_non_ha_un_tasso_e_la_regola_tace(tmp_path):
    """«Vuoto = ignoto, mai zero»: senza righe non c'e' una quota di partenze da scontare.

    Il difetto rovesciato sarebbe il piu' caro: leggere l'assenza come «non ha mai cominciato» sconta
    del massimo proprio l'uomo di cui non si sa niente.
    """
    data = _prepare(_db(tmp_path), "2025-09-05")
    ghost = next(obs for obs in data.observations if obs.fc_id == 3)
    assert (ghost.starts_seen, ghost.played_seen) == (None, None)
    assert evaluate._start_rate_seen(ghost) is None


def test_il_subentrante_e_scontato_e_il_titolare_pieno_no(tmp_path):
    data = _prepare(_db(tmp_path), "2025-09-05")
    starter = next(obs for obs in data.observations if obs.fc_id == 1)
    sub = next(obs for obs in data.observations if obs.fc_id == 2)
    assert evaluate._start_rate_seen(starter) == 1.0
    assert evaluate._start_rate_seen(sub) == 0.0


@pytest.mark.parametrize("key", sorted(evaluate.R24_BENCH))
def test_inerte_su_una_finestra_pre_stagione(tmp_path, key):
    """Senza giornate viste R24 non esiste, quindi nessuna delle dieci finestre pubblicate si muove."""
    conn = _db(tmp_path)
    data = _prepare(conn, "2025-08-01")
    assert data.matchdays_seen == 0
    params = evaluate.fit_params(data, ("R0", key))
    with_rule = evaluate.predict_window(data, ("R0", key), params=params)
    without = evaluate.predict_window(data, ("R0",))
    assert {p.obs.fc_id: p.pv_pred for p in with_rule} == {p.obs.fc_id: p.pv_pred for p in without}


def test_ogni_punto_di_griglia_e_dichiarato_e_nessuno_e_adottato(tmp_path):
    """La griglia e' un VERDETTO e non un fit: ogni chiave e' una regola sua, e nessuna e' in vigore."""
    declared = {rule.key for rule in evaluate.RULES}
    assert set(evaluate.R24_BENCH) <= declared
    assert set(evaluate.R24_BENCH) <= set(evaluate.CANDIDATES)
    for adopted in evaluate.ADOPTED.values():
        assert not any(key.startswith("R24") for key in adopted)
    # I due K non riaprono una questione chiusa: sono i due gia' adottati da R20.
    assert {prior for prior, _ in evaluate.R24_BENCH.values()} == {10.0, 6.0}
