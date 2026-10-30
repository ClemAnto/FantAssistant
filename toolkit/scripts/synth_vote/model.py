import numpy as np, pandas as pd, json, sqlite3
S = r"C:/Users/aclem/AppData/Local/Temp/claude/d--Projects-FantAssistant/c4fd6b59-0778-450e-89af-ea60ee83ea7c/scratchpad/synthvote"
d = pd.read_pickle(S + "/rows2.pkl")
d = d[d.GA.notna() & d.GF.notna()].copy()
d["mins"] = d.tm_min.fillna(d.s_min).fillna(0).clip(0, 90)
d["started"] = d.tm_start.fillna(d.s_started).fillna(0).astype(float)
d["home"] = d.home.fillna(0.5).astype(float)
gd = (d.GF - d.GA)
d["W"] = (gd > 0).astype(float); d["L"] = (gd < 0).astype(float); d["gd"] = gd.clip(-3, 3)
d["GFc"] = d.GF.clip(0, 5); d["GAc"] = d.GA.clip(0, 5)
d["eloT"] = d.elo_team.fillna(d.groupby("league").elo_team.transform("mean"))
d["eloO"] = d.elo_opp.fillna(d.groupby("league").elo_opp.transform("mean"))
d["elod"] = (d.eloT - d.eloO) / 100
d["elot"] = (d.eloT - 1700) / 100
d["m90"] = d.mins / 90; d["short"] = (d.mins <= 30).astype(float)
d["cs"] = ((d.GA == 0) & (d.mins >= 60)).astype(float)
d["gd_m"] = d.gd * d.m90
for col in ["shots", "shots_on_target", "key_passes", "touches", "big_chances_created", "big_chances_missed"]:
    d[col] = d[col].fillna(0)
pos = d.position_id.fillna(0).astype(int)
for p, name in [(4, "LB"), (5, "RB"), (6, "DM"), (8, "LM"), (9, "RM"), (10, "AM"), (11, "LW"), (12, "RW"), (13, "SS")]:
    d["pos_" + name] = (pos == p).astype(float)
# player prior: his mean real vote in the previous season, same platform (shrunk toward role mean)
c = sqlite3.connect(S + "/db.sqlite")
prev = pd.read_sql("select fc_id, platform, season, avg(mv) pm, count(*) n from match_ratings where status='played' and mv is not null group by 1,2,3", c)
prev["season"] = prev.season.map(lambda s: f"{int(s[:4])+1}-{str(int(s[:4])+2)[2:]}")
d = d.merge(prev, on=["fc_id", "platform", "season"], how="left")
rm = d.groupby("role").mv.transform("mean")
d["prior"] = ((d.pm - rm) * d.n / (d.n + 8)).fillna(0); d["has_prior"] = d.pm.notna().astype(float)

EV = ["goals", "pen_scored", "pen_missed", "assists", "own_goals", "yellows", "reds"]
B = ["W", "L", "gd"]
M1 = B + ["home", "GFc", "GAc", "elod", "elot", "started", "m90", "short", "gd_m"] + EV
POS = [c for c in d.columns if c.startswith("pos_")]
SETS = {
 "a_role": [], "b_result": B, "M1": M1, "M1pos": M1 + POS, "M1prior": M1 + POS + ["prior", "has_prior"],
 "M2_espn": M1 + POS + ["shots", "shots_on_target"], "M2prior": M1 + POS + ["shots", "shots_on_target", "prior", "has_prior"],
 "M3_sofaonly": M1 + POS + ["shots", "shots_on_target", "key_passes", "touches", "big_chances_created", "big_chances_missed"],
 "c_rating": ["rating"], "c2_rating_ev": ["rating"] + EV + B,
}
KEEPER_EXTRA = ["pen_saved", "cs"]

def X(df, feats, role):
    f = list(feats) + (KEEPER_EXTRA if role == "P" and feats else [])
    f = [x for x in f if not (role == "P" and x in ("goals", "pen_scored", "pen_missed", "assists"))]
    return np.column_stack([np.ones(len(df))] + [df[x].astype(float).values for x in f]), f

def fit(df, feats, role, lam=1.0):
    A, f = X(df, feats, role); y = df.mv.values
    reg = lam * np.eye(A.shape[1]); reg[0, 0] = 0
    w = np.linalg.solve(A.T @ A + reg, A.T @ y)
    return w, f

def predict(df, feats, role, w):
    A, _ = X(df, feats, role); return A @ w

def evaluate(train_mask, test_mask, name):
    out = {}
    for s in sorted(d.season.unique()):
        tr = d[train_mask & (d.season != s) & d.rating.notna()]; te = d[test_mask & (d.season == s) & d.rating.notna()]
        if len(te) == 0: continue
        for key, feats in SETS.items():
            pred = pd.Series(index=te.index, dtype=float)
            for role in "PDCA":
                w, _ = fit(tr[tr.role == role], feats, role)
                t = te[te.role == role]; pred[t.index] = predict(t, feats, role, w)
            e = pred - te.mv
            r = (np.round(pred * 2) / 2) - te.mv
            out.setdefault(key, []).append(dict(season=s, n=len(te), mae=e.abs().mean(), mae_r=r.abs().mean(),
                bias=e.mean(), within=(e.abs() <= 0.5).mean(),
                fv=( (pred + (te.fantavoto - te.mv)) - te.fantavoto).abs().mean(),
                **{f"mae_{ro}": e[te.role == ro].abs().mean() for ro in "PDCA"}))
    res = {k: pd.DataFrame(v) for k, v in out.items()}
    summ = pd.DataFrame({k: v[["mae", "mae_r", "bias", "within", "mae_P", "mae_D", "mae_C", "mae_A"]].mean() for k, v in res.items()}).T
    per = pd.DataFrame({k: v.set_index("season").mae for k, v in res.items()})
    print(f"\n=== {name} (rows {int(test_mask.sum())}) ==="); print(summ.round(3)); print(per.round(3))
    return res
seriea = d.league == "serie_a"; foreign = d.league != "serie_a"
R = {}
R["seriea"] = evaluate(seriea, seriea, "Serie A, LOSO")
R["foreign"] = evaluate(foreign, foreign, "Estere euro, LOSO (fit sulle estere)")
R["transfer"] = evaluate(seriea, foreign, "Transfer: fit Serie A, test estere")
R["pooled"] = evaluate(seriea | foreign, foreign, "Fit Serie A + estere, test estere")
pd.to_pickle(R, S + "/results.pkl")
# final coefficients of the shippable set (pooled fit, all seasons)
co = {}
for role in "PDCA":
    w, f = fit(d[d.role == role], SETS["M1pos"], role); co[role] = dict(zip(["intercept"] + f, np.round(w, 4)))
json.dump(co, open(S + "/coef_M1pos.json", "w"), indent=1)
print(json.dumps(co, indent=1)[:3000])
