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
