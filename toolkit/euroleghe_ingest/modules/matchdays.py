"""matchdays - euro <-> real matchday alignment, PER LEAGUE (matchday_map).

One EuroLeghe round bundles a DIFFERENT real round in each of the 5 leagues, and skips some real
rounds entirely (8 of 38 in Serie A 2023-24). Without the map we cannot tell a real matchday the
euro calendar actually covered from one that has to be filled synthetically.

Serie A is derived OFFLINE from what we already have: for each euro matchday we compare the set of
(player, goals, assists, yellows, reds) rows against every `default` matchday and keep the best
match. Only the BONUSES go into the signature, never the base voto: the two platforms publish a
DIFFERENT base voto for the same real match (verified: +/-0.5 on ~1/3 of the players), while the
bonus events are identical. The alignment is decisive - the best candidate agrees on 95-100% of the
rows, the runner-up never above ~58%.

The other 4 leagues have no `default` twin, so their rows come from the external per-match layer
(SofaScore rounds -> external_match_stats.real_md); see `positions`.
"""

from __future__ import annotations

from euroleghe_ingest.context import Context

NAME = "matchdays"
DESCRIPTION = "euro <-> real matchday alignment per league -> matchday_map"
DEPENDS_ON: list[str] = ["ratings"]
RAW_INPUTS: list[str] = []
NETWORK = False

_PLAYER_ROLES = ("P", "D", "C", "A")
# Accept an alignment only when it is both strong and unambiguous.
MIN_CONFIDENCE = 0.80   # share of euro rows the winning real matchday reproduces
MIN_MARGIN = 0.20       # gap to the runner-up (a real calendar shift never ties)


def _signatures(conn, season: str, platform: str) -> dict[int, set[tuple]]:
    """Per matchday, the set of (fc_id, goals, assists, yellows, reds) rows with a vote."""
    out: dict[int, set[tuple]] = {}
    rows = conn.execute(
        f"""
        SELECT matchday, fc_id, goals, assists, yellows, reds
        FROM match_ratings
        WHERE season = ? AND platform = ? AND mv IS NOT NULL
          AND role IN ({','.join('?' * len(_PLAYER_ROLES))})
        """,
        (season, platform, *_PLAYER_ROLES),
    ).fetchall()
    for md, fc_id, goals, assists, yellows, reds in rows:
        out.setdefault(md, set()).add((fc_id, goals, assists, yellows, reds))
    return out


def align_season(euro: dict[int, set[tuple]], default: dict[int, set[tuple]]
                 ) -> tuple[dict[int, tuple[int, float]], list[str]]:
    """Match every euro matchday to its real (`default`) matchday. Pure, so it is unit-testable.

    Returns {euro_md: (real_md, confidence)} plus the euro matchdays left unmapped (with a reason).
    """
    # Only players who exist in the `default` platform at all (i.e. the Serie A subset of the euro
    # round) can possibly match; the other 4 leagues' rows would just dilute the score.
    known = {row[0] for rows in default.values() for row in rows}
    mapped: dict[int, tuple[int, float]] = {}
    skipped: list[str] = []
    for euro_md in sorted(euro):
        signature = {row for row in euro[euro_md] if row[0] in known}
        if not signature:
            skipped.append(f"euro {euro_md}: no Serie A player with a vote")
            continue
        scores = sorted(
            ((len(signature & rows) / len(signature), real_md) for real_md, rows in default.items()),
            reverse=True,
        )
        best, runner_up = scores[0], (scores[1] if len(scores) > 1 else (0.0, None))
        if best[0] < MIN_CONFIDENCE or best[0] - runner_up[0] < MIN_MARGIN:
            skipped.append(f"euro {euro_md}: ambiguous (best real {best[1]} {best[0]:.0%}, "
                           f"runner-up {runner_up[1]} {runner_up[0]:.0%})")
            continue
        mapped[euro_md] = (best[1], round(best[0], 3))
    return mapped, skipped


def derive_from_ratings(ctx: Context, league: str = "serie_a") -> int:
    """Derive and store the Serie A euro<->real map from the two platforms' ratings (offline)."""
    conn = ctx.require_conn()
    seasons = [s for (s,) in conn.execute(
        "SELECT DISTINCT season FROM match_ratings WHERE platform = 'default' ORDER BY season")]
    total = 0
    for season in seasons:
        euro = _signatures(conn, season, "euro")
        default = _signatures(conn, season, "default")
        if not euro or not default:
            continue
        mapped, skipped = align_season(euro, default)
        for euro_md, (real_md, confidence) in mapped.items():
            conn.execute(
                """
                INSERT OR REPLACE INTO matchday_map(season, euro_md, league, real_md, source,
                                                    confidence)
                VALUES (?, ?, ?, ?, 'derived', ?)
                """,
                (season, euro_md, league, real_md, confidence),
            )
        total += len(mapped)
        covered = sorted(real_md for real_md, _ in mapped.values())
        missing = sorted(set(default) - set(covered))
        worst = min((c for _, c in mapped.values()), default=1.0)
        print(f"[matchdays] {season} {league}: {len(mapped)}/{len(euro)} euro matchdays mapped "
              f"(min confidence {worst:.0%}) · real matchdays outside the euro calendar: {missing}")
        for note in skipped:
            print(f"[matchdays] {season} {league}: {note}")
    conn.commit()
    return total


def _euro_lineups(conn, season: str, league: str) -> dict[int, set[tuple]]:
    """Per euro matchday, (player, goals) for the `league` players who got a vote.

    Goals are part of the fingerprint on purpose: who PLAYED barely changes from round to round
    (the euro perimeter is the same ~150 players every week), so presence alone leaves the runner-up
    within a few points of the winner. Who SCORED is what makes a round unique. Note the +pen_scored:
    the fantacalcio Gf column excludes penalties, the provider's per-match goals include them.
    """
    out: dict[int, set[tuple]] = {}
    rows = conn.execute(
        f"""
        SELECT mr.matchday, mr.fc_id, COALESCE(mr.goals, 0) + COALESCE(mr.pen_scored, 0)
        FROM match_ratings mr
        JOIN rosters r ON r.fc_id = mr.fc_id AND r.season = mr.season
        WHERE mr.season = ? AND mr.platform = 'euro' AND mr.mv IS NOT NULL
          AND mr.role IN ({','.join('?' * len(_PLAYER_ROLES))}) AND r.league = ?
        """,
        (season, *_PLAYER_ROLES, league),
    ).fetchall()
    for matchday, fc_id, goals in rows:
        out.setdefault(matchday, set()).add((fc_id, goals))
    return out


def _external_lineups(conn, season: str, league: str) -> dict[int, set[tuple]]:
    """Per REAL matchday, (player, goals) from the external per-match layer."""
    out: dict[int, set[tuple]] = {}
    rows = conn.execute(
        """
        SELECT real_md, fc_id, COALESCE(goals, 0) FROM external_match_stats
        WHERE season = ? AND competition = ? AND real_md IS NOT NULL
          AND COALESCE(minutes, 0) > 0
        """,
        (season, league),
    ).fetchall()
    for real_md, fc_id, goals in rows:
        out.setdefault(real_md, set()).add((fc_id, goals))
    return out


def derive_from_external(ctx: Context, leagues=None) -> int:
    """Map the 4 foreign leagues with the same overlap logic, using the external per-match layer.

    There is no `default` twin outside Serie A, so the "who played this real round" side comes from
    external_match_stats (SofaScore). Requires the per-match layer: `positions --layer match`.
    """
    conn = ctx.require_conn()
    pairs = conn.execute(
        "SELECT DISTINCT season, competition FROM external_match_stats "
        "WHERE source = 'sofascore' ORDER BY season, competition").fetchall()
    total = 0
    for season, league in pairs:
        if leagues and league not in leagues:
            continue
        euro = _euro_lineups(conn, season, league)
        real = _external_lineups(conn, season, league)
        if not euro or not real:
            continue
        mapped, skipped = align_season(euro, real)
        # Where we already derived the map from OUR OWN ratings (Serie A), that stays authoritative
        # and the external map becomes a free cross-check of the whole external pipeline.
        derived = {euro_md: real_md for euro_md, real_md in conn.execute(
            "SELECT euro_md, real_md FROM matchday_map WHERE season = ? AND league = ? "
            "AND source = 'derived'", (season, league))}
        agree = sum(1 for euro_md, (real_md, _c) in mapped.items()
                    if derived.get(euro_md) == real_md)
        for euro_md, (real_md, confidence) in mapped.items():
            if euro_md in derived:
                continue
            conn.execute(
                """
                INSERT OR REPLACE INTO matchday_map(season, euro_md, league, real_md, source,
                                                    confidence)
                VALUES (?, ?, ?, ?, 'sofascore', ?)
                """,
                (season, euro_md, league, real_md, confidence),
            )
            total += 1
        if derived:
            overlap = sum(1 for euro_md in mapped if euro_md in derived)
            print(f"[matchdays] {season} {league}: cross-check vs the ratings-derived map: "
                  f"{agree}/{overlap} matchdays agree")
        missing = sorted(set(real) - {real_md for real_md, _ in mapped.values()})
        worst = min((c for _, c in mapped.values()), default=1.0)
        print(f"[matchdays] {season} {league}: {len(mapped)}/{len(euro)} euro matchdays mapped "
              f"(min confidence {worst:.0%}) · real matchdays outside the euro calendar: {missing}")
        for note in skipped:
            print(f"[matchdays] {season} {league}: {note}")
    conn.commit()
    return total


def run(ctx: Context, **kwargs) -> None:
    total = derive_from_ratings(ctx) + derive_from_external(ctx)
    conn = ctx.require_conn()
    by_league = conn.execute(
        "SELECT league, COUNT(*) FROM matchday_map GROUP BY league ORDER BY league").fetchall()
    detail = ", ".join(f"{league}={n}" for league, n in by_league) or "empty"
    print(f"[matchdays] matchday_map rows: {detail} (+{total} mapped this run)")
