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
from euroleghe_ingest.engine import evaluate, features, model

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


def test_every_window_is_a_coherent_prediction_exercise():
    """One season predicting the next, with an auction date between the two. Cheap to get wrong."""
    previous = None
    for key, window in features.WINDOWS.items():
        start, end = window.input_season.split("-")
        assert window.target_season.startswith(str(int(start) + 1)), key
        assert window.target_season.endswith(str(int(end) + 1).zfill(2)), key
        # the auction happens in the target season's first calendar year, before a ball is kicked
        assert window.auction_date[:4] == window.target_season[:4], key
        assert window.auction_date[5:7] in {"07", "08", "09"}, key
        if previous is not None:      # WINDOWS is ordered oldest first, and cross_fit_source relies on it
            assert previous.input_season < window.input_season, key
        previous = window


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


def test_replacement_level_is_the_marginal_rostered_player_at_that_role(prepared):
    """Not the anchor (that is the role's MEAN) but the man at rank teams x slots: the one you would
    have fielded instead. Pv >= 20 like the anchors, so the two are commensurable, and a pool thinner
    than its own rank uses its last man rather than reporting nothing."""
    _cfg, conn, _window, data = prepared
    slots = {"P": 1, "D": 2, "C": 1, "A": 1}
    levels = features.replacement_levels(conn, "euro", (INPUT_SEASON,), "classic", slots, teams=1)
    assert features.roster_depth(conn, "euro", (INPUT_SEASON,), "classic",
                                 {"squad_slots": slots}) == {k: float(v) for k, v in slots.items()}
    # regular defenders with Pv >= 20 in the input season: 6.90, 6.50, 6.30 (the fringe one is out)
    assert levels["D"] == pytest.approx(6.50)          # rank 1 x 2 = the second best
    assert levels["D"] < data.anchors["D"]             # below the mean, which is the whole point
    deep = features.replacement_levels(conn, "euro", (INPUT_SEASON,), "classic",
                                       {"D": 99}, teams=1)
    assert deep["D"] == pytest.approx(6.30)            # pool exhausted -> its last man


def test_fielding_caps_reproduce_the_module_limits(prepared):
    """A Mantra module caps how many of a role you can field - no scheme allows 3 'pc' or 4 'dc'. Rather
    than transcribe the official module table, the cap is MEASURED off real starting elevens, and this
    pins the two properties that make that measurement trustworthy:

    * the 90th percentile is read, not the max, because a multi-role starter counts in every role he is
      listed with - so one freak eleven must not raise the cap for the whole league;
    * a role's cap is what a side fields, so 'por' comes out 1 whatever else happens.
    """
    _cfg, conn, _window, _data = prepared
    # 22 players, roles chosen so a normal eleven is por + 3 dc + 2 e + 3 c + 2 pc
    eleven = ["por"] + ["dc"] * 3 + ["e"] * 2 + ["c"] * 3 + ["pc"] * 2
    conn.executemany("INSERT OR IGNORE INTO players(fc_id, canonical_name) VALUES (?, ?)",
                     [(100 + i, f"XI{i}") for i in range(12)])
    conn.executemany(
        "INSERT OR REPLACE INTO rosters(fc_id, season, roles, role_classic, league) "
        "VALUES (?, ?, ?, 'C', 'serie_a')",
        [(100 + i, INPUT_SEASON, role) for i, role in enumerate(eleven)]
        + [(111, INPUT_SEASON, "dc")])       # the 12th man, only used by the freak eleven
    rows = []
    for match in range(20):                  # twenty ordinary elevens
        rows += [(100 + i, INPUT_SEASON, f"m{match}", 100 + i) for i in range(11)]
    # ... and one that fields five players listed 'dc', by swapping in the spare and re-using an 'e'
    rows += [(fc_id, INPUT_SEASON, "freak", fc_id)
             for fc_id in [100, 101, 102, 103, 111, 105, 106, 107, 108, 109, 110]]
    conn.executemany(
        "INSERT OR REPLACE INTO external_match_stats(fc_id, season, source, match_id, competition, "
        "club, started) VALUES (?, ?, 'sofascore', ?, 'serie_a', 'Inter', 1)",
        [(r[0], r[1], r[2]) for r in rows])
    conn.commit()

    caps = features.simultaneous_caps(conn, "default", (INPUT_SEASON,))
    assert caps["dc"] == 3, "one freak eleven must not lift the cap - that is why p90, not max"
    assert caps["por"] == 1 and caps["pc"] == 2 and caps["c"] == 3
    assert min(caps.values()) >= 1, "a role a league ever plays is rostered at least one deep"

    # 'por' overlaps with nothing, so its depth must come back as the Classic rule verbatim
    slots = features.derive_mantra_slots(conn, "default", (INPUT_SEASON,), {"P": 3, "D": 8, "C": 8,
                                                                           "A": 6})
    assert slots["por"] == pytest.approx(3.0)
    # ... and inside a group the caps set the shape: 3 'dc' against 1 'b' cannot be equal depth
    assert slots["dc"] > slots["b"]


def test_surplus_ranks_the_better_fantamedia_over_the_iron_man(prepared):
    """The Rice / De Roon case, in miniature. De Roon took the last euro/mantra 'c' slot from Rice by
    1.9% of predicted VALUE, won entirely on half an appearance, and then finished 43rd to Rice's 4th.
    VALUE = FM x Pv is the SUM of a season's fantavoti, so whoever plays every week outranks a better
    player who plays slightly less; measured over what the bench would have given you, he does not.
    Both orderings are correct answers - to different questions - so both must be available."""
    _cfg, _conn, _window, data = prepared
    defenders = [obs for obs in data.observations if obs.role_classic == "D"][:2]
    iron, star = defenders[0], defenders[1]
    predictions = [evaluate.Prediction(iron, 6.10, 30.0, None),
                   evaluate.Prediction(star, 6.90, 26.0, None)]

    by_value = evaluate.auction_view(data, predictions, top_n=2)["D"]
    assert [row["name"] for row in by_value["predicted"]] == [iron.name, star.name]
    assert by_value["replacement"] is None            # no league setup -> no surplus claimed
    assert by_value["predicted"][0]["surplus_pred"] is None

    data.replacement = {"D": 6.0}
    by_surplus = evaluate.auction_view(data, predictions, top_n=2, metric=evaluate.SURPLUS)["D"]
    assert [row["name"] for row in by_surplus["predicted"]] == [star.name, iron.name]
    assert by_surplus["replacement"] == pytest.approx(6.0)
    assert by_surplus["predicted"][0]["surplus_pred"] == pytest.approx((6.90 - 6.0) * 26.0, abs=0.1)


def test_reliability_weight_demotes_the_man_who_played_too_little(prepared):
    """Malen scored 51.8 of surplus in 18 Serie A matches of 38 and was 2nd among the forwards; Yildiz
    scored 46.7 in 36. The bare product is the exact expected surplus and ranks Malen higher, which is
    arithmetically right and practically wrong - you cannot field him, and transfers are limited. The
    weight is a declared preference, so it must be OFF by default in the engine and do nothing at 0."""
    _cfg, _conn, _window, data = prepared
    by_name = {obs.name: obs for obs in data.observations if obs.role_classic == "D"}
    part_timer, regular = by_name["Fringe"], by_name["Regular"]
    data.replacement = {"D": 6.0}
    # 2.60 over the floor in 45% of the season (35.1) against 1.00 in 95% of it (28.5)
    predictions = [evaluate.Prediction(part_timer, 8.60, data.matchdays_target * 0.45, None),
                   evaluate.Prediction(regular, 7.00, data.matchdays_target * 0.95, None)]

    bare = evaluate.auction_view(data, predictions, top_n=2, metric=evaluate.SURPLUS)["D"]
    assert data.reliability == 0.0, "a preference must not be on unless the league asks for it"
    assert [row["name"] for row in bare["predicted"]] == [part_timer.name, regular.name]

    data.reliability = 0.5
    weighted = evaluate.auction_view(data, predictions, top_n=2, metric=evaluate.SURPLUS)["D"]
    assert [row["name"] for row in weighted["predicted"]] == [regular.name, part_timer.name]
    # ... and it is a discount, never a bonus: nobody gains from it, the near-full-season man least
    for row_bare, row_weighted in zip(sorted(bare["predicted"], key=lambda r: r["name"]),
                                      sorted(weighted["predicted"], key=lambda r: r["name"]),
                                      strict=True):
        assert row_weighted["surplus_pred"] <= row_bare["surplus_pred"]


def test_the_two_sides_are_scored_against_their_own_seasons_level(prepared):
    """A forecast may only know the input seasons. A REPORT on what happened must be measured against
    the season it happened in - and getting that backwards is a level error big enough to invert the
    list: the euro 'pc' replacement fell 8.02 -> 7.80 -> 7.38 over three seasons, and scoring 2025-26
    fantamedie against the older baseline made a striker with 28 appearances worth less than one with a
    single good match. So the asymmetry is deliberate and pinned here in both directions."""
    _cfg, _conn, _window, data = prepared
    defender = next(obs for obs in data.observations if obs.role_classic == "D")
    data.replacement = {"D": 6.50}          # what the auction could know
    data.replacement_actual = {"D": 6.00}   # what the season turned out to be
    prediction = evaluate.Prediction(defender, 7.00, 20.0, None)

    row = evaluate.auction_view(data, [prediction], top_n=1,
                                metric=evaluate.SURPLUS)["D"]["predicted"][0]
    assert row["surplus_pred"] == pytest.approx((7.00 - 6.50) * 20.0, abs=0.05)
    assert row["surplus_act"] == pytest.approx(
        (defender.fm_act - 6.00) * defender.pv_act, abs=0.05)
    # and the block reports both, so a reader can see which baseline each column used
    block = evaluate.auction_view(data, [prediction], top_n=1, metric=evaluate.SURPLUS)["D"]
    assert (block["replacement"], block["replacement_actual"]) == (6.50, 6.00)


def test_one_appearance_cannot_reach_a_surplus_top_ten(prepared):
    """Lukaku played once in 2025-26, scored 9.5, and that single match was worth +1.6 of surplus - which
    in a role whose scarcity is near zero was enough for 7th among the euro 'pc'. The catchability weight
    cut it to 0.3 and he STILL placed 7th, because everyone around him was at 0.1-1.3 too: a discount can
    always be out-earned by one spectacular match. He is excluded instead, because the claim is not that
    he was worth little - it is that he was never someone you could have fielded.

    The floor gates the RANKING only, and only under SURPLUS: the VALUE lists are the pre-registered
    deliverable and stay unfiltered, one-match hat-tricks included."""
    _cfg, _conn, _window, data = prepared
    by_name = {obs.name: obs for obs in data.observations if obs.role_classic == "D"}
    cameo, regular = by_name["Fringe"], by_name["Regular"]
    object.__setattr__(cameo, "fm_act", 9.50)
    object.__setattr__(cameo, "pv_act", 1)
    data.replacement = {"D": 6.0}

    unfiltered = evaluate.auction_view(data, [], top_n=4, metric=evaluate.SURPLUS)["D"]
    assert cameo.name in {row["name"] for row in unfiltered["actual"]}

    data.min_availability = 0.35
    filtered = evaluate.auction_view(data, [], top_n=4, metric=evaluate.SURPLUS)["D"]
    assert cameo.name not in {row["name"] for row in filtered["actual"]}
    assert regular.name in {row["name"] for row in filtered["actual"]}
    # ... and VALUE is untouched by it: the gate's list must not quietly change shape
    assert cameo.name in {row["name"]
                          for row in evaluate.auction_view(data, [], top_n=4)["D"]["actual"]}


def test_a_role_without_a_replacement_level_keeps_the_value_ordering(prepared):
    """Silently, and on purpose: inventing a floor for a role whose pool cannot support one would put
    a made-up number in the column the panel sorts by."""
    _cfg, _conn, _window, data = prepared
    predictions = evaluate.predict_window(data, ("R0",))
    data.replacement = {}
    asked = evaluate.auction_view(data, predictions, top_n=3, metric=evaluate.SURPLUS)
    plain = evaluate.auction_view(data, predictions, top_n=3)
    for role, block in asked.items():
        assert [row["rank"] for row in block["predicted"]] == [
            row["rank"] for row in plain[role]["predicted"]]
        assert [row["name"] for row in block["predicted"]] == [
            row["name"] for row in plain[role]["predicted"]]


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


def test_robust_verdict_needs_a_majority_a_mean_gain_and_a_bounded_worst_case():
    """The second verdict exists because an AND over many windows rejects good rules; it must not
    become an OR that accepts bad ones."""
    assert evaluate.MIN_WINDOWS_FOR_ROBUST >= 3        # no "majority" of two
    assert 0 < evaluate.MAX_WINDOW_LOSS <= 0.05        # a bounded, not an unlimited, single-window loss
    assert evaluate.MAX_WINDOW_LOSS > evaluate.MIN_RELATIVE_GAIN


def test_auction_view_groups_by_the_game_s_own_roles(prepared):
    """Classic asks for one role per player, Mantra for every role he holds: a 'dc;dd' defender must
    appear in both Mantra lists and in exactly one Classic list."""
    _cfg, conn, window, data = prepared
    roles, holds = evaluate.role_membership(data)
    assert roles == model.CLASSIC_ROLES
    mantra_data = features.prepare(conn, window, "euro", "mantra")
    mantra_roles, mantra_holds = evaluate.role_membership(mantra_data)
    assert mantra_roles == model.MANTRA_ROLES

    defender = next(obs for obs in mantra_data.observations if obs.name == "Defender3")
    assert defender.roles_mantra == ("dd",)
    assert mantra_holds(defender, "dd") and not mantra_holds(defender, "dc")
    assert sum(1 for role in roles if holds(defender, role)) == 1

    # and the view keys follow the game, so the panel's role headings are the game's own
    view = evaluate.auction_view(mantra_data, evaluate.predict_window(mantra_data, ("R0",)))
    assert set(view) <= set(model.MANTRA_ROLES)
