"""Tests for the identity matcher: the real name-convention gaps between us and the providers."""

from __future__ import annotations

from euroleghe_ingest.matching import (
    build_pool_entry,
    club_abbreviation,
    club_key,
    fold,
    lossy_eq,
    match_in_pool,
    split_initial,
)


def test_fold_strips_accents_and_special_letters():
    assert fold("Guðmundsson") == "gudmundsson"
    assert fold("Kjær") == "kjaer"
    assert fold("Yıldız") == "yildiz"
    assert fold("N'Dicka") == "n dicka"


def test_split_initial_handles_one_and_two_letter_initials():
    assert split_initial("Zapata D.") == ("zapata", "d")
    assert split_initial("Pellegrini Lo.") == ("pellegrini", "lo")
    assert split_initial("Esposito F.P.") == ("esposito", "fp")     # two given names abbreviated
    assert split_initial("De Ketelaere") == ("de ketelaere", None)


def test_multiple_initials_match_given_names_in_any_order():
    # our 'Esposito F.P.' (Francesco Pio) vs the provider's 'Pio Esposito'
    pool = _pool("Esposito F.P.", "Esposito Se.")
    _tier, candidates = match_in_pool("Pio Esposito", pool)
    assert [name for _fc_id, name in candidates] == ["Esposito F.P."]
    # a namesake with different initials must not be dragged in
    _tier, candidates = match_in_pool("Sebastiano Esposito", pool)
    assert [name for _fc_id, name in candidates] == ["Esposito Se."]


def test_lossy_eq_accepts_runs_of_replacement_chars():
    # the 23/24-24/25 CSVs lost each accented char byte by byte: 'Ikone' -> 'Ikon��'
    assert lossy_eq("ikon��", "ikone")
    assert lossy_eq("soul��", "soule")
    assert not lossy_eq("ikon��", "ikonenberg")


def _pool(*names):
    return [build_pool_entry(index + 1, name) for index, name in enumerate(names)]


def test_match_tiers_on_real_cases():
    pool = _pool("Zapata D.", "Martinez L.", "De Ketelaere", "N'Dicka", "Arthur Melo",
                 "Zambo Anguissa", "Sulemana I.")
    cases = {
        "Duvan Zapata": "Zapata D.",             # tier 1: surname tail + initial
        "Lautaro Martinez": "Martinez L.",
        "Charles De Ketelaere": "De Ketelaere",  # multi-word surname
        "Evan Ndicka": "N'Dicka",                # tier 2: squashed name
        "Arthur": "Arthur Melo",                 # tier 3: our extra token
        "Frank Anguissa": "Zambo Anguissa",      # tier 3: different first name
        "Sulemana": "Sulemana I.",               # one-token provider name -> initial not required
    }
    for provider_name, expected in cases.items():
        tier, candidates = match_in_pool(provider_name, pool)
        assert len(candidates) == 1, (provider_name, tier, candidates)
        assert candidates[0][1] == expected, (provider_name, tier, candidates)


def test_initial_mismatch_separates_namesakes():
    pool = _pool("Martinez L.", "Martinez J.")
    _tier, candidates = match_in_pool("Josep Martinez", pool)
    assert [name for _fc_id, name in candidates] == ["Martinez J."]


def test_no_match_returns_empty():
    assert match_in_pool("Seydou Fini", _pool("Zapata D.", "Dybala")) == (0, [])


def test_club_key_normalizes_corporate_tokens():
    assert club_key("AC Milan") == club_key("Milan")
    assert club_key("SSC Napoli") == club_key("Napoli")
    assert club_key("FC Bayern Munchen") == "bayern munchen"
    assert club_key("1. FC Union Berlin") == "union berlin"
    assert club_key("Monaco") != club_key("FC Bayern Munchen")   # the exonym trap


def test_club_abbreviations_are_unique_across_the_whole_perimeter():
    """The point of an abbreviation is to identify a club. Every pair below shares a three-letter
    prefix, which is why the naive prefix was not enough - and the pairs are the real perimeter's,
    not invented. A new club that clashes must fail here and get an entry in CLUB_ABBREVIATIONS,
    never silently shadow another."""
    clubs = [
        "Bayer Leverkusen", "Bayern Monaco", "Bordeaux", "Borussia Dortmund", "Borussia MGladbach",
        "Cardiff", "Carpi", "Eintracht", "Eintracht Francoforte", "Mainz", "Maiorca",
        "Manchester City", "Manchester United", "Monaco", "Monza", "Newcastle", "Newcastle United",
        "Olympique Lione", "Olympique Marsiglia", "Paris Saint-Germain", "Parma",
        "Real Madrid", "Real Sociedad", "Valencia", "Valladolid", "Wolfsburg", "Wolverhampton",
    ]
    codes = [club_abbreviation(name) for name in clubs]
    assert len(set(codes)) == len(clubs), sorted(
        code for code in set(codes) if codes.count(code) > 1)
    assert all(3 <= len(code) <= 4 and code.isupper() for code in codes)


def test_club_abbreviation_reads_like_the_conventional_short_form():
    for name, expected in (("Atalanta", "ATA"), ("Inter", "INT"), ("Manchester United", "MUN"),
                           ("Real Madrid", "RMA"), ("Schalke 04", "S04"), ("Hannover 96", "H96"),
                           ("Paris Saint-Germain", "PSG"), ("Alav\u00e9s", "ALA")):
        assert club_abbreviation(name) == expected, name
    # a club we do not know about is still safe to display
    assert club_abbreviation(None) == ""
    assert club_abbreviation("   ") == ""


# ---------- clubs: the official name vs the listone name ----------
def test_match_club_strips_the_official_form_words():
    """Transfermarkt writes the official name; a listone never does."""
    from euroleghe_ingest.matching import club_key, match_club

    ours = {club_key(name): index for index, name in enumerate(
        ["Fiorentina", "Genoa", "Lilla", "Betis", "Rennes", "Milan", "Inter"], start=1)}
    for official, expected in (("ACF Fiorentina", 1), ("Genoa CFC", 2), ("LOSC Lilla", 3),
                               ("Real Betis Balompie", 4), ("Stade Rennes FC", 5),
                               ("AC Milan", 6), ("Inter", 7)):
        found = match_club(official, ours)
        assert found is not None, f"{official} did not resolve"
        assert found[1] == expected, f"{official} -> {found}"


def test_match_club_refuses_a_different_club_that_shares_a_word():
    """The two false positives a word-containment pass produced, kept as tests.

    Both were measured against the real competition tables. 'Paris FC' is not Paris Saint-Germain, and
    Espanyol is not Barcelona - and no uniqueness rule can catch either, because our perimeter has no
    Paris FC and no Espanyol at all. A pool that is missing the right answer cannot be saved by
    tie-breaking; only by refusing to guess.
    """
    from euroleghe_ingest.matching import club_key, match_club

    ours = {club_key(name): index for index, name in enumerate(
        ["Paris Saint-Germain", "Barcellona", "Real Madrid", "Atletico Madrid"], start=1)}
    assert match_club("Paris FC", ours) is None
    assert match_club("RCD Espanyol Barcellona", ours) is None
    # The stated LIMIT of the forms pass, asserted rather than wished away: a city-only name attaches
    # to whichever club reduces to that city, because 'Real' is stripped from both sides - which is the
    # same rule that makes 'Real Betis Balompie' find our 'Betis'. No source in the perimeter writes a
    # bare city, so the trade is worth it; if one ever does, this test is where it will be argued.
    assert match_club("Madrid", ours)[1] == 3      # -> Real Madrid


def test_match_club_keeps_two_deportivos_apart():
    from euroleghe_ingest.matching import club_key, match_club

    ours = {club_key(name): index for index, name in enumerate(
        ["Deportivo A Coruna", "Alaves"], start=1)}
    assert match_club("Deportivo Alaves", ours)[1] == 2
    assert match_club("Deportivo A Coruna", ours)[1] == 1


def test_two_spellings_of_our_own_club_are_one_identity():
    """`club_key` is the CACHE key and stays conservative; `club_identity` is the one that says «same club».

    The distinction is not academic - it cost three clubs. `_get_or_create_club` matched on the exact
    string and minted a surrogate id otherwise, so `Newcastle` and `Newcastle United` became two rows of
    `clubs` with the listone's seasons on one and the provider's xref on the other. Namesakes must still
    stay apart: AS Monaco is not Bayern Monaco, and Eintracht Braunschweig is not Eintracht Frankfurt.
    """
    from euroleghe_ingest.matching import club_identity, club_key

    for one, other in (("Newcastle", "Newcastle United"),
                       ("Eintracht", "Eintracht Francoforte"),
                       ("Paris Saint Germain", "Paris Saint-Germain"),
                       ("Milan", "AC Milan")):
        assert club_identity(one) == club_identity(other), f"{one} and {other} are one club"
    assert club_key("Newcastle") != club_key("Newcastle United"), "and club_key must NOT be changed"
    assert club_identity("Monaco") != club_identity("Bayern Monaco")
    assert club_identity("Eintracht") != club_identity("Eintracht Braunschweig")


def test_merging_twin_clubs_keeps_every_row_and_says_what_it_dropped():
    """The migration behind `club_identity`: one club, one id, and the histories that were split rejoin.

    Measured on the real database (05/08/2026): today's Eintracht had ZERO coach spells because all 70
    sat on its twin, and `penalty_hierarchy` was halved across the pair - the same shape of defect that
    once made a decay of 0.5 look better than 0.75. The survivor is the id carrying the most recent
    roster season, because that is where the next listone lands.
    """
    import sqlite3

    from euroleghe_ingest.db.database import merge_twin_clubs

    conn = sqlite3.connect(":memory:")
    conn.executescript(
        """
        CREATE TABLE clubs (fc_club_id INTEGER PRIMARY KEY, canonical_name TEXT, league TEXT);
        CREATE TABLE rosters (fc_id INTEGER, season TEXT, fc_club_id INTEGER,
                              PRIMARY KEY (fc_id, season));
        CREATE TABLE club_xref (fc_club_id INTEGER, source TEXT, source_id TEXT,
                                PRIMARY KEY (source, source_id));
        CREATE TABLE club_elo (fc_club_id INTEGER, date TEXT, elo REAL, PRIMARY KEY (fc_club_id, date));
        CREATE TABLE coaches (fc_club_id INTEGER, coach_name TEXT, valid_from TEXT,
                              PRIMARY KEY (fc_club_id, valid_from));
        CREATE TABLE penalty_hierarchy (fc_club_id INTEGER, valid_from TEXT, fc_id INTEGER,
                                        PRIMARY KEY (fc_club_id, valid_from, fc_id));
        CREATE TABLE squad_snapshot (fc_id INTEGER, club TEXT);
        CREATE TABLE arrivals (fc_id INTEGER, origin_club TEXT);

        INSERT INTO clubs VALUES (12, 'Newcastle', 'premier_league'), (60, 'Newcastle United', 'premier_league');
        INSERT INTO rosters VALUES (1, '2025-26', 12), (2, '2022-23', 60);
        INSERT INTO club_xref VALUES (12, 'transfermarkt', '762'), (60, 'sofascore', '39');
        INSERT INTO club_elo VALUES (12, '2026-08-01', 1800), (60, '2026-08-01', 1801), (60, '2025-08-01', 1790);
        INSERT INTO coaches VALUES (60, 'Howe', '2021-11-08');
        INSERT INTO penalty_hierarchy VALUES (12, '2026-01-01', 7), (60, '2025-01-01', 9);
        INSERT INTO squad_snapshot VALUES (1, 'Newcastle'), (2, 'Newcastle United');
        INSERT INTO arrivals VALUES (3, 'Newcastle United');
        """
    )
    merged = merge_twin_clubs(conn)
    assert len(merged) == 1 and "Newcastle United (60) -> Newcastle (12)" in merged[0]
    assert "1 club_elo" in merged[0], "the one colliding row is REPORTED, never dropped in silence"

    assert conn.execute("SELECT COUNT(*) FROM clubs").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM rosters WHERE fc_club_id = 12").fetchone()[0] == 2
    assert {s for (s,) in conn.execute("SELECT source FROM club_xref WHERE fc_club_id = 12")} == {
        "transfermarkt", "sofascore"}, "both providers now answer for the same club"
    assert conn.execute("SELECT COUNT(*) FROM coaches WHERE fc_club_id = 12").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM penalty_hierarchy WHERE fc_club_id = 12").fetchone()[0] == 2
    assert conn.execute("SELECT COUNT(*) FROM club_elo").fetchone()[0] == 2, "same club same day = one row"
    assert {c for (c,) in conn.execute("SELECT DISTINCT club FROM squad_snapshot")} == {"Newcastle"}
    assert conn.execute("SELECT origin_club FROM arrivals").fetchone()[0] == "Newcastle"
    assert merge_twin_clubs(conn) == [], "idempotent: nothing left to merge"
