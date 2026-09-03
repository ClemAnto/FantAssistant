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
    sheets = [params for name, params in calls if name == "snapshot"]
    assert len(sheets) == len(leagues)
    assert [one["league"] for one in sheets] == leagues
    assert [one["refresh"] for one in sheets] == [True] + [False] * (len(leagues) - 1)


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
