import numpy as np, pandas as pd
src = open(r"C:/Users/aclem/AppData/Local/Temp/claude/d--Projects-FantAssistant/c4fd6b59-0778-450e-89af-ea60ee83ea7c/scratchpad/synthvote/ladder.py", encoding="utf-8").read()
exec(src.split("for mask, lab")[0])
t = d[d.tm_goals.notna()]
print("agreement TM vs fantacalcio: goals(incl pen)", (t.tm_goals == t.goals_all).mean().round(4),
      "assists", (t.tm_assists == t.assists).mean().round(4), "yellows", (t.tm_y == t.yellows).mean().round(4),
      "reds", (t.tm_r == t.reds).mean().round(4))
print(pd.crosstab(t.assists, t.tm_assists).iloc[:3, :3])
# fit on fantacalcio events, PREDICT with TM-sourced events (the realistic input), pens/own goals kept (ESPN keyEvents)
TMd = d.copy()
m = TMd.tm_goals.notna()
TMd.loc[m, "goals_all"] = TMd.loc[m, "tm_goals"]
TMd.loc[m, "assists"] = TMd.loc[m, "tm_assists"]
TMd.loc[m, "yellows"] = TMd.loc[m, "tm_y"]; TMd.loc[m, "reds"] = TMd.loc[m, "tm_r"]
rows = []
for mask_name in ["serie_a", "foreign"]:
    mask = (d.league == "serie_a") if mask_name == "serie_a" else (d.league != "serie_a")
    for s in sorted(d[mask].season.unique()):
        tr = d[mask & (d.season != s) & d.rating.notna()]; te_idx = d[mask & (d.season == s) & d.rating.notna()].index
        for src_name, frame in [("eventi fantacalcio", d), ("eventi Transfermarkt", TMd)]:
            te = frame.loc[te_idx]; p = pd.Series(index=te.index, dtype=float)
            for role in "PDCA":
                ff = feats_for(L3, role); w = fitp(tr[tr.role == role], ff); tt = te[te.role == role]; p[tt.index] = predp(tt, ff, w)
            rows.append(dict(pop=mask_name, src=src_name, season=s, mae=(p - te.mv).abs().mean()))
print(pd.DataFrame(rows).groupby(["pop", "src"]).mae.agg(["mean", "max"]).round(3))
