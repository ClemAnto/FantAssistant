"""injuries - Transfermarkt: the injury HISTORY per player, plus the contract-expiry snapshot.

Why this module is separate from `transfers` (which reads the same site): everything there is a
club-level page, one request per club-season. Injuries are a per-PLAYER page, so the cost is a
different order of magnitude (thousands of requests, hours, resumable) and it earns its own command.

What the engine gets out of this:
  * `injuries`                 dated absences with the matches actually missed - the missing half of
                               the presences module (spec: half the holes in the defenders' top-10
                               are injuries), and the input the "long-term absent team-mate" refinement
                               of the forward-pairs work is blocked on;
  * `flags(contract_until)`    the FACT: when the player's contract expires;
  * `flags(exit_risk)`         the JUDGEMENT derived from it, with a PROVISIONAL threshold.

Three pages, three costs:
  kader/verein/{tm}/saison_id/{year}   the squad of a club-season -> Transfermarkt player ids
                                      (`player_xref`), ~one request per club-season;
  kader/verein/{tm}                    the CURRENT squad, which is the only view that carries the
                                      contract-expiry column;
  verletzungen/spieler/{pid}           the injury history, 15 rows a page, `/page/{n}` for the rest.

⚠️ CONTRACT EXPIRY IS A SNAPSHOT OF TODAY, AND CANNOT BE BACKFILLED. Verified against the source:
the per-season squad page does NOT carry the contract column - only the current one does. So
`exit_risk` is usable for the auction that is coming and is NOT measurable on a past window; a rule
reading it cannot be gated on T1/T2 at all. The dated cache file is the time series, exactly like
the fc_site snapshots, and it has to accumulate from now on.

The injury rows are dated facts, so they carry no such caveat: one page read today gives the whole
career, past windows included.

Identity: Transfermarkt gives a name inside a club, so it goes through the same narrowest-pool
matcher `transfers` uses. Ids are ALSO harvested offline from the club-transfer pages already in the
cache, which costs nothing and covers the players who moved.
"""

from __future__ import annotations

import datetime as dt
import os
import random
import re
import time

from bs4 import BeautifulSoup
from curl_cffi import requests as curl_requests

from euroleghe_ingest.context import Context
from euroleghe_ingest.matching import build_pool_entry, match_in_pool
from euroleghe_ingest.modules import transfers

NAME = "injuries"
DESCRIPTION = "Transfermarkt -> injuries (+ contract_until / exit_risk flags)"
DEPENDS_ON: list[str] = ["rosters", "transfers"]
RAW_INPUTS: list[str] = []
NETWORK = True

BASE_URL = "https://www.transfermarkt.it"
# A placeholder slug works: Transfermarkt only reads the numeric id (verified, same as `transfers`).
SQUAD_ENDPOINT = BASE_URL + "/x/kader/verein/{tm_id}/saison_id/{year}/plus/1"
CURRENT_SQUAD_ENDPOINT = BASE_URL + "/x/kader/verein/{tm_id}/plus/1"
INJURIES_ENDPOINT = BASE_URL + "/x/verletzungen/spieler/{pid}"
INJURIES_PAGE_ENDPOINT = BASE_URL + "/x/verletzungen/spieler/{pid}/page/{page}"

REQUEST_DELAY = 2.5
REQUEST_JITTER = 1.5
MAX_INJURY_PAGES = 8          # 15 rows a page; 8 pages = a 20-year career, and it bounds a bad parse

# PROVISIONAL (spec: a constant that exists because a module needed a number). How close an expiring
# contract has to be before the player counts as an exit risk. It is a MODEL choice, so the gate owns
# it - and `contract_until` stores the raw date, so the threshold can be re-swept without re-scraping.
EXIT_RISK_MONTHS = 12

_DATE = re.compile(r"(\d{2})/(\d{2})/(\d{4})")
_DAYS = re.compile(r"(\d+)")
_PAGE_HREF = re.compile(r"/verletzungen/spieler/\d+/page/(\d+)")
_KADER_CACHE = re.compile(r"transfermarkt_kader_(\d+)_(\d{4})\.html$")
_SQUAD_CACHE = re.compile(r"transfermarkt_squad_(\d+)_(\d{4}-\d{2}-\d{2})\.html$")
_INJURY_CACHE = re.compile(r"transfermarkt_injuries_(\d+)(?:_p(\d+))?\.html$")

# The source's own Italian labels -> a small vocabulary. Ordered: the first key found wins, so
# "lesione del legamento crociato" is a knee injury and not a generic muscle one.
KIND_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("knee", ("crociato", "ginocchio", "menisco", "legamento collaterale", "rotula")),
    ("ankle", ("caviglia", "malleolo", "achille", "tendine d'achille")),
    ("groin", ("inguine", "pubalgia", "adduttor")),
    ("muscular", ("muscolar", "flessor", "polpaccio", "coscia", "bicipite femorale", "stiramento",
                  "strappo", "contrattura", "lesione")),
    ("back", ("schiena", "lombare", "ernia", "vertebra", "disco")),
    ("head", ("testa", "commozione", "cranio", "naso", "zigomo", "occhio")),
    ("upper_body", ("spalla", "braccio", "clavicola", "mano", "polso", "dito", "costola")),
    ("illness", ("influenza", "virus", "malattia", "covid", "febbre", "mononucleosi", "angina",
                 "gastro", "problemi cardiaci")),
    ("fracture", ("frattura", "rottura del", "tibia", "perone", "metatarso")),
    ("foot_leg", ("piede", "gamba", "anca", "tallone")),
    ("conditioning", ("ritardo di condizione", "condizione", "preparazione")),
    ("surgery", ("operazione", "intervento")),
    ("suspension", ("squalifica",)),
)


# ---------- HTTP ----------
def _polite_sleep(cancel_event=None) -> None:
    delay = REQUEST_DELAY + random.uniform(0, REQUEST_JITTER)   # jitter (not crypto)
    if cancel_event is not None:
        cancel_event.wait(delay)
    else:
        time.sleep(delay)


def _client():
    """Transfermarkt checks the TLS fingerprint: only an impersonating client gets a 200."""
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


def _int(value: str | None) -> int | None:
    match = _DAYS.search((value or "").replace(".", ""))
    return int(match.group(1)) if match else None


def classify_injury(label: str | None) -> str:
    """The source's label -> our vocabulary. 'other' when nothing matches, never a guess."""
    lowered = (label or "").lower()
    for kind, needles in KIND_RULES:
        if any(needle in lowered for needle in needles):
            return kind
    return "other"


# ---------- parsing (pure, offline-testable) ----------
def parse_injury_history(html: str) -> list[dict]:
    """The injury-history table -> [{season, detail, kind, start_date, end_date, days_out, ...}].

    The page carries TWO tables: the history (6 columns: season, injury, from, to, days, matches)
    and a per-season summary (4 columns). They are told apart by their own header, not by position:
    a layout change must drop the parse, not silently ingest the summary as if it were history.
    """
    soup = BeautifulSoup(html, "lxml")
    out: list[dict] = []
    for table in soup.select("table.items"):
        headers = [th.get_text(" ", strip=True).lower() for th in table.select("thead th")]
        if "da" not in headers or "fino al" not in headers:
            continue
        index = {name: position for position, name in enumerate(headers)}
        for row in table.select("tbody > tr"):
            cells = [cell.get_text(" ", strip=True) for cell in row.find_all("td", recursive=False)]
            if len(cells) < len(headers):
                continue
            start = _iso(cells[index["da"]])
            if not start:
                continue
            label = cells[index.get("infortunio", 1)]
            out.append({
                "season": _season(cells[index.get("stagione", 0)]),
                "detail": label,
                "kind": classify_injury(label),
                "start_date": start,
                "end_date": _iso(cells[index["fino al"]]),
                "days_out": _int(cells[index.get("giorni", 4)]),
                "matches_missed": _int(cells[index.get("partite perse", 5)]),
            })
    return out


def _season(label: str | None) -> str | None:
    """'24/25' -> '2024-25'. The century comes from the two digits: 90/91 is 1990-91."""
    match = re.fullmatch(r"(\d{2})/(\d{2})", (label or "").strip())
    if not match:
        return None
    start = int(match.group(1))
    century = 2000 if start < 90 else 1900
    return f"{century + start}-{match.group(2)}"


def parse_max_page(html: str) -> int:
    """Highest page number the pager links to (1 when the history fits on one page)."""
    pages = [int(match.group(1)) for match in
             (_PAGE_HREF.search(link.get("href") or "")
              for link in BeautifulSoup(html, "lxml").select('a[href*="/page/"]')) if match]
    return min(max(pages, default=1), MAX_INJURY_PAGES)


def parse_squad(html: str) -> list[dict]:
    """A squad page -> [{tm_id, name, contract_until, market_value}].

    Alignment note: `row.select('td')` returns the tds of the NESTED player card too, so the cells
    stop matching the header. `find_all(recursive=False)` keeps the direct children only, which does
    line up with the header - and that is what makes reading a column BY NAME safe here.

    The MARKET VALUE comes off the same page, and its date is the thing that makes it usable: the
    squad page of a past season carries that season's value, not today's (verified on a club with
    eleven seasons in cache - the same player reads 225 / 175 / 150 / 100 / 200 mila across them). So
    it is a SEASON fact and it is stored as one, which is what lets the gate read the value of the
    input season to predict the target one and never the other way round.
    """
    soup = BeautifulSoup(html, "lxml")
    table = soup.select_one("table.items")
    if not table:
        return []
    headers = [th.get_text(" ", strip=True).lower() for th in table.select("thead th")]
    contract_at = headers.index("contratto") if "contratto" in headers else None
    value_at = next((index for index, head in enumerate(headers) if "valore di mercato" in head), None)
    out: list[dict] = []
    for row in table.select("tbody > tr"):
        link = row.select_one('a[href*="/profil/spieler/"]')
        if not link:
            continue
        tm_id = (link.get("href") or "").split("/spieler/")[-1].split("/")[0]
        if not tm_id.isdigit():
            continue
        cells = [cell.get_text(" ", strip=True) for cell in row.find_all("td", recursive=False)]
        contract = None
        if contract_at is not None and contract_at < len(cells):
            contract = _iso(cells[contract_at])
        out.append({
            "tm_id": tm_id,
            "name": link.get_text(strip=True) or (link.get("title") or "").strip(),
            "contract_until": contract,
            "market_value": (transfers.parse_fee(cells[value_at])
                             if value_at is not None and value_at < len(cells) else None),
        })
    return out


# ---------- persistence ----------
def _club_pool(conn, fc_club_id: int, season: str) -> list:
    return [build_pool_entry(fc_id, name) for fc_id, name in conn.execute(
        "SELECT r.fc_id, p.canonical_name FROM rosters r JOIN players p USING(fc_id) "
        "WHERE r.season = ? AND r.fc_club_id = ?", (season, fc_club_id))]


def resolve_squad(conn, fc_club_id: int, season: str, records: list[dict],
                  *, also_previous: bool = False) -> tuple[int, list[str]]:
    """Match a Transfermarkt squad to our roster of the same club-season -> player_xref.

    The club pool is the narrowest there is, which is what keeps namesakes out. `also_previous`
    adds the club's PREVIOUS-season roster as a second pass: a transfer page lists departures too,
    and a man who left is in last season's squad, not this one.
    """
    pools = [_club_pool(conn, fc_club_id, season)]
    if also_previous:
        previous = conn.execute("SELECT MAX(season) FROM rosters WHERE season < ?",
                                (season,)).fetchone()[0]
        if previous:
            pools.append(_club_pool(conn, fc_club_id, previous))
    matched = 0
    unresolved: list[str] = []
    for rec in records:
        candidates: list = []
        for pool in pools:
            _tier, candidates = match_in_pool(rec["name"], pool)
            if len(candidates) == 1:
                break
        if len(candidates) != 1:
            unresolved.append(rec["name"])
            continue
        conn.execute(
            "INSERT OR REPLACE INTO player_xref(fc_id, source, source_id) "
            "VALUES (?, 'transfermarkt', ?)", (candidates[0][0], rec["tm_id"]))
        # ...and the MARKET VALUE of that season, which travels on the same row and costs nothing here.
        # Stored per season because that is what it is (see `market_values` in the schema): the value on
        # a past season's squad page is that season's, so a window can read the INPUT season's value to
        # predict the target one. It is what §7-quater was missing - `transfers_history.fee` is NULL for
        # a free transfer, so the fee proxy said "no investment" about Modric and De Bruyne.
        if rec.get("market_value") is not None:
            conn.execute(
                "INSERT OR REPLACE INTO market_values(fc_id, season, source, value) "
                "VALUES (?, ?, 'transfermarkt', ?)",
                (candidates[0][0], season, rec["market_value"]))
        matched += 1
    return matched, unresolved


def upsert_injuries(conn, fc_id: int, records: list[dict]) -> int:
    for rec in records:
        conn.execute(
            """
            INSERT OR REPLACE INTO injuries(
                fc_id, start_date, end_date, kind, days_out, matches_missed, detail, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'transfermarkt')
            """,
            (fc_id, rec["start_date"], rec["end_date"], rec["kind"], rec["days_out"],
             rec["matches_missed"], rec["detail"]),
        )
    return len(records)


def upsert_contracts(conn, records: list[dict], season: str, snapshot_date: str) -> int:
    """contract_until (fact) + exit_risk (judgement) for the players we could identify.

    Both go on the LATEST season, because that is what the snapshot describes: back-dating today's
    contract to a past season would be look-ahead of the plainest kind.
    """
    by_tm = {source_id: fc_id for source_id, fc_id in conn.execute(
        "SELECT source_id, fc_id FROM player_xref WHERE source = 'transfermarkt'")}
    horizon = _add_months(snapshot_date, EXIT_RISK_MONTHS)
    written = 0
    for rec in records:
        fc_id = by_tm.get(rec["tm_id"])
        if fc_id is None or not rec["contract_until"]:
            continue
        conn.execute(
            "INSERT OR REPLACE INTO flags(fc_id, season, flag, value, source) "
            "VALUES (?, ?, 'contract_until', ?, 'transfermarkt')",
            (fc_id, season, rec["contract_until"]))
        if rec["contract_until"] <= horizon:
            conn.execute(
                "INSERT OR REPLACE INTO flags(fc_id, season, flag, value, source) "
                "VALUES (?, ?, 'exit_risk', ?, 'transfermarkt')",
                (fc_id, season, rec["contract_until"]))
        written += 1
    return written


def _add_months(date: str, months: int) -> str:
    year, month, day = (int(part) for part in date.split("-"))
    month += months
    year += (month - 1) // 12
    month = (month - 1) % 12 + 1
    return f"{year:04d}-{month:02d}-{min(day, 28):02d}"


# ---------- orchestration ----------
def _cache(config, kind: str, key: str):
    return config.cache_dir / f"transfermarkt_{kind}_{key}.html"


def _perimeter_clubs(conn) -> list[tuple[int, str]]:
    return [(club_id, tm_id) for club_id, tm_id in conn.execute(
        "SELECT fc_club_id, source_id FROM club_xref WHERE source = 'transfermarkt' "
        "ORDER BY fc_club_id")]


def _harvest_ids_from_transfer_cache(ctx: Context) -> int:
    """Free ids: the club-transfer pages `transfers` already cached name every player they list.

    Costs nothing (offline) and covers precisely the players who moved, which is a large share of
    the perimeter - so the squad walk below has less to resolve.
    """
    conn = ctx.require_conn()
    from euroleghe_ingest.modules.transfers import _CACHE_NAME

    by_tm = {tm_id: club_id for club_id, tm_id in _perimeter_clubs(conn)}
    matched = 0
    for path in sorted(ctx.config.cache_dir.glob("transfermarkt_transfers_*.html")):
        key = _CACHE_NAME.search(path.name)
        if not key:
            continue
        tm_id, _, year = key.group(2).rpartition("_")
        club_id = by_tm.get(tm_id)
        if club_id is None or not year.isdigit():
            continue
        season = f"{year}-{(int(year) + 1) % 100:02d}"
        try:
            soup = BeautifulSoup(path.read_text(encoding="utf-8"), "lxml")
        except OSError:
            continue
        ids: dict[str, str] = {}
        for link in soup.select('a[href*="/profil/spieler/"]'):
            tm_player = (link.get("href") or "").split("/spieler/")[-1].split("/")[0]
            name = link.get_text(strip=True)
            if tm_player.isdigit() and name:
                ids[name] = tm_player
        # The page lists arrivals AND departures, so both rosters are legitimate pools here.
        count, _unresolved = resolve_squad(
            conn, club_id, season, [{"tm_id": v, "name": k} for k, v in ids.items()],
            also_previous=True)
        matched += count
    conn.commit()
    return matched


def fetch_squads(ctx: Context, seasons: tuple[str, ...], refresh: bool = False) -> None:
    """Cache one squad page per club-season (ids) plus today's squad page (contract expiry)."""
    conn = ctx.require_conn()
    clubs = _perimeter_clubs(conn)
    today = dt.datetime.now(tz=dt.UTC).date().isoformat()
    session = _client()
    print(f"[injuries] {len(clubs)} clubs x {len(seasons)} seasons of squad pages (+1 current each)")
    try:
        for index, (_club_id, tm_id) in enumerate(clubs, start=1):
            if ctx.cancelled():
                raise KeyboardInterrupt
            for season in seasons:
                year = season.split("-")[0]
                path = _cache(ctx.config, "kader", f"{tm_id}_{year}")
                if path.exists() and not refresh:
                    continue
                _polite_sleep(ctx.cancel_event)
                html = _get_html(session, SQUAD_ENDPOINT.format(tm_id=tm_id, year=year))
                if html:
                    _atomic_write_text(path, html)
            # the current squad is the only page carrying the contract column -> dated snapshot
            path = _cache(ctx.config, "squad", f"{tm_id}_{today}")
            if not path.exists() or refresh:
                _polite_sleep(ctx.cancel_event)
                html = _get_html(session, CURRENT_SQUAD_ENDPOINT.format(tm_id=tm_id))
                if html:
                    _atomic_write_text(path, html)
            if index % 5 == 0 or index == len(clubs):
                print(f"[injuries] squads {index}/{len(clubs)} clubs")
    except KeyboardInterrupt:
        print("[injuries] interrupted - already-downloaded squad pages are cached")
    finally:
        session.close()


def _players_to_walk(conn, seasons: tuple[str, ...], limit: int | None) -> list[tuple[int, str]]:
    """(fc_id, tm_id) for the perimeter players we have an id for, most valuable first.

    Order matters because this is the long walk: interrupted halfway, the players an auction
    actually argues about are the ones already done. Qt.I, never Qt.A - the pre-auction quotation
    is the only price a decision may read.
    """
    placeholders = ",".join("?" * len(seasons))
    return [(fc_id, tm_id) for fc_id, tm_id in conn.execute(
        f"""
        SELECT x.fc_id, x.source_id
        FROM player_xref x
        JOIN rosters r ON r.fc_id = x.fc_id
        WHERE x.source = 'transfermarkt' AND r.season IN ({placeholders})
        GROUP BY x.fc_id, x.source_id
        ORDER BY MAX(COALESCE(r.price_initial, r.price, 0)) DESC
        """ + (f" LIMIT {int(limit)}" if limit else ""), seasons)]


def fetch_injury_pages(ctx: Context, seasons: tuple[str, ...], limit: int | None = None,
                       refresh: bool = False) -> None:
    """One page per player (plus its pager), cached. Hours, resumable, interruptible."""
    conn = ctx.require_conn()
    players = _players_to_walk(conn, seasons, limit)
    todo = [(fc_id, tm_id) for fc_id, tm_id in players
            if refresh or not _cache(ctx.config, "injuries", tm_id).exists()]
    print(f"[injuries] {len(players)} players with a Transfermarkt id · {len(todo)} still to fetch "
          f"(~{len(todo) * (REQUEST_DELAY + REQUEST_JITTER / 2) / 60:.0f} min)")
    session = _client()
    done = 0
    try:
        for fc_id, tm_id in todo:
            if ctx.cancelled():
                raise KeyboardInterrupt
            _polite_sleep(ctx.cancel_event)
            html = _get_html(session, INJURIES_ENDPOINT.format(pid=tm_id))
            if not html:
                continue
            _atomic_write_text(_cache(ctx.config, "injuries", tm_id), html)
            for page in range(2, parse_max_page(html) + 1):
                if ctx.cancelled():
                    raise KeyboardInterrupt
                _polite_sleep(ctx.cancel_event)
                extra = _get_html(session, INJURIES_PAGE_ENDPOINT.format(pid=tm_id, page=page))
                if not extra:
                    break
                _atomic_write_text(_cache(ctx.config, "injuries", f"{tm_id}_p{page}"), extra)
            done += 1
            if done % 25 == 0 or done == len(todo):
                print(f"[injuries] {done}/{len(todo)} players fetched")
                ctx.progress("injuries", done, len(todo), "players fetched")
    except KeyboardInterrupt:
        print("[injuries] interrupted - every fetched player is cached, rerun to continue")
    finally:
        session.close()


def reingest_from_cache(ctx: Context) -> None:
    """Rebuild player_xref(transfermarkt), injuries and the contract flags offline from the cache."""
    conn = ctx.require_conn()
    by_tm = {tm_id: club_id for club_id, tm_id in _perimeter_clubs(conn)}
    if not by_tm:
        print("[injuries] no Transfermarkt club ids yet - run `transfers` first")
        return

    # 1) identity, from the cheapest source up: transfer pages (free) then the squad pages.
    free = _harvest_ids_from_transfer_cache(ctx)
    squads = unresolved = 0
    for path in sorted(ctx.config.cache_dir.glob("transfermarkt_kader_*.html")):
        key = _KADER_CACHE.search(path.name)
        club_id = by_tm.get(key.group(1)) if key else None
        if club_id is None:
            continue
        season = f"{key.group(2)}-{(int(key.group(2)) + 1) % 100:02d}"
        try:
            matched, misses = resolve_squad(conn, club_id, season,
                                            parse_squad(path.read_text(encoding="utf-8")))
        except Exception as exc:   # noqa: BLE001 - a corrupt page must not abort the rebuild
            print(f"[injuries] skipping unreadable {path.name}: {exc}")
            continue
        squads += matched
        unresolved += len(misses)
    conn.commit()
    total_ids = conn.execute(
        "SELECT COUNT(*) FROM player_xref WHERE source = 'transfermarkt'").fetchone()[0]
    print(f"[injuries] ids: {total_ids} players mapped ({free} from the transfer pages, "
          f"{squads} squad rows matched, {unresolved} unresolved)")

    # 2) the injury history, one file per player (+ its extra pages).
    by_player: dict[str, list] = {}
    for path in sorted(ctx.config.cache_dir.glob("transfermarkt_injuries_*.html")):
        key = _INJURY_CACHE.search(path.name)
        if key:
            by_player.setdefault(key.group(1), []).append(path)
    xref = {source_id: fc_id for source_id, fc_id in conn.execute(
        "SELECT source_id, fc_id FROM player_xref WHERE source = 'transfermarkt'")}
    conn.execute("DELETE FROM injuries WHERE source = 'transfermarkt'")
    stored = players = orphans = 0
    for tm_id, paths in sorted(by_player.items()):
        fc_id = xref.get(tm_id)
        if fc_id is None:
            orphans += 1
            continue
        records: list[dict] = []
        for path in paths:
            try:
                records += parse_injury_history(path.read_text(encoding="utf-8"))
            except Exception as exc:   # noqa: BLE001
                print(f"[injuries] skipping unreadable {path.name}: {exc}")
        stored += upsert_injuries(conn, fc_id, records)
        players += 1
    conn.commit()
    print(f"[injuries] {stored} dated absences over {players} players "
          f"({orphans} cached pages without a resolved identity)")

    # 3) the contract snapshot: the most recent dated squad page wins.
    season = conn.execute("SELECT MAX(season) FROM rosters").fetchone()[0]
    latest: dict[str, tuple[str, object]] = {}
    for path in sorted(ctx.config.cache_dir.glob("transfermarkt_squad_*.html")):
        key = _SQUAD_CACHE.search(path.name)
        if key:
            latest[key.group(1)] = (key.group(2), path)
    if season and latest:
        conn.execute("DELETE FROM flags WHERE source = 'transfermarkt' "
                     "AND flag IN ('contract_until', 'exit_risk')")
        contracts = 0
        for date, path in latest.values():
            try:
                contracts += upsert_contracts(
                    conn, parse_squad(path.read_text(encoding="utf-8")), season, date)
            except Exception as exc:   # noqa: BLE001
                print(f"[injuries] skipping unreadable {path.name}: {exc}")
        conn.commit()
        risks = conn.execute("SELECT COUNT(*) FROM flags WHERE flag = 'exit_risk'").fetchone()[0]
        print(f"[injuries] contracts: {contracts} expiry dates on {season} · {risks} exit_risk "
              f"(provisional: within {EXIT_RISK_MONTHS} months, and NOT measurable on a past window)")


def run(ctx: Context, *, seasons=None, limit: int | None = None, refresh: bool = False,
        layer: str = "all", **kwargs) -> None:
    """layer='ids' (squad pages), 'injuries' (the long per-player walk), 'all', or 'reparse'.

    Resumable: anything already cached is not downloaded again unless refresh=True.
    """
    conn = ctx.require_conn()
    if isinstance(seasons, str):
        seasons = [seasons]
    if seasons:
        seasons = tuple(seasons)
    else:
        seasons = tuple(row[0] for row in conn.execute(
            "SELECT DISTINCT season FROM rosters ORDER BY season"))
    if layer not in ("ids", "injuries", "all", "reparse"):
        raise RuntimeError(f"Unknown layer {layer!r}; choose from ids|injuries|all|reparse")
    ctx.config.cache_dir.mkdir(parents=True, exist_ok=True)

    if layer in ("ids", "all"):
        fetch_squads(ctx, seasons, refresh)
        reingest_from_cache(ctx)          # the ids must be in the DB before the walk can order it
    if layer in ("injuries", "all"):
        fetch_injury_pages(ctx, seasons, limit, refresh)
    reingest_from_cache(ctx)
