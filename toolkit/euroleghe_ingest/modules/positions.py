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

from euroleghe_ingest import config
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
# The CURRENT squad of a club, and the cheapest source of the granular real role: every entry carries
# `positionsDetailed` (one to three of the twelve codes) and `preferredFoot`. One request per CLUB
# instead of one per player - 77 requests for the whole perimeter instead of ~1500.
SQUAD_ENDPOINT = BASE_URL + "/team/{tid}/players"
# The per-player fallback, for whoever no squad page covered. Same two fields, 1 request each.
PLAYER_ENDPOINT = BASE_URL + "/player/{pid}"
# A club's own recent fixtures, whatever competition they were in. The round scrape can only see what a
# LEAGUE calendar contains, so in July the per-match layer stops at the last matchday of May and a whole
# pre-season is invisible - which is precisely the window an August auction is prepared in.
TEAM_EVENTS_ENDPOINT = BASE_URL + "/team/{tid}/events/last/{page}"
INCIDENTS_ENDPOINT = BASE_URL + "/event/{eid}/incidents"
CREST_ENDPOINT = BASE_URL + "/team/{tid}/image"
EXTRA_WINDOW_DAYS = 150       # how far back a non-league match is still part of "the last ten"

# How many pages of a club's history the listing may be walked back. The endpoint serves 30 finished
# events a page - measured on Inter, 15/08/2026: page 0 covers 2026-01→2026-08, page 3 reaches
# 2024-10 - so a page is about half a season and twelve of them are three years, which is as far back
# as any channel here looks. It is a CAP and not a target: the walk stops as soon as a page is older
# than the window asked for, so the default 150-day run still costs one page per club.
EXTRA_MAX_PAGES = 12
# Quanti rifiuti di fila bastano a dire che la fonte ha chiuso. Cinque e non uno: un 403 isolato capita, e
# novantuno di fila sono un provider che non ci vuole - continuare a chiedere non lo riapre e la corsa del
# 17/08/2026 ha dimostrato che intanto puo' fare danni.
REFUSAL_LIMIT = 5

# SofaScore unique-tournament ids for the 5 leagues in scope (verified against the API).
TOURNAMENTS: dict[str, int] = {
    "serie_a": 23,
    "premier_league": 17,
    "la_liga": 8,
    "bundesliga": 35,
    "ligue_1": 34,
}

# FEEDER leagues: where the PROMOTED clubs come from. Deliberately NOT in `TOURNAMENTS`, which means
# "a championship in scope" - a listone quotes nobody here, `scoring_config` has no rules for it, and
# `derive_club_leagues` must not file a club under it. What we want is one thing only: the SEASON
# AGGREGATE of the men a promoted club brings up, because without it their starts and minutes are
# missing rather than measured and the claim reads noise (Frosinone's drawn XI: claims 0.07-0.43,
# 4/11 against the press - todolist-formazioni-tipo item 1).
# It cannot be derived from the per-match layer we already have: for 2025-26 that holds 97 Serie B
# matches of 380, round 16 to 38, a median of 14 per player against 31 in Serie A - so a derived
# aggregate would say "he played a third of the season" about a man who played it all. Halving a
# denominator is worse than leaving it empty: «vuoto = ignoto, mai zero».
# A bare run never touches these; `--league serie_b` does. One request for the season list plus one
# per page of 100 players.
FEEDER_TOURNAMENTS: dict[str, int] = {
    "serie_b": 53,
}
# The keys are `config.FEEDER_LEAGUES`: this module owns the provider ids, config owns the list, and a
# key here that config does not know would be a championship nothing downstream counts as one.
assert set(FEEDER_TOURNAMENTS) == set(config.FEEDER_LEAGUES)


# The provider's own slug for a championship we have a key for -> OUR key. Only for the leagues in
# `known_leagues()`: a cup or a friendly keeps the provider's slug, because it is not a championship
# and the sheet has to be able to tell them apart (`snapshot.competition_class`).
_OUR_SLUG: dict[str, str] = {"serie-b": "serie_b"}


def tournament_id(league: str) -> int:
    """The provider's tournament id for a league in scope OR a feeder one."""
    if league in TOURNAMENTS:
        return TOURNAMENTS[league]
    return FEEDER_TOURNAMENTS[league]


def known_leagues() -> dict[str, int]:
    """Every league this module can be pointed at, in scope or feeder."""
    return {**TOURNAMENTS, **FEEDER_TOURNAMENTS}
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
_SQUAD_CACHE_NAME = re.compile(r"sofascore_squad_(\d+)_(\d{4}-\d{2}-\d{2})\.json$")
_PLAYER_CACHE_NAME = re.compile(r"sofascore_player_(\d+)_(\d{4}-\d{2}-\d{2})\.json$")


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
    data = _get_json(session, SEASONS_ENDPOINT.format(tid=tournament_id(league)))
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
        url = STATS_ENDPOINT.format(tid=tournament_id(league), sid=season_id, limit=PAGE_SIZE,
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
    data = _get_json(session, ROUND_ENDPOINT.format(tid=tournament_id(league), sid=season_id, rnd=rnd))
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


def _season_of(date: str) -> str:
    """'2026-07-18' -> '2026-27'. The football year turns in July, so a pre-season friendly belongs to
    the season about to start: tagging it with the one that just ended would put it in the aggregates
    of a completed season and in the roles derived from them."""
    year = int(date[:4])
    return f"{year}-{(year + 1) % 100:02d}" if date[5:7] >= "07" else f"{year - 1}-{year % 100:02d}"


def _iso_date(timestamp) -> str | None:
    if not timestamp:
        return None
    return time.strftime("%Y-%m-%d", time.gmtime(timestamp))


def parse_round(payload: dict, season: str, xref: dict[str, int],
                keep_unplayed: bool = False) -> tuple[list[tuple], list[tuple], int]:
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
        # A cached file normally holds one competition, so the payload names it; the extra layer holds a
        # club's friendlies and cup ties together, so each event may carry its OWN slug. It has to be
        # stored per row: `snapshot.competition_class` reads that slug to keep ten goals in friendlies
        # from ever being counted as ten in a league.
        # ...and it is normalized HERE too, not only where it was downloaded: the cache is the raw
        # source of truth and is replayed offline, so a file written before `_slug_of` learned our keys
        # still carries `serie-b`. One spelling per competition, whichever run wrote the file.
        competition = _OUR_SLUG.get(event.get("competition") or "", event.get("competition")) or league
        # and the same for the season: one file normally holds one, but a club's extra matches straddle
        # the turn of the football year - a May cup tie and a July friendly are two different seasons.
        event_season = event.get("season") or season
        sides = payload.get("lineups", {}).get(event_id) or {}
        real_md = event.get("round")
        match_date = _iso_date(event.get("startTimestamp"))
        home_goals, away_goals = event.get("homeGoals"), event.get("awayGoals")
        for side in ("home", "away"):
            club = event.get(side)
            opponent = event.get("away" if side == "home" else "home")
            team_goals = home_goals if side == "home" else away_goals
            opponent_goals = away_goals if side == "home" else home_goals
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
                if not stats and not keep_unplayed:
                    continue          # named on the bench but never came on
                # `keep_unplayed` is the EXTRA layer's own case, and it is not the same fact: the
                # provider publishes the eleven of a pre-season friendly and NO per-player statistics
                # at all (measured: 0 of 11 entries carry any). Storing the row with a null minute is
                # what lets the sheet say "he started that friendly" instead of "no data", and a null
                # minute is what keeps him out of every rate - there is nothing to average.
                rows.append((
                    fc_id, event_season, event_id, competition, real_md, match_date, club, opponent,
                    1 if side == "home" else 0,
                    entry.get("position") or player.get("position"),
                    0 if entry.get("substitute") else 1,
                    _int(stats.get("minutesPlayed")), stats.get("rating"),
                    _int(stats.get("goals")), _int(stats.get("goalAssist")),
                    stats.get("expectedGoals"), stats.get("expectedAssists"),
                    _int(stats.get("totalShots")), _int(stats.get("onTargetScoringAttempt")),
                    _int(stats.get("bigChanceCreated")), _int(stats.get("bigChanceMissed")),
                    _int(stats.get("keyPass")), _int(stats.get("touches")),
                    team_goals, opponent_goals,
                ))
            if starters:
                club_rows.append((event_season, event_id, club, competition, real_md, match_date,
                                  starters,
                                  slots["G"], slots["D"], slots["M"], slots["F"]))
    return rows, club_rows, unknown


# The per-match layer's two source tags, and the difference between them is the GATE. `sofascore` is
# the five leagues we walk round by round: every fitted feature reads it. `sofascore_extra` is what no
# league calendar contains - pre-season friendlies, cups, continental ties - and it is DESCRIPTIVE only:
# the snapshot's last-ten window unions both (a July friendly is exactly what August has to judge), while
# every engine query filters on the source, the platform's competition whitelist, or both. A friendly goal
# must never be summed into a propensity that a coefficient was fitted on.
LEAGUE_SOURCE = "sofascore"
EXTRA_SOURCE = "sofascore_extra"


def _store_match_rows(conn, rows: list[tuple], source: str = LEAGUE_SOURCE) -> int:
    conn.executemany(
        """
        INSERT OR REPLACE INTO external_match_stats(
            fc_id, season, source, match_id, competition, real_md, match_date, club, opponent,
            home, position, started, minutes, rating, goals, assists, xg, xa,
            shots, shots_on_target, big_chances_created, big_chances_missed, key_passes, touches,
            team_goals, opponent_goals)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [(row[0], row[1], source, *row[2:]) for row in rows],
    )
    return len(rows)


def _store_club_rows(conn, club_rows: list[tuple], source: str = LEAGUE_SOURCE) -> int:
    conn.executemany(
        """
        INSERT OR REPLACE INTO club_match_lineups(
            season, source, match_id, club, competition, real_md, match_date,
            starters, goalkeepers, defenders, midfielders, forwards)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [(row[0], source, *row[1:]) for row in club_rows],
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


def _slug_of(event: dict) -> str:
    """The competition of one event: OUR key where we have one, the provider's slug otherwise.

    A competition is an entity, so it joins through a canonical key and not through the string a
    source happens to spell it with - the rule this project pays for over and over. The provider calls
    Serie B `serie-b` and our own key for it is `serie_b`, and with both in the table the same
    championship was two: the season aggregate under one spelling, the per-match rows under the other,
    and any query naming one of them silently missing the other. The tournament ID decides, never the
    text. Everything genuinely outside our leagues (cups, friendlies, continental ties) keeps its slug,
    because those are not championships and the sheet reports them apart on purpose.
    """
    tournament = event.get("tournament") or {}
    unique = tournament.get("uniqueTournament") or {}
    by_id = {str(tid): league for league, tid in known_leagues().items()}
    ours = by_id.get(str(unique.get("id")))
    if ours:
        return ours
    name = unique.get("slug") or tournament.get("slug") or tournament.get("name") or "other"
    return str(name).lower()


def download_extra(session, team_id: str, since: str, cancel_event=None,
                   max_pages: int = EXTRA_MAX_PAGES) -> dict | None:
    """One club's matches OUTSIDE our five leagues, back to `since`, in the round cache's own shape.

    Kept: FINISHED events, no older than `since`, whose tournament is not one of the five we walk round
    by round - so friendlies and pre-season trophies, but also the cups and the continental ties the
    league calendar never listed. Each event keeps its own slug, because a friendly and a Coppa Italia
    tie are not the same evidence and the sheet reports them apart.

    PAGINATED, and it is what makes the past reachable at all: the endpoint serves 30 events a page and
    the first page is barely half a season, so a single page could never carry the European ties of the
    seasons before this one - measured 15/08/2026, Champions had 1,071 rows in 2025-26 and 21 in
    2024-25, which reads as «we never played them» and is really «we never asked». The walk stops at the
    first page entirely older than `since`, so a short window still costs one request per club.
    """
    known_tournaments = {str(tid) for tid in TOURNAMENTS.values()}
    events, lineups = [], {}
    listing = []
    # UNA PAGINA CHE RISPONDE non e' la stessa cosa di una pagina che non risponde, e la differenza decide
    # se si puo' scrivere il file vuoto: vedi `fetch_extra_matches`. Il 17/08/2026 questa distinzione non
    # c'era e 91 file di cache su 93 sono stati sovrascritti con «zero eventi» mentre il provider
    # rispondeva 403 a tutto - un IGNOTO salvato come uno ZERO, sopra dati buoni.
    answered = False
    for page in range(max(1, max_pages)):
        if cancel_event is not None and cancel_event.is_set():
            break
        if page:
            _polite_sleep(cancel_event)
        data = _get_json(session, TEAM_EVENTS_ENDPOINT.format(tid=team_id, page=page))
        answered = answered or data is not None
        found = (data or {}).get("events") or []
        if not found:
            break
        listing.extend(found)
        newest = max((_iso_date(one.get("startTimestamp")) or "" for one in found), default="")
        if newest < since:
            break                         # this page is already past the window: so is every next one
    if not listing:
        # Ha risposto e non ha niente in finestra: e' un FATTO, e il chiamante puo' salvarlo.
        # Non ha risposto: non si sa niente, e il chiamante non deve toccare quello che ha.
        return {"league": "extra", "round": 0, "events": [], "lineups": {}} if answered else None
    for event in listing:
        if (event.get("status") or {}).get("type") != "finished":
            continue
        date = _iso_date(event.get("startTimestamp"))
        if not date or date < since:
            continue
        unique = (event.get("tournament") or {}).get("uniqueTournament") or {}
        if str(unique.get("id")) in known_tournaments:
            continue                      # the round walk already has it, with its real matchday
        events.append({
            "id": event.get("id"),
            "home": (event.get("homeTeam") or {}).get("name") or "",
            "away": (event.get("awayTeam") or {}).get("name") or "",
            "round": None,                # a friendly has no matchday, and inventing one would sort
            "startTimestamp": event.get("startTimestamp"),
            "competition": _slug_of(event),
            "season": _season_of(date),
            # The result. A friendly has no ratings row to derive it from, so if it is not kept
            # here it does not exist anywhere.
            "homeGoals": ((event.get("homeScore") or {}).get("current")),
            "awayGoals": ((event.get("awayScore") or {}).get("current")),
        })
        if cancel_event is not None and cancel_event.is_set():
            break
        _polite_sleep(cancel_event)
        detail = _lineups_for(session, event.get("id"))
        if detail:
            lineups[str(event.get("id"))] = detail
    return {"league": "extra", "round": 0, "events": events, "lineups": lineups} if events else None


def fetch_extra_matches(ctx: Context, clubs=None, refresh: bool = False,
                        days: int = EXTRA_WINDOW_DAYS) -> dict[str, int]:
    """The extra layer for every club we have a provider id for: one listing + one lineup per match.

    Cheap (one request per club plus one per match found) and cached per club, so it can be re-run
    through August as the friendlies are played. The cache file is named like a round payload on
    purpose - `reingest_match_layer` then picks it up with no special case, and the per-event slug is
    what ends up in `external_match_stats.competition`.
    """
    conn = ctx.require_conn()
    targets = role_targets(conn, clubs)
    counts = {"clubs": 0, "matches": 0, "requests": 0}
    if not targets:
        print("[positions] no provider team id for any club - run `positions --layer roles` first")
        return counts
    since = time.strftime("%Y-%m-%d", time.gmtime(time.time() - days * 86400))
    # the file's season is only its cache key and the reingest filter: each event carries its own
    season = _season_of(time.strftime("%Y-%m-%d", time.gmtime()))
    print(f"[positions] extra matches since {since}: {len(targets)} clubs")
    session = _client()
    try:
        for name, team_id in targets:
            if ctx.cancelled():
                raise KeyboardInterrupt
            cache = ctx.config.cache_dir / f"sofascore_round_extra_{team_id}_{season}_r0.json"
            if cache.exists() and not refresh:
                continue
            _polite_sleep(ctx.cancel_event)
            payload = download_extra(session, team_id, since, ctx.cancel_event)
            counts["requests"] += 1
            if payload is None:
                # LA FONTE NON HA RISPOSTO: non si scrive niente. Il file che c'e' resta com'e' - un club
                # senza partite in finestra e' un fatto e lo scrive `download_extra`, un 403 non lo e'.
                counts["refused"] = counts.get("refused", 0) + 1
                if counts["refused"] >= REFUSAL_LIMIT:
                    print(f"[positions] {REFUSAL_LIMIT} rifiuti di fila: la fonte ha chiuso, mi fermo "
                          "(quello che c'e' in cache resta intatto)")
                    break
                continue
            counts["refused"] = 0
            if not payload["events"]:
                # Ha risposto «niente in finestra»: si salva, o ogni ri-corsa lo ri-paga.
                _atomic_write_text(cache, json.dumps(payload, ensure_ascii=False))
                continue
            _atomic_write_text(cache, json.dumps(payload, ensure_ascii=False))
            counts["clubs"] += 1
            counts["matches"] += len(payload["events"])
            print(f"[positions] {name}: {len(payload['events'])} extra matches "
                  f"({len(payload['lineups'])} with lineups)")
    except KeyboardInterrupt:
        print("[positions] interrupted - already-downloaded clubs are cached")
    finally:
        session.close()
    # Un file «extra» porta ora eventi di PIÙ stagioni (ognuno con la sua), quindi la ricostruzione non
    # può essere ristretta alla stagione del nome del file: quella è solo la chiave della cache.
    reingest_match_layer(ctx)
    # The line-ups say who was there; only the incidents say who scored.
    fetch_extra_incidents(ctx, refresh=refresh)
    return counts


def fetch_extra_incidents(ctx: Context, seasons=None, refresh: bool = False) -> dict[str, int]:
    """WHO scored in a friendly, which the line-up payload cannot say.

    A non-league match arrives with the eleven and no per-player statistics at all - measured on
    2026-27: 1,188 rows of 4,332 carry even a minute - so its goals exist only as a scoreline and
    92 of 919 had a name on them. The incidents endpoint names the scorer with the provider's own
    player id, so `player_xref` maps him without ever touching a NAME.

    Only the matches that need it are fetched: a 0-0 costs nothing, and neither does one whose
    goals are already attributed. The cache never expires here and that is correct - a finished
    match does not get new goals - unlike the club listing, whose cache froze the whole layer.

    Assists are written ONLY where the provider recorded one (11 of 40 goals over a sample of 12
    pre-season matches). A missing assist is not a zero and nothing here invents it.
    """
    conn = ctx.require_conn()
    seasons = list(seasons or [])
    params: list = [EXTRA_SOURCE]
    where = "source = ?"
    if seasons:
        where += f" AND season IN ({','.join('?' * len(seasons))})"
        params += seasons
    # (match, club) pairs whose declared goals are not all attributed to a player yet
    todo = conn.execute(
        f"""
        SELECT match_id, season, SUM(declared) AS declared, SUM(attributed) AS attributed
        FROM (SELECT match_id, season, club,
                     MAX(COALESCE(team_goals, 0)) AS declared,
                     SUM(COALESCE(goals, 0))      AS attributed
              FROM external_match_stats WHERE {where}
              GROUP BY match_id, season, club)
        GROUP BY match_id, season
        HAVING declared > attributed
        ORDER BY match_id
        """, params).fetchall()
    counts = {"matches": 0, "goals": 0, "assists": 0, "unmatched": 0, "requests": 0}
    if not todo:
        print("[positions] incidents: nothing to attribute")
        return counts

    xref = {source_id: fc_id for source_id, fc_id in conn.execute(
        "SELECT source_id, fc_id FROM player_xref WHERE source = 'sofascore'")}
    print(f"[positions] incidents: {len(todo)} matches with goals nobody is credited for")
    session = _client()
    try:
        for match_id, season, _declared, _attributed in todo:
            if ctx.cancelled():
                raise KeyboardInterrupt
            cache = ctx.config.cache_dir / f"sofascore_incidents_{match_id}.json"
            if cache.exists() and not refresh:
                payload = json.loads(cache.read_text(encoding="utf-8"))
            else:
                _polite_sleep(ctx.cancel_event)
                payload = _get_json(session, INCIDENTS_ENDPOINT.format(eid=match_id)) or {}
                counts["requests"] += 1
                _atomic_write_text(cache, json.dumps(payload, ensure_ascii=False))
            goals: dict[int, int] = {}
            assists: dict[int, int] = {}
            for incident in payload.get("incidents", []):
                if incident.get("incidentType") != "goal":
                    continue
                # An own goal is not a goal for the man who put it in: this table has no column
                # for one, so it is left out rather than credited to him.
                if incident.get("incidentClass") == "ownGoal":
                    continue
                scorer = xref.get(str((incident.get("player") or {}).get("id") or ""))
                if scorer is None:
                    counts["unmatched"] += 1
                else:
                    goals[scorer] = goals.get(scorer, 0) + 1
                helper = xref.get(str((incident.get("assist1") or {}).get("id") or ""))
                if helper is not None:
                    assists[helper] = assists.get(helper, 0) + 1
            for fc_id, n in goals.items():
                counts["goals"] += conn.execute(
                    "UPDATE external_match_stats SET goals = ? "
                    "WHERE fc_id = ? AND season = ? AND source = ? AND match_id = ?",
                    (n, fc_id, season, EXTRA_SOURCE, match_id)).rowcount
            for fc_id, n in assists.items():
                counts["assists"] += conn.execute(
                    "UPDATE external_match_stats SET assists = ? "
                    "WHERE fc_id = ? AND season = ? AND source = ? AND match_id = ?",
                    (n, fc_id, season, EXTRA_SOURCE, match_id)).rowcount
            counts["matches"] += 1
        conn.commit()
    except KeyboardInterrupt:
        conn.commit()
        print("[positions] interrupted - what was already read is committed")
    finally:
        session.close()
    print(f"[positions] incidents: {counts['matches']} matches, {counts['goals']} goals and "
          f"{counts['assists']} assists credited, {counts['unmatched']} scorers outside our pool")
    return counts


def fetch_club_crests(ctx: Context, refresh: bool = False) -> dict[str, int]:
    """The clubs' badges, one request per club, cached as the bytes the provider sent.

    Why the toolkit and not the app: the app reads the bundle and never the web, and a public
    page that hot-links a provider's images depends on that provider staying friendly. Downloaded
    once here, they travel with the export like any other fact.

    No conversion and no resizing - the bytes are the source of truth, as everywhere else in this
    cache - so the type varies (png and webp both come back) and `index.json` records the file
    name per club. An unknown extension served as octet-stream is the kind of thing that works in
    one browser and not in the next.
    """
    conn = ctx.require_conn()
    targets = role_targets(conn, None)
    out = ctx.config.cache_dir / "crests"
    out.mkdir(parents=True, exist_ok=True)
    by_club = conn.execute(
        "SELECT c.canonical_name, c.fc_club_id FROM clubs c WHERE c.canonical_name IS NOT NULL")
    ids = {name: club_id for name, club_id in by_club}
    counts = {"clubs": 0, "downloaded": 0, "bytes": 0, "missing_id": 0}
    index: dict[str, str] = {}
    existing = json.loads((out / "index.json").read_text(encoding="utf-8")) if (
        out / "index.json").exists() else {}
    index.update(existing)

    session = _client()
    try:
        for name, team_id in targets:
            club_id = ids.get(name)
            if club_id is None:
                counts["missing_id"] += 1
                continue
            counts["clubs"] += 1
            already = index.get(str(club_id))
            if already and (out / already).exists() and not refresh:
                continue
            if ctx.cancelled():
                raise KeyboardInterrupt
            _polite_sleep(ctx.cancel_event)
            response = session.get(CREST_ENDPOINT.format(tid=team_id), timeout=30)
            if response.status_code != 200 or not response.content:
                print(f"[positions] crest {name}: HTTP {response.status_code}")
                continue
            kind = (response.headers.get("content-type") or "").split("/")[-1].split(";")[0]
            suffix = {"png": "png", "webp": "webp", "jpeg": "jpg", "svg+xml": "svg"}.get(kind)
            if suffix is None:
                print(f"[positions] crest {name}: unexpected type {kind!r}, skipped")
                continue
            file_name = f"{club_id}.{suffix}"
            (out / file_name).write_bytes(response.content)
            index[str(club_id)] = file_name
            counts["downloaded"] += 1
            counts["bytes"] += len(response.content)
    except KeyboardInterrupt:
        print("[positions] interrupted - the crests already downloaded are cached")
    finally:
        session.close()
        _atomic_write_text(out / "index.json", json.dumps(index, ensure_ascii=False, indent=1))
    print(f"[positions] crests: {counts['downloaded']} downloaded, {len(index)} in cache, "
          f"{counts['bytes'] / 1024:.0f} KB")
    return counts


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
                        session, ROUND_ENDPOINT.format(tid=tournament_id(league), sid=season_id,
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


def normalize_competitions(conn) -> int:
    """Rewrite a stored competition that is a provider SLUG for a league we have a key for.

    The cache is replayed offline and files written before `_slug_of` learned our keys are still on
    disk, but rows written from them are already in the tables - and a rename at read time would be a
    second definition. One spelling, in the data.
    """
    moved = 0
    for slug, ours in _OUR_SLUG.items():
        for table in ("external_match_stats", "club_match_lineups"):
            moved += conn.execute(f"UPDATE OR REPLACE {table} SET competition = ? "
                                  f"WHERE competition = ?", (ours, slug)).rowcount
    if moved:
        conn.commit()
    return moved


def drop_superseded_extra_rows(conn) -> int:
    """Remove league-source rows of a competition NO round walk covers, where the extra layer has them.

    The extra layer used to write under the league source and now has its own (`sofascore_extra`), so
    the same match sits twice: measured 08/08/2026, 4302 rows - Serie B 1707, the Champions League 916,
    the domestic cups - and EVERY ONE of them has its twin. They were harmless while nothing counted
    those competitions and stopped being harmless the moment Serie B became a denominator.

    The criterion cannot delete anything unique, which is the whole point of stating it: a row goes
    only if its competition is outside the round walk (so no league run produces it) AND the same
    (player, season, match) exists under the extra source. `sofascore_recent` is left alone - that is
    `recent_form`'s own layer and it means something else.
    """
    walked = ",".join("?" * len(TOURNAMENTS))
    dropped = conn.execute(
        f"""DELETE FROM external_match_stats
            WHERE source = ? AND competition NOT IN ({walked})
              AND EXISTS (SELECT 1 FROM external_match_stats twin
                          WHERE twin.fc_id = external_match_stats.fc_id
                            AND twin.season = external_match_stats.season
                            AND twin.match_id = external_match_stats.match_id
                            AND twin.source = ?)""",
        (LEAGUE_SOURCE, *TOURNAMENTS, EXTRA_SOURCE)).rowcount
    if dropped:
        conn.commit()
    return dropped


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
            rows, club_rows, missing = parse_round(
                payload, season, xref, keep_unplayed=path.name.startswith("sofascore_round_extra"))
        except Exception as exc:   # noqa: BLE001 - a corrupt cache file must not abort the rebuild
            print(f"[positions] skipping unreadable round cache {path.name}: {exc}")
            continue
        key = (league, season)
        # An extra file holds one CLUB's friendlies and cup ties, in several competitions and possibly
        # two seasons, so the league file's "delete this competition-season first" does not apply to it -
        # and does not need to: the primary key is (fc_id, season, source, match_id), so re-reading the
        # same cache twice replaces rather than duplicates.
        extra = league.startswith("extra")
        source = EXTRA_SOURCE if extra else LEAGUE_SOURCE
        if key not in touched and not extra:
            conn.execute("DELETE FROM external_match_stats WHERE source = 'sofascore' "
                         "AND competition = ? AND season = ?", (league, season))
            conn.execute("DELETE FROM club_match_lineups WHERE source = 'sofascore' "
                         "AND competition = ? AND season = ?", (league, season))
        touched.setdefault(key, 0)
        touched[key] += _store_match_rows(conn, rows, source)
        _store_club_rows(conn, club_rows, source)
        unknown += missing
    conn.commit()
    renamed = normalize_competitions(conn)
    superseded = drop_superseded_extra_rows(conn)
    if touched:
        for (league, season), n in sorted(touched.items()):
            print(f"[positions] {league} {season}: {n} external_match_stats rows")
        print(f"[positions] per-match layer: {sum(touched.values())} rows from {len(files)} cached "
              f"rounds ({unknown} lineup entries without a resolved identity)")
    if renamed:
        print(f"[positions] {renamed} row(s) moved onto our own competition key (a provider slug is "
              f"a spelling, not an identity)")
    if superseded:
        print(f"[positions] {superseded} duplicate row(s) dropped: the extra layer wrote them under "
              f"the league source before it had its own, and every one has its twin")


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
                pid=provider_id, tid=tournament_id(league), sid=season_id))
            if payload is None:
                continue
            _atomic_write_text(
                ctx.config.cache_dir / f"sofascore_heatmap_{league}_{season}_{provider_id}.json",
                json.dumps(payload, ensure_ascii=False))
            done += 1
            if done % 50 == 0 or done == len(todo):
                print(f"[positions] heatmap {done}/{len(todo)} player-seasons")
                ctx.progress("positions", done, len(todo), "heatmaps")
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


# ---------- the granular REAL ROLE (twelve codes) ----------
# The provider's whole position vocabulary. Twelve codes, verified by enumeration and not from memory:
# 128 players sampled across the four lines returned nothing else, and every one of them had at least
# one code. There is no second-striker code - a seconda punta comes back as AM or ST.
REAL_ROLES: tuple[str, ...] = ("GK",
                               "DL", "DC", "DR",
                               "DM",
                               "ML", "MC", "MR",
                               "AM",
                               "LW", "RW",
                               "ST")
# Which of the four lines each code belongs to, in the PROVIDER's vocabulary - where a winger is a
# midfielder. It is the same convention `external_match_stats.position` already uses, so the granular
# code and the modal per-match slot can be compared instead of quietly meaning different things.
REAL_ROLE_LINE: dict[str, str] = {
    "GK": "G",
    "DL": "D", "DC": "D", "DR": "D",
    "DM": "M", "ML": "M", "MC": "M", "MR": "M", "AM": "M", "LW": "M", "RW": "M",
    "ST": "F",
}
# Which flank a code names: -1 the team's left, +1 its right, 0 the middle. A code that names no side
# does not exist in this vocabulary - every one of the twelve is either central or on a stated flank,
# which is exactly what the listone's 'e' (esterno) and 'w' (winger) leave open.
REAL_ROLE_SIDE: dict[str, float] = {
    "DL": -1.0, "ML": -1.0, "LW": -1.0,
    "DR": 1.0, "MR": 1.0, "RW": 1.0,
    "GK": 0.0, "DC": 0.0, "DM": 0.0, "MC": 0.0, "AM": 0.0, "ST": 0.0,
}
# How far up the pitch a code stands: 0.0 = the player's OWN goal, 1.0 = the opponent's. The SAME axis
# `positions.avg_x` is measured on, so a drawn position and a measured one are comparable.
#
# With SIDE this makes the twelve codes a grid, which is the whole reason they are worth having:
#
#                        ST                      1.00
#              LW        AM        RW            0.80
#              ML        MC        MR            0.60
#                        DM                      0.45
#         DL         DC      DC         DR       0.25
#                        GK                      0.00
#
# The two lines the listone's four roles cannot separate are the ones that decide a formation: DM
# behind MC behind AM is a 4-3-3 or a 4-2-3-1, and all three are 'C'. The numbers are DRAWING
# positions - a layout choice for the pitch view, not a fitted quantity, and nothing predictive reads
# them. `avg_x`/`avg_y` from the heatmap is the measured version and beats them wherever it is filled.
REAL_ROLE_DEPTH: dict[str, float] = {
    "GK": 0.0,
    "DL": 0.25, "DC": 0.25, "DR": 0.25,
    "DM": 0.45,
    "ML": 0.60, "MC": 0.60, "MR": 0.60,
    "AM": 0.80, "LW": 0.80, "RW": 0.80,
    "ST": 1.0,
}
# The game's own vocabulary for each code. Italian on purpose and by the same precedent the pitch
# badges already set: these are the words an auction is prepared in, and "terzino sinistro" is not a
# translation of DL, it is what DL is. Everything else in the repo stays English.
REAL_ROLE_LABEL: dict[str, str] = {
    "GK": "portiere",
    "DL": "terzino sinistro",
    "DC": "difensore centrale",
    "DR": "terzino destro",
    "DM": "mediano davanti alla difesa",
    "ML": "esterno di centrocampo sinistro",
    "MC": "centrocampista centrale",
    "MR": "esterno di centrocampo destro",
    "AM": "trequartista",
    "LW": "ala sinistra",
    "RW": "ala destra",
    "ST": "punta centrale",
}


# ---------- the twelve codes -> the Mantra vocabulary ----------
# The Mantra roles as the listone spells them, verified against `rosters.roles` (2025-26: por 164,
# dc 272, dd 146, ds 150, b 28, e 224, m 171, c 294, t 172, w 173, a 187, pc 144).
MANTRA_ROLES: tuple[str, ...] = ("por", "dc", "dd", "ds", "b", "e", "m", "c", "t", "w", "a", "pc")
# The user's own mapping. Mantra SIMPLIFIES: it does not care which flank a midfielder or a winger is
# on ('e' and 'w' are sideless), so ML and MR collapse to one role and LW and RW to another. Going the
# other way is therefore lossy on purpose - the granular code stays the thing that places a man, and
# this only says what he would be called at a Mantra auction.
REAL_TO_MANTRA: dict[str, str] = {
    "GK": "por",
    "DL": "ds", "DC": "dc", "DR": "dd",
    "DM": "m",
    "ML": "e", "MR": "e",          # esterno: Mantra does not name the flank
    "MC": "c",
    "LW": "w", "RW": "w",          # ala: same
    "ST": "pc",
    # AM is the one code that is not a single Mantra role - see `mantra_roles`.
}
# Two roles that no SINGLE code can produce, and both are read off the code LIST instead:
# * 'b' (braccetto) = a full back who can also play central in a back three. That is a COMBINATION -
#   a flank defensive code together with DC - which is exactly why having up to three codes per
#   player is worth more than having one. Measured: 139 players carry it, where the 2025-26 listone
#   assigns 'b' to 28. The listone is the more parsimonious of the two, and this is a capability
#   ("può giocare centrale"), so the two numbers are not expected to agree; noted rather than tuned.
# * 't' vs 'a' for AM = whether he is more midfielder or more forward. The provider's own broad line
#   answers it and is already stored: of the AM players, 63 are line 'M' (-> t) and 19 line 'F' (-> a).
_FLANK_DEFENDER: frozenset[str] = frozenset({"DL", "DR"})


def mantra_roles(roles: str | None, line: str | None = None) -> str:
    """The twelve provider codes -> the Mantra roles, in the provider's own order. 'DL;DC' -> 'ds;dc;b'.

    DESCRIPTIVE and NOT gated, and it is NOT `rosters.roles`: that is what the listone sells him as and
    stays the source of truth wherever it exists. This is what he would be called at a Mantra auction
    whose listone does not exist yet - which is the normal case for the season being auctioned in July,
    where 1343 of 1343 players in the sheet have no listone row at all.
    """
    codes = [code.strip() for code in (roles or "").upper().split(";")
             if code.strip() in REAL_ROLES]
    out: list[str] = []
    for code in codes:
        if code == "AM":
            # more forward than midfielder -> 'a', else the trequartista 't'
            mapped = "a" if (line or "").upper() == "F" else "t"
        else:
            mapped = REAL_TO_MANTRA.get(code)
        if mapped and mapped not in out:
            out.append(mapped)
    if any(code in _FLANK_DEFENDER for code in codes) and "DC" in codes and "b" not in out:
        out.append("b")
    return ";".join(out)


def backfill_club_ids(ctx: Context) -> int:
    """external_stats.club_id from the cached season aggregates. Offline, zero requests.

    The column was added after the rows were written, and every value it needs is in the cache the
    rows came from - the same shape as the `goalsConceded` recovery of gate §7-decies. Joined through
    `player_xref`, because the payload speaks the provider's player id and this table speaks `fc_id`.
    """
    conn = ctx.require_conn()
    known = {str(source_id): fc_id for fc_id, source_id in conn.execute(
        "SELECT fc_id, source_id FROM player_xref WHERE source = 'sofascore'")}
    updates: list[tuple[str, int, str, str]] = []
    for path in sorted(ctx.config.cache_dir.glob("sofascore_stats_*.json")):
        found = _CACHE_NAME.search(path.name)
        if not found:
            continue
        league, season = found.group(1), found.group(2)
        try:
            rows = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:   # noqa: BLE001 - a corrupt cache file must not abort the rebuild
            print(f"[positions] skipping unreadable cache {path.name}: {exc}")
            continue
        for row in rows if isinstance(rows, list) else ():
            team_id = (row.get("team") or {}).get("id")
            fc_id = known.get(str((row.get("player") or {}).get("id") or ""))
            if team_id and fc_id:
                updates.append((str(team_id), fc_id, season, league))
    conn.executemany(
        """UPDATE external_stats SET club_id = ?
           WHERE fc_id = ? AND season = ? AND competition = ? AND source = 'sofascore'""", updates)
    conn.commit()
    filled = conn.execute(
        "SELECT COUNT(*) FROM external_stats WHERE club_id IS NOT NULL").fetchone()[0]
    total = conn.execute("SELECT COUNT(*) FROM external_stats").fetchone()[0]
    print(f"[positions] club_id backfilled: {filled:,} of {total:,} external_stats rows "
          f"({filled / total:.1%}) from {len(updates):,} cached claims")
    return filled


def derive_club_xref(ctx: Context) -> int:
    """club_xref(source='sofascore') from the cached season aggregates. Offline.

    The squad endpoint is keyed by the provider's TEAM id, and no source of ours carried one. The
    cached `sofascore_stats_{league}_{season}.json` already do: every player row ships its team's id
    and name, so the mapping is a group-by over files we have, not a scrape.
    """
    conn = ctx.require_conn()
    by_key: dict[str, str] = {}
    for path in sorted(ctx.config.cache_dir.glob("sofascore_stats_*.json")):
        if not _CACHE_NAME.search(path.name):
            continue
        try:
            rows = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:   # noqa: BLE001 - a corrupt cache file must not abort the rebuild
            print(f"[positions] skipping unreadable cache {path.name}: {exc}")
            continue
        for row in rows:
            team = row.get("team") or {}
            name, team_id = (team.get("name") or "").strip(), team.get("id")
            if name and team_id:
                # Newest file wins on a tie: a club that changed name keeps the id its latest
                # season used, which is the one the squad endpoint answers for today.
                by_key[club_key(name)] = str(team_id)
    if not by_key:
        return 0
    # `clubs` holds a few duplicate rows for the same real club ('Eintracht' and 'Eintracht
    # Francoforte'), and the xref PK is (source, source_id): both would claim the same team id and the
    # last one silently wins, leaving its twin with no squad page. Resolved openly instead - the row
    # with the most roster players is the live one - and the losers are named in the log, so a club
    # whose squad stops being fetched is a line you can read and not a gap you have to find.
    claims: dict[str, list[tuple[int, int, str]]] = {}
    for club_id, name in conn.execute(
            "SELECT fc_club_id, canonical_name FROM clubs WHERE canonical_name IS NOT NULL"):
        team_id = (by_key.get(club_key(CLUB_ALIASES.get(name, name)))
                   or by_key.get(club_key(name)))
        if not team_id:
            continue
        roster = conn.execute("SELECT COUNT(*) FROM rosters WHERE fc_club_id = ?",
                              (club_id,)).fetchone()[0]
        claims.setdefault(team_id, []).append((roster, club_id, name))
    duplicates: list[str] = []
    for team_id, group in claims.items():
        group.sort(reverse=True)
        conn.execute("INSERT OR REPLACE INTO club_xref(fc_club_id, source, source_id) "
                     "VALUES (?, 'sofascore', ?)", (group[0][1], team_id))
        duplicates += [f"{name} -> {group[0][2]}" for _n, _id, name in group[1:]]
    conn.commit()
    print(f"[positions] provider team ids: {len(claims)} clubs in club_xref")
    if duplicates:
        print(f"[positions] duplicate club rows folded onto one provider team: "
              f"{', '.join(sorted(duplicates))}")
    return len(claims)


def role_targets(conn, clubs=None) -> list[tuple[str, str]]:
    """(canonical club, provider team id) for the clubs whose squad is worth reading.

    `clubs` narrows it to the ones a caller actually needs - the snapshot passes the clubs of its own
    sheet, so an auction in one platform does not pay for the other four leagues' reserves.
    """
    rows = conn.execute(
        "SELECT c.canonical_name, x.source_id FROM club_xref x JOIN clubs c USING(fc_club_id) "
        "WHERE x.source = 'sofascore' AND c.canonical_name IS NOT NULL "
        "ORDER BY c.canonical_name").fetchall()
    if clubs is None:
        return [(name, source_id) for name, source_id in rows]
    wanted = {club_key(CLUB_ALIASES.get(name, name)) for name in clubs} | {
        club_key(name) for name in clubs}
    return [(name, source_id) for name, source_id in rows
            if club_key(name) in wanted or club_key(CLUB_ALIASES.get(name, name)) in wanted]


def _role_entry(player: dict) -> dict | None:
    """One provider player object -> the fields `player_roles` stores. None when it says nothing.

    Only codes from the enumerated vocabulary are kept: an unknown one would silently become a role
    nothing downstream can place, and the count of them is printed so a new code is noticed rather
    than absorbed.
    """
    provider_id = str(player.get("id") or "")
    codes = [code for code in (player.get("positionsDetailed") or []) if code in REAL_ROLES]
    if not provider_id or not codes:
        return None
    return {"provider_id": provider_id, "roles": ";".join(codes), "primary_role": codes[0],
            # The provider's broad slot when it gives one, else the primary code's own line: the two
            # agree by construction on every sample, and this way a payload missing `position` still
            # lands in a line instead of a NULL.
            "line": player.get("position") or REAL_ROLE_LINE.get(codes[0]),
            "foot": player.get("preferredFoot"),
            # The BODY comes in the same payload, so it costs nothing: it is what tells a punta centrale
            # who plays as a torre from one who plays on the move, which the twelve codes cannot say (both
            # are `ST`). Descriptive - see `_role_entry`'s caller and the schema comment.
            "height": player.get("height"),
            "weight": player.get("weight")}


def unknown_role_codes(payloads) -> dict[str, int]:
    """Codes the provider returned that are NOT in the enumerated vocabulary, with their counts."""
    seen: dict[str, int] = {}
    for player in payloads:
        for code in (player.get("positionsDetailed") or []):
            if code not in REAL_ROLES:
                seen[code] = seen.get(code, 0) + 1
    return seen


def _squad_players(payload) -> list[dict]:
    """The provider objects of a cached squad page, whatever shape the file has."""
    if isinstance(payload, dict) and "players" in payload:
        return [entry.get("player") or {} for entry in payload.get("players") or []]
    if isinstance(payload, dict) and "player" in payload:
        return [payload.get("player") or {}]        # a single-player cache file
    return []


def fetch_roles(ctx: Context, clubs=None, date: str | None = None, refresh: bool = False,
                top_up: int | None = 150, on_club=None) -> dict[str, int]:
    """The granular real role of every player, into the cache. Dated, resumable, interruptible.

    Two passes, cheapest first:
      * one request per CLUB (`/team/{id}/players`), which answers for its whole current squad;
      * then one request per PLAYER still missing, for whoever no squad page covered - a man whose
        club we have no provider id for, or who the page does not list. Ordered by pre-auction price
        (Qt.I) so an interrupted top-up has done the players that matter, and bounded by `top_up`.

    The cache file names carry the OBSERVATION DATE, so rerunning on the same day costs nothing and
    a run next month is a new snapshot rather than an overwrite of this one.

    `on_club(done, total)` is called after each club, and `total` is the list this run really has to
    FETCH - not the perimeter: on a second run of the same day the cache answers everything and the
    honest report is that there was nothing to do, not 34 instant clubs.
    """
    conn = ctx.require_conn()
    date = date or time.strftime("%Y-%m-%d", time.gmtime())
    targets = role_targets(conn, clubs)
    counts = {"clubs": 0, "requests": 0, "players": 0}
    if not targets:
        print("[positions] no provider team id for any club - run `positions --layer roles` after the "
              "season aggregates are cached (it derives them), or check clubs.canonical_name")
        return counts
    todo = [(name, team_id) for name, team_id in targets
            if refresh or not (ctx.config.cache_dir /
                               f"sofascore_squad_{team_id}_{date}.json").exists()]
    print(f"[positions] real role: {len(targets)} clubs · {len(todo)} to fetch "
          f"(~{len(todo) * (REQUEST_DELAY + REQUEST_JITTER / 2) / 60:.0f} min)")
    if on_club:
        # Said BEFORE the first request, and said even when there is nothing to fetch: a caller showing
        # progress has to be able to tell "34 clubs to go" from "the cache already has today's".
        on_club(0, len(todo))
    session = _client()
    try:
        for index, (name, team_id) in enumerate(todo, start=1):
            if ctx.cancelled():
                raise KeyboardInterrupt
            if on_club:
                on_club(index - 1, len(todo))
            _polite_sleep(ctx.cancel_event)
            payload = _get_json(session, SQUAD_ENDPOINT.format(tid=team_id))
            counts["requests"] += 1
            if not payload:
                print(f"[positions] {name}: squad page unavailable (team id {team_id})")
                continue
            _atomic_write_text(
                ctx.config.cache_dir / f"sofascore_squad_{team_id}_{date}.json",
                json.dumps(payload, ensure_ascii=False))
            counts["clubs"] += 1
            counts["players"] += len(payload.get("players") or [])
    except KeyboardInterrupt:
        print("[positions] interrupted - every fetched squad is cached, rerun to continue")
    finally:
        session.close()
    ingest_roles_from_cache(ctx)
    if top_up:
        counts.update(_top_up_roles(ctx, date, top_up, [name for name, _id in targets]))
        ingest_roles_from_cache(ctx)
    # The same payloads carry the player's COUNTRY, and a mid-season continental cup is priced off it
    # (`engine/cups.py`). Written here rather than in a module of its own so one fetch answers both
    # questions - and so a run that refreshes the squads cannot leave the two facts on different days.
    ingest_nationality_from_cache(ctx)
    return counts


def _top_up_roles(ctx: Context, date: str, limit: int, clubs) -> dict[str, int]:
    """One request per player for whoever the squad pages left without a role on `date`.

    Bounded to the SAME clubs the club pass covered. Without that bound it walked every club in
    `squad_snapshot` - 77 of them against the 38 a euro auction can buy from - and spent one request
    per player on squads whose cheaper club page had never been asked for, for rows the sheet then
    filtered out anyway.
    """
    conn = ctx.require_conn()
    placeholders = ",".join("?" * len(clubs)) or "NULL"
    missing = conn.execute(
        f"""
        -- `rosters` and not `listone_quotes` ON PURPOSE: this is a request ORDER, not a valuation. Both
        -- listoni rank importance the same way, so which one wrote the number cannot change who is asked
        -- about first - and a platform filter here would drop the players quoted only on the other one.
        SELECT x.source_id, MAX(COALESCE(r.price_initial, r.price, 0)) AS worth
        FROM player_xref x
        JOIN squad_snapshot s ON s.fc_id = x.fc_id
        LEFT JOIN rosters r ON r.fc_id = x.fc_id
        WHERE x.source = 'sofascore' AND s.club IN ({placeholders})
          AND NOT EXISTS (SELECT 1 FROM player_roles p
                          WHERE p.fc_id = x.fc_id AND p.valid_from = ? AND p.source = 'sofascore')
        GROUP BY x.source_id ORDER BY worth DESC
        """, (*clubs, date)).fetchall()
    todo = [provider_id for provider_id, _worth in missing
            if not (ctx.config.cache_dir /
                    f"sofascore_player_{provider_id}_{date}.json").exists()][:limit]
    if not todo:
        return {"top_up": 0}
    dropped = max(0, len(missing) - limit)
    print(f"[positions] real role top-up: {len(todo)} players the squad pages did not cover"
          + (f" ({dropped} more left out by the {limit} bound - raise it to go further)"
             if dropped else ""))
    session = _client()
    done = 0
    try:
        for provider_id in todo:
            if ctx.cancelled():
                raise KeyboardInterrupt
            _polite_sleep(ctx.cancel_event)
            payload = _get_json(session, PLAYER_ENDPOINT.format(pid=provider_id))
            if not payload:
                continue
            _atomic_write_text(
                ctx.config.cache_dir / f"sofascore_player_{provider_id}_{date}.json",
                json.dumps(payload, ensure_ascii=False))
            done += 1
    except KeyboardInterrupt:
        print("[positions] interrupted - every fetched player is cached, rerun to continue")
    finally:
        session.close()
    return {"top_up": done}


def ingest_roles_from_cache(ctx: Context, date: str | None = None) -> int:
    """player_roles from the cached squad and player pages (offline).

    Identity through `player_xref` only, like the per-match layer: a provider row nobody resolved is
    counted and skipped, never guessed by name - the surname fallbacks are what collapsed ten
    different 'Sanchez' into one player, and a wrong role is worse than a missing one on a sheet whose
    whole job is to say where a man plays.
    """
    conn = ctx.require_conn()
    xref = {source_id: fc_id for source_id, fc_id in conn.execute(
        "SELECT source_id, fc_id FROM player_xref WHERE source = 'sofascore'")}
    files = [(path, _SQUAD_CACHE_NAME.search(path.name) or _PLAYER_CACHE_NAME.search(path.name))
             for path in sorted(ctx.config.cache_dir.glob("sofascore_squad_*.json"))
             + sorted(ctx.config.cache_dir.glob("sofascore_player_*.json"))]
    rows: dict[tuple[int, str], tuple] = {}
    unresolved: set[str] = set()
    unknown: dict[str, int] = {}
    for path, key in files:
        if not key:
            continue
        observed = key.group(2)
        if date and observed != date:
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:   # noqa: BLE001 - a corrupt cache file must not abort the rebuild
            print(f"[positions] skipping unreadable squad cache {path.name}: {exc}")
            continue
        players = _squad_players(payload)
        for code, n in unknown_role_codes(players).items():
            unknown[code] = unknown.get(code, 0) + n
        for player in players:
            entry = _role_entry(player)
            if entry is None:
                continue
            fc_id = xref.get(entry["provider_id"])
            if fc_id is None:
                unresolved.add(entry["provider_id"])
                continue
            # A player listed by two clubs on the same day (a transfer the pages disagree on) would
            # otherwise write twice; the role is a fact about the man, so either row will do.
            rows[(fc_id, observed)] = (fc_id, observed, entry["roles"], entry["primary_role"],
                                       entry["line"], entry["foot"], entry["height"], entry["weight"])
    if not rows:
        return 0
    conn.executemany(
        "INSERT OR REPLACE INTO player_roles(fc_id, valid_from, source, roles, primary_role, line, "
        "foot, height, weight) VALUES (?, ?, 'sofascore', ?, ?, ?, ?, ?, ?)", list(rows.values()))
    conn.commit()
    dates = sorted({observed for _fc, observed in rows})
    print(f"[positions] real role: {len(rows)} player-observations over {len(dates)} date(s) "
          f"[{dates[0]} .. {dates[-1]}] · {len(unresolved)} provider ids without a resolved identity")
    if unknown:
        print(f"[positions] NEW provider position codes, not in the enumerated vocabulary: "
              f"{unknown} - add them to REAL_ROLES/REAL_ROLE_LINE/REAL_ROLE_SIDE before trusting "
              f"a sheet that silently dropped them")
    return len(rows)


def ingest_nationality_from_cache(ctx: Context) -> int:
    """players.nationality (+ `capped_on`) from the cached squad and player pages (offline).

    `players.nationality` has been in the schema since the first day and was NULL on all 4674 rows,
    because the two listoni do not carry it - the Excel column labelled 'Nazione' holds the LEAGUE
    (`sources.py` says so). Nobody had noticed that the provider payload the granular roles are already
    read from carries `player.country`: the fact was in the cache, paid for, and unread. So this needs
    no network at all, which is the only reason it can run today - the provider has been answering 403
    `challenge` since 16/08/2026.

    A nationality is an IDENTITY fact, not a season fact, so it is written once over every cached file
    rather than inside a per-season loop - the mistake that left 827 fc_id with their aggregates in the
    table and no provider id. And it is joined through `player_xref` like everything else here: a
    provider row nobody resolved is counted and skipped, never matched by name.

    `capped_on` is the day a payload was seen listing him among the club's `nationalPlayers`, i.e. the
    provider's own «he has played for his country». It is kept because the measurement needs it: a CAF
    regular who is capped loses 0.35 of a cup window against 0.20 for one who is not (`engine/cups.py`).
    It is stored as the OBSERVATION DATE and not as a flag, because that is what it is - the provider
    publishes today's squad, and a man capped for the first time next spring will read NULL until then.
    Never retracted: «he has played for his country» does not stop being true.
    """
    conn = ctx.require_conn()
    xref = {source_id: fc_id for source_id, fc_id in conn.execute(
        "SELECT source_id, fc_id FROM player_xref WHERE source = 'sofascore'")}
    country: dict[int, str] = {}
    capped: dict[int, str] = {}
    unresolved: set[str] = set()
    files = [(path, _SQUAD_CACHE_NAME.search(path.name) or _PLAYER_CACHE_NAME.search(path.name))
             for path in sorted(ctx.config.cache_dir.glob("sofascore_squad_*.json"))
             + sorted(ctx.config.cache_dir.glob("sofascore_player_*.json"))]
    for path, key in files:
        if not key:
            continue
        observed = key.group(2)
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:   # noqa: BLE001 - a corrupt cache file must not abort the rebuild
            print(f"[positions] skipping unreadable cache {path.name}: {exc}")
            continue
        for player in _squad_players(payload):
            provider_id = str(player.get("id") or "")
            name = ((player.get("country") or {}).get("name") or "").strip()
            if not provider_id or not name:
                continue
            fc_id = xref.get(provider_id)
            if fc_id is None:
                unresolved.add(provider_id)
                continue
            country[fc_id] = name
        # `nationalPlayers` is a SUBSET of `players` (checked over 120 cached squads: not one id sits
        # outside it), so this loop adds no player - only the fact that the provider files him as an
        # international. The EARLIEST observation is kept: it is the earliest day we can prove it.
        national = payload.get("nationalPlayers") or [] if isinstance(payload, dict) else []
        for entry in national:
            provider_id = str(((entry.get("player") or {}).get("id")) or "")
            fc_id = xref.get(provider_id)
            if fc_id is None:
                continue
            capped[fc_id] = min(capped.get(fc_id, observed), observed)
    if not country:
        return 0
    conn.executemany("UPDATE players SET nationality = ? WHERE fc_id = ?",
                     [(name, fc_id) for fc_id, name in country.items()])
    # COALESCE keeps a date already on file: a rerun must not move it later than the first sighting.
    conn.executemany("UPDATE players SET capped_on = MIN(COALESCE(capped_on, ?), ?) WHERE fc_id = ?",
                     [(observed, observed, fc_id) for fc_id, observed in capped.items()])
    conn.commit()
    total = conn.execute("SELECT COUNT(*) FROM players").fetchone()[0]
    share = f" ({100 * len(country) / total:.0f}%)" if total else ""
    print(f"[positions] nationality: {len(country)}/{total} players{share} · "
          f"{len(capped)} filed as internationals · "
          f"{len(unresolved)} provider ids without a resolved identity")
    return len(country)


def roles_as_of(conn, date: str, fallback: bool = False) -> dict[int, dict]:
    """The newest real-role observation per player at or before a date.

    Dated series read the way every other volatile state is read here: an auction dated last August
    must not see a role observed today, or the sheet is quietly reading the future.

    `fallback` lets a player with NO observation by that date take his earliest one after it, and it
    exists because of what the provider does: it accepts a `seasonId` and ignores it, so a role can only
    ever be observed on the day it is read and a back-dated sheet would have none at all. A role is also
    the slowest-moving thing in this database - a left back is still a left back a season later - so the
    trade is a POSITION read late against a pitch that cannot place anybody. The caller says which it
    wants, and the sheet reports `desc_real_role_observed`, which is the date it was really read on.
    """
    out: dict[int, dict] = {}
    rows = conn.execute(
        "SELECT fc_id, roles, primary_role, line, foot, valid_from, height, weight FROM player_roles "
        "WHERE source = 'sofascore' AND valid_from <= ? ORDER BY valid_from", (date,)).fetchall()
    if fallback:
        # later observations FIRST, so the loop below overwrites them with anything that predates the
        # date: an in-time reading always wins over a borrowed one
        rows = conn.execute(
            "SELECT fc_id, roles, primary_role, line, foot, valid_from, height, weight FROM player_roles "
            "WHERE source = 'sofascore' AND valid_from > ? ORDER BY valid_from DESC",
            (date,)).fetchall() + rows
    for fc_id, roles, primary, line, foot, observed, height, weight in rows:
        out[fc_id] = {
            "roles": roles, "primary": primary, "line": line, "foot": foot, "observed": observed,
            "height": height, "weight": weight,
            # Where to DRAW him, from the primary code: depth up the pitch and flank, on the same
            # axes `avg_x`/`avg_y` measure. Carried in the sheet so every reader of the CSV places
            # him the same way the pitch view does, instead of each one inventing a mapping.
            "depth": REAL_ROLE_DEPTH.get(primary or ""),
            "side": REAL_ROLE_SIDE.get(primary or ""),
            # What a Mantra auction would call him, derived from the same codes. Descriptive, and it
            # never replaces the listone's own `rosters.roles` - it EXISTS for the case where those do
            # not, which in July is every player in the sheet.
            "mantra": mantra_roles(roles, line),
        }
    return out


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
# stronger: an explicit manual override beats the club pass, which beats the league/season fallbacks -
# and last of all the KNOWN IDENTITY, which is not a name match at all (see `collect_claims`).
_PASS_RANK = {"manual": -1, "club": 0, "league": 1, "season": 2, "known": 3}


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


def next_season(season: str) -> str:
    """'2025-26' -> '2026-27'. The season a promoted club's men are quoted in."""
    start = int(season.split("-")[0]) + 1
    return f"{start}-{(start + 1) % 100:02d}"


def known_identities(conn) -> dict[str, int]:
    """provider id -> fc_id, as `player_xref` already knows it.

    Read ONCE before the run rewrites the table, so the resolution of every season sees the same
    starting state whichever order the seasons are processed in.
    """
    return {source_id: fc_id for fc_id, source_id in conn.execute(
        "SELECT fc_id, source_id FROM player_xref WHERE source = 'sofascore'")}


def _manual_overrides(conn) -> dict[str, int]:
    """manual_overrides rows pinning a provider id to an fc_id (highest precedence, spec §7):
    entity='player_xref', field='sofascore', value=<provider id>."""
    return {str(value): fc_id for value, fc_id in conn.execute(
        "SELECT value, fc_id FROM manual_overrides "
        "WHERE entity = 'player_xref' AND field = 'sofascore' AND fc_id IS NOT NULL")}


def collect_claims(conn, rows: list[dict], league: str, season: str, pools, overrides, known=None):
    """Turn one league-season of provider rows into claims (+ the rows nothing matched).

    `known` = provider id -> fc_id from `player_xref`, i.e. an identity ALREADY established. It is
    the LAST pass, only reached when no name pass matched, and it exists because the three name pools
    are all built from the SEASON'S roster while the listone's perimeter changes every summer: a man
    bought into the perimeter this year is in no pool of the year he actually played, so his input
    season goes to nobody. Measured 08/08/2026: 59 men of the 2026-27 listone had NO 2025-26
    aggregate at all while their provider id was already in `player_xref` - Doekhi (Union Berlin,
    identified in 2023-24) and Geubbels (Paris FC), both of whom the press starts, and both with an
    empty claim on the sheet because starts and minutes were missing rather than zero.

    It is deliberately the weakest evidence and it NEVER decides an identity: `_store_identities`
    skips these claims. An identity says which man a season fact belongs to; a season fact must not
    say who the man is, or a namesake collapse from an old run would re-confirm itself forever.
    """
    by_club, by_league, season_pool = pools
    known = known or {}
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
            if provider_id in known:
                claims.append(Claim(known[provider_id], (_PASS_RANK["known"], 0), league, row,
                                    "known"))
                continue
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


def resolve_season(conn, season: str, rows_by_league: dict[str, list[dict]], known=None):
    """Resolve a WHOLE season at once (every league together), so injectivity can be enforced.

    A FEEDER league is resolved against the NEXT season's rosters, and that is not a shortcut - it is
    what a feeder league IS. Nobody in Serie B is in a listone while he plays there; he is quoted the
    summer his club comes up, so the pool of the season he played in cannot contain him by
    construction. Measured on the 2025-26 Serie B aggregate: 34 unresolved provider rows of the three
    promoted clubs, and their surnames - Bracaglia, Calvani, Corrado, Pessina, Dagasso - are sitting
    in our own 2026-27 rosters. Same pools, same passes, same tier limits: only the year the pool is
    built from moves.
    """
    pools = _club_pools(conn, season)
    feeder_pools = None
    overrides = _manual_overrides(conn)
    if known is None:
        known = known_identities(conn)
    claims: list[Claim] = []
    report: list[dict] = []
    for league, rows in rows_by_league.items():
        if league in FEEDER_TOURNAMENTS:
            if feeder_pools is None:
                feeder_pools = _club_pools(conn, next_season(season))
            league_pools = feeder_pools
        else:
            league_pools = pools
        league_claims, league_report = collect_claims(conn, rows, league, season, league_pools,
                                                      overrides, known)
        claims += league_claims
        report += league_report
    kept, injectivity_report = enforce_injectivity(claims, season)
    return kept, report + injectivity_report


# ---------- persistence ----------
def _int(value):
    return int(value) if isinstance(value, (int, float)) else None


def _store_identities(conn, claims_by_season: dict[str, list[Claim]], rows_by_season: dict,
                      authoritative: bool = True) -> int:
    """provider id -> fc_id in `player_xref`, decided over EVERY season of this run at once.

    Apart from the per-season rows because an identity is NOT a season fact, and writing it inside the
    per-season loop made it one: each season first dropped the xref rows of the provider ids it was about
    to re-resolve, then rewrote only its own surviving claims. So a player whose claim was rejected in his
    most RECENT cached season lost the identity an earlier season had established - 91 of them on the real
    cache, Saka, Guirassy, Ferran Torres, Sorloth, Mbeumo and Cunha among them, with their season
    aggregates still in the table and every dated layer (granular roles, heatmap, per-match rows) blind to
    them, because those layers all join through this table.

    Strongest evidence wins and, on a tie, the most recent season - `enforce_one_identity` has already
    made sure one provider id survives per fc_id, so this only picks WHICH claim of that id speaks.

    `authoritative` says whether this run may DELETE: over the whole cache "not claimed" is a verdict, and
    a stale mapping (a namesake collapse from an older run) has to go. Over a subset of the seasons it is
    not a verdict at all - the seasons that would have identified him were not even read - so a partial
    run only ever replaces what it can decide. That asymmetry is the whole difference between re-resolving
    and forgetting.

    The `known` pass is EXCLUDED here, and that is the point of having it: those claims were made BY this
    table, so counting them as evidence would make every mapping re-confirm itself and no stale identity
    could ever be dropped - the `authoritative` delete above would be undone by the claims it produced.
    An identity says which man a season fact belongs to; a season fact does not say who the man is.
    """
    if authoritative:
        # ...and only over the mappings THIS module established. Three modules write identities on
        # three different kinds of evidence, and this delete had no way of telling them apart: it was
        # dropping ids `recent_form` had paid provider searches for, about men who play in a
        # league-season no listone of ours quoted, so no name pool here could ever re-establish them
        # (20 identities on the real cache, 19 of them quoted in 2026-27). `resolved_by` says who owns
        # a row; 'unknown' is what a row written before the column is, and nobody retracts those.
        conn.executemany(
            "DELETE FROM player_xref WHERE source = 'sofascore' AND source_id = ? "
            "AND resolved_by = 'positions'",
            [(str((row.get("player") or {}).get("id") or ""),)
             for rows_by_league in rows_by_season.values()
             for rows in rows_by_league.values() for row in rows],
        )
    best: dict[str, tuple] = {}
    for season, claims in sorted(claims_by_season.items()):     # ascending: a tie goes to the newest
        for claim in claims:
            if not claim.provider_id or claim.pass_name == "known":
                continue
            current = best.get(claim.provider_id)
            if current is None or claim.evidence <= current[0]:
                best[claim.provider_id] = (claim.evidence, season, claim.fc_id)
    conn.executemany(
        "INSERT OR REPLACE INTO player_xref(fc_id, source, source_id, resolved_by) "
        "VALUES (?, 'sofascore', ?, 'positions')",
        [(fc_id, provider_id) for provider_id, (_e, _s, fc_id) in best.items()],
    )
    return {provider_id: fc_id for provider_id, (_e, _s, fc_id) in best.items()}


def drop_orphan_known_claims(claims_by_season: dict[str, list[Claim]],
                             surviving: dict[str, int]) -> tuple[dict[str, list[Claim]], int]:
    """Remove `known`-pass claims whose identity this run did NOT re-establish.

    Only an authoritative run can say this: it has just deleted and rewritten the whole mapping, so a
    provider id missing from `surviving` is one no name pass confirmed anywhere. Keeping its claims
    would write season facts under an identity that no longer exists - and the NEXT run, reading the
    emptied table, would drop them again: two runs, two different databases, from one cache.
    """
    dropped = 0
    out: dict[str, list[Claim]] = {}
    for season, claims in claims_by_season.items():
        keep = [claim for claim in claims
                if claim.pass_name != "known" or claim.provider_id in surviving]
        dropped += len(claims) - len(keep)
        out[season] = keep
    return out, dropped


def _store_claims(conn, season: str, claims: list[Claim]) -> int:
    for claim in claims:
        row = claim.row
        conn.execute(
            """
            INSERT OR REPLACE INTO external_stats(
                fc_id, season, source, competition, matches, starts, minutes, goals, assists,
                pen_scored, pen_taken, xg, xa, rating, yellows, reds, goals_conceded, saves,
                club_id)
            VALUES (?, ?, 'sofascore', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                claim.fc_id, season, claim.league, _int(row.get("appearances")),
                _int(row.get("matchesStarted")), _int(row.get("minutesPlayed")),
                _int(row.get("goals")), _int(row.get("assists")), _int(row.get("penaltyGoals")),
                _int(row.get("penaltiesTaken")), row.get("expectedGoals"),
                row.get("expectedAssists"), row.get("rating"), _int(row.get("yellowCards")),
                _int(row.get("redCards")),
                # ...and the keeper's half of the fantavoto, asked for since the first run and dropped
                # here until now (gate §7-decies). `goalsConceded` is the goals the team conceded while
                # he was on the pitch, which for a keeper IS the malus.
                _int(row.get("goalsConceded")), _int(row.get("saves")),
                # WHICH CLUB he played them for, by the provider's own id and never by its name. The
                # payload has always carried it; storing it is what lets anything downstream join a
                # club through a key instead of a spelling (`elo.personal_levels`).
                str((row.get("team") or {}).get("id") or "") or None,
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
    """Wipe what we are about to rewrite, so re-resolving always converges to the same DB content.

    The season's rows only. The IDENTITIES are cleared and rewritten once for the whole run, by
    `_store_identities`: a mapping rejected this time must not survive as a stale identity, and dropping
    it per season lost the identities that only an OLDER season could establish.
    """
    for league in rows_by_league:
        conn.execute("DELETE FROM external_stats WHERE source = 'sofascore' "
                     "AND season = ? AND competition = ?", (season, league))


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
    payloads only - guaranteed offline, for when the parser learns to read a new field. layer='extra'
    adds what no league calendar contains - pre-season friendlies, cups, continental ties - which is
    what the last-ten window is made of in July.

    Resumable: anything already cached is not downloaded again unless refresh=True.
    Interruptible via ctx.cancel_event / Ctrl-C - whatever was cached is kept and still ingested.
    """
    ctx.require_conn()
    if isinstance(leagues, str):
        leagues = [leagues]
    if isinstance(seasons, str):
        seasons = [seasons]
    # A bare run walks the leagues IN SCOPE. A feeder league (`serie_b`) has to be asked for by name:
    # it is not a championship the engine reasons about, only the place a promoted club's men played.
    leagues = tuple(leagues) if leagues else tuple(TOURNAMENTS)
    # SEASONS only bounds NEW downloads; the offline reparse covers the whole cache unless the
    # caller names seasons explicitly (the cache spans further back than the download default).
    requested_seasons = tuple(seasons) if seasons else None
    seasons = tuple(seasons) if seasons else SEASONS
    unknown = [league for league in leagues if league not in known_leagues()]
    if unknown:
        raise RuntimeError(f"Unknown league(s) {unknown}; choose from {sorted(known_leagues())}")
    feeders = [league for league in leagues if league in FEEDER_TOURNAMENTS]
    if feeders and layer not in ("season", "reparse"):
        raise RuntimeError(
            f"{feeders} are FEEDER leagues: only the season aggregate is wanted from them (the men a "
            f"promoted club brings up need measured starts and minutes). Use --layer season.")
    if layer == "crests":
        return fetch_club_crests(ctx, refresh=refresh)
    if layer not in ("season", "match", "complete", "heatmap", "roles", "all", "reparse",
                     "crosstab", "extra", "crests"):
        raise RuntimeError(f"Unknown layer {layer!r}; choose from "
                           "season|match|complete|heatmap|roles|all|reparse|crosstab|extra")

    ctx.config.cache_dir.mkdir(parents=True, exist_ok=True)
    if layer == "crosstab":
        role_crosstab(ctx)
        return
    if layer == "roles":
        # The team ids first: they come from the cached aggregates, and without them there is no
        # squad page to ask. Cheap and offline, so it is not worth a separate command.
        derive_club_xref(ctx)
        fetch_roles(ctx, clubs=kwargs.get("clubs"), refresh=refresh)
        return
    if layer == "reparse":
        reingest_match_layer(ctx, seasons=requested_seasons)
        derive_roles_from_match_layer(ctx)
        ingest_heatmaps_from_cache(ctx, seasons=requested_seasons)
        ingest_roles_from_cache(ctx)
        return
    if layer == "extra":
        # Only if they are missing: deriving them is a WRITE, and this layer is the one most likely to
        # run beside another job (it is re-run through August as the friendlies are played).
        if not role_targets(ctx.require_conn()):
            derive_club_xref(ctx)
        fetch_extra_matches(ctx, clubs=kwargs.get("clubs"), refresh=refresh,
                            days=kwargs.get("days") or EXTRA_WINDOW_DAYS)
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
    # Resolution runs over a WHOLE season at a time (see enforce_injectivity), so a partial download
    # cannot leave a partially resolved season. It does not run over the whole CACHE unless the caller
    # asked for every season: a run bounded to some seasons may not delete an identity that the seasons
    # it never read are the ones establishing - see `_store_identities(authoritative=...)`.
    reingest_from_cache(ctx, seasons=requested_seasons)
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
    authoritative = not seasons
    surviving = _store_identities(conn, claims_by_season, by_season, authoritative=authoritative)
    identities = len(surviving)
    if authoritative:
        claims_by_season, orphans = drop_orphan_known_claims(claims_by_season, surviving)
        if orphans:
            print(f"[positions] {orphans} claim(s) dropped: their identity was not re-established "
                  f"by any name pass in this run")
    known_rows = sum(1 for claims in claims_by_season.values()
                     for claim in claims if claim.pass_name == "known")
    if known_rows:
        print(f"[positions] {known_rows} season row(s) attributed through an identity the name pools "
              f"could not see (the listone perimeter changes every summer)")
    for season, rows_by_league in sorted(by_season.items()):
        _clear_season(conn, season, rows_by_league)
        claims = claims_by_season[season]
        total += _store_claims(conn, season, claims)
        conn.commit()
        _log_season(season, claims, rows_by_league, rejected[season])
        print(f"[positions] {season} perimeter coverage: {our_side_coverage(conn, season)}")
    print(f"[positions] {total} external_stats rows and {identities} identities "
          f"from {len(by_season)} cached seasons")
    _write_coverage_report(ctx.config, report)
    # Fill the league of every club we still do not know, from these same cached files. It runs HERE
    # and not only in `rebuild` because of the order a build from zero has: `transfers` resolves clubs
    # BY LEAGUE, and on a fresh machine the league is NULL until something derives it - which would
    # leave club_xref empty, and with it the coach spells, the fees and the Transfermarkt ids.
    derive_club_leagues(ctx)


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
    # The share is only defined once there ARE players: on a fresh clone this ran before anything had
    # been downloaded and took the whole `rebuild` down with a ZeroDivisionError - found by actually
    # rebuilding an empty machine, which is the only way this class of bug ever shows up.
    share = f" ({100 * filled / total:.0f}%)" if total else ""
    print(f"[positions] birth years from the lineups: {filled}/{total} players{share}")
    return filled


def reingest_all_from_cache(ctx: Context) -> None:
    """Everything this module rebuilds offline, in dependency order (used by `rebuild`)."""
    reingest_from_cache(ctx)
    reingest_match_layer(ctx)
    derive_roles_from_match_layer(ctx)
    ingest_heatmaps_from_cache(ctx)     # after the roles: they rewrite the same `positions` slice
    derive_club_xref(ctx)               # provider team ids, from the same cached aggregates
    ingest_roles_from_cache(ctx)        # every dated real-role observation still on disk
    ingest_nationality_from_cache(ctx)  # ...and the country the same payloads have always carried
    derive_birth_years(ctx)
