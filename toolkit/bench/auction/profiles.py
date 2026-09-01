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

#: How much of what the purse can afford PER REMAINING SLOT becomes the floor of every ceiling. At 1.0 a
#: participant is always willing to spend his affordable share on the man in front of him, which is why
#: nobody ends the auction holding credits. Declared; sweeping it is the third knob.
ABUNDANCE = 1.0

PROFILES: dict[str, dict[str, list[float]]] = {
    # 1a) e 1b) SENZA PIANO, e la scala e' PIATTA per entrambi: e' questo che «senza piano» vuol dire.
    #     Una scala decrescente - pago meno per il quarto centrocampista che per il primo - E' un piano di
    #     razionamento, e darla a chi non ne ha uno era il difetto che l'operatore ha visto dal risultato:
    #     «non e' normale che il novizio batta l'esperto 2-0, il novizio dovrebbe avere dei buchi nella
    #     rosa che gli pregiudicano la stagione». Con la scala piatta i crediti finiscono sui primi nomi
    #     che passano - e l'asta chiama i piu' cari per primi - e i reparti si chiudono con quello che
    #     resta, che e' esattamente la rosa sbilanciata di chi non pianifica.
    #
    #     Cosa separa i due, allora: l'ESPERTO «sa valutare al momento l'asta ed il valore dei calciatori
    #     astati», quindi corregge il prezzo con quello che il motore dice del giocatore (`EXPERT_EYE`) e
    #     quasi non sbanda; l'INESPERTO «un po' si fida ciecamente della QI e un po' fa degli errori
    #     grossolani», quindi legge solo la quotazione e sbanda molto (`SCATTER`).
    "P1a no plan, expert": {
        "P": [1.0] * 3, "D": [1.0] * 8, "C": [1.0] * 8, "A": [1.0] * 6,
    },
    "P1b no plan, novice": {
        "P": [1.0] * 3, "D": [1.0] * 8, "C": [1.0] * 8, "A": [1.0] * 6,
    },
    # 2) «punta molto su portiere e difesa per massimizzare il mod.dif. ma non e' uno sprovveduto, cerca
    #    comunque di piazzare qualche buon colpo low-cost in attacco e centrocampo».
    "P2 defence": {
        "P": [1.6, 0.9, 0.2],
        "D": [1.5, 1.5, 1.4, 1.3, 1.0, 0.6, 0.3, 0.1],
        "C": [0.5, 0.5, 0.4, 0.3, 0.2, 0.1, 0.1, 0.05],
        "A": [0.5, 0.5, 0.4, 0.2, 0.1, 0.05],
    },
    # 3) «cerca di rispettare i budget di reparto e costruisce una rosa equilibrata evitando i rilanci
    #    piu' pericolosi» - hence the extra per-man cap below, which is what «pericolosi» means.
    "P3 balanced": {
        "P": [0.9, 0.7, 0.2],
        "D": [1.1, 1.1, 1.0, 1.0, 0.8, 0.5, 0.3, 0.1],
        "C": [1.0, 1.0, 0.9, 0.8, 0.5, 0.3, 0.2, 0.1],
        "A": [1.0, 1.0, 1.0, 0.5, 0.2, 0.1],
    },
    # 4) «vuole il top d'attacco, risparmia in maniera netta negli altri reparti prendendo il minimo
    #    necessario per completare i titolari e poi prende il miglior attaccante e qualche buon colpo».
    "P4 top striker": {
        "P": [0.5, 0.3, 0.1],
        "D": [0.5, 0.5, 0.5, 0.5, 0.2, 0.1, 0.05, 0.05],
        # A BIT MORE IN MIDFIELD, on the operator's correction of 01/09/2026: «forse dobbiamo rivalutare
        # le sue offerte facendogli spendere qualcosina in piu' a centrocampo». He wants the top striker,
        # not a midfield of one-credit men - «il minimo necessario per completare i titolari» has to
        # actually buy three midfielders who play, and at 0.6 of the ask price it did not.
        "C": [0.9, 0.85, 0.8, 0.3, 0.15, 0.05, 0.05, 0.05],
        "A": [2.2, 1.0, 0.8, 0.3, 0.1, 0.05],
    },
}

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

#: A per-man ceiling of its own for the profile that «evita i rilanci piu' pericolosi», as a share of the
#: budget. NOT MEASURED: it is the first thing this bench should sweep, because it is one of the reasons
#: P3 does well and nobody has asked the data what it should be.
CAUTIOUS_CAP_SHARE: dict[str, float] = {"P3 balanced": 0.15}

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
