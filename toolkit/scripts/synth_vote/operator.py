import numpy as np, pandas as pd, json
exec(open(r"C:/Users/aclem/AppData/Local/Temp/claude/d--Projects-FantAssistant/c4fd6b59-0778-450e-89af-ea60ee83ea7c/scratchpad/synthvote/model.py", encoding="utf-8").read().split("EV = [")[0])
d["goals_all"] = d.goals + d.pen_scored
d["manyGA"] = (d.GA >= 3).astype(float); d["manyGF"] = (d.GF >= 3).astype(float)
d["sub_short"] = ((d.started == 0) & (d.mins <= 30)).astype(float)
d["gk_ga"] = np.where(d.role == "P", d.goals_conceded, 0)
d["cs_dp"] = np.where(d.role.isin(["D", "P"]), d.cs, 0)

def m0(df):  # the operator's declared rule, literal, untuned
    v = 6 + 1.0 * df.goals_all + 0.5 * df.assists
    v = v - 1.0 * ((df.role == "D") & (df.GA >= 3))
    v = v + 0.5 * ((df.role == "C") & (df.GF >= 3))
    return v

STRUCT = ["goals_all", "assists", "manyGA", "manyGF"]
EXT = STRUCT + ["reds", "pen_missed", "own_goals", "yellows", "cs_dp", "gk_ga", "pen_saved", "sub_short", "W", "L"]
def fitp(df, f, lam=1.0):
    A = np.column_stack([np.ones(len(df))] + [df[x].astype(float).values for x in f])
    reg = lam * np.eye(A.shape[1]); reg[0, 0] = 0
    return np.linalg.solve(A.T @ A + reg, A.T @ df.mv.values)
def predp(df, f, w):
    return np.column_stack([np.ones(len(df))] + [df[x].astype(float).values for x in f]) @ w
def feats_for(f, role):
    drop = {"P": {"goals_all", "assists", "manyGF"}}.get(role, set()) | ({"gk_ga", "pen_saved"} if role != "P" else set())
    return [x for x in f if x not in drop]

def run(mask, label, sets):
    rows = []
    for s in sorted(d[mask].season.unique()):
        tr = d[mask & (d.season != s) & d.rating.notna()]; te = d[mask & (d.season == s) & d.rating.notna()]
        preds = {"M0_operatore": m0(te)}
        for name, f in sets.items():
            p = pd.Series(index=te.index, dtype=float)
            for role in "PDCA":
                ff = feats_for(f, role); w = fitp(tr[tr.role == role], ff)
                t = te[te.role == role]; p[t.index] = predp(t, ff, w)
            preds[name] = p
        for name, p in preds.items():
            e = p - te.mv
            rows.append(dict(model=name, season=s, mae=e.abs().mean(), mae_r=((np.round(p*2)/2)-te.mv).abs().mean(),
                             bias=e.mean(), within=(e.abs() <= 0.5).mean(),
                             **{f"mae_{r}": e[te.role == r].abs().mean() for r in "PDCA"}))
    r = pd.DataFrame(rows)
    print(f"\n=== {label}"); print(r.groupby("model")[["mae", "mae_r", "bias", "within", "mae_P", "mae_D", "mae_C", "mae_A"]].mean().round(3).to_string())
    print(r.pivot(index="season", columns="model", values="mae").round(3).to_string())
    return r
sets = {"M0_fit": STRUCT, "M0ext_fit": EXT}
for nm, f in [("noRES", [x for x in EXT if x not in ("W", "L", "manyGA", "manyGF")])]: sets[nm] = f
seriea = d.league == "serie_a"; foreign = ~seriea
ra = run(seriea, "Serie A LOSO", sets); rf = run(foreign, "Estere LOSO", sets)
# drop-one on the extended structure, foreign, LOSO
imp = {}
base = rf[rf.model == "M0ext_fit"].mae.mean()
for x in EXT:
    r = run(foreign, f"drop {x}", {"m": [y for y in EXT if y != x]}) if False else None
pd.to_pickle((ra, rf), S + "/operator_res.pkl")
# full-sample coefficients, per role
co = {}
for role in "PDCA":
    for nm, f in [("M0_fit", STRUCT), ("M0ext_fit", EXT)]:
        ff = feats_for(f, role); w = fitp(d[(d.role == role) & d.rating.notna()], ff)
        co.setdefault(nm, {})[role] = dict(zip(["base"] + ff, np.round(w, 3)))
json.dump(co, open(S + "/coef_operator.json", "w"), indent=1)
for nm in co:
    print("\n", nm); print(pd.DataFrame(co[nm]).round(2).to_string())
