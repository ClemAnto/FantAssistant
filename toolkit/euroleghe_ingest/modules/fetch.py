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
    ("press_formations", "press --import FILE --season YYYY-YY",
     "the press's typical XIs, dated - the boards' external judge (optional)"),
)


# ---------------------------------------------------------------------------------------------------
# PER-SEASON coverage. `COVERAGE` above answers «is this source populated at all?» and will happily say
# «every source is populated» while the xG of 2021-22 does not exist and `matchday_map` has no row for
# that season. Non-emptiness is not completeness, and a plan that cannot tell them apart is how a hole
# survives a check that passes.
#
# The hard-won part is NOT the counting - it is the CLASSIFICATION, because three different things look
# identical to a row count, and only one of them is work to do:
#
#   * DECLARED   the column has no source and `validate.ALLOWED_EMPTY` says so (`match_ratings.minutes`
#                is NULL on all 263k rows because the votes Excel does not carry minutes at all; the
#                per-match layer holds them, with its own source tag). Not a gap - a design decision.
#   * CONVENTION the value is absent because it IS zero. Measured, not assumed: of the `external_match_stats`
#                rows with NULL `xg`, 3701 of 3701 carry `shots` = 0, and not one of a season's goals sits
#                on a NULL row - so NULL means «no shot», and every reader already sums
#                `COALESCE(xg, 0)`. Counting those NULLs as missing data overstates the hole by half the
#                table.
#   * SOURCE     the provider does not serve it for that season, so no amount of scraping will produce it.
#                Two are measured and recorded below.
#   * MISSING    genuinely absent and fetchable - the only class that deserves a command.
#
# Written 14/08/2026 after a census that reported three offline «holes» of which inspection dissolved two.
KNOWN_SEASON_GAPS: tuple[tuple[str, str, str, str], ...] = (
    ("match_ratings", "2021-22",
     "euro votes: 17,825 rows carry the events (goals on all of them) and NO vote",
     "the source serves no votes for EuroLeghe 2021-22 - `mv` and `fantavoto` are NULL on every one "
     "of the 17,825 rows, so the hole is the VOTE and counting rows concludes the opposite. NULL and "
     "not 0, which is the distinction the whole «vuoto = ignoto» rule turns on"),
    ("external_match_stats", "<=2021-22",
     "xG/xA absent for every player",
     "the provider's own payload has no expectedGoals: 0 of 446 players in the cached round 1 of "
     "2021-22, against 312 of 471 in 2022-23. Re-downloading cannot add it"),
    ("matchday_map", "2021-22",
     "no euro <-> real alignment",
     "DOWNSTREAM of the votes above, not an independent hole: the alignment matches the euro round's "
     "player signature against the real rounds, and `_signatures` reads rows WITH a vote - of which "
     "that season has none. Verified by running `matchdays`: 890 rows re-derived, zero for 2021-22"),
)

# (table, the command that fills it, what it is for). `{season}` is substituted where the subcommand
# actually ACCEPTS `--season`; the others derive every season in one pass and are quoted bare.
# Checked against the CLI rather than assumed: the first version of this list offered
# `matchdays --season 2021-22`, which does not parse - a report built to stop useless commands cannot
# be the thing that prints one.
SEASON_COVERAGE: tuple[tuple[str, str, str], ...] = (
    ("match_ratings", "ratings --platform euro|default --season {season}", "per-matchday votes"),
    ("season_stats", "stats", "pv/mv/fm per platform (all seasons in one pass)"),
    ("listone_quotes", "ratings --quotes-from-cache", "the quotation, per platform (OFFLINE)"),
    ("rosters", "ratings / rosters", "roles + the pre-auction price"),
    ("external_stats", "positions --layer season --season {season}", "the season aggregate"),
    ("external_match_stats", "positions --layer match --season {season}", "the per-match layer (hours)"),
    ("club_match_lineups", "positions --layer match --season {season}", "the lines a club fields"),
    ("matchday_map", "matchdays", "euro <-> real calendar (all seasons in one pass)"),
    ("positions", "positions --layer reparse --season {season}", "the real role (OFFLINE from cache)"),
    ("arrivals", "arrivals", "the roster diff (all seasons in one pass)"),
    ("flags", "transfers / positions / arrivals / injuries", "the derived booleans"),
)


def _seasons_present(conn, tables) -> list[str]:
    """Every season any of these tables mentions, newest last."""
    found: set[str] = set()
    existing = set(table_names(conn))
    for table, *_ in tables:
        if table not in existing:
            continue
        for (season,) in conn.execute(f'SELECT DISTINCT season FROM "{table}" WHERE season IS NOT NULL'):
            found.add(season)
    return sorted(found)


def season_status(ctx: Context, seasons: list[str]) -> list[tuple[str, dict[str, int]]]:
    """(table, {season: rows}) for the season-shaped tables."""
    conn = ctx.conn
    if conn is None:
        return []
    existing = set(table_names(conn))
    out = []
    for table, _command, _what in SEASON_COVERAGE:
        if table not in existing:
            continue
        counts = {}
        for season in seasons:
            counts[season] = conn.execute(
                f'SELECT COUNT(*) FROM "{table}" WHERE season = ?', (season,)).fetchone()[0]
        out.append((table, counts))
    return out


def print_season_plan(ctx: Context, last: int = 5) -> None:
    """The per-season matrix, with the measured source limits stated instead of counted as work."""
    if ctx.conn is None:
        print("[fetch] no database yet: the per-season report needs one (see `bootstrap --plan`).")
        return
    seasons = _seasons_present(ctx.conn, SEASON_COVERAGE)[-last:]
    if not seasons:
        print("[fetch] no season in the database yet.")
        return
    print(f"\n[fetch] per-season coverage, last {len(seasons)}: {', '.join(seasons)}")
    print("        a hole reads as a COLUMN. Zero rows is not «nothing to take»: it is «not taken».")
    width = max(9, max(len(s) for s in seasons) + 2)
    header = " " * 26 + "".join(f"{s:>{width}}" for s in seasons)
    print(header)
    rows = season_status(ctx, seasons)
    gaps: list[tuple[str, str, str]] = []
    for table, counts in rows:
        cells = "".join(f"{counts[s]:>{width},}" for s in seasons)
        print(f"  {table:24}{cells}")
        command = next(c for t, c, _w in SEASON_COVERAGE if t == table)
        for season in seasons:
            if counts[season] == 0:
                gaps.append((table, season, command))
    votes = dict(rows).get("match_ratings", {})

    print()
    for table, season, note, why in KNOWN_SEASON_GAPS:
        print(f"  [fonte] {table} {season}: {note}")
        print(f"          -> {why}")

    # A season the listone already quotes but nobody has played is NOT a gap: it is the TARGET season,
    # and every fact that can only exist after a ball is kicked is legitimately absent. Printing
    # «run ratings --season 2026-27» in August is the same defect this report exists to cure, one
    # level up - a command that cannot succeed yet, offered as work.
    future = [s for s in seasons if not votes.get(s)]
    for season in future:
        print(f"  [bersaglio] {season}: quotata dal listone e non ancora giocata - i fatti che nascono "
              f"dal campo sono assenti per costruzione, non per omissione")

    declared = {(t, s) for t, s, _n, _w in KNOWN_SEASON_GAPS}
    actionable = [(t, s, c) for t, s, c in gaps
                  if (t, s) not in declared and s not in future]
    if actionable:
        print(f"\n[fetch] {len(actionable)} season-shaped gap(s) that a command can fill:")
        for table, season, command in actionable:
            print(f"   {table} {season} -> python -m euroleghe_ingest "
                  f"{command.format(season=season)}")
    else:
        print("\n[fetch] no season-shaped gap left that a command could fill.")


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


def run(ctx: Context, *, plan: bool = False, do_run: bool = False, inbox: bool = False,
        seasons: int = 0) -> None:
    if inbox:
        import_inbox(ctx)
        return
    if do_run:
        raise not_implemented(
            NAME, "downloading belongs to each module (its own auth, rate limit and cache); "
                  "run `bootstrap` for the ordered acquisition")
    print_plan(ctx)
    if seasons:
        print_season_plan(ctx, last=seasons)
