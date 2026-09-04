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

Identity: the probabili page carries the fc_id in each player's href (.../{slug}/{fc_id}), so that
list is exact. The indisponibili page gives a surname and a club, so it goes through the tiered
matcher. The SEASON used to sit in that same href and the site dropped it on 05/08/2026; it is read
from the page's own fixture links instead (`page_round`), because the page has to say which season it
is talking about and the day of the reading cannot.
"""

from __future__ import annotations

import datetime as dt
import os
import re
import unicodedata

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
    # ...and the same lists for the OTHER platform, which the operator had to point out (07/08/2026):
    # EuroLeghe has its own editorial pages - `-euro-leghe`, the same spelling the listone URL uses -
    # and nothing here read them, so four leagues of five had no editorial signal at all. Both answer
    # 200 today with the page shell and ZERO player links (the 2026-27 lineups are not out), which is a
    # reason to start CAPTURING them daily rather than to leave them out: a probabili page is one of the
    # three facts that cannot be backfilled, so a day not taken is a day lost.
    "probabili_euro": BASE_URL + "/probabili-formazioni-euro-leghe",
    "indisponibili_euro": BASE_URL + "/indisponibili-euro-leghe",
}
# The site publishes the editorial pages a few weeks into the preseason; until then it says so.
NOT_PUBLISHED = "dati non ancora disponibili"
_SNAPSHOT = re.compile(r"fc_site_([a-z_]+)_(\d{4}-\d{2}-\d{2})\.html$")
# The player link. The season segment is OPTIONAL because the site dropped it: until 04/08/2026 the href
# was `/serie-a/squadre/{club}/{slug}/{fc_id}/{season}` and from 05/08 it is `.../{fc_id}` - so a pattern
# that REQUIRED the season stopped matching, and `parse_probable_starters` returned 0 records from a page
# carrying 20 team cards and 461 players. Measured on the cache: 442 records on 04/08, ZERO from 05/08 to
# 18/08, i.e. two weeks of probabili paid for over the network and thrown away, with the sheet's starter
# and duel columns empty and `squad_snapshot`'s `fc_site` source frozen at 04/08.
_PLAYER_HREF = re.compile(r"/squadre/[^/]+/[^/]+/(\d+)(?:/(\d{4}-\d{2}))?")
# ...so the SEASON is read from the page instead, and it is still the PAGE saying it rather than the clock
# (the 07/08/2026 rule: the page keeps serving the last round of the season that ended until the new one
# starts, and the day of the reading cannot tell which season it is about). Every fixture on it links to
# `/calendario/{matchday}/{season}/{slug}/{id}`, and one page is one round: measured over the cache, the
# 04/08 page yields exactly (38, 2025-26) and the 15-18/08 ones exactly (1, 2026-27).
_PAGE_ROUND = re.compile(r"/calendario/(\d+)/(\d{4}-\d{2})/")
_PERCENT = re.compile(r"(\d+)\s*%")

# The three lists the indisponibili page splits players into -> our state vocabulary.
# "Diffidati" is not unavailability (one booking away from a ban), so it becomes a flag.
LIST_STATUS: dict[str, str] = {
    "infortunati": "injured",
    "squalificati": "suspended",
    "diffidati": "booking_risk",
}

# ---------- the return date, from the page's own PROSE ----------
# The *indisponibili* page writes one line about every absent man, and that line usually says when he
# is expected back: «Rientro in campo da inizio ottobre», «tornare arruolabile da meta' novembre».
# Until 04/09/2026 the line was parsed and THROWN AWAY (`upsert_availability` kept only the status), so
# the only return date this project had was Transfermarkt's - a WEEKLY archive, outside `update
# --daily`, while this page is read every day. That is the operator's own question of the same day
# («questa informazione l'ho recuperata leggendo articoli di giornale, come possiamo rendere questa
# operazione automatica?»): the articles are these lines.
#
# THE PARSE IS DELIBERATELY NARROW, because a wrong date is worse than no date: it feeds a valuation.
# The structure that discriminates is a RETURN VERB governing a «da/dal/dalla» that governs a month
# anchor - and it is not decoration, it is what tells the three traps apart, all three present in the
# same page on 03/09/2026:
#   * «il difensore ai box DA INIZIO SETTEMBRE per una lesione...»   -> the START of the absence
#   * «operato A FINE GIUGNO per una lesione...»                     -> the day of the operation
#   * «A META' SETTEMBRE verra' sottoposto a un controllo»            -> the day of a medical
# All three carry a month anchor and none of them is a return; a looser reader would have filed the
# first as «he is back in early September», which is the OPPOSITE of what the page says.
#
# Measured on the cache before being wired: 23 of the 45 injured men on the Serie A page of 03/09/2026
# get a date, 14 of 94 on the euro one, and every single one is right by eye. Cross-validated against
# Transfermarkt, which knows nothing about this page: on the 15 men both sources date, the median
# difference is +1 day and 10 of 15 are inside a week - two independent sources with no reason to
# agree, agreeing. And 8 of the 23 have NO Transfermarkt date at all, which is what this channel buys.
#
# WHAT IS NOT PARSED, and it is a refusal rather than an omission: the DURATIONS («stop di almeno due
# mesi», «stop di circa 25 giorni»). They are counted from the injury, and the injury's date is in the
# prose only sometimes - so a duration would have to be anchored on a day we may not know, which is
# how a wrong date gets invented. «Vuoto = ignoto»: the men who only carry a duration keep no date.
MONTHS: dict[str, int] = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
}

# WHICH DAY a part of a month means. CONVENTIONS, declared here because they are the whole precision of
# the reading: a month split in three (1-10, 11-20, 21-end) and in halves, each read at its MIDPOINT.
# The midpoint and not the first day, because «inizio ottobre» is a band and the neutral reading of a
# band is its centre - the PRUDENCE margin that makes it pessimistic lives in the app and is declared
# there, so putting a second pessimism here would count the same fear twice.
MONTH_PART_DAY: dict[str, int] = {
    "inizio": 5, "principio": 5, "meta": 15, "fine": 25, "prima meta": 8, "seconda meta": 23,
}

_RETURN_VERB = r"(?:rientr\w*|recuper\w*|torn\w*|arruolabil\w*|disponibil\w*|rivedr\w*|convocabil\w*)"
_FROM = r"(?:da|dal|dalla|dall'|dallo)"
# UN CONFINE DI PAROLA PRIMA DEL «da» non e' decorazione: senza, il «da» dentro «seconDA» fa
# scattare la frase, e «recuperabile dalla SECONDA meta' di settembre» diventerebbe una data
# letta da mezza parola.
_PART = r"(?:(?:prima|seconda)\s+met[aà]|inizio|principio|met[aà]|fine)"
_RETURN_PHRASE = re.compile(
    _RETURN_VERB + r"[^.;]{0,60}?\b" + _FROM + r"\s*(?:l'|la\s+|il\s+)?(" + _PART
    + r")\s*(?:di\s+|d'|del\s+)?(" + "|".join(MONTHS) + r")\b",
    re.IGNORECASE,
)
_SEASON_OVER = re.compile(r"stagione\s+(?:finita|conclusa|terminata)", re.IGNORECASE)


def parse_return(note: str | None, read_on: str) -> tuple[str | None, str | None]:
    """The prose -> (expected return as ISO, which form said it) - or (None, None).

    `read_on` is the day the PAGE was read and it is not decoration: the phrase names a month and never
    a year, so «gennaio» read in September is next January and «settembre» read in September is this
    one. Same rule as everywhere else here - the reading's own date decides what it is about.

    `('', 'season_over')` is the one basis with no date: «stagione finita» is the most decision-relevant
    sentence the page can carry and it names no month, so the FACT travels and the date stays empty
    rather than being invented as a last round nobody has looked up.
    """
    if not note:
        return None, None
    # NORMALIZZATA IN NFC prima di guardarla, e non e' pedanteria: la «a» accentata si scrive in due
    # modi (un carattere, oppure «a» piu' un accento combinante) e per una regex sono stringhe DIVERSE.
    # Trovato scrivendo il test: la pagina vera usa la forma precomposta e il caso scritto a mano quella
    # decomposta, e lo stesso parser leggeva «meta' novembre» su una e niente sull'altra. Una fonte che
    # cambiasse forma spegnerebbe il canale in silenzio - stessa famiglia del tag rinominato.
    note = unicodedata.normalize("NFC", note)
    if _SEASON_OVER.search(note):
        return None, "season_over"
    found = _RETURN_PHRASE.search(note)
    if not found:
        return None, None
    part = re.sub(r"\s+", " ", found.group(1).strip().lower()).replace("à", "a")
    day = MONTH_PART_DAY.get(part)
    month = MONTHS[found.group(2).lower()]
    if not day:
        return None, None
    on = dt.date.fromisoformat(read_on)
    year = on.year if month >= on.month else on.year + 1
    return dt.date(year, month, day).isoformat(), "month_part"


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
def page_round(html: str) -> tuple[int | None, str | None]:
    """(matchday, season) the page is talking about, from its own fixture links - or (None, None).

    The page states it and the clock cannot: in August the probabili page keeps serving the LAST round of
    the season that ended until the new one starts, and on 04/08/2026 that was 810 hrefs of 2025-26 at
    probability 1.0 - line-ups that were FIELDED, not forecast. Read from `/calendario/{md}/{season}/`,
    which every fixture on the page carries; when the page shows more than one round (it never has), the
    most frequent wins, because a page is a round and a tie would mean this is no longer the right anchor.
    """
    counts: dict[tuple[int, str], int] = {}
    for matchday, season in _PAGE_ROUND.findall(html):
        key = (int(matchday), season)
        counts[key] = counts.get(key, 0) + 1
    if not counts:
        return None, None
    (matchday, season), _n = max(counts.items(), key=lambda kv: kv[1])
    return matchday, season


def parse_probable_starters(html: str) -> list[dict]:
    """team-card blocks -> one record per listed player. fc_id comes from the href, not the name."""
    soup = BeautifulSoup(html, "lxml")
    # The season the page is about. Only a FALLBACK for the href's own segment, so a cached page from
    # before 05/08/2026 is still read exactly as it was: `rebuild` replays those files, and a parser that
    # changed its mind about them would rewrite history.
    _matchday, page_season = page_round(html)
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
                    "season": match.group(2) or page_season,
                    "team": team,
                    "formation": formation,
                    "role": (role.get("data-value") or "").upper() if role else None,
                    "starter": starters,
                    "probability": probability,
                    "status": item.get("data-status"),
                })
    return out


def _list_of(header):
    """The <ul> a section header owns: the first one BEFORE the next header, or None.

    Bounded on purpose. `find_next_sibling("ul")` walks to the end of the column, and a section whose
    own list is empty carries no <ul> at all - the site writes `<div class="empty-list-message">Nessuno`
    instead - so the header SWALLOWED the next section's list. Measured over the 20 cached pages of
    2026: 50 of the 611 lists were attributed that way, every one of them a `squalificati` header
    taking the `diffidati` list, i.e. men one booking away from a ban stored as men actually banned.
    """
    for sibling in header.find_next_siblings():
        if sibling.name == "header":
            return None
        if sibling.name == "ul":
            return sibling
    return None


def parse_unavailable(html: str) -> list[dict]:
    """team-card blocks -> (team, status, player surname, note) for injured/suspended/at-risk.

    The section is read from the <header> that NAMES it, never from the tag carrying the word, because
    that tag changed under us. Until 26/08/2026 all three headers were `<strong class="label">`; on
    01/09/2026 the injured one became an `<a class="label">` inside `<div class="aa-infirmary-label">`,
    so `strong.label` still matched the two lists that had NOT moved and the injured list silently went
    to zero. Measured on the cache: `strong.label` says "infortunati" 20 times on every page from 26/07
    to 26/08 and ZERO times on 01/09, where the page names 50 injured men - Yildiz among them, with a
    three-month risk on him. Same family as the `_PLAYER_HREF` change above, and the same cure: read
    the thing the page cannot rename without renaming what the reader sees.
    """
    soup = BeautifulSoup(html, "lxml")
    out: list[dict] = []
    for card in soup.select("div.team-card"):
        name_node = card.select_one(".team-name")
        team = name_node.get_text(strip=True) if name_node else None
        for header in card.select("header"):
            status = LIST_STATUS.get(header.get_text(" ", strip=True).lower())
            if not status:
                continue
            group = _list_of(header)
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
    # Bench/reserve rows carry no percentage but half the hierarchy signal (who sits behind whom,
    # in which module), so a NULL probability is stored, not skipped. R7's lesson: the full record
    # must accumulate from day one - a field discarded today cannot be backfilled for past windows.
    stored = 0
    for rec in records:
        if not conn.execute("SELECT 1 FROM players WHERE fc_id = ?", (rec["fc_id"],)).fetchone():
            # a player we have never seen (a new signing): keep the foreign key honest
            conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)",
                         (rec["fc_id"], str(rec["fc_id"])))
        conn.execute(
            # A ROW THAT KNOWS ITS SEASON IS NEVER REPLACED BY ONE THAT DOES NOT. The PK is
            # (fc_id, valid_from) and the euro pages - stored with an unknown season on purpose, so
            # no sheet reads them - are ingested AFTER the Serie A page in the same run: with a plain
            # INSERT OR REPLACE they were overwriting the Serie A reading of every player whose club
            # is also on the euro platform, i.e. exactly the ten biggest clubs, and the day's
            # freshest probabili survived only for Cagliari, Frosinone, Genoa & co. Found 03/09/2026
            # because the full `update` repairs it by accident (the sheets step re-reads the Serie A
            # page after the euro one), so any run that stops before the sheets left the day
            # clobbered. Same rule as `load_reference` (20/08/2026), on the WRITER's side: an empty
            # reading does not override a full one, not even a more recent one.
            "INSERT INTO probable_starter("
            "    fc_id, valid_from, probability, source, team, formation, starter, role, status, "
            "    season) "
            "VALUES (?, ?, ?, 'fc_site', ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(fc_id, valid_from) DO UPDATE SET "
            "    probability = excluded.probability, source = excluded.source, "
            "    team = excluded.team, formation = excluded.formation, "
            "    starter = excluded.starter, role = excluded.role, status = excluded.status, "
            "    season = excluded.season "
            "WHERE NOT (probable_starter.season IS NOT NULL AND excluded.season IS NULL)",
            (rec["fc_id"], date, rec["probability"], rec.get("team"), rec.get("formation"),
             1 if rec.get("starter") else 0, rec.get("role"), rec.get("status"),
             # The parser has always read it out of the href and it was thrown away here: the page states
             # which season it is talking about, and the day of the reading does not.
             rec.get("season")),
        )
        stored += 1
    return stored


def _season_pools(conn, season: str, platform: str = "default"):
    """(by_club_key, league_pool) for the matcher, over the PAGE'S OWN perimeter.

    Fino al 26/08/2026 questa funzione filtrava `r.league = 'serie_a'` e la sua docstring diceva «these
    pages are Serie A» - vero quando le pagine erano due, falso dal 07/08/2026, quando sono state
    agganciate quelle euro (`-indisponibili-euro-leghe`). Il pool non conteneva un solo giocatore di
    Premier, Liga, Ligue 1 o Bundesliga, quindi un infortunato di quelle leghe non poteva combaciare PER
    COSTRUZIONE: si risolvevano soltanto gli uomini quotati ANCHE in Serie A - misurato quel giorno,
    **24 righe su 88**, con Bruno Guimaraes (Arsenal), Baleba (Manchester United), Asencio (Real Madrid)
    scartati mentre stavano nel registro col nome identico e col club identico a quello che la pagina
    dichiarava. Stessa forma del «ripiego corretto per un chiamante e muto per un altro»: una chiave che
    non combacia si legge come un dato che non c'e'.

    Il perimetro di una pagina euro e' il LISTONE euro, e «chi e' in quel listone» si chiede a
    `listone_quotes`, che e' l'unica tabella con la piattaforma nella chiave (`rosters` tiene l'ultima
    lettura e non sa dire quale dei due listoni l'ha scritta). Il ramo Serie A resta identico.
    """
    by_club: dict[str, list] = {}
    pool: list = []
    where, params = ("r.league = 'serie_a'", (season,))
    if platform == "euro":
        where = ("EXISTS (SELECT 1 FROM listone_quotes q WHERE q.fc_id = r.fc_id "
                 "AND q.season = r.season AND q.platform = 'euro')")
    rows = conn.execute(
        f"""
        SELECT r.fc_id, p.canonical_name, cl.canonical_name
        FROM rosters r
        JOIN players p USING(fc_id)
        LEFT JOIN clubs cl ON cl.fc_club_id = r.fc_club_id
        WHERE r.season = ? AND {where}
        """,
        params,
    ).fetchall()
    for fc_id, our_name, our_club in rows:
        entry = build_pool_entry(fc_id, our_name)
        by_club.setdefault(club_key(CLUB_ALIASES.get(our_club, our_club)), []).append(entry)
        pool.append(entry)
    return by_club, pool


def upsert_availability(conn, records: list[dict], season: str, date: str,
                        platform: str = "default") -> tuple[int, list[str], int]:
    """injured/suspended -> availability · booking_risk -> flags.

    Returns (stored, unresolved, dated) - and `dated` is in the signature so the RUN can print it: un
    canale nuovo che finisce a zero in silenzio e' esattamente come la lista degli infortunati che il
    01/09/2026 e' andata a zero per un tag rinominato, e nessuno se ne e' accorto per due giorni.

    `platform` is the PAGE's, not a preference: an entry of the euro list is looked for among the men
    that listone quotes (see `_season_pools`).
    """
    by_club, league_pool = _season_pools(conn, season, platform)
    stored = 0
    dated = 0
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
            # LA PROSA VIAGGIA CON LO STATO, e la data che ne esce accanto. `date` e' il giorno in cui la
            # PAGINA e' stata letta, che e' anche l'anno di riferimento del mese che la frase nomina.
            expected, basis = parse_return(rec.get("note"), date)
            conn.execute(
                "INSERT OR REPLACE INTO availability"
                "(fc_id, valid_from, status, source, note, expected_return, return_basis) "
                "VALUES (?, ?, ?, 'fc_site', ?, ?, ?)",
                (fc_id, date, rec["status"], rec.get("note"), expected, basis))
            dated += 1 if basis else 0
        stored += 1
    return stored, unresolved, dated


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
    # ONE ENTRY PER REAL PENALTY, and it has to be said out loud because it was not: a Serie A penalty
    # exists in `match_ratings` TWICE - once in the euro rows and once in the default ones, the same kick
    # under two matchday numberings that both translate to the same date - so the series a Serie A club's
    # hierarchy was built from was twice as long as its real one. The effect was not cosmetic: with the
    # weight of the k-th penalty decaying as DECAY**k, a doubled series applies the decay twice per real
    # penalty, so the memory was HALF as long for Serie A as for a foreign club (0.75 doubled behaves like
    # 0.56). Measured: 387 of 1675 (season, club, date, taker) tuples appeared more than once.
    # Keyed by the kick, with the max of the two platforms' counts: a genuine brace in one match is two
    # penalties on both platforms and stays two, while one platform holding a partial row cannot lose one.
    tally: dict[tuple, tuple[int, int]] = {}
    for season, platform, matchday, fc_id, scored, missed, club_id, league, mapped in rows:
        if club_id is None or league is None:
            continue
        real_md = matchday if platform == "default" else mapped
        date = dates.get((season, league, real_md)) if real_md else None
        if date is None:
            continue
        key = (season, club_id, date, fc_id)
        seen = tally.get(key, (0, 0))
        tally[key] = (max(seen[0], int(scored)), max(seen[1], int(missed)))
    events = []
    for (season, club_id, date, fc_id), (scored, missed) in tally.items():
        events += [(season, club_id, date, fc_id, False)] * scored
        events += [(season, club_id, date, fc_id, True)] * missed
    events.sort(key=lambda event: (event[0], event[1], event[2]))
    return events


def rank_takers(attempts: list[tuple[int, bool]], decay: float = DECAY,
                miss_penalty: float = MISS_PENALTY) -> list[tuple[int, float, str | None]]:
    """Newest-first attempts [(fc_id, missed)] -> [(fc_id, confidence, trigger_event)] ranked.

    A taker's weight decays with how many penalties ago they took theirs, so the hierarchy follows
    the club's recent behaviour instead of the season total; a taker whose LAST attempt was missed
    is quarantined (the spec's trigger), which is what lets a number two overtake.

    The two parameters are arguments and not just the module's constants because they are PROVISIONAL
    (gate 7-bis) and `modules/sweep.py` scores them: it replays every penalty in the DB, predicting the
    next taker from the ones before it. A constant no harness can vary is a constant nobody can sweep.
    """
    weights: dict[int, float] = {}
    last_missed: dict[int, bool] = {}
    for index, (fc_id, missed) in enumerate(attempts):
        weights[fc_id] = weights.get(fc_id, 0.0) + decay ** index
        last_missed.setdefault(fc_id, missed)
    total = sum(weights.values()) or 1.0
    ranked = []
    for fc_id, weight in weights.items():
        confidence = weight / total
        trigger = None
        if last_missed.get(fc_id):
            confidence *= miss_penalty
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
    # The euro pages are the same lists for the other platform, so they take the same parsers: one page
    # key per URL, one parser per KIND. `page.startswith` and not equality, or adding a platform would
    # silently ingest nothing at all.
    if page.startswith("probabili"):
        records = parse_probable_starters(html)
        stored = upsert_probable_starters(conn, records, date)
        teams = len({rec["team"] for rec in records if rec["team"]})
        seasons = sorted({rec["season"] for rec in records if rec.get("season")})
        # WHICH SEASON the page was about, printed because it is the difference between a forecast and a
        # record of a match already played: in August this list reads ['2025-26'] on a page fetched today.
        print(f"[fc_site] {page} {date}: {stored} probabilities over {teams} teams"
              + (f" · season {', '.join(seasons)}" if seasons else " · no player links yet"))
        # A PAGE THAT HAS PLAYERS AND YIELDS NO RECORDS IS A BROKEN PARSER, and it must say so instead of
        # printing a serene zero. That is exactly what happened for two weeks from 05/08/2026, when the
        # site dropped the season segment from the player href: 20 team cards, 461 `li.player-item`, and
        # "no player links yet" every day - indistinguishable, on the log, from a page not published yet.
        # `is_published` cannot catch it: the site publishes the page, we stop reading it.
        listed = html.count("player-item")
        if listed and not records:
            print(f"[fc_site] {page} {date}: PARSER BROKEN - the page lists {listed} players and none "
                  f"was read. The selectors or the href shape changed: fix them before trusting any "
                  f"starter column, because this state cannot be backfilled.")
        if records and not seasons:
            print(f"[fc_site] {page} {date}: the page does not say which SEASON it is about (no "
                  f"/calendario/ link and no season in the hrefs), so the rows are stored with an "
                  f"unknown season and no sheet will read them - empty is unknown, never current.")
    elif page.startswith("indisponibili"):
        records = parse_unavailable(html)
        stored, unresolved, dated = upsert_availability(
            conn, records, season, date, "euro" if page.endswith("_euro") else "default")
        kinds: dict[str, int] = {}
        for rec in records:
            kinds[rec["status"]] = kinds.get(rec["status"], 0) + 1
        detail = " ".join(f"{key}={value}" for key, value in sorted(kinds.items()))
        print(f"[fc_site] {page} {date}: {stored}/{len(records)} resolved [{detail}] "
              f"- {dated} con una data di rientro dalla prosa")
        # THE SAME GUARD THE PROBABILI BRANCH ALREADY CARRIES, and this branch needed it: on 01/09/2026
        # the injured header changed tag, the parser read 1 of the 41 men the page names, and the line
        # above printed «1/1 resolved [suspended=1]» - a success. Every `.item-name` node is one record
        # by construction, so the comparison is exact rather than a threshold: measured over the 22
        # published pages in cache, records == item-name on 22 of 22.
        listed = html.count('class="item-name"')
        if listed != len(records):
            print(f"[fc_site] {page} {date}: PARSER BROKEN - the page names {listed} men and "
                  f"{len(records)} were read. The markup of a section moved: fix it before trusting "
                  f"any availability column, because this state cannot be backfilled.")
        if unresolved:
            names = ", ".join(sorted(unresolved)[:8]).encode("ascii", "replace").decode()
            print(f"[fc_site] {len(unresolved)} names not matched: {names}")
    elif page.startswith("rigoristi"):
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


def reingest_from_cache(ctx: Context, pages=None) -> None:
    """Replay every dated snapshot in order, so a rebuild reconstructs the whole state history.

    `pages` narrows the replay to some of them, like `positions.reingest_from_cache(seasons=...)`, and
    it exists for the case that produced it: a COLUMN added to a table this module writes needs the
    old snapshots re-read to be filled, and re-reading the probabili to fill a column of
    `availability` is a few thousand rows rewritten for nothing. `rebuild` still calls it with no
    argument, which is the whole history and stays the canonical path.
    """
    conn = ctx.require_conn()
    season = _latest_season(conn)
    snapshots = []
    for path in ctx.config.cache_dir.glob("fc_site_*.html"):
        match = _SNAPSHOT.search(path.name)
        if match and (pages is None or match.group(1) in pages):
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
