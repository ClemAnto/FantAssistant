"""The strategy profiles a real table brings, dictated by the operator on 01/09/2026.

Each profile is a WILLINGNESS TO PAY: for the n-th man of a role, the multiple of the PRIOR (the
listone's Qt.I rescaled onto the league's credit pool) that this participant will go up to. They are a
translation of five sentences into numbers, and that translation is the DECLARED half of this bench -
what is measured is what those behaviours produce, never the behaviours themselves.

Two constraints apply to everybody and are declared, not fitted:

  * THE MENTAL THRESHOLD. «La soglia mentale dei 500 difficilmente si supera» - nobody bids more than
    half the budget on one man. It is an ABSOLUTE cap and not a multiple of the ask price: without it
    the second-price mechanism takes the best striker to 747 credits, which the operator recognised as
    wrong before any number was reported.
  * NOBODY KEEPS CREDITS IN THEIR POCKET. With money to spare for the slots that remain, every profile
    pays the going rate rather than saving. Without this rule an «austere» recipe ends the auction with
    300 credits unspent, which is a defect of the recipe and not of the strategy it stands for - and it
    would rig the comparison in favour of whoever spends.
"""
from __future__ import annotations

#: Half the budget, and no man goes above it. See the module docstring.
MENTAL_CAP_SHARE = 0.5

#: How much of what the purse can afford PER REMAINING SLOT becomes the floor of every ceiling, FOR THE
#: ENGINE ARM ONLY since 02/09/2026 - the humans reach the same end by another road (`Team.scale`), and
#: the reason is the whole of what changed that day. A flat share per slot is not a plan: with 1000
#: credits and 25 slots it says «40 a man» about the best striker of the listone and about the 200th
#: defender alike, and it was the biggest single cause of the flat auctions the operator objected to -
#: four participants of ten ended with ZERO men under 5 credits and 23-25 men in the 21-60 band. A
#: recipe is a DISTRIBUTION of the purse and its level is fixed by conservation, so what the humans get
#: is their own ladder normalised to what they can still spend. Declared; sweeping it is the third knob.
ABUNDANCE = 1.0

#: WHAT «THE n-TH MAN OF A ROLE» MEANS, and it is a conservation law rather than a choice: in a league
#: of ten there are ten first-choice defenders, because each participant fields one. So a man's TIER is
#: his rank inside his own role divided by the number of teams, and a recipe's n-th step is what that
#: participant pays for a man of the n-th tier.
#:
#: Until 02/09/2026 the step was indexed by HOW MANY MEN OF THE ROLE HE ALREADY HELD, which is the same
#: number only when the lots are CALLED dearest first - there the first defender he meets IS the best
#: one left. Drawn at random it is a different number entirely, and the recipe read as «I pay 1.5 times
#: the ask for the first defender I happen to meet»: P2, whose whole strategy is the top of the defence,
#: met the 90th defender of the listone first, paid a premium for him, and had nothing left for Dimarco.
#: The operator found it from the result - «sono tutti suoi obiettivi e almeno 3 devono essere suoi
#: altrimenti la strategia fallisce».
#:
#: The index is now `max(tier, men already owned who are AS GOOD OR BETTER)`: he pays the tier-3 price
#: for a tier-3 man, and once he already owns three defenders at least that good the next one is his
#: fourth. Both halves are needed and neither is decoration - the first is what the ladder was always
#: meant to say, the second is what stops a profile buying eight first-choice defenders at the
#: first-choice price. The «as good or better» clause is the correction of 02/09 (evening): counted on
#: the plain number of men held, a squad with four forwards priced the best player of the game as its
#: fifth, at 0,18 times the ask.

#: WHAT A PROFILE COMES TO THE TABLE WANTING - his TARGET LIST - as (role, how many men of the top tier
#: he means to own, the share of the budget he ring-fences until he owns them). The operator's own
#: sentences of 02/09/2026, and each half of the tuple is one of his clauses. The count is a number of
#: NAMES - the `count` dearest men of that role - and not a tier: read as «any first-tier forward» the
#: plan released itself the moment he bought the tenth-best of them.
#:
#:   P2 - «fonda la sua strategia sui top di difesa ... Dimarco, Solet, Di Lorenzo, Bremer, Dumfries
#:         sono tutti suoi obiettivi e almeno 3 devono essere suoi ... li attende anche alla fine
#:         dell'asta».
#:   P4 - «deve puntare sul TOP in attacco e fa di tutto per prenderlo (lo attende conservando piu'
#:         crediti degli altri) facendo solo qualche acquisto oculato senza rilanci avventurosi. Solo
#:         dopo aver preso un attaccante TOP comincia a piazzare qualche altra offerta seria».
#:
#: Two rules follow from a plan and both are DECLARED behaviour, never a valuation: the money is
#: RING-FENCED (a bid on anybody who is not a target is computed on the purse less the reserve, which
#: is «conservando piu' crediti degli altri» and also «solo dopo ... offerte serie»), and the SLOT is
#: KEPT (he will not fill the last slots he owes a target with lesser men while a target is still in
#: the urn). P1a, P1b and P3 have no entry: for the first two that is what «senza piano» means, and P3
#: is defined by balance rather than by a target.
PLAN: dict[str, tuple[tuple[str, int, float], ...]] = {
    "P2 defence": (("D", 3, 0.45), ("P", 1, 0.10)),
    "P4 top striker": (("A", 1, 0.40),),
}

# ------------------------------------------------------------------------------------
# WHAT IS NOT DECLARED HERE, and used to be: HOW MANY SLOTS ANYBODY KEEPS FREE.
# The rule lives in `Team.keeps` and has no constant at all: it is COUNTED. If `hands` participants
# still want a role, the better men left in the urn go one each, so this squad's share of them is
# their number over the hands up - and while that share covers every slot it still has there, letting
# this one pass costs nothing. The same counting `Team.alternative` does for a CREDIT, done for a
# SLOT, which is the draft bench's own lesson: at a random extraction a slot is as scarce as a credit.
#
# It is what stops a champion going unsold, which was the first anomaly the operator reported: «non e'
# realistico che L.Martinez non venga preso ... su 10 persone qualcuno dovrebbe conservare un posto in
# rosa aspettando proprio il campione», with his own justification for the risk - «il rischio vale per
# un top di ruolo». Nobody was refusing him for want of money: the rosters were simply full by the
# time he was drawn, because 77 forwards go into 60 slots.
#
# MEASURED: of the 50 dearest men of the listone, 14,3 went unsold at a drawn auction before this and
# 1,93 after, against 1,75 in the four real drawn auctions whose extraction order could be
# reconstructed - and zero slots are left unfilled, which is the risk the rule takes. The two DECLARED
# forms that came first were both worse and are recorded so nobody re-tries them: keeping the last
# slot of a role while a FIRST-tier man is still to come leaves 7,73 of the 50 unsold (the men refused
# are the second and third tier of the crowded roles), and extending that to the second tier makes it
# 10,67 - a threshold moves the problem down a tier instead of solving it.
#
# INERT AT A CALLED AUCTION, and not by accident: there the dearest man is offered first, so there is
# never a better one still to come. One rule, two mechanisms - the property `Urn.random` has.
# ------------------------------------------------------------------------------------

#: THE MARKET LADDER - what a REAL table pays for the n-th tier of a role, as a multiple of the ask.
#: MEASURED on the 60 real auctions of this exact roster (3/8/8/6) played by TEN PARTICIPANTS, read from
#: the production database on 02/09/2026 and kept in `docs/real-data/`; every figure is normalised by
#: the auction's own montepremi first, so a 500-credit league does not outvote a 1000-credit one.
#:
#: TEN, on the operator's instruction: «dobbiamo necessariamente confrontare i dati reali di aste con 10
#: partecipanti a simulazioni con 10 partecipanti altrimenti avremo delle incongruenze». He is right and
#: it was a defect: this bench plays a league of `rules.TEAMS` = 10, `to_credits` conserves ten budgets
#: over ten squads' worth of men, and a TIER is a rank divided by ten - so a table of eleven or thirteen
#: participants brings 10% or 30% more money and slots than everything it is calibrated against.
#: `bench.seated` cures the auction side; this line cures the measurement side.
#:
#: What it cost to move: almost nothing, which is the normalisation doing its job. Over all 131 auctions
#: the same medians read P 1.25 0.34 0.50 · D 0.87 0.69 0.50 0.43 0.23 0.24 0.18 0.19 ·
#: C 1.18 0.83 0.62 0.50 0.25 0.25 0.16 0.21 · A 2.38 1.34 0.92 0.30 0.18 0.18 - the largest single
#: move is the third tier of the midfield (0.62 to 0.74). The population is right now, and that is the
#: reason, not the size of the change.
#:
#: THE MEDIAN of paid/ask inside the tier, and the choice is not cosmetic - the RATIO OF SUMS is 1.03
#: to 1.06 times the median at the top of a role and 1.4 to 1.7 times it in the tail (D reads 0.92 0.71
#: 0.57 0.49 0.33 0.34 0.31 0.33), because a handful of filler men are bought at the death with
#: whatever is left in a purse. That inflation is REAL and this bench produces it on its own: `scale`
#: rises as a squad runs out of slots. Putting it in the ladder as well would count it twice, and
#: measured it does - the ratio of sums gives 2,7 men under 5 credits per squad against 4,3 for the
#: median and a real 8,0. A ladder is the ceiling of an ORDINARY purchase.
#:
#: What the median gives up is conservation: summed over the tiers it recovers only 79% of the
#: montepremi, so a plan priced on it starts at a scale of 1,21 and the mechanism supplies the rest.
#: That is the right division of labour, and it is checked - the credits left in pocket come out at
#: 2,8% of a budget at a called auction against a real 2,8%.
#:
#: WHAT IT REPLACED, and it was wrong at both ends: a flat 1.0 on every tier for the two profiles with
#: no plan. The real market pays 2.38 times the ask for a first-tier forward and 0.16-0.25 from the
#: fifth tier on, which is the operator's own objection of 02/09/2026 - «normalmente la dinamica e'
#: offrire poco (1-5 crediti) per i pezzi comuni e aumentare il rilancio solo per i pezzi veramente
#: pregiati». It also settles the department split without anybody declaring one: 9,1% keepers, 16,3%
#: defence, 27,2% midfield, 47,4% attack. Nearly half the money goes to six men of twenty-five.
#:
#: A CALIBRATION OF THE ENVIRONMENT, NOT A RESULT. What the bench judges is which strategy wins, and a
#: strategy is a DEVIATION from this ladder (`TILT`). So «the simulated table reproduces the real
#: ladder» is not evidence of anything - it is how the table is built. What IS evidence is the part the
#: mechanism produces on its own: the concentration of a squad's spend, the credits left in pocket, and
#: how many champions go unsold. Those are scored in the README against the same 131 auctions.
#:
#: ONE LIMIT INSIDE THE FIRST BAND, stated rather than smoothed away: a tier is `TEAMS` men wide
#: because that is the conservation law, and inside the first band of the ATTACK the real ladder still
#: falls - rank by rank it reads 2.81 3.36 2.15 2.60 3.01 2.23 then 1.79 1.23 1.89 1.90, so the six
#: dearest forwards go for more than the four behind them and this bench prices all ten alike.
MARKET: dict[str, list[float]] = {
    "P": [1.31, 0.39, 0.50],
    "D": [0.89, 0.73, 0.53, 0.44, 0.21, 0.25, 0.17, 0.20],
    "C": [1.18, 0.87, 0.74, 0.51, 0.24, 0.29, 0.14, 0.21],
    "A": [2.30, 1.35, 0.86, 0.25, 0.28, 0.17],
}

#: WHAT MAKES A PROFILE ITSELF: how far it goes above or below the market, per role, as
#: `(top tiers, the multiple on them, the multiple on every tier below)`. A role with no entry is
#: played at the market rate, and a profile with no entry at all IS the market - which is what «senza
#: piano» means, and a far better model of it than the flat ladder it replaces: a man with no plan does
#: not pay the same multiple for the best striker and for the 200th defender, he pays what the room pays.
#:
#: DECLARED, from the operator's own sentences - the market is measured, the deviation is his. Each
#: profile's own clauses are quoted where its numbers are.
TILT: dict[str, dict[str, tuple[int, float, float]]] = {
    # 1a) e 1b) SENZA PIANO: nessuna deviazione, cioe' pagano quello che paga la stanza. Cosa li separa
    #     e' l'OCCHIO e lo SBANDAMENTO, non la scala - l'ESPERTO «sa valutare al momento l'asta ed il
    #     valore dei calciatori astati», quindi corregge il prezzo con quello che il motore dice del
    #     giocatore (`EXPERT_EYE`); l'INESPERTO «un po' si fida ciecamente della QI e un po' fa degli
    #     errori grossolani», quindi legge solo la quotazione e sbanda molto (`SCATTER`).
    #
    #     La scala DECRESCENTE che avevano prima non era «nessun piano»: era il piano di razionamento
    #     del mercato, dato a chi non ne ha uno. Ora il razionamento e' del mercato e loro non lo
    #     deviano, che e' la stessa frase detta bene.
    "P1a no plan, expert": {},
    "P1b no plan, novice": {},
    # 2) «punta molto su portiere e difesa per massimizzare il mod.dif. ma non e' uno sprovveduto, cerca
    #    comunque di piazzare qualche buon colpo low-cost in attacco e centrocampo» + 02/09: «fonda la
    #    sua strategia sui top di difesa e quindi e' preparato sui difensori piu' forti e li attende
    #    anche alla fine dell'asta: Dimarco, Solet, Di Lorenzo, Bremer, Dumfries sono tutti suoi
    #    obiettivi e almeno 3 devono essere suoi altrimenti la strategia fallisce».
    #    Il «almeno 3» sta in `PLAN`, non qui: una scala dice quanto paga, non quanti ne prende.
    "P2 defence": {"P": (1, 1.5, 0.5), "D": (4, 1.9, 0.9), "C": (0, 1.0, 0.55),
                   "A": (0, 1.0, 0.55)},
    # 3) «cerca di rispettare i budget di reparto e costruisce una rosa equilibrata evitando i rilanci
    #    piu' pericolosi» - hence the per-man cap below, which is what «pericolosi» means, and a tilt
    #    that goes AGAINST the market where the market concentrates: he pays over the odds for the
    #    tiers that field an eleven and refuses the auction's one big name.
    "P3 balanced": {"P": (1, 1.15, 1.0), "D": (4, 1.4, 1.15), "C": (4, 1.2, 1.05),
                    "A": (1, 0.8, 0.95)},
    # 4) «vuole il top d'attacco, risparmia in maniera netta negli altri reparti prendendo il minimo
    #    necessario per completare i titolari e poi prende il miglior attaccante e qualche buon colpo» +
    #    02/09: «deve puntare sul TOP in attacco e fa di tutto per prenderlo (lo attende conservando piu'
    #    crediti degli altri) facendo solo qualche acquisto oculato senza rilanci avventurosi. Solo dopo
    #    aver preso un attaccante TOP comincia a piazzare qualche altra offerta seria».
    #    Le due clausole nuove - il posto tenuto e i crediti da parte - stanno in `PLAN`.
    #    Il centrocampo resta sopra la parsimonia degli altri reparti sulla sua correzione del 01/09:
    #    «forse dobbiamo rivalutare le sue offerte facendogli spendere qualcosina in piu' a centrocampo».
    "P4 top striker": {"P": (0, 1.0, 0.6), "D": (0, 1.0, 0.6), "C": (0, 1.0, 0.85),
                       "A": (1, 1.5, 0.8)},
    # 5) e 6) NON SONO DELL'OPERATORE: sono i due archetipi che la MISURA ha trovato nelle 1.177 rose
    #    vere e che il suo tavolo non aveva (k-means sulle quote di reparto piu' la concentrazione; gli
    #    altri tre gruppi sono i suoi P4, P3 e P2). Dichiarati e SEDUTI FUORI dal tavolo dichiarato: chi
    #    siede al suo tavolo e' una sua decisione, non una misura.
    #
    #    P5 «rinuncia al top d'attacco» - 13,5% delle rose vere: P 12% D 24% C 38% A 26% del proprio
    #    budget, e il suo acquisto piu' caro e' il 18% contro il 26% della mediana. E' lo specchio di P4:
    #    lascia andare il nome che si porta via mezzo montepremi e compra qualita' negli altri tre
    #    reparti. Non e' un P3 con un'altra faccia - P3 spende come il mercato, questo spende il 62% fra
    #    difesa e centrocampo contro il 43,5% del mercato.
    "P5 no top striker": {"P": (1, 1.3, 1.1), "D": (4, 1.6, 1.3), "C": (4, 1.45, 1.25),
                          "A": (1, 0.3, 0.7)},
    #    P6 «un campione e la manovalanza» - 14% delle rose vere: A 63% del budget, il 46% su UN uomo
    #    solo e il 42% della rosa comprata a due crediti o meno. E' P4 portato al limite, ed e' un
    #    archetipo diverso perche' il prezzo lo paga sul resto della rosa: dove P4 «prende il minimo
    #    necessario per completare i titolari», questo non lo prende.
    "P6 one champion": {"P": (0, 1.0, 0.4), "D": (0, 1.0, 0.4), "C": (0, 1.0, 0.5),
                        "A": (1, 2.0, 0.35)},
}


def _ladder(role: str, tilt: tuple[int, float, float] | None) -> list[float]:
    """The market ladder for this role, tilted the way this profile deviates from it."""
    if tilt is None:
        return list(MARKET[role])
    bands, top, rest = tilt
    return [round(rate * (top if tier < bands else rest), 3)
            for tier, rate in enumerate(MARKET[role])]


PROFILES: dict[str, dict[str, list[float]]] = {
    name: {role: _ladder(role, tilts.get(role)) for role in MARKET}
    for name, tilts in TILT.items()
}

#: WHAT THE ENGINE ARM BIDS AT A DRAWN AUCTION, and it is the market's own ladder tilted toward the
#: back. ADOPTED 02/09/2026 (night), and it is the largest single gain this bench has measured.
#:
#: THE DEFECT IT CURES IS ONE OF SCALE. The arm prices a man in FANTAPUNTI (`engine_worth` = surplus +
#: cover) and converts with one global rate; the market prices him as a MULTIPLE OF HIS ASK, tier by
#: tier, and that ladder is what conserves the credits. A bidder whose ceilings do not live on the same
#: scale as the prices cannot win a contested lot at any level - photographed, the arm bid 0,16-0,47 of
#: what the men it lost went for, paid 0,10-0,15 of the ask for defenders and midfielders, bought at a
#: MEDIAN OF ONE CREDIT and left 344 credits of 1000 unspent. Its holes were 79,8 a season against 20,6
#: for the best human, and at `HOLE_COST` that is 266 of the ~370 points it was behind.
#:
#: MEASURED, ten windows x ten urns, against the arm as it was: the ladder alone is **+13,2%** and with
#: our own department shares **+14,5%**, both STRICT (10 windows of 10 improve, worst window +8,1% and
#: +4,1%) - and the tilt takes it to **+17,9%**, place 10,27 -> 3,82 of eleven, holes 79,8 ->
#: 22,4, spend 656 -> 987, and 28 titles of 100 against 0. It beats the best human profile by 54,5
#: fantapunti where it used to lose to it by 371,8.
#:
#: AND OUR OWN RANKING ADDS NOTHING TO IT, which has to be said because it is the uncomfortable half:
#: the same ladder read on the PRICE'S ranking instead of the engine's gives +12,4% against +12,3%,
#: identical. What the arm gains here is not a better opinion about footballers - it is bidding on a
#: scale that can win a lot. Our edge over the listone, spent this way, is worth zero, and
#: `metrica-asta-surplus-v1.md` §18 had already measured that edge as one number wide (the appearances).
#:
#: WHAT THE TILT SAYS, and the search found it rather than copying it: pay ~1,7 times the market on the
#: top four tiers of the DEFENCE, under the market for the attack, and almost nothing for the tails. It
#: is P2's strategy, arrived at independently - and the regulation says why it pays, because both
#: modifiers of this league are paid in BASE VOTES (the defence modifier on the mean of the best three
#: defenders, the R-Factor on all eleven) and base votes are what a back line delivers.
#:
#: THE KEEPERS ARE OUT OF IT, and that is measured rather than assumed - the first version tilted them
#: WITH the defence because the grid searched the two together, and it was never asked separately. The
#: three arms read 2605,4 (both), 2608,3 (defence only) and 2563,3 (keepers only, -1,6%), so the keeper
#: half is worth NOTHING (+0,1%, 4 windows of 10) while it spends 100 credits of the purse in goal
#: instead of 58. At a tie the form that survives is the one that does not carry an unmeasured
#: instruction - and this one had a visible consequence, because it told the operator to bid 136 credits
#: for a first-tier keeper where the market pays 81.
#:
#: TWO THINGS STATED RATHER THAN HIDDEN. The optimum is INTERIOR on the widened grid (back 1.3 ... 2.3,
#: top 1.3 ... 3.5: the neighbours read 2584,6 · 2584,9 · 2604,0 · 2569,9 against 2609,0) but the whole
#: plateau is flat inside 1%, so the DIRECTION is the finding and the two decimals are not. And at a
#: CALLED auction this ladder LOSES - 2575,7 against 2628,3, 3 windows of 10 - so it is switched on by
#: the mechanism itself (`Urn.random`) and not by a flag anybody has to remember, exactly as
#: `ALT_WEIGHT` is switched off there. A parameter belongs to the mechanism it was measured on.
ENGINE_BACK = 1.9
ENGINE_TOP = 2.2
ENGINE_BANDS = 4

#: What each department carries of a table's money, MEASURED on the 131 real auctions - the divisor the
#: tilt is renormalised by, so a tilt gives up in front whatever it takes at the back. A tilt that does
#: not conserve is not a strategy, it is a bigger purse.
MARKET_SHARE: dict[str, float] = {"P": 0.091, "D": 0.163, "C": 0.272, "A": 0.474}


def engine_ladder() -> dict[str, list[float]]:
    """The market ladder tilted toward the back and the top tiers, renormalised to one budget.

    OUR OWN DEPARTMENT SHARES ARE NOT READ HERE, and that is measured rather than an omission. On the
    UNTILTED ladder they are worth +1,1% (the surplus says P 14,5% · D 20,1% · C 28,2% · A 37,2%
    against the market's 9,1 · 16,3 · 27,2 · 47,4, i.e. our valuation leans the same way the winning
    tilt does); on the TILTED one they cost -1,2% and improve only 2 windows of 10, worst -3,2%,
    because the two lean the same way and the squad ends over-tilted. The tilt absorbs them, so the
    parameter is gone instead of being carried unread.
    """
    out: dict[str, list[float]] = {}
    for role, market in MARKET.items():
        factor = ENGINE_BACK if role == "D" else 1.0
        out[role] = [rate * factor * (ENGINE_TOP if tier < ENGINE_BANDS else 1.0)
                     for tier, rate in enumerate(market)]
    total = sum(sum(out[role]) / sum(MARKET[role]) * MARKET_SHARE[role] for role in out)
    return {role: [rate / total for rate in steps] for role, steps in out.items()}


#: HOW MUCH A PROFILE SCATTERS around its own recipe, as a share either way. Without it «no plan» would
#: silently become «pays the list price to everybody», which is a disciplined strategy wearing the wrong
#: name. DECLARED, like the recipes: 0.8 means the novice can go to nearly double or nearly nothing on a
#: given name - «errori grossolani» - while the expert's 0.15 is the ordinary hesitation of somebody who
#: knows what he is looking at. Nobody has measured the real dispersion of either.
SCATTER: dict[str, float] = {"P1a no plan, expert": 0.15, "P1b no plan, novice": 0.8}

#: HOW MUCH A PROFILE READS THE MAN instead of the ask price, 0 = only the quotation, 1 = only the
#: engine's surplus. It is what separates the expert from the novice at the same ladder: «sa valutare al
#: momento l'asta ed il valore dei calciatori astati» is exactly the ability to disagree with the
#: listone, and the engine's surplus is the best available stand-in for that judgement - not because a
#: human computes it, but because it is the same disagreement made explicit and auditable.
#: DECLARED. What it is worth is what the bench measures.
EXPERT_EYE: dict[str, float] = {"P1a no plan, expert": 0.6}

#: How much a department's per-man ceiling is lifted while it cannot yet field its own places. DECLARED:
#: a hole costs the place plus both modifiers, so a squad short of a starter should be willing to pay
#: more there than its average - but how much more is not measured, and this is one of the two knobs
#: this bench exists to sweep.
URGENCY = 1.8

#: A per-man ceiling of its own for the profile that «evita i rilanci piu' pericolosi», as a share of
#: the budget. MEASURED against the real archive on 02/09/2026 (evening), where it had been a guess:
#: the dearest purchase of a real squad is 14,8% of its budget at the p10, 18,4% at the p25 and 25,0%
#: at the median, and only 10,4% of 1.177 real squads keep it under 15% - so the 0.15 it had been
#: given sat at the TENTH PERCENTILE of caution, which is not «cautious» but extreme, and with three of
#: ten seats on this profile it was setting the second price for the auction's dearest man.
#:
#: 0.18 is the p25 - «he is in the most cautious quarter of a real table», which is what the sentence
#: says - and it is also where the credits left in pocket at a called auction land nearest the real
#: figure (3,4% at 0.15, 2,5% at 0.18, 1,4% at 0.22, against a real 2,8%).
#:
#: AND IT IS NOW NEARLY INERT, which is the more useful finding: over the whole grid 0.15 ... 0.50 the
#: four calibration targets move by less than a point. What had looked like a binding cap was a symptom
#: of the step being indexed on the plain count of men held - a squad with four forwards priced the
#: best player of the game as its fifth - and once that was corrected this ceiling stopped deciding
#: anything. A knob that only bites while another thing is broken is a knob to re-measure after fixing
#: it, not before.
CAUTIOUS_CAP_SHARE: dict[str, float] = {"P3 balanced": 0.18}

# ---------------------------------------------------------------------------------------------------
# THE FIFTH PROFILE IS DECLARED AND SWITCHED OFF, on the operator's instruction of 01/09/2026: «ci
# sarebbe anche un altro profilo ma per il momento non lo consideriamo».
#
#   «il tifoso -> prova a prendere quanti piu' calciatori di una certa squadra reale (es: Napoli),
#    pagandoli oltre il ragionevole e rinunciando alle aste dei calciatori delle squadre reali nemiche
#    (Napoli <> Juve) ... cerca di equilibrare la rosa con qualche colpo low-cost.»
#
# It is written down rather than left to memory because it needs something the other four do not: the
# CLUB of every man, plus a declared table of rivalries. It cannot be inferred - «Napoli <> Juve» is a
# fact about people, not about football we measure - so it would join the two rulebooks and the board
# rulings as configuration. Two things it would be worth measuring, once switched on: what the premium
# on one club's men costs, and whether giving up entire auctions is a bigger loss than the premium.
SUPPORTER_PROFILE: dict[str, object] = {
    "name": "P5 supporter (declared, off)",
    "premium": 1.8,          # what he pays for a man of his own club, as a multiple of the prior
    "boycott": 0.0,          # what he bids for a man of the enemy club: nothing
    "elsewhere": 0.35,       # the low-cost patching everywhere else
}
