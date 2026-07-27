"""DB -> per-window observations, with the look-ahead discipline enforced in ONE place.

A backtest is only worth as much as its inputs are honest, and the easiest way to fool ourselves is
to feed the model something that was not knowable on auction day. So every read lives here and is
tagged:

  ALLOWED  input-season aggregates (season_stats, external_stats, flags, positions) · the TARGET
           listone's roles / prices / club (published before the auction, which is already how
           `arrivals` computes its tiers) · `arrivals` of the target season (it describes a move that
           happened before the auction, and its foreign FM-equivalent is built from the input season)
           · club_elo at the auction date · dated states (probable_starter, penalty_hierarchy) with
           valid_from <= auction date
  FORBIDDEN anything of the target season except the listone: target ratings, target flags/positions,
           target mv_synth, dated states after the auction. The target aggregates ARE loaded, but
           only into the `*_act` fields, which exist for scoring and are never passed to the model.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field

from euroleghe_ingest.engine.model import ANCHOR_FALLBACK, ANCHOR_MIN_PV, split_roles

# ---------------------------------------------------------------- windows


@dataclass(frozen=True)
class Window:
    """One prediction exercise: predict `target_season` knowing only `input_season`."""

    key: str
    input_season: str
    target_season: str
    auction_date: str        # everything dated after this is invisible to the model

    @property
    def label(self) -> str:
        return f"{self.key} {self.input_season}->{self.target_season}"


# T1/T2 are the two independent windows the project's gate is written against. A third window needs
# seasons before 2023-24, which the raw sources do not cover yet (see the roadmap).
WINDOWS: dict[str, Window] = {
    "T1": Window("T1", "2023-24", "2024-25", "2024-08-15"),
    "T2": Window("T2", "2024-25", "2025-26", "2025-08-15"),
}


# ---------------------------------------------------------------- observations


@dataclass(frozen=True)
class Observation:
    """Everything known about one player for one window, plus his actual outcome (for scoring)."""

    fc_id: int
    name: str
    role_classic: str | None
    roles_mantra: tuple[str, ...]
    league: str | None
    # Qt.A of the target season: revised all season long, so for a past season it already knows the
    # outcome. Kept for description only - no rule may read it (`price_initial` is the usable one).
    price: float | None
    club_prev: str | None
    club_target: str | None
    # input season: the model may use all of this
    pv_prev: int | None
    mv_prev: float | None
    fm_prev: float | None
    minutes_prev: int | None = None
    starts_prev: int | None = None
    matches_prev: int | None = None
    goals_prev: int | None = None
    assists_prev: int | None = None
    xg_prev: float | None = None
    xa_prev: float | None = None
    rating_prev: float | None = None
    minutes_share_euro_prev: float | None = None    # minutes on the euro calendar's own rounds
    # Qt.I, the pre-auction quotation: the market's EXPECTATION for the target season, and the same
    # quantity a year earlier - so the engine can read how the market REVISED him before the auction.
    price_initial: float | None = None
    price_initial_prev: float | None = None
    # `recent_form`: a small dated sample for players with no history at all. Ratings from a
    # competition the synthetic voto was never fitted on, so kept as its own thing.
    recent_matches: int = 0
    recent_minutes: int = 0
    recent_goals: int = 0
    recent_assists: int = 0
    recent_rating: float | None = None
    # inactivity, from the dated per-match layer: the injury proxy while `injuries` stays empty
    longest_gap_days: int | None = None
    days_since_last_match: int | None = None
    minutes_last_3: float | None = None
    birth_year: int | None = None
    derived_role_prev: str | None = None
    off_role_prev: bool = False
    # target season, but known before the auction
    arrival_type: str | None = None
    arrival_tier: str | None = None
    origin_league: str | None = None
    foreign_fm_equiv: float | None = None
    elo_target: float | None = None
    new_coach_target: bool = False        # derived at 1 August, so known on auction day
    same_role_arrivals: int = 0           # new team-mates competing for the same Classic role
    starter_prob: float | None = None
    penalty_rank: int | None = None
    penalty_confidence: float | None = None
    # actual outcome - SCORING ONLY, never an input
    pv_act: int | None = None
    mv_act: float | None = None
    fm_act: float | None = None

    @property
    def club_change(self) -> bool:
        """An unknown previous club counts as "stayed": the module was fitted that way."""
        if not self.club_prev or not self.club_target:
            return False
        return self.club_prev != self.club_target

    @property
    def value_act(self) -> float | None:
        if self.fm_act is None or self.pv_act is None:
            return None
        return self.fm_act * self.pv_act

    def share_prev(self, matchdays: int) -> float:
        return (self.pv_prev or 0) / matchdays if matchdays else 0.0

    def age(self, window: Window) -> int | None:
        if not self.birth_year:
            return None
        return int(window.target_season.split("-")[0]) - self.birth_year

    def minutes_share_prev(self, rounds: int) -> float | None:
        """Minutes over the club's available minutes: the titolare/spezzonista separator (R3)."""
        if self.minutes_prev is None or not rounds:
            return None
        return self.minutes_prev / (90.0 * rounds)


# ---------------------------------------------------------------- loaders


def matchday_count(conn: sqlite3.Connection, platform: str, season: str) -> int:
    """Matchdays actually published for that platform/season (euro is 30-31, `default` is 38)."""
    row = conn.execute(
        "SELECT COUNT(DISTINCT matchday) FROM match_ratings WHERE season = ? AND platform = ?",
        (season, platform)).fetchone()
    return int(row[0] or 0)


def league_rounds(conn: sqlite3.Connection, season: str) -> dict[str, int]:
    """Real rounds per league from the provider layer (34 in the Bundesliga, 38 elsewhere)."""
    return {league: int(rounds) for league, rounds in conn.execute(
        "SELECT competition, MAX(real_md) FROM external_match_stats "
        "WHERE season = ? AND competition IS NOT NULL AND real_md IS NOT NULL "
        "GROUP BY competition", (season,))}


def euro_minutes_shares(conn: sqlite3.Connection, season: str) -> dict[int, float]:
    """Minutes played IN THE ROUNDS THE EURO CALENDAR ACTUALLY USES, as a share of those rounds.

    The reason R3 (minutes over the full real season) failed on the euro platform: the target is
    appearances in a 27-31 round SUBSET of a 34-38 round league, and a player's minutes in the rounds
    the game ignores say nothing about the rounds it scores. `matchday_map` knows which real round
    each euro round bundles, per league, so the minutes can be measured on the same calendar as the
    target. Summed across competitions for players who changed league mid-season.
    """
    mapped_rounds = {league: count for league, count in conn.execute(
        "SELECT league, COUNT(*) FROM matchday_map WHERE season = ? GROUP BY league", (season,))}
    if not mapped_rounds:
        return {}
    totals: dict[int, float] = {}
    for fc_id, competition, minutes in conn.execute(
            """SELECT e.fc_id, e.competition, SUM(COALESCE(e.minutes, 0))
               FROM external_match_stats e
               JOIN matchday_map m ON m.season = e.season AND m.league = e.competition
                                  AND m.real_md = e.real_md
               WHERE e.season = ? AND e.source = 'sofascore'
               GROUP BY e.fc_id, e.competition""", (season,)):
        rounds = mapped_rounds.get(competition)
        if rounds:
            totals[fc_id] = totals.get(fc_id, 0.0) + minutes / (90.0 * rounds)
    return {fc_id: min(share, 1.0) for fc_id, share in totals.items()}


def anchors(conn: sqlite3.Connection, platform: str, seasons: tuple[str, ...], game: str,
            min_pv: int = ANCHOR_MIN_PV, min_weight: float = 3.0) -> dict[str, float]:
    """Role anchors recomputed from the DB, averaged over `seasons` (task 3.1's own procedure).

    `game='classic'` -> one anchor per P/D/C/A. `game='mantra'` -> the FRACTIONAL variant: a
    multi-role player's fantamedia counts 1/k on each of his k roles, so the thin roles are not
    dominated by whoever happens to also be listed elsewhere.

    Roles with less than `min_weight` of effective sample fall back through `ANCHOR_FALLBACK`
    (that is how 'b' borrows 'dc' until the braccetto sample matures).
    """
    per_season: dict[str, list[float]] = {}
    for season in seasons:
        rows = conn.execute(
            """SELECT r.role_classic, r.roles, ss.fm
               FROM season_stats ss
               JOIN rosters r ON r.fc_id = ss.fc_id AND r.season = ss.season
               WHERE ss.season = ? AND ss.platform = ? AND ss.pv >= ? AND ss.fm IS NOT NULL""",
            (season, platform, min_pv)).fetchall()
        totals: dict[str, list[float]] = {}
        for role_classic, roles_raw, fm in rows:
            if game == "classic":
                keys = [role_classic] if role_classic else []
                weight = 1.0
            else:
                keys = split_roles(roles_raw)
                weight = 1.0 / len(keys) if keys else 0.0
            for key in keys:
                bucket = totals.setdefault(key, [0.0, 0.0])
                bucket[0] += weight * fm
                bucket[1] += weight
        for key, (weighted_sum, weight_total) in totals.items():
            if weight_total >= min_weight:
                per_season.setdefault(key, []).append(weighted_sum / weight_total)
    out = {key: sum(values) / len(values) for key, values in per_season.items() if values}
    for role, source in ANCHOR_FALLBACK.items():
        if role not in out and source in out:
            out[role] = out[source]
    return out


def goalkeeper_club_rates(conn: sqlite3.Connection, platform: str,
                          season: str) -> tuple[dict[str, float], float]:
    """{club: goals conceded per game} from its keepers, plus the population mean (M2e's mu_rate)."""
    rows = conn.execute(
        """SELECT c.canonical_name, SUM(ss.goals_conceded), SUM(ss.pv)
           FROM season_stats ss
           JOIN rosters r ON r.fc_id = ss.fc_id AND r.season = ss.season
           JOIN clubs c ON c.fc_club_id = r.fc_club_id
           WHERE ss.season = ? AND ss.platform = ? AND r.role_classic = 'P' AND ss.pv > 0
           GROUP BY 1""", (season, platform)).fetchall()
    rates = {club: conceded / appearances for club, conceded, appearances in rows
             if appearances and conceded is not None}
    mean = sum(rates.values()) / len(rates) if rates else 1.3
    return rates, mean


def _external(conn: sqlite3.Connection, season: str) -> dict[int, tuple]:
    """Input-season provider aggregates, built from the PER-MATCH layer with the season aggregates
    as a fallback.

    The per-match layer is the better source now that it is complete (all clubs of all 5 leagues,
    not just the perimeter's fixtures): it resolves identity through `player_xref`, which is
    season-agnostic, so a player who was outside the fc listone in the input season still gets his
    minutes. `external_stats` resolves identity against THAT season's roster, so it silently misses
    exactly the population R1 exists for - the newcomers. Ezzalzouli is the case that showed it: 33
    matches and 1995 minutes in 24/25 in the per-match layer, no season-aggregate row at all.

    `external_stats` still fills anyone the per-match layer does not cover, and the ratings are
    match-weighted either way.
    """
    out: dict[int, tuple] = {}
    for fc_id, matches, starts, minutes, goals, assists, xg, xa, rating_weighted in conn.execute(
            """SELECT fc_id, COUNT(*), SUM(COALESCE(started, 0)), SUM(COALESCE(minutes, 0)),
                      SUM(COALESCE(goals, 0)), SUM(COALESCE(assists, 0)), SUM(COALESCE(xg, 0)),
                      SUM(COALESCE(xa, 0)), SUM(COALESCE(rating, 0))
               FROM external_match_stats
               WHERE season = ? AND source = 'sofascore' AND COALESCE(minutes, 0) > 0
               GROUP BY fc_id""", (season,)):
        out[fc_id] = (matches, starts, minutes, goals, assists, xg, xa,
                      (rating_weighted / matches) if matches else None)
    for fc_id, matches, starts, minutes, goals, assists, xg, xa, rating_weighted in conn.execute(
            """SELECT fc_id, SUM(COALESCE(matches, 0)), SUM(COALESCE(starts, 0)),
                      SUM(COALESCE(minutes, 0)), SUM(COALESCE(goals, 0)), SUM(COALESCE(assists, 0)),
                      SUM(COALESCE(xg, 0)), SUM(COALESCE(xa, 0)),
                      SUM(COALESCE(rating, 0) * COALESCE(matches, 0))
               FROM external_stats WHERE season = ? AND source = 'sofascore' GROUP BY fc_id""",
            (season,)):
        if fc_id not in out:
            out[fc_id] = (matches, starts, minutes, goals, assists, xg, xa,
                          (rating_weighted / matches) if matches else None)
    return out


def _recent_form(conn: sqlite3.Connection, auction_date: str) -> dict[int, dict]:
    """The last matches of players with no history, from `recent_form`, STRICTLY before the auction.

    A separate source on purpose (`sofascore_recent`): these matches are in competitions the synthetic
    voto was never calibrated on, so their rating is a rating and not a base voto. What the engine gets
    is a small, honest sample - how many matches, how many minutes, what the provider thought of him -
    for players it would otherwise price on a role anchor alone.

    The date filter is what makes the same rows legal in a backtest: the scraper is anchored to today,
    the engine only ever looks at what predated that window's auction.
    """
    return {fc_id: {"matches": matches, "minutes": minutes, "goals": goals,
                    "assists": assists, "rating": rating}
            for fc_id, matches, minutes, goals, assists, rating in conn.execute(
                """SELECT fc_id, COUNT(*), SUM(COALESCE(minutes, 0)), SUM(COALESCE(goals, 0)),
                          SUM(COALESCE(assists, 0)), AVG(rating)
                   FROM external_match_stats
                   WHERE source = 'sofascore_recent' AND match_date < ?
                     AND COALESCE(minutes, 0) > 0
                   GROUP BY fc_id""", (auction_date,))}


def _inactivity(conn: sqlite3.Connection, auction_date: str) -> dict[int, dict]:
    """How long a player went without playing, from the dated per-match layer. The injury proxy.

    `injuries` is empty and no source fills it yet, but the per-match layer already says when a player
    did NOT appear: a gap of 90+ days inside a season is a spell out, whatever its cause. Measured on
    both providers' rows (the 5 leagues and `recent_form`), always before the auction date.

    Gaps that straddle 1 July are DISCARDED, and that correction is the whole difference between a
    signal and noise: measured across the close season, "longest gap" ranked 520 players in the
    over-90-days band and the relationship with next season's appearances inverted. Measured inside a
    season it is monotone on both windows - over 90 days out means about 13 appearances the year after
    against 18 for a normal 21-45 day gap.
    """
    import datetime

    rows = conn.execute(
        """SELECT fc_id, match_date, COALESCE(minutes, 0) FROM external_match_stats
           WHERE match_date IS NOT NULL AND match_date < ? AND COALESCE(minutes, 0) > 0
           ORDER BY fc_id, match_date""", (auction_date,)).fetchall()
    auction = datetime.date.fromisoformat(auction_date)
    played: dict[int, list] = {}
    for fc_id, date, minutes in rows:
        played.setdefault(fc_id, []).append((datetime.date.fromisoformat(date), minutes))

    def crosses_july(start: datetime.date, end: datetime.date) -> bool:
        for year in range(start.year, end.year + 1):
            if start < datetime.date(year, 7, 1) <= end:
                return True
        return False

    out: dict[int, dict] = {}
    for fc_id, appearances in played.items():
        if len(appearances) < 3:
            continue
        dates = [date for date, _minutes in appearances]
        gaps = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)
                if not crosses_july(dates[i], dates[i + 1])]
        out[fc_id] = {
            "longest_gap": max(gaps) if gaps else 0,
            # to the auction it is always at least a close season, so this reads as "did he finish
            # the season playing" rather than as an absolute
            "days_since_last": (auction - dates[-1]).days,
            "minutes_last_3": sum(minutes for _date, minutes in appearances[-3:]) / 3,
        }
    return out


def _probable_starters(conn: sqlite3.Connection, auction_date: str) -> dict[int, float]:
    """Auction-day view of a dated series: the last row with valid_from <= the auction date."""
    out: dict[int, float] = {}
    for fc_id, probability in conn.execute(
            "SELECT fc_id, probability FROM probable_starter WHERE valid_from <= ? "
            "ORDER BY valid_from", (auction_date,)):
        out[fc_id] = probability
    return out


def _penalty_state(conn: sqlite3.Connection, auction_date: str) -> dict[int, tuple]:
    out: dict[int, tuple] = {}
    for fc_id, rank, confidence in conn.execute(
            "SELECT fc_id, rank, confidence FROM penalty_hierarchy WHERE valid_from <= ? "
            "ORDER BY valid_from", (auction_date,)):
        out[fc_id] = (rank, confidence)
    return out


def load(conn: sqlite3.Connection, window: Window, platform: str) -> list[Observation]:
    """All observations of a window. `platform='default'` is the Serie A game (Serie A players only)."""
    league_filter = " AND r.league = 'serie_a'" if platform == "default" else ""
    rows = conn.execute(
        f"""SELECT r.fc_id, p.canonical_name, r.role_classic, r.roles, r.league, r.price,
                   ct.canonical_name, cp.canonical_name, p.birth_year,
                   sp.pv, sp.mv, sp.fm, st.pv, st.mv, st.fm,
                   r.price_initial, rp.price_initial
            FROM rosters r
            JOIN players p ON p.fc_id = r.fc_id
            LEFT JOIN clubs ct ON ct.fc_club_id = r.fc_club_id
            LEFT JOIN rosters rp ON rp.fc_id = r.fc_id AND rp.season = ?
            LEFT JOIN clubs cp ON cp.fc_club_id = rp.fc_club_id
            LEFT JOIN season_stats sp ON sp.fc_id = r.fc_id AND sp.season = ? AND sp.platform = ?
            LEFT JOIN season_stats st ON st.fc_id = r.fc_id AND st.season = ? AND st.platform = ?
            WHERE r.season = ?{league_filter}""",
        (window.input_season, window.input_season, platform,
         window.target_season, platform, window.target_season)).fetchall()

    external = _external(conn, window.input_season)
    arrivals = {fc_id: (kind, tier, origin, equivalent) for fc_id, kind, tier, origin, equivalent
                in conn.execute("SELECT fc_id, type, tier, origin_league, foreign_fm_equiv "
                                "FROM arrivals WHERE season = ?", (window.target_season,))}
    elo_date = conn.execute("SELECT MAX(date) FROM club_elo WHERE date <= ?",
                            (window.auction_date,)).fetchone()[0]
    elo = {club: value for club, value in conn.execute(
        "SELECT c.canonical_name, e.elo FROM club_elo e JOIN clubs c USING(fc_club_id) "
        "WHERE e.date = ?", (elo_date,))} if elo_date else {}
    off_role = {fc_id for (fc_id,) in conn.execute(
        "SELECT fc_id FROM flags WHERE season = ? AND flag = 'off_role_usage'",
        (window.input_season,))}
    derived = {fc_id: role for fc_id, role in conn.execute(
        "SELECT fc_id, derived_role FROM positions WHERE season = ?", (window.input_season,))}
    recent = _recent_form(conn, window.auction_date)
    inactivity = _inactivity(conn, window.auction_date)
    starters = _probable_starters(conn, window.auction_date)
    penalties = _penalty_state(conn, window.auction_date)
    euro_minutes = euro_minutes_shares(conn, window.input_season)
    # new_coach is a TARGET-season flag and still auction-safe: `transfers.derive_new_coach` compares
    # who was in charge on 1 August with a year earlier, so a mid-season sacking only surfaces on the
    # following season - which is when it becomes priceable anyway.
    new_coach = {fc_id for (fc_id,) in conn.execute(
        "SELECT fc_id FROM flags WHERE season = ? AND flag = 'new_coach'", (window.target_season,))}
    # Positional competition, straight from the target listone: how many players are NEW at this club
    # in this role. The listone is published before the auction, and `arrivals` is a roster diff.
    competition: dict[tuple[str, str], int] = {}
    arrived: set[int] = set()
    for fc_id, club, role in conn.execute(
            """SELECT a.fc_id, c.canonical_name, r.role_classic
               FROM arrivals a
               JOIN rosters r ON r.fc_id = a.fc_id AND r.season = a.season
               LEFT JOIN clubs c ON c.fc_club_id = r.fc_club_id
               WHERE a.season = ?""", (window.target_season,)):
        if club and role:
            competition[(club, role)] = competition.get((club, role), 0) + 1
            arrived.add(fc_id)

    observations: list[Observation] = []
    for (fc_id, name, role_classic, roles_raw, league, price, club_target, club_prev, birth_year,
         pv_prev, mv_prev, fm_prev, pv_act, mv_act, fm_act,
         price_initial, price_initial_prev) in rows:
        matches, starts, minutes, goals, assists, xg, xa, rating = external.get(fc_id, (None,) * 8)
        kind, tier, origin, equivalent = arrivals.get(fc_id, (None, None, None, None))
        sample = recent.get(fc_id) or {}
        idle = inactivity.get(fc_id) or {}
        rank, confidence = penalties.get(fc_id, (None, None))
        observations.append(Observation(
            fc_id=fc_id, name=name, role_classic=role_classic,
            roles_mantra=tuple(split_roles(roles_raw)), league=league, price=price,
            club_prev=club_prev, club_target=club_target,
            pv_prev=pv_prev, mv_prev=mv_prev, fm_prev=fm_prev,
            minutes_prev=minutes, starts_prev=starts, matches_prev=matches,
            goals_prev=goals, assists_prev=assists, xg_prev=xg, xa_prev=xa, rating_prev=rating,
            minutes_share_euro_prev=euro_minutes.get(fc_id),
            price_initial=price_initial, price_initial_prev=price_initial_prev,
            recent_matches=sample.get("matches", 0), recent_minutes=sample.get("minutes", 0),
            recent_goals=sample.get("goals", 0), recent_assists=sample.get("assists", 0),
            recent_rating=sample.get("rating"),
            longest_gap_days=idle.get("longest_gap"),
            days_since_last_match=idle.get("days_since_last"),
            minutes_last_3=idle.get("minutes_last_3"),
            birth_year=birth_year, derived_role_prev=derived.get(fc_id),
            off_role_prev=fc_id in off_role,
            arrival_type=kind, arrival_tier=tier, origin_league=origin,
            foreign_fm_equiv=equivalent, elo_target=elo.get(club_target or ""),
            new_coach_target=fc_id in new_coach,
            # a player who arrived himself is not his own competition
            same_role_arrivals=max(0, competition.get((club_target or "", role_classic or ""), 0)
                                   - (1 if fc_id in arrived else 0)),
            starter_prob=starters.get(fc_id), penalty_rank=rank, penalty_confidence=confidence,
            pv_act=pv_act, mv_act=mv_act, fm_act=fm_act))
    return observations


# ---------------------------------------------------------------- input inventory

# What each pre-registered rule needs, so the report can state its feasibility instead of guessing.
FEATURE_CHECKS: tuple[tuple[str, str], ...] = (
    ("fm_prev", "previous fantamedia - the core's only input today"),
    ("minutes_prev", "provider minutes - R3 titolare vs spezzonista"),
    ("minutes_share_euro_prev", "minutes on the euro calendar's rounds - R3c"),
    ("xg_prev", "provider xG/xA - R2 per-90 propensity"),
    ("foreign_fm_equiv", "foreign FM-equivalent - R1 arrivals"),
    ("recent_rating", "last matches elsewhere (recent_form) - R13 no-history players"),
    ("longest_gap_days", "longest spell without playing - R14 inactivity"),
    ("price_initial", "pre-auction quotation Qt.I - R12 market expectation"),
    ("price_initial_prev", "last season's Qt.I - R12b expectation revision"),
    ("birth_year", "birth year - R4 age curve"),
    ("elo_target", "destination club Elo - R5 (backlog)"),
    ("starter_prob", "probable starter at auction date - R7 goalkeepers"),
    ("penalty_rank", "penalty hierarchy at auction date - R6/R8"),
)


def feature_availability(observations: list[Observation]) -> dict[str, dict[str, int]]:
    """How many observations actually carry each feature: the next phases' feasibility, measured."""
    return {name: {"present": sum(1 for obs in observations if getattr(obs, name) is not None),
                   "total": len(observations)}
            for name, _description in FEATURE_CHECKS}


@dataclass
class WindowData:
    """A window plus everything the model is allowed to know. Built only by `prepare`."""

    window: Window
    platform: str
    game: str
    observations: list[Observation]
    anchors: dict[str, float] = field(default_factory=dict)
    gk_rates: dict[str, float] = field(default_factory=dict)
    mu_rate: float = 1.3
    matchdays_prev: int = 0
    matchdays_target: int = 0
    rounds: dict[str, int] = field(default_factory=dict)

    def rounds_for(self, league: str | None) -> int:
        """Real rounds of the player's league, with the 38-round default for unknown leagues."""
        return self.rounds.get(league or "", 38) or 38


def prepare(conn: sqlite3.Connection, window: Window, platform: str, game: str) -> WindowData:
    """Load a window and everything the model needs, using only seasons <= the input season."""
    seasons = tuple(season for (season,) in conn.execute(
        "SELECT DISTINCT season FROM season_stats ORDER BY season") if season <= window.input_season)
    gk_rates, mu_rate = goalkeeper_club_rates(conn, platform, window.input_season)
    return WindowData(
        window=window, platform=platform, game=game,
        observations=load(conn, window, platform),
        anchors=anchors(conn, platform, seasons, game),
        gk_rates=gk_rates, mu_rate=mu_rate,
        matchdays_prev=matchday_count(conn, platform, window.input_season),
        matchdays_target=matchday_count(conn, platform, window.target_season),
        rounds=league_rounds(conn, window.input_season),
    )
