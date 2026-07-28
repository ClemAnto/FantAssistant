"""positions - SofaScore: the FULL real season for the 4 foreign leagues (+ Serie A as the control).

Why this module exists (spec v9 §7): the EuroLeghe calendar only SAMPLES a player's real season, so
propensity (goals/assists/xG per 90) has to be computed over every real match. Serie A gets that
from the `default` platform; the other 4 leagues have no such twin, so the facts come from here.

FBref was the planned source for the facts but it is behind a Cloudflare interstitial (403 on every
request, TLS impersonation included), while SofaScore's API answers and carries the same facts PLUS
the per-match rating the calibrated synthetic base voto needs. So SofaScore is the primary source and
FBref stays an optional enrichment (career penalties, set-piece pass types) for a later phase.

Two layers:
- season aggregates  -> external_stats(source='sofascore')          [this step, ~6 requests/league-season]
- per-match ratings  -> external_match_stats + positions            [next step, rounds -> lineups]

Everything is source-tagged and NEVER touches the `euro` target in season_stats/match_ratings.
The raw JSON is cached under data/cache/, so a rebuild re-ingests it offline like the ratings Excel.
"""

from __future__ import annotations

import json
import os
import random
import re
import time

from euroleghe_ingest.config import DEFAULT_SEASONS
from euroleghe_ingest.context import Context
from euroleghe_ingest.matching import (
    CLUB_ALIASES,
    build_pool_entry,
    club_key,
    match_in_pool,
)

NAME = "positions"
DESCRIPTION = "SofaScore -> external_stats (full real season) + positions"
DEPENDS_ON: list[str] = ["rosters"]
RAW_INPUTS: list[str] = []
NETWORK = True

BASE_URL = "https://api.sofascore.com/api/v1"
SEASONS_ENDPOINT = BASE_URL + "/unique-tournament/{tid}/seasons/"
STATS_ENDPOINT = (BASE_URL + "/unique-tournament/{tid}/season/{sid}/statistics"
                  "?limit={limit}&offset={offset}&order=-rating&accumulation=total&fields={fields}")
ROUND_ENDPOINT = BASE_URL + "/unique-tournament/{tid}/season/{sid}/events/round/{rnd}"
LINEUPS_ENDPOINT = BASE_URL + "/event/{eid}/lineups"
# The season heatmap: a weighted cloud of touch coordinates for one player in one league-season.
# One request per player-season - the cheapest form of it (the per-match one costs 30x as much).
HEATMAP_ENDPOINT = BASE_URL + "/player/{pid}/unique-tournament/{tid}/season/{sid}/heatmap/overall"

# SofaScore unique-tournament ids for the 5 leagues in scope (verified against the API).
TOURNAMENTS: dict[str, int] = {
    "serie_a": 23,
    "premier_league": 17,
    "la_liga": 8,
    "bundesliga": 35,
    "ligue_1": 34,
}
SEASONS: tuple[str, ...] = DEFAULT_SEASONS   # config.py owns the list (one edit per new season)

# Fields requested from the season-statistics endpoint (the default `group` returns far fewer).
STAT_FIELDS: tuple[str, ...] = (
    "goals", "assists", "minutesPlayed", "appearances", "matchesStarted", "expectedGoals",
    "expectedAssists", "rating", "yellowCards", "redCards", "penaltyGoals", "penaltiesTaken",
    "goalsConceded", "saves",
)
PAGE_SIZE = 100
MAX_ROUNDS = 38          # the 5 leagues play 34 (Bundesliga) to 38 rounds

# Polite rate limiting (seconds): base + jitter between requests, same policy as `ratings`.
REQUEST_DELAY = 2.0
REQUEST_JITTER = 1.5
_CACHE_NAME = re.compile(r"sofascore_stats_([a-z_0-9]+)_(\d{4}-\d{2})\.json$")
_ROUND_CACHE_NAME = re.compile(r"sofascore_round_([a-z_0-9]+)_(\d{4}-\d{2})_r(\d+)\.json$")
_HEATMAP_CACHE_NAME = re.compile(r"sofascore_heatmap_([a-z_0-9]+)_(\d{4}-\d{2})_(\d+)\.json$")


# ---------- HTTP ----------
def _polite_sleep(cancel_event=None) -> None:
    delay = REQUEST_DELAY + random.uniform(0, REQUEST_JITTER)   # jitter (not crypto)
    if cancel_event is not None:
        cancel_event.wait(delay)
    else:
        time.sleep(delay)


def _client():
    """curl_cffi session impersonating a browser.

    Plain `requests` gets a blanket 403 from api.sofascore.com (the CDN checks the TLS/HTTP2
    fingerprint, not the User-Agent), so this is the only client that can read the public API.
    """
    try:
        from curl_cffi import requests as curl_requests
    except ImportError as exc:   # pragma: no cover - dependency is declared in pyproject
        raise RuntimeError("curl_cffi is required for the SofaScore API: pip install curl_cffi") from exc
    return curl_requests.Session(impersonate="chrome")


def _get_json(session, url: str, *, tries: int = 3):
    """GET + parse JSON, retrying transient failures (network error / HTTP 5xx / 429)."""
    for attempt in range(1, tries + 1):
        try:
            response = session.get(url, timeout=40)
            if response.status_code == 200:
                return response.json()
            if response.status_code not in (429, 500, 502, 503, 504) or attempt == tries:
                return None
        except Exception:
            if attempt == tries:
                raise
        time.sleep(2.0 * attempt)
    return None


def _atomic_write_text(path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def sofascore_year(season: str) -> str:
    """'2023-24' -> '23/24' (the provider's season label)."""
    start, end = season.split("-")
    return f"{start[2:]}/{end}"


def resolve_season_id(session, league: str, season: str) -> int | None:
    data = _get_json(session, SEASONS_ENDPOINT.format(tid=TOURNAMENTS[league]))
    if not data:
        return None
    year = sofascore_year(season)
    for entry in data.get("seasons", []):
        if entry.get("year") == year:
            return entry.get("id")
    return None


def download_season_stats(session, league: str, season_id: int, cancel_event=None) -> list[dict]:
    """Every player of a league-season (paginated), as returned by the provider."""
    fields = ",".join(STAT_FIELDS)
    results: list[dict] = []
    page = 0
    while True:
        url = STATS_ENDPOINT.format(tid=TOURNAMENTS[league], sid=season_id, limit=PAGE_SIZE,
                                    offset=page * PAGE_SIZE, fields=fields)
        data = _get_json(session, url)
        if not data:
            break
        results.extend(data.get("results", []))
        page += 1
        if page >= data.get("pages", 0) or (cancel_event is not None and cancel_event.is_set()):
            break
        _polite_sleep(cancel_event)
    return results


# ---------- per-match layer (rounds -> lineups) ----------
def perimeter_club_keys(conn, season: str) -> set[str]:
    """Club keys of the EuroLeghe perimeter for a season (the clubs that appear in the euro ratings).

    Only their matches are worth downloading: EuroLeghe carries ~8 clubs per foreign league, so this
    cuts the per-match scrape to roughly a third of each round.
    """
    teams = [team for (team,) in conn.execute(
        "SELECT DISTINCT team FROM match_ratings WHERE platform = 'euro' AND season = ? "
        "AND team IS NOT NULL", (season,))]
    return {club_key(CLUB_ALIASES.get(team, team)) for team in teams}


def download_round(session, league: str, season_id: int, rnd: int, perimeter: set[str],
                   cancel_event=None) -> dict | None:
    """One round: the round's events plus the lineups of the matches involving a perimeter club."""
    data = _get_json(session, ROUND_ENDPOINT.format(tid=TOURNAMENTS[league], sid=season_id, rnd=rnd))
    if not data or not data.get("events"):
        return None
    events, lineups = [], {}
    for event in data["events"]:
        home = (event.get("homeTeam") or {}).get("name") or ""
        away = (event.get("awayTeam") or {}).get("name") or ""
        if club_key(home) not in perimeter and club_key(away) not in perimeter:
            continue
        if (event.get("status") or {}).get("type") != "finished":
            continue
        events.append({
            "id": event.get("id"), "home": home, "away": away,
            "round": (event.get("roundInfo") or {}).get("round") or rnd,
            "startTimestamp": event.get("startTimestamp"),
        })
        if cancel_event is not None and cancel_event.is_set():
            break
        _polite_sleep(cancel_event)
        detail = _get_json(session, LINEUPS_ENDPOINT.format(eid=event.get("id")))
        if detail:
            lineups[str(event.get("id"))] = {
                side: [{"player": {k: (entry.get("player") or {}).get(k)
                                   for k in ("id", "name", "position", "dateOfBirthTimestamp")},
                        "substitute": entry.get("substitute"),
                        "position": entry.get("position"),
                        "statistics": entry.get("statistics") or {}}
                       for entry in (detail.get(side) or {}).get("players") or []]
                for side in ("home", "away")
            }
    return {"league": league, "round": rnd, "events": events, "lineups": lineups} if events else None


def _iso_date(timestamp) -> str | None:
    if not timestamp:
        return None
    return time.strftime("%Y-%m-%d", time.gmtime(timestamp))


def parse_round(payload: dict, season: str,
                xref: dict[str, int]) -> tuple[list[tuple], list[tuple], int]:
    """Cached round payload -> (external_match_stats rows, club_match_lineups rows, unresolved).

    Identity comes straight from player_xref (written by the season-aggregate step): a player the
    aggregates could not resolve is skipped here too, so the two layers can never disagree. The
    club-level counts are the exception on purpose - they are built over EVERY lineup entry,
    resolved or not, because how many forwards a club fields is a fact about the club and the
    identity funnel would bias it against the clubs whose fringe players are not quoted.
    """
    league = payload.get("league")
    rows: list[tuple] = []
    club_rows: list[tuple] = []
    unknown = 0
    for event in payload.get("events", []):
        event_id = str(event.get("id"))
        sides = payload.get("lineups", {}).get(event_id) or {}
        real_md = event.get("round")
        match_date = _iso_date(event.get("startTimestamp"))
        for side in ("home", "away"):
            club = event.get(side)
            opponent = event.get("away" if side == "home" else "home")
            slots = {"G": 0, "D": 0, "M": 0, "F": 0}
            starters = 0
            for entry in sides.get(side) or []:
                player = entry.get("player") or {}
                if not entry.get("substitute"):
                    starters += 1
                    position = entry.get("position") or player.get("position")
                    if position in slots:
                        slots[position] += 1
                fc_id = xref.get(str(player.get("id") or ""))
                if fc_id is None:
                    unknown += 1
                    continue
                stats = entry.get("statistics") or {}
                if not stats:
                    continue          # named on the bench but never came on
                rows.append((
                    fc_id, season, event_id, league, real_md, match_date, club, opponent,
                    1 if side == "home" else 0,
                    entry.get("position") or player.get("position"),
                    0 if entry.get("substitute") else 1,
                    _int(stats.get("minutesPlayed")), stats.get("rating"),
                    _int(stats.get("goals")), _int(stats.get("goalAssist")),
                    stats.get("expectedGoals"), stats.get("expectedAssists"),
                    _int(stats.get("totalShots")), _int(stats.get("onTargetScoringAttempt")),
                    _int(stats.get("bigChanceCreated")), _int(stats.get("bigChanceMissed")),
                    _int(stats.get("keyPass")), _int(stats.get("touches")),
                ))
            if starters:
                club_rows.append((season, event_id, club, league, real_md, match_date, starters,
                                  slots["G"], slots["D"], slots["M"], slots["F"]))
    return rows, club_rows, unknown


def _store_match_rows(conn, rows: list[tuple]) -> int:
    conn.executemany(
        """
        INSERT OR REPLACE INTO external_match_stats(
            fc_id, season, source, match_id, competition, real_md, match_date, club, opponent,
            home, position, started, minutes, rating, goals, assists, xg, xa,
            shots, shots_on_target, big_chances_created, big_chances_missed, key_passes, touches)
        VALUES (?, ?, 'sofascore', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    return len(rows)


def _store_club_rows(conn, club_rows: list[tuple]) -> int:
    conn.executemany(
        """
        INSERT OR REPLACE INTO club_match_lineups(
            season, source, match_id, club, competition, real_md, match_date,
            starters, goalkeepers, defenders, midfielders, forwards)
        VALUES (?, 'sofascore', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        club_rows,
    )
    return len(club_rows)


def fetch_match_layer(ctx: Context, leagues, seasons, refresh: bool = False) -> None:
    """Download the per-match layer for the perimeter clubs (rounds -> lineups) into the cache."""
    conn = ctx.require_conn()
    session = _client()
    try:
        for season in seasons:
            perimeter = perimeter_club_keys(conn, season)
            if not perimeter:
                print(f"[positions] {season}: no euro ratings yet - perimeter unknown, skipping")
                continue
            for league in leagues:
                season_id = None
                for rnd in range(1, MAX_ROUNDS + 1):
                    if ctx.cancelled():
                        raise KeyboardInterrupt
                    cache = ctx.config.cache_dir / f"sofascore_round_{league}_{season}_r{rnd}.json"
                    if cache.exists() and not refresh:
                        continue
                    if season_id is None:
                        _polite_sleep(ctx.cancel_event)
                        season_id = resolve_season_id(session, league, season)
                        if season_id is None:
                            print(f"[positions] {league} {season}: season not found upstream")
                            break
                    _polite_sleep(ctx.cancel_event)
                    payload = download_round(session, league, season_id, rnd, perimeter,
                                             ctx.cancel_event)
                    if payload is None:
                        print(f"[positions] {league} {season}: stop at round {rnd} "
                              "(no finished perimeter match)")
                        continue
                    _atomic_write_text(cache, json.dumps(payload, ensure_ascii=False))
                    print(f"[positions] {league} {season} r{rnd}: {len(payload['events'])} matches, "
                          f"{len(payload['lineups'])} lineups cached")
    except KeyboardInterrupt:
        print("[positions] interrupted - already-downloaded rounds are cached")
    finally:
        session.close()
    reingest_match_layer(ctx, seasons=seasons)


def _lineups_for(session, event_id) -> dict | None:
    """The two lineups of one match, in the shape the round cache stores."""
    detail = _get_json(session, LINEUPS_ENDPOINT.format(eid=event_id))
    if not detail:
        return None
    return {
        side: [{"player": {k: (entry.get("player") or {}).get(k)
                           for k in ("id", "name", "position", "dateOfBirthTimestamp")},
                "substitute": entry.get("substitute"),
                "position": entry.get("position"),
                "statistics": entry.get("statistics") or {}}
               for entry in (detail.get(side) or {}).get("players") or []]
        for side in ("home", "away")
    }


def complete_match_layer(ctx: Context, leagues, seasons) -> dict[str, int]:
    """Fill the matches the perimeter-driven scrape skipped: NON-perimeter vs NON-perimeter.

    Why this exists (gate-motore-v1 §5): `download_round` only kept matches involving a perimeter
    club, so a club outside the perimeter ended up with just its games AGAINST the strong teams - 18
    of 38 in Serie A - and its players' FM-equivalent came out biased low by 0.05 (defenders) to 0.22
    (forwards). Measuring a season on its hardest half is not a smaller sample, it is a different one.

    Incremental on purpose: each round's cached payload is READ, the round listing tells us which
    finished matches are missing from it, and only those lineups are fetched and merged back. Cost is
    one listing per round plus one request per missing match, instead of re-downloading everything.
    """
    session = _client()
    added = {"rounds": 0, "matches": 0, "requests": 0}
    try:
        for season in seasons:
            for league in leagues:
                season_id = None
                for rnd in range(1, MAX_ROUNDS + 1):
                    if ctx.cancelled():
                        raise KeyboardInterrupt
                    cache = ctx.config.cache_dir / f"sofascore_round_{league}_{season}_r{rnd}.json"
                    payload = None
                    if cache.exists():
                        try:
                            payload = json.loads(cache.read_text(encoding="utf-8"))
                        except (OSError, json.JSONDecodeError):
                            payload = None
                    if season_id is None:
                        _polite_sleep(ctx.cancel_event)
                        season_id = resolve_season_id(session, league, season)
                        added["requests"] += 1
                        if season_id is None:
                            print(f"[positions] {league} {season}: season not found upstream")
                            break
                    _polite_sleep(ctx.cancel_event)
                    listing = _get_json(
                        session, ROUND_ENDPOINT.format(tid=TOURNAMENTS[league], sid=season_id,
                                                       rnd=rnd))
                    added["requests"] += 1
                    if not listing or not listing.get("events"):
                        # `continue`, not `break`: _get_json returns None on a non-retryable status
                        # too, and breaking here would silently truncate the season at that round -
                        # exactly the partial coverage this pass exists to remove. `fetch_match_layer`
                        # already makes the same choice.
                        print(f"[positions] {league} {season}: no events at round {rnd}, skipping")
                        continue
                    payload = payload or {"league": league, "round": rnd, "events": [],
                                          "lineups": {}}
                    known = {str(event.get("id")) for event in payload["events"]}
                    missing = [event for event in listing["events"]
                               if (event.get("status") or {}).get("type") == "finished"
                               and str(event.get("id")) not in known]
                    if not missing:
                        continue
                    for event in missing:
                        if ctx.cancelled():
                            raise KeyboardInterrupt
                        _polite_sleep(ctx.cancel_event)
                        lineups = _lineups_for(session, event.get("id"))
                        added["requests"] += 1
                        if not lineups:
                            continue
                        payload["events"].append({
                            "id": event.get("id"),
                            "home": (event.get("homeTeam") or {}).get("name") or "",
                            "away": (event.get("awayTeam") or {}).get("name") or "",
                            "round": (event.get("roundInfo") or {}).get("round") or rnd,
                            "startTimestamp": event.get("startTimestamp"),
                        })
                        payload["lineups"][str(event.get("id"))] = lineups
                        added["matches"] += 1
                    _atomic_write_text(cache, json.dumps(payload, ensure_ascii=False))
                    added["rounds"] += 1
                    print(f"[positions] {league} {season} r{rnd}: +{len(missing)} matches "
                          f"(now {len(payload['events'])}) · {added['matches']} added so far")
    except KeyboardInterrupt:
        print("[positions] interrupted - every merged round is already on disk, rerun to continue")
    finally:
        session.close()
    print(f"[positions] completion: +{added['matches']} matches over {added['rounds']} rounds "
          f"({added['requests']} requests)")
    return added


def reingest_match_layer(ctx: Context, seasons=None) -> None:
    """Rebuild external_match_stats offline from the cached round payloads."""
    conn = ctx.require_conn()
    xref = {source_id: fc_id for source_id, fc_id in conn.execute(
        "SELECT source_id, fc_id FROM player_xref WHERE source = 'sofascore'")}
    files = sorted(ctx.config.cache_dir.glob("sofascore_round_*.json"))
    touched: dict[tuple[str, str], int] = {}
    unknown = 0
    for path in files:
        match = _ROUND_CACHE_NAME.search(path.name)
        if not match:
            continue
        league, season = match.group(1), match.group(2)
        if seasons and season not in seasons:
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            rows, club_rows, missing = parse_round(payload, season, xref)
        except Exception as exc:   # noqa: BLE001 - a corrupt cache file must not abort the rebuild
            print(f"[positions] skipping unreadable round cache {path.name}: {exc}")
            continue
        key = (league, season)
        if key not in touched:
            conn.execute("DELETE FROM external_match_stats WHERE source = 'sofascore' "
                         "AND competition = ? AND season = ?", (league, season))
            conn.execute("DELETE FROM club_match_lineups WHERE source = 'sofascore' "
                         "AND competition = ? AND season = ?", (league, season))
            touched[key] = 0
        touched[key] += _store_match_rows(conn, rows)
        _store_club_rows(conn, club_rows)
        unknown += missing
    conn.commit()
    if touched:
        for (league, season), n in sorted(touched.items()):
            print(f"[positions] {league} {season}: {n} external_match_stats rows")
        print(f"[positions] per-match layer: {sum(touched.values())} rows from {len(files)} cached "
              f"rounds ({unknown} lineup entries without a resolved identity)")


# ---------- real role (offline, from the per-match layer) ----------
# The provider tags every lineup entry with the slot the player actually filled, and we already have
# that on 100% of external_match_stats - so the REAL role needs no extra request. The heatmap layer
# (avg_x/avg_y) only refines it, e.g. left-back vs centre-back, which G/D/M/F cannot express.
PROVIDER_TO_CLASSIC: dict[str, str] = {"G": "P", "D": "D", "M": "C", "F": "A"}
# Defensive -> offensive. A player used BELOW their nominal role is a demotion, which is the
# direction the validated asymmetric anchor change reacts to (full on demotion, zero on promotion).
ROLE_ORDER: dict[str, int] = {"P": 0, "D": 1, "C": 2, "A": 3}
MIN_OFF_ROLE_MATCHES = 5      # below this it is rotation, not usage
MIN_OFF_ROLE_SHARE = 0.4      # and it has to be a real share of the player's appearances


def derive_roles_from_match_layer(ctx: Context) -> tuple[int, int]:
    """positions.derived_role from the modal provider slot + the off_role_usage flag.

    Returns (positions rows, off_role_usage flags). Pure SQL + counting: no network.
    """
    conn = ctx.require_conn()
    rows = conn.execute(
        """
        SELECT e.fc_id, e.season, e.position, COUNT(*) AS n
        FROM external_match_stats e
        WHERE e.source = 'sofascore' AND e.position IS NOT NULL AND COALESCE(e.minutes, 0) > 0
        GROUP BY e.fc_id, e.season, e.position
        """
    ).fetchall()
    played: dict[tuple[int, str], dict[str, int]] = {}
    for fc_id, season, position, n in rows:
        played.setdefault((fc_id, season), {})[position] = n

    nominal = {(fc_id, season): role for fc_id, season, role in conn.execute(
        "SELECT fc_id, season, role_classic FROM rosters WHERE role_classic IS NOT NULL")}

    conn.execute("DELETE FROM positions WHERE source = 'sofascore'")
    conn.execute("DELETE FROM flags WHERE flag = 'off_role_usage' AND source = 'sofascore'")
    positions_written = flags_written = 0
    for (fc_id, season), counts in played.items():
        total = sum(counts.values())
        provider_role = max(counts, key=lambda code: counts[code])
        real_role = PROVIDER_TO_CLASSIC.get(provider_role)
        conn.execute(
            """
            INSERT OR REPLACE INTO positions(fc_id, season, source, derived_role, n_matches,
                                             is_friendly)
            VALUES (?, ?, 'sofascore', ?, ?, 0)
            """,
            (fc_id, season, real_role, total),
        )
        positions_written += 1

        listed = nominal.get((fc_id, season))
        if not listed or not real_role or listed == real_role:
            continue
        off_matches = counts[provider_role]
        if off_matches < MIN_OFF_ROLE_MATCHES or off_matches / total < MIN_OFF_ROLE_SHARE:
            continue
        if listed not in ROLE_ORDER or real_role not in ROLE_ORDER:
            continue
        direction = "demotion" if ROLE_ORDER[real_role] < ROLE_ORDER[listed] else "promotion"
        conn.execute(
            "INSERT OR REPLACE INTO flags(fc_id, season, flag, value, source) "
            "VALUES (?, ?, 'off_role_usage', ?, 'sofascore')",
            (fc_id, season, f"{listed}->{real_role}:{direction}:{off_matches}/{total}"),
        )
        flags_written += 1
    conn.commit()
    print(f"[positions] real role from the per-match layer: {positions_written} player-seasons · "
          f"{flags_written} off_role_usage flags")
    return positions_written, flags_written


# ---------- heatmap layer (avg_x / avg_y) ----------
# What this adds over `derived_role`: G/D/M/F cannot say WHERE inside the line a player is used, and
# the Mantra vocabulary can (dd vs dc, e vs c). The heatmap is the cheapest fact that carries it.
# Convention, verified on a goalkeeper (avg_x = 1.4): x runs from the player's OWN goal (0) to the
# opponent's (100), y across the pitch (0-100), both normalized by the provider so a season's matches
# are comparable regardless of which way the team kicked off.
# NOTE the boundary: this module stores the COORDINATES. Turning them into a Mantra role is a model
# choice and belongs to the engine, behind the gate - so nothing here derives a role from them.
def heatmap_targets(conn, seasons: tuple[str, ...] | None = None) -> list[tuple[str, str, str, int]]:
    """(league, season, provider_id, fc_id) per player-season, in the league he played most in.

    A player who moved mid-season has rows in two competitions; the heatmap endpoint is per
    unique-tournament, so the one with the most minutes is the one that describes his usage.
    Ordered by pre-auction price (Qt.I) so an interrupted walk has done the players that matter.
    """
    rows = conn.execute(
        """
        SELECT e.season, e.competition, x.source_id, e.fc_id, COALESCE(e.minutes, 0),
               MAX(COALESCE(r.price_initial, r.price, 0))
        FROM external_stats e
        JOIN player_xref x ON x.fc_id = e.fc_id AND x.source = 'sofascore'
        LEFT JOIN rosters r ON r.fc_id = e.fc_id AND r.season = e.season
        WHERE e.source = 'sofascore' AND COALESCE(e.minutes, 0) > 0
        GROUP BY e.fc_id, e.season, e.competition
        """
    ).fetchall()
    best: dict[tuple[int, str], tuple[int, float, str, str]] = {}
    for season, league, provider_id, fc_id, minutes, price in rows:
        if seasons and season not in seasons:
            continue
        key = (fc_id, season)
        current = best.get(key)
        if current is None or minutes > current[0]:
            best[key] = (minutes, price or 0.0, league, provider_id)
    ordered = sorted(best.items(), key=lambda item: -item[1][1])
    return [(league, season, provider_id, fc_id)
            for (fc_id, season), (_minutes, _price, league, provider_id) in ordered]


def heatmap_centroid(payload) -> tuple[float, float, int] | None:
    """The provider's weighted point cloud -> (avg_x, avg_y, touches). None when it is empty.

    Weighted by `count`: an unweighted mean of distinct coordinates would count one stray touch in
    the opponent's box as heavily as the hundred a full-back plays on his own flank.
    """
    points = (payload or {}).get("points") or []
    total = sum(point.get("count") or 0 for point in points)
    if not total:
        return None
    sum_x = sum((point.get("x") or 0) * (point.get("count") or 0) for point in points)
    sum_y = sum((point.get("y") or 0) * (point.get("count") or 0) for point in points)
    return round(sum_x / total, 2), round(sum_y / total, 2), int(total)


def fetch_heatmaps(ctx: Context, leagues, seasons, refresh: bool = False,
                   limit: int | None = None) -> None:
    """One request per player-season, cached. Resumable and interruptible like every other layer."""
    conn = ctx.require_conn()
    targets = [target for target in heatmap_targets(conn, seasons) if target[0] in leagues]
    if limit:
        targets = targets[:limit]
    todo = [t for t in targets
            if refresh or not (ctx.config.cache_dir /
                               f"sofascore_heatmap_{t[0]}_{t[1]}_{t[2]}.json").exists()]
    print(f"[positions] heatmap: {len(targets)} player-seasons · {len(todo)} to fetch "
          f"(~{len(todo) * (REQUEST_DELAY + REQUEST_JITTER / 2) / 60:.0f} min)")
    session = _client()
    season_ids: dict[tuple[str, str], int | None] = {}
    done = 0
    try:
        for league, season, provider_id, _fc_id in todo:
            if ctx.cancelled():
                raise KeyboardInterrupt
            if (league, season) not in season_ids:
                _polite_sleep(ctx.cancel_event)
                season_ids[(league, season)] = resolve_season_id(session, league, season)
            season_id = season_ids[(league, season)]
            if season_id is None:
                continue
            _polite_sleep(ctx.cancel_event)
            payload = _get_json(session, HEATMAP_ENDPOINT.format(
                pid=provider_id, tid=TOURNAMENTS[league], sid=season_id))
            if payload is None:
                continue
            _atomic_write_text(
                ctx.config.cache_dir / f"sofascore_heatmap_{league}_{season}_{provider_id}.json",
                json.dumps(payload, ensure_ascii=False))
            done += 1
            if done % 50 == 0 or done == len(todo):
                print(f"[positions] heatmap {done}/{len(todo)} player-seasons")
    except KeyboardInterrupt:
        print("[positions] interrupted - every fetched heatmap is cached, rerun to continue")
    finally:
        session.close()
    ingest_heatmaps_from_cache(ctx)


def ingest_heatmaps_from_cache(ctx: Context, seasons=None) -> int:
    """positions.avg_x / avg_y from the cached heatmaps (offline).

    Runs AFTER `derive_roles_from_match_layer`, never before: that function rewrites the whole
    sofascore slice of `positions`, so coordinates written first would be silently dropped.
    """
    conn = ctx.require_conn()
    xref = {source_id: fc_id for source_id, fc_id in conn.execute(
        "SELECT source_id, fc_id FROM player_xref WHERE source = 'sofascore'")}
    written = orphans = empty = 0
    for path in sorted(ctx.config.cache_dir.glob("sofascore_heatmap_*.json")):
        key = _HEATMAP_CACHE_NAME.search(path.name)
        if not key:
            continue
        season, provider_id = key.group(2), key.group(3)
        if seasons and season not in seasons:
            continue
        fc_id = xref.get(provider_id)
        if fc_id is None:
            orphans += 1
            continue
        try:
            centroid = heatmap_centroid(json.loads(path.read_text(encoding="utf-8")))
        except Exception as exc:   # noqa: BLE001 - a corrupt cache file must not abort the rebuild
            print(f"[positions] skipping unreadable heatmap {path.name}: {exc}")
            continue
        if centroid is None:
            empty += 1
            continue
        avg_x, avg_y, _touches = centroid
        updated = conn.execute(
            "UPDATE positions SET avg_x = ?, avg_y = ? "
            "WHERE fc_id = ? AND season = ? AND source = 'sofascore'",
            (avg_x, avg_y, fc_id, season)).rowcount
        if not updated:
            # a player-season with a heatmap but no per-match layer (older seasons): the coordinates
            # are still a fact about him, so the row is created rather than thrown away.
            conn.execute(
                "INSERT OR REPLACE INTO positions(fc_id, season, source, avg_x, avg_y, is_friendly) "
                "VALUES (?, ?, 'sofascore', ?, ?, 0)", (fc_id, season, avg_x, avg_y))
        written += 1
    conn.commit()
    if written or orphans or empty:
        print(f"[positions] heatmap: avg_x/avg_y on {written} player-seasons "
              f"({empty} empty clouds, {orphans} without a resolved identity)")
    return written


# ---------- role vocabulary cross-tab (offline) ----------
def role_crosstab(ctx: Context) -> dict[str, dict[str, int]]:
    """provider slot (G/D/M/F) x listone role, per Classic role and per Mantra role -> report.

    Why it exists: the forward-pairs work measured that 57-81% of the provider's `F` are listone `A`,
    which is what let K (strikers fielded per eleven) be read as a fantacalcio fact. Extending the
    same counting to defenders and midfielders needs the SAME translation measured for D and M -
    otherwise `club_match_lineups.defenders` is a number about a vocabulary we have not checked.
    Pure SQL + counting, zero requests.
    """
    conn = ctx.require_conn()
    rows = conn.execute(
        """
        SELECT e.position, r.role_classic, r.roles, e.season, COUNT(*) AS n
        FROM external_match_stats e
        JOIN rosters r ON r.fc_id = e.fc_id AND r.season = e.season
        WHERE e.source = 'sofascore' AND e.position IS NOT NULL AND COALESCE(e.minutes, 0) > 0
          AND r.role_classic IS NOT NULL
        GROUP BY e.position, r.role_classic, r.roles, e.season
        """
    ).fetchall()
    classic: dict[str, dict[str, int]] = {}
    mantra: dict[str, dict[str, int]] = {}
    by_season: dict[str, dict[str, int]] = {}
    for position, role_classic, roles, season, n in rows:
        classic.setdefault(position, {})
        classic[position][role_classic] = classic[position].get(role_classic, 0) + n
        for role in (roles or "").replace("/", ";").split(";"):
            role = role.strip()
            if role:
                mantra.setdefault(position, {})
                mantra[position][role] = mantra[position].get(role, 0) + n
        key = f"{season}|{position}"
        by_season.setdefault(key, {})
        by_season[key][role_classic] = by_season[key].get(role_classic, 0) + n

    import csv
    import io

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["scope", "provider_position", "our_role", "appearances", "share_of_provider"])
    for scope, table in (("classic", classic), ("mantra", mantra)):
        for position, counts in sorted(table.items()):
            total = sum(counts.values()) or 1
            for role, n in sorted(counts.items(), key=lambda item: -item[1]):
                writer.writerow([scope, position, role, n, f"{n / total:.4f}"])
    for key, counts in sorted(by_season.items()):
        season, position = key.split("|")
        total = sum(counts.values()) or 1
        for role, n in sorted(counts.items(), key=lambda item: -item[1]):
            writer.writerow([season, position, role, n, f"{n / total:.4f}"])
    path = ctx.config.data_dir / "reports" / "role_crosstab.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    _atomic_write_text(path, buffer.getvalue())

    for position in ("G", "D", "M", "F"):
        counts = classic.get(position, {})
        total = sum(counts.values())
        if not total:
            continue
        detail = " ".join(f"{role} {100 * n / total:.0f}%"
                          for role, n in sorted(counts.items(), key=lambda item: -item[1])[:3])
        print(f"[positions] provider {position} ({total} appearances): {detail}")
    print(f"[positions] role cross-tab -> {path}")
    return classic


# ---------- which league a club plays in (needed for a build from zero) ----------
def derive_club_leagues(ctx: Context) -> tuple[int, int]:
    """clubs.league (and then rosters.league) from the cached provider files, by team name.

    Why this exists: on THIS machine the league of a euro club came from the Drive roster exports,
    which carry a league column. A fresh clone has no Drive files - it builds the registry from the
    authenticated listone, and the euro listone does NOT say which league a club plays in. Without
    this, `clubs.league` would stay NULL for every foreign club and the matcher would lose its league
    pass, `matchdays` its per-league map and the engine its league filters.

    The provider cache already answers it: each `sofascore_stats_{league}_{season}.json` IS a league,
    so every team name in it plays there. Fills NULLs only - a league we already know is never
    overwritten by a name match. Offline.
    """
    conn = ctx.require_conn()
    known: dict[str, str] = {}
    for path in sorted(ctx.config.cache_dir.glob("sofascore_stats_*.json")):
        match = _CACHE_NAME.search(path.name)
        if not match:
            continue
        league = match.group(1)
        if league not in TOURNAMENTS:
            continue
        try:
            rows = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:   # noqa: BLE001 - a corrupt cache file must not abort the rebuild
            print(f"[positions] skipping unreadable cache {path.name}: {exc}")
            continue
        for row in rows:
            name = ((row.get("team") or {}).get("name") or "").strip()
            if name:
                known.setdefault(club_key(name), league)
    if not known:
        return 0, 0
    clubs = 0
    for club_id, name in conn.execute(
            "SELECT fc_club_id, canonical_name FROM clubs WHERE league IS NULL").fetchall():
        league = known.get(club_key(CLUB_ALIASES.get(name, name))) or known.get(club_key(name))
        if league:
            conn.execute("UPDATE clubs SET league = ? WHERE fc_club_id = ?", (league, club_id))
            clubs += 1
    rosters = conn.execute(
        "UPDATE rosters SET league = (SELECT c.league FROM clubs c "
        "WHERE c.fc_club_id = rosters.fc_club_id) "
        "WHERE league IS NULL AND fc_club_id IS NOT NULL").rowcount
    conn.commit()
    if clubs or rosters:
        print(f"[positions] league from the provider cache: {clubs} clubs, {rosters} roster rows")
    return clubs, rosters


# ---------- identity resolution ----------
def _club_pools(conn, season: str):
    """Roster pools for a season, keyed for the three matcher passes.

    Returns (by_club_key, by_league, season_pool): the club pass is the precise one; the league pass
    catches mid-season transfers (our roster club != the provider's); the season pass catches players
    whose fantacalcio league differs from the one being scraped (a summer move between two of the 5).
    """
    by_club: dict[str, list] = {}
    by_league: dict[str, list] = {}
    season_pool: list = []
    rows = conn.execute(
        """
        SELECT r.fc_id, p.canonical_name, cl.canonical_name, r.league
        FROM rosters r
        JOIN players p USING(fc_id)
        LEFT JOIN clubs cl ON cl.fc_club_id = r.fc_club_id
        WHERE r.season = ?
        """,
        (season,),
    ).fetchall()
    for fc_id, our_name, our_club, league in rows:
        entry = build_pool_entry(fc_id, our_name)
        provider_club = CLUB_ALIASES.get(our_club, our_club)
        by_club.setdefault(club_key(provider_club), []).append(entry)
        by_league.setdefault(league or "", []).append(entry)
        season_pool.append(entry)
    return by_club, by_league, season_pool


# A claim = one provider row asking to be player fc_id. `evidence` = (pass_rank, tier), lower is
# stronger: an explicit manual override beats the club pass, which beats the league/season fallbacks.
_PASS_RANK = {"manual": -1, "club": 0, "league": 1, "season": 2}


class Claim:
    __slots__ = (
        "evidence",
        "fc_id",
        "league",
        "pass_name",
        "provider_id",
        "provider_name",
        "provider_team",
        "row",
    )

    def __init__(self, fc_id, evidence, league, row, pass_name):
        player = row.get("player") or {}
        self.fc_id = fc_id
        self.evidence = evidence
        self.league = league
        self.row = row
        self.pass_name = pass_name
        self.provider_id = str(player.get("id") or "")
        self.provider_name = player.get("name") or ""
        self.provider_team = (row.get("team") or {}).get("name") or ""

    def as_report(self, season: str, reason: str, detail: str) -> dict:
        return {"league": self.league, "season": season, "provider_id": self.provider_id,
                "provider_name": self.provider_name, "provider_team": self.provider_team,
                "reason": reason, "detail": detail}


def _manual_overrides(conn) -> dict[str, int]:
    """manual_overrides rows pinning a provider id to an fc_id (highest precedence, spec §7):
    entity='player_xref', field='sofascore', value=<provider id>."""
    return {str(value): fc_id for value, fc_id in conn.execute(
        "SELECT value, fc_id FROM manual_overrides "
        "WHERE entity = 'player_xref' AND field = 'sofascore' AND fc_id IS NOT NULL")}


def collect_claims(conn, rows: list[dict], league: str, season: str, pools, overrides):
    """Turn one league-season of provider rows into claims (+ the rows nothing matched)."""
    by_club, by_league, season_pool = pools
    claims: list[Claim] = []
    report: list[dict] = []
    for row in rows:
        player = row.get("player") or {}
        provider_id = str(player.get("id") or "")
        name = player.get("name") or ""
        team = (row.get("team") or {}).get("name") or ""
        if provider_id in overrides:
            claims.append(Claim(overrides[provider_id], (_PASS_RANK["manual"], 0), league, row,
                                "manual"))
            continue
        passes = (
            ("club", by_club.get(club_key(team), []), 4),
            ("league", by_league.get(league, []), 3),
            ("season", season_pool, 2),
        )
        for pass_name, pool, max_tier in passes:
            tier, candidates = match_in_pool(name, pool)
            if not candidates or tier > max_tier:
                continue
            if len(candidates) == 1:
                claims.append(Claim(candidates[0][0], (_PASS_RANK[pass_name], tier), league, row,
                                    pass_name))
            else:
                report.append({"league": league, "season": season, "provider_id": provider_id,
                               "provider_name": name, "provider_team": team, "reason": "ambiguous",
                               "detail": f"{pass_name}/t{tier}: "
                                         + " | ".join(c[1] for c in candidates[:4])})
            break
        else:
            report.append({"league": league, "season": season, "provider_id": provider_id,
                           "provider_name": name, "provider_team": team, "reason": "unmatched",
                           "detail": f"appearances={row.get('appearances')}"})
    return claims, report


def enforce_injectivity(claims: list[Claim], season: str):
    """Keep at most one provider row per (fc_id, competition), and refuse weak multi-league claims.

    Without this the surname-only fallbacks collapse namesakes: 10 different 'Sanchez' across the 5
    leagues all matched our single 'Sanchez' and silently overwrote each other. Rule: for each fc_id
    keep only the claims at its strongest evidence level; if several remain and that evidence is a
    fallback pass, they are namesakes -> keep none. Several claims at CLUB-pass strength in different
    competitions are a genuine cross-league transfer -> keep them all (one row per competition).
    """
    by_fc: dict[int, list[Claim]] = {}
    for claim in claims:
        by_fc.setdefault(claim.fc_id, []).append(claim)

    kept: list[Claim] = []
    report: list[dict] = []
    for fc_id, group in by_fc.items():
        best = min(claim.evidence for claim in group)
        finalists = [claim for claim in group if claim.evidence == best]
        for claim in group:
            if claim.evidence != best:
                report.append(claim.as_report(
                    season, "superseded",
                    f"fc_id={fc_id} matched more strongly by {finalists[0].pass_name}"))
        competitions = {claim.league for claim in finalists}
        if len(finalists) > 1 and (best[0] > _PASS_RANK["club"] or len(competitions) < len(finalists)):
            for claim in finalists:
                report.append(claim.as_report(
                    season, "ambiguous",
                    f"fc_id={fc_id} claimed by {len(finalists)} provider rows at "
                    f"{claim.pass_name}/t{best[1]}"))
            continue
        kept.extend(finalists)
    return kept, report


def enforce_one_identity(claims_by_season: dict[str, list[Claim]]):
    """One fc_id <-> ONE provider id, across every season.

    A real player has a single SofaScore id for life, so two different provider ids landing on the
    same fc_id means a namesake slipped through in some season (e.g. Darwin Nunez in the Premier
    League and a different Nunez in LaLiga two seasons later). The provider id with the strongest
    evidence - and, on a tie, the most seasons - keeps the identity; the other's claims are dropped.
    """
    by_fc: dict[int, dict[str, list[tuple[str, Claim]]]] = {}
    for season, claims in claims_by_season.items():
        for claim in claims:
            by_fc.setdefault(claim.fc_id, {}).setdefault(claim.provider_id, []).append(
                (season, claim))

    dropped: set[int] = set()
    report: list[dict] = []
    for fc_id, by_provider in by_fc.items():
        if len(by_provider) < 2:
            continue
        ranked = sorted(by_provider.items(),
                        key=lambda item: (min(c.evidence for _s, c in item[1]), -len(item[1])))
        winner = ranked[0][0]
        for provider_id, entries in ranked[1:]:
            for season, claim in entries:
                dropped.add(id(claim))
                report.append(claim.as_report(
                    season, "namesake",
                    f"fc_id={fc_id} already identified as provider id {winner}"))
    if not dropped:
        return claims_by_season, report
    kept = {season: [c for c in claims if id(c) not in dropped]
            for season, claims in claims_by_season.items()}
    return kept, report


def resolve_season(conn, season: str, rows_by_league: dict[str, list[dict]]):
    """Resolve a WHOLE season at once (every league together), so injectivity can be enforced."""
    pools = _club_pools(conn, season)
    overrides = _manual_overrides(conn)
    claims: list[Claim] = []
    report: list[dict] = []
    for league, rows in rows_by_league.items():
        league_claims, league_report = collect_claims(conn, rows, league, season, pools, overrides)
        claims += league_claims
        report += league_report
    kept, injectivity_report = enforce_injectivity(claims, season)
    return kept, report + injectivity_report


# ---------- persistence ----------
def _int(value):
    return int(value) if isinstance(value, (int, float)) else None


def _store_claims(conn, season: str, claims: list[Claim]) -> int:
    for claim in claims:
        row = claim.row
        if claim.provider_id:
            conn.execute(
                "INSERT OR REPLACE INTO player_xref(fc_id, source, source_id) VALUES (?, ?, ?)",
                (claim.fc_id, "sofascore", claim.provider_id),
            )
        conn.execute(
            """
            INSERT OR REPLACE INTO external_stats(
                fc_id, season, source, competition, matches, starts, minutes, goals, assists,
                pen_scored, pen_taken, xg, xa, rating, yellows, reds)
            VALUES (?, ?, 'sofascore', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                claim.fc_id, season, claim.league, _int(row.get("appearances")),
                _int(row.get("matchesStarted")), _int(row.get("minutesPlayed")),
                _int(row.get("goals")), _int(row.get("assists")), _int(row.get("penaltyGoals")),
                _int(row.get("penaltiesTaken")), row.get("expectedGoals"),
                row.get("expectedAssists"), row.get("rating"), _int(row.get("yellowCards")),
                _int(row.get("redCards")),
            ),
        )
    return len(claims)


def _write_coverage_report(config, report: list[dict]) -> None:
    """Unresolved provider rows -> data/reports/sofascore_coverage.csv (spec: coverage_report)."""
    if not report:
        return
    import csv
    import io

    path = config.data_dir / "reports" / "sofascore_coverage.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=["league", "season", "provider_id", "provider_name",
                                                "provider_team", "reason", "detail"])
    writer.writeheader()
    writer.writerows(report)
    _atomic_write_text(path, buffer.getvalue())
    print(f"[positions] {len(report)} unresolved provider rows -> {path}")


def _clear_season(conn, season: str, rows_by_league: dict[str, list[dict]]) -> None:
    """Wipe what we are about to rewrite, so re-resolving always converges to the same DB content."""
    for league in rows_by_league:
        conn.execute("DELETE FROM external_stats WHERE source = 'sofascore' "
                     "AND season = ? AND competition = ?", (season, league))
    # Also drop the xref rows of the provider ids being re-resolved: a mapping rejected this time
    # (e.g. a namesake collapse from an older run) must not survive as a stale identity.
    conn.executemany(
        "DELETE FROM player_xref WHERE source = 'sofascore' AND source_id = ?",
        [(str((row.get("player") or {}).get("id") or ""),)
         for rows in rows_by_league.values() for row in rows],
    )


def _log_season(season: str, claims: list[Claim], rows_by_league, rejected: int) -> None:
    passes: dict[str, int] = {}
    for claim in claims:
        passes[claim.pass_name] = passes.get(claim.pass_name, 0) + 1
    detail = " ".join(f"{k}={v}" for k, v in sorted(passes.items()))
    total_rows = sum(len(rows) for rows in rows_by_league.values())
    rate = 100 * len(claims) / total_rows if total_rows else 0.0
    print(f"[positions] {season} {sorted(rows_by_league)}: {len(claims)}/{total_rows} provider rows "
          f"resolved ({rate:.1f}%) [{detail}] · {rejected} unresolved/rejected")


def our_side_coverage(conn, season: str) -> str:
    """Share of OUR roster players (the perimeter) that got provider stats - the metric that matters.
    The provider-side rate is low by construction: it lists every player of the whole league, while
    EuroLeghe only carries the top clubs."""
    rows = conn.execute(
        """
        SELECT r.league, COUNT(*),
               SUM(CASE WHEN EXISTS (SELECT 1 FROM external_stats e
                                     WHERE e.fc_id = r.fc_id AND e.season = r.season
                                       AND e.source = 'sofascore') THEN 1 ELSE 0 END)
        FROM rosters r
        JOIN season_stats s ON s.fc_id = r.fc_id AND s.season = r.season AND s.pv > 0
        WHERE r.season = ? AND r.league IS NOT NULL
        GROUP BY r.league ORDER BY r.league
        """,
        (season,),
    ).fetchall()
    return " · ".join(f"{league} {covered}/{total} ({100 * covered / total:.0f}%)"
                      for league, total, covered in rows if total)


# ---------- orchestration ----------
def run(ctx: Context, *, leagues=None, seasons=None, refresh: bool = False,
        layer: str = "season", **kwargs) -> None:
    """Download SofaScore data for the selected leagues/seasons.

    layer='season' (default, ~6 requests per league-season) fills external_stats; layer='match'
    walks the rounds and the perimeter clubs' lineups into external_match_stats (hours, resumable);
    layer='all' does both. layer='reparse' rebuilds external_match_stats from the cached round
    payloads only - guaranteed offline, for when the parser learns to read a new field.

    Resumable: anything already cached is not downloaded again unless refresh=True.
    Interruptible via ctx.cancel_event / Ctrl-C - whatever was cached is kept and still ingested.
    """
    ctx.require_conn()
    if isinstance(leagues, str):
        leagues = [leagues]
    if isinstance(seasons, str):
        seasons = [seasons]
    leagues = tuple(leagues) if leagues else tuple(TOURNAMENTS)
    # SEASONS only bounds NEW downloads; the offline reparse covers the whole cache unless the
    # caller names seasons explicitly (the cache spans further back than the download default).
    requested_seasons = tuple(seasons) if seasons else None
    seasons = tuple(seasons) if seasons else SEASONS
    unknown = [league for league in leagues if league not in TOURNAMENTS]
    if unknown:
        raise RuntimeError(f"Unknown league(s) {unknown}; choose from {sorted(TOURNAMENTS)}")
    if layer not in ("season", "match", "complete", "heatmap", "all", "reparse", "crosstab"):
        raise RuntimeError(f"Unknown layer {layer!r}; choose from "
                           "season|match|complete|heatmap|all|reparse|crosstab")

    ctx.config.cache_dir.mkdir(parents=True, exist_ok=True)
    if layer == "crosstab":
        role_crosstab(ctx)
        return
    if layer == "reparse":
        reingest_match_layer(ctx, seasons=requested_seasons)
        derive_roles_from_match_layer(ctx)
        ingest_heatmaps_from_cache(ctx, seasons=requested_seasons)
        return
    if layer == "heatmap":
        fetch_heatmaps(ctx, leagues, seasons, refresh)
        return
    if layer == "complete":
        complete_match_layer(ctx, leagues, seasons)
        reingest_match_layer(ctx, seasons=seasons)
        derive_roles_from_match_layer(ctx)
        ingest_heatmaps_from_cache(ctx, seasons=seasons)
        return
    if layer == "match":
        fetch_match_layer(ctx, leagues, seasons, refresh)
        derive_roles_from_match_layer(ctx)
        ingest_heatmaps_from_cache(ctx, seasons=seasons)
        return
    session = _client()
    try:
        for league in leagues:
            for season in seasons:
                if ctx.cancelled():
                    raise KeyboardInterrupt
                cache = ctx.config.cache_dir / f"sofascore_stats_{league}_{season}.json"
                if cache.exists() and not refresh:
                    print(f"[positions] {league} {season}: already cached - skipping download")
                    continue
                _polite_sleep(ctx.cancel_event)
                season_id = resolve_season_id(session, league, season)
                if season_id is None:
                    print(f"[positions] {league} {season}: season not found upstream - skipping")
                    continue
                _polite_sleep(ctx.cancel_event)
                rows = download_season_stats(session, league, season_id, ctx.cancel_event)
                if not rows:
                    print(f"[positions] {league} {season}: no rows returned - skipping")
                    continue
                _atomic_write_text(cache, json.dumps(rows, ensure_ascii=False))
                print(f"[positions] {league} {season}: {len(rows)} provider rows cached")
    except KeyboardInterrupt:
        print("[positions] interrupted - already-downloaded league-seasons are cached")
    finally:
        session.close()
    # Identity resolution always runs over the full cache: it is a whole-season decision (see
    # enforce_injectivity), so a partial download must not leave a partially resolved season.
    reingest_from_cache(ctx, seasons=seasons)
    if layer == "all":
        fetch_match_layer(ctx, leagues, seasons, refresh)


def _cached_rows(config, seasons=None) -> dict[str, dict[str, list[dict]]]:
    """Cached provider aggregates grouped as {season: {league: rows}}."""
    out: dict[str, dict[str, list[dict]]] = {}
    for path in sorted(config.cache_dir.glob("sofascore_stats_*.json")):
        match = _CACHE_NAME.search(path.name)
        if not match:
            continue
        league, season = match.group(1), match.group(2)
        if seasons and season not in seasons:
            continue
        try:
            rows = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:   # noqa: BLE001 - a corrupt cache file must not abort the rebuild
            print(f"[positions] skipping unreadable cache {path.name}: {exc}")
            continue
        out.setdefault(season, {})[league] = rows
    return out


def reingest_from_cache(ctx: Context, seasons=None) -> None:
    """Rebuild external_stats offline from the cached provider JSON (the raw source of truth).

    Two resolution phases: per season (injectivity between the 5 leagues) and then across seasons
    (one fc_id <-> one provider id). Nothing is written until both have run.
    """
    conn = ctx.require_conn()
    by_season = _cached_rows(ctx.config, seasons)
    if not by_season:
        return
    claims_by_season: dict[str, list[Claim]] = {}
    rejected: dict[str, int] = {}
    report: list[dict] = []
    for season, rows_by_league in sorted(by_season.items()):
        claims, season_report = resolve_season(conn, season, rows_by_league)
        claims_by_season[season] = claims
        rejected[season] = len(season_report)
        report += season_report
    claims_by_season, identity_report = enforce_one_identity(claims_by_season)
    for entry in identity_report:
        rejected[entry["season"]] = rejected.get(entry["season"], 0) + 1
    report += identity_report

    total = 0
    for season, rows_by_league in sorted(by_season.items()):
        _clear_season(conn, season, rows_by_league)
        claims = claims_by_season[season]
        total += _store_claims(conn, season, claims)
        conn.commit()
        _log_season(season, claims, rows_by_league, rejected[season])
        print(f"[positions] {season} perimeter coverage: {our_side_coverage(conn, season)}")
    print(f"[positions] {total} external_stats rows from {len(by_season)} cached seasons")
    _write_coverage_report(ctx.config, report)


def derive_birth_years(ctx: Context) -> int:
    """players.birth_year from the cached lineups - no source of ours carries a date of birth.

    Every lineup entry ships the player's dateOfBirthTimestamp, so the age (needed by the U22
    trigger and, later, the age curves) is already sitting in the round cache.
    """
    conn = ctx.require_conn()
    xref = {source_id: fc_id for source_id, fc_id in conn.execute(
        "SELECT source_id, fc_id FROM player_xref WHERE source = 'sofascore'")}
    years: dict[int, int] = {}
    for path in sorted(ctx.config.cache_dir.glob("sofascore_round_*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:   # noqa: BLE001 - a corrupt cache file must not abort the rebuild
            print(f"[positions] skipping unreadable round cache {path.name}: {exc}")
            continue
        for sides in (payload.get("lineups") or {}).values():
            for entries in sides.values():
                for entry in entries or []:
                    player = entry.get("player") or {}
                    fc_id = xref.get(str(player.get("id") or ""))
                    timestamp = player.get("dateOfBirthTimestamp")
                    if fc_id is not None and timestamp:
                        years[fc_id] = int(time.strftime("%Y", time.gmtime(timestamp)))
    conn.executemany("UPDATE players SET birth_year = ? WHERE fc_id = ? AND birth_year IS NULL",
                     [(year, fc_id) for fc_id, year in years.items()])
    conn.commit()
    filled = conn.execute("SELECT COUNT(birth_year) FROM players").fetchone()[0]
    total = conn.execute("SELECT COUNT(*) FROM players").fetchone()[0]
    print(f"[positions] birth years from the lineups: {filled}/{total} players "
          f"({100 * filled / total:.0f}%)")
    return filled


def reingest_all_from_cache(ctx: Context) -> None:
    """Everything this module rebuilds offline, in dependency order (used by `rebuild`)."""
    reingest_from_cache(ctx)
    reingest_match_layer(ctx)
    derive_roles_from_match_layer(ctx)
    ingest_heatmaps_from_cache(ctx)     # after the roles: they rewrite the same `positions` slice
    derive_birth_years(ctx)
