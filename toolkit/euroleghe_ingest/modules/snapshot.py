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
import time
from pathlib import Path
from typing import NamedTuple

from euroleghe_ingest import config, matching
from euroleghe_ingest.context import Context
from euroleghe_ingest.engine import estimate as est
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

# WHEN AN OLD SHEET IS STALE. `generated_at` says when a folder was written; it cannot say whether the code
# that wrote it still computes the same numbers, and «rifare gli snapshot» was a question nobody could answer
# from the folder itself (06/08/2026). Bump this whenever a change moves a value a sheet CARRIES - a rule, a
# constant, a layer, an identity in the DB - and leave it alone for anything cosmetic. A folder whose
# `sheet_revision` is lower than this one was built by a different model and is to be rebuilt.
#   1  everything up to 05/08/2026 (folders with no `sheet_revision` at all are revision 0 by definition)
#   2  06/08/2026 - the live squad's completeness guard (93 marked rows -> 48); the twin club identities
#      merged (109 -> 106 clubs, so coaches / elo / penalty hierarchy / the live-squad join all move);
#      `other_platform` restricted to the same competition (13 rows); the `older` rung regressed toward the
#      anchor (38 rows).
#   3  07/08/2026 - the live squad is derived AGAIN after the roles step, which is what downloads the
#      payload it reads: every sheet before this one carried the PREVIOUS day's live squad, so the
#      departures (⇥) and the eleven were one reading behind.
#   4  07/08/2026 - the probabili are read only for the season being AUCTIONED
#      (`probable_starter.season`): until now the freshest reading was the last 2025-26 round, so 428 of
#      648 Serie A rows carried a starting probability of 1.0 taken from line-ups already played, 415
#      duels were built on it, and its 442 players asserted a 2026-27 squad. Now empty by design.
SHEET_REVISION = 4

# How complete a live payload must be before its SILENCE counts as evidence, as a share of the identified
# squad the sheet itself shows for that club. MEASURED, not chosen (05/08/2026, over the euro and the
# Serie A sheets, 172 absences, precision = the share a transfer corroborates - a LOWER bound, since the
# provider caught Gutierrez a week before the transfers layer did):
#
#   gate   absences kept   corroborated   precision   absence-only claims kept
#   0.00        172              99          57.6%              73
#   0.80        130              94          72.3%              36
#   0.85         94              77          81.9%              17
#   0.90         59              49          83.1%              10      <- the plateau starts here
#   0.95         27              24          88.9%               3      <- and the signal all but vanishes
#
# `/team/{id}/players` is the FIRST TEAM, and how much of it the provider publishes varies: West Ham reads
# 18 men against 29 identified, and every one of its 14 "departures" was uncorroborated - while Bologna at
# 0.86 was 6/6 right. Below the gate a silence is under-reading, not a departure. Precision is what this
# guard buys and recall is what it costs, and the asymmetry decides: a false departure hides a man who is
# really there, a missed one only leaves the listone's own claim standing.
SQUAD_COMPLETENESS = 0.90

# The stages a build walks, in order, each with the SECONDS it was measured to cost - which is the only
# reason a percentage may be shown at all. Seconds and not shares, because the two stages that touch the
# network dominate the total when they run and cost nothing when the cache already answers, so a fixed
# share would be wrong in both directions.
# Measured on 03/08/2026, euro/mantra 2026-27 (910 rows, 34 clubs): the offline stages from
# `[snapshot] stages:`, the timing line every run now prints (65s in total, of which the engine fit is
# 37); `roles` from the cache timestamps of a real refresh - 35 club pages in 95s plus a 71-player
# top-up in 197s - and `refresh` from its two page fetches, the one stage small enough not to matter.
# They are re-measurable the same way: read the timing line after any run.
# What the percentage is NOT: an estimate of the seconds remaining. A build's cost is dominated by
# whatever the DB is missing that day, so the honest reading is "this much of the WORK is behind us",
# with the stage name beside it saying which work. The label is what the operator reads.
STAGES: tuple[tuple[str, str, float], ...] = (
    ("refresh", "today's probabili", 8.0),
    ("squads", "real squads", 14.0),
    ("roles", "granular real roles", 293.0),
    ("prepare", "engine features", 5.0),
    ("predict", "engine predictions", 37.0),
    ("form", "the club's last ten", 4.4),
    ("layers", "descriptive layers", 4.3),
    ("fielded", "the eleven fielded next", 0.5),
    ("rows", "the sheet's rows", 1.0),
    ("write", "csv + manifest", 0.5),
)


class Progress:
    """How much of a build is behind us, printed as a percentage the panel can read.

    One line per stage, `[snapshot] 46% · descriptive layers`, on stdout with everything else the module
    says - so the CLI log, the Operations log and the Snapshot tab's own bar all get the same signal from
    the same place, and none of them has to model this module's phases. The panel parses the percentage
    (`SnapshotView.building`) and falls back to the stage text on a line that carries no number.

    The arithmetic is in SECONDS: each finished stage adds its measured cost, and the percentage is that
    over the cost of the stages this run will really walk. Hence a build with no refresh is not a bar
    that stops at 20% - the two network stages are dropped from the denominator - and a `tick(0, 0)`
    means "this stage found nothing to do", which drops it too rather than jumping the bar over work that
    never happened. Monotone by construction: a stage closes at its full cost, and dropping a stage only
    ever shrinks the denominator.

    Within a long stage `tick()` interpolates over a COUNTED total (clubs to observe, players to walk) -
    a real fraction of a real denominator, never a spinner dressed up as a number.

    It also records how long each stage really took and prints it at the end, which is what makes the
    costs above a measurement instead of a guess: they were read off that line, and re-reading it is how
    they get corrected when the module changes.
    """

    def __init__(self, skip: tuple[str, ...] | set[str] = ()) -> None:
        self.cost = {key: seconds for key, _label, seconds in STAGES if key not in skip}
        self.labels = {key: label for key, label, _seconds in STAGES}
        self.spent = 0.0                    # the measured seconds the finished stages account for
        self.current: str | None = None
        self.timings: dict[str, float] = {}
        self._started = time.monotonic()
        self._stage_started = self._started

    def _say(self, seconds: float, label: str) -> None:
        share = seconds / (sum(self.cost.values()) or 1.0)
        print(f"[snapshot] {min(round(share * 100), 99):2.0f}% · {label}", flush=True)

    def stage(self, key: str, label: str | None = None) -> None:
        """Start a stage: closes the one before it at its FULL cost and announces this one."""
        now = time.monotonic()
        if self.current:
            self.timings[self.current] = now - self._stage_started
            self.spent += self.cost.get(self.current, 0.0)
        self._stage_started = now
        self.current = key
        if key in self.cost:
            self._say(self.spent, label or self.labels.get(key, key))

    def tick(self, count: int, total: int, label: str | None = None) -> None:
        """Interpolate inside the current stage over a counted total (`4/34 clubs`).

        `total == 0` is the answer "nothing to fetch": the stage is dropped from the denominator, which
        is the difference between a bar that credits the cache and one that pretends 34 clubs were
        observed in a second.
        """
        if not self.current:
            return
        if not total:
            self.cost.pop(self.current, None)
            self._say(self.spent, f"{self.labels.get(self.current, self.current)} - nothing to fetch")
            return
        share = self.spent + self.cost.get(self.current, 0.0) * min(count / total, 1.0)
        self._say(share, f"{label or self.labels.get(self.current, self.current)} {count}/{total}")

    def finish(self) -> None:
        """100%, and the timing line the costs are re-measured from."""
        if self.current:
            self.timings[self.current] = time.monotonic() - self._stage_started
            self.current = None
        elapsed = time.monotonic() - self._started
        print("[snapshot] 100% · done", flush=True)
        if self.timings:
            measured = " · ".join(f"{key} {value:.1f}s ({value / (elapsed or 1):.0%})"
                                  for key, value in self.timings.items())
            print(f"[snapshot] stages: {measured} · total {elapsed:.1f}s")


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


def resolve_window(conn, season: str | None = None, today: str | None = None,
                   as_of: str | None = None) -> tuple[features.Window, str | None]:
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
    # `as_of` IS the day the sheet stands on, so it is also the day that decides which season is being
    # played: standing on 1 March 2026 the season in progress is 2025-26, and reading "today" from the
    # clock instead would auction 2026-27 with March's squads - two different seasons in one sheet.
    today = as_of or today or dt.datetime.now(tz=dt.UTC).date().isoformat()
    target = season or season_of(today)
    note = None
    if target not in seasons:
        note = (f"{target} has no listone yet (rosters = 0): the sheet is built from the REAL squads, "
                f"so roles come from each player's last listone row and there are no quotations to "
                f"show. Rerun it when the listone is out and the same command fills them in.")
    earlier = [value for value in seasons if value < target]
    input_season = earlier[-1] if earlier else target
    # `as_of` is taken literally, 15 August is not imposed on it: the point of a back-dated snapshot is to
    # stand on a DAY inside a season - "what did this squad look like on 1 March" - and clamping it to the
    # pre-season would answer a different question. Without it, the auction is the usual mid-August one.
    auction = as_of or min(f"{target.split('-')[0]}-08-15", today)
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
    # ...and every OTHER spelling of ours that the alias table sends to the same provider club. Needed
    # since the twin identities were merged (`db.database.merge_twin_clubs`): `Eintracht Francoforte` was
    # a row of `clubs` and is now only an alias key, while 1210 rows of `match_ratings.team` and 27
    # transfers still spell it that way - and a source string is EVIDENCE, never rewritten to match a
    # table. Without this the merge would have traded three split clubs for three unreadable spellings.
    for ours, theirs in CLUB_ALIASES.items():
        known = canonical.get(club_key(theirs))
        if known is not None:
            canonical.setdefault(club_key(ours), known)

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


def derive_squads(ctx: Context, date: str | None = None,
                  season: str | None = None) -> dict[str, int]:
    """Who is REALLY in each club's squad today -> `squad_snapshot`. Offline, from three sources.

    An auction is prepared before the listone exists, so the sheet cannot be built from `rosters`.
    These are, strongest first:

      fc_site        the probabili page carries an exact fc_id in every href, so its 20 Serie A squads
                     are certain - but it is Serie A only, AND only for the season the page is about:
                     `season` keeps the last round of the season that ended from asserting a squad for
                     the one being auctioned (07/08/2026: 442 rows a day, all of 2025-26);
      transfermarkt  the CURRENT squad page of each perimeter club (already cached by `injuries`),
                     resolved through player_xref: all five leagues, ~1400 players;
      appearances    whoever actually played for the club in its recent matches - the backstop, and the
                     only source for a club neither page covers.

    Dated on purpose: a squad is a fact about a DAY, and in August it changes weekly. Same discipline as
    every other volatile state - the snapshot then reads "the squad as of the auction date".
    """
    conn = ctx.require_conn()
    date = date or dt.datetime.now(tz=dt.UTC).date().isoformat()
    counts = {"fc_site": 0, "sofascore": 0, "transfermarkt": 0, "appearances": 0}
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
        "SELECT MAX(valid_from) FROM probable_starter WHERE valid_from <= ?"
        + (" AND season = ?" if season else ""),
        (date, season) if season else (date,)).fetchone()[0]
    if latest_probabili:
        for fc_id, team, role in conn.execute(
                "SELECT fc_id, team, role FROM probable_starter WHERE valid_from = ?"
                + (" AND season = ?" if season else ""),
                (latest_probabili, season) if season else (latest_probabili,)):
            conn.execute(
                "INSERT OR REPLACE INTO squad_snapshot(fc_id, valid_from, club, source, role_hint) "
                "VALUES (?, ?, ?, 'fc_site', ?)",
                (fc_id, latest_probabili, canonical(team), role))
            counts["fc_site"] += 1

    # THE LIVE SQUAD, and it is the freshest thing we have: `/team/{id}/players` is one request per club,
    # already downloaded every day for the granular roles, and dated. Measured on the case that asked for a
    # reliable source: on 28/07 its Napoli payload had 46 players and NOT Gutierrez, while `fc_site` still
    # listed him on 04/08 and the Transfermarkt squad page on 29/07 - the provider had the departure a week
    # before either of them. Read from the same cache the roles layer reads (`positions._squad_players`), so
    # there is one parser and no new request.
    from euroleghe_ingest.modules.positions import _SQUAD_CACHE_NAME, _squad_players

    by_provider = {source_id: club for source_id, club in conn.execute(
        "SELECT x.source_id, cl.canonical_name FROM club_xref x JOIN clubs cl "
        "ON cl.fc_club_id = x.fc_club_id WHERE x.source = 'sofascore'")}
    player_ids = {source_id: fc_id for source_id, fc_id in conn.execute(
        "SELECT source_id, fc_id FROM player_xref WHERE source = 'sofascore'")}
    newest: dict[str, tuple[str, Path]] = {}
    for path in sorted(ctx.config.cache_dir.glob("sofascore_squad_*.json")):
        key = _SQUAD_CACHE_NAME.search(path.name)
        if not key or key.group(2) > date:
            continue                          # a payload observed after the sheet's day is the future
        club = by_provider.get(key.group(1))
        if club and (club not in newest or key.group(2) > newest[club][0]):
            newest[club] = (key.group(2), path)
    for club, (observed, path) in newest.items():
        try:
            players = _squad_players(json.loads(path.read_text(encoding="utf-8")))
        except Exception as exc:   # noqa: BLE001 - a corrupt cache file must not abort a snapshot
            print(f"[snapshot] skipping unreadable squad cache {path.name}: {exc}")
            continue
        for player in players:
            fc_id = player_ids.get(str(player.get("id") or ""))
            if fc_id is None:
                continue
            conn.execute(
                "INSERT OR REPLACE INTO squad_snapshot(fc_id, valid_from, club, source, role_hint) "
                "VALUES (?, ?, ?, 'sofascore', NULL)", (fc_id, observed, club))
            counts["sofascore"] = counts.get("sofascore", 0) + 1

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
          f"(fc_site {counts['fc_site']}, sofascore {counts['sofascore']}, "
          f"transfermarkt {counts['transfermarkt']}, appearances {counts['appearances']})")
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

# THE COMPETITIONS THAT MAKE UP A PLATFORM'S CALENDAR, and therefore the only ones a "share of the
# season" may be measured over. They are the five championships themselves (`config.LEAGUES`), which is
# also the value `external_match_stats.competition` / `club_match_lineups.competition` carry for a league
# match - the cups and the continental rounds arrive with the provider's own slug ('uefa-champions-
# league', 'coppa-italia', ...), so the set is exact and not a prefix match.
#
# Why it is a filter and not a detail: the season AGGREGATE (`external_stats`) stores one row per
# championship and nothing else, so every numerator in this sheet - starts, appearances, minutes - is
# already league-only. The DENOMINATOR was the club's whole fixture list, and the competition mix is
# different for every club (Arsenal 58 elevens = 38 + 14 + 6, Bayern 50, Napoli 38 = Serie A alone).
# A percentage of one and a percentage of the other are not the same quantity, so the shirts read
# titolarità that could not be compared across clubs: Kane 25 starts of 34 Bundesliga rounds printed
# 50%, and a European campaign was indistinguishable from a bench.
LEAGUE_COMPETITIONS: tuple[str, ...] = config.LEAGUES
_LEAGUE_IN = ",".join("?" * len(LEAGUE_COMPETITIONS))


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
        "SELECT DISTINCT match_id FROM external_match_stats "
        "WHERE match_date IS NOT NULL AND COALESCE(minutes, 0) > 0")}
    # In the ELEVEN of a match nobody has statistics for - a pre-season friendly. It is neither a
    # performance nor an absence, so it is counted as neither: it gets its own token, and the strip
    # draws it small and grey because there is no rating to colour it with.
    lineup_only: dict[int, set[str]] = {}
    for fc_id, match_id in conn.execute(
            """SELECT fc_id, match_id FROM external_match_stats
               WHERE match_date IS NOT NULL AND match_date < ? AND started = 1
                 AND COALESCE(minutes, 0) = 0""", (auction_date,)):
        lineup_only.setdefault(fc_id, set()).add(str(match_id))
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
            elif str(match_id) in lineup_only.get(obs.fc_id, ()):
                token = "x"
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


def _merged_spells(dates: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """The UNION of a player's absence intervals, so an overlap is one absence and not two.

    This is also the answer to "does Transfermarkt count a relapse twice": counting the ROUNDS inside the
    union cannot, whatever the source lists, because a round is counted once or not at all.
    """
    out: list[tuple[str, str]] = []
    for start, end in sorted(dates):
        if out and start <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], end))
        else:
            out.append((start, end))
    return out


def rounds_missed(conn, auction_date: str, seasons: list[str]) -> dict[int, dict[str, int]]:
    """Absences counted in the LEAGUE ROUNDS of his own club: {fc_id: {season: rounds}}.

    The unit is what makes it usable. Transfermarkt says how many of the club's GAMES a spell cost him,
    over every competition it played, and that number cannot be taken off a championship calendar or
    divided by one: Bayern play 50 fixtures and 34 of them are Bundesliga rounds, and for the Italian
    clubs our own parsed fixture list is the championship alone (38), so scaling by what we parsed
    corrects the German and leaves the Italian untouched - 8 players of the euro sheet ended up with more
    absences than their season had rounds. Here the rounds are COUNTED: his club's league fixtures, by
    date, inside the union of his spells. No scaling, no ratio, and comparable between two clubs by
    construction.

    Which club's calendar: the one he appeared for that season where the per-match layer knows (the modal
    club by appearances), the listone's otherwise - which is the case that matters, because a man injured
    from August to May has no appearances at all. A season whose calendar we do not have (a club outside
    the five leagues) is left out rather than counted as zero, and `seasons` in the result says how many
    were really measured.
    """
    resolve = club_index(conn)
    wanted = set(seasons)
    fixtures: dict[tuple[str, str], list[str]] = {}
    for club, season, date in conn.execute(
            f"""SELECT club, season, match_date FROM club_match_lineups
                WHERE competition IN ({_LEAGUE_IN}) AND match_date IS NOT NULL""",
            LEAGUE_COMPETITIONS):
        if season not in wanted:
            continue
        key, _name = resolve(club)
        if key:
            fixtures.setdefault((key, season), []).append(date)
    # Where he was, season by season: appearances first (they are the fact), the listone as the fallback.
    where: dict[tuple[int, str], str] = {}
    for fc_id, season, club in conn.execute(
            """SELECT r.fc_id, r.season, c.canonical_name FROM rosters r
               JOIN clubs c ON c.fc_club_id = r.fc_club_id
               WHERE c.canonical_name IS NOT NULL"""):
        if season in wanted:
            key, _name = resolve(club)
            if key:
                where[(fc_id, season)] = key
    counts: dict[tuple[int, str], dict[str, int]] = {}
    for fc_id, season, club, appearances in conn.execute(
            """SELECT fc_id, season, club, COUNT(*) FROM external_match_stats
               WHERE source = 'sofascore' AND COALESCE(minutes, 0) > 0 AND club IS NOT NULL
               GROUP BY fc_id, season, club""", ()):
        if season not in wanted:
            continue
        key, _name = resolve(club)
        if key:
            counts.setdefault((fc_id, season), {})[key] = appearances
    for (fc_id, season), by_club in counts.items():
        where[(fc_id, season)] = max(by_club, key=lambda club: by_club[club])

    spells: dict[int, list[tuple[str, str]]] = {}
    for fc_id, start, end in conn.execute(
            "SELECT fc_id, start_date, COALESCE(end_date, ?) FROM injuries WHERE start_date <= ?",
            (auction_date, auction_date)):
        spells.setdefault(fc_id, []).append((start, min(end, auction_date)))
    out: dict[int, dict[str, int]] = {}
    for fc_id, mine in spells.items():
        merged = _merged_spells(mine)
        for season in seasons:
            dates = fixtures.get((where.get((fc_id, season)) or "", season))
            if not dates:
                continue
            out.setdefault(fc_id, {})[season] = sum(
                1 for date in dates if any(start <= date <= end for start, end in merged))
    return out


def investment(conn, window, observations, squads: dict[int, str]) -> dict[int, dict]:
    """How much this club has PUT INTO him, in two channels that must not be merged.

    The hypothesis (the user's, 29/07/2026): a club that has spent on a player wants to see him play, and
    the coach is more forgiving with him than with a youth-team man - so investment should weigh on who is
    selected, beyond what last season's minutes already say.

    Two channels, because they catch different players, and MEASURED rather than assumed:

    * `fee_share` - what he cost, as a share of everything this club spent in that window. Isak 145 M of
      Liverpool's 336 M is 0.43; a man already at the club has no new spending and reads 0. A SHARE, so it
      is the argument "relative to the club's cash" as far as our data can carry it: we have what the club
      spent, never what it earns or pays in wages.
    * `stature` - his Qt.I percentile WITHIN his role: the market's own statement about how important he is.
      This is the channel that catches the celebrity, and the measurement is why both exist - **Modric and
      De Bruyne arrived on FREE transfers**, so the fee says "no investment" for exactly the two names the
      hypothesis was built on, while their Qt.I sits at the 77th and 94th percentile of the midfielders.
      Centred and doubled to [-1, +1], because the claim has two sides: the expensive man is forgiven a bad
      game AND the cheap youngster pays for it.

    WAGES ARE NOT AVAILABLE and no whitelisted source carries them. They are the best single measure of a
    club's standing commitment, and their absence is a limit of this layer, not a detail.

    Legality: the fee is dated and read only before the auction date; Qt.I is the PRE-auction quotation (the
    only price a rule may read), taken from the season being auctioned where the listone exists and from the
    previous one where it does not yet - which is the case in July, when this sheet is built.
    """
    resolve = club_index(conn)
    now: dict[int, str] = {}
    for obs in observations:
        key, _name = resolve(obs.club_target or squads.get(obs.fc_id))
        if key:
            now[obs.fc_id] = key
    # The transfer window being priced: from the June before the target season to the auction day.
    since = f"{int(window.target_season.split('-')[0]) - 1}-06-01" \
        if window.auction_date[5:7] < "06" else f"{window.target_season.split('-')[0]}-06-01"
    fees: dict[int, float] = {}
    spent: dict[str, float] = {}
    for fc_id, to_club, fee in conn.execute(
            """SELECT fc_id, to_club, fee FROM transfers_history
               WHERE fee IS NOT NULL AND date >= ? AND date <= ?""", (since, window.auction_date)):
        key, _name = resolve(to_club)
        if key is None:
            continue
        fees[fc_id] = max(fees.get(fc_id, 0.0), float(fee))
        spent[key] = spent.get(key, 0.0) + float(fee)
    # Qt.I percentile within the role, on the listone being auctioned - or the previous one while it does
    # not exist. A percentile and not the price: a 20 is elite for a defender and mid-table for a striker.
    prices: dict[int, tuple[float, str]] = {}
    for season in (window.target_season, window.input_season):
        for fc_id, price, role in conn.execute(
                "SELECT fc_id, price_initial, role_classic FROM rosters "
                "WHERE season = ? AND price_initial IS NOT NULL", (season,)):
            prices.setdefault(fc_id, (float(price), role or "?"))
        if prices:
            break
    by_role: dict[str, list[float]] = {}
    for price, role in prices.values():
        by_role.setdefault(role, []).append(price)
    # THE THIRD CHANNEL, and the one the other two were missing: his MARKET VALUE as a share of the value
    # of the squad he is in, both read on the INPUT season (`market_values`, from the source's own squad
    # page of that season - a season fact, never today's). It is the same argument as `fee_share` - how big
    # a part of this club's commitment is he - and unlike the fee it exists for a man who arrived FREE,
    # which is exactly where the fee proxy failed: Modric and De Bruyne read "no investment" (gate
    # 7-quater). Read on the input season and never on the target one: the target season's value would
    # know the outcome.
    values = {fc_id: float(value) for fc_id, value in conn.execute(
        "SELECT fc_id, value FROM market_values WHERE season = ? AND value IS NOT NULL",
        (window.input_season,))}
    squad_value: dict[str, float] = {}
    for fc_id, value in values.items():
        club = now.get(fc_id)
        if club:
            squad_value[club] = squad_value.get(club, 0.0) + value
    out: dict[int, dict] = {}
    for obs in observations:
        club = now.get(obs.fc_id)
        fee = fees.get(obs.fc_id)
        total = spent.get(club or "", 0.0)
        entry: dict = {
            "fee": fee,
            # None, not 0, when the club spent nothing we know of: a share of an unknown total is unknown,
            # and reporting it as 0 would say "he was free" about a club whose fees we simply do not have.
            "fee_share": round(fee / total, 3) if fee and total else (0.0 if total else None),
            "value": values.get(obs.fc_id),
            # ...and the same rule for the share: unknown squad total, unknown share.
            "value_share": (round(values[obs.fc_id] / squad_value[club], 4)
                            if obs.fc_id in values and squad_value.get(club) else None),
        }
        if obs.fc_id in prices:
            price, role = prices[obs.fc_id]
            peers = by_role.get(role) or [price]
            entry["stature"] = round(sum(1 for other in peers if other <= price) / len(peers), 3)
        out[obs.fc_id] = entry
    return out


def fielded_next(conn, auction_date: str, observations, squads: dict[int, str]
                 ) -> tuple[dict[int, dict], dict[str, dict]]:
    """Who ACTUALLY started the club's first match AFTER the auction date. A fact, not a forecast.

    Why it exists, and it is a decision worth reading before the code: a sheet standing on TODAY refreshes
    the probabili, because the editors' list is the most recent thing there is and the coach's words are
    already in it. A sheet standing on a PAST date cannot use them - and does not need to, because for that
    date the eleven that was actually fielded EXISTS. A forecast is only interesting while the outcome is
    unknown.

    So these columns are neither `engine_*` nor `desc_*`: they are `actual_*`, measured strictly AFTER the
    auction date, reporting only, and no rule and no prediction may read them. The prefix is the guard - the
    board draws them, says out loud that they are the fielded eleven, and never pours them into
    `desc_starter_prob`, because then nobody could tell a guess from an outcome.

    Empty by construction for a sheet built today: the next match has not been played.
    """
    resolve = club_index(conn)
    # The first fixture after the date, per club, with the line-up it fielded. `club_match_lineups` is the
    # right source: one row per club-match, so it exists even for a club whose players we cannot all resolve.
    # By DATE, and that is the only unit that survives a postponement: a match can be played weeks after
    # the round it belongs to, so "the next match" is a date and never a matchday number. The round is
    # carried along so a catch-up is visible in the label instead of reading as the following round.
    first: dict[str, tuple] = {}
    for club, match_id, date, competition, real_md, defenders, midfielders, forwards, starters in \
            conn.execute(
                """SELECT club, match_id, match_date, competition, real_md,
                          defenders, midfielders, forwards, starters
                   FROM club_match_lineups
                   WHERE match_date IS NOT NULL AND match_date > ? ORDER BY match_date""",
                (auction_date,)):
        key, _name = resolve(club)
        if key and key not in first:
            first[key] = (str(match_id), date, competition, real_md,
                          defenders, midfielders, forwards, starters)
    clubs: dict[str, dict] = {}
    for obs in observations:
        key, name = resolve(obs.club_target or squads.get(obs.fc_id))
        if key in first and name not in clubs:
            match_id, date, competition, real_md, defenders, midfielders, forwards, starters = first[key]
            clubs[name] = {
                "match_id": match_id, "date": date, "competition": competition, "round": real_md,
                # the shape as FIELDED, in the provider's vocabulary (a winger is a midfielder)
                "shape": (f"{defenders}-{midfielders}-{forwards}"
                          if starters == 11 and None not in (defenders, midfielders, forwards)
                          and defenders + midfielders + forwards == 10 else None),
            }
    wanted = {entry["match_id"] for entry in clubs.values()}
    # Keyed by the player AND by his club in that match, because a match_id carries BOTH teams: read
    # without the club, a man the listone puts at Milan who actually played that day for the opponent was
    # counted among Milan's starters (twelve of them), and the opponent field came out as the club itself.
    played: dict[tuple[str, int], tuple] = {}
    fixture: dict[tuple[str, str], tuple] = {}
    if wanted:
        placeholders = ",".join("?" * len(wanted))
        for match_id, fc_id, club, started, minutes, opponent, home in conn.execute(
                f"""SELECT match_id, fc_id, club, COALESCE(started, 0), COALESCE(minutes, 0),
                           opponent, home
                    FROM external_match_stats WHERE match_id IN ({placeholders})""", (*wanted,)):
            key, _name = resolve(club)
            if not key:
                continue
            played[(str(match_id), fc_id)] = (started, minutes, key)
            if opponent:
                fixture[(str(match_id), key)] = (opponent, home)
    out: dict[int, dict] = {}
    for obs in observations:
        key, name = resolve(obs.club_target or squads.get(obs.fc_id))
        entry = clubs.get(name or "")
        if not entry:
            continue
        row = played.get((entry["match_id"], obs.fc_id))
        if row and row[2] != key:
            row = None          # he played that match for the other side: not this club's eleven
        opponent, home = fixture.get((entry["match_id"], key or ""), (None, None))
        out[obs.fc_id] = {
            "match": " ".join(part for part in (
                entry["date"], entry["competition"] or "",
                f"md{entry['round']}" if entry.get("round") else "",
                f"vs {opponent}" if opponent else "",
                "(H)" if home else "(A)" if home == 0 else "") if part),
            # 1 he started · 0 he came on or was not used · empty only when the layer has no rows at all
            "started": (1 if row and row[0] else 0) if played else None,
            "minutes": row[1] if row else 0 if played else None,
        }
    return out, clubs


def injury_history(conn, auction_date: str, seasons: list[str],
                   measured: str | None = None) -> dict[int, dict]:
    """Absences per player: matches missed, weighted by recency, plus whatever is open right now.

    `matches_missed` and not days: days become matches only through the calendar, and the source
    already did that translation. A player with no rows is NOT a player with zero absences - he may
    simply have no Transfermarkt id, which is why `desc_injury_source` says which of the two it is.

    Two numbers, and they answer different questions - which is why the sheet now carries both:

    * `weighted` over three seasons = how much a man LIKE THIS misses in a season. A FORECAST, and the
      only one of the two that belongs in an availability discount.
    * `missed_measured` = what he actually missed inside the season the other layers measure. That is a
      fact about a sample, and it is what the denominator of a start RATE needs: a man injured for two
      months started fewer matches, and dividing by the whole calendar reads his absence as the coach
      preferring someone else. Putting the three-season forecast there instead - which is what this sheet
      did until the units were checked - makes the discount cancel almost exactly out of `presence`,
      because the same estimate is subtracted and then multiplied back in.

    Both of them come in two units, and the sheet carries both because they are not equally good. The
    source's own count is over every competition the club played (`matches_missed`, `weighted`); the
    ROUNDS versions (`rounds_measured`, `rounds_weighted`) are counted on his club's league fixtures by
    date (`rounds_missed`), which is the unit every share in this sheet is expressed in - and the only one
    that can be compared between two clubs. `rounds_seasons` says how many of the three seasons had a
    calendar to count on: zero means the rounds are unknown, not zero, and the view falls back to scaling
    the source's number.
    """
    known = {fc_id for (fc_id,) in conn.execute(
        "SELECT DISTINCT fc_id FROM player_xref WHERE source = 'transfermarkt'")}
    weights = {season: INJURY_WEIGHTS[index] for index, season in
               enumerate(reversed(seasons[-len(INJURY_WEIGHTS):]))}
    rounds = rounds_missed(conn, auction_date,
                           sorted({*weights, *([measured] if measured else [])}))
    out: dict[int, dict] = {}
    for fc_id, start, end, kind, days, missed in conn.execute(
            """SELECT fc_id, start_date, end_date, kind, days_out, matches_missed FROM injuries
               WHERE start_date <= ? ORDER BY start_date DESC""", (auction_date,)):
        season = f"{int(start[:4]) - (0 if start[5:7] >= '07' else 1)}-" \
                 f"{(int(start[:4]) + (1 if start[5:7] >= '07' else 0)) % 100:02d}"
        entry = out.setdefault(fc_id, {"spells": 0, "matches_missed": 0, "days_out": 0,
                                       "weighted": 0.0, "missed_measured": 0, "worst_kind": None,
                                       "open": None, "last_start": start})
        entry["spells"] += 1
        entry["matches_missed"] += missed or 0
        entry["days_out"] += days or 0
        entry["weighted"] += (missed or 0) * weights.get(season, 0.0)
        if measured and season == measured:
            entry["missed_measured"] += missed or 0
        if (end is None or end >= auction_date) and entry["open"] is None:
            entry["open"] = f"{kind} since {start}"
        if entry["worst_kind"] is None or (days or 0) >= (entry.get("worst_days") or 0):
            entry["worst_kind"], entry["worst_days"] = kind, days or 0
    for fc_id, entry in out.items():
        entry["weighted"] = round(entry["weighted"], 2)
        entry["source"] = "transfermarkt"
        del entry["worst_days"]
        mine = rounds.get(fc_id, {})
        # The same numbers in ROUNDS of his own championship. Per season and MOST RECENT FIRST, aligned
        # with INJURY_WEIGHTS, because that is what keeps the weights sweepable: a pre-weighted total
        # freezes them at the values it was written with, and they are provisional (gate 7-bis). A season
        # with no calendar to count on is an empty entry - unknown, never a zero.
        by_season = [mine.get(season) for season in sorted(weights, reverse=True)]
        counted = {season: weight for season, weight in weights.items() if season in mine}
        entry["rounds_by_season"] = ";".join("" if value is None else str(value)
                                            for value in by_season)
        entry["rounds_weighted"] = (
            round(sum(mine[season] * weight for season, weight in counted.items())
                  / sum(counted.values()) * sum(INJURY_WEIGHTS), 2) if counted else None)
        entry["rounds_measured"] = mine.get(measured) if measured in mine else None
        entry["rounds_seasons"] = len(counted)
    for fc_id in known - set(out):
        out[fc_id] = {"spells": 0, "matches_missed": 0, "days_out": 0, "weighted": 0.0,
                      "missed_measured": 0, "rounds_weighted": 0.0, "rounds_measured": 0,
                      "rounds_by_season": ";".join(["0"] * len(weights)),
                      "rounds_seasons": len(weights),
                      "worst_kind": None, "open": None, "last_start": None,
                      "source": "transfermarkt (no absence recorded)"}
    return out


def evidence_age(conn, window: features.Window) -> tuple[dict, list[str]]:
    """How old the SQUAD and TRANSFER evidence behind this sheet is. Returns (facts, notes).

    Asked for by the operator, on a case: «Gutierrez non è più nel Napoli». The sheet was right about what
    it had - both squad sources said Napoli - and what it had was days old, while `transfers_history` did
    not carry a single move dated 2026: the whole summer market was missing and nothing said so. A squad is
    a VOLATILE state, so its age is part of the answer, and an auction sheet that cannot say how old its
    rosters are is inviting the operator to trust a fact nobody has re-checked.

    Two things are reported and neither is inferred from the other: the newest observation PER SOURCE
    (`squad_snapshot` is written by `fc_site`, `transfers`/Transfermarkt and the appearances backstop, and
    one being fresh says nothing about the others), and whether the transfer layer has any move at all in
    the window that feeds this sheet - the summer before the target season, which is exactly the market an
    August auction is about.
    """
    facts: dict = {"squad_sources": {}, "transfers_latest": None, "transfers_in_window": 0}
    notes: list[str] = []
    today = window.auction_date
    for source, latest in conn.execute(
            "SELECT source, MAX(valid_from) FROM squad_snapshot GROUP BY source"):
        facts["squad_sources"][source] = latest
    facts["transfers_latest"] = conn.execute(
        "SELECT MAX(date) FROM transfers_history").fetchone()[0]
    # The window: moves from the January of the target season's own year onwards, i.e. the market that
    # built the squads this sheet prices.
    since = f"{window.target_season.split('-')[0]}-01-01"
    facts["transfers_in_window"] = conn.execute(
        "SELECT COUNT(*) FROM transfers_history WHERE date >= ?", (since,)).fetchone()[0]
    stale = {source: latest for source, latest in facts["squad_sources"].items()
             if not latest or latest < today}
    if stale:
        notes.append("SQUAD EVIDENCE is older than the sheet's own date (" + today + "): "
                     + " · ".join(f"{source} last observed {latest or 'never'}"
                                  for source, latest in sorted(stale.items()))
                     + ". A squad is a volatile state: a man transferred since then is still drawn where "
                       "he was. Re-run `fc_site` and `transfers` to move these dates.")
    if facts["transfers_in_window"]:
        pass                                   # counted per row instead; the note is written with the rows
    if not facts["transfers_in_window"]:
        notes.append(f"TRANSFER LAYER has no move dated {since} or later (newest: "
                     f"{facts['transfers_latest'] or 'none'}), so the market that built these squads is "
                     f"not in the DB at all: an arrival's origin club and fee are blind, and any check of "
                     f"a roster against the transfers cannot fire. `transfers` fills it.")
    return facts, notes


def latest_starters(conn, auction_date: str, season: str | None = None
                    ) -> tuple[dict[int, dict], str | None]:
    """The most recent probabili snapshot at or before the auction date, per player.

    Of the season being AUCTIONED, which is not the same question as "the freshest reading". The page
    keeps serving the last round of the season that ended until the new one starts, so in August the
    newest snapshot describes 2025-26 with probabilities of 1.0 - line-ups that were FIELDED, not
    forecast. Those are a fact about a season nobody is buying any more, and the sheet says «no probabili
    snapshot» instead, which is what it is (`probable_starter.season`).
    """
    date = conn.execute(
        "SELECT MAX(valid_from) FROM probable_starter WHERE valid_from <= ?"
        + (" AND season = ?" if season else ""),
        (auction_date, season) if season else (auction_date,)).fetchone()[0]
    if not date:
        return {}, None
    out = {fc_id: {"probability": probability, "starter": bool(starter), "status": status,
                   "team": team, "formation": formation, "role": role}
           for fc_id, probability, starter, status, team, formation, role in conn.execute(
               "SELECT fc_id, probability, starter, status, team, formation, role "
               "FROM probable_starter WHERE valid_from = ?"
               + (" AND season = ?" if season else ""),
               (date, season) if season else (date,))}
    return out, date


def availability_now(conn, auction_date: str) -> dict[int, str]:
    """Latest injured/suspended state per player at the auction date (dated series, newest wins)."""
    out: dict[int, str] = {}
    for fc_id, status in conn.execute(
            "SELECT fc_id, status FROM availability WHERE valid_from <= ? ORDER BY valid_from",
            (auction_date,)):
        out[fc_id] = status
    return out


def duels(observations, starters: dict[int, dict],
          roles: dict[int, dict] | None = None) -> dict[int, dict]:
    """Starting duels: same club, same POSITION, comparable starting probability.

    Read off the probabili snapshot, which is the only source that says who the editors expect to
    start. Without a snapshot the column is empty rather than guessed from minutes - "who plays" and
    "who played" are different questions, and the second one already has its own column.

    The position is the GRANULAR REAL ROLE, and one shared code is enough ('RW;AM' and 'AM' do compete
    for a shirt). The Classic role is not a fallback and not a first pass: it says what you buy a man as,
    not where a coach puts him, and at Napoli it calls Politano, Lobotka, Elmas, McTominay, Anguissa, De
    Bruyne, Vergara and Neres all 'C' - so it declared a right winger in a duel with a regista thirty
    metres away, and the sheet then handed his shirt's alternatives to men who cannot take it while the
    real challenger went unnamed.

    A player with no code is therefore left OUT of the result entirely - unknown, not "no rival":
    reporting it as a zero would be the usual absence of evidence dressed as evidence. It is a gap in the
    OBSERVED roles, and for most of them the missing piece is the provider identity rather than a run:
    `positions --layer roles` can only observe a man it can identify. Same rule, same vocabulary, as
    `SnapshotView.can_replace`, which is where a duel becomes a shirt.
    """
    roles = roles or {}

    def codes(fc_id: int) -> set[str]:
        return {code.strip().upper()
                for code in ((roles.get(fc_id) or {}).get("roles") or "").split(";") if code.strip()}

    by_club: dict[str, list] = {}
    for obs in observations:
        entry = starters.get(obs.fc_id)
        if not obs.club_target or not entry or entry.get("probability") is None:
            continue
        if not codes(obs.fc_id):
            continue
        by_club.setdefault(obs.club_target, []).append(
            (obs.fc_id, obs.name, float(entry["probability"])))
    out: dict[int, dict] = {}
    for group in by_club.values():
        group.sort(key=lambda item: -item[2])
        for fc_id, _name, probability in group:
            mine = codes(fc_id)
            rivals = [name for other, name, other_probability in group
                      if other != fc_id
                      and abs(other_probability - probability) <= BALLOTTAGGIO_MARGIN
                      and mine & codes(other)]
            # ALL of them, not the first three: `rivals` is an exact count, so a truncated name list
            # made the two columns of the same fact disagree - 6 men of the 2026-27 euro sheet read
            # "4 rivals" next to three names, with nothing saying which one was missing. Capping how
            # many can be DRAWN is the pitch's business (`SnapshotView.rival_text`), not the data's.
            out[fc_id] = {"rivals": len(rivals), "names": "; ".join(rivals)}
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


def _unpriced_reason(prediction, obs) -> str | None:
    """Why a row has no predicted fantamedia - `''` when it has one.

    The core refuses to predict outside the domain its coefficients were fitted on (`MIN_PV_PREV` votes in
    the input season), and where that leaves the cell empty depends on the platform: euro has R0c adopted
    and prices him at the role anchor, default does not. Both cases read the same in the cell and are not
    the same fact, so the row carries which one it is - with the number, because "13 of 15" and "1 of 15"
    are different distances from a prediction.
    """
    if prediction is not None and prediction.fm_pred is not None:
        return None
    if obs.pv_prev is None:
        return "no season on this platform"
    if obs.pv_prev < evaluate.model.MIN_PV_PREV:
        vote = "vote" if obs.pv_prev == 1 else "votes"
        return f"only {obs.pv_prev} {vote} of {evaluate.model.MIN_PV_PREV}"
    return "no prediction"


def departures(conn, window: features.Window, date: str) -> dict[int, dict]:
    """{fc_id: {"at": {club keys he ARRIVED at}, "out": [(from key, destination, date)]}} in this window.

    The operator's case: «Gutierrez ad esempio non è più nel Napoli» - and every source the sheet had said
    Napoli, because the 26/27 listone lists him there and the squad pages had not caught up (fc_site 04/08,
    transfermarkt 29/07). What DID know is the transfer: Napoli -> Bayer 04 Leverkusen, 01/07/2026, 26M.

    ⚠️ AN OUT IS NOT A DEPARTURE ON ITS OWN, and finding that out is why this reads both directions. A club's
    page carries the same man twice on the same 1 July when a loan RETURNS him and the club then signs him
    permanently: Hojlund is in Napoli's OUT (to Manchester United, no fee) and in its IN (from Manchester
    United, 44M). Reading the OUT alone reported him as leaving the club that had just bought him - and 82
    rows of the first version were exactly that. So a man counts as gone only when the window holds an OUT
    from his club and NO arrival back at it.

    Only transfers dated at or before the sheet's own date: a back-dated sheet must not read a move that had
    not happened yet. `transfers_history` had to be re-keyed for this to be possible at all - see
    `db.database.widen_transfers_pk`.
    """
    floor = f"{int(window.target_season.split('-')[0])}-01-01"
    out: dict[int, dict] = {}
    for fc_id, moved_on, from_club, to_club, fee in conn.execute(
            """
            SELECT fc_id, date, from_club, to_club, fee FROM transfers_history
            WHERE date >= ? AND date <= ? ORDER BY date
            """,
            (floor, date)):
        mine = out.setdefault(fc_id, {"at": set(), "out": []})
        if to_club:
            mine["at"].add(_club_key(to_club))
        if from_club:
            mine["out"].append((_club_key(from_club), to_club, moved_on, fee))
    return out


def live_squads(conn, date: str) -> dict[str, dict]:
    """{club key: {"on": date, "club": name, "ids": {fc_id, ...}}} - each club's LIVE squad at or before `date`.

    The reliable, near-real-time source the operator asked for, and it was already in the cache: the provider's
    `/team/{id}/players` is one request per club, downloaded every day for the granular roles, and it had
    Gutierrez out of Napoli on 28/07 while the listone and both squad pages still had him days later.

    Its power is ABSENCE, which no other source of ours can express: a squad page lists who is in, a transfer
    lists an event, and only a full squad read can say "he is not in it". Hence the second half of this layer -
    and hence the two guards, because absence has two twins that mean the opposite: a man the provider cannot
    identify (`observed_players`), and a payload too thin to be a squad at all (`complete_squads`).

    Keyed on `_club_key` and NOT on the spelling: the sheet says `Newcastle` where the provider says
    `Newcastle United`, and a raw-string lookup silently answers "no payload" - which reads as "no evidence"
    and switches the whole signal off for that club without saying so.
    """
    out: dict[str, dict] = {}
    for club, observed in conn.execute(
            "SELECT club, MAX(valid_from) FROM squad_snapshot WHERE source = 'sofascore' "
            "AND valid_from <= ? GROUP BY club", (date,)):
        key = _club_key(club)
        if key not in out or observed > out[key]["on"]:
            out[key] = {"on": observed, "club": club, "ids": set()}
    for entry in out.values():
        entry["ids"] = {fc_id for (fc_id,) in conn.execute(
            "SELECT fc_id FROM squad_snapshot WHERE source = 'sofascore' AND club = ? AND valid_from = ?",
            (entry["club"], entry["on"]))}
    return out


def complete_squads(live: dict[str, dict], observations, known: set[int],
                    completeness: float = SQUAD_COMPLETENESS) -> dict[str, dict]:
    """The payloads whose SILENCE is evidence: those covering `completeness` of the squad the sheet shows.

    A payload is the club's FIRST TEAM as the provider publishes it, and how much of it arrives varies by
    club - so "he is not in it" means one thing at Bologna (24 men against 28 identified, 6 departures and
    6 of them corroborated by a transfer) and another at West Ham (18 against 29, fourteen "departures" and
    NOT ONE corroborated). The denominator is the identified squad on this very sheet, because that is the
    population the absence is being read against; see `SQUAD_COMPLETENESS` for the measured curve.

    Dropped payloads keep their entry with an empty `ids` - `left_his_club` already reads that as "this
    source has nothing to say", which is exactly true, rather than as "the squad is empty".
    """
    rostered: dict[str, int] = {}
    for obs in observations:
        if obs.fc_id in known:
            key = _club_key(obs.club_target)
            if key:
                rostered[key] = rostered.get(key, 0) + 1
    out: dict[str, dict] = {}
    for key, entry in live.items():
        size = len(entry["ids"])
        enough = size >= completeness * rostered.get(key, 0) if rostered.get(key) else False
        out[key] = dict(entry, ids=entry["ids"] if enough else set(),
                        thin=None if enough else (size, rostered.get(key, 0)))
    return out


def observed_players(conn) -> set[int]:
    """Whoever the provider can be asked about at all: an fc_id with a sofascore identity.

    ⚠️ THE GUARD, and without it the live squad reads backwards. A man missing from a squad payload is either
    gone or never identified - 1352 provider ids have no resolved identity, and the same is true the other way
    round - and «vuoto = ignoto, mai zero rivali» is the rule this project already paid for twice. So absence
    is only evidence about a man the provider KNOWS.
    """
    return {fc_id for (fc_id,) in conn.execute(
        "SELECT fc_id FROM player_xref WHERE source = 'sofascore'")}


def left_his_club(obs, moves: dict | None, live: dict | None = None,
                  known: set[int] | None = None) -> tuple[str | None, str | None]:
    """(where he is now / how we know, date) if he is no longer in the squad this row shows him at.

    Two independent signals, strongest first: a TRANSFER that names the destination, and the LIVE SQUAD that
    simply does not contain him. The second exists because a listone is a weekly publication and a squad is a
    daily fact - it caught Gutierrez a week before anything else - and it is read only where absence can mean
    absence: for a man the provider can identify (`observed_players`), out of a payload complete enough to be
    a squad (`complete_squads`). Otherwise "not in the payload" means "we never matched him", or "the provider
    published eighteen of them".
    """
    here = _club_key(obs.club_target)
    if not here:
        return None, None
    if moves and here not in moves["at"]:
        for from_key, to_club, moved_on, _fee in reversed(moves["out"]):
            if from_key == here and _club_key(to_club) != here:
                return to_club, moved_on
    if live and known is not None and obs.fc_id in known:
        squad = live.get(here)
        if squad and squad["ids"] and obs.fc_id not in squad["ids"]:
            return "not in the club's live squad", squad["on"]
    return None, None


def estimation_layer(conn, window: features.Window, platform: str,
                     observations) -> dict[int, dict]:
    """Everything the fallback valuation needs, gathered once: {fc_id: {...}} - see `engine.estimate`.

    Three reads, and each one is a rung of the ladder that module declares:
      * the same input season on the OTHER platform (its fantamedia stands in with mean +0.001 and 92%
        inside 0.3 - measured on 870 player-seasons, and its presences scale by the calendar, median 1.269
        against the 38/31 = 1.226 the two calendars imply);
      * the most recent season FURTHER BACK, any platform, with a full set of votes;
      * each CLUB's own mean fantamedia per role on the input season, which is what moves the anchor for a
        man nobody has measured («un attaccante della Juve ... è sempre meglio di un attaccante del Verona»).
    Read-only, one query each, no per-player round trips.
    """
    ids = tuple({obs.fc_id for obs in observations})
    if not ids:
        return {}
    marks = ",".join("?" * len(ids))
    other = "euro" if platform == "default" else "default"
    layer: dict[int, dict] = {fc_id: {} for fc_id in ids}
    # ⚠️ ONLY WHERE IT IS THE SAME FOOTBALL. The +0.001 was measured on players with a full season on BOTH
    # platforms - Serie A men, whose euro and default rows are one season seen from two calendars. For a
    # `default` sheet, a euro row belonging to another league is not that at all: it is a FOREIGN
    # fantamedia, which is R1, refused by the gate on five windows of six. Found by the operator on Kolo
    # Muani, whose euro 2025-26 is TOTTENHAM: it priced him at 5.74 and −9.9 of surplus while his own
    # Serie A season (Juventus 2024-25, 16 votes, 7.62) sat one rung below, unread. Seven of the nine
    # `other_platform` estimates on that sheet were foreign, and they erred BOTH ways - Gonzalez N. was
    # lifted to +17.8 off a Liga season against his measured 6.41 here. `default` covers Serie A alone, so
    # the test is the roster's own league; on a euro sheet the other platform IS Serie A and always
    # qualifies. Same rule as `synth.calibrated_competitions`: a fitted transform belongs to the
    # population it was fitted on, and eligibility is read from the data, never from a tag.
    eligible_other = {fc_id for (fc_id,) in conn.execute(
        f"SELECT fc_id FROM rosters WHERE season = ? AND league = 'serie_a' AND fc_id IN ({marks})",
        (window.input_season, *ids))} if platform == "default" else set(ids)
    for fc_id, pv, fm in conn.execute(
            f"SELECT fc_id, pv, fm FROM season_stats WHERE season = ? AND platform = ? "
            f"AND fm IS NOT NULL AND fc_id IN ({marks})",
            (window.input_season, other, *ids)):
        if fc_id in eligible_other:
            layer[fc_id]["other"] = {"pv": pv, "fm": fm, "platform": other}
    # The newest season BEFORE the input one, whichever platform measured it best (most votes wins, then
    # the newest): an older season is a weaker rung, and `engine.estimate` prices that by how far back it is.
    # ...and it is bound by the SAME competition test as the rung above, which the first version of this
    # filter forgot - caught by the operator with one question, «dove gioca Ramos?». Gonçalo Ramos has never
    # played in Serie A (PSG 2023→2026), so `other_platform` was correctly refused and then `older` handed
    # over his LIGUE 1 2024-25 (19 votes, 7.50) as «his last measured season», priced him 7.50 and gave him
    # +22.5 of surplus on a Serie A sheet. Same foreign fantamedia, same R1, one rung lower. A man with no
    # season in this competition at all belongs at the ANCHOR, which is exactly what the gate measured R1
    # against and what it preferred on five windows of six.
    older_join = (" JOIN rosters r ON r.fc_id = s.fc_id AND r.season = s.season "
                  "AND r.league = 'serie_a' ") if platform == "default" else ""
    for fc_id, season, plat, pv, fm in conn.execute(
            f"SELECT s.fc_id, s.season, s.platform, s.pv, s.fm FROM season_stats s{older_join} "
            f"WHERE s.season < ? AND s.fm IS NOT NULL AND s.pv >= ? AND s.fc_id IN ({marks}) "
            f"ORDER BY s.season ASC, s.pv ASC",
            (window.input_season, est.FULL_SEASON_VOTES, *ids)):
        layer[fc_id]["older"] = {"season": season, "platform": plat, "pv": pv, "fm": fm}
    club_level: dict[tuple[str, str], tuple[float, int]] = {}
    for club, role, mean_fm, count in conn.execute(
            """
            SELECT cl.canonical_name, r.role_classic, AVG(s.fm), COUNT(*)
            FROM season_stats s
            JOIN rosters r ON r.fc_id = s.fc_id AND r.season = s.season
            JOIN clubs cl ON cl.fc_club_id = r.fc_club_id
            WHERE s.season = ? AND s.platform = ? AND s.pv >= ? AND s.fm IS NOT NULL
            GROUP BY 1, 2
            """,
            (window.input_season, platform, est.FULL_SEASON_VOTES)):
        if club and role:
            club_level[(club, role)] = (mean_fm, count)
    return {"players": layer, "club_level": club_level}


def estimate_for(obs, prediction, layer: dict, anchors: dict, data,
                 window: features.Window, platform: str = "euro") -> est.Estimate:
    """One player's fallback valuation, down the ladder `engine.estimate` declares. Never returns None.

    The order is the measured one and NOT "his own football first": R1 put a foreign FM-equivalent against
    the role anchor on six windows and lost on five, so an equivalent is not a rung at all - what a man did
    in a league the calendar does not cover is descriptive, and the anchor beats it at predicting here.
    """
    role = obs.role_classic or ""
    anchor = est.club_anchor(
        anchors.get(role) or (prediction.anchor if prediction else None) or 6.0,
        *(layer.get("club_level", {}).get((obs.club_target or "", role)) or (None, 0)))
    mine = layer.get("players", {}).get(obs.fc_id, {})
    calendar = data.matchdays_target or 0
    if prediction is not None and prediction.fm_pred is not None:
        return est.Estimate(prediction.fm_pred, prediction.pv_pred, "core", est.CONFIDENCE["core"], "")
    other, older = mine.get("other"), mine.get("older")
    pv_pred = prediction.pv_pred if prediction else None

    def presences(source_pv, source_calendar_ratio=1.0):
        """His presences, if the engine has none: the other calendar's, scaled by the two calendars."""
        if pv_pred is not None:
            return pv_pred
        if source_pv is None:
            return None
        return round(source_pv * source_calendar_ratio, 1)

    if other and (other["pv"] or 0) >= est.FULL_SEASON_VOTES:
        ratio = (calendar / 31.0) if calendar else 1.0
        return est.Estimate(
            other["fm"], presences(other["pv"], ratio), "other_platform",
            est.CONFIDENCE["other_platform"],
            f"his {window.input_season} on {other['platform']} ({other['pv']} votes) stands in for "
            f"a season this platform has not got")
    level = f"the level of {obs.club_target or 'the club'}'s {role or 'players'} ({anchor:.2f})"
    if obs.pv_prev and obs.fm_prev is not None:
        value, confidence = est.shrink(obs.fm_prev, obs.pv_prev, anchor)
        return est.Estimate(value, presences(obs.pv_prev), "shrunk", confidence,
                            f"only {_votes(obs.pv_prev)} here, so his mean is blended with {level}")
    if other and other["fm"] is not None and (other["pv"] or 0) >= 1:
        value, confidence = est.shrink(other["fm"], other["pv"], anchor)
        ratio = (calendar / 31.0) if calendar else 1.0
        return est.Estimate(value, presences(other["pv"], ratio), "shrunk", confidence * 0.9,
                            f"only {_votes(other['pv'])} on {other['platform']} and none here, blended "
                            f"with {level}")
    if older:
        # how many seasons back it is, from the season the sheet predicts FROM: 2 by construction, since
        # anything at t-1 would have been caught by the rungs above.
        back = int(window.input_season[:4]) - int(older["season"][:4]) + 1
        # ...and it is REGRESSED toward the anchor, not handed over raw: an old fantamedia used as a
        # prediction is the naive baseline the core beats, and it is biased upward for exactly the men
        # this rung serves (`est.OLDER_BETA` carries the measurement).
        value = est.regress(older["fm"], anchor)
        return est.Estimate(value, presences(older["pv"]), "older", est.older_confidence(back),
                            f"his last measured season is {older['season']} on {older['platform']} "
                            f"({older['pv']} votes, {older['fm']:.2f}), {back} seasons back - pulled "
                            f"{int((1 - est.OLDER_BETA) * 100)}% toward {level}")
    return est.Estimate(anchor,
                        presences(None) or est.default_presences(calendar, platform, "unmeasured"),
                        "anchor", est.CONFIDENCE["anchor"], f"nothing measured anywhere: {level}")


def _club_key(name: str | None) -> str:
    """Two spellings of one club must not read as two clubs: «LOSC Lilla» and «Lille» are the same side, and
    a naive comparison would report a departure for every man on the sheet whose provider spells it its own
    way. Same normalisation `matching.club_key` uses, which is what `club_xref` was built with."""
    return matching.club_key(name or "") if name else ""


def _votes(count: int) -> str:
    """«1 vote», not «1 votes»: a note the operator reads has to read like a sentence."""
    return f"{count} vote" if count == 1 else f"{count} votes"


def measured_season(conn, window) -> tuple[str, str | None]:
    """(the season the descriptive layers measure, a note). Which season "so far" even means.

    Standing on 1 March 2026 the interesting titolarità is THIS season's, up to that day - not last
    season's total, which is what a pre-season snapshot has to use because nothing else exists yet. So
    the target season is measured when it has really been played by then, and the previous one otherwise.
    """
    # ROUNDS, not matches. Counting matches made two pre-season friendlies (25 of them across the
    # perimeter) look like a season under way, and it switched every rate onto a two-game sample. A
    # matchday only exists for a league round, which is exactly the thing that says the season started.
    played = conn.execute(
        """SELECT COUNT(DISTINCT competition || ':' || real_md) FROM external_match_stats
           WHERE season = ? AND source = 'sofascore' AND real_md IS NOT NULL
             AND match_date IS NOT NULL AND match_date < ?""",
        (window.target_season, window.auction_date)).fetchone()[0]
    if played >= TO_DATE_MIN_ROUNDS:
        return window.target_season, (
            f"measured on {window.target_season} up to {window.auction_date} ({played} league rounds in "
            f"the per-match layer), not on the season total: everything after that date is ignored")
    return window.input_season, None


# Below this many league rounds played, "this season to date" is not a sample: the layers fall back to
# the previous season's totals, which is what a pre-season snapshot uses anyway. Five is one September.
TO_DATE_MIN_ROUNDS = 5


def propensity(conn, season: str, before: str | None = None) -> dict[int, dict]:
    """Bonus propensity per 90 over the FULL real season - the engine's own input, reported as-is.

    `before` switches the source from the season AGGREGATE to the per-match layer bounded by that date,
    which is the only way to say "his rate so far" without reading matches that had not been played.

    "FULL real season" means his whole CHAMPIONSHIP - all 38 rounds against the euro calendar's subset -
    and not every competition he appeared in. The aggregate has always read it that way (`external_stats`
    is one row per championship); the dated path counted the cups, so the same rate was measured over two
    different samples depending on the day the sheet was built, and `minutes` could not be divided by a
    league calendar. `LEAGUE_COMPETITIONS` is now the sample in both.
    """
    query = (f"""SELECT fc_id, SUM(COALESCE(minutes, 0)), SUM(COALESCE(goals, 0)),
                        SUM(COALESCE(assists, 0)), SUM(COALESCE(xg, 0)), SUM(COALESCE(xa, 0))
                 FROM external_match_stats
                 WHERE season = ? AND source = 'sofascore' AND match_date IS NOT NULL
                   AND match_date < ? AND competition IN ({_LEAGUE_IN}) GROUP BY fc_id""" if before
             else
             f"""SELECT fc_id, SUM(COALESCE(minutes, 0)), SUM(COALESCE(goals, 0)),
                        SUM(COALESCE(assists, 0)), SUM(COALESCE(xg, 0)), SUM(COALESCE(xa, 0))
                 FROM external_stats WHERE season = ? AND source = 'sofascore'
                   AND competition IN ({_LEAGUE_IN}) GROUP BY fc_id""")
    out: dict[int, dict] = {}
    for fc_id, minutes, goals, assists, xg, xa in conn.execute(
            query, ((season, before, *LEAGUE_COMPETITIONS) if before
                    else (season, *LEAGUE_COMPETITIONS))):
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


def league_repertoire(conn, season: str, before: str | None = None) -> dict[str, int]:
    """{shape: complete elevens that used it} over EVERY club of the season - football's own repertoire.

    A club's history says what its coach does; this says what a formation IS. It exists because the two
    questions are different: a coach can try a shape he has never used - a new man, a summer arrival, an
    opponent - and the board must be able to draw it, while still refusing to invent one. Measured on
    2025-26: 4812 elevens over 11 distinct shapes, of which SEVEN are above 1% (4-5-1 36%, 3-4-3 22%,
    3-5-2 13%, 4-3-3 12%, 4-4-2 10%, 5-3-2 3.3%, 5-4-1 2.5%) and the remaining four are two elevens each
    (2-6-2, 4-2-4, 4-6-0) or twelve (3-6-1) - parsing tails, not modules. Whoever reads this applies the
    floor; storing the counts keeps the judgement in the open.
    """
    rows = conn.execute(
        """SELECT defenders, midfielders, forwards, COUNT(*) FROM club_match_lineups
           WHERE season = ? AND starters = 11
             AND goalkeepers + defenders + midfielders + forwards = 11
             AND (? IS NULL OR (match_date IS NOT NULL AND match_date < ?))
           GROUP BY 1, 2, 3 ORDER BY 4 DESC""", (season, before, before)).fetchall()
    return {f"{defenders}-{midfielders}-{forwards}": count
            for defenders, midfielders, forwards, count in rows}


class Typical(NamedTuple):
    """What the club's complete elevens say about its shape."""

    shape: str | None
    share: float | None
    counted: int
    basis: str
    under_coach: int
    # Every shape it actually fielded, with how many times: "3-4-3:27;4-5-1:8;4-3-3:3". The MODE alone
    # cannot answer "what else does this side line up in", and that is the question a board has to answer
    # when the modal shape asks for a player the squad has not got. Raw counts, not the coach weighting:
    # the counts are the fact, and whoever reads them can see for himself how much is the predecessor's.
    shapes: str


def typical_formation(conn, spellings: list[str], season: str, coach_since: str | None = None,
                      before: str | None = None) -> Typical:
    """The club's MODAL formation over its complete elevens, and the whole distribution with it.

    The mode, not the mean. A club that alternates 3-5-2 and 4-3-3 has a mean of 3.5 defenders, which is
    not a formation anyone can field; its mode is one of the two, and the share says how settled it is -
    97% of 38 elevens is Atalanta's habit, 63% is Arsenal choosing.

    When `coach_since` says the man in charge arrived DURING the sample, his own elevens weigh four times
    his predecessor's: a new coach's shape is the club's shape now, and the previous one is only evidence
    about a side that no longer exists. The `basis` says which of the two happened, because "3-4-3" from
    38 elevens and "3-4-3" from four are not the same statement.
    """
    if not spellings:
        return Typical(None, None, 0, "no lineups", 0, "")
    placeholders = ",".join("?" * len(spellings))
    rows = conn.execute(
        f"""SELECT defenders, midfielders, forwards, match_date FROM club_match_lineups
            WHERE club IN ({placeholders}) AND season = ? AND starters = 11
              AND goalkeepers + defenders + midfielders + forwards = 11
              AND (? IS NULL OR (match_date IS NOT NULL AND match_date < ?))""",
        (*spellings, season, before, before)).fetchall()
    if not rows:
        return Typical(None, None, 0, "no lineups", 0, "")
    weights: dict[tuple[int, int, int], float] = {}
    counts: dict[tuple[int, int, int], int] = {}
    under_coach = 0
    for defenders, midfielders, forwards, date in rows:
        his = bool(coach_since and date and date >= coach_since)
        under_coach += his
        weight = 1.0 if (his or not coach_since) else PREVIOUS_COACH_WEIGHT
        shape = (defenders, midfielders, forwards)
        weights[shape] = weights.get(shape, 0.0) + weight
        counts[shape] = counts.get(shape, 0) + 1
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
    # `under_coach` is returned as a NUMBER as well as inside the sentence: whoever has to decide how much
    # to trust this shape needs a value it can compare, and the Auction board does exactly that - a modal
    # shape resting on 0 elevens of the current coach is a historical note, not a habit, and the board is
    # allowed to draw a different one. Parsing the sentence back out would be reading our own prose.
    spread = ";".join(f"{'-'.join(str(part) for part in key)}:{count}"
                      for key, count in sorted(counts.items(), key=lambda item: -item[1]))
    # No `coach_since` inside the sample means the man in charge PREDATES it, so every eleven is his -
    # counting the rows that fall after a date that does not exist returned 0 and read as "this is his
    # predecessor's shape" for Arteta, who has been at Arsenal since 2019.
    return Typical("-".join(str(part) for part in shape), round(weight / total, 2), len(rows), basis,
                   len(rows) if not coach_since else under_coach, spread)


def measured_elsewhere(conn, window) -> dict[int, dict]:
    """{fc_id: matches, minutes, where} - the window of football a man with no season here DID play.

    It is `features._recent_form`'s own sample, read through the same bounds (the input season's July to the
    auction date) and reduced to what a sheet column can hold. Written so the panel can stand on the fact
    the ENGINE already stands on: R13 - adopted on Serie A - predicts this man's presences from exactly
    these matches, and the board was drawing him at a standing of zero.

    `where` is the competitions, most matches first, because ten matches somewhere are not a season here and
    the plate has to say where they were played.
    """
    out: dict[int, dict] = {}
    floor = f"{window.input_season.split('-')[0]}-07-01"
    for fc_id, matches, minutes, competitions in conn.execute(
            """SELECT fc_id, COUNT(*), SUM(COALESCE(minutes, 0)),
                      GROUP_CONCAT(DISTINCT competition)
               FROM external_match_stats
               WHERE source = 'sofascore_recent' AND match_date >= ? AND match_date < ?
                 AND COALESCE(minutes, 0) > 0
               GROUP BY fc_id""", (floor, window.auction_date)):
        out[fc_id] = {"matches": matches, "minutes": minutes,
                      "where": (competitions or "").replace(",", " ")[:40] or None}
    return out


def preseason_starts(conn, season: str, coach_since: str | None = None) -> dict[int, tuple[int, int]]:
    """fc_id -> (elevens he STARTED, friendlies he appeared in) in the TARGET season's pre-season.

    A READING and never a criterion, and the reason is measured rather than assumed. For an August auction
    the pre-season is the only football the new coach has played, and the operator's own case says how much
    it can be worth: Atalanta's two friendlies under Sarri were started by Gaetano, Samardzic, Scamacca and
    Raspadori - the four the published prediction fields and our claim does not - while De Roon, Ederson and
    Krstovic, whom our board starts, started NEITHER.
    That looks like a signal, and it is not usable as one:
      * NO out-of-sample test is possible: per-player friendlies exist for exactly ONE pre-season (1696 rows
        on 2026-27 against 37 on 2025-26), so nothing can be judged on a window that does not judge itself,
        which is this project's own rule;
      * the sample is 1-3 matches, and **two of the seven Serie A clubs with a new coach have none at all**;
      * minutes and ratings are absent from 1399 of 1716 rows, so the only thing there is the `started` flag;
      * and the fixtures are what they are: Atalanta's two are against **their own U23 side** and Arezzo,
        where a coach fields whoever he wants. A starting eleven there is not a competitive statement;
      * the one external source that agrees (the published 26/27 elevens) is NOT independent - it read the
        same friendlies.
    So it goes where a true, non-predictive fact goes on this board: the plate, for the human who is
    bidding. Same treatment as the body (height/weight, gate §5-terdecies), for the same reason.
    Pre-registered instead of guessed: in June 2027 this season's outcome exists, and the pre-season signal
    becomes testable out of sample for the first time (gate §7).
    """
    rows = conn.execute(
        """SELECT fc_id, SUM(COALESCE(started, 0)), COUNT(*) FROM external_match_stats
           WHERE season = ? AND competition LIKE '%friendly%'
             AND (? IS NULL OR (match_date IS NOT NULL AND match_date >= ?))
           GROUP BY fc_id""", (season, coach_since, coach_since)).fetchall()
    return {fc_id: (int(started or 0), int(matches or 0)) for fc_id, started, matches in rows}


def coach_repertoire(conn, coach: str | None, before: str | None = None) -> tuple[str, int]:
    """({shape: count} as "4-3-3:162;4-4-2:20", how many elevens) — what THIS COACH lines up in, anywhere.

    The third source of a shape, and the one that was missing. A club's own history answers «what does this
    side do», the league's repertoire «what is a formation»; neither answers «what does the man who is here
    NOW do», and for a new coach that is the only question that matters. Measured on the 26/27 sheets: 12 of
    34 euro clubs (7 of 20 Serie A) have a coach with **zero** elevens at this club, so what the board drew
    was his predecessor's shape.

    His OWN elevens, from every spell in `coaches` and every competition we parsed - a coach's habit travels
    with him, so restricting it to this club would answer nothing, and restricting it to the league would
    throw away the seasons that make the sample big enough to mean something.

    The sample is what decides whether it may be used, and it is wildly uneven, which is why the count is
    returned with it: Sarri 188 elevens (4-3-3 at 86%), Maresca 57 (4-5-1 98%), Amorim 47 (3-4-3 96%),
    Allegri 112 (3-5-2, only 53% - a coach who is genuinely shape-fluid) against Tedesco 3, Gattuso 2,
    Mourinho 1, and Iraola / Filipe Luís / Carles Martínez at **zero**, because their careers were spent
    outside the five leagues we cover. A floor is not optional: with n = 2 the mode is noise, and it would
    replace a club habit that is already right.
    """
    if not coach:
        return "", 0
    rows = conn.execute(
        """SELECT l.defenders, l.midfielders, l.forwards, COUNT(*)
           FROM club_match_lineups l
           JOIN clubs c ON c.canonical_name = l.club
           JOIN coaches h ON h.fc_club_id = c.fc_club_id AND h.coach_name = ?
           WHERE l.starters = 11 AND l.match_date IS NOT NULL
             AND l.goalkeepers + l.defenders + l.midfielders + l.forwards = 11
             AND l.match_date >= COALESCE(h.valid_from, '0000')
             AND l.match_date <= COALESCE(h.valid_to, '9999')
             AND (? IS NULL OR l.match_date < ?)
           GROUP BY 1, 2, 3 ORDER BY 4 DESC""", (coach, before, before)).fetchall()
    total = sum(count for *_shape, count in rows)
    return (";".join(f"{d}-{m}-{f}:{count}" for d, m, f, count in rows), total)


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


def titolarita(conn, season: str, before: str | None = None) -> dict[int, dict]:
    """How often he STARTED over the full real season: (starts, matches, share).

    This - not any valuation - is what says whether a coach fields him. Read over the whole season
    because the "schieramento tipo" is a habit over a year; the last ten matches are a separate column
    and answer the other question, which side the coach is picking now.

    `before` reads the per-match layer up to that date instead of the season aggregate: on 1 March the
    habit is the one measured through February, and the aggregate would carry the rest of the season -
    matches that, from where the sheet is standing, have not been played.

    LEAGUE matches only, in both paths. The aggregate has no choice - `external_stats` stores one row per
    championship - and the dated path used to count the cups too, so the same column meant two different
    things depending on when the sheet was built, and neither could be divided by a club's league
    calendar. `desc_season_starts` is therefore always "starts in his championship".
    """
    query = (f"""SELECT fc_id, SUM(COALESCE(started, 0)), COUNT(*) FROM external_match_stats
                 WHERE season = ? AND source = 'sofascore' AND COALESCE(minutes, 0) > 0
                   AND match_date IS NOT NULL AND match_date < ?
                   AND competition IN ({_LEAGUE_IN}) GROUP BY fc_id""" if before else
             f"""SELECT fc_id, SUM(COALESCE(starts, 0)), SUM(COALESCE(matches, 0))
                 FROM external_stats WHERE season = ? AND source = 'sofascore'
                   AND competition IN ({_LEAGUE_IN}) GROUP BY fc_id""")
    out: dict[int, dict] = {}
    for fc_id, starts, matches in conn.execute(
            query, ((season, before, *LEAGUE_COMPETITIONS) if before
                    else (season, *LEAGUE_COMPETITIONS))):
        if not matches:
            continue
        out[fc_id] = {"starts": starts, "matches": matches,
                      "share": round((starts or 0) / matches, 3)}
    return out


def previously_at_club(conn, observations, squads: dict[int, str], season: str) -> dict[int, str]:
    """fc_id -> the most recent EARLIER season in which THIS club's listone already had him.

    The one thing that separates a man his club SENT AWAY from a man it has just taken on, and it is
    measured rather than looked up: no source of ours marks a loan. `arrivals.type` knows only
    new/transfer_cross_league/transfer_intra_league, `transfers_history.fee` is NULL for a free transfer
    and for a loan alike (1367 of 2067 rows) and carries nothing at all for the window being auctioned.
    A club's own roster history does carry it: Marin R. was in Napoli's listone in 2024-25 and in
    Villarreal's in 2025-26, so Napoli had him and let him go; Gila has been Lazio's for four seasons and
    is Milan's now, so Milan has never judged him.

    Read against the club he is at NOW, not against the listone's - in July the listone does not exist.
    Seasons at or after `season` (the measured one) are ignored: the question is about BEFORE.
    """
    resolve = club_index(conn)
    now: dict[int, str] = {}
    for obs in observations:
        key, _name = resolve(obs.club_target or squads.get(obs.fc_id))
        if key:
            now[obs.fc_id] = key
    out: dict[int, str] = {}
    for fc_id, roster_season, club in conn.execute(
            """SELECT r.fc_id, r.season, c.canonical_name FROM rosters r
               LEFT JOIN clubs c ON c.fc_club_id = r.fc_club_id
               WHERE r.season < ? AND c.canonical_name IS NOT NULL ORDER BY r.season""",
            (season,)):
        if fc_id in now and resolve(club)[0] == now[fc_id]:
            out[fc_id] = roster_season          # ascending, so the last write is the most recent
    return out


def at_current_club(conn, season: str, observations, squads: dict[int, str],
                    before: str | None = None) -> dict[int, dict]:
    """His measured season split in two: what he played AT THE CLUB HE IS AT NOW, and what ELSEWHERE.

    The season totals say how much a coach used him; they do not say WHOSE coach. Marin R. is at Napoli
    with 21 starts and 1980 minutes, and every one of them is Villarreal's - read as a Napoli standing
    they put him ahead of Rrahmani. So the split travels in the sheet as two halves of one season and the
    view discounts the half made elsewhere (`SnapshotView.LOAN_DISCOUNT`) instead of dropping it: being
    sent on loan is the club's own judgement of a player, and zeroing it would delete every summer
    signing from the eleven.

    From the per-match layer, the only place that stores a club per appearance, and over the CHAMPIONSHIP
    rounds only - the same sample as `titolarita` and `propensity`, so the three halves of one season can
    be read against each other. Counting the cups here made `desc_minutes_club` and
    `desc_minutes_full_season` two different numbers for the same season in the same row (Kane 2994
    against 2382), and the share was taken over a sample whose size depended on how far his club went in
    Europe. A player the layer has no row for is absent from the result, which leaves the columns empty
    and his standing undiscounted: not knowing where he played is not knowing.
    """
    resolve = club_index(conn)
    # The club whose shirt he is competing for in THIS sheet - the same one the pitch draws him at.
    now: dict[int, str] = {}
    for obs in observations:
        key, _name = resolve(obs.club_target or squads.get(obs.fc_id))
        if key:
            now[obs.fc_id] = key
    query = (f"""SELECT fc_id, club, COALESCE(started, 0), COALESCE(minutes, 0)
                 FROM external_match_stats
                 WHERE season = ? AND source = 'sofascore' AND COALESCE(minutes, 0) > 0
                   AND competition IN ({_LEAGUE_IN})
                   AND match_date IS NOT NULL AND match_date < ?""" if before else
             f"""SELECT fc_id, club, COALESCE(started, 0), COALESCE(minutes, 0)
                 FROM external_match_stats
                 WHERE season = ? AND source = 'sofascore' AND COALESCE(minutes, 0) > 0
                   AND competition IN ({_LEAGUE_IN})""")
    out: dict[int, dict] = {}
    for fc_id, club, started, minutes in conn.execute(
            query, ((season, *LEAGUE_COMPETITIONS, before) if before
                    else (season, *LEAGUE_COMPETITIONS))):
        if fc_id not in now:
            continue
        entry = out.setdefault(fc_id, {"starts": 0, "minutes": 0,
                                       "starts_elsewhere": 0, "minutes_elsewhere": 0})
        here = resolve(club)[0] == now[fc_id]
        entry["starts" if here else "starts_elsewhere"] += 1 if started else 0
        entry["minutes" if here else "minutes_elsewhere"] += minutes
    return out


def club_context(conn, data: features.WindowData, starters_date: str | None,
                 clubs: list[str], measured: str | None = None,
                 before: str | None = None, fielded: dict[str, dict] | None = None) -> list[dict]:
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
    # Which championship each club plays in - the calendar its share-of-the-season denominators count.
    championships = dict(conn.execute(
        "SELECT canonical_name, league FROM clubs WHERE canonical_name IS NOT NULL"))
    out = []
    for club in clubs:
        coach = conn.execute(
            """SELECT co.coach_name, co.valid_from FROM coaches co JOIN clubs c USING(fc_club_id)
               WHERE c.canonical_name = ? AND co.valid_from <= ?
               ORDER BY co.valid_from DESC LIMIT 1""", (club, window.auction_date)).fetchone()
        mine = spellings.get(resolve(club)[0], [])
        placeholders = ",".join("?" * len(mine)) or "NULL"
        season = measured or window.input_season
        lines = conn.execute(
            f"""SELECT AVG(defenders), AVG(midfielders), AVG(forwards), COUNT(*),
                       SUM(competition IN ({_LEAGUE_IN}))
                FROM club_match_lineups
                WHERE club IN ({placeholders}) AND season = ? AND starters = 11
                  AND goalkeepers + defenders + midfielders + forwards = 11
                  AND (? IS NULL OR (match_date IS NOT NULL AND match_date < ?))""",
            (*LEAGUE_COMPETITIONS, *mine, season, before, before)).fetchone()
        # The coach's own start date, and only when he arrived after the sample began: an unchanged
        # coach needs no reweighting, the whole season is his.
        coach_since = coach[1] if coach and coach[1] else None
        if coach_since and coach_since <= f"{season.split('-')[0]}-07-01":
            coach_since = None
        # NOT `measured`: that name is this function's own parameter, the season the layers are measured
        # on, and shadowing it fed a NamedTuple to the next query as a season.
        shapes = typical_formation(conn, mine, season, coach_since, before)
        typical, share, counted, basis = shapes.shape, shapes.share, shapes.counted, shapes.basis
        coach_shapes, coach_shapes_of = coach_repertoire(conn, coach[0] if coach else None, before)
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
            # How many of those elevens are the CURRENT coach's. Zero means the modal shape belongs to a
            # side that no longer exists, which is what lets a reader (and the Auction board) decide how
            # much of a habit it is instead of taking a percentage at face value.
            "formation_typical_under_coach": shapes.under_coach,
            # And every shape it fielded, with counts. The board draws one of THESE when the modal shape
            # asks for a player the squad has not got - a formation nobody lined up in is not an
            # alternative, it is an invention.
            "formation_shapes": shapes.shapes,
            # ...and every shape THE COACH fielded, anywhere, with how many elevens it rests on
            # (`coach_repertoire`). It is the answer to «what does the man who is here NOW do», which
            # neither of the two above can give, and the board weighs it by its own sample size - Sarri
            # arrives at Atalanta with 188 elevens and a 4-3-3 at 86% while the club's own habit is his
            # predecessor's 3-4-3, and Iraola arrives at Liverpool with none at all.
            "coach_shapes": coach_shapes,
            "coach_shapes_of": coach_shapes_of,
            # "Absolutely preferred" is a measured thing: a shape used in most of the elevens is the
            # coach's, one used in a third of them is a coach still choosing - and the two must not be
            # presented the same way.
            "formation_settled": (("no" if "PREDECESSOR" in (basis or "")
                                   else "yes" if (share or 0) >= FORMATION_SETTLED else "no")
                                  if share else None),
            "formation_today": formations.get(club),
            # What it ACTUALLY lined up in, in the first match after the auction date - a fact, and only on
            # a back-dated sheet. The pair with `formation_today` is deliberate: one is the editors' guess
            # for that week, the other is what happened, and they must never be read as the same column.
            "formation_next_fielded": (fielded or {}).get(club, {}).get("shape"),
            "next_match_date": (fielded or {}).get(club, {}).get("date"),
            "probabili_date": starters_date,
            "lines_fielded_D": round(lines[0], 2) if lines and lines[0] is not None else None,
            "lines_fielded_M": round(lines[1], 2) if lines and lines[1] is not None else None,
            "lines_fielded_F": round(lines[2], 2) if lines and lines[2] is not None else None,
            # Every complete eleven we parsed, whatever the competition: the sample the lines above are
            # averaged over, and the fixture list Transfermarkt counts a man's absences against.
            "complete_XIs": lines[3] if lines else 0,
            # ...and how many of those are the CHAMPIONSHIP's. This is the denominator of a share of the
            # season: the platform's calendar is made of league rounds, the numerators are league-only
            # (`external_stats` stores nothing else), and the club-to-club spread of the other number is
            # 66%-100% (Arsenal 38 of 58, Napoli 38 of 38). A titolarità divided by the whole fixture
            # list is not comparable between two clubs, which is what made Kane read 49%.
            "league_XIs": lines[4] if lines and lines[4] is not None else 0,
            # The championship those rounds belong to, so the sheet says which calendar it counted.
            "league": championships.get(club),
            "arrivals": arrivals,
            "elo": round(elo[club], 1) if club in elo else None,
        })
    return out


# ---------------------------------------------------------------- the engine half
def engine_predictions(conn, window: features.Window, platform: str, game: str,
                       league, squad_source: str = "real", prepared=None, fits=None
                       ) -> tuple[features.WindowData, list, str, list[str]]:
    """The validated valuation: ADOPTED rules, parameters fitted on a DIFFERENT window.

    Nothing here is new model code - it calls the same functions `backtest --auction` calls, which is
    what keeps the sheet and the gate from ever disagreeing.

    `fits` = `{window key: Params}` over the windows the caller has ALREADY fitted, in `WINDOWS` order.
    It exists for the Auction panel, which fits every window to cross-score them and would otherwise
    pay for eleven `prepare` calls twice over; the CHOICE of which fit prices a live target stays here,
    in one place, because a second copy of that choice is how the sheet and the panel start disagreeing.
    """
    notes: list[str] = []
    if prepared is None:
        prepared = features.prepare(conn, window, platform, game, league=league,
                                    squad_source=squad_source)
    data = prepared
    if not data.matchdays_target:
        # THE CALENDAR OF A SEASON NOT YET PLAYED, and it lives here rather than in whoever calls this:
        # appearances are predicted as a SHARE of the target calendar, so a calendar of zero rounds turns
        # every prediction into zero - and then VALUE and SURPLUS are zero too and the ranking is sorted
        # by nothing. It used to sit in `snapshot.build`, which is the caller: the Auction panel asking
        # the same question got a whole listone priced at zero appearances. Same shape as every other
        # defect this project has paid for - the fix belongs where the price is decided.
        data.matchdays_target = data.matchdays_prev
        notes.append(f"{window.target_season} has no matchdays yet, so expected appearances are "
                     f"scaled on {window.input_season}'s calendar ({data.matchdays_prev} rounds)")
    listone = sum(1 for obs in data.observations if obs.price_initial is not None)
    if squad_source == "real" and listone < len(data.observations):
        notes.append(f"{len(data.observations) - listone} of {len(data.observations)} players are in a "
                     f"real squad but not in the {window.target_season} listone: no Qt.I exists for "
                     f"them yet, so the engine prices them at the role anchor (R0c) and their "
                     f"`price_initial` is empty by construction, not by omission")
    active = ("R0", *evaluate.ADOPTED.get(platform, ()))
    if fits is not None:
        usable = tuple(key for key in features.WINDOWS if key in fits)
    else:
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
    fitted = dict(fits) if fits is not None else {key: evaluate.fit_params(
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
    "engine_replacement_fm", "engine_anchor", "engine_unpriced_reason",
    # ESTIMATED, a third class next to engine_ (gated) and desc_ (measured): every player gets a surplus,
    # penalised for what we do not know about him, with the basis and the penalty on the row (engine/estimate.py)
    "est_fm", "est_pv", "est_surplus", "est_basis", "est_confidence", "est_note",
    # a TRANSFER says he has left the club this row shows him at (see `departures`): reported, never applied
    "desc_left_for", "desc_left_on",
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
    "desc_real_role_side", "desc_mantra_real", "desc_foot", "desc_height", "desc_weight",
    "desc_real_role_observed",
    "desc_preseason_starts", "desc_preseason_matches",
    "desc_avg_x", "desc_avg_y", "desc_side_measured",
    "desc_starter_prob", "desc_starter_status", "desc_expected_minutes",
    # Titolarità: how often he STARTS. Two horizons, because they answer different questions - the
    # season's share is the coach's habit over a year, the recent one is the shape of the side now.
    "desc_season_starts", "desc_season_matches", "desc_start_share",
    # ...and how much of that season was played at the club he is at NOW: the two halves of it, so that a
    # reader can see that Marin R.'s 21 starts are Villarreal's and not Napoli's. The half made elsewhere
    # is DISCOUNTED where a shirt is handed out, never dropped: `SnapshotView.LOAN_DISCOUNT`.
    "desc_season_starts_club", "desc_season_starts_elsewhere",
    "desc_minutes_club", "desc_minutes_elsewhere", "desc_at_club_before",
    "desc_elsewhere_matches", "desc_elsewhere_minutes", "desc_elsewhere_where",
    "desc_duel_rivals", "desc_duel_names",
    "desc_injury_matches_missed", "desc_injury_weighted", "desc_injury_spells",
    # What he missed INSIDE the measured season, which is the only one of the injury numbers that is a
    # fact about this sample rather than a forecast: `desc_season_starts` are the starts he made while
    # absent for these, so it is what a start rate has to leave out of its denominator.
    "desc_injury_missed_measured",
    # ...and the same in ROUNDS of his own championship, counted on his club's fixtures by date instead of
    # taken from a source that counts every competition. This is the unit the shares in this sheet are
    # expressed in; `desc_injury_rounds_seasons` = 0 means unknown, never zero. `..._by_season` is most
    # recent first, aligned with the recency weights and with an empty entry for a season we could not
    # count: the weights are PROVISIONAL, and a pre-weighted total would freeze them.
    "desc_injury_rounds_weighted", "desc_injury_rounds_by_season", "desc_injury_rounds_measured",
    "desc_injury_rounds_seasons",
    "desc_injury_worst_kind", "desc_injury_open", "desc_injury_source",
    "desc_availability_now",
    "desc_goals_p90", "desc_assists_p90", "desc_xg_p90", "desc_xa_p90", "desc_minutes_full_season",
    "desc_penalty_rank", "desc_penalty_confidence", "desc_set_piece_duty",
    "desc_cards_per_match", "desc_yellows", "desc_reds",
    "desc_contract_until", "desc_exit_risk", "desc_arrival", "desc_arrival_tier",
    "desc_arrival_origin", "desc_transfer_fee", "desc_seasons_at_club", "desc_new_coach",
    "desc_u22",
    # WHAT THE CLUB PUT INTO HIM: the fee, its share of everything the club spent that window, and his Qt.I
    # percentile within his role. Two channels because they catch different players - the fee catches a big
    # signing, the stature catches a celebrity who arrived for nothing (Modric and De Bruyne, free). Both
    # are PRE-auction facts and legal to read; wages, which would be the best measure, do not exist in any
    # whitelisted source. The weight they carry in the selection is a PARAMETER, off until the gate speaks.
    "desc_investment_fee", "desc_investment_fee_share", "desc_investment_stature",
    "desc_market_value", "desc_investment_value_share", "desc_level_elo", "desc_career_fm",
    # A THIRD class, and the prefix is the whole point: `actual_*` is measured strictly AFTER the auction
    # date. It exists because a BACK-DATED sheet does not need a forecast of who plays - the eleven that was
    # fielded that week exists, and a forecast is only interesting while the outcome is unknown. Reporting
    # only: no rule, no prediction and no `desc_*` column may read them, which is why they are not called
    # `desc_`. Empty by construction on a sheet built today (the next match has not been played).
    "actual_next_match", "actual_next_started", "actual_next_minutes",
)


def perimeter_clubs(conn, platform: str, seasons: tuple[str, ...]) -> set[str]:
    """The clubs THIS PLATFORM plays, from its own ratings: who you can actually buy from."""
    placeholders = ",".join("?" * len(seasons)) or "NULL"
    return {team for (team,) in conn.execute(
        f"SELECT DISTINCT team FROM match_ratings WHERE platform = ? AND team IS NOT NULL "
        f"AND season IN ({placeholders})", (platform, *seasons))}


def build_rows(conn, data: features.WindowData, predictions, layers: dict,
               perimeter: set[str] | None = None, window: features.Window | None = None,
               platform: str = "euro") -> list[dict]:
    """One row per purchasable player, engine columns first, descriptive after.

    `perimeter` filters the OUTPUT, never the model population. The engine's standardisations are
    computed over the whole listone - that is the population its rules were fitted and validated on -
    so trimming before predicting would quietly give a player a different number here than in the gate.
    Trimming after keeps every figure identical and only stops the sheet from listing a Verona squad at
    a EuroLeghe auction, where nobody can buy it.
    """
    by_id = {p.obs.fc_id: p for p in predictions}
    # The fallback valuation's inputs, gathered once for the whole sheet (`estimation_layer`): every player
    # must end up with a surplus, and the ones the core cannot price need the other platform, an older
    # season and their club's own level to get one.
    window = window or data.window
    estimation = estimation_layer(conn, window, platform, data.observations)
    left = departures(conn, window, window.auction_date)
    provider_known = observed_players(conn)
    live_squad = complete_squads(live_squads(conn, window.auction_date),
                                 data.observations, provider_known)
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
        at_club = layers["at_club"].get(obs.fc_id, {})
        card = layers["discipline"].get(obs.fc_id, {})
        state = layers["contract"].get(obs.fc_id, {})
        role_detail = layers["real_role_detail"].get(obs.fc_id, {})
        recent = layers["elsewhere"].get(obs.fc_id, {})
        penalty = layers["penalties"].get(obs.fc_id)
        fielded = layers["fielded_next"].get(obs.fc_id, {})
        spend = layers["investment"].get(obs.fc_id, {})
        pv_pred = prediction.pv_pred if prediction else None
        guess = estimate_for(obs, prediction, estimation, data.anchors, data, window,
                             platform)
        gone_to, gone_on = left_his_club(obs, left.get(obs.fc_id), live_squad, provider_known)
        guess_surplus = est.surplus(guess.fm, guess.pv,
                                    data.replacement.get(obs.role_classic or ""), guess.confidence)
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
            # WHY this row has no valuation, per player. The note at the end says it for the sheet, and it
            # could only say ONE thing, while the cell hides three different ones: measured here and too
            # little of it (Boga 13 votes of 15, Pavard 1), or nothing measured on THIS platform at all
            # because his season was played on the other calendar (Kolo Muani 23 euro votes and no Serie A,
            # Stones 3). An empty cell is a statement; this is which statement.
            "engine_unpriced_reason": _unpriced_reason(prediction, obs),
            "est_fm": _round(guess.fm, 3),
            "est_pv": _round(guess.pv, 1),
            "est_surplus": _round(guess_surplus, 1),
            "est_basis": guess.basis,
            "est_confidence": _round(guess.confidence, 2),
            "est_note": guess.note,
            # A transfer dated in this window took him somewhere else, and no arrival brought him back:
            # the listone and the squad pages can be weeks behind in August, and this is the one source
            # that carries the event (`left_his_club` - an OUT alone is not a departure).
            "desc_left_for": gone_to,
            "desc_left_on": gone_on,
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
            # The physical profile, from the same provider payload as the codes. It is what separates a
            # punta centrale who plays as a TORRE from one who plays on the move - `ST` says neither - and
            # it is DESCRIPTIVE: measured, the more used of a club's two strikers is the taller one 44
            # times out of 92 (48%), so it decides nothing about who plays (gate §5-terdecies).
            "desc_height": role_detail.get("height"),
            "desc_weight": role_detail.get("weight"),
            "desc_real_role_observed": role_detail.get("observed"),
            # The TARGET season's PRE-SEASON, under the coach who is there now: started X of Y friendlies.
            # A reading for whoever is bidding and nothing else - `preseason_starts` carries the five
            # measured reasons why it cannot be a criterion (one pre-season only, so no out-of-sample test;
            # 1-3 matches; two of seven new-coach clubs with none; no minutes; and fixtures against a U23
            # side, where a starting eleven is not a competitive statement).
            "desc_preseason_starts": layers["preseason"].get(obs.fc_id, (None, None))[0],
            "desc_preseason_matches": layers["preseason"].get(obs.fc_id, (None, None))[1],
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
            # Whose season it was. Empty for a player the per-match layer has no row for: unknown, and
            # an unknown split must not discount him.
            "desc_season_starts_club": at_club.get("starts"),
            "desc_season_starts_elsewhere": at_club.get("starts_elsewhere"),
            "desc_minutes_club": at_club.get("minutes"),
            "desc_minutes_elsewhere": at_club.get("minutes_elsewhere"),
            # The last season THIS club's listone already had him. Empty = it never did, so it has not
            # judged him: what a season measured elsewhere is worth toward the shirt depends on it.
            "desc_at_club_before": layers["was_here"].get(obs.fc_id),
            # THE WINDOW MEASURED ELSEWHERE, for a man with no season here at all: it is the engine's own
            # R13 sample (`features._recent_form`, adopted on Serie A), written into the sheet so the board
            # can stand on the same fact - a standing of zero for a man the engine predicts will play is the
            # panel disagreeing with the engine about the same player. The competition travels with it,
            # because ten matches somewhere are not a season here and the plate has to say where.
            "desc_elsewhere_matches": (recent.get("matches") or None) if recent else None,
            "desc_elsewhere_minutes": (recent.get("minutes") or None) if recent else None,
            "desc_elsewhere_where": recent.get("where") if recent else None,
            "desc_duel_rivals": duel.get("rivals"), "desc_duel_names": duel.get("names"),
            "desc_injury_matches_missed": injury.get("matches_missed"),
            "desc_injury_weighted": injury.get("weighted"),
            "desc_injury_missed_measured": injury.get("missed_measured"),
            "desc_injury_rounds_weighted": injury.get("rounds_weighted"),
            "desc_injury_rounds_by_season": injury.get("rounds_by_season"),
            "desc_injury_rounds_measured": injury.get("rounds_measured"),
            "desc_injury_rounds_seasons": injury.get("rounds_seasons"),
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
            "desc_investment_fee": spend.get("fee"),
            "desc_investment_fee_share": spend.get("fee_share"),
            # The MARKET VALUE of the input season, and his share of his squad's: the third channel of the
            # investment hypothesis, and the only one that exists for a man who arrived free.
            "desc_market_value": spend.get("value"),
            "desc_investment_value_share": spend.get("value_share"),
            # THE LEVEL of the football behind his minutes: the Elo of the club he played them for, and only
            # for a man who CHANGED club - the population `presence.level_lift` was measured on. Without this
            # column the adopted channel is switched on and blind: the panel builds its `Inputs` from the
            # sheet, so a parameter whose input never reaches the row does nothing at all.
            "desc_level_elo": (obs.elo_prev if obs.club_change else None),
            # What he had shown BEFORE last season - the career channel's input, forwards only because
            # that is the population it was measured on (`presence.career_lift`).
            "desc_career_fm": (obs.fm_career if obs.role_classic == "A" else None),
            "desc_investment_stature": spend.get("stature"),
            # AFTER the auction date, reporting only (see PLAYER_COLUMNS): what really happened in the
            # club's first match of the week that followed.
            "actual_next_match": fielded.get("match"),
            "actual_next_started": fielded.get("started"),
            "actual_next_minutes": fielded.get("minutes"),
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


def refresh_real_roles(ctx: Context, clubs, date: str, progress: Progress | None = None) -> str | None:
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
        positions.fetch_roles(ctx, clubs=sorted(clubs) if clubs else None, date=date,
                              on_club=(lambda done, total: progress.tick(done, total, "clubs observed"))
                              if progress else None)
    except Exception as exc:   # noqa: BLE001 - a snapshot must still be produced without the refresh
        return (f"real-role refresh failed ({exc}) - the sheet uses the most recent stored "
                f"observation, and there is no way to reconstruct today's")
    return None


def run(ctx: Context, *, season: str | None = None, platform: str = "euro",
        game: str = "classic", refresh: bool = True, out: str | None = None,
        date: str | None = None, clubs=None, league: str | None = None, **kwargs) -> dict:
    """Build the auction snapshot. Read-only on the DB except for the editorial refresh.

    `league` names one of the leagues declared in `config/league_config.json`, and it is the whole
    parameterisation of a sheet: a played league STATES its platform and its game, so naming it fixes
    both, and its squad size fixes the replacement level surplus is measured against. Given a league,
    `platform` and `game` come from it and the arguments are ignored - one name cannot mean two sheets.
    Without one, the two dimensions are read straight and the league setup is whatever the config file
    states at top level, which is what this module did before leagues had names.

    `date` stands the whole sheet on a chosen DAY: the last ten matches are the ten before it, the squads
    and the availability are the ones known then, and the descriptive layers are measured on the season so
    far instead of on its total (see `measured_season`). What it cannot back-date is the editorial
    refresh - the probabili exist only from the day the weekly job recorded them - and the heatmap, which
    is a season-long cloud and is therefore read from the season BEFORE, never from the one in progress.

    `clubs` narrows the sheet to the clubs named. The engine's population is untouched: a replacement
    level measured on one squad is not a replacement level, so the numbers are the same ones the full run
    would print - only the rows are fewer.
    """
    conn = ctx.require_conn()
    # The league is resolved FIRST, because it is what decides the other two. `load_league` raises on a
    # name that is not declared: silently falling back would hand this sheet another league's
    # replacement level, which is a wrong sort order with nothing on screen to show it.
    setup = (ctx.config.load_league(league) if league
             else ctx.config.load_league(platform=platform, game=game))
    if league:
        platform, game = setup["platform"], setup["game"]
    if platform not in ("euro", "default"):
        raise RuntimeError(f"Unknown platform {platform!r}; choose euro|default")
    if game not in ("classic", "mantra"):
        raise RuntimeError(f"Unknown game {game!r}; choose classic|mantra")

    if isinstance(clubs, str):
        clubs = [clubs]
    notes: list[str] = []
    if date and refresh:
        # Refusing would be worse than saying it: today's probabili describe today's team, and pasting
        # them onto a March sheet is exactly the look-ahead this whole module is dated to avoid.
        refresh = False
        notes.append(f"as of {date}: the editorial refresh was skipped, because today's probabili are "
                     f"not the probabili of that day. Whatever the weekly job recorded at or before "
                     f"{date} is used instead - possibly nothing.")
    # The percentage the panel shows: the stages this run will actually walk, so a build with no network
    # step does not stall the bar at the two stages it is skipping.
    progress = Progress(skip=() if refresh else ("refresh", "roles"))
    if refresh:
        progress.stage("refresh")
        failure = refresh_editorial(ctx)
        if failure:
            notes.append(failure)

    window, note = resolve_window(conn, season, as_of=date)
    if note:
        notes.append(note)
    print(f"[snapshot] {setup['name'] or f'{platform}/{game}'} ({platform}/{game}, "
          f"{setup['teams']} teams) · auctioning {window.target_season} from "
          f"{window.input_season} · as of {window.auction_date}")

    # The real squads first: the row set of the sheet is who is in a club TODAY, listone or not.
    progress.stage("squads")
    derive_squads(ctx, window.auction_date, window.target_season)
    # Then the granular real role, which needs the squads (the per-player top-up walks them) and is
    # observed for the PERIMETER - the clubs this platform actually lets you buy from.
    if refresh:
        progress.stage("roles")
        failure = refresh_real_roles(
            ctx, clubs or perimeter_clubs(conn, platform,
                                          (window.input_season, window.target_season)),
            window.auction_date, progress=progress)
        if failure:
            notes.append(failure)
        # ...and then the squads AGAIN, because the roles step is what DOWNLOADS `/team/{id}/players`,
        # and that payload IS the live squad. Derived only before it, `squad_snapshot` read the newest
        # cache file on disk - yesterday's - on every single run: measured 07/08/2026, the 35 payloads
        # were written at 14:24 by a sheet whose squads had been derived at 14:22, so the ⇥ of a
        # departure and `eleven()`'s exclusion were always one day stale (the sheet's own evidence note
        # said `sofascore last observed` the day before, which is how it was found). The first pass
        # stays: the per-player roles top-up walks the squads to know whom to ask about.
        derive_squads(ctx, window.auction_date, window.target_season)
    progress.stage("prepare")
    data = features.prepare(conn, window, platform, game, league=setup,
                            squad_source="real")
    # The empty target calendar is patched inside `engine_predictions` - where the price is decided, so
    # every caller gets it - and its note arrives with the engine's own.
    progress.stage("predict")
    data, predictions, params_source, engine_notes = engine_predictions(
        conn, window, platform, game, setup, prepared=data)
    notes += engine_notes
    if not data.observations:
        raise RuntimeError(f"no players in the {window.target_season} listone for platform "
                           f"{platform} - nothing to snapshot")

    # Which season the descriptive layers measure, and up to which day. `before` is None for the usual
    # pre-season run: there the season total IS everything that happened.
    # HOW OLD the squad and transfer evidence is, said out loud before anything reads it (see
    # `evidence_age`): the operator's case was a sheet that was right about what it had, and what it had
    # was days old with the whole summer market missing.
    evidence, evidence_notes = evidence_age(conn, window)
    notes += evidence_notes
    measured, measured_note = measured_season(conn, window)
    before = window.auction_date if measured == window.target_season else None
    if measured_note:
        notes.append(measured_note)
    seasons = [row[0] for row in conn.execute(
        "SELECT DISTINCT season FROM rosters WHERE season <= ? ORDER BY season",
        (window.target_season,))]
    starters, starters_date = latest_starters(conn, window.auction_date,   # notes is already open
                                              window.target_season)
    if not starters:
        notes.append(
            "no probabili snapshot at or before the auction date: the starter and duel columns are empty. "
            + ("For a back-dated sheet this costs nothing and is not a gap to fill: a forecast of who "
               "plays is only interesting while the outcome is unknown, and for that day the eleven that "
               "was actually FIELDED exists - it is in the `actual_*` columns, and the pitch draws it. The "
               "editors' probabilities are worth fetching only for a sheet standing on TODAY, where they "
               "carry what we cannot compute: the coach's own words."
               if date else
               "They are a state of NOW and cannot be backfilled, so they exist only from the day a run "
               "records them - which is why a sheet for today refreshes them."))
    squads, squad_sources = squad_as_of(conn, window.auction_date)
    # The club's last ten has a stage of its own: it walks every observation against its club's fixture
    # list and it is the single most expensive descriptive layer, so folding it in with the cheap lookups
    # would make a quarter of the bar move in one step.
    progress.stage("form")
    form = club_form(conn, window.auction_date, data.observations, squads)
    progress.stage("layers")
    layers = {
        "form": form,
        "squads": squads, "squad_sources": squad_sources,
        "injuries": injury_history(conn, window.auction_date, seasons, measured),
        "starters": starters,
        "availability": availability_now(conn, window.auction_date),
        "propensity": propensity(conn, measured, before),
        "titolarita": titolarita(conn, measured, before),
        # The same season, split by WHOSE it was: what he played at the club he is at now, and what
        # somewhere else. The totals cannot say it - only the per-match layer stores a club.
        "at_club": at_current_club(conn, measured, data.observations, squads, before),
        # The engine's OWN recent sample (R13's input), so the sheet and the engine stand on one fact
        "elsewhere": measured_elsewhere(conn, window),
        # What the club has PUT INTO him - fee share and stature. A pre-auction fact; whether it weighs on
        # who is selected is a parameter of `engine.presence`, and it starts at zero.
        "investment": investment(conn, window, data.observations, squads),
        # ...and whether the club he is at now had already had him: the only measured difference between
        # a man it sent away and a man it has just taken on (no source of ours marks a loan).
        "was_here": previously_at_club(conn, data.observations, squads, measured),
        # Cards stay on the season aggregate of the season BEFORE: the per-match layer does not store
        # yellows and reds, so there is nothing to bound by a date - and last season's total is at least
        # a fact that was known by then.
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
        "real_role_detail": positions.roles_as_of(conn, window.auction_date, fallback=bool(date)),
        "sides": measured_sides(conn, window.input_season, notes),
        "positions": {fc_id: (avg_x, avg_y) for fc_id, avg_x, avg_y in conn.execute(
            "SELECT fc_id, avg_x, avg_y FROM positions WHERE season = ? AND source = 'sofascore'",
            (window.input_season,))},
        # The TARGET season's pre-season: who the coach who is there NOW started in the friendlies. The
        # only football a new man has played by auction day - and a reading, never a criterion, for the
        # five measured reasons in `preseason_starts`.
        "preseason": preseason_starts(conn, window.target_season),
    }
    # The eleven the clubs actually FIELDED in the first match after the auction date. Empty for a sheet
    # built today, and for a back-dated one it is what makes the probabili unnecessary: the outcome exists.
    progress.stage("fielded")
    layers["fielded_next"], fielded_clubs = fielded_next(
        conn, window.auction_date, data.observations, squads)
    if fielded_clubs:
        # How many of those elevens the SHEET can actually show: a starter who is not in its rows (a
        # relegated club's man, an identity we cannot resolve, someone the listone never had) leaves a hole,
        # and counting the complete ones is the honest way to say how far the fact goes.
        started_per_club: dict[str, int] = {}
        for obs in data.observations:
            if (layers["fielded_next"].get(obs.fc_id) or {}).get("started"):
                started_per_club[obs.club_target or ""] = started_per_club.get(obs.club_target or "", 0) + 1
        complete = sum(1 for count in started_per_club.values() if count >= 11)
        notes.append(f"{len(fielded_clubs)} clubs have the eleven they really fielded after "
                     f"{window.auction_date} in the `actual_*` columns (first match: "
                     f"{min(entry['date'] for entry in fielded_clubs.values())}), and {complete} of them "
                     f"have all eleven men among the sheet's own rows. The others fielded somebody this "
                     f"sheet does not carry, and the reason is the row set rather than the fact: the "
                     f"squads are the ones of TODAY (a past day's squad page cannot be fetched either), so "
                     f"a man who has since left his club is missing - Inter's eleven of 2025-08-24 is "
                     f"complete except Pavard. Measured AFTER the auction date, so reporting ONLY: no "
                     f"engine_* or desc_* column reads them, and the pitch labels them as fielded rather "
                     f"than predicted.")
    # after the layers, because a duel is POSITIONAL: it needs the granular real roles, not the P/D/C/A
    layers["duels"] = duels(data.observations, starters, layers["real_role_detail"])
    covered = sum(1 for obs in data.observations if obs.fc_id in layers["real_role_detail"])
    if date:
        borrowed = sum(1 for detail in layers["real_role_detail"].values()
                       if (detail.get("observed") or "") > window.auction_date)
        if borrowed:
            notes.append(f"{borrowed} granular real roles were observed AFTER {window.auction_date} and "
                         f"are used anyway: the provider ignores the season it is asked for, so no "
                         f"role can be observed for a past date and the alternative is a sheet that "
                         f"cannot place anybody. A role is the slowest-moving fact here - a left back "
                         f"is still a left back - and desc_real_role_observed carries the real date.")
    if covered < len(data.observations):
        notes.append(f"{len(data.observations) - covered} of {len(data.observations)} players have no "
                     f"granular real role: the provider's squad pages did not list them, or their "
                     f"identity is not resolved to a provider id. Their line is still known from "
                     f"desc_real_role (G/D/M/F) - what is missing is the flank. "
                     f"`positions --layer roles` retries, and only for TODAY: the codes cannot be "
                     f"observed for a past date. It can only observe a player it can IDENTIFY, so where "
                     f"the sofascore id is missing from player_xref the cure is the identity, not the "
                     f"run. Consequence to read on purpose: a ballottaggio is a duel between REAL roles, "
                     f"so desc_duel_rivals/desc_duel_names are EMPTY for these men - unknown, never "
                     f"'no rival' - and the pitch offers them no alternative rather than one taken from "
                     f"the listone role, which calls a winger and a regista the same thing.")

    perimeter = perimeter_clubs(conn, platform, (window.input_season, window.target_season))
    if not perimeter:
        # An unknown perimeter is not an empty one: filtering on nothing would blank the whole sheet.
        notes.append(f"platform {platform} has no ratings for {window.input_season}/"
                     f"{window.target_season}, so the perimeter is unknown and nothing was filtered")
        perimeter = None
    progress.stage("rows")
    rows = build_rows(conn, data, predictions, layers, perimeter, window, platform)
    dropped = len(data.observations) - len(rows) if perimeter is not None else 0
    if dropped:
        notes.append(f"{dropped} players were left out of the sheet: their club is not one this "
                     f"platform plays ({len(perimeter)} clubs are). They stay in the engine's "
                     f"population, so every number here is the one the harness would give")
    # WHY a row can have no engine_* valuation at all, said out loud instead of leaving an empty cell to be
    # read as a zero. The core refuses to predict outside the domain its coefficients were fitted on
    # (`model.MIN_PV_PREV` = 15 votes in the input season), and what happens then depends on the PLATFORM:
    # on euro the adopted set contains R0c, the role anchor, which prices him anyway; on default it does not
    # (it never beat the anchor there), so there is nothing to fall back to. That is the Serie A coverage
    # hole the gate has been carrying, and it is worth seeing on the sheet that shows it.
    unpriced = [row for row in rows if not row.get("engine_fm_pred")]
    if unpriced:
        notes.append(
            f"{len(unpriced)} of {len(rows)} players have NO engine_* valuation (no predicted fantamedia, "
            f"so no VALUE and no SURPLUS): their {window.input_season} on platform {platform} is under "
            f"{evaluate.model.MIN_PV_PREV} votes, which is outside the domain the core's coefficients were "
            f"fitted on - the harness refuses to pretend otherwise. On euro the adopted set includes R0c "
            f"(the role anchor) and prices them at it; on default R0c is not adopted, because it never beat "
            f"the anchor there, so the cell is EMPTY and not a zero. `desc_*` columns are unaffected: they "
            f"are measured, not predicted. Examples: "
            f"{', '.join(row['name'] for row in unpriced[:5])}.")
        # ...and the same count SPLIT by reason, because the sentence above can only say one of them and
        # the cell hides three. Per row it is in `engine_unpriced_reason`.
        by_reason: dict[str, int] = {}
        for row in unpriced:
            key = (row.get("engine_unpriced_reason") or "no prediction").split(" votes")[0]
            key = "too few votes" if key.startswith("only") else key
            by_reason[key] = by_reason.get(key, 0) + 1
        # ...and what the sheet DOES give them instead, because «ogni calciatore DEVE avere il suo SURPLUS»:
        # the fallback valuation, penalised and labelled per row.
        estimated = [row for row in rows if row.get("est_basis") and row["est_basis"] != "core"]
        if estimated:
            by_basis: dict[str, int] = {}
            for row in estimated:
                by_basis[row["est_basis"]] = by_basis.get(row["est_basis"], 0) + 1
            worst = min((row.get("est_confidence") or 1.0) for row in estimated)
            notes.append(
                f"...and all of them DO have an `est_surplus`: {len(rows) - len(estimated)} rows carry the "
                f"gated valuation and {len(estimated)} carry an ESTIMATE, penalised by how little is known "
                f"(confidence down to {worst:g}). By basis: "
                + " · ".join(f"{count} {basis}" for basis, count in sorted(
                    by_basis.items(), key=lambda item: -item[1]))
                + ". Same arithmetic as `engine_surplus` times that confidence, so one column ranks the "
                  "whole sheet; `est_note` says per row what it is built from. NOT gated and not measured: "
                  "it is the third prefix, and the ladder is in `engine/estimate.py` with the measurement "
                  "behind each rung.")
        notes.append("...and WHY, per row (`engine_unpriced_reason`): "
                     + " · ".join(f"{count} {reason}" for reason, count in sorted(
                         by_reason.items(), key=lambda item: -item[1]))
                     + ". A man with no season on this platform played his football on the other calendar "
                       "(or outside the perimeter): his measured history exists and is not a Serie A one, "
                       "and converting it is R1, which the gate has refused twice (§7-octies).")
    gone = [row for row in rows if row.get("desc_left_for")]
    if gone:
        notes.append(
            f"⚑ {len(gone)} players are still listed at a club they are no longer in, by one of TWO "
            f"independent signals - a transfer that names where they went, or the club's LIVE SQUAD not "
            f"containing them (the provider's own team page, one request per club, re-read every day: it had "
            f"Gutierrez out of Napoli on 28/07 while the listone and both squad pages still had him days "
            f"later). The row keeps its club on purpose: the listone is the game's own authority on who is in "
            f"a squad, so the sheet reports the contradiction instead of overruling it. Absence is only read "
            f"for a man the provider can identify - otherwise 'not in the payload' would mean 'never matched' "
            f"- and a signing made after the payload's date will read as absent until it is re-read: "
            + " · ".join(f"{row['name']} -> {row['desc_left_for']} ({row['desc_left_on']})"
                         for row in gone[:6])
            + (f" · and {len(gone) - 6} more" if len(gone) > 6 else "")
            + ". `desc_left_for` / `desc_left_on` carry it per row.")
    if clubs:
        wanted = {matching.club_key(name) for name in clubs}
        kept = [row for row in rows if matching.club_key(row.get("club") or "") in wanted]
        if not kept:
            raise RuntimeError(f"no players for {', '.join(clubs)} in this sheet - the club names are "
                               f"the canonical ones, e.g. 'Napoli', 'Inter'")
        notes.append(f"narrowed to {', '.join(sorted({row['club'] for row in kept}))}: "
                     f"{len(rows) - len(kept)} players of the other clubs were left out of the sheet, "
                     f"and the engine's numbers are unchanged (its population is the whole platform)")
        rows = kept
    club_rows = club_context(conn, data, starters_date,
                            sorted({row["club"] for row in rows if row.get("club")}),
                            measured, before, fielded_clubs)

    # The folder carries the day the sheet STANDS ON, plus the club when it is one club: a back-dated
    # run must not overwrite today's, and two dates are two different sheets. And the LEAGUE, because two
    # leagues can be played on the same platform and game with different squad sizes: without the name
    # the second sheet would silently overwrite the first one, whose numbers are measured against another
    # replacement level.
    progress.stage("write")
    stamp = date or dt.datetime.now(tz=dt.UTC).date().isoformat()
    only = f"-{matching.club_key(clubs[0]).replace(' ', '')}" if clubs and len(clubs) == 1 else ""
    named = f"-{matching.club_key(setup['name']).replace(' ', '')}" if setup["name"] else ""
    folder = Path(out) if out else (
        ctx.config.data_dir / "reports" /
        f"auction-snapshot-{window.target_season}-{platform}-{game}{named}{only}-{stamp}")
    folder.mkdir(parents=True, exist_ok=True)
    _write_csv(folder / "players.csv", PLAYER_COLUMNS, rows)
    _write_csv(folder / "clubs.csv", list(club_rows[0]) if club_rows else ["club"], club_rows)

    filled = {column: sum(1 for row in rows if row.get(column) not in (None, ""))
              for column in PLAYER_COLUMNS}
    manifest = {
        "generated_at": dt.datetime.now(tz=dt.UTC).isoformat(timespec="seconds"),
        "sheet_revision": SHEET_REVISION,
        "platform": platform, "game": game,
        "target_season": window.target_season, "input_season": window.input_season,
        "auction_date": window.auction_date,
        "players": len(rows), "clubs": len(club_rows),
        # WHICH LEAGUE this sheet is for. Without it a reader cannot know what the surplus column is
        # measured against: the replacement level is the fantamedia of the marginal rostered player, so
        # it changes with the squad size, and two leagues on the same platform and game produce two
        # different sort orders from the same predictions. `declared: false` = not one of the operator's
        # leagues, i.e. platform and game were read straight and these are the config file's top-level
        # numbers.
        "league": {
            "name": setup["name"] or None,
            "declared": setup.get("declared", True),
            "teams": setup["teams"], "squad_slots": dict(setup["squad_slots"]),
            "mantra_slots": dict(setup["mantra_slots"]) or None,
            "reliability_exponent": setup["reliability_exponent"],
            "min_availability": setup["min_availability"],
            "_note": "The league the sheet was built for, from config/league_config.json. It fixes the "
                     "REPLACEMENT LEVEL that engine_surplus is measured against - a number quoted "
                     "without it is not comparable with another league's.",
        },
        # The two CALENDARS, because a share of a season needs to say which one, and they are not the
        # same length: the platform's (31 euro rounds in 2025-26, 38 on default) is what engine_pv_pred
        # counts appearances on, while the descriptive shares are a share of the CLUB's championship
        # (clubs.csv `league_XIs`: 38 rounds in Serie A, 34 in the Bundesliga). Reading pv_pred against a
        # club's fixture list printed 53% for a man expected in 26.6 of 31 rounds.
        "matchdays": {
            "platform_target": data.matchdays_target,
            "platform_input": data.matchdays_prev,
            "_note": "engine_pv_pred is expressed on platform_target. The desc_* shares are shares of "
                     "the club's own championship calendar, which is clubs.csv `league_XIs`.",
        },
        "engine": {
            "rules": ["R0", *evaluate.ADOPTED.get(platform, ())],
            "params_from": params_source,
            "_note": "The `engine_*` columns are the valuation the gate validated. The parameters come "
                     "from a window that is not the season being auctioned. A coefficient quoted "
                     "without its platform, its residual baseline and its date is not a fact - the "
                     "numbers live in data/reports/engine_backtest.json.",
        },
        # The THIRD class of columns, and the only one that lives after the auction date.
        "actual": {
            "_note": "The `actual_*` columns are measured AFTER the auction date: the eleven the club "
                     "really fielded in its first match of the following week. They exist because a "
                     "BACK-DATED sheet has no use for a forecast of who plays - the outcome exists, and "
                     "the probabili of that day cannot be fetched anyway. Reporting ONLY: no rule, no "
                     "prediction and no desc_* column reads them, which is why they are not called "
                     "desc_. Empty on a sheet built today: the next match has not been played.",
            "clubs_with_a_fielded_eleven": len(fielded_clubs),
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
        # What a formation IS, as opposed to what each coach does: every shape the season's complete
        # elevens used, league-wide, with counts. The board offers a club a shape it has never fielded
        # only if football plays it - a coach can try something new, and still not something invented.
        "formation_repertoire": league_repertoire(conn, measured, before),
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
        "evidence_age": evidence,
        "notes": notes,
    }
    (folder / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    progress.finish()
    print(f"[snapshot] {len(rows)} players · {len(club_rows)} clubs -> {folder}")
    thin = [column for column, count in filled.items()
            if column.startswith(("engine_", "desc_")) and count < len(rows) * 0.2]
    if thin:
        print(f"[snapshot] thin columns (<20% filled): {', '.join(thin)}")
    for line in notes:
        print(f"[snapshot] note: {line}")
    return manifest
