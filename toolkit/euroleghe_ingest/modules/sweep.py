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
    # ...and the same hypothesis in its SHARPER form, as a composite: the two weights alone are swept on the
    # "standing" shape, where a lift is added to everybody, but the claim is really about the man whose
    # season was played somewhere else - the signing the club has just paid for. `investment_shape="arrival"`
    # is that version (the investment closes part of what the arrival discount took away, and does nothing
    # to a man whose whole season is already here), and it cannot be tested by moving the shape alone,
    # because with both weights at zero the two shapes ARE the same function. Hence the pairs.
    "investment": (("standing", 0.0, 0.0),
                   ("arrival", 0.1, 0.0), ("arrival", 0.2, 0.0), ("arrival", 0.3, 0.0),
                   ("arrival", 0.5, 0.0), ("arrival", 0.0, 0.1), ("arrival", 0.0, 0.2),
                   ("arrival", 0.2, 0.2)),
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


def build_inputs(conn, data: features.WindowData) -> tuple[dict[int, presence.Inputs], dict]:
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
            fee_share=(spend.get(obs.fc_id) or {}).get("fee_share"),
            stature=(spend.get(obs.fc_id) or {}).get("stature"),
            value_share=(spend.get(obs.fc_id) or {}).get("value_share"),
        )
    note = {"players": len(out), "of_observations": len(data.observations),
            "clubs_under_90pct_parsed": thin}
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
        return f"{value[0]}:{value[1]:g}/{value[2]:g}"        # the composite: shape, fee, stature
    return "/".join(f"{part:g}" for part in value) if isinstance(value, tuple) else f"{value}"


def _params_for(name: str, value) -> presence.Params:
    """The parameter set for one grid point. `investment` is a COMPOSITE (shape, fee, stature).

    It has to be one grid point and not three, because the shape and the weights are not independent: with
    the weights at zero the two shapes are the same function, so sweeping the shape on its own reports
    "no effect" about a term that is switched off.
    """
    if name == "investment":
        shape, fee, stature = value
        return replace(presence.DEFAULTS, investment_shape=shape,
                       fee_weight=fee, stature_weight=stature)
    return presence.DEFAULTS.with_value(name, value)


def sweep_platform(conn, platform: str, game: str, windows: list[str] | None) -> dict:
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
        inputs, note = build_inputs(conn, data)
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
        # the composite has no field of its own: its "current" is the shape and the two weights in use
        current = ((presence.DEFAULTS.investment_shape, presence.DEFAULTS.fee_weight,
                    presence.DEFAULTS.stature_weight) if name == "investment"
                   else getattr(presence.DEFAULTS, name))
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
    """
    from euroleghe_ingest.modules import arrivals

    seasons = [row[0] for row in conn.execute(
        "SELECT DISTINCT season FROM arrivals ORDER BY season")]
    rows: list[tuple[str, float | None, int, bool, float, float | None]] = []
    for season in seasons:
        percentiles = arrivals._price_percentiles(conn, season)
        previous = conn.execute("SELECT MAX(season) FROM rosters WHERE season < ?",
                                (season,)).fetchone()[0]
        equivalents = arrivals.foreign_fm_equivalent(conn, scoring, previous) if previous else {}
        measured = arrivals.measured_percentiles(conn, season, equivalents)
        actual = dict(conn.execute(
            "SELECT fc_id, fm FROM season_stats WHERE season = ? AND platform = ? AND fm IS NOT NULL",
            (season, platform)))
        for fc_id, birth_year in conn.execute(
                "SELECT a.fc_id, p.birth_year FROM arrivals a JOIN players p USING(fc_id) "
                "WHERE a.season = ?", (season,)):
            if fc_id not in actual:
                continue            # no outcome on this platform: nothing to score him against
            _fm_equiv, matches = equivalents.get(fc_id, (None, 0))
            rows.append((season, percentiles.get(fc_id), matches,
                         int(season.split("-")[0]) - (birth_year or 0), actual[fc_id],
                         measured.get(fc_id)))
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
                _season, percentile, matches, age, _fm, measured_pct = row
                u22_age = value if name == "u22_age" else arrivals.U22_AGE
                cuts = {"t1_price": arrivals.T1_PRICE_PCT, "t3_price": arrivals.T3_PRICE_PCT,
                        "full_history": arrivals.FULL_HISTORY_MATCHES}
                if name in cuts:
                    cuts[name] = value
                return arrivals.classify_tier(
                    percentile, matches, age <= u22_age,
                    cuts["t1_price"], cuts["t3_price"], cuts["full_history"],
                    measured_percentile=measured_pct,
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
            out["blocks"].append(sweep_platform(conn, platform, game, windows))
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
