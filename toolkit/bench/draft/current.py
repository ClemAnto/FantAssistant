"""The CURRENT listone as a bench window, for showing a simulated draft on names that exist today.

Not a measurement - there is no outcome, the season is being played - so it carries no votes: it exists to
LOOK at what a policy builds (`show.mjs`). Read-only on the DB, written in explicit UTF-8, not in git.

    python current.py current.json [EuroLeghe]

Prices are the listone's CURRENT FVM in the game's currency: at a real draft that is both the price and
what sets the next round's order. The predictions are the sheet's own (`engine_*`, falling back on `est_*`),
on the platform's remaining calendar.
"""
import gzip
import json
import sys

from euroleghe_ingest.config import Config
from euroleghe_ingest.db.database import connect
from euroleghe_ingest.matching import club_identity

OUT = sys.argv[1]
LEAGUE = sys.argv[2] if len(sys.argv) > 2 else "EuroLeghe"
cfg = Config()
setup = cfg.load_league(LEAGUE)
manifest = json.load(open(cfg.data_dir / "export" / "2026-27" / "manifest.json", encoding="utf-8"))
entry = next(s for s in manifest["engine_sheets"] if s["league"] == LEAGUE)
sheet = json.load(gzip.open(cfg.data_dir / "export" / "2026-27" / entry["path"]))
cols = sheet["columns"]
rows = [dict(zip(cols, r)) for r in sheet["rows"]]
season, platform = sheet["target_season"], sheet["platform"]
mantra = sheet["game"] == "mantra"
rounds = sheet["matchdays"]["platform_target"]
conn = connect(cfg.db_path)
fvm_col = "fvm_mantra" if mantra else "fvm"
fvm = {fc: v for fc, v in conn.execute(
    f"select fc_id, {fvm_col} from listone_quotes where season=? and platform=? and {fvm_col} is not null",
    (season, platform))}
steady = {fc: round(rate, 4) for fc, n, rate in conn.execute(
    "select fc_id, count(*), avg(case when mv >= 6 then 1.0 else 0.0 end) from match_ratings"
    " where platform=? and mv is not null group by fc_id having count(*) >= 15", (platform,))}

men = []
for r in rows:
    if r["league"] == "serie_a":
        continue
    fm = r["engine_fm_pred"] if r["engine_fm_pred"] is not None else r["est_fm"]
    pv = r["engine_pv_pred"] if r["engine_pv_pred"] is not None else r["est_pv"]
    price = fvm.get(r["fc_id"])
    roles = [x.strip().lower() for x in (r.get("roles_mantra") or "").replace(",", ";").split(";") if x.strip()]
    if fm is None or pv is None or not price or not roles:
        continue
    men.append({"id": r["fc_id"], "name": r["name"], "club": r["club"], "league": r["league"],
                "slot": roles[0], "roles": roles, "price": float(price), "fm_pred": float(fm),
                "pv_pred": float(pv), "steady": steady.get(r["fc_id"]),
                "surplus": float(r["engine_surplus"] if r["engine_surplus"] is not None else (r["est_surplus"] or 0))})

keeper = "por" if mantra else "p"
by_club = {}
for m in men:
    if m["slot"] == keeper:
        by_club.setdefault(club_identity(m["club"]), []).append(m)
players = [m for m in men if m["slot"] != keeper]
for i, (key, ks) in enumerate(sorted(by_club.items())):
    apps = sum(k["pv_pred"] for k in ks if k["pv_pred"] > 0)
    if not apps:
        continue
    starter = max(ks, key=lambda k: k["price"])
    st = [k for k in ks if k["steady"] is not None and k["pv_pred"] > 0]
    sa = sum(k["pv_pred"] for k in st)
    players.append({
        "id": -(i + 1), "name": f"Porta {ks[0]['club']}", "club": ks[0]["club"], "league": ks[0]["league"],
        "slot": keeper, "roles": [keeper], "price": starter["price"], "starter": starter["name"],
        "fm_pred": sum(k["fm_pred"] * k["pv_pred"] for k in ks) / apps, "pv_pred": min(float(rounds), apps),
        "steady": round(sum(k["steady"] * k["pv_pred"] for k in st) / sa, 4) if sa else None,
        # A door's surplus is its keepers' summed: the appearances of a club's keepers add up to one shirt.
        "surplus": sum(k["surplus"] for k in ks),
    })
for p in players:
    p["value"] = p["fm_pred"] * p["pv_pred"]
out = {"NOW": {"league": LEAGUE, "platform": platform, "game": sheet["game"], "input": season,
               "target": season, "rounds": rounds, "players": players, "others": [], "votes": {}, "base": {}}}
with open(OUT, "w", encoding="utf-8") as handle:
    json.dump(out, handle, ensure_ascii=False)
print(f"{LEAGUE} {season}: {len(players)} priced ({sum(p['slot'] == keeper for p in players)} doors),"
      f" {rounds} matchdays left, sheet revision {sheet['sheet_revision']}")
