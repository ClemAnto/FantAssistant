"""Tests for matchdays: the euro <-> real calendar alignment."""

from __future__ import annotations

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import matchdays


def _signature(fc_ids, goals=0):
    return {(fc_id, goals, 0, 0, 0) for fc_id in fc_ids}


def test_align_season_skips_real_matchdays_outside_the_euro_calendar():
    # real matchdays 1..4; the euro calendar covers 2 and 4 only
    default = {1: _signature(range(1, 40)), 2: _signature(range(40, 80)),
               3: _signature(range(80, 120)), 4: _signature(range(120, 160))}
    euro = {1: _signature(range(40, 75)), 2: _signature(range(120, 155))}
    mapped, skipped = matchdays.align_season(euro, default)
    assert {euro_md: real_md for euro_md, (real_md, _c) in mapped.items()} == {1: 2, 2: 4}
    assert all(confidence == 1.0 for _md, confidence in mapped.values())
    assert skipped == []


def test_align_season_refuses_an_ambiguous_matchday():
    # two identical real matchdays -> no margin over the runner-up -> reported, not guessed
    default = {1: _signature(range(1, 30)), 2: _signature(range(1, 30))}
    mapped, skipped = matchdays.align_season({1: _signature(range(1, 30))}, default)
    assert mapped == {}
    assert len(skipped) == 1 and "ambiguous" in skipped[0]


def _scored(fc_ids, scorers):
    return {(fc_id, 1 if fc_id in scorers else 0, 0, 0, 0) for fc_id in fc_ids}


def test_align_season_reads_a_gap_of_exactly_the_margin_as_the_margin():
    # 1.0 against 0.8 is a gap of 0.19999... in floating point: Ligue 1 2025-26 euro 30 was refused
    # for that alone. Five men, one scorer: the neighbour reproduces four of the five (80%).
    default = {33: _scored(range(1, 6), {1}), 34: _scored(range(1, 6), set())}
    mapped, skipped = matchdays.align_season({30: _scored(range(1, 6), {1})}, default)
    assert mapped == {30: (33, 1.0)} and skipped == []


def test_align_season_accepts_a_near_perfect_best_the_calendar_order_confirms():
    # A quiet round between two decisive ones: the adjacent round reproduces 90% of its signature.
    men = range(1, 21)
    default = {2: _scored(men, set(range(1, 7))), 3: _scored(men, {13}), 4: _scored(men, {14}),
               5: _scored(men, set(range(7, 13)))}
    euro = {1: _scored(men, set(range(1, 7))), 2: _scored(men, {14}), 3: _scored(men, set(range(7, 13)))}
    mapped, skipped = matchdays.align_season(euro, default)
    assert {md: real for md, (real, _c) in mapped.items()} == {1: 2, 2: 4, 3: 5}
    assert skipped == []


def test_align_season_refuses_a_near_perfect_best_that_breaks_the_calendar_order():
    # Same quiet round, but it is placed AFTER the decisive round that bundles real 5.
    men = range(1, 21)
    default = {2: _scored(men, set(range(1, 7))), 3: _scored(men, {13}), 4: _scored(men, {14}),
               5: _scored(men, set(range(7, 13)))}
    euro = {1: _scored(men, set(range(1, 7))), 2: _scored(men, set(range(7, 13))), 3: _scored(men, {14})}
    mapped, skipped = matchdays.align_season(euro, default)
    assert 3 not in mapped and any("euro 3: ambiguous" in note for note in skipped)


def test_align_season_refuses_a_tie_the_calendar_order_cannot_split():
    # 100% against 100%, and both rounds lie between the neighbours: nothing names it, so it is reported.
    men = range(1, 21)
    default = {1: _scored(men, {1}), 2: _scored(men, set()), 3: _scored(men, set()), 4: _scored(men, {4})}
    euro = {1: _scored(men, {1}), 2: _scored(men, set()), 3: _scored(men, {4})}
    mapped, skipped = matchdays.align_season(euro, default)
    assert 2 not in mapped and any("euro 2: ambiguous" in note for note in skipped)


def test_align_season_resolves_two_ambiguous_rounds_in_a_row():
    # Ligue 1 2026-27 euro 3 and 4: each is the other's missing neighbour. Best 100%, runner-up 90%.
    men = range(1, 21)
    default = {2: _scored(men, {1, 2, 3}), 3: _scored(men, {4, 5, 6}),
               4: _scored(men, {7}), 5: _scored(men, {8})}
    euro = {1: _scored(men, {1, 2, 3}), 2: _scored(men, {4, 5, 6}), 3: _scored(men, {7}), 4: _scored(men, {8})}
    mapped, skipped = matchdays.align_season(euro, default)
    assert mapped[3][0] == 4 and mapped[4][0] == 5 and skipped == []


def test_align_season_tolerates_partial_overlap():
    # a euro round whose rows are mostly (not exactly) the real round's still maps
    default = {5: _signature(range(1, 101))}
    euro = {1: _signature(range(1, 96)) | _signature(range(200, 205))}
    mapped, _skipped = matchdays.align_season(euro, default)
    assert mapped[1][0] == 5 and mapped[1][1] >= matchdays.MIN_CONFIDENCE


def test_derive_from_ratings_writes_the_map(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    conn = init_db(cfg.db_path)
    conn.executemany("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)",
                     [(i, f"P{i}") for i in range(1, 21)])
    rows = []
    for fc_id in range(1, 21):
        rows.append((fc_id, "2023-24", 1, "C", "euro", 6.5))      # the only euro matchday
        rows.append((fc_id, "2023-24", 2, "C", "default", 6.0))   # ...is real matchday 2
        rows.append((fc_id, "2023-24", 1, "C", "default", 6.0))   # real matchday 1: skipped by euro
    conn.executemany(
        "INSERT OR REPLACE INTO match_ratings(fc_id, season, matchday, role, platform, mv, goals,"
        " assists, yellows, reds) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0)", rows)
    # give real matchday 1 a different set of scorers so it cannot be confused with matchday 2
    conn.execute("UPDATE match_ratings SET goals = 1 WHERE platform = 'default' AND matchday = 1")
    conn.commit()

    ctx = Context(config=cfg, conn=conn)
    assert matchdays.derive_from_ratings(ctx) == 1
    row = conn.execute("SELECT euro_md, real_md, league, source FROM matchday_map").fetchone()
    assert tuple(row) == (1, 2, "serie_a", "derived")


def test_derive_from_external_maps_a_foreign_league(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    conn = init_db(cfg.db_path)
    conn.executemany("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)",
                     [(i, f"P{i}") for i in range(1, 25)])
    conn.executemany("INSERT INTO rosters(fc_id, season, league) VALUES (?, '2023-24', ?)",
                     [(i, "premier_league") for i in range(1, 25)])
    conn.executemany(
        "INSERT INTO match_ratings(fc_id, season, matchday, role, platform, mv) "
        "VALUES (?, '2023-24', 1, 'C', 'euro', 6.0)", [(i,) for i in range(1, 23)])
    external = []
    for fc_id in range(1, 25):
        external.append((fc_id, "2023-24", f"e3_{fc_id}", "premier_league", 3, 90))   # the real round
        external.append((fc_id, "2023-24", f"e9_{fc_id}", "premier_league", 9, 90))
    conn.executemany(
        "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, real_md,"
        " minutes) VALUES (?, ?, 'sofascore', ?, ?, ?, ?)", external)
    # only round 3 fielded exactly our 22 euro-voted players
    conn.execute("DELETE FROM external_match_stats WHERE real_md = 9 AND fc_id < 12")
    conn.commit()

    ctx = Context(config=cfg, conn=conn)
    assert matchdays.derive_from_external(ctx) == 1
    row = conn.execute("SELECT euro_md, real_md, league, source FROM matchday_map").fetchone()
    assert tuple(row) == (1, 3, "premier_league", "sofascore")
