"""Pure-formula tests for the engine: no DB, no I/O.

Two kinds of assertions here. The behavioural ones pin the formulas (an anchor pulls, a clip clips).
The others tie the published constants to each other: the engine's shipped values must be the mean of
the per-season / per-window figures they were derived from, so a typo while transcribing a table from
docs/model fails a test instead of quietly biasing every backtest.
"""

from __future__ import annotations

import pytest

from euroleghe_ingest.engine import model
from euroleghe_ingest.engine.fitting import fit_linear, predict_linear, spearman

# ---------------------------------------------------------------- core


def test_anchor_pulls_towards_itself():
    anchor, fm_prev = 6.0, 8.0
    assert model.predict_fm(anchor, fm_prev, 0.0) == anchor          # beta 0 -> pure anchor
    assert model.predict_fm(anchor, fm_prev, 1.0) == fm_prev          # beta 1 -> pure persistence
    predicted = model.predict_fm(anchor, fm_prev, 0.42)
    assert anchor < predicted < fm_prev
    # symmetric below the anchor: a bad season is regressed upwards by the same fraction
    assert model.predict_fm(anchor, 4.0, 0.42) == pytest.approx(6.0 - 0.42 * 2.0)


def test_fractional_anchor_averages_the_roles_and_skips_unknown_ones():
    anchors = {"w": 6.74, "a": 7.12}
    assert model.fractional_anchor(("w", "a"), anchors) == pytest.approx(6.93)
    assert model.fractional_anchor(("a", "zz"), anchors) == pytest.approx(7.12)
    assert model.fractional_anchor((), anchors) is None
    # a role nobody has an anchor for must be "not predictable", never 0
    assert model.fractional_anchor(("zz",), anchors) is None


def test_goalkeeper_module_decomposes_ability_and_defence():
    mu = 1.30
    # an average keeper in an average defence: only the penalties-saved term survives
    assert model.predict_fm_goalkeeper(model.GK_MV_ANCHOR, mu, mu) == pytest.approx(
        model.GK_MV_ANCHOR - mu + model.GK_PEN_SAVED)
    # a keeper who moves to a tighter defence is worth more, all else equal
    tight = model.predict_fm_goalkeeper(6.30, 0.80, mu)
    leaky = model.predict_fm_goalkeeper(6.30, 1.90, mu)
    assert tight > leaky
    assert tight - leaky == pytest.approx(model.GK_RATE_BETA * (1.90 - 0.80))
    # unknown destination club falls back to the population mean, it does not crash
    assert model.predict_fm_goalkeeper(6.30, None, mu) == pytest.approx(
        model.predict_fm_goalkeeper(6.30, mu, mu))


# ---------------------------------------------------------------- appearances


def test_expected_share_is_bounded_and_monotone():
    baseline = model.expected_share(0.5, 6.2, False)
    assert model.expected_share(0.9, 6.2, False) > baseline
    assert model.expected_share(0.1, 6.2, False) < baseline
    # club change is worth exactly its coefficient
    assert (model.expected_share(0.5, 6.2, True) - baseline
            == pytest.approx(model.PV_SHARE_COEFFS[3]))
    # the share can never leave [0, 1], whatever the inputs
    assert 0.0 <= model.expected_share(0.0, 3.0, False) <= 1.0
    # even every term at its maximum stays inside the band, and short of a full season: the module
    # never promises anyone all 38 matchdays
    assert model.expected_share(1.0, 10.0, True) == pytest.approx(sum(model.PV_SHARE_COEFFS))
    assert model.expected_share(1.0, 10.0, True) < 1.0


def test_mv_term_is_clipped_so_tiny_samples_cannot_dominate():
    huge = model.expected_share(0.5, 20.0, False)
    at_bound = model.expected_share(0.5, model.MV_PIVOT + model.MV_CLIP, False)
    assert huge == pytest.approx(at_bound)


def test_expected_appearances_cannot_exceed_the_calendar():
    assert model.expected_appearances(1.4, 31) == 31
    assert model.expected_appearances(0.0, 31) == 0
    assert model.season_value(7.0, 25.0) == 175.0


def test_penalty_adjustment_scales_with_the_hierarchy_confidence():
    assert model.penalty_adjustment(None, 0.3) == 0.0        # not a taker -> nothing
    assert model.penalty_adjustment(1.0, 0.3) == pytest.approx(0.3)
    assert model.penalty_adjustment(0.5, 0.3) == pytest.approx(0.15)


def test_off_role_adjustment_is_asymmetric_and_direction_aware():
    forward, backward = 0.10, -0.20
    # a defender used as a midfielder is used further FORWARD
    assert model.off_role_adjustment("D", "C", forward, backward) == pytest.approx(forward)
    # a midfielder used as a defender is used further BACK
    assert model.off_role_adjustment("C", "D", forward, backward) == pytest.approx(backward)
    assert model.off_role_adjustment("C", "C", forward, backward) == 0.0
    # unknown on either side -> no adjustment, never a guess
    assert model.off_role_adjustment(None, "A", forward, backward) == 0.0
    assert model.off_role_adjustment("D", None, forward, backward) == 0.0
    assert model.off_role_adjustment("D", "??", forward, backward) == pytest.approx(backward)


def test_club_strength_and_competition_adjustments_are_linear_and_safe_when_unknown():
    assert model.club_strength_adjustment(None, 0.5) == 0.0      # no Elo -> no shift, never a guess
    assert model.club_strength_adjustment(2.0, 0.05) == pytest.approx(0.10)
    assert model.club_strength_adjustment(-2.0, 0.05) == pytest.approx(-0.10)
    assert model.competition_adjustment(0, -0.02) == 0.0
    assert model.competition_adjustment(3, -0.02) == pytest.approx(-0.06)


def test_coach_change_adjustment_only_fires_on_a_change():
    assert model.coach_change_adjustment(False, 0.9, -0.02, 0.06) == 0.0
    # level + interaction with the previous share: a starter and a fringe player move differently
    assert model.coach_change_adjustment(True, 0.9, -0.02, 0.06) == pytest.approx(-0.02 + 0.054)
    assert model.coach_change_adjustment(True, 0.1, -0.02, 0.06) == pytest.approx(-0.02 + 0.006)
    starter = model.coach_change_adjustment(True, 0.9, -0.02, 0.06)
    fringe = model.coach_change_adjustment(True, 0.1, -0.02, 0.06)
    assert starter > fringe                       # positive interaction sharpens the hierarchy


def test_role_advancement_covers_the_classic_vocabulary():
    assert set(model.ROLE_ADVANCEMENT) == set(model.CLASSIC_ROLES)
    order = [model.ROLE_ADVANCEMENT[role] for role in ("P", "D", "C", "A")]
    assert order == sorted(order)


# ---------------------------------------------------------------- published constants


def test_engine_mantra_anchors_are_the_mean_of_the_published_seasons():
    for role, engine_value in model.ENGINE_ANCHORS_MANTRA.items():
        if role in model.ANCHOR_FALLBACK:          # 'b' borrows 'dc', it has no own series yet
            continue
        seasons = [table[role] for table in model.REFERENCE_ANCHORS_MANTRA.values()
                   if role in table]
        assert seasons, f"no published series for role {role}"
        assert engine_value == pytest.approx(sum(seasons) / len(seasons), abs=0.011)


def test_shipped_appearance_coefficients_are_the_mean_of_the_two_window_fits():
    windows = list(model.REFERENCE_PV_COEFFS.values())
    for index, shipped in enumerate(model.PV_SHARE_COEFFS[1:]):     # skip the intercept
        published_mean = sum(window[index] for window in windows) / len(windows)
        assert shipped == pytest.approx(published_mean, abs=0.011)


def test_fallback_roles_point_at_roles_that_exist():
    for role, source in model.ANCHOR_FALLBACK.items():
        assert role in model.MANTRA_ROLES
        assert source in model.MANTRA_ROLES


# ---------------------------------------------------------------- fitting


def test_fit_linear_recovers_exact_coefficients():
    truth = (1.0, 2.0, -3.0)
    samples = [((x1, x2), truth[0] + truth[1] * x1 + truth[2] * x2)
               for x1, x2 in ((0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (2.0, 3.0), (-1.0, 4.0))]
    fitted = fit_linear(samples)
    assert fitted is not None
    assert fitted == pytest.approx(truth, abs=1e-9)
    assert predict_linear(fitted, (2.0, 1.0)) == pytest.approx(1.0 + 4.0 - 3.0)


def test_fit_linear_refuses_what_the_data_cannot_identify():
    # fewer samples than parameters
    assert fit_linear([((1.0,), 1.0)]) is None
    # a perfectly collinear design (x2 = 2*x1) must not return arbitrary coefficients
    collinear = [((x, 2 * x), 3 * x) for x in (1.0, 2.0, 3.0, 4.0, 5.0)]
    assert fit_linear(collinear) is None
    assert fit_linear([]) is None


def test_fit_linear_without_intercept_is_a_pure_slope():
    samples = [((x,), 0.42 * x) for x in (1.0, -2.0, 3.5)]
    fitted = fit_linear(samples, intercept=False)
    assert fitted is not None and fitted[0] == pytest.approx(0.42)


def test_spearman_reads_order_not_magnitude():
    rising = [(1.0, 10.0), (2.0, 20.0), (3.0, 31.0), (4.0, 400.0)]
    assert spearman(rising) == pytest.approx(1.0)
    assert spearman([(x, -y) for x, y in rising]) == pytest.approx(-1.0)
    assert spearman([(1.0, 5.0), (1.0, 5.0)]) is None           # too few points
    # all predictions identical -> no order to reward
    assert spearman([(1.0, 3.0), (1.0, 2.0), (1.0, 1.0)]) is None
