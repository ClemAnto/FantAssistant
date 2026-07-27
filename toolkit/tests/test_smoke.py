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


def test_auction_view_tab_exists_and_labels_every_role():
    """The panel must be able to name every role either game can produce - a missing label would
    render a bare 'w' or 'pc' where the user expects a heading."""
    from euroleghe_ingest import gui
    from euroleghe_ingest.engine import model

    assert hasattr(gui, "AuctionView")
    for role in (*model.CLASSIC_ROLES, *model.MANTRA_ROLES):
        assert role in gui.AuctionView.ROLE_LABELS, role


def test_auction_tab_offers_both_games_on_both_platforms():
    """Mantra is played on the classic Serie A game too - its listone carries RM, Qt.A M, Qt.I M and
    FVM M, and rosters.roles holds the Serie A Mantra roles. The panel must offer what the data
    supports, and the gate must not skip the combination."""
    from euroleghe_ingest import gui

    for platform in ("euro", "default"):
        assert set(gui.AuctionView.GAMES[platform]) == {"classic", "mantra"}


def test_every_auction_column_is_explained_by_a_tooltip():
    """The columns are the whole point of the view and several are easy to misread - Qt.I against Qt.A
    is the look-ahead discipline, FVM is reporting-only, and FM/Pv/VALUE mean predicted on the left and
    actual on the right. A new column must not ship without its explanation."""
    from euroleghe_ingest import gui

    view = gui.AuctionView
    for columns, specific in ((view.PREDICTED_COLUMNS, view.PREDICTED_HELP),
                              (view.ACTUAL_COLUMNS, view.ACTUAL_HELP)):
        help_texts = {**view.COMMON_HELP, **specific}
        missing = [column for column in columns if not help_texts.get(column)]
        assert not missing, missing
        unused = [key for key in help_texts if key not in columns]
        assert not unused, unused
    # the two tables disagree about FM/Pv/VALUE on purpose, and that must stay true
    for column in ("FM", "Pv", "VALUE"):
        assert view.PREDICTED_HELP[column] != view.ACTUAL_HELP[column], column


def test_heading_tooltip_maps_the_identified_column_to_its_name():
    """Tk reports the column under the cursor as '#3'; the tooltip has to turn that into a name, and
    return nothing when the pointer is not over the header row at all."""
    from euroleghe_ingest import gui

    class FakeTree:
        def __init__(self):
            self.region, self.column = "heading", "#2"

        def cget(self, _option):
            return ("#", "Player", "Team")

        def identify_region(self, _x, _y):
            return self.region

        def identify_column(self, _x):
            return self.column

        def bind(self, *_a, **_k):
            return None

        def after(self, *_a, **_k):
            return None

    tree = FakeTree()
    tip = gui.HeadingTooltip(tree, {"Player": "the name"})
    event = type("E", (), {"x": 0, "y": 0})()
    assert tip._column_under(event) == "Player"
    tree.column = "#3"
    assert tip._column_under(event) == "Team"
    tree.column = "#9"                      # past the end: no column, not a crash
    assert tip._column_under(event) is None
    tree.region = "cell"                    # over the body, not the header
    assert tip._column_under(event) is None


def test_auction_selectors_are_locked_while_the_engine_runs():
    """A run owns the selection it started with: changing platform or game mid-run would leave the
    worker computing one thing while the panel claims another. Real widgets, because the invariant is
    about widget state - skipped where Tk cannot open a display."""
    import tkinter as tk

    import pytest

    from euroleghe_ingest import gui

    try:
        root = tk.Tk()
    except tk.TclError as exc:                    # headless CI: nothing to assert about widgets
        pytest.skip(f"no Tk display: {exc}")
    try:
        root.withdraw()
        view = gui.AuctionView(root, Config())
        assert view._selectors, "the selectors must be collected for _busy to lock them"
        # str(): ttk returns a Tcl object from cget, which never equals a Python string
        assert all(str(s.cget("state")) == "readonly" for s in view._selectors)

        view._busy(True)
        assert all(str(s.cget("state")) == "disabled" for s in view._selectors)
        assert view.spinner.winfo_manager(), "the spinner should be visible while busy"

        view._busy(False)
        assert all(str(s.cget("state")) == "readonly" for s in view._selectors)
        assert not view.spinner.winfo_manager(), "the spinner should be gone when idle"
    finally:
        root.destroy()
