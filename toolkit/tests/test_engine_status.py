"""Pure-formula tests for `engine/status.py`: no DB, no I/O.

Two of them exist to stop a REGRESSION that would be invisible on screen rather than to pin a formula -
the board gate in both directions, which is the operator's own coherence requirement (20/08/2026) and the
thing a future simplification would delete first, because from inside the module it looks redundant.
"""

from __future__ import annotations

from euroleghe_ingest.engine import minutes, presence, status


def test_the_six_words_are_the_operators_own_and_in_order():
    assert status.LADDER == ("bandiera", "titolarissimo", "titolare", "ballottaggio",
                             "panchina", "riserva")
    assert [status.rank_of(word) for word in status.LADDER] == [0, 1, 2, 3, 4, 5]
    assert status.rank_of(None) is None
    assert status.rank_of("titolare ") is None      # not a rung, and never guessed into one


def test_the_ladder_reads_the_two_axes_the_operator_wrote():
    """A share of the matches AND a minutes floor - the four starting rungs are their cascade."""
    assert status.status_of(0.95, 80.0, True) == "bandiera"
    assert status.status_of(0.85, 80.0, True) == "titolarissimo"       # under 90%, still a full match
    assert status.status_of(0.95, 70.0, True) == "titolare"            # every match, comes off at 70
    assert status.status_of(0.85, 70.0, True) == "titolare"
    assert status.status_of(0.95, 50.0, True) == "ballottaggio"        # always on the pitch, never long
    assert status.status_of(0.60, 90.0, True) == "ballottaggio"        # full matches, but not every week


def test_a_man_the_eleven_does_not_field_can_never_be_called_titolare():
    """The gate, half one: `ballottaggio` is the CEILING off the pitch, whatever the numbers say.

    Measured on four back-dated pre-season windows: without it, 19 men of one Serie A sheet read
    `titolarissimo` while the board draws somebody else in their place.
    """
    for play, mins in ((1.0, 90.0), (0.95, 80.0), (0.85, 76.0)):
        assert status.status_of(play, mins, False) == "ballottaggio"


def test_a_man_the_eleven_DOES_field_never_falls_below_ballottaggio():
    """The gate, half two: 83 drawn men of that same sheet would otherwise read `panchina` or `riserva`."""
    assert status.status_of(0.10, 20.0, True) == "ballottaggio"
    assert status.status_of(0.0, None, True) == "ballottaggio"
    # ...and off the pitch the same two men are what their share says they are.
    assert status.status_of(0.10, 20.0, False) == "riserva"
    assert status.status_of(0.60, 20.0, False) == "panchina"


def test_unknown_minutes_cost_only_the_rungs_that_ask_for_minutes():
    """«Vuoto = ignoto, mai zero»: no forecast is not a short one, and it must not read as 0 minutes.

    102 rows of a Serie A sheet have no measured season to build one from, so this is the normal case and
    not an edge: he keeps every rung whose promise is about how OFTEN he plays.
    """
    assert status.status_of(0.99, None, True) == "ballottaggio"
    assert status.status_of(0.99, None, False) == "ballottaggio"
    assert status.status_of(0.70, None, False) == "panchina"
    assert status.status_of(0.30, None, False) == "riserva"


def test_a_man_whose_appearances_nobody_can_forecast_has_NO_rung():
    """None in, None out - the rule the empty SURPLUS already obeys. `riserva` would be a claim."""
    assert status.status_of(None, 85.0, True) is None
    assert status.status_of(None, None, False) is None


def test_the_bars_are_the_ones_the_operator_dictated():
    """Strictly greater, as he wrote them, and exactly at the two minute floors."""
    assert status.status_of(status.PLAY_EVERY, 80.0, True) == "titolarissimo"
    assert status.status_of(status.PLAY_EVERY + 1e-9, 80.0, True) == "bandiera"
    assert status.status_of(0.95, status.FULL_MATCH, True) == "bandiera"
    assert status.status_of(0.95, status.FULL_MATCH - 0.1, True) == "titolare"
    assert status.status_of(0.95, status.MOST_OF_THE_MATCH, True) == "titolare"
    assert status.status_of(0.95, status.MOST_OF_THE_MATCH - 0.1, True) == "ballottaggio"
    assert status.status_of(status.PLAY_OFTEN, None, False) == "riserva"
    assert status.status_of(status.PLAY_OFTEN + 1e-9, None, False) == "panchina"


def test_the_ladder_is_monotone_in_both_axes():
    """More matches never demotes him, and neither do more minutes. Cheap, and it would catch a cascade
    rewritten in the wrong order - which is exactly how a six-branch `if` goes wrong."""
    plays = [0.0, 0.3, 0.5, 0.6, 0.8, 0.85, 0.9, 0.95, 1.0]
    mins = [10.0, 40.0, 64.0, 65.0, 74.0, 75.0, 90.0]
    for in_eleven in (False, True):
        for one in mins:
            ranks = [status.rank_of(status.status_of(play, one, in_eleven)) for play in plays]
            assert ranks == sorted(ranks, reverse=True)
        for play in plays:
            ranks = [status.rank_of(status.status_of(play, one, in_eleven)) for one in mins]
            assert ranks == sorted(ranks, reverse=True)


def test_the_share_it_reads_is_the_one_WITHOUT_the_injury_discount():
    """`appearance_share` x `availability` IS `voto_share` - one definition, split, not duplicated.

    The ladder reads the first factor because it has to agree with the typical eleven, which is «the side
    with everybody fit». If these two ever stop multiplying to `voto_share`, the state and the auction's
    own column are answering with two different models.
    """
    one = presence.Inputs(starts=20.0, appearances=30.0, minutes=2400.0, league_matches=38.0,
                          weighted_all=4.0, known_injuries=True)
    share = presence.appearance_share(one)
    assert abs(share * presence.availability(one) - presence.voto_share(one)) < 1e-12
    assert share > presence.voto_share(one)                 # he missed matches, so the two differ


def test_the_two_inputs_are_the_ones_the_rest_of_the_engine_already_publishes():
    """Not a test of a value: a test that the ladder is not fed by a private model of its own.

    `minutes.per_appearance` is the card's chip and `presence.appearance_share` is `voto_share`'s own
    first factor. A future reader tempted to give `status` its own minutes will have to delete this.
    """
    predicted = minutes.per_appearance("C", 2400.0, 30.0, 0.8, 0.7, 0.8)
    assert status.status_of(0.95, predicted, True) in status.LADDER
