"""The denominator of a season played in TWO championships, and the guard that must read what the formula reads.

Both defects were found on 20/08/2026 from one question of the operator's - «Malen e' stato uno dei
migliori giocatori della scorsa stagione, non puo' essere una riserva» - and both are arithmetic, not
model choices: nothing here changes a parameter, so nothing here asks the gate for a verdict.
"""

from __future__ import annotations

import datetime as dt
import sqlite3

from euroleghe_ingest.engine import features, presence, status


def _day(md: int) -> str:
    """One round a week from 20/08, the same calendar for every championship and every player.

    Coherent dates are not decoration here: the whole rule turns on WHEN a round began, so a fixture where
    two players play round 38 in different months would be testing the fixture.
    """
    return (dt.date(2025, 8, 20) + dt.timedelta(days=7 * (md - 1))).isoformat()


def _layer() -> sqlite3.Connection:
    """Four men, and the first two are the case: same football, different season aggregate."""
    conn = sqlite3.connect(":memory:")
    conn.execute("""CREATE TABLE external_match_stats (
                        fc_id INTEGER, season TEXT, source TEXT, competition TEXT,
                        real_md INTEGER, match_date TEXT, minutes INTEGER)""")
    conn.execute("""CREATE TABLE external_stats (
                        fc_id INTEGER, season TEXT, source TEXT, competition TEXT, matches INTEGER)""")
    rows, aggregates = [], []

    def moved(fc_id: int) -> None:
        """21 rounds of the Premier at one club, then Serie A from round 21 - Malen's own season."""
        rows.extend((fc_id, "premier_league", md, _day(md), 70) for md in range(1, 22))
        rows.extend((fc_id, "serie_a", md, _day(md), 82) for md in range(21, 39))

    moved(1)
    aggregates.append((1, "serie_a", 18))                       # ...and only THIS half was acquired
    moved(4)
    aggregates += [(4, "serie_a", 18), (4, "premier_league", 21)]  # ...and this man has both
    # 2 - a whole season in one championship: no split, and the calendar is already his.
    rows.extend((2, "serie_a", md, _day(md), 90) for md in range(1, 39))
    aggregates.append((2, "serie_a", 38))
    # 3 - the man who STOPPED being picked in March. From the outside his last appearance is not the last
    # round, exactly like a man who left - and his denominator must NOT be shortened for it.
    rows.extend((3, "serie_a", md, _day(md), 90) for md in range(1, 26))
    aggregates.append((3, "serie_a", 25))
    # 5 - one match here in August and gone by the fifth round: his spell is the rounds that had BEGUN when
    # he turned up elsewhere, not the single round he was picked for.
    rows.append((5, "serie_a", 1, _day(1), 25))
    rows.extend((5, "premier_league", md, _day(md), 60) for md in range(5, 38))
    aggregates.append((5, "serie_a", 1))
    conn.executemany("INSERT INTO external_match_stats VALUES (?, ?, 'sofascore', ?, ?, ?, ?)",
                     [(fc, "2025-26", comp, md, date, mins) for fc, comp, md, date, mins in rows])
    conn.executemany("INSERT INTO external_stats VALUES (?, '2025-26', 'sofascore', ?, ?)", aggregates)
    return conn


def test_a_spell_is_bounded_by_the_other_spell_and_never_by_his_own_appearances():
    """One match played, four rounds spent here: 1/4, not 1/1 and not 1/38.

    Bounding a spell by his first and last appearance in it hands back every round he was there for and
    was not picked - the same flattery the man who stopped playing in March is protected from. The transfer
    window is unobservable (every `transfers_history` row is dated 1 July), so the gap between two spells
    is charged to both.
    """
    out = features.measured_season_rounds(_layer(), "2025-26", ("serie_a", "premier_league"))
    assert out[5] == 4.0, out
    assert presence.appearance_share(presence.Inputs(appearances=1.0, league_matches=38.0,
                                                     measured_rounds=out[5])) == 0.25


def test_the_denominator_follows_the_numerator_and_not_the_calendar():
    """The two men played the same season; what differs is which half was AGGREGATED.

    `starting_record` sums the `external_stats` rows, so man 1's numerator is his 18 Serie A appearances
    and his denominator has to be the 18 rounds he was in Serie A for - summing both windows would have
    read 18/39 and cured nothing. Man 4 has both halves counted, so his is 39 over 39: one rule, and the
    same answer, 1.000 of a season for a man who played all of it.
    """
    conn = _layer()
    out = features.measured_season_rounds(conn, "2025-26", ("serie_a", "premier_league"))
    assert {k: out[k] for k in (1, 4)} == {1: 18.0, 4: 39.0}, out
    assert presence.appearance_share(presence.Inputs(appearances=18.0, league_matches=38.0,
                                                     measured_rounds=out[1])) == 1.0
    assert presence.appearance_share(presence.Inputs(appearances=39.0, league_matches=38.0,
                                                     measured_rounds=out[4])) == 1.0
    # ...and nobody else is in the result: one championship, one calendar, nothing to correct - including
    # the man who stopped playing in March, whose 25/38 is a fact about him.
    assert 2 not in out and 3 not in out


def test_a_back_dated_sheet_ends_the_last_championship_at_the_last_round_played():
    """The season is still running, so its calendar is what has been played - not 38."""
    conn = _layer()
    out = features.measured_season_rounds(conn, "2025-26", ("serie_a", "premier_league"),
                                          before="2026-03-01")
    assert out and out[1] < 39.0


def test_contested_reads_the_measured_calendar_and_availability_does_not():
    """Two questions, two denominators: the share OBSERVED, and the absences per FULL season.

    Shortening one number for both would fix a share and break a unit - `absences_per_season` returns
    rounds per season, and dividing that by an 18-round exposure says he misses twice as much football.
    """
    long_way = presence.Inputs(appearances=18.0, minutes=1478.0, league_matches=38.0,
                               rounds_measured=0.0, rounds_by_season=(2.0, None, None),
                               known_injuries=True)
    short_way = presence.Inputs(**{**long_way.__dict__, "measured_rounds": 18.0})
    assert presence.contested(long_way) == 38.0
    assert presence.contested(short_way) == 18.0
    assert presence.appearance_share(long_way) < 0.5
    assert presence.appearance_share(short_way) == 1.0
    # ...and the injury discount is the same man's in both readings.
    assert presence.availability(short_way) == presence.availability(long_way)


def test_the_panel_passes_the_column_into_the_model():
    """The wiring, not the formula: a column the row carries and `presence_inputs` drops does nothing.

    Third time this project pays for that shape (the dispatcher's dropped flag, the bundle folder the
    pull did not copy), so the panel is DRIVEN here instead of read.
    """
    from euroleghe_ingest.gui import SnapshotView as View

    view = View.__new__(View)
    view.season_calendar = lambda row: 38.0
    view.club_fixtures = lambda club: 38.0
    view.level_z = view.level_gap_z = view.fm_z = view._career_z = lambda row: None
    view._band_prior = lambda base: None
    built = view.presence_inputs({"desc_season_matches": "18", "desc_minutes_full_season": "1478",
                                 "desc_season_rounds": "18", "club": "Roma"})
    assert built.measured_rounds == 18.0
    assert built.league_matches == 38.0        # the calendar being predicted is untouched
    assert presence.appearance_share(built) == 1.0


def test_the_appearance_guard_asks_about_the_football_the_formula_reads():
    """A window measured elsewhere is football on file and is invisible to `appearance_share`.

    Counting it let the guard wave through the very men it exists for: zero appearances divided by his new
    club's calendar is a measured-looking 0.000, and the ladder answers `riserva` - the strongest negative
    word it has - about a man nobody has seen in this championship.
    """
    from euroleghe_ingest.gui import SnapshotView as View

    view = View.__new__(View)
    view.presence_inputs = lambda row: presence.Inputs(appearances=0.0, league_matches=38.0)
    only_elsewhere = {"desc_elsewhere_matches": "10", "desc_elsewhere_minutes": "693"}
    assert view.play_share(only_elsewhere) is None
    assert status.status_of(view.play_share(only_elsewhere), None, False) is None
    # ...and a man with a season here still gets his number, whatever it is.
    view.presence_inputs = lambda row: presence.Inputs(appearances=18.0, league_matches=38.0)
    assert view.play_share({"desc_season_matches": "18"}) is not None


def test_a_league_we_do_not_acquire_cannot_bound_a_spell_and_that_is_declared():
    """The limit is an ACQUISITION, not a formula, and it costs a real man.

    A spell can only be bounded by football that is on file, and the per-match layer holds the five
    championships plus the feeders. Taylor K. was at Ajax until January and then played 18 of Lazio's last
    19 rounds; his Eredivisie season is ONE row dated 10/08, so nothing here can say he was away and he
    keeps his club's whole calendar. Bounding spells with every league-class competition was written and
    MEASURED instead of assumed - 0 rows of 67 change on 2025-26, because those leagues are not acquired -
    so the knob came out and the limit went down in writing.
    """
    conn = _layer()
    conn.execute("INSERT INTO external_match_stats VALUES (6, '2025-26', 'sofascore', 'eredivisie',"
                 " 1, ?, 90)", (_day(1),))
    conn.executemany("INSERT INTO external_match_stats VALUES (6, '2025-26', 'sofascore', 'serie_a',"
                     " ?, ?, 85)", [(md, _day(md)) for md in range(20, 38)])
    conn.execute("INSERT INTO external_stats VALUES (6, '2025-26', 'sofascore', 'serie_a', 18)")
    out = features.measured_season_rounds(conn, "2025-26", ("serie_a", "premier_league"))
    assert 6 not in out            # one championship on file: his club's calendar stands, understated
