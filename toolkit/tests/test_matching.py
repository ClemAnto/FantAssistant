"""Tests for the identity matcher: the real name-convention gaps between us and the providers."""

from __future__ import annotations

from euroleghe_ingest.matching import (
    build_pool_entry,
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
    assert split_initial("De Ketelaere") == ("de ketelaere", None)


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
