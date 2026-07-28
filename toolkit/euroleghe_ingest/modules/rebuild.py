"""rebuild - rebuilds the whole DB from raw files. Idempotent.

Applies the schema, then runs the pipeline modules in order and closes with `validate`.
Modules not implemented yet (NotImplementedError) are marked 'skipped' and the rebuild continues.
NETWORK modules (authenticated scraping / downloads) are skipped by default and must be run
explicitly (or with include_network=True) - rebuild stays offline and fast.
"""

from __future__ import annotations

import datetime as dt

from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import apply_schema, connect, record_run, table_names
from euroleghe_ingest.modules import PIPELINE, load

NAME = "rebuild"
DESCRIPTION = "Rebuild the DB from raw files (schema + pipeline + validate)"
DEPENDS_ON: list[str] = []
RAW_INPUTS: list[str] = []
NETWORK = False


def run(ctx: Context, *, include_network: bool = False, **kwargs) -> None:
    started_at = dt.datetime.now(tz=dt.UTC).isoformat(timespec="seconds")
    # Rebuild "from scratch": reset in-place by dropping all tables (avoids a file-lock failure if
    # the GUI has the DB open, and applies any schema changes), then re-apply the schema.
    db = ctx.config.db_path
    if ctx.conn is not None:
        ctx.conn.close()
        ctx.conn = None
    conn = connect(db)
    conn.execute("PRAGMA foreign_keys = OFF")
    for name in table_names(conn):
        conn.execute(f'DROP TABLE IF EXISTS "{name}"')
    conn.commit()
    conn.execute("PRAGMA foreign_keys = ON")
    apply_schema(conn)
    ctx.conn = conn
    print(f"[rebuild] schema reset (in-place) -> {db}")

    done, deferred, todo = [], [], []
    for name in PIPELINE:
        if name in ("arrivals", "matchdays", "synth", "validate"):
            continue   # run after the offline ratings re-ingest + club backfill (need clubs/ratings)
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
    load("rosters").backfill_rosters_from_ratings(ctx)   # Serie A + voti-only seasons
    load("ratings").reingest_listone_from_cache(ctx)     # Mantra roles + prices for ALL teams (listone)
    load("positions").derive_club_leagues(ctx)           # league from the provider cache (build from zero)
    load("rosters").fix_club_leagues(ctx)                # correct clubs mislabeled by transferred players
    load("positions").reingest_all_from_cache(ctx)       # SofaScore facts + per-match layer + real role
    load("stats").derive_from_ratings(ctx)               # season aggregates for players without a listone
    load("matchdays").run(ctx)                           # euro<->real calendar map (needs both platforms)
    load("fc_site").reingest_from_cache(ctx)             # dated states replayed + revealed penalties
    load("tournaments").reingest_from_cache(ctx)         # who played which tournament, offline
    load("transfers").reingest_from_cache(ctx)           # clubs, coaches (new_coach), transfers
    load("injuries").reingest_from_cache(ctx)            # tm ids, dated absences, contract snapshot
    load("elo").reingest_from_cache(ctx)                 # club strength at the auction dates
    load("synth").run(ctx)                               # calibrated synthetic base voto (needs the map)
    load("arrivals").run(ctx)   # roster diff needs the backfilled clubs
    ctx.conn.commit()

    load("validate").run(ctx)
    done.append("validate")
    record_run(ctx.conn, "rebuild", started_at, "ok",
               f"{len(done)} run · deferred: {','.join(deferred)} · todo: {','.join(todo)}")
    print(f"\n[rebuild] done - {len(done)} run, {len(deferred)} network-deferred, {len(todo)} to implement.")
    if deferred:
        print("           network (run explicitly): " + ", ".join(deferred))
    if todo:
        print("           to implement: " + ", ".join(todo))
