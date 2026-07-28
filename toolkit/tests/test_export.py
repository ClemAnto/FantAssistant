"""Tests for the app's data bundle.

What is worth asserting here is not "does it write a file" but the three things a wrong bundle would
do silently: copy a column into the wrong column (an ALTER-TABLE migration puts a new column at the
END of the source table while schema.sql declares it in the middle), ship a bundle whose references
dangle, and lose the manifest that says which prices are auction-safe.
"""

from __future__ import annotations

import gzip
import json
import sqlite3

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import export


def _ctx(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    cfg.cache_dir.mkdir(parents=True)
    return Context(config=cfg, conn=init_db(cfg.db_path))


def _seed(conn) -> None:
    conn.execute("INSERT INTO players(fc_id, canonical_name, birth_year) VALUES (1, 'Kean', 2000)")
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (2, 'Bastoni')")
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) "
                 "VALUES (10, 'Fiorentina', 'serie_a')")
    for season in ("2024-25", "2025-26"):
        for fc_id in (1, 2):
            conn.execute(
                "INSERT INTO rosters(fc_id, season, fc_club_id, league, role_classic, roles, "
                "price, price_initial) VALUES (?, ?, 10, 'serie_a', 'A', 'a', 30, 25)",
                (fc_id, season))
            for platform in ("euro", "default"):
                conn.execute("INSERT INTO season_stats(fc_id, season, platform, pv, mv, fm) "
                             "VALUES (?, ?, ?, 30, 6.1, 7.2)", (fc_id, season, platform))
    conn.execute("INSERT INTO match_ratings(fc_id, season, matchday, platform, mv) "
                 "VALUES (1, '2025-26', 1, 'euro', 6.5)")
    conn.execute("INSERT INTO match_ratings(fc_id, season, matchday, platform, mv) "
                 "VALUES (1, '2023-24', 1, 'euro', 6.0)")
    conn.commit()


def test_bundle_round_trips_and_verifies(tmp_path):
    ctx = _ctx(tmp_path)
    _seed(ctx.conn)
    manifest = export.run(ctx, history=1)

    assert manifest["target_season"] == "2025-26"
    assert manifest["input_season"] == "2024-25"
    bundle = ctx.config.data_dir / "export" / "2025-26" / "bundle.sqlite"
    out = sqlite3.connect(bundle)
    try:
        # 'season' scope: every season up to the target. 'heavy' scope: the last one only.
        assert out.execute("SELECT COUNT(*) FROM rosters").fetchone()[0] == 4
        assert [row[0] for row in out.execute(
            "SELECT DISTINCT season FROM match_ratings")] == ["2025-26"], \
            "history=1 must leave the older per-matchday rows behind"
        # the price columns must land in the right column, not merely be present
        assert out.execute("SELECT price, price_initial FROM rosters LIMIT 1").fetchone() == (30, 25)
        assert out.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        out.close()
    assert manifest["verify"]["problems"] == []


def test_json_tables_are_readable_and_column_named(tmp_path):
    ctx = _ctx(tmp_path)
    _seed(ctx.conn)
    export.run(ctx, formats=("json",), history=1, verify=False)
    path = ctx.config.data_dir / "export" / "2025-26" / "json" / "rosters.json.gz"
    payload = json.loads(gzip.decompress(path.read_bytes()).decode("utf-8"))
    assert payload["table"] == "rosters"
    assert "price_initial" in payload["columns"]
    row = dict(zip(payload["columns"], payload["rows"][0], strict=True))
    assert row["price_initial"] == 25 and row["fc_id"] in (1, 2)


def test_manifest_carries_the_discipline_the_app_must_not_guess(tmp_path):
    ctx = _ctx(tmp_path)
    _seed(ctx.conn)
    manifest = export.run(ctx, history=1)
    assert manifest["price_discipline"]["auction_safe"] == ["rosters.price_initial",
                                                           "rosters.price_initial_mantra"]
    assert "rosters.fvm" in manifest["price_discipline"]["reporting_only"]
    assert manifest["provisional_parameters"]["injuries.EXIT_RISK_MONTHS"] == 12
    assert manifest["adopted_rules"]["by_platform"]["euro"][0] == "R0"
    assert manifest["known_gaps"], "a bundle without its known gaps invites a wrong reading"
    assert "match_rating_bonuses" in manifest["excluded"]
    # every contract table is accounted for, with a row count
    assert {entry["name"] for entry in manifest["tables"]} == {spec.name for spec in export.CONTRACT}
    config_dir = ctx.config.data_dir / "export" / "2025-26" / "config"
    assert (config_dir / "scoring_config.json").exists()
    assert (config_dir / "league_config.json").exists()


def test_verify_fails_on_a_dangling_reference(tmp_path):
    ctx = _ctx(tmp_path)
    _seed(ctx.conn)
    # A roster row whose player is not in `players`: the FK is OFF while copying, so only the
    # verification pass can catch this - which is the whole reason it re-opens the bundle.
    ctx.conn.execute("PRAGMA foreign_keys = OFF")
    ctx.conn.execute("INSERT INTO rosters(fc_id, season, fc_club_id) VALUES (999, '2025-26', 10)")
    ctx.conn.commit()
    try:
        export.run(ctx, history=1)
    except RuntimeError as exc:
        assert "verify failed" in str(exc)
    else:
        raise AssertionError("a dangling roster reference must fail the export")


def test_missing_target_season_falls_back_and_says_so(tmp_path):
    ctx = _ctx(tmp_path)
    _seed(ctx.conn)
    target, warning = export.resolve_target_season(ctx.conn, "2026-27")
    assert target == "2025-26"
    assert "2026-27" in warning and "listone" in warning


def test_absent_seasons_are_notes_not_problems(tmp_path):
    """euro has no rows before 2018-19 and 2021-22 is empty at the source: a bundle must still build."""
    ctx = _ctx(tmp_path)
    _seed(ctx.conn)
    ctx.conn.execute("INSERT INTO rosters(fc_id, season, fc_club_id, league) "
                     "VALUES (1, '2015-16', 10, 'serie_a')")
    ctx.conn.commit()
    manifest = export.run(ctx, history=1)
    assert manifest["verify"]["problems"] == []
    assert any("2015-16" in note for note in
               export.verify_bundle(ctx.config.data_dir / "export" / "2025-26" / "bundle.sqlite",
                                    ["2015-16", "2024-25", "2025-26"], "2025-26",
                                    ("euro", "default"))[1])


def test_heavy_window_covers_the_cross_fit_window(tmp_path):
    """The default must include the season the COEFFICIENTS are fitted on, not just the input season.

    This is the regression test for the subtlest failure of the whole bundle: with two seasons of the
    per-match tables the observations came out identical and every gate metric matched, and the auction
    list still differed - the parameters had been fitted on a window whose per-match layer was missing.
    Nothing but running the harness against the bundle could have surfaced it.
    """
    from euroleghe_ingest.engine import features

    assert export.DEFAULT_HISTORY >= 3
    ctx = _ctx(tmp_path)
    _seed(ctx.conn)
    for season in ("2022-23", "2023-24"):
        ctx.conn.execute("INSERT INTO rosters(fc_id, season, fc_club_id, league) "
                         "VALUES (1, ?, 10, 'serie_a')", (season,))
    ctx.conn.commit()
    manifest = export.run(ctx, formats=("json",), verify=False)
    target = manifest["target_season"]
    window = next(w for w in features.WINDOWS.values() if w.target_season == target)
    source = features.cross_fit_source(
        next(key for key, w in features.WINDOWS.items() if w.target_season == target))
    # the input season of the window AND of the window its parameters come from must both be there
    assert window.input_season in manifest["heavy_seasons"]
    assert features.WINDOWS[source].input_season in manifest["heavy_seasons"]
