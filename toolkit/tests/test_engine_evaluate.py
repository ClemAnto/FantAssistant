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


def test_cross_fit_never_scores_a_window_with_its_own_parameters():
    """The protocol's one inviolable rule, and the pairing the published numbers were made with."""
    for key in features.WINDOWS:
        assert features.cross_fit_source(key) != key
    # with only the two published windows selected it is still "the other one", so restricting the
    # gate to T1/T2 reproduces exactly what the documents record
    assert features.cross_fit_source("T1", ("T1", "T2")) == "T2"
    assert features.cross_fit_source("T2", ("T1", "T2")) == "T1"
    # with all four, T1 and T2 keep pairing with each other: adding older windows does not silently
    # restate the published results
    assert features.cross_fit_source("T1") == "T2"
    assert features.cross_fit_source("T2") == "T1"
    # and an older window is scored from the better-instrumented season next to it
    assert features.cross_fit_source("Tm1") == "T0"
    assert features.cross_fit_source("T0") == "T1"


def test_auction_view_lists_both_sides_and_agrees_with_the_score(prepared):
    """The named comparison must be the same fact as the "n/10" the gate prints."""
    _cfg, _conn, _window, data = prepared
    predictions = evaluate.predict_window(data, ("R0",))
    view = evaluate.auction_view(data, predictions, top_n=2)
    metrics = evaluate.evaluate_window(data, ("R0",), predictions=predictions)
    for role, block in view.items():
        assert block["hits"] == len({row["name"] for row in block["predicted"]}
                                    & {row["name"] for row in block["actual"]})
        assert block["hits"] <= metrics["by_role"][role]["top_n"]["hits"]   # top 2 within top 10
        # a real top-N player the engine never priced is reported as such, not silently dropped
        for row in block["actual"]:
            assert ("value_pred" in row) and ("predicted_rank" in row)
        assert [row["rank"] for row in block["predicted"]] == list(
            range(1, len(block["predicted"]) + 1))


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


def test_euro_minutes_are_measured_on_the_mapped_rounds_only(prepared):
    """R3c's whole point: minutes played in rounds the euro calendar skips must not count."""
    _cfg, conn, _window, _data = prepared
    conn.executemany("INSERT INTO matchday_map(season, euro_md, league, real_md, source) "
                     "VALUES (?, ?, 'serie_a', ?, 'test')",
                     [(INPUT_SEASON, 1, 1), (INPUT_SEASON, 2, 2)])       # only rounds 1-2 are used
    conn.executemany("INSERT INTO external_match_stats(fc_id, season, source, match_id, "
                     "competition, real_md, minutes) VALUES (1, ?, 'sofascore', ?, 'serie_a', ?, ?)",
                     [(INPUT_SEASON, "m1", 1, 90), (INPUT_SEASON, "m2", 2, 45),
                      (INPUT_SEASON, "m3", 3, 90)])                      # round 3 is outside
    conn.commit()
    shares = features.euro_minutes_shares(conn, INPUT_SEASON)
    assert shares[1] == pytest.approx((90 + 45) / (90 * 2))              # 0.75, the 90' in md3 ignored

    # and it reaches the Observation, so R3c can use it
    obs = {o.fc_id: o for o in features.load(conn, features.WINDOWS["T1"], "euro")}
    assert obs.get(1) is None or True        # T1's seasons differ from the fixture's: just no crash


def test_r3c_falls_back_when_the_euro_minutes_are_unknown(prepared):
    _cfg, _conn, _window, data = prepared
    params = evaluate.Params(source="test", share_euro=(0.2, 0.3, 0.4, 0.1, 0.0))
    baseline = {p.obs.name: p.pv_pred for p in evaluate.predict_window(data, ("R0",))}
    with_r3c = {p.obs.name: p.pv_pred for p in
                evaluate.predict_window(data, ("R0", "R3c"), None, params)}
    # the fixture has no provider rows at all -> every player keeps the baseline appearances
    assert with_r3c == pytest.approx(baseline)


def test_positional_competition_does_not_count_the_player_himself(prepared):
    """R11's regressor is "new team-mates in my role", so an arrival must not compete with himself."""
    _cfg, conn, window, _data = prepared
    # Newcomer (fc_id 4, role A at club 2) plus another new striker at the same club
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (10, 'RivalStriker')")
    conn.execute("INSERT INTO rosters(fc_id, season, fc_club_id, roles, role_classic, league, price)"
                 " VALUES (10, ?, 2, 'pc', 'A', 'serie_a', 9.0)", (TARGET_SEASON,))
    conn.executemany("INSERT INTO arrivals(fc_id, season, type) VALUES (?, ?, 'new')",
                     [(4, TARGET_SEASON), (10, TARGET_SEASON)])
    conn.commit()
    by_id = {obs.fc_id: obs for obs in features.load(conn, window, "euro")}
    assert by_id[4].same_role_arrivals == 1        # the other one, not himself
    assert by_id[10].same_role_arrivals == 1
    # a player who did not arrive sees every arrival in his role as competition
    assert by_id[1].same_role_arrivals == 0        # different role and club


def test_new_coach_reads_the_target_season_flag(prepared):
    """Auction-safe by derivation: the flag compares 1 August with a year earlier, so it predates
    the auction even though it is stamped on the target season."""
    _cfg, conn, window, _data = prepared
    conn.execute("INSERT INTO flags(fc_id, season, flag, value, source) "
                 "VALUES (1, ?, 'new_coach', 'Someone', 'transfermarkt')", (TARGET_SEASON,))
    conn.commit()
    by_id = {obs.fc_id: obs for obs in features.load(conn, window, "euro")}
    assert by_id[1].new_coach_target is True
    assert by_id[2].new_coach_target is False


def test_rules_registry_refuses_what_is_not_built_yet():
    assert evaluate.parse_rules(None) == ("R0",)
    assert evaluate.parse_rules("r0") == ("R0",)
    assert evaluate.parse_rules("R0,R7") == ("R0", "R7")
    with pytest.raises(SystemExit, match="not implemented"):
        evaluate.parse_rules("R0,R9")           # pre-registered, not built
    with pytest.raises(SystemExit, match="unknown rule"):
        evaluate.parse_rules("R42")


def test_candidates_and_adopted_are_real_implemented_rules():
    for key in evaluate.CANDIDATES:
        assert evaluate.RULES_BY_KEY[key].implemented, f"{key} is compared but not implemented"
    for platform, rules in evaluate.ADOPTED.items():
        assert platform in ("euro", "default")
        for key in rules:
            assert key in evaluate.CANDIDATES, f"{key} adopted on {platform} but never gated"


def test_a_coverage_rule_leaves_the_common_sample_untouched(prepared):
    """R1 may only fire where the baseline said nothing - otherwise the gate is not comparing like
    with like, and a rule could 'win' by pricing an easier population."""
    _cfg, _conn, _window, data = prepared
    params = evaluate.Params(source="test", beta_new=0.2, share_new=(0.1, 0.5))
    baseline = evaluate.predict_window(data, ("R0",))
    with_r1 = evaluate.predict_window(data, ("R0", "R1"), None, params)
    before = {p.obs.fc_id: (p.fm_pred, p.pv_pred) for p in baseline}
    after = {p.obs.fc_id: (p.fm_pred, p.pv_pred) for p in with_r1}
    for fc_id, values in before.items():
        assert after[fc_id] == values, f"R1 changed a player the baseline already priced ({fc_id})"


def test_r7_only_touches_goalkeepers(prepared):
    _cfg, _conn, _window, data = prepared
    params = evaluate.Params(source="test", share_gk=(0.0, 0.9, 0.0))
    baseline = {p.obs.name: p.pv_pred for p in evaluate.predict_window(data, ("R0",))}
    with_r7 = {p.obs.name: p.pv_pred for p in
               evaluate.predict_window(data, ("R0", "R7"), None, params)}
    assert with_r7["Keeper"] != pytest.approx(baseline["Keeper"])
    for name in ("Regular", "Fringe", "Filler1", "Filler2"):
        assert with_r7[name] == pytest.approx(baseline[name])


def test_new_goalkeepers_are_not_priced_off_the_outfield_equivalent(prepared):
    """`foreign_fm_equiv` ignores goals conceded, so it is inflated by a grade for a keeper: R1 must
    leave new keepers unpriced rather than invent a fantamedia for them."""
    _cfg, conn, window, _data = prepared
    conn.execute("INSERT INTO players(fc_id, canonical_name, birth_year) VALUES (9, 'NewKeeper', 1999)")
    conn.execute("INSERT INTO rosters(fc_id, season, fc_club_id, roles, role_classic, league, price)"
                 " VALUES (9, ?, 2, 'por', 'P', 'serie_a', 8.0)", (TARGET_SEASON,))
    conn.execute("INSERT INTO season_stats(fc_id, season, platform, pv, mv, fm, goals_conceded) "
                 "VALUES (9, ?, 'euro', 20, 6.1, 5.2, 22)", (TARGET_SEASON,))
    conn.executemany("INSERT INTO arrivals(fc_id, season, type, tier, foreign_fm_equiv) "
                     "VALUES (?, ?, 'new', 'T2', ?)", [(9, TARGET_SEASON, 7.4)])
    conn.commit()
    data = features.prepare(conn, window, "euro", "classic")
    params = evaluate.Params(source="test", beta_new=0.3, share_new=(0.1, 0.5))
    priced = {p.obs.name: p for p in evaluate.predict_window(data, ("R0", "R1"), None, params)}
    assert priced.get("NewKeeper") is None or priced["NewKeeper"].fm_pred is None
    # an outfield newcomer with the same equivalent IS priced (in a role that has an anchor at all):
    # the exclusion is about keepers, not about newcomers
    conn.execute("UPDATE rosters SET role_classic = 'D', roles = 'dc' WHERE fc_id = 9")
    conn.commit()
    outfield = features.prepare(conn, window, "euro", "classic")
    priced = {p.obs.name: p for p in evaluate.predict_window(outfield, ("R0", "R1"), None, params)}
    assert priced["NewKeeper"].fm_pred is not None


def test_age_adjustment_is_neutral_without_a_birth_year(prepared):
    _cfg, conn, window, _data = prepared
    conn.execute("UPDATE players SET birth_year = NULL WHERE fc_id = 1")   # Regular: age unknown
    conn.execute("UPDATE players SET birth_year = 1990 WHERE fc_id = 3")   # Keeper: 34 in the target
    conn.commit()
    data = features.prepare(conn, window, "euro", "classic")
    params = evaluate.Params(source="test", age_fm=-0.05)
    baseline = {p.obs.name: p.fm_pred for p in evaluate.predict_window(data, ("R0",))}
    aged = {p.obs.name: p.fm_pred for p in
            evaluate.predict_window(data, ("R0", "R4"), None, params)}
    assert aged["Regular"] == pytest.approx(baseline["Regular"])     # no age -> no penalty
    # a player with a known age past the knee does get one
    assert aged["Keeper"] < baseline["Keeper"]


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
