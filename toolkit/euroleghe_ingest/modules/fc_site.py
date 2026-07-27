"""fc_site - fantacalcio.it editorial lists -> the VOLATILE states, as dated time series.

Three states the engine needs, none of which is a static flag (spec v9 §8):
    probable_starter   probabili formazioni: starting probability per player
    availability       indisponibili: injured / suspended (+ a booking-risk flag)
    penalty_hierarchy  who takes the penalties

For the penalty hierarchy the spec ranks the sources: REVEALED (who actually took the last
penalty, from our own ratings) > official lists (this page) > friendlies. The revealed part is
derived OFFLINE here from match_ratings, so it works without the site and is the strongest signal;
the official list only fills the preseason gap - and as of the 2026-27 preseason that page still
answers "Dati non ancora disponibili", which this module reports instead of parsing thin air.

Every fetch is snapshotted to data/cache/fc_site_{page}_{date}.html. Those snapshots ARE the time
series: `rebuild` replays them in date order, so the history of a state survives a rebuild even
though the site only ever shows "now".

Identity: the probabili page carries the fc_id in each player's href (.../{slug}/{fc_id}/{season}),
so that list is exact. The indisponibili page gives a surname and a club, so it goes through the
tiered matcher.
"""

from __future__ import annotations

import datetime as dt
import os
import re

import requests
from bs4 import BeautifulSoup

from euroleghe_ingest.context import Context
from euroleghe_ingest.matching import CLUB_ALIASES, build_pool_entry, club_key, match_in_pool

NAME = "fc_site"
DESCRIPTION = "fantacalcio.it lists -> probable_starter, availability, penalty_hierarchy"
DEPENDS_ON: list[str] = ["rosters"]
RAW_INPUTS: list[str] = []
NETWORK = True

BASE_URL = "https://www.fantacalcio.it"
PAGES: dict[str, str] = {
    "probabili": BASE_URL + "/probabili-formazioni-serie-a",
    "indisponibili": BASE_URL + "/indisponibili-serie-a",
    "rigoristi": BASE_URL + "/rigoristi-serie-a",
}
# The site publishes the editorial pages a few weeks into the preseason; until then it says so.
NOT_PUBLISHED = "dati non ancora disponibili"
_SNAPSHOT = re.compile(r"fc_site_([a-z]+)_(\d{4}-\d{2}-\d{2})\.html$")
_PLAYER_HREF = re.compile(r"/squadre/[^/]+/[^/]+/(\d+)/(\d{4}-\d{2})")
_PERCENT = re.compile(r"(\d+)\s*%")

# The three lists the indisponibili page splits players into -> our state vocabulary.
# "Diffidati" is not unavailability (one booking away from a ban), so it becomes a flag.
LIST_STATUS: dict[str, str] = {
    "infortunati": "injured",
    "squalificati": "suspended",
    "diffidati": "booking_risk",
}

# Revealed hierarchy: how fast an older penalty stops counting, and how much a miss costs.
# PROVISIONAL VALUES. They set how much the hierarchy trusts recency, which is a modelling choice,
# so the `penalty_ev` gate owns them - sweep these two, do not treat them as established.
DECAY = 0.75            # weight of the k-th most recent penalty = DECAY**k (memory ~4 penalties)
MISS_PENALTY = 0.7      # confidence of a taker whose last attempt was missed (quarantine)


# ---------- HTTP ----------
def _fetch(url: str) -> str:
    user_agent = os.environ.get("EUROLEGHE_USER_AGENT", "FantAssistant/0.1 (+personal-use)")
    response = requests.get(url, headers={"User-Agent": user_agent}, timeout=30)
    response.raise_for_status()
    return response.text


def _atomic_write_text(path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def snapshot_path(config, page: str, date: str):
    return config.cache_dir / f"fc_site_{page}_{date}.html"


# ---------- parsing (pure, offline-testable) ----------
def parse_probable_starters(html: str) -> list[dict]:
    """team-card blocks -> one record per listed player. fc_id comes from the href, not the name."""
    soup = BeautifulSoup(html, "lxml")
    out: list[dict] = []
    for card in soup.select("div.team-card"):
        name_node = card.select_one(".team-name")
        team = name_node.get_text(strip=True) if name_node else None
        formation_node = card.select_one(".team-formation")
        formation = formation_node.get_text(strip=True) if formation_node else None
        for group in card.select("ul.player-list"):
            starters = "starters" in (group.get("class") or [])
            for item in group.select("li.player-item"):
                link = item.select_one("a.player-link")
                match = _PLAYER_HREF.search(link.get("href") or "") if link else None
                if not match:
                    continue
                percent = item.select_one(".progress-value")
                probability = None
                if percent:
                    found = _PERCENT.search(percent.get_text())
                    probability = int(found.group(1)) / 100 if found else None
                role = item.select_one(".role")
                out.append({
                    "fc_id": int(match.group(1)),
                    "season": match.group(2),
                    "team": team,
                    "formation": formation,
                    "role": (role.get("data-value") or "").upper() if role else None,
                    "starter": starters,
                    "probability": probability,
                    "status": item.get("data-status"),
                })
    return out


def parse_unavailable(html: str) -> list[dict]:
    """team-card blocks -> (team, status, player surname, note) for injured/suspended/at-risk."""
    soup = BeautifulSoup(html, "lxml")
    out: list[dict] = []
    for card in soup.select("div.team-card"):
        name_node = card.select_one(".team-name")
        team = name_node.get_text(strip=True) if name_node else None
        for label in card.select("strong.label"):
            status = LIST_STATUS.get(label.get_text(strip=True).lower())
            if not status:
                continue
            # the list follows its own header, as the next <ul> among the header's siblings
            header = label.parent
            group = header.find_next_sibling("ul") if header else None
            for item in group.select("li") if group else []:
                name_tag = item.select_one(".item-name")
                if not name_tag:
                    continue
                note = item.select_one(".item-description")
                out.append({
                    "team": team,
                    "status": status,
                    "name": name_tag.get_text(strip=True),
                    "note": note.get_text(" ", strip=True) if note else None,
                })
    return out


def is_published(html: str) -> bool:
    return NOT_PUBLISHED not in html.lower()


# ---------- persistence ----------
def upsert_probable_starters(conn, records: list[dict], date: str) -> int:
    stored = 0
    for rec in records:
        if rec["probability"] is None:
            continue
        if not conn.execute("SELECT 1 FROM players WHERE fc_id = ?", (rec["fc_id"],)).fetchone():
            # a player we have never seen (a new signing): keep the foreign key honest
            conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)",
                         (rec["fc_id"], str(rec["fc_id"])))
        conn.execute(
            "INSERT OR REPLACE INTO probable_starter(fc_id, valid_from, probability, source) "
            "VALUES (?, ?, ?, 'fc_site')",
            (rec["fc_id"], date, rec["probability"]),
        )
        stored += 1
    return stored


def _season_pools(conn, season: str):
    """(by_club_key, league_pool) for the matcher, restricted to Serie A - these pages are Serie A."""
    by_club: dict[str, list] = {}
    pool: list = []
    rows = conn.execute(
        """
        SELECT r.fc_id, p.canonical_name, cl.canonical_name
        FROM rosters r
        JOIN players p USING(fc_id)
        LEFT JOIN clubs cl ON cl.fc_club_id = r.fc_club_id
        WHERE r.season = ? AND r.league = 'serie_a'
        """,
        (season,),
    ).fetchall()
    for fc_id, our_name, our_club in rows:
        entry = build_pool_entry(fc_id, our_name)
        by_club.setdefault(club_key(CLUB_ALIASES.get(our_club, our_club)), []).append(entry)
        pool.append(entry)
    return by_club, pool


def upsert_availability(conn, records: list[dict], season: str, date: str) -> tuple[int, list[str]]:
    """injured/suspended -> availability · booking_risk -> flags. Returns (stored, unresolved)."""
    by_club, league_pool = _season_pools(conn, season)
    stored = 0
    unresolved: list[str] = []
    for rec in records:
        fc_id = None
        for pool in (by_club.get(club_key(rec["team"]), []), league_pool):
            _tier, candidates = match_in_pool(rec["name"], pool)
            if len(candidates) == 1:
                fc_id = candidates[0][0]
                break
        if fc_id is None:
            unresolved.append(f"{rec['name']} ({rec['team']})")
            continue
        if rec["status"] == "booking_risk":
            conn.execute(
                "INSERT OR REPLACE INTO flags(fc_id, season, flag, value, source) "
                "VALUES (?, ?, 'booking_risk', ?, 'fc_site')", (fc_id, season, date))
        else:
            conn.execute(
                "INSERT OR REPLACE INTO availability(fc_id, valid_from, status, source) "
                "VALUES (?, ?, ?, 'fc_site')", (fc_id, date, rec["status"]))
        stored += 1
    return stored, unresolved


# ---------- revealed penalty hierarchy (offline) ----------
def _round_dates(conn) -> dict[tuple[str, str, int], str]:
    """(season, league, real_md) -> the round's first match date, from the external per-match layer."""
    return {(season, league, real_md): date for season, league, real_md, date in conn.execute(
        "SELECT season, competition, real_md, MIN(match_date) FROM external_match_stats "
        "WHERE match_date IS NOT NULL AND real_md IS NOT NULL GROUP BY 1, 2, 3")}


def penalty_events(conn) -> list[tuple]:
    """(season, fc_club_id, date, fc_id, missed) for every penalty actually taken, in date order.

    The taker is a FACT in our own ratings (pen_scored / pen_missed), and the date comes from the
    external per-match layer via the euro<->real matchday map - the same translation the views do.
    """
    dates = _round_dates(conn)
    rows = conn.execute(
        """
        SELECT mr.season, mr.platform, mr.matchday, mr.fc_id,
               COALESCE(mr.pen_scored, 0), COALESCE(mr.pen_missed, 0),
               cl.fc_club_id, r.league,
               (SELECT m.real_md FROM matchday_map m
                WHERE m.season = mr.season AND m.league = r.league AND m.euro_md = mr.matchday)
        FROM match_ratings mr
        LEFT JOIN clubs cl ON cl.canonical_name = mr.team
        LEFT JOIN rosters r ON r.fc_id = mr.fc_id AND r.season = mr.season
        WHERE COALESCE(mr.pen_scored, 0) > 0 OR COALESCE(mr.pen_missed, 0) > 0
        """
    ).fetchall()
    events = []
    for season, platform, matchday, fc_id, scored, missed, club_id, league, mapped in rows:
        if club_id is None or league is None:
            continue
        real_md = matchday if platform == "default" else mapped
        date = dates.get((season, league, real_md)) if real_md else None
        if date is None:
            continue
        events += [(season, club_id, date, fc_id, False)] * int(scored)
        events += [(season, club_id, date, fc_id, True)] * int(missed)
    events.sort(key=lambda event: (event[0], event[1], event[2]))
    return events


def rank_takers(attempts: list[tuple[int, bool]]) -> list[tuple[int, float, str | None]]:
    """Newest-first attempts [(fc_id, missed)] -> [(fc_id, confidence, trigger_event)] ranked.

    A taker's weight decays with how many penalties ago they took theirs, so the hierarchy follows
    the club's recent behaviour instead of the season total; a taker whose LAST attempt was missed
    is quarantined (the spec's trigger), which is what lets a number two overtake.
    """
    weights: dict[int, float] = {}
    last_missed: dict[int, bool] = {}
    for index, (fc_id, missed) in enumerate(attempts):
        weights[fc_id] = weights.get(fc_id, 0.0) + DECAY ** index
        last_missed.setdefault(fc_id, missed)
    total = sum(weights.values()) or 1.0
    ranked = []
    for fc_id, weight in weights.items():
        confidence = weight / total
        trigger = None
        if last_missed.get(fc_id):
            confidence *= MISS_PENALTY
            trigger = "pen_missed"
        ranked.append((fc_id, round(confidence, 4), trigger))
    ranked.sort(key=lambda item: -item[1])
    return ranked


def derive_revealed_hierarchy(ctx: Context) -> int:
    """Rebuild penalty_hierarchy(source='revealed') from the penalties actually taken."""
    conn = ctx.require_conn()
    conn.execute("DELETE FROM penalty_hierarchy WHERE source = 'revealed'")
    events = penalty_events(conn)
    history: dict[tuple[str, int], list[tuple[int, bool]]] = {}
    written = 0
    for season, club_id, date, fc_id, missed in events:
        key = (season, club_id)
        history.setdefault(key, []).insert(0, (fc_id, missed))   # newest first
        for rank, (taker, confidence, trigger) in enumerate(rank_takers(history[key]), start=1):
            conn.execute(
                """
                INSERT OR REPLACE INTO penalty_hierarchy(
                    fc_club_id, valid_from, fc_id, rank, confidence, source, trigger_event)
                VALUES (?, ?, ?, ?, ?, 'revealed', ?)
                """,
                (club_id, date, taker, rank, confidence, trigger),
            )
            written += 1
    conn.commit()
    club_seasons = len({(season, club) for season, club, *_ in events})
    print(f"[fc_site] revealed penalty hierarchy: {len(events)} penalties across {club_seasons} "
          f"club-seasons -> {written} dated rows")
    return written


# ---------- orchestration ----------
def _latest_season(conn) -> str | None:
    row = conn.execute("SELECT MAX(season) FROM rosters").fetchone()
    return row[0] if row else None


def ingest_snapshot(ctx: Context, page: str, html: str, date: str, season: str) -> None:
    conn = ctx.require_conn()
    if not is_published(html):
        print(f"[fc_site] {page}: the site says '{NOT_PUBLISHED}' - nothing to ingest yet")
        return
    if page == "probabili":
        records = parse_probable_starters(html)
        stored = upsert_probable_starters(conn, records, date)
        teams = len({rec["team"] for rec in records if rec["team"]})
        print(f"[fc_site] probabili {date}: {stored} probabilities over {teams} teams")
    elif page == "indisponibili":
        records = parse_unavailable(html)
        stored, unresolved = upsert_availability(conn, records, season, date)
        kinds: dict[str, int] = {}
        for rec in records:
            kinds[rec["status"]] = kinds.get(rec["status"], 0) + 1
        detail = " ".join(f"{key}={value}" for key, value in sorted(kinds.items()))
        print(f"[fc_site] indisponibili {date}: {stored}/{len(records)} resolved [{detail}]")
        if unresolved:
            names = ", ".join(sorted(unresolved)[:8]).encode("ascii", "replace").decode()
            print(f"[fc_site] {len(unresolved)} names not matched: {names}")
    elif page == "rigoristi":
        # Deliberately not parsed: the page has answered "not available yet" every time since this
        # module was written, so a parser would be guesswork. The revealed hierarchy covers the need.
        print(f"[fc_site] rigoristi {date}: published now - parser not implemented "
              "(the revealed hierarchy is the primary source)")
    conn.commit()


def run(ctx: Context, *, pages=None, **kwargs) -> None:
    """Snapshot today's editorial pages, ingest them, and rebuild the revealed hierarchy."""
    conn = ctx.require_conn()
    ctx.config.cache_dir.mkdir(parents=True, exist_ok=True)
    season = _latest_season(conn)
    if season is None:
        print("[fc_site] no rosters yet - run `rosters` first")
        return
    today = dt.datetime.now(tz=dt.UTC).date().isoformat()
    for page in (pages or PAGES):
        if page not in PAGES:
            raise RuntimeError(f"Unknown page {page!r}; choose from {sorted(PAGES)}")
        if ctx.cancelled():
            break
        try:
            html = _fetch(PAGES[page])
        except requests.RequestException as exc:
            print(f"[fc_site] {page}: fetch failed ({exc}) - skipping")
            continue
        _atomic_write_text(snapshot_path(ctx.config, page, today), html)
        ingest_snapshot(ctx, page, html, today, season)
    derive_revealed_hierarchy(ctx)


def reingest_from_cache(ctx: Context) -> None:
    """Replay every dated snapshot in order, so a rebuild reconstructs the whole state history."""
    conn = ctx.require_conn()
    season = _latest_season(conn)
    snapshots = []
    for path in ctx.config.cache_dir.glob("fc_site_*.html"):
        match = _SNAPSHOT.search(path.name)
        if match:
            snapshots.append((match.group(2), match.group(1), path))   # (date, page, path)
    for date, page, path in sorted(snapshots):
        if season is None:
            break
        try:
            ingest_snapshot(ctx, page, path.read_text(encoding="utf-8"), date, season)
        except Exception as exc:   # noqa: BLE001 - a corrupt snapshot must not abort the rebuild
            print(f"[fc_site] skipping unreadable snapshot {path.name}: {exc}")
    if snapshots:
        print(f"[fc_site] replayed {len(snapshots)} dated snapshots")
    derive_revealed_hierarchy(ctx)
