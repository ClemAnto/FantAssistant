"""categories - which of seven words describes what a man is WORTH INSIDE HIS ROLE, for the season coming.

THE SEVEN WORDS ARE THE OPERATOR'S, dictated 22/09/2026, and they replace the six of 01/09 (oro,
argento, bronzo, cristallo, scommessa, scarto) on his instruction:

    supertop    he plays and is OFF THE SCALE in his role    (Malen, Martinez L., Dimarco, Paz N.)
    top         the best of his role, or off the scale but too fragile to play  (Calhanoglu, Hojlund)
    semitop     high in his role                             (Scamacca)
    buono       in the top quarter of his role, and he plays (Kvernadze, Varela)
    tappabuchi  he plays, and that is what you buy him for   (Pinamonti, Douglas Luiz)
    scarto      he does not even play - and it is MEASURED
    incognita   nothing to read: no expected fantamedia at all

TWO AXES, AND EVERY BAR COMES FROM A NAME HE GAVE. The nine verdicts he dictated are the
specification, exactly as the seven names of 01/09 were: they were all reproduced before this module
was written, and a change that breaks one of them is a change to re-discuss with him.

  * THE LEVEL is the expected fantamedia INSIDE THE ROLE. It has to be the forecast and not his
    record (Malen played 18 matches, all after January, and is the first `super`), and it has to be
    read inside the role because 6.78 is the best defender in the listone and the 44th forward.
    IT IS NOT THE BONUS RATE, which was tried first and REFUSED because it does not reproduce his
    names: Kvernadze and Varela sit under «qualche bonus» on both the historical and the expected
    scale and he calls them `solido`, while the expected fantamedia orders all six of his first names
    exactly as he labelled them (8.21 · 7.73 · 7.11 · 6.70 · 6.65 · 6.60 against supertop · supertop ·
    top · top · buono · buono). The fantamedia sums the base vote and the bonus, which is what he
    looks at.
  * WILL HE PLAY is `engine_pv_pred / matchdays`, titolarita in this project's only sense. It is what
    keeps Calhanoglu (the best midfielder of the listone, 0.60 of the calendar) and De Bruyne (0.70,
    «fragile, non puo' darti tante presenze») out of `super` - his own words, and the bar sits
    between De Bruyne at 0.70 and Martinez at 0.74.

THE LEVEL IS RE-BLENDED WITH A K PER ROLE, and this is the one piece that is measured rather than
declared. The sheet's fantamedia blends the season in progress with the previous one using R25's K,
which is FORTY for every role; measured out of sample (leave-one-season-out, ten seasons of Serie A,
target = the matchdays AFTER the k-th so the ones already seen are not inside the outcome), the right
weight depends on the role - and by a factor of two:

    role   K     weight of 5 played matchdays   gain over last season alone   seasons better
    P      16.6  23%                            6.2%                          9/10
    D      32.6  13%                            2.4%                          9/10
    C      43.5  10%                            1.7%                          7/10
    A      18.5  21%                            6.0%                          10/10

The mechanism is in the error itself: a forward's fantamedia is volatile (0.63 of MAE against a
defender's 0.28), so last season's signal is weaker and the new matches matter more. WITHOUT THIS the
scale cannot tell `solido` from `riserva`: Varela and Pinamonti have the same expected fantamedia
(6.60 and 6.61) and he puts them in different words - what separates them is that Varela is playing
well NOW (+2.88 of bonus, 6.62 of base vote) and Pinamonti is not (0.00 and 5.75). Re-blended, they
sit 36 percentiles apart instead of 1.

THIS IS REPORTING AND THE ENGINE DOES NOT MOVE. `engine_fm_pred` keeps R25's K of 40: changing the
engine's own blend per role is a GATED question and is pre-registered separately. What happens here is
that a `desc_*` column reads the same numbers with a weight measured for the question it answers - and
if the gate ever adopts a per-role K, this correction becomes the identity and should be removed
rather than counted twice.

THE BARS ARE ABSOLUTE (his ruling of 01/09/2026, over percentiles recomputed per sheet): a bar that
moved with the sheet would make a word mean something different every week. They were measured ONCE,
on the 2026-27 Serie A sheet the nine verdicts were given on, at the percentiles his own names put
them: `super` 97, `top` 93.5, `semi` 85, `solido` 77. Re-measure them when the listone changes
shape, and say so when you do.

Dependency-free, like the rest of `engine/`: the shippable TypeScript engine gets ported from here.
"""

from __future__ import annotations

from collections.abc import Mapping

#: The seven words. Their INDEX is the order he dictated them in, so a screen that sorts by category
#: has ONE ordering - three copies of seven words would eventually disagree about one of them.
#: `scommessa` is last because it is not a judgement: it is the absence of one.
#: L'ORDINE E' IL SUO (22/09/2026, sera): `scommessa` sta SOPRA `scarto`, perche' «nessuno l'ha
#: ancora misurato» promette piu' di «e' misurato e non gioca» - la stessa ragione per cui le due
#: parole non si fondono. Nella prima stesura `scommessa` (allora `scommessa`) chiudeva la scala come
#: non-giudizio; lui l'ha messa davanti allo scarto, e la graduatoria e' sua.
LADDER: tuple[str, ...] = (
    "super", "top", "semi", "solido", "riserva", "scommessa", "scarto")

#: Le stesse sette parole per NOME, cosi' la cascata non si scrive con gli indici: riordinarle - e lui
#: l'ha gia' fatto una volta, spostando `scommessa` sopra `scarto` - rinumerava ogni `LADDER[n]` e il
#: compilatore non avrebbe detto niente. Con i nomi un riordino non puo' cambiare quale parola torna.
SUPER, TOP, SEMI, SOLIDO, RISERVA, SCOMMESSA, SCARTO = LADDER

#: «gioca sempre», the gate of `super`. DECLARED from two of his own cases and not fitted: De Bruyne
#: at 0.70 is OUT («e' fragile e non puo' darti tante presenze») and Martinez at 0.74 is IN, so the bar
#: is between them. It is deliberately stricter than the 0.70 the six-word scale used.
PLAYS_ALWAYS = 0.72

#: «gioca spesso», the floor under which a man is a `scarto` whatever his level. His decision of
#: 22/09/2026, taken to let Varela (0.54) be a `solido`: half the calendar.
PLAYS_OFTEN = 0.50

#: «gioca parecchio», the floor of `semi`. His ruling of 22/09/2026 evening - «Adams C. non puo'
#: essere un SEMITOP perche' ha troppe poche partite attese» - and the band is closed by two cases:
#: Adams C. OUT at 0.630 (with a measured history behind him, so the level is not the problem) and
#: Scamacca IN at 0.718.
#:
#: IT IS NOT `PLAYS_ALWAYS`, and the first version made it so by reading «0,72» off a ROUNDED table:
#: Scamacca's real share is 0.718 and the bar cut him out by two thousandths, which is the same
#: mistake the two bars of Svilar and Varela had already cost - committed again, by whoever had just
#: written it down. The value sits in the middle of the band and not on either edge.
PLAYS_A_LOT = 0.68

#: The blend constant PER ROLE for the level, measured leave-one-season-out on ten Serie A seasons.
#: See the module docstring for the table and the mechanism. `k/(k+K)` is the weight of the matchdays
#: already played, the same shape R25 uses in the engine.
BLEND_K: Mapping[str, float] = {"P": 16.6, "D": 32.6, "C": 43.5, "A": 18.5}

#: (buono, semitop, top, supertop) of EXPECTED FANTAMEDIA, per PLATFORM and listone role.
#:
#: PER PLATFORM, and it is not a refinement: the euro sheet's fantamedia sits systematically higher
#: than Serie A's (median forward 7.14 against 6.61, keeper 5.05 against 4.96), because EuroLeghe is a
#: selection of top clubs. One table for both would have made half the euro forwards at least
#: `semi` by construction - «a parameter belongs to the population it was measured on», and the
#: platform is such a population, which this repository has written down for prices, tiers and K.
#:
#: DUE VALORI DI `default` SONO ABBASSATI DI UN CENTESIMO rispetto al percentile, e non e' un
#: ritocco: il percentile trova la ZONA, il CASO DICHIARATO fissa il valore. Svilar (livello 5,329) e'
#: un `super` per sua parola e il p97 arrotondato a 5,33 lo tagliava fuori di un millesimo; Varela
#: (6,878) e' un `solido` e il p77 a 6,88 lo tagliava per due.
#:
#: E LE DUE TABELLE NON SONO MISURATE SULLA STESSA QUANTITA', il che e' corretto e va detto: su
#: `default` sui livelli RI-MISCELATI (R25 e' adottata la', quindi `relevel` lavora), su `euro` sui
#: livelli come sono (R25 non e' adottata, quindi `relevel` restituisce il valore intatto). Le due
#: meta' di ogni confronto vengono dalla stessa quantita'; il giorno in cui il gate adottasse R25 su
#: euro, QUESTA TABELLA VA RIMISURATA - non e' una nota di cortesia, e' la condizione che la tiene in
#: piedi.
#:
#: UNA SBARRA DENTRO UN PLATEAU NON SEPARA NIENTE, e su euro ce ne sono due: 80 portieri su 110 (73%)
#: e 42 attaccanti su 173 portano la STESSA fantamedia attesa, tutti dal core - un fatto sul motore e
#: non su questa scala. Dove il p77 e il p85 cadevano sullo stesso valore la sbarra superiore e'
#: spostata al primo valore STRETTAMENTE maggiore, cosi' quei 42 uomini uguali restano tutti nella
#: stessa parola invece di essere spaccati in due da un arrotondamento. Resta vero, e va saputo, che
#: su euro la categoria di un PORTIERE distingue poco: il motore non li distingue.
LEVEL_BARS: Mapping[str, Mapping[str, tuple[float, float, float, float]]] = {
    "default": {
        "P": (5.07, 5.16, 5.24, 5.32),
        "D": (6.11, 6.16, 6.26, 6.35),
        "C": (6.35, 6.42, 6.53, 6.71),
        "A": (6.87, 6.97, 7.09, 7.61),
    },
    "euro": {
        "P": (5.048, 5.066, 5.140, 5.186),
        "D": (6.163, 6.175, 6.285, 6.399),
        "C": (6.708, 6.796, 6.891, 6.987),
        "A": (7.424, 7.438, 7.728, 7.932),
    },
}


def bars_for(platform: str | None,
             slot: str | None) -> tuple[float, float, float, float] | None:
    """The four bars for a row's PLATFORM and listone role, or None when nothing can be said.

    The LISTONE role and not the mantra slot, unlike the bonus bars the six-word scale used: the level
    is a fantamedia, and a fantamedia is comparable across the twelve codes of one macro-role in a way
    a bonus rate is not (a `dc` and a `dd` bring different bonus and score the same marks). Read
    case-insensitively for the reason the previous version already stated: this repository lowercases
    slots elsewhere, and a caller that normalises must not silently get None.

    A platform with no measured table answers None - and a row with no bars is `scommessa`, which is
    the honest reading: a word measured against nobody is not a word.
    """
    if not slot or not platform:
        return None
    return LEVEL_BARS.get(platform, {}).get(slot.upper())


def relevel(fm_pred: float | None, seen_matches: int | None, seen_fm: float | None,
            role: str | None, sheet_k: float | None) -> float | None:
    """The expected fantamedia re-blended with this ROLE's K instead of the sheet's single one.

    `fm_pred` already blends the season in progress with `sheet_k` (R25's, forty for every role), so
    the base is recovered before re-blending - undoing exactly what is about to be redone differently,
    which is the only way the two do not count the same matches twice.

    Returns `fm_pred` untouched when there is nothing to re-blend: no matches played yet, no K on the
    sheet (a pre-season sheet, where R25 is inert by construction), or a role with no measured K. That
    is not a fallback that hides a hole - on a pre-season sheet the two blends ARE the same number.
    """
    if fm_pred is None:
        return None
    k = BLEND_K.get((role or "").upper())
    if not seen_matches or seen_fm is None or k is None or not sheet_k:
        return fm_pred
    w_sheet = seen_matches / (seen_matches + sheet_k)
    if w_sheet >= 1.0:
        return fm_pred
    base = (fm_pred - w_sheet * seen_fm) / (1 - w_sheet)
    w_role = seen_matches / (seen_matches + k)
    return w_role * seen_fm + (1 - w_role) * base


def category_of(play_share: float | None, level: float | None,
                bars: tuple[float, float, float, float] | None,
                history: bool = True, seen: bool = False) -> str | None:
    """One of `LADDER`, or None when not even the appearances are known.

    `play_share` is `engine_pv_pred / matchdays`, `level` is `relevel(...)`, `bars` is `bars_for(...)`.

    NO LEVEL IS `scommessa` AND NEVER `scarto`: «vuoto = ignoto, mai zero», met here on a word that
    would otherwise call a nineteen-year-old bad because nobody has priced him yet. The two are
    opposite statements, and he chose the word himself on 22/09/2026 rather than folding them together.

    `grounded` IS THE OTHER HALF OF THAT, and without it the word was empty by construction. The sheet
    gives EVERY row a fantamedia - where the engine cannot price a man, `est_fm` falls back to his
    role's anchor - so a level is never missing and `scommessa` described nobody: measured on the
    2026-27 Serie A sheet, 147 rows sat on the anchor and were handed 103 `scarto`, 31 `riserva`
    and even 7 `solido`, which is a judgement about men nobody has watched. It is the `bandiera` defect
    of 20/08 (a rung empty by construction) met on a word instead of a ladder.

    The caller says whether the level STANDS ON FOOTBALL: the anchor alone does not, but the anchor
    plus matchdays played THIS season does - a man we are watching right now is not an unknown, and
    that is also why 3 of those 147 read `top` legitimately.

    A ROW WITH NO APPEARANCE FORECAST AT ALL GETS NO WORD - the caller owes that distinction, exactly
    as it does for the six-rung ladder next door.

    THE ORDER OF THE TESTS IS THE CASCADE and it is not an implementation detail: his six definitions
    overlap (a man who plays often with a high level satisfies several at once), so «the first rule
    that matches» is what makes them exclusive, and it is the order he dictated them in.
    """
    if play_share is None:
        return None
    if level is None or bars is None or not (history or seen):
        return SCOMMESSA
    good, semi, top, sup = bars
    # SENZA STORICO NON SI SALE SOPRA `solido`, sua regola del 22/09/2026 sera: «Osmajic e Romero D.
    # non possono essere SEMITOP perche' hanno uno storico poco definito». I due leggevano 6,996 - il
    # PLATEAU dell'ancora di ruolo, che il motore serve come `core` a confidenza piena quando non ha
    # una fantamedia precedente da regredire - cioe' un numero che non parla di loro, appena sopra la
    # sbarra. Il tetto e' consistente con tutti e quindici i suoi verdetti: i tre uomini senza storico
    # (Kvernadze, Varela, Douglas Luiz) sono `solido` o sotto, e chiunque metta da `semi` in su ce
    # l'ha. NON e' `scommessa`: quelli il calcio di quest'anno ce l'hanno, e si vede.
    if not history:
        return SOLIDO if play_share >= PLAYS_OFTEN and level >= good else (
            RISERVA if play_share >= PLAYS_OFTEN else SCARTO)
    if level >= sup and play_share >= PLAYS_ALWAYS:
        return SUPER
    # ...off the scale but not playing enough is `top` and not `super`: Calhanoglu is the best
    # midfielder of the listone at 0.60 of the calendar, and the word has to say that he is worth it
    # AND that he will not be there. His ruling, 22/09/2026.
    #
    # `or level >= sup` used to be here and was REDUNDANT - the bars are sorted and a test asserts it,
    # so `level >= sup` implies `level >= top` - and removing it makes the real property visible: this
    # branch has NO appearance floor, so a man off the scale who plays 5% of the calendar reads `top`
    # and never `scarto`. That is Calhanoglu's case taken to its limit and the operator has not ruled
    # on it; it is stated here rather than guessed, and the population it would affect is worth
    # counting before anybody adds a floor.
    if level >= top:
        return TOP
    if play_share < PLAYS_OFTEN:
        return SCARTO
    # ...e `semi` VUOLE LE PRESENZE, sua regola dello stesso giorno: «Adams C. non puo' essere un
    # SEMITOP perche' ha troppe poche partite attese» - 0,630 del calendario, con lo storico che ce
    # l'ha (6,67 su 33 presenze), quindi qui il difetto non e' il livello. La sbarra e' `PLAYS_A_LOT`,
    # chiusa fra lui e Scamacca (0,718), e NON `PLAYS_ALWAYS` - vedi la costante per il perche' la
    # prima stesura sbagliava.
    if level >= semi and play_share >= PLAYS_A_LOT:
        return SEMI
    if level >= good:
        return SOLIDO
    return RISERVA


def rank_of(category: str | None) -> int | None:
    """Where a word sits in the list, 0 = `super`. None for a row with no word, never a number."""
    if category is None:
        return None
    try:
        return LADDER.index(category)
    except ValueError:
        return None
