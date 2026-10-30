import numpy as np, pandas as pd, json
src = open(r"C:/Users/aclem/AppData/Local/Temp/claude/d--Projects-FantAssistant/c4fd6b59-0778-450e-89af-ea60ee83ea7c/scratchpad/synthvote/ladder.py", encoding="utf-8").read()
exec(src.split("for mask, lab")[0])
TMONLY = [x for x in L3 if x not in ("pen_missed", "own_goals", "pen_saved")]
for mask, lab in [(d.league != "serie_a", "Estere"), (d.league == "serie_a", "Serie A")]:
    run(mask, lab, {"L3": L3, "L3 solo TM": TMONLY})
pool = d[d.rating.notna()]
co = {}
for role in "PDCA":
    ff = feats_for(L3, role); w = fitp(pool[pool.role == role], ff); co[role] = dict(zip(["base"] + ff, [round(float(x), 3) for x in w]))
json.dump(co, open(S + "/coef_L3.json", "w"), indent=1)
print(pd.DataFrame(co).round(3).to_string())
print("rows", len(pool), pool.league.value_counts().to_dict())
