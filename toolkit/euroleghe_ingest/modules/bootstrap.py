"""bootstrap - build the whole database from nothing, on a machine that has never seen this project.

The problem this solves. `rebuild` is deliberately OFFLINE: it replays data/cache/ and data/raw/, which
is what makes the DB rebuildable "from scratch" on THIS machine. On a fresh clone both folders are
empty, so rebuild produces an empty DB - correctly, and uselessly. What was missing was the other
half: the ordered ACQUISITION, with each module's options, because the order is not free (identity
resolution needs the registry, the calendar map needs both platforms, the synthetic voto needs the
map) and because two of the steps take hours.

So this module is the plan, executable and resumable:

    python -m euroleghe_ingest bootstrap --plan     # print the plan, touch nothing
    python -m euroleghe_ingest bootstrap            # run it, skipping what is already cached
    python -m euroleghe_ingest bootstrap --from ratings --to positions:season

Every step is a normal module call with explicit options - nothing here can do something the CLI
cannot - and every network module caches its raw response, so an interrupted bootstrap continues
where it stopped and the final `rebuild` is offline by construction.

WHAT CANNOT BE DOWNLOADED, and what happens then:
  * fantacalcio.it needs CREDENTIALS in .env (see .env.example). Without them there is no listone and
    no votes, and therefore no registry: the bootstrap refuses to start rather than build half a DB.
  * the Drive roster exports (data/raw/*.csv|xlsx) are the user's own files and are NOT on the public
    web. They are an ENRICHMENT, not a prerequisite: the listone creates players/clubs/rosters and
    `stats.derive_from_ratings` derives the euro season aggregates from the votes. If you have them,
    drop them in data/inbox/ and run `fetch --inbox` first - the result is identical to this machine's.
  * FBref is behind Cloudflare (403 on every path, TLS impersonation included). SofaScore replaced it
    as the source of the facts; `fbref` stays a stub on purpose.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from euroleghe_ingest.context import Context
from euroleghe_ingest.modules import load

NAME = "bootstrap"
DESCRIPTION = "Acquire everything from zero, in order (resumable) - then rebuild and validate"
DEPENDS_ON: list[str] = []
RAW_INPUTS: list[str] = []
NETWORK = True


@dataclass(frozen=True)
class Step:
    """One acquisition step: a module call with fixed options, and what it is for.

    `minutes` is a rough measured cost on a normal connection, printed so nobody starts the two long
    steps by accident. `optional` steps are skipped without failing the run when their prerequisite
    is missing (credentials, a stub module).
    """

    key: str
    module: str
    why: str
    params: dict = field(default_factory=dict)
    minutes: int = 1
    optional: bool = False


def plan(seasons: tuple[str, ...] | None = None) -> tuple[Step, ...]:
    """The acquisition order. Each step's comment says why it cannot move earlier."""
    listone_seasons = list(seasons) if seasons else None
    return (
        Step("inbox", "fetch", optional=True, minutes=1,
             params={"inbox": True},
             why="import the Drive roster exports if the operator dropped them in data/inbox "
                 "(optional: the listone can build the registry on its own)"),
        Step("rosters", "rosters", minutes=1,
             why="the registry, if raw files are present. ALWAYS first - fc_id is the primary key"),
        Step("stats", "stats", minutes=1,
             why="euro season aggregates from the same raw files (also derived from votes later)"),
        Step("ratings:default", "ratings", minutes=45,
             params={"platform": "default", "seasons": listone_seasons},
             why="authenticated Excel: classic Serie A votes + THE LISTONE, which is what creates "
                 "players/clubs/rosters when there are no Drive files"),
        Step("ratings:euro", "ratings", minutes=45,
             params={"platform": "euro", "seasons": listone_seasons},
             why="the euro platform: the FM/Mv TARGET, on its own calendar"),
        Step("positions:season", "positions", minutes=10,
             params={"layer": "season"},
             why="SofaScore season facts for the 5 leagues -> external_stats, player_xref, and the "
                 "league of every club (which the euro listone does not carry)"),
        Step("transfers", "transfers", minutes=20,
             why="club ids, coach spells (new_coach) and the transfer market with fees"),
        Step("elo", "elo", minutes=1,
             why="ClubElo: one request per auction date, every club in Europe"),
        Step("fc_site", "fc_site", minutes=1,
             why="today's probabili/indisponibili snapshot + the revealed penalty hierarchy. "
                 "The HISTORY of this one can only accumulate from now on: schedule "
                 "scripts/weekly-snapshot.ps1"),
        Step("tournaments", "tournaments", minutes=10,
             why="who actually played at the tournament -> the post-tournament flag"),
        Step("positions:match", "positions", minutes=420,
             params={"layer": "match"},
             why="THE LONG ONE: the per-match layer, rounds -> lineups. Propensity, the inactivity "
                 "proxy, the real role, the lineup counts. Resumable - stop and rerun"),
        Step("positions:complete", "positions", minutes=180,
             params={"layer": "complete"},
             why="the matches the perimeter filter skipped: without it a non-perimeter club is "
                 "measured on its hardest half only (bias 0.05 to 0.22 of FM-equivalent)"),
        Step("injuries:ids", "injuries", minutes=25,
             params={"layer": "ids"},
             why="Transfermarkt squad pages: player ids + the contract-expiry snapshot"),
        Step("injuries", "injuries", minutes=180,
             params={"layer": "injuries"},
             why="THE OTHER LONG ONE: the injury history, one request per player. Resumable"),
        Step("recent_form", "recent_form", minutes=90,
             params={},
             why="the last matches of the players with no history (the ones an auction overpays)"),
    )


# The offline chain that turns the cache into the DB. `rebuild` already runs it in the right order,
# and running it here means a bootstrap ends with a database that a plain `rebuild` reproduces.
FINAL_STEP = "rebuild"


def _credentials_present() -> bool:
    """The one hard prerequisite. Read like `ratings` reads it, so the check cannot disagree with it."""
    from dotenv import load_dotenv

    load_dotenv()
    return bool(os.environ.get("FANTACALCIO_USERNAME") and os.environ.get("FANTACALCIO_PASSWORD"))


def print_plan(steps: tuple[Step, ...]) -> None:
    total = sum(step.minutes for step in steps)
    print(f"[bootstrap] {len(steps)} steps, about {total // 60}h{total % 60:02d} of mostly polite "
          f"waiting. Everything is cached, so an interrupted run continues where it stopped.\n")
    for index, step in enumerate(steps, start=1):
        options = " ".join(f"{key}={value}" for key, value in sorted(step.params.items()) if value)
        tag = " (optional)" if step.optional else ""
        print(f"  {index:2}. {step.key:20} ~{step.minutes:4} min  {step.module} {options}{tag}")
        print(f"      {step.why}")
    print(f"\n  {len(steps) + 1:2}. {FINAL_STEP:20} ~   5 min  offline: raw cache -> the database, "
          "then validate")
    print("\n[bootstrap] then, before an auction: `export` for the app bundle, and schedule "
          "scripts/weekly-snapshot.ps1 (the probabili history cannot be backfilled).")


def run(ctx: Context, *, steps_from: str | None = None, steps_to: str | None = None,
        seasons=None, dry_run: bool = False, skip: tuple[str, ...] = (), **kwargs) -> None:
    """Run the acquisition plan. `--plan` prints it and touches nothing."""
    if isinstance(seasons, str):
        seasons = (seasons,)
    steps = plan(tuple(seasons) if seasons else None)
    keys = [step.key for step in steps]
    for name, value in (("--from", steps_from), ("--to", steps_to)):
        if value and value not in keys:
            raise RuntimeError(f"{name}={value!r} is not a step. Steps: {', '.join(keys)}")
    start = keys.index(steps_from) if steps_from else 0
    stop = keys.index(steps_to) + 1 if steps_to else len(steps)
    selected = [step for step in steps[start:stop] if step.key not in skip]

    if dry_run:
        print_plan(steps)
        return

    if not _credentials_present():
        raise RuntimeError(
            "fantacalcio.it credentials are missing: copy .env.example to .env and fill "
            "FANTACALCIO_USERNAME / FANTACALCIO_PASSWORD. Without them there is no listone and no "
            "votes, which means no registry - a half-built DB is worse than none.")

    print_plan(tuple(selected))
    print()
    done: list[str] = []
    for index, step in enumerate(selected, start=1):
        if ctx.cancelled():
            print("[bootstrap] cancelled - every completed step is cached, rerun to continue")
            break
        print(f"\n[bootstrap] === step {index}/{len(selected)}: {step.key} ===")
        try:
            load(step.module).run(ctx, **step.params)
            if ctx.conn is not None:
                ctx.conn.commit()
            done.append(step.key)
        except NotImplementedError as exc:
            if not step.optional:
                raise
            print(f"[bootstrap] {step.key}: skipped ({exc})")
        except KeyboardInterrupt:
            print(f"[bootstrap] interrupted during {step.key} - rerun to continue from here")
            break
    print(f"\n[bootstrap] {len(done)}/{len(selected)} steps done: {', '.join(done)}")
    print("[bootstrap] now running the offline chain (cache -> database)")
    load(FINAL_STEP).run(ctx)
