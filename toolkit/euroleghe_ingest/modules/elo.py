"""elo - club strength -> club_elo at the auction dates, from the ClubElo API.

WHO READS THIS TABLE, checked against the code on 07/08/2026 rather than copied forward:
* R19, the LEVEL channel and the only adopted use - the ORIGIN club's Elo (`Observation.elo_prev`),
  standardised over the clubs the movers came from, moving the expected APPEARANCES of a man who
  changed club. In the engine on `default` (`evaluate.ADOPTED`), in the panel through
  `presence.level_lift` (`level_weight` 0.06). Its input on the sheet is `desc_level_elo`.
* the club card, which prints the club's Elo as a fact (`snapshot.club_context`).
* R5 / R5b, the destination club's strength shifting the FANTAMEDIA: the family is CLOSED after four
  rejections (`model.club_strength_adjustment`). Kept re-scorable by the gate, not a live use.

Two claims that used to stand here were false, and both were about a use this engine does not make.
The goalkeeper module does NOT read `club_elo`: `predict_fm_goalkeeper` takes the conceded rate from
`features.goalkeeper_club_rates`, i.e. measured `season_stats.goals_conceded`, and the 50/50
persistence+Elo mix that `clubelo-gate.md` adopted in Colab (M2 -> M2e) was never ported - the name
travelled, the Elo half did not (recorded in gate-motore-v1 §3-quinquies (a) on 27/07/2026 and left in
the code until now). Porting it is a proposal for the gate, not a fix. And the club-to-club
coefficient for the ARRIVALS (task 3.2) is not implemented either: `arrivals.py` never mentions Elo,
and clubelo-gate.md itself files 3.2 as untestable-for-now. Neither was a validated use.

Why the API and not the seed CSV any more. `data/raw/elo-asta-mappa-club.csv` was a hand-made file
with two columns of Elo: a fresh clone could not reproduce `club_elo` at all, and two columns is also
why R5 could never be tested beyond two dates. The API gives EVERY club in Europe at ANY date in one
request - http://api.clubelo.com/YYYY-MM-DD -> CSV(Rank,Club,Country,Level,Elo,From,To) - so eleven
requests cover eleven seasons.

The dates come from `engine.features.WINDOWS`, not from a local guess: the engine reads
`MAX(date) <= auction_date`, so a snapshot taken on exactly that date is the one it will find, and the
2020-21 September date (COVID) is a special case a local f-string would get wrong.

Each response is cached under data/cache/clubelo_{date}.csv, so `rebuild` re-ingests it offline like
every other source. The legacy seed is still honoured when present - it is how the published numbers
were produced - but it never overwrites a fetched snapshot.
"""

from __future__ import annotations

import csv
import os
import time
import urllib.error
import urllib.request

from euroleghe_ingest.context import Context
from euroleghe_ingest.matching import CLUB_ALIASES, club_key

NAME = "elo"
DESCRIPTION = "ClubElo API -> club_elo at the auction dates (offline-reingestable)"
DEPENDS_ON: list[str] = ["rosters"]
RAW_INPUTS: list[str] = ["elo-asta-mappa-club.csv"]   # optional legacy seed, no longer required
NETWORK = True

ENDPOINT = "http://api.clubelo.com/{date}"
REQUEST_DELAY = 1.5          # a static file server, but polite is still polite
# Countries -> our league keys. Used only to REPORT coverage, never to filter a match: a club that
# dropped out of its top division still has an Elo, and the older windows need exactly those.
COUNTRY_LEAGUE: dict[str, str] = {
    "ITA": "serie_a", "ENG": "premier_league", "ESP": "la_liga",
    "GER": "bundesliga", "FRA": "ligue_1",
}

# ClubElo's short names -> our canonical spelling. Measured, not guessed: without these the API
# leaves the strongest clubs of four leagues without an Elo (PSG, City, Bayern, Atletico...), which
# is precisely the population the level channel exists for - a man arriving FROM one of them is the
# case R19 prices, and a missing origin Elo reads as "no evidence" and moves him not at all.
ELO_ALIASES: dict[str, str] = {
    "Paris SG": "Paris Saint-Germain",
    "Man City": "Manchester City",
    "Man United": "Manchester United",
    "Newcastle": "Newcastle United",
    "Bayern": "Bayern Monaco",
    "Leverkusen": "Bayer Leverkusen",
    "Dortmund": "Borussia Dortmund",
    "Frankfurt": "Eintracht Francoforte",
    "Gladbach": "Borussia Monchengladbach",
    "Atletico": "Atletico Madrid",
    "Sociedad": "Real Sociedad",
    "Bilbao": "Athletic Bilbao",
    "Marseille": "Olympique Marsiglia",
    "Lyon": "Olympique Lione",
    "Hertha": "Hertha Berlino",
    "Leicester": "Leicester City",
}
# The legacy seed CSV's two columns -> the auction dates they represented.
SEED_DATES = {"elo24": "2024-08-15", "elo25": "2025-08-15"}


def auction_dates(conn, today: str | None = None) -> list[str]:
    """Every date worth a snapshot: the engine's window auction dates + the newest season's.

    The newest season's date is the conventional 15 August, and during the PRESEASON that day has not
    happened yet - so asking for it would file a reading taken today under a date in the future, which
    is the one thing a dated fact must never do. Today's own date goes in instead: a sheet built before
    the auction has TODAY as its auction date, the readers take `MAX(date) <= auction_date`, and
    without this the whole 2026-27 window was reading the 2025-08-15 snapshot - a club's strength as it
    was a season and a transfer window ago, which is what `desc_level_elo` (R19) and the club card are
    built on. On or after the 15th the pre-registered date is fetched as before and joins the series.
    """
    import datetime as dt

    from euroleghe_ingest.engine.features import WINDOWS

    dates = {window.auction_date for window in WINDOWS.values()}
    latest = conn.execute("SELECT MAX(season) FROM rosters").fetchone()[0]
    today = today or dt.datetime.now(tz=dt.UTC).date().isoformat()
    if latest:
        dates.add(min(f"{latest.split('-')[0]}-08-15", today))
    return sorted(dates)


# ---------- fetch ----------
def _cache_path(config, date: str):
    return config.cache_dir / f"clubelo_{date}.csv"


def fetch_snapshots(ctx: Context, dates: list[str], refresh: bool = False) -> int:
    """One request per date, cached. Nothing else in the toolkit is this cheap."""
    ctx.config.cache_dir.mkdir(parents=True, exist_ok=True)
    fetched = 0
    for date in dates:
        if ctx.cancelled():
            break
        path = _cache_path(ctx.config, date)
        if path.exists() and not refresh:
            continue
        try:
            with urllib.request.urlopen(ENDPOINT.format(date=date), timeout=30) as response:
                payload = response.read()
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            print(f"[elo] {date}: fetch failed ({exc}) - skipping")
            continue
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_bytes(payload)
        os.replace(tmp, path)
        fetched += 1
        print(f"[elo] {date}: snapshot cached ({len(payload) // 1024} KB)")
        time.sleep(REQUEST_DELAY)
    return fetched


# ---------- parsing (pure, offline-testable) ----------
def parse_snapshot(text: str) -> list[dict]:
    """The API's CSV -> [{club, country, level, elo}], skipping rows without a usable Elo."""
    out: list[dict] = []
    for row in csv.DictReader(text.splitlines()):
        try:
            elo = float(row.get("Elo") or "")
        except ValueError:
            continue
        club = (row.get("Club") or "").strip()
        if not club:
            continue
        out.append({"club": club, "country": (row.get("Country") or "").strip(),
                    "level": (row.get("Level") or "").strip(), "elo": elo})
    return out


def _our_clubs(conn) -> dict[str, int]:
    """Every club we know, indexed by normalized name AND by its alias spellings."""
    index: dict[str, int] = {}
    for club_id, name in conn.execute("SELECT fc_club_id, canonical_name FROM clubs"):
        for candidate in (name, CLUB_ALIASES.get(name, name)):
            index.setdefault(club_key(candidate), club_id)
    return index


def store_snapshot(conn, date: str, records: list[dict]) -> tuple[int, list[str]]:
    """club_elo rows for the clubs we have. Returns (stored, unresolved top-division clubs)."""
    ours = _our_clubs(conn)
    stored = 0
    unresolved: list[str] = []
    for rec in records:
        name = ELO_ALIASES.get(rec["club"], rec["club"])
        club_id = ours.get(club_key(name))
        if club_id is None:
            if rec["country"] in COUNTRY_LEAGUE and rec["level"] == "1":
                unresolved.append(rec["club"])
            continue
        conn.execute("INSERT OR REPLACE INTO club_elo(fc_club_id, date, elo) VALUES (?, ?, ?)",
                     (club_id, date, rec["elo"]))
        stored += 1
    return stored, unresolved


def ingest_seed_csv(ctx: Context) -> int:
    """The legacy hand-made seed, kept because the published numbers were produced with it.

    `INSERT OR IGNORE`, so where the API answered the API wins and where it did not the two-column
    seed still fills 2024-08-15 / 2025-08-15.
    """
    conn = ctx.require_conn()
    path = ctx.config.raw_dir / "elo-asta-mappa-club.csv"
    if not path.exists():
        return 0
    text = path.read_bytes().decode("utf-8-sig", errors="replace")   # strip a BOM if present
    rows = 0
    for record in csv.DictReader(text.splitlines()):
        name = (record.get("squadra") or "").strip()
        if not name:
            continue
        club = conn.execute("SELECT fc_club_id FROM clubs WHERE canonical_name = ?",
                            (name,)).fetchone()
        if club is None:
            continue
        for column, date in SEED_DATES.items():
            value = record.get(column)
            if value not in (None, ""):
                conn.execute("INSERT OR IGNORE INTO club_elo(fc_club_id, date, elo) "
                             "VALUES (?, ?, ?)", (club[0], date, float(value)))
                rows += 1
    return rows


def reingest_from_cache(ctx: Context) -> None:
    """Rebuild club_elo offline from the cached snapshots (+ the legacy seed, if it is there)."""
    conn = ctx.require_conn()
    dates = stored = 0
    unresolved: set[str] = set()
    for path in sorted(ctx.config.cache_dir.glob("clubelo_*.csv")):
        date = path.stem.replace("clubelo_", "")
        try:
            records = parse_snapshot(path.read_text(encoding="utf-8", errors="replace"))
        except OSError as exc:
            print(f"[elo] skipping unreadable {path.name}: {exc}")
            continue
        count, misses = store_snapshot(conn, date, records)
        stored += count
        unresolved.update(misses)
        dates += 1
    seeded = ingest_seed_csv(ctx)
    conn.commit()
    total = conn.execute("SELECT COUNT(*) FROM club_elo").fetchone()[0]
    covered = conn.execute("SELECT COUNT(DISTINCT fc_club_id) FROM club_elo").fetchone()[0]
    print(f"[elo] {dates} snapshots -> {stored} rows ({seeded} from the legacy seed) · "
          f"club_elo: {total} rows over {covered} clubs")
    if unresolved:
        names = ", ".join(sorted(unresolved)[:10])
        print(f"[elo] {len(unresolved)} top-division clubs of our 5 leagues are outside our "
              f"perimeter (normal - EuroLeghe carries ~8 per league): {names}")


def run(ctx: Context, *, refresh: bool = False, fetch: bool = True, **kwargs) -> None:
    """`fetch=False` ingests only what is already on disk - the offline path, and what tests use."""
    conn = ctx.require_conn()
    dates = auction_dates(conn)
    fetched = fetch_snapshots(ctx, dates, refresh) if fetch else 0
    print(f"[elo] {len(dates)} auction dates, {fetched} newly fetched")
    reingest_from_cache(ctx)
