"""Step 3: the SECOND structured source - FotMob's squads, positions, injuries with expected return, and the coach.

Its public team API answered 200 on 28/09/2026 for all 37 clubs (Sofascore, FBref, ESPN and kicker did not).
It disagrees with Transfermarkt in both directions and that is why it is read: TM keeps late-window departures,
FotMob is vaguer on returns («Doubtful», «Mid October»). Writes `fm_data.json`.
"""
import json, os, pathlib, subprocess, time

REPO = pathlib.Path(__file__).resolve().parents[3]
WORK = pathlib.Path(os.environ.get("PRESS_SURVEY_DIR", REPO / "data" / "reports" / "press_survey"))
(WORK / "fm").mkdir(parents=True, exist_ok=True)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
# listone club name -> FotMob team id (read from the league tables, /api/data/leagues?id=47|55|54|87|53)
FM = {"Arsenal": 9825, "Aston Villa": 10252, "Bournemouth": 8678, "Brighton": 10204, "Chelsea": 8455,
      "Liverpool": 8650, "Manchester City": 8456, "Manchester United": 10260, "Newcastle": 10261,
      "Tottenham": 8586, "Atalanta": 8524, "Bologna": 9857, "Como": 10171, "Fiorentina": 8535, "Inter": 8636,
      "Juventus": 9885, "Lazio": 8543, "Milan": 8564, "Napoli": 9875, "Roma": 8686, "Bayer Leverkusen": 8178,
      "Bayern Monaco": 9823, "Borussia Dortmund": 9789, "Eintracht": 9810, "Lipsia": 178475,
      "Stoccarda": 10269, "Athletic Bilbao": 8315, "Atletico Madrid": 9906, "Barcellona": 8634, "Betis": 8603,
      "Real Madrid": 8633, "Villarreal": 10205, "Monaco": 9829, "Olympique Marsiglia": 8592,
      "Paris Saint-Germain": 9847, "Racing Strasburgo": 9848, "Rennes": 9851}

out = {}
for club, team in FM.items():
    raw = subprocess.run(["curl", "-s", "-A", UA, "--max-time", "40",
                          f"https://www.fotmob.com/api/data/teams?id={team}"], capture_output=True).stdout
    (WORK / "fm" / f"{team}.json").write_bytes(raw)
    try:
        data = json.loads(raw.decode("utf-8"))
    except ValueError as exc:
        print("FAIL", club, exc)
        continue
    squad, coach = [], None
    for group in data["squad"]["squad"]:
        if group["title"] == "coach":
            coach = group["members"][0]["name"] if group["members"] else None
            continue
        for m in group["members"]:
            squad.append(dict(id=m["id"], name=m["name"], pos=m.get("positionIdsDesc"), role=group["title"],
                              injured=bool(m.get("injured")), injury=m.get("injury"), rating=m.get("rating"),
                              age=m.get("age"), goals=m.get("goals"), assists=m.get("assists"),
                              value=m.get("transferValue")))
    out[club] = dict(fm_id=team, name=data["details"]["name"], coach=coach, squad=squad)
    print(club, len(squad), "injured", sum(x["injured"] for x in squad), "coach", coach, flush=True)
    time.sleep(2)
(WORK / "fm_data.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
