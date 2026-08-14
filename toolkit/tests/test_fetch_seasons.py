"""Tests for the PER-SEASON coverage report.

The point of the report is not counting - it is refusing to call three different things a gap. So the
tests assert the CLASSIFICATION on a database built to contain one of each: a season the source cannot
serve, a season nobody has played yet, and one real hole.
"""

from __future__ import annotations

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import fetch


def _ctx(tmp_path) -> Context:
    cfg = Config(data_dir=tmp_path, db_path=tmp_path / "t.db")
    return Context(config=cfg, conn=init_db(cfg.db_path))


def _player(conn, fc_id: int) -> int:
    """Both tables reference `players`, so a row has to exist before it can be quoted or rated."""
    conn.execute("INSERT OR IGNORE INTO players(fc_id, canonical_name) VALUES (?,?)",
                 (fc_id, f"Tizio {fc_id}"))
    return fc_id


def _played(conn, season: str, *, votes: int = 3, mapped: bool = True) -> None:
    """A season with votes (so it counts as played) and, optionally, its calendar map."""
    for md in range(1, votes + 1):
        conn.execute("""INSERT OR REPLACE INTO match_ratings(fc_id, season, matchday, platform, mv)
                        VALUES (?,?,?,?,?)""", (_player(conn, 100 + md), season, md, "euro", 6.0))
    if mapped:
        conn.execute("""INSERT OR REPLACE INTO matchday_map(season, euro_md, league, real_md, source,
                        confidence) VALUES (?,?,?,?,?,?)""",
                     (season, 1, "serie_a", 1, "derived", 1.0))
    conn.commit()


def _quoted_only(conn, season: str) -> None:
    """A season the listone quotes and nobody has played: the target season's shape."""
    conn.execute("""INSERT OR REPLACE INTO listone_quotes(fc_id, season, platform, price_initial)
                    VALUES (?,?,?,?)""", (_player(conn, 1), season, "euro", 10.0))
    conn.commit()


def test_a_table_that_is_populated_for_the_season_is_not_offered_as_work(tmp_path, capsys):
    """The complement of the test below, and the one that would catch a report crying wolf.

    A minimal fixture legitimately has zeros in the tables nobody filled, so «no gap at all» is the
    wrong assertion here: what must hold is that the table WITH rows for that season does not appear
    in the work list."""
    ctx = _ctx(tmp_path)
    _played(ctx.conn, "2024-25")
    fetch.print_season_plan(ctx, last=5)
    out = capsys.readouterr().out
    assert "matchday_map 2024-25" not in out
    assert "match_ratings 2024-25 ->" not in out


def test_a_real_hole_is_reported_with_the_command_that_fills_it(tmp_path, capsys):
    """A played season missing its calendar map is the one class that IS work to do."""
    ctx = _ctx(tmp_path)
    _played(ctx.conn, "2024-25", mapped=False)
    fetch.print_season_plan(ctx, last=5)
    out = capsys.readouterr().out
    assert "matchday_map 2024-25" in out
    # `matchdays` derives every season in one pass, so the command is quoted bare - and that is
    # checked against the parser by the last test in this file, not assumed here.
    assert "euroleghe_ingest matchdays" in out


def test_the_target_season_is_not_a_gap(tmp_path, capsys):
    """Quoted and never played: every fact born on the pitch is absent BY CONSTRUCTION.

    Reported as a target season and excluded from the work list - offering `ratings --season 2026-27`
    in August is a command that cannot succeed, which is the defect this report exists to cure."""
    ctx = _ctx(tmp_path)
    _played(ctx.conn, "2025-26")
    _quoted_only(ctx.conn, "2026-27")
    fetch.print_season_plan(ctx, last=5)
    out = capsys.readouterr().out
    assert "[bersaglio] 2026-27" in out
    assert "match_ratings 2026-27 ->" not in out
    assert "season_stats 2026-27 ->" not in out


def test_a_gap_the_source_cannot_fill_is_stated_and_never_offered_as_work(tmp_path, capsys):
    """The two measured source limits are printed as facts, not as commands.

    `KNOWN_SEASON_GAPS` is the list, and it exists because a plan that says «run this» about data the
    provider does not serve sends somebody to spend hours for nothing."""
    ctx = _ctx(tmp_path)
    _played(ctx.conn, "2021-22", mapped=False)
    fetch.print_season_plan(ctx, last=5)
    out = capsys.readouterr().out
    assert "[fonte] match_ratings 2021-22" in out
    # declared for match_ratings, so no command for THAT pair...
    assert "match_ratings 2021-22 ->" not in out
    # ...while a different table of the same season is still real work
    assert "matchday_map 2021-22" in out


def test_every_declared_gap_names_a_table_the_report_actually_walks():
    """A declaration about a table nobody reports on would be a note nobody ever sees."""
    covered = {table for table, _c, _w in fetch.SEASON_COVERAGE}
    for table, _season, _note, _why in fetch.KNOWN_SEASON_GAPS:
        assert table in covered, table


def test_every_offered_command_actually_parses():
    """A plan that prints a command nobody can run is worse than no plan.

    The first version of this list offered `matchdays --season 2021-22`; that flag does not exist, so
    the report built to stop useless work was printing some. Each template is checked against the real
    argument parser instead of being trusted."""
    import shlex

    from euroleghe_ingest.cli import build_parser

    parser = build_parser()
    for _table, command, _what in fetch.SEASON_COVERAGE:
        if "/" in command:
            continue          # a prose list of several modules, not one invocation
        argv = shlex.split(command.format(season="2024-25").replace("euro|default", "euro"))
        parser.parse_args(argv)     # raises SystemExit if the flag does not exist
