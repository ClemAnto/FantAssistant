"""Scrape Transfermarkt for the 37 EuroLeghe clubs: squad usage (all comps + league, this season and last),
injuries, fixtures. Read-only on the project; writes only into this scratchpad folder."""
import os, json, re, subprocess, sys, time, pathlib
from bs4 import BeautifulSoup

REPO = pathlib.Path(__file__).resolve().parents[3]
# Everything these scripts WRITE carries names, FVM and paid-source pages, and the repository is public, so
# it lives under data/reports/ (gitignored) and never next to the code.
WORK = pathlib.Path(os.environ.get("PRESS_SURVEY_DIR", REPO / "data" / "reports" / "press_survey"))
WORK.mkdir(parents=True, exist_ok=True)
RAW = WORK / "raw"; RAW.mkdir(exist_ok=True)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"

CLUBS = {  # listone name -> (tm id, league code)
    "Arsenal": (11, "GB1"), "Aston Villa": (405, "GB1"), "Bournemouth": (989, "GB1"), "Brighton": (1237, "GB1"),
    "Chelsea": (631, "GB1"), "Liverpool": (31, "GB1"), "Manchester City": (281, "GB1"),
    "Manchester United": (985, "GB1"), "Newcastle": (762, "GB1"), "Tottenham": (148, "GB1"),
    "Atalanta": (800, "IT1"), "Bologna": (1025, "IT1"), "Como": (1047, "IT1"), "Fiorentina": (430, "IT1"),
    "Inter": (46, "IT1"), "Juventus": (506, "IT1"), "Lazio": (398, "IT1"), "Milan": (5, "IT1"),
    "Napoli": (6195, "IT1"), "Roma": (12, "IT1"),
    "Bayer Leverkusen": (15, "L1"), "Bayern Monaco": (27, "L1"), "Borussia Dortmund": (16, "L1"),
    "Eintracht": (24, "L1"), "Lipsia": (23826, "L1"), "Stoccarda": (79, "L1"),
    "Athletic Bilbao": (621, "ES1"), "Atletico Madrid": (13, "ES1"), "Barcellona": (131, "ES1"),
    "Betis": (150, "ES1"), "Real Madrid": (418, "ES1"), "Villarreal": (1050, "ES1"),
    "Monaco": (162, "FR1"), "Olympique Marsiglia": (244, "FR1"), "Paris Saint-Germain": (583, "FR1"),
    "Racing Strasburgo": (667, "FR1"), "Rennes": (273, "FR1"),
}
refusals = 0


def get(url, name):
    global refusals
    f = RAW / name
    if f.exists() and f.stat().st_size > 20000:
        return f.read_text(encoding="utf-8", errors="replace")
    for attempt in range(3):
        r = subprocess.run(["curl", "-s", "-A", UA, "--max-time", "40", "-w", "%{http_code}", url],
                           capture_output=True)
        code = r.stdout[-3:].decode()
        body = r.stdout[:-3].decode("utf-8", errors="replace")
        time.sleep(3)
        if code == "200" and len(body) > 20000:
            refusals = 0
            f.write_text(body, encoding="utf-8")
            return body
        print(f"  ! {code} len={len(body)} {url}", flush=True)
    refusals += 1
    if refusals >= 5:
        sys.exit("five refusals in a row - abandoning the sweep")
    return None


def num(t):
    t = t.strip().replace("'", "").replace(".", "")
    return int(t) if t.isdigit() else 0


def perf(body):
    s = BeautifulSoup(body, "html.parser")
    title = s.title.text if s.title else ""
    tab = s.select_one("table.items")
    out = {}
    if not tab:
        return title, out
    for tr in tab.select(":scope > tbody > tr"):
        a = tr.select_one("td.hauptlink a[href*='/spieler/']")
        if not a:
            continue
        pid = int(re.search(r"/spieler/(\d+)", a["href"]).group(1))
        inl = tr.select_one("table.inline-table")
        pos = inl.select("tr")[-1].get_text(" ", strip=True) if inl else ""
        cells = [c.get_text(" ", strip=True) for c in tr.find_all("td", recursive=False)]
        # cells: [#, player(inline), age, nat, in squad, apps, g, a, y, 2y, r, on, off, ppg, min]
        z = cells[-11:]  # in squad, apps, g, a, y, 2y, r, on, off, ppg, minutes
        not_used = any("Not used" in c or "Not in squad" in c for c in cells)
        row = dict(name=a.get("title") or a.text, pos=pos, age=cells[2] if len(cells) > 2 else "")
        if not_used:
            row.update(squad=num(cells[4]) if len(cells) > 4 else 0, apps=0, goals=0, assists=0,
                       on=0, off=0, minutes=0, note=next(c for c in cells if "Not" in c))
        else:
            row.update(squad=num(z[0]), apps=num(z[1]), goals=num(z[2]), assists=num(z[3]),
                       on=num(z[7]), off=num(z[8]), minutes=num(z[10]))
        out[pid] = row
    return title, out


def injuries(body):
    s = BeautifulSoup(body, "html.parser")
    rows = []
    tab = s.select_one("table.items")
    if not tab:
        return rows
    for tr in tab.select(":scope > tbody > tr"):
        a = tr.select_one("td.hauptlink a[href*='/spieler/']")
        if not a:
            continue
        cells = [c.get_text(" ", strip=True) for c in tr.find_all("td", recursive=False)]
        pid = int(re.search(r"/spieler/(\d+)", a["href"]).group(1))
        rows.append(dict(pid=pid, name=a.get("title") or a.text, cells=cells[-5:]))
    return rows


def fixtures(body):
    s = BeautifulSoup(body, "html.parser")
    comp, out = None, []
    for tr in s.select("div.responsive-table table tbody tr"):
        tds = [c.get_text(" ", strip=True) for c in tr.find_all("td")]
        if len(tds) == 1:
            comp = tds[0]; continue
        if len(tds) < 8:
            continue
        m = re.search(r"(\d\d)/(\d\d)/(\d\d)", tds[1])
        if not m:
            continue
        date = f"20{m.group(3)}-{m.group(2)}-{m.group(1)}"
        res = tds[-1]
        out.append(dict(comp=comp, round=tds[0], date=date, venue=tds[3], opp=tds[6],
                        result=res, played=bool(re.match(r"^\d+:\d+", res))))
    return out


data = {}
for club, (cid, lg) in CLUBS.items():
    print(club, flush=True)
    base = f"https://www.transfermarkt.com/x"
    t_all, all26 = perf(get(f"{base}/leistungsdaten/verein/{cid}/plus/1?reldata=%262026", f"{cid}_all26.html") or "")
    _, lg26 = perf(get(f"{base}/leistungsdaten/verein/{cid}/plus/1?reldata={lg}%262026", f"{cid}_lg26.html") or "")
    _, all25 = perf(get(f"{base}/leistungsdaten/verein/{cid}/plus/1?reldata=%262025", f"{cid}_all25.html") or "")
    _, lg25 = perf(get(f"{base}/leistungsdaten/verein/{cid}/plus/1?reldata={lg}%262025", f"{cid}_lg25.html") or "")
    inj = injuries(get(f"{base}/sperrenundverletzungen/verein/{cid}", f"{cid}_inj.html") or "")
    fx = fixtures(get(f"{base}/spielplandatum/verein/{cid}/saison_id/2026", f"{cid}_fix.html") or "")
    print(f"  {t_all[:50]!r} squad={len(all26)} inj={len(inj)} fixtures={len(fx)} played={sum(f['played'] for f in fx)}",
          flush=True)
    data[club] = dict(tm_id=cid, league=lg, title=t_all, all26=all26, lg26=lg26, all25=all25, lg25=lg25,
                      injuries=inj, fixtures=fx)
    (WORK / "tm_data.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
print("done")
