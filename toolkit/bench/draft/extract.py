"""Extracts the measurable windows a draft bench needs, for ONE declared league.

Per window: the PRICE (the listone's Qt.I in the league's own currency - the only quotation that does not
know the outcome), the VALUE and the SURPLUS the engine predicts (parameters cross-fit on an adjacent
window, exactly as the gate does it), the complete roles, the season's outcome and the FANTAVOTO matchday
by matchday.

This is NOT a gate path: it reads the DB and writes a working file, nothing else. The file it writes is
kept out of git - it carries names, prices and votes of paid fantacalcio.it content - so it is meant to be
regenerated (about two minutes) rather than stored.

    python extract.py windows.json                 # the league's default: EuroLeghe (euro/mantra)
    python extract.py serie-a.json "Leghe Mantra"  # any league declared in config/league_config.json
"""
import json
import sys

from euroleghe_ingest.config import Config
from euroleghe_ingest.db.database import connect
from euroleghe_ingest.engine import evaluate, features

OUT = sys.argv[1]
LEAGUE = sys.argv[2] if len(sys.argv) > 2 else "EuroLeghe"

# Which windows a platform can actually be measured on. euro: the authenticated votes API turned out to
# serve seasons the Drive datasets never covered, and EuroLeghe 21/22 is empty AT THE SOURCE, which costs
# euro two windows. `default` has the full ten (see CLAUDE.md, «the gate now runs on 10 windows»).
AVAILABLE = {
    "euro": ("Tm4", "Tm3", "T0", "T1", "T2"),
    "default": ("Tm7", "Tm6", "Tm5", "Tm4", "Tm3", "Tm2", "Tm1", "T0", "T1", "T2"),
}

cfg = Config()
conn = connect(cfg.db_path)
setup = cfg.load_league(LEAGUE)
platform, game = setup["platform"], setup["game"]
windows = AVAILABLE[platform]
mantra = game == "mantra"

# The price is the pre-auction quotation IN THE CURRENCY THE GAME IS PLAYED IN. Mixing the two would be
# comparing a bid against an ask from another game: 904 of 916 surplus values differ between them.
price_column = "price_initial_mantra" if mantra else "price_initial"
fvm_column = "fvm_mantra" if mantra else "fvm"

print(f'league "{LEAGUE}": platform={platform} game={game}, windows {", ".join(windows)}', flush=True)
out = {}

for key in windows:
    win = features.WINDOWS[key]
    data = features.prepare(conn, win, platform, game, league=setup)
    source = features.cross_fit_source(key, windows)
    params = evaluate.fit_params(
        features.prepare(conn, features.WINDOWS[source], platform, game),
        ("R0", *evaluate.CANDIDATES),
    )
    preds = evaluate.predict_window(data, ("R0", *evaluate.ADOPTED[platform]), None, params)
    quotes = {
        fc: (qi, fvm)
        for fc, qi, fvm in conn.execute(
            f"select fc_id, {price_column}, {fvm_column} from listone_quotes"
            f" where season=? and platform=? and {price_column} is not null",
            (win.target_season, platform),
        )
    }
    rows = []
    for pred in preds:
        obs = pred.obs
        if mantra:
            roles = [r.lower() for r in (obs.roles_mantra or ()) if r]
        else:
            roles = []
        slot = roles[0] if roles else (obs.role_classic or "").lower()
        rep = (data.replacement or {}).get(slot)
        pair = quotes.get(obs.fc_id)
        price = pair[0] if pair else None
        if not price or rep is None or pred.fm_pred is None or pred.pv_pred is None:
            continue
        if obs.fm_act is None or obs.pv_act is None:
            continue
        rows.append({
            "id": obs.fc_id, "name": obs.name, "slot": slot, "roles": roles or [slot],
            "price": float(price),
            "fvm": float(pair[1]) if pair[1] else None,      # ARCHIVED: it has already seen the season
            "fm_prev": float(obs.fm_prev) if obs.fm_prev is not None else None,
            "surplus": (pred.fm_pred - rep) * pred.pv_pred,
            "value": pred.fm_pred * pred.pv_pred,
            # The two halves separately, because «which of the two is the bottleneck» is a question about
            # them and not about their product (todolist item 2.1, whose answer rested on ONE window).
            "fm_pred": float(pred.fm_pred),
            "pv_pred": float(pred.pv_pred),
            "fm_act": float(obs.fm_act),
            "pv_act": float(obs.pv_act),
            "actual": float(obs.fm_act) * float(obs.pv_act),
        })
    ids = {r["id"] for r in rows}
    votes = {}
    rounds = 0
    for fc, md, fv in conn.execute(
        "select fc_id, matchday, fantavoto from match_ratings"
        " where season=? and platform=? and fantavoto is not null",
        (win.target_season, platform),
    ):
        rounds = max(rounds, int(md))
        if fc in ids:
            votes.setdefault(str(fc), {})[str(md)] = round(float(fv), 2)
    out[key] = {
        "league": LEAGUE, "platform": platform, "game": game,
        "input": win.input_season, "target": win.target_season, "cross_fit": source,
        "rounds": rounds, "players": rows, "votes": votes,
    }
    print(f"{key}: {win.input_season} -> {win.target_season}, cross-fit on {source},"
          f" {len(rows)} players, {rounds} matchdays, {len(votes)} with votes", flush=True)

# UTF-8 explicitly: without it Windows writes cp1252 and every accented name comes back mangled
# to a UTF-8 reader (the scratchpad version had this defect - harmless for the numbers, and it
# still means the file cannot be re-read by the script that wrote it).
with open(OUT, "w", encoding="utf-8") as handle:
    json.dump(out, handle, ensure_ascii=False)
print(f"written {OUT}")
