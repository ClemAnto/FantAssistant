"""Tests for synth: the calibrated rating -> base-voto map."""

from __future__ import annotations

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import synth


def test_fit_line_recovers_a_known_line():
    pairs = [("C", rating, 1.0 + 0.8 * rating) for rating in (5.0, 6.0, 7.0, 8.0, 9.0)]
    assert synth._fit_line(pairs) == (1.0, 0.8)


def test_apply_model_uses_the_role_line_then_the_global_one():
    model = {"global": (1.0, 0.8), "roles": {"P": (2.0, 0.5)}}
    assert synth.apply_model(model, "P", 6.0) == 5.0        # role line
    assert synth.apply_model(model, "A", 6.0) == 5.8        # global fallback
    assert synth.apply_model(model, "A", None) is None


def test_apply_model_clamps_to_the_voto_range():
    model = {"global": (0.0, 2.0), "roles": {}}
    assert synth.apply_model(model, "C", 9.0) == synth.MV_RANGE[1]
    assert synth.apply_model(model, "C", 1.0) == synth.MV_RANGE[0]


def test_evaluate_beats_the_mean_baseline_on_a_linear_signal():
    pairs = [("C", rating, 1.0 + 0.8 * rating) for rating in (5.0, 6.0, 7.0, 8.0)]
    model = synth.fit_model(pairs)
    scores = synth.evaluate(model, pairs)
    assert scores["mae"] < scores["mae_baseline_mean"]


def _seed(conn):
    """One player, one league, a mapped matchday, and a provider row on the same real match."""
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (1, 'X')")
    conn.execute("INSERT INTO rosters(fc_id, season, league, role_classic) "
                 "VALUES (1, '2023-24', 'serie_a', 'C')")
    conn.execute("INSERT INTO matchday_map(season, euro_md, league, real_md, source) "
                 "VALUES ('2023-24', 1, 'serie_a', 2, 'derived')")


def test_overlap_pairs_joins_through_the_matchday_map(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    conn = init_db(cfg.db_path)
    _seed(conn)
    conn.execute("INSERT INTO match_ratings(fc_id, season, matchday, role, platform, mv) "
                 "VALUES (1, '2023-24', 1, 'C', 'euro', 6.5)")
    conn.execute(
        "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, real_md,"
        " minutes, rating) VALUES (1, '2023-24', 'sofascore', 'e1', 'serie_a', 2, 90, 7.1)")
    conn.commit()
    fit, test = synth.overlap_pairs(conn, holdout_season="2025-26")
    assert fit == [("C", 7.1, 6.5)] and test == []


def test_run_writes_mv_synth(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    conn = init_db(cfg.db_path)
    _seed(conn)
    # enough overlap rows for a line: euro matchday 1 <-> real matchday 2
    for index, (rating, mv) in enumerate([(5.0, 5.5), (6.0, 6.0), (7.0, 6.5), (8.0, 7.0)]):
        conn.execute("INSERT INTO match_ratings(fc_id, season, matchday, role, platform, mv) "
                     "VALUES (1, ?, 1, 'C', 'euro', ?)", (f"20{index}0-21", mv))
        conn.execute("INSERT INTO matchday_map(season, euro_md, league, real_md, source) "
                     "VALUES (?, 1, 'serie_a', 2, 'derived')", (f"20{index}0-21",))
        conn.execute(
            "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition,"
            " real_md, minutes, rating) VALUES (1, ?, 'sofascore', 'e1', 'serie_a', 2, 90, ?)",
            (f"20{index}0-21", rating))
    conn.commit()

    synth.run(Context(config=cfg, conn=conn), holdout_season=None)
    values = [row[0] for row in conn.execute(
        "SELECT mv_synth FROM external_match_stats ORDER BY season")]
    assert all(value is not None for value in values)
    assert values == sorted(values)                     # monotone in the rating
    assert (cfg.data_dir / "reports" / synth.CALIBRATION_FILE).exists()

def test_a_competition_the_line_never_saw_needs_an_offset_and_the_offset_needs_two_nulls():
    """Gate §7-nonies, and the case that asked for it: ten Serie B matches that do not become a voto.

    The line is fitted on the OVERLAP - a rating and a real vote for the same match - and for Serie B that
    overlap is zero rows, because the game does not cover Serie B. So a competition outside the five gets a
    number only through an OFFSET, and the offset is validated against two nulls: the naked line (converting
    with no correction at all) and the role anchor (the trivial answer). It is kept only if it beats both on
    the majority of the men, which is what was written down before it was fitted.

    Measured: Serie B's offset is real (-0.181, leave-one-out 0.163 against 0.204 for the naked line) and
    still loses to the anchor - so nothing is converted, and `APPLY_OFFSETS` stays off.
    """
    from euroleghe_ingest.modules import synth

    model = {"global": (1.0, 0.7), "roles": {}, "calibrated": ["serie_a", "bundesliga"]}
    # a calibrated competition needs no offset and never asks for one
    assert synth.apply_model(model, "C", 7.0, "bundesliga") == 5.9
    # ...one outside it returns NOTHING without an offset: no line covers it
    assert synth.apply_model(model, "C", 7.0, "serie-b") is None
    with_offset = {**model, "offsets": {"serie-b": {"delta": -0.2}}}
    assert synth.apply_model(with_offset, "C", 7.0, "serie-b") == 5.7
    # and a competition below the floor of men is reported, never guessed
    thin = {**model, "offsets": {"serie-b": {"delta": None}}}
    assert synth.apply_model(thin, "C", 7.0, "serie-b") is None

    # the estimator: delta is the mean gap over MEN, and the leave-one-out says whether it is worth having
    men = {"lega-x": [{"fc_id": index, "season": "2024-25", "rating": 7.0, "mv": 6.0,
                       "role": "C", "same_season": True, "matches_there": 10}
                      for index in range(12)]}
    fitted = synth.fit_offsets(model, men)["lega-x"]
    assert fitted["men"] == 12 and fitted["arm"] == "same_season"
    assert round(fitted["delta"], 2) == round(6.0 - 5.9, 2), fitted
    # a sample smaller than the floor is answered with "not estimable" and not with a number
    few = {"lega-y": men["lega-x"][:4]}
    assert synth.fit_offsets(model, few)["lega-y"]["delta"] is None

