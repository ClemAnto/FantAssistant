import sqlite3, sys, pandas as pd
sys.path.insert(0, r"D:/Projects/FantAssistant/toolkit")
from euroleghe_ingest.modules.snapshot import club_index
S = r"C:/Users/aclem/AppData/Local/Temp/claude/d--Projects-FantAssistant/c4fd6b59-0778-450e-89af-ea60ee83ea7c/scratchpad/synthvote"
c = sqlite3.connect(S + "/db.sqlite"); resolve = club_index(c)
d = pd.read_pickle(S + "/rows.pkl")
mr = pd.read_sql("select platform, season, matchday, team, role, goals, pen_scored, own_goals, goals_conceded, status from match_ratings where season >= '2019-20'", c)
keyof = {}
def k(n):
    if n not in keyof: keyof[n] = resolve(n)[0]
    return keyof[n]
mr["ck"] = mr.team.map(k)
g = mr.groupby(["platform", "season", "matchday", "ck"])
T = pd.DataFrame({"scored": g.goals.sum() + g.pen_scored.sum(), "og": g.own_goals.sum(),
                  "ga": mr[(mr.role == "P") & (mr.status == "played")].groupby(["platform", "season", "matchday", "ck"]).goals_conceded.sum()}).reset_index()
d["ck"] = d.team.map(k); d["ok"] = d.opponent.map(k)
d = d.merge(T.rename(columns={"ck": "ck"}), on=["platform", "season", "matchday", "ck"], how="left")
O = T.rename(columns={"ck": "ok", "scored": "o_scored", "og": "o_og", "ga": "o_ga"})
d = d.merge(O, on=["platform", "season", "matchday", "ok"], how="left")
# goals against: our keeper's conceded (the vote sheet's own count); goals for: our scorers + opponent own goals, else opponent keeper's conceded
d["GA"] = d.ga
d["GF"] = d.o_ga.where(d.o_ga.notna(), d.scored + d.o_og.fillna(0))
print(d.groupby("league").agg(GA=("GA", lambda x: x.notna().mean()), GF=("GF", lambda x: x.notna().mean()), oppvoted=("o_ga", lambda x: x.notna().mean())))
# consistency where both sides known: GF from opponent keeper vs our scorers + their own goals
m = d.o_ga.notna()
print("GF agreement", ((d.o_ga[m] == d.scored[m] + d.o_og[m])).mean())
d.to_pickle(S + "/rows2.pkl")
