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
#
# 75, HIS DECISION OF 03/09/2026 (evening), arrived at in two steps because he judged twice - first
# three matches («ATALANTA vs CAGLIARI e' facile per l'Atalanta ... COMO vs GENOA ... ATALANTE vs
# LECCE», which took it from 200 to 100: two of the three were ALREADY easy at 200, so his list
# constrained one match at +104.2), then TWELVE matches dotted on two boards of the auction plancia,
# which took it to 75 together with the field term below. 11 of those 12 clear this margin; the one
# that does not is Udinese-Cagliari, the lowest he drew.
#
# What moving it costs and buys, held out on the label itself over the same 5354 club-matches (below):
#
#            P(cs) at it   classified easy   cs | easy   cs | rest   lift
#     200         0.401              13.0%       0.427      0.239    1.79
#     100         0.319              28.9%       0.399      0.208    1.92
#      75         0.300              33.8%       0.387      0.200    1.93
#
# So the SEPARATION does not decay - it is flat between 50 and 250 and reads marginally better at the
# low end - and what changes is what the word promises: an easy match keeps a clean sheet 39.5% of the
# time instead of 42.7%. That is why this is a CHOICE and not a fit: the label is worth having at both
# values, and which sentence «facile» stands for is his to declare.
#
# HIS OTHER RULE, the one 200 was frozen on, still holds at 75 - once the field term is the one this
# question was measured on. «The strongest club must stop reading all of them»: with the half-gap at 35
# NO Serie A club reads its whole season as easy at this margin (against one at 14.5), because a bigger
# home advantage makes an away trip HARDER and a top club's away matches are exactly what its 38/38 was
# made of. So the two halves of his request pull the same way instead of against each other, which is
# not something anybody argued - it is what the count says (serie_a 0 · premier 0 · liga 0 · bundes 1 ·
# ligue_1 1: Bayern and PSG, in championships he does not play).
#
# The count still SATURATES at every threshold - that is a property of a count and not of the value
# (§23.3) - and it saturates DOWNWARD on a short window, which is what he was looking at: over rounds
# 3-5 the club x club grid read 136 cells of 190 at zero, and at 75 it reads 36. On a window that short
# the count carries FOUR possible values for 190 cells at any threshold, while the continuous column
# carries 63 - so on a three-matchday competition the tie-break is not a refinement, it is the column. The continuous margin
# travels beside it for the same reason as before: Bayern's +344 says what «34/34» could not.
EASY_MARGIN = 75.0
TRIM_MIN_SAMPLE = 5        # operator's general rule, 10/08/2026: a mean used to JUDGE something drops
                           # its highest and lowest value, provided there are at least five of them -
                           # below that, dropping two of four is not a mean any more. It applies to
                           # descriptive numbers like this one; a mean that feeds a PREDICTION changes
                           # only through the gate (measured: as a predictor the trim is worth
                           # -0.0012 +/- 0.0077, indistinguishable from zero).
# THE HOME-AWAY GAP, applied SYMMETRICALLY: +gap/2 at home, -gap/2 away. The operator asked for an away
# malus on 10/08/2026 and the malus was already there implicitly - not getting the home bonus IS the
# malus - so making it a separate term would have doubled the gap with nobody deciding it. Symmetric
# changes nothing about the gap and makes an away trip PAY instead of being the neutral case.
#
# WHICH GAP, THOUGH, IS A QUESTION ABOUT THE QUESTION - and the answer changed on 03/09/2026 (evening).
# 29 is measured on the RESULT (1140 Serie A matches of 23-24..25-26, home score share 0.5412 over 2657
# matches and seven seasons; per-season standard error +-18, so a constant with a date and not an annual
# series) and it is kept here because it is where this module started - but NOBODY IN THIS MODULE ASKS
# THAT QUESTION any more. Every reader of `edge()` asks «how easy is this match», and since 03/09 this
# project's own definition of easy is «he is likely not to concede», for which the same day measured a
# half-gap of 30-35 out of sample (log-loss 0.57796 at 35 against 0.57839 at 14.5 and 0.57936 with no
# field effect at all, interior optimum, 2320 held-out matches). That measurement was RECORDED AND NOT
# ADOPTED, on the argument that two field constants in one module is how a screen ends up with two
# answers to «is this match at home» - and it is adopted now because there are not two questions here,
# there is one, and 14.5 was the answer to the other one.
#
# WHAT MOVED IT IS THE OPERATOR'S OWN READING, and it is worth writing down how: he dotted the matches
# he considers easy on two boards of the plancia, and ALL TWELVE OF THEM ARE HOME MATCHES. Nobody asked
# him about the field; a regularity that strong in a judgement about football is evidence about the
# model, and it pointed at the one number this module had measured and left on the bench. It also pays
# at both ends - the label separates a shade better at every threshold (lift 1.93 against 1.91 at 75)
# and the away side of a top club gets harder, which is what keeps his rule of 10/08 alive at a lower
# margin. A CHANGE OF INPUT NEEDS THE TRANSFORM RE-FITTED: the logistic below was re-fitted on the edge
# this gap produces (same 5354 club-matches, same shape), because a transform belongs to the input it
# was fitted on as much as to its population.
RESULT_HOME_AWAY_GAP = 29.0              # measured on the RESULT - provenance, no reader in this module
HOME_AWAY_GAP = 70.0                     # measured on the CLEAN SHEET, which is what «facile» means here
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
# both clubs' level from `club_levels`). Logistic on the SAME edge `easy_matches` computes - re-fitted
# on 03/09/2026 (evening) when `HOME_ADVANTAGE` moved to the value measured on THIS question:
#
#     edge  -200 -> 0.141      edge   +75 -> 0.300      edge  +300 -> 0.484
#     edge     0 -> 0.248      edge  +100 -> 0.319      edge  +400 -> 0.571
#                              edge  +200 -> 0.399
#
# The 40% level is reached at an edge of 202 (199 before the field term was re-measured, and the two
# agreeing to three points is what a re-fit on a wider field term looks like), which for one day was
# also the value of `EASY_MARGIN`:
# two numbers measured on unrelated criteria a month apart landing on each other - the threshold the
# operator had chosen by eye and `club_defence.CLEAN_SHEET_SHARE` = 0.40, itself measured as the quota
# at which «una porta resta inviolata spesso». THAT AGREEMENT IS OVER, by his decision of the same
# evening: `EASY_MARGIN` is 100 and P(clean sheet) there is 0.320, so «facile» on this board no longer
# claims that a clean sheet is the more likely outcome - it claims an easy match, and the two clubs'
# own probabilities travel beside the count for whoever needs the stronger sentence. The 40% level is
# an invariant of the CURVE and is asserted as one; the threshold is a declaration and is asserted as
# the value it is, so nobody reads 0.40 off a board built at 0.32.
# Held out on the label itself: at 200 matches classified easy kept a clean sheet 42.7% of the time
# against 23.9%, at 100 39.9% against 20.8%, and at the adopted 75 it is 38.7% against 20.0% - the lift
# goes 1.79 -> 1.92 -> 1.93, i.e. the separation does NOT decay as the label widens, which is what makes
# the choice of threshold a declaration rather than a fit. Calibration by decile of predicted
# probability is within 0.03 everywhere except the top tenth, which the model OVER-states (0.475
# predicted against 0.432 realised) - stated because that is the decile the auction board's best
# pairings are made of.
#
# ADOPTED 03/09/2026 (evening), and it stood here refused for one day: for a CLEAN SHEET the home
# advantage fits at a half-gap of
# 30-35 Elo points and not at the 14.5 this module uses, which was fitted on the RESULT (log-loss of
# the actual outcome, `HOME_AWAY_GAP` above). Held-out log-loss over 2320 matches: 0.57796 at H=35
# against 0.57839 at H=14.5 and 0.57936 with no field effect at all - an interior optimum, so the
# DIRECTION is identified (keeping a clean sheet is a more home-dependent thing than winning), and it
# moves 3% of the classifications and 0.0004 of log-loss. That is not worth a SECOND home constant in a
# module whose whole output is reporting: two constants for one venue is how a screen ends up with two
# answers to «is this match at home». Recorded here so nobody re-measures it, and so that whoever wants
# it has the number.
CLEAN_SHEET_INTERCEPT = -1.107526
CLEAN_SHEET_SLOPE_PER_100 = 0.348021

# ---------------------------------------------------------------------------------------------------
# ...AND THE GOALS, WHICH THE ELO DOES NOT CARRY (03/09/2026, evening, the operator's request):
# «oltre all'elo valutassi anche la media gol dell'attacco e i gol subiti in media della difesa ...
# potresti prendere le ultime 5 o 10 partite di ogni squadra». His mechanism, stated in his own words
# and it is the right one: «una squadra forte non e' detto che segni tanto, e una squadra debole non e'
# detto che segni poco» - the Elo is a rating of RESULTS, so it cannot separate a side that wins 3-2
# from one that wins 1-0, and a clean sheet is exactly that difference.
#
# MEASURED, and it passes: log-loss leave-one-season-out over 4940 club-matches and 8 seasons,
# 0.54749 (Elo alone) -> 0.54282, better in 7 of the 8 seasons. On the label at his own threshold the
# lift goes 1.95 -> 2.01 and 9% of the matches change side. What the coefficients say, at a level
# match: an opponent scoring 0.8 a game against one scoring 2.0 moves the probability from 0.289 to
# 0.199 - nine points, from the same Elo.
#
# THREE THINGS THE MEASUREMENT SETTLED AGAINST THE WAY THE REQUEST WAS WORDED, and they are the reason
# it is worth writing down rather than just switching on:
#   · THE WINDOW IS TEN AND NOT FIVE. A five-match mean is mostly noise: held out, 5 is worth -0.0024
#     against -0.0044 for 10, and the curve is FLAT from 10 to 38 (-0.0044 · -0.0047 · -0.0050), with
#     its nominal minimum at the edge of the grid - which this project does not adopt, and which here
#     would mean «the whole season», i.e. not form at all. Ten is also the window this project already
#     calls a club's recent form.
#   · THE VENUE SPLIT DOES NOT PAY. «media gol casa/fuori» reads -0.0021 against -0.0035 for the plain
#     ten over the same rows: five home matches is half the sample for a term the edge already carries.
#   · THE TWO HALVES ARE NOT WORTH THE SAME. His opponent's attack is worth -0.0030 alone; his own
#     defence -0.0005, which is nearly nothing (5 seasons of 8). Both are kept because together they
#     are -0.0047 and 7/8, but the sentence to remember is «what decides a clean sheet is mostly who
#     you are playing against».
#
# AND THE FIRST MEASUREMENT OF THIS WAS WRONG IN MY OWN HANDS, which is why the numbers above are the
# second set: walking the club-matches in date order while appending each result to the club's history
# leaks the match into its own predictor, because the TWO ROWS OF ONE MATCH SHARE A DATE. It read four
# times the gain and «the shorter the window the better», monotonically to the edge of the grid - and
# that monotonicity is the tell this project already writes down. The history is now built in full
# first, and each row reads only matches with a date STRICTLY BEFORE its own.
CLEAN_SHEET_FORM_INTERCEPT = -0.140474
CLEAN_SHEET_FORM_PER_100 = 0.278270
CLEAN_SHEET_FORM_CONCEDED = -0.319126     # MY goals conceded per match over the last FORM_MATCHES
CLEAN_SHEET_FORM_SCORED = -0.410066       # THEIR goals scored per match over the same window
CLEAN_SHEET_FORM_SAMPLE = 4940
FORM_MATCHES = 10
# How far back the ten may reach. Fifteen months = the previous season plus the current one, so a
# promoted club has no form instead of a form from the last time it was here.
FORM_HORIZON_DAYS = 450
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


def clean_sheet_probability(club_edge: float, *, conceded: float | None = None,
                            scored: float | None = None) -> float:
    """P(this club concedes nothing in this match). Serie A only - see above.

    TWO MODELS AND ONE FUNCTION, because a caller must not have to know which is available: with the
    two clubs' recent goals it uses the form model (the operator's channel, measured), without them the
    edge alone. A promoted club has no Serie A matches behind it, so its form does not exist - «vuoto =
    ignoto, mai zero», and inventing a 1.35 for it would price a side nobody has seen here.

    The two agree BY CONSTRUCTION at the threshold: `EASY_PROBABILITY` is defined as this function's
    answer at `EASY_MARGIN` on the edge-only model, so a club with no form is labelled exactly as it
    was before the goals entered - no discontinuity between the men who have a form and those who do
    not, which is what would otherwise show up as a club changing colour for having been promoted.
    """
    import math
    if conceded is None or scored is None:
        z = CLEAN_SHEET_INTERCEPT + CLEAN_SHEET_SLOPE_PER_100 * club_edge / 100.0
    else:
        z = (CLEAN_SHEET_FORM_INTERCEPT
             + CLEAN_SHEET_FORM_PER_100 * club_edge / 100.0
             + CLEAN_SHEET_FORM_CONCEDED * conceded
             + CLEAN_SHEET_FORM_SCORED * scored)
    return 1.0 / (1.0 + math.exp(-z))


# THE LABEL'S THRESHOLD, IN THE UNIT THE LABEL IS NOW DECIDED IN. His 75 of Elo edge, read through the
# edge-only model, is P = 0.3002 - so the threshold moves onto the PROBABILITY and his decision travels
# with it unchanged. It has to: with three predictors an edge threshold could no longer express «facile»
# (two matches at the same edge are not the same match any more), and keeping both would be two answers
# to one question. Outside the leagues the logistic was fitted on there is no probability at all, and
# there the count still uses `EASY_MARGIN` on the edge - stated, and it is the same «a fitted transform
# belongs to its population» that leaves `cs_home`/`cs_away` empty there.
EASY_PROBABILITY = 0.3002


def recent_goals(conn, *, before: str | None = None, league: str = "serie_a",
                 matches: int = FORM_MATCHES,
                 horizon_days: int = FORM_HORIZON_DAYS) -> dict[str, tuple[float, float, int]]:
    """{club_key: (goals conceded per match, goals scored per match, matches read)}, last `matches`.

    THE UNIT IS THE MATCH AND THE WINDOW WALKS DATES, never matchdays: a postponed round is played
    weeks after the one that follows it, so «the last ten» ordered by round is not the last ten.

    Goals conceded come from the votes' own `role='P'` rows and goals scored from `goals + pen_scored`
    (the `goals` column is net of penalties and own goals), so neither passes through the identity
    funnel - «a club-level fact must not be counted on its members». A club with fewer than `matches`
    behind it is NOT returned: a mean over three games is not the quantity the coefficients were fitted
    on, and the caller's own fallback is the edge-only model.

    AND THE TEN MATCHES HAVE A HORIZON, which is the same rule read from the time side: a promoted
    club's last ten Serie A matches are TWO SEASONS OLD (Frosinone read 0.90/0.90 off 2023-24), and a
    reading that old is not a reading of today - «vuoto = ignoto» applies to a stale window exactly as
    it applies to an empty one. Fifteen months covers the previous season and the current one, so in
    September a promoted side has two matches, no form, and the edge-only model - which is the honest
    answer about a side nobody has seen in this championship.
    """
    # TWO QUERIES AND THE JOIN IN PYTHON, because the key is a club IDENTITY and that resolver is a
    # Python alias table (`matching.club_identity`). The first version joined the two layers on
    # (season, matchday) alone - no club at all - so every club-match matched every OTHER club of that
    # round and all twenty clubs read the same (1.8, 1.4). Found by printing five clubs and seeing
    # identical rows: «identical lines are not a result, they are a broken instrument».
    goals: dict[tuple[str, int, str], tuple[float, float]] = {}
    for season, matchday, team, conceded, scored in conn.execute(
            """SELECT season, matchday, team,
                      MAX(CASE WHEN role = 'P' THEN goals_conceded END),
                      SUM(COALESCE(goals, 0)) + SUM(COALESCE(pen_scored, 0))
                 FROM match_ratings WHERE platform = 'default'
                GROUP BY season, matchday, team"""):
        if conceded is None or team is None:
            continue
        goals[(season, int(matchday), matching.club_identity(team))] = (float(conceded),
                                                                       float(scored or 0))

    history: dict[str, list[tuple[str, float, float]]] = {}
    floor = None
    if horizon_days:
        anchor = dt.date.fromisoformat(before) if before else dt.date.today()
        floor = (anchor - dt.timedelta(days=horizon_days)).isoformat()
    for season, real_md, club, date in conn.execute(
            """SELECT DISTINCT season, real_md, club, match_date FROM external_match_stats
                WHERE competition = ? AND real_md IS NOT NULL AND club IS NOT NULL
                  AND match_date IS NOT NULL""", (league,)):
        if before and date >= before:
            continue
        if floor and date < floor:
            continue
        key = matching.club_identity(club)
        played = goals.get((season, int(real_md), key))
        if played:
            history.setdefault(key, []).append((date, played[0], played[1]))

    out: dict[str, tuple[float, float, int]] = {}
    for key, played in history.items():
        # By DATE and not by the order the rows came back: the window is «the last ten matches», and a
        # postponed round is played weeks after the one that follows it.
        window = sorted(played)[-matches:]
        if len(window) < matches:
            continue
        out[key] = (sum(one[1] for one in window) / len(window),
                    sum(one[2] for one in window) / len(window),
                    len(window))
    return out


def _elo_year(season: str) -> str:
    """The Elo snapshot a season is judged on: the year it kicks off in."""
    return season.split("-")[0]


def easy_matches(conn, season: str, club_key: str, *, league: str | None = None,
                 since: str | None = None, until: str | None = None,
                 margin: float = EASY_MARGIN, home_bonus: float = HOME_ADVANTAGE,
                 form: dict[str, tuple[float, float, int]] | None = None,
                 probability: float = EASY_PROBABILITY) -> dict:
    """How many of a club's remaining matches are EASY, and by how much on average.

    Two numbers from one measurement, because the count saturates and the mean does not: at +100 seven
    to nine Serie A clubs of twenty read 0/8 or 8/8 over an eight-round window, and for them the count
    carries no calendar information at all (§23.3). The mean signed margin keeps it.

    `n` counts the matches it could CLASSIFY - both clubs' Elo known - and `unclassified` says how many
    it could not, because a percentage over half a calendar is a different quantity (§22.3). Outside
    Serie A the opponents of a perimeter club are largely outside the perimeter, so this is not a
    detail: it is the coverage the cell has to declare.

    `form` (from `recent_goals`) switches the verdict onto the PROBABILITY, which is where it lives
    since the goals entered the model: with it a match is easy when P(clean sheet) clears
    `probability`, without it when the edge clears `margin` - and the two coincide by construction for
    a club whose form we cannot read. The caller passes it because it is ONE query for every club and
    this function is called once per club; and it is a fact about TODAY, not about the day of each
    fixture, since nobody knows the form of May.
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
        mine_form = (form or {}).get(club_key)
        their_form = (form or {}).get(away_key if at_home else home_key)
        if mine_form and their_form:
            if clean_sheet_probability(gap, conceded=mine_form[0],
                                       scored=their_form[1]) > probability:
                easy += 1
        elif gap > margin:
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

    SINCE 03/09/2026 THE PROBABILITY ALSO READS THE GOALS of the last ten matches of both clubs, which
    is the channel the operator asked for and the measurement kept. Two consequences the file has to
    declare rather than leave to be discovered. The form is read ONCE, as of today, and applied to every
    future fixture - for the next round that is exactly right and for the 38th it is the only thing
    anybody has, so the file says the day it was read. And a club without ten Serie A matches behind it
    (a promoted side, in September a side with two) is priced by the edge alone, which at the threshold
    is the same verdict as before: the two models are pinned together at `EASY_PROBABILITY`.
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
    # The form is «as of today», and the day is written into the artefact: a dated reading whose date
    # nobody stores is a reading that cannot be told from a stale one.
    today = dt.date.today().isoformat()

    out: dict[str, dict] = {}
    for league in leagues:
        rows = conn.execute(
            "SELECT round, date, home_key, away_key FROM fixtures "
            "WHERE season = ? AND league = ? AND played = 0 AND round IS NOT NULL "
            "ORDER BY round, date", (season, league)).fetchall()
        if not rows:
            continue
        rated = league in CLEAN_SHEET_LEAGUES
        form = recent_goals(conn, before=today, league=league) if rated else {}
        matches: list[list] = []
        unclassified = 0
        with_form = 0
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
            home_form, away_form = form.get(home), form.get(away)
            both = bool(home_form and away_form)
            matches.append([
                rnd, date, home, away, round(gap, 1),
                round(clean_sheet_probability(
                    gap,
                    conceded=home_form[0] if both else None,
                    scored=away_form[1] if both else None), 4) if rated else None,
                round(clean_sheet_probability(
                    -gap,
                    conceded=away_form[0] if both else None,
                    scored=home_form[1] if both else None), 4) if rated else None,
            ])
            if rated and both:
                with_form += 1
        out[league] = {
            "rounds": max(int(row[0]) for row in rows),
            "unclassified": unclassified,
            # Whether the two probability columns carry anything, and WHY when they do not: a reader
            # that finds them empty must know it is a population limit and not a missing run.
            "clean_sheet_fitted": rated,
            # ...and how many of them read the GOALS as well as the Elo. A count and not a flag,
            # because in September some clubs have ten Serie A matches behind them and some do not.
            "with_form": with_form,
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
        # THE THRESHOLD THE LABEL IS DECIDED BY, where the probability exists: his 75 of edge read
        # through the edge-only model. The app must use THIS against `cs_home`/`cs_away` and fall back
        # to `easy_margin` on the edge only where the probability is null, or two matches with the same
        # edge and different opponents would read the same - which is the whole point of the goals.
        "easy_probability": EASY_PROBABILITY,
        "home_advantage": HOME_ADVANTAGE,
        "clean_sheet": {
            "intercept": CLEAN_SHEET_INTERCEPT,
            "slope_per_100": CLEAN_SHEET_SLOPE_PER_100,
            "sample": CLEAN_SHEET_SAMPLE,
            "leagues": sorted(CLEAN_SHEET_LEAGUES),
            "at_margin": round(clean_sheet_probability(EASY_MARGIN), 4),
            "_note": "P(the club concedes nothing). Two models, one threshold: with the last "
                     f"{FORM_MATCHES} matches of both clubs it reads the goals as well as the Elo "
                     "(the operator's channel, 03/09/2026: log-loss 0.54749 -> 0.54282 held out, 7 "
                     "seasons of 8), without them the edge alone - and the two agree at the "
                     "threshold by construction. Fitted on Serie A only: the other championships "
                     "have no goals-conceded layer here, so nothing was fitted there and nothing is "
                     "claimed.",
            "form": {
                "matches": FORM_MATCHES,
                "read_on": today,
                "intercept": CLEAN_SHEET_FORM_INTERCEPT,
                "per_100": CLEAN_SHEET_FORM_PER_100,
                "conceded": CLEAN_SHEET_FORM_CONCEDED,
                "scored": CLEAN_SHEET_FORM_SCORED,
                "sample": CLEAN_SHEET_FORM_SAMPLE,
            },
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
