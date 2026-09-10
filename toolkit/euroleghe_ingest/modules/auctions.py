"""auctions - real auction exports -> `auction_prices`, what a room ACTUALLY paid, per month.

WHAT THIS IS AND WHAT IT IS NOT. Every price this project already holds is somebody's OPINION about
a footballer: the Qt.I is the market's pre-season expectation, the FVM is the same author's opinion
refreshed at every salient event. This table holds neither. It holds the CLEARING PRICE of real
auctions - what ten managers, with their own money and their own deadline, actually handed over for
that name. It is a fact about the ROOM and never about the player, and no engine path reads it: it
answers «what will it take», not «who will score». Those are two questions and the whole point of
the engine is that they have different answers.

DATED BY MONTH, on the operator's instruction (08/09/2026: «vorrei che il costo-medio-reale sia
anche un attributo per i calciatori del nostro db associato al mese»). The month is the auctions'
own - the median award date of each session, not the day the file was read - because a clearing
price ages: a September auction prices a squad two rounds into the season and an August one does
not. It is `injuries.observed_on` applied to a market: a table dated on the EVENT needs the date of
the OBSERVATION too, or it cannot tell a market that has not moved from a market nobody has watched.

NORMALISED TO A REFERENCE LEAGUE (`REF_TEAMS` x `REF_BUDGET`), because a credit means nothing on its
own: the same man on the same day costs 173 of a 500 budget in a two-man league and 685 of a 1000
budget in an eight-man one. The conversion is the share of the MONTEPREMI - `paid / (budget x
teams) x REF_TEAMS x REF_BUDGET` - and it was VERIFIED rather than assumed: paired on the same man,
6-8 squad leagues read 0.96 of the 10-12 squad ones and 2-4 squad leagues 1.02. What it does not
carry is the very top of a SMALL league, where one manager can put a third of a whole budget on one
name, which is why `MIN_TEAMS` starts at six.

THE POPULATION IS THE ROSTER SHAPE, and it is part of the price. A league that buys 3/8/8/6 is
buying a different set of men from one that buys six keepers, so the shape is a filter and not a
column: mixing them would produce one number describing two markets.

WHAT IT IS FOR: the Strategy page draws it beside the FVM, because the two disagree in a way that is
measured and systematic - the FVM is a fair price only for keepers and for the big forwards, while a
first-tier midfielder goes for two thirds of it. Details, and every figure quoted here:
`docs/real-data/2026-27/LEGGIMI.md`.

Source: the per-award export of a real auction platform (one row per award, with the session's own
settings on it). The raw file is NOT archived as it arrives - it carries the buyers' own team names,
which belong to other people's leagues - so `archive` writes an anonymous per-award copy under
`data/raw/auctions/` and that is what `rebuild` replays.
"""

from __future__ import annotations

import collections
import csv
import io
import statistics as st
from pathlib import Path

from euroleghe_ingest.context import Context

NAME = "auctions"
DESCRIPTION = "Real auction exports -> auction_prices (the clearing price, per month)"
DEPENDS_ON: list[str] = ["rosters"]
RAW_INPUTS: list[str] = ["auctions/auctions_<season>_<month>_<platform>_<game>.csv (by --import)"]
NETWORK = False

#: The league every price is expressed in. Ten squads because that is the conservation law the whole
#: project is calibrated on - `rules.TEAMS`, a tier being a rank divided by ten, the replacement level
#: at the 10 x slots-th man - and 1000 credits because that is the budget the FVM itself is calibrated
#: on, which is what makes the two columns comparable without converting anything.
REF_TEAMS = 10
REF_BUDGET = 1000

#: The roster shape a session must have for its prices to be pooled. Declared and not inferred: it is
#: the operator's own league, and a different shape is a different market.
REF_SLOTS = {"P": 3, "D": 8, "C": 8, "A": 6}

#: Below six squads one manager's whim moves the clearing price of the dearest man; below five
#: sessions a median is one manager's evening. Both are floors on the EVIDENCE, not on the player.
MIN_TEAMS = 6
MIN_AUCTIONS = 5

#: The columns the export must carry. Named here so an export that changes shape fails loudly instead
#: of writing a table of zeros - the defect this repository has paid for whenever a source was read
#: through a key nobody checked.
REQUIRED = ("asta_id", "gioco", "listone", "squadre", "budget_iniziale", "slot_P", "slot_D",
            "slot_C", "slot_A", "id_calciatore", "ruolo_classic", "crediti_pagati", "stagione")


def _num(value, default=None):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _quantile(values: list[float], p: float) -> float:
    ordered = sorted(values)
    i = (len(ordered) - 1) * p
    lo = int(i)
    hi = min(lo + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (i - lo)


def _month_of(rows: list[dict]) -> str | None:
    """The month an auction was PLAYED, from the median award timestamp.

    Per SESSION and not per award, so a session that runs past midnight on the last of the month is
    not split in two. The median and not the first award: one export in fifty opened on 17 August and
    closed on 8 September, and its first timestamp would file three weeks of bidding under a month
    that saw eight of its 250 lots.
    """
    days = sorted(r["timestamp_italia"][:7] for r in rows if r.get("timestamp_italia"))
    return days[len(days) // 2] if days else None


def read_export(path: Path | str) -> list[dict]:
    """The raw per-award export, grouped by session and checked for the columns we read."""
    rows = list(csv.DictReader(io.open(path, encoding="utf-8-sig")))
    if not rows:
        raise ValueError(f"{path}: empty export")
    missing = [c for c in REQUIRED if c not in rows[0]]
    if missing:
        raise ValueError(f"{path}: the export does not carry {missing}")
    sessions: dict[str, list[dict]] = collections.OrderedDict()
    for row in rows:
        sessions.setdefault(row["asta_id"], []).append(row)
    return list(sessions.values())


def eligible(session: list[dict]) -> bool:
    """Whether a session's prices may be pooled: our roster shape, a real listone, enough squads."""
    head = session[0]
    if head["listone"] not in ("default", "euro"):
        return False                      # a hand-made listone has arbitrary quotations
    if any(head[f"slot_{r}"] != str(n) for r, n in REF_SLOTS.items()):
        return False
    return _num(head["squadre"], 0) >= MIN_TEAMS and _num(head["budget_iniziale"], 0) > 0


def measure(sessions: list[list[dict]]) -> dict[tuple, dict]:
    """(fc_id, season, platform, game, month) -> the clearing price and how much evidence is behind it.

    `sold` counts the sessions of the reference size where SOMEBODY took him at all, out of `sold_of`.
    It is the half that no quotation can carry: a man at 15/15 has to be bought now and one at 5/15
    can be waited for, and that is a fact about the room. Counted on the ten-squad sessions alone
    because they are the only ones whose denominator means the same thing - 250 slots out of one
    listone - while a six-squad league leaves a hundred men unsold by construction.
    """
    prices: dict[tuple, list[float]] = collections.defaultdict(list)
    seen: dict[tuple, set[str]] = collections.defaultdict(set)
    sold: dict[tuple, set[str]] = collections.defaultdict(set)
    reference: dict[tuple, set[str]] = collections.defaultdict(set)
    for session in sessions:
        if not eligible(session):
            continue
        head = session[0]
        month = _month_of(session)
        if not month:
            continue
        teams = _num(head["squadre"])
        budget = _num(head["budget_iniziale"])
        scale = REF_TEAMS * REF_BUDGET / (teams * budget)
        book = (head["stagione"], head["listone"], head["gioco"], month)
        if teams == REF_TEAMS:
            reference[book].add(head["asta_id"])
        for row in session:
            if not row["id_calciatore"].isdigit():
                continue
            key = (int(row["id_calciatore"]), *book)
            prices[key].append(_num(row["crediti_pagati"], 0) * scale)
            seen[key].add(head["asta_id"])
            if teams == REF_TEAMS:
                sold[key].add(head["asta_id"])
    out = {}
    for key, values in prices.items():
        if len(seen[key]) < MIN_AUCTIONS:
            continue
        book = key[1:]
        out[key] = {
            "auctions": len(seen[key]),
            "sold": len(sold[key]),
            "sold_of": len(reference[book]),
            "price_p25": round(_quantile(values, 0.25), 1),
            "price_med": round(st.median(values), 1),
            "price_p75": round(_quantile(values, 0.75), 1),
            "price_min": round(min(values), 1),
            "price_max": round(max(values), 1),
        }
    return out


def store(ctx: Context, measured: dict[tuple, dict]) -> int:
    for (fc_id, season, platform, game, month), row in measured.items():
        ctx.conn.execute(
            "INSERT OR REPLACE INTO auction_prices(fc_id, season, platform, game, month, auctions,"
            " sold, sold_of, price_p25, price_med, price_p75, price_min, price_max)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (fc_id, season, platform, game, month, row["auctions"], row["sold"], row["sold_of"],
             row["price_p25"], row["price_med"], row["price_p75"], row["price_min"],
             row["price_max"]))
    ctx.conn.commit()
    return len(measured)


def archive(ctx: Context, sessions: list[list[dict]]) -> list[Path]:
    """Write the ANONYMOUS per-award rows this table is derived from, one file per (season, month,
    platform, game), so `rebuild` can replay them.

    The award rows and not the aggregate, because the aggregation is ours and may change; the buyer
    is dropped entirely and the session keeps only its id, because who bought what belongs to other
    people's leagues and this repository is public. What is kept is exactly what `measure` reads.
    """
    folder = ctx.config.raw_dir / "auctions"
    folder.mkdir(parents=True, exist_ok=True)
    books: dict[tuple, list[list]] = collections.defaultdict(list)
    for session in sessions:
        if not eligible(session):
            continue
        head = session[0]
        month = _month_of(session)
        if not month:
            continue
        for row in session:
            books[(head["stagione"], month, head["listone"], head["gioco"])].append(
                [head["asta_id"], head["squadre"], head["budget_iniziale"], row["id_calciatore"],
                 row["ruolo_classic"], row["crediti_pagati"], row.get("fvm", ""),
                 row.get("qt_i", "")])
    written = []
    for (season, month, platform, game), rows in sorted(books.items()):
        dest = folder / f"auctions_{season}_{month}_{platform}_{game}.csv"
        with io.open(dest, "w", encoding="utf-8", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(["asta_id", "squadre", "budget_iniziale", "id_calciatore",
                             "ruolo_classic", "crediti_pagati", "fvm", "qt_i"])
            writer.writerows(rows)
        written.append(dest)
    return written


def _sessions_from_archive(path: Path) -> list[list[dict]]:
    """One archived file -> the sessions `measure` expects, with the book restored from the name."""
    stem = path.stem.split("_")
    season, month, platform, game = stem[1], stem[2], stem[3], stem[4]
    sessions: dict[str, list[dict]] = collections.OrderedDict()
    for row in csv.DictReader(io.open(path, encoding="utf-8")):
        # The month is restored from the FILE NAME, so an archived row needs no timestamp: it is
        # already filed under the month its session was played in, which is the fact being kept.
        row = dict(row, stagione=season, listone=platform, gioco=game,
                   timestamp_italia=f"{month}-15",
                   **{f"slot_{r}": str(n) for r, n in REF_SLOTS.items()})
        sessions.setdefault(row["asta_id"], []).append(row)
    return list(sessions.values())


def reingest_from_raw(ctx: Context) -> tuple[int, int]:
    """Replay every archived export (offline). Returns (files, rows written)."""
    folder = ctx.config.raw_dir / "auctions"
    files = sorted(folder.glob("auctions_*.csv")) if folder.exists() else []
    sessions: list[list[dict]] = []
    for path in files:
        sessions.extend(_sessions_from_archive(path))
    return len(files), (store(ctx, measure(sessions)) if sessions else 0)


def run(ctx: Context, *, import_files: list[str] | None = None, **_kwargs) -> None:
    ctx.require_conn()
    if import_files:
        for path in import_files:
            sessions = read_export(path)
            usable = [s for s in sessions if eligible(s)]
            written = store(ctx, measure(sessions))
            archived = archive(ctx, sessions)
            print(f"[auctions] {path}: {len(sessions)} sessioni, {len(usable)} nella popolazione"
                  f" -> {written} righe di auction_prices"
                  f" · archiviate {len(archived)} ({', '.join(p.name for p in archived)})")
        return
    files, rows = reingest_from_raw(ctx)
    if files:
        print(f"[auctions] {files} file archiviati rigiocati -> {rows} righe di auction_prices")
    else:
        print("[auctions] niente da fare: nessun export sotto data/raw/auctions/."
              " Importane uno con --import FILE.")
