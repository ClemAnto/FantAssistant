"""Scaffold smoke test: schema applies, CLI builds, validate on an empty DB."""

from __future__ import annotations

import inspect

import pytest

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


def test_a_summary_symbol_does_not_fail_a_run_on_a_narrow_console(capsys, monkeypatch):
    """The ⚑ of the departures line cost two snapshot runs their `ok` on 06/08/2026: the sheets were
    written, the console was cp1252, and `ingest_runs` recorded UnicodeEncodeError. Reproduced on the
    stream, not on the print: a cp1252 writer must degrade the symbol, never raise."""
    import io

    from euroleghe_ingest.cli import _console_takes_unicode

    narrow = io.TextIOWrapper(io.BytesIO(), encoding="cp1252", write_through=True)
    monkeypatch.setattr("sys.stdout", narrow)
    with pytest.raises(UnicodeEncodeError):
        narrow.write("⚑ gone")            # what the operator's console did
    _console_takes_unicode()
    narrow.write("⚑ gone")                # ...and does not do any more


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
    # ...and `arrivals` closes the chain: the per-match layer feeds the FM-equivalent, which is the only
    # thing an arrival with no history is priced from - it went stale exactly there (§7-septies-bis).
    assert ToolkitGUI._follow_ups("positions", {"layer": "match"}) == (
        "matchdays", "synth", "arrivals")
    assert ToolkitGUI._follow_ups("recent_form", {}) == ("synth", "arrivals"),         "matches nobody converts and nobody reads are matches fetched for nothing"
    assert ToolkitGUI._follow_ups("positions", {"layer": "season"}) == ()
    # a new listone is a new PERIMETER, so who counts as an arrival changes with it
    assert ToolkitGUI._follow_ups("ratings", {}) == ("matchdays", "arrivals")
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
    # `fetch --plan` is a status report and is now implemented, so it is always runnable - and on an
    # empty machine it is the FIRST thing to run, because it says what to do next.
    assert operation_state("fetch:plan", None, True) == "todo"
    # `bootstrap` is the from-zero acquisition: available with nothing in place, by definition.
    assert operation_state("bootstrap", None, True) == "todo"
    assert operation_state("bootstrap", {"players": 10}, True) == "completed"
    # `export` needs a listone to export, and turns green when a bundle exists on disk.
    assert operation_state("export", None, True) == "unavailable"
    assert operation_state("export", {"rosters": 10}, True) == "todo"
    assert operation_state("export", {"rosters": 10, "_export_bundle": 1}, True) == "completed"

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
    """The columns are the whole point of the view and several are easy to misread - FVM is
    reporting-only, and FM/Pv/VALUE mean predicted on the left and actual on the right. A new column
    must not ship without its explanation."""
    from euroleghe_ingest import gui

    view = gui.AuctionView
    used: set[str] = set()
    for metric, (predicted, actual) in view.COLUMNS.items():
        assert metric in view.METRICS.values(), metric
        for columns, specific in ((predicted, view.PREDICTED_HELP), (actual, view.ACTUAL_HELP)):
            help_texts = {**view.COMMON_HELP, **specific}
            missing = [column for column in columns if not help_texts.get(column)]
            assert not missing, (metric, missing)
            used.update(columns)
    # The LIVE list's columns are a SUBSET of the predicted ones - which is what keeps every one of them
    # explained, and what stops an outcome column from appearing on a list that has no outcome.
    for metric, columns in view.LIVE_COLUMNS.items():
        assert metric in view.METRICS.values(), metric
        extra = set(columns) - set(view.COLUMNS[metric][0])
        assert not extra, (metric, extra)
        assert not [column for column in columns if "real" in column], (metric, columns)
    # ... and nothing explained that no metric actually shows
    explained = set(view.COMMON_HELP) | set(view.PREDICTED_HELP) | set(view.ACTUAL_HELP)
    assert not explained - used, explained - used
    # the two tables disagree about FM/Pv/VALUE/SURPLUS on purpose, and that must stay true
    for column in ("FM", "Pv", "VALUE", "SURPLUS"):
        assert view.PREDICTED_HELP[column] != view.ACTUAL_HELP[column], column


def test_league_setup_has_usable_defaults_and_derives_the_mantra_slots(tmp_path):
    """The replacement level needs to know how many players of each role a league rosters. The group
    totals are league CONFIGURATION, not a fitted parameter, so they ship as a standard 8-team / 3-8-8-6
    setup. What is checked here is the OFFLINE fallback shape; the shipped Mantra shape comes from the
    measured fielding caps (see test_fielding_caps_reproduce_the_module_limits)."""
    from euroleghe_ingest.config import Config
    from euroleghe_ingest.sources import CLASSIC_ROLES, MANTRA_BY_CLASSIC, MANTRA_ROLES

    # Pointed at a path that does not exist ON PURPOSE: this asserts the built-in FALLBACK, and reading
    # the repository's own `league_config.json` made it assert the OPERATOR'S league instead - so it broke
    # the moment he declared his (12 teams, euro/mantra) from the panel, which is a supported thing to do.
    # A test whose fixture is a user-editable file is testing the user.
    setup = Config(league_config_path=tmp_path / "absent.json").load_league()
    assert setup["teams"] == 8
    assert setup["squad_slots"] == {"P": 3, "D": 8, "C": 8, "A": 6}
    assert sum(setup["squad_slots"].values()) == 25          # the fantacalcio.it squad
    assert set(MANTRA_BY_CLASSIC) == set(CLASSIC_ROLES)
    assert sorted(role for roles in MANTRA_BY_CLASSIC.values() for role in roles) == sorted(
        MANTRA_ROLES)                                        # every Mantra role belongs somewhere

    assert Config(league_config_path=tmp_path / "absent.json").roster_slots("classic")         == setup["squad_slots"]
    mantra = Config().roster_slots("mantra")
    assert set(mantra) == set(MANTRA_ROLES)
    # 8 Classic slots over 4 defensive roles -> 2 each; 8 over 3 midfield roles -> 3 each (rounded up)
    assert (mantra["por"], mantra["dc"], mantra["c"], mantra["pc"]) == (3, 2, 3, 2)
    assert min(mantra.values()) >= 1                         # no role can be rostered zero deep


def test_a_missing_league_config_still_yields_a_usable_setup(tmp_path):
    """A panel that refuses to open because a config file is absent is worse than one using 8 teams."""
    from euroleghe_ingest.config import Config

    cfg = Config(league_config_path=tmp_path / "not-there.json")
    assert cfg.load_league()["teams"] == 8
    assert cfg.roster_slots("mantra")["pc"] == 2
    (tmp_path / "broken.json").write_text("{not json", encoding="utf-8")
    assert Config(league_config_path=tmp_path / "broken.json").load_league()["teams"] == 8


def _league_file(path, payload: dict):
    import json

    path.write_text(json.dumps(payload), encoding="utf-8")
    from euroleghe_ingest.config import Config

    return Config(league_config_path=path)


def test_a_played_league_states_its_platform_its_game_and_its_squad(tmp_path):
    """The three things that make a sheet computable belong to a named league, not to the run.

    Platform decides which matches count, game the roles and the currency, teams x squad_slots the
    replacement level - so a sheet built for the wrong one is a wrong sort order with nothing on screen
    to show it. Hence: inheritance from the file's own defaults (a league that rosters like the others
    only names its two dimensions), and a HARD failure on a name that is not declared.
    """
    import pytest

    cfg = _league_file(tmp_path / "leagues.json", {
        "teams": 8, "squad_slots": {"P": 3, "D": 8, "C": 8, "A": 6},
        "my_leagues": {
            "Amici": {"platform": "euro", "game": "mantra"},
            "Ufficio": {"platform": "default", "game": "classic", "teams": 12,
                        "squad_slots": {"D": 9}},
            "_note": ["documentation, not a league"],
        },
    })
    leagues = cfg.my_leagues()
    assert list(leagues) == ["Amici", "Ufficio"]        # the `_note` key is not a league
    assert (leagues["Amici"]["platform"], leagues["Amici"]["game"]) == ("euro", "mantra")
    assert leagues["Amici"]["teams"] == 8               # inherited
    assert leagues["Ufficio"]["teams"] == 12            # overridden
    # A partial squad_slots override keeps the roles it does not mention, instead of defaulting them
    assert leagues["Ufficio"]["squad_slots"] == {"P": 3, "D": 9, "C": 8, "A": 6}
    assert cfg.roster_slots("classic", "Ufficio")["D"] == 9

    assert cfg.load_league()["name"] == "Amici"         # no argument = the first declared
    assert cfg.load_league("Ufficio")["teams"] == 12
    assert cfg.load_league(platform="default", game="classic")["name"] == "Ufficio"
    with pytest.raises(RuntimeError, match="unknown league"):
        cfg.load_league("Ufficio ")                     # a typo must not silently pick another league

    # A combination nobody plays is still readable - the gate sweeps all four - but it is not a league,
    # and it says so rather than borrowing a name.
    other = cfg.load_league(platform="euro", game="classic")
    assert other["declared"] is False
    assert other["name"] == ""


def test_a_config_without_my_leagues_reads_as_one_league(tmp_path):
    """The shape the file had before leagues had names has to keep working: one unnamed setup, which is
    exactly one league. Nothing that used to run needs the new key."""
    cfg = _league_file(tmp_path / "legacy.json", {"teams": 10, "squad_slots": {"A": 7}})

    leagues = cfg.my_leagues()
    assert list(leagues) == ["default"]
    assert leagues["default"]["teams"] == 10
    assert leagues["default"]["squad_slots"]["A"] == 7
    assert cfg.load_league()["teams"] == 10


def test_saving_leagues_keeps_the_comments_and_writes_only_the_overrides(tmp_path):
    """league_config.json is a hand-edited document whose `_note` blocks are part of the knowledge base:
    the editor replaces one key, it does not regenerate the file. And a value equal to the file's own
    default stays inherited rather than being copied into every league."""
    import json

    path = tmp_path / "leagues.json"
    cfg = _league_file(path, {
        "_comment": ["why the replacement level is what it is"],
        "teams": 8, "squad_slots": {"P": 3, "D": 8, "C": 8, "A": 6},
        "reliability_exponent": 0.5,
        "_mantra_note": ["measured, not transcribed"],
        "my_leagues": {"Old": {"platform": "euro", "game": "classic"}},
    })
    cfg.save_leagues({
        "Amici": {"platform": "euro", "game": "mantra", "teams": 8,
                  "squad_slots": {"P": 3, "D": 8, "C": 8, "A": 6}},
        "Ufficio": {"platform": "default", "game": "classic", "teams": 12,
                    "squad_slots": {"P": 3, "D": 9, "C": 8, "A": 6}},
    })

    written = json.loads(path.read_text(encoding="utf-8"))
    assert written["_comment"] == ["why the replacement level is what it is"]
    assert written["_mantra_note"] == ["measured, not transcribed"]
    assert written["teams"] == 8 and written["reliability_exponent"] == 0.5
    assert written["my_leagues"]["Amici"] == {"platform": "euro", "game": "mantra"}
    assert written["my_leagues"]["Ufficio"]["teams"] == 12
    assert written["my_leagues"]["Ufficio"]["squad_slots"]["D"] == 9
    assert "Old" not in written["my_leagues"]
    assert cfg.load_league("Ufficio")["squad_slots"]["D"] == 9


def test_the_panel_s_surplus_key_is_the_one_the_engine_understands():
    """The panel names the metric without importing the engine, so the two constants can drift apart
    into a silently wrong sort key. They are pinned here instead."""
    from euroleghe_ingest import gui
    from euroleghe_ingest.engine import evaluate

    assert gui.SURPLUS == evaluate.SURPLUS
    assert gui.SURPLUS_PRESSURE == evaluate.SURPLUS_PRESSURE
    # SURPLUS_PRESSURE is pinned but NOT offered: its declared validation failed on the bust rate
    # (metrica doc §11 Esito) and the option ships OFF - re-offering it is an out-loud decision.
    assert set(gui.AuctionView.METRICS.values()) == {"value", evaluate.SURPLUS}
    # SURPLUS leads: the panel opens on the currency an auction actually asks about. VALUE stays
    # available because seeing both is how you understand why a name moved.
    assert next(iter(gui.AuctionView.METRICS.values())) == evaluate.SURPLUS


def test_the_reliability_discount_is_a_preference_the_league_states():
    """It encodes risk aversion, not accuracy, so no backtest can pick it - but it must ship set to
    something usable, and it must never come out negative (that would pay a bonus for absence)."""
    from euroleghe_ingest.config import DEFAULT_RELIABILITY, Config

    assert Config().load_league()["reliability_exponent"] == DEFAULT_RELIABILITY >= 0


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


def _write_sheet(reports, name: str, manifest: dict, clubs=("Inter", "Milan")):
    """A minimal snapshot folder on disk: the three files the panel reads."""
    import csv
    import json

    from euroleghe_ingest.modules.snapshot import PLAYER_COLUMNS

    folder = reports / name
    folder.mkdir(parents=True)
    with open(folder / "players.csv", "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=PLAYER_COLUMNS)
        writer.writeheader()
        for index, club in enumerate(clubs):
            writer.writerow({"fc_id": str(index + 1), "name": f"Player {index}", "club": club,
                             "role_classic": "D"})
    with open(folder / "clubs.csv", "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["club"])
        writer.writeheader()
        writer.writerows([{"club": club} for club in clubs])
    (folder / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return folder


def test_the_snapshot_bar_groups_sheets_by_the_league_they_were_built_for(tmp_path):
    """The bar has two axes and the first one is the LEAGUE, because that is what the surplus column is
    measured against. Three cases in one panel: a sheet that records its league, one written before the
    manifest carried one (filed under the league played on its platform and game - its numbers came from
    the same setup, so this is correct rather than a guess), and a combination nobody plays, which stays
    reachable and is labelled as not a league. Real widgets: the grouping IS the selector's contents."""
    import tkinter as tk

    import pytest

    from euroleghe_ingest import gui

    reports = tmp_path / "reports"
    _write_sheet(reports, "auction-snapshot-2026-27-euro-classic-amici-2026-07-29",
                 {"platform": "euro", "game": "classic", "target_season": "2026-27",
                  "auction_date": "2026-07-29", "generated_at": "2026-07-29T10:00:00+00:00",
                  "players": 2, "clubs": 2,
                  "league": {"name": "Amici", "declared": True, "teams": 8,
                             "squad_slots": {"P": 3, "D": 8, "C": 8, "A": 6}}})
    _write_sheet(reports, "auction-snapshot-2026-27-euro-classic-2026-07-28",
                 {"platform": "euro", "game": "classic", "target_season": "2026-27",
                  "auction_date": "2026-07-28", "generated_at": "2026-07-28T10:00:00+00:00",
                  "players": 2, "clubs": 2})
    _write_sheet(reports, "auction-snapshot-2026-27-euro-mantra-2026-07-27",
                 {"platform": "euro", "game": "mantra", "target_season": "2026-27",
                  "auction_date": "2026-07-27", "generated_at": "2026-07-27T10:00:00+00:00",
                  "players": 2, "clubs": 2})
    cfg = _league_file(tmp_path / "leagues.json",
                       {"teams": 8, "squad_slots": {"P": 3, "D": 8, "C": 8, "A": 6},
                        "my_leagues": {"Amici": {"platform": "euro", "game": "classic"}}})
    cfg = type(cfg)(data_dir=tmp_path, league_config_path=tmp_path / "leagues.json")

    try:
        root = tk.Tk()
    except tk.TclError as exc:                    # headless CI: nothing to assert about widgets
        pytest.skip(f"no Tk display: {exc}")
    built: list = []
    try:
        root.withdraw()
        view = gui.SnapshotView(root, cfg, on_build=built.append)
        view.reload()

        assert list(view.league_cb["values"]) == [
            "Amici", "euro/mantra (not a league)", gui.SnapshotView.MANAGE]
        # Two sheets under the league: the one that records it, and the pre-league one on the same
        # platform and game. The undeclared combination is a group of its own.
        view.league_var.set("Amici")
        view._on_league_change()
        assert len(view.when_cb["values"]) == 2
        assert "(latest)" in view.when_var.get() and "29/07/2026" in view.when_var.get()
        # ...and the sheet's own name states its PLATFORM and GAME (the operator's request): a declared
        # league fixes both, so the League selector shows neither, and the same league's name over a
        # euro/classic sheet and a euro/mantra one would read as the same thing.
        assert "euro/classic" in view.when_var.get(), view.when_var.get()
        assert "does not state its league" not in view.note_var.get()
        view.when_var.set(list(view.when_cb["values"])[1])
        view._on_when_change()
        assert "does not state its league" in view.note_var.get()

        # Build takes the LEAGUE BY NAME, so the run cannot be handed another league's squad size...
        view.league_var.set("Amici")
        view._on_league_change()
        view._build_now()
        assert built == [{"league": "Amici", "refresh": True}]
        # ...while an undeclared group has no name to pass and its two dimensions go straight through.
        view.league_var.set("euro/mantra (not a league)")
        view._on_league_change()
        view._build_now()
        assert built[-1] == {"platform": "euro", "game": "mantra", "refresh": True}
    finally:
        root.destroy()


def test_deleting_a_sheet_refuses_anything_that_is_not_one(tmp_path, monkeypatch):
    """Delete removes a TREE, so the target is checked against data/reports and the folder prefix
    rather than trusted: a stale selection must never turn into an rmtree somewhere else."""
    import tkinter as tk

    import pytest

    from euroleghe_ingest import gui

    reports = tmp_path / "reports"
    folder = _write_sheet(reports, "auction-snapshot-2026-27-euro-classic-2026-07-29",
                          {"platform": "euro", "game": "classic", "auction_date": "2026-07-29",
                           "generated_at": "2026-07-29T10:00:00+00:00", "players": 2, "clubs": 2})
    elsewhere = tmp_path / "precious"
    elsewhere.mkdir()
    (elsewhere / "keep.txt").write_text("do not delete me", encoding="utf-8")
    cfg = Config(data_dir=tmp_path, db_path=tmp_path / "none.db",
                 league_config_path=tmp_path / "none.json")

    try:
        root = tk.Tk()
    except tk.TclError as exc:
        pytest.skip(f"no Tk display: {exc}")
    refusals: list = []
    monkeypatch.setattr(gui.messagebox, "showerror",
                        lambda title, message, **_k: refusals.append(message))
    monkeypatch.setattr(gui.messagebox, "askyesno", lambda *_a, **_k: True)
    try:
        root.withdraw()
        view = gui.SnapshotView(root, cfg)
        view.reload()

        # A sheet outside data/reports is refused, and nothing is removed
        view.sheets[0]["path"] = view._when_paths[0] = elsewhere
        view._delete_selected()
        assert refusals, "deleting outside data/reports must be refused out loud"
        assert elsewhere.exists() and (elsewhere / "keep.txt").exists()

        # The real one goes, once confirmed
        view.sheets[0]["path"] = view._when_paths[0] = folder
        view._delete_selected()
        assert not folder.exists()
    finally:
        root.destroy()


def test_the_plate_stacks_its_rivals_by_titolarita_and_counts_the_rest(monkeypatch):
    """One rival per LINE, likeliest first, each with his own percentage - a duel is read as a ranking,
    and a ranking needs the number next to the name. Two at most, because the plate has to fit between
    two drawn lines; whoever is left over is COUNTED (`+N`) and named in the shirt's tooltip, never
    dropped in silence."""
    from euroleghe_ingest import gui

    view = gui.SnapshotView.__new__(gui.SnapshotView)
    view.clubs, view.players = {}, []
    monkeypatch.setattr(gui.SnapshotView, "presence",
                        lambda _self, row, _horizon: row.get("share", 0.0))
    monkeypatch.setattr(gui.SnapshotView, "claim",
                        lambda _self, row, _horizon="season": row.get("share", 0.0))
    view.xi_mode = type("V", (), {"get": staticmethod(lambda: "typical")})()
    starter = {"name": "Saliba", "share": 0.45}
    rivals = [{"name": "Mosquera", "share": 0.14}, {"name": "Calafiori", "share": 0.20},
              {"name": "Lewis-Skelly", "share": 0.10}]

    lines = view.plate_lines(starter, rivals, 18, 20)
    # the likeliest rival first, not the order the eleven happened to build
    assert lines == ["Saliba 45%", "vs Calafiori 20%", "   Mosquera 14% +1"]
    # one rival, no count; none, no line at all
    assert view.plate_lines(starter, rivals[:1], 18, 20) == ["Saliba 45%", "vs Mosquera 14%"]
    assert view.plate_lines(starter, [], 18, 20) == ["Saliba 45%"]
    # a lane with room for one rival only still says how many there are
    assert view.plate_lines(starter, rivals, 18, 20, max_rivals=1) == [
        "Saliba 45%", "vs Calafiori 20% +2"]
    # On a narrow plate the count goes first and the NAME is cut, because the percentage is what makes
    # the stack a ranking. Nothing is ever floored past the budget - that is how a line ends up drawn on
    # the neighbouring shirt (measured: 0 of 1687 drawn lines overflow).
    assert view.plate_lines(starter, rivals, 12, 12) == ["Saliba 45%", "vs Calaf 20%", "   Mosqu 14%"]
    for budget in range(8, 30):
        for line in view.plate_lines(starter, rivals, budget, budget):
            assert len(line) <= budget, (budget, line)


def _shape_view(monkeypatch, elevens: dict[str, float]):
    """A view whose eleven for each shape is worth the given number of matchdays."""
    from euroleghe_ingest import gui

    view = gui.SnapshotView.__new__(gui.SnapshotView)
    view._shape_cache, view._shape_choice, view.manifest = {}, {}, {}
    monkeypatch.setattr(gui.SnapshotView, "eleven",
                        lambda _s, _club, shape, _mode: [("M", {"share": elevens.get(shape, 0.0)}, [])])
    monkeypatch.setattr(gui.SnapshotView, "presence",
                        lambda _self, row, _horizon: row.get("share", 0.0))
    monkeypatch.setattr(gui.SnapshotView, "claim",
                        lambda _self, row, _horizon="season": row.get("share", 0.0))
    return view


def test_how_likely_each_shape_is_blends_the_club_the_league_and_the_squad(monkeypatch):
    """One number per shape, and the three things it comes from have to pull in the right directions.

    A settled habit whose squad mans it must come out near certain; a habit that belongs to the PREVIOUS
    coach must not dominate, because it describes a side that no longer exists; a shape the club has never
    played is possible - a coach can try one - but only as much as the league plays it; and a shape whose
    slots force a 5% squad player onto the pitch loses whatever its history says.
    """
    repertoire = {"formation_repertoire": {"4-5-1": 1746, "3-4-3": 1054, "3-5-2": 631,
                                           "4-3-3": 587, "4-4-2": 498, "3-6-1": 12, "4-2-4": 2}}

    # Inter: 42 of 44 elevens, every one of them its coach's, and the squad fields it best
    settled = {"formation_typical": "3-5-2", "formation_typical_of": "44",
               "formation_typical_under_coach": "44", "formation_shapes": "3-5-2:42;3-4-3:2"}
    view = _shape_view(monkeypatch, {"3-5-2": 6.10, "3-4-3": 5.60, "4-5-1": 6.00, "4-3-3": 5.40,
                                     "4-4-2": 6.10})
    view.manifest = repertoire
    odds = view.shape_odds("Inter", settled, "typical")
    assert next(iter(odds)) == "3-5-2" and odds["3-5-2"] > 0.85
    assert abs(sum(odds.values()) - 1.0) < 1e-9
    # a module nobody in the league plays is not even in the list: 2 elevens of 4812 is a parsing tail
    assert "4-2-4" not in odds and "3-6-1" not in odds

    # Napoli: the 3-4-3 is 27 of 38 elevens but NONE of them the current coach's, and it fields half a
    # matchday less than the 4-5-1 - so the habit does not win, and it does not collapse either
    predecessor = {"formation_typical": "3-4-3", "formation_typical_of": "38",
                   "formation_typical_under_coach": "0",
                   "formation_shapes": "3-4-3:27;4-5-1:8;4-3-3:3"}
    view = _shape_view(monkeypatch, {"3-4-3": 6.41, "4-5-1": 6.86, "4-3-3": 6.72, "3-5-2": 6.86,
                                     "4-4-2": 6.86, "5-3-2": 6.70, "5-4-1": 6.80})
    view.manifest = repertoire
    odds = view.shape_odds("Napoli", predecessor, "typical")
    assert next(iter(odds)) == "4-5-1"
    assert 0.20 < odds["3-4-3"] < 0.40, "the predecessor's habit is discounted, not deleted"
    assert odds["4-4-2"] > 0.0, "never fielded here, but the league plays it: possible"
    assert odds["4-4-2"] < odds["4-3-3"], "...and less likely than one this side has actually used"
    assert view.board_shape("Napoli", predecessor, "typical")[0] == "4-5-1"

    # the SQUAD has the last word: the same history with an eleven two matchdays weaker loses
    view = _shape_view(monkeypatch, {"3-4-3": 4.00, "4-5-1": 6.86, "4-3-3": 6.72})
    view.manifest = repertoire
    assert view.shape_odds("Napoli", predecessor, "typical")["3-4-3"] < 0.05

    # ...and the COACH's own history is the fourth source, in the LEAGUE's place and not the club's.
    # Measured on Atalanta: the club's 3-4-3 rests on 46 elevens, none of them Sarri's, while Sarri arrives
    # with 188 of his own and a 4-3-3 in 86% of them - and the sources' prediction for the new season is a
    # 4-3-3. What must NOT happen is the same thing off two elevens: Gattuso's 3-3-4 (n=2) cannot overturn
    # a club habit that the sources agree with, which is why the sample has a floor and a ramp.
    view = _shape_view(monkeypatch, {"3-4-3": 6.41, "4-5-1": 6.60, "4-3-3": 6.50, "3-5-2": 6.40,
                                     "4-4-2": 6.40})
    view.manifest = repertoire
    sarri = {**predecessor, "formation_typical_of": "46", "formation_shapes": "3-4-3:43;4-4-2:2;4-3-3:1",
             "coach_shapes": "4-3-3:162;4-4-2:20;4-5-1:4", "coach_shapes_of": "188"}
    odds = view.shape_odds("Atalanta", sarri, "typical")
    assert next(iter(odds)) == "4-3-3", odds
    assert odds["3-4-3"] > 0.20, "the club's habit is discounted by the man, not deleted"
    assert view.board_shape("Atalanta", sarri, "typical")[0] == "4-3-3"
    # his own history also makes a shape REACHABLE that neither the club nor the league floor offers
    narrow = {**sarri, "coach_shapes": "5-3-2:180;4-3-3:8", "coach_shapes_of": "188"}
    assert "5-3-2" in view.shape_odds("Atalanta", narrow, "typical")
    # below the floor it says nothing at all: two elevens are not a habit
    noise = {**predecessor, "coach_shapes": "3-3-4:1;4-3-3:1", "coach_shapes_of": "2"}
    assert view.shape_odds("Napoli", noise, "typical") == view.shape_odds("Napoli", predecessor, "typical")
    # and between floor and full the pull is partial, never a cliff. The SAME shares over a growing
    # sample, so what moves is only how much the sample is worth.
    def his(sample):
        info = {**predecessor,
                "coach_shapes": f"4-3-3:{round(sample * 0.86)};4-4-2:{round(sample * 0.11)}",
                "coach_shapes_of": str(sample)}
        return view.shape_odds("Atalanta", info, "typical")["4-3-3"]

    floor, full = type(view).COACH_SHAPE_MIN, type(view).COACH_SHAPE_FULL
    ramp = [his(floor - 1), his((floor + full) // 2), his(full), his(full * 3)]
    assert ramp[0] < ramp[1] < ramp[2], f"the pull has to grow with the sample: {ramp}"
    assert abs(ramp[2] - ramp[3]) < 0.005, "...and stop growing once the sample is full"

    # For the coming match the coach has DECLARED a shape: it is the answer, at 100%
    view = _shape_view(monkeypatch, {"3-5-2": 1.0, "4-3-3": 9.0})
    view.manifest = repertoire
    assert view.shape_odds("Napoli", {**predecessor, "formation_today": "3-5-2"}, "next") == {"3-5-2": 1.0}

    # ...and the OPERATOR outranks the board, with the odds of what he chose stated
    view = _shape_view(monkeypatch, {"3-4-3": 6.41, "4-5-1": 6.86, "4-3-3": 6.72})
    view.manifest = repertoire
    view._shape_choice[("Napoli", "typical")] = "4-3-3"
    shape, why = view.board_shape("Napoli", predecessor, "typical")
    assert shape == "4-3-3" and "your choice" in why and "%" in why
    # a shape nobody plays cannot be forced in through the back door
    view._shape_choice[("Napoli", "typical")] = "4-2-4"
    assert view.board_shape("Napoli", predecessor, "typical")[0] == "4-5-1"
def test_the_shape_selector_offers_what_the_club_played_and_locks_on_a_declared_XI(tmp_path):
    """Every module the club actually lined up in, with how many of its elevens used it and what the side
    it fields adds up to - the numbers are the point, otherwise the choice is a guess between labels. And
    it is LOCKED for the coming match when the probabili name a shape: that is the coach's own answer."""
    import tkinter as tk

    import pytest

    from euroleghe_ingest import gui

    try:
        root = tk.Tk()
    except tk.TclError as exc:
        pytest.skip(f"no Tk display: {exc}")
    try:
        root.withdraw()
        view = gui.SnapshotView(root, Config(data_dir=tmp_path, db_path=tmp_path / "none.db",
                                             league_config_path=tmp_path / "none.json"))
        info = {"formation_typical": "3-4-3", "formation_shapes": "3-4-3:27;4-5-1:8;4-3-3:3",
                "formation_typical_of": "38", "formation_typical_under_coach": "0"}
        view.players = [{"name": "A", "club": "Napoli", "desc_real_roles": "GK", "role_classic": "P"}]
        view.clubs = {"Napoli": info}

        view._fill_shapes("Napoli", info, "4-5-1")
        labels = list(view.shape_cb["values"])
        assert [view._shape_labels[label] for label in labels] == ["3-4-3", "4-5-1", "4-3-3"]
        # ONE number per shape: how likely this side is to line up in it (27 of 38 elevens here)
        assert labels[0] == "3-4-3 · 71%"
        assert view._shape_labels[view.shape_var.get()] == "4-5-1", "opens on what the board drew"
        assert str(view.shape_cb.cget("state")) == "readonly"

        view.xi_mode.set("next")
        view._fill_shapes("Napoli", {**info, "formation_today": "3-5-2"}, "3-5-2")
        assert str(view.shape_cb.cget("state")) == "disabled"
        assert view.shape_var.get() == "3-5-2"
    finally:
        root.destroy()


def test_a_line_considers_every_real_role_a_man_plays_not_just_his_first(monkeypatch):
    """Spinazzola is 'ML;DL'. Bucketed by his first code alone he only ever competed with central
    midfielders, lost to them at 54%, and Napoli's left back became a 38% man while the 54% one sat
    outside the eleven - twice over, because the LINE-distance term of `slot_cost` also read the primary
    code only and charged him seven steps for a defensive slot."""
    from euroleghe_ingest import gui

    view = gui.SnapshotView.__new__(gui.SnapshotView)
    view.clubs, view.players = {}, []
    squad = [
        {"name": "Meret", "desc_real_roles": "GK", "role_classic": "P", "share": 0.68},
        {"name": "Di Lorenzo", "desc_real_roles": "DR; DC", "role_classic": "D", "share": 0.62},
        {"name": "Buongiorno", "desc_real_roles": "DC; DL", "role_classic": "D", "share": 0.70},
        {"name": "Juan Jesus", "desc_real_roles": "DC", "role_classic": "D", "share": 0.47},
        {"name": "Spinazzola", "desc_real_roles": "ML; DL", "role_classic": "D", "share": 0.54},
        {"name": "Gutierrez", "desc_real_roles": "DL; ML", "role_classic": "D", "share": 0.38},
        {"name": "McTominay", "desc_real_roles": "MC; AM", "role_classic": "C", "share": 0.79},
        {"name": "Lobotka", "desc_real_roles": "MC; DM", "role_classic": "C", "share": 0.72},
        {"name": "Elmas", "desc_real_roles": "MC; AM", "role_classic": "C", "share": 0.52},
        {"name": "Politano", "desc_real_roles": "RW; MR", "role_classic": "C", "share": 0.66},
        {"name": "Hojlund", "desc_real_roles": "ST", "role_classic": "A", "share": 0.80},
        {"name": "Santos A.", "desc_real_roles": "LW", "role_classic": "C", "share": 0.24},
    ]
    monkeypatch.setattr(gui.SnapshotView, "squad", lambda _s, _club: squad)
    monkeypatch.setattr(gui.SnapshotView, "presence",
                        lambda _self, row, _horizon: row.get("share", 0.0))
    monkeypatch.setattr(gui.SnapshotView, "claim",
                        lambda _self, row, _horizon="season": row.get("share", 0.0))
    monkeypatch.setattr(gui.SnapshotView, "titolarita",
                        lambda _self, row, _horizon: (0.0, row.get("share", 0.0)))

    eleven = view.eleven("Napoli", "4-3-3", "typical")
    picked = {starter["name"] for _role, starter, _rivals in eleven}
    assert "Spinazzola" in picked, "the 54% left back must be in the eleven"
    assert "Gutierrez" not in picked, "not instead of him at 38%"
    # and he is drawn where he was chosen, not where his first code says
    lanes, _geometry, drawn = view.lanes_for(eleven)
    assert "Spinazzola" in {row["name"] for row, _rivals in lanes["D"]}
    assert drawn == "4-3-3"


def test_a_top_player_has_to_pass_every_test_at_once(monkeypatch):
    """At most three per club, and it is a CONJUNCTION: a huge surplus does not buy a place for a man who
    is on the pitch twenty minutes, and a certainty worth nothing is not a top player either.

    The minutes are read PER MATCH and only on LEAGUE matches, which is what makes them comparable: an
    average of 60 minutes is the same number for a man who plays every match to the 70th and for one who
    alternates 90 with 20. It was also the way round the OTHER defect this criterion uncovered - the
    club's fixture list as the denominator of a titolarità, which had Kane at 49% for playing nearly
    everything (25 of 34 Bundesliga rounds over Bayern's 50 fixtures). That one is fixed at the source
    now: `club_matches` counts the championship. Both readings survive, and they answer different
    questions - minutes per match is about how long he stays on.
    """
    from euroleghe_ingest import gui

    view = gui.SnapshotView.__new__(gui.SnapshotView)
    view._top_cache, view._surplus_cut, view._shape_cache, view._shape_choice = {}, None, {}, {}
    view.clubs = {"Napoli": {}}

    def detail(minutes, competition="serie_a"):
        """A trend detail: date|competition|opponent|side|token|minutes|rating|goals|assists|started."""
        return ";".join(f"2026-05-{index + 1:02d}|{competition}|X|H|p|{value}|6.5|0|0|1"
                        for index, value in enumerate(minutes))

    def player(name, share, surplus, minutes, **extra):
        return {"name": name, "share": share, "engine_surplus": str(surplus),
                "desc_form_detail": detail(minutes), **extra}

    ace = player("McTominay", 0.79, 9.0, [90, 90, 90, 90, 90, 90])
    striker = player("Hojlund", 0.80, 5.9, [90, 66, 90, 90, 90, 90])       # 5 of 6 whole: enough
    cameos = player("Elmas", 0.52, 8.0, [11, 12, 45, 15, 90, 14])          # huge surplus, 20 minutes
    cheap = player("Juan Jesus", 0.75, 1.0, [90, 90, 90, 90])              # whole matches, worth nothing
    duelled = player("Buongiorno", 0.78, 7.0, [90, 90, 90, 90])            # a rival on his shoulder
    hurt = player("Politano", 0.78, 7.0, [90, 90, 90, 90], desc_injury_open="knee")
    # 90 minutes every time, but in the CUP: not what the fantamedia is scored on
    cupped = player("Gilmour", 0.78, 7.0, [])
    cupped["desc_form_detail"] = detail([90, 90, 90, 90, 90], competition="coppa-italia")
    deputy = player("Beukema", 0.60, 4.0, [80, 80])
    eleven = [("M", ace, []), ("A", striker, []), ("M", cameos, []), ("D", cheap, []),
              ("D", duelled, [deputy]), ("A", hurt, []), ("M", cupped, [])]
    view.players = [row for _role, row, _rivals in eleven]
    monkeypatch.setattr(gui.SnapshotView, "presence",
                        lambda _self, row, _horizon: row.get("share", 0.0))
    monkeypatch.setattr(gui.SnapshotView, "claim",
                        lambda _self, row, _horizon="season": row.get("share", 0.0))
    monkeypatch.setattr(gui.SnapshotView, "board_shape",
                        lambda _self, _club, _info, _mode: ("4-3-3", ""))
    monkeypatch.setattr(gui.SnapshotView, "eleven",
                        lambda _self, _club, _shape, _mode: eleven)
    # the bar is the SHEET's own p90 of surplus - 5.5 on the 2026-27 euro sheet. Fixed here, because six
    # players are not a distribution: what this test is about is the conjunction, not the percentile.
    assert view._surplus_floor() == 9.0, "the percentile is read off the sheet it is given"
    monkeypatch.setattr(gui.SnapshotView, "_surplus_floor", lambda _self: 5.5)

    top = view.top_players("Napoli", "typical")
    assert top == ["McTominay", "Hojlund"], top      # best surplus first
    assert "Elmas" not in top, "eight points of surplus do not buy twenty minutes a match"
    assert "Juan Jesus" not in top, "he plays them whole and is worth nothing"
    assert "Buongiorno" not in top, "a challenger at 60% of his titolarita is a real duel"
    assert "Politano" not in top, "an open injury is not one of the positive values"
    assert "Gilmour" not in top, "90 minutes in the CUP is not what the fantamedia is scored on"
    assert len(view.top_players("Napoli", "typical")) <= gui.SnapshotView.TOP_PLAYERS
    # the criterion itself: per match, league only
    assert view.full_match_share(ace) == (1.0, 6)
    assert view.full_match_share(cameos)[0] < 0.2
    assert view.full_match_share(cupped) == (0.0, 0), "no league match in the window at all"


def test_how_many_rivals_a_plate_may_name_follows_from_the_room_between_the_lines():
    """Derived from the plate's own geometry, not tuned to today's data: two plates may face each other
    across the gap between two drawn lines, so each owns half of it. Measured consequence - a shape with
    four lines names two rivals, one with five (a trequartisti lane) names one and counts the rest."""
    from euroleghe_ingest.gui import SnapshotView as View

    assert View.plate_rivals_for(140) == View.PLATE_RIVALS      # roomy: the full two
    assert View.plate_rivals_for(125) == 2                      # a four-line shape on a 478px pitch
    assert View.plate_rivals_for(94) == 1                       # a five-line one
    assert View.plate_rivals_for(40) == 1                       # never zero: a challenger must show
    # and the promise itself: a plate of 1 + n rivals fits in half the gap it was allowed for
    for gap in range(40, 200):
        lines = 1 + View.plate_rivals_for(gap)
        high = View.PLATE_PAD_PX + lines * View.PLATE_LINE_PX
        assert View.PLATE_OFFSET_PX + high <= gap / 2 or View.plate_rivals_for(gap) == 1


def _descendants(widget):
    """Every widget under this one, the parent included - for asserting on a dialog's contents."""
    yield widget
    for child in widget.winfo_children():
        yield from _descendants(child)


def test_clicking_a_shirt_accounts_for_every_declared_rival(tmp_path):
    """The plate holds a few characters; the click holds the whole duel - and it must ACCOUNT for the
    men the editors name but the pitch does not offer, or "declared with three" next to two rows reads
    as a contradiction. The commonest reason is the rule itself: a rival is by definition not in the
    eleven, so a third man who is starting his own shirt is not competing for this one."""
    import tkinter as tk
    from tkinter import ttk

    import pytest

    from euroleghe_ingest import gui

    try:
        root = tk.Tk()
    except tk.TclError as exc:
        pytest.skip(f"no Tk display: {exc}")
    try:
        root.withdraw()
        view = gui.SnapshotView(root, Config(data_dir=tmp_path, db_path=tmp_path / "none.db",
                                             league_config_path=tmp_path / "none.json"))
        deroon = {"name": "De Roon", "club": "Atalanta", "desc_real_roles": "MC; DM",
                  "desc_duel_names": "Pasalic; Samardzic; Musah", "desc_duel_rivals": "3"}
        pasalic = {"name": "Pasalic", "club": "Atalanta", "desc_real_roles": "MC; AM"}
        musah = {"name": "Musah", "club": "Atalanta", "desc_real_roles": "MC; DM"}
        samardzic = {"name": "Samardzic", "club": "Atalanta", "desc_real_roles": "AM; MC"}
        lookman = {"name": "Lookman", "club": "Atalanta", "desc_real_roles": "LW"}
        view.players = [deroon, pasalic, musah, samardzic, lookman]
        view.clubs = {"Atalanta": {"club": "Atalanta"}}
        # Samardzic is drawn in the eleven, so he is not competing for De Roon's shirt
        view._hits = [(0.0, 0.0, deroon, [pasalic, musah]), (0.0, 0.0, samardzic, [])]

        view._duel_popup(deroon, [pasalic, musah])
        popup = [child for child in view.winfo_children() if isinstance(child, tk.Toplevel)][-1]
        trees = [w for w in _descendants(popup) if isinstance(w, ttk.Treeview)]
        rows = [tree.item(iid)["values"] for tree in trees for iid in tree.get_children()]
        assert [row[0] for row in rows] == ["Pasalic", "Musah", "Samardzic"]
        assert rows[0][3] == "yes" and rows[1][3] == "yes"      # both named and offered
        assert rows[2][3] == "yes · in the XI"                  # named, not offered, and WHY
        # every declared name is accounted for: nothing is dropped in silence
        assert {row[0] for row in rows} >= set(deroon["desc_duel_names"].replace(";", " ").split())
    finally:
        root.destroy()


def test_the_next_matchday_eleven_is_the_editors_own(monkeypatch):
    """`eleven(..., 'next')` must reach `_declared`. Pinned because it was broken by a NAME COLLISION -
    an attribute holding the declared LEAGUES shadowed the `_declared` METHOD, and every "prossima
    giornata" XI raised TypeError while the "schieramento tipo" one kept working."""
    from euroleghe_ingest import gui

    view = gui.SnapshotView.__new__(gui.SnapshotView)      # no widgets: only the eleven logic is under test
    view.clubs, view.players = {}, []                      # the presence denominator reads both
    view._slot_side, view._excluded, view._lanes_final = {}, set(), False
    # ELEVEN named men, because one name is not a declared side: the board draws the editors' eleven only
    # where they have declared one (Eintracht had a single probability in the sheet and the pitch drew a
    # single man), and below that it falls back to the measured answer.
    squad = [
        {"name": "Meret", "desc_starter_prob": "0.9", "desc_real_roles": "GK", "role_classic": "P"},
        {"name": "Politano", "desc_starter_prob": "0.6", "desc_real_roles": "RW", "role_classic": "C",
         "desc_duel_names": "Neres; Lang"},
        *({"name": f"Titolare{index}", "desc_starter_prob": "0.8",
           "desc_real_roles": codes, "role_classic": role}
          for index, (codes, role) in enumerate((("DR", "D"), ("DC", "D"), ("DC", "D"), ("DL", "D"),
                                                 ("MC", "C"), ("MC", "C"), ("ML", "C"), ("AM", "C"),
                                                 ("ST", "A")))),
        {"name": "Neres", "desc_real_roles": "RW", "role_classic": "C"},
        {"name": "Lang", "desc_real_roles": "RW", "role_classic": "C"},
    ]
    monkeypatch.setattr(gui.SnapshotView, "squad", lambda _self, _club: squad)

    eleven = view.eleven("Napoli", "4-3-3", "next")
    by_name = {starter["name"]: rivals for _role, starter, rivals in eleven}
    assert "Meret" in by_name and "Politano" in by_name     # only the men the editors listed
    assert not {"Neres", "Lang"} & set(by_name), "and nobody they did not"
    assert len(by_name) == 11
    # BOTH named rivals are carried, not just the first: the drawing decides how many fit, not this
    assert [row["name"] for row in by_name["Politano"]] == ["Neres", "Lang"]


def test_last_ten_dot_bands_and_fading():
    """The strip's colour rules, which are a DISPLAY choice and must stay one.

    Nothing downstream fits on these thresholds - a test here is what keeps them from quietly becoming
    a model parameter, and what documents the ring (a full match) against the fade (an absence).
    """
    from euroleghe_ingest.gui import SnapshotView, _blend

    assert SnapshotView.band(9.1) == SnapshotView.BANDS[0][1]        # exceptional
    assert SnapshotView.band(7.4) == SnapshotView.BANDS[1][1]        # very good
    assert SnapshotView.band(6.9) == SnapshotView.BANDS[2][1]        # good
    assert SnapshotView.band(6.4) == SnapshotView.BANDS[3][1]        # average
    assert SnapshotView.band(6.0) == SnapshotView.BANDS[4][1]        # weak
    assert SnapshotView.band(4.5) == SnapshotView.BANDS[5][1]        # poor
    # a played match without a rating must not be coloured as a bad one
    assert SnapshotView.band(None) == SnapshotView.BANDS[3][1]
    # the four absences are four different colours, and all of them faded: a choice, an injury, a
    # suspension and no data at all are four different facts about a blank week
    assert len(set(SnapshotView.ABSENT.values())) == 4
    assert set(SnapshotView.ABSENT) == {"b", "i", "s", "n"}
    faded = _blend("#9e9e9e", "#ffffff", 0.3)
    assert faded != "#9e9e9e" and faded > "#c0c0c0", "an absence must read as lighter than a result"


def test_the_eleven_is_chosen_by_titolarita_and_never_by_a_valuation():
    """The regression that matters: a coach does not pick his side by fantacalcio value.

    The first version ranked the pitch by predicted SURPLUS, which fields the most VALUABLE player
    rather than the one who plays. Here the cheap regular must beat the expensive reserve, in both
    modes - and the two modes must differ on exactly one thing: whether an absence counts.
    """
    from euroleghe_ingest.gui import SnapshotView

    regular = {"name": "Regular", "role_classic": "A", "roles_mantra": "pc",
               "desc_start_share": "0.90", "desc_season_starts": "27",
               "desc_form_measured": "10", "desc_form_starts": "9", "desc_form_minutes": "800",
               "engine_surplus": "1.0"}
    expensive = {"name": "Expensive", "role_classic": "A", "roles_mantra": "pc",
                 "desc_start_share": "0.10", "desc_season_starts": "3",
                 "desc_form_measured": "10", "desc_form_starts": "1", "desc_form_minutes": "90",
                 "engine_surplus": "99.0"}
    injured = {"name": "Injured", "role_classic": "A", "roles_mantra": "pc",
               "desc_start_share": "1.00", "desc_season_starts": "30",
               "desc_form_measured": "10", "desc_form_starts": "10", "desc_form_minutes": "900",
               "engine_surplus": "5.0", "desc_injury_open": "knee since 2026-07-01"}

    view = SnapshotView.__new__(SnapshotView)          # no Tk needed for the selection logic
    view.players = [regular, expensive, injured]
    view.clubs = {}
    view.rows = view.players
    for row in view.players:
        row["club"] = "Test"

    assert view.titolarita(regular, "season")[0] > view.titolarita(expensive, "season")[0]

    # the ATTACK, which is the line these three belong to: a squad of three strikers also has to fill the
    # other seven shirts of a 4-4-2, and it does (an adapted player beats an empty shirt - see
    # `eleven`), so the question here is who gets the two forward ones
    typical = [starter["name"] for role, starter, _rivals in view.eleven("Test", "4-4-2", "typical")
               if role == "A"]
    assert typical == ["Injured", "Regular"], "the schieramento tipo ignores who is out today"
    assert "Expensive" not in typical, "value must not buy a shirt"

    class Mode:
        @staticmethod
        def get():
            return "next"

    view.xi_mode = Mode()
    nxt = [starter["name"] for role, starter, _rivals in view.eleven("Test", "4-4-2", "next")
           if role == "A"]
    assert nxt[0] == "Regular", "for the next match the injured man is out and the regular starts"
    assert SnapshotView.lines("3-4-2-1") == (3, 6, 1), "every part of a module counts"
    assert "Injured" not in nxt


# ----------------------------------------------------------------------------------------------------
# The denominators: every share in the Snapshot panel is a share of the CHAMPIONSHIP's calendar
# ----------------------------------------------------------------------------------------------------
def _sheet_view(clubs: dict, players: list, manifest: dict | None = None):
    """A SnapshotView with a sheet in it and no widgets: only the arithmetic is under test."""
    from euroleghe_ingest import gui

    view = gui.SnapshotView.__new__(gui.SnapshotView)
    view.clubs, view.players, view.rows = clubs, players, players
    view.manifest = manifest or {}
    return view


def test_a_share_of_the_season_is_counted_on_the_championship_and_not_on_every_cup():
    """The numerators are league-only (`external_stats` stores one row per championship and nothing
    else) and the denominator used to be every fixture we parsed - so a club's percentages moved with how
    far it went in Europe. Arsenal 58 elevens against 38 rounds, Bayern 50 against 34, Napoli 38 against
    38: Kane read 49% off 25 starts in 34 Bundesliga rounds, and a European campaign was
    indistinguishable from a bench."""
    european = {"complete_XIs": "58", "league_XIs": "38", "league": "premier_league"}
    domestic = {"complete_XIs": "38", "league_XIs": "38", "league": "serie_a"}

    def man(club):
        return {"name": f"man of {club}", "club": club, "desc_season_starts": "30",
                "desc_season_matches": "34", "desc_minutes_full_season": "2700",
                "desc_injury_source": "transfermarkt (no absence recorded)",
                "desc_injury_rounds_seasons": "3", "desc_injury_rounds_weighted": "0",
                "desc_injury_rounds_measured": "0"}

    view = _sheet_view({"Arsenal": european, "Napoli": domestic},
                       [man("Arsenal"), man("Napoli")])
    assert view.club_matches("Arsenal") == 38, "the championship, not the fixture list"
    assert view.club_fixtures("Arsenal") == 58, "the fixture list is still there: absences count on it"
    arsenal, napoli = view.players
    assert view.presence(arsenal) == view.presence(napoli), \
        "the same season must read the same whatever the cup load"
    assert view.presence(arsenal) > 0.75, "30 starts of 38 rounds is not a 49% man"


def test_a_sheet_written_before_the_league_calendar_existed_still_reads():
    """`league_XIs` is a new column. An older folder has only `complete_XIs`, and the panel must open it
    with the numbers it has rather than dividing by one."""
    view = _sheet_view({"Vecchio": {"complete_XIs": "44"}},
                       [{"name": "x", "club": "Vecchio", "desc_season_starts": "20"}])
    assert view.club_matches("Vecchio") == 44


def test_the_start_rate_leaves_out_the_rounds_he_missed_and_not_the_forecast():
    """Two different questions, and using one number for both makes the injury history decoration: the
    three-season forecast subtracted from the calendar and then multiplied back in by `availability`
    cancels out of `presence` almost exactly. So the rate's denominator is what he ACTUALLY missed inside
    the measured season, and the forecast is only the discount."""
    club = {"complete_XIs": "38", "league_XIs": "38"}
    # 16 rounds missed of 38, and he started all 22 he was there for
    row = {"name": "Rrahmani", "club": "Napoli", "desc_season_starts": "22",
           "desc_season_matches": "22", "desc_minutes_full_season": "1980",
           "desc_injury_source": "transfermarkt", "desc_injury_rounds_seasons": "3",
           "desc_injury_rounds_measured": "16", "desc_injury_rounds_by_season": "9;9;9"}
    view = _sheet_view({"Napoli": club}, [row])
    assert view.contested(row) == 22, "38 rounds less the 16 he was not there for"
    assert view.availability(row) == pytest.approx(1 - 9.0 / 38, abs=0.01), \
        "nine rounds a season, whatever the recency weights make of the three"
    # a man who starts everything he is fit for, discounted only by how much he is expected to miss
    assert view.presence(row) == pytest.approx(view.availability(row), abs=0.02)


def test_availability_counts_rounds_where_it_can_and_scales_the_source_where_it_cannot():
    """Transfermarkt counts a spell over every competition the club played, so its number cannot be
    divided by a championship calendar. Where his club's fixtures are known the rounds are COUNTED;
    where they are not (a club outside the five leagues) the source's number is scaled by the league
    share of what we parsed, and `desc_injury_rounds_seasons` = 0 says which of the two it is."""
    club = {"complete_XIs": "50", "league_XIs": "34"}
    counted = {"name": "counted", "club": "Bayern Monaco", "desc_injury_source": "transfermarkt",
               "desc_injury_rounds_seasons": "3", "desc_injury_rounds_by_season": "2;2;2",
               "desc_injury_weighted": "9.75"}
    scaled = {"name": "scaled", "club": "Bayern Monaco", "desc_injury_source": "transfermarkt",
              "desc_injury_rounds_seasons": "0", "desc_injury_weighted": "9.75"}
    unknown = {"name": "no id", "club": "Bayern Monaco"}
    view = _sheet_view({"Bayern Monaco": club}, [counted, scaled, unknown])
    assert view.availability(counted) == pytest.approx(1 - 2.0 / 34, abs=0.01)
    assert view.availability(scaled) == pytest.approx(1 - 5.0 / 50, abs=0.01)
    assert view.availability(unknown) == 1.0, "no history is not knowing, never a penalty"


def test_two_overlapping_absences_cost_the_same_round_once():
    """Which is also the answer to "does the source count a relapse twice": counting the ROUNDS inside
    the UNION of the spells cannot double-count, whatever the source lists."""
    from euroleghe_ingest.modules.snapshot import _merged_spells

    assert _merged_spells([("2026-01-10", "2026-02-10"), ("2026-02-01", "2026-03-01")]) == \
        [("2026-01-10", "2026-03-01")]
    assert _merged_spells([("2026-01-10", "2026-01-20"), ("2026-03-01", "2026-03-10")]) == \
        [("2026-01-10", "2026-01-20"), ("2026-03-01", "2026-03-10")]
    assert _merged_spells([("2026-01-10", "2026-05-01"), ("2026-02-01", "2026-02-10")]) == \
        [("2026-01-10", "2026-05-01")], "a spell inside another one adds nothing"


def test_predicted_appearances_are_a_share_of_the_platform_calendar():
    """`engine_pv_pred` is counted on the platform's own calendar - 31 euro rounds in 2025-26 against 38
    in Serie A - so it is not a share of the club's championship. Read against Bayern's fixtures a man
    expected in 26.6 of 31 rounds printed 53%."""
    view = _sheet_view({"Bayern Monaco": {"complete_XIs": "50", "league_XIs": "34"}}, [],
                       {"matchdays": {"platform_target": 31, "platform_input": 31}})
    assert view.platform_matchdays() == 31
    assert min(26.6 / view.platform_matchdays(), 1) > 0.85
    assert _sheet_view({}, [], {}).platform_matchdays() == 0, "an older sheet says nothing: fall back"


# ----------------------------------------------------------------------------------------------------
# The gate's other half: the provisional constants, and the harness that sweeps them
# ----------------------------------------------------------------------------------------------------
def test_every_swept_parameter_exists_and_is_scored_against_a_target():
    """A new parameter must not be sweepable without saying WHICH outcome judges it: `standing_weights`
    never enters `voto_share`, so scoring it on appearances would print a flat line and read as "no
    effect" - a statement about the code, not about the parameter."""
    from dataclasses import fields

    from euroleghe_ingest.engine import presence
    from euroleghe_ingest.modules import sweep

    names = {field.name for field in fields(presence.Params)}
    # The investment arms are COMPOSITES: a shape and its weights move together, because with the weights
    # at zero every shape is the same function and sweeping the shape alone would report "no effect" about
    # a term that is switched off. One per form - the main effect (§7-quater) and the two conditional arms
    # of §7-septies, kept apart because their COVERAGE differs (11 seasons of market values against 2 of
    # transfer fees) and a verdict that hides that is not a verdict.
    # ...and `age_decline` is one for the same reason: at a discount of 0 the threshold is
    # unidentifiable, so the two move together (todolist-formazioni-tipo item 7).
    composite = ({name for name in sweep.GRIDS if name.startswith("investment")}
                 | {"arrival_split", "age_decline"})
    assert set(sweep.GRIDS) - composite <= names,         f"swept but not a parameter: {set(sweep.GRIDS) - composite - names}"
    assert set(sweep.GRIDS) == set(sweep.TARGETS), "every grid needs its target named"
    assert set(sweep.TARGETS.values()) <= set(sweep.PREDICTORS)
    # A family's BASELINE - the point every gain is measured against - must be a point the sweep actually
    # scored, or the reported gain is a comparison with something no fold ever evaluated. Normally that
    # baseline is the state in use (every term off); a family may declare another one in `BASELINES` when the
    # question is a MARGINAL contribution (the value channel over its own null, gate §7-septies), and then it
    # is the declared baseline that has to be in the grid.
    for name in sweep.BASELINES:
        assert name in sweep.GRIDS, f"{name}: a baseline for a family that does not exist"
        assert sweep.BASELINES[name] in sweep.GRIDS[name], (
            f"{name}: its declared baseline is not one of the points it scores")
    for name, grid in sweep.GRIDS.items():
        if name in composite:
            if name in sweep.BASELINES:
                continue                    # checked above, against its own declared baseline
            # the composite's own grid must contain the state the code is actually in. Each composite says
            # what "in use" means for it: the investment arms are every term off, the arrival split is the
            # single discount applied to both kinds of arrival.
            # ...asked of the SWEEP itself, so the test and the run can no longer disagree about what
            # "the state in use" is - they did, and the disagreement only surfaced as a crash mid-run.
            assert sweep._current(name) in grid, f"{name}: the state in use is not in its own grid"
            continue
        assert getattr(presence.DEFAULTS, name) in grid, f"{name}: the value in use is not in its own grid"


def test_a_parameter_is_never_chosen_on_the_fold_that_scores_it():
    """The whole protocol in one table: fold B's own best value is 'b', but B is scored with what A and C
    chose. A harness that picked per fold would report a gain that cannot be had out of sample."""
    from euroleghe_ingest.modules import sweep

    table = {"A": {"a": 0.10, "b": 0.20}, "B": {"a": 0.30, "b": 0.10}, "C": {"a": 0.10, "b": 0.20}}
    result = sweep._cross_fit(table, ["a", "b"], "a")
    assert result["cross_fit_choice"]["B"] == "a",         "B's own best is 'b' by a mile, and B is scored with what A and C chose"
    assert result["gain_vs_current"]["B"] == 0.0, "so B reports no gain, which is the honest answer"
    assert not result["strict"] and not result["robust"], result
    # ...and when the other folds really do prefer the alternative, it is chosen and the gain is measured
    better = {"A": {"a": 0.20, "b": 0.10}, "B": {"a": 0.20, "b": 0.10}}
    result = sweep._cross_fit(better, ["a", "b"], "a")
    assert result["cross_fit_choice"] == {"A": "b", "B": "b"}
    assert result["strict"] and result["robust"], result
    assert result["mean_gain"] == 0.5


def test_the_forecast_and_the_measured_absences_are_not_interchangeable():
    """v9.11's shape change, as arithmetic: with the FORECAST on both sides of `presence` the injury
    history cancels almost exactly, so a sweep of the weights or the floor would have been measuring
    nothing. The gate ran it and kept `measured` on every fold, on both platforms."""
    from euroleghe_ingest.engine import presence

    # 20 starts in 38 rounds, 16 of which he missed; a man like him misses 9 a season
    inputs = presence.Inputs(starts=20.0, appearances=20.0, minutes=1800.0, league_matches=38.0,
                             fixtures=38.0, rounds_measured=16.0, rounds_by_season=(16.0, 4.0, 7.0),
                             known_injuries=True)
    measured = presence.presence(inputs, presence.DEFAULTS)
    forecast = presence.presence(inputs, presence.DEFAULTS.with_value("contested_from", "forecast"))
    assert measured > forecast, "the rate has to be read over the rounds he was actually there for"
    # the cancellation: with the forecast subtracted AND multiplied back, the discount all but vanishes
    healthy = presence.Inputs(**{**inputs.__dict__, "rounds_by_season": (), "known_injuries": False})
    assert presence.presence(healthy, presence.DEFAULTS.with_value("contested_from", "forecast")) \
        == pytest.approx(20.0 / 38, abs=0.001)


def test_a_serie_a_penalty_is_one_penalty_and_not_two(tmp_path):
    """It exists in `match_ratings` twice - once in the euro rows, once in the default ones, the same kick
    under two matchday numberings - so the series a Serie A hierarchy was built from was twice as long as
    the real one. With the weight decaying as DECAY**k that halves the MEMORY for Serie A against a
    foreign club, and it is why the first sweep of DECAY appeared to want 0.5 (0.75 squared is 0.56)."""
    from euroleghe_ingest.db.database import init_db
    from euroleghe_ingest.modules import fc_site

    conn = init_db(tmp_path / "euroleghe.db")
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (7, 'Rigorista')")
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (1, 'Napoli', 'serie_a')")
    conn.execute("INSERT INTO rosters(fc_id, season, fc_club_id, league) VALUES (7, '2025-26', 1, "
                 "'serie_a')")
    conn.execute("INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, "
                 "real_md, match_date, minutes) VALUES (7, '2025-26', 'sofascore', 'm1', 'serie_a', "
                 "5, '2025-09-20', 90)")
    conn.execute("INSERT INTO matchday_map(season, euro_md, league, real_md) "
                 "VALUES ('2025-26', 4, 'serie_a', 5)")
    for platform, matchday in (("default", 5), ("euro", 4)):
        conn.execute("INSERT INTO match_ratings(fc_id, season, matchday, platform, team, role, mv, "
                     "pen_scored) VALUES (7, '2025-26', ?, ?, 'Napoli', 'A', 7.0, 1)",
                     (matchday, platform))
    conn.commit()
    events = fc_site.penalty_events(conn)
    assert len(events) == 1, f"the same kick counted {len(events)} times: {events}"

    # ...and a real brace in one match is still two penalties
    conn.execute("UPDATE match_ratings SET pen_scored = 2 WHERE season = '2025-26'")
    conn.commit()
    assert len(fc_site.penalty_events(conn)) == 2


def test_the_penalty_hierarchy_answers_to_its_two_parameters():
    """Both are provisional, so both are arguments: the decay says how fast an old penalty stops counting,
    the miss penalty how much a miss quarantines its taker - which is what lets a number two overtake."""
    from euroleghe_ingest.modules.fc_site import rank_takers

    # newest first: the last taker MISSED his, the man before him scored
    attempts = [(10, True), (20, False)]
    assert rank_takers(attempts)[0][0] == 20, "a taker whose last attempt was missed loses the top spot"
    assert rank_takers(attempts, miss_penalty=1.0)[0][0] == 10, "with no quarantine the last taker leads"
    # a short memory reads only the most recent kick; a long one adds up the older ones
    assert rank_takers([(10, False), (20, False), (20, False)], decay=0.05)[0][0] == 10
    assert rank_takers([(10, False), (20, False), (20, False)], decay=1.0)[0][0] == 20


def test_a_back_dated_sheet_draws_the_eleven_that_was_FIELDED():
    """The precedence for "who plays": the outcome where it exists, the editors' forecast where it does
    not. A forecast is only interesting while the answer is unknown, and a sheet standing on a past day is
    standing after the match - so the probabili of that day are not worth fetching (and cannot be).

    The two never share a column: `actual_*` is its own class, and the caption says which one is on screen.
    """
    from euroleghe_ingest import gui

    def man(name, role, codes, started=None, probability=None):
        return {"name": name, "club": "Napoli", "role_classic": role, "desc_real_roles": codes,
                "actual_next_started": started, "desc_starter_prob": probability,
                "desc_season_starts": "20", "desc_minutes_full_season": "1800"}

    fielded = [man("Meret", "P", "GK", "1"), man("Di Lorenzo", "D", "DR", "1"),
               man("Rrahmani", "D", "DC", "1"), man("Buongiorno", "D", "DC", "1"),
               man("Spinazzola", "D", "DL; ML", "1"), man("Anguissa", "C", "MC", "1"),
               man("Lobotka", "C", "MC; DM", "1"), man("McTominay", "C", "MC; AM", "1"),
               man("Politano", "C", "RW; MR", "1"), man("Neres", "C", "LW", "1"),
               man("Lukaku", "A", "ST", "1")]
    # the editors had named a different eleven, and it must lose to what happened
    bench = [man("Simeone", "A", "ST", "0", "0.9"), man("Olivera", "D", "DL", "0", "0.85")]
    view = gui.SnapshotView.__new__(gui.SnapshotView)
    view.clubs = {"Napoli": {"formation_next_fielded": "4-3-3", "next_match_date": "2025-08-23",
                             "formation_typical": "4-5-1", "formation_today": "3-4-3"}}
    view.players = view.rows = fielded + bench
    view.manifest, view._calendar = {}, {}

    picked = {starter["name"] for _role, starter, _rivals in view.eleven("Napoli", "4-3-3", "next")}
    assert picked == {row["name"] for row in fielded}, "the fielded eleven, not the declared one"
    assert "Simeone" not in picked, "a 90% probability does not beat having watched the match"
    shape, why = gui.SnapshotView._formation(view.clubs["Napoli"], "next")
    assert shape == "4-3-3" and "FIELDED" in why and "2025-08-23" in why
    # ...and with no outcome recorded the editors' forecast is back in charge
    for row in fielded:
        row["actual_next_started"] = None
    assert gui.SnapshotView._formation({"formation_today": "3-4-3", "formation_typical": "4-5-1"},
                                       "next") == ("3-4-3", "probabili of today")


def test_what_the_club_put_into_him_has_two_channels_and_they_start_at_zero():
    """The hypothesis is that a club plays the man it paid for, and forgives him a bad game at a
    youngster's expense. Two channels, because they catch different players - and the measurement is the
    reason both exist: Modric and De Bruyne arrived on FREE transfers, so a fee-only index says "no
    investment" for exactly the two names the argument was built on, while their Qt.I sits at the 77th and
    94th percentile of the midfielders.

    Both weights are 0 by default: a hypothesis nobody has scored yet must not move a single number.
    """
    from euroleghe_ingest.engine import presence

    base = presence.Inputs(starts=20.0, appearances=20.0, minutes=1800.0, league_matches=38.0,
                           fixtures=38.0, minutes_here=0.0, minutes_elsewhere=1800.0,
                           fee_share=0.43, stature=0.95)
    assert presence.investment_lift(base) == 0.0, "off until the gate says otherwise"
    assert presence.standing(base) == presence.standing(base, presence.DEFAULTS)

    fee_on = presence.DEFAULTS.with_value("fee_weight", 0.2)
    assert presence.investment_lift(base, fee_on) == pytest.approx(0.086)
    # the fee is one-sided: spending nothing is not evidence AGAINST a man
    assert presence.investment_lift(presence.Inputs(fee_share=0.0), fee_on) == 0.0
    # the stature is centred, because the claim has two sides: the star gains, the cheap youngster pays
    stature_on = presence.DEFAULTS.with_value("stature_weight", 0.2)
    assert presence.investment_lift(presence.Inputs(stature=1.0), stature_on) == pytest.approx(0.2)
    assert presence.investment_lift(presence.Inputs(stature=0.0), stature_on) == pytest.approx(-0.2)
    assert presence.investment_lift(presence.Inputs(stature=0.5), stature_on) == 0.0
    # an unknown channel contributes nothing: not knowing what a club spent is not knowing
    assert presence.investment_lift(presence.Inputs(), fee_on) == 0.0

    # THE THIRD CHANNEL - the market value as a share of his squad's - and the reason it exists: a fee is
    # NULL for a free transfer, so `fee_share` said «no investment» about Modric and De Bruyne, the two
    # names the hypothesis came from. A value exists for everyone the source has priced, and it is dated by
    # SEASON, so a window reads the input season's and never the target one's.
    value_on = presence.DEFAULTS.with_value("value_weight", 0.30)
    # a starter is an eleventh of his squad by construction, so that is the scale this term works on
    assert presence.investment_lift(presence.Inputs(value_share=1 / 11), value_on) == pytest.approx(0.027,
                                                                                                    abs=1e-3)
    assert presence.investment_lift(presence.Inputs(value_share=0.30), value_on) == pytest.approx(0.09)
    # one-sided like the fee: being a small part of a rich squad is not evidence against a man
    assert presence.investment_lift(presence.Inputs(value_share=0.0), value_on) == 0.0
    assert presence.investment_lift(presence.Inputs(), value_on) == 0.0, "no value on file, no lift"
    # and OFF by default, like the other two: 20 042 values in the DB must not move a single number
    assert presence.DEFAULTS.value_weight == 0.0
    assert presence.investment_lift(presence.Inputs(value_share=0.9)) == 0.0

    # the ARRIVAL shape only closes part of the gap a discount opened, so a man whose whole season is
    # already at this club cannot be lifted by it - his minutes have said it
    arrival = presence.Params(fee_weight=0.5, investment_shape="arrival")
    here = presence.Inputs(minutes_here=1800.0, minutes_elsewhere=0.0, fee_share=1.0)
    assert presence.at_club_weight(here, arrival) == 1.0
    elsewhere = presence.Inputs(minutes_here=0.0, minutes_elsewhere=1800.0, fee_share=1.0)
    assert presence.at_club_weight(elsewhere, arrival) > presence.at_club_weight(elsewhere)


def test_a_fold_that_cannot_see_the_feature_is_not_a_failure():
    """The gate's own rule, and it matters for any parameter whose input starts mid-history: the transfer
    fees exist from 2023, so the older windows cannot move at all. Counted as "no gain" they would fail
    every hypothesis mechanically on the strict verdict; they are reported as not measurable instead."""
    from euroleghe_ingest.modules import sweep

    table = {"old": {"off": 0.30, "on": 0.30},          # the feature does not exist in this fold
             "T1": {"off": 0.30, "on": 0.20}, "T2": {"off": 0.30, "on": 0.20}}
    result = sweep._cross_fit(table, ["off", "on"], "off")
    assert result["folds_without_the_feature"] == ["old"]
    assert set(result["gain_vs_current"]) == {"T1", "T2"}
    assert result["strict"] and result["robust"], result
    # and with no informative fold at all there is no verdict to give
    flat = sweep._cross_fit({"a": {"off": 0.3, "on": 0.3}}, ["off", "on"], "off")
    assert "strict" not in flat and flat["verdict"] == "not measurable on any fold"


def test_the_panel_spends_its_height_on_the_board_and_not_on_its_own_chrome(tmp_path, monkeypatch):
    """Two layout invariants nobody was measuring, and both were broken.

    The STATUS BAR was packed after a shell that expands, so the packer had no cavity left for it: it was
    created, filled and updated at one pixel tall - present in the code and invisible on screen. And on the
    Snapshot board the pitch is the thing being read, while the app header, the tab strip, the sheet bar
    and the club card sit on top of it; each of them was sized as if it were the only one.

    Asserted as RATIOS, not pixel counts, so the test says the same thing on another display's fonts.
    """
    import tkinter as tk

    from euroleghe_ingest import gui

    try:
        root = tk.Tk()
    except tk.TclError as exc:                       # headless: there is no geometry to measure
        pytest.skip(f"no Tk display: {exc}")
    # `db_path` is an INDEPENDENT field, not derived from `data_dir`, so redirecting the data dir alone
    # left this test opening the operator's real 313 MB database - and the Auction tab does it in a
    # BACKGROUND thread (`ToolkitGUI` reloads every tab), which then outlived the test and died in the
    # garbage collector. A geometry test must not read a database at all: point it at one that isn't
    # there, and the panel says "no database yet" instead of starting the engine.
    monkeypatch.setattr(gui, "Config",
                        lambda: Config(data_dir=tmp_path, db_path=tmp_path / "none.db",
                                       league_config_path=tmp_path / "none.json"))
    try:
        app = gui.ToolkitGUI(root)
        root.state("normal")                         # it opens maximised; measure a known size instead
        root.geometry("1180x780")
        root.update()
        app.notebook.select(app.snapshot)
        root.update()

        status = root.pack_slaves()[0]
        assert status.winfo_height() > 10, (
            "the status bar must be packed BEFORE the expanding shell, or it gets no cavity at all")

        # Everything above the pitch inside the board: the sheet bar, the provenance line, the club card
        # and the two rows of pitch options. Measured at 1180x780 it was 242px against 388px of pitch
        # (ratio 1.6); one row per fact instead of one row per widget makes it 165 against 493 (3.0).
        board = app.snapshot
        chrome = board.pitch.winfo_rooty() - board.winfo_rooty()
        assert board.pitch.winfo_height() > 2.5 * chrome, (
            f"pitch {board.pitch.winfo_height()}px against {chrome}px of chrome above it")
    finally:
        root.destroy()


def test_the_appearance_segments_carry_the_mae_the_document_quotes():
    """`presenze-attese-v1.md` quotes the starters' MAE («6.84→6.51 e 6.71→6.27») and nothing was checking
    it: the segment table only carried the bias. The starters are the segment an auction is decided on, so a
    silent drift there is the one that costs - and it is exactly where the three unreproducible T1 numbers
    turned out to live.

    Guarded here as a SHAPE check (the segments carry four numbers, not two) because the values themselves
    are in `REFERENCE_GATE` and `backtest --verify` compares them against a real window.
    """
    from euroleghe_ingest.engine import evaluate, model

    for key in ("T1", "T2"):
        for name in ("pv_mae_starters_model", "pv_mae_starters_naive", "pv_gain_crossfit",
                     "pv_gain_vs_naive", "pv_bias_naive_starters", "pv_bias_model_starters"):
            assert key in model.REFERENCE_GATE[name], f"{name} must carry {key}"
    # the naive promises the average starter 4-6 phantom matchdays on every window and platform measured:
    # that is the criterion the module was adopted on, and it is what must never quietly go to zero
    for key in ("T1", "T2"):
        assert 4.0 <= model.REFERENCE_GATE["pv_bias_naive_starters"][key] <= 6.5
        assert abs(model.REFERENCE_GATE["pv_bias_model_starters"][key]) < 1.0
    source = inspect.getsource(evaluate.appearance_segments)
    for field in ("bias_model", "bias_naive", "mae_model", "mae_naive"):
        assert f'"{field}"' in source, f"the segment must report {field}"


def test_every_presence_input_is_populated_by_every_caller():
    """A parameter whose INPUT never reaches a caller is switched on and blind, which is worse than off.

    Found twice in one session, both times only because somebody looked: `level_weight` was adopted by the
    sweep and the panel never set `level_z`, so the board showed pre-adoption claims; and `standing_prior`
    had the same shape. The mirror case is just as bad and is also here - `window_matches`/`window_minutes`
    are set by the panel and NOT by the sweep, which is why `window_standing` has never been scorable and
    gate §7-octies is blocked by an omission rather than by a decision.

    So: every field of `Inputs` must be named by every constructor of it. A field genuinely out of reach for
    one caller goes in `KNOWN_GAPS` with the reason, and the list is expected to shrink.
    """
    import re
    from dataclasses import fields
    from pathlib import Path

    from euroleghe_ingest.engine import presence

    KNOWN_GAPS = {
        # the sweep cannot see the recent-form window: `recent_form` fetches it for TODAY's sheet, and a
        # window played years ago would need the same measurement rebuilt from `external_match_stats`.
        # Until it is, `window_standing` (gate §7-octies) cannot be scored - stated, not hidden.
        ("modules/sweep.py", "window_matches"),
        ("modules/sweep.py", "window_minutes"),
        # ...and the other way round: the SHEET does not carry the per-player level yet, so the panel
        # cannot rank a man inside his department. Filling it means a `desc_` column and a
        # SHEET_REVISION, and there is no reason to pay that before the gate has spoken on
        # `level_rank_weight` (§7-tervicies). Declared, and to be closed by whoever adopts the channel.
        ("gui.py", "level_rank"),
    }
    names = {f.name for f in fields(presence.Inputs)}
    root = Path(__file__).resolve().parents[1] / "euroleghe_ingest"
    missing = set()
    for rel in ("gui.py", "modules/sweep.py"):
        text = (root / rel).read_text(encoding="utf-8")
        start = text.index("presence.Inputs(")
        depth, end = 0, start
        for index in range(start + len("presence.Inputs"), len(text)):
            depth += (text[index] == "(") - (text[index] == ")")
            if depth == 0:
                end = index
                break
        block = text[start:end]
        given = {m.group(1) for m in re.finditer(r"[\s(]\s*(\w+)=", block)}
        for gap in names - given:
            if (rel, gap) not in KNOWN_GAPS:
                missing.add(f"{rel} never sets Inputs.{gap}")
    assert not missing, "an input nobody feeds: " + " · ".join(sorted(missing))
