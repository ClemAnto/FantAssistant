"""A CALENDAR is counted by the layer that walks the rounds, and declared where it does not reach.

Found 06/09/2026 while measuring what a rename of `recent_form`'s provider slugs would expose
(gate §7-quattuorquadragies). `league_rounds` took `MAX(real_md)` from any row that carried one, and
`sofascore_recent` - a handful of a player's own last matches - is not a calendar: on the live DB it was
the ONLY source of `bundesliga 2016-17` and answered **33** rounds instead of 34. With the slugs renamed
into our keys it would have become the rule: `la_liga 2015-16` 29 rounds, `ligue_1 2016-17` and
`premier_league 2018-19` **one** - and `derive` divides a man's minutes by that number, so a divisor of
one sends every 90-minute season to the ceiling (measured: 248 observations of Tm4/euro).

Nothing here is a model choice, so nothing here asks the gate for a verdict: it is arithmetic about a
calendar. What it DOES move is stated in the gate section - 204 observations on two euro windows, 0 on
`default`, and 0 of the 6,168 numbers of the backtest report, because on euro no adopted rule reads that
quantity today (R3c reads the euro-calendar share instead).
"""

from __future__ import annotations

import sqlite3

from euroleghe_ingest import config
from euroleghe_ingest.engine import features


def _layer() -> sqlite3.Connection:
    """Two seasons: one the round-walking layer covers, one only a stray recent row touches."""
    conn = sqlite3.connect(":memory:")
    conn.execute("""CREATE TABLE external_match_stats (
                        fc_id INTEGER, season TEXT, source TEXT, competition TEXT,
                        real_md INTEGER, match_date TEXT, minutes INTEGER)""")
    rows = []
    # 2024-25: the real thing, walked round by round. Ligue 1 plays 34 since it went to 18 teams, and
    # that number has to come from the LAYER - a declaration cannot know it.
    rows += [(1, "2024-25", "sofascore", "serie_a", md, None, 90) for md in range(1, 39)]
    rows += [(1, "2024-25", "sofascore", "ligue_1", md, None, 90) for md in range(1, 35)]
    # ...plus one stray recent row that claims a round nobody else does: it must not raise the max.
    rows.append((2, "2024-25", "sofascore_recent", "serie_a", 12, None, 90))
    # 2016-17: no walked layer at all, and one recent row of the Bundesliga stopping at round 33 - which
    # is exactly how that season came to read 33 instead of 34.
    rows.append((2, "2016-17", "sofascore_recent", "bundesliga", 33, None, 90))
    rows.append((2, "2016-17", "sofascore_recent", "premier_league", 1, None, 90))
    conn.executemany("INSERT INTO external_match_stats(fc_id, season, source, competition, real_md,"
                     " match_date, minutes) VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
    conn.commit()
    return conn


def test_a_stray_row_of_the_recent_layer_cannot_set_a_calendar():
    """The defect itself: 33 rounds of the Bundesliga, and one round of the Premier League."""
    conn = _layer()
    old = features.league_rounds(conn, "2016-17")
    assert old["bundesliga"] == 34, "the declared calendar, not the last round a stray row reached"
    assert old["premier_league"] == 38, "and certainly not ONE round"


def test_where_we_walk_the_rounds_the_number_is_MEASURED_and_not_declared():
    """The other half, and the reason this is not «declare them all».

    Ligue 1 plays 34 rounds since 2023-24 and 38 before it; the Bundesliga has always played 34. Only the
    layer can know which season is which, so the measurement wins wherever it exists and the declaration
    fills in behind it - never the other way round.
    """
    conn = _layer()
    rounds = features.league_rounds(conn, "2024-25")
    assert rounds["ligue_1"] == 34, "measured from the layer, against a declaration that says 38"
    assert rounds["serie_a"] == 38


def test_the_declared_calendar_covers_every_championship_the_config_names():
    """`config.CHAMPIONSHIPS` owns the list, this module owns the numbers - and they must agree.

    The engine takes plain mappings and knows nothing about files (`evaluate.declared_cups` says why), so
    the six names are repeated here. Repeated without a test they would drift, and a championship added
    to the config would silently have no calendar at all.
    """
    assert set(features.DECLARED_ROUNDS) == set(config.CHAMPIONSHIPS)
    assert features.DECLARED_ROUNDS["bundesliga"] == 34
    assert {rounds for league, rounds in features.DECLARED_ROUNDS.items()
            if league != "bundesliga"} == {38}


def test_a_competition_nobody_declared_keeps_the_blanket_default():
    """A cup, or a league outside the six: `rounds_for` must still answer with a number.

    It is also the one place the old blanket 38 survives, and on purpose: `league_rounds` reads
    `MAX(real_md)` over whatever the provider filed, and for `uefa-europa-league` that is 636.
    """
    data = features.WindowData(
        window=features.WINDOWS["T2"], platform="euro", game="classic",
        observations=[], anchors={}, rounds={"serie_a": 38},
    )
    assert data.rounds_for("eredivisie") == features.UNKNOWN_LEAGUE_ROUNDS
    assert data.rounds_for(None) == features.UNKNOWN_LEAGUE_ROUNDS
    assert data.rounds_for("bundesliga") == 34, "declared, even when this window measured nothing"
    assert data.rounds_for("serie_a") == 38
