"""elo - club strength -> club_elo at the auction dates.

First version reads the local seed CSV data/raw/elo-asta-mappa-club.csv (columns:
squadra, elo24, elo25), maps club names to fc_club_id, and writes one club_elo row per
auction date. A later upgrade can fetch from api.clubelo.com (see WHITELIST_DOMAINS).

Validated uses: the goalkeeper M2e model (50/50 persistence+Elo mix for the goals-conceded
rate) and the club-to-club coefficient for arrivals (task 3.2).
"""

from __future__ import annotations

import csv

from euroleghe_ingest.context import Context

NAME = "elo"
DESCRIPTION = "ClubElo seed -> club_elo (auction dates)"
DEPENDS_ON: list[str] = ["rosters"]
RAW_INPUTS: list[str] = ["elo-asta-mappa-club.csv"]
NETWORK = False   # reads the local seed CSV; the ClubElo API is a later upgrade

# Seed-CSV column -> the auction date it represents (ISO).
AUCTION_DATES = {"elo24": "2024-08-15", "elo25": "2025-08-15"}


def run(ctx: Context, **kwargs) -> None:
    conn = ctx.require_conn()
    path = ctx.config.raw_dir / "elo-asta-mappa-club.csv"
    if not path.exists():
        print(f"[elo] seed file missing ({path.name}) - nothing to do")
        return

    text = path.read_bytes().decode("utf-8-sig", errors="replace")   # strip a BOM if present
    matched = rows = 0
    unresolved: list[str] = []
    for record in csv.DictReader(text.splitlines()):
        name = (record.get("squadra") or "").strip()
        if not name:
            continue
        club = conn.execute(
            "SELECT fc_club_id FROM clubs WHERE canonical_name = ?", (name,)
        ).fetchone()
        if club is None:
            unresolved.append(name)
            continue
        matched += 1
        for column, date in AUCTION_DATES.items():
            value = record.get(column)
            if value not in (None, ""):
                conn.execute(
                    "INSERT OR REPLACE INTO club_elo(fc_club_id, date, elo) VALUES (?, ?, ?)",
                    (club[0], date, float(value)),
                )
                rows += 1

    print(f"[elo] clubs matched={matched} · club_elo rows={rows}")
    if unresolved:
        print(f"[elo] {len(unresolved)} club names not in the current perimeter: "
              + ", ".join(sorted(unresolved)))
