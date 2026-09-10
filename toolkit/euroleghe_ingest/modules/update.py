"""update - the whole update, in ONE order: from the network to the bundle the app reads.

Why this module exists. The order of an update is not free - it is the `DEPENDS_ON` graph (spec,
«Dipendenze e ri-derivazioni») - and it lived in three places none of which can be executed: the spec,
`bootstrap`'s docstring, and the memory of whoever had read one of the two. An order you remember is an
order you eventually get wrong, and getting it wrong does not raise: it produces sheets built on a stale
input, which is the defect this project has already paid for («a chain that feeds a chain must be re-run
as a chain», and `mv_synth` was stale so the arrivals layer worked on a third of its input).

So there is no new step here. There are the steps that already exist, in declared PHASES, each with its
rough cost, and `--plan` prints them without touching anything.

THE ACQUISITION IS NOT REDEFINED. It is `bootstrap.plan(refresh=True)`, one definition, because two
lists of the same order drift and the first one to be wrong would be the one the button runs. The
`refresh` is the whole difference between the two questions: `bootstrap` fills an empty cache, an update
has to RE-READ what changed in the meantime - an August friendly, a postponed fixture, today's squad
page - and on those layers a cache without an expiry is a freeze and not a saving.

WHAT IS DELIBERATELY NOT A PHASE, and why:
  * `rebuild`. It DROPS every table and its offline chain does not cover `recent_form`, `performance`
    and `fixtures`: running it inside an update would empty three tables to refill two. It is the right
    command when the SCHEMA changes, and then it is an explicit choice - followed by those three
    modules, which read the cache and cost no network.
  * the PUBLICATION. `npm run deploy:pages` pushes to a PUBLIC branch: that is an outward-facing action
    and does not belong to a button called «update everything». The `app` phase stops at `data:pull`,
    which is a local copy - and without it the app reads an older SHAPE of the same bundle, a defect
    already paid for once (a folder added to the export and not to the pull).
  * the HARNESSES. `backtest`, `sweep`, `estimates`, `zeros` judge code, not data: a run that changed no
    rule cannot change a verdict, and putting them here would mean re-running the gate to refresh a
    listone.

TWO THINGS THE PHASES KNOW ABOUT EACH OTHER, because they are the reason an order exists at all:
  * the editorial reading is taken ONCE. The sheets refresh the probabili on the FIRST league and the
    others read that reading: the cache key is the DAY, so three refreshes in one run would overwrite
    each other anyway - and one read per run is what the file can honestly carry (a 20:45 kick-off
    reading the 15:00 state is a known limit, not a thing to hide behind three reads).
  * a failed sheet is louder than a missing one. `export` picks the NEWEST sheet per league, so a league
    whose sheet failed still travels in the bundle - with YESTERDAY's numbers. The summary says so by
    name; a stale sheet that looks fresh is the «displayed list whose figures describe a different list»
    family, and the only cure is to state it.
"""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass, field

from euroleghe_ingest.context import Context
from euroleghe_ingest.modules import bootstrap, load

NAME = "update"
DESCRIPTION = "Update everything in dependency order: acquire -> derive -> sheets -> packs -> bundle"
DEPENDS_ON: list[str] = []
RAW_INPUTS: list[str] = []
NETWORK = True

# How many consecutive failures abandon the ACQUISITION phase. «A long sweep that starts getting refused
# is a sweep to abandon» (17/08/2026, the 91 cache files): continuing does not reopen the source, and the
# offline half of an update is still worth doing on the data already in hand. Three and not five because
# here every failure is a different SOURCE, not the same one refusing again.
CONSECUTIVE_FAILURES = 3


@dataclass(frozen=True)
class Phase:
    """One block of the update, and what it answers.

    `network` is what makes a phase skippable without a second thought: everything else reads the DB and
    the cache, so the offline preset (every phase but the first) is the common case - after a code change
    the data is fine and only the deliverable is stale.
    """

    key: str
    title: str
    why: str
    network: bool = False


PHASES: tuple[Phase, ...] = (
    Phase("acquire", "Acquisition (network)", network=True,
          why="every source, in dependency order, re-reading what changes: `bootstrap`'s own plan with "
              "the refresh flags on. The long half of the run, and fully resumable"),
    Phase("derive", "Offline derivation",
          why="the tables DERIVED from what just arrived - the calendar map, the synthetic base voto, "
              "the arrivals, the season aggregates of whoever has no listone. A chain, re-run as a chain"),
    Phase("sheets", "The auction sheets",
          why="one sheet per DECLARED league (`config/league_config.json`), because a surplus without "
              "its league is not comparable: the replacement level is teams x squad_slots"),
    Phase("packs", "Time-travel packs",
          why="the engine at the chosen past dates, rebuilt where its sheets are below today's "
              "SHEET_REVISION - a pack at an old revision shows an old engine under a chosen date"),
    Phase("bundle", "The app bundle",
          why="data/export/<season>/: the pruned SQLite, the JSON tables, the sheets, the boards and "
              "the manifest, verified after writing"),
    Phase("app", "The app's own copy",
          why="`npm run data:pull` in app/: a LOCAL copy, never the publication. Without it the app "
              "reads an older shape of the same bundle"),
)

PHASE_KEYS: tuple[str, ...] = tuple(phase.key for phase in PHASES)


@dataclass(frozen=True)
class Step:
    """One step of the plan: a module call, or an ACTION whose work is decided when it runs.

    A step is a module call wherever it can be - then the plan is auditable against the module list, the
    way `bootstrap`'s is. The actions are the steps whose work is not knowable in advance: how many
    leagues are declared, which packs are behind, whether Node exists on this machine.
    """

    key: str
    phase: str
    why: str
    minutes: int = 1
    module: str | None = None
    params: dict = field(default_factory=dict)
    action: str | None = None
    optional: bool = False


# The offline chain. Same order as `rebuild`'s tail, and for the same reason: the calendar map needs both
# platforms, the synthetic voto needs the map, the arrivals need the backfilled clubs. `validate` closes
# it, because a check that runs before the derivations checks the wrong database.
DERIVE: tuple[Step, ...] = (
    Step("stats:derive", "derive", module="stats", action="stats_derive", minutes=2,
         why="season aggregates for the players no listone carries, derived from the votes that just "
             "arrived (`stats.derive_from_ratings` - the module's own run() reads raw files instead)"),
    Step("matchdays", "derive", module="matchdays", minutes=2,
         why="the euro<->real calendar map per league: it needs BOTH platforms, so it comes after both "
             "ratings runs"),
    Step("synth", "derive", module="synth", minutes=6,
         why="re-calibrates the provider rating onto the real base voto on the overlap and refills "
             "mv_synth. The overlap moved, so the line moved"),
    Step("arrivals", "derive", module="arrivals", minutes=2,
         why="a roster diff, so a new listone is a new set of arrivals - and the tier is a percentile "
             "INSIDE a listone, which is why it is re-derived and not patched"),
    Step("validate", "derive", module="validate", minutes=1,
         why="integrity checks on what the run just wrote, before anything is built on top of it"),
)

DELIVER: tuple[Step, ...] = (
    Step("sheets", "sheets", action="sheets", minutes=24,
         why="`snapshot --league NAME` for every declared league. The first one refreshes the "
             "probabili/indisponibili; the others read that same reading"),
    Step("packs", "packs", action="packs", minutes=20,
         why="`timepack`: builds the dates that are missing and rebuilds the ones whose sheets are "
             "behind today's revision"),
    Step("bundle", "bundle", module="export", minutes=3,
         why="`export`: the bundle, with its own verification pass"),
    Step("pull", "app", action="pull", minutes=1, optional=True,
         why="`npm run data:pull`: the app's copy of the bundle it was just handed"),
)


# THE DAILY PRESET: what a run made ON THE DAY OF A SESSION actually has to pay for.
#
# It is a SELECTION of the one order above and not a second list - same discipline as `--offline`,
# and the same reason: two lists of the same steps drift, and the first one to be wrong is the one
# the button runs. A key here that is not a step of `plan()` is a preset that silently gets shorter,
# which is the «flag the parser accepts and the dispatcher drops» family; a test asserts the subset.
#
# The criterion is NOT the cost, it is WHAT THE STEP OBSERVES: a fact about TODAY that is lost if
# nobody looks today, or one that moves between one day and the next. Everything left out is a fact
# that is FINISHED (a played round's votes, a badge) or an ARCHIVE whose unit is the week (the injury
# history, the market curve, the per-match layer) - and «a cache over a fact that is finished can live
# forever» is exactly what makes leaving them out a saving rather than a gamble.
#
# ...and there is a THIRD state, which is the one this preset used to hide: a step left out whose fact
# the SHEETS step re-reads a slice of by itself, because a sheet cannot be built on a squad or a
# listone from last week. `snapshot.SHEET_REFRESHES` names them and `--daily` prints them, so the
# operator plans the next run on what really happened - a preset that promises LESS than it does is
# the mirror of one that quietly skips, and costs the same wrong decision.
#
# THE DERIVATION IS DELIBERATELY OUT, and that is a claim about the graph rather than a preference:
# `stats:derive`, `matchdays` and `synth` read `match_ratings`, `external_match_stats`,
# `external_stats` and `matchday_map` - not one of which a daily step writes. So on a run that does
# not re-read the votes they reproduce yesterday's tables, and cost thirteen minutes to do it. The
# same argument puts the PACKS out: a time-travel pack is rebuilt when SHEET_REVISION moves, which is
# a code change and not a day.
#
# `arrivals` IS in that list of steps and is NOT in that argument, and the difference is worth the
# line: it reads `rosters`, which the sheets step DOES write, because `snapshot.refresh_official_
# sources` re-reads the target season's listone before building anything. So it is left out as a
# STEP and re-derived anyway, by whoever made it stale - see `snapshot.SHEET_REFRESHES`, which is
# what `--daily` prints so the operator is not told the fact went untouched.
#
# What is left out is left out LOUDLY (`--daily` prints it), because a preset that quietly skips the
# archives reads exactly like a full update that found nothing to do.
DAILY: dict[str, str] = {
    "fc_site": "today's editorial pages, all FIVE of them. THE daily fact: the page publishes only "
               "«now», so a day not captured is gone - and it is the fast channel the app draws its "
               "alarms from. Two of the five overlap with what the sheets refresh by themselves "
               "(`snapshot.refresh_editorial` takes probabili + indisponibili for Serie A); the step "
               "stays because the other three - `rigoristi` and the two EURO pages - are taken here "
               "and nowhere else, and they are snapshots too. Two downloads of one page is the price",
    "positions:roles": "the granular real role AND the live squad, one request per club. The provider "
                       "accepts a seasonId and ignores it, so this is an observation of TODAY; and the "
                       "squad read is the authority on who is in a squad (operator, 17/08/2026)",
    "fixtures": "each club's upcoming matches. A postponement moves a match by weeks, and both the "
                "easy-matches count and the calendar margin are read off it",
    "elo": "one request per auction date - and during a season in progress that date is TODAY, so a "
           "new day is a new snapshot of every club's strength",
    "sheets": "the deliverable: a sheet per declared league, built on the four readings above",
    "bundle": "data/export/<season>/, which is the only thing the app can read",
    "pull": "the app's own copy. Without it the app reads an older shape of the same bundle",
}


def plan(phases: tuple[str, ...] | None = None, *, seasons: tuple[str, ...] | None = None,
         refresh: bool = True, daily: bool = False) -> tuple[Step, ...]:
    """The whole update, in order. `phases` selects; everything else is fixed by the dependency graph.

    `refresh` goes straight to `bootstrap.plan`, so the two commands share ONE acquisition order and
    differ only in whether they re-read what has changed since the cache was written.

    `daily` is a SELECTION of this same order (see `DAILY`), never a second one - so a step renamed
    here is renamed there, and the preset cannot quietly get shorter.
    """
    wanted = set(phases) if phases else set(PHASE_KEYS)
    unknown = wanted - set(PHASE_KEYS)
    if unknown:
        raise RuntimeError(f"unknown phase(s) {sorted(unknown)}; declared: {', '.join(PHASE_KEYS)}")
    steps: list[Step] = []
    if "acquire" in wanted:
        steps += [Step(key=one.key, phase="acquire", why=one.why, minutes=one.minutes,
                       module=one.module, params=dict(one.params), optional=one.optional)
                  for one in bootstrap.plan(seasons, refresh=refresh)]
    steps += [one for one in DERIVE + DELIVER if one.phase in wanted]
    if daily:
        steps = [one for one in steps if one.key in DAILY]
    return tuple(steps)


def hours(minutes: int) -> str:
    return f"{minutes // 60}h{minutes % 60:02d}" if minutes >= 60 else f"{minutes} min"


def print_plan(ctx: Context | None, steps: tuple[Step, ...]) -> None:
    """Print the plan, grouped by phase, with what each ACTION would actually do.

    An action's work is read from the machine it is about to run on - which leagues are declared, which
    packs are behind - because a plan that says «the sheets» and then builds one is a plan nobody can
    check against the run that follows it.
    """
    total = sum(step.minutes for step in steps)
    phases = len({step.phase for step in steps})
    print(f"[update] {len(steps)} steps in {phases} phase(s), about {hours(total)} of mostly polite "
          f"waiting. Every step is resumable: what is already cached is not downloaded again.")
    print("[update] ONE session owns the DB (acquisitions, snapshot, export). Close the other one "
          "first, or the two of you meet on the write lock.\n")
    for phase in PHASES:
        mine = [step for step in steps if step.phase == phase.key]
        if not mine:
            continue
        tag = " · network" if phase.network else ""
        print(f"  {phase.title.upper()}  ~{hours(sum(step.minutes for step in mine))}{tag}")
        print(f"      {phase.why}")
        for step in mine:
            options = " ".join(f"{key}={value}" for key, value in sorted(step.params.items()) if value)
            note = " (optional)" if step.optional else ""
            print(f"    - {step.key:22} ~{step.minutes:4} min  "
                  f"{step.module or step.action} {options}{note}")
            print(f"          {step.why}")
        for line in _detail(ctx, phase.key):
            print(f"          {line}")
        print()


def _detail(ctx: Context | None, phase: str) -> list[str]:
    """What an action phase would do HERE - or why it cannot say. Never raises: this is a report."""
    if ctx is None or ctx.conn is None:
        return []
    try:
        if phase == "sheets":
            names = list(ctx.config.my_leagues())
            return [f"declared leagues: {', '.join(names)} ({len(names)} sheets)"]
        if phase == "packs":
            timepack, snapshot = load("timepack"), load("snapshot")
            dates = [one["date"] for one in timepack.wanted_dates(ctx)[1]]
            stale = timepack.outdated(ctx)
            return [f"dates: {', '.join(dates) or 'none'}",
                    f"behind revision {snapshot.SHEET_REVISION}: {', '.join(stale) or 'none'}"]
        if phase == "app":
            return ["npm found" if shutil.which("npm") else
                    "npm NOT on PATH - the bundle is written, the app's copy is not"]
    except Exception as exc:                       # noqa: BLE001 - a report never fails a run
        return [f"(cannot say yet: {type(exc).__name__}: {exc})"]
    return []


# ------------------------------------------------------------------ the actions
def _run_stats_derive(ctx: Context) -> None:
    load("stats").derive_from_ratings(ctx)


def _run_sheets(ctx: Context) -> None:
    """One sheet per declared league: the editorial reading taken once, the LISTONE once per platform.

    `refresh` on the first league only: the probabili cache is keyed on the DAY, so three refreshes in
    one run overwrite each other and cost three downloads for one fact. The order is the file's own, so
    the league that gets the fresh read is the one the operator declared first.

    ...AND THAT RULE IS RIGHT FOR FOUR CHANNELS AND WRONG FOR THE FIFTH, found 10/09/2026 by reading a
    run's own log: the probabili, the market, the squad pages and the Elo are facts about a DAY, so one
    reading serves every sheet - but the LISTONE is a fact about a PLATFORM, and the first declared
    league only has one. On a table that declares EuroLeghe first, the euro list was re-read daily and
    the Serie A one was two days old, which the two default sheets said about themselves while nobody
    read it. So the platforms the first sheet did not cover get their listone topped up here, by name:
    one login and one request each, the cheapest of the refreshes.
    """
    snapshot = load("snapshot")
    leagues = ctx.config.my_leagues()
    covered: set[str] = set()
    for index, (name, setup) in enumerate(leagues.items()):
        if ctx.cancelled():
            print("[update] cancelled - the sheets already written are kept")
            return
        platform = setup["platform"]
        if index and platform not in covered:
            print(f"\n[update] the {platform} listone is not the one the first sheet "
                  f"re-read: topping it up, because a listone is a fact about a PLATFORM")
            for note in snapshot.refresh_listone_for_platform(ctx, platform):
                print(f"[update] {note}")
        head = " (refreshing the editorial pages)" if index == 0 else ""
        print(f"\n[update] sheet {index + 1}/{len(leagues)}: {name}{head}")
        snapshot.run(ctx, league=name, refresh=(index == 0))
        covered.add(platform)


def _run_packs(ctx: Context) -> None:
    """Build what is missing, then REBUILD only what is behind the current sheet revision.

    Not `--all --refresh`: that rebuilds four packs to fix one, and a pack already at the current
    revision has nothing to gain from being rewritten. Which ones are behind is `timepack.outdated`'s
    answer and not a second reading of it - the same list `--plan` prints.
    """
    timepack = load("timepack")
    stale = timepack.outdated(ctx)
    timepack.run(ctx, build_all=True)
    for date in stale:
        if ctx.cancelled():
            return
        print(f"\n[update] pack {date}: below the current sheet revision - rebuilding it")
        timepack.run(ctx, date=date, refresh=True)


def _run_pull(ctx: Context) -> None:
    """`npm run data:pull` in app/. Node is the APP's toolchain, so its absence is a note, not a failure.

    A string with `shell=True` and not a list: on Windows npm is a `.cmd`, and a list handed to a shell
    gets re-split on spaces - which is how a commit message once became three unknown pathspecs
    (`app/scripts/deploy-pages.mjs` carries the same warning at its own call site).
    """
    app = ctx.config.repo_root / "app"
    if shutil.which("npm") is None or not (app / "package.json").exists():
        print("[update] note: npm not found (or no app/) - the bundle is written and the app's copy is "
              "not. Run `npm run data:pull` in app/ before opening it.")
        return
    done = subprocess.run("npm run data:pull", cwd=app, shell=True, check=False,
                          capture_output=True, text=True)
    for line in (done.stdout or "").splitlines() + (done.stderr or "").splitlines():
        print(f"  {line}")
    if done.returncode != 0:
        raise RuntimeError(f"npm run data:pull exited {done.returncode}")


ACTIONS = {"stats_derive": _run_stats_derive, "sheets": _run_sheets, "packs": _run_packs,
           "pull": _run_pull}


def run(ctx: Context, *, phases: tuple[str, ...] | None = None, plan_only: bool = False,
        offline: bool = False, daily: bool = False, steps_from: str | None = None,
        steps_to: str | None = None, skip: tuple[str, ...] = (), seasons=None,
        refresh: bool = True, **kwargs) -> dict:
    """Run the update. `plan_only` prints the plan and touches nothing.

    A failure does not end the run: it is caught, named and carried to the SUMMARY, because stopping at
    the first hiccup means the operator gets nothing out of a night's work - and because the offline half
    is still worth doing on the data already in hand. The one exception is the acquisition phase, which
    is abandoned after `CONSECUTIVE_FAILURES` in a row: at that point the network is the problem and
    grinding on can only damage what is on disk.
    """
    if isinstance(phases, str):
        phases = (phases,)
    # `offline` is a NAME for a selection, not a second mechanism: every phase but the network one,
    # and an explicit --phase always wins over it (a flag that silently overrides the more specific one
    # is how a run comes out different from what was asked for).
    if phases is None and offline:
        phases = tuple(key for key in PHASE_KEYS if key != "acquire")
    if isinstance(seasons, str):
        seasons = (seasons,)
    steps = plan(tuple(phases) if phases else None,
                 seasons=tuple(seasons) if seasons else None, refresh=refresh, daily=daily)

    keys = [step.key for step in steps]
    for name, value in (("--from", steps_from), ("--to", steps_to)):
        if value and value not in keys:
            raise RuntimeError(f"{name}={value!r} is not a step. Steps: {', '.join(keys)}")
    start = keys.index(steps_from) if steps_from else 0
    stop = keys.index(steps_to) + 1 if steps_to else len(steps)
    selected = tuple(step for step in steps[start:stop] if step.key not in skip)

    print_plan(ctx, selected)
    if daily:
        _print_what_daily_leaves_out()
    if plan_only:
        return {"steps": [step.key for step in selected], "planned": True}

    done: list[str] = []
    failed: list[tuple[str, str]] = []
    consecutive = 0
    abandoned = False
    for index, step in enumerate(selected, start=1):
        if ctx.cancelled():
            print("\n[update] cancelled - every completed step is kept, rerun to continue")
            break
        if abandoned and step.phase == "acquire":
            continue
        print(f"\n[update] === {index}/{len(selected)} · {step.phase} · {step.key} ===", flush=True)
        try:
            if step.action:
                ACTIONS[step.action](ctx)
            else:
                load(step.module).run(ctx, **step.params)
            if ctx.conn is not None:
                ctx.conn.commit()
            done.append(step.key)
            consecutive = 0
        except NotImplementedError as exc:
            print(f"[update] {step.key}: skipped ({exc})")
        except KeyboardInterrupt:
            print(f"[update] interrupted during {step.key} - rerun to continue from here")
            break
        except Exception as exc:                              # noqa: BLE001 - see the docstring
            failed.append((step.key, f"{type(exc).__name__}: {exc}"))
            print(f"[update] XX {step.key}: {type(exc).__name__}: {exc}")
            if step.phase != "acquire":
                continue
            consecutive += 1
            if consecutive >= CONSECUTIVE_FAILURES:
                abandoned = True
                print(f"[update] {consecutive} sources in a row refused - abandoning the acquisition "
                      f"and going on with what is already on disk. A sweep that starts getting refused "
                      f"does not reopen the source by continuing.")
    return _summary(selected, done, failed, abandoned)



def _print_what_daily_leaves_out() -> None:
    """Name the archives the preset skips, and the cadence that is now the operator's to keep.

    A preset that quietly skips them reads exactly like a full update that found nothing to do - the
    «zero that is indistinguishable from a broken feature» this project keeps paying for. So the run
    says what it did NOT read, in the same breath as what it did.
    """
    from euroleghe_ingest.modules.snapshot import SHEET_REFRESHES

    left = [one for one in plan() if one.key not in DAILY]
    cost = sum(one.minutes for one in left)
    print(f"[update] --daily: {len(left)} steps LEFT OUT (~{hours(cost)}), because their fact is "
          f"finished or its unit is the week, not the day:")
    print(f"      {', '.join(one.key for one in left)}")
    # ...and of those, the ones the SHEETS step re-reads a SLICE of by itself. Naming them is the
    # point: «left out» and «read in full» are not the only two states, and a preset that promises
    # LESS than it does makes the next run be planned on a false picture exactly like one that
    # promises more. The list belongs to `snapshot`, because that is where the calls are.
    covered = [one for one in left if one.key in SHEET_REFRESHES]
    if covered:
        print(f"[update] ...but {len(covered)} of them have a SLICE re-read by the sheets step "
              f"itself, before each sheet is built:")
        for one in covered:
            print(f"      {one.key:16} {SHEET_REFRESHES[one.key]}")
    print("[update] what NO daily step re-reads is the VOTES and the season aggregates, so the "
          "derivation that stands on them (stats:derive, matchdays, synth) would reproduce "
          "yesterday's tables. Run the full `update` when a round has been played, or when "
          "SHEET_REVISION moved (the packs).\n")


def _summary(selected, done: list[str], failed: list[tuple[str, str]], abandoned: bool) -> dict:
    """Say what ran, what did not, and the one consequence that is not obvious from the list."""
    print(f"\n[update] {len(done)}/{len(selected)} steps done.")
    if abandoned:
        print("[update] the acquisition was ABANDONED after consecutive refusals: the data is as fresh "
              "as the last successful source, and the deliverable was built on it.")
    for key, why in failed:
        print(f"[update] FAILED  {key}: {why}")
    # The one non-obvious consequence: `export` takes the NEWEST sheet per league, so a league whose
    # sheet failed still travels - carrying the sheet from BEFORE this run. Nothing downstream can see
    # that, and the app would show yesterday's numbers under today's date.
    if any(key == "sheets" for key, _why in failed) and "bundle" in done:
        print("[update] WARNING: a sheet failed and the bundle picks the NEWEST sheet per league, so the "
              "app may be reading yesterday's numbers for that league. Rebuild it before an auction.")
    return {"steps": len(selected), "done": done, "failed": failed, "abandoned": abandoned}
