"""tournaments - international tournaments -> tournaments_squads + the post-tournament signal.

Two effects the engine cares about (both about APPEARANCES, not ability):
  * a summer tournament eats a player's preseason -> post_torneo on the season that follows;
  * a mid-season one (Africa Cup, Asia Cup) takes him away DURING the season, so the appearances
    he misses are not unreliability and must not be read as such.

Source: SofaScore, not Wikidata. A squad list would only say who was called up; the match lineups
say who actually PLAYED and for how long, and minutes are what the fatigue effect is about. It also
reuses the client, the identity map and the cache format the league layer already uses.

Only players already in player_xref are stored: the perimeter is what the engine prices, and a
tournament roster is mostly players we will never see.
"""

from __future__ import annotations

import json
import re

from euroleghe_ingest.context import Context
from euroleghe_ingest.modules.positions import (
    BASE_URL,
    _atomic_write_text,
    _client,
    _get_json,
    _iso_date,
    _polite_sleep,
)

NAME = "tournaments"
DESCRIPTION = "International tournaments -> tournaments_squads (post_torneo, mid-season cups)"
DEPENDS_ON: list[str] = ["rosters", "positions"]
RAW_INPUTS: list[str] = []
NETWORK = True

EVENTS_ENDPOINT = BASE_URL + "/unique-tournament/{tid}/season/{sid}/events/last/{page}"
SEASONS_ENDPOINT = BASE_URL + "/unique-tournament/{tid}/seasons/"
LINEUPS_ENDPOINT = BASE_URL + "/event/{eid}/lineups"
MAX_PAGES = 12

# key -> (SofaScore unique-tournament id, season label, the season the effect lands on).
# A SUMMER tournament (Euro, and from 2027 the Africa Cup) eats the following season's preseason; one
# played MID-SEASON (the Asia Cup, the Africa Cup until 2025, and the World Cup of 2022) takes him away
# during the season it is played in, and those are the two different effects the docstring names.
#
# ⚠ THE IDS ARE VERIFIED AGAINST THE PROVIDER, and one was wrong: `africa_cup_2025` carried **132**,
# which is the **NBA** (its seasons come back as «NBA 25/26»). Nothing had ever downloaded it, so the
# error was invisible - and it would have stayed invisible, because a basketball payload resolves zero
# `player_xref` ids and produces zero rows, i.e. exactly what «this tournament has nobody we price»
# looks like. Checked 17/08/2026 through `/search/all`: Africa Cup of Nations = **270**, AFC Asian
# Cup = **246**, Euro = 1, World Cup = 16. Before adding one, look the id up rather than guess it.
TOURNAMENTS: dict[str, tuple[int, str, str]] = {
    # summer tournaments: the effect lands on the PRESEASON of the season after
    "world_cup_2026": (16, "2026", "2026-27"),
    "euro_2024": (1, "2024", "2024-25"),
    "euro_2020": (1, "2021", "2021-22"),          # played June-July 2021: the provider's year is 2021
    # mid-season tournaments: the effect lands on the season they are played in
    "world_cup_2022": (16, "2022", "2022-23"),    # November-December 2022, in the middle of the season
    "africa_cup_2025": (270, "2025", "2025-26"),  # 21/12/2025 - 18/01/2026
    "africa_cup_2023": (270, "2023", "2023-24"),  # 13/01 - 11/02/2024
    "africa_cup_2021": (270, "2021", "2021-22"),  # 09/01 - 06/02/2022
    "asian_cup_2023": (246, "2023", "2023-24"),   # 12/01 - 10/02/2024
}
DEFAULT_TOURNAMENTS: tuple[str, ...] = ("world_cup_2026",)
_CACHE_NAME = re.compile(r"sofascore_tournament_([a-z0-9_]+)\.json$")


# ---------- network ----------
def resolve_season_id(session, tournament_id: int, year: str) -> int | None:
    data = _get_json(session, SEASONS_ENDPOINT.format(tid=tournament_id))
    for entry in (data or {}).get("seasons", []):
        if entry.get("year") == year:
            return entry.get("id")
    return None


def download_tournament(session, key: str, cancel_event=None) -> dict | None:
    """Every finished match of a tournament plus its lineups (group stage AND knockouts).

    Numeric rounds only cover the group stage - the knockout rounds are named ('Round of 32',
    'Final'), so the paginated past-events endpoint is the only way to get the whole thing.
    """
    tournament_id, year, _target = TOURNAMENTS[key]
    season_id = resolve_season_id(session, tournament_id, year)
    if season_id is None:
        return None
    events: dict[str, dict] = {}
    for page in range(MAX_PAGES):
        data = _get_json(session, EVENTS_ENDPOINT.format(tid=tournament_id, sid=season_id, page=page))
        if not data:
            break
        for event in data.get("events", []):
            if (event.get("status") or {}).get("type") != "finished":
                continue
            round_info = event.get("roundInfo") or {}
            events[str(event.get("id"))] = {
                "id": event.get("id"),
                "home": (event.get("homeTeam") or {}).get("name"),
                "away": (event.get("awayTeam") or {}).get("name"),
                "round": round_info.get("name") or round_info.get("round"),
                "startTimestamp": event.get("startTimestamp"),
            }
        if not data.get("hasNextPage"):
            break
        _polite_sleep(cancel_event)
    lineups: dict[str, dict] = {}
    for event_id in events:
        if cancel_event is not None and cancel_event.is_set():
            break
        _polite_sleep(cancel_event)
        detail = _get_json(session, LINEUPS_ENDPOINT.format(eid=event_id))
        if not detail:
            continue
        lineups[event_id] = {
            side: [{"id": (entry.get("player") or {}).get("id"),
                    "minutes": (entry.get("statistics") or {}).get("minutesPlayed")}
                   for entry in (detail.get(side) or {}).get("players") or []]
            for side in ("home", "away")
        }
    return {"key": key, "events": list(events.values()), "lineups": lineups}


# ---------- parsing / persistence ----------
def summarise(payload: dict, xref: dict[str, int]) -> dict[int, dict]:
    """{fc_id: {matches, minutes, first_date, last_date}} for the players we know."""
    dates = {str(event["id"]): _iso_date(event.get("startTimestamp"))
             for event in payload.get("events", [])}
    out: dict[int, dict] = {}
    for event_id, sides in (payload.get("lineups") or {}).items():
        date = dates.get(event_id)
        for entries in sides.values():
            for entry in entries or []:
                fc_id = xref.get(str(entry.get("id") or ""))
                minutes = entry.get("minutes")
                if fc_id is None or not minutes:
                    continue          # unknown player, or named but never came on
                record = out.setdefault(fc_id, {"matches": 0, "minutes": 0,
                                                "first_date": date, "last_date": date})
                record["matches"] += 1
                record["minutes"] += int(minutes)
                if date:
                    record["first_date"] = min(record["first_date"] or date, date)
                    record["last_date"] = max(record["last_date"] or date, date)
    return out


def store(conn, key: str, summary: dict[int, dict]) -> int:
    """tournaments_squads + a post_torneo flag carrying the minutes actually played."""
    _tid, _year, target_season = TOURNAMENTS[key]
    conn.execute("DELETE FROM tournaments_squads WHERE tournament = ?", (key,))
    conn.execute("DELETE FROM flags WHERE flag = 'post_torneo' AND value LIKE ?", (f"{key}:%",))
    for fc_id, record in summary.items():
        conn.execute(
            "INSERT OR REPLACE INTO tournaments_squads(fc_id, tournament, start_date, end_date) "
            "VALUES (?, ?, ?, ?)",
            (fc_id, key, record["first_date"], record["last_date"]),
        )
        conn.execute(
            "INSERT OR REPLACE INTO flags(fc_id, season, flag, value, source) "
            "VALUES (?, ?, 'post_torneo', ?, 'sofascore')",
            (fc_id, target_season, f"{key}:{record['minutes']}min:{record['matches']}m"),
        )
    return len(summary)


def ingest(ctx: Context, payload: dict) -> int:
    conn = ctx.require_conn()
    xref = {source_id: fc_id for source_id, fc_id in conn.execute(
        "SELECT source_id, fc_id FROM player_xref WHERE source = 'sofascore'")}
    summary = summarise(payload, xref)
    stored = store(conn, payload["key"], summary)
    conn.commit()
    _tid, _year, target = TOURNAMENTS[payload["key"]]
    total_minutes = sum(record["minutes"] for record in summary.values())
    print(f"[tournaments] {payload['key']}: {len(payload.get('events', []))} matches · "
          f"{stored} perimeter players · {total_minutes} minutes -> post_torneo on {target}")
    return stored


# ---------- orchestration ----------
def run(ctx: Context, *, tournaments=None, refresh: bool = False, **kwargs) -> None:
    """Download the selected tournaments (default: the most recent World Cup) and ingest them."""
    ctx.require_conn()
    if isinstance(tournaments, str):
        tournaments = [tournaments]
    keys = tuple(tournaments) if tournaments else DEFAULT_TOURNAMENTS
    unknown = [key for key in keys if key not in TOURNAMENTS]
    if unknown:
        raise RuntimeError(f"Unknown tournament(s) {unknown}; choose from {sorted(TOURNAMENTS)}")

    ctx.config.cache_dir.mkdir(parents=True, exist_ok=True)
    session = _client()
    try:
        for key in keys:
            cache = ctx.config.cache_dir / f"sofascore_tournament_{key}.json"
            if cache.exists() and not refresh:
                print(f"[tournaments] {key}: already cached - skipping download")
                continue
            if ctx.cancelled():
                break
            payload = download_tournament(session, key, ctx.cancel_event)
            if payload is None or not payload.get("events"):
                print(f"[tournaments] {key}: nothing finished upstream - skipping")
                continue
            _atomic_write_text(cache, json.dumps(payload, ensure_ascii=False))
    finally:
        session.close()
    reingest_from_cache(ctx)


def reingest_from_cache(ctx: Context) -> None:
    """Rebuild tournaments_squads offline from the cached payloads."""
    files = sorted(ctx.config.cache_dir.glob("sofascore_tournament_*.json"))
    for path in files:
        match = _CACHE_NAME.search(path.name)
        if not match or match.group(1) not in TOURNAMENTS:
            continue
        try:
            ingest(ctx, json.loads(path.read_text(encoding="utf-8")))
        except Exception as exc:   # noqa: BLE001 - a corrupt cache file must not abort the rebuild
            print(f"[tournaments] skipping unreadable cache {path.name}: {exc}")
