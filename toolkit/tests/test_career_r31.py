"""R31/R31b (gate §7-quattuorsexagies): una stagione CORTA non cancella la carriera.

Il caso da cui nasce e' Gvardiol: 13 voti a t-1, due stagioni piene prima, e il motore lo prezzava
all'ancora del ruolo. Quattro affermazioni: dove B0 tace e ci sono due stagioni piene, la fantamedia e'
la carriera regredita verso l'ancora; con UNA sola stagione piena la regola tace (e' la popolazione di
R18, «due stagioni o piu'»); chi ha una stagione piena a t-1 non si muove; e un portiere resta fuori.
"""

from __future__ import annotations

import pytest

from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.engine import evaluate, features

# fc_id -> (ruolo, righe di season_stats come (stagione, pv, fm))
MEN = {
    1: ("D", (("2022-23", 30, 6.6), ("2023-24", 30, 6.8), ("2024-25", 10, 6.7))),   # la carriera
    2: ("D", (("2023-24", 30, 6.8), ("2024-25", 10, 6.7))),                          # una sola piena
    3: ("D", (("2022-23", 30, 6.6), ("2023-24", 30, 6.8), ("2024-25", 30, 6.7))),   # stagione piena
    4: ("P", (("2022-23", 30, 5.6), ("2023-24", 30, 5.8), ("2024-25", 10, 5.7))),   # un portiere
    # chi fa l'ancora: tre difensori e tre portieri con una stagione piena a t-1 (min_weight 3)
    **{fc_id: ("D", (("2024-25", 30, 6.0),)) for fc_id in (5, 6, 7)},
    **{fc_id: ("P", (("2024-25", 30, 5.0),)) for fc_id in (8, 9, 10)},
}


def _db(tmp_path):
    tmp_path.mkdir(exist_ok=True)
    conn = init_db(tmp_path / "t.db")
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (10, 'Inter', 'serie_a')")
    for fc_id, (role, seasons) in MEN.items():
        conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)", (fc_id, f"U{fc_id}"))
        for season in ("2022-23", "2023-24", "2024-25", "2025-26"):
            conn.execute(
                "INSERT INTO rosters(fc_id, season, fc_club_id, league, role_classic, price_initial) "
                "VALUES (?, ?, 10, 'serie_a', ?, 10)", (fc_id, season, role))
            conn.execute("INSERT INTO listone_quotes(fc_id, season, platform, price_initial) "
                         "VALUES (?, ?, 'default', 10)", (fc_id, season))
        for season, pv, fm in seasons:
            conn.execute("INSERT INTO season_stats(fc_id, season, platform, pv, mv, fm) "
                         "VALUES (?, ?, 'default', ?, ?, ?)", (fc_id, season, pv, fm - 0.3, fm))
    conn.commit()
    return conn


def _fm(tmp_path, rules, params):
    data = features.prepare(_db(tmp_path), features.Window("W", "2024-25", "2025-26", "2025-08-15"),
                            "default", "classic")
    anchor = {o.fc_id: evaluate._anchor_for(o, data) for o in data.observations}
    obs = {o.fc_id: o for o in data.observations}
    fm = {p.obs.fc_id: p.fm_pred for p in evaluate.predict_window(data, ("R0", *rules), params=params)}
    return fm, anchor, obs


def test_la_carriera_sostituisce_l_ancora_dove_la_stagione_scorsa_e_corta(tmp_path):
    fm, anchor, obs = _fm(tmp_path, ("R0c", "R31"), evaluate.Params(career_lam=0.6))
    assert obs[1].fm_5y == pytest.approx(6.7) and obs[1].fm_5y_seasons == 2
    assert fm[1] == pytest.approx(anchor[1] + 0.6 * (6.7 - anchor[1]))
    # una sola stagione piena: la regola tace e resta l'ancora di R0c
    assert fm[2] == pytest.approx(anchor[2])
    # un portiere resta fuori, dichiarato
    assert fm[4] == pytest.approx(anchor[4])


def test_chi_ha_una_stagione_piena_non_si_muove(tmp_path):
    base, _, _ = _fm(tmp_path / "a", ("R0c",), evaluate.Params())
    with_rule, _, _ = _fm(tmp_path / "b", ("R0c", "R31"), evaluate.Params(career_lam=0.6))
    assert with_rule[3] == pytest.approx(base[3])


def test_r31b_legge_anche_la_stagione_corta(tmp_path):
    fm, anchor, _ = _fm(tmp_path, ("R0c", "R31b"), evaluate.Params(career_lam_b=(0.2, 0.5)))
    assert fm[1] == pytest.approx(anchor[1] + 0.2 * (6.7 - anchor[1]) + 0.5 * (6.7 - anchor[1]))


def test_senza_la_regola_resta_l_ancora(tmp_path):
    fm, anchor, _ = _fm(tmp_path, ("R0c",), evaluate.Params())
    assert fm[1] == pytest.approx(anchor[1])
