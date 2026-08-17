"""How many league appearances does a mid-season continental cup actually cost?

Read-only on the DB, one run and one table: `python toolkit/bench/panel/cup_penalty.py <outdir>` from the
repository root. It is in the repo because a measurement nobody can repeat is an opinion - the coefficients
it produces are the ones `engine/cups.py` carries, and the numbers quoted in gate-motore-v1.md
§7-quattuortricies come from here.

Difference-in-differences on the dated per-match layer. For every (season, tournament window):
  treated = players whose nationality belongs to the confederation whose cup is being played;
  control = everybody else in the same league and season;
  outcome = share of his CLUB'S league matches he was on the pitch for, inside vs outside the window.

The DiD removes what the window itself does (winter fixtures, cup congestion, the calendar) and
leaves the part attributable to being away. Nationality comes from the cached SofaScore payloads
(the identity funnel, never a name), the club/match strings come from ONE parser on both sides.
"""

from __future__ import annotations

import collections
import glob
import json
import re
import sqlite3
import sys

DB = "data/euroleghe.db"
LEAGUES = ("serie_a", "premier_league", "la_liga", "bundesliga", "ligue_1")

# Verified from the public record, not from memory (see the session's sources).
WINDOWS = [
    ("2021-22", "CAF", "afcon_2021", "2022-01-09", "2022-02-06"),
    ("2023-24", "CAF", "afcon_2023", "2024-01-13", "2024-02-11"),
    ("2023-24", "AFC", "asian_cup_2023", "2024-01-12", "2024-02-10"),
    ("2025-26", "CAF", "afcon_2025", "2025-12-21", "2026-01-18"),
]

AFC = {"Japan", "South Korea", "North Korea", "Australia", "Uzbekistan", "Jordan", "Indonesia",
       "Iran", "Iraq", "Saudi Arabia", "Qatar", "United Arab Emirates", "Oman", "Bahrain", "Kuwait",
       "Palestine", "China", "Kyrgyzstan", "Syria", "Singapore", "Vietnam", "Thailand", "Tajikistan",
       "Yemen", "India", "Malaysia", "Philippines", "Hong Kong", "Lebanon", "Turkmenistan", "Myanmar"}
CAF = {"Algeria", "Angola", "Benin", "Botswana", "Burkina Faso", "Burundi", "Cameroon", "Cape Verde",
       "Cabo Verde", "Central African Republic", "Chad", "Comoros", "Congo", "DR Congo", "Djibouti",
       "Egypt", "Equatorial Guinea", "Eritrea", "Eswatini", "Ethiopia", "Gabon", "Gambia", "Ghana",
       "Guinea", "Guinea-Bissau", "Ivory Coast", "Côte d'Ivoire", "Kenya", "Lesotho", "Liberia",
       "Libya", "Madagascar", "Malawi", "Mali", "Mauritania", "Mauritius", "Morocco", "Mozambique",
       "Namibia", "Niger", "Nigeria", "Rwanda", "Senegal", "Seychelles", "Sierra Leone", "Somalia",
       "South Africa", "South Sudan", "Sudan", "Tanzania", "Togo", "Tunisia", "Uganda", "Zambia",
       "Zimbabwe"}


def nationality_from_cache() -> tuple[dict[str, str], set[str]]:
    """{provider id: country} plus the provider ids SofaScore itself flags as internationals."""
    country: dict[str, str] = {}
    internationals: set[str] = set()
    newest: dict[str, tuple[str, str]] = {}
    pattern = re.compile(r"sofascore_squad_(\d+)_(\d{4}-\d{2}-\d{2})\.json$")
    for path in glob.glob("data/cache/sofascore_squad_*.json"):
        match = pattern.search(path.replace("\\", "/"))
        if match and (match.group(1) not in newest or match.group(2) > newest[match.group(1)][0]):
            newest[match.group(1)] = (match.group(2), path)
    for _date, path in newest.values():
        with open(path, encoding="utf-8") as handle:
            payload = json.load(handle)
        for key in ("players", "foreignPlayers", "nationalPlayers"):
            for entry in payload.get(key) or []:
                player = entry.get("player") or {}
                name = (player.get("country") or {}).get("name")
                if player.get("id") and name:
                    country[str(player["id"])] = name
        for entry in payload.get("nationalPlayers") or []:
            if (entry.get("player") or {}).get("id"):
                internationals.add(str(entry["player"]["id"]))
    for path in glob.glob("data/cache/sofascore_player_*.json"):
        with open(path, encoding="utf-8") as handle:
            player = (json.load(handle) or {}).get("player") or {}
        name = (player.get("country") or {}).get("name")
        if player.get("id") and name:
            country.setdefault(str(player["id"]), name)
    return country, internationals


def confederation(country: str | None) -> str | None:
    if country in AFC:
        return "AFC"
    if country in CAF:
        return "CAF"
    return None


def main() -> None:
    conn = sqlite3.connect(DB)
    country, internationals = nationality_from_cache()
    xref = {source_id: fc_id for source_id, fc_id in conn.execute(
        "SELECT source_id, fc_id FROM player_xref WHERE source = 'sofascore'")}
    nat = {xref[sid]: name for sid, name in country.items() if sid in xref}
    intl = {xref[sid] for sid in internationals if sid in xref}
    print(f"nationality known for {len(nat)} fc_id · flagged internationals {len(intl)}\n")

    rows = []
    for season, conf, key, start, end in WINDOWS:
        # the club's own league matches, split by the window
        club_matches: dict[tuple[str, str], dict[str, set]] = collections.defaultdict(
            lambda: {"in": set(), "out": set()})
        for league, club, match_id, date in conn.execute(
                "SELECT competition, club, match_id, match_date FROM club_match_lineups "
                f"WHERE season = ? AND competition IN ({','.join('?' * len(LEAGUES))})",
                (season, *LEAGUES)):
            bucket = "in" if start <= date <= end else "out"
            club_matches[(league, club)][bucket].add(match_id)

        # who was on the pitch, per player, per bucket
        played: dict[tuple[int, str, str], dict[str, set]] = collections.defaultdict(
            lambda: {"in": set(), "out": set()})
        for fc_id, league, club, match_id, date, minutes in conn.execute(
                "SELECT fc_id, competition, club, match_id, match_date, minutes FROM external_match_stats "
                f"WHERE season = ? AND competition IN ({','.join('?' * len(LEAGUES))})",
                (season, *LEAGUES)):
            if not minutes:
                continue                      # NULL = named and never came on (project convention)
            bucket = "in" if start <= date <= end else "out"
            played[(fc_id, league, club)][bucket].add(match_id)

        for (fc_id, league, club), buckets in played.items():
            fixtures = club_matches.get((league, club))
            if not fixtures or not fixtures["in"] or len(fixtures["out"]) < 10:
                continue                      # a club with no window fixtures says nothing
            if fc_id not in nat:
                continue                      # vuoto = ignoto, never counted as a control
            share_out = len(buckets["out"]) / len(fixtures["out"])
            share_in = len(buckets["in"]) / len(fixtures["in"])
            rows.append({"season": season, "window": key, "conf": conf, "league": league,
                         "fc_id": fc_id, "country": nat[fc_id],
                         "treated": confederation(nat[fc_id]) == conf,
                         "intl": fc_id in intl, "share_in": share_in, "share_out": share_out,
                         "n_in": len(fixtures["in"]), "n_out": len(fixtures["out"])})

    def mean(values):
        values = list(values)
        return sum(values) / len(values) if values else float("nan")

    print(f"{'window':16s} {'group':9s} {'n':>4s} {'out':>7s} {'in':>7s} {'delta':>8s}")
    did_by_window = {}
    for key in dict.fromkeys(r["window"] for r in rows):
        block = [r for r in rows if r["window"] == key]
        deltas = {}
        for label, subset in (("treated", [r for r in block if r["treated"]]),
                              ("control", [r for r in block if not r["treated"]])):
            if not subset:
                continue
            out, inside = mean(r["share_out"] for r in subset), mean(r["share_in"] for r in subset)
            deltas[label] = inside - out
            print(f"{key:16s} {label:9s} {len(subset):4d} {out:7.3f} {inside:7.3f} {inside - out:+8.3f}")
        if "treated" in deltas and "control" in deltas:
            did_by_window[key] = deltas["treated"] - deltas["control"]
            print(f"{'':16s} {'DiD':9s} {'':4s} {'':7s} {'':7s} {did_by_window[key]:+8.3f}")
    print()

    # Conditioned on what the model can know BEFORE the season: he is a regular, and he is capped.
    print("Conditioned on the population the rule would act on (share_out >= 0.50):")
    print(f"{'window':16s} {'group':22s} {'n':>4s} {'out':>7s} {'in':>7s} {'delta':>8s} {'DiD':>8s}")
    for key in dict.fromkeys(r["window"] for r in rows):
        block = [r for r in rows if r["window"] == key and r["share_out"] >= 0.50]
        control = [r for r in block if not r["treated"]]
        base = mean(r["share_in"] for r in control) - mean(r["share_out"] for r in control)
        for label, subset in (("treated", [r for r in block if r["treated"]]),
                              ("treated + capped", [r for r in block if r["treated"] and r["intl"]]),
                              ("treated, not capped", [r for r in block if r["treated"] and not r["intl"]]),
                              ("control", control)):
            if not subset:
                continue
            out, inside = mean(r["share_out"] for r in subset), mean(r["share_in"] for r in subset)
            did = (inside - out) - base if label != "control" else 0.0
            print(f"{key:16s} {label:22s} {len(subset):4d} {out:7.3f} {inside:7.3f} "
                  f"{inside - out:+8.3f} {did:+8.3f}")
    print()

    # THE OTHER HALF OF THE LISTONE, and it is measured rather than capped. The coefficient above is a
    # difference in SHARES measured on regulars; applying it to a squad player would charge him rounds he
    # was never going to play, and CAPPING it at his own predicted share is a guess about him. So the
    # band is a POPULATION and gets its own number: «diamo penalità a tutti» done by measuring, not by
    # extrapolating. Bands on his share OUTSIDE the window, which is what the sheet knows before the cup.
    print("Per BAND of his own share outside the window (the population each coefficient is about):")
    print(f"{'window':16s} {'band':14s} {'group':9s} {'n':>4s} {'out':>7s} {'in':>7s} {'DiD':>8s}")
    BANDS = (("regular", 0.50, 1.01), ("rotation", 0.25, 0.50), ("fringe", 0.0, 0.25))
    for key in dict.fromkeys(r["window"] for r in rows):
        for label, low, high in BANDS:
            block = [r for r in rows if r["window"] == key and low <= r["share_out"] < high]
            control = [r for r in block if not r["treated"]]
            treated = [r for r in block if r["treated"]]
            if not treated or not control:
                continue
            base = mean(r["share_in"] for r in control) - mean(r["share_out"] for r in control)
            for name, subset in (("treated", treated),
                                 ("capped", [r for r in treated if r["intl"]]),
                                 ("not capped", [r for r in treated if not r["intl"]])):
                if not subset:
                    continue
                did = (mean(r["share_in"] for r in subset) - mean(r["share_out"] for r in subset)) - base
                print(f"{key:16s} {label:14s} {name:9s} {len(subset):4d} "
                      f"{mean(r['share_out'] for r in subset):7.3f} "
                      f"{mean(r['share_in'] for r in subset):7.3f} {did:+8.3f}")
    print()

    # ...and the same bands POOLED over the windows of one confederation, which is what ships: three
    # windows of four are CAF and one is AFC, so a pooled CAF number has three observations behind it.
    print("POOLED per confederation and band (what the coefficients are read from):")
    print(f"{'conf':5s} {'band':10s} {'group':11s} {'n':>4s} {'windows':>8s} {'DiD':>8s}")
    for conf in ("CAF", "AFC"):
        for label, low, high in BANDS:
            for name, want in (("capped", True), ("not capped", False)):
                per_window = []
                total = 0
                for key in dict.fromkeys(r["window"] for r in rows if r["conf"] == conf):
                    block = [r for r in rows if r["window"] == key and low <= r["share_out"] < high]
                    control = [r for r in block if not r["treated"]]
                    subset = [r for r in block if r["treated"] and r["intl"] is want]
                    if not subset or not control:
                        continue
                    base = mean(r["share_in"] for r in control) - mean(r["share_out"] for r in control)
                    per_window.append(
                        (mean(r["share_in"] for r in subset) - mean(r["share_out"] for r in subset)) - base)
                    total += len(subset)
                if per_window:
                    print(f"{conf:5s} {label:10s} {name:11s} {total:4d} {len(per_window):8d} "
                          f"{mean(per_window):+8.3f}")
    print()

    # The same thing in the unit the sheet needs: matchdays lost over a full season.
    print("Rounds lost per treated regular, in the window and over the season:")
    for key in dict.fromkeys(r["window"] for r in rows):
        block = [r for r in rows if r["window"] == key and r["share_out"] >= 0.50]
        control = [r for r in block if not r["treated"]]
        base = mean(r["share_in"] for r in control) - mean(r["share_out"] for r in control)
        for label, subset in (("all treated", [r for r in block if r["treated"]]),
                              ("capped only", [r for r in block if r["treated"] and r["intl"]])):
            if not subset:
                continue
            did = (mean(r["share_in"] for r in subset) - mean(r["share_out"] for r in subset)) - base
            window_rounds = mean(r["n_in"] for r in subset)
            season_rounds = mean(r["n_in"] + r["n_out"] for r in subset)
            print(f"  {key:16s} {label:12s} n={len(subset):3d} DiD {did:+.3f} × {window_rounds:.1f} "
                  f"window rounds = {did * window_rounds:+.2f} rounds "
                  f"({did * window_rounds / season_rounds * 100:+.1f}% of a {season_rounds:.0f}-round season)")

    with open(sys.argv[1] + "/did_rows.json", "w", encoding="utf-8") as handle:
        json.dump(rows, handle, ensure_ascii=False)


if __name__ == "__main__":
    main()
