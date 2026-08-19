"""transfers - Transfermarkt: club identities, coach history, transfer history.

What the engine gets out of this:
  * `coaches`            who was in charge and when -> the **new_coach** flag, i.e. a change of ideas
                         about who plays and in which role;
  * `transfers_history`  where an arrival came from and for how much - the fee is the market's own
                         statement about a player nobody in the perimeter has data for.

Identity is resolved twice over. Clubs come from each competition's own table, so the club list is
authoritative rather than guessed from a search box, and lands in club_xref(source='transfermarkt').
Players resolve through the CANONICAL KEY first - the row's own href carries Transfermarkt's player
id, and `player_xref(source='transfermarkt')` already maps it to an fc_id - with the name matched
INSIDE the club that bought or sold him (the narrowest pool there is) as the fallback. The id path
matters exactly where the name path is blind: a July arrival is not in the buying club's LISTONE
roster yet, so the pool cannot contain him however well the name matches (Molina N., fc_id 4998,
had the identity, the Roma page had the row, and the two never met - 08/08/2026). Unresolved rows
are reported, never guessed.

NOT covered here: `injuries` (Transfermarkt keeps them per player, one request each) and the
`exit_risk` flag, which needs contract-expiry data the pages read here do not carry. The CURRENT
injury state already comes from fc_site.
"""

from __future__ import annotations

import datetime as dt
import os
import random
import re
import time

from bs4 import BeautifulSoup
from curl_cffi import requests as curl_requests

from euroleghe_ingest.config import DEFAULT_SEASONS
from euroleghe_ingest.context import Context
from euroleghe_ingest.matching import (
    CLUB_ALIASES,
    build_pool_entry,
    club_key,
    match_club,
    match_in_pool,
)

NAME = "transfers"
DESCRIPTION = "Transfermarkt -> club_xref, coaches (new_coach), transfers_history"
DEPENDS_ON: list[str] = ["rosters"]
RAW_INPUTS: list[str] = []
NETWORK = True

BASE_URL = "https://www.transfermarkt.it"
# A placeholder slug works: Transfermarkt only reads the numeric id (verified).
COMPETITION_ENDPOINT = BASE_URL + "/x/startseite/wettbewerb/{code}"
COACHES_ENDPOINT = BASE_URL + "/x/mitarbeiterhistorie/verein/{tm_id}/personalie/Allenatore"
TRANSFERS_ENDPOINT = BASE_URL + "/x/transfers/verein/{tm_id}/saison_id/{year}"

# Our league keys -> Transfermarkt competition codes.
COMPETITIONS: dict[str, str] = {
    "serie_a": "IT1",
    "premier_league": "GB1",
    "la_liga": "ES1",
    "bundesliga": "L1",
    "ligue_1": "FR1",
}
SEASONS: tuple[str, ...] = DEFAULT_SEASONS   # config.py owns the list (one edit per new season)

REQUEST_DELAY = 2.5
REQUEST_JITTER = 1.5
_DATE = re.compile(r"(\d{2})/(\d{2})/(\d{4})")
_PLAYER_ID = re.compile(r"/profil/spieler/(\d+)")
_FEE = re.compile(r"([\d.,]+)\s*(mln|mila)?", re.IGNORECASE)
_CACHE_NAME = re.compile(r"transfermarkt_([a-z]+)_([a-z0-9_]+)\.html$")


# ---------- HTTP ----------
def _polite_sleep(cancel_event=None) -> None:
    delay = REQUEST_DELAY + random.uniform(0, REQUEST_JITTER)   # jitter (not crypto)
    if cancel_event is not None:
        cancel_event.wait(delay)
    else:
        time.sleep(delay)


def _client():
    """Transfermarkt sits behind the same kind of bot check as SofaScore: fingerprint required."""
    return curl_requests.Session(impersonate="chrome")


def _get_html(session, url: str, *, tries: int = 3) -> str | None:
    for attempt in range(1, tries + 1):
        try:
            response = session.get(url, timeout=40)
            if response.status_code == 200:
                return response.text
            if response.status_code not in (429, 500, 502, 503, 504) or attempt == tries:
                return None
        except Exception:   # curl_cffi raises its own error hierarchy
            if attempt == tries:
                raise
        time.sleep(2.0 * attempt)
    return None


def _atomic_write_text(path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def _iso(value: str | None) -> str | None:
    match = _DATE.search(value or "")
    return f"{match.group(3)}-{match.group(2)}-{match.group(1)}" if match else None


def parse_fee(text: str | None) -> float | None:
    """'23,00 mln EUR' -> 23000000 · '300 mila' -> 300000 · loan/free/unknown -> None."""
    if not text:
        return None
    lowered = text.lower()
    if any(word in lowered for word in ("prestito", "svincolat", "sconosciut", "?")):
        return None
    match = _FEE.search(lowered.replace("€", ""))
    if not match:
        return None
    try:
        amount = float(match.group(1).replace(".", "").replace(",", "."))
    except ValueError:
        return None
    scale = {"mln": 1_000_000, "mila": 1_000}.get((match.group(2) or "").lower(), 1)
    return amount * scale


# ---------- parsing (pure, offline-testable) ----------
def parse_competition_clubs(html: str) -> list[tuple[str, str]]:
    """The competition table -> [(club name, transfermarkt id)], authoritative for that league."""
    soup = BeautifulSoup(html, "lxml")
    table = soup.select_one("table.items")
    found: dict[str, str] = {}
    for link in table.select('a[href*="/startseite/verein/"]') if table else []:
        name = (link.get("title") or link.get_text(strip=True) or "").strip()
        href = link.get("href") or ""
        if name and "/verein/" in href:
            found.setdefault(name, href.split("/verein/")[1].split("/")[0])
    return sorted(found.items())


def parse_coach_history(html: str) -> list[dict]:
    """The coach-history table -> [{name, valid_from, valid_to}].

    Each row nests a card, so the date of birth turns up more than once (in the name cell and in its
    own). The DOB is simply the EARLIEST date in the row - a coach is born before he is appointed -
    so dropping it leaves the spell, in document order.
    """
    soup = BeautifulSoup(html, "lxml")
    table = soup.select_one("table.items")
    out: list[dict] = []
    for row in table.select("tbody > tr") if table else []:
        cells = [cell.get_text(" ", strip=True) for cell in row.select("td")]
        if len(cells) < 6:
            continue
        # each row links the coach TWICE: first the photo (no text), then the name. Take the first
        # link that actually carries text, and fall back to its title attribute.
        name = None
        for link in row.select('a[href*="/profil/trainer/"]'):
            name = link.get_text(strip=True) or (link.get("title") or "").strip() or None
            if name:
                break
        dates = list(dict.fromkeys(iso for cell in cells if (iso := _iso(cell))))
        spell = [date for date in dates if date != min(dates)] if len(dates) > 1 else []
        if not name or not spell:
            continue
        out.append({"name": name, "valid_from": spell[0],
                    "valid_to": spell[1] if len(spell) > 1 else None})
    return out


def _counterpart(club_link) -> str | None:
    """The other club's name, un-doubled: the page's own `title` for a man leaving for NO club reads
    "svincolatosvincolato" (id 515, and the nested img says it once), which then travelled all the way to
    the sheet. An exactly repeated string is collapsed; anything else is taken as it is."""
    if not club_link:
        return None
    name = (club_link.get("title") or "").strip()
    half = len(name) // 2
    if name and len(name) % 2 == 0 and name[:half] == name[half:]:
        return name[:half]
    return name or None


def parse_club_transfers(html: str) -> list[dict]:
    """The club-transfers page -> [{direction, name, tm_id, counterpart, fee}].

    The page shows arrivals and departures as separate tables; their headers name the counterpart
    ("Venditore" for who sold to us, "Acquirente"/"Nuova squadra" for who bought from us).
    `tm_id` is Transfermarkt's own player id, from the same href the name comes from: the canonical
    key, which the parser used to throw away while keeping only the string.
    """
    soup = BeautifulSoup(html, "lxml")
    out: list[dict] = []
    for table in soup.select("table.items"):
        headers = " ".join(th.get_text(" ", strip=True).lower() for th in table.select("thead th"))
        if "venditore" in headers:
            direction = "in"
        elif "acquirente" in headers or "nuova squadra" in headers:
            direction = "out"
        else:
            continue
        for row in table.select("tbody > tr"):
            player_link = row.select_one('a[href*="/profil/spieler/"]')
            if not player_link:
                continue
            cells = [cell.get_text(" ", strip=True) for cell in row.select("td")]
            club_link = row.select_one('a[href*="/startseite/verein/"]')
            tm_id = _PLAYER_ID.search(player_link.get("href") or "")
            out.append({
                "direction": direction,
                "name": player_link.get_text(strip=True),
                "tm_id": tm_id.group(1) if tm_id else None,
                "counterpart": _counterpart(club_link),
                "fee": parse_fee(cells[-1] if cells else None),
            })
    return out


# ---------- persistence ----------
def resolve_clubs(conn, league: str, clubs: list[tuple[str, str]]) -> tuple[int, list[str]]:
    """Match Transfermarkt clubs to ours by normalized name -> club_xref. Returns (matched, misses).

    Both keys are indexed, ours and the aliased one: transfermarkt.IT uses the same Italian exonyms
    we do ("Bayern Monaco", "Lipsia"), so translating through CLUB_ALIASES - which targets the
    English/local spellings SofaScore uses - would MISS exactly the clubs it was written for.
    """
    ours: dict[str, int] = {}
    for club_id, name in conn.execute(
            "SELECT fc_club_id, canonical_name FROM clubs WHERE league = ?", (league,)):
        for candidate in (name, CLUB_ALIASES.get(name, name)):
            ours.setdefault(club_key(candidate), club_id)
    matched = 0
    misses: list[str] = []
    for name, tm_id in clubs:
        # `match_club`, not a plain lookup: Transfermarkt writes the OFFICIAL name ("ACF Fiorentina",
        # "LOSC Lilla", "TSG 1899 Hoffenheim") and a listone never does. An unmatched club here is not
        # a cosmetic miss - it is a club with no coach spells, no fees and no injury ids.
        resolved = match_club(name, ours)
        club_id = resolved[1] if resolved else None
        if club_id is None:
            misses.append(name)
            continue
        conn.execute(
            "INSERT OR REPLACE INTO club_xref(fc_club_id, source, source_id) "
            "VALUES (?, 'transfermarkt', ?)", (club_id, tm_id))
        matched += 1
    return matched, misses


def upsert_coaches(conn, fc_club_id: int, spells: list[dict]) -> int:
    for spell in spells:
        conn.execute(
            "INSERT OR REPLACE INTO coaches(fc_club_id, coach_name, valid_from, valid_to) "
            "VALUES (?, ?, ?, ?)",
            (fc_club_id, spell["name"], spell["valid_from"], spell["valid_to"]))
    return len(spells)


def upsert_transfers(conn, fc_club_id: int, league: str, season: str, records: list[dict],
                     observed_on: str | None = None) -> tuple[int, list[str]]:
    """transfers_history for one club-season.

    The date is the season's window, not the exact day: the club page does not carry one and
    (fc_id, date) is the key. Documented approximation - good enough for "where from, for how much",
    which is what the arrival pricing asks. `observed_on` (the cache file's own download day) lands
    in `first_seen`, kept at its minimum across re-parses: the one date that can tell a late-July
    operation from an early one.

    Resolution goes CANONICAL KEY first (the row's Transfermarkt id against `player_xref`), the name
    inside the club's roster pool second. The pool is blind exactly on the men this table exists
    for: a July arrival is not in the buying club's listone roster yet.
    """
    date = f"{season.split('-')[0]}-07-01"
    row = conn.execute("SELECT canonical_name FROM clubs WHERE fc_club_id = ?",
                       (fc_club_id,)).fetchone()
    club_name = row[0] if row else None
    # The counterpart resolves to OUR canonical name where the club is in the perimeter, with the
    # same matcher `resolve_clubs` uses. A deal between two perimeter clubs is on BOTH pages, each
    # spelling the other its own way ("SS Lazio" / "Lazio", "1.FC Union Berlino" / "Union Berlino"),
    # and a key holding the raw strings kept both rows - one departure read twice is one departure
    # flag too many. A club outside the perimeter keeps the source's spelling: an identity we do not
    # have is not invented.
    ours: dict[str, str] = {}
    for (name,) in conn.execute("SELECT canonical_name FROM clubs WHERE canonical_name IS NOT NULL"):
        for candidate in (name, CLUB_ALIASES.get(name, name)):
            ours.setdefault(club_key(candidate), name)

    def counterpart_name(spelling: str | None) -> str | None:
        resolved = match_club(spelling, ours) if spelling else None
        return resolved[1] if resolved else spelling
    def club_pool(for_season: str | None):
        if not for_season:
            return []
        return [build_pool_entry(fc_id, name) for fc_id, name in conn.execute(
            "SELECT r.fc_id, p.canonical_name FROM rosters r JOIN players p USING(fc_id) "
            "WHERE r.season = ? AND r.fc_club_id = ?", (for_season, fc_club_id))]

    previous = conn.execute("SELECT MAX(season) FROM rosters WHERE season < ?", (season,)).fetchone()[0]
    # An ARRIVAL is in this season's squad; a DEPARTURE is in the PREVIOUS one - he already left.
    pools = {"in": [club_pool(season), club_pool(previous)],
             "out": [club_pool(previous), club_pool(season)]}
    stored = 0
    unresolved: list[str] = []
    for rec in records:
        fc_id = None
        if rec.get("tm_id"):
            row = conn.execute(
                "SELECT fc_id FROM player_xref WHERE source = 'transfermarkt' AND source_id = ?",
                (rec["tm_id"],)).fetchone()
            fc_id = row[0] if row else None
        if fc_id is None:
            for pool in pools[rec["direction"]]:
                _tier, candidates = match_in_pool(rec["name"], pool)
                if len(candidates) == 1:
                    fc_id = candidates[0][0]
                    break
        if fc_id is None:
            unresolved.append(rec["name"])
            continue
        incoming = rec["direction"] == "in"
        counterpart = counterpart_name(rec["counterpart"])
        conn.execute(
            """
            INSERT INTO transfers_history(
                fc_id, date, from_club, to_club, from_league, to_league, fee, first_seen)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(fc_id, date, from_club, to_club) DO UPDATE SET
                from_league = COALESCE(excluded.from_league, from_league),
                to_league   = COALESCE(excluded.to_league, to_league),
                fee         = COALESCE(excluded.fee, fee),
                first_seen  = CASE WHEN excluded.first_seen IS NOT NULL
                                    AND (first_seen IS NULL OR excluded.first_seen < first_seen)
                                   THEN excluded.first_seen ELSE first_seen END
            """,
            (fc_id, date,
             counterpart if incoming else club_name,
             club_name if incoming else counterpart,
             None if incoming else league, league if incoming else None,
             rec["fee"], observed_on),
        )
        stored += 1
    return stored, unresolved


def derive_new_coach(conn) -> int:
    """flags(new_coach) for every player of a club that changed coach since the previous season.

    Read at the season's start (1 August): who was in charge then, versus a year earlier. A
    mid-season sacking therefore surfaces on the season AFTER it, which is when its effect on
    selection is actually priceable at an auction.
    """
    conn.execute("DELETE FROM flags WHERE flag = 'new_coach' AND source = 'transfermarkt'")

    def coach_on(club_id: int, date: str) -> str | None:
        row = conn.execute(
            "SELECT coach_name FROM coaches WHERE fc_club_id = ? AND valid_from <= ? "
            "AND (valid_to IS NULL OR valid_to >= ?) ORDER BY valid_from DESC LIMIT 1",
            (club_id, date, date)).fetchone()
        return row[0] if row else None

    written = 0
    for season in [row[0] for row in conn.execute(
            "SELECT DISTINCT season FROM rosters ORDER BY season")]:
        year = int(season.split("-")[0])
        clubs = [row[0] for row in conn.execute(
            "SELECT DISTINCT fc_club_id FROM rosters WHERE season = ? AND fc_club_id IS NOT NULL",
            (season,))]
        for club_id in clubs:
            now = coach_on(club_id, f"{year}-08-01")
            before = coach_on(club_id, f"{year - 1}-08-01")
            if not now or not before or now == before:
                continue
            for (fc_id,) in conn.execute(
                    "SELECT fc_id FROM rosters WHERE season = ? AND fc_club_id = ?",
                    (season, club_id)):
                conn.execute(
                    "INSERT OR REPLACE INTO flags(fc_id, season, flag, value, source) "
                    "VALUES (?, ?, 'new_coach', ?, 'transfermarkt')", (fc_id, season, now))
                written += 1
    return written


# ---------- orchestration ----------
def _cache(config, kind: str, key: str):
    return config.cache_dir / f"transfermarkt_{kind}_{key}.html"


def _perimeter_ids(conn) -> list[tuple[int, str]]:
    return [(club_id, tm_id) for club_id, tm_id in conn.execute(
        "SELECT fc_club_id, source_id FROM club_xref WHERE source = 'transfermarkt' "
        "ORDER BY fc_club_id")]


def run(ctx: Context, *, leagues=None, seasons=None, refresh: bool = False, **kwargs) -> None:
    """Cache the competition, coach-history and club-transfer pages, then ingest them offline.

    Two passes on purpose: the club ids have to exist before we know WHICH clubs to walk, so the
    competition pages are downloaded and resolved first.
    """
    conn = ctx.require_conn()
    if isinstance(leagues, str):
        leagues = [leagues]
    if isinstance(seasons, str):
        seasons = [seasons]
    leagues = tuple(leagues) if leagues else tuple(COMPETITIONS)
    seasons = tuple(seasons) if seasons else SEASONS
    unknown = [league for league in leagues if league not in COMPETITIONS]
    if unknown:
        raise RuntimeError(f"Unknown league(s) {unknown}; choose from {sorted(COMPETITIONS)}")
    ctx.config.cache_dir.mkdir(parents=True, exist_ok=True)

    session = _client()
    try:
        for league in leagues:
            if ctx.cancelled():
                break
            path = _cache(ctx.config, "competition", league)
            if path.exists() and not refresh:
                continue
            _polite_sleep(ctx.cancel_event)
            html = _get_html(session, COMPETITION_ENDPOINT.format(code=COMPETITIONS[league]))
            if html:
                _atomic_write_text(path, html)
                print(f"[transfers] {league}: competition page cached")
        # resolve the clubs now, so the per-club walk knows where to go
        for path in sorted(ctx.config.cache_dir.glob("transfermarkt_competition_*.html")):
            league = _CACHE_NAME.search(path.name).group(2)
            resolve_clubs(conn, league, parse_competition_clubs(path.read_text(encoding="utf-8")))
        conn.commit()

        clubs = _perimeter_ids(conn)
        print(f"[transfers] {len(clubs)} perimeter clubs to walk "
              f"({1 + len(seasons)} pages each) - this is the slow part")
        for index, (_club_id, tm_id) in enumerate(clubs, start=1):
            if ctx.cancelled():
                break
            if index % 5 == 0 or index == len(clubs):
                print(f"[transfers] club {index}/{len(clubs)}")
            path = _cache(ctx.config, "coaches", str(tm_id))
            if not path.exists() or refresh:
                _polite_sleep(ctx.cancel_event)
                html = _get_html(session, COACHES_ENDPOINT.format(tm_id=tm_id))
                if html:
                    _atomic_write_text(path, html)
            for season in seasons:
                if ctx.cancelled():
                    break
                year = season.split("-")[0]
                path = _cache(ctx.config, "transfers", f"{tm_id}_{year}")
                if path.exists() and not refresh:
                    continue
                _polite_sleep(ctx.cancel_event)
                html = _get_html(session, TRANSFERS_ENDPOINT.format(tm_id=tm_id, year=year))
                if html:
                    _atomic_write_text(path, html)
    except KeyboardInterrupt:
        print("[transfers] interrupted - already-downloaded pages are cached")
    finally:
        session.close()
    reingest_from_cache(ctx)


def reingest_from_cache(ctx: Context) -> None:
    """Rebuild club_xref / coaches / transfers_history offline from the cached pages."""
    conn = ctx.require_conn()
    for path in sorted(ctx.config.cache_dir.glob("transfermarkt_competition_*.html")):
        league = _CACHE_NAME.search(path.name).group(2)
        try:
            matched, misses = resolve_clubs(
                conn, league, parse_competition_clubs(path.read_text(encoding="utf-8")))
        except Exception as exc:   # noqa: BLE001 - a corrupt page must not abort the rebuild
            print(f"[transfers] skipping unreadable {path.name}: {exc}")
            continue
        note = f" · {len(misses)} outside our perimeter" if misses else ""
        print(f"[transfers] {league}: {matched} clubs mapped{note}")
    conn.commit()

    by_tm = {tm_id: club_id for club_id, tm_id in _perimeter_ids(conn)}
    leagues = dict(conn.execute("SELECT fc_club_id, league FROM clubs").fetchall())

    spells = 0
    for path in sorted(ctx.config.cache_dir.glob("transfermarkt_coaches_*.html")):
        club_id = by_tm.get(_CACHE_NAME.search(path.name).group(2))
        if club_id is None:
            continue
        try:
            spells += upsert_coaches(conn, club_id,
                                     parse_coach_history(path.read_text(encoding="utf-8")))
        except Exception as exc:   # noqa: BLE001
            print(f"[transfers] skipping unreadable {path.name}: {exc}")
    conn.commit()

    # The table is DERIVED from these cached pages and nothing else, so the re-ingest starts clean:
    # that is what purges rows an older resolution rule wrote - the same deal from both clubs' pages
    # under two spellings, or a name-match the canonical id now contradicts - instead of accreting
    # them forever. `first_seen` survives because it re-derives from the cache files' own mtimes.
    conn.execute("DELETE FROM transfers_history")
    stored = 0
    unresolved: list[str] = []
    for path in sorted(ctx.config.cache_dir.glob("transfermarkt_transfers_*.html")):
        tm_id, _, year = _CACHE_NAME.search(path.name).group(2).rpartition("_")
        club_id = by_tm.get(tm_id)
        if club_id is None or not year.isdigit():
            continue
        season = f"{year}-{(int(year) + 1) % 100:02d}"
        # the cache file's own download day IS the observation date of every row it carries
        observed = dt.datetime.fromtimestamp(path.stat().st_mtime, tz=dt.UTC).date().isoformat()
        try:
            count, misses = upsert_transfers(
                conn, club_id, leagues.get(club_id, ""), season,
                parse_club_transfers(path.read_text(encoding="utf-8")), observed_on=observed)
        except Exception as exc:   # noqa: BLE001
            print(f"[transfers] skipping unreadable {path.name}: {exc}")
            continue
        stored += count
        unresolved += misses
    conn.commit()

    flagged = derive_new_coach(conn)
    conn.commit()
    print(f"[transfers] {spells} coach spells · {stored} transfers "
          f"({len(unresolved)} names unresolved) · {flagged} new_coach flags")


def refresh_current_season(ctx: Context, season: str) -> tuple[str | None, dict]:
    """Re-read the TARGET season's transfer page of every perimeter club, at most once a day.

    A CACHE OVER A FACT THAT CHANGES NEEDS AN EXPIRY, and this one had none: the page is keyed
    `transfermarkt_transfers_{tm_id}_{year}.html` and `run` skips it when the file exists, so the summer
    market was frozen at whatever day the pages were first pulled. Measured 18/08/2026:
    `transfers_history` held nothing newer than **2026-07-01** and the pages dated from 27-29/07, in the
    middle of the window it is there to describe - the same defect as the friendlies layer (v9.47) and
    the same cure, an expiry in the caller's hands.

    The expiry is ONE DAY and it is read off the file's own mtime, so three sheets built the same
    afternoon pay for it once. Overwriting is safe here, unlike a squad payload: a season's transfer page
    is CUMULATIVE, so the newer copy contains everything the older one did.

    Only the target season, and only the perimeter: the older seasons are finished facts and re-reading
    them would be 59 clubs x 12 seasons for nothing.
    """
    conn = ctx.require_conn()
    counts = {"clubs": 0, "fetched": 0, "stale": 0}
    today = dt.datetime.now(tz=dt.UTC).date().isoformat()
    year = season.split("-")[0]
    clubs = _perimeter_ids(conn)
    counts["clubs"] = len(clubs)
    todo = []
    for _club_id, tm_id in clubs:
        path = _cache(ctx.config, "transfers", f"{tm_id}_{year}")
        if not path.exists() or dt.datetime.fromtimestamp(
                path.stat().st_mtime, tz=dt.UTC).date().isoformat() < today:
            todo.append((tm_id, path))
    counts["stale"] = len(todo)
    if not todo:
        return None, counts                   # already read today: nothing to pay for
    print(f"[transfers] {season}: {len(todo)} of {len(clubs)} club pages older than today - re-reading")
    session = _client()
    try:
        for index, (tm_id, path) in enumerate(todo, start=1):
            if ctx.cancelled():
                raise KeyboardInterrupt
            _polite_sleep(ctx.cancel_event)
            html = _get_html(session, TRANSFERS_ENDPOINT.format(tm_id=tm_id, year=year))
            if html:
                _atomic_write_text(path, html)
                counts["fetched"] += 1
            if index % 10 == 0 or index == len(todo):
                print(f"[transfers] {index}/{len(todo)} club pages")
    except KeyboardInterrupt:
        print("[transfers] interrupted - already-downloaded pages are cached")
    except Exception as exc:   # noqa: BLE001 - the network is not allowed to cost a sheet
        return f"transfer refresh failed ({exc}) - the sheet uses the transfers already in the DB", counts
    finally:
        session.close()
    if not counts["fetched"]:
        # A source that refuses is a measurement: saying "0 fetched" as though it were "nothing to do"
        # is what hid the live-squad no-op for three days.
        return (f"the transfer pages did not answer ({len(todo)} clubs asked): the market that built "
                f"these squads is as old as the last run that reached them"), counts
    reingest_from_cache(ctx)
    return None, counts
