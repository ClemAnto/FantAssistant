"""categories - which of six words describes what a man is WORTH INSIDE HIS ROLE, for the season coming.

THE SIX WORDS ARE THE OPERATOR'S, dictated 01/09/2026, and five of them are his own list:

    oro         he plays every week and brings a lot of bonus      (Malen, Dimarco, Paz N.)
    argento     he plays every week and brings some bonus
    bronzo      he plays every week                                (Lobotka, Cristante)
    cristallo   he plays little, and brings bonus when he does     (Dybala, Berardi)
    scommessa   nobody has measured him yet - he might beat the discards
    scarto      he plays little and brings nothing

The sixth is his own word too, taken from the sentence that defines the fifth («potrebbe fare bene
rispetto agli SCARTI»): every player must carry a category, and a man who is neither a regular nor a
bonus man is not unknown - he is measured, and the measurement is bad. Naming him is a statement;
leaving him blank would read as «not computed», which is what `scommessa` means here.

TWO AXES, AND THEY ARE ASYMMETRIC ON PURPOSE - which is the whole content of this module.

  * WILL HE PLAY is a FORECAST: `engine_pv_pred / matchdays`, i.e. titolarita in this project's only
    sense (the share of the matchdays he gets a VOTO in). It has to be the forecast and not his record,
    or Malen - 18 Serie A appearances, all of them after January - would not be a man who plays every
    week, and the operator's first example would fail.
  * WHAT HE BRINGS is a TRAIT: the bonus per appearance he has actually delivered, `fm - mv` per season,
    over the five most recent seasons anybody measured (`features.bonus_seasons`, one aligned pair per
    season, `pv >= 15`). It has to be his record and not the forecast, or Dybala reads +0.48 - BELOW the
    median forward - because the engine regresses a falling rate, and the operator's fourth example
    would fail. His history says +1.19, and that is what the word «cristallo» is about.

    A mean that JUDGES drops the best and the worst season from five up (the operator's standing
    convention), so one freak season cannot crown a man - and cannot bury him either.

WITHIN HIS ROLE, and the bars are ABSOLUTE (his ruling, 01/09/2026, over percentiles recomputed per
sheet): a `pc` is not compared with a `dc`, and a bar that moved with the sheet would make «oro» mean a
different thing every week. They are MEASURED once and written here: the 60th and 80th percentile of the
per-season bonus rate of the men each listone quoted in that role, over five seasons (2021-22 .. 2025-26),
one row per (player, season) with at least 15 votes - a rate over three matches is noise, and a bar
measured on noise is a bar about noise. The pool is every man any listone carried, and each season is read
from the platform that measured it best, so the TRAIT and the BAR sit on one ruler.

WHY p60 AND p80: because his seven names are the specification and those two bars reproduce all seven.
p90 puts Malen (1.33 against 1.54) and Paz N. (0.74 against 0.77) in argento, contradicting two of the
three examples he gave for `oro`; p70/p80 also reproduces the seven but leaves `argento` ten percentiles
wide - 12 men on a 609-row sheet - which is a band nobody could read. Delivered on the 2026-27 Serie A
sheet: oro 13, argento 25, bronzo 57, cristallo 86, scommessa 218, scarto 210.

TWO THINGS THAT ARE TRUE AND LOOK LIKE DEFECTS, so they are stated rather than cured:

  * A MAN CAN READ DIFFERENTLY ON TWO SHEETS. Malen is `oro` on Serie A classic and `argento` on
    EuroLeghe mantra, because `pc` is a narrower and stronger class than `A` (its p80 is 1.39 against
    1.25) - the same reason his SURPLUS is a different number there. Lobotka is `bronzo` on one and
    `scarto` on the other, because the two platforms have different calendars and the euro engine expects
    him in 0.63 of 31 rounds against 0.72 of 38. A category is a fact about (sheet, role), like every
    other number on the row.
  * THE KEEPERS' BARS ARE NEGATIVE (-1.10 / -0.93). For a keeper `fm - mv` is dominated by the goals he
    concedes, so «brings bonus» means «concedes little and keeps clean sheets», which is exactly what a
    keeper is bought for. Reading it inside the role is what makes the word survive the sign.

WHAT IT IS NOT. REPORTING: no `engine_*` column moves and no gate owns these bars. What is gated is
underneath - the appearances forecast is the engine's, the fantamedia and the base vote are the engine's -
and this module only says where two of those numbers put a man. `engine_*` cannot move for a structural
reason and not because somebody hopes so: no rule reads `bonus_seasons`, and `evaluate` never sees a
`desc_*` column. The `backtest --verify` 22/22 that says it out loud is OWED and not yet run - on
01/09/2026 the acquisition held the write lock (the DB is `journal_mode=delete`, so a long read blocks it)
and a check that breaks the run it is checking is worse than a check taken an hour later.

Dependency-free, like the rest of `engine/`: the shippable TypeScript engine gets ported from here.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

#: The six words. Their INDEX is the order the operator dictated them in, so a screen that sorts by
#: category has ONE ordering - three copies of six words would eventually disagree about one of them.
LADDER: tuple[str, ...] = ("oro", "argento", "bronzo", "cristallo", "scommessa", "scarto")

#: «gioca sempre»: the share of the target calendar he is expected to get a voto in. DECLARED, not
#: fitted - it is the one number he did not give. What it delivers is the separation of his own examples:
#: Lobotka 0.72 and Cristante 0.77 above it, Dybala 0.61 and Berardi 0.59 below.
PLAYS_ALWAYS = 0.70

#: (some bonus, a lot of bonus) per appearance, per role. See the module docstring for the measurement.
#: `b` is the thin pool (39 season-rows against 300-1300 for every other code): it is written down with
#: the others, and its bar is the one to re-measure first when the braccetti get quoted more widely.
BONUS_BARS: Mapping[str, Mapping[str, tuple[float, float]]] = {
    "classic": {
        "P": (-1.10, -0.93),
        "D": (0.10, 0.22),
        "C": (0.33, 0.57),
        "A": (0.87, 1.25),
    },
    "mantra": {
        "por": (-1.10, -0.93),
        "dc": (0.05, 0.17),
        "dd": (0.12, 0.24),
        "ds": (0.11, 0.23),
        "b": (0.08, 0.15),
        "e": (0.16, 0.30),
        "m": (0.16, 0.32),
        "c": (0.22, 0.40),
        "t": (0.50, 0.71),
        "w": (0.55, 0.77),
        "a": (0.75, 1.06),
        "pc": (1.00, 1.39),
    },
}


def bars_for(game: str, slot: str | None) -> tuple[float, float] | None:
    """The two bars for a row's own slot, or None when nothing can be said about it.

    A mantra sheet falls back to the CLASSIC table for a man the listone gives no code to, which is the
    same third case `snapshot.auction_level` already handles and for the same reason: his row would
    otherwise carry a word measured against nobody. The fallback is by SLOT NAME - on a mantra sheet that
    man's `engine_role_slot` is his listone role, A or D, which is a key of the classic table and never
    of the mantra one, so the two vocabularies cannot silently trade places.
    """
    if not slot:
        return None
    if game == "mantra":
        return BONUS_BARS["mantra"].get(slot) or BONUS_BARS["classic"].get(slot)
    return BONUS_BARS["classic"].get(slot)


def bonus_rate(seasons: Sequence[float]) -> float | None:
    """His bonus per appearance over the seasons anybody measured, most recent first.

    The mean drops the best and the worst season from five up - the operator's standing rule for a mean
    that judges - so neither one explosion nor one injured season decides a word. None in, None out: a man
    with no measured season has no rate, which is what makes him a `scommessa` rather than a `scarto`, and
    the two are opposite statements.
    """
    kept = list(seasons)[:5]
    if not kept:
        return None
    if len(kept) >= 5:
        kept = sorted(kept)[1:-1]
    return sum(kept) / len(kept)


def category_of(play_share: float | None, rate: float | None,
                bars: tuple[float, float] | None) -> str | None:
    """One of `LADDER`, or None when not even the appearances are known.

    `play_share` is `engine_pv_pred / matchdays`, `rate` is `bonus_rate(...)`, `bars` is `bars_for(...)`.

    NO RATE IS `scommessa` AND NEVER `scarto`: «vuoto = ignoto, mai zero», met here on a word that would
    otherwise call a nineteen-year-old bad because nobody has watched him yet. A row with no appearance
    forecast at all gets no word - the caller owes that distinction, exactly as it does for the six-rung
    ladder next door.
    """
    if play_share is None:
        return None
    if rate is None or bars is None:
        return LADDER[4]
    some, many = bars
    if play_share >= PLAYS_ALWAYS:
        return LADDER[0] if rate >= many else LADDER[1] if rate >= some else LADDER[2]
    return LADDER[3] if rate >= some else LADDER[5]


def rank_of(category: str | None) -> int | None:
    """Where a word sits in the list, 0 = `oro`. None for a row with no word, never a number."""
    if category is None:
        return None
    try:
        return LADDER.index(category)
    except ValueError:
        return None
