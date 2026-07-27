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
