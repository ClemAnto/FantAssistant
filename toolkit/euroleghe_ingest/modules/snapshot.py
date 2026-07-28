"""snapshot - everything needed to build the action plan for an initial auction, as of TODAY.

One command per auction, run on the day you sit down to prepare it. It refreshes the volatile states
that only exist "now", then writes a dated folder under data/reports/ with one row per player, one row
per club, and a manifest saying what each number is and how much it can be trusted.

THE ONE RULE THIS MODULE OBEYS. The output is split in two, in the CSV header itself:

  * `engine_*`      the valuation the gate validated: predicted fantamedia, expected appearances,
                    VALUE, SURPLUS, the role's replacement level. Produced by calling `engine/` -
                    never re-implemented here - with the ADOPTED rule set for the platform and the
                    parameters fitted on a window that is not the one being predicted.
  * `desc_*`        DESCRIPTIVE columns, computed here and NOT gated: form over the last matches,
                    injury propensity, expected minutes, starting duels, bonus propensity, penalty
                    duty, discipline, contract situation. They are for the human reading the sheet.
                    NONE of them may be turned into a coefficient without a pre-registered gate run -
                    six families of fantamedia hypotheses have already died that way.

Anything the sources cannot answer is a column of NULLs with the reason in the manifest, never a
plausible-looking number. Two of those are worth knowing before reading the sheet:

  * "rapporto con la società" is NOT measurable from any source in the whitelist. What IS measurable
    sits in `desc_contract_until` / `desc_exit_risk` / `desc_arrival*` / `desc_seasons_at_club` /
    `desc_new_coach`, and those are proxies for it, not it.
  * set-piece duty beyond penalties is NOT available: the votes API never fills `assists_set_piece`,
    so corners and free kicks cannot be attributed. Penalties are, and they are revealed from our own
    votes rather than from an editorial list.

The auction date is `min(the target season's 15 August, today)`: for the season being auctioned that is
today, so today's probabili and injuries count; for a season already played it is that season's own
auction day, so a dry run cannot read the future it is pretending not to know.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import os
from pathlib import Path

from euroleghe_ingest.context import Context
from euroleghe_ingest.engine import evaluate, features
from euroleghe_ingest.modules import positions

NAME = "snapshot"
DESCRIPTION = "Today's auction snapshot: refresh the volatile state, then one row per player + per club"
DEPENDS_ON: list[str] = ["rosters"]
RAW_INPUTS: list[str] = []
NETWORK = True          # only the editorial refresh; everything else is computed from the DB

# How many recent matches "form" is measured over. The user's own number, and it is a WINDOW, not a
# model parameter: nothing downstream fits on it.
FORM_MATCHES = 10
# A starting duel: two players of the same club and role whose starting probabilities are this close.
# A threshold for a human reading a sheet, not a coefficient.
BALLOTTAGGIO_MARGIN = 0.25
# How many seasons of injuries the propensity looks back over, newest first, with these weights.
INJURY_WEIGHTS: tuple[float, ...] = (1.0, 0.6, 0.35)
# Above this share of its complete elevens, a club's modal shape is the coach's PREFERRED formation
# rather than one of several he alternates. A reading threshold, stated in the sheet, not a coefficient.
FORMATION_SETTLED = 0.60

# How far back an appearance still says "he is in this squad". Fourteen months, so a full season plus a
# transfer window fits and the season before it does not: with no bound at all a player's last
# appearance EVER counted, which put two retired keepers in Inter's 2026 squad.
SQUAD_APPEARANCE_MONTHS = 14


def _months_before(date: str, months: int) -> str:
    year, month, day = (int(part) for part in date.split("-"))
    month -= months
    year += (month - 1) // 12
    month = (month - 1) % 12 + 1
    return f"{year:04d}-{month:02d}-{min(day, 28):02d}"


# ---------------------------------------------------------------- window
def season_of(date: str) -> str:
    """The season a date belongs to: July onwards opens the new one ('2026-07-28' -> '2026-27')."""
    year, month = int(date[:4]), int(date[5:7])
    start = year if month >= 7 else year - 1
    return f"{start}-{(start + 1) % 100:02d}"


def resolve_window(conn, season: str | None = None,
                   today: str | None = None) -> tuple[features.Window, str | None]:
    """(window, note). The target is the season being AUCTIONED, listone or not.

    The default target is the season today belongs to - not the newest listone. That is the whole point
    of the exercise: in July the auction being prepared is for a season whose listone does not exist
    yet, and the sheet has to work anyway, off the real squads. When the listone IS out it simply adds
    the roles and the quotations on top.
    """
    seasons = [row[0] for row in conn.execute(
        "SELECT DISTINCT season FROM rosters ORDER BY season")]
    if not seasons:
        raise RuntimeError("no rosters in the DB - run `bootstrap` (or at least `ratings`) first")
    today = today or dt.datetime.now(tz=dt.UTC).date().isoformat()
    target = season or season_of(today)
    note = None
    if target not in seasons:
        note = (f"{target} has no listone yet (rosters = 0): the sheet is built from the REAL squads, "
                f"so roles come from each player's last listone row and there are no quotations to "
                f"show. Rerun it when the listone is out and the same command fills them in.")
    earlier = [value for value in seasons if value < target]
    input_season = earlier[-1] if earlier else target
    auction = min(f"{target.split('-')[0]}-08-15", today)
    return features.Window("SNAP", input_season, target, auction), note


# ---------------------------------------------------------------- the real squad
def club_index(conn):
    """A function mapping ANY spelling of a club to one canonical key.

    Necessary, not tidy: the fixtures are keyed by the provider's name ('FC Bayern München'), the
    listone says 'Bayern Monaco' and Transfermarkt says something else again. Keyed naively, the same
    club becomes three, which reads as a transfer that never happened and as a squad whose matches
    cannot be found.
    """
    from euroleghe_ingest.matching import CLUB_ALIASES, club_key

    canonical: dict[str, str] = {}
    for (name,) in conn.execute("SELECT canonical_name FROM clubs WHERE canonical_name IS NOT NULL"):
        for spelling in (name, CLUB_ALIASES.get(name, name)):
            canonical.setdefault(club_key(spelling), name)

    def resolve(name: str | None) -> tuple[str, str] | tuple[None, None]:
        """(key, our canonical name). The KEY is derived from the canonical name, not from the input:
        keyed on the input, 'Bayern Monaco' and 'FC Bayern München' both map to the same club and still
        land in two different buckets - which is what made half the squad look transferred."""
        if not name:
            return None, None
        ours = canonical.get(club_key(name))
        if ours is None:
            return club_key(name), name
        return club_key(ours), ours

    return resolve


def derive_squads(ctx: Context, date: str | None = None) -> dict[str, int]:
    """Who is REALLY in each club's squad today -> `squad_snapshot`. Offline, from three sources.

    An auction is prepared before the listone exists, so the sheet cannot be built from `rosters`.
    These are, strongest first:

      fc_site        the probabili page carries an exact fc_id in every href, so its 20 Serie A squads
                     are certain - but it is Serie A only;
      transfermarkt  the CURRENT squad page of each perimeter club (already cached by `injuries`),
                     resolved through player_xref: all five leagues, ~1400 players;
      appearances    whoever actually played for the club in its recent matches - the backstop, and the
                     only source for a club neither page covers.

    Dated on purpose: a squad is a fact about a DAY, and in August it changes weekly. Same discipline as
    every other volatile state - the snapshot then reads "the squad as of the auction date".
    """
    conn = ctx.require_conn()
    date = date or dt.datetime.now(tz=dt.UTC).date().isoformat()
    counts = {"fc_site": 0, "transfermarkt": 0, "appearances": 0}
    # Normalized ON WRITE: the three sources spell a club three ways, and a squad table keyed on the
    # provider's spelling cannot be joined to `clubs` - which is how a real squad ends up with no
    # league, no fixtures and no club in the sheet.
    resolve = club_index(conn)

    def canonical(name):
        return resolve(name)[1]

    # Each source is dated with ITS OWN date, never with the run's: writing today's probabili as if
    # they had been known on an August 2025 auction day is look-ahead, and the whole point of dating
    # these states is that a dry run cannot read the future it pretends not to know.
    latest_probabili = conn.execute(
        "SELECT MAX(valid_from) FROM probable_starter WHERE valid_from <= ?", (date,)).fetchone()[0]
    if latest_probabili:
        for fc_id, team, role in conn.execute(
                "SELECT fc_id, team, role FROM probable_starter WHERE valid_from = ?",
                (latest_probabili,)):
            conn.execute(
                "INSERT OR REPLACE INTO squad_snapshot(fc_id, valid_from, club, source, role_hint) "
                "VALUES (?, ?, ?, 'fc_site', ?)",
                (fc_id, latest_probabili, canonical(team), role))
            counts["fc_site"] += 1

    from euroleghe_ingest.modules.injuries import _SQUAD_CACHE, parse_squad

    xref = {source_id: fc_id for source_id, fc_id in conn.execute(
        "SELECT source_id, fc_id FROM player_xref WHERE source = 'transfermarkt'")}
    clubs = {tm_id: club for club, tm_id in conn.execute(
        "SELECT c.canonical_name, x.source_id FROM club_xref x JOIN clubs c USING(fc_club_id) "
        "WHERE x.source = 'transfermarkt'")}
    # The Transfermarkt pages already carry their own date in the file name, which is why a page
    # fetched today does not inform an auction dated last August.
    for path in sorted(ctx.config.cache_dir.glob("transfermarkt_squad_*.html")):
        key = _SQUAD_CACHE.search(path.name)
        club = clubs.get(key.group(1)) if key else None
        if not club:
            continue
        try:
            records = parse_squad(path.read_text(encoding="utf-8"))
        except OSError:
            continue
        for rec in records:
            fc_id = xref.get(rec["tm_id"])
            if fc_id is None:
                continue
            conn.execute(
                "INSERT OR REPLACE INTO squad_snapshot(fc_id, valid_from, club, source, role_hint) "
                "VALUES (?, ?, ?, 'transfermarkt', NULL)", (fc_id, key.group(2), canonical(club)))
            counts["transfermarkt"] += 1

    # The backstop: whoever appeared for a club RECENTLY is in that club's squad. Two bounds, both
    # learned from the sheet itself:
    #   * only a club we KNOW - otherwise the sheet grows rows for Al-Qadsiah and Rosenborg, clubs
    #     nobody in this league can buy from, arriving with no league and no fixtures;
    #   * only the last `SQUAD_APPEARANCE_MONTHS` - his LAST appearance EVER put Handanovic and Cordaz
    #     in Inter's 2026 squad, and made Lecce a 70-man club. A squad is who is there now.
    known_clubs = {name for (name,) in conn.execute(
        "SELECT canonical_name FROM clubs WHERE canonical_name IS NOT NULL")}
    # A club whose CURRENT squad page we have needs no backstop, and taking one anyway is what made
    # Bologna a 72-man club: everyone who appeared for it in fourteen months, including the men it sold
    # in January. Where the page exists it IS the squad; the backstop is for the clubs without one.
    with_page = {club for (club,) in conn.execute(
        "SELECT DISTINCT club FROM squad_snapshot WHERE source IN ('transfermarkt', 'fc_site')")}
    floor = _months_before(date, SQUAD_APPEARANCE_MONTHS)
    for fc_id, club in conn.execute(
            """SELECT e.fc_id, e.club FROM external_match_stats e
               JOIN (SELECT fc_id, MAX(match_date) AS last FROM external_match_stats
                     WHERE COALESCE(minutes, 0) > 0 AND match_date >= ? AND match_date < ?
                     GROUP BY fc_id) last
                 ON last.fc_id = e.fc_id AND last.last = e.match_date
               WHERE e.club IS NOT NULL AND COALESCE(e.minutes, 0) > 0
               GROUP BY e.fc_id""", (floor, date)):
        name = canonical(club)
        if name not in known_clubs or name in with_page:
            continue
        conn.execute(
            "INSERT OR REPLACE INTO squad_snapshot(fc_id, valid_from, club, source, role_hint) "
            "VALUES (?, ?, ?, 'appearances', NULL)", (fc_id, date, name))
        counts["appearances"] += 1
    conn.commit()
    total = conn.execute("SELECT COUNT(DISTINCT fc_id) FROM squad_snapshot").fetchone()[0]
    print(f"[snapshot] real squads: {total} players "
          f"(fc_site {counts['fc_site']}, transfermarkt {counts['transfermarkt']}, "
          f"appearances {counts['appearances']})")
    return counts


# ---------------------------------------------------------------- descriptive layers
# What KIND of match a performance happened in. Ten goals in friendlies are worth something, and much
# less than ten in a league - so the classes are reported side by side and never summed into one number.
# The slugs are the provider's own (`external_match_stats.competition`).
COMPETITION_CLASSES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("friendly", ("friendly", "amichevo", "club-friendly", "pre-season", "trophy")),
    ("continental", ("champions-league", "europa-league", "conference", "libertadores",
                     "sudamericana", "club-world", "super-cup", "supercoppa", "supercup")),
    ("national", ("world-cup", "euro-", "nations-league", "copa-america", "africa-cup", "asian-cup",
                  "qualification", "friendlies-international")),
    ("cup", ("coppa", "cup", "copa", "pokal", "dfb", "efl", "carabao", "fa-", "coupe")),
    ("league", ()),        # the fallback: our own five leagues and every other domestic championship
)


def competition_class(slug: str | None) -> str:
    lowered = (slug or "").lower()
    for label, needles in COMPETITION_CLASSES:
        if any(needle in lowered for needle in needles):
            return label
    return "league"


def squad_as_of(conn, date: str) -> tuple[dict[int, str], dict[int, str]]:
    """(club per player, source per player) from `squad_snapshot` as of a date.

    Precedence where the sources disagree: fc_site (an exact fc_id in the page) beats Transfermarkt
    (a resolved name) beats an appearance. Ties within a source go to the most recent observation.
    """
    order = {"fc_site": 0, "transfermarkt": 1, "appearances": 2}
    best: dict[int, tuple] = {}
    for fc_id, club, source, valid_from in conn.execute(
            "SELECT fc_id, club, source, valid_from FROM squad_snapshot WHERE valid_from <= ? "
            "ORDER BY valid_from", (date,)):
        rank = (order.get(source, 9), )
        current = best.get(fc_id)
        if current is None or rank <= current[0]:
            best[fc_id] = (rank, club, source, valid_from)
    return ({fc_id: entry[1] for fc_id, entry in best.items()},
            {fc_id: entry[2] for fc_id, entry in best.items()})


def club_matches(conn, auction_date: str, resolve, limit: int = FORM_MATCHES) -> dict[str, list[tuple]]:
    """Each club's last `limit` matches before the auction date: (date, match_id, competition).

    Two sources, unioned: `club_match_lineups` (one row per club-match of the five leagues we scrape)
    and the per-match rows themselves, which is what brings in the cups, the friendlies and the other
    championships `recent_form` fetched. Keyed by the canonical club, so the provider's spelling and
    the listone's agree. A match nobody appeared in and no lineup recorded does not exist for us, and
    the count says so rather than pretending it was a rest.
    """
    rows = conn.execute(
        """
        SELECT club, match_date, match_id, competition FROM club_match_lineups
        WHERE match_date IS NOT NULL AND match_date < ?
        UNION
        SELECT club, match_date, match_id, competition FROM external_match_stats
        WHERE match_date IS NOT NULL AND match_date < ? AND club IS NOT NULL
        ORDER BY match_date DESC
        """,
        (auction_date, auction_date),
    ).fetchall()
    out: dict[str, list[tuple]] = {}
    for club, date, match_id, competition in rows:
        key, _name = resolve(club)
        if key is None:
            continue
        bucket = out.setdefault(key, [])
        if len(bucket) < limit and all(str(match_id) != str(known[1]) for known in bucket):
            bucket.append((date, match_id, competition))
    return out


def _by_date(item: tuple):
    """Sort key for a fixture tuple: its date. A named function, so no closure captures a loop name."""
    return item[0]


# One token per match of the club's last ten, oldest first, so the strip reads left to right like a
# calendar. Deliberately compact: the sheet is a CSV a human also opens in Excel.
#   p:<rating>:<minutes>  he played        b  in the layer, no minutes: bench or left out
#   i                     inside a recorded INJURY spell on that date
#   s                     inside a recorded SUSPENSION - a different reason from an injury, and from a
#                         choice: the absence list carries it as its own kind
#   n                     no player-level data for that match at all - unknown, which includes not
#                         being in the squad. Never conflated with `b`.
def absence_spells(conn, auction_date: str) -> dict[int, list[tuple[str, str, str]]]:
    """(start, end, token) per player: 's' for a suspension, 'i' for anything else.

    A suspension is not an injury and not a choice, and the absence list already tells them apart -
    Transfermarkt lists "Squalifica" as its own kind, which `classify_injury` maps to `suspension`. The
    end is filled with the auction date when the spell is still open. A suspension nobody recorded reads
    as bench, which is the honest fallback: we do not know that he was banned.
    """
    out: dict[int, list[tuple[str, str, str]]] = {}
    for fc_id, start, end, kind in conn.execute(
            "SELECT fc_id, start_date, end_date, kind FROM injuries WHERE start_date <= ?",
            (auction_date,)):
        out.setdefault(fc_id, []).append(
            (start, end or auction_date, "s" if kind == "suspension" else "i"))
    return out


def club_form(conn, auction_date: str, observations, squads: dict[int, str],
              limit: int = FORM_MATCHES) -> dict[int, dict]:
    """Form measured over the last `limit` matches of the player's CLUB, not of the player.

    The difference is the whole point. A player's own last ten appearances hide the weeks he sat on the
    bench; his CLUB's last ten do not - a man who never came on reads `played 0 of 10`, which is the
    fact an auction needs. Where he changed club inside the window the two clubs' matches are merged in
    date order, so the sample follows the player and not a shirt.

    Two honesty rules, both learned the hard way on this very sheet:

    * a player with NO rows in the per-match layer (identity unresolved, or a league we do not scrape)
      reads UNKNOWN, not `0 of 10`. 231 of the 2025-26 listone are in that state, and reporting them as
      "never played" would be a lie about a fact we do not have. `desc_form_source` says which it is.
    * "named on the bench" and "not in the squad" are indistinguishable here, because the layer only
      stores a row for a player who got minutes. They are reported together as `unused`.

    Goals and assists are split league / other and never summed: ten goals in friendlies are worth
    something, and nothing like ten in a league.
    """
    resolve = club_index(conn)
    fixtures = club_matches(conn, auction_date, resolve, limit)
    spells = absence_spells(conn, auction_date)
    covered = {fc_id for (fc_id,) in conn.execute(
        "SELECT DISTINCT fc_id FROM external_match_stats")}
    # Which MATCHES we have player-level rows for at all. A club's last ten include cups and other
    # competitions we never scraped player-by-player: counting those as "he did not play" would turn a
    # gap in our data into a statement about the player. They are counted apart.
    with_players = {str(match_id) for (match_id,) in conn.execute(
        "SELECT DISTINCT match_id FROM external_match_stats WHERE match_date IS NOT NULL")}
    appearances: dict[int, dict[str, tuple]] = {}
    for fc_id, match_id, club, competition, date, minutes, started, rating, goals, assists in             conn.execute(
                """SELECT fc_id, match_id, club, competition, match_date, COALESCE(minutes, 0),
                          started, rating, COALESCE(goals, 0), COALESCE(assists, 0)
                   FROM external_match_stats
                   WHERE match_date IS NOT NULL AND match_date < ? AND COALESCE(minutes, 0) > 0""",
                (auction_date,)):
        appearances.setdefault(fc_id, {})[str(match_id)] = (
            club, competition, date, minutes, started, rating, goals, assists)
    # Who the club played, per match: a fact about the FIXTURE, so it is available for the matches he did
    # not play too - which is exactly where the strip needs it to become readable.
    opponents: dict[tuple[str, str], tuple[str, int]] = {}
    for match_id, club, opponent, home in conn.execute(
            """SELECT match_id, club, opponent, home FROM external_match_stats
               WHERE match_date IS NOT NULL AND match_date < ? AND opponent IS NOT NULL
               GROUP BY match_id, club""", (auction_date,)):
        key, _name = resolve(club)
        if key:
            opponents[(key, str(match_id))] = (opponent, home or 0)

    out: dict[int, dict] = {}
    for obs in observations:
        if obs.fc_id not in covered:
            out[obs.fc_id] = {"source": "not in the per-match layer (identity unresolved, or a "
                                        "competition we do not scrape): UNKNOWN, not zero"}
            continue
        mine = appearances.get(obs.fc_id, {})

        def build(clubs: dict[str, str], _mine=mine) -> list[tuple]:
            pool: list[tuple] = []
            for key in clubs:
                pool += [(date, match_id, competition, key)
                         for date, match_id, competition in fixtures.get(key, [])]
            pool.sort(key=_by_date, reverse=True)
            seen: set[str] = set()
            window: list[tuple] = []
            for date, match_id, competition, key in pool:
                if str(match_id) in seen:
                    continue
                seen.add(str(match_id))
                window.append((date, match_id, competition, key))
                if len(window) >= limit:
                    break
            return window

        # WHERE he is now, then which clubs that window actually spans. Two passes, because the two
        # depend on each other: the window comes from his clubs, and which clubs count comes from the
        # window's dates. A transfer inside the window is exactly the case this resolves - the sample
        # becomes his old club's matches up to the move and his new club's after it - while a club he
        # left three seasons ago stays out, which one pass over his whole career would not manage.
        clubs: dict[str, str] = {}
        for candidate in (squads.get(obs.fc_id), obs.club_target):
            key, name = resolve(candidate)
            if key:
                clubs.setdefault(key, name)
        recent = sorted(mine.values(), key=lambda entry: entry[2], reverse=True)
        if recent and not clubs:
            key, name = resolve(recent[0][0])
            if key:
                clubs[key] = name
        window = build(clubs)
        if window:
            floor = min(item[0] for item in window)
            for entry in mine.values():
                if entry[2] >= floor:
                    key, name = resolve(entry[0])
                    if key:
                        clubs.setdefault(key, name)
            window = build(clubs)
        if not window:
            out[obs.fc_id] = {"source": f"no recent matches recorded for "
                                        f"{', '.join(clubs.values()) or 'his club'}"}
            continue

        played = starts = minutes = measured = 0
        ratings: list[float] = []
        goals: dict[str, int] = {}
        assists: dict[str, int] = {}
        kinds: dict[str, int] = {}
        series: list[str] = []
        detail: list[str] = []
        for date, match_id, competition, club_key in reversed(window):  # oldest first, for the strip
            kind = competition_class(competition)
            kinds[kind] = kinds.get(kind, 0) + 1
            known = str(match_id) in with_players
            if known:
                measured += 1
            entry = mine.get(str(match_id))
            if entry:
                rating = entry[5]
                token = f"p:{rating if rating is not None else ''}:{entry[3]}"
            elif (reason := next((code for start, end, code in spells.get(obs.fc_id, ())
                                  if start <= date <= end), None)):
                token = reason
            else:
                token = "b" if known else "n"
            series.append(token)
            # One line per match for the popup: everything a dot cannot say. Same order as the strip.
            opponent, home = opponents.get((club_key, str(match_id)), ("", 0))
            detail.append("|".join(str(part) for part in (
                date, competition or "", opponent, "H" if home else "A", token.split(":")[0],
                entry[3] if entry else "", entry[5] if entry and entry[5] is not None else "",
                entry[6] if entry else "", entry[7] if entry else "",
                1 if entry and entry[4] else "")))
            if not entry:
                continue
            _c, _comp, _d, match_minutes, started, rating, match_goals, match_assists = entry
            played += 1
            minutes += match_minutes
            starts += 1 if started else 0
            if rating is not None:
                ratings.append(rating)
            goals[kind] = goals.get(kind, 0) + match_goals
            assists[kind] = assists.get(kind, 0) + match_assists
        out[obs.fc_id] = {
            "club_matches": len(window),
            "measured": measured,
            "played": played,
            # bench or out of the squad - the layer cannot tell them apart - among the matches we DO
            # have player rows for. The rest of the window is `club_matches - measured`: unknown.
            "unused": measured - played,
            "unknown": len(window) - measured,
            "starts": starts,
            "minutes": minutes,
            "minutes_per_club_match": round(minutes / measured, 1) if measured else None,
            "rating": round(sum(ratings) / len(ratings), 2) if ratings else None,
            "goals_league": goals.get("league", 0),
            "assists_league": assists.get("league", 0),
            "goals_other": sum(count for kind, count in goals.items() if kind != "league"),
            "assists_other": sum(count for kind, count in assists.items() if kind != "league"),
            "competitions": " ".join(f"{kind}x{count}" for kind, count in
                                     sorted(kinds.items(), key=lambda item: -item[1])),
            # only a REAL transfer shows up here: the clubs are compared canonically, so the provider's
            # 'FC Bayern München' and the listone's 'Bayern Monaco' are one club, not two
            "clubs": "; ".join(sorted(clubs.values())) if len(clubs) > 1 else None,
            "last_match": window[0][0] if window else None,
            "series": " ".join(series),
            "detail": ";".join(detail),
            "source": "per-match layer",
        }
    return out


def injury_history(conn, auction_date: str, seasons: list[str]) -> dict[int, dict]:
    """Absences per player: matches missed, weighted by recency, plus whatever is open right now.

    `matches_missed` and not days: days become matches only through the calendar, and the source
    already did that translation. A player with no rows is NOT a player with zero absences - he may
    simply have no Transfermarkt id, which is why `desc_injury_source` says which of the two it is.
    """
    known = {fc_id for (fc_id,) in conn.execute(
        "SELECT DISTINCT fc_id FROM player_xref WHERE source = 'transfermarkt'")}
    weights = {season: INJURY_WEIGHTS[index] for index, season in
               enumerate(reversed(seasons[-len(INJURY_WEIGHTS):]))}
    out: dict[int, dict] = {}
    for fc_id, start, end, kind, days, missed in conn.execute(
            """SELECT fc_id, start_date, end_date, kind, days_out, matches_missed FROM injuries
               WHERE start_date <= ? ORDER BY start_date DESC""", (auction_date,)):
        season = f"{int(start[:4]) - (0 if start[5:7] >= '07' else 1)}-" \
                 f"{(int(start[:4]) + (1 if start[5:7] >= '07' else 0)) % 100:02d}"
        entry = out.setdefault(fc_id, {"spells": 0, "matches_missed": 0, "days_out": 0,
                                       "weighted": 0.0, "worst_kind": None, "open": None,
                                       "last_start": start})
        entry["spells"] += 1
        entry["matches_missed"] += missed or 0
        entry["days_out"] += days or 0
        entry["weighted"] += (missed or 0) * weights.get(season, 0.0)
        if (end is None or end >= auction_date) and entry["open"] is None:
            entry["open"] = f"{kind} since {start}"
        if entry["worst_kind"] is None or (days or 0) >= (entry.get("worst_days") or 0):
            entry["worst_kind"], entry["worst_days"] = kind, days or 0
    for fc_id, entry in out.items():
        entry["weighted"] = round(entry["weighted"], 2)
        entry["source"] = "transfermarkt"
        del entry["worst_days"]
    for fc_id in known - set(out):
        out[fc_id] = {"spells": 0, "matches_missed": 0, "days_out": 0, "weighted": 0.0,
                      "worst_kind": None, "open": None, "last_start": None,
                      "source": "transfermarkt (no absence recorded)"}
    return out


def latest_starters(conn, auction_date: str) -> tuple[dict[int, dict], str | None]:
    """The most recent probabili snapshot at or before the auction date, per player."""
    date = conn.execute("SELECT MAX(valid_from) FROM probable_starter WHERE valid_from <= ?",
                        (auction_date,)).fetchone()[0]
    if not date:
        return {}, None
    out = {fc_id: {"probability": probability, "starter": bool(starter), "status": status,
                   "team": team, "formation": formation, "role": role}
           for fc_id, probability, starter, status, team, formation, role in conn.execute(
               "SELECT fc_id, probability, starter, status, team, formation, role "
               "FROM probable_starter WHERE valid_from = ?", (date,))}
    return out, date


def availability_now(conn, auction_date: str) -> dict[int, str]:
    """Latest injured/suspended state per player at the auction date (dated series, newest wins)."""
    out: dict[int, str] = {}
    for fc_id, status in conn.execute(
            "SELECT fc_id, status FROM availability WHERE valid_from <= ? ORDER BY valid_from",
            (auction_date,)):
        out[fc_id] = status
    return out


def duels(observations, starters: dict[int, dict]) -> dict[int, dict]:
    """Starting duels: same club, same Classic role, comparable starting probability.

    Read off the probabili snapshot, which is the only source that says who the editors expect to
    start. Without a snapshot the column is empty rather than guessed from minutes - "who plays" and
    "who played" are different questions, and the second one already has its own column.
    """
    by_slot: dict[tuple[str, str], list] = {}
    for obs in observations:
        entry = starters.get(obs.fc_id)
        if not obs.club_target or not obs.role_classic or not entry:
            continue
        if entry.get("probability") is None:
            continue
        by_slot.setdefault((obs.club_target, obs.role_classic), []).append(
            (obs.fc_id, obs.name, float(entry["probability"])))
    out: dict[int, dict] = {}
    for group in by_slot.values():
        group.sort(key=lambda item: -item[2])
        for fc_id, _name, probability in group:
            rivals = [name for other, name, other_probability in group
                      if other != fc_id and abs(other_probability - probability)
                      <= BALLOTTAGGIO_MARGIN]
            out[fc_id] = {"rivals": len(rivals), "names": "; ".join(rivals[:3])}
    return out


def penalty_duty(conn, auction_date: str) -> dict[int, tuple[int, float]]:
    """Revealed penalty hierarchy at the auction date: (rank, confidence) per player."""
    out: dict[int, tuple[int, float]] = {}
    for fc_id, rank, confidence in conn.execute(
            "SELECT fc_id, rank, confidence FROM penalty_hierarchy WHERE valid_from <= ? "
            "ORDER BY valid_from", (auction_date,)):
        out[fc_id] = (rank, confidence)
    return out


def contract_state(conn, season: str) -> dict[int, dict]:
    """The club-relationship PROXIES: contract expiry, exit risk, arrival, seasons at the club."""
    out: dict[int, dict] = {}
    for fc_id, flag, value in conn.execute(
            "SELECT fc_id, flag, value FROM flags WHERE flag IN "
            "('contract_until', 'exit_risk', 'new_coach', 'u22_trigger') AND season = ?", (season,)):
        out.setdefault(fc_id, {})[flag] = value
    for fc_id, kind, tier, origin, equivalent in conn.execute(
            "SELECT fc_id, type, tier, origin_league, foreign_fm_equiv FROM arrivals WHERE season = ?",
            (season,)):
        out.setdefault(fc_id, {}).update(
            {"arrival": kind, "tier": tier, "origin": origin, "equiv": equivalent})
    for fc_id, seasons in conn.execute(
            """SELECT r.fc_id, COUNT(*) FROM rosters r
               JOIN rosters t ON t.fc_id = r.fc_id AND t.season = ? AND t.fc_club_id = r.fc_club_id
               WHERE r.season <= ? GROUP BY r.fc_id""", (season, season)):
        out.setdefault(fc_id, {})["seasons_at_club"] = seasons
    for fc_id, fee, to_club in conn.execute(
            "SELECT fc_id, fee, to_club FROM transfers_history WHERE date >= ? ORDER BY date",
            (f"{season.split('-')[0]}-01-01",)):
        if fee:
            out.setdefault(fc_id, {}).update({"fee": fee, "fee_to": to_club})
    return out


def discipline(conn, season: str, platform: str) -> dict[int, dict]:
    """Cards per appearance (correttezza), from the platform's own season aggregate."""
    return {fc_id: {"yellows": yellows or 0, "reds": reds or 0,
                    "per_match": round(((yellows or 0) + 3 * (reds or 0)) / pv, 3) if pv else None}
            for fc_id, yellows, reds, pv in conn.execute(
                "SELECT fc_id, yellows, reds, pv FROM season_stats WHERE season = ? AND platform = ?",
                (season, platform))}


def propensity(conn, season: str) -> dict[int, dict]:
    """Bonus propensity per 90 over the FULL real season - the engine's own input, reported as-is."""
    out: dict[int, dict] = {}
    for fc_id, minutes, goals, assists, xg, xa in conn.execute(
            """SELECT fc_id, SUM(COALESCE(minutes, 0)), SUM(COALESCE(goals, 0)),
                      SUM(COALESCE(assists, 0)), SUM(COALESCE(xg, 0)), SUM(COALESCE(xa, 0))
               FROM external_stats WHERE season = ? AND source = 'sofascore' GROUP BY fc_id""",
            (season,)):
        if not minutes:
            continue
        per90 = 90.0 / minutes
        out[fc_id] = {"goals_p90": round((goals or 0) * per90, 3),
                      "assists_p90": round((assists or 0) * per90, 3),
                      "xg_p90": round((xg or 0) * per90, 3), "xa_p90": round((xa or 0) * per90, 3),
                      "minutes": minutes}
    return out


def lineup_spellings(conn, resolve) -> dict[str, list[str]]:
    """canonical key -> every spelling `club_match_lineups` holds for that club.

    Needed for the same reason the fixtures needed it: the lineup table is keyed by the PROVIDER's name
    ('FC Barcelona'), and querying it with ours ('Barcellona') returned zero elevens for every club
    outside Serie A - which is exactly the population whose formation nobody knows by heart.
    """
    out: dict[str, list[str]] = {}
    for (club,) in conn.execute("SELECT DISTINCT club FROM club_match_lineups WHERE club IS NOT NULL"):
        key, _name = resolve(club)
        if key:
            out.setdefault(key, []).append(club)
    return out


# How much an eleven played by the PREVIOUS coach still counts when the coach has changed. Not zero:
# with three matches under a new man his predecessor's habit is still the best evidence there is, and a
# hard cut would answer "3-4-3, 100% of 3 elevens" from a pre-season friendly. Not one either - that is
# the whole point of the request. A READING weight, stated in the sheet, and no rule fits on it.
PREVIOUS_COACH_WEIGHT = 0.25


def typical_formation(conn, spellings: list[str], season: str, coach_since: str | None = None
                      ) -> tuple[str | None, float | None, int, str]:
    """The club's MODAL formation over its complete elevens: (shape, share, elevens, basis).

    The mode, not the mean. A club that alternates 3-5-2 and 4-3-3 has a mean of 3.5 defenders, which is
    not a formation anyone can field; its mode is one of the two, and the share says how settled it is -
    97% of 38 elevens is Atalanta's habit, 63% is Arsenal choosing.

    When `coach_since` says the man in charge arrived DURING the sample, his own elevens weigh four times
    his predecessor's: a new coach's shape is the club's shape now, and the previous one is only evidence
    about a side that no longer exists. The `basis` says which of the two happened, because "3-4-3" from
    38 elevens and "3-4-3" from four are not the same statement.
    """
    if not spellings:
        return None, None, 0, "no lineups"
    placeholders = ",".join("?" * len(spellings))
    rows = conn.execute(
        f"""SELECT defenders, midfielders, forwards, match_date FROM club_match_lineups
            WHERE club IN ({placeholders}) AND season = ? AND starters = 11
              AND goalkeepers + defenders + midfielders + forwards = 11""",
        (*spellings, season)).fetchall()
    if not rows:
        return None, None, 0, "no lineups"
    weights: dict[tuple[int, int, int], float] = {}
    under_coach = 0
    for defenders, midfielders, forwards, date in rows:
        his = bool(coach_since and date and date >= coach_since)
        under_coach += his
        weight = 1.0 if (his or not coach_since) else PREVIOUS_COACH_WEIGHT
        shape = (defenders, midfielders, forwards)
        weights[shape] = weights.get(shape, 0.0) + weight
    total = sum(weights.values())
    shape, weight = max(weights.items(), key=lambda item: item[1])
    if coach_since and not under_coach:
        # The reweighting cannot help here: with no eleven of his own, every match is the predecessor's
        # and scaling them all by the same factor changes nothing. What CAN be done is say so - a 97%
        # 3-4-3 that the current coach has never fielded describes a side that no longer exists, and at
        # an auction that is the difference between a habit and a historical note.
        basis = f"0 of {len(rows)} XIs under this coach - this is his PREDECESSOR's shape"
    elif coach_since and under_coach < len(rows):
        basis = f"{under_coach} of {len(rows)} XIs under this coach"
    else:
        basis = f"{len(rows)} XIs"
    return ("-".join(str(part) for part in shape), round(weight / total, 2), len(rows), basis)


# The positional heatmap says WHERE across the pitch a player stood, but not which touchline y=0 is on.
# So the orientation is CALIBRATED from the players whose listone role names a side: right backs and left
# backs cannot both be at the same end of the axis. Below this many of each, no side is claimed at all -
# an uncalibrated axis would put half a defence on the wrong flank, which is worse than saying nothing.
SIDE_CALIBRATION_MIN = 8


def measured_sides(conn, season: str, notes: list[str]) -> dict[int, float]:
    """fc_id -> where he really stood across the pitch, -1 the team's left ... +1 its right.

    From `positions.avg_y` (the season heatmap), oriented by the calibration above. This is the precise
    answer the listone's role only approximates: a nominal centre back who spent the year on the left of
    a back three shows up as one, and a 'dc' really in the middle stays in the middle.
    """
    rows = conn.execute(
        """SELECT p.fc_id, p.avg_y, r.roles FROM positions p
           JOIN rosters r ON r.fc_id = p.fc_id AND r.season = p.season
           WHERE p.season = ? AND p.source = 'sofascore' AND p.avg_y IS NOT NULL""",
        (season,)).fetchall()
    if not rows:
        return {}
    right = [avg_y for _fc, avg_y, roles in rows if "dd" in (roles or "").split(";")]
    left = [avg_y for _fc, avg_y, roles in rows if "ds" in (roles or "").split(";")]
    if min(len(right), len(left)) < SIDE_CALIBRATION_MIN:
        notes.append(f"the heatmap axis could not be calibrated ({len(right)} right backs and "
                     f"{len(left)} left backs with a heatmap, {SIDE_CALIBRATION_MIN} of each needed), "
                     f"so no measured side is published: the sheet falls back to the listone's roles. "
                     f"Run `positions --layer heatmap` to fill it.")
        return {}
    orientation = 1.0 if sum(right) / len(right) < sum(left) / len(left) else -1.0
    notes.append(f"heatmap axis calibrated on {len(right)} right backs and {len(left)} left backs: "
                 f"{'low' if orientation > 0 else 'high'} y is the team's right")
    return {fc_id: round(max(-1.0, min(1.0, orientation * (50.0 - avg_y) / 50.0)), 3)
            for fc_id, avg_y, _roles in rows}


def titolarita(conn, season: str) -> dict[int, dict]:
    """How often he STARTED over the full real season: (starts, matches, share).

    This - not any valuation - is what says whether a coach fields him. Read over the whole season
    because the "schieramento tipo" is a habit over a year; the last ten matches are a separate column
    and answer the other question, which side the coach is picking now.
    """
    out: dict[int, dict] = {}
    for fc_id, starts, matches in conn.execute(
            """SELECT fc_id, SUM(COALESCE(starts, 0)), SUM(COALESCE(matches, 0))
               FROM external_stats WHERE season = ? AND source = 'sofascore' GROUP BY fc_id""",
            (season,)):
        if not matches:
            continue
        out[fc_id] = {"starts": starts, "matches": matches,
                      "share": round((starts or 0) / matches, 3)}
    return out


def club_context(conn, data: features.WindowData, starters_date: str | None,
                 clubs: list[str]) -> list[dict]:
    """One row per club OF THE SHEET: coach, formation, lines fielded, arrivals, Elo.

    The club list comes from the sheet's own rows, not from `rosters`: with no listone for the season
    being auctioned there are no roster rows to enumerate, and the clubs are exactly the ones whose real
    squads the sheet just described.
    """
    window = data.window
    resolve = club_index(conn)
    spellings = lineup_spellings(conn, resolve)
    formations: dict[str, str] = {}
    if starters_date:
        formations = {team: formation for team, formation in conn.execute(
            "SELECT team, formation FROM probable_starter WHERE valid_from = ? AND team IS NOT NULL "
            "AND formation IS NOT NULL GROUP BY team", (starters_date,))}
    elo_date = conn.execute("SELECT MAX(date) FROM club_elo WHERE date <= ?",
                            (window.auction_date,)).fetchone()[0]
    elo = dict(conn.execute(
        "SELECT c.canonical_name, e.elo FROM club_elo e JOIN clubs c USING(fc_club_id) "
        "WHERE e.date = ?", (elo_date,))) if elo_date else {}
    out = []
    for club in clubs:
        coach = conn.execute(
            """SELECT co.coach_name, co.valid_from FROM coaches co JOIN clubs c USING(fc_club_id)
               WHERE c.canonical_name = ? AND co.valid_from <= ?
               ORDER BY co.valid_from DESC LIMIT 1""", (club, window.auction_date)).fetchone()
        mine = spellings.get(resolve(club)[0], [])
        placeholders = ",".join("?" * len(mine)) or "NULL"
        lines = conn.execute(
            f"""SELECT AVG(defenders), AVG(midfielders), AVG(forwards), COUNT(*)
                FROM club_match_lineups
                WHERE club IN ({placeholders}) AND season = ? AND starters = 11
                  AND goalkeepers + defenders + midfielders + forwards = 11""",
            (*mine, window.input_season)).fetchone()
        # The coach's own start date, and only when he arrived after the sample began: an unchanged
        # coach needs no reweighting, the whole season is his.
        coach_since = coach[1] if coach and coach[1] else None
        if coach_since and coach_since <= f"{window.input_season.split('-')[0]}-07-01":
            coach_since = None
        typical, share, counted, basis = typical_formation(
            conn, mine, window.input_season, coach_since)
        arrivals = conn.execute(
            """SELECT COUNT(*) FROM arrivals a JOIN rosters r
               ON r.fc_id = a.fc_id AND r.season = a.season
               JOIN clubs c ON c.fc_club_id = r.fc_club_id
               WHERE a.season = ? AND c.canonical_name = ?""",
            (window.target_season, club)).fetchone()[0]
        new_coach = conn.execute(
            """SELECT COUNT(*) FROM flags f JOIN rosters r
               ON r.fc_id = f.fc_id AND r.season = f.season
               JOIN clubs c ON c.fc_club_id = r.fc_club_id
               WHERE f.flag = 'new_coach' AND f.season = ? AND c.canonical_name = ?""",
            (window.target_season, club)).fetchone()[0]
        out.append({
            "club": club,
            "coach": coach[0] if coach else None,
            "coach_since": coach[1] if coach else None,
            "new_coach": "yes" if new_coach else "no",
            # The MODULO TIPO: the shape this club actually lines up in most often, not the mean of its
            # lines. The mean is an artefact - Arsenal's 4.0/3.74/2.26 rounds to 4-4-2, a formation they
            # never played - while the mode is a formation that was on the pitch, and its share says how
            # much of a habit it is.
            "formation_typical": typical,
            "formation_typical_share": share,
            "formation_typical_of": counted,
            "formation_typical_basis": basis,
            # "Absolutely preferred" is a measured thing: a shape used in most of the elevens is the
            # coach's, one used in a third of them is a coach still choosing - and the two must not be
            # presented the same way.
            "formation_settled": (("no" if "PREDECESSOR" in (basis or "")
                                   else "yes" if (share or 0) >= FORMATION_SETTLED else "no")
                                  if share else None),
            "formation_today": formations.get(club),
            "probabili_date": starters_date,
            "lines_fielded_D": round(lines[0], 2) if lines and lines[0] is not None else None,
            "lines_fielded_M": round(lines[1], 2) if lines and lines[1] is not None else None,
            "lines_fielded_F": round(lines[2], 2) if lines and lines[2] is not None else None,
            "complete_XIs": lines[3] if lines else 0,
            "arrivals": arrivals,
            "elo": round(elo[club], 1) if club in elo else None,
        })
    return out


# ---------------------------------------------------------------- the engine half
def engine_predictions(conn, window: features.Window, platform: str, game: str,
                       league, squad_source: str = "real", prepared=None
                       ) -> tuple[features.WindowData, list, str, list[str]]:
    """The validated valuation: ADOPTED rules, parameters fitted on a DIFFERENT window.

    Nothing here is new model code - it calls the same functions `backtest --auction` calls, which is
    what keeps the sheet and the gate from ever disagreeing.
    """
    notes: list[str] = []
    if prepared is None:
        prepared = features.prepare(conn, window, platform, game, league=league,
                                    squad_source=squad_source)
    data = prepared
    listone = sum(1 for obs in data.observations if obs.price_initial is not None)
    if squad_source == "real" and listone < len(data.observations):
        notes.append(f"{len(data.observations) - listone} of {len(data.observations)} players are in a "
                     f"real squad but not in the {window.target_season} listone: no Qt.I exists for "
                     f"them yet, so the engine prices them at the role anchor (R0c) and their "
                     f"`price_initial` is empty by construction, not by omission")
    active = ("R0", *evaluate.ADOPTED.get(platform, ()))
    # The FIT windows keep the listone population on purpose: they are the gate's own windows, and
    # widening them would fit the coefficients on a different population than the one they were
    # validated on. Only the window being PRICED reads the real squads.
    usable = tuple(key for key in features.WINDOWS
                   if evaluate._window_is_usable(
                       features.prepare(conn, features.WINDOWS[key], platform, game), platform))
    if not usable:
        notes.append("no window has both a previous and an actual fantamedia, so no parameters could "
                     "be fitted: the engine columns fall back to the R0 core alone")
        return data, evaluate.predict_window(data, ("R0",)), "R0-core", notes
    fitted = {key: evaluate.fit_params(
        features.prepare(conn, features.WINDOWS[key], platform, game),
        ("R0", *evaluate.CANDIDATES)) for key in usable}
    # The most recent usable window fits the parameters, and the pooled rules average over the others -
    # the same construction the auction simulation uses. For a LIVE target this is not cross-fitting
    # (there is nothing to cross-fit against yet): it is the freshest fit that does not read the season
    # being auctioned, which is the strongest thing available before it is played.
    source = usable[-1]
    params = evaluate.pool_params(fitted, "", fitted[source])
    if window.target_season == features.WINDOWS[source].target_season:
        notes.append(f"the target season {window.target_season} is also the season the parameters were "
                     f"fitted on ({source}): this run is a DRY RUN, not an out-of-sample statement")
    return data, evaluate.predict_window(data, active, None, params), params.source or source, notes


# ---------------------------------------------------------------- assembly
PLAYER_COLUMNS: tuple[str, ...] = (
    # identity and market facts
    "fc_id", "name", "club", "league", "role_classic", "roles_mantra",
    "price_initial", "price_initial_mantra", "fvm_reporting_only",
    # the gated engine valuation
    "engine_fm_pred", "engine_pv_pred", "engine_value", "engine_surplus", "engine_role_rank",
    "engine_replacement_fm", "engine_anchor",
    # descriptive, NOT gated
    "desc_form_club_matches", "desc_form_measured", "desc_form_played", "desc_form_unused",
    "desc_form_unknown", "desc_form_starts",
    "desc_form_minutes", "desc_form_minutes_per_club_match", "desc_form_rating",
    "desc_form_goals_league", "desc_form_assists_league",
    "desc_form_goals_other", "desc_form_assists_other",
    "desc_form_competitions", "desc_form_clubs", "desc_form_last_match", "desc_form_source",
    "desc_form_series", "desc_form_detail",
    "desc_squad_club", "desc_squad_source", "desc_real_role",
    # The granular real role: where on the pitch he belongs, in the twelve-code vocabulary.
    "desc_real_roles", "desc_real_role_primary", "desc_real_role_line", "desc_real_role_depth",
    "desc_real_role_side", "desc_mantra_real", "desc_foot", "desc_real_role_observed",
    "desc_avg_x", "desc_avg_y", "desc_side_measured",
    "desc_starter_prob", "desc_starter_status", "desc_expected_minutes",
    # Titolarità: how often he STARTS. Two horizons, because they answer different questions - the
    # season's share is the coach's habit over a year, the recent one is the shape of the side now.
    "desc_season_starts", "desc_season_matches", "desc_start_share",
    "desc_duel_rivals", "desc_duel_names",
    "desc_injury_matches_missed", "desc_injury_weighted", "desc_injury_spells",
    "desc_injury_worst_kind", "desc_injury_open", "desc_injury_source",
    "desc_availability_now",
    "desc_goals_p90", "desc_assists_p90", "desc_xg_p90", "desc_xa_p90", "desc_minutes_full_season",
    "desc_penalty_rank", "desc_penalty_confidence", "desc_set_piece_duty",
    "desc_cards_per_match", "desc_yellows", "desc_reds",
    "desc_contract_until", "desc_exit_risk", "desc_arrival", "desc_arrival_tier",
    "desc_arrival_origin", "desc_transfer_fee", "desc_seasons_at_club", "desc_new_coach",
    "desc_u22",
)


def perimeter_clubs(conn, platform: str, seasons: tuple[str, ...]) -> set[str]:
    """The clubs THIS PLATFORM plays, from its own ratings: who you can actually buy from."""
    placeholders = ",".join("?" * len(seasons)) or "NULL"
    return {team for (team,) in conn.execute(
        f"SELECT DISTINCT team FROM match_ratings WHERE platform = ? AND team IS NOT NULL "
        f"AND season IN ({placeholders})", (platform, *seasons))}


def build_rows(conn, data: features.WindowData, predictions, layers: dict,
               perimeter: set[str] | None = None) -> list[dict]:
    """One row per purchasable player, engine columns first, descriptive after.

    `perimeter` filters the OUTPUT, never the model population. The engine's standardisations are
    computed over the whole listone - that is the population its rules were fitted and validated on -
    so trimming before predicting would quietly give a player a different number here than in the gate.
    Trimming after keeps every figure identical and only stops the sheet from listing a Verona squad at
    a EuroLeghe auction, where nobody can buy it.
    """
    by_id = {p.obs.fc_id: p for p in predictions}
    ranks: dict[int, int] = {}
    for role in {obs.role_classic for obs in data.observations if obs.role_classic}:
        ranked = sorted(
            (p for p in predictions if p.obs.role_classic == role and p.value_pred is not None),
            key=lambda p: (-(_surplus(p, data) or 0.0), p.obs.fc_id))
        for index, prediction in enumerate(ranked, start=1):
            ranks[prediction.obs.fc_id] = index

    rows: list[dict] = []
    for obs in data.observations:
        if perimeter is not None and (obs.club_target or "") not in perimeter:
            continue
        prediction = by_id.get(obs.fc_id)
        form = layers["form"].get(obs.fc_id, {})
        injury = layers["injuries"].get(obs.fc_id, {})
        starter = layers["starters"].get(obs.fc_id, {})
        duel = layers["duels"].get(obs.fc_id, {})
        prop = layers["propensity"].get(obs.fc_id, {})
        season_play = layers["titolarita"].get(obs.fc_id, {})
        card = layers["discipline"].get(obs.fc_id, {})
        state = layers["contract"].get(obs.fc_id, {})
        role_detail = layers["real_role_detail"].get(obs.fc_id, {})
        penalty = layers["penalties"].get(obs.fc_id)
        pv_pred = prediction.pv_pred if prediction else None
        rows.append({
            "fc_id": obs.fc_id, "name": obs.name, "club": obs.club_target, "league": obs.league,
            "role_classic": obs.role_classic, "roles_mantra": ";".join(obs.roles_mantra),
            "price_initial": obs.price_initial, "price_initial_mantra": obs.price_initial_mantra,
            "fvm_reporting_only": obs.fvm,
            "engine_fm_pred": _round(prediction.fm_pred if prediction else None, 3),
            "engine_pv_pred": _round(pv_pred, 1),
            "engine_value": _round(_value(prediction), 1),
            "engine_surplus": _round(_surplus(prediction, data), 1),
            "engine_role_rank": ranks.get(obs.fc_id),
            "engine_replacement_fm": _round(data.replacement.get(obs.role_classic or ""), 3),
            "engine_anchor": _round(prediction.anchor if prediction else None, 3),
            "desc_form_club_matches": form.get("club_matches"),
            "desc_form_measured": form.get("measured"),
            "desc_form_played": form.get("played"), "desc_form_unused": form.get("unused"),
            "desc_form_unknown": form.get("unknown"),
            "desc_form_starts": form.get("starts"), "desc_form_minutes": form.get("minutes"),
            "desc_form_minutes_per_club_match": form.get("minutes_per_club_match"),
            "desc_form_rating": form.get("rating"),
            "desc_form_goals_league": form.get("goals_league"),
            "desc_form_assists_league": form.get("assists_league"),
            "desc_form_goals_other": form.get("goals_other"),
            "desc_form_assists_other": form.get("assists_other"),
            "desc_form_competitions": form.get("competitions"),
            "desc_form_clubs": form.get("clubs"), "desc_form_last_match": form.get("last_match"),
            "desc_form_source": form.get("source"),
            "desc_form_series": form.get("series"),
            "desc_form_detail": form.get("detail"),
            "desc_squad_club": layers["squads"].get(obs.fc_id),
            "desc_squad_source": layers["squad_sources"].get(obs.fc_id),
            # The role he was REALLY used in, from the provider's own slot per match (positions.
            # derived_role). It answers a different question from the listone's: the listone says what
            # you buy him as, this says where the coach actually put him.
            "desc_real_role": layers["real_roles"].get(obs.fc_id),
            # And WHERE inside that line: the provider's own granular position, one to three of the
            # twelve codes, ordered with the most representative first. This is the only column that
            # tells a left back from a centre back - `role_classic` calls both 'D' and
            # `desc_real_role` calls both 'D' too. `depth`/`side` are where to DRAW him (0 = own goal
            # to 1 = the opponent's; -1 the team's left to +1 its right), so every reader places him
            # the same way. Observed on a DATE and not derivable for any other: see the manifest.
            "desc_real_roles": role_detail.get("roles"),
            "desc_real_role_primary": role_detail.get("primary"),
            "desc_real_role_line": role_detail.get("line"),
            "desc_real_role_depth": role_detail.get("depth"),
            "desc_real_role_side": role_detail.get("side"),
            # What a MANTRA auction would call him, derived from the same codes: Mantra simplifies
            # (ML/MR both 'e', LW/RW both 'w' - it does not name the flank), AM is 't' or 'a' by the
            # provider's own line, and 'b' (braccetto) comes from the code COMBINATION, a flank
            # defender who also plays DC. It never replaces `roles_mantra`, which is what the listone
            # sells him as: this column exists for the July case, where no listone row exists at all.
            "desc_mantra_real": role_detail.get("mantra"),
            "desc_foot": role_detail.get("foot"),
            "desc_real_role_observed": role_detail.get("observed"),
            "desc_avg_x": layers["positions"].get(obs.fc_id, (None, None))[0],
            "desc_avg_y": layers["positions"].get(obs.fc_id, (None, None))[1],
            "desc_side_measured": layers["sides"].get(obs.fc_id),
            "desc_starter_prob": starter.get("probability"),
            "desc_starter_status": starter.get("status"),
            # Expected minutes = minutes per CLUB match recently x the appearances the engine
            # predicts. The recent share is what carries bench time; the season-long one is the
            # fallback for a player whose club we have no recent matches for.
            "desc_expected_minutes": _round(_expected_minutes(obs, form, pv_pred), 0),
            "desc_season_starts": season_play.get("starts"),
            "desc_season_matches": season_play.get("matches"),
            "desc_start_share": season_play.get("share"),
            "desc_duel_rivals": duel.get("rivals"), "desc_duel_names": duel.get("names"),
            "desc_injury_matches_missed": injury.get("matches_missed"),
            "desc_injury_weighted": injury.get("weighted"),
            "desc_injury_spells": injury.get("spells"),
            "desc_injury_worst_kind": injury.get("worst_kind"),
            "desc_injury_open": injury.get("open"),
            "desc_injury_source": injury.get("source", "no Transfermarkt id: unknown, not zero"),
            "desc_availability_now": layers["availability"].get(obs.fc_id),
            "desc_goals_p90": prop.get("goals_p90"), "desc_assists_p90": prop.get("assists_p90"),
            "desc_xg_p90": prop.get("xg_p90"), "desc_xa_p90": prop.get("xa_p90"),
            "desc_minutes_full_season": prop.get("minutes"),
            "desc_penalty_rank": penalty[0] if penalty else None,
            "desc_penalty_confidence": penalty[1] if penalty else None,
            "desc_set_piece_duty": "not available (assists_set_piece is NULL at the source)",
            "desc_cards_per_match": card.get("per_match"), "desc_yellows": card.get("yellows"),
            "desc_reds": card.get("reds"),
            "desc_contract_until": state.get("contract_until"),
            "desc_exit_risk": "yes" if state.get("exit_risk") else None,
            "desc_arrival": state.get("arrival"), "desc_arrival_tier": state.get("tier"),
            "desc_arrival_origin": state.get("origin"), "desc_transfer_fee": state.get("fee"),
            "desc_seasons_at_club": state.get("seasons_at_club"),
            "desc_new_coach": "yes" if state.get("new_coach") else None,
            "desc_u22": "yes" if state.get("u22_trigger") else None,
        })
    rows.sort(key=lambda row: (row["role_classic"] or "Z", -(row["engine_surplus"] or -1e9)))
    return rows


def _expected_minutes(obs, form: dict, pv_pred) -> float | None:
    """Minutes per appearance x the appearances the engine predicts.

    The recent share is preferred because it carries bench time - but only when he actually played in
    the sample. A keeper who sat out his club's last ten has a recent share of zero, and answering
    "0 minutes" for a man the engine expects to play twenty games is worse than answering with his
    season-long share, which is what the fallback is for.
    """
    if not pv_pred:
        return None
    share = form.get("minutes_per_club_match") if form.get("played") else None
    if share is None and obs.minutes_prev and obs.matches_prev:
        share = obs.minutes_prev / obs.matches_prev
    return share * pv_pred if share is not None else None


def _round(value, digits=3):
    return None if value is None else round(value, digits)


def _value(prediction) -> float | None:
    if not prediction or prediction.fm_pred is None or prediction.pv_pred is None:
        return None
    return prediction.fm_pred * prediction.pv_pred


def _surplus(prediction, data: features.WindowData) -> float | None:
    """(FM - the role's replacement level) x appearances. Falls back to VALUE without a level."""
    if not prediction or prediction.fm_pred is None or prediction.pv_pred is None:
        return None
    level = data.replacement.get(prediction.obs.role_classic or "")
    if level is None:
        return prediction.fm_pred * prediction.pv_pred
    return (prediction.fm_pred - level) * prediction.pv_pred


def _write_csv(path: Path, columns, rows) -> None:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=list(columns), extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(buffer.getvalue(), encoding="utf-8-sig")   # -sig: Excel reads the accents right
    os.replace(tmp, path)


# ---------------------------------------------------------------- orchestration
def refresh_editorial(ctx: Context) -> str | None:
    """Today's probabili + indisponibili snapshot. Three requests, and it cannot be done later."""
    from euroleghe_ingest.modules import fc_site

    try:
        fc_site.run(ctx, pages=("probabili", "indisponibili"))
    except Exception as exc:   # noqa: BLE001 - a snapshot must still be produced without the refresh
        return f"editorial refresh failed ({exc}) - the sheet uses the most recent stored snapshot"
    return None


def refresh_real_roles(ctx: Context, clubs, date: str) -> str | None:
    """Today's granular real role for every player of the perimeter. One request per CLUB.

    THE THIRD FACT THAT CANNOT BE BACKFILLED. The provider serves only "now": asking its player
    endpoint for a season three years old returns today's codes (`?seasonId=` answers 200 and is
    ignored), so a role not observed on a given day is a role that day will never have. Same reason
    the probabili are refreshed here and not derived later.

    Cheap enough to run every time: the squad endpoint answers for a whole club at once, so the
    perimeter costs ~80 requests, and the cache is keyed by the observation date - a second run on the
    same day is free. Never raises: a sheet without the roles is worse than no sheet, but only just.
    """
    try:
        positions.derive_club_xref(ctx)
        positions.fetch_roles(ctx, clubs=sorted(clubs) if clubs else None, date=date)
    except Exception as exc:   # noqa: BLE001 - a snapshot must still be produced without the refresh
        return (f"real-role refresh failed ({exc}) - the sheet uses the most recent stored "
                f"observation, and there is no way to reconstruct today's")
    return None


def run(ctx: Context, *, season: str | None = None, platform: str = "euro",
        game: str = "classic", refresh: bool = True, out: str | None = None, **kwargs) -> dict:
    """Build today's auction snapshot. Read-only on the DB except for the editorial refresh."""
    conn = ctx.require_conn()
    if platform not in ("euro", "default"):
        raise RuntimeError(f"Unknown platform {platform!r}; choose euro|default")
    if game not in ("classic", "mantra"):
        raise RuntimeError(f"Unknown game {game!r}; choose classic|mantra")

    notes: list[str] = []
    if refresh:
        failure = refresh_editorial(ctx)
        if failure:
            notes.append(failure)

    window, note = resolve_window(conn, season)
    if note:
        notes.append(note)
    print(f"[snapshot] {platform}/{game} · auctioning {window.target_season} from "
          f"{window.input_season} · as of {window.auction_date}")

    # The real squads first: the row set of the sheet is who is in a club TODAY, listone or not.
    derive_squads(ctx, window.auction_date)
    # Then the granular real role, which needs the squads (the per-player top-up walks them) and is
    # observed for the PERIMETER - the clubs this platform actually lets you buy from.
    if refresh:
        failure = refresh_real_roles(
            ctx, perimeter_clubs(conn, platform, (window.input_season, window.target_season)),
            window.auction_date)
        if failure:
            notes.append(failure)
    data = features.prepare(conn, window, platform, game, league=ctx.config.load_league(),
                            squad_source="real")
    if not data.matchdays_target:
        # Not a note only: appearances are predicted as a SHARE of the target calendar, and a calendar
        # of zero rounds turns every prediction into zero. The season being auctioned has not been
        # played, so its length is last season's until it exists.
        data.matchdays_target = data.matchdays_prev
        notes.append(f"{window.target_season} has no matchdays yet, so expected appearances are "
                     f"scaled on {window.input_season}'s calendar ({data.matchdays_prev} rounds)")
    data, predictions, params_source, engine_notes = engine_predictions(
        conn, window, platform, game, ctx.config.load_league(), prepared=data)
    notes += engine_notes
    if not data.observations:
        raise RuntimeError(f"no players in the {window.target_season} listone for platform "
                           f"{platform} - nothing to snapshot")

    seasons = [row[0] for row in conn.execute(
        "SELECT DISTINCT season FROM rosters WHERE season <= ? ORDER BY season",
        (window.target_season,))]
    starters, starters_date = latest_starters(conn, window.auction_date)   # notes is already open
    if not starters:
        notes.append("no probabili snapshot at or before the auction date: the starter and duel "
                     "columns are empty. This history only accumulates from the day the weekly job "
                     "starts running - it cannot be backfilled.")
    squads, squad_sources = squad_as_of(conn, window.auction_date)
    layers = {
        "form": club_form(conn, window.auction_date, data.observations, squads),
        "squads": squads, "squad_sources": squad_sources,
        "injuries": injury_history(conn, window.auction_date, seasons),
        "starters": starters,
        "availability": availability_now(conn, window.auction_date),
        "propensity": propensity(conn, window.input_season),
        "titolarita": titolarita(conn, window.input_season),
        "discipline": discipline(conn, window.input_season, platform),
        "contract": contract_state(conn, window.target_season),
        "penalties": penalty_duty(conn, window.auction_date),
        # Where he really stood on the pitch last season (the positional heatmap). Empty until
        # `positions --layer heatmap` has run; the view falls back to the Mantra roles, which name a
        # side for defenders but not for wingers.
        "real_roles": {fc_id: role for fc_id, role in conn.execute(
            "SELECT fc_id, derived_role FROM positions WHERE season = ? AND source = 'sofascore' "
            "AND derived_role IS NOT NULL", (window.input_season,))},
        # The GRANULAR real role: one to three of the provider's twelve codes (GK, DL/DC/DR, DM,
        # ML/MC/MR, AM, LW/RW, ST). It answers the question neither of the other two can - a left back
        # is not a centre back, and P/D/C/A and G/D/M/F both call them the same thing. Read as of the
        # auction date, because it is a dated observation and not a season fact.
        "real_role_detail": positions.roles_as_of(conn, window.auction_date),
        "sides": measured_sides(conn, window.input_season, notes),
        "positions": {fc_id: (avg_x, avg_y) for fc_id, avg_x, avg_y in conn.execute(
            "SELECT fc_id, avg_x, avg_y FROM positions WHERE season = ? AND source = 'sofascore'",
            (window.input_season,))},
    }
    layers["duels"] = duels(data.observations, starters)
    covered = sum(1 for obs in data.observations if obs.fc_id in layers["real_role_detail"])
    if covered < len(data.observations):
        notes.append(f"{len(data.observations) - covered} of {len(data.observations)} players have no "
                     f"granular real role: the provider's squad pages did not list them, or their "
                     f"identity is not resolved to a provider id. Their line is still known from "
                     f"desc_real_role (G/D/M/F) - what is missing is the flank. "
                     f"`positions --layer roles` retries, and only for TODAY: the codes cannot be "
                     f"observed for a past date.")

    perimeter = perimeter_clubs(conn, platform, (window.input_season, window.target_season))
    if not perimeter:
        # An unknown perimeter is not an empty one: filtering on nothing would blank the whole sheet.
        notes.append(f"platform {platform} has no ratings for {window.input_season}/"
                     f"{window.target_season}, so the perimeter is unknown and nothing was filtered")
        perimeter = None
    rows = build_rows(conn, data, predictions, layers, perimeter)
    dropped = len(data.observations) - len(rows) if perimeter is not None else 0
    if dropped:
        notes.append(f"{dropped} players were left out of the sheet: their club is not one this "
                     f"platform plays ({len(perimeter)} clubs are). They stay in the engine's "
                     f"population, so every number here is the one the harness would give")
    clubs = club_context(conn, data, starters_date,
                         sorted({row["club"] for row in rows if row.get("club")}))

    stamp = dt.datetime.now(tz=dt.UTC).date().isoformat()
    folder = Path(out) if out else (ctx.config.data_dir / "reports" /
                                    f"auction-snapshot-{window.target_season}-{platform}-{game}-{stamp}")
    folder.mkdir(parents=True, exist_ok=True)
    _write_csv(folder / "players.csv", PLAYER_COLUMNS, rows)
    _write_csv(folder / "clubs.csv", list(clubs[0]) if clubs else ["club"], clubs)

    filled = {column: sum(1 for row in rows if row.get(column) not in (None, ""))
              for column in PLAYER_COLUMNS}
    manifest = {
        "generated_at": dt.datetime.now(tz=dt.UTC).isoformat(timespec="seconds"),
        "platform": platform, "game": game,
        "target_season": window.target_season, "input_season": window.input_season,
        "auction_date": window.auction_date,
        "players": len(rows), "clubs": len(clubs),
        "engine": {
            "rules": ["R0", *evaluate.ADOPTED.get(platform, ())],
            "params_from": params_source,
            "_note": "The `engine_*` columns are the valuation the gate validated. The parameters come "
                     "from a window that is not the season being auctioned. A coefficient quoted "
                     "without its platform, its residual baseline and its date is not a fact - the "
                     "numbers live in data/reports/engine_backtest.json.",
        },
        "descriptive": {
            "_note": "Every `desc_*` column is DESCRIPTIVE and NOT gated. It is there for the human "
                     "reading the sheet. Turning any of it into a coefficient requires a "
                     "pre-registered gate run - six families of fantamedia hypotheses have already "
                     "died that way.",
            "form_matches": FORM_MATCHES,
            "duel_margin": BALLOTTAGGIO_MARGIN,
            "injury_recency_weights": list(INJURY_WEIGHTS),
        },
        "real_role_note": {
            "_note": "desc_real_roles is the player's REAL position in the provider's own twelve-code "
                     "vocabulary, most representative first. It is the only column that separates a "
                     "left back from a centre back: role_classic calls both D, and desc_real_role "
                     "(the modal per-match slot) calls both D as well.",
            "vocabulary": {code: positions.REAL_ROLE_LABEL[code] for code in positions.REAL_ROLES},
            "drawing": "desc_real_role_depth 0 = his own goal, 1 = the opponent's (the axis avg_x is "
                       "measured on); desc_real_role_side -1 = the team's left, +1 = its right. They "
                       "are LAYOUT positions derived from the primary code, not measured and not "
                       "fitted; avg_x/avg_y from the heatmap is the measured version and wins where "
                       "it is filled.",
            "cannot_be_backfilled": "The provider serves only NOW - `?seasonId=` is accepted (HTTP "
                                    "200) and ignored, returning today's codes for any past season. "
                                    "So this is the THIRD snapshot-only fact, with probable_starter "
                                    "and flags.contract_until: every day it is not observed is a day "
                                    "that will never exist. It is stored dated in `player_roles` and "
                                    "read here as of the auction date.",
        },
        "formation_note": ("The lines are counted in the PROVIDER's vocabulary, where a winger is a "
                           "midfielder: a 4-3-3 with two wingers therefore reads 4-5-1. Measured "
                           "translation, provider slot -> listone role: G->P 100%, D->D 97%, M->C 80%, "
                           "F->A 80% (data/reports/role_crosstab.csv). Read the shape as who stands "
                           "where, not as the coach's declared module."),
        "not_measurable": {
            "club_relationship": "no source in the whitelist states it. The proxies actually measured "
                                 "are desc_contract_until, desc_exit_risk, desc_arrival*, "
                                 "desc_transfer_fee, desc_seasons_at_club and desc_new_coach.",
            "set_piece_duty": "the votes API never fills assists_set_piece, so corners and free kicks "
                              "cannot be attributed. Penalties are, revealed from our own votes.",
            "coach_ideas": "not stated anywhere either. What is measured: who the coach is and since "
                           "when, whether he is new, the formation of today's probabili, and how many "
                           "players per line the club actually fielded last season.",
        },
        "column_coverage": filled,
        "notes": notes,
    }
    (folder / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"[snapshot] {len(rows)} players · {len(clubs)} clubs -> {folder}")
    thin = [column for column, count in filled.items()
            if column.startswith(("engine_", "desc_")) and count < len(rows) * 0.2]
    if thin:
        print(f"[snapshot] thin columns (<20% filled): {', '.join(thin)}")
    for line in notes:
        print(f"[snapshot] note: {line}")
    return manifest
