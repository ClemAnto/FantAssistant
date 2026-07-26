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
        assert module.NAME == name


def test_gui_module_importable():
    # Importable without opening windows (Tk() is not instantiated at import time).
    from euroleghe_ingest import gui

    assert hasattr(gui, "ToolkitGUI") and hasattr(gui, "main")


def test_every_button_has_a_tooltip():
    from euroleghe_ingest import gui

    for _label, command in gui.OPERATIONS:
        assert gui.TOOLTIPS.get(command), f"missing tooltip for {command!r}"


def test_every_operation_is_in_exactly_one_cadence_group():
    """The panel groups operations by how often they are run; a new module must be filed in one."""
    from euroleghe_ingest import gui

    grouped = [command for _group, commands in gui.OPERATION_GROUPS for command in commands]
    assert len(grouped) == len(set(grouped)), "an operation is listed in two groups"
    assert set(PIPELINE) <= set(grouped), f"ungrouped modules: {sorted(set(PIPELINE) - set(grouped))}"


def test_module_buttons_are_labelled_with_the_module_name():
    from euroleghe_ingest import gui

    labels = {command: label for label, command in gui.OPERATIONS}
    assert labels["ratings"] == "ratings"          # no "Module:" prefix
    assert labels["initdb"] == "Initialize DB"     # meta-operations keep a readable label


def test_every_implemented_module_reports_when_it_is_done():
    """Without an output counter a module's dot stays orange forever, however often it is run."""
    from euroleghe_ingest import gui
    from euroleghe_ingest.modules import IMPLEMENTED

    producers = IMPLEMENTED - {"validate"}          # validate is a check, it produces nothing
    assert producers <= set(gui.OUTPUT_COUNTER), \
        f"no output counter for: {sorted(producers - set(gui.OUTPUT_COUNTER))}"


def test_new_modules_turn_green_once_their_output_exists():
    from euroleghe_ingest.gui import operation_state

    counts = {"players": 10, "rosters": 10, "season_stats": 10}
    for command, counter in (("matchdays", "matchday_map"), ("positions", "external_stats"),
                             ("synth", "external_match_stats.mv_synth")):
        assert operation_state(command, counts, True) == "todo"
        assert operation_state(command, {**counts, counter: 1}, True) == "completed"


def test_option_dialogs_and_follow_ups_point_at_real_things():
    from euroleghe_ingest.gui import ToolkitGUI
    from euroleghe_ingest.modules import ALL_MODULES

    for command, method in ToolkitGUI.DIALOGS.items():
        assert command in ALL_MODULES
        assert callable(getattr(ToolkitGUI, method))

    # the per-match layer is useless until the map and the calibration are recomputed
    assert ToolkitGUI._follow_ups("positions", {"layer": "match"}) == ("matchdays", "synth")
    assert ToolkitGUI._follow_ups("positions", {"layer": "season"}) == ()
    assert ToolkitGUI._follow_ups("ratings", {}) == ("matchdays",)
    assert ToolkitGUI._follow_ups("elo", {}) == ()
    for follow_ups in (ToolkitGUI._follow_ups("positions", {"layer": "all"}),
                       ToolkitGUI._follow_ups("ratings", {})):
        assert set(follow_ups) <= set(ALL_MODULES)


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
