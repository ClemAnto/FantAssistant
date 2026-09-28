"""One EuroLeghe sheet on the PRIVATE DB copy, with presence params / the prior season overridden in memory.

usage: python run_variant.py NAME [key=value ...] [tm=covered|all]
The real DB and the real sheet are never touched: EUROLEGHE_DB_PATH points at the copy, --out at scratch.

tm=covered : a man with NO previous-season row in external_stats takes it from tm_appearances, but only in
             the championships `config.TM_CHAMPIONSHIPS` already declares as the same quantity (25/08/2026).
tm=all     : the same over every league tier the provider codes as COUNTRY+DIGIT (BE1, PO1, A1, GB2...),
             i.e. also the championships the est_pv cascade refused on 25/08/2026 for having no level term.
Starts are not in tm_appearances: a match of 60 minutes or more stands for a start (declared proxy).
"""
import os, re, sys, pathlib

REPO = pathlib.Path(__file__).resolve().parents[3]
# Everything these scripts WRITE carries names, FVM and paid-source pages, and the repository is public, so
# it lives under data/reports/ (gitignored) and never next to the code.
WORK = pathlib.Path(os.environ.get("PRESS_SURVEY_DIR", REPO / "data" / "reports" / "press_survey"))
WORK.mkdir(parents=True, exist_ok=True)
HERE = WORK / "experiments"
HERE.mkdir(exist_ok=True)
_name = sys.argv[1]
_db = HERE / ("euroleghe.db" if _name == "base" else f"db_{_name}.db")
if not _db.exists():
    import shutil
    shutil.copyfile(REPO / "data" / "euroleghe.db", _db)
os.environ["EUROLEGHE_DB_PATH"] = str(_db)
sys.path.insert(0, str(REPO / "toolkit"))

from euroleghe_ingest import config  # noqa: E402
from euroleghe_ingest.engine import presence  # noqa: E402
from euroleghe_ingest.modules import snapshot  # noqa: E402

name, *pairs = sys.argv[1:]
tm_mode = None
when, season, league, notm = "2026-09-28", None, "EuroLeghe", False
for pair in pairs:
    key, value = pair.split("=")
    if key == "tm":
        tm_mode = value
        continue
    if key == "date":
        when = value
        continue
    if key == "season":
        season = value
        continue
    if key == "league":
        league = value
        continue
    if key == "notm":          # the code BEFORE revision 77: no fallback at all
        notm = True
        continue
    old = getattr(presence.DEFAULTS, key)
    object.__setattr__(presence.DEFAULTS, key, type(old)(float(value)))
    print(f"[variant {name}] {key}: {old} -> {getattr(presence.DEFAULTS, key)}", flush=True)

if tm_mode:
    LEAGUE_CODE = re.compile(r"^[A-Z]{1,4}\d$")
    TOP_CODE = re.compile(r"^[A-Z]{1,4}1$")
    YOUTH = {"IJ1", "FRR1", "CPO1"}     # Primavera and reserve/youth championships coded like a first tier
    _record, _propensity = snapshot.starting_record, snapshot.propensity
    _cache = {}

    def tm_prior(conn, season):
        if season in _cache:
            return _cache[season]
        out = {}
        for fc_id, comp, apps, starts, minutes in conn.execute(
                """SELECT fc_id, competition, SUM(state = 'played'),
                          SUM(state = 'played' AND COALESCE(minutes, 0) >= 60), SUM(COALESCE(minutes, 0))
                     FROM tm_appearances WHERE season = ? AND COALESCE(is_national, 0) = 0
                    GROUP BY fc_id, competition""", (season,)):
            if tm_mode == "covered":
                ok = comp in config.TM_CHAMPIONSHIPS
            elif tm_mode == "top":      # FIRST TIERS only: a reserve side in 3. Liga is not a Bundesliga prior
                ok = bool(TOP_CODE.match(comp or "")) and comp not in YOUTH
            else:
                ok = bool(LEAGUE_CODE.match(comp or ""))
            if not ok or not apps:
                continue
            best = out.get(fc_id)
            if best is None or apps > best["matches"]:   # the man's main league that season
                out[fc_id] = {"matches": apps, "starts": starts, "minutes": minutes, "comp": comp}
        _cache[season] = out
        print(f"[variant {name}] tm prior {tm_mode}: {len(out)} men with a {season} league row in tm_appearances",
              flush=True)
        return out

    def starting_record(conn, season, before=None):
        base = _record(conn, season, before)
        if before is not None:
            return base
        added = 0
        for fc_id, row in tm_prior(conn, season).items():
            if fc_id not in base:
                base[fc_id] = {"starts": row["starts"], "matches": row["matches"],
                               "share": round((row["starts"] or 0) / row["matches"], 3)}
                added += 1
        print(f"[variant {name}] prev record: +{added} men from tm_appearances", flush=True)
        return base

    def propensity(conn, season, before=None, *args, **kwargs):
        base = _propensity(conn, season, before, *args, **kwargs)
        if before is not None:
            return base
        for fc_id, row in tm_prior(conn, season).items():
            if fc_id not in base:
                base[fc_id] = {"minutes": row["minutes"]}
        return base

    snapshot.starting_record = starting_record
    snapshot.propensity = propensity

if notm:
    snapshot.prior_from_tm = lambda conn, season: {}

from euroleghe_ingest.cli import main  # noqa: E402

sys.exit(main(["snapshot", "--league", league, "--no-refresh", "--date", when,
               *(["--season", season] if season else []),
               "--out", str(HERE / f"sheet_{name}")]))
