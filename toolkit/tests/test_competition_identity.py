"""A PROVIDER SLUG IS NOT AN IDENTITY: SofaScore calls `bundesliga` two different championships.

Found 06/09/2026 while running the pre-registered change of §7-quattuorquadragies. `recent_form` reads
the competition off the player's own event list, so a Premier League match at a club outside the euro
perimeter was archived as `premier-league` while `synth.calibrated_competitions` asks
`matchday_map.league`, which speaks our keys: `bundesliga` was the only spelling that coincided, and it
was the only one converting - 44 rows of 44 - while 352 rows of 45 players got no synthetic voto for a
hyphen.

And the cure's first form was WRONG in a way only the data could show. Mapping the slugs merged the
AUSTRIAN Bundesliga into the German one: 36 matches of Red Bull Salzburg and Austria Klagenfurt took a
synthetic voto from a line fitted on the Bundesliga, and four of those men are ARRIVALS whose foreign
FM-equivalent was built on it (Pavlovic 6.86, Sucic L. 8.30, Irving 8.29, Alajbegovic 6.93 - the last on
the 2026-27 listone, i.e. the sheet in use). So the mapping is guarded by the CLUB's country, which is
the only fact that separates the two, and exactly 36 rows of 334,630 under our six keys disagree with
it - these two clubs and nothing else.
"""

from __future__ import annotations

import sqlite3

from euroleghe_ingest import config
from euroleghe_ingest.matching import club_key
from euroleghe_ingest.modules import positions

COUNTRIES = {club_key(name): country for name, country in (
    ("FC Bayern München", "GER"),
    ("Red Bull Salzburg", "AUT"),
    ("Liverpool FC", "ENG"),
    ("Boca Juniors", "ARG"),
)}


def test_a_provider_spelling_of_our_championship_becomes_our_key():
    assert positions.competition_for("premier-league", "Liverpool FC", COUNTRIES) == "premier_league"
    assert positions.competition_for("bundesliga", "FC Bayern München", COUNTRIES) == "bundesliga"


def test_the_same_spelling_in_another_country_is_NOT_ours_to_claim():
    """The provider's slug is kept: it is another country's league, and it is provenance.

    `premier-league` is not only England's word - and a row we cannot name is better than a row named
    wrong, which is the same asymmetry as «an ambiguous name match is worse than a missing one».
    """
    assert positions.competition_for("premier-league", "Boca Juniors", COUNTRIES) == "premier-league"


def test_a_slug_that_collides_with_our_own_key_is_moved_off_it():
    """The defect itself: Austria under our German key, where `synth` converts with the German line.

    The name it gets is `bundesliga-aut`, which is not an invention: it is the spelling those very rows
    carried in this database before a cache replay overwrote it.
    """
    assert positions.competition_for("bundesliga", "Red Bull Salzburg", COUNTRIES) == "bundesliga-aut"


def test_no_country_on_file_leaves_the_slug_in_charge():
    """Absence of a country is not an argument against the spelling.

    «To act you need evidence, and to refuse you need evidence too»: the guard exists to catch a club
    we KNOW to be elsewhere, and refusing to normalise a club we simply have no country for would
    switch off the cure for the rows it was written for. The old `serie-b` normalisation depends on it.
    """
    assert positions.competition_for("bundesliga", "Sconosciuto", COUNTRIES) == "bundesliga"
    assert positions.competition_for("premier-league", "Sconosciuto", COUNTRIES) == "premier_league"
    assert positions.competition_for("premier-league", None, COUNTRIES) == "premier_league"


def test_a_cup_or_a_friendly_keeps_its_slug_whoever_plays_it():
    """It is not a championship, and `snapshot.competition_class` has to be able to tell them apart."""
    assert positions.competition_for("uefa-champions-league", "FC Bayern München",
                                     COUNTRIES) == "uefa-champions-league"
    assert positions.competition_for("coppa-italia", "Liverpool FC", COUNTRIES) == "coppa-italia"
    assert positions.competition_for("eredivisie", "Liverpool FC", COUNTRIES) == "eredivisie"


def test_every_championship_the_config_names_declares_its_country():
    """`config.CHAMPIONSHIPS` owns the list and `LEAGUE_COUNTRY` the countries: they must agree.

    A championship added to the config without a country would silently stop being guarded - and the
    guard is what keeps two leagues that share a slug apart.
    """
    assert set(config.LEAGUE_COUNTRY) == set(config.CHAMPIONSHIPS)


def _archive() -> sqlite3.Connection:
    """The archive as the replay left it: the four slugs, plus Austria under our German key."""
    conn = sqlite3.connect(":memory:")
    conn.execute("""CREATE TABLE external_match_stats (fc_id INTEGER, season TEXT, source TEXT,
                        competition TEXT, club TEXT, real_md INTEGER)""")
    conn.execute("""CREATE TABLE club_match_lineups (season TEXT, source TEXT, competition TEXT,
                        club TEXT, real_md INTEGER)""")
    conn.execute("CREATE TABLE club_levels (club_key TEXT, country TEXT)")
    conn.executemany("INSERT INTO club_levels(club_key, country) VALUES (?, ?)",
                     list(COUNTRIES.items()))
    conn.executemany("""INSERT INTO external_match_stats(fc_id, season, source, competition, club,
                            real_md) VALUES (?, '2025-26', 'sofascore_recent', ?, ?, ?)""",
                     [(1, "premier-league", "Liverpool FC", 12),
                      (2, "bundesliga", "FC Bayern München", 12),
                      (3, "bundesliga", "Red Bull Salzburg", 12),
                      (4, "premier-league", "Boca Juniors", 12),
                      (5, "coppa-italia", "Liverpool FC", None)])
    conn.commit()
    return conn


def _stored(conn) -> dict[int, tuple[str, str]]:
    """Keyed by `fc_id` and not by club: Liverpool has two rows here, a league one and a cup one, and
    a dict keyed by club would quietly keep the last of them - which is how the first version of this
    test accused the code of its own defect."""
    return {fc_id: (club, competition) for fc_id, club, competition in conn.execute(
        "SELECT fc_id, club, competition FROM external_match_stats")}


def test_the_archive_is_normalised_club_by_club_and_not_slug_by_slug():
    """A blanket `UPDATE ... WHERE competition = 'bundesliga'` cannot tell Bayern from Salzburg.

    Which is why this pass reads the distinct CLUBS of the competitions that can move: measured on the
    live DB it is a handful of queries, not a walk over 350,000 rows.
    """
    conn = _archive()
    moved = positions.normalize_competitions(conn)
    stored = _stored(conn)
    assert stored[1] == ("Liverpool FC", "premier_league")
    assert stored[2] == ("FC Bayern München", "bundesliga")
    assert stored[3] == ("Red Bull Salzburg", "bundesliga-aut"), "Austria must leave our German key"
    assert stored[4] == ("Boca Juniors", "premier-league"), "not ours to claim"
    assert stored[5] == ("Liverpool FC", "coppa-italia"), "a cup keeps its slug"
    assert moved == 2, "one row onto our key, one off it - and nothing else touched"


def test_normalising_twice_changes_nothing_more():
    """It runs inside every re-ingest of the per-match layer, so it has to be idempotent."""
    conn = _archive()
    positions.normalize_competitions(conn)
    first = _stored(conn)
    assert positions.normalize_competitions(conn) == 0
    assert _stored(conn) == first
