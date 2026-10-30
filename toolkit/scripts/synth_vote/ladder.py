import numpy as np, pandas as pd
src = open(r"C:/Users/aclem/AppData/Local/Temp/claude/d--Projects-FantAssistant/c4fd6b59-0778-450e-89af-ea60ee83ea7c/scratchpad/synthvote/operator.py", encoding="utf-8").read()
exec(src.split("sets = {")[0])
L0 = EXT
L1 = L0 + ["gd", "GFc", "GAc"]
L2 = L1 + ["m90", "started", "gd_m"]
L3 = L2 + ["elod", "elot", "home"]
L4 = L3 + ["shots", "shots_on_target"]
L5 = L3 + ["rating"]
ladder = {"L0 operatore esteso": L0, "L1 +margine/gol": L1, "L2 +minuti": L2, "L3 +Elo/casa": L3, "L4 +tiri (ESPN)": L4, "L5 +rating (rif.)": L5}
for mask, lab in [(d.league != "serie_a", "Estere"), (d.league == "serie_a", "Serie A")]:
    r = run(mask, lab, ladder)
