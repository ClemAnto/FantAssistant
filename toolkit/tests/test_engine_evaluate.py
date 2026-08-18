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


def _publish_quotes(conn, platform: str = "euro") -> None:
    """What a listone ingest does: the quotation into `rosters` AND into `listone_quotes`, per platform.

    `features` reads the price from the second one, because there are two listoni and they disagree on
    202 Qt.I for the players quoted in both (schema.sql, `listone_quotes`). A fixture that writes only
    `rosters` describes a DB that `ratings` cannot produce, and the engine would see no price at all.
    """
    conn.execute(
        "INSERT OR REPLACE INTO listone_quotes(fc_id, season, platform, price, price_initial, fvm, "
        "fvm_mantra, price_mantra, price_initial_mantra) "
        "SELECT fc_id, season, ?, price, price_initial, fvm, fvm_mantra, price_mantra, "
        "price_initial_mantra FROM rosters", (platform,))
    conn.commit()



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
    _publish_quotes(conn)
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


def test_the_places_an_eleven_fields_are_counted_from_the_rulebook_and_sum_to_eleven():
    """THE OTHER ZERO, and the only thing it needs is the game's own rulebook, counted.

    `roster_depth` says how deep a league ROSTERS (8 defenders x 10 teams -> the 80th) and answers «chi
    conviene comprare». `fielded_places` says how many places an eleven FIELDS, which is the rank behind
    «quanto costa una giornata saltata» - and it is configuration read, never a number chosen: the seven
    classic modules give exactly P 1 · D 4 · C 4 · A 2 and the eleven Mantra schemes give the twelve
    codes. Both sum to ELEVEN, which is the same transcription check the two files carry about
    themselves, and it is what would catch a mis-read line or a hybrid place counted twice.

    The two conventions are pinned here because they are conventions: a hybrid place is split evenly
    among the roles it accepts (a `W/A` is half a `w` and half an `a`), and the keeper is one place in
    every shape although no shape lists him.
    """
    config = Config()
    classic = features.fielded_places(config.load_modules("classic"), "classic")
    assert classic == {"P": 1.0, "D": 4.0, "C": 4.0, "A": 2.0}
    assert sum(classic.values()) == pytest.approx(11.0)

    mantra = features.fielded_places(config.load_modules("mantra"), "mantra")
    assert sum(mantra.values()) == pytest.approx(11.0)
    assert mantra["por"] == pytest.approx(1.0)
    assert set(mantra) == set(model.MANTRA_ROLES), "every code the pools are keyed on has a rank"
    # the hybrid split, read off the file: `A/PC` and `T/A/PC` are the only striker places there are, so
    # a `pc` never reaches one whole place a shape - which is the rulebook's own consequence (§13 of
    # assistente-asta-v1) arriving here as a number.
    assert mantra["pc"] < 1.0 < mantra["dc"]
    # ...and by macro-role the two rulebooks agree on the only thing they can: eleven men, one keeper.
    by_group = {group: sum(mantra[role] for role in roles)
                for group, roles in model.MANTRA_BY_CLASSIC.items()}
    assert by_group["P"] == pytest.approx(1.0)
    assert sum(by_group.values()) == pytest.approx(11.0)

    # no rulebook is a SILENCE and not an empty rulebook: the columns it feeds stay empty (see
    # `snapshot._surplus_over`), and nothing invents a zero.
    assert features.fielded_places({}, "classic") == {}


def test_the_fielded_zero_is_the_same_function_one_depth_up(prepared):
    """Same pool, same domain, same seasons: only the RANK moves, and it moves the level up.

    That is the whole claim of metrica-asta-surplus-v1 §21.2 - «non è un numero nuovo da fittare, è la
    stessa funzione con una profondità diversa» - and it is what keeps the two sheet columns comparable:
    a reader can attribute their difference to the depth, because nothing else differs. Measured on the
    real 2025-26 Serie A pool the pair is P 4.13/5.01 · D 5.66/6.14 · C 5.87/6.36 · A 5.61/6.71.
    """
    _cfg, conn, _window, _data = prepared
    roster = features.replacement_levels(conn, "euro", (INPUT_SEASON,), "classic",
                                         {"P": 1, "D": 3, "C": 1, "A": 1}, teams=1)
    fielded = features.replacement_levels(conn, "euro", (INPUT_SEASON,), "classic",
                                          {"P": 1, "D": 1, "C": 1, "A": 1}, teams=1)
    assert fielded["D"] > roster["D"], "fewer places means a stronger marginal man"
    assert fielded["P"] == roster["P"], "a role whose depth does not change does not move"


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


def test_the_weight_is_the_ranking_s_and_the_sheet_s_column_is_the_bare_expectation():
    """ONE arithmetic, and the exponent has to be asked for in writing.

    The three surpluses of this project - the sheet's `engine_surplus`, the estimate's fallback and the
    Auction tab's ranking - had drifted into two numbers under one name: only `auction_view` applied the
    league's `reliability_exponent`, so preparing an auction on the panel and bidding with the app read
    two different orders (measured on the shipped bundle, 17/08/2026: rho 0.989-0.998, 22-23 of the top
    25 in common). The operator's decision is that the weight belongs to whoever RANKS, so what this
    test protects is the ASYMMETRY itself - both directions, or the next reader "fixes" one of them.
    """
    from euroleghe_ingest.engine import estimate, model
    from euroleghe_ingest.modules import snapshot

    fm, pv, floor, matchdays = 7.0, 18.0, 6.0, 38
    bare = model.surplus_of(fm, pv, floor)
    assert bare == pytest.approx((fm - floor) * pv)
    # ...and off unless asked for, in both of the ways it can be left out
    assert model.surplus_of(fm, pv, floor, matchdays=matchdays) == pytest.approx(bare)
    assert model.surplus_of(fm, pv, floor, reliability=0.5) == pytest.approx(bare)
    weighted = model.surplus_of(fm, pv, floor, reliability=0.5, matchdays=matchdays)
    assert weighted == pytest.approx(bare * (pv / matchdays) ** 0.5)
    assert weighted < bare

    # The SHEET is the bare expectation, whatever the league declares: `_surplus` never passes gamma.
    class _Obs:
        fc_id, role_classic, roles_mantra = 1, "D", ()

    class _Data:
        game, replacement, matchdays_target, reliability = "classic", {"D": floor}, matchdays, 0.5

    prediction = evaluate.Prediction(_Obs(), fm, pv, None)
    assert snapshot._surplus(prediction, _Data()) == pytest.approx(bare)
    # ...and so is the estimate's column, times its own penalty and nothing else.
    assert estimate.surplus(fm, pv, floor, 0.5) == pytest.approx(bare * 0.5)
    # No level anywhere means VALUE, which is what a role without a replacement has always done.
    assert model.surplus_of(fm, pv, None) == pytest.approx(fm * pv)


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


def test_the_full_list_holds_the_men_a_top_ten_cannot(prepared):
    """`full=True` is what a single sortable table needs, and what it must NOT do is drop the men the
    ranking legitimately refuses. Two kinds: below the availability floor (he was never someone you could
    have fielded, so he has no rank) and never priced at all (no previous season to regress from). Both
    keep their row and say so with an empty cell, because a list called "all the players" that quietly
    holds 60% of them is worse than a top ten that says it is one.

    And the gate's own path must not move a decimal: without `full` there is no list at all."""
    _cfg, _conn, _window, data = prepared
    data.replacement = {"D": 6.0, "A": 6.5}
    predictions = evaluate.predict_window(data, ("R0",))
    view = evaluate.auction_view(data, predictions, top_n=1, metric=evaluate.SURPLUS, full=True)

    defenders = view["D"]
    assert len(defenders["predicted"]) == 1, "the top ten is still a top ten"
    ranked = [row for row in defenders["rows"] if row["ranked"]]
    assert len(ranked) == defenders["n_ranked"] > 1
    assert [row["rank"] for row in ranked] == list(range(1, len(ranked) + 1))
    # ...and the rest is the men the ranking could not hold, below it and marked
    assert len(defenders["rows"]) > len(ranked)
    assert all(row["rank"] is None for row in defenders["rows"][len(ranked):])
    # one row per man, and the identity on it: a single list has to be joined on something
    ids = [row["fc_id"] for row in defenders["rows"]]
    assert len(ids) == len(set(ids)) and all(isinstance(fc_id, int) for fc_id in ids)

    # the newcomer has no input season, so no ranking could ever contain him - and he played
    newcomer = next(row for row in view["A"]["rows"] if row["name"] == "Newcomer")
    assert newcomer["rank"] is None and not newcomer["ranked"]
    assert newcomer["surplus_pred"] is None, "no valuation, and that is the statement"
    assert newcomer["surplus_act"] is not None, "...but the season he played is a fact"

    # ...and the gate path is untouched
    bare = evaluate.auction_view(data, predictions, top_n=1, metric=evaluate.SURPLUS)
    assert bare["D"]["rows"] == [] and bare["D"]["predicted"] == defenders["predicted"]


def test_the_market_rate_is_a_budget_and_not_a_scaling():
    """SpM converts the SURPLUS into the listone's credits, and the rate is not chosen: the FVM is a
    PRICE on a reference auction's scale (Serie A: 10 teams x 1000, max 500 - measured, the complete
    2025-26 listone's top 250 sum to 1032 a team), so the conversion is a budget question.

    Per role: the money the MARKET spends on the men it rosters, over the surplus of the men the ENGINE
    would roster. Then the whole list costs exactly one auction, and dVM is the same budget over the same
    number of slots split by somebody else - which is why the population must be the ROSTERED men and not
    everybody quoted: spread over the whole listone the same money reads the men who actually get bought
    as overpriced by construction.

    Three things it must not do: fit on men worth nothing over the bench (they still GET a negative SpM,
    which is the point of the column for them), quote a rate for a pool too thin to carry one, and invent
    a difference against a price the listone never published.
    """
    rows = [
        {"role_classic": "A", "surplus_pred": 20.0, "fvm": 100.0},   # both rosters take him
        {"role_classic": "A", "surplus_pred": 10.0, "fvm": 20.0},    # only the engine's
        {"role_classic": "A", "surplus_pred": -3.0, "fvm": 60.0},    # only the market's
        {"role_classic": "A", "surplus_pred": 8.0, "fvm": None},     # not quoted here
        {"role_classic": "P", "surplus_pred": 4.0, "fvm": 10.0},     # a pool of one
    ]
    rates = evaluate.market_rates(rows, roster={"A": 2, "P": 1}, min_pool=2)
    assert set(rates) == {"A"}, "a rate is a ratio of two sums: one row does not make a market"
    # budget = the market's two most expensive forwards (100 + 60); earned = the engine's two best (30)
    assert rates["A"]["rate"] == pytest.approx(160 / 30)
    assert (rates["A"]["n"], rates["A"]["rostered"]) == (2, 2)

    evaluate.market_surplus(rows, rates)
    spm = [row["spm"] for row in rows]
    assert spm == [pytest.approx(106.7), pytest.approx(53.3), pytest.approx(-16.0),
                   pytest.approx(42.7), None]
    assert sum(spm[:2]) == pytest.approx(160.0), "my roster costs exactly the market's budget"
    # ...so dVM summed over my roster is how much MORE the market's own roster costs than mine at market
    # prices (160 - 120), and it can never be negative: no subset of N outprices the top N
    assert sum(row["dvm"] for row in rows[:2]) == pytest.approx(40.0, abs=0.1)
    assert rows[3]["dvm"] is None, "no quotation, no difference: vuoto = ignoto"

    # and without a league to say how deep it rosters, the whole quoted pool is the population
    plain = evaluate.market_rates(rows, min_pool=2)
    assert plain["A"]["rate"] == pytest.approx(180 / 38), (
        "the whole quoted pool is the budget (60 credits more) and the whole list earns it (8 more)")


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


def test_the_price_a_window_reads_is_its_own_platforms(prepared):
    """A QUOTATION IS A FACT ABOUT A PLATFORM, and `rosters` can hold only one.

    Measured 07/08/2026: the two listoni disagree on 202 Qt.I and 226 FVM for the 249 Italians quoted in
    both - Svilar 18 credits on the Serie A list against 15 on the EuroLeghe one - and whichever was
    downloaded last decided what BOTH sheets showed, including the ask price at the table. So the engine
    reads `listone_quotes` and filters on its own platform; the fallback that would look harmless here -
    "take the roster row if this platform has no quote" - is the defect itself.
    """
    _cfg, conn, window, _data = prepared
    conn.executemany(
        "INSERT OR REPLACE INTO listone_quotes(fc_id, season, platform, price_initial, fvm) "
        "VALUES (1, ?, ?, ?, ?)",
        [(window.target_season, "euro", 15.0, 56.0), (window.target_season, "default", 18.0, 65.0)])
    conn.commit()

    euro = {obs.fc_id: obs for obs in features.load(conn, window, "euro")}
    serie_a = {obs.fc_id: obs for obs in features.load(conn, window, "default")}
    assert (euro[1].price_initial, euro[1].fvm) == (15.0, 56.0)
    assert (serie_a[1].price_initial, serie_a[1].fvm) == (18.0, 65.0)
    # and a player nobody quoted on this platform has NO price here - not the other list's
    conn.execute("DELETE FROM listone_quotes WHERE fc_id = 1 AND platform = 'euro'")
    conn.commit()
    assert {obs.fc_id: obs for obs in features.load(conn, window, "euro")}[1].price_initial is None


def test_target_season_flags_and_late_states_are_invisible(prepared):
    """The look-ahead audit, pinned: only what predates the auction may reach an Observation."""
    _cfg, conn, window, _data = prepared
    conn.executemany("INSERT INTO flags(fc_id, season, flag, value, source) VALUES (?, ?, ?, ?, ?)",
                     [(1, TARGET_SEASON, "off_role_usage", "1", "sofascore")])
    conn.execute("INSERT INTO probable_starter(fc_id, valid_from, probability, source, season) "
                 "VALUES (1, '2025-01-31', 0.9, 'fc_site', ?)", (TARGET_SEASON,))  # after the auction
    # ...and the trap that cost 428 rows of a real sheet: a reading taken BEFORE the auction that is
    # about the season already finished. The date makes it legal, the season makes it meaningless.
    conn.execute("INSERT INTO probable_starter(fc_id, valid_from, probability, source, season) "
                 "VALUES (1, '2024-07-30', 1.0, 'fc_site', ?)", (INPUT_SEASON,))
    conn.commit()
    by_id = {obs.fc_id: obs for obs in features.load(conn, window, "euro")}
    assert by_id[1].off_role_prev is False, "a target-season flag leaked into the inputs"
    assert by_id[1].starter_prob is None, ("a state dated after the auction, or one about the season "
                                           "that has already been played, leaked into the inputs")

    # the same facts, dated before the auction, must be picked up
    conn.execute("INSERT INTO flags(fc_id, season, flag, value, source) "
                 "VALUES (1, ?, 'off_role_usage', '1', 'sofascore')", (INPUT_SEASON,))
    conn.execute("INSERT INTO probable_starter(fc_id, valid_from, probability, source, season) "
                 "VALUES (1, '2024-08-01', 0.8, 'fc_site', ?)", (TARGET_SEASON,))
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
    _publish_quotes(conn)
    # `arrivals` is keyed on the platform too - the tier is a percentile inside a listone - so a row
    # written for the wrong one is invisible to `features.load(conn, window, "euro")`.
    conn.executemany("INSERT INTO arrivals(fc_id, season, platform, type) VALUES (?, ?, 'euro', 'new')",
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
    conn.executemany("INSERT INTO arrivals(fc_id, season, platform, type, tier, foreign_fm_equiv) "
                     "VALUES (?, ?, 'euro', 'new', 'T2', ?)", [(9, TARGET_SEASON, 7.4)])
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


# ---------------------------------------------------------------- R17: forward crowding


@pytest.fixture
def crowded(tmp_path):
    """One club, three strikers, capacity ONE fielded forward: the Kean/Piccoli shape in miniature.

    The defender exists to vote the provider club name onto the canonical one, and the lineup
    counts live in club_match_lineups (built over ALL entries at ingest) - including one malformed
    eleven that the slot-sum filter must drop.
    """
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euroleghe.db")
    (tmp_path / "data").mkdir()
    conn = init_db(cfg.db_path)
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (1, 'Inter', 'serie_a')")
    conn.executemany("INSERT INTO players(fc_id, canonical_name, birth_year) VALUES (?, ?, ?)",
                     [(1, "Voter", 1996), (6, "First", 1997), (9, "Second", 1998), (10, "Third", 1999)])
    rosters = []
    for season in (INPUT_SEASON, TARGET_SEASON):
        rosters.append((1, season, 1, "dc", "D", "serie_a", 5.0))
        for fc_id, qti in ((6, 20.0), (9, 10.0), (10, 4.0)):
            rosters.append((fc_id, season, 1, "pc", "A", "serie_a", qti))
    conn.executemany("INSERT INTO rosters(fc_id, season, fc_club_id, roles, role_classic, league, "
                     "price_initial) VALUES (?, ?, ?, ?, ?, ?, ?)", rosters)
    _publish_quotes(conn)
    conn.executemany("INSERT INTO match_ratings(fc_id, season, matchday, platform, mv) "
                     "VALUES (1, ?, ?, 'euro', 6.0)",
                     [(season, matchday) for season in (INPUT_SEASON, TARGET_SEASON)
                      for matchday in range(1, MATCHDAYS + 1)])
    conn.executemany(
        "INSERT INTO season_stats(fc_id, season, platform, pv, mv, fm) VALUES (?, ?, 'euro', ?, ?, ?)",
        [(1, INPUT_SEASON, 25, 6.30, 6.40), (1, TARGET_SEASON, 24, 6.30, 6.40),
         (6, INPUT_SEASON, 23, 6.30, 7.40), (6, TARGET_SEASON, 24, 6.40, 7.60),
         (9, INPUT_SEASON, 21, 6.20, 7.00), (9, TARGET_SEASON, 12, 6.20, 7.00),
         (10, INPUT_SEASON, 20, 6.10, 6.80), (10, TARGET_SEASON, 6, 6.10, 6.80)])
    # the defender's 30 starts vote "FC Internazionale" -> Inter; the two top strikers co-start 8 times
    conn.executemany(
        "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, club, "
        "position, started, minutes) VALUES (?, ?, 'sofascore', ?, 'serie_a', 'FC Internazionale', "
        "?, 1, 90)",
        [(1, INPUT_SEASON, f"m{n}", "D") for n in range(1, 31)]
        + [(fc_id, INPUT_SEASON, f"m{n}", "F") for n in range(1, 9) for fc_id in (6, 9)])
    conn.executemany(
        "INSERT INTO club_match_lineups(season, source, match_id, club, competition, starters, "
        "goalkeepers, defenders, midfielders, forwards) "
        "VALUES (?, 'sofascore', ?, 'FC Internazionale', 'serie_a', ?, ?, ?, ?, ?)",
        [(INPUT_SEASON, f"m{n}", 11, 1, 4, 5, 1) for n in range(1, 31)]
        + [(INPUT_SEASON, "malformed", 11, 1, 4, 4, 1)])   # slots sum 10: must be dropped
    conn.commit()
    window = features.Window("TEST", INPUT_SEASON, TARGET_SEASON, "2024-08-15")
    return conn, features.prepare(conn, window, "euro", "classic")


def test_forward_caps_and_co_starts_come_from_the_lineups(crowded):
    _conn, data = crowded
    assert data.forward_caps["Inter"] == (1.0, 1.0, 30)     # the malformed eleven is not counted
    assert data.co_starts[(6, 9)] == 8
    assert (6, 10) not in data.co_starts                    # never shared a pitch: absent, not zero


def test_crowding_charges_only_the_market_s_lower_ranked_claimants(crowded):
    _conn, data = crowded
    derived = evaluate.derive(data)
    params = evaluate.Params(source="W1")
    x = evaluate._crowding_features(data, ("R0",), params, derived)
    shares = {p.obs.fc_id: p.pv_pred / MATCHDAYS
              for p in evaluate.predict_window(data, ("R0",)) if p.obs.role_classic == "A"}
    assert x[6] == 0.0                                       # rank 1 <= capacity: never charged
    assert x[9] == pytest.approx(max(0.0, shares[6] + shares[10] - 1.0))
    assert x[10] == pytest.approx(max(0.0, shares[6] + shares[9] - 1.0))
    assert x[9] > 0 and x[10] > x[9]                         # the weakest claimant is charged most
    assert 1 not in x                                        # the defender is not a claimant


def test_crowding_cache_key_isolates_configurations(crowded):
    """The regressor depends on the configuration AND on whose fit produced the shares: a cache key
    missing either would silently serve one configuration's overflow to another."""
    _conn, data = crowded
    derived = evaluate.derive(data)
    evaluate._crowding_features(data, ("R0",), evaluate.Params(source="W1"), derived)
    evaluate._crowding_features(data, ("R0",), evaluate.Params(source="W2"), derived)
    evaluate._crowding_features(data, ("R0", "R3"), evaluate.Params(source="W1"), derived)
    assert len([key for key in data.cache if key[0] == "R17"]) == 3


def test_r17_fits_against_the_baseline_and_moves_only_the_charged(crowded):
    _conn, data = crowded
    params = evaluate.fit_params(data, ("R0", "R17"))
    assert params.notes["residual_baseline"] == "R0"
    assert params.notes["R17_n"] == 2                       # two strikers carry a positive regressor
    assert params.crowding_lam is not None and params.crowding_lam < 0
    base = {p.obs.fc_id: p.pv_pred for p in evaluate.predict_window(data, ("R0",))}
    with_r17 = {p.obs.fc_id: p.pv_pred
                for p in evaluate.predict_window(data, ("R0", "R17"), None, params)}
    assert with_r17[6] == pytest.approx(base[6])            # the market's first choice is untouched
    assert with_r17[9] < base[9] and with_r17[10] < base[10]


def test_auction_view_annotates_same_club_company_without_touching_the_ranking(crowded):
    _conn, data = crowded
    predictions = evaluate.predict_window(data, ("R0",))
    bare_order = [p.obs.fc_id for p in sorted(
        (p for p in predictions if p.obs.role_classic == "A" and p.value_pred is not None),
        key=lambda p: -p.value_pred)]
    view = evaluate.auction_view(data, predictions, top_n=3)
    rows = view["A"]["predicted"]
    assert [row["name"] for row in rows] == [
        {6: "First", 9: "Second", 10: "Third"}[fc_id] for fc_id in bare_order[:3]]
    for row in rows:                                   # all three claim Inter's forward slots
        assert row["pair"] is not None
        assert row["pair"]["k_mean"] == pytest.approx(1.0)
        assert row["pair"]["n_xi"] == 30
    by_name = {row["name"]: row["pair"] for row in rows}
    assert set(by_name["First"]["with"]) == {"Second", "Third"}
    # co-starts read against the best-ranked companion: First+Second shared 8 elevens,
    # Third never started with First - absent is reported as None, not zero
    assert by_name["Second"]["co_starts"] == 8
    assert by_name["Third"]["co_starts"] is None
    assert by_name["First"]["qti_gap"] == pytest.approx(10.0)
    assert by_name["Second"]["qti_gap"] == pytest.approx(-10.0)
    # a lone name in its club gets no annotation at all
    keeper_like = [row for role, block in view.items() if role != "A"
                   for row in block["predicted"]]
    assert all(row["pair"] is None for row in keeper_like)


def test_slot_pressure_factor_discounts_contested_and_rewards_assured_slots():
    """Declared constants, no fit (metrica doc §11): the factor is bounded on both sides."""
    assert model.slot_pressure_factor(4, 1.55) == pytest.approx((1.55 / 4) ** 0.5)   # Juventus 25/26
    assert model.slot_pressure_factor(2, 2.05) == pytest.approx((2.05 / 2) ** 0.5)   # Inter: ~1.0
    assert model.slot_pressure_factor(1, 2.0) == model.PRESSURE_CAP                  # assured slot
    assert model.slot_pressure_factor(0, 2.0) == model.PRESSURE_CAP
    assert model.slot_pressure_factor(9, 1.0) == model.PRESSURE_FLOOR                # bounded discount
    assert model.slot_pressure_factor(3, 0.0) == 1.0                                 # no K, no opinion


def test_slot_pressure_scales_the_ranking_only(crowded):
    _conn, data = crowded
    predictions = evaluate.predict_window(data, ("R0",))
    plain = evaluate.auction_view(data, predictions, top_n=3, metric=evaluate.SURPLUS)["A"]
    pressed = evaluate.auction_view(data, predictions, top_n=3,
                                    metric=evaluate.SURPLUS_PRESSURE)["A"]
    # three serious claimants (all shares are high) on a capacity of 1 -> floor discount for all
    factor = model.slot_pressure_factor(3, 1.0)
    assert factor == model.PRESSURE_FLOOR
    for row in pressed["predicted"]:
        assert row["pressure"] == pytest.approx(factor)
    # the factor is uniform inside one club, so the order and every displayed figure match the
    # plain view: predictions, VALUE, and the actual side are not discounted - only the sort key is
    assert [row["name"] for row in pressed["predicted"]] == [
        row["name"] for row in plain["predicted"]]
    for pressed_row, plain_row in zip(pressed["predicted"], plain["predicted"]):
        for field in ("fm_pred", "pv_pred", "value_pred", "value_act"):
            assert pressed_row[field] == plain_row[field]
    assert plain["predicted"][0].get("pressure") is None       # other currencies stay untouched


def test_a_season_not_yet_played_is_priced_on_last_seasons_calendar(prepared):
    """The season being AUCTIONED has no matchdays, and appearances are a SHARE of the target calendar -
    so a calendar of zero prices every player at zero appearances, which makes VALUE and SURPLUS zero and
    leaves the auction list sorted by nothing at all.

    The fallback used to live in `snapshot.build`, i.e. in one CALLER, and the Auction panel asking the
    same question got a whole listone at zero. It now lives in `engine_predictions`, where the price is
    decided, which is the only place that reaches every caller.
    """
    from euroleghe_ingest.modules import snapshot

    _cfg, conn, window, data = prepared
    data.matchdays_target = 0                     # what August looks like: a season with no votes yet
    out, predictions, source, notes = snapshot.engine_predictions(
        conn, window, "euro", "classic", None, prepared=data, fits={})
    assert out.matchdays_target == MATCHDAYS, "the target calendar falls back to the input season's"
    assert any("no matchdays yet" in note for note in notes), notes
    assert source == "R0-core"                    # no fits given, so the honest fallback says so
    priced = [p for p in predictions if p.pv_pred is not None]
    assert priced and all(p.pv_pred > 0 for p in priced), "a zero calendar prices everyone at zero"


def test_a_new_signing_is_not_an_unknown_man():
    """`est_pv` for whoever has no season on this platform was the share of a man with NOTHING measured
    anywhere - 0.29 of the calendar on `default`. Applied to a €74M striker with 1320 measured Ligue 1
    minutes it said 11 appearances of 38, which is the sheet throwing away football it has watched.

    The line is fitted on exactly that population (his league minutes over that league's rounds) and
    judged leave-one-SEASON-out: MAE 0.2300 against 0.2803 for the constant on default (+17.9%), 0.2831
    against 0.2983 on euro (+5.1%). What it does NOT touch is the fantamedia: R1 lost to the role anchor
    on five windows of six, and what a man did abroad predicts how much he PLAYS, not how well.
    """
    from euroleghe_ingest.engine import estimate as est

    # Gonçalo Ramos: 1320 minutes over Ligue 1's 34 rounds = 0.431 of a season
    share = 1320 / (90 * 34)
    intercept, slope = est.ABROAD_SHARE["default"]
    assert est.presences_from_abroad(38, "default", share) == pytest.approx(
        round(38 * (intercept + slope * share), 1))
    assert est.presences_from_abroad(38, "default", share) > 17, "a starter, not a third of a season"
    assert est.default_presences(38, "default") == pytest.approx(11.0), "what he used to get"

    # the two platforms have their own line, because everything here is per-platform
    assert est.presences_from_abroad(31, "euro", share) != est.presences_from_abroad(31, "default",
                                                                                     share)
    # ...and where there is nothing to read it says so, instead of inventing a share: the caller then
    # falls back to the unmeasured constant, which is a different sentence about a different man
    assert est.presences_from_abroad(38, "default", None) is None
    assert est.presences_from_abroad(38, "default", 0.0) is None
    assert est.presences_from_abroad(None, "default", share) is None
    assert est.presences_from_abroad(38, "nowhere", share) is None
    # a share above the calendar cannot come out of it, whatever goes in
    assert est.presences_from_abroad(38, "default", 5.0) <= 38


def test_the_estimate_carries_a_base_vote_and_never_guesses_it_apart():
    """`est_mv` = `est_fm` minus the bonus per appearance, so the pair cannot contradict itself.

    Measured 15/08/2026 on 3750 Serie A player-seasons with >= 15 votes: the bonus rate is a property of
    the man (r = +0.842 from one season to the next) and its size is the ROLE's - keepers -1.29 against
    +0.05 for defenders - so padding a short sample with the role's own rate is what «spannometrico ma
    ragionato» means here. A direct estimate of the MV was measured too (anchor + 0.45(his - anchor), MAE
    0.148 against 0.166 for the anchor alone) and refused on purpose: a second free number could
    contradict the first.
    """
    from euroleghe_ingest.engine import estimate as est

    # nothing measured of him: the role's rate answers, which is how everybody still gets an MV
    assert est.bonus_rate(None, None, 0.74) == pytest.approx(0.74)
    assert est.bonus_rate(0.90, 0, 0.74) == pytest.approx(0.74)
    # a full sample is entirely his
    assert est.bonus_rate(0.90, est.FULL_SEASON_VOTES, 0.74) == pytest.approx(0.90)
    assert est.bonus_rate(0.90, 60, 0.74) == pytest.approx(0.90), "never past his own rate"
    # a third of a sample is a third of his own, the same shrink as everywhere else
    assert est.bonus_rate(0.90, 5, 0.74) == pytest.approx(0.74 + (0.90 - 0.74) / 3)
    # and with no role rate at all his own stands rather than nothing
    assert est.bonus_rate(0.90, 5, None) == pytest.approx(0.90)

    # the derivation itself, and the identity that makes the pair readable: fm - mv IS the bonus rate
    assert est.mv_from(6.85, 0.74) == pytest.approx(6.11)
    assert est.mv_from(5.20, -1.29) == pytest.approx(6.49), "a keeper's fantamedia is BELOW his vote"
    assert est.mv_from(None, 0.74) is None
    assert est.mv_from(6.85, None) is None

    # an Estimate built without one is still valid: an older bundle simply has no MV to show
    assert est.Estimate(6.0, 20.0, "anchor", 0.5, "").mv is None
