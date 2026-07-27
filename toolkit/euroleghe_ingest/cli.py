"""euroleghe-ingest CLI. Usage: `python -m euroleghe_ingest <command> [options]`."""

from __future__ import annotations

import argparse

from euroleghe_ingest import __version__
from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import ALL_MODULES, PIPELINE, load


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

    p_fetch = sub.add_parser("fetch", help="acquire raw files from whitelisted domains")
    p_fetch.add_argument("--plan", action="store_true", help="compute what is needed -> whitelist_request.md")
    p_fetch.add_argument("--run", dest="do_run", action="store_true", help="download what is reachable")
    p_fetch.add_argument("--inbox", action="store_true", help="import manual downloads from data/inbox/")

    sub.add_parser("rebuild", help="rebuild the whole DB from raw files (idempotent)")

    # Gate harness: read-only on the DB, writes only a report under data/reports/.
    p_backtest = sub.add_parser("backtest", help=load("backtest").DESCRIPTION)
    p_backtest.add_argument("--window", action="append", choices=["T1", "T2"], metavar="T1|T2",
                            help="prediction window (repeatable; default: both)")
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
    p_backtest.add_argument("--no-report", dest="report", action="store_false",
                            help="print only, do not write data/reports/engine_backtest.json")

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
            p.add_argument("--layer", choices=["season", "match", "complete", "all"],
                           default="season",
                           help="season aggregates (fast), the per-match layer (hours), "
                                "'complete' to add the matches the perimeter filter skipped, or both")

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

    if args.command == "fetch":
        try:
            load("fetch").run(ctx, plan=args.plan, do_run=args.do_run, inbox=args.inbox)
        except NotImplementedError as exc:
            print(f"[fetch] not implemented yet: {exc}")
            return 1
        return 0

    # Single pipeline module: ensure the schema exists, then run.
    if args.command in ALL_MODULES:
        ctx.conn = init_db(cfg.db_path)
        try:
            if args.command == "ratings":
                load("ratings").run(ctx, platform=args.platform,
                                    seasons=args.season, refresh=args.refresh)
            elif args.command == "positions":
                load("positions").run(ctx, leagues=args.league, seasons=args.season,
                                      refresh=args.refresh, layer=args.layer)
            elif args.command == "recent_form":
                load("recent_form").run(ctx, seasons=args.season, wanted=args.matches,
                                        bonuses=args.bonuses, limit=args.limit)
            elif args.command == "synth":
                load("synth").run(ctx, validate=args.validate)
            elif args.command == "backtest":
                load("backtest").run(ctx, windows=args.window, platforms=args.platform,
                                     games=args.game, rules=args.rules, cases=args.cases,
                                     verify=args.verify, gate=args.gate, auction=args.auction,
                                     report=args.report)
            else:
                load(args.command).run(ctx)
        except NotImplementedError as exc:
            print(f"[{args.command}] not implemented yet: {exc}")
            return 1
        ctx.conn.commit()
        return 0

    raise SystemExit(f"Unknown command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
