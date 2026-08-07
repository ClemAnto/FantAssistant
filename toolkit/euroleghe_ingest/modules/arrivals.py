"""arrivals - who is new in the perimeter each season, by diffing the roster lists (offline).

For each season vs the previous one:
  * `new`                    - fc_id not in the perimeter last season (no prior FM) -> arrival anchor case.
  * `transfer_cross_league`  - was in the perimeter, changed club AND league (e.g. De Bruyne).
  * `transfer_intra_league`  - was in the perimeter, changed club within the same league.
Players staying at the same club are not arrivals.

On top of the detection this module fills the two fields the pricing needs (spec, policy NUOVI
ARRIVI): the TIER, which decides which estimation path an arrival takes, and the foreign
FM-EQUIVALENT, i.e. what the player's fantamedia would have looked like under EuroLeghe scoring had
his real season been played in the game. The equivalent is what makes a Bundesliga arrival
comparable to a Serie A one at all, and it is the input of the club-to-club correction (task 3.2).

Both are FEATURES, not predictions: how the engine leans on them still has to win the
out-of-sample gate. The thresholds below are provisional and marked as such.
"""

from __future__ import annotations

from euroleghe_ingest.context import Context

NAME = "arrivals"
DESCRIPTION = "Roster diff -> arrivals (type, tier, foreign FM-equivalent)"
DEPENDS_ON: list[str] = ["rosters"]
RAW_INPUTS: list[str] = []
NETWORK = False

# The tier is a percentile INSIDE a listone, so it has a platform - one row per platform per arrival
# (schema.sql, `arrivals`). Kept here and not imported from `ratings` to leave this module dependency-free.
PLATFORMS: tuple[str, ...] = ("euro", "default")

# PROVISIONAL thresholds (the gate owns them - do not read them as established).
# The price is the market's own statement about how important a player is, so it decides whether an
# arrival is worth the full treatment; the amount of history decides whether that treatment is even
# possible. "Sotto soglia" in the spec = important but thin history -> drop to the T2 path.
T1_PRICE_PCT = 0.80          # top fifth of its role in that season
T3_PRICE_PCT = 0.40          # below this the player is marginal -> discounted role anchor
FULL_HISTORY_MATCHES = 15    # matches with a (real or synthetic) base voto to call a history usable
U22_AGE = 22


def _season_map(conn, season: str) -> dict[int, tuple]:
    rows = conn.execute(
        "SELECT r.fc_id, c.canonical_name, r.league "
        "FROM rosters r LEFT JOIN clubs c ON c.fc_club_id = r.fc_club_id WHERE r.season = ?",
        (season,),
    ).fetchall()
    return {fc_id: (club, league) for fc_id, club, league in rows}


def _classify(prev: tuple, cur: tuple) -> tuple[str, str | None, str | None] | None:
    """Return (type, origin_club, origin_league) or None if it's not an arrival."""
    pclub, pleague = prev
    club, league = cur
    if pclub is not None and pclub == club:
        return None   # same club, stayed
    if pclub is None or club is None:
        # club unknown on one side -> fall back to league only
        if pleague and league and pleague != league:
            return ("transfer_cross_league", pclub, pleague)
        return None
    kind = "transfer_cross_league" if pleague != league else "transfer_intra_league"
    return (kind, pclub, pleague)


def foreign_fm_equivalent(conn, scoring: dict[str, float], season: str) -> dict[int, tuple]:
    """{fc_id: (fm_equiv, matches)} for `season`, from the real matches we have under euro scoring.

    The gate is the CONVERTED base voto and no longer the source tag (`synth.calibrated_competitions`): a
    man whose only football is the ten matches `recent_form` recovered gets an equivalent over those ten,
    and the MATCH COUNT travels with it so nobody reads a window as a season - the tier's own
    `full_history` threshold (15, swept) is what decides whether it is treated as one.

    Per match the base voto is the real euro one when the euro calendar covered that round, and the
    calibrated synthetic voto otherwise - which is the whole point of the synthetic layer: a foreign
    player's fantamedia stops depending on which rounds the game happened to include.

    Cards are the one approximation: the per-match layer has no bookings, so the season totals from
    external_stats are spread evenly over the appearances. That biases the equivalent slightly
    upward for players who are booked in bursts, never by more than the card malus itself.

    GOALKEEPERS ARE EXCLUDED FROM THIS FORMULA, and that is not a shortcut: their fantavoto is dominated
    by the goals-conceded malus, which this sum has no term for. Measured on the men it can be measured
    on, this formula reads +0.82 to +1.22 above their real fantamedia with **0%** inside 0.3. They get
    their own arithmetic instead - `keeper_fm_equivalent`, gate §7-decies - and where that is not
    computable either they stay NULL, because a NULL says "we cannot price him" while a number inflated
    by a goal a game says something false with a straight face.
    """
    rows = conn.execute(
        """
        SELECT e.fc_id,
               COALESCE(mr.mv, e.mv_synth) AS base,
               COALESCE(e.goals, 0), COALESCE(e.assists, 0)
        FROM external_match_stats e
        LEFT JOIN matchday_map m ON m.season = e.season AND m.league = e.competition
                                AND m.real_md = e.real_md
        LEFT JOIN match_ratings mr ON mr.fc_id = e.fc_id AND mr.season = e.season
                                  AND mr.platform = 'euro' AND mr.matchday = m.euro_md
        LEFT JOIN rosters r ON r.fc_id = e.fc_id AND r.season = e.season
        WHERE e.season = ? AND COALESCE(e.minutes, 0) > 0
          AND COALESCE(mr.mv, e.mv_synth) IS NOT NULL
          AND COALESCE(r.role_classic, '') != 'P' AND COALESCE(e.position, '') != 'G'
        """,
        (season,),
    ).fetchall()
    cards = {fc_id: (yellows or 0, reds or 0, matches or 0) for fc_id, yellows, reds, matches
             in conn.execute("SELECT fc_id, yellows, reds, matches FROM external_stats "
                             "WHERE season = ? AND source = 'sofascore'", (season,))}
    totals: dict[int, list[float]] = {}
    for fc_id, base, goals, assists in rows:
        bucket = totals.setdefault(fc_id, [0.0, 0])
        bucket[0] += base + scoring["goal_bonus"] * goals + scoring["assist_bonus"] * assists
        bucket[1] += 1
    out: dict[int, tuple] = {}
    for fc_id, (total, matches) in totals.items():
        yellows, reds, aggregate_matches = cards.get(fc_id, (0, 0, 0))
        per_match_cards = 0.0
        if aggregate_matches:
            per_match_cards = (scoring["yellow_card_malus"] * yellows
                               + scoring["red_card_malus"] * reds) / aggregate_matches
        out[fc_id] = (round(total / matches - per_match_cards, 3), matches)
    out.update(keeper_fm_equivalent(conn, scoring, season))
    return out


def keeper_fm_equivalent(conn, scoring: dict[str, float], season: str) -> dict[int, tuple]:
    """{fc_id: (fm_equiv, matches)} for the GOALKEEPERS of `season`. Gate §7-decies.

    A keeper's fantavoto is an identity, not an estimate: measured on 16,017 of our own keeper rows on
    both platforms, `fantavoto = mv - goals_conceded + 3*pen_saved - cards` is exact in 100% of them, and
    there is NO clean-sheet bonus (residual 0.000 on the 4,872 matches closed at zero, while
    `scoring_config` declares one - `ratings._fantavoto` already excludes it for the same measured
    reason). So one number was missing and it was the goals conceded.

    Where it comes from: `external_stats.goals_conceded`, the provider's own season aggregate - goals the
    team conceded WHILE HE WAS ON THE PITCH, which for a keeper is the malus. It is a per-SEASON number,
    so the malus is his season rate, and numerator and denominator are read on the same COMPETITION (his
    league), never on "every eleven we parsed": that rule is why titolarità was wrong before v9.11.

    Two things this cannot do, both declared rather than approximated:
    * `pen_saved` does not exist in the provider aggregate, so the +3 term is absent. It biases the
      equivalent DOWNWARD by about 0.005-0.02 of a fantavoto, which is the prudent direction, and the
      measurement carries it (bias -0.00 to -0.18 across seasons);
    * a competition with no season aggregate has no goals conceded anywhere in our sources - the round
      and player caches are distilled and the match SCORE was dropped - so a keeper whose only football
      is Serie B (the case that opened §7-nonies) still gets NULL. What is missing for him is not the
      voto: it is the goals conceded.
    """
    per_match = conn.execute(
        """
        SELECT e.fc_id, e.competition,
               SUM(COALESCE(mr.mv, e.mv_synth)), COUNT(*)
        FROM external_match_stats e
        LEFT JOIN matchday_map m ON m.season = e.season AND m.league = e.competition
                                AND m.real_md = e.real_md
        LEFT JOIN match_ratings mr ON mr.fc_id = e.fc_id AND mr.season = e.season
                                  AND mr.platform = 'euro' AND mr.matchday = m.euro_md
        WHERE e.season = ? AND COALESCE(e.minutes, 0) > 0 AND e.position = 'G'
          AND COALESCE(mr.mv, e.mv_synth) IS NOT NULL
        GROUP BY 1, 2
        """,
        (season,),
    ).fetchall()
    base = {(fc_id, competition): (total, matches) for fc_id, competition, total, matches in per_match}
    out: dict[int, tuple] = {}
    for fc_id, competition, matches, conceded, yellows, reds in conn.execute(
        """
        SELECT fc_id, competition, matches, goals_conceded, COALESCE(yellows, 0), COALESCE(reds, 0)
        FROM external_stats
        WHERE season = ? AND source = 'sofascore' AND competition <> ''
          AND COALESCE(saves, 0) > 0 AND COALESCE(matches, 0) > 0 AND goals_conceded IS NOT NULL
        """,
        (season,),
    ):
        counted = base.get((fc_id, competition))
        if not counted:
            continue
        total, played = counted
        equivalent = (total / played
                      - scoring["goal_conceded_malus_gk"] * conceded / matches
                      - (scoring["yellow_card_malus"] * yellows
                         + scoring["red_card_malus"] * reds) / matches)
        # A keeper with two league aggregates in one season (a mid-season transfer between two of the
        # five leagues) keeps the one he played most: the equivalent describes a season of football, and
        # averaging two spells would describe neither.
        if fc_id in out and out[fc_id][1] >= played:
            continue
        out[fc_id] = (round(equivalent, 3), played)
    return out


# WHICH PERCENTILE ROUTES AN ARRIVAL, and it is the operator's rule: «utilizziamo la quotazione quando non
# abbiamo altre risorse oggettive». The quotation is somebody's judgement - a good one, and still a judgement
# - so it goes LAST, behind football that was actually played. What comes first is his FM-EQUIVALENT in the
# league he came from (`foreign_fm_equivalent`): the same event we are predicting, measured, converted with
# this league's own scoring. Where that does not exist the quotation decides, because then it is the only
# statement about him that exists at all.
# "price" keeps the old behaviour so the two can be scored head to head (`sweep`), which is the only way this
# is a decision and not a preference.
TIER_DRIVER = "measured_first"


def classify_tier(price_percentile: float | None, history_matches: int, u22: bool,
                  t1_price: float = T1_PRICE_PCT, t3_price: float = T3_PRICE_PCT,
                  full_history: int = FULL_HISTORY_MATCHES,
                  measured_percentile: float | None = None,
                  fvm_percentile: float | None = None,
                  driver: str = TIER_DRIVER) -> str:
    """T1 full history · T2 important but thin (U22 trigger / national-team fallback) · T3 marginal.

    The three cuts are arguments as well as constants because they are PROVISIONAL (gate 7-bis) and
    `modules/sweep.py` varies them: a threshold nobody can move is a threshold nobody can measure. The
    DRIVER is the fourth of them, and the same rule applies to it.
    """
    # The order the operator asked for: football that was played, then the FRESHER judgement, then the
    # fixed one. «L'FVM varia ogni settimana o quando ci sono eventi particolari - infortuni,
    # trasferimenti», so where both judgements exist it is the FVM that describes where the player is NOW,
    # while Qt.I was set once before the season and never moved. Both are opinions; one is current.
    percentile = price_percentile
    if driver == "measured_first":
        if measured_percentile is not None:
            percentile = measured_percentile
        elif fvm_percentile is not None:
            percentile = fvm_percentile
    if percentile is None:
        return "T3"
    if percentile >= t1_price and history_matches >= full_history and not u22:
        return "T1"
    if percentile >= t3_price:
        return "T2"
    return "T3"


def fvm_percentiles(conn, season: str | None, platform: str = "default") -> dict[int, float]:
    """fc_id -> the percentile of his FANTAVALORE within his Classic role, ON THAT PLATFORM'S listone.

    The second choice, behind football actually played and ahead of the quotation, and the reason is the
    operator's own: the fantavalore moves weekly and on events (injuries, transfers) while Qt.I is set once
    before the season - so where both exist, the FVM is the one that says where the player is now. Ten times
    finer, too: a striker's Qt.I spans 1-40 and his FVM 1-430.
    Read on the season GIVEN, which callers pass as the one BEFORE the arrival: the fantavalore of the season
    being played would know its outcome. Empty before 2022-23, where the source stores zeros and not values -
    and a zero is not a fantavalore, so it is excluded rather than ranked.
    `platform` because a percentile is a comparison, and the two listoni are two currencies: ranking a Serie
    A player against EuroLeghe fantavalori compares him with a scale his own list does not use.
    """
    if not season:
        return {}
    roles = dict(conn.execute("SELECT fc_id, role_classic FROM rosters WHERE season = ?", (season,)))
    by_role: dict[str, list[float]] = {}
    mine: dict[int, tuple[str, float]] = {}
    for fc_id, value in conn.execute(
            "SELECT fc_id, fvm FROM listone_quotes WHERE season = ? AND platform = ? "
            "AND fvm IS NOT NULL AND fvm > 0", (season, platform)):
        role = roles.get(fc_id)
        if not role:
            continue
        mine[fc_id] = (role, float(value))
        by_role.setdefault(role, []).append(float(value))
    return {fc_id: round(sum(1 for other in by_role[role] if other <= value) / len(by_role[role]), 3)
            for fc_id, (role, value) in mine.items()}


def measured_percentiles(conn, season: str, equivalents: dict[int, tuple]) -> dict[int, float]:
    """fc_id -> the percentile of his FM-EQUIVALENT within his Classic role. Measured football only.

    Built exactly like `_price_percentiles`, and for the same reason: a 6.2 is a different statement for a
    defender than for a striker, so the comparison has to be inside the role. What it reads is the fantamedia
    he really produced in the league he came from, converted with this league's scoring - the same event the
    engine is predicting, only measured somewhere else.
    """
    roles = dict(conn.execute("SELECT fc_id, role_classic FROM rosters WHERE season = ?", (season,)))
    by_role: dict[str, list[float]] = {}
    mine: dict[int, tuple[str, float]] = {}
    for fc_id, (equivalent, _matches) in equivalents.items():
        role = roles.get(fc_id)
        if equivalent is None or not role:
            continue
        mine[fc_id] = (role, equivalent)
        by_role.setdefault(role, []).append(equivalent)
    return {fc_id: round(sum(1 for other in by_role[role] if other <= value) / len(by_role[role]), 3)
            for fc_id, (role, value) in mine.items()}


def _price_percentiles(conn, season: str, platform: str = "default") -> dict[int, float]:
    """Price percentile WITHIN the player's Classic role, and INSIDE THIS PLATFORM'S listone.

    Reads Qt.I, the PRE-AUCTION quotation, not Qt.A. Qt.A is revised all season long, so for a season
    already played it embeds the outcome: tiers built on it would look prescient and be worthless
    (Openda 25/26: Qt.I 20 before the auction, Qt.A 3 after 12 appearances).

    The pool is the platform's own list because the two are two currencies, and NOT proportional ones:
    measured 07/08/2026 on 2026-27, forwards run to 28 on the Serie A listone and to 49 on the EuroLeghe
    one, while defenders go the other way (28 against 20). Pooling them ranked an Italian against a scale
    his own auction does not use, and 84 players of 1175 crossed a T1/T2/T3 band because of it.
    """
    total = conn.execute("SELECT COUNT(*) FROM rosters WHERE season = ?", (season,)).fetchone()[0]
    with_initial = conn.execute(
        "SELECT COUNT(*) FROM listone_quotes WHERE season = ? AND platform = ? "
        "AND price_initial IS NOT NULL", (season, platform)).fetchone()[0]
    if total and not with_initial:
        # Every tier would silently fall to the no-price branch and `validate` would still call the DB
        # healthy, because price_initial is allowed to be empty (a roster rebuilt from the votes alone
        # has neither quotation). Say it out loud instead - and name the platform, or a season that has
        # one listone and not the other reads as a defect twice.
        print(f"[arrivals] WARNING {season}/{platform}: no pre-auction quotation (Qt.I) in this "
              f"platform's listone (the season has {total} roster rows) - every tier here will be "
              "assigned without the price dimension")
    roles = dict(conn.execute("SELECT fc_id, role_classic FROM rosters WHERE season = ?", (season,)))
    by_role: dict[str, list[tuple[float, int]]] = {}
    for fc_id, price in conn.execute(
            "SELECT fc_id, price_initial FROM listone_quotes "
            "WHERE season = ? AND platform = ? AND price_initial IS NOT NULL", (season, platform)):
        by_role.setdefault(roles.get(fc_id) or "?", []).append((price, fc_id))
    out: dict[int, float] = {}
    for entries in by_role.values():
        entries.sort()
        for index, (_price, fc_id) in enumerate(entries):
            out[fc_id] = (index + 1) / len(entries)
    return out


def enrich(ctx: Context) -> None:
    """Fill arrivals.tier and arrivals.foreign_fm_equiv, and flag the U22 trigger.

    Per PLATFORM, because the tier is a percentile inside a listone and there are two of them. Everything
    else about an arrival is platform-independent - it is a roster diff - so the FM-equivalent and the U22
    trigger are computed once and written to every row; only the tier is asked twice.
    """
    conn = ctx.require_conn()
    scoring = ctx.config.load_scoring()
    seasons = [row[0] for row in conn.execute("SELECT DISTINCT season FROM arrivals ORDER BY season")]
    conn.execute("DELETE FROM flags WHERE flag = 'u22_trigger' AND source = 'arrivals'")
    tiers: dict[str, dict[str, int]] = {}
    with_equivalent = 0
    for season in seasons:
        # the history that matters is the season BEFORE the arrival - that is what we can price on
        previous = conn.execute("SELECT MAX(season) FROM rosters WHERE season < ?", (season,)).fetchone()[0]
        equivalents = foreign_fm_equivalent(conn, scoring, previous) if previous else {}
        measured = measured_percentiles(conn, season, equivalents)
        rows = conn.execute(
            "SELECT DISTINCT a.fc_id, p.birth_year FROM arrivals a JOIN players p USING(fc_id) "
            "WHERE a.season = ?", (season,)).fetchall()
        for platform in PLATFORMS:
            percentiles = _price_percentiles(conn, season, platform)
            fvm = fvm_percentiles(conn, previous, platform)
            for fc_id, birth_year in rows:
                fm_equiv, matches = equivalents.get(fc_id, (None, 0))
                season_start = int(season.split("-")[0])
                u22 = bool(birth_year) and (season_start - birth_year) <= U22_AGE
                tier = classify_tier(percentiles.get(fc_id), matches, u22,
                                     measured_percentile=measured.get(fc_id),
                                     fvm_percentile=fvm.get(fc_id))
                conn.execute("UPDATE arrivals SET tier = ?, foreign_fm_equiv = ? "
                             "WHERE fc_id = ? AND season = ? AND platform = ?",
                             (tier, fm_equiv, fc_id, season, platform))
                tiers.setdefault(platform, {})[tier] = tiers.setdefault(platform, {}).get(tier, 0) + 1
                if u22:
                    conn.execute(
                        "INSERT OR REPLACE INTO flags(fc_id, season, flag, value, source) "
                        "VALUES (?, ?, 'u22_trigger', ?, 'arrivals')",
                        (fc_id, season, str(season_start - birth_year)))
        with_equivalent += sum(1 for fc_id, _birth in rows if equivalents.get(fc_id, (None, 0))[0]
                               is not None)
    conn.commit()
    for platform, counts in sorted(tiers.items()):
        detail = " ".join(f"{tier}={n}" for tier, n in sorted(counts.items()))
        print(f"[arrivals] tiers {platform}: [{detail}]")
    print(f"[arrivals] foreign FM-equivalent on {with_equivalent} arrivals (platform-independent: "
          "measured football, not a quotation)")


def run(ctx: Context, **kwargs) -> None:
    conn = ctx.require_conn()
    seasons = [r[0] for r in conn.execute("SELECT DISTINCT season FROM rosters ORDER BY season")]
    conn.execute("DELETE FROM arrivals")   # idempotent rebuild

    n = 0
    prev_map: dict[int, tuple] | None = None
    for season in seasons:
        cur_map = _season_map(conn, season)
        if prev_map is not None:
            for fc_id, cur in cur_map.items():
                if fc_id not in prev_map:
                    kind, origin_club, origin_league = "new", None, None
                else:
                    classified = _classify(prev_map[fc_id], cur)
                    if classified is None:
                        continue
                    kind, origin_club, origin_league = classified
                # One row per platform: the EVENT is the same on both (a roster diff knows one club per
                # player-season), the TIER is not - `enrich` fills it from each listone's own pool.
                for platform in PLATFORMS:
                    conn.execute(
                        "INSERT OR REPLACE INTO arrivals(fc_id, season, platform, type, origin_club, "
                        "origin_league) VALUES (?, ?, ?, ?, ?, ?)",
                        (fc_id, season, platform, kind, origin_club, origin_league),
                    )
                n += 1
        prev_map = cur_map

    print(f"[arrivals] {n} arrivals/transfers across {len(seasons)} seasons")
    enrich(ctx)
