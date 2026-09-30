"""THE EXPECTED APPEARANCES, REBUILT FROM THEIR PARTS - a test bench, not an engine rule (30/09/2026, v2 01/10).

The operator's request: split every past season into the reasons a man did or did not get a vote - injured,
suspended, absent for another reason, not called, on the bench, came on, started - and predict next season's
appearances as a product of those parts, so each part can be re-tuned on its own:

    Pa = N x D_hat x S_hat x europe x c                       (every role, goalkeepers included)

    D_hat   availability over two seasons (the older weighted w2), pulled toward the ROLE's Dbar by kD (see `CELL_MIN`);
    S_hat   chosen when available: (1 - alpha - gamma) x share of games played + alpha x share of minutes
            + gamma x share of starts, pulled toward its ROLE's prior INSIDE its context by kS; x (1 + q (mv - 6)), the quality;
    europe  (1 - b x Eout) / (1 - b x Ein): the club of the predicted season plays a European cup (main phase),
            and the club of the measured one did. Eout is read from the predicted season's own games (his first
            club there), which at the auction is known for the Champions League and not always for the Europa
            and Conference play-offs, nor for a man sold on 31 August: a small advantage the engine's
            pre-season number does not have, and it is stated rather than hidden;
    c       one scale.

THE KEEPER LINE (v2), MEASURED AND REFUSED: a club fields ONE keeper, so a line of their own (R7's form, with the
same functions `fitting.fit_linear` + `model.linear_share`, on the share of games with a vote and the club change)
was the obvious candidate. On the keepers it is worse than the plain product on 10 windows of 10 (-12.9%), while
the product with the role's priors beats the engine's R7 on 7 of 10 (+2.9%, worst -7.8%). `fit(keeper_line=True)`
stays, so the reading is re-run every time the bench is.

THE SOURCE, v2: `tm_appearances`, which since 30/09/2026 carries the absence reason, the start, the coach and the
competition type (`performance --from-cache`, zero requests). v1 read the cache files directly because the parser
dropped those fields; one reader of one fact now. 1, 2 and 3 of `absence_id` are the three suspensions.

THE PROTOCOL, v2: every pre-season window of the gate (Tm7 -> T2), each JUDGED with parameters fitted on the other
nine (leave one window out), against the engine's own pre-season prediction of that window built the way the gate
builds it (every window fitted, the judged one scored with its neighbour's parameters). v1's split - fit on T1,
judge T2 - is printed first as a reproduction line, because a bench is checked on the numbers it has already
published before it judges anything.

THE BLEND, v2: on the gate's in-season windows (`features.INSEASON_WINDOWS`, 5 September and 5 February) the
formula's pre-season share - fitted on the pre-season windows whose target is NOT that season, or it would have
read the outcome - is blended with the rounds already played by the engine's own function
(`model.blend_with_seen`) at the engine's own K (the R20 key in `evaluate.ADOPTED["default"]`), and judged on the
rounds that remain against the engine's in-season prediction.

Writes `presence_test.json` into the newest export folder (or `--out`), which `app/scripts/pull-bundle.mjs` copies
for the /why page. The file carries names and paid numbers: it lives under data/, never in the repository.

    python toolkit/scripts/presence_test/build.py [--db PATH] [--out FILE] [--no-inseason]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path
from statistics import mean, median

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "toolkit"))
from euroleghe_ingest.config import Config  # noqa: E402
from euroleghe_ingest.engine import evaluate, features, model, status  # noqa: E402
from euroleghe_ingest.engine.fitting import fit_linear  # noqa: E402

PLATFORM, GAME = "default", "classic"
SUSPENSION = {1, 2, 3}
# NATIONAL DUTY (01/10/2026): `absence_id` 5 and 8 fall within four days of one of his national team's games 88.8%
# and 87.4% of the time, against 1-5% for every other code - so they are the call-ups (a continental cup, a window).
NATIONAL = {5, 8}
EUROPE = {"CL", "EL", "UCOL"}
TOP5 = {"IT1", "GB1", "ES1", "L1", "FR1"}
LEAGUE_TYPES = (1, 2)          # Transfermarkt's first and second divisions; cups and youth are other types
SAMPLE_PER_CELL = 2
CONTEXTS = ("serie A, stesso club", "serie A, cambio club", "estero top5", "altro campionato", "portiere", "nessuna")
GRID = {
    "kD": [0, 20, 40, 80, 160, 320, 640], "w2": [0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0],
    "alpha": [0, 0.25, 0.5, 0.75, 1.0], "gamma": [0, 0.1, 0.2, 0.3, 0.5],
    "q": [-0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.5], "kS": [0, 5, 10, 20, 40, 80, 160],
    "b": [-0.1, -0.05, 0, 0.05, 0.1, 0.15, 0.2, 0.3], "c": [0.85, 0.9, 0.95, 1.0, 1.05, 1.1],
}
# The two readings born on 01/10/2026 from Contini and Christensen; the bench measures them before they are kept.
# OWN_CLUB is REFUSED and kept off: -0.05% against the base (5 windows of 10), and worse on the keepers (3 of 10).
# KEEPER_CLASS is kept: +0.57% overall (7 of 10, worst -1.2%, robust), +3.2% on the keepers.
OWN_CLUB, OWN_CLUB_MIN = False, 10
KEEPER_CLASS, KEEPER_CLASS_SHARE = True, 0.5
# «PER IL MOMENTO ELIMINIAMO DAI TEST TUTTI I CALCIATORI CON QUOTAZIONE INIZIALE BASSA» (operator, 01/10/2026):
# a man the listone quotes at 5 or less (Qt.I of the season predicted, the only auction-safe price) is out of the
# bench - out of the fit AND out of the judgement. A man with no Qt.I at all is not cheap, he is unknown, so he
# stays and is counted.
MAX_CHEAP_PRICE = 5.0
# ...REPLACED, for the bench, by a BASE QUOTATION PER ROLE (operator, 01/10/2026: «troviamo una quotazione base per
# ogni ruolo»). The men an auction buys are not «above 5»: that filter keeps 18-20 keepers a season against the 30 a
# ten-team league buys, and 104-130 midfielders against 80. The base is the Qt.I of the LAST man a league of ten with
# 3/8/8/6 buys - the 80th defender, the 80th midfielder, the 60th forward - as the median over the twelve seasons of
# the Serie A listone (D 6 in 5-7, C 8 in 6-9, A 11 in 6-15), each role at or above its base. Keepers are the
# exception and the operator's call: the 30th keeper costs 1 in every season (the third keepers all do), and he keeps
# them at Qt.I ABOVE 5 - the first keepers, 18-22 a season - so the base there is strict. `MAX_CHEAP_PRICE` stays
# because R33b (gate §7-octsexagies) was frozen on it.
QTI_BASE = {"P": 5.0, "D": 6.0, "C": 8.0, "A": 11.0}
QTI_BASE_STRICT = {"P"}


def bought(role: str | None, price: float | None) -> bool:
    """The men the bench judges: at or above his role's base Qt.I. No Qt.I at all is unknown, and stays."""
    if price is None:
        return True
    base = QTI_BASE.get(role or "", MAX_CHEAP_PRICE)
    return price > base if (role in QTI_BASE_STRICT or role not in QTI_BASE) else price >= base
# «L'INFORTUNIO DI LUKAKU NON ERA PREVEDIBILE ... ANDREBBE INSERITA IN UN GRUPPO A PARTE» (operator, 01/10/2026). A
# man who, from the auction date on, missed at least this share of his club's league games through injury, with no
# spell open on the auction date, is neither a hit nor a miss of either model: he is scored APART (`injury` =
# «unforeseen»). The share is the population's own ninetieth percentile of the injured share of a season, measured
# on this bench (0.316): a season in the worst tenth. A long injury that WAS open at the auction is «known»: the fact
# was there and neither model reads it, so it stays in the judgement - that one is an error, and a correctable one.
# Lukaku's thigh went on 14 August 2025, the day before the gate's auction date: «known».
LONG_INJURY_SHARE = 1 / 3
# SEPTEMBER'S TWO READINGS, measured before they were kept: which rounds seen the blend counts - «calendar» (the
# club's league calendar, the engine's own `pv_seen`), «club» (from the day he is at the club he plays for after the
# auction, games injured counted as not played), «free» (the same, injured games left out) - and whether a spell open
# on the auction date takes its expected games off.
# Measured on the seven 5 September windows against the engine (01/10/2026): calendar 7 of 7, +3.46%; calendar +
# the open spell 7 of 7, +3.75% (the spell on top of the calendar: 5 of 7, +0.3% - under the gate's floor, kept
# because it reads a fact the auction had: Lukaku was out from 14 August 2025); «club» 3 of 7, «free» 2 of 7. A
# game missed injured counted as NOT PLAYED carries the injury itself, which is why leaving it out loses.
SEPTEMBER_SEEN, SEPTEMBER_OPEN_SPELL = "calendar", True
# The gate's own thresholds for the two verdicts, so the bench speaks the gate's vocabulary.
FLOOR, TOLERANCE = 0.005, -0.02
K_READING = (3, 6, 10, 15, 25, 40)


def previous(season: str) -> str:
    start = int(season[:4]) - 1
    return f"{start}-{str(start + 1)[-2:]}"


def breakdown(conn: sqlite3.Connection):
    """Per (fc_id, season): the league seasons summed, the clubs, the first club, and the clubs in Europe."""
    agg: dict = defaultdict(lambda: defaultdict(float))
    # ...and the same per CLUB, because a season can be two clubs: Christensen's 2024-25 is twenty games «not in
    # squad» at Fiorentina and sixteen starts on loan at Salernitana, in Serie B.
    at_club: dict = defaultdict(lambda: defaultdict(float))
    clubs: dict = defaultdict(lambda: defaultdict(float))
    first: dict = {}
    europe: set = set()
    for club, season in conn.execute(
            f"SELECT DISTINCT club_id, season FROM tm_appearances WHERE is_national = 0 "
            f"AND competition IN ({','.join('?' * len(EUROPE))})", tuple(EUROPE)):
        europe.add((club, season))
    for fc, season, club in conn.execute(
            """SELECT fc_id, season, club_id FROM (
                   SELECT fc_id, season, club_id,
                          ROW_NUMBER() OVER (PARTITION BY fc_id, season ORDER BY played_on) AS k
                   FROM tm_appearances WHERE is_national = 0 AND season IS NOT NULL) WHERE k = 1"""):
        first[(fc, season)] = club
    for fc, season, comp, club, state, start, minutes, absence in conn.execute(
            f"""SELECT fc_id, season, competition, club_id, state, is_starting, minutes, absence_id
                FROM tm_appearances
                WHERE is_national = 0 AND season IS NOT NULL
                  AND competition_type IN ({','.join('?' * len(LEAGUE_TYPES))})""", LEAGUE_TYPES):
        clubs[(fc, season)][club] += 1
        for a in (agg[(fc, season)], at_club[(fc, season, club)]):
            a["n"] += 1
            a["it1"] += comp == "IT1"
            a["top5"] += comp in TOP5
            if state == "played":
                a["start" if start else "sub"] += 1
                a["minutes"] += minutes or 0
            elif state == "in squad":
                a["bench"] += 1
            elif state == "injured":
                a["inj"] += 1
            elif state == "absent":
                a["susp" if absence in SUSPENSION else "naz" if absence in NATIONAL else "other"] += 1
            else:
                a["out"] += 1
    return agg, at_club, clubs, first, europe


def league_dates(conn: sqlite3.Connection) -> dict:
    """Per (fc_id, season): the dates of his club's league games and whether he was injured in each."""
    out: dict = defaultdict(list)
    for fc, season, day, state in conn.execute(
            f"""SELECT fc_id, season, played_on, state FROM tm_appearances
                WHERE is_national = 0 AND season IS NOT NULL
                  AND competition_type IN ({','.join('?' * len(LEAGUE_TYPES))})""", LEAGUE_TYPES):
        out[(fc, season)].append((day, state == "injured"))
    return out


def open_spells(conn: sqlite3.Connection) -> dict:
    """Per fc_id: the dated absence spells (Transfermarkt's archive), to tell «out at the auction» from «went later»."""
    out: dict = defaultdict(list)
    for fc, start, end in conn.execute("SELECT fc_id, start_date, end_date FROM injuries WHERE start_date IS NOT NULL"):
        out[fc].append((start, end))
    return out


def league_games(conn: sqlite3.Connection) -> dict:
    """Per (fc_id, season): every league game of his club while he was there, (date, club, state, absence), sorted."""
    out: dict = defaultdict(list)
    for fc, season, day, club, state, absence in conn.execute(
            f"""SELECT fc_id, season, played_on, club_id, state, absence_id FROM tm_appearances
                WHERE is_national = 0 AND season IS NOT NULL
                  AND competition_type IN ({','.join('?' * len(LEAGUE_TYPES))})""", LEAGUE_TYPES):
        out[(fc, season)].append((day, club, state, absence))
    for games in out.values():
        games.sort()
    return out


def seen_at_club(r, games: dict) -> tuple[int, int, int]:
    """THE ROUNDS SEEN, counted from the day he is at the club he plays for after the auction (01/10/2026).

    The engine's `pv_seen` divides by the club's calendar, so Hojlund - at Napoli from 1 September 2025, first game
    on the 13th - reads «two rounds seen, none played» on 5 September. Here the club is the one of his first league
    game AFTER the auction, and the evidence is that club's games up to the auction: (available, played). A game
    he missed injured, banned or away is not evidence about being CHOSEN, which is what the blend is about.
    """
    rows = games.get((r["fc_id"], r["target"]), ())
    after = [club for day, club, _state, _absence in rows if day > r["auction"]]
    if not after:
        return 0, 0, 0
    club = after[0]
    before = [(state, absence) for day, c, state, absence in rows if day <= r["auction"] and c == club]
    free = [state for state, _absence in before if state not in ("injured", "absent")]
    return len(before), len(free), sum(state == "played" for state in free)


def residual_table(conn: sqlite3.Connection, before: str) -> list[tuple[int, float]]:
    """How many days a spell still has left, by the days already gone: the median over spells CLOSED before `before`.

    The archive's end date of a spell is its outcome and never the forecast of the day (the row is replaced at every
    read), so an open spell cannot be priced from its own `end_date`. What can be read ex ante is how long spells
    like it lasted: bins of a week of elapsed days, median of what was left over spells longer than that.
    """
    spans = [dt.date.fromisoformat(end).toordinal() - dt.date.fromisoformat(start).toordinal()
             for start, end in conn.execute(
                 "SELECT start_date, end_date FROM injuries WHERE end_date IS NOT NULL AND end_date < ?", (before,))
             if start and end]
    table = []
    for elapsed in range(0, 365, 7):
        left = [span - elapsed for span in spans if span > elapsed]
        if len(left) >= 20:
            table.append((elapsed, float(median(left))))
    return table


def expected_out(r, games: dict, spells: dict, table: list) -> int:
    """League games still to miss for a spell OPEN at the auction date, from the residual table and his fixtures."""
    auction = dt.date.fromisoformat(r["auction"])
    open_since = [dt.date.fromisoformat(start) for start, end in spells.get(r["fc_id"], ())
                  if start <= r["auction"] and (end is None or end >= r["auction"])]
    if not open_since or not table:
        return 0
    elapsed = (auction - min(open_since)).days
    left = next((days for gone, days in reversed(table) if gone <= elapsed), table[0][1])
    back = (auction + dt.timedelta(days=left)).isoformat()
    return sum(1 for day, *_rest in games.get((r["fc_id"], r["target"]), ()) if r["auction"] < day < back)


def injury_group(r, dates: dict, spells: dict) -> str | None:
    """«unforeseen», «known» or None - see `LONG_INJURY_SHARE`. Only the games AFTER the auction date count."""
    games = [hurt for day, hurt in dates.get((r["fc_id"], r["target"]), ()) if day > r["auction"]]
    if not games or sum(games) < LONG_INJURY_SHARE * len(games):
        return None
    known = any(start <= r["auction"] and (end is None or end >= r["auction"]) for start, end in spells.get(r["fc_id"], ()))
    return "known" if known else "unforeseen"


def clubs_elsewhere(conn: sqlite3.Connection) -> tuple[dict, dict]:
    """Where a man played a season the gate's `club_prev` does not name (it is a Serie A roster fact).

    Two sources, in order, for DISPLAY only: the club he played most matches for in the per-match layer (the
    provider's spelling, «AC Milan» and not «Milan», which is a name to read and never a key to join on), and
    the club a transfer of that summer says he came FROM (`transfers_history`, dated 1 July from 2023). What
    neither knows stays a dash: a man with no season anywhere has no club to name.
    """
    played: dict = {}
    for fc, season, club, n in conn.execute(
            "SELECT fc_id, season, club, COUNT(*) FROM external_match_stats WHERE club IS NOT NULL GROUP BY 1, 2, 3"):
        if n > played.get((fc, season), (None, 0))[1]:
            played[(fc, season)] = (club, n)
    came_from = {(fc, int(day[:4])): club for fc, day, club in conn.execute(
        "SELECT fc_id, date, from_club FROM transfers_history WHERE from_club IS NOT NULL")}
    return {key: club for key, (club, _n) in played.items()}, came_from


def engine_rows(conn: sqlite3.Connection, windows: dict, *, keep_cheap: bool = False):
    """The engine's prediction of each window, as the gate builds it (in-season windows pair among themselves).

    `windows` maps a gate key to its `Window`: a July window keeps the pre-season key (so it pairs and pools with
    its neighbours as the gate's own do) and carries its own auction date.
    """
    prepared = {k: evaluate.prepared_window(conn, w, PLATFORM, GAME) for k, w in windows.items()}
    prepared = {k: d for k, d in prepared.items() if evaluate._window_is_usable(d, PLATFORM)}
    fitted = {k: evaluate.fit_params(d, ("R0", *evaluate.CANDIDATES)) for k, d in prepared.items()}
    adopted = ("R0", *evaluate.ADOPTED[PLATFORM])
    out = []
    for key, data in prepared.items():
        scoring = evaluate.pool_params(fitted, key, fitted[features.cross_fit_source(key, tuple(prepared))])
        preds = {p.obs.fc_id: p for p in evaluate.predict_window(data, adopted, None, scoring)}
        window = windows[key]
        for obs in data.observations:
            if obs.pv_act is None:
                continue
            if not keep_cheap and not bought(obs.role_classic, obs.price_initial):
                continue
            p = preds.get(obs.fc_id)
            out.append({"window": key, "input": window.input_season, "target": window.target_season,
                        "auction": window.auction_date,
                        "fc_id": obs.fc_id, "name": obs.name, "role": obs.role_classic,
                        "club_change": bool(obs.club_change),
                        "club_prev": obs.club_prev, "club_target": obs.club_target, "N": float(data.matchdays_target),
                        "seen": int(data.matchdays_seen or 0),
                        "pv_seen": obs.pv_seen,
                        "pa_engine": None if p is None or p.pv_pred is None else round(p.pv_pred, 1),
                        "pa_actual": float(obs.pv_act)})
    return out


def available(a) -> float:
    return a["n"] - a["inj"] - a["susp"] - a["other"] - a["naz"]


def keeper_input(r) -> tuple[float, float]:
    a1 = r["a1"]
    return ((a1["sub"] + a1["start"]) / a1["n"], 1.0 if r["club_change"] else 0.0)


def parts(r, p):
    a1, a2 = r["a1"], r["a2"]
    chosen = r.get("a1s") or a1      # the games that say whether he is CHOSEN (see `annotate`)
    n = a1["n"] + (p["w2"] * a2["n"] if a2 else 0)
    free = available(a1) + (p["w2"] * available(a2) if a2 else 0)
    d = (free + p["kD"] * prior(p, "Dbar", r)) / (n + p["kD"])
    av1 = max(available(chosen), 0)
    s_app = (chosen["sub"] + chosen["start"]) / av1 if av1 else 0
    s_min = chosen["minutes"] / (90 * av1) if av1 else 0
    s_start = chosen["start"] / av1 if av1 else 0
    s_raw = (1 - p["alpha"] - p["gamma"]) * s_app + p["alpha"] * s_min + p["gamma"] * s_start
    # A season spent entirely out (injured, suspended) says nothing about being chosen: the prior answers.
    s_bar = prior(p, "Sbar", r)
    s = (av1 * s_raw + p["kS"] * s_bar) / (av1 + p["kS"]) if av1 + p["kS"] else s_bar
    s *= (1 - p["b"] * r["eout"]) / (1 - p["b"] * r["ein"])
    mv = r["mv"] if r["mv"] is not None or not p["by_role"] else prior(p, "MVbar", r)
    if mv is not None and not r["ctx"].startswith("portiere"):
        s *= 1 + p["q"] * (mv - 6.0)
    return d, min(s, 1.0)


def rung(play_share: float | None, minutes: float | None) -> str | None:
    """The six-word ladder (`engine/status.py`) on its two axes, WITHOUT the board's gate.

    Operator, 01/10/2026: «inserire una colonna con il gradino-titolarità ricavato». The ladder's own function,
    not a copy, and one thing it cannot have here is stated rather than faked: a past window has no drawn
    board, so «is he in the typical eleven» is unknown. The two numbers decide alone - a top rung where they
    reach it (as if drawn), otherwise the rungs of a man the board does not draw. `play_share` is the share of
    the games he is FIT for that he gets a vote in, which is what S is, and `minutes` per game played.
    """
    if play_share is None:
        return None
    drawn = status.status_of(play_share, minutes, True)
    return (drawn if drawn in status.LADDER[:status.LADDER.index("ballottaggio")]
            else status.status_of(play_share, minutes, False))


def minutes_per_game(a) -> float | None:
    played = a["sub"] + a["start"] if a else 0
    return a["minutes"] / played if played else None


def share(r, p) -> float:
    """The predicted share of the calendar, before any round of the target season is known."""
    if r["a1"] is None:
        return prior(p, "none", r)
    if r["ctx"].startswith("portiere") and p.get("keeper"):
        return model.linear_share(p["keeper"], keeper_input(r))
    d, s = parts(r, p)
    return d * s * p["c"]


def predict(r, p) -> float:
    return r["N"] * share(r, p)


# «QUANDO NEI CALCOLI MANCANO DEI DATI UTILIZZIAMO SEMPRE LE MEDIE PER RUOLO IN QUELL'AMBITO» (operator,
# 01/10/2026). Every prior the formula falls back on - the availability a short record is pulled toward, the
# chance of being chosen, the share of a man with no season on file, and the base vote where he has none - is
# the mean of HIS ROLE inside HIS CONTEXT on the training rows. A cell thinner than `CELL_MIN` falls back to the
# context and then to everybody, and that is stated rather than hidden: a mean of three men is a coin.
CELL_MIN = 10


def cells(train, keep, value, by_role: bool, per_context: bool = True) -> dict:
    """Means per (role, context), per context and overall - the ladder `prior` walks down."""
    groups: dict = defaultdict(list)
    for r in train:
        if not keep(r):
            continue
        v = value(r)
        groups[("*", "*")].append(v)
        if per_context:
            groups[("*", r["ctx"])].append(v)
        if by_role:
            groups[(r["role"], r["ctx"] if per_context else "*")].append(v)
    return {key: (mean(vs), len(vs)) for key, vs in groups.items()}


def prior(p, name: str, r) -> float:
    table = p[name]
    ctx = r["ctx"] if ("*", r["ctx"]) in table else "*"
    for key in ((r["role"], ctx), ("*", ctx), ("*", "*")):
        if key in table and table[key][1] >= CELL_MIN:
            return table[key][0]
    return table[("*", "*")][0]


def fit(train: list[dict], *, keeper_line: bool = True, by_role: bool = True) -> dict:
    """Priors, the keeper line and the coordinate descent, all on `train` and nothing else."""
    p = {"by_role": by_role,
         "Dbar": cells(train, lambda r: r["a1"] is not None, lambda r: available(r["a1"]) / r["a1"]["n"],
                       by_role, per_context=False),
         "none": cells(train, lambda r: r["ctx"] == "nessuna", lambda r: r["pa_actual"] / r["N"], by_role),
         "Sbar": cells(train, lambda r: r["ctx"] != "nessuna", lambda r: min(1, r["pa_actual"] / r["N"]),
                       by_role),
         "MVbar": cells(train, lambda r: r["mv"] is not None, lambda r: r["mv"], True),
         "kD": 40, "w2": 0.5, "alpha": 0.5, "gamma": 0.0, "q": 0.0, "kS": 20, "b": 0.0, "c": 1.0,
         "keeper": None}
    if keeper_line:
        p["keeper"] = fit_linear([(keeper_input(r), r["pa_actual"] / r["N"])
                                  for r in train if r["ctx"].startswith("portiere")])
    # The outfield descent never sees a keeper once the line exists, or the grid would tune D and S to
    # rescue rows the line already answers.
    outfield = [r for r in train if not (p["keeper"] and r["ctx"].startswith("portiere"))]
    for _ in range(4):
        for key, values in GRID.items():
            p[key] = min(values, key=lambda v: mae(outfield, {**p, key: v}))
    return p


def mae(group, params) -> float:
    return mean(abs(predict(r, params) - r["pa_actual"]) for r in group)


def ratio(pred: float | None, actual: float) -> float | None:
    # Predicted over REAL (operator, 30/09/2026): 100% exact, 50% he played twice what was expected, 200%
    # he played half. A man who played nothing has no ratio: any prediction over zero is infinitely off.
    return None if pred is None or actual <= 0 else pred / actual


def band_share(values) -> float:
    known = [v for v in values if v is not None]
    return round(sum(0.8 <= v <= 1.25 for v in known) / len(known), 3) if known else 0.0


def scored(rows: list[dict], pred, *, everybody: bool = True) -> dict:
    """Formula (`pred(row)`) against the engine on the rows where the engine has a number.

    EVERYBODY IS JUDGED (01/10/2026). Leaving the «unforeseen» long injuries out was measured to be a selection on
    the OUTCOME that favours the model predicting more - the formula - so a verdict counts them (gate
    §7-octsexagies bis); `everybody=False` is the reading that leaves them apart, for looking at cases.
    """
    both = [r for r in rows if r["pa_engine"] is not None
            and (everybody or r.get("injury") != "unforeseen")]
    formula = [pred(r) for r in both]
    f_mae = mean(abs(f - r["pa_actual"]) for f, r in zip(formula, both))
    e_mae = mean(abs(r["pa_engine"] - r["pa_actual"]) for r in both)
    f_ratio = [ratio(f, r["pa_actual"]) for f, r in zip(formula, both)]
    e_ratio = [ratio(r["pa_engine"], r["pa_actual"]) for r in both]
    return {"n": len(both), "unforeseen": sum(r.get("injury") == "unforeseen" for r in rows
                                               if r["pa_engine"] is not None),
            "mae_formula": round(f_mae, 3), "mae_engine": round(e_mae, 3),
            "gain": round((e_mae - f_mae) / e_mae, 4),
            "median_ratio_formula": round(median(v for v in f_ratio if v is not None), 3),
            "median_ratio_engine": round(median(v for v in e_ratio if v is not None), 3),
            "within20_formula": band_share(f_ratio), "within20_engine": band_share(e_ratio)}


def verdict(gains: list[float]) -> dict:
    """The gate's two verdicts on a list of per-window gains (positive = the formula is better)."""
    mean_gain = mean(gains)
    wins = sum(g > 0 for g in gains)
    return {"windows": len(gains), "wins": wins, "mean_gain": round(mean_gain, 4),
            "worst": round(min(gains), 4),
            "strict": all(g > 0 for g in gains) and mean_gain > FLOOR,
            "robust": wins > len(gains) / 2 and mean_gain > FLOOR and min(gains) > TOLERANCE}


def annotate(rows, agg, at_club, clubs, first, europe, mv, *, own_club: bool = OWN_CLUB,
             keeper_class: bool = KEEPER_CLASS) -> None:
    for r in rows:
        one, two = r["input"], previous(r["input"])
        a1, a2 = agg.get((r["fc_id"], one)), agg.get((r["fc_id"], two))
        r["a1"] = a1 if a1 and a1["n"] else None
        r["a2"] = a2 if a2 and a2["n"] else None
        # THE CLUB HE WILL PLAY FOR (operator, 01/10/2026, on Christensen): whether he is CHOSEN is read on the
        # games of the season measured at the club of the season predicted, when he spent enough of them there -
        # sixteen starts on loan in Serie B say nothing about Fiorentina's shirt. Availability (D) stays the whole
        # season: an injury belongs to the man, not to the club.
        target_club = first.get((r["fc_id"], r["target"]))
        there = at_club.get((r["fc_id"], one, target_club)) if own_club and r["a1"] else None
        r["a1s"] = there if there and there["n"] >= OWN_CLUB_MIN and there["n"] < r["a1"]["n"] else None
        chosen = r["a1s"] or r["a1"]
        if r["a1"] is None:
            r["ctx"] = "nessuna"
        elif r["role"] == "P":
            # A CLUB FIELDS ONE KEEPER (operator, 01/10/2026, on Contini): the keepers' population is bimodal, so a
            # prior that is the mean of every keeper (0.44) is a shirt nobody holds. The context of a keeper is his
            # CLASS last season - the man who played or the man who did not - and the role's mean inside it.
            fit_for = available(chosen)
            share = (chosen["sub"] + chosen["start"]) / fit_for if fit_for > 0 else 0.0
            r["ctx"] = (("portiere titolare" if share >= KEEPER_CLASS_SHARE else "portiere riserva")
                        if keeper_class else "portiere")
        elif a1["it1"] >= a1["n"] / 2:
            r["ctx"] = "serie A, cambio club" if r["club_change"] else "serie A, stesso club"
        else:
            r["ctx"] = "estero top5" if a1["top5"] >= a1["n"] / 2 else "altro campionato"
        held = clubs.get((r["fc_id"], one))
        main_club = max(held.items(), key=lambda kv: kv[1])[0] if held else None
        r["ein"] = 1.0 if main_club and (main_club, one) in europe else 0.0
        r["eout"] = 1.0 if (first.get((r["fc_id"], r["target"])), r["target"]) in europe else 0.0
        r["mv"] = mv.get((r["fc_id"], one))
        nxt = agg.get((r["fc_id"], r["target"]))
        r["a_next"] = nxt if nxt and nxt["n"] else None
        fit_for = available(nxt) if r["a_next"] else 0
        r["s_actual"] = (nxt["sub"] + nxt["start"]) / fit_for if fit_for > 0 else None


def july_windows() -> dict:
    """The gate's ten pre-season windows with the auction on 31 July of the season predicted (operator, 01/10/2026)."""
    return {key: features.Window(key, w.input_season, w.target_season, f"{w.target_season[:4]}-07-31")
            for key, w in features.WINDOWS.items()}


def september_windows() -> dict:
    """The gate's own 5 September windows (`INSEASON_WINDOWS`, the «set» half): the Serie A market has closed and
    the first rounds are played - the auction the operator plays and most leagues do."""
    return {key: w for key, w in features.INSEASON_WINDOWS.items() if key.endswith("set")}


def band(actual: float) -> str:
    return "0" if actual <= 0 else "1-9" if actual < 10 else "10-19" if actual < 20 else "20-29" if actual < 30 else "30+"


def sample_of(rows: list[dict]) -> set:
    """THE SAMPLE the page shows (operator: «inutile che mostri tutti, un campione ampio variegato»): up to two men
    per (window, role, context, band of real appearances), chosen by a fixed hash of the id - same on every run,
    and nobody picked the names."""
    cells: dict = defaultdict(list)
    for r in rows:
        cells[(r["window"], r["role"], r["ctx"], band(r["pa_actual"]))].append(r)
    picked: set = set()
    for members in cells.values():
        for r in sorted(members, key=lambda one: (one["fc_id"] * 2654435761) % 2**32)[:SAMPLE_PER_CELL]:
            picked.add((r["window"], r["fc_id"]))
    return picked


def main() -> None:
    parser = argparse.ArgumentParser()
    # The project's own paths (`EUROLEGHE_DB_PATH`, `EUROLEGHE_DATA_DIR`), so a worktree reads the real DB.
    config = Config()
    parser.add_argument("--db", default=str(config.db_path))
    parser.add_argument("--out", default=None)
    args = parser.parse_args()
    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    agg, at_club, clubs, first, europe = breakdown(conn)
    played_for, came_from = clubs_elsewhere(conn)
    mv = {(fc, s): v for fc, s, v in conn.execute(
        "select fc_id, season, mv from season_stats where platform='default' and mv is not null and pv >= 5")}
    dates, spells, games = league_dates(conn), open_spells(conn), league_games(conn)

    def load(windows: dict, **kwargs) -> list[dict]:
        rows = engine_rows(conn, windows, **kwargs)
        for r in rows:
            r["injury"] = injury_group(r, dates, spells)
        annotate(rows, agg, at_club, clubs, first, europe, mv)
        return rows

    # 0. THE REPRODUCTION of v1's published split (15 August, fit T1, judge T2): v1's contexts and priors, the
    # engine fitted on every window as the gate does, and everybody in - v1 had no price filter.
    august = [r for r in load(dict(features.WINDOWS), keep_cheap=True) if r["window"] in ("T1", "T2")]
    annotate(august, agg, at_club, clubs, first, europe, mv, own_club=False, keeper_class=False)
    p_v1 = fit([r for r in august if r["window"] == "T1"], keeper_line=False, by_role=False)
    repro = {k: scored([r for r in august if r["window"] == k], lambda r: predict(r, p_v1), everybody=True)
             for k in ("T1", "T2")}
    print(f"[v1, 15 agosto] fit T1: T1 {repro['T1']['mae_formula']} / {repro['T1']['mae_engine']} · "
          f"T2 {repro['T2']['mae_formula']} / {repro['T2']['mae_engine']}")

    # 1. FINE LUGLIO: the ten pre-season windows at 31 July, each judged with parameters fitted on the other nine.
    july = load(july_windows())
    windows = [k for k in features.WINDOWS if any(r["window"] == k for r in july)]
    folds: dict[str, dict] = {}
    params_by_fold: dict[str, dict] = {}
    for key in windows:
        p_main = fit([r for r in july if r["window"] != key], keeper_line=False)
        params_by_fold[key] = p_main
        judged = [r for r in july if r["window"] == key]
        keepers = [r for r in judged if r["ctx"].startswith("portiere")]
        folds[key] = {"moment": "luglio", "target": judged[0]["target"], "auction": judged[0]["auction"],
                      **scored(judged, lambda r, p=p_main: predict(r, p)),
                      "keepers": scored(keepers, lambda r, p=p_main: predict(r, p))}
        f = folds[key]
        print(f"[luglio] {key} -> {f['target']}: n {f['n']}, formula {f['mae_formula']}, motore {f['mae_engine']}, "
              f"guadagno {f['gain']:+.2%}; portieri {f['keepers']['gain']:+.2%}")
    edges = {k: sorted({params_by_fold[w][k] for w in windows}) for k in GRID}
    july_verdict = {"formula": verdict([f["gain"] for f in folds.values()]),
                    "keepers": verdict([f["keepers"]["gain"] for f in folds.values()])}
    print(f"[luglio] {july_verdict}\nparametri per piega: {edges}")

    # 2. INIZIO SETTEMBRE: the market has closed and two or three rounds are played. The prior is the July formula
    # fitted on every window whose season predicted is NOT this one (or it would have read the outcome); on top of
    # it, the rounds seen AT HIS CLUB and a spell still open on the day, each measured as its own reading.
    k_key = next(k for k in evaluate.ADOPTED[PLATFORM] if k in evaluate.R20_ROUNDS)
    k_rounds = evaluate.R20_ROUNDS[k_key]
    september = load(september_windows())
    priors: dict[str, dict] = {}
    tables: dict[str, list] = {}
    for r in september:
        if r["target"] not in priors:
            priors[r["target"]] = fit([x for x in july if x["target"] != r["target"]], keeper_line=False)
            tables[r["target"]] = residual_table(conn, f"{r['target'][:4]}-07-01")
        r["seen_club"], r["seen_free"], r["seen_played"] = seen_at_club(r, games)
        r["out_open"] = expected_out(r, games, spells, tables[r["target"]])

    def september_pa(r, *, seen: str = SEPTEMBER_SEEN, open_spell: bool = SEPTEMBER_OPEN_SPELL) -> float:
        p = priors[r["target"]]
        prior = share(r, p)
        if seen == "free":
            chosen = (model.blend_with_seen(prior, r["seen_played"] / r["seen_free"], r["seen_free"], k_rounds)
                      if r["seen_free"] else prior)
        elif seen == "club":
            chosen = (model.blend_with_seen(prior, r["seen_played"] / r["seen_club"], r["seen_club"], k_rounds)
                      if r["seen_club"] else prior)
        else:
            chosen = (model.blend_with_seen(prior, r["pv_seen"] / r["seen"], r["seen"], k_rounds)
                      if r["seen"] and r["pv_seen"] is not None else prior)
        rounds = max(r["N"] - (r["out_open"] if open_spell else 0), 0.0)
        return rounds * chosen

    readings = {"formula": {},
                **{f"viste {seen}{' + stop' if spell else ''}": {"seen": seen, "open_spell": spell}
                   for seen in ("calendar", "club", "free") for spell in (False, True)},
                "solo il prior": None}
    sep_folds: dict[str, dict] = {}
    for key in september_windows():
        judged = [r for r in september if r["window"] == key]
        if not judged:
            continue
        entry = {"moment": "settembre", "target": judged[0]["target"], "auction": judged[0]["auction"],
                 "seen": judged[0]["seen"], "open_spells": sum(r["out_open"] > 0 for r in judged)}
        for name, opts in readings.items():
            pred = ((lambda r: r["N"] * share(r, priors[r["target"]])) if opts is None
                    else (lambda r, o=opts: september_pa(r, **o)))
            entry["formula" if name == "formula" else name] = scored(judged, pred)
        entry.update({k: entry["formula"][k] for k in entry["formula"]})
        entry["keepers"] = scored([r for r in judged if r["ctx"].startswith("portiere")], september_pa)
        sep_folds[key] = entry
        print(f"[settembre] {key} (viste {entry['seen']}, stop aperti {entry['open_spells']}): formula "
              f"{entry['mae_formula']}, motore {entry['mae_engine']}, guadagno {entry['gain']:+.2%} · "
              + " · ".join(f"{name} {entry[name]['gain']:+.2%}" for name in readings if name != "formula"))
    sep_verdict = {name: verdict([f["gain"] if name == "formula" else f[name]["gain"] for f in sep_folds.values()])
                   for name in readings}
    sep_verdict["keepers"] = verdict([f["keepers"]["gain"] for f in sep_folds.values()])
    print(f"[settembre] K {k_rounds:g} ({k_key}): {sep_verdict}")

    # 3. The rows the page draws, one per man and window of each moment.
    sampled = sample_of(july) | sample_of(september)
    out_rows = []
    for moment, rows in (("luglio", july), ("settembre", september)):
        for r in rows:
            a1, a2 = r["a1"], r["a2"]
            p = params_by_fold[r["window"]] if moment == "luglio" else priors[r["target"]]
            d, s_ = parts(r, p) if a1 and not (p["keeper"] and r["ctx"].startswith("portiere")) else (None, None)
            pa = predict(r, p) if moment == "luglio" else september_pa(r)
            out_rows.append({
                "moment": moment, "window": r["window"], "target": r["target"], "auction": r["auction"],
                "fcId": r["fc_id"], "name": r["name"],
                "role": r["role"], "context": r["ctx"], "clubChange": r["club_change"],
                "europeIn": bool(r["ein"]), "europeOut": bool(r["eout"]), "mv": r["mv"],
                # «other» on the page is every absence that is neither an injury nor a ban, national duty included,
                # so the seven columns still add up to the games; the call-ups travel apart as well.
                "prev": None if not a1 else {**{k: int(a1[k]) for k in
                                                ("n", "inj", "susp", "out", "bench", "sub", "start", "minutes")},
                                             "other": int(a1["other"] + a1["naz"]), "naz": int(a1["naz"])},
                # THE SEASON PREDICTED, as it went: the games of his club's league he missed injured, banned, or
                # away with his national team (operator, 01/10/2026).
                "next": None if not r["a_next"] else {k: int(r["a_next"][k]) for k in ("n", "inj", "susp", "naz")},
                "prev2": None if not a2 else {k: int(a2[k]) for k in ("n", "inj", "susp", "other")},
                "clubPrev": (r["club_prev"] or played_for.get((r["fc_id"], r["input"]))
                             or came_from.get((r["fc_id"], int(r["target"][:4])))),
                "clubNext": r["club_target"],
                "d": None if d is None else round(d, 3), "s": None if s_ is None else round(s_, 3),
                # THE RUNG the formula's S gives him (minutes: the season measured - no forecast of minutes on
                # this bench, and saying so is the point), and the rung he really reached in the season predicted.
                "rung": rung(s_, minutes_per_game(a1)),
                "rungActual": rung(r["s_actual"], minutes_per_game(r["a_next"])),
                # SEPTEMBER: the rounds to play, the votes over the rounds already played (what the adopted blend
                # reads: the club's calendar, `SEPTEMBER_SEEN`), and the games a spell still open should cost.
                "rounds": r["N"],
                "seenVotes": r["pv_seen"] if moment == "settembre" else None,
                "seenRounds": r["seen"] if moment == "settembre" else None,
                "outOpen": r.get("out_open"),
                "paFormula": round(pa, 1), "paEngine": r["pa_engine"], "paActual": r["pa_actual"],
                "sample": (r["window"], r["fc_id"]) in sampled,
                "injury": r["injury"],
            })

    def median_of(key, field):
        values = [abs(x[field] - x["paActual"]) for x in out_rows if x["window"] == key
                  and x["paEngine"] is not None]
        return round(median(values), 2) if values else None

    summary = {key: {"moment": f["moment"], "target": f["target"], "auction": f["auction"],
                     "fitted_on": "le altre finestre", "out_of_sample": True,
                     **{k: f[k] for k in ("n", "unforeseen", "mae_formula", "mae_engine", "median_ratio_formula",
                                          "median_ratio_engine", "within20_formula", "within20_engine")},
                     "median_formula": median_of(key, "paFormula"), "median_engine": median_of(key, "paEngine"),
                     "zero_actual": sum(x["paActual"] <= 0 for x in out_rows if x["window"] == key
                                        and x["paEngine"] is not None)}
               for key, f in {**folds, **sep_folds}.items()}
    newest = params_by_fold[windows[-1]]
    result = {
        "generated_at": dt.datetime.now(tz=dt.UTC).isoformat(timespec="seconds"),
        "formula": "Pa = N x D x S x europa x c",
        "protocol": "two moments, leave one window out",
        "params": {k: (round(v, 4) if isinstance(v, float) else v) for k, v in newest.items() if k in GRID},
        # The page shows the cells the rule reads: one per role inside a context (the thinner ones fall back).
        "priors": {f"{role} {ctx}": round(v, 3) for (role, ctx), (v, n) in newest["Sbar"].items()
                   if role != "*" and n >= CELL_MIN},
        "cellMin": CELL_MIN, "qtiBase": QTI_BASE, "longInjuryShare": round(LONG_INJURY_SHARE, 3),
        "reproduction": repro, "edges": edges,
        "moments": {"luglio": {"verdict": july_verdict},
                    "settembre": {"verdict": sep_verdict, "k_rule": k_key, "k": k_rounds}},
        # v1 and the page's own reader call the pre-season verdict «verdict»: the July one, which is that.
        "verdict": july_verdict,
        "summary": summary, "rows": out_rows,
    }
    exports = [d for d in (config.data_dir / "export").iterdir() if d.is_dir() and (d / "manifest.json").exists()]
    target = Path(args.out) if args.out else max(exports, key=lambda d: d.name) / "presence_test.json"
    target.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    print(f"campione: {sum(1 for row in out_rows if row['sample'])} righe; {len(out_rows)} righe in {target}")


if __name__ == "__main__":
    main()
