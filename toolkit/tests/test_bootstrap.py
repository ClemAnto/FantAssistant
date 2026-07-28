"""Tests for the from-zero acquisition plan and the source-status report.

The plan is data, so what matters is that it stays consistent with the modules it calls (a step
naming a module that does not exist would only fail hours into a real run) and that it refuses to
start without credentials instead of building half a database.
"""

from __future__ import annotations

import pytest

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import ALL_MODULES, bootstrap, fetch, load


def _ctx(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    cfg.cache_dir.mkdir(parents=True)
    return Context(config=cfg, conn=init_db(cfg.db_path))


def test_every_step_names_a_real_module_and_a_real_option():
    for step in bootstrap.plan():
        assert step.module in ALL_MODULES, f"{step.key}: unknown module {step.module}"
        assert step.why, f"{step.key}: a step without a reason is a step nobody can audit"
        assert step.minutes > 0


def test_the_registry_comes_before_anything_that_needs_it():
    keys = [step.key for step in bootstrap.plan()]
    # the listone (ratings) is what creates players/clubs/rosters on a machine with no Drive files,
    # so identity-resolving steps must come after it
    assert keys.index("ratings:default") < keys.index("positions:season")
    assert keys.index("positions:season") < keys.index("positions:match")
    assert keys.index("injuries:ids") < keys.index("injuries")
    assert keys.index("inbox") == 0


def test_from_and_to_select_a_slice(tmp_path, capsys):
    ctx = _ctx(tmp_path)
    bootstrap.run(ctx, dry_run=True)
    printed = capsys.readouterr().out
    assert "positions:match" in printed and "THE LONG ONE" in printed
    with pytest.raises(RuntimeError, match="not a step"):
        bootstrap.run(ctx, steps_from="nope", dry_run=False)


def test_it_refuses_to_run_without_credentials(tmp_path, monkeypatch):
    monkeypatch.setattr(bootstrap, "_credentials_present", lambda: False)
    ctx = _ctx(tmp_path)
    with pytest.raises(RuntimeError, match="credentials"):
        bootstrap.run(ctx)


def test_fetch_plan_reports_every_empty_table(tmp_path, capsys):
    ctx = _ctx(tmp_path)
    fetch.print_plan(ctx)
    printed = capsys.readouterr().out
    assert "empty table" in printed
    # the report must give the command, not just the diagnosis
    assert "python -m euroleghe_ingest" in printed
    assert all(table in printed for table, _c, _w in fetch.COVERAGE)


def test_fetch_inbox_imports_only_known_names(tmp_path, capsys):
    ctx = _ctx(tmp_path)
    ctx.config.inbox_dir.mkdir(parents=True, exist_ok=True)
    (ctx.config.inbox_dir / "euroleghe-stats-2023-24.csv").write_text("x", encoding="utf-8")
    (ctx.config.inbox_dir / "random-notes.txt").write_text("x", encoding="utf-8")
    assert fetch.import_inbox(ctx) == 1
    assert (ctx.config.raw_dir / "euroleghe-stats-2023-24.csv").exists()
    assert not (ctx.config.raw_dir / "random-notes.txt").exists()
    assert "left in the inbox" in capsys.readouterr().out


def test_rebuild_survives_a_completely_empty_machine(tmp_path, capsys):
    """The whole offline chain on a fresh clone: no raw files, no cache, no rows.

    This is the test that was missing. Rebuilding an empty machine died on a ZeroDivisionError deep in
    the birth-year step (a share of zero players), and nothing in the suite exercised the case because
    every other test seeds data first. A build from zero is exactly the situation where every "there is
    always at least one row" assumption is false.
    """
    ctx = _ctx(tmp_path)
    load("rebuild").run(ctx)
    printed = capsys.readouterr().out
    assert "[rebuild] done" in printed
    assert "network (run explicitly)" in printed, "the network modules must be deferred, not failed"
    # and it stays idempotent: a second pass over nothing is still a clean pass
    load("rebuild").run(ctx)
    assert "[rebuild] done" in capsys.readouterr().out
