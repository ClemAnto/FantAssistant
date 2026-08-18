"""Pure-formula tests for `engine/minutes.py`: no DB, no I/O.

One of them exists to stop an IDEA coming back rather than to pin a formula - the ratio of two claims,
which was proposed, measured and refused because it deletes the minutes it claims to rescale.
"""

from __future__ import annotations

from dataclasses import replace

from euroleghe_ingest.engine import minutes

# A midfielder with a full season: 30 appearances, 2400 minutes, started 80% of them.
MAN = dict(role="C", minutes=2400.0, matches=30.0, start_share=0.8)


def _predicted(**over):
    one = {**MAN, "presence_share": 0.7, "expected_share": 0.8, **over}
    return minutes.per_appearance(one["role"], one["minutes"], one["matches"], one["start_share"],
                                  one["presence_share"], one["expected_share"])


def test_an_unchanged_start_rate_still_SHRINKS_him_toward_his_role():
    """The property that surprises, so it is pinned: with P_next = P_prev the number is NOT his average.

    Only `anchor` of the personal residual survives, which is a shrinkage - and it is where +4.6% / +4.9%
    of the measured +7.6% comes from. The man here measured 80' per appearance at a start rate of 0.8; his
    role's structure says 68.1', and he is drawn back four fifths of the way to it.
    """
    # presence / expected = 0.8 = his measured start share, so the BLEND cannot move him: only the
    # shrinkage acts.
    same = _predicted(presence_share=0.64, expected_share=0.8)
    level = minutes.SUB_MINUTES["C"] + 0.8 * (minutes.START_MINUTES["C"] - minutes.SUB_MINUTES["C"])
    assert abs(same - (level + minutes.DEFAULTS.anchor * (80.0 - level))) < 0.01
    assert level < same < 80.0


def test_a_man_who_will_start_more_is_expected_to_stay_on_longer():
    losing = _predicted(presence_share=0.24)        # modelled P 0.30 against a measured 0.80
    keeping = _predicted(presence_share=0.64)       # modelled P 0.80, i.e. unchanged
    gaining = _predicted(presence_share=0.80)       # modelled P 1.00
    assert losing < keeping < gaining


def test_it_never_leaves_the_two_measured_ends():
    """Bounded by construction: a man cannot play more than a match nor less than a minute."""
    for presence_share in (0.0, 0.2, 0.5, 0.8, 1.0):
        for start_share in (0.0, 0.5, 1.0):
            one = _predicted(presence_share=presence_share, start_share=start_share)
            assert minutes.MIN_MINUTES <= one <= minutes.MAX_MINUTES


def test_a_missing_half_is_unknown_and_never_zero():
    assert minutes.per_appearance("C", None, 30.0, 0.8, 0.7, 0.8) is None
    assert minutes.per_appearance("C", 2400.0, None, 0.8, 0.7, 0.8) is None
    assert minutes.per_appearance("C", 2400.0, 0.0, 0.8, 0.7, 0.8) is None


def test_without_a_measured_start_rate_the_number_stays_HIS():
    """No `desc_start_share`: no residual to shrink and no rate to blend, so the measurement stands."""
    assert minutes.per_appearance("C", 2400.0, 30.0, None, 0.7, 0.8) == 80.0


def test_without_a_prediction_only_the_shrinkage_acts():
    """The sheet cannot price him: the start rate falls back to his own, and he is shrunk and not moved."""
    alone = minutes.per_appearance("C", 2400.0, 30.0, 0.8, None, None)
    assert abs(alone - _predicted(presence_share=0.64, expected_share=0.8)) < 1e-9


def test_the_keeper_is_not_rescaled():
    """Measured: rescaling him is WORSE (MAE 3.65 -> 6.19 and 2.24 -> 5.88 on the two windows), because
    his P is 1 by the rulebook and the model's is not. His measurement is his forecast."""
    kept = minutes.per_appearance("P", 2700.0, 30.0, 1.0, 0.2, 0.9)
    assert kept == 90.0


def test_an_unknown_role_gets_its_own_constants_and_not_the_midfielder_s():
    assert minutes.START_MINUTES["?"] != minutes.START_MINUTES["C"]
    assert minutes.per_appearance(None, 2400.0, 30.0, 0.8, 0.7, 0.8) == _predicted(role="?")


def test_the_start_rate_is_a_blend_and_the_model_is_the_minority():
    """`model_mix` = 0.30, measured: the pure model arm is NEGATIVE on both windows (-4.2%, -8.4%)."""
    rate = minutes.start_rate_next(0.6, 1.0, 0.8)
    assert abs(rate - (0.30 * 0.6 + 0.70 * 0.8)) < 1e-9
    assert minutes.DEFAULTS.model_mix < 0.5


def test_the_start_rate_cannot_exceed_one_appearance():
    """He cannot start more often than he plays: two shares, and the cap is on their ratio."""
    assert minutes.start_rate_next(0.9, 0.3, 1.0) == 1.0


def test_the_ratio_of_two_claims_deletes_the_minutes_it_claims_to_rescale():
    """THE REFUSED ESTIMATOR, kept as arithmetic so nobody proposes it again.

    The claim's measured part is `minutes / (rounds x 90)` (`standing_weights` = (0, 1)), so scaling the
    per-appearance average by `claim_now / claim_prev` cancels the minutes and leaves
    `90 x rounds x claim_now / matches` - a number with nothing of his own in it but the denominator.
    Measured on the two windows: -59% and -55% against changing nothing.
    """
    minutes_prev, matches, rounds, claim_now = 2400.0, 30.0, 38.0, 0.55
    claim_prev = minutes_prev / (rounds * 90.0)
    ratio = (minutes_prev / matches) * claim_now / claim_prev
    assert abs(ratio - 90.0 * rounds * claim_now / matches) < 1e-9


def test_the_parameters_are_swept_and_not_frozen():
    """A harness must be able to vary them: `replace` is the sweep's own way in (like `presence.Params`)."""
    hotter = replace(minutes.DEFAULTS, model_mix=1.0)
    one = minutes.per_appearance("C", 2400.0, 30.0, 0.8, 0.3, 0.8, hotter)
    assert one != _predicted(presence_share=0.3)
