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


# ---------------------------------------------------------------- window
def resolve_window(conn, season: str | None = None) -> tuple[features.Window, str | None]:
    """(window, note). The target is the season being auctioned; the input is the one behind it."""
    seasons = [row[0] for row in conn.execute(
        "SELECT DISTINCT season FROM rosters ORDER BY season")]
    if not seasons:
        raise RuntimeError("no rosters in the DB - run `bootstrap` (or at least `ratings`) first")
    note = None
    target = season or seasons[-1]
    if target not in seasons:
        note = (f"{target} has no listone yet (rosters = 0), so the snapshot was built for "
                f"{seasons[-1]}. Rerun it when the {target} listone is out - that run is the real one.")
        target = seasons[-1]
    index = seasons.index(target)
    input_season = seasons[index - 1] if index else target
    today = dt.datetime.now(tz=dt.UTC).date().isoformat()
    auction = min(f"{target.split('-')[0]}-08-15", today)
    return features.Window("SNAP", input_season, target, auction), note


# ---------------------------------------------------------------- descriptive layers
def recent_form(conn, auction_date: str, since: str, limit: int = FORM_MATCHES) -> dict[int, dict]:
    """The last `limit` matches STRICTLY before the auction date, per player.

    Both providers' rows count (the 5 leagues and the `recent_form` sample): what is being described
    is "how has he been playing lately", and a match is a match. Ratings average over the matches that
    have one - a cameo without a rating is not a zero.
    """
    rows = conn.execute(
        """
        SELECT fc_id, match_date, COALESCE(minutes, 0), rating, COALESCE(goals, 0),
               COALESCE(assists, 0), started
        FROM external_match_stats
        WHERE match_date IS NOT NULL AND match_date < ? AND match_date >= ?
          AND COALESCE(minutes, 0) > 0
        ORDER BY fc_id, match_date DESC
        """,
        (auction_date, since),
    ).fetchall()
    by_player: dict[int, list] = {}
    for fc_id, date, minutes, rating, goals, assists, started in rows:
        bucket = by_player.setdefault(fc_id, [])
        if len(bucket) < limit:
            bucket.append((date, minutes, rating, goals, assists, started))
    out: dict[int, dict] = {}
    for fc_id, sample in by_player.items():
        ratings = [rating for _d, _m, rating, _g, _a, _s in sample if rating is not None]
        minutes = sum(m for _d, m, _r, _g, _a, _s in sample)
        out[fc_id] = {
            "matches": len(sample),
            "minutes": minutes,
            "minutes_per_match": round(minutes / len(sample), 1) if sample else None,
            "rating": round(sum(ratings) / len(ratings), 2) if ratings else None,
            "goals": sum(g for _d, _m, _r, g, _a, _s in sample),
            "assists": sum(a for _d, _m, _r, _g, a, _s in sample),
            "starts": sum(1 for _d, _m, _r, _g, _a, s in sample if s),
            "last_match": sample[0][0] if sample else None,
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


def club_context(conn, data: features.WindowData, starters_date: str | None) -> list[dict]:
    """One row per club of the target season: coach, formation, lines fielded, arrivals, Elo."""
    window = data.window
    clubs = [row[0] for row in conn.execute(
        """SELECT DISTINCT c.canonical_name FROM rosters r JOIN clubs c USING(fc_club_id)
           WHERE r.season = ? AND c.canonical_name IS NOT NULL ORDER BY c.canonical_name""",
        (window.target_season,))]
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
        lines = conn.execute(
            """SELECT AVG(defenders), AVG(midfielders), AVG(forwards), COUNT(*)
               FROM club_match_lineups
               WHERE club = ? AND season = ? AND starters = 11
                 AND goalkeepers + defenders + midfielders + forwards = 11""",
            (club, window.input_season)).fetchone()
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
            "formation_today": formations.get(club),
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
                       league) -> tuple[features.WindowData, list, str, list[str]]:
    """The validated valuation: ADOPTED rules, parameters fitted on a DIFFERENT window.

    Nothing here is new model code - it calls the same functions `backtest --auction` calls, which is
    what keeps the sheet and the gate from ever disagreeing.
    """
    notes: list[str] = []
    data = features.prepare(conn, window, platform, game, league=league)
    active = ("R0", *evaluate.ADOPTED.get(platform, ()))
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
    "desc_form_rating", "desc_form_matches", "desc_form_minutes_per_match", "desc_form_goals",
    "desc_form_assists", "desc_form_starts", "desc_form_last_match",
    "desc_starter_prob", "desc_starter_status", "desc_expected_minutes",
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


def build_rows(conn, data: features.WindowData, predictions, layers: dict) -> list[dict]:
    """One row per player of the target listone, engine columns first, descriptive after."""
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
        prediction = by_id.get(obs.fc_id)
        form = layers["form"].get(obs.fc_id, {})
        injury = layers["injuries"].get(obs.fc_id, {})
        starter = layers["starters"].get(obs.fc_id, {})
        duel = layers["duels"].get(obs.fc_id, {})
        prop = layers["propensity"].get(obs.fc_id, {})
        card = layers["discipline"].get(obs.fc_id, {})
        state = layers["contract"].get(obs.fc_id, {})
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
            "desc_form_rating": form.get("rating"),
            "desc_form_matches": form.get("matches"),
            "desc_form_minutes_per_match": form.get("minutes_per_match"),
            "desc_form_goals": form.get("goals"), "desc_form_assists": form.get("assists"),
            "desc_form_starts": form.get("starts"), "desc_form_last_match": form.get("last_match"),
            "desc_starter_prob": starter.get("probability"),
            "desc_starter_status": starter.get("status"),
            "desc_expected_minutes": _round(
                (obs.minutes_prev / obs.matches_prev * pv_pred)
                if obs.minutes_prev and obs.matches_prev and pv_pred else None, 0),
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

    data, predictions, params_source, engine_notes = engine_predictions(
        conn, window, platform, game, ctx.config.load_league())
    notes += engine_notes
    if not data.observations:
        raise RuntimeError(f"no players in the {window.target_season} listone for platform "
                           f"{platform} - nothing to snapshot")
    if not data.matchdays_target:
        notes.append(f"{window.target_season} has no matchdays yet, so expected appearances are "
                     f"scaled on {window.input_season}'s calendar ({data.matchdays_prev} rounds)")

    seasons = [row[0] for row in conn.execute(
        "SELECT DISTINCT season FROM rosters WHERE season <= ? ORDER BY season",
        (window.target_season,))]
    starters, starters_date = latest_starters(conn, window.auction_date)
    if not starters:
        notes.append("no probabili snapshot at or before the auction date: the starter and duel "
                     "columns are empty. This history only accumulates from the day the weekly job "
                     "starts running - it cannot be backfilled.")
    layers = {
        "form": recent_form(conn, window.auction_date, f"{int(window.auction_date[:4]) - 1}-07-01"),
        "injuries": injury_history(conn, window.auction_date, seasons),
        "starters": starters,
        "availability": availability_now(conn, window.auction_date),
        "propensity": propensity(conn, window.input_season),
        "discipline": discipline(conn, window.input_season, platform),
        "contract": contract_state(conn, window.target_season),
        "penalties": penalty_duty(conn, window.auction_date),
    }
    layers["duels"] = duels(data.observations, starters)

    rows = build_rows(conn, data, predictions, layers)
    clubs = club_context(conn, data, starters_date)

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
