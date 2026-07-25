"""rebuild - rebuilds the whole DB from raw files. Idempotent.

Applies the schema, then runs the pipeline modules in order and closes with `validate`.
Modules not implemented yet (NotImplementedError) are marked 'skipped' and the rebuild continues.
NETWORK modules (authenticated scraping / downloads) are skipped by default and must be run
explicitly (or with include_network=True) - rebuild stays offline and fast.
"""

from __future__ import annotations

from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import PIPELINE, load

NAME = "rebuild"
DESCRIPTION = "Rebuild the DB from raw files (schema + pipeline + validate)"
DEPENDS_ON: list[str] = []
RAW_INPUTS: list[str] = []
NETWORK = False


def run(ctx: Context, *, include_network: bool = False, **kwargs) -> None:
    # Rebuild "from scratch": remove the existing DB to guarantee idempotency and stable ids.
    db = ctx.config.db_path
    if ctx.conn is not None:
        ctx.conn.close()  # on Windows the file can't be deleted while a connection is open
        ctx.conn = None
    if db.exists():
        db.unlink()
    ctx.conn = init_db(db)
    print(f"[rebuild] schema applied -> {db}")

    done, deferred, todo = [], [], []
    for name in PIPELINE:
        if name in ("arrivals", "validate"):
            continue   # run after the offline ratings re-ingest + club backfill (need clubs)
        module = load(name)
        if getattr(module, "NETWORK", False) and not include_network:
            deferred.append(name)
            print(f"[rebuild] {name}: SKIP (network module - run it explicitly)")
            continue
        try:
            module.run(ctx)
            ctx.conn.commit()
            done.append(name)
            print(f"[rebuild] {name}: ok")
        except NotImplementedError as exc:
            todo.append(name)
            print(f"[rebuild] {name}: SKIP ({exc})")

    # Keep the scraped ratings across rebuilds: re-ingest them offline from the cached Excel files
    # (the raw source of truth), then backfill any missing clubs (e.g. 2024-25) from the ratings team.
    load("ratings").reingest_from_cache(ctx)
    load("rosters").backfill_clubs(ctx)
    load("arrivals").run(ctx)   # roster diff needs the backfilled clubs
    ctx.conn.commit()

    load("validate").run(ctx)
    done.append("validate")
    print(f"\n[rebuild] done - {len(done)} run, {len(deferred)} network-deferred, {len(todo)} to implement.")
    if deferred:
        print("           network (run explicitly): " + ", ".join(deferred))
    if todo:
        print("           to implement: " + ", ".join(todo))
