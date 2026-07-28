"""Read-only studies that feed pre-registrations, never verdicts.

The FORWARD-PAIRS study (28/07/2026): season-start top lists sometimes rank two forwards of the
same club together (Marmoush+Haaland on euro, Kean+Piccoli on Serie A). Usually one cannibalizes
the other - starter against backup - but some pairs genuinely coexist (Thuram+Lautaro). This
module characterizes every such group with season-start-legal inputs so the R17 pre-registration
can freeze its functional form on evidence rather than on two anecdotes.

The honesty structure, decided out loud before the first run: OUTCOMES ARE READ ONLY ON
`OUTCOME_WINDOWS` (T1, T2) - the two windows already declared hypothesis-generation windows, where
the motivating cases were observed. Every other window contributes INPUT distributions only, so it
stays clean and can still confirm or refute R17 in the gate. Widening `OUTCOME_WINDOWS` is a
protocol decision, not a parameter sweep.

Same contract as the rest of the engine: stdlib only, read-only on the DB, writes one report under
data/reports/. Depends on `evaluate` (adopted set, fitting, prediction), never the reverse.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime

from . import evaluate, features, model

OUTCOME_WINDOWS: tuple[str, ...] = ("T1", "T2")
PAIR_RANK_LIMIT = 30      # a pair is reported when both members sit in the role's predicted top 30
TOP_FLAG_RANK = 15        # ...and flagged as the user-visible problem when both are in the top 15
MIN_XI = model.FORWARD_MIN_XI   # one constant: the same measurability floor R17 pre-registers
BOTH_THRIVED_SHARE = 0.6  # descriptive outcome label: both delivered >= 60% of their predicted VALUE


def _shot_shares(conn: sqlite3.Connection,
                 season: str) -> dict[int, tuple[float | None, int]]:
    """{fc_id: (share of his main club's forward shots, his own shots)} for the input season.

    "Reference striker" measured where he actually played: his shot total against the forward-shot
    total of the club he took most of them for. An arrival therefore carries the share he held at
    his PREVIOUS club - exactly the number the market read when it priced him. None when the club
    group has no recorded shots (the column exists from the 28/07/2026 re-parse onwards).
    """
    rows = conn.execute(
        """SELECT fc_id, club, SUM(COALESCE(shots, 0))
           FROM external_match_stats
           WHERE source = 'sofascore' AND season = ? AND position = 'F'
           GROUP BY fc_id, club""",
        (season,)).fetchall()
    club_totals: dict[str, int] = {}
    best: dict[int, tuple[str, int]] = {}
    for fc_id, club, shots in rows:
        club_totals[club] = club_totals.get(club, 0) + shots
        if fc_id not in best or shots > best[fc_id][1]:
            best[fc_id] = (club, shots)
    out: dict[int, tuple[float | None, int]] = {}
    for fc_id, (club, shots) in best.items():
        total = club_totals.get(club, 0)
        out[fc_id] = (shots / total if total else None, shots)
    return out


def _role_cross_tab(conn: sqlite3.Connection, platform: str, season: str) -> dict:
    """Provider 'F' against listone 'A', both directions, for the input season.

    The K statistic counts provider-F starters while R17's claimants are listone-A players; if the
    two vocabularies disagree (wingers listed C, trequartisti listed A), the rule's numerator and
    denominator talk past each other. Measured, not assumed, before anything is frozen.
    """
    competitions = features.PLATFORM_COMPETITIONS.get(
        platform, features.PLATFORM_COMPETITIONS["default"])
    marks = ",".join("?" * len(competitions))
    f_starters = dict(conn.execute(
        f"""SELECT COALESCE(r.role_classic, '?'), COUNT(*)
            FROM external_match_stats e
            LEFT JOIN rosters r ON r.fc_id = e.fc_id AND r.season = e.season
            WHERE e.started = 1 AND e.position = 'F' AND e.source = 'sofascore'
              AND e.season = ? AND e.competition IN ({marks})
            GROUP BY 1""",
        (season, *competitions)).fetchall())
    listone_a = dict(conn.execute(
        """SELECT COALESCE(p.derived_role, 'none'), COUNT(*)
           FROM rosters r
           LEFT JOIN positions p ON p.fc_id = r.fc_id AND p.season = r.season
                AND p.source = 'sofascore'
           WHERE r.season = ? AND r.role_classic = 'A'
           GROUP BY 1""",
        (season,)).fetchall())
    return {"f_starters_by_listone_role": f_starters,
            "listone_a_by_derived_role": listone_a}


def _qti_rank(members: list, matchdays_prev: int) -> dict[int, int]:
    """Market rank inside the club's forward group: Qt.I desc, missing Qt.I last.

    Ties broken by last season's share then fc_id - the deterministic order R17 pre-registers.
    """
    def sort_key(obs):
        return (obs.price_initial is None, -(obs.price_initial or 0.0),
                -obs.share_prev(matchdays_prev), obs.fc_id)
    return {obs.fc_id: rank for rank, obs in enumerate(sorted(members, key=sort_key), start=1)}


def _pairs_for_window(data: features.WindowData, predictions: list,
                      shots: dict[int, tuple[float | None, int]]) -> list[dict]:
    """Same-club forward groups whose two best members both rank inside the predicted top 30."""
    ranked = sorted((p for p in predictions
                     if p.obs.role_classic == "A" and p.value_pred is not None),
                    key=lambda p: p.value_pred, reverse=True)
    role_rank = {p.obs.fc_id: rank for rank, p in enumerate(ranked, start=1)}
    by_club: dict[str, list] = {}
    for p in predictions:
        if p.obs.role_classic == "A" and p.obs.club_target:
            by_club.setdefault(p.obs.club_target, []).append(p)
    matchdays = data.matchdays_target or 1
    matchdays_prev = data.matchdays_prev or 1
    read_outcomes = data.window.key in OUTCOME_WINDOWS
    out: list[dict] = []
    for club, group in sorted(by_club.items()):
        valued = sorted((p for p in group if p.value_pred is not None),
                        key=lambda p: p.value_pred, reverse=True)
        if len(valued) < 2 or role_rank.get(valued[1].obs.fc_id, 10**6) > PAIR_RANK_LIMIT:
            continue
        caps = data.forward_caps.get(club)
        k_mean, k_p90, n_xi = caps if caps else (None, None, 0)
        measurable = n_xi >= MIN_XI
        claim = sum(p.pv_pred / matchdays for p in group if p.pv_pred is not None)
        top2 = valued[:2]
        pair_key = tuple(sorted(p.obs.fc_id for p in top2))
        qti_ranks = _qti_rank([p.obs for p in group], matchdays_prev)
        members = []
        for p in (valued if len(valued) <= 4 else valued[:4]):
            obs = p.obs
            shot_share, shot_count = shots.get(obs.fc_id, (None, 0))
            entry = {
                "fc_id": obs.fc_id, "name": obs.name,
                "roles_mantra": list(obs.roles_mantra or ()),
                "qti": obs.price_initial, "qti_rank": qti_ranks.get(obs.fc_id),
                "role_rank": role_rank.get(obs.fc_id),
                "fm_prev": obs.fm_prev, "share_prev": obs.share_prev(matchdays_prev),
                "pv_pred": p.pv_pred, "value_pred": p.value_pred,
                "arrival_type": obs.arrival_type, "club_change": obs.club_change,
                "same_role_arrivals": obs.same_role_arrivals,
                "penalty_rank": obs.penalty_rank,
                "shot_share_prev": shot_share, "shots_prev": shot_count,
            }
            if read_outcomes:
                entry.update({"pv_act": obs.pv_act, "fm_act": obs.fm_act,
                              "value_act": obs.value_act})
            members.append(entry)
        pair = {
            "club": club,
            "both_in_top15": all(role_rank.get(p.obs.fc_id, 10**6) <= TOP_FLAG_RANK
                                 for p in top2),
            "k_mean": k_mean, "k_p90": k_p90, "n_xi": n_xi, "k_measurable": measurable,
            "share_claim": claim,
            "overflow": (claim - k_mean) if (measurable and k_mean is not None) else None,
            "co_starts": data.co_starts.get(pair_key),
            "new_pair": any(p.obs.club_change for p in top2),
            "members": members,
        }
        if read_outcomes:
            acts = [p.obs.value_act for p in top2]
            preds_v = [p.value_pred for p in top2]
            if all(act is not None for act in acts):
                pair["both_thrived"] = all(act >= BOTH_THRIVED_SHARE * pred
                                           for act, pred in zip(acts, preds_v))
                pair["winner"] = top2[0].obs.name if acts[0] >= acts[1] else top2[1].obs.name
        out.append(pair)
    return out


def _print_pair(pair: dict) -> None:
    k_text = (f"K={pair['k_mean']:.2f}/p90 {pair['k_p90']:.0f} ({pair['n_xi']} XIs)"
              if pair["k_measurable"] else f"K not measurable ({pair['n_xi']} XIs)")
    overflow = pair["overflow"]
    claim_text = f"claim {pair['share_claim']:.2f}" + (
        f" ({overflow:+.2f} vs K)" if overflow is not None else "")
    co = pair["co_starts"]
    co_text = "co=new pair" if pair["new_pair"] else f"co={co if co is not None else 0}"
    flag = " ⚠both-top15" if pair["both_in_top15"] else ""
    print(f"    {pair['club']:<18} {k_text:<28} {claim_text:<22} {co_text}{flag}")
    for member in pair["members"]:
        share = member["shot_share_prev"]
        share_text = f"{100 * share:.0f}%" if share is not None else "-"
        outcome = ""
        if "value_act" in member:
            act = member["value_act"]
            outcome = f" -> act {act:.1f}" if act is not None else " -> act -"
        print(f"      #{member['qti_rank']} {member['name']:<22} QtI {member['qti'] or '-':>4} "
              f"rk{member['role_rank'] or '-':>3} shots {share_text:>4} "
              f"pred {member['value_pred']:.1f}{outcome}")
    if "both_thrived" in pair:
        verdict = "BOTH THRIVED" if pair["both_thrived"] else f"one flopped (won: {pair['winner']})"
        print(f"      outcome: {verdict}")


def run(ctx, *, windows: list[str] | None = None, platforms: list[str] | None = None,
        games: list[str] | None = None, report: bool = True, **_ignored) -> dict:
    """The forward-pairs study over every usable window, under the adopted configuration."""
    conn = ctx.require_conn()
    window_keys = tuple(windows or features.WINDOWS)
    platform_keys = tuple(platforms or ("euro", "default"))
    game_keys = tuple(games or ("classic", "mantra"))
    print(f"[pairs] adopted configuration per platform · outcomes read on "
          f"{', '.join(OUTCOME_WINDOWS)} ONLY (all other windows stay clean for the gate)")
    output: dict = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "outcome_windows": list(OUTCOME_WINDOWS),
        "note": "outcomes read only on the already-burned hypothesis-generation windows; "
                "every other window contributes input distributions only",
        "constants": {"pair_rank_limit": PAIR_RANK_LIMIT, "top_flag_rank": TOP_FLAG_RANK,
                      "min_xi": MIN_XI, "both_thrived_share": BOTH_THRIVED_SHARE},
        "views": [],
    }
    for platform in platform_keys:
        for game in game_keys:
            active = ("R0", *evaluate.ADOPTED.get(platform, ()))
            preps = {key: features.prepare(conn, features.WINDOWS[key], platform, game)
                     for key in features.WINDOWS}
            usable = tuple(key for key in features.WINDOWS
                           if evaluate._window_is_usable(preps[key], platform))
            fitted = {key: evaluate.fit_params(preps[key], ("R0", *evaluate.CANDIDATES))
                      for key in usable}
            for key in window_keys:
                if key not in usable:
                    continue
                data = preps[key]
                other = features.cross_fit_source(key, usable)
                params = evaluate.pool_params(fitted, key, fitted[other])
                predictions = evaluate.predict_window(data, active, None, params)
                shots = _shot_shares(conn, data.window.input_season)
                pairs = _pairs_for_window(data, predictions, shots)
                cross_tab = _role_cross_tab(conn, platform, data.window.input_season)
                print(f"\n  == {data.window.label} · {platform}/{game} · "
                      f"rules {', '.join(active)} · params {params.source} ==")
                f_split = cross_tab["f_starters_by_listone_role"]
                total_f = sum(f_split.values()) or 1
                print(f"    F-starters by listone role: "
                      + " ".join(f"{role}={100 * n / total_f:.0f}%"
                                 for role, n in sorted(f_split.items())))
                for pair in pairs:
                    _print_pair(pair)
                if not pairs:
                    print("    (no same-club pair inside the predicted top 30)")
                output["views"].append({
                    "window": key, "platform": platform, "game": game,
                    "rules": list(active), "params_from": params.source,
                    "cross_tab": cross_tab, "pairs": pairs,
                })
    if report:
        path = ctx.config.data_dir / "reports" / "forward_pairs.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(output, indent=2), encoding="utf-8")
        print(f"\n[pairs] report -> {path}")
    return output
