"""abroad - the newcomer's last senior season, and the screen that says «look at this one».

WHO THIS IS FOR. Every August a third of the Serie A listone has no Serie A behind it: measured on the
2026-27 sheet, **188 of 531 quoted men** have not a single vote of the season that just ended. The engine
prices them off a role anchor and `est_pv` reads the «nobody has ever seen him play» constant, so on the
auction lists they are sorted by a number that is the same for all of them. This module does not price
them - it says which of them are worth a second look, and with which numbers.

THE OPERATOR'S QUESTION, 10/09/2026: «i calciatori nuovi che potenzialmente potrebbero fare molto bene ...
nelle ultime 15 o 20 partite una media voto molto alta giocando con costanza, o molti bonus (gol+assist)».
Both halves are real and they belong to DIFFERENT populations, which is the whole design here.

WHAT WAS MEASURED, and it is the reason there are two arms (7 seasons, 803 man-seasons of men quoted in
Serie A with no Serie A the year before and 900+ minutes on file; outcome «esploso» = 20+ appearances AND
a fantamedia of 6.0+; every signal ranked INSIDE role and season, so the null is the pool the operator
actually chooses from):

                            covered leagues (n=155)      not covered (n=648)
                            base 36.8%                   base 23.6%
      share of calendar     52.0%  -> 1.41x              30.2%  -> 1.28x
      goals+assists /90     38.0%  -> 1.03x              32.0%  -> 1.35x
      synthetic vote        50.0%  -> 1.36x              (does not exist there)
      Qt.I alone            52.0%  -> 1.41x              35.6%  -> 1.51x

So: from the five leagues we cover, what carries is HOW MUCH HE PLAYED and the bonuses carry nothing
(1.03x, and 0.70x among the cheap - i.e. actively misleading exactly where one goes looking for a
bargain); from a league we do not cover it is the other way round and the BONUSES carry (1.35x). The
mechanism is readable: inside the big five the league itself says the level, so what distinguishes two
men is whether they played; outside, the level is unknown and the bonuses are the only thing that says
«he is good» - which is also why they pay less than they seem to, being confounded with a weak league.

THREE THINGS THIS IS NOT.
* It is NOT a valuation. Nothing here enters `engine_*`, no gate owns it, and the sheet's own numbers are
  untouched - the same standing as the injury marks. Adopting any of it as an input would need a
  pre-registration and a run on the bench.
* It does NOT beat the market. The Qt.I alone reads 1.41x and 1.51x, i.e. as well or better than anything
  we have. What it adds is that these men are today ordered by a CONSTANT: measured on the live sheet,
  `r(share played abroad, est_pv)` is **+0.053** and **+0.069**. The sheet is blind to the fact, not
  wrong about it.
* The thresholds here were chosen on the same seasons that score them (the leave-one-season-out for the
  two adopted signals holds - 1.47x and 1.33x - but the POOL cut and the floors did not get one). Said
  rather than smoothed over.

THREE TRAPS, all of them measured rather than imagined.
* GOALKEEPERS are out. Their role's own p90 of goals+assists per 90 is 0.03, so a keeper with one assist
  in a season clears it, and the screen would fire on three of them.
* YOUTH football is out, and it is not a hand-written list: `tm_appearances` carries 1,086 competition
  codes and among them is the Primavera (median birth year 2006), where 38 matches and 14 goals are not a
  senior season. Derived from the median AGE of whoever plays a competition, so a new youth league
  excludes itself.
* The LEVEL of the league is not read at all, and that is a refusal and not an omission: over the three
  non-covered leagues that have a measured offset the link between level and shift is INVERTED, and using
  a rate from a weak league as if it were a strong one is exactly what makes the bonus arm pay 1.35x
  instead of more. The mark therefore says «look», never «he is worth this much».
"""

from __future__ import annotations

# A rate over less than a season's worth of football is not a rate. 900 minutes = ten full matches, the
# same floor the measurement above was taken with.
MIN_MINUTES = 900
# The window the operator asked for. Twenty and not ten because that is the question he put («le ultime
# 15 o 20 partite»), and because ten matches of a 34-round league is a third of the evidence there is.
WINDOW = 20
# Where a signal has to sit inside its own (role, arm) to fire: the top third, which is the band the
# measurement above reports. A percentile and never an absolute, because a rate means different things
# for a defender and a forward - the same reason `RISER_POOL` is a band.
TOP_SHARE = 1 / 3
# Below this many men in a (role, arm) cell the percentile is not a percentile and nothing fires.
MIN_POOL = 6
# The roles the screen speaks about. The keeper is excluded and the reason is his own metre, above.
ROLES = ("D", "C", "A")

# The five we cover: for these the synthetic vote exists and the ARM is «how much did he play».
COVERED = ("serie_a", "premier_league", "la_liga", "bundesliga", "ligue_1")
# A competition whose median player is this young is youth football, whatever it is called.
YOUTH_MEDIAN_AGE = 20
YOUTH_MIN_ROWS = 20


def youth_competitions(rows) -> set[str]:
    """{competition} whose median player is a boy, derived from the data and never listed by hand.

    `rows` is (competition, age) for every appearance we can date. A competition with fewer than
    `YOUTH_MIN_ROWS` is left OUT of the set - «vuoto = ignoto»: too thin to call it youth football, and
    calling it senior by default is the error that lets 38 Primavera matches read as a season.
    """
    ages: dict[str, list[int]] = {}
    for competition, age in rows:
        if competition and age is not None:
            ages.setdefault(competition, []).append(age)
    out = set()
    for competition, found in ages.items():
        if len(found) >= YOUTH_MIN_ROWS:
            found.sort()
            if found[len(found) // 2] <= YOUTH_MEDIAN_AGE:
                out.add(competition)
    return out


def window_of(matches, window: int = WINDOW) -> dict | None:
    """His last `window` league matches, summed - or None when there is not enough football to read.

    `matches` is a list of dicts in DATE order, each with `competition`, `minutes`, `goals`, `assists`
    and optionally `vote` (the calibrated `mv_synth`, or the declared `mv_est` where the line was never
    calibrated - one reader takes COALESCE of the two, so this does not care which it got).

    The vote is averaged over the matches that HAVE one and the count is carried beside it, because a
    mean over three matches and a mean over twenty are not the same statement and the row has to be able
    to say which it is.
    """
    last = list(matches)[-window:]
    minutes = sum(match.get("minutes") or 0 for match in last)
    if not last or minutes < MIN_MINUTES:
        return None
    bonuses = sum((match.get("goals") or 0) + (match.get("assists") or 0) for match in last)
    votes = [match["vote"] for match in last if match.get("vote") is not None]
    where: dict[str, int] = {}
    for match in last:
        where[match["competition"]] = where.get(match["competition"], 0) + 1
    return {
        "matches": len(last), "minutes": minutes, "bonuses": bonuses,
        "ga90": round(bonuses * 90 / minutes, 3),
        "vote": round(sum(votes) / len(votes), 2) if votes else None,
        "voted": len(votes),
        "competition": max(where, key=lambda key: (where[key], key)),
        # THE ARM IS DECIDED BY THE MINUTES, not by «every match». The measurement drew the covered arm
        # as «900+ minutes inside the five», so a man with nineteen Ligue 1 matches and one in Ligue 2
        # belongs to it; `all()` moved him to the other arm on a single afternoon, which is a statement
        # about one fixture and not about his season.
        "covered": (sum(match.get("minutes") or 0 for match in last
                        if match["competition"] in COVERED) * 2 > minutes),
    }


def screen(men: dict[int, dict]) -> dict[int, dict]:
    """{fc_id: {arm, signal, value, pool, rank}} for the men the screen fires on.

    `men` is {fc_id: {role, share, ...window fields..., covered}} - `share` being how much of his own
    league's calendar he played, which is the covered arm's signal and is computed by the caller because
    the number of rounds is a fact about a championship and lives where championships are known.

    The arm is decided by the FOOTBALL, not by the tag: a man whose last twenty matches are all in the
    five we cover is read on his share, everyone else on his bonuses. That is the measurement above and
    it is also the only reading that does not compare two men on a number that means different things
    for each of them.
    """
    cells: dict[tuple[str, str], list[tuple[float, int]]] = {}
    for fc_id, man in men.items():
        role, arm = man.get("role"), ("covered" if man.get("covered") else "open")
        signal = man.get("share") if arm == "covered" else man.get("ga90")
        if role in ROLES and signal is not None:
            cells.setdefault((role, arm), []).append((signal, fc_id))
    out: dict[int, dict] = {}
    for (role, arm), found in cells.items():
        if len(found) < MIN_POOL:
            continue
        found.sort()
        cut = len(found) - max(1, round(len(found) * TOP_SHARE))
        for position, (signal, fc_id) in enumerate(found):
            if position >= cut:
                out[fc_id] = {
                    "arm": arm,
                    "signal": "share" if arm == "covered" else "bonuses",
                    "value": signal,
                    "pool": len(found),
                    "rank": len(found) - position,
                }
    return out


# The rounds of a championship, for the covered arm only. `features.league_rounds` answers for the five
# we cover; for anything else it reads MAX(real_md) off the per-match layer, where a foreign competition
# arrives with the provider's own round id - `uefa-europa-league` declares 636. So the share is computed
# for the covered arm and NOWHERE else, which is not a limitation here: the open arm is scored on the
# bonuses, which need no denominator. The trap is avoided by construction rather than by remembering it.
def layer(conn, target_season: str, input_season: str, platform: str = "default") -> dict[int, dict]:
    """{fc_id: {...window..., share, screen}} for the quoted men with no football in this championship.

    Read-only. One pass over the per-match layer and one over `tm_appearances`, with the first winning
    wherever it has the man: it carries the VOTE (calibrated `mv_synth`, or the declared `mv_est` where
    the line was never calibrated - COALESCE, and the row says which by which one is filled) while
    `tm_appearances` carries only minutes and bonuses. Two sources for one fact, ordered by what they
    can answer and not by preference.
    """
    from euroleghe_ingest.engine import features

    quoted = {row[0]: row[1] for row in conn.execute(
        """SELECT lq.fc_id, r.role_classic FROM listone_quotes lq
           JOIN rosters r ON r.fc_id = lq.fc_id AND r.season = lq.season
           WHERE lq.season = ? AND lq.platform = ? AND COALESCE(lq.sold, 0) = 0
             AND r.role_classic IN ('D', 'C', 'A')""", (target_season, platform))}
    if not quoted:
        return {}
    seen_here = {row[0] for row in conn.execute(
        "SELECT DISTINCT fc_id FROM match_ratings WHERE platform = ? AND season = ?",
        (platform, input_season))}
    newcomers = {fc_id: role for fc_id, role in quoted.items() if fc_id not in seen_here}

    youth = youth_competitions(conn.execute(
        """SELECT a.competition, CAST(substr(a.season, 1, 4) AS INTEGER) - p.birth_year
           FROM tm_appearances a JOIN players p USING(fc_id)
           WHERE p.birth_year IS NOT NULL AND a.state = 'played'
             AND COALESCE(a.is_national, 0) = 0""").fetchall())

    matches: dict[int, list[dict]] = {}
    for fc_id, date, competition, minutes, goals, assists, vote in conn.execute(
            """SELECT fc_id, match_date, competition, minutes, goals, assists,
                      COALESCE(mv_synth, mv_est)
               FROM external_match_stats
               WHERE COALESCE(minutes, 0) > 0 AND competition IS NOT NULL
               ORDER BY match_date"""):
        if fc_id in newcomers and _is_league(competition) and competition not in youth:
            matches.setdefault(fc_id, []).append(
                {"competition": competition, "minutes": minutes, "goals": goals,
                 "assists": assists, "vote": vote, "date": date})
    for fc_id, date, competition, minutes, goals, assists in conn.execute(
            """SELECT fc_id, played_on, competition, minutes, goals, assists FROM tm_appearances
               WHERE state = 'played' AND COALESCE(is_national, 0) = 0 AND COALESCE(minutes, 0) > 0
               ORDER BY played_on"""):
        if fc_id in newcomers and fc_id not in matches and competition not in youth:
            matches.setdefault(fc_id, []).append(
                {"competition": competition, "minutes": minutes, "goals": goals,
                 "assists": assists, "vote": None, "date": date})

    calendars = features.league_rounds(conn, input_season)
    season_minutes: dict[tuple[int, str], int] = {}
    for fc_id, competition, played in conn.execute(
            """SELECT fc_id, competition, SUM(minutes) FROM external_match_stats
               WHERE season = ? AND COALESCE(minutes, 0) > 0 GROUP BY fc_id, competition""",
            (input_season,)):
        if fc_id in newcomers:
            season_minutes[(fc_id, competition)] = played

    men: dict[int, dict] = {}
    for fc_id, role in newcomers.items():
        window = window_of(matches.get(fc_id, []))
        if window is None:
            continue
        share = None
        if window["covered"]:
            rounds = calendars.get(window["competition"])
            played = season_minutes.get((fc_id, window["competition"]))
            if rounds and played:
                # ...OVER THE SEASON and never over the window, which is an error of unit and was
                # committed here first: twenty matches of a 34-round league cap the share at 0.588
                # whatever the man did, so every full-time starter read the same number and the
                # ranking was measuring the window. The window answers «what has he been doing
                # lately» - the operator's own question - and the share answers «how much of a
                # season is he», which needs the season.
                share = round(min(played / (90 * rounds), 1.0), 3)
        men[fc_id] = {**window, "role": role, "share": share}
    for fc_id, hit in screen(men).items():
        men[fc_id]["screen"] = hit
    return men


# A CUP is not a season: its rounds are few, its opponents are not a league, and a rate over six cup
# ties is the «one good afternoon» this module refuses everywhere else. Matched on the word rather than
# on a list of codes, for the same reason the youth set is derived: the provider names dozens of them.
_CUP_WORDS = ("cup", "coppa", "copa", "taca", "beker", "pokal", "kupasi", "schaal", "uefa-",
              "supercopa", "friendly", "shield", "conmebol", "afc-", "caf-", "trophee", "playoff")


def _is_league(competition: str | None) -> bool:
    return bool(competition) and not any(word in competition for word in _CUP_WORDS)
