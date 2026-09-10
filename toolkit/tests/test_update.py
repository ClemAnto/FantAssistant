"""Tests for the one-button update: the ORDER, and the three things about it that are decisions.

The plan is data, so most of what can go wrong here is structural - a step naming a module that does
not exist, an order that puts the bundle before the sheets it copies, a `refresh` on a fact that is
finished (which would cost a whole night to re-download what cannot have changed). Those are cheap to
assert and would otherwise only show up hours into a real run.

Three tests are not structural and are the reason this file exists at all:
  * the acquisition must stay BOOTSTRAP'S OWN plan and not a copy of it, because two lists of one order
    drift and the first to be wrong is the one the button runs;
  * a failure must not end the run, or a night's downloads produce nothing;
  * the publication must not be reachable from here - `deploy:pages` pushes to a public branch.
"""

from __future__ import annotations

import json

import pytest

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import ALL_MODULES, bootstrap, timepack, update


def _ctx(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    cfg.cache_dir.mkdir(parents=True)
    return Context(config=cfg, conn=init_db(cfg.db_path))


class _Fake:
    """A module whose run() records that it was called - or raises, to test the failure paths."""

    def __init__(self, calls: list, name: str, boom: bool = False) -> None:
        self.calls, self.name, self.boom = calls, name, boom

    def run(self, _ctx, **params):
        self.calls.append((self.name, params))
        if self.boom:
            raise RuntimeError(f"{self.name} refused")
        return {}

    def derive_from_ratings(self, _ctx):
        self.calls.append((self.name, {"derive_from_ratings": True}))

    def refresh_listone_for_platform(self, _ctx, platform):
        self.calls.append((self.name, {"listone_for": platform}))
        return []


def _stub_load(calls, boom: tuple[str, ...] = ()):
    return lambda name: _Fake(calls, name, boom=name in boom)


# ----------------------------------------------------------------- the plan is data
def test_every_step_names_a_real_module_or_a_real_action():
    for step in update.plan():
        assert step.module in ALL_MODULES or step.action in update.ACTIONS, step.key
        if step.action:
            assert step.action in update.ACTIONS, step.key
        assert step.why, f"{step.key}: a step without a reason is a step nobody can audit"
        assert step.minutes > 0
        assert step.phase in update.PHASE_KEYS


def test_the_acquisition_is_bootstraps_own_plan_and_not_a_copy():
    """The whole point of `plan()`: ONE order, two questions.

    If a future session copies bootstrap's list in here to add a step, this fails - which is exactly
    when it should, because from then on the two would drift and only one of them would be run.
    """
    mine = [step.key for step in update.plan(("acquire",))]
    assert mine == [step.key for step in bootstrap.plan()]


def test_refresh_is_set_where_the_source_moves_and_nowhere_else():
    """A cache over a fact that CHANGES needs an expiry; over a FINISHED fact it must not have one.

    The second half is what makes the test worth having: a `refresh` on a played round or on a club
    badge costs the entire download again and cannot buy a single new row.
    """
    params = {step.key: step.params for step in update.plan(("acquire",), refresh=True)}
    moves = ("positions:season", "positions:roles", "positions:extra", "transfers", "fixtures",
             "injuries:ids", "injuries", "market", "performance")
    finished = ("ratings:default", "ratings:euro", "positions:match", "positions:complete",
                "positions:crests", "positions:heatmap", "tournaments", "elo")
    for key in moves:
        assert params[key].get("refresh") is True, f"{key} re-reads a source that moves"
    for key in finished:
        assert params[key].get("refresh") is not True, f"{key} would re-download a finished fact"
    # ...and with the flag off, nothing re-reads anything: that is what --no-refresh means.
    off = {step.key: step.params for step in update.plan(("acquire",), refresh=False)}
    assert not [key for key, one in off.items() if one.get("refresh")]


def test_the_extra_layer_carries_its_window():
    """`--days` is the flag this dispatcher dropped twice; a plan that omits it repeats the defect."""
    extra = next(step for step in update.plan(("acquire",)) if step.key == "positions:extra")
    assert extra.params["days"] == 1100


def test_the_deliverable_comes_after_everything_it_reads():
    keys = [step.key for step in update.plan()]
    for derived in ("stats:derive", "matchdays", "synth", "arrivals"):
        assert keys.index(derived) < keys.index("sheets"), derived
    assert keys.index("sheets") < keys.index("packs")      # a pack calls snapshot at a past date
    assert keys.index("sheets") < keys.index("bundle")     # export copies the NEWEST sheet per league
    assert keys.index("packs") < keys.index("bundle")      # ...and the packs it finds on disk
    assert keys.index("bundle") < keys.index("pull")       # the app copies what export wrote
    assert keys[-1] == "pull"


def test_an_unknown_phase_is_refused_by_name():
    with pytest.raises(RuntimeError, match="unknown phase"):
        update.plan(("acquire", "publish"))


def test_the_publication_is_not_reachable_from_here():
    """`deploy:pages` pushes to a PUBLIC branch: an outward-facing action, not part of «update».

    Asserted on the one step that shells out, because that is the only place it could ever get in - and
    on the plan's own text, so a step cannot be described as publishing either.
    """
    import inspect

    shells = inspect.getsource(update._run_pull)
    assert 'subprocess.run("npm run data:pull"' in shells
    assert "deploy" not in shells.split('"""')[2], "the only shelled command is the local copy"
    assert not [step for step in update.plan() if "deploy" in (step.why + str(step.params)).lower()]


# ----------------------------------------------------------------- selection
def test_offline_drops_the_network_phase_and_an_explicit_phase_still_wins(tmp_path):
    ctx = _ctx(tmp_path)
    out = update.run(ctx, offline=True, plan_only=True)
    assert "ratings:default" not in out["steps"]
    assert "sheets" in out["steps"] and "bundle" in out["steps"]
    # the more specific flag is not silently overridden by the broader one
    out = update.run(ctx, offline=True, phases=("acquire",), plan_only=True)
    assert out["steps"] == [step.key for step in bootstrap.plan()]


def test_from_and_to_select_a_slice_and_a_bad_name_is_refused(tmp_path):
    ctx = _ctx(tmp_path)
    out = update.run(ctx, phases=("derive",), steps_from="synth", plan_only=True)
    assert out["steps"] == ["synth", "arrivals", "validate"]
    with pytest.raises(RuntimeError, match="not a step"):
        update.run(ctx, steps_to="nope")


# ----------------------------------------------------------------- what the run does
def test_a_failed_step_does_not_end_the_run_and_lands_in_the_summary(tmp_path, monkeypatch, capsys):
    calls: list = []
    monkeypatch.setattr(update, "load", _stub_load(calls, boom=("synth",)))
    ctx = _ctx(tmp_path)
    out = update.run(ctx, phases=("derive",))
    assert [name for name, _p in calls] == ["stats", "matchdays", "synth", "arrivals", "validate"]
    assert [key for key, _why in out["failed"]] == ["synth"]
    assert "FAILED  synth" in capsys.readouterr().out


def test_three_refusals_in_a_row_abandon_the_acquisition_and_the_rest_still_runs(
        tmp_path, monkeypatch, capsys):
    """«A long sweep that starts getting refused is a sweep to abandon» - and the offline half is not.

    The number that matters is not the three: it is that the derive/sheets phases still happen, on the
    data already on disk. Abandoning the network is not abandoning the run.
    """
    calls: list = []
    monkeypatch.setattr(update, "load", _stub_load(
        calls, boom=("fetch", "rosters", "stats", "ratings", "positions", "transfers")))
    ctx = _ctx(tmp_path)
    out = update.run(ctx, phases=("acquire", "derive"))
    assert out["abandoned"] is True
    assert len(out["failed"]) == update.CONSECUTIVE_FAILURES
    printed = capsys.readouterr().out
    assert "abandoning the acquisition" in printed
    # `matchdays` is in the derive phase and must have been reached all the same
    assert "matchdays" in [name for name, _p in calls]


def test_the_sheets_are_one_per_declared_league_and_the_editorial_read_is_taken_once(
        tmp_path, monkeypatch):
    calls: list = []
    monkeypatch.setattr(update, "load", _stub_load(calls))
    ctx = _ctx(tmp_path)
    leagues = list(ctx.config.my_leagues())
    update.run(ctx, phases=("sheets",))
    # `snapshot` is now called for two different jobs - a sheet and a listone top-up - so the rows are
    # picked by what they SAY and not by the module they came from.
    sheets = [params for name, params in calls if name == "snapshot" and "league" in params]
    assert len(sheets) == len(leagues)
    assert [one["league"] for one in sheets] == leagues
    assert [one["refresh"] for one in sheets] == [True] + [False] * (len(leagues) - 1)


def test_the_listone_is_topped_up_ONCE_PER_PLATFORM_and_not_once_per_run(tmp_path, monkeypatch):
    """Four of the five refreshed channels are facts about a DAY; the listone is a fact about a PLATFORM.

    Found 10/09/2026 by reading a run's own log. `refresh` goes to the first declared league only -
    right for the probabili, the market, the squad pages and the Elo, which one reading serves - and
    the listone is not one of those: `listone_quotes` carries `platform` in its key because the two
    lists disagree on 202 Qt.I and 226 FVM. With EuroLeghe declared first, the euro list was re-read
    every day and the Serie A one was two days old, and the sheets built on it said so about
    themselves while nobody read it.

    The assertion is on the PLATFORM and not on a count: three leagues on two platforms must produce
    exactly one top-up, for the platform the first sheet does not cover - one login and one request,
    never three, and never zero.
    """
    import json

    calls: list = []
    monkeypatch.setattr(update, "load", _stub_load(calls))
    # A DECLARED file and never the repository's own: a test whose fixture is a user-editable file is
    # testing the user (the smoke-test lesson), and this one needs two platforms to say anything.
    declared = tmp_path / "league_config.json"
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db",
                 league_config_path=declared)
    cfg.cache_dir.mkdir(parents=True)
    ctx = Context(config=cfg, conn=init_db(cfg.db_path))
    declared.write_text(json.dumps({
        "teams": 10, "budget": 500, "squad_slots": {"P": 3, "D": 8, "C": 8, "A": 6},
        "my_leagues": {
            "EuroLeghe": {"platform": "euro", "game": "mantra"},
            "Leghe": {"platform": "default", "game": "classic"},
            "Leghe Mantra": {"platform": "default", "game": "mantra"},
        },
    }), encoding="utf-8")

    update.run(ctx, phases=("sheets",))
    sheets = [params["league"] for name, params in calls if name == "snapshot" and "league" in params]
    topped = [params["listone_for"] for name, params in calls
              if name == "snapshot" and "listone_for" in params]
    assert sheets == ["EuroLeghe", "Leghe", "Leghe Mantra"]
    assert topped == ["default"], (
        "the listone must be re-read once for every platform the first sheet does not cover, "
        f"and this run did {topped}")


def test_the_packs_build_what_is_missing_and_rebuild_only_what_is_behind(tmp_path, monkeypatch):
    """Not `--all --refresh`: that rebuilds four packs to fix one, and costs a snapshot run per league."""
    calls: list = []

    class _Timepack(_Fake):
        def outdated(self, _ctx):
            return ["2025-02-05"]

    monkeypatch.setattr(update, "load",
                        lambda name: _Timepack(calls, name) if name == "timepack"
                        else _Fake(calls, name))
    update.run(_ctx(tmp_path), phases=("packs",))
    assert [params for name, params in calls if name == "timepack"] == [
        {"build_all": True}, {"date": "2025-02-05", "refresh": True}]


def test_a_cancelled_run_stops_between_steps_and_keeps_what_is_done(tmp_path, monkeypatch):
    import threading

    calls: list = []
    monkeypatch.setattr(update, "load", _stub_load(calls))
    ctx = _ctx(tmp_path)
    ctx.cancel_event = threading.Event()
    ctx.cancel_event.set()
    out = update.run(ctx, phases=("derive",))
    assert calls == [] and out["done"] == []


# ----------------------------------------------------------------- the staleness decision
def _pack(ctx, date: str, payload: dict) -> None:
    folder = ctx.config.data_dir / "timepacks" / date
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "manifest.json").write_text(json.dumps(payload), encoding="utf-8")


def test_a_pack_is_behind_when_its_sheets_are_and_an_unreadable_one_counts_as_behind(
        tmp_path, monkeypatch):
    """One definition of «this pack is behind», read by `--plan` and by the update that rebuilds it.

    A pack that does not DECLARE its revision is not a pack anyone can call up to date - the same rule
    the field itself was added for (a revision recovered, never restamped with today's).
    """
    from euroleghe_ingest.modules import snapshot

    ctx = _ctx(tmp_path)
    now = snapshot.SHEET_REVISION
    monkeypatch.setattr(timepack, "wanted_dates", lambda _ctx: (
        [], [{"date": "2024-09-05"}, {"date": "2025-02-05"}, {"date": "2025-09-05"},
             {"date": "2026-02-05"}]))
    _pack(ctx, "2024-09-05", {"sheet_revision": now - 1})
    _pack(ctx, "2025-02-05", {"sheet_revision": now})
    _pack(ctx, "2025-09-05", {"leagues": [{"manifest": {"sheet_revision": now - 7}}]})
    (ctx.config.data_dir / "timepacks" / "2026-02-05").mkdir(parents=True)  # no manifest at all
    assert timepack.outdated(ctx) == ["2024-09-05", "2025-09-05", "2026-02-05"]


def test_the_daily_preset_is_a_SELECTION_of_the_one_order_and_not_a_second_list():
    """A key that is not a step is a preset that silently gets SHORTER, which nothing else would show.

    Same family as the flag the parser accepts and the dispatcher drops: a typo here does not raise, it
    produces a run that is missing a phase and looks exactly like a run that had nothing to do.
    """
    keys = {step.key for step in update.plan()}
    unknown = sorted(set(update.DAILY) - keys)
    assert not unknown, f"DAILY names steps that do not exist: {unknown}"
    # ...and every step of the preset carries its own reason, because the criterion is WHAT IT
    # OBSERVES and a list without reasons is a list nobody can argue with.
    assert all(why.strip() for why in update.DAILY.values())


def test_the_daily_preset_takes_todays_readings_and_leaves_the_archives_out():
    """What decides is the FACT, not the cost: today's readings in, finished facts and archives out."""
    daily = [step.key for step in update.plan(daily=True)]
    # the reading that cannot be backfilled, and the deliverable it feeds
    for wanted in ("fc_site", "positions:roles", "fixtures", "elo", "sheets", "bundle"):
        assert wanted in daily, f"{wanted} is a daily fact and the preset drops it"
    # the archives: their unit is the week (or the season), and re-reading them daily is hours
    for archive in ("injuries", "market", "positions:match", "performance", "ratings:default",
                    "positions:heatmap", "recent_form"):
        assert archive not in daily, f"{archive} is a weekly archive and the preset pays for it"
    # the DERIVATION is out on a claim about the graph: it reads the votes and the season aggregates,
    # which a daily run does not re-read, so it would reproduce yesterday's tables in 13 minutes.
    for derived in ("stats:derive", "matchdays", "synth", "arrivals", "packs"):
        assert derived not in daily
    # and the order is the plan's own, never a second one
    assert daily == [step.key for step in update.plan() if step.key in update.DAILY]


def test_the_daily_preset_says_what_it_left_out(capsys):
    """A preset that quietly skips the archives reads like a full update that found nothing to do."""
    update._print_what_daily_leaves_out()
    out = capsys.readouterr().out
    assert "LEFT OUT" in out and "injuries" in out and "market" in out
    # ...AND it says which of those the sheets step re-reads a slice of by itself. Until 09/09/2026 it
    # said the opposite - «none of them feeds today's sheet» - while a real run moved
    # `transfers_history` 6019 -> 6026, wrote 995 rows of `fvm_history` off the listone re-read and
    # logged an `arrivals ... re-derived by snapshot`. A preset that promises LESS than it does makes
    # the next run be planned on a false picture exactly like one that quietly skips.
    # ...and the names are looked for in the SLICE section and not in the whole output: the plain
    # leave-out list already carries every one of them, so an assertion on `out` could not fail - the
    # circular assert this project has paid for, met inside its own guard.
    head, marker, slices = out.partition("SLICE re-read by the sheets step")
    assert marker, "the printout no longer says which steps the sheets re-read a slice of"
    for named in ("transfers", "injuries:ids", "arrivals"):
        assert named in slices, f"{named} is left out as a step and re-read by the sheets: say so"
    assert "none of them feeds today's sheet" not in out


def test_what_a_sheet_re_reads_is_DERIVED_from_the_calls_and_not_kept_by_hand():
    """`snapshot.SHEET_REFRESHES` is what `--daily` prints, so a channel missing from it is a silence.

    The map is checked against the SOURCE of `refresh_official_sources` - which channels it calls and
    which module each of those reaches - because a list kept beside the consumer drifts from the
    producer, and the first one to be wrong is the one the printout reads. Deliberately crude, like the
    dispatcher test: it catches exactly the defect that has now cost one false declaration, a SEVENTH
    channel added to the sheet refresh and never named where the operator reads it.
    """
    import ast
    from pathlib import Path

    from euroleghe_ingest.modules import snapshot

    tree = ast.parse(Path(snapshot.__file__).read_text(encoding="utf-8"))
    funcs = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
    # TRANSITIVE, and it was not on 09/09: the crawl walked one level and the listone moved one level
    # deeper the next day (`_listone_notes` -> `refresh_listone_for` -> `ratings`), which read as «the
    # refresh no longer reaches ratings». A depth is not a property of the graph, it is a property of
    # the arrangement, and an assertion that depends on it fails on a rename.
    reached: set[str] = set()
    seen: set[str] = set()
    todo = ["refresh_official_sources"]
    while todo:
        name = todo.pop()
        if name in seen or name not in funcs:
            continue
        seen.add(name)
        for node in ast.walk(funcs[name]):
            if isinstance(node, ast.ImportFrom) and node.module == "euroleghe_ingest.modules":
                reached |= {alias.name for alias in node.names}
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                todo.append(node.func.id)
    # the map speaks in STEP keys (`ratings:euro`), the calls in module names (`ratings`)
    declared = {key.split(":")[0] for key in snapshot.SHEET_REFRESHES}
    assert declared == reached, (
        f"the sheet refresh reaches {sorted(reached)} and SHEET_REFRESHES declares {sorted(declared)}")
    # every key is a real step, or the printout drops the note without raising - the «flag the parser
    # accepts and the dispatcher drops» family, one level up
    keys = {step.key for step in update.plan()}
    unknown = sorted(set(snapshot.SHEET_REFRESHES) - keys)
    assert not unknown, f"SHEET_REFRESHES names steps that do not exist: {unknown}"
    # ...and each one says WHICH SLICE, because «re-read» without «how much» is what was wrong before
    assert all(why.strip() for why in snapshot.SHEET_REFRESHES.values())
