import numpy as np, pandas as pd, sys
sys.path.insert(0, r"D:/Projects/FantAssistant/toolkit")
from euroleghe_ingest.modules import fixtures as fx
src = open(r"C:/Users/aclem/AppData/Local/Temp/claude/d--Projects-FantAssistant/c4fd6b59-0778-450e-89af-ea60ee83ea7c/scratchpad/synthvote/ladder.py", encoding="utf-8").read()
exec(src.split("for mask, lab")[0])
d = d[d.mins >= 1].copy()
d["edge"] = [fx.edge(a, b, h >= 0.75) if h != 0.5 else a - b for a, b, h in zip(d.eloT, d.eloO, d.home)]
M = fx.EASY_MARGIN
d["diff"] = np.where(d.edge >= M, "facile", np.where(d.edge <= -M, "difficile", "media"))
d["res"] = np.where(d.W == 1, "V", np.where(d.L == 1, "P", "N"))
d["GAb"] = d.GA.clip(0, 3).astype(int).astype(str).replace("3", "3+")
d["GFb"] = d.GF.clip(0, 4).astype(int).astype(str).replace("4", "4+")
d["venue"] = np.where(d.home >= 0.75, "casa", np.where(d.home <= 0.25, "fuori", "?"))
print("easy margin", M, "home adv", fx.HOME_ADVANTAGE, "share easy/medium/hard", d["diff"].value_counts(normalize=True).round(3).to_dict())
def tab(col, order):
    out = []
    for r in "PDCA":
        x = d[d.role == r]; null = x.mv.mean()
        g = x.groupby(col).agg(n=("mv", "size"), voto=("mv", "mean"), fv=("fantavoto", "mean"))
        g["voto-null"] = g.voto - null
        g.index = [f"{r} {i}" for i in g.index]
        out.append(g.reindex([f"{r} {o}" for o in order]))
    t = pd.concat(out); print(f"\n-- per {col}"); print(t.round(2).to_string())
tab("GAb", ["0", "1", "2", "3+"]); tab("GFb", ["0", "1", "2", "3", "4+"]); tab("res", ["V", "N", "P"])
tab("venue", ["casa", "fuori"]); tab("diff", ["facile", "media", "difficile"])
# partial correlations controlling for the player's own bonuses and minutes
OWN = ["goals_all", "assists", "reds", "pen_missed", "own_goals", "yellows", "pen_saved", "m90", "started", "sub_short"]
def resid(y, X):
    A = np.column_stack([np.ones(len(X))] + [X[c].values for c in X.columns])
    return y - A @ np.linalg.lstsq(A, y, rcond=None)[0]
rows = []
for r in "PDCA":
    x = d[d.role == r]; X = x[[c for c in OWN if x[c].std() > 0]].astype(float)
    ry = resid(x.mv.values, X)
    for v in ["GF", "GA", "gd", "W", "L", "home", "edge"]:
        raw = np.corrcoef(x.mv, x[v].astype(float))[0, 1]
        par = np.corrcoef(ry, resid(x[v].astype(float).values, X))[0, 1]
        rows.append(dict(ruolo=r, var=v, r_grezza=raw, r_parziale=par))
print("\n-- correlazioni (parziale = al netto di gol/assist/cartellini/rigori/minuti propri)")
print(pd.DataFrame(rows).pivot(index="var", columns="ruolo", values=["r_grezza", "r_parziale"]).round(3).to_string())
# does difficulty move the vote AFTER the score is known?
print("\n-- la difficolta' dopo il risultato (coefficienti, voto; modello: eventi propri + minuti + V/P + diff reti + GF + GA)")
BASE = OWN + ["W", "L", "gd", "GFc", "GAc", "gd_m"]
d["easy"] = (d["diff"] == "facile").astype(float); d["hard"] = (d["diff"] == "difficile").astype(float); d["edge100"] = d.edge / 100
for pop, mask in [("Serie A", d.league == "serie_a"), ("Estero", d.league != "serie_a")]:
    res = []
    for r in "PDCA":
        x = d[mask & (d.role == r)]
        cols = [c for c in BASE + ["easy", "hard", "edge100"] if x[c].std() > 0]
        A = np.column_stack([np.ones(len(x))] + [x[c].astype(float).values for c in cols])
        w, *_ = np.linalg.lstsq(A, x.mv.values, rcond=None)
        e = x.mv.values - A @ w; sig = np.sqrt((e ** 2).sum() / (len(x) - A.shape[1]))
        se = sig * np.sqrt(np.diag(np.linalg.inv(A.T @ A)))
        co = dict(zip(["c"] + cols, zip(w, se)))
        res.append({"ruolo": r, **{k: f"{co[k][0]:+.3f} (t {co[k][0]/co[k][1]:+.1f})" for k in ["easy", "hard", "edge100", "W", "L", "gd"]}})
    print(pop); print(pd.DataFrame(res).to_string(index=False))
# LOSO MAE gain of adding easy/hard to L2 (no Elo) and to L3
for pop, mask in [("Estere", d.league != "serie_a"), ("Serie A", d.league == "serie_a")]:
    run(mask, pop, {"L2": L2, "L2+facile/difficile": L2 + ["easy", "hard"], "L2+edge": L2 + ["edge100"], "L3": L3})
