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

WHEN THE HOST IS DOWN (07/08/2026: ECONNREFUSED on the API *and* on clubelo.com, from two different
networks), there is a fallback, and it is deliberately a MIRROR OF THE SAME SERIES rather than another
provider. The reason is calibration, not convenience: `level_weight` 0.06 was swept on ClubElo's own
distribution, and while `evaluate._origin_elo_z` standardises inside each window - so a foreign scale
would not corrupt the arithmetic outright - substituting a different provider on ONE window of ten is
exactly «a fitted transform belongs to the population it was fitted on». `tonyelhabr/club-rankings`
republishes ClubElo's daily CSV with its own columns untouched (Rank,Club,Country,Level,Elo,From,To
plus `date`), so `parse_snapshot` reads it unchanged and no number changes meaning.

Two properties the fallback must keep, and they are why it is not a plain download:
* it stores the OBSERVED date, never the requested one. The mirror's coverage ends 2026-01-14, so a
  request for today is served by the 14 January snapshot filed AS 2026-01-14 - which the readers find
  anyway (`MAX(date) <= auction_date`) and which no longer claims to be something it is not. Filing it
  under today would be the same defect `auction_dates` was just fixed for, one step further along.
* the extracted file is byte-for-byte the shape the API would have returned, cached under the usual
  name, so `rebuild` cannot tell the difference - with a `clubelo_{date}.origin.txt` sidecar next to it
  saying where it came from, because a row that cannot say its provenance is a row nobody can audit.
The mirror covers 2023-04-16 -> 2026-01-14 only. The ten gate windows are already cached in full, so
this exists for the CURRENT reading and for `bootstrap` on a fresh clone, not to rebuild history.
"""

from __future__ import annotations

import csv
import io
import json
import os
import time
import urllib.error
import urllib.request

from euroleghe_ingest.context import Context
from euroleghe_ingest.matching import CLUB_ALIASES, club_identity, club_key

NAME = "elo"
DESCRIPTION = "ClubElo API -> club_elo at the auction dates (offline-reingestable)"
DEPENDS_ON: list[str] = ["rosters"]
RAW_INPUTS: list[str] = ["elo-asta-mappa-club.csv"]   # optional legacy seed, no longer required
NETWORK = True

ENDPOINT = "http://api.clubelo.com/{date}"
REQUEST_DELAY = 1.5          # a static file server, but polite is still polite

# The fallback: ClubElo's own daily CSV, republished. One 49 MB file holding every date, so it is
# streamed once and filtered rather than downloaded per date. Verified 07/08/2026: same seven columns
# in the same order plus `date`/`updated_at`, ClubElo's own short spellings (`Paris SG`, `Man City` -
# the ones ELO_ALIASES already maps), and the last snapshot it carries, 2026-01-14, has 630 clubs of
# which 96 in the top division of our five leagues (Arsenal 2052.4, Bayern 1996.3).
MIRROR_URL = ("https://github.com/tonyelhabr/club-rankings/releases/download/club-rankings/"
              "clubelo-club-rankings.csv")
MIRROR_COLUMNS = ("Rank", "Club", "Country", "Level", "Elo", "From", "To")
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
    missing: list[str] = []
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
            print(f"[elo] {date}: fetch failed ({exc}) - will try the mirror")
            missing.append(date)
            continue
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_bytes(payload)
        os.replace(tmp, path)
        fetched += 1
        print(f"[elo] {date}: snapshot cached ({len(payload) // 1024} KB)")
        time.sleep(REQUEST_DELAY)
    if missing and not ctx.cancelled():
        fetched += fetch_from_mirror(ctx, missing)
    return fetched


def fetch_from_mirror(ctx: Context, wanted: list[str]) -> int:
    """The API is down: serve what we can from the republished ClubElo series (see module docstring).

    Streamed and filtered in one pass - the mirror is one 49 MB file holding every date, and pulling
    it once for N dates beats pulling it N times. Everything it produces is a normal cache file at the
    date it was actually OBSERVED, so `reingest_from_cache` needs no knowledge of any of this.
    """
    print(f"[elo] falling back to the mirror for {len(wanted)} date(s): {MIRROR_URL}")
    try:
        with urllib.request.urlopen(MIRROR_URL, timeout=180) as response:
            lines = (raw.decode("utf-8", errors="replace") for raw in response)
            picked = pick_from_mirror(lines, wanted)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        print(f"[elo] the mirror failed too ({exc}) - club_elo keeps whatever it already had")
        return 0

    written = 0
    for date in wanted:
        chosen = picked.get(date)
        if chosen is None:
            print(f"[elo] {date}: the mirror has nothing at or before this date - skipping")
            continue
        observed, payload = chosen
        path = _cache_path(ctx.config, observed)
        if path.exists():
            print(f"[elo] {date}: the mirror offers {observed}, already cached - left alone")
            continue
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(payload, encoding="utf-8")
        os.replace(tmp, path)
        # Provenance next to the file, because `club_elo` has no source column and a number that
        # cannot say where it came from is one nobody can audit later.
        path.with_suffix(".origin.txt").write_text(
            f"{MIRROR_URL}\nrequested={date}\nobserved={observed}\n", encoding="utf-8")
        written += 1
        stale = " (the API's own date, so nothing is approximated)" if observed == date else \
                f" - filed as {observed}, which is when it was OBSERVED, not {date}"
        print(f"[elo] {date}: mirror snapshot cached{stale}")
    return written


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


def pick_from_mirror(lines, wanted: list[str]) -> dict[str, tuple[str, str]]:
    """{requested date: (the date actually observed, the CSV the API would have returned)}.

    Takes any iterable of lines so the network path and the tests exercise the SAME code: the caller
    passes a streamed response, a test passes a string's `.splitlines()`.

    For each requested date it keeps the most recent mirror date that is not AFTER it - never a later
    one, because a snapshot taken after the auction knows things the auction did not. A request the
    mirror cannot reach (it starts 2023-04-16, and the older windows are cached anyway) is absent from
    the result rather than filled with the closest thing available: that is the «vuoto = ignoto» rule
    applied to a date.
    """
    rows = iter(lines)
    try:
        header = next(csv.reader([next(rows)]))
    except StopIteration:
        return {}
    try:
        at = {name: header.index(name) for name in (*MIRROR_COLUMNS, "date")}
    except ValueError as exc:                       # the mirror changed shape: say so, do not guess
        raise ValueError(f"the mirror's columns are not the ones we parse: {header}") from exc

    horizon = max(wanted)
    best: dict[str, str] = {}
    buffered: dict[str, list[list[str]]] = {}
    for row in csv.reader(rows):
        if len(row) <= at["date"]:
            continue
        observed = row[at["date"]]
        if observed > horizon:
            break                                   # date-ascending file, verified: nothing left to gain
        for date in wanted:
            if observed > date:
                continue
            if best.get(date, "") < observed:
                best[date], buffered[date] = observed, []
            if best[date] == observed:
                buffered[date].append([row[at[name]] for name in MIRROR_COLUMNS])

    out: dict[str, tuple[str, str]] = {}
    for date, records in buffered.items():
        if not records:
            continue
        buffer = io.StringIO(newline="")
        writer = csv.writer(buffer, lineterminator="\n")
        writer.writerow(MIRROR_COLUMNS)
        writer.writerows(records)
        out[date] = (best[date], buffer.getvalue())
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


# ---------- the LEVEL of every club, not just ours (gate §7-tervicies) ----------
# `club_elo` holds 97 clubs, because `store_snapshot` keeps only what resolves to an `fc_club_id` - i.e.
# whoever has been in a listone. The cached CSVs hold 631 PER YEAR, and a player's career runs through
# clubs no fantacalcio roster ever had (Benfica, Ajax, Porto). Reading them straight, and taking the club
# from the PER-MATCH layer rather than from the listone, lifts the coverage of our own match rows from
# 76.7% to 92.5%.
NAME_NOISE = frozenset({
    "fc", "ac", "cf", "sc", "ssc", "as", "afc", "cd", "ud", "rc", "rcd", "sv", "tsg", "vfl", "vfb",
    "sd", "cp", "ca", "club", "calcio", "de", "di", "the", "bsc", "fsv", "sk", "ss", "us", "acf",
    "1899", "04", "05", "09", "96", "98", "1900", "1904", "1907", "1909", "1913"})
# Residues the rules below cannot reach, each with the match rows it fixes. A hand-written list is the
# remedy this project prefers to avoid, so it is short and it is declared.
NAME_EXTRA: dict[str, str] = {
    "Bayer 04 Leverkusen": "Leverkusen", "Brighton & Hove Albion": "Brighton",   # 4715 · 3864
    "Athletic Club": "Bilbao", "Stade Rennais": "Rennes",                        # 3739 · 3264
    "Wolverhampton": "Wolves", "Borussia M'gladbach": "Gladbach",                # 2874 · 2520
    "Deportivo Alavés": "Alaves",                                                # 1036
    # ...and the ones the LEVELS table needed, added 08/08/2026 with the rows each recovers: a club with
    # no level is a player with no level, and the operator's rule is that every player must have one.
    "Red Bull Salzburg": "Salzburg", "Sporting Braga": "Braga",                  #   26 ·   24
    "Austria Klagenfurt": "Klagenfurt", "Deportivo de A Coruña": "Depor",        #   10 ·   24
}


# German transliteration, and it is a RULE rather than five aliases. ClubElo spells the umlauts out -
# `Koeln`, `Duesseldorf`, `Fuerth`, `Nuernberg`, `Suedtirol`, `Muenchen` - while every other source of
# ours keeps them (`1. FC Köln`), and stripping the diaeresis the ordinary way gives `koln`, which matches
# nothing. Measured 08/08/2026: it recovers Köln (725 match rows), Düsseldorf, Fürth, Nürnberg, Südtirol
# and Mönchengladbach in one line, where a hand-written alias each would have been six lines and the next
# German club would have needed a seventh.
_UMLAUTS = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"})


def _name_tokens(name: str) -> list[str]:
    import re
    import unicodedata

    text = name.lower().translate(_UMLAUTS)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return [t for t in re.sub(r"[^a-z0-9 ]+", " ", text).split() if t]


def _name_core(name: str) -> frozenset[str]:
    full = _name_tokens(name)
    return frozenset([t for t in full if t not in NAME_NOISE] or full)


def _is_acronym(short: str, ours: list[str]) -> bool:
    """ClubElo writes «Paris SG»: `sg` is not a prefix of anything, it is Saint-Germain's initials."""
    if not 2 <= len(short) <= 4:
        return False
    return any(short == "".join(t[0] for t in ours[i:i + len(short)]) for i in range(len(ours)))


def match_club_names(elo_names, ours, seed: dict | None = None) -> dict[str, str]:
    """our spelling -> ClubElo's. Only UNIQUE matches, and two guards paid for by a wrong number.

    The first version of this gave Gonçalo Ramos an Elo of 1472 - lower than every Milan forward, for a
    man who had played PSG and Benfica. Stripping the corporate noise reduced «Paris FC» to the single
    token `paris`, which is a subset of «Paris Saint-Germain», and the match came out UNIQUE, so three
    seasons at PSG were priced at a Ligue 2 club (1405-1538 instead of 1970). Hence:

    * a name reduced to ONE generic token cannot cover one made of three - kills Paris FC, keeps
      «Milan» = «AC Milan» and «Bayern» = «FC Bayern München»;
    * initials count as a name, so «Paris SG» matches on its own merits and the pair would be
      ambiguous rather than silently wrong even without the first guard.

    An ambiguous match is worse than a missing one: a missing Elo leaves a man unknown, a wrong one
    gives him another club's strength. So ambiguity is dropped, and `validate_club_index` exists to be
    run against clubs whose level is already known.
    """
    table = {name: _name_core(name) for name in elo_names}
    out = dict(seed or {})
    for target in ours:
        if target in out:
            continue
        mine, mine_full = _name_core(target), _name_tokens(target)
        if not mine:
            continue
        exact = [n for n, t in table.items() if t == mine]
        if len(exact) == 1:
            out[target] = exact[0]
            continue
        if exact:
            continue                                  # ambiguous: leave it unknown
        def covers(theirs: frozenset[str], mine=mine, mine_full=mine_full) -> bool:
            if len(theirs) == 1 and len(mine) >= 3:
                return False                          # the Paris FC guard
            return bool(theirs) and all(
                any(o.startswith(e) or e.startswith(o) for o in mine) or _is_acronym(e, mine_full)
                for e in theirs)
        candidates = [n for n, t in table.items() if covers(t)]
        if len(candidates) == 1:
            out[target] = candidates[0]
    return out


def load_cached_levels(ctx: Context) -> dict[str, dict[str, float]]:
    """{year: {ClubElo name: Elo}} from every snapshot on disk - all 631 clubs, not just ours."""
    out: dict[str, dict[str, float]] = {}
    for path in sorted(ctx.config.cache_dir.glob("clubelo_*.csv")):
        year = path.stem.replace("clubelo_", "")[:4]
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for record in parse_snapshot(text):
            out.setdefault(year, {})[record["club"]] = record["elo"]
    return out


def store_levels(conn, ctx: Context) -> tuple[int, int, int]:
    """`club_levels`: every club ClubElo publishes, per year, keyed canonically. Returns (rows, clubs, ours).

    `club_elo` can only hold a club that has been in a listone - its key is `fc_club_id` - so 97 clubs of
    the ~630 published survived ingest and everybody else read as «no level». That is a table about our
    PERIMETER being used as a table about FOOTBALL, and the two are different things: Red Bull Salzburg is
    a real club with a real strength, and a man whose measured window was played there carried nothing.

    Both sides are indexed, so no read path ever compares a name: ClubElo's own spelling, and every
    spelling WE hold anywhere (`clubs`, the per-match layer, the parsed line-ups) that `match_club_names`
    resolves to it - with the two guards that function was given after «Paris FC» was matched to PSG.
    An ambiguous name stays unresolved, because a wrong level is worse than a missing one.
    """
    levels = load_cached_levels(ctx)
    if not levels:
        return 0, 0, 0
    elo_names = sorted({name for year in levels.values() for name in year})
    ours: set[str] = set()
    for query in ("SELECT DISTINCT canonical_name FROM clubs WHERE canonical_name IS NOT NULL",
                  "SELECT DISTINCT club FROM external_match_stats WHERE club IS NOT NULL",
                  "SELECT DISTINCT club FROM club_match_lineups WHERE club IS NOT NULL"):
        ours.update(name for (name,) in conn.execute(query))
    known = set(elo_names)
    seed = {mine: theirs for theirs, mine in ELO_ALIASES.items() if theirs in known}
    seed.update({mine: theirs for mine, theirs in NAME_EXTRA.items() if theirs in known})
    index = match_club_names(elo_names, sorted(ours), seed)
    # ClubElo's own name first, then ours - so a spelling of ours that collides with a ClubElo name
    # cannot silently take another club's level, and the row says which club it is.
    keyed: dict[str, str] = {club_identity(name): name for name in elo_names}
    for mine, theirs in index.items():
        keyed.setdefault(club_identity(mine), theirs)
    rows = 0
    for year, table in levels.items():
        for key, name in keyed.items():
            value = table.get(name)
            if value is None:
                continue
            conn.execute("INSERT OR REPLACE INTO club_levels(club_key, year, elo, elo_name) "
                         "VALUES (?, ?, ?, ?)", (key, year, value, name))
            rows += 1
    return rows, len(elo_names), len(index)


def levels_at(conn, year: str) -> dict[str, float]:
    """{club_key: Elo} for one year - what a read joins against, never a name."""
    return {key: value for key, value in conn.execute(
        "SELECT club_key, elo FROM club_levels WHERE year = ?", (year,))}


def derive_elo_xref(conn, ctx: Context) -> tuple[int, list[str]]:
    """club_xref(source='clubelo') keyed on the PROVIDER'S TEAM ID. Resolved once, stored, auditable.

    This is the only place a club name is ever compared, and it happens at INGEST. Everything
    downstream joins `external_stats.club_id` -> this table -> the level, so no read path can pick the
    wrong club by spelling. `club_xref`'s own key is `(source, source_id)`, which is what makes the
    provider's id the natural anchor: it is unique, it is stable across seasons, and it exists for
    every club the per-season aggregates cover - including the ones no listone ever had.

    `fc_club_id` is filled where we have one and left at 0 otherwise: a club outside every listone is
    still a real club with a real strength, and refusing it would put us back to knowing Europe's top
    97 only. Returns (rows written, the ambiguous names it REFUSED to resolve).
    """
    levels = load_cached_levels(ctx)
    if not levels:
        return 0, []
    # provider id -> the name the provider uses, from the same cached files the ids come from and NOT
    # from the DB: the mapping must be derivable on a fresh clone, before anything is backfilled.
    # Newest file last, so a club that changed name keeps its latest spelling.
    named: dict[str, str] = {}
    for path in sorted(ctx.config.cache_dir.glob("sofascore_stats_*.json")):
        try:
            rows = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for row in rows if isinstance(rows, list) else ():
            team = row.get("team") or {}
            if team.get("id") and (team.get("name") or "").strip():
                named[str(team["id"])] = team["name"].strip()
    spellings = sorted(set(named.values()))
    seed = {ours: theirs for theirs, ours in ELO_ALIASES.items() if ours in spellings}
    seed.update({o: t for o, t in NAME_EXTRA.items()
                 if any(t in year for year in levels.values())})
    index = match_club_names(sorted({n for year in levels.values() for n in year}), spellings, seed)

    ours = {club_key(name): club_id for club_id, name in conn.execute(
        "SELECT fc_club_id, canonical_name FROM clubs WHERE canonical_name IS NOT NULL")}
    written, refused = 0, []
    for provider_id, name in named.items():
        target = index.get(name)
        if target is None:
            refused.append(name)
            continue
        conn.execute(
            """INSERT OR REPLACE INTO club_levels_xref(
                   provider_club_id, elo_name, provider_name, fc_club_id, resolved_by)
               VALUES (?, ?, ?, ?, ?)""",
            (provider_id, target, name, ours.get(club_key(name)),
             "alias" if name in seed else "tokens"))
        written += 1
    return written, sorted(set(refused))


def elo_by_provider_club(conn, ctx: Context) -> dict[str, dict[str, float]]:
    """{provider team id: {year: Elo}} - read through the stored mapping, never through a name."""
    levels = load_cached_levels(ctx)
    out: dict[str, dict[str, float]] = {}
    for provider_id, name in conn.execute(
            "SELECT provider_club_id, elo_name FROM club_levels_xref"):
        found = {year: table[name] for year, table in levels.items() if name in table}
        if found:
            out[provider_id] = found
    return out


def personal_levels(conn, ctx: Context, season: str, window: int = 5) -> dict[int, float]:
    """{fc_id: the mean Elo of the football he played}, weighted by MINUTES, over `window` seasons.

    The MEAN and not the sum: `sum(Elo x minutes)` measures how MUCH high-level football he played,
    which is volume - and volume is age plus playing time, the confound that ate the first version of
    this idea (r +0.769 with the minutes themselves). The mean answers the other question, at what
    level, which is the one that says whether a club bought him to play.
    """
    by_club = elo_by_provider_club(conn, ctx)
    if not by_club:
        return {}
    seasons = [row[0] for row in conn.execute(
        "SELECT DISTINCT season FROM external_stats WHERE season <= ? ORDER BY season DESC LIMIT ?",
        (season, window))]
    if not seasons:
        return {}
    placeholders = ",".join("?" for _ in seasons)
    weighted: dict[int, list[float]] = {}
    for fc_id, played, club_id, minutes in conn.execute(
            f"""SELECT fc_id, season, club_id, SUM(COALESCE(minutes, 0)) FROM external_stats
                WHERE source = 'sofascore' AND competition <> '' AND club_id IS NOT NULL
                  AND season IN ({placeholders}) GROUP BY fc_id, season, club_id""", seasons):
        value = (by_club.get(str(club_id)) or {}).get(played.split("-")[0])
        if value is None or not minutes:
            continue                                   # unknown club: unknown level, never a zero
        total = weighted.setdefault(fc_id, [0.0, 0.0])
        total[0] += value * minutes
        total[1] += minutes
    return {fc_id: pair[0] / pair[1] for fc_id, pair in weighted.items() if pair[1]}


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
    # ...and the identity layer: which ClubElo row belongs to which PROVIDER TEAM ID, resolved once
    # here so that no read path ever compares a club name (§7-tervicies).
    written, refused = derive_elo_xref(conn, ctx)
    # ...and the LEVELS themselves, for every club ClubElo publishes and not only the ones a listone
    # carries: `club_elo` is keyed on `fc_club_id` and can hold nobody else (§ `club_levels`).
    rows, clubs_seen, matched = store_levels(conn, ctx)
    conn.commit()
    print(f"[elo] club_levels: {rows} rows over {clubs_seen} clubs a year "
          f"({matched} of our own spellings resolved onto them)")
    print(f"[elo] club_xref(clubelo): {written} provider clubs mapped"
          + (f" · {len(refused)} names left unresolved (ambiguous or absent): "
             + ", ".join(refused[:6]) if refused else ""))
