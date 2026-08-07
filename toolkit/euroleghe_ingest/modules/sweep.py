"""sweep - the out-of-sample verdict on the PROVISIONAL presence parameters (gate 7-bis).

Five constants have been shaping the auction sheet without ever having been measured: the two discounts
for a season played somewhere else, the recency of the injury history, the availability floor, how starts
and minutes are weighed - plus, since v9.11, WHICH absences come off the denominator of a start rate. They
are model choices, so the golden rule applies to them exactly as to a candidate rule: no gate, no engine.

What this command does, and it is deliberately the same protocol the rule gate uses:

  * it rebuilds, for a window that was played years ago, the very inputs the panel would have had on that
    auction day - the layers `snapshot` writes, from seasons <= the input season and dated spells <= the
    auction date, so nothing here can see the season it is predicting;
  * it scores TWO targets, because the parameters do not all touch the same one: APPEARANCES (`pv` on the
    platform's own calendar, which is what a fantacalcio squad collects) against `presence.voto_share`,
    and STARTS (his championship's rounds he started, from the per-match layer) against
    `presence.presence` - `standing_weights` only exists in the second;
  * it sweeps one parameter at a time over a PRE-REGISTERED grid, cross-fits it leave-one-window-out
    (the value is chosen on the other windows and scored on the held-out one, never on itself), and
    reports the same two verdicts the rule gate reports, strict and robust, side by side.

It writes `data/reports/sweep_presence.json` and is READ-ONLY on the DB. Listed under STANDALONE for the
same reason `backtest` is: it produces no ingest table. It lives in `modules/` and not in `engine/` because
it needs the descriptive layers - `engine/` may not import upwards, and `presence.py`, which holds the
formulas being swept, is the part that has to stay portable.
"""

from __future__ import annotations

import datetime as dt
import json
from dataclasses import asdict, replace

from euroleghe_ingest.context import Context
from euroleghe_ingest.engine import evaluate, features, model, presence
from euroleghe_ingest.modules import snapshot

# The five championships, as a SQL list: the competitions a platform's calendar is made of, and the only
# ones a share of a season may be counted over (spec «Novità v9.11»).
LEAGUES: tuple[str, ...] = snapshot.LEAGUE_COMPETITIONS
_IN = ",".join("?" * len(LEAGUES))

# `external_stats`, `external_match_stats` and `club_match_lineups` all start at 2019-20: before that there
# is no starts/minutes layer to build a single one of these inputs from, and a window that cannot see a
# parameter says nothing about it. Same rule the rule gate applies to its own thin windows.
FIRST_INSTRUMENTED = "2019-20"

NAME = "sweep"
DESCRIPTION = "Gate sweep of the provisional presence parameters against what actually happened"
DEPENDS_ON: list[str] = ["rosters", "stats", "ratings", "positions", "injuries"]
RAW_INPUTS: list[str] = []
NETWORK = False

# ---------------------------------------------------------------- the pre-registered grids
#
# Written down before the run, and every value has a reason to be in it rather than being a range someone
# liked: the two discounts span the whole meaningful interval (1.0 = a season elsewhere counts in full,
# 0.0 = it counts for nothing, which is the shape the module explicitly rejected when it was written);
# the injury weight shapes are the three the knowledge base already quoted plus the two degenerate ones
# (last season only, all three equal) that say whether the recency matters at all; the standing weights
# walk from "only starts" to "only minutes"; and `contested_from` is the v9.11 shape change against the
# one it replaced.
GRIDS: dict[str, tuple] = {
    "loan_discount": (0.0, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0),
    "arrival_discount": (0.0, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0),
    # THE ARRIVAL SPLIT (pre-registered 06/08/2026, gate §7-quindecies), as PAIRS (intra, cross) because
    # with the cross value equal to the intra one the two are the same function and sweeping one alone
    # would report "no effect" about a term that is switched off. The first entry is the incumbent - one
    # discount for both. The measured residuals say cross-league arrivals are nearly unbiased (−0.013)
    # while intra-league ones pay (−0.057), so the grid moves the CROSS value up toward 1.0 (less discount)
    # and keeps one entry the other way, because a hypothesis that only allows its own sign is not a test.
    "arrival_split": ((0.8, 0.8), (0.8, 0.7), (0.8, 0.9), (0.8, 1.0), (0.7, 0.9), (0.7, 1.0), (0.9, 1.0)),
    "availability_floor": (0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6),
    "injury_weights": ((1.0, 0.6, 0.35), (1.0, 0.75, 0.5), (1.0, 0.45, 0.2),
                       (1.0, 0.0, 0.0), (1.0, 1.0, 1.0)),
    "standing_weights": ((1.0, 0.0), (0.8, 0.2), (0.65, 0.35), (0.5, 0.5), (0.35, 0.65), (0.0, 1.0)),
    "contested_from": ("measured", "forecast"),
    # THE INVESTMENT HYPOTHESIS (pre-registered 29/07/2026, gate 7-quater). Both weights start at 0 = off,
    # and the grid is one-sided upward for the fee (spending cannot make a coach play a man LESS) and
    # includes a negative step for the stature, because a hypothesis that only allows the sign it expects is
    # not being tested. 0.30 of a season is nine rounds: past that the term would be deciding the eleven on
    # its own, which is not what anybody is claiming.
    "fee_weight": (0.0, 0.05, 0.10, 0.15, 0.20, 0.30),
    # the market-value channel, on the same grid as the fee: it is the same claim with a proxy that exists
    # for a free arrival too, and a share of the squad's value is on the same 0..1 scale as a share of its
    # spending. Pre-registered in gate §7-quater's follow-up.
    "value_weight": (0.0, 0.05, 0.10, 0.15, 0.20, 0.30, 0.50),
    "stature_weight": (-0.10, 0.0, 0.05, 0.10, 0.15, 0.20, 0.30),
    # THE QUALITY HYPOTHESIS (pre-registered 06/08/2026, gate §7-duodecies). «Un giocatore con SURPLUS
    # maggiore, nell'arco dell'anno, acquisirà più visibilità agli occhi dell'allenatore e quindi
    # minutaggio». Swept on the FANTAMEDIA and not on the surplus, because the surplus already contains the
    # presences this very standing produces. Centred on what was measured before the grid was written -
    # +1.5 minutes per round per sd of role-relative FM, i.e. 0.017 of a season - with 0.05 (three times
    # it) as the upper bound and ONE negative step, because a hypothesis that only allows the sign it
    # expects is not being tested. 0 is in the grid and is the incumbent.
    "quality_weight": (-0.01, 0.0, 0.01, 0.017, 0.025, 0.035, 0.05),
    # THE LEVEL HYPOTHESIS (pre-registered 06/08/2026, gate §7-terdecies). «Livello più alto puoi intenderlo
    # anche con Premier > Serie A», and the data agrees: mean ClubElo 1807 against 1610. Centred on what was
    # measured BEFORE the grid was written - +0.040 of start share per sd of the origin club's Elo, on 700
    # transfers, controlling for the minutes AND the fantamedia - with 0.12 (three times it) as the ceiling
    # and one negative step, because a hypothesis that only allows the sign it expects is not being tested.
    # 0 is in the grid and is the incumbent.
    "level_weight": (-0.02, 0.0, 0.02, 0.04, 0.06, 0.08, 0.12),
    # THE SALTO (pre-registered 07/08/2026, gate §7-duovicies), from the operator's question about what
    # separates a squad filler from a designated starter - with the listone's Qt.I ruled OUT by him, because
    # it already contains its author's opinion about the man's titolarità and predicting titolarità with it
    # is circular. `elo_prev - elo_target`, standardised: how far he steps DOWN by moving. Measured at equal
    # minutes, r = +0.220 against the residual, against +0.117 for the absolute origin level. The grid is the
    # level channel's own, so the two are directly comparable, plus one negative step because a hypothesis
    # that only allows the sign it expects is not being tested. 0 is the incumbent.
    # SWEPT TOGETHER WITH `level_weight` on purpose: they share `elo_prev`, so a run where this wins and that
    # falls to zero says the gap SUBSUMES the level, and a run where both hold says they read different
    # things. Deciding it by hand was the alternative, and it is not one.
    "level_gap_weight": (-0.02, 0.0, 0.02, 0.04, 0.06, 0.09, 0.12),
    # IL RANGO NEL REPARTO (pre-registrato 07/08/2026, gate §7-tervicies). Non un lift ma una MISCELA,
    # perche' e' la forma misurata: 0.75 x minuti + 0.25 x rango dava r +0.346 contro +0.286 dei soli
    # minuti e +0.109 del solo rango, con massimo INTERNO sulla griglia esplorata (0.15/0.25/0.35/0.50).
    # La griglia qui e' centrata su quel 0.25 e arriva a 0.45, cosi' l'ottimo puo' restare interno anche
    # se si sposta; 0.0 e' l'incumbent ed e' dentro. Nessuno step negativo: mescolare al CONTRARIO del
    # rango non e' un'ipotesi che qualcuno abbia formulato, e la griglia dichiara cosa si sta testando.
    "level_rank_weight": (0.0, 0.10, 0.18, 0.25, 0.32, 0.45),
    # THE CAREER HYPOTHESIS (pre-registered 06/08/2026, gate §7-vicies). Centred on the measured effect -
    # +0.034 of start share per sd of role-relative career fantamedia, on 264 forwards - with 0.10 as the
    # ceiling and one negative step. Applied to FORWARDS ONLY, which is where it was measured: over
    # everybody it is +0.010, on midfielders +0.020, on defenders **−0.054**. 0 is the incumbent.
    "career_weight": (-0.02, 0.0, 0.02, 0.034, 0.05, 0.07, 0.10),
    # THE SAMPLE-SIZE SHRINKAGE (pre-registered 06/08/2026, gate §7-quaterdecies). In ROUNDS: K is how many
    # rounds of the population's mean it takes to outweigh his own. One-sided by construction - K < 0 is not
    # a weaker shrinkage, it is nonsense - and 0 is the incumbent. The top of the grid, 25, would make a
    # 13-round sample count for a third of itself; past that the parameter would be replacing the player
    # with the average, which is not what anybody is claiming.
    "standing_prior_rounds": (0.0, 3.0, 6.0, 10.0, 15.0, 25.0),
    # ...and the same hypothesis in its SHARPER form, as a composite: the two weights alone are swept on the
    # "standing" shape, where a lift is added to everybody, but the claim is really about the man whose
    # season was played somewhere else - the signing the club has just paid for. `investment_shape="arrival"`
    # is that version (the investment closes part of what the arrival discount took away, and does nothing
    # to a man whose whole season is already here), and it cannot be tested by moving the shape alone,
    # because with both weights at zero the two shapes ARE the same function. Hence the pairs.
    # THE CONDITIONAL FORM (pre-registered 05/08/2026, gate §7-septies): the lift only where the MINUTES are
    # not informative - `investment_shape="unplayed"` closes part of the gap between what he played and a
    # full season. Two arms, never summed and reported separately because their COVERAGE differs by five
    # times: the market value exists on 11 seasons, the transfer fee only from 2023. Each keeps its own
    # channel's grid from §7-quater / §7-quinquies, untouched - re-tuning a grid after seeing the curve is
    # the other way of fitting.
    "investment_unplayed_value": (("standing", 0.0, 0.0, 0.0),
                                  ("unplayed", 0.0, 0.0, 0.05), ("unplayed", 0.0, 0.0, 0.10),
                                  ("unplayed", 0.0, 0.0, 0.15), ("unplayed", 0.0, 0.0, 0.20),
                                  ("unplayed", 0.0, 0.0, 0.30), ("unplayed", 0.0, 0.0, 0.50)),
    # ...and the NULL of the same shape, on the scale the value channel works at (a starter is an eleventh
    # of his squad's value, so `value_weight` x 0.09 is what a 0.5 weight really adds: hence 0.005 - 0.05).
    "investment_unplayed_null": (("standing", 0.0, 0.0, 0.0, 0.0),
                                 ("unplayed", 0.0, 0.0, 0.0, 0.005), ("unplayed", 0.0, 0.0, 0.0, 0.01),
                                 ("unplayed", 0.0, 0.0, 0.0, 0.02), ("unplayed", 0.0, 0.0, 0.0, 0.03),
                                 ("unplayed", 0.0, 0.0, 0.0, 0.05)),
    "investment_unplayed_fee": (("standing", 0.0, 0.0, 0.0),
                                ("unplayed", 0.05, 0.0, 0.0), ("unplayed", 0.10, 0.0, 0.0),
                                ("unplayed", 0.15, 0.0, 0.0), ("unplayed", 0.20, 0.0, 0.0),
                                ("unplayed", 0.30, 0.0, 0.0)),
    "investment": (("standing", 0.0, 0.0),
                   ("arrival", 0.1, 0.0), ("arrival", 0.2, 0.0), ("arrival", 0.3, 0.0),
                   ("arrival", 0.5, 0.0), ("arrival", 0.0, 0.1), ("arrival", 0.0, 0.2),
                   ("arrival", 0.2, 0.2)),
    # THE FOLLOW-UP OF §7-septies, pre-registered 05/08/2026 and written here BEFORE the run. The first run
    # passed robust on Serie A and was NOT adopted for one reason: every fold picked the EDGE of the grid
    # (0.50 of 0.50), so the optimum sits outside what was ever measured, and a term is not adopted at a
    # boundary. Two arms, and only arm A (the market value) is extended - the fee arm is dead.
    # (1) the same channel, upward, stopping where the term would be deciding the eleven on its own: a
    # typical starter is about 0.09 of his squad's value, so weight 3.0 adds 0.27 of a season, which is the
    # same ceiling argument the fee grid used at 0.30.
    "investment_unplayed_value_wide": (("standing", 0.0, 0.0, 0.0),
                                       ("unplayed", 0.0, 0.0, 0.50), ("unplayed", 0.0, 0.0, 0.75),
                                       ("unplayed", 0.0, 0.0, 1.00), ("unplayed", 0.0, 0.0, 1.50),
                                       ("unplayed", 0.0, 0.0, 2.00), ("unplayed", 0.0, 0.0, 3.00)),
    # (2) the same channel measured NET OF ITS NULL, which is the part the first run could not separate: the
    # shape rewards whoever played little, and whoever played little plays more next year whoever he is.
    # `shrink_weight` is held at 0.05 - the best pooled null of the first run on `default`, with euro's 0.03
    # inside one step of it - and the value weight is swept on top. The gains of this family are measured
    # against the NULL-ONLY point (see `BASELINES`), so what comes out is the MARGINAL contribution of
    # knowing what the club paid, never the sum of the two.
    "investment_unplayed_marginal": (("unplayed", 0.0, 0.0, 0.0, 0.05),
                                     ("unplayed", 0.0, 0.0, 0.10, 0.05),
                                     ("unplayed", 0.0, 0.0, 0.20, 0.05),
                                     ("unplayed", 0.0, 0.0, 0.50, 0.05),
                                     ("unplayed", 0.0, 0.0, 1.00, 0.05),
                                     ("unplayed", 0.0, 0.0, 2.00, 0.05)),
}

# WHICH GRID POINT a family's gains are measured against. The default is the value in the code, which is
# what "would this change help?" means. One family needs something else: the marginal contribution of the
# value channel over its own null is a per-fold comparison with the NULL POINT, and subtracting two
# families' pooled means would not be the same number - the folds are not the same weight.
BASELINES: dict[str, tuple] = {
    "investment_unplayed_marginal": ("unplayed", 0.0, 0.0, 0.0, 0.05),
}

# Which target each parameter is judged on. `standing_weights` never enters `voto_share` - appearances are
# not weighed between starts and minutes - so scoring it there would report a flat line and call it "no
# effect", which is a statement about the code and not about the parameter.
TARGETS: dict[str, str] = {
    "loan_discount": "appearances",
    "arrival_discount": "appearances",
    "availability_floor": "appearances",
    "injury_weights": "appearances",
    "contested_from": "appearances",
    "standing_weights": "starts",
    # The claim is about SELECTION - who the coach puts on the pitch - so it is judged on starts.
    "fee_weight": "starts",
    "value_weight": "starts",
    "stature_weight": "starts",
    "investment": "starts",
    # the conditional form asks the same question - who the coach PUTS on the pitch
    "investment_unplayed_value": "starts",
    "investment_unplayed_fee": "starts",
    "investment_unplayed_null": "starts",
    "investment_unplayed_value_wide": "starts",
    "investment_unplayed_marginal": "starts",
    # ...and the quality channel asks the same question as the investment one - who the coach PUTS on the
    # pitch, given something the minutes could not see - so it is judged on the same outcome.
    "quality_weight": "starts",
    # same question again: who the coach PUTS on the pitch, given something the minutes could not see.
    "level_weight": "starts",
    "level_gap_weight": "starts",
    "level_rank_weight": "starts",
    "career_weight": "starts",
    "standing_prior_rounds": "starts",
    "arrival_split": "starts",
}

# The gate's own thresholds, quoted from gate-motore-v1.md so the two verdicts mean the same thing here.
FLOOR = 0.005            # below half a percent, a difference is not a difference
WORST_ALLOWED = -0.02    # robust: no window may lose more than 2%


# ---------------------------------------------------------------- the inputs, as of an auction day
def _calendars(conn, season: str) -> tuple[dict[str, float], dict[str, float], dict[str, float]]:
    """Per club: its championship's rounds, every fixture we parsed, and the league ones among them.

    The rounds come from the league's own calendar (`features.league_rounds`) and NOT from the elevens we
    parsed, because the older seasons are only partly parsed - 2020-21 and 2021-22 have about two thirds of
    the line-ups - and a calendar that short would print a 140% titolare. What the parsed count is for is
    the COVERAGE correction on the counted absences: rounds counted inside a spell can only be found among
    the fixtures we have, so they are scaled up by the share we are missing.
    """
    rounds = features.league_rounds(conn, season)
    resolve = snapshot.club_index(conn)
    leagues = {name: league for name, league in conn.execute(
        "SELECT canonical_name, league FROM clubs WHERE canonical_name IS NOT NULL")}
    calendar: dict[str, float] = {}
    for club, league in leagues.items():
        key, _name = resolve(club)
        if key and league in rounds:
            calendar[key] = float(rounds[league])
    fixtures: dict[str, float] = {}
    parsed_league: dict[str, float] = {}
    for club, total, league_count in conn.execute(
            f"""SELECT club, COUNT(*), SUM(competition IN ({_IN}))
                FROM club_match_lineups
                WHERE season = ? AND starters = 11
                  AND goalkeepers + defenders + midfielders + forwards = 11
                GROUP BY club""", (*LEAGUES, season)):
        key, _name = resolve(club)
        if not key:
            continue
        fixtures[key] = fixtures.get(key, 0.0) + float(total or 0)
        parsed_league[key] = parsed_league.get(key, 0.0) + float(league_count or 0)
    return calendar, fixtures, parsed_league


# The rounds bands the prior is conditioned on - the ones measured and published in gate §7-quaterdecies.
# Edges and not a fitted curve, because a fitted prior would be a second model inside a shrinkage.
_ROUNDS_BANDS = ((0, 10), (11, 19), (20, 28), (29, 34), (35, 10_000))


def _rounds_band(rounds: float) -> tuple[int, int]:
    for band in _ROUNDS_BANDS:
        if band[0] <= rounds <= band[1]:
            return band
    return _ROUNDS_BANDS[-1]


def build_inputs(conn, data: features.WindowData, ctx: Context | None = None) -> tuple[dict[int, presence.Inputs], dict]:
    """{fc_id: Inputs} for one window, plus a note on how well the window is instrumented.

    Everything is measured on the INPUT season and on spells dated before the auction: this is what the
    panel would have had in its hands on that day, no more.
    """
    window = data.window
    season = window.input_season
    resolve = snapshot.club_index(conn)
    calendar, fixtures, parsed_league = _calendars(conn, season)
    played = snapshot.titolarita(conn, season)
    rates = snapshot.propensity(conn, season)
    # squads = {}: for a past window there is no squad snapshot to read, and the club that matters is the
    # one the TARGET listone puts him at - which is published before the auction, so it is legal here.
    at_club = snapshot.at_current_club(conn, season, data.observations, {})
    spend = snapshot.investment(conn, window, data.observations, {})
    was_here = snapshot.previously_at_club(conn, data.observations, {}, season)
    seasons = [row[0] for row in conn.execute(
        "SELECT DISTINCT season FROM rosters WHERE season <= ? ORDER BY season", (season,))]
    injuries = snapshot.injury_history(conn, window.auction_date, seasons, season)

    # What he SHOWED, per role, in standard deviations - the quality channel's only input. Standardised
    # WITHIN the role because a 6.6 from a defender and a 6.6 from a forward are not the same season, and
    # computed over the men the core would price (a fantamedia off three votes is not a fantamedia).
    by_role: dict[str, list[float]] = {}
    for obs in data.observations:
        if obs.fm_prev is not None and (obs.pv_prev or 0) >= model.MIN_PV_PREV and obs.role_classic:
            by_role.setdefault(obs.role_classic, []).append(obs.fm_prev)
    # THE LEVEL of the football behind his minutes: the Elo of the club he played them for, standardised,
    # and ONLY for a man who has changed club - the population the coefficient was measured on. For a man
    # who stayed the term would quietly become «his own club is strong», a claim nobody has scored.
    elos = [obs.elo_prev for obs in data.observations
            if obs.elo_prev is not None and obs.club_change]
    level_z: dict[int, float] = {}
    if len(elos) > 1:
        mean_elo = sum(elos) / len(elos)
        sd_elo = (sum((x - mean_elo) ** 2 for x in elos) / len(elos)) ** 0.5
        if sd_elo > 0:
            for obs in data.observations:
                if obs.elo_prev is not None and obs.club_change:
                    level_z[obs.fc_id] = (obs.elo_prev - mean_elo) / sd_elo

    # ...and the SALTO he takes by moving: how far the club he played for stands above the one that just
    # bought him (gate §7-duovicies). Standardised over the same population and NOT over the origin Elos:
    # the quantity is a difference, and its spread is not the spread of the levels.
    gaps = [obs.elo_prev - obs.elo_target for obs in data.observations
            if obs.elo_prev is not None and obs.elo_target is not None and obs.club_change]
    level_gap_z: dict[int, float] = {}
    if len(gaps) > 1:
        mean_gap = sum(gaps) / len(gaps)
        sd_gap = (sum((x - mean_gap) ** 2 for x in gaps) / len(gaps)) ** 0.5
        if sd_gap > 0:
            for obs in data.observations:
                if obs.elo_prev is not None and obs.elo_target is not None and obs.club_change:
                    level_gap_z[obs.fc_id] = (obs.elo_prev - obs.elo_target - mean_gap) / sd_gap

    # ...and WHERE HE STANDS in the department he joins (§7-tervicies). Two steps, and the second is the
    # one that carries the meaning: the LEVEL of the football each man has played (five seasons,
    # minutes-weighted, every club in Europe and not just ours), then his percentile among the men of
    # HIS ROLE in the squad he is joining. Ranked inside the club because the question is comparative -
    # «lo hanno comprato davanti a chi c'era gia'?» - and a department of fewer than three men cannot
    # answer it, so those stay None rather than 0.5.
    from euroleghe_ingest.modules import elo as elo_module

    personal = elo_module.personal_levels(conn, ctx, season) if ctx else {}
    by_department: dict[tuple[str, str], list[float]] = {}
    for obs in data.observations:
        value = personal.get(obs.fc_id)
        key, _name = resolve(obs.club_target or "")
        if value is not None and key and obs.role_classic:
            by_department.setdefault((key, obs.role_classic), []).append(value)
    level_rank: dict[int, float] = {}
    for obs in data.observations:
        value = personal.get(obs.fc_id)
        key, _name = resolve(obs.club_target or "")
        peers = by_department.get((key or "", obs.role_classic or ""), ())
        others = [v for v in peers if v != value]
        if value is not None and len(others) >= 2:
            level_rank[obs.fc_id] = sum(1 for v in others if v < value) / len(others)

    # ...and the CAREER, only for forwards: the population the coefficient was measured on (§7-vicies).
    careers = [obs.fm_career for obs in data.observations
               if obs.fm_career is not None and obs.role_classic == "A"]
    career_z: dict[int, float] = {}
    if len(careers) > 1:
        mean_c = sum(careers) / len(careers)
        sd_c = (sum((x - mean_c) ** 2 for x in careers) / len(careers)) ** 0.5
        if sd_c > 0:
            for obs in data.observations:
                if obs.fm_career is not None and obs.role_classic == "A":
                    career_z[obs.fc_id] = (obs.fm_career - mean_c) / sd_c

    fm_z: dict[int, float] = {}
    for obs in data.observations:
        pool = by_role.get(obs.role_classic or "")
        if obs.fm_prev is None or not pool or len(pool) < 2:
            continue
        mean = sum(pool) / len(pool)
        var = sum((x - mean) ** 2 for x in pool) / len(pool)
        if var > 0:
            fm_z[obs.fc_id] = (obs.fm_prev - mean) / (var ** 0.5)

    # The population's mean standing for this window, computed with the shrinkage OFF - it is the prior the
    # shrinkage pulls toward, so reading it from an already-shrunk population would be circular.
    prior: float | None = None

    # Which championship each club plays in, so an arrival can be told apart from a move down the road.
    # Resolved through the canonical index like everything else that joins on a club.
    club_league: dict[str, str] = {}
    for name, league in conn.execute(
            "SELECT canonical_name, league FROM clubs WHERE canonical_name IS NOT NULL AND league IS NOT NULL"):
        club_league[resolve(name)[0]] = league

    def _cross(obs) -> bool:
        if not obs.club_change or not obs.club_prev or not obs.club_target:
            return False
        before = club_league.get(resolve(obs.club_prev)[0])
        after = club_league.get(resolve(obs.club_target)[0])
        return bool(before and after and before != after)

    out: dict[int, presence.Inputs] = {}
    thin = 0
    for obs in data.observations:
        key, _name = resolve(obs.club_target or obs.club_prev)
        rounds = calendar.get(key or "", 0.0)
        if not rounds:
            continue                     # a club outside the five championships: no calendar, no share
        mine = played.get(obs.fc_id)
        if not mine:
            continue                     # no season aggregate: the candidate has nothing to read
        parsed = parsed_league.get(key or "", 0.0)
        coverage = min(parsed / rounds, 1.0) if parsed else 0.0
        if coverage < 0.9:
            thin += 1
        injury = injuries.get(obs.fc_id, {})
        # The counted rounds are scaled up by what we did not parse of that calendar: a spell over a
        # stretch we have half the fixtures for costs him half the rounds it really did.
        lift = 1.0 / coverage if coverage else 1.0
        by_season: list[float | None] = []
        for part in (injury.get("rounds_by_season") or "").split(";"):
            try:
                by_season.append(min(float(part) * lift, rounds))
            except ValueError:
                by_season.append(None)
        measured_rounds = injury.get("rounds_measured")
        split = at_club.get(obs.fc_id, {})
        out[obs.fc_id] = presence.Inputs(
            starts=float(mine.get("starts") or 0),
            appearances=float(mine.get("matches") or 0),
            minutes=float((rates.get(obs.fc_id) or {}).get("minutes") or 0),
            league_matches=rounds,
            fixtures=fixtures.get(key or "", 0.0),
            rounds_measured=(min(measured_rounds * lift, rounds)
                             if measured_rounds is not None else None),
            rounds_by_season=tuple(by_season),
            weighted_all=injury.get("weighted"),
            known_injuries=bool(injury.get("source")),
            minutes_here=float(split.get("minutes") or 0),
            minutes_elsewhere=float(split.get("minutes_elsewhere") or 0),
            was_here_before=obs.fc_id in was_here,
            fm_z=fm_z.get(obs.fc_id),
            level_z=level_z.get(obs.fc_id),
            level_gap_z=level_gap_z.get(obs.fc_id),
            level_rank=level_rank.get(obs.fc_id),
            career_z=career_z.get(obs.fc_id),
            standing_prior=prior,
            cross_league=_cross(obs),
            fee_share=(spend.get(obs.fc_id) or {}).get("fee_share"),
            stature=(spend.get(obs.fc_id) or {}).get("stature"),
            value_share=(spend.get(obs.fc_id) or {}).get("value_share"),
        )
    # ...and NOW the prior, because it could not be known before the inputs existed: the population's mean
    # standing with the shrinkage OFF. Reading it from an already-shrunk population would be circular, and
    # the two-pass shape is the honest way to say that a prior belongs to a population and not to a player.
    if out:
        unshrunk = replace(presence.DEFAULTS, standing_prior_rounds=0.0)
        # ...and BY BAND of rounds observed, not one mean for everybody: a man measured over a handful of
        # rounds is a fringe player and regresses toward the fringe, not toward the league.
        bands: dict[tuple[int, int], list[float]] = {}
        for inp in out.values():
            band = _rounds_band(presence.contested(inp, unshrunk))
            bands.setdefault(band, []).append(presence.standing(inp, unshrunk))
        by_band = {band: sum(v) / len(v) for band, v in bands.items() if v}
        overall = sum(sum(v) for v in bands.values()) / sum(len(v) for v in bands.values())
        prior = round(overall, 4)
        out = {fc_id: replace(inp, standing_prior=by_band.get(
                   _rounds_band(presence.contested(inp, unshrunk)), overall))
               for fc_id, inp in out.items()}

    note = {"players": len(out), "of_observations": len(data.observations),
            "clubs_under_90pct_parsed": thin, "standing_prior": round(prior, 4) if prior else None}
    return out, note


def build_targets(conn, data: features.WindowData) -> dict[int, dict[str, float]]:
    """What actually happened, per player: his share of the appearances, and his share of the starts.

    Two calendars, deliberately. APPEARANCES are `pv` on the PLATFORM's calendar - the euro game scores a
    31-round subset of a 34-38 round league, and that subset is what a squad collects. STARTS come from the
    per-match layer over his championship's rounds, because no votes source carries who started: the
    `started` column of `match_ratings` is NULL in every season.
    """
    target = data.window.target_season
    matchdays = float(data.matchdays_target or data.matchdays_prev or 38)
    rounds = features.league_rounds(conn, target)
    starts: dict[int, tuple[float, float]] = {}
    for fc_id, competition, made in conn.execute(
            f"""SELECT fc_id, competition, SUM(COALESCE(started, 0)) FROM external_match_stats
                WHERE season = ? AND source = 'sofascore' AND COALESCE(minutes, 0) > 0
                  AND competition IN ({_IN})
                GROUP BY fc_id, competition""", (target, *LEAGUES)):
        total, calendar = starts.get(fc_id, (0.0, 0.0))
        starts[fc_id] = (total + float(made or 0), calendar + float(rounds.get(competition, 38)))
    out: dict[int, dict[str, float]] = {}
    for obs in data.observations:
        row: dict[str, float] = {}
        if obs.pv_act is not None:
            row["appearances"] = min(obs.pv_act / matchdays, 1.0)
        if obs.fc_id in starts:
            made, calendar = starts[obs.fc_id]
            if calendar:
                row["starts"] = min(made / calendar, 1.0)
        if row:
            out[obs.fc_id] = row
    return out


# ---------------------------------------------------------------- scoring
PREDICTORS = {"appearances": presence.voto_share, "starts": presence.presence}


def mae(inputs: dict[int, presence.Inputs], targets: dict[int, dict[str, float]],
        params: presence.Params, target: str) -> tuple[float, int]:
    """(mean absolute error on the share, how many players it was measured on)."""
    predict = PREDICTORS[target]
    total, count = 0.0, 0
    for fc_id, mine in inputs.items():
        actual = (targets.get(fc_id) or {}).get(target)
        if actual is None:
            continue
        total += abs(predict(mine, params) - actual)
        count += 1
    return (total / count if count else 0.0), count


def baseline_mae(data: features.WindowData, targets: dict[int, dict[str, float]],
                 inputs: dict[int, presence.Inputs]) -> tuple[float, int]:
    """The ENGINE's own appearances model on the same population - the incumbent, not a straw man.

    `model.expected_share` is the gated one (presenze-attese-v1.md): share_prev, last season's Mv and a
    club change, with the published coefficients. Scored on exactly the players the candidate could score,
    so the two numbers are comparable.
    """
    matchdays = float(data.matchdays_prev or 38)
    total, count = 0.0, 0
    for obs in data.observations:
        if obs.fc_id not in inputs:
            continue
        actual = (targets.get(obs.fc_id) or {}).get("appearances")
        if actual is None or obs.pv_prev is None:
            continue
        share_prev = min(obs.pv_prev / matchdays, 1.0) if matchdays else 0.0
        predicted = model.expected_share(share_prev, obs.mv_prev or model.MV_PIVOT, obs.club_change)
        total += abs(predicted - actual)
        count += 1
    return (total / count if count else 0.0), count


def verdicts(gains: dict[str, float]) -> dict[str, bool | float]:
    """The two gate verdicts on a set of per-window gains, reported side by side and never merged."""
    values = list(gains.values())
    if not values:
        # One window is not a cross-fit: choosing a value on the window that scores it is exactly the
        # thing the protocol forbids, so there is no verdict to give.
        return {"strict": False, "robust": False, "mean_gain": 0.0, "worst": 0.0, "windows": 0}
    mean_gain = sum(values) / len(values)
    return {
        "strict": all(value > FLOOR for value in values),
        "robust": (sum(1 for value in values if value > 0) > len(values) / 2
                   and mean_gain > FLOOR and min(values) >= WORST_ALLOWED),
        "mean_gain": round(mean_gain, 5),
        "worst": round(min(values), 5),
        "windows": len(values),
    }


def _label(value) -> str:
    if isinstance(value, tuple) and value and isinstance(value[0], str):
        # the composite: shape, fee, stature, and the market value where the arm carries one
        weights = "/".join(f"{part:g}" for part in value[1:])
        return f"{value[0]}:{weights}"
    return "/".join(f"{part:g}" for part in value) if isinstance(value, tuple) else f"{value}"


def _current(name: str):
    """The grid point the code is IN for this family - which a composite has no single field for.

    One place, because there were two and they disagreed: the smoke test learned about `arrival_split` and
    the sweep did not, so the run died on `getattr(Params, "arrival_split")`. A composite is defined by the
    tuple of fields it moves together, so that is what this returns.
    """
    if name.startswith("investment"):
        off = (presence.DEFAULTS.investment_shape, presence.DEFAULTS.fee_weight,
               presence.DEFAULTS.stature_weight)
        wide = (*off, presence.DEFAULTS.value_weight, presence.DEFAULTS.shrink_weight)
        if name == "investment":
            return off
        return wide if name.endswith(("null", "marginal")) else wide[:4]
    if name == "arrival_split":
        return (presence.DEFAULTS.arrival_discount, presence.DEFAULTS.arrival_discount_cross)
    return getattr(presence.DEFAULTS, name)


def _params_for(name: str, value) -> presence.Params:
    """The parameter set for one grid point. `investment` is a COMPOSITE (shape, fee, stature).

    It has to be one grid point and not three, because the shape and the weights are not independent: with
    the weights at zero the two shapes are the same function, so sweeping the shape on its own reports
    "no effect" about a term that is switched off.
    """
    if name.startswith("investment"):
        shape, fee, stature, *rest = value
        return replace(presence.DEFAULTS, investment_shape=shape, fee_weight=fee,
                       stature_weight=stature,
                       value_weight=rest[0] if rest else 0.0,
                       shrink_weight=rest[1] if len(rest) > 1 else 0.0)
    if name == "arrival_split":
        # the two discounts move TOGETHER for the same reason: with the cross value equal to the intra one
        # they are the same function, and sweeping one alone would report "no effect" about a split that
        # is not in force.
        intra, cross = value
        return replace(presence.DEFAULTS, arrival_discount=intra, arrival_discount_cross=cross)
    return presence.DEFAULTS.with_value(name, value)


def sweep_platform(conn, platform: str, game: str, windows: list[str] | None,
                   ctx: Context | None = None) -> dict:
    """Every parameter, every window, on one platform. Returns the report block."""
    prepared: dict[str, features.WindowData] = {}
    for key, window in features.WINDOWS.items():
        if windows and key not in windows:
            continue
        data = features.prepare(conn, window, platform, game)
        if not evaluate._window_is_usable(data, platform):
            continue
        if window.input_season < FIRST_INSTRUMENTED:
            continue
        prepared[key] = data
    block: dict = {"platform": platform, "game": game, "windows": {}, "parameters": {}}
    facts: dict[str, tuple] = {}
    for key, data in prepared.items():
        inputs, note = build_inputs(conn, data, ctx)
        targets = build_targets(conn, data)
        facts[key] = (inputs, targets, data)
        base, base_n = baseline_mae(data, targets, inputs)
        here, here_n = mae(inputs, targets, presence.DEFAULTS, "appearances")
        block["windows"][key] = {
            **note,
            "label": data.window.label,
            "scored_appearances": here_n, "scored_starts": mae(
                inputs, targets, presence.DEFAULTS, "starts")[1],
            "mae_appearances_sheet": round(here, 4),
            "mae_appearances_engine": round(base, 4),
            "engine_scored": base_n,
        }
        thin_note = (f"  (thin: {note['clubs_under_90pct_parsed']} players at a club whose season is "
                     f"under 90% parsed)" if note["clubs_under_90pct_parsed"] else "")
        print(f"[sweep] {platform}/{game} {data.window.label}: {len(inputs)} players, "
              f"MAE(appearance share) sheet {here:.4f} vs engine {base:.4f}{thin_note}")

    for name, grid in GRIDS.items():
        target = TARGETS[name]
        current = BASELINES.get(name, _current(name))
        per_window: dict[str, dict[str, float]] = {}
        for key, (inputs, targets, _data) in facts.items():
            scores: dict[str, float] = {}
            for value in grid:
                score, count = mae(inputs, targets, _params_for(name, value), target)
                if count:
                    scores[_label(value)] = round(score, 5)
            if scores:
                per_window[key] = scores
        if not per_window:
            block["parameters"][name] = {"target": target, "verdict": "not measurable here"}
            continue
        block["parameters"][name] = {
            "target": target,
            **_cross_fit(per_window, [_label(value) for value in grid], _label(current)),
        }
    return block


# ---------------------------------------------------------------- the other two families
def _cross_fit(per_fold: dict[str, dict[str, float]], labels: list[str], current: str) -> dict:
    """The gate's protocol on any {fold: {value: error}} table: pick on the others, score on this one.

    Shared by the three families so the verdict means the same thing in all of them, and so the one place
    that could get the leave-one-out wrong is one place.
    """
    # A fold whose error does not move across the WHOLE grid contains no information about this parameter -
    # the feature it reads is absent there (the transfer fees only exist from 2023, so an older window
    # cannot see the investment term at all). The gate's own rule: such a window is reported as NOT
    # MEASURABLE, never as a failure, and counting its flat 0.0 as "no gain" would fail every hypothesis
    # mechanically on the strict verdict.
    uninformative = [fold for fold, scores in per_fold.items() if len(set(scores.values())) <= 1]
    per_fold = {fold: scores for fold, scores in per_fold.items() if fold not in uninformative}
    if not per_fold:
        return {"current": current, "grid": labels, "verdict": "not measurable on any fold",
                "folds_without_the_feature": uninformative}
    chosen: dict[str, str] = {}
    gains: dict[str, float] = {}
    for fold, mine in per_fold.items():
        others = [other for other in per_fold if other != fold]
        if not others:
            continue
        totals = {label: sum(per_fold[other][label] for other in others) for label in labels
                  if all(label in per_fold[other] for other in others)}
        if not totals:
            continue
        pick = min(totals, key=totals.get)
        chosen[fold] = pick
        gains[fold] = ((mine[current] - mine[pick]) / mine[current]) if mine.get(current) else 0.0
    pooled = {label: round(sum(fold[label] for fold in per_fold.values()) / len(per_fold), 5)
              for label in labels if all(label in fold for fold in per_fold.values())}
    # How much the value in use beats the best of the OTHERS, pooled. Positive = it is the best on the
    # pooled curve by that much. It exists so a CONFIRMATION carries a number too: once a value has been
    # adopted, "gain vs current" is 0.0 by construction, and a re-run must not read as no evidence.
    rivals = [error for label, error in pooled.items() if label != current]
    margin = ((min(rivals) - pooled[current]) / min(rivals)
              if rivals and current in pooled and min(rivals) else 0.0)
    return {
        "margin_over_runner_up": round(margin, 5),
        "folds_without_the_feature": uninformative,
        "current": current,
        "grid": labels,
        "error_per_fold": per_fold,
        "error_pooled": pooled,
        "best_pooled": min(pooled, key=pooled.get) if pooled else None,
        "cross_fit_choice": chosen,
        "gain_vs_current": {fold: round(value, 5) for fold, value in gains.items()},
        # A confirmation and a "nothing found" are not the same statement: the first means the held-out
        # pick WAS the value in the code, every time. Reported apart, because the sweep exists to say
        # which of the two happened.
        "confirmed": bool(chosen) and all(pick == current for pick in chosen.values()),
        **verdicts(gains),
    }


# The first run of these two picked the LOWER EDGE of the grid on every fold (decay 0.5, miss 0.3), which
# means the sweep had not located anything - it had only said "further down". The grids were extended
# downward and the run repeated, and that is declared here rather than presented as the first attempt: the
# protocol the gate protects is "the value is never chosen on the fold that scores it", which the
# leave-one-out does either way, but a grid changed after seeing a result has to be visible.
PENALTY_GRIDS: dict[str, tuple] = {
    "decay": (0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1.0),
    "miss_penalty": (0.0, 0.1, 0.2, 0.3, 0.5, 0.7, 0.85, 1.0),
}


def sweep_penalties(conn) -> dict:
    """The revealed penalty hierarchy, replayed penalty by penalty: who takes the NEXT one?

    A real out-of-sample question with a real sample - every penalty in the DB that had one before it at
    the same club - and it needs no window machinery: the hierarchy at the moment of a penalty is built
    only from the attempts that preceded it. `decay` says how fast an old penalty stops counting,
    `miss_penalty` how much a miss quarantines its taker.

    The error is 1 - top-1 accuracy: the share of penalties whose taker the hierarchy did NOT have first.
    The folds are seasons, so the value is chosen on the other seasons and scored on the held-out one.
    """
    from euroleghe_ingest.modules import fc_site

    events = fc_site.penalty_events(conn)
    history: dict[tuple[str, int], list[tuple[int, bool]]] = {}
    # one row per predictable penalty: (season, the attempts before it, who actually took it)
    trials: list[tuple[str, tuple[tuple[int, bool], ...], int]] = []
    for season, club_id, _date, fc_id, missed in events:
        key = (season, club_id)
        before = history.get(key)
        if before:
            trials.append((season, tuple(before), fc_id))
        history.setdefault(key, []).insert(0, (fc_id, missed))
    if not trials:
        return {"family": "penalties", "verdict": "no penalties in the DB"}
    seasons = sorted({season for season, _before, _taker in trials})
    block: dict = {"family": "penalties", "trials": len(trials), "folds": seasons, "parameters": {}}
    for name, grid in PENALTY_GRIDS.items():
        current = getattr(fc_site, "DECAY" if name == "decay" else "MISS_PENALTY")
        per_fold: dict[str, dict[str, float]] = {}
        for season in seasons:
            mine = [trial for trial in trials if trial[0] == season]
            for value in grid:
                kwargs = {name: value}
                hits = sum(1 for _season, before, taker in mine
                           if fc_site.rank_takers(list(before), **kwargs)[0][0] == taker)
                per_fold.setdefault(season, {})[_label(value)] = round(1.0 - hits / len(mine), 5)
        block["parameters"][name] = {"target": "next penalty taker (1 - top-1 accuracy)",
                                    **_cross_fit(per_fold, [_label(v) for v in grid], _label(current))}
    return block


TIER_GRIDS: dict[str, tuple] = {
    # WHICH percentile routes an arrival: the FM-equivalent he really produced in the league he came from,
    # or the pre-auction quotation. The operator's rule is «la quotazione quando non abbiamo altre risorse
    # oggettive», so `measured_first` is the shipped value - and it is scored against `price`, the old
    # behaviour, because a preference that no window has judged is not a decision.
    "tier_driver": ("measured_first", "price"),
    "t1_price": (0.70, 0.75, 0.80, 0.85, 0.90),
    "t3_price": (0.20, 0.30, 0.40, 0.50, 0.60),
    "full_history": (5, 10, 15, 20, 25),
    "u22_age": (19, 20, 21, 22, 23),
}


def sweep_arrival_tiers(conn, scoring: dict, platform: str) -> dict:
    """Where to cut the arrival tiers, judged by whether the cut separates OUTCOMES.

    Read the limit before the numbers: a tier does not predict anything by itself - it routes an arrival to
    an estimation path, and the rule that consumes it (R13c) is frozen for sample size. So what is measured
    here is the honest proxy: predict an arrival's realised fantamedia by the MEAN of his tier, with the
    means fitted on the OTHER seasons. A threshold that cuts where the outcome really changes wins; one
    that cuts a homogeneous population cannot.

    ...and it is scored on THE POPULATION THE TIER ACTUALLY ROUTES: the arrivals the core cannot price, i.e.
    no previous-season fantamedia on at least `MIN_PV_PREV` votes. That is the condition `predict_fm` itself
    uses before it ever looks at the arrival path. Scoring every arrival instead - which is what this did -
    let the verdict be decided by men whose tier is never consulted in production, and it showed: with the
    fantavalore inserted as the second choice, the price-driven arm crossed the adoption floor on `default`
    purely on intra-league movers, who have Serie A football behind them and are priced by the core.
    """
    from euroleghe_ingest.modules import arrivals

    seasons = [row[0] for row in conn.execute(
        "SELECT DISTINCT season FROM arrivals ORDER BY season")]
    rows: list[tuple[str, float | None, int, bool, float, float | None, float | None]] = []
    for season in seasons:
        # ...on THIS platform's listone, which is the pool the production tier is computed in
        percentiles = arrivals._price_percentiles(conn, season, platform)
        previous = conn.execute("SELECT MAX(season) FROM rosters WHERE season < ?",
                                (season,)).fetchone()[0]
        equivalents = arrivals.foreign_fm_equivalent(conn, scoring, previous) if previous else {}
        measured = arrivals.measured_percentiles(conn, season, equivalents)
        fvm = arrivals.fvm_percentiles(conn, previous, platform)
        actual = dict(conn.execute(
            "SELECT fc_id, fm FROM season_stats WHERE season = ? AND platform = ? AND fm IS NOT NULL",
            (season, platform)))
        # the men the core CAN price are not the tier's business: same condition as `evaluate.predict_fm`
        priced = {fc_id for fc_id, in conn.execute(
            "SELECT fc_id FROM season_stats WHERE season = ? AND platform = ? AND mv IS NOT NULL "
            "AND COALESCE(pv, 0) >= ?", (previous, platform, model.MIN_PV_PREV))} if previous else set()
        for fc_id, birth_year in conn.execute(
                "SELECT DISTINCT a.fc_id, p.birth_year FROM arrivals a JOIN players p USING(fc_id) "
                "WHERE a.season = ? AND a.platform = ?", (season, platform)):
            if fc_id not in actual:
                continue            # no outcome on this platform: nothing to score him against
            if fc_id in priced:
                continue            # the core prices him: his tier is never consulted
            _fm_equiv, matches = equivalents.get(fc_id, (None, 0))
            rows.append((season, percentiles.get(fc_id), matches,
                         int(season.split("-")[0]) - (birth_year or 0), actual[fc_id],
                         measured.get(fc_id), fvm.get(fc_id)))
    folds = sorted({season for season, *_rest in rows})
    if len(folds) < 2:
        return {"family": "arrival_tiers", "platform": platform, "verdict": "not enough seasons"}
    block: dict = {"family": "arrival_tiers", "platform": platform, "arrivals_scored": len(rows),
                   "folds": folds, "parameters": {}}
    for name, grid in TIER_GRIDS.items():
        current = {"t1_price": arrivals.T1_PRICE_PCT, "t3_price": arrivals.T3_PRICE_PCT,
                   "full_history": arrivals.FULL_HISTORY_MATCHES, "u22_age": arrivals.U22_AGE,
                   "tier_driver": arrivals.TIER_DRIVER}[name]
        per_fold: dict[str, dict[str, float]] = {}
        for value in grid:
            def tier_of(row, value=value, name=name) -> str:
                _season, percentile, matches, age, _fm, measured_pct, fvm_pct = row
                u22_age = value if name == "u22_age" else arrivals.U22_AGE
                cuts = {"t1_price": arrivals.T1_PRICE_PCT, "t3_price": arrivals.T3_PRICE_PCT,
                        "full_history": arrivals.FULL_HISTORY_MATCHES}
                if name in cuts:
                    cuts[name] = value
                return arrivals.classify_tier(
                    percentile, matches, age <= u22_age,
                    cuts["t1_price"], cuts["t3_price"], cuts["full_history"],
                    measured_percentile=measured_pct, fvm_percentile=fvm_pct,
                    driver=value if name == "tier_driver" else arrivals.TIER_DRIVER)
            grouped: dict[str, dict[str, list[float]]] = {}
            for row in rows:
                grouped.setdefault(row[0], {}).setdefault(tier_of(row), []).append(row[4])
            for fold in folds:
                # the tier means come from the OTHER seasons, so the fold never scores itself
                pool: dict[str, list[float]] = {}
                for season, tiers in grouped.items():
                    if season == fold:
                        continue
                    for tier, values in tiers.items():
                        pool.setdefault(tier, []).extend(values)
                means = {tier: sum(values) / len(values) for tier, values in pool.items() if values}
                overall = (sum(sum(values) for values in pool.values())
                           / sum(len(values) for values in pool.values())) if pool else 0.0
                errors = [abs(means.get(tier, overall) - fm)
                          for tier, values in grouped.get(fold, {}).items() for fm in values]
                if errors:
                    per_fold.setdefault(fold, {})[_label(value)] = round(
                        sum(errors) / len(errors), 5)
        block["parameters"][name] = {"target": "the arrival's realised fantamedia, by tier mean",
                                    **_cross_fit(per_fold, [_label(v) for v in grid], _label(current))}
    return block


def run(ctx: Context, platforms: list[str] | None = None, games: list[str] | None = None,
        windows: list[str] | None = None, report: bool = True, **_kwargs) -> None:
    conn = ctx.require_conn()
    out = {"generated_at": dt.datetime.now(tz=dt.UTC).isoformat(timespec="seconds"),
           "defaults": {key: _label(value) for key, value in asdict(presence.DEFAULTS).items()},
           "floor": FLOOR, "worst_allowed": WORST_ALLOWED,
           "grids": {name: [_label(value) for value in grid] for name, grid in GRIDS.items()},
           "targets": TARGETS, "penalty_grids": {name: [_label(v) for v in grid]
                                                 for name, grid in PENALTY_GRIDS.items()},
           "tier_grids": {name: [_label(v) for v in grid] for name, grid in TIER_GRIDS.items()},
           "blocks": []}
    for platform in (platforms or ["euro", "default"]):
        for game in (games or ["classic"]):
            out["blocks"].append(sweep_platform(conn, platform, game, windows, ctx))
    # The other two families of 7-bis. Neither has windows: the penalty hierarchy is replayed penalty by
    # penalty and the tiers are judged season by season, so their folds are seasons.
    out["blocks"].append(sweep_penalties(conn))
    for platform in (platforms or ["euro", "default"]):
        out["blocks"].append(sweep_arrival_tiers(conn, ctx.config.load_scoring(), platform))

    print()
    for block in out["blocks"]:
        if block.get("family") == "penalties":
            print(f"=== penalty hierarchy: {block.get('trials', 0)} predictable penalties, "
                  f"{len(block.get('folds', []))} seasons")
        elif block.get("family") == "arrival_tiers":
            print(f"=== arrival tiers ({block['platform']}): {block.get('arrivals_scored', 0)} "
                  f"arrivals with an outcome, {len(block.get('folds', []))} seasons")
        else:
            print(f"=== presence, {block['platform']}/{block['game']}: "
                  f"{len(block['windows'])} windows ({', '.join(block['windows'])})")
        for name, result in block.get("parameters", {}).items():
            if "strict" not in result:
                # no verdict to print: the grid did not move a single fold's error, so no fold carries
                # information about this parameter (the guard is `strict`, not `current` - a
                # not-measurable result still says which value is in use)
                print(f"  {name:20} current {result.get('current')!s:>12} · {result.get('verdict')}"
                      f" ({len(result.get('folds_without_the_feature') or [])} folds without the feature)")
                continue
            print(f"  {name:20} current {result['current']:>12} · "
                  f"best pooled {result['best_pooled']:>12} · "
                  f"margin over the runner-up {result['margin_over_runner_up']:+.2%} · "
                  f"mean gain {result['mean_gain']:+.2%} · worst {result['worst']:+.2%} · "
                  f"strict {'PASS' if result['strict'] else 'no':4} "
                  f"robust {'PASS' if result['robust'] else 'no':4} "
                  f"{'CONFIRMED (held-out pick = the value in the code)' if result['confirmed'] else ''}")
            print(f"  {'':20} picks: "
                  f"{', '.join(f'{key}->{value}' for key, value in result['cross_fit_choice'].items())}")
    if report:
        path = ctx.config.data_dir / "reports" / "sweep_presence.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(out, indent=1), encoding="utf-8")
        print(f"\n[sweep] report -> {path}")
