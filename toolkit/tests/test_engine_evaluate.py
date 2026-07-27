"""Harness tests on a tiny fixture DB: domains, metrics, and the look-ahead discipline.

The look-ahead tests are the important ones. A backtest that quietly reads the target season looks
better and is worthless, and no aggregate metric would reveal it - so the rule is pinned here: what
happened after the auction date must not reach the model.
"""

from __future__ import annotations

import json

import pytest

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.engine import evaluate, features

INPUT_SEASON, TARGET_SEASON = "2023-24", "2024-25"
# Small, but long enough to clear both thresholds the model works with: MIN_PV_PREV (the beta's
# domain) and ANCHOR_MIN_PV (which decides who contributes to an anchor at all).
MATCHDAYS = 30


@pytest.fixture
def prepared(tmp_path):
    """A small 2-season DB: three regular defenders (enough to carry a 'D' anchor), a fringe
    defender, a keeper, a midfielder, a striker, and a newcomer who only exists in the target
    listone."""
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euroleghe.db")
    (tmp_path / "data").mkdir()
    conn = init_db(cfg.db_path)
    conn.executemany("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (?, ?, ?)",
                     [(1, "Inter", "serie_a"), (2, "Milan", "serie_a")])
    conn.executemany("INSERT INTO players(fc_id, canonical_name, birth_year) VALUES (?, ?, ?)",
                     [(1, "Regular", 1996), (2, "Fringe", 2003), (3, "Keeper", 1994),
                      (4, "Newcomer", 2004), (5, "Filler1", 1998), (6, "Filler2", 1999),
                      (7, "Defender2", 1997), (8, "Defender3", 2000)])
    rosters = []
    for season in (INPUT_SEASON, TARGET_SEASON):
        for fc_id, role, roles in ((1, "D", "dc"), (2, "D", "dc"), (3, "P", "por"), (5, "C", "m"),
                                   (6, "A", "pc"), (7, "D", "dc"), (8, "D", "dd")):
            rosters.append((fc_id, season, 1, roles, role, "serie_a", 10.0))
    rosters.append((4, TARGET_SEASON, 2, "a", "A", "serie_a", 12.0))   # only in the target listone
    conn.executemany("INSERT INTO rosters(fc_id, season, fc_club_id, roles, role_classic, league, "
                     "price) VALUES (?, ?, ?, ?, ?, ?, ?)", rosters)
    # the calendar: what matchday_count reads
    conn.executemany("INSERT INTO match_ratings(fc_id, season, matchday, platform, mv) "
                     "VALUES (1, ?, ?, 'euro', 6.0)",
                     [(season, matchday) for season in (INPUT_SEASON, TARGET_SEASON)
                      for matchday in range(1, MATCHDAYS + 1)])
    conn.executemany(
        "INSERT INTO season_stats(fc_id, season, platform, pv, mv, fm, goals_conceded) "
        "VALUES (?, ?, 'euro', ?, ?, ?, ?)",
        [(1, INPUT_SEASON, 25, 6.50, 6.90, None), (1, TARGET_SEASON, 22, 6.30, 6.70, None),
         (2, INPUT_SEASON, 5, 6.00, 6.10, None), (2, TARGET_SEASON, 12, 6.10, 6.20, None),
         (3, INPUT_SEASON, 26, 6.20, 5.10, 29), (3, TARGET_SEASON, 27, 6.25, 5.30, 26),
         (5, INPUT_SEASON, 24, 6.40, 6.80, None), (5, TARGET_SEASON, 20, 6.20, 6.60, None),
         (6, INPUT_SEASON, 23, 6.30, 7.40, None), (6, TARGET_SEASON, 25, 6.40, 7.60, None),
         (7, INPUT_SEASON, 22, 6.35, 6.50, None), (7, TARGET_SEASON, 24, 6.30, 6.45, None),
         (8, INPUT_SEASON, 21, 6.25, 6.30, None), (8, TARGET_SEASON, 18, 6.20, 6.25, None),
         (4, TARGET_SEASON, 24, 6.60, 7.90, None)])
    conn.commit()
    window = features.Window("TEST", INPUT_SEASON, TARGET_SEASON, "2024-08-15")
    return cfg, conn, window, features.prepare(conn, window, "euro", "classic")


def test_calendar_and_anchors_come_from_the_data(prepared):
    _cfg, _conn, _window, data = prepared
    assert data.matchdays_prev == MATCHDAYS and data.matchdays_target == MATCHDAYS
    # Anchors are recomputed from the data, not hard-coded. Only players above ANCHOR_MIN_PV count
    # (so the fringe defender is out), and a role with too thin a sample gets no anchor at all
    # rather than one built on a single player - here that leaves 'D' only.
    assert set(data.anchors) == {"D"}
    assert data.anchors["D"] == pytest.approx((6.90 + 6.50 + 6.30) / 3)


def test_the_two_modules_have_different_domains(prepared):
    _cfg, _conn, _window, data = prepared
    predictions = {p.obs.name: p for p in evaluate.predict_window(data, ("R0",))}

    # a regular gets both halves of the valuation
    assert predictions["Regular"].fm_pred is not None
    assert predictions["Regular"].pv_pred is not None
    assert predictions["Regular"].value_pred is not None

    # a fringe player (Pv_prev below the domain the beta was fitted on) gets appearances only:
    # that is the asymmetry the published gates were run with
    fringe = predictions["Fringe"]
    assert fringe.fm_pred is None
    assert fringe.pv_pred is not None
    assert fringe.value_pred is None

    # a newcomer with no previous season gets nothing at all - the hole R1 addresses
    assert "Newcomer" not in predictions


def test_keeper_goes_through_the_decomposed_module(prepared):
    _cfg, _conn, _window, data = prepared
    keeper = next(p for p in evaluate.predict_window(data, ("R0",)) if p.obs.name == "Keeper")
    # M2e works off Mv and the club's conceded rate and never touches the role anchor - so a keeper
    # stays predictable even where no 'P' anchor could be computed at all
    assert "P" not in data.anchors
    assert keeper.anchor is None
    assert keeper.fm_pred is not None
    expected = (6.15 + 0.40 * (6.20 - 6.15)) - data.mu_rate + 0.055
    assert keeper.fm_pred == pytest.approx(expected)


def test_metrics_separate_coverage_of_value_and_appearances(prepared):
    _cfg, _conn, _window, data = prepared
    report = evaluate.evaluate_window(data, ("R0",))
    overall = report["overall"]
    assert overall["n_predicted"] < overall["n_predicted_pv"]      # fringe has Pv but no VALUE
    assert overall["coverage"] < overall["coverage_pv"]
    # the VALUE error is decomposed into its two sides, which is the roadmap's compass
    assert {"contrib_fm", "contrib_pv", "spearman"} <= set(overall["value"])
    assert report["share_coeffs"][1] == pytest.approx(0.50)        # published coefficients by default


def test_target_season_flags_and_late_states_are_invisible(prepared):
    """The look-ahead audit, pinned: only what predates the auction may reach an Observation."""
    _cfg, conn, window, _data = prepared
    conn.executemany("INSERT INTO flags(fc_id, season, flag, value, source) VALUES (?, ?, ?, ?, ?)",
                     [(1, TARGET_SEASON, "off_role_usage", "1", "sofascore")])
    conn.execute("INSERT INTO probable_starter(fc_id, valid_from, probability, source) "
                 "VALUES (1, '2025-01-31', 0.9, 'fc_site')")          # after the auction
    conn.commit()
    by_id = {obs.fc_id: obs for obs in features.load(conn, window, "euro")}
    assert by_id[1].off_role_prev is False, "a target-season flag leaked into the inputs"
    assert by_id[1].starter_prob is None, "a state dated after the auction leaked into the inputs"

    # the same facts, dated before the auction, must be picked up
    conn.execute("INSERT INTO flags(fc_id, season, flag, value, source) "
                 "VALUES (1, ?, 'off_role_usage', '1', 'sofascore')", (INPUT_SEASON,))
    conn.execute("INSERT INTO probable_starter(fc_id, valid_from, probability, source) "
                 "VALUES (1, '2024-08-01', 0.8, 'fc_site')")
    conn.commit()
    reloaded = {obs.fc_id: obs for obs in features.load(conn, window, "euro")}
    assert reloaded[1].off_role_prev is True
    assert reloaded[1].starter_prob == pytest.approx(0.8)


def test_share_fit_needs_a_window_where_the_regressors_actually_vary(prepared):
    _cfg, conn, window, data = prepared
    coefficients, samples = evaluate.fit_share(data)
    assert samples == 7                       # the seven players present in both seasons
    # Nobody changed club here, so that column is constant and the design is singular: the fit must
    # decline rather than return coefficients the data cannot identify.
    assert coefficients is None

    conn.execute("UPDATE rosters SET fc_club_id = 2 WHERE fc_id = 7 AND season = ?",
                 (TARGET_SEASON,))
    conn.commit()
    moved = features.prepare(conn, window, "euro", "classic")
    coefficients, samples = evaluate.fit_share(moved)
    assert samples == 7
    assert coefficients is not None and len(coefficients) == 4


def test_rules_registry_refuses_what_is_not_built_yet():
    assert evaluate.parse_rules(None) == ("R0",)
    assert evaluate.parse_rules("r0") == ("R0",)
    with pytest.raises(SystemExit, match="not implemented"):
        evaluate.parse_rules("R0,R3")
    with pytest.raises(SystemExit, match="unknown rule"):
        evaluate.parse_rules("R42")


def test_run_writes_a_report_and_leaves_the_db_alone(prepared):
    cfg, conn, _window, _data = prepared
    before = {table: conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
              for table in ("rosters", "season_stats", "match_ratings", "flags")}
    ctx = Context(config=cfg, conn=conn)
    # the fixture's seasons are not the real T1/T2, so no window matches: the run must still be safe
    output = evaluate.run(ctx, platforms=["euro"], games=["classic"], rules="R0")
    assert output["rules"] == ["R0"]
    path = cfg.data_dir / "reports" / "engine_backtest.json"
    assert json.loads(path.read_text(encoding="utf-8"))["rules"] == ["R0"]
    after = {table: conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
             for table in before}
    assert after == before, "backtest must be read-only on the DB"
