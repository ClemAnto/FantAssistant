"""Scaffold smoke test: schema applies, CLI builds, validate on an empty DB."""

from __future__ import annotations

from euroleghe_ingest.cli import build_parser
from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import PIPELINE, load


def test_schema_applies(tmp_path):
    db = tmp_path / "euroleghe.db"
    conn = init_db(db)
    tables = {
        r[0]
        for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    # key tables from spec v8
    assert {"players", "clubs", "rosters", "penalty_hierarchy", "manual_overrides"} <= tables


def test_cli_parser_builds():
    parser = build_parser()
    assert parser.prog == "euroleghe-ingest"


def test_validate_passes_on_empty_db(tmp_path):
    cfg = Config(db_path=tmp_path / "euroleghe.db")
    ctx = Context(config=cfg, conn=init_db(cfg.db_path))
    load("validate").run(ctx)  # no populated tables -> no problems


def test_pipeline_modules_importable():
    for name in PIPELINE:
        module = load(name)
        assert hasattr(module, "run")
        assert getattr(module, "NAME") == name


def test_gui_module_importable():
    # Importable without opening windows (Tk() is not instantiated at import time).
    import euroleghe_ingest.gui as gui

    assert hasattr(gui, "ToolkitGUI") and hasattr(gui, "main")


def test_every_button_has_a_tooltip():
    import euroleghe_ingest.gui as gui

    for _label, command in gui.OPERATIONS:
        assert gui.TOOLTIPS.get(command), f"missing tooltip for {command!r}"


def test_operation_state_logic():
    from euroleghe_ingest.gui import operation_state

    # No DB yet, raw sources present: create the DB / run the implemented modules; stubs unavailable.
    assert operation_state("initdb", None, True) == "todo"
    assert operation_state("rosters", None, True) == "todo"
    assert operation_state("validate", None, True) == "unavailable"  # nothing to validate
    assert operation_state("fbref", None, True) == "unavailable"     # stub (not implemented)
    assert operation_state("elo", None, True) == "todo"              # elo is implemented
    assert operation_state("fetch:plan", None, True) == "unavailable"

    # Populated DB: implemented outputs are completed; validate is available.
    counts = {"players": 1662, "rosters": 3199, "season_stats": 3199}
    assert operation_state("initdb", counts, True) == "completed"
    assert operation_state("rebuild", counts, True) == "completed"
    assert operation_state("rosters", counts, True) == "completed"
    assert operation_state("stats", counts, True) == "completed"
    assert operation_state("validate", counts, True) == "todo"
    assert operation_state("elo", counts, True) == "todo"                        # club_elo not built yet
    assert operation_state("elo", {**counts, "club_elo": 76}, True) == "completed"

    # No raw sources: data modules can't run.
    assert operation_state("rosters", None, False) == "unavailable"
    assert operation_state("rebuild", None, False) == "unavailable"

    # DB exists but empty: rosters still to do (output not produced yet).
    empty = {"players": 0, "rosters": 0, "season_stats": 0}
    assert operation_state("rosters", empty, True) == "todo"
