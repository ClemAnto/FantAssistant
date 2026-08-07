"""validate - integrity checks on the normalized DB.

Includes the check born from the data-quality finding (the 2024-25 CSV with an empty
`squadra` column): "no entirely-null column" on every populated table. Raises
ValidationError if something is off, so `rebuild` fails loudly instead of silently
producing wrong data. Extend with: stable fc_id, recomputed FM formula, club x season perimeter.
"""

from __future__ import annotations

from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import table_names
from euroleghe_ingest.sources import CLASSIC_ROLES, MANTRA_ROLES, _norm_roles

NAME = "validate"
DESCRIPTION = "Integrity checks (e.g. no entirely-null column)"
DEPENDS_ON: list[str] = []
RAW_INPUTS: list[str] = []
NETWORK = False


class ValidationError(RuntimeError):
    """At least one integrity check failed."""


# Columns that MAY be entirely empty because no source feeds them yet
# (documented, not an extraction bug). Any other entirely-NULL column is suspicious.
ALLOWED_EMPTY: dict[str, set[str]] = {
    "players": {"birth_year", "nationality"},
    # the providers give an id, not the window it is valid for: we date a mapping only when a source
    # actually tells us it changed (e.g. a manual override), which has not happened yet.
    "player_xref": {"valid_from", "valid_to"},
    "club_xref": {"valid_from", "valid_to"},
    # quotations and FVM all come from the listone: a roster rebuilt from the votes alone has none
    "rosters": {"price", "price_initial", "fvm", "fvm_mantra",
                "price_mantra", "price_initial_mantra"},
    "season_stats": {"own_goals"},  # own goals only in the 25/26 Excel, not in the CSVs
    # future/enrichment fields + source-/season-dependent event columns that can be legitimately all
    # empty on a partial scrape (a raise here would abort an otherwise-good rebuild).
    "match_ratings": {"assists_set_piece", "player_of_the_match", "started", "minutes",
                      "own_goals", "pen_scored", "pen_missed", "pen_saved", "goals_conceded"},
    "arrivals": {"tier", "foreign_fm_equiv"},  # need fbref/transfers, not computed yet
    # a listone may quote in one currency only (Mantra columns are absent from the oldest files), and a
    # platform whose list was never downloaded has no rows at all rather than empty ones
    "listone_quotes": {"price", "price_mantra", "price_initial_mantra", "fvm", "fvm_mantra"},
    # the season a probabili page was ABOUT: stored from 07/08/2026 on, so every row captured before then
    # is legitimately NULL - and a NULL one is never read as a forecast (that is the point of the column)
    "probable_starter": {"season"},
    # external layer: each provider fills a different subset (SofaScore has no penalty split, xG is
    # missing on some competitions/seasons, mv_synth only exists after the calibration step).
    "external_stats": {"pen_scored", "pen_taken", "xg", "xa", "starts", "yellows", "reds"},
    "external_match_stats": {"xg", "xa", "yellows", "reds", "mv_synth", "started", "position"},
    # derived_role comes free from the per-match layer; the average position needs the heatmap layer,
    # and friendlies (factor 21) only exist once the preseason is scraped.
    "positions": {"avg_x", "avg_y", "is_friendly"},
}


def _all_null_columns(conn, table: str) -> list[str]:
    """Entirely-NULL columns in a non-empty table."""
    (n,) = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()
    if n == 0:
        return []
    cols = [row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    offenders = []
    for col in cols:
        (non_null,) = conn.execute(
            f'SELECT COUNT("{col}") FROM {table}'  # COUNT(col) ignores NULLs
        ).fetchone()
        if non_null == 0:
            offenders.append(col)
    return offenders


# Tolerances for the ratings-vs-season-aggregates cross-check.
_MV_TOL = 0.02   # media voto is formula-independent -> strict
_FM_TOL = 0.10   # fantamedia depends on scoring/rounding -> reported, not a hard failure


def check_ratings_consistency(conn) -> list[str]:
    """Cross-check scraped per-matchday ratings against the season aggregates (Pv, Mv, FM).

    For each (player, season) with COMPLETE coverage (scraped votes == season Pv):
    Mv (average vote) must match season Mv within tolerance (hard); more votes than the season
    Pv is an anomaly (hard); FM (average fantavoto) is compared loosely and only reported.
    Players still mid-scrape (fewer votes than Pv) are skipped. No-op if match_ratings is empty.
    """
    if conn.execute("SELECT COUNT(*) FROM match_ratings").fetchone()[0] == 0:
        return []
    rows = conn.execute(
        """
        SELECT r.fc_id AS fc_id, r.season AS season,
               COUNT(r.mv) AS pv_r, AVG(r.mv) AS mv_r, AVG(r.fantavoto) AS fm_r,
               s.pv AS pv_s, s.mv AS mv_s, s.fm AS fm_s
        FROM match_ratings r
        JOIN season_stats s ON s.fc_id = r.fc_id AND s.season = r.season AND s.platform = 'euro'
        WHERE r.platform = 'euro'   -- the listone Mv/FM are the EuroLeghe perspective
        GROUP BY r.fc_id, r.season
        """
    ).fetchall()

    complete = mv_ok = fm_ok = fm_off = incomplete = 0
    problems: list[str] = []
    for row in rows:
        pv_r, pv_s = row["pv_r"], row["pv_s"]
        if pv_r == 0 or pv_s is None:
            continue
        if pv_r < pv_s:
            incomplete += 1
            continue
        if pv_r > pv_s:
            problems.append(f"match_ratings fc_id={row['fc_id']} {row['season']}: "
                            f"{pv_r} votes > season Pv {pv_s}")
            continue
        complete += 1
        if row["mv_s"] is not None and abs(row["mv_r"] - row["mv_s"]) > _MV_TOL:
            problems.append(f"match_ratings fc_id={row['fc_id']} {row['season']}: "
                            f"Mv {row['mv_r']:.2f} != season {row['mv_s']}")
        else:
            mv_ok += 1
        if row["fm_s"] is not None:
            if abs(row["fm_r"] - row["fm_s"]) <= _FM_TOL:
                fm_ok += 1
            else:
                fm_off += 1
    print(f"[validate] ratings vs season: {complete} complete-coverage players "
          f"({mv_ok} Mv-consistent, {fm_ok} FM-consistent, {fm_off} FM-off; {incomplete} partial)")
    return problems


def check_role_vocabulary(conn) -> None:
    """Report roster roles outside the canonical vocabulary (i.e. that normalization couldn't map)."""
    canon_c, canon_m = set(CLASSIC_ROLES), set(MANTRA_ROLES)
    bad_c: set[str] = set()
    bad_m: set[str] = set()
    for role_classic, roles in conn.execute("SELECT role_classic, roles FROM rosters"):
        if role_classic and role_classic not in canon_c:
            bad_c.add(role_classic)
        for token in _norm_roles(roles):
            if token not in canon_m:
                bad_m.add(token)
    if bad_c or bad_m:
        print(f"[validate] non-canonical roles (not normalized): "
              f"classic={sorted(bad_c)} mantra={sorted(bad_m)}")
    else:
        print("[validate] roles: all canonical")


def run(ctx: Context, **kwargs) -> None:
    conn = ctx.require_conn()
    problems: list[str] = []
    for table in table_names(conn):
        allowed = ALLOWED_EMPTY.get(table, set())
        offenders = [c for c in _all_null_columns(conn, table) if c not in allowed]
        problems += [f"{table}.{c}: entirely-NULL column" for c in offenders]
    check_role_vocabulary(conn)
    # Ratings-vs-season is a soft cross-check: the listone is a snapshot, so Pv can legitimately
    # differ from the scraped coverage. Report anomalies, don't fail the pipeline on them.
    ratings_anomalies = check_ratings_consistency(conn)
    if ratings_anomalies:
        print(f"[validate] {len(ratings_anomalies)} ratings-vs-season anomalies to review "
              f"(e.g. {ratings_anomalies[0]})")
    if problems:
        raise ValidationError("Checks failed:\n  - " + "\n  - ".join(problems))
