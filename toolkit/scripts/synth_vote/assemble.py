"""Assemble player-match rows: real vote + features obtainable without SofaScore. Read-only on a private DB copy."""
import sqlite3, sys, pandas as pd
sys.path.insert(0, r"D:/Projects/FantAssistant/toolkit")
from euroleghe_ingest.modules.snapshot import club_index

S = r"C:/Users/aclem/AppData/Local/Temp/claude/d--Projects-FantAssistant/c4fd6b59-0778-450e-89af-ea60ee83ea7c/scratchpad/synthvote"
c = sqlite3.connect(S + "/db.sqlite")
resolve = club_index(c)
canon2id = {n: i for i, n in c.execute("select fc_club_id, canonical_name from clubs")}
def club_id(name):
    key, canon = resolve(name)
    return canon2id.get(canon) if canon else None

LEAGUE_TM = {"serie_a": "IT1", "premier_league": "GB1", "la_liga": "ES1", "bundesliga": "L1", "ligue_1": "FR1"}

def load(platform, league, seasons):
    mr = pd.read_sql(f"""select fc_id, season, matchday, role, team, mv, goals, assists, assists_set_piece, own_goals,
        pen_scored, pen_missed, pen_saved, goals_conceded, yellows, reds, fantavoto
        from match_ratings where platform='{platform}' and status='played' and mv is not null
        and season in ({','.join("'%s'" % s for s in seasons)})""", c)
    if platform == "euro":
        mm = pd.read_sql(f"select season, euro_md as matchday, real_md from matchday_map where league='{league}'", c)
        mr = mr.merge(mm, on=["season", "matchday"], how="inner")
    else:
        mr["real_md"] = mr["matchday"]
    ex = pd.read_sql(f"""select fc_id, season, real_md, match_id, match_date, club, opponent, home, team_goals, opponent_goals,
        rating, shots, shots_on_target, key_passes, touches, big_chances_created, big_chances_missed, minutes as s_min,
        started as s_started, position as s_pos, xg, xa
        from external_match_stats where source='sofascore' and competition='{league}'""", c)
    ex = ex.drop_duplicates(["fc_id", "season", "real_md"], keep=False)
    d = mr.merge(ex, on=["fc_id", "season", "real_md"], how="inner")
    tm = pd.read_sql(f"""select fc_id, played_on as match_date, minutes as tm_min, is_starting as tm_start, position_id,
        goals as tm_goals, assists as tm_assists, yellows as tm_y, reds as tm_r, state, club_id as tm_club
        from tm_appearances where competition='{LEAGUE_TM[league]}'""", c)
    tm = tm.drop_duplicates(["fc_id", "match_date"], keep=False)
    d = d.merge(tm, on=["fc_id", "match_date"], how="left")
    d["league"] = league; d["platform"] = platform
    return d

frames = []
frames.append(load("default", "serie_a", [f"20{y}-{y+1}" for y in range(19, 26)]))
for lg in ["premier_league", "la_liga", "bundesliga", "ligue_1"]:
    frames.append(load("euro", lg, [f"20{y}-{y+1}" for y in range(19, 26)]))
d = pd.concat(frames, ignore_index=True)

# Elo: the pre-season snapshot (ex ante) of team and opponent, by club identity
elo = pd.read_sql("select fc_club_id, date, elo from club_elo", c)
elo["season"] = elo["date"].str[:4].astype(int).map(lambda y: f"{y}-{str(y+1)[2:]}")
elo = elo.sort_values("date").drop_duplicates(["fc_club_id", "season"], keep="first")
E = {(r.fc_club_id, r.season): r.elo for r in elo.itertuples()}
lev = {(k, y): e for k, y, e in c.execute("select club_key, year, elo from club_levels")}
def elo_of(name, season):
    cid = club_id(name)
    v = E.get((cid, season)) if cid else None
    if v is None:
        key, _ = resolve(name)
        from euroleghe_ingest.matching import club_key
        v = lev.get((key or club_key(name), season[:4]))
    return v
cache = {}
def ce(name, season):
    k = (name, season)
    if k not in cache: cache[k] = elo_of(name, season)
    return cache[k]
d["elo_team"] = [ce(n, s) for n, s in zip(d.club, d.season)]
d["elo_opp"] = [ce(n, s) for n, s in zip(d.opponent, d.season)]
d.to_pickle(S + "/rows.pkl")
print(d.groupby(["league"]).agg(n=("mv", "size"), tm=("tm_min", lambda x: x.notna().mean()),
      rating=("rating", lambda x: x.notna().mean()), eloT=("elo_team", lambda x: x.notna().mean()),
      eloO=("elo_opp", lambda x: x.notna().mean()), res=("team_goals", lambda x: x.notna().mean())))
print(d.groupby("season").size())
