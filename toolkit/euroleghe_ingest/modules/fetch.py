"""fetch - what is missing here, and the one manual path that remains.

`--plan`   a status report: which sources are populated, which are empty, and the exact command that
           fills each gap. It replaces the original plan (a `whitelist_request.md` to send to a
           workspace administrator), which is obsolete: every domain the toolkit needs answers today,
           so the question is no longer "may we?" but "what is still missing on this machine?".
`--inbox`  import files dropped in data/inbox/ into data/raw/. The Drive roster exports are the
           user's own files and are not on the public web, so this is the only manual step in the
           project - and it is OPTIONAL: the authenticated listone builds the registry without them.
`--run`    deliberately not implemented: downloading belongs to each module, because each has its own
           auth, rate limit and cache. `bootstrap` is the ordered acquisition.

Nothing here touches the network.
"""

from __future__ import annotations

import shutil

from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import table_names
from euroleghe_ingest.modules.base import not_implemented
from euroleghe_ingest.sources import SEASON_SOURCES

NAME = "fetch"
DESCRIPTION = "Status of the sources (--plan) and import of manual downloads (--inbox)"
DEPENDS_ON: list[str] = []
RAW_INPUTS: list[str] = []
NETWORK = False

# (table, the command that fills it, what it is for). In pipeline order.
COVERAGE: tuple[tuple[str, str, str], ...] = (
    ("players", "ratings / rosters", "the registry, fc_id as primary key"),
    ("rosters", "ratings (listone) or rosters (Drive files)", "roles + the pre-auction price"),
    ("season_stats", "stats / ratings", "pv/mv/fm per platform"),
    ("match_ratings", "ratings --platform euro|default", "per-matchday votes (authenticated Excel)"),
    ("external_stats", "positions --layer season", "the full real season of the 4 foreign leagues"),
    ("external_match_stats", "positions --layer match", "the per-match layer (hours)"),
    ("club_match_lineups", "positions --layer match", "how many players per line a club fields"),
    ("matchday_map", "matchdays", "euro <-> real calendar, per league"),
    ("positions", "positions --layer reparse|heatmap", "the real role, and avg_x/avg_y"),
    ("coaches", "transfers", "coach spells -> the new_coach flag"),
    ("transfers_history", "transfers", "where an arrival came from, and for how much"),
    ("injuries", "injuries --layer all", "dated absences (hours, resumable)"),
    ("club_elo", "elo", "club strength at the auction dates"),
    ("probable_starter", "fc_site (weekly!)", "starting probability - the history cannot be backfilled"),
    ("availability", "fc_site", "injured / suspended, dated"),
    ("penalty_hierarchy", "fc_site", "who takes the penalties (revealed from our own votes)"),
    ("tournaments_squads", "tournaments", "who actually played at a tournament"),
    ("arrivals", "arrivals", "the roster diff: tier + foreign FM-equivalent"),
    ("flags", "transfers / positions / arrivals / injuries", "the derived booleans"),
)


def import_inbox(ctx: Context) -> int:
    """Copy the recognised Drive exports from data/inbox to data/raw. Returns how many landed."""
    inbox, raw = ctx.config.inbox_dir, ctx.config.raw_dir
    inbox.mkdir(parents=True, exist_ok=True)
    raw.mkdir(parents=True, exist_ok=True)
    wanted = {filename for _season, filename, _fmt in SEASON_SOURCES}
    wanted.add("elo-asta-mappa-club.csv")   # the legacy Elo seed, now optional (the API replaced it)
    moved = 0
    for path in sorted(inbox.iterdir()):
        if not path.is_file():
            continue
        if path.name not in wanted:
            print(f"[fetch] {path.name}: not a known source name - left in the inbox")
            continue
        shutil.copy2(path, raw / path.name)
        moved += 1
        print(f"[fetch] {path.name} -> data/raw/")
    if not moved:
        print(f"[fetch] nothing to import from {inbox}. Known names: {', '.join(sorted(wanted))}")
    return moved


def status(ctx: Context) -> list[tuple[str, int, str, str]]:
    """(table, rows, command, what) for every table of the coverage list."""
    conn = ctx.conn
    existing = set(table_names(conn)) if conn is not None else set()
    out = []
    for table, command, what in COVERAGE:
        rows = 0
        if table in existing:
            rows = conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        out.append((table, rows, command, what))
    return out


def print_plan(ctx: Context) -> None:
    raw_present = [filename for _season, filename, _fmt in SEASON_SOURCES
                   if (ctx.config.raw_dir / filename).exists()]
    cache_files = len(list(ctx.config.cache_dir.glob("*"))) if ctx.config.cache_dir.exists() else 0
    print(f"[fetch] raw files: {len(raw_present)}/{len(SEASON_SOURCES)} Drive exports present "
          f"(optional) · cache: {cache_files} files")
    rows = status(ctx)
    empty = [row for row in rows if row[1] == 0]
    for table, count, command, what in rows:
        mark = "  " if count else "!!"
        print(f" {mark} {table:22} {count:>9,} rows   {what}")
        if not count:
            print(f"      -> run: python -m euroleghe_ingest {command}")
    if empty:
        print(f"\n[fetch] {len(empty)} empty table(s). On a fresh machine the whole sequence is "
              "`bootstrap --plan`, which prints the order and what it costs.")
    else:
        print("\n[fetch] every source is populated.")


def run(ctx: Context, *, plan: bool = False, do_run: bool = False, inbox: bool = False) -> None:
    if inbox:
        import_inbox(ctx)
        return
    if do_run:
        raise not_implemented(
            NAME, "downloading belongs to each module (its own auth, rate limit and cache); "
                  "run `bootstrap` for the ordered acquisition")
    print_plan(ctx)
