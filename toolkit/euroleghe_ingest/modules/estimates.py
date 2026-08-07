"""estimates - does the FALLBACK valuation make the auction list better or worse? (gate §7-undecies)

`engine/estimate.py` exists for a product rule («ogni calciatore DEVE avere il suo SURPLUS»), not for a gate:
it does not predict better than the anchor - R1 and R13c already lost that argument on six windows - it gives a
number where there was none. What IS testable is what it now does: it RANKS. A man on an estimate can take a
place in a role's top ten, and on a finished window we know whether he delivered.

So this command re-runs the deliverable twice on every usable window - `auction_view` without estimates and
with them - and reports the captured VALUE and SURPLUS, the names in common, and, for every estimated man who
reached a top ten, what he actually returned. Criteria are pre-registered in the gate: the estimates stay in
the ranking only if captured value does not get worse on the majority of windows and no window loses more than
2%; otherwise they are displacing better men and the list goes back to ranking the priced ones only.

READ-ONLY on the DB, writes `data/reports/estimates_check.json`. It lives in `modules/` and not in `engine/`
because the cascade's INPUTS are gathered by `snapshot` (the other platform's season, the club's own level) and
`engine/` may not import upwards - the same reason `sweep` lives here.
"""

from __future__ import annotations

import datetime as dt
import json
import statistics

from euroleghe_ingest.context import Context
from euroleghe_ingest.engine import estimate as est
from euroleghe_ingest.engine import evaluate, features
from euroleghe_ingest.modules import snapshot

NAME = "estimates"
DESCRIPTION = "Does the fallback valuation make the auction list better or worse? (gate §7-undecies)"
DEPENDS_ON: list[str] = ["rosters", "stats", "ratings", "positions"]
RAW_INPUTS: list[str] = []
NETWORK = False

MAX_WINDOW_LOSS = 0.02          # the robust verdict's own tolerance, quoted from the gate


def _estimates_for(conn, data, predictions, window, platform: str) -> dict[int, dict]:
    """{fc_id: the fallback valuation} for the men the core cannot price - the panel's own layer.

    Deliberately the same call the Auction tab makes: measuring a different cascade than the one that ships
    would measure nothing. Reads only seasons <= the input season, so a past window cannot see its own answer.
    """
    priced = {p.obs.fc_id for p in predictions if p.value_pred is not None}
    by_id = {p.obs.fc_id: p for p in predictions}
    layer = snapshot.estimation_layer(conn, window, platform, data.observations)
    out: dict[int, dict] = {}
    for obs in data.observations:
        if obs.fc_id in priced:
            continue
        guess = snapshot.estimate_for(obs, by_id.get(obs.fc_id), layer, data.anchors, data,
                                      window, platform)
        # Same slot the panel and the sheet use - `role_classic` is not a key of `replacement` on a
        # mantra window, so this used to hand `est.surplus` a None and return the VALUE instead.
        _slot, level = snapshot.auction_level(obs, data)
        out[obs.fc_id] = {
            "fm": guess.fm, "pv": guess.pv, "basis": guess.basis,
            "confidence": guess.confidence, "note": guess.note,
            "value": est.surplus(guess.fm, guess.pv, None, guess.confidence),
            "surplus": est.surplus(guess.fm, guess.pv, level, guess.confidence),
        }
    return out


def _totals(view: dict) -> dict:
    """The deliverable in three numbers, summed over the roles: what the ten names captured."""
    return {
        "captured": round(sum(block["captured_value"] or 0.0 for block in view.values()), 1),
        "perfect": round(sum(block["perfect_value"] or 0.0 for block in view.values()), 1),
        "hits": sum(block["hits"] for block in view.values()),
        "estimated_in_top": sum(1 for block in view.values()
                                for row in block["predicted"] if row.get("estimated")),
    }


def check(ctx: Context, platform: str, game: str, metric: str = evaluate.SURPLUS) -> dict:
    """One platform: every usable window, the list twice, and what the estimated men actually returned."""
    conn = ctx.require_conn()
    setup = ctx.config.load_league(platform=platform, game=game)
    block: dict = {"platform": platform, "game": game, "metric": metric, "windows": {}}
    usable, fits = {}, {}
    for key, window in features.WINDOWS.items():
        data = features.prepare(conn, window, platform, game, league=setup)
        if evaluate._window_is_usable(data, platform):
            usable[key] = data
            fits[key] = evaluate.fit_params(data, ("R0", *evaluate.CANDIDATES))
    for key, data in usable.items():
        # the same parameters the gate scores this window with: never its own
        source = features.cross_fit_source(key, tuple(usable))
        params = evaluate.pool_params(fits, key, fits[source])
        adopted = ("R0", *evaluate.ADOPTED.get(platform, ()))
        predictions = evaluate.predict_window(data, adopted, None, params)
        estimates = _estimates_for(conn, data, predictions, data.window, platform)
        bare = evaluate.auction_view(data, predictions, metric=metric)
        with_est = evaluate.auction_view(data, predictions, metric=metric, estimates=estimates)
        before, after = _totals(bare), _totals(with_est)
        delta = ((after["captured"] - before["captured"]) / before["captured"]
                 if before["captured"] else 0.0)
        # ...and what the men who got in actually did, which is the only honest way to read a ranking
        entered = [{"name": row["name"], "role": role, "rank": row["rank"],
                    "basis": row["est_basis"], "confidence": row["est_confidence"],
                    "surplus_pred": row["surplus_pred"], "surplus_act": row["surplus_act"],
                    "displaced": next((other["name"] for other in bare[role]["predicted"]
                                       if other["rank"] == top_n_last(bare[role])), None)}
                   for role, block_after in with_est.items()
                   for row in block_after["predicted"] if row.get("estimated")]
        block["windows"][key] = {
            "label": data.window.label,
            "estimable": len(estimates),
            "before": before, "after": after,
            "captured_delta": round(delta, 5),
            "entered": entered,
        }
        print(f"[estimates] {platform}/{game} {data.window.label}: {len(estimates)} estimable · captured "
              f"{before['captured']:.0f} -> {after['captured']:.0f} ({delta:+.2%}) · "
              f"{after['estimated_in_top']} estimated in the top tens · hits {before['hits']} -> "
              f"{after['hits']}")
        for row in entered:
            got = "never played" if row["surplus_act"] is None else f"{row['surplus_act']:+.1f} real"
            print(f"    {row['role']} #{row['rank']:<2} {row['name']:22} {row['basis']:15} "
                  f"conf {row['confidence']:.2f} · predicted {row['surplus_pred']:+.1f} · {got}")
    deltas = [w["captured_delta"] for w in block["windows"].values()]
    block["verdict"] = {
        "windows": len(deltas),
        "not_worse": sum(1 for d in deltas if d >= 0),
        "worst": round(min(deltas), 5) if deltas else 0.0,
        "mean": round(statistics.mean(deltas), 5) if deltas else 0.0,
        # the pre-registered condition: majority not worse AND no window losing more than 2%
        "keeps_them_in_the_ranking": bool(deltas) and sum(1 for d in deltas if d >= 0) * 2 >= len(deltas)
                                     and min(deltas) > -MAX_WINDOW_LOSS,
    }
    return block


def top_n_last(block: dict) -> int:
    """The last rank of a block's top ten - whoever an estimated man pushed out of it."""
    return len(block["predicted"])


def run(ctx: Context, **kwargs) -> None:
    platforms = kwargs.get("platform") or ["euro", "default"]
    game = kwargs.get("game") or "classic"
    metric = kwargs.get("metric") or evaluate.SURPLUS
    report = {"generated_at": dt.datetime.now(tz=dt.UTC).isoformat(timespec="seconds"),
              "max_window_loss": MAX_WINDOW_LOSS, "blocks": []}
    for platform in platforms:
        report["blocks"].append(check(ctx, platform, game, metric))
    for block in report["blocks"]:
        verdict = block["verdict"]
        print(f"[estimates] {block['platform']}/{block['game']}: not worse on "
              f"{verdict['not_worse']}/{verdict['windows']} windows · worst {verdict['worst']:+.2%} · "
              f"mean {verdict['mean']:+.2%} · "
              f"{'KEEP them in the ranking' if verdict['keeps_them_in_the_ranking'] else 'DO NOT rank them'}")
    if not kwargs.get("no_report"):
        path = ctx.config.data_dir / "reports" / "estimates_check.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"[estimates] report -> {path}")
