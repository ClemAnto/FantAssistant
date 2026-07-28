"""recent_form - the last N matches of priced players the engine knows nothing about.

Who this is for. Every August the listone prices players with no history in our data at all: they
arrive from a league we do not scrape (Eredivisie, Championship, Liga Portugal, Serie B, Brazil) or
from a club that was outside the perimeter. Measured on the two listoni we have, **63 players in
25/26 and 64 in 24/25** are priced ABOVE their role's median quotation and have zero rows in
`season_stats` and zero in the per-match layer for the previous season - Gyokeres, Cancelo, Tillman,
Gimenez, O'Riley, Joao Neves, Neres, plus the promoted clubs' men (Lauriente, Pohjanpalo, Man). The
engine currently prices them off a role anchor and nothing else.

What this brings in: their last N matches with a real rating and real minutes, dated, so the engine
has SOMETHING measured about them. Not a season, not a fantamedia - a minimum.

Three decisions worth stating, because each is a place to go wrong:

* **`source='sofascore_recent'`, not `'sofascore'`.** These matches are in competitions the synthetic
  voto was never calibrated on: a 7.0 rating in Serie B is not a 7.0 in Serie A. `synth` fits and
  applies its line to `source='sofascore'` only, so tagging them apart keeps a Serie B rating from
  silently becoming a Serie A base voto. Whether and how the engine leans on them is the gate's call.
* **Dated, and the engine filters by the auction date.** The provider's endpoint is anchored to TODAY,
  not to an auction, so for a past window we page backwards until the matches predate that window's
  auction. Storing the date is what lets the same rows serve a live auction and a backtest.
* **Identity is resolved conservatively and TIERED.** The provider's search gives a player's CURRENT
  club, which matches his listone club for a recent listone and drifts for an older one. A unique name
  match with the club confirmed is tier 1; a unique name match without it is tier 2 and flagged;
  anything ambiguous is refused and reported. Nothing is guessed.
"""

from __future__ import annotations

import csv
import json
import re
import time
from urllib.parse import quote

# `positions` owns the SofaScore client policy (browser impersonation, retry, polite delay): one
# policy for one API, so this module borrows it instead of keeping a second copy in sync.
from euroleghe_ingest.context import Context
from euroleghe_ingest.matching import CLUB_ALIASES, club_key, fold, split_initial
from euroleghe_ingest.modules.positions import (
    _atomic_write_text,
    _client,
    _get_json,
    _iso_date,
    _polite_sleep,
)

NAME = "recent_form"
DESCRIPTION = "Last N matches of priced players with no history (other leagues) -> external_match_stats"
DEPENDS_ON: list[str] = ["rosters", "ratings"]
RAW_INPUTS: list[str] = []
NETWORK = True

BASE_URL = "https://api.sofascore.com/api/v1"
SEARCH_ENDPOINT = BASE_URL + "/search/all?q={query}&page=0"
LAST_EVENTS_ENDPOINT = BASE_URL + "/player/{pid}/events/last/{page}"
EVENT_STATS_ENDPOINT = BASE_URL + "/event/{eid}/player/{pid}/statistics"
PLAYER_ENDPOINT = BASE_URL + "/player/{pid}"

SOURCE = "sofascore_recent"
MATCHES_WANTED = 10          # "the last 10 valid matches" - valid = club match, minutes > 0
# 30 matches a page, and the endpoint is anchored to TODAY. A player with 55 matches a season needs
# ~3 pages per season of history, so reaching the T1 auction (two years back) takes more than four:
# with 4 the deep window came back empty for a dozen resolved players.
MAX_PAGES = 8
MIN_MINUTES = 1
COVERAGE_FILE = "recent_form_coverage.csv"
MAX_BIRTHYEAR_PROBES = 5     # how many ambiguous candidates are worth one request each
POPULARITY_DOMINANCE = 5.0   # tier3 only when the top candidate is followed this many times more

# Auction day, by convention the same date the engine's windows use.
AUCTION_MONTH_DAY = "-08-15"


# ---------- who needs this ----------

def priced_without_history(conn, target_season: str, input_season: str) -> list[dict]:
    """Listone players priced ABOVE their role's median with no data at all for `input_season`.

    Above the median and not at it: for goalkeepers the median quotation is 1 credit, so "at least
    average" would drag in every third-choice keeper (56 of them in 25/26 against 8 above the median).
    """
    rows = conn.execute(
        """
        SELECT r.fc_id, p.canonical_name, r.role_classic, r.price_initial, c.canonical_name,
               r.league, p.birth_year
        FROM rosters r
        JOIN players p ON p.fc_id = r.fc_id
        LEFT JOIN clubs c ON c.fc_club_id = r.fc_club_id
        WHERE r.season = ? AND r.price_initial IS NOT NULL AND r.role_classic IS NOT NULL
        """, (target_season,)).fetchall()
    by_role: dict[str, list[float]] = {}
    for _fc_id, _name, role, price, _club, _league, _born in rows:
        by_role.setdefault(role, []).append(price)
    median = {}
    for role, prices in by_role.items():
        ordered = sorted(prices)
        middle = len(ordered) // 2
        median[role] = (ordered[middle] if len(ordered) % 2
                        else (ordered[middle - 1] + ordered[middle]) / 2)

    out: list[dict] = []
    for fc_id, name, role, price, club, league, born in rows:
        if price <= median.get(role, 0):
            continue
        has_stats = conn.execute(
            "SELECT 1 FROM season_stats WHERE fc_id = ? AND season = ? AND pv > 0 LIMIT 1",
            (fc_id, input_season)).fetchone()
        # source-filtered: our OWN rows are not evidence of history. Without this the population
        # collapses to empty on the second run - the matches we just stored are dated in the input
        # season, so every player we covered would look like he had a season behind him.
        has_matches = conn.execute(
            "SELECT 1 FROM external_match_stats WHERE fc_id = ? AND season = ? AND source = ? "
            "LIMIT 1", (fc_id, input_season, "sofascore")).fetchone()
        if has_stats or has_matches:
            continue
        out.append({"fc_id": fc_id, "name": name, "role": role, "price": price,
                    "club": club, "league": league, "birth_year": born})
    out.sort(key=lambda entry: -entry["price"])
    return out


# ---------- identity ----------

_PAREN = re.compile(r"\s*\([^)]*\)")


def candidate_matches(base: str, initial: str | None, candidate_name: str) -> bool:
    """Does a provider name fit a listone one? Compared FOLDED, and the initial is a discriminator.

    `matching.fold` is what makes "Vazquez" meet "Lucas Vazquez" at all - a raw substring test fails
    on the accent, which is why four Vazquez went unresolved. `matching.split_initial` reads our own
    "Surname X." convention, so the surname is compared against the END of the provider's
    "First Last" and the initial against the start of his first name: "James J." then singles out
    Jaden James, where a surname-only test also matched James Justin and Reece James.
    """
    name = fold(candidate_name)
    if not name or not base:
        return False
    if initial:
        # our format is unambiguous here: surname last, first name starting with that letter
        return name.endswith(base) and name.split()[0].startswith(initial)
    # without an initial the provider may order the name either way
    return name.endswith(base) or f"{base} " in f"{name} "


def search_candidates(session, name: str) -> list[dict]:
    """Football players matching a listone name, as {id, name, team, followers}.

    The search spans every sport - a query for "Tillman" returns an NFL player and a basketball one -
    so it is filtered to football here. `userCount` (how many people follow that player on the
    provider) comes along because it is the only discriminator available when nothing else separates
    two footballers with the same surname.
    """
    query = quote(_PAREN.sub("", name).strip())
    data = _get_json(session, SEARCH_ENDPOINT.format(query=query))
    out = []
    for item in (data or {}).get("results") or []:
        if item.get("type") != "player":
            continue
        entity = item.get("entity") or {}
        team = entity.get("team") or {}
        if ((team.get("sport") or {}).get("slug") or "football") != "football":
            continue
        if entity.get("id"):
            out.append({"id": entity["id"], "name": entity.get("name") or "",
                        "team": team.get("name") or "",
                        "followers": entity.get("userCount") or 0})
    return out


def birth_year(session, provider_id: int) -> int | None:
    """The provider's birth year for one player - one request, spent only to break a tie.

    The search reaches every era, so a candidate can carry a pre-1970 (negative) timestamp, which
    `time.gmtime` refuses on Windows. An unreadable date is simply not a discriminator.
    """
    data = _get_json(session, PLAYER_ENDPOINT.format(pid=provider_id))
    timestamp = ((data or {}).get("player") or {}).get("dateOfBirthTimestamp")
    return _year_of(timestamp)


def _year_of(timestamp) -> int | None:
    if not timestamp or timestamp <= 0:
        return None
    try:
        return time.gmtime(timestamp).tm_year
    except (OSError, ValueError, OverflowError):
        return None


def resolve(session, player: dict, cancel_event=None) -> tuple[int | None, str]:
    """(provider id, tier) - a ladder, refusing rather than guessing at the end of it.

    tier1  the listone club and the provider's CURRENT club agree. Strongest, and it only works for a
           recent listone: the search reports where a player is TODAY, so for an older window it
           drifts (Cancelo is at Al-Hilal now, the 25/26 listone had him at Barcelona).
    tier2  the birth year we already hold for 94% of the listone singles out one candidate. One
           request per candidate, spent only on a real tie.
    tier3  nobody else is close on followers (the provider's own popularity count). A stated
           heuristic, tagged so a report can show how much rests on it.
    """
    candidates = search_candidates(session, player["name"])
    if not candidates:
        return None, ""

    if player["club"]:
        wanted = club_key(CLUB_ALIASES.get(player["club"], player["club"]))
        confirmed = [c for c in candidates
                     if club_key(CLUB_ALIASES.get(c["team"], c["team"])) == wanted]
        if len(confirmed) == 1:
            return confirmed[0]["id"], "tier1_club_confirmed"
        if len(confirmed) > 1:
            return None, ""            # two footballers, same name, same club: refuse

    base, initial = split_initial(player["name"])
    shortlist = [c for c in candidates if candidate_matches(base, initial, c["name"])]
    if not shortlist:
        # the initial may be the thing that is wrong (a nickname, a second surname): drop it before
        # giving up on the name entirely
        shortlist = [c for c in candidates if candidate_matches(base, None, c["name"])] or candidates
    if len(shortlist) == 1:
        return shortlist[0]["id"], "tier2_name_only"

    if player.get("birth_year"):
        probes = sorted(shortlist, key=lambda c: -c["followers"])[:MAX_BIRTHYEAR_PROBES]
        matching = []
        for candidate in probes:
            if cancel_event is not None and cancel_event.is_set():
                break
            _polite_sleep(cancel_event)
            if birth_year(session, candidate["id"]) == player["birth_year"]:
                matching.append(candidate)
        if len(matching) == 1:
            return matching[0]["id"], "tier2_birth_year"

    ranked = sorted(shortlist, key=lambda c: -c["followers"])
    if (len(ranked) > 1 and ranked[0]["followers"]
            >= POPULARITY_DOMINANCE * max(1, ranked[1]["followers"])):
        return ranked[0]["id"], "tier3_popularity"
    return None, ""


# ---------- the matches ----------

def _season_of(timestamp: int) -> str:
    """Season a match belongs to, European convention (July starts a season)."""
    when = time.gmtime(timestamp)
    year = when.tm_year if when.tm_mon >= 7 else when.tm_year - 1
    return f"{year}-{(year + 1) % 100:02d}"


def recent_matches(session, provider_id: int, before_timestamp: int,
                   wanted: int = MATCHES_WANTED, cancel_event=None) -> list[dict]:
    """The last `wanted` CLUB matches with minutes, all strictly before `before_timestamp`.

    The endpoint is anchored to today and returns 30 events a page, so a past window needs paging
    backwards. National-team matches are dropped (the `national` flag on the team he played for) and
    so are friendlies: neither is evidence about a league season.
    """
    kept: list[dict] = []
    for page in range(MAX_PAGES):
        if cancel_event is not None and cancel_event.is_set():
            break
        data = _get_json(session, LAST_EVENTS_ENDPOINT.format(pid=provider_id, page=page))
        if not data:
            break
        stats_map = data.get("statisticsMap") or {}
        team_map = data.get("playedForTeamMap") or {}
        events = sorted(data.get("events") or [],
                        key=lambda e: -(e.get("startTimestamp") or 0))
        for event in events:
            timestamp = event.get("startTimestamp") or 0
            if timestamp >= before_timestamp:
                continue
            key = str(event.get("id"))
            statistics = stats_map.get(key) or {}
            minutes = statistics.get("minutesPlayed") or 0
            if minutes < MIN_MINUTES:
                continue
            team_id = team_map.get(key)
            home, away = event.get("homeTeam") or {}, event.get("awayTeam") or {}
            side = home if home.get("id") == team_id else away
            if side.get("national"):
                continue
            tournament = event.get("tournament") or {}
            unique = tournament.get("uniqueTournament") or {}
            competition = unique.get("slug") or tournament.get("slug") or tournament.get("name") or ""
            if "friendly" in competition.lower():
                continue
            kept.append({
                "event_id": key,
                "timestamp": timestamp,
                "season": _season_of(timestamp),
                "competition": competition,
                "club": side.get("name"),
                "opponent": (away if side is home else home).get("name"),
                "home": 1 if side is home else 0,
                "round": (event.get("roundInfo") or {}).get("round"),
                "minutes": minutes,
                "rating": statistics.get("rating"),
            })
            if len(kept) >= wanted:
                return kept
        if not data.get("hasNextPage"):
            break
        _polite_sleep(cancel_event)
    return kept


def enrich_with_bonuses(session, provider_id: int, matches: list[dict], cancel_event=None) -> int:
    """Add goals/assists/xG/xA per match - one request each, and the reason the module is not free.

    The events endpoint carries only rating and minutes. Without goals there is no FM-equivalent for
    these players, only a base voto, so the bonuses are worth a request apiece.
    """
    filled = 0
    for match in matches:
        if cancel_event is not None and cancel_event.is_set():
            break
        _polite_sleep(cancel_event)
        data = _get_json(session, EVENT_STATS_ENDPOINT.format(eid=match["event_id"],
                                                              pid=provider_id))
        statistics = (data or {}).get("statistics") or {}
        if not statistics:
            continue
        match["goals"] = statistics.get("goals") or 0
        match["assists"] = statistics.get("goalAssist") or 0
        match["xg"] = statistics.get("expectedGoals")
        match["xa"] = statistics.get("expectedAssists")
        filled += 1
    return filled


CACHE_NAME = re.compile(r"sofascore_recent_(\d+)\.json$")


def _cache_path(ctx: Context, fc_id: int):
    return ctx.config.cache_dir / f"sofascore_recent_{fc_id}.json"


def _write_cache(ctx: Context, fc_id: int, matches: list[dict]) -> None:
    """Keep the raw fetch on disk, like every other network module in the toolkit.

    Without this `recent_form` was the only scraper whose output existed nowhere but in the DB, and
    `rebuild` drops every table - so hours of polite requests were one command away from being
    irrecoverable, against the project's own rule that the DB is always rebuildable from scratch.
    Merged with whatever is already cached, so a second window's fetch does not erase the first's.
    """
    path = _cache_path(ctx, fc_id)
    known: dict[str, dict] = {}
    if path.exists():
        try:
            known = {entry["event_id"]: entry
                     for entry in json.loads(path.read_text(encoding="utf-8"))}
        except (OSError, ValueError, KeyError):
            known = {}
    known.update({match["event_id"]: match for match in matches})
    ordered = sorted(known.values(), key=lambda match: match["timestamp"])
    _atomic_write_text(path, json.dumps(ordered, ensure_ascii=False))


def reingest_from_cache(ctx: Context) -> None:
    """Re-apply every cached player fetch offline (the rebuild path)."""
    conn = ctx.require_conn()
    files = sorted(ctx.config.cache_dir.glob("sofascore_recent_*.json"))
    players = rows = 0
    for path in files:
        found = CACHE_NAME.search(path.name)
        if not found:
            continue
        try:
            matches = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):   # a corrupt cache file must not abort the rebuild
            print(f"[recent_form] skipping unreadable cache {path.name}")
            continue
        if matches:
            rows += store(conn, int(found.group(1)), matches)
            players += 1
    conn.commit()
    if files:
        print(f"[recent_form] reingested {rows} matches for {players} players from cache")


def store(conn, fc_id: int, matches: list[dict]) -> int:
    rows = [(fc_id, match["season"], SOURCE, match["event_id"], match["competition"],
             match.get("round"), _iso_date(match["timestamp"]),
             match.get("club"), match.get("opponent"), match.get("home"), match.get("minutes"),
             match.get("rating"), match.get("goals"), match.get("assists"),
             match.get("xg"), match.get("xa"))
            for match in matches]
    conn.executemany(
        """INSERT OR REPLACE INTO external_match_stats
           (fc_id, season, source, match_id, competition, real_md, match_date, club, opponent,
            home, minutes, rating, goals, assists, xg, xa)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", rows)
    return len(rows)


def _process(ctx: Context, session, conn, player: dict, target: str, cutoff: int,
             wanted: int, bonuses: bool) -> dict | None:
    """One player: resolve, fetch, store. None = already covered, nothing to do."""
    # Covered means covered FOR THIS WINDOW: the same bounds the engine reads with
    # (features._recent_form), input-season July to auction day. Counting everything before the
    # auction instead would let matches fetched for an earlier listone stand in as this window's
    # recent form - a player scraped for 24/25 would be skipped for 25/26 and priced on football he
    # played two seasons before.
    # Counted WITH the bonuses when they were asked for. Counting matches alone made the resume check
    # permanently self-satisfied: a player stored by a --no-bonuses run had his matches and no goals,
    # was skipped by every later run, and reached the engine as "0 goals in 715 minutes" - which is what
    # happened to 111 of the 123 players in this population, Lauriente' among them.
    already = conn.execute(
        f"""SELECT COUNT(*) FROM external_match_stats
            WHERE fc_id = ? AND source = ? AND match_date >= ? AND match_date < ?
              {"AND goals IS NOT NULL" if bonuses else ""}""",
        (player["fc_id"], SOURCE, f"{int(target.split('-')[0]) - 1}-07-01",
         f"{target.split('-')[0]}{AUCTION_MONTH_DAY}")).fetchone()
    if already and already[0] >= wanted:
        return None                                   # resumable: already covered

    _polite_sleep(ctx.cancel_event)
    provider_id, tier = resolve(session, player, ctx.cancel_event)
    entry = {"season": target, "fc_id": player["fc_id"], "name": player["name"],
             "role": player["role"], "price": player["price"], "club": player["club"],
             "provider_id": provider_id or "", "tier": tier or "unresolved",
             "matches": 0, "competitions": "", "_stored": 0}
    if not provider_id:
        return entry

    _polite_sleep(ctx.cancel_event)
    matches = recent_matches(session, provider_id, cutoff, wanted, ctx.cancel_event)
    if matches and bonuses:
        enrich_with_bonuses(session, provider_id, matches, ctx.cancel_event)
    if matches:
        entry["_stored"] = store(conn, player["fc_id"], matches)
        _write_cache(ctx, player["fc_id"], matches)
        conn.commit()
    entry["matches"] = len(matches)
    entry["competitions"] = ";".join(sorted({match["competition"] for match in matches}))
    return entry


def _write_report(ctx: Context, report: list[dict], stored_total: int) -> None:
    resolved = sum(1 for entry in report if entry["provider_id"])
    with_matches = sum(1 for entry in report if entry["matches"])
    path = ctx.config.data_dir / "reports" / COVERAGE_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    if report:
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=sorted({k for e in report for k in e}))
            writer.writeheader()
            writer.writerows(report)
    tiers: dict[str, int] = {}
    for entry in report:
        tiers[entry["tier"]] = tiers.get(entry["tier"], 0) + 1
    print(f"[recent_form] {resolved}/{len(report)} identities resolved · {with_matches} with matches "
          f"· {stored_total} rows stored · report -> {path}")
    print(f"[recent_form] tiers: {json.dumps(tiers, sort_keys=True)}")


def run(ctx: Context, *, seasons=None, wanted: int = MATCHES_WANTED, bonuses: bool = True,
        limit: int | None = None, **kwargs) -> None:
    """Resolve and fetch the recent form of priced players with no history, season by season.

    Resumable (a player with enough stored matches is skipped), interruptible, and tolerant: one odd
    player is reported and stepped over rather than ending the run, and the coverage report is written
    whatever happens - a crash two thirds of the way through used to leave nothing to look at.
    """
    conn = ctx.require_conn()
    all_seasons = [row[0] for row in conn.execute(
        "SELECT DISTINCT season FROM rosters ORDER BY season")]
    targets = list(seasons) if seasons else all_seasons[1:]      # the first season has no "previous"
    session = _client()
    report: list[dict] = []
    stored_total = 0
    try:
        for target in targets:
            previous = max((s for s in all_seasons if s < target), default=None)
            if previous is None:
                continue
            cutoff = int(time.mktime(time.strptime(
                f"{target.split('-')[0]}{AUCTION_MONTH_DAY}", "%Y-%m-%d")))
            players = priced_without_history(conn, target, previous)
            if limit:
                players = players[:limit]
            print(f"[recent_form] {target}: {len(players)} priced players with no {previous} data")
            for player in players:
                if ctx.cancelled():
                    raise KeyboardInterrupt
                try:
                    entry = _process(ctx, session, conn, player, target, cutoff, wanted, bonuses)
                except KeyboardInterrupt:
                    raise
                except Exception as exc:   # noqa: BLE001 - one odd player must not end the run
                    print(f"[recent_form]   {player['name'][:22]:<22} skipped: {exc!r}")
                    entry = {"season": target, "fc_id": player["fc_id"], "name": player["name"],
                             "role": player["role"], "price": player["price"],
                             "club": player["club"], "provider_id": "", "tier": "error",
                             "matches": 0, "competitions": "", "_stored": 0}
                if entry is None:
                    continue
                stored_total += entry.pop("_stored", 0)
                report.append(entry)
                print(f"[recent_form]   {player['name'][:22]:<22} Qt.I {player['price']:>4.0f} "
                      f"{entry['tier']:<20} {entry['matches']} matches")
    except KeyboardInterrupt:
        print("[recent_form] interrupted - what is stored is committed, rerun to continue")
    finally:
        session.close()
        _write_report(ctx, report, stored_total)
