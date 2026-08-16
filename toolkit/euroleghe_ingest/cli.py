"""euroleghe-ingest CLI. Usage: `python -m euroleghe_ingest <command> [options]`."""

from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import sys

from euroleghe_ingest import __version__
from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db, record_run
from euroleghe_ingest.engine.features import WINDOWS
from euroleghe_ingest.modules import ALL_MODULES, PIPELINE, load


def _argv_detail(args: argparse.Namespace) -> str:
    """The options a run was actually invoked with - the part of provenance a log line can carry."""
    skip = {"command", "report"}
    parts = [f"{key}={value}" for key, value in sorted(vars(args).items())
             if key not in skip and value not in (None, False)]
    return " ".join(parts)[:400]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="euroleghe-ingest",
        description="Data ingestion toolkit for the EuroLeghe prediction engine.",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    # No subcommand -> open the GUI (operator panel).
    sub = parser.add_subparsers(dest="command", required=False, metavar="command")

    sub.add_parser("gui", help="open the operator panel (window)")
    sub.add_parser("initdb", help="apply the schema to an empty DB")

    p_fetch = sub.add_parser("fetch", help=load("fetch").DESCRIPTION)
    p_fetch.add_argument("--plan", action="store_true",
                         help="report which sources are populated and the command that fills each gap")
    p_fetch.add_argument("--run", dest="do_run", action="store_true",
                         help="(not implemented: downloading belongs to each module - see bootstrap)")
    p_fetch.add_argument("--inbox", action="store_true", help="import manual downloads from data/inbox/")
    # Non-emptiness is not completeness: `--plan` alone says «populated» while a whole season of a
    # column is absent. This adds the per-season matrix, and states the gaps the SOURCE cannot fill
    # instead of printing a command that would not work.
    p_fetch.add_argument("--seasons", type=int, nargs="?", const=5, default=0, metavar="N",
                         help="also report per-season coverage for the last N seasons (default 5)")

    sub.add_parser("rebuild", help="rebuild the whole DB from raw files (idempotent)")

    # Build everything from nothing, on a machine that has never seen the project.
    p_boot = sub.add_parser("bootstrap", help=load("bootstrap").DESCRIPTION)
    p_boot.add_argument("--plan", dest="dry_run", action="store_true",
                        help="print the acquisition plan (order, options, cost) and touch nothing")
    p_boot.add_argument("--from", dest="steps_from", metavar="STEP",
                        help="start from this step (see --plan for the names)")
    p_boot.add_argument("--to", dest="steps_to", metavar="STEP", help="stop after this step")
    p_boot.add_argument("--skip", action="append", metavar="STEP", default=[],
                        help="skip a step (repeatable)")
    p_boot.add_argument("--season", action="append", metavar="YYYY-YY",
                        help="limit the votes/listone download to these seasons (repeatable)")

    # Gate harness: read-only on the DB, writes only a report under data/reports/.
    p_backtest = sub.add_parser("backtest", help=load("backtest").DESCRIPTION)
    p_backtest.add_argument("--window", action="append", choices=list(WINDOWS),
                            metavar="|".join(WINDOWS),
                            help="prediction window, oldest to newest (repeatable; default: all). "
                                 "The published gate numbers are T1 and T2 alone.")
    p_backtest.add_argument("--platform", action="append", choices=["euro", "default"],
                            help="euro = EuroLeghe, default = classic Serie A (default: both)")
    p_backtest.add_argument("--game", action="append", choices=["classic", "mantra"],
                            help="role system driving anchors and beta (default: both)")
    p_backtest.add_argument("--rules", default="R0", metavar="R0[,R1,...]",
                            help="candidate rules to switch on (default: R0 = current engine)")
    p_backtest.add_argument("--cases", action="store_true",
                            help="print the regression cases predicted vs actual")
    p_backtest.add_argument("--verify", action="store_true",
                            help="reproduce the published gate numbers before scoring anything")
    p_backtest.add_argument("--auction", action="store_true",
                            help="simulate the auction: per role, the predicted top 10 against the "
                                 "real end-of-season top 10, with the adopted rules")
    p_backtest.add_argument("--gate", action="store_true",
                            help="run the gate: every candidate rule vs the baseline, per role, "
                                 "with parameters fitted on the other window")
    p_backtest.add_argument("--pairs", action="store_true",
                            help="forward-pairs diagnostic: same-club striker groups under the "
                                 "adopted set (outcomes read on T1/T2 only, the burned windows)")
    p_backtest.add_argument("--no-report", dest="report", action="store_false",
                            help="print only, do not write data/reports/engine_backtest.json")

    # The gate's other half: the PROVISIONAL constants of the presence model, swept out of sample.
    p_sweep = sub.add_parser("sweep", help=load("sweep").DESCRIPTION)
    p_sweep.add_argument("--window", action="append", choices=list(WINDOWS),
                         metavar="|".join(WINDOWS),
                         help="prediction window (repeatable; default: every window instrumented "
                              "enough to build the inputs, i.e. input season from 2019-20)")
    p_sweep.add_argument("--platform", action="append", choices=["euro", "default"],
                         help="euro = EuroLeghe, default = classic Serie A (default: both)")
    p_sweep.add_argument("--game", action="append", choices=["classic", "mantra"],
                         help="role system (default: classic - none of these parameters reads a role)")
    p_sweep.add_argument("--no-report", dest="report", action="store_false",
                         help="print only, do not write data/reports/sweep_presence.json")

    # The third question, next to the two gates: does the FALLBACK valuation make the auction list better
    # or worse? It is not a rule and cannot pass a rule's gate - it gives a number where there was none - but
    # since it now RANKS, on a finished window we know whether the men it lets in delivered (gate §7-undecies).
    p_estimates = sub.add_parser("estimates", help=load("estimates").DESCRIPTION)
    p_estimates.add_argument("--platform", action="append", choices=["euro", "default"],
                             help="euro = EuroLeghe, default = classic Serie A (default: both)")
    p_estimates.add_argument("--game", choices=["classic", "mantra"],
                             help="role system the list is ranked in (default: classic)")
    p_estimates.add_argument("--metric", choices=["value", "surplus"],
                             help="the currency the top tens are ranked in (default: surplus)")
    p_estimates.add_argument("--no-report", dest="report", action="store_false",
                             help="print only, do not write data/reports/estimates_check.json")

    # The app's data bundle: read-only on the DB, writes data/export/<season>/.
    p_export = sub.add_parser("export", help=load("export").DESCRIPTION)
    p_export.add_argument("--season", metavar="YYYY-YY",
                          help="the season being auctioned (default: the latest listone)")
    p_export.add_argument("--out", metavar="DIR",
                          help="destination folder (default: data/export/<season>)")
    p_export.add_argument("--format", dest="formats", action="append",
                          choices=["sqlite", "json"],
                          help="bundle format (repeatable; default: both)")
    p_export.add_argument("--history", type=int, default=load("export").DEFAULT_HISTORY,
                          help="how many seasons of the heavy per-match tables to include "
                               f"(default: {load('export').DEFAULT_HISTORY})")
    p_export.add_argument("--no-gzip", dest="compress", action="store_false",
                          help="write the JSON tables uncompressed (easier to diff, ~5x bigger)")
    p_export.add_argument("--no-verify", dest="verify", action="store_false",
                          help="skip the integrity check on the written bundle (not advisable)")

    # Today's auction snapshot: the sheet an initial auction is prepared from.
    p_snap = sub.add_parser("snapshot", help=load("snapshot").DESCRIPTION)
    p_snap.add_argument("--league", metavar="NAME",
                        help="a league you play in, as declared in config/league_config.json: it "
                             "states the platform and the game, so those two are taken from it and "
                             "its squad size fixes the replacement level (default: none, read the two "
                             "dimensions straight)")
    p_snap.add_argument("--platform", choices=["euro", "default"], default="euro",
                        help="euro = EuroLeghe, default = classic Serie A (default: euro). Ignored "
                             "when --league is given")
    p_snap.add_argument("--game", choices=["classic", "mantra"], default="classic",
                        help="role system the sheet is ranked in (default: classic). Ignored when "
                             "--league is given")
    p_snap.add_argument("--season", metavar="YYYY-YY",
                        help="the season being auctioned (default: the latest listone)")
    p_snap.add_argument("--date", metavar="YYYY-MM-DD",
                        help="stand the sheet on this DAY: the last 10 matches are the ten before it "
                             "and every value is measured only up to it (default: today)")
    p_snap.add_argument("--club", action="append", metavar="NAME",
                        help="only these clubs, canonical names (repeatable; default: all)")
    p_snap.add_argument("--out", metavar="DIR", help="destination folder (default: data/reports/...)")
    p_snap.add_argument("--no-refresh", dest="refresh", action="store_false",
                        help="do not fetch today's probabili/indisponibili first (offline run)")

    # The engine at a PAST date, packed for the app's time travel. Few dates and chosen ones: the two
    # days a squad is really the squad - just after each transfer window closes - for the last two
    # seasons. The dates are READ from the transfers layer, never written by hand.
    p_pack = sub.add_parser("timepack", help=load("timepack").DESCRIPTION)
    p_pack.add_argument("--plan", action="store_true",
                        help="list the significant dates, where each comes from, and which are built")
    p_pack.add_argument("--date", metavar="YYYY-MM-DD",
                        help="build this one (must be one of the dates --plan lists)")
    p_pack.add_argument("--all", dest="build_all", action="store_true",
                        help="build every date that is still missing")
    p_pack.add_argument("--refresh", action="store_true",
                        help="rebuild a pack that already exists")

    # One subcommand per pipeline module (single run).
    for name in PIPELINE:
        module = load(name)
        p = sub.add_parser(name, help=getattr(module, "DESCRIPTION", name))
        if name == "ratings":
            p.add_argument("--platform", choices=["euro", "default"], default="euro",
                           help="which platform to import (default: euro)")
            p.add_argument("--season", action="append", metavar="YYYY-YY",
                           help="season to import, e.g. 2024-25 (repeatable; default: all)")
            p.add_argument("--refresh", action="store_true",
                           help="re-download matchdays even if already present")
            p.add_argument("--quotes-from-cache", dest="quotes_from_cache", action="store_true",
                           help="OFFLINE: re-apply every cached listone (one file per platform and "
                                "season) so `listone_quotes` carries the quotation of each listone "
                                "separately - zero requests, no votes touched")
        if name == "market":
            p.add_argument("--limit", type=int, metavar="N",
                           help="only the N most valuable quoted players - which is how a pilot run "
                                "verifies the route before it is paid for on a thousand")
            p.add_argument("--refresh", action="store_true",
                           help="re-download a curve already cached: the series GROWS, so a cached "
                                "file is short rather than wrong, and only the caller knows if it is "
                                "worth re-asking")
            p.add_argument("--from-cache", dest="from_cache", action="store_true",
                           help="OFFLINE: re-read the curves already downloaded, zero requests")
            p.add_argument("--all-seasons", dest="all_seasons", action="store_true",
                           help="everybody ever quoted, not just today's listone: 'quoted today' is a "
                                "SURVIVORSHIP filter, so on a past window the curve only exists for who "
                                "still has a career (7%% of Tm7's quoted against 59%% of T2's) and the "
                                "harness cannot judge the channel on it")
        if name == "recent_form":
            p.add_argument("--season", action="append", metavar="YYYY-YY",
                           help="target listone season (repeatable; default: all but the first)")
            p.add_argument("--matches", type=int, default=10,
                           help="how many recent club matches per player (default: 10)")
            p.add_argument("--no-bonuses", dest="bonuses", action="store_false",
                           help="skip the per-match goals/assists request (5x cheaper, no FM-equivalent)")
            p.add_argument("--bonuses-only", dest="bonuses_only", action="store_true",
                           help="only fetch the goals/assists of matches ALREADY stored - one request "
                                "per match, no identity resolving, no match list re-download")
            p.add_argument("--limit", type=int,
                           help="only the N most expensive players (for a pilot run)")
        if name == "synth":
            p.add_argument("--validate", action="store_true",
                           help="only re-measure the synthetic layer against the Serie A real votes "
                                "(read-only) -> data/reports/mv_synth_validation.json")
        if name == "fixtures":
            p.add_argument("--league", action="append", metavar="LEAGUE",
                           help="only the clubs of this league (repeatable; default: every club with "
                                "a sofascore id)")
            p.add_argument("--refresh", action="store_true",
                           help="re-download: a CALENDAR MOVES, so a cached page can be stale by a "
                                "postponement - without this the cache is used as it is")
            p.add_argument("--pages", type=int, default=3,
                           help="pages of 30 future events per club (default: 3, which covered a whole "
                                "38-round season plus cups on the club it was measured on)")
        if name == "positions":
            p.add_argument("--league", action="append", metavar="LEAGUE",
                           help="league to import, e.g. premier_league (repeatable; default: the 5 "
                                "in scope). A FEEDER league (serie_b) has to be named: only its "
                                "season aggregate is wanted, so a promoted club's men have measured "
                                "starts and minutes instead of none")
            p.add_argument("--season", action="append", metavar="YYYY-YY",
                           help="season to import, e.g. 2024-25 (repeatable; default: all)")
            p.add_argument("--refresh", action="store_true",
                           help="re-download league-seasons even if already present")
            p.add_argument("--days", type=int, metavar="N",
                           help="with --layer extra: how far back to walk a club's non-league matches "
                                "(default 150, i.e. the last ten rounds). The listing is paginated 30 "
                                "events at a time, so a wider window costs one request more per page - "
                                "1100 reaches three seasons and is what the European ties need, since "
                                "one page is barely half a season and the cups of the seasons before "
                                "this one were never asked for (Champions: 1.071 rows in 2025-26, 21 "
                                "in 2024-25)")
            p.add_argument("--layer",
                           choices=["season", "match", "complete", "heatmap", "roles", "all",
                                    "reparse", "crosstab", "extra", "crests"],
                           default="season",
                           help="season aggregates (fast), the per-match layer (hours), "
                                "'complete' to add the matches the perimeter filter skipped, "
                                "'heatmap' for avg_x/avg_y (one request per player-season), "
                                "'roles' for the granular real role + foot (one request per CLUB), "
                                "both, "
                                "'reparse' to rebuild from the cache offline (zero requests), "
                                "'crosstab' for the provider-role vs listone-role report (offline), or "
                                "'extra' for the matches no league calendar has - pre-season "
                                "friendlies, cups, continental ties (one request per club)")
        if name == "press":
            p.add_argument("--import", dest="import_files", action="append", metavar="FILE",
                           help="import a press reference JSON (a list of per-club entries: club, "
                                "module, module_alternatives, typical_xi, ...) as a DATED fact; "
                                "archived under data/raw/press/ so it survives `rebuild`")
            p.add_argument("--season", metavar="YYYY-YY",
                           help="the season the imported XI predicts (required with --import unless "
                                "the file is a self-describing archive)")
            p.add_argument("--observed-on", dest="observed_on", metavar="YYYY-MM-DD",
                           help="the day the press reading was taken (default: today)")
            p.add_argument("--source", metavar="NAME",
                           help="outlet or synthesis name (default: press); with --sheet it filters "
                                "which stored reference judges the boards")
            p.add_argument("--sheet", metavar="DIR",
                           help="judge this sheet folder's boards against the stored reference "
                                "(headless panel: needs a display). With no option at all the module "
                                "replays the archived references, which is what `rebuild` runs")
            p.add_argument("--against", choices=["press", "outcome"], default="press",
                           help="which judge: 'press' = the stored forecast for the season being "
                                "auctioned; 'outcome' = what the clubs ACTUALLY did, which needs a "
                                "back-dated sheet (snapshot --season 2025-26 --date 2025-08-15) and "
                                "is the stronger evidence - nobody's opinion, and counted in the same "
                                "vocabulary as the boards")
            p.add_argument("--no-report", dest="report", action="store_false",
                           help="print only, do not write data/reports/press_comparison.json")
        if name == "injuries":
            p.add_argument("--season", action="append", metavar="YYYY-YY",
                           help="seasons whose squads/players to walk (repeatable; default: all)")
            p.add_argument("--layer", choices=["ids", "injuries", "all", "reparse"], default="all",
                           help="'ids' = squad pages (Transfermarkt ids + contract snapshot), "
                                "'injuries' = the per-player history walk (hours, resumable), "
                                "'all' = both, 'reparse' = offline from the cache (zero requests)")
            p.add_argument("--limit", type=int,
                           help="only the N most expensive players (for a pilot run)")
            p.add_argument("--refresh", action="store_true",
                           help="re-download pages even if already cached")

    return parser


def _console_takes_unicode() -> None:
    """A run must not be recorded as FAILED because its summary carried a symbol the console lacks.

    Measured, twice, on 06/08/2026: the two snapshot runs that produced the sheets are in `ingest_runs`
    with `status='error'` and `UnicodeEncodeError: '\\u2691'` - the ⚑ of the departures line. The CSVs were
    already written, so the sheets were fine and the log said the opposite; and a chained run (sheet then
    `export`) would have stopped there. Windows hands a cp1252 stdout to a non-UTF-8 console, and a print
    is not the place to decide what a marker may be: replace what cannot be encoded, never raise.
    """
    for stream in (sys.stdout, sys.stderr):
        with contextlib.suppress(Exception):        # a redirected/wrapped stream may not reconfigure
            stream.reconfigure(errors="replace")


def main(argv: list[str] | None = None) -> int:
    _console_takes_unicode()
    args = build_parser().parse_args(argv)
    cfg = Config()
    ctx = Context(config=cfg)

    # Default (no command) or explicit 'gui' command -> operator panel.
    if args.command in (None, "gui"):
        from euroleghe_ingest.gui import main as gui_main
        return gui_main()

    if args.command == "initdb":
        init_db(cfg.db_path)
        print(f"DB initialized: {cfg.db_path}")
        return 0

    if args.command == "rebuild":
        load("rebuild").run(ctx)
        return 0

    if args.command == "bootstrap":
        # The plan is printed without a DB; a real run needs one to write into.
        if not args.dry_run:
            ctx.conn = init_db(cfg.db_path)
        load("bootstrap").run(ctx, dry_run=args.dry_run, steps_from=args.steps_from,
                              steps_to=args.steps_to, skip=tuple(args.skip), seasons=args.season)
        return 0

    if args.command == "fetch":
        # A status report needs the DB it is reporting on (it may legitimately not exist yet).
        ctx.conn = init_db(cfg.db_path) if cfg.db_path.exists() else None
        try:
            load("fetch").run(ctx, plan=args.plan, do_run=args.do_run, inbox=args.inbox,
                              seasons=args.seasons)
        except NotImplementedError as exc:
            print(f"[fetch] not implemented: {exc}")
            return 1
        return 0

    # Single pipeline module: ensure the schema exists, then run.
    if args.command in ALL_MODULES:
        ctx.conn = init_db(cfg.db_path)
        started_at = dt.datetime.now(tz=dt.UTC).isoformat(timespec="seconds")
        try:
            if args.command == "ratings":
                if args.quotes_from_cache:
                    load("ratings").reingest_listone_from_cache(ctx)
                else:
                    load("ratings").run(ctx, platform=args.platform,
                                        seasons=args.season, refresh=args.refresh)
            elif args.command == "fixtures":
                load("fixtures").run(ctx, leagues=args.league, refresh=args.refresh,
                                     pages=args.pages)
            elif args.command == "positions":
                load("positions").run(ctx, leagues=args.league, seasons=args.season,
                                      refresh=args.refresh, layer=args.layer)
            elif args.command == "injuries":
                load("injuries").run(ctx, seasons=args.season, layer=args.layer,
                                     limit=args.limit, refresh=args.refresh)
            elif args.command == "market":
                if args.from_cache:
                    load("market").reingest_from_cache(ctx)
                else:
                    load("market").run(ctx, limit=args.limit, refresh=args.refresh,
                                       all_seasons=args.all_seasons)
            elif args.command == "recent_form":
                load("recent_form").run(ctx, seasons=args.season, wanted=args.matches,
                                        bonuses=args.bonuses, limit=args.limit,
                                        bonuses_only=args.bonuses_only)
            elif args.command == "synth":
                load("synth").run(ctx, validate=args.validate)
            elif args.command == "export":
                load("export").run(ctx, season=args.season, out=args.out,
                                   formats=tuple(args.formats) if args.formats
                                   else ("sqlite", "json"),
                                   history=args.history, compress=args.compress,
                                   verify=args.verify)
            elif args.command == "snapshot":
                load("snapshot").run(ctx, season=args.season, platform=args.platform,
                                     game=args.game, refresh=args.refresh, out=args.out,
                                     date=args.date, clubs=args.club, league=args.league)
            elif args.command == "timepack":
                load("timepack").run(ctx, date=args.date, plan=args.plan,
                                     build_all=args.build_all, refresh=args.refresh)
            elif args.command == "backtest":
                load("backtest").run(ctx, windows=args.window, platforms=args.platform,
                                     games=args.game, rules=args.rules, cases=args.cases,
                                     verify=args.verify, gate=args.gate, auction=args.auction,
                                     pairs=args.pairs, report=args.report)
            elif args.command == "press":
                load("press").run(ctx, import_files=args.import_files, season=args.season,
                                  source=args.source, observed_on=args.observed_on,
                                  sheet=args.sheet, against=args.against, report=args.report)
            elif args.command == "sweep":
                load("sweep").run(ctx, windows=args.window, platforms=args.platform,
                                  games=args.game, report=args.report)
            elif args.command == "estimates":
                load("estimates").run(ctx, platform=args.platform, game=args.game,
                                      metric=args.metric, no_report=not args.report)
            else:
                load(args.command).run(ctx)
        except NotImplementedError as exc:
            record_run(ctx.conn, args.command, started_at, "skipped", str(exc))
            print(f"[{args.command}] not implemented yet: {exc}")
            return 1
        except BaseException as exc:   # log WHY a run died, then re-raise it unchanged
            record_run(ctx.conn, args.command, started_at, "error",
                       f"{type(exc).__name__}: {exc}"[:400])
            raise
        ctx.conn.commit()
        record_run(ctx.conn, args.command, started_at, "ok", _argv_detail(args))
        return 0

    raise SystemExit(f"Unknown command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
