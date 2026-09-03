"""fixtures - the calendar STILL TO BE PLAYED, per club, from the SofaScore team endpoint.

Why a module of its own. Everything else in this toolkit measures football that HAPPENED:
`external_match_stats` is played matches, `match_ratings` is votes, `club_match_lineups` is elevens
that were fielded. «Quante partite facili ha un calciatore da qui alla fine» is a question about
matches that have NOT happened, and the DB could not answer it at all - `assistente-asta-v1.md` §21.4
records exactly that gap, and §23.4 freezes the column that waits for it.

WHY THIS SOURCE, and the two that were tried first (10/08/2026):
  * ClubElo publishes `/Fixtures`, and it is NOT the calendar: measured, 104 rows over five days,
    mostly cups and minor leagues. It is a short-horizon endpoint and cannot say what is left.
  * FBref would have the full season table, and `fbref.py` is still a stub (`not_implemented`), so it
    would mean writing a whole source.
  * SofaScore is already ours: `club_xref` holds 93 team ids, `positions.py` owns the session that can
    read the API at all, and `/team/{id}/events/next/{page}` returns the club's remaining fixtures with
    the ROUND number inside. Measured on Atalanta: 41 future events in 2 pages, of which the whole
    38-round Serie A calendar of 2026-27.

Two rules this module does not bend:
  * a club joins through its CANONICAL KEY (`matching.club_identity`), never through the provider's
    string. The same join done by name once lost AC Milan, AS Roma and SSC Napoli from every club's
    schedule, unevenly, which is worse than losing them uniformly (§21.7).
  * an opponent OUTSIDE our perimeter is a real club with a real strength: he gets a row and a key even
    though no `fc_club_id` exists for him, because `club_levels` is keyed the same way and that is
    where his Elo lives.

Cache: one file per club under `data/cache/sofascore_fixtures_{tid}.json`, so `rebuild` re-ingests
offline like every other source. A calendar CHANGES (postponements), so the cache is refreshed on
request and every row carries `observed_on` - the rule this project wrote down after a per-match layer
sat frozen at 28/07 through the whole of August.
"""

from __future__ import annotations

import datetime as dt
import json

from euroleghe_ingest import matching
from euroleghe_ingest.context import Context
from euroleghe_ingest.modules import positions

NAME = "fixtures"
DESCRIPTION = "SofaScore -> the remaining calendar per club (fixtures), keyed by the match"
DEPENDS_ON: list[str] = ["rosters", "positions"]
RAW_INPUTS: list[str] = []
NETWORK = True

EVENTS_ENDPOINT = positions.BASE_URL + "/team/{tid}/events/next/{page}"

# «Facile» as the operator froze it (assistente-asta-v1.md §23.4): I am much stronger, with the home
# bonus. Both constants are DECLARED here and neither is fitted - the second is measured and the first
# is a choice, and the difference is stated because a percentage without its threshold is not a fact.
# 200, the operator's choice of 10/08/2026, made with the trade-off in front of him: he asked that the
# strongest club stop reading «all of them», and at this threshold Bayern goes 34/34 -> 30/34. The price
# is at the other end and it is bigger: over the five leagues, clubs reading ZERO easy matches for a
# whole season go from 7 of 61 to 18. The count saturates at EVERY threshold - that is a property of a
# count, not of the value (§23.3) - which is why the continuous margin travels beside it: Bayern's +344
# says what «34/34» could not. Previous value 100 (expected score 0.64), kept here for provenance.
EASY_MARGIN = 200.0
TRIM_MIN_SAMPLE = 5        # operator's general rule, 10/08/2026: a mean used to JUDGE something drops
                           # its highest and lowest value, provided there are at least five of them -
                           # below that, dropping two of four is not a mean any more. It applies to
                           # descriptive numbers like this one; a mean that feeds a PREDICTION changes
                           # only through the gate (measured: as a predictor the trim is worth
                           # -0.0012 +/- 0.0077, indistinguishable from zero).
# The whole HOME-AWAY GAP, applied SYMMETRICALLY: +gap/2 at home, -gap/2 away. The operator asked for
# an away malus on 10/08/2026 and the malus was already there implicitly - not getting the home bonus IS
# the malus - so making it a separate term would have doubled the gap to 58 with nobody deciding it.
# Symmetric changes nothing about the gap and makes an away trip PAY instead of being the neutral case.
#
# MEASURED: 1140 Serie A matches of 23-24..25-26, home score share 0.5412 (25 over 2657 matches and
# seven seasons; per-season standard error +-18, so it is a constant with a date and NOT an annual
# series). Raising it is a CHOICE AGAINST A MEASUREMENT and belongs to the operator: measured on this
# calendar, only a gap of ~100 - 3.4x the real one - makes Bayern's away matches read harder than its
# home ones (13/17 against 16/17), and the convention of 60-100 is precisely what §23.1 refuted.
HOME_AWAY_GAP = 29.0
HOME_ADVANTAGE = HOME_AWAY_GAP / 2.0     # what a home side adds; an away side subtracts the same

# MULTIPLICATIVE field factors were asked for on 10/08/2026 (x1.10 at home, x0.80 away) and are
# REFUTED, so they are recorded here instead of being tried again. Measured on the 2657 Serie A matches
# rebuilt from `match_ratings` (home score share 0.5359, goals 1.42 vs 1.23 - the same numbers §23.1
# published), log-loss of the actual result, lower is better:
#   no field effect        0.63092
#   ADDITIVE h = 30        0.62783   <- best
#   proportional f = 1.018 0.62807   (i.e. +29 on 1600: the data's own factor is 1.8%, not 10%)
#   the factors 1.10/0.80  1.25787   <- twice as bad as ignoring the field altogether
# And the test that decides between the two shapes: the home advantage by the HOME club's strength is
# 60 points under Elo 1550, 30 in the middle, 15 above 1750 - it DECREASES with strength, the opposite
# of what a factor does. Fitted on 2019-23 and tested on 2023-26 that banded version does not survive
# (0.62951 against 0.62822 for a constant), while the value already in use wins out of sample:
#   h = 29                 0.62803   <- best of all, on 1140 held-out matches
# So the right weight is the one that was already there, and it is a CONSTANT.


# ---------------------------------------------------------------------------------------------------
# WHAT «FACILE» MEANS, MEASURED AGAINST THE QUESTION IT IS ASKED FOR (03/09/2026).
#
# `EASY_MARGIN` above was frozen by the operator on a different criterion - «the strongest club must
# stop reading all of them» - and the auction board now asks it to answer a different sentence of his:
# «una partita facile e' una partita dove la squadra in cui gioca il portiere e' probabile che subira'
# 0 gol». Those are two claims, so the label was VALIDATED instead of reused on trust.
#
# Measured on 5354 Serie A club-matches, 2019-20..2026-27 (opponent and venue from the per-match layer,
# goals conceded from the votes' own `role='P'` rows, so the count passes through no identity funnel;
# both clubs' level from `club_levels`). Logistic on the SAME edge `easy_matches` computes:
#
#     edge  -200 -> 0.141      edge  +100 -> 0.320      edge  +300 -> 0.487
#     edge     0 -> 0.249      edge  +200 -> 0.401      edge  +400 -> 0.575
#
# So the frozen margin of 200 IS the operator's sentence: at it, P(clean sheet) = 0.401, and the 40%
# level is reached at an edge of 199. Two numbers already in this repository, measured on two unrelated
# criteria a month apart, landing on each other - the threshold he chose by eye and `club_defence.
# CLEAN_SHEET_SHARE` = 0.40, itself measured as the quota at which «una porta resta inviolata spesso».
# Held out on the label itself: matches classified easy keep a clean sheet 42.8% of the time against
# 23.9% for the rest. Calibration by decile of predicted probability is within 0.03 everywhere except
# the top tenth, which the model OVER-states (0.473 predicted against 0.423 realised) - stated because
# that is the decile the auction board's best pairings are made of.
#
# MEASURED AND NOT ADOPTED, on purpose: for a CLEAN SHEET the home advantage fits at a half-gap of
# 30-35 Elo points and not at the 14.5 this module uses, which was fitted on the RESULT (log-loss of
# the actual outcome, `HOME_AWAY_GAP` above). Held-out log-loss over 2320 matches: 0.57796 at H=35
# against 0.57839 at H=14.5 and 0.57936 with no field effect at all - an interior optimum, so the
# DIRECTION is identified (keeping a clean sheet is a more home-dependent thing than winning), and it
# moves 3% of the classifications and 0.0004 of log-loss. That is not worth a SECOND home constant in a
# module whose whole output is reporting: two constants for one venue is how a screen ends up with two
# answers to «is this match at home». Recorded here so nobody re-measures it, and so that whoever wants
# it has the number.
CLEAN_SHEET_INTERCEPT = -1.104293
CLEAN_SHEET_SLOPE_PER_100 = 0.351375
# The population the two coefficients above belong to, and therefore the only league they may be
# applied to. A fitted transform belongs to the population it was fitted on: the other four
# championships have no goals-conceded layer here, so nothing was fitted there and nothing is claimed.
CLEAN_SHEET_LEAGUES: frozenset[str] = frozenset({"serie_a"})
CLEAN_SHEET_SAMPLE = 5354


def edge(mine: float, theirs: float, at_home: bool, home_bonus: float = HOME_ADVANTAGE) -> float:
    """How much stronger this club is in THIS match: its level, the venue, and the opponent's level.

    One definition, because `easy_matches` counts with it and the calendar the app reads is built from
    it - two spellings of one subtraction is how the same match ends up easy on one screen and not on
    the other. Note the identity the callers rely on: the away side's edge is exactly minus the home
    side's, so one number per match says both.
    """
    return (mine + (home_bonus if at_home else -home_bonus)) - theirs


def clean_sheet_probability(club_edge: float) -> float:
    """P(this club concedes nothing in this match), from the edge alone. Serie A only - see above."""
    import math
    return 1.0 / (1.0 + math.exp(-(CLEAN_SHEET_INTERCEPT
                                   + CLEAN_SHEET_SLOPE_PER_100 * club_edge / 100.0)))


def _elo_year(season: str) -> str:
    """The Elo snapshot a season is judged on: the year it kicks off in."""
    return season.split("-")[0]


def easy_matches(conn, season: str, club_key: str, *, league: str | None = None,
                 since: str | None = None, until: str | None = None,
                 margin: float = EASY_MARGIN, home_bonus: float = HOME_ADVANTAGE) -> dict:
    """How many of a club's remaining matches are EASY, and by how much on average.

    Two numbers from one measurement, because the count saturates and the mean does not: at +100 seven
    to nine Serie A clubs of twenty read 0/8 or 8/8 over an eight-round window, and for them the count
    carries no calendar information at all (§23.3). The mean signed margin keeps it.

    `n` counts the matches it could CLASSIFY - both clubs' Elo known - and `unclassified` says how many
    it could not, because a percentage over half a calendar is a different quantity (§22.3). Outside
    Serie A the opponents of a perimeter club are largely outside the perimeter, so this is not a
    detail: it is the coverage the cell has to declare.
    """
    year = _elo_year(season)
    levels = {key: elo for key, elo in conn.execute(
        "SELECT club_key, elo FROM club_levels WHERE year = ?", (year,))}
    if not levels:
        latest = conn.execute("SELECT MAX(year) FROM club_levels WHERE year <= ?", (year,)).fetchone()
        year = (latest or [None])[0]
        if year:
            levels = {key: elo for key, elo in conn.execute(
                "SELECT club_key, elo FROM club_levels WHERE year = ?", (year,))}

    sql = ("SELECT home_key, away_key, date, round FROM fixtures "
           "WHERE season = ? AND played = 0 AND (home_key = ? OR away_key = ?)")
    params: list = [season, club_key, club_key]
    if league:
        sql += " AND league = ?"
        params.append(league)
    if since:
        sql += " AND date >= ?"
        params.append(since)
    if until:
        sql += " AND date <= ?"
        params.append(until)

    mine = levels.get(club_key)
    easy = 0
    classified: list[float] = []
    unclassified = 0
    for home_key, away_key, _date, _round in conn.execute(sql + " ORDER BY date", params):
        at_home = home_key == club_key
        theirs = levels.get(away_key if at_home else home_key)
        if mine is None or theirs is None:
            unclassified += 1
            continue
        gap = edge(mine, theirs, at_home, home_bonus)
        classified.append(gap)
        if gap > margin:
            easy += 1
    # The CONTINUOUS reading, which does not saturate where the count does - and it is a mean used to
    # JUDGE a calendar, so it drops the easiest and the hardest match (the operator's general rule). The
    # COUNT stays whole: `k/n` is a count, not a mean, and trimming it would change what it says.
    trimmed = sorted(classified)[1:-1] if len(classified) >= TRIM_MIN_SAMPLE else classified
    return {
        "easy": easy,
        "n": len(classified),
        "share": (easy / len(classified)) if classified else None,
        "margin": (sum(trimmed) / len(trimmed)) if trimmed else None,
        # Says WHICH mean the row carries instead of leaving the reader to guess.
        "margin_trimmed": len(classified) >= TRIM_MIN_SAMPLE,
        "margin_of": len(trimmed),
        "unclassified": unclassified,
        "elo_year": year,
        "threshold": margin,
        "home_bonus": home_bonus,
    }

# The provider says `26/27`, we say `2026-27`. One place, so nothing downstream guesses.
def _our_season(year: str | None) -> str | None:
    if not year:
        return None
    if "/" in year:
        first, second = year.split("/", 1)
        if len(first) == 2 and len(second) == 2:
            return f"20{first}-{second}"
    if len(year) == 4 and year.isdigit():
        # A single-year competition (a summer tournament): the season it belongs to is that year.
        return f"{year}-{str(int(year) + 1)[-2:]}"
    return year


def _league_key(event: dict) -> str | None:
    """OUR championship key, or the provider's slug for anything that is not one of the five."""
    tournament = event.get("tournament") or {}
    unique = tournament.get("uniqueTournament") or {}
    provider_id = unique.get("id")
    for key, tid in positions.known_leagues().items():
        if provider_id == tid:
            return key
    slug = unique.get("slug") or tournament.get("slug")
    return slug or None


def parse_events(events: list[dict], observed_on: str,
                 keys_by_id: dict[str, str] | None = None) -> list[dict]:
    """Provider events -> `fixtures` rows. Pure, so a test can read a real payload offline.

    `keys_by_id` maps the provider's TEAM ID to our canonical key, and it is the only reliable bridge
    for a club we carry: `club_identity` reconciles a lot of spellings and not all of them - measured
    10/08/2026, «Hellas Verona» and «Bayern Munich» never met our «Verona» and «Bayern Monaco», so both
    read ZERO remaining matches while every other club was right. A club we do NOT carry has no id in
    the map and keeps the name-derived key, which is what `club_levels` is keyed on anyway.
    """
    keys_by_id = keys_by_id or {}

    def key_of(team: dict) -> str:
        source_id = str(team.get("id")) if team.get("id") else None
        return keys_by_id.get(source_id) or matching.club_identity(team["name"])
    rows: list[dict] = []
    for event in events or []:
        home = event.get("homeTeam") or {}
        away = event.get("awayTeam") or {}
        stamp = event.get("startTimestamp")
        league = _league_key(event)
        season = _our_season(str((event.get("season") or {}).get("year") or "") or None)
        if not (event.get("id") and home.get("name") and away.get("name") and stamp and league and season):
            continue
        rows.append({
            "event_id": str(event["id"]),
            "season": season,
            "league": league,
            "round": (event.get("roundInfo") or {}).get("round"),
            "date": dt.datetime.fromtimestamp(stamp, tz=dt.UTC).date().isoformat(),
            "home_key": key_of(home),
            "away_key": key_of(away),
            "home_source_id": str(home.get("id")) if home.get("id") else None,
            "away_source_id": str(away.get("id")) if away.get("id") else None,
            "played": 1 if (event.get("status") or {}).get("type") == "finished" else 0,
            "source": "sofascore",
            "observed_on": observed_on,
        })
    return rows


def store(conn, rows: list[dict]) -> int:
    """Upsert by event id: a postponement MOVES a match, it does not add one."""
    for row in rows:
        conn.execute(
            """INSERT INTO fixtures(event_id, season, league, round, date, home_key, away_key,
                                    home_source_id, away_source_id, played, source, observed_on)
               VALUES (:event_id, :season, :league, :round, :date, :home_key, :away_key,
                       :home_source_id, :away_source_id, :played, :source, :observed_on)
               ON CONFLICT(event_id) DO UPDATE SET
                   season = excluded.season, league = excluded.league, round = excluded.round,
                   date = excluded.date, home_key = excluded.home_key, away_key = excluded.away_key,
                   played = excluded.played, observed_on = excluded.observed_on""",
            row)
    conn.commit()
    return len(rows)


def schedule(conn, season: str, leagues: tuple[str, ...] | list[str]) -> dict:
    """THE CALENDAR STILL TO BE PLAYED, per championship, priced by the edge - for the app to read.

    Why the toolkit computes it and the app only counts. Whether a match is EASY is a claim about
    football - it needs both clubs' level, the venue and a threshold - and a claim about football is a
    measurement, so it lives where the harnesses can reach it. Counting how many of them fall inside a
    window and belong to a pair of clubs is arithmetic about the operator's own competition settings,
    which live in the app. Same boundary that puts a real club's drawn board in `boards.py` and a fanta
    eleven in `core/fanta-eleven.ts`.

    THE APP JOINS BY THE CANONICAL KEY AND NEVER BY A NAME, which is why `clubs` here carries both: the
    key `club_levels` and `fixtures` are keyed on, and OUR canonical name where the club is one of ours,
    so a sheet row and a fixture meet on a string that was resolved once, here. A club outside the
    perimeter has no name of ours and keeps its key - it is an opponent, not a row to buy from.

    ONE NUMBER PER MATCH SAYS BOTH SIDES: the away edge is exactly minus the home edge, so `edge` is the
    home side's and the reader negates it. The clean-sheet probability cannot be derived that way - it is
    a logistic of the edge - so both are written, and both are NULL outside the league the coefficients
    were fitted on, which is «a fitted transform belongs to the population it was fitted on» and not an
    oversight.
    """
    year = _elo_year(season)
    levels = {key: value for key, value in conn.execute(
        "SELECT club_key, elo FROM club_levels WHERE year = ?", (year,))}
    if not levels:
        latest = conn.execute("SELECT MAX(year) FROM club_levels WHERE year <= ?", (year,)).fetchone()
        year = (latest or [None])[0]
        if year:
            levels = {key: value for key, value in conn.execute(
                "SELECT club_key, elo FROM club_levels WHERE year = ?", (year,))}

    ours = {matching.club_identity(name): (fc_club_id, name) for fc_club_id, name in conn.execute(
        "SELECT fc_club_id, canonical_name FROM clubs")}

    out: dict[str, dict] = {}
    for league in leagues:
        rows = conn.execute(
            "SELECT round, date, home_key, away_key FROM fixtures "
            "WHERE season = ? AND league = ? AND played = 0 AND round IS NOT NULL "
            "ORDER BY round, date", (season, league)).fetchall()
        if not rows:
            continue
        rated = league in CLEAN_SHEET_LEAGUES
        matches: list[list] = []
        unclassified = 0
        keys: set[str] = set()
        for rnd, date, home, away in rows:
            keys.update((home, away))
            at_home, at_away = levels.get(home), levels.get(away)
            if at_home is None or at_away is None:
                # «vuoto = ignoto, mai zero»: a match whose two levels we cannot both read is carried
                # with no edge at all, so the app draws it in the popover and counts it nowhere.
                matches.append([rnd, date, home, away, None, None, None])
                unclassified += 1
                continue
            gap = edge(at_home, at_away, True)
            matches.append([
                rnd, date, home, away, round(gap, 1),
                round(clean_sheet_probability(gap), 4) if rated else None,
                round(clean_sheet_probability(-gap), 4) if rated else None,
            ])
        out[league] = {
            "rounds": max(int(row[0]) for row in rows),
            "unclassified": unclassified,
            # Whether the two probability columns carry anything, and WHY when they do not: a reader
            # that finds them empty must know it is a population limit and not a missing run.
            "clean_sheet_fitted": rated,
            "clubs": sorted(
                ({"key": key, "elo": levels.get(key),
                  "name": ours.get(key, (None, None))[1],
                  "fc_club_id": ours.get(key, (None, None))[0]}
                 for key in keys),
                key=lambda club: club["key"]),
            "columns": ["round", "date", "home", "away", "edge_home", "cs_home", "cs_away"],
            "matches": matches,
        }
    return {
        "season": season,
        "elo_year": year,
        "observed_on": (conn.execute(
            "SELECT MAX(observed_on) FROM fixtures WHERE season = ?", (season,)).fetchone()
            or [None])[0],
        "easy_margin": EASY_MARGIN,
        "home_advantage": HOME_ADVANTAGE,
        "clean_sheet": {
            "intercept": CLEAN_SHEET_INTERCEPT,
            "slope_per_100": CLEAN_SHEET_SLOPE_PER_100,
            "sample": CLEAN_SHEET_SAMPLE,
            "leagues": sorted(CLEAN_SHEET_LEAGUES),
            "at_margin": round(clean_sheet_probability(EASY_MARGIN), 4),
            "_note": "P(the club concedes nothing), logistic on the same edge the easy count uses. "
                     "Fitted on Serie A only - the other championships have no goals-conceded layer "
                     "here, so nothing was fitted there and nothing is claimed.",
        },
        "leagues": out,
    }


def club_keys_by_source_id(conn) -> dict[str, str]:
    """provider team id -> OUR canonical key, for every club we carry."""
    return {str(source_id): matching.club_identity(name) for source_id, name in conn.execute(
        "SELECT x.source_id, c.canonical_name FROM club_xref x JOIN clubs c USING (fc_club_id) "
        "WHERE x.source = 'sofascore'")}


def _clubs(conn, leagues: list[str] | None) -> list[tuple[str, str]]:
    """(sofascore team id, canonical name) for the clubs we can ask about."""
    sql = ("SELECT x.source_id, c.canonical_name FROM club_xref x JOIN clubs c USING (fc_club_id) "
           "WHERE x.source = 'sofascore'")
    params: list = []
    if leagues:
        sql += f" AND c.league IN ({','.join('?' * len(leagues))})"
        params = list(leagues)
    return list(conn.execute(sql + " ORDER BY c.canonical_name", params))


def run(ctx: Context, *, leagues: list[str] | None = None, refresh: bool = False,
        pages: int = 3, **kwargs) -> dict:
    """One request per club per page, cached. `--refresh` re-reads a calendar that may have moved."""
    conn = ctx.require_conn()
    cache = ctx.config.cache_dir
    cache.mkdir(parents=True, exist_ok=True)
    observed_on = dt.datetime.now(tz=dt.UTC).date().isoformat()

    clubs = _clubs(conn, leagues)
    if not clubs:
        raise RuntimeError("no club has a sofascore id yet: run `positions` first")
    keys_by_id = club_keys_by_source_id(conn)

    session = None
    written = 0
    fetched = 0
    seasons: dict[str, int] = {}
    for tid, name in clubs:
        path = cache / f"sofascore_fixtures_{tid}.json"
        payload: list[dict] | None = None
        if path.exists() and not refresh:
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except ValueError:
                payload = None
        if payload is None:
            session = session or positions._client()
            payload = []
            for page in range(pages):
                data = positions._get_json(session, EVENTS_ENDPOINT.format(tid=tid, page=page))
                if not data:
                    break
                payload += data.get("events") or []
                if not data.get("hasNextPage"):
                    break
            fetched += 1
            positions._atomic_write_text(path, json.dumps(payload, ensure_ascii=False))
        rows = parse_events(payload, observed_on, keys_by_id)
        written += store(conn, rows)
        for row in rows:
            seasons[row["season"]] = seasons.get(row["season"], 0) + 1
        print(f"[fixtures] {name}: {len(rows)} partite"
              f"{'' if payload is None else ''}")

    total = conn.execute("SELECT COUNT(*) FROM fixtures").fetchone()[0]
    print(f"[fixtures] {written} righe scritte da {len(clubs)} club ({fetched} scaricati), "
          f"{total} in tabella · per stagione: "
          + ", ".join(f"{season} {count}" for season, count in sorted(seasons.items())))
    return {"clubs": len(clubs), "written": written, "fetched": fetched, "rows": total}
