"""euroleghe-ingest CLI. Usage: `python -m euroleghe_ingest <command> [options]`."""

from __future__ import annotations

import argparse
import datetime as dt

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
    p_snap.add_argument("--platform", choices=["euro", "default"], default="euro",
                        help="euro = EuroLeghe, default = classic Serie A (default: euro)")
    p_snap.add_argument("--game", choices=["classic", "mantra"], default="classic",
                        help="role system the sheet is ranked in (default: classic)")
    p_snap.add_argument("--season", metavar="YYYY-YY",
                        help="the season being auctioned (default: the latest listone)")
    p_snap.add_argument("--out", metavar="DIR", help="destination folder (default: data/reports/...)")
    p_snap.add_argument("--no-refresh", dest="refresh", action="store_false",
                        help="do not fetch today's probabili/indisponibili first (offline run)")

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
        if name == "positions":
            p.add_argument("--league", action="append", metavar="LEAGUE",
                           help="league to import, e.g. premier_league (repeatable; default: all 5)")
            p.add_argument("--season", action="append", metavar="YYYY-YY",
                           help="season to import, e.g. 2024-25 (repeatable; default: all)")
            p.add_argument("--refresh", action="store_true",
                           help="re-download league-seasons even if already present")
            p.add_argument("--layer",
                           choices=["season", "match", "complete", "heatmap", "roles", "all",
                                    "reparse", "crosstab"],
                           default="season",
                           help="season aggregates (fast), the per-match layer (hours), "
                                "'complete' to add the matches the perimeter filter skipped, "
                                "'heatmap' for avg_x/avg_y (one request per player-season), "
                                "'roles' for the granular real role + foot (one request per CLUB), "
                                "both, "
                                "'reparse' to rebuild from the cache offline (zero requests), or "
                                "'crosstab' for the provider-role vs listone-role report (offline)")
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


def main(argv: list[str] | None = None) -> int:
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
            load("fetch").run(ctx, plan=args.plan, do_run=args.do_run, inbox=args.inbox)
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
                load("ratings").run(ctx, platform=args.platform,
                                    seasons=args.season, refresh=args.refresh)
            elif args.command == "positions":
                load("positions").run(ctx, leagues=args.league, seasons=args.season,
                                      refresh=args.refresh, layer=args.layer)
            elif args.command == "injuries":
                load("injuries").run(ctx, seasons=args.season, layer=args.layer,
                                     limit=args.limit, refresh=args.refresh)
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
                                     game=args.game, refresh=args.refresh, out=args.out)
            elif args.command == "backtest":
                load("backtest").run(ctx, windows=args.window, platforms=args.platform,
                                     games=args.game, rules=args.rules, cases=args.cases,
                                     verify=args.verify, gate=args.gate, auction=args.auction,
                                     pairs=args.pairs, report=args.report)
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
