"""espn - the live squads and the calendar from ESPN's public site API, where SofaScore has stopped answering.

WHY THIS SOURCE (30/10/2026). SofaScore has answered 403 `challenge` on every endpoint since 24/09/2026, and
two things the lineup depends on stood still with it: the LIVE SQUAD - the operator's authority on who is in
a squad (17/08/2026), the only read that can say «he is no longer there» - and the CALENDAR, read on 24/09
and never again, so a postponement since then is invisible. Getting past that block is not an option this
project takes (a browser impersonation to beat a bot check was refused on 30/10/2026, and rightly). ESPN's
`site.api.espn.com` was probed the same day with one plain request per endpoint, no key and no cookie, on the
five championships:

  * `/{slug}/teams`                         the championship's clubs, with ESPN's team id;
  * `/{slug}/teams/{id}/roster`             the WHOLE squad of a club, dated by our read - which is what makes
                                             it a squad source and not a list of names: an absence from a full
                                             read is evidence (see `snapshot.live_squads`);
  * `/{slug}/teams/{id}/schedule[?fixture=true]`  the club's played and remaining league matches, with the
                                             DATE and the status, i.e. where a postponement shows.

What it does NOT carry is said here so nobody looks for it: no granular role (the roster gives G/D/M/F only),
no ROUND number on a match, no xG and no provider rating. The roles and the per-match layer are the next
step, from the match summaries; this module is the squad and the date.

IDENTITY, and it is the delicate half. An ESPN athlete is joined to an `fc_id` by NAME inside a POOL, never
by name alone (`matching.match_in_pool`, the one funnel the project already trusts), and the birth year is a
VETO wherever both sides know it. Two passes: the club's own pool (whoever our listone, rosters or a dated
squad reading puts at that club), then the whole quoted listone - for a man who moved between two clubs we
both carry - where only a tier-1/2 name match with the SAME birth year is accepted. A claim two ESPN ids make
on one `fc_id` is dropped on both sides: an ambiguous identity is worse than a missing one. The mappings are
re-derived from the whole cache at every run and written with `resolved_by = 'espn'`, so a stale one does not
survive and no other module's identity is touched.

Two rules carried in from the house:
  * a club joins through its CANONICAL name, resolved once (`club_xref` source `espn`), never through ESPN's
    string - «Internazionale», «Bayern Munich», «Marseille» are none of our spellings;
  * the calendar UPDATES the rows SofaScore wrote (date, played) and never invents one: ESPN has no round
    number, and a match without its round would be a fixture the rest of the code cannot place. What does
    not match is counted and printed, never silently dropped.
"""

from __future__ import annotations

import datetime as dt
import json
import random
import re
import time
from pathlib import Path

from euroleghe_ingest import matching
from euroleghe_ingest.context import Context

NAME = "espn"
DESCRIPTION = "ESPN -> live squads (squad_snapshot via snapshot), ESPN identities, calendar dates/status"
DEPENDS_ON: list[str] = ["rosters", "ratings", "fixtures"]
RAW_INPUTS: list[str] = []
NETWORK = True

BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer"
TEAMS_ENDPOINT = BASE_URL + "/{slug}/teams"
ROSTER_ENDPOINT = BASE_URL + "/{slug}/teams/{tid}/roster"
SCHEDULE_ENDPOINT = BASE_URL + "/{slug}/teams/{tid}/schedule"

# Our championship key -> ESPN's slug. One table for the standings (`fixtures.ESPN_SLUGS`) and this module.
from euroleghe_ingest.modules.fixtures import ESPN_SLUGS  # noqa: E402

# THE SPELLINGS NO RULE PLACES, declared and checked on 30/10/2026 against `clubs.canonical_name`: the project
# resolver (`snapshot.club_index`) places 86 of ESPN's 94 clubs by itself, and of the eight it echoes back
# unchanged these are the ones we carry. The rest (Brentford, Getafe, Le Havre...) are clubs no listone of ours
# quotes, so there is nothing to join them to - they are printed, not guessed.
ESPN_CLUB_NAMES: dict[str, str] = {
    "Internazionale": "Inter", "Bayern Munich": "Bayern Monaco",
    "Borussia Mönchengladbach": "Borussia MGladbach", "Marseille": "Olympique Marsiglia",
    "Lyon": "Olympique Lione", "FC Cologne": "Colonia", "Toulouse": "Tolosa", "Leeds United": "Leeds",
}

# Polite, and slower than SofaScore's own because nobody pays us for this API either: ~94 rosters plus ~188
# schedule pages is a few minutes a night.
REQUEST_DELAY = 1.0
REQUEST_JITTER = 0.5

_ROSTER_CACHE = re.compile(r"espn_roster_(\d+)_(\d{4}-\d{2}-\d{2})\.json$")
_TEAMS_CACHE = re.compile(r"espn_teams_([a-z0-9.]+)\.json$")


# ---------------------------------------------------------------------------------------------- network


def _get_json(url: str, *, tries: int = 3):
    """GET + JSON with a plain client. `None` when the source did not answer - never an empty payload, so a
    marker can never record «nothing» on behalf of a refusal (CLAUDE.md, 17/08/2026)."""
    import urllib.error
    import urllib.request

    for attempt in range(1, tries + 1):
        try:
            request = urllib.request.Request(url, headers={"Accept": "application/json",
                                                           "User-Agent": "FantAssistant/1.0"})
            with urllib.request.urlopen(request, timeout=40) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504) or attempt == tries:
                return None
        except (urllib.error.URLError, TimeoutError, ValueError):
            if attempt == tries:
                return None
        time.sleep(2.0 * attempt)
    return None


def _sleep(ctx: Context) -> None:
    delay = REQUEST_DELAY + random.uniform(0, REQUEST_JITTER)
    if ctx.cancel_event is not None:
        ctx.cancel_event.wait(delay)
    else:
        time.sleep(delay)


def _write(path: Path, payload) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def _read(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"[espn] skipping unreadable cache {path.name}: {exc}")
        return None


# ------------------------------------------------------------------------------------------------ clubs


def teams_of(payload) -> list[dict]:
    """The team objects of a `/teams` payload, whatever nesting it has."""
    try:
        return [entry["team"] for entry in payload["sports"][0]["leagues"][0]["teams"]]
    except (KeyError, IndexError, TypeError):
        return []


def resolve_clubs(conn, teams_by_league: dict[str, list[dict]]) -> tuple[dict[str, str], list[str]]:
    """({ESPN team id: our canonical club name}, [ESPN names we carry no club for]). Pure on the DB."""
    from euroleghe_ingest.modules.snapshot import club_index

    resolve = club_index(conn)
    canonical = {name for (name,) in conn.execute(
        "SELECT canonical_name FROM clubs WHERE canonical_name IS NOT NULL")}
    out: dict[str, str] = {}
    missing: list[str] = []
    for _league, teams in teams_by_league.items():
        for team in teams:
            tid, name = str(team.get("id") or ""), team.get("displayName") or ""
            if not tid or not name:
                continue
            ours = ESPN_CLUB_NAMES.get(name)
            if ours is None:
                for spelling in (name, team.get("shortDisplayName"), team.get("location")):
                    found = resolve(spelling)[1] if spelling else None
                    if found in canonical:
                        ours = found
                        break
            if ours in canonical:
                out[tid] = ours
            else:
                missing.append(name)
    return out, missing


def store_club_xref(conn, clubs: dict[str, str]) -> int:
    ids = {name: fc_club_id for fc_club_id, name in conn.execute(
        "SELECT fc_club_id, canonical_name FROM clubs WHERE canonical_name IS NOT NULL")}
    rows = [(ids[name], "espn", tid) for tid, name in clubs.items() if name in ids]
    conn.executemany("INSERT OR REPLACE INTO club_xref(fc_club_id, source, source_id) VALUES (?, ?, ?)",
                     rows)
    return len(rows)


def espn_clubs(conn) -> dict[str, str]:
    """{ESPN team id: canonical club} as stored - the bridge every other reader of this module uses."""
    return {str(tid): name for tid, name in conn.execute(
        "SELECT x.source_id, c.canonical_name FROM club_xref x JOIN clubs c USING (fc_club_id) "
        "WHERE x.source = 'espn'")}


# --------------------------------------------------------------------------------------------- identity


def athletes_of(payload) -> list[dict]:
    """The athlete objects of a roster payload (flat list on the site API, grouped on some others)."""
    athletes = (payload or {}).get("athletes") or []
    flat: list[dict] = []
    for entry in athletes:
        if isinstance(entry, dict) and "items" in entry:
            flat += entry.get("items") or []
        elif isinstance(entry, dict):
            flat.append(entry)
    return flat


def _birth_year(athlete: dict) -> int | None:
    born = athlete.get("dateOfBirth") or ""
    return int(born[:4]) if len(born) >= 4 and born[:4].isdigit() else None


def _target_season(conn) -> str | None:
    return conn.execute("SELECT MAX(season) FROM rosters").fetchone()[0]


def club_pools(conn, season: str, date: str) -> dict[str, list[tuple]]:
    """{canonical club: [pool entries]} - who OUR sources put at each club, and with what birth year.

    Three readings united on purpose: the listone of `season` per platform (a man quoted on one platform only
    is still at that club), the roster row, and the newest dated squad reading of the last four months (the
    club a man is at between two listone reads). A man in two pools is in both - the injectivity check below
    is what keeps that from becoming two identities.
    """
    floor = (dt.date.fromisoformat(date) - dt.timedelta(days=120)).isoformat()
    rows = conn.execute(
        """
        SELECT c.canonical_name, p.fc_id, p.canonical_name, p.birth_year
        FROM listone_quotes q JOIN clubs c ON c.fc_club_id = q.fc_club_id JOIN players p USING (fc_id)
        WHERE q.season = :season
        UNION
        SELECT c.canonical_name, p.fc_id, p.canonical_name, p.birth_year
        FROM rosters r JOIN clubs c ON c.fc_club_id = r.fc_club_id JOIN players p USING (fc_id)
        WHERE r.season = :season
        UNION
        SELECT s.club, p.fc_id, p.canonical_name, p.birth_year
        FROM (SELECT fc_id, club, MAX(valid_from) AS seen FROM squad_snapshot
              WHERE valid_from >= :floor AND valid_from <= :date GROUP BY fc_id) s
        JOIN players p USING (fc_id)
        """, {"season": season, "floor": floor, "date": date}).fetchall()
    pools: dict[str, dict[int, tuple]] = {}
    for club, fc_id, name, born in rows:
        if club:
            pools.setdefault(club, {})[fc_id] = (*matching.build_pool_entry(fc_id, name), born)
    return {club: list(entries.values()) for club, entries in pools.items()}


def quoted_pool(conn, season: str) -> list[tuple]:
    rows = conn.execute(
        "SELECT DISTINCT p.fc_id, p.canonical_name, p.birth_year FROM listone_quotes q "
        "JOIN players p USING (fc_id) WHERE q.season = ?", (season,)).fetchall()
    return [(*matching.build_pool_entry(fc_id, name), born) for fc_id, name, born in rows]


def _claim(athlete: dict, pool: list[tuple], *, strict: bool) -> int | None:
    """The fc_id this athlete is, inside `pool`, or None. `strict` = the wide pass (whole listone)."""
    born = _birth_year(athlete)
    names = [one for one in (athlete.get("displayName"), athlete.get("fullName")) if one]
    for name in dict.fromkeys(names):
        tier, candidates = matching.match_in_pool(name, [entry[:4] for entry in pool])
        if not candidates:
            continue
        years = {entry[0]: entry[4] for entry in pool}
        # THE BIRTH YEAR IS A VETO wherever both sides know it - and in the wide pass it is REQUIRED.
        agree = [fc_id for fc_id, _name in candidates
                 if (years.get(fc_id) is None or born is None or years[fc_id] == born)]
        if strict:
            agree = [fc_id for fc_id in agree if born is not None and years.get(fc_id) == born]
            if tier > 2:
                return None
        elif tier == 4 and not all(born is not None and years.get(fc_id) == born for fc_id in agree):
            return None            # a FUZZY name stands only on a birth year both sides confirm
        unique = list(dict.fromkeys(agree))
        return unique[0] if len(unique) == 1 else None
    return None


def resolve_athletes(rosters: list[tuple[str, list[dict]]], pools: dict[str, list[tuple]],
                     wide: list[tuple]) -> tuple[dict[str, int], int]:
    """({ESPN athlete id: fc_id}, how many claims were dropped as ambiguous). Pure.

    `rosters` = [(canonical club, athletes)] over every cached read; the same athlete read on several days
    (or at two clubs across a window) must reach the SAME fc_id, or he has none.
    """
    claims: dict[str, set[int]] = {}
    seen: dict[str, dict] = {}
    for club, athletes in rosters:
        pool = pools.get(club) or []
        for athlete in athletes:
            aid = str(athlete.get("id") or "")
            if not aid:
                continue
            seen.setdefault(aid, athlete)
            fc_id = _claim(athlete, pool, strict=False)
            if fc_id is not None:
                claims.setdefault(aid, set()).add(fc_id)
    for aid, athlete in seen.items():
        if aid not in claims:
            fc_id = _claim(athlete, wide, strict=True)
            if fc_id is not None:
                claims.setdefault(aid, set()).add(fc_id)
    one = {aid: next(iter(ids)) for aid, ids in claims.items() if len(ids) == 1}
    owners: dict[int, list[str]] = {}
    for aid, fc_id in one.items():
        owners.setdefault(fc_id, []).append(aid)
    out = {aid: fc_id for aid, fc_id in one.items() if len(owners[fc_id]) == 1}
    return out, len(claims) - len(out)


def cached_rosters(cache: Path, clubs: dict[str, str], until: str | None = None):
    """[(canonical club, observed day, athletes)] for every cached roster read, oldest first."""
    out = []
    for path in sorted(cache.glob("espn_roster_*.json")):
        key = _ROSTER_CACHE.search(path.name)
        if not key or (until and key.group(2) > until):
            continue
        club = clubs.get(key.group(1))
        payload = _read(path) if club else None
        if payload is not None:
            out.append((club, key.group(2), athletes_of(payload)))
    return out


def store_identities(conn, mapping: dict[str, int]) -> int:
    """Rewrite this module's own identities. Only `resolved_by = 'espn'` rows are ever retracted."""
    conn.execute("DELETE FROM player_xref WHERE source = 'espn' AND resolved_by = 'espn'")
    conn.executemany(
        "INSERT OR REPLACE INTO player_xref(fc_id, source, source_id, resolved_by) VALUES (?, 'espn', ?, 'espn')",
        [(fc_id, aid) for aid, fc_id in mapping.items()])
    return len(mapping)


def ingest_identities(ctx: Context) -> dict[str, int]:
    conn = ctx.require_conn()
    clubs = espn_clubs(conn)
    season = _target_season(conn)
    reads = cached_rosters(ctx.config.cache_dir, clubs)
    if not reads or not season:
        return {"identities": 0, "athletes": 0}
    newest = max(day for _club, day, _athletes in reads)
    mapping, dropped = resolve_athletes([(club, athletes) for club, _day, athletes in reads],
                                        club_pools(conn, season, newest), quoted_pool(conn, season))
    athletes = len({str(a.get("id")) for _c, _d, roster in reads for a in roster if a.get("id")})
    written = store_identities(conn, mapping)
    conn.commit()
    print(f"[espn] identities: {written} of {athletes} ESPN athletes resolved to an fc_id"
          f"{f' · {dropped} dropped as ambiguous' if dropped else ''}")
    return {"identities": written, "athletes": athletes, "ambiguous": dropped}


# --------------------------------------------------------------------------------------------- calendar


def _our_season(year) -> str | None:
    return f"{int(year)}-{str(int(year) + 1)[-2:]}" if str(year or "").isdigit() else None


def parse_schedule(payload, league: str, keys_by_tid: dict[str, str]) -> list[dict]:
    """ESPN schedule events -> {season, league, home_key, away_key, date, played}. Pure.

    Only matches whose BOTH clubs have a key: the update joins on the pair, and a side with no key cannot be
    the pair of any row.
    """
    rows: list[dict] = []
    for event in (payload or {}).get("events") or []:
        season = _our_season((event.get("season") or {}).get("year"))
        competition = (event.get("competitions") or [{}])[0]
        sides = {one.get("homeAway"): str((one.get("team") or {}).get("id") or "")
                 for one in competition.get("competitors") or []}
        home, away = keys_by_tid.get(sides.get("home", "")), keys_by_tid.get(sides.get("away", ""))
        stamp = event.get("date") or ""
        if not (season and home and away and len(stamp) >= 10):
            continue
        status = (competition.get("status") or {}).get("type") or {}
        rows.append({"season": season, "league": league, "home_key": home, "away_key": away,
                     "date": stamp[:10], "played": 1 if status.get("completed") else 0,
                     "event_id": str(event.get("id") or "")})
    return rows


def update_fixtures(conn, rows: list[dict], observed_on: str) -> dict[str, int]:
    """Move the SofaScore rows to ESPN's date and status. Never inserts: a row needs its round."""
    moved = updated = unmatched = 0
    for row in {(r["season"], r["league"], r["home_key"], r["away_key"]): r for r in rows}.values():
        found = conn.execute(
            "SELECT event_id, date, played FROM fixtures WHERE season = ? AND league = ? "
            "AND home_key = ? AND away_key = ?",
            (row["season"], row["league"], row["home_key"], row["away_key"])).fetchall()
        if len(found) != 1:
            unmatched += 1
            continue
        event_id, date, played = found[0]
        if date != row["date"]:
            moved += 1
        conn.execute("UPDATE fixtures SET date = ?, played = MAX(played, ?), observed_on = ? "
                     "WHERE event_id = ?", (row["date"], row["played"], observed_on, event_id))
        updated += 1
    return {"updated": updated, "moved": moved, "unmatched": unmatched}


def ingest_calendar(ctx: Context, observed_on: str | None = None) -> dict[str, int]:
    """The calendar from the cached schedule pages (offline)."""
    conn = ctx.require_conn()
    observed_on = observed_on or dt.datetime.now(tz=dt.UTC).date().isoformat()
    from euroleghe_ingest.modules.fixtures import match_espn_teams

    totals = {"updated": 0, "moved": 0, "unmatched": 0}
    for league, slug in ESPN_SLUGS.items():
        teams_path = ctx.config.cache_dir / f"espn_teams_{slug}.json"
        teams = teams_of(_read(teams_path)) if teams_path.exists() else []
        season = conn.execute("SELECT MAX(season) FROM fixtures WHERE league = ?", (league,)).fetchone()[0]
        if not teams or not season:
            continue
        keys = {key for pair in conn.execute(
            "SELECT home_key, away_key FROM fixtures WHERE league = ? AND season = ?", (league, season))
            for key in pair}
        keys_by_tid = {str(team.get("id")): key for team, key in
                       match_espn_teams([(team, team) for team in teams], keys)}
        rows: list[dict] = []
        for team in teams:
            for kind in ("past", "next"):
                path = ctx.config.cache_dir / f"espn_schedule_{team.get('id')}_{kind}.json"
                if path.exists():
                    rows += parse_schedule(_read(path), league, keys_by_tid)
        counts = update_fixtures(conn, rows, observed_on)
        print(f"[espn] calendar {league}: {len(keys_by_tid)}/{len(teams)} clubs placed · "
              f"{counts['updated']} matches updated, {counts['moved']} moved date, "
              f"{counts['unmatched']} without a SofaScore row")
        for name, value in counts.items():
            totals[name] += value
    conn.commit()
    return totals


# ------------------------------------------------------------------------------------------------- runs


def fetch_teams(ctx: Context, refresh: bool = True) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for league, slug in ESPN_SLUGS.items():
        path = ctx.config.cache_dir / f"espn_teams_{slug}.json"
        payload = None
        if refresh or not path.exists():
            payload = _get_json(TEAMS_ENDPOINT.format(slug=slug))
            if payload is not None:
                _write(path, payload)
            _sleep(ctx)
        if payload is None and path.exists():
            payload = _read(path)
        out[league] = teams_of(payload)
    return out


def run(ctx: Context, *, layer: str = "all", refresh: bool = True, **kwargs) -> dict[str, int]:
    """`squads` = the clubs, today's rosters and the identities; `calendar` = the schedule pages and the
    dates; `all` = both. The rosters are dated by the day of the read, so a second run on the same day costs
    nothing unless `refresh`; the schedules are one file per club and are re-read on every run (a calendar
    moves) unless `refresh` is off."""
    conn = ctx.require_conn()
    cache = ctx.config.cache_dir
    cache.mkdir(parents=True, exist_ok=True)
    today = dt.datetime.now(tz=dt.UTC).date().isoformat()
    counts: dict[str, int] = {"requests": 0, "failed": 0}

    teams = fetch_teams(ctx)
    clubs, missing = resolve_clubs(conn, teams)
    store_club_xref(conn, clubs)
    conn.commit()
    print(f"[espn] clubs: {len(clubs)} of {sum(len(t) for t in teams.values())} placed on ours"
          + (f" · not carried by us: {', '.join(sorted(missing))}" if missing else ""))
    slug_of = {str(team.get("id")): ESPN_SLUGS[league] for league, ts in teams.items() for team in ts}
    todo: list[tuple[str, str, str]] = []
    if layer in ("all", "squads"):
        todo += [("roster", tid, cache / f"espn_roster_{tid}_{today}.json") for tid in clubs]
    if layer in ("all", "calendar"):
        todo += [(f"schedule_{kind}", tid, cache / f"espn_schedule_{tid}_{kind}.json")
                 for tid in slug_of for kind in ("past", "next")]
    todo = [item for item in todo if refresh or not item[2].exists()]
    failures_in_a_row = 0
    for index, (kind, tid, path) in enumerate(todo, start=1):
        if ctx.cancelled():
            print("[espn] interrupted - every page read is cached, rerun to continue")
            break
        slug = slug_of[tid]
        url = (ROSTER_ENDPOINT if kind == "roster" else SCHEDULE_ENDPOINT).format(slug=slug, tid=tid)
        if kind == "schedule_next":
            url += "?fixture=true"
        payload = _get_json(url)
        counts["requests"] += 1
        if payload is None:
            counts["failed"] += 1
            failures_in_a_row += 1
            # A sweep that starts getting refused is a sweep to abandon (17/08/2026): continuing does not
            # reopen the source, and what is on disk is kept.
            if failures_in_a_row >= 5:
                print(f"[espn] {failures_in_a_row} refusals in a row - stopping, the cache is kept")
                break
        else:
            failures_in_a_row = 0
            _write(path, payload)
        if index % 25 == 0 or index == len(todo):
            ctx.progress("espn", index, len(todo), "pagine lette")
        _sleep(ctx)
    if layer in ("all", "squads"):
        counts.update(ingest_identities(ctx))
    if layer in ("all", "calendar"):
        counts.update(ingest_calendar(ctx, today))
    return counts


def reingest_from_cache(ctx: Context) -> None:
    """OFFLINE: clubs, identities and calendar from the cache - the replay `rebuild` runs."""
    conn = ctx.require_conn()
    teams = {league: teams_of(_read(ctx.config.cache_dir / f"espn_teams_{slug}.json"))
             for league, slug in ESPN_SLUGS.items()
             if (ctx.config.cache_dir / f"espn_teams_{slug}.json").exists()}
    if not teams:
        return
    clubs, _missing = resolve_clubs(conn, teams)
    store_club_xref(conn, clubs)
    conn.commit()
    ingest_identities(ctx)
    ingest_calendar(ctx)
