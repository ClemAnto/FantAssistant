"""bench/auction/advice - DOES THE ENGINE'S ADVICE FAVOUR WHOEVER USES IT? Asked without a table.

    python -m bench.auction.advice

The operator's question of 02/09/2026, and it deserves an answer that does not depend on the simulated
room: every auction-level number `bench.py` publishes is conditional on the declared table, and §23.4
measured two reasons to distrust that room at the bottom of the market. This judge takes the room out.

WHAT MAKES IT POSSIBLE is a conservation law this bench is already built on. A roster is
`sum(rules.SLOTS)` = 25 men and a listone holds exactly 25 BANDS of `rules.TEAMS` men (a tier is a rank
over the teams), so **a squad is one man per band** - and the only decision the advice actually changes
is WHICH of the ten men of a band you take. That decision can be scored on what those men REALLY did:
`fm_act`, `pv_act` and `actual` travel in every window of `bench/draft/leghe-classic.json`, and
`fm_pred`/`pv_pred` are cross-fit on an adjacent window exactly as the gate does it.

THREE MEASUREMENTS, and each one answers a different half of the question.

  1. PER PICK, on a man's own realised season. Four pickers on the same band: the quotation's own
     choice (the dearest), the engine's (`pv_pred`, which `metrica-asta-surplus-v1.md` §18 measured as
     the whole of our incremental edge), the value (`fm_pred x pv_pred`) and the surplus. The null is
     the band's MEAN, which is what a dart throw returns.
  2. TWO SQUADS, same bands, same prices, one chosen by the engine and one by the quotation, both
     playing the real season. This is the simulation with no room in it.
  3. THE SATURATION CURVE: how the squad moves as `k` of its 25 bands are chosen by the engine, the
     bands drawn AT RANDOM - because swapping them in a fixed order measures the order.

WHAT IT FOUND (02/09/2026, ten real seasons), and the third figure is the one to keep in mind:
  * the engine's pick is worth **+19.9 +- 5.2 realised fantapunti per pick** over the quotation's own
    (t 3.8, 9 seasons of 10), and the quotation's pick inside a band is worth **-1.0 +- 3.7 against a
    dart throw**: inside a price band the listone carries no information and our forecast does.
  * at the SQUAD level the same 25 swaps buy **+26.4 fantapunti a season (+0.99%)**, with the holes
    HALVED (18.2 -> 8.5) and both modifiers up (R 11.4 -> 13.9, defence 13.9 -> 17.9).
  * so **one swap is worth +2.4 fantapunti of squad score on the first five bands and +0.7 on the last
    five, not +19.9**: a squad fields ELEVEN of its 25, so most of a man's extra appearances are
    absorbed and what survives is the cover - which is why the curve DIMINISHES, an eleven being
    coverable only once. The value of a threshold cannot be written on a row: the R-Factor's own
    lesson, met from a new side.
  * and the squad test cannot RANK our own columns: the surplus picker reads +36.0 (t 1.10) against the
    appearances' +26.4 (t 0.67), i.e. the same thing within its noise, while per pick the appearances
    win clearly (+19.9, t 3.8) and the surplus does not (+5.0, t 1.0). Ten seasons of squads separate
    «the engine beats the quotation» from nothing, and nothing finer.
  * and ten real seasons CANNOT certify +26 (se 40, t 0.67): that is why `bench.py` replays the same
    ten seasons over hundreds of urns. The bench's job is POWER, not more football.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import statistics as st

from . import rules
from .bench import (Team, WINDOWS_FILE, priced_pool, role_of, season, tier_asks)
from .profiles import MARKET

#: The pickers, and each one is a claim about what to read. Ties go to the lower id so a re-run of a
#: year from now reads the same men.
PICKERS = {
    "market (the dearest of the band)": lambda men: max(men, key=lambda m: (m["price"], -m["id"])),
    "ENGINE (who plays most)": lambda men: max(men, key=lambda m: ((m.get("pv_pred") or -1),
                                                                   -m["id"])),
    "value (fm x pv)": lambda men: max(men, key=lambda m: ((m.get("value") or -1), -m["id"])),
    "surplus": lambda men: max(men, key=lambda m: ((m.get("surplus") or -1e9), -m["id"])),
}
BASE = "market (the dearest of the band)"


def bands(window: dict) -> list[tuple[str, int, list[dict], int]]:
    """The listone cut into its 25 bands, each with what the market pays for that tier.

    The price is the tier's own mean ask times `profiles.MARKET`'s measured multiple, so both squads
    of measurement 2 pay exactly the same for the same band and the comparison is about the CHOICE.
    Summed over the bands it recovers about 79% of a budget, which is what `MARKET` says about itself
    (it is a median, and the tail of a real auction inflates the rest).
    """
    pool = priced_pool(window)
    asks = tier_asks(pool)
    out = []
    for role in rules.SLOTS:
        men = sorted((m for m in pool if role_of(m) == role), key=lambda m: (-m["price"], m["id"]))
        for tier in range(rules.SLOTS[role]):
            band = men[tier * rules.TEAMS:(tier + 1) * rules.TEAMS]
            if not band:
                continue
            ladder = MARKET[role]
            paid = max(1, round(asks[(role, tier)] * ladder[min(tier, len(ladder) - 1)]))
            out.append((role, tier, band, paid))
    return out


def squad(window: dict, cut: list, chosen: set[int], pick, other=None) -> dict:
    """One man per band, `chosen` bands by `pick` and the rest by `other`, playing the real season."""
    team = Team("advice", "ENGINE", None)
    team.matchdays = window["rounds"]
    for index, (role, _tier, band, paid) in enumerate(cut):
        got = (pick if index in chosen else (other or PICKERS[BASE]))(band)
        team.men[role].append({**got, "paid": paid})
    return season(team, window["votes"], window.get("base", {}), window["rounds"])


def _report(mean: float, values: list[float]) -> str:
    se = st.stdev(values) / math.sqrt(len(values)) if len(values) > 1 else float("nan")
    return f"{mean:+8.1f} +- {se:6.1f} (t {mean / se:5.2f})" if se else f"{mean:+8.1f}"


def per_pick(windows: dict) -> None:
    """1. What a pick is worth, on the man's OWN realised season."""
    picked: dict[tuple, list] = {}
    for key, window in windows.items():
        for role, tier, band, _paid in bands(window):
            known = [m for m in band if m.get("actual") is not None]
            if len(known) < 5:
                continue
            chance = st.mean(m["actual"] for m in known)
            for name, pick in PICKERS.items():
                got = pick(band)
                if got.get("actual") is not None:
                    picked.setdefault((name, role, tier), []).append((key, got["actual"], chance))
    print("1. WHAT A PICK IS WORTH, in realised fantapunti - the man's own season, no table anywhere")
    print(f"   {'picker':34s}{'over a dart throw':>26s}{'seasons':>10s}")
    for name in PICKERS:
        rows = [row for key in picked if key[0] == name for row in picked[key]]
        gains = [a - c for _k, a, c in rows]
        per_window: dict[str, list[float]] = {}
        for k, a, c in rows:
            per_window.setdefault(k, []).append(a - c)
        wins = sum(1 for k in per_window if st.mean(per_window[k]) > 0)
        print(f"   {name:34s}{_report(st.mean(gains), gains):>26s}"
              f"{f'{wins}/{len(windows)}':>10s}")
    print(f"\n   ...and PAIRED against the quotation's own pick on the same band")
    for name in PICKERS:
        if name == BASE:
            continue
        diff, per_win = [], {}
        for role in rules.SLOTS:
            for tier in range(rules.SLOTS[role]):
                mine = {k: a for k, a, _c in picked.get((name, role, tier), [])}
                theirs = {k: a for k, a, _c in picked.get((BASE, role, tier), [])}
                for k in mine.keys() & theirs.keys():
                    diff.append(mine[k] - theirs[k])
                    per_win.setdefault(k, []).append(mine[k] - theirs[k])
        wins = sum(1 for k in per_win if st.mean(per_win[k]) > 0)
        same = sum(1 for x in diff if x == 0)
        print(f"   {name:34s}{_report(st.mean(diff), diff):>26s}"
              f"{f'{wins}/{len(windows)}':>10s}   {same} scelte identiche su {len(diff)}")


def two_squads(windows: dict) -> None:
    """2. The simulation with no room: same bands, same prices, two ways of choosing."""
    print("\n2. TWO SQUADS, the same 25 bands at the same prices, playing the real season")
    scored: dict[str, dict] = {}
    for name, pick in PICKERS.items():
        rows, cost = [], []
        for key, window in windows.items():
            cut = bands(window)
            rows.append(squad(window, cut, set(range(len(cut))), pick))
            cost.append(sum(paid for _r, _t, _b, paid in cut))
        scored[name] = {"rows": rows, "cost": st.mean(cost)}
    print(f"   {'chosen by':34s}{'fantapunti':>12s}{'holes':>8s}{'R':>7s}{'def':>7s}{'cost':>8s}")
    for name, got in scored.items():
        rows = got["rows"]
        print(f"   {name:34s}{st.mean(r['points'] for r in rows):12.1f}"
              f"{st.mean(r['holes'] for r in rows):8.1f}"
              f"{st.mean(r['r_factor'] for r in rows):7.1f}"
              f"{st.mean(r['defence'] for r in rows):7.1f}{got['cost']:8.0f}")
    print(f"\n   {'paired against the quotation':34s}{'a season':>26s}{'seasons':>10s}")
    for name in PICKERS:
        if name == BASE:
            continue
        diff = [a["points"] - b["points"]
                for a, b in zip(scored[name]["rows"], scored[BASE]["rows"])]
        share = st.mean(diff) / st.mean(r["points"] for r in scored[BASE]["rows"]) * 100
        print(f"   {name:34s}{_report(st.mean(diff), diff):>26s}"
              f"{f'{sum(1 for d in diff if d > 0)}/{len(diff)}':>10s}   {share:+.2f}%")


def saturation(windows: dict, draws: int) -> None:
    """3. How much the advice buys as more bands follow it - the bands drawn AT RANDOM.

    Swapped in a fixed order the curve measures the order (keepers first reads +6.4 on one swap), so
    the bands are sampled. What the shape says: the gain is real and DIMINISHING, because what the
    advice buys is the cover of an eleven and an eleven can only be covered once.
    """
    print(f"\n3. THE SATURATION CURVE, {draws} random subsets of each size")
    steps = (0, 2, 5, 8, 11, 15, 20, 25)
    rows: dict[int, list] = {}
    for key, window in windows.items():
        cut = bands(window)
        for k in steps:
            for draw in range(1 if k in (0, len(cut)) else draws):
                shuffle = random.Random(f"{key}|{k}|{draw}".encode().hex())
                chosen = set(shuffle.sample(range(len(cut)), min(k, len(cut))))
                rows.setdefault(k, []).append(
                    squad(window, cut, chosen, PICKERS["ENGINE (who plays most)"]))
    zero = st.mean(r["points"] for r in rows[0])
    print(f"   {'bands':>7s}{'fantapunti':>12s}{'gain':>8s}{'per band':>10s}{'holes':>8s}"
          f"{'R':>7s}{'def':>7s}")
    for k in steps:
        pts = st.mean(r["points"] for r in rows[k])
        print(f"   {k:7d}{pts:12.1f}{pts - zero:+8.1f}{(pts - zero) / k if k else 0:10.2f}"
              f"{st.mean(r['holes'] for r in rows[k]):8.1f}"
              f"{st.mean(r['r_factor'] for r in rows[k]):7.1f}"
              f"{st.mean(r['defence'] for r in rows[k]):7.1f}")
    five = (st.mean(r["points"] for r in rows[5]) - zero) / 5
    last = (st.mean(r["points"] for r in rows[25]) - st.mean(r["points"] for r in rows[20])) / 5
    print(f"\n   the marginal band: {five:+.2f} fantapunti on the first five, {last:+.2f} on the "
          f"last five")


def main() -> None:
    parser = argparse.ArgumentParser(description="does the engine's advice favour whoever uses it?")
    parser.add_argument("--draws", type=int, default=30,
                        help="random subsets per size in the saturation curve (default 30)")
    args = parser.parse_args()
    if not WINDOWS_FILE.exists():
        raise SystemExit(f"missing {WINDOWS_FILE.name}: run bench/draft/extract.py first")
    windows = json.loads(WINDOWS_FILE.read_text(encoding="utf-8"))
    print(f"{len(windows)} real seasons, {sum(rules.SLOTS.values())} bands of {rules.TEAMS} men\n")
    per_pick(windows)
    two_squads(windows)
    saturation(windows, args.draws)


if __name__ == "__main__":
    main()
