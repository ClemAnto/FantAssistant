"""presence - who plays, and how much of a season: the formulas, with their parameters exposed.

Extracted from the Snapshot panel on 29/07/2026 for one reason: the constants in it are MODEL choices
(gate `7-bis`), and a parameter the gate owns cannot live inside a Tk view where no harness can reach
it. The panel now calls this module, `modules/sweep.py` sweeps it against realised appearances, and the
two can no longer disagree - which is the same discipline `snapshot` already follows for the `engine_*`
columns.

Dependency-free, like the rest of `engine/`: the shippable TypeScript engine gets ported from here.

THE UNIT, because it is what the whole file rests on: everything is a share of the CHAMPIONSHIP's
calendar. The numerators are league-only by construction (the season aggregate stores one row per
championship), so the calendar has to be too - a club's full fixture list is 66%-100% of it depending on
how far it went in Europe, and dividing one by the other made two clubs' percentages incomparable
(spec «Novità v9.11»). Absences arrive from an external source in ITS unit, every competition included,
so they are counted as league rounds where a calendar exists and scaled only as a declared fallback.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

# ---------------------------------------------------------------- the parameters
#
# PROVISIONAL unless the field says otherwise: they exist because the panel needed a number to draw a
# pitch, and the gate owes them a verdict (gate-motore-v1.md 7-bis / 7-ter). `modules/sweep.py` is what
# replaces one with a measured value or confirms it, and after the run of 29/07/2026 the state is:
#   standing_weights  MEASURED - (0, 1), strict and robust on all ten folds. No longer provisional.
#   contested_from    CONFIRMED - "measured" is the held-out pick on every fold, on both platforms.
#   arrival_discount  CONFIRMED - 0.80 is the pooled optimum on default and ties for it on euro, and the
#                     curve is steep (0.0 costs 30% more error), so the parameter matters and is right.
#   loan_discount     OPEN and platform-DEPENDENT: euro pulls to 0.2, default to 0.8, and the curve is
#                     flat between them. 0.60 sits in the middle and stays provisional.
#   injury_weights    the SHAPE is confirmed (both degenerate alternatives are worse: last-season-only is
#                     the worst value on both platforms), the TILT is open - the three candidates sit
#                     within 0.3% of each other and the two platforms prefer opposite ones.
#   availability_floor OPEN: monotone toward 0.6, but the whole grid spans 0.6% - under the gate's floor.
# Anything still marked open is quoted as provisional and never as established.


@dataclass(frozen=True)
class Params:
    """One set of the presence parameters. `replace(params, ...)` is how the sweep varies one of them."""

    # How much a season measured AT ANOTHER CLUB is worth toward THIS club's shirt. Two numbers because
    # there are two reasons to discount and they do not always both apply: it was earned in another side
    # (always), and being sent away is this club's own judgement of him (only if it had him to send).
    loan_discount: float = 0.60
    arrival_discount: float = 0.80
    # ...and the same discount for a man arriving from ANOTHER championship, which the data says is a
    # different event. Residual of next season's start share against his previous minutes, over 2324
    # player-seasons: stayed **+0.020** (n=1619, se 0.006), bought **−0.047** (n=705, se 0.011) - so the
    # discount is right and if anything mild. But split by kind: **intra-league −0.057** (n=543) against
    # **cross-league −0.013** (n=162, within half a sigma of zero). The man bought from abroad is nearly
    # unbiased; the one bought down the road is the one who pays. Defaults to the SAME value as
    # `arrival_discount`, so the incumbent is one discount for both and is literally a point of the grid -
    # a "None means fall back" would have been the same function and not the same object, which is how an
    # incumbent ends up unrepresentable in its own sweep.
    arrival_discount_cross: float = 0.80
    # Recency of the injury history: this season, the one before, the one before that.
    injury_weights: tuple[float, ...] = (1.0, 0.6, 0.35)
    # A man is never assumed to miss more than this much of a season: a bad history is a discount, not a
    # verdict that he will not play.
    availability_floor: float = 0.40
    # LA RECENZA DEL RIENTRO (pre-registrata 16/08/2026). L'ipotesi: un uomo tornato da poco da uno stop
    # lungo non e' lo stesso uomo con lo stesso storico che sta bene da un anno - rischia la ricaduta e
    # viene reinserito con calma. Il canale che gia' c'e' legge i GIORNI FUORI negli ultimi tre anni, che
    # e' una cosa diversa: dice quanto si e' fatto male, non quanto e' fa che e' tornato.
    #
    # Il caso che l'ha chiesta (operatore, 16/08/2026): Berisha M., mai piu' di 15 presenze in carriera
    # (6, 15, 13), quattro stop muscolari di cui DUE da 101 giorni consecutivi, rientrato 46 giorni prima
    # dell'asta - e il motore gliene prevede 21,2. Sulla popolazione: chi ha il 25-35% degli ultimi tre
    # anni fuori gioca l'anno dopo in mediana 15 partite e solo il 28% ne supera 21.
    #
    # PARTE DA ZERO, che e' l'unico default onesto per un'ipotesi che nessuno ha ancora giudicato - come
    # i due canali dell'investimento. `return_recency_days` e' la finestra entro cui un rientro conta
    # ancora, `return_recency_weight` quanta disponibilita' toglie a chi e' appena tornato, in quota di
    # stagione; l'effetto decade linearmente fino a zero al bordo della finestra. Sono una COPPIA perche'
    # con il peso a zero la finestra non e' identificabile: spazzarne una sola direbbe «nessun effetto» di
    # un termine che e' spento.
    return_recency_days: float = 90.0
    return_recency_weight: float = 0.0
    # How the standing splits between his START RATE and his SHARE OF THE MINUTES. The only one of these
    # parameters that is no longer provisional: `sweep` ran it on 29/07/2026 against the share of his
    # championship's rounds he actually STARTED next season, and (0, 1) - minutes alone - won on every one
    # of the ten window-platform folds, strict AND robust, mean gain +1.55% on euro (4 windows) and +1.32%
    # on default (6), worst fold +0.70%. The whole grid is monotone in that direction, so the reading is
    # the plain one: how long a coach keeps a man on the pitch says more about whether he will start next
    # season than how often he was in the eleven. `starts` is still the fallback for a player with no
    # minutes on file - no minutes recorded is not zero minutes played.
    # Report: data/reports/sweep_presence.json (`generated_at` is the provenance, as always).
    standing_weights: tuple[float, float] = (0.0, 1.0)
    # WHAT THE CLUB HAS PUT INTO HIM, and how much it should weigh on being selected. The hypothesis: a
    # club that has spent wants to see the man play and the coach forgives him a bad match, at the expense
    # of a youth-team player. Two channels because they catch different players - the fee catches Isak, the
    # stature catches De Bruyne, who arrived for nothing - and BOTH START AT ZERO: the term is off until the
    # sweep says otherwise, which is the only honest default for a hypothesis nobody has scored yet.
    # Careful with what a verdict here would and would not mean: passing says investment predicts starts
    # beyond what minutes already say. It does NOT separate "he plays because the club paid" from "the club
    # paid because he is good" - that needs a design this data cannot give.
    fee_weight: float = 0.0
    stature_weight: float = 0.0
    # ...and the third channel, which is what §7-quater was waiting for: his MARKET VALUE as a share of
    # the value of his squad, read on the INPUT season. The fee is NULL for a free transfer, so it said
    # "no investment" about Modric and De Bruyne - the two names the hypothesis came from - while a market
    # value exists for every player the source has ever priced. Historical and dated, so a window reads the
    # input season and never the target one. Starts at ZERO like the other two.
    value_weight: float = 0.0
    # HOW MUCH A MEASURED WINDOW COUNTS when there is no season at all: 0.0 = not at all, which is what
    # the ENGINE keeps (its answer for that man is R13, already adopted on Serie A - presences from his
    # recent matches at the old club) and what every gate number was measured with. The PANEL turns it on
    # (`SnapshotView.PRESENCE`), because a board that draws nobody where the engine predicts somebody is
    # two answers to one question: Alajbegovic has 693 minutes over ten Bundesliga matches, the engine
    # prices his presences off exactly those, and the eleven had him at a standing of ZERO - not "low",
    # absent. Pre-registered as a model input in gate §7-octies; until that runs it is a DISPLAY choice and
    # says so, in the company of `FORM_WEIGHT` and `RECENT_PRIOR`.
    window_standing: float = 0.0
    # THE NULL for the conditional form, and it is not a channel: a lift of the SAME SHAPE with no
    # investment in it at all - `shrink_weight * (1 - measured)`. It exists because «a statistic must be
    # compared with the right null»: `unplayed` closes part of the gap between what a man played and a full
    # season, and a man who played little tends to play more next year whoever he is (mean reversion). If the
    # constant does what the market value does, then what passed the gate is the SHAPE and not the money.
    # Swept beside the two arms (§7-septies), never adopted: it is a measuring stick.
    shrink_weight: float = 0.0
    # Where it enters: "standing" adds to the standing itself; "arrival" instead closes part of the gap in
    # `at_club_weight`, which is the sharper version of the claim - a season played elsewhere counts more
    # toward this shirt when the club paid for him, and nothing changes for a man whose whole season is
    # already here (his minutes have said it).
    # ...and "unplayed", the THIRD form, pre-registered 05/08/2026 (gate §7-septies): the lift closes part of
    # the gap between what he PLAYED and a full season, so it is null by construction on a man who starts and
    # largest on the man the coach did not use. It exists because of what killed the other two: «the mechanism
    # is already absorbed by the minutes» - and where the minutes are not informative, nothing absorbs it.
    # The case it was written for is a striker the club paid 13M for and the outgoing coach refused to field.
    # THE QUALITY CHANNEL, off until the sweep says otherwise. «Un giocatore con SURPLUS maggiore,
    # nell'arco dell'anno, acquisirà più visibilità agli occhi dell'allenatore e quindi minutaggio» -
    # the operator, 06/08/2026. Stated on the SURPLUS it would be circular (surplus = FM x predicted
    # presences, and the presences come from this very standing), so what is swept is the part that is
    # not: role-relative FANTAMEDIA, in standard deviations, added to the standing.
    # Measured first, on 1758 (player, season) of Serie A - first half against second, same club, at least
    # five votes, controlling for the minutes he already played: partial r = +0.100, and the effect is
    # +1.5 minutes per round per standard deviation (forwards +2.9, r = +0.196; midfield and defence +1.3).
    # Real, and small: 1.5 of 90 is 0.017 of a season, while a real ballottaggio is a gap ten times that.
    # THE CAREER CHANNEL, off until the sweep says otherwise. Measured 06/08/2026: the mean fantamedia of
    # the seasons BEFORE the input one predicts next season's start share beyond the minutes already
    # played - but only for FORWARDS. Partial r +0.135 (n=264, +0.034 of start share per sd) against +0.010
    # over everybody, +0.020 on midfielders and **−0.054** on defenders. A single global weight would be
    # describing four different things at once, so the input is None outside the role it was fitted on.
    career_weight: float = 0.0
    # THE AGE DECLINE (see `age_lift`): from which age it starts, over how many years it ramps, and how
    # much of a season it takes at full reach. 0.0 = OFF, which is the incumbent and a point of the grid.
    # PRE-REGISTERED GRID (08/08/2026, before any verdict was looked at):
    #     age_decline_from in (29, 30, 31) x age_decline in (0.0, 0.03, 0.06, 0.09), span fixed at 4
    # MEASURED AND REFUSED BY BOTH JUDGES, the same day:
    #   * `sweep` (error on the realised appearance share): euro mean gain **+0.23%**, worst -0.36%,
    #     pooled optimum 30/0.09 which is AT THE EDGE of the grid; default mean **+0.04%**, worst
    #     -0.84%, optimum 31/0.06. Neither reaches the 0.5% floor - strict no, robust no, on both.
    #   * the OUTCOME judge (the boards of 2025-08-15 against what the clubs did in 2025-26): every
    #     point of the grid makes it WORSE, 134/220 men -> 132 and 13 modules -> 12, monotonically.
    # And the mechanism, which is why the band table that suggested it was misleading: the 30+ ALREADY
    # carry fewer measured minutes (1299 against 1574 for the 27-29 band, Serie A 2024-25), so the
    # standing discounts them before any age term is added and the term charges the same evidence twice.
    # The band table (66/72/77/51% of starts kept) does not control for the minutes; the model does.
    # Kept at 0 and reachable, like `HEATMAP_SIDE` and `PRESEASON_WEIGHT`: the measurement is the value.
    age_decline_from: float = 30.0
    age_decline_span: float = 4.0
    age_decline: float = 0.0
    quality_weight: float = 0.0
    # THE LEVEL CHANNEL, off until the sweep says otherwise. «Livello più alto puoi intenderlo anche con
    # Premier > Serie A» - the operator, 06/08/2026, and the data agrees: mean ClubElo is 1807 in the Premier
    # against 1610 in Serie A. Measured on 700 transfers, controlling for the minutes he played AND for his
    # fantamedia (so it is LEVEL and not quality in disguise): partial r +0.137 overall, +0.235 for forwards,
    # +0.040 of start share per +1 sd of Elo (1 sd = 127 points). Gate §7-terdecies.
    # ADOTTATO 06/08/2026 al valore 0.06 - lo sweep, non una scelta. Serie A: robust PASS, guadagno medio
    # +0.93% su 6 finestre, il cross-fit sceglie 0.08 in 5 fold su 6. euro: positivo su TUTTE e 4 le
    # finestre (peggiore +0.05%) e non robust solo perché la media, +0.46%, sta sotto la soglia dello 0.5%.
    # Entrambe le curve pooled hanno un minimo INTERNO - euro a 0.06, Serie A a 0.08, e risalgono a 0.12 -
    # che è la condizione che mancava a ogni altro candidato di oggi. 0.06 è l'ottimo di euro e cattura il
    # 90% del guadagno di Serie A (0.20106 contro 0.20084 al suo 0.08): un valore solo, quasi ottimo su
    # entrambe, invece di una costante che sarebbe giusta su una piattaforma e sbagliata sull'altra.
    level_weight: float = 0.06
    # ...and the SALTO: Elo(the club he played for) - Elo(the club that just bought him), standardised.
    # Pre-registered 07/08/2026 (gate §7-duovicies) from the operator's question - «cosa differenzia un
    # giocatore acquistato per riempire la rosa da uno preso per giocare titolare?» - after he refused the
    # obvious candidate on an argument that holds: the listone's Qt.I is not an objective value, it already
    # contains its author's opinion about how much the man will play, so predicting that with the price is partly
    # circular. Measured at EQUAL MINUTES (the confound that ate the first attempt: the index `minutes x
    # Elo` correlates +0.769 with the minutes themselves, so it is the regression rewritten and not new
    # information): the gap scores r = +0.220 against the residual, the absolute origin level +0.117.
    # WHAT THE SIGN SAYS is the answer to the question: a POSITIVE gap - he comes from a stronger club than
    # the one buying him - means the model UNDER-predicts him. Chi scende di livello sale di ruolo: he was
    # behind better players and now he is not. The symmetric case is the commoner one, the regular starter
    # who steps UP a level and is over-predicted. And the gap beats the absolute level TWICE OVER, which is
    # also why this is not R5 in disguise: R5 read the destination Elo alone and was rejected four times.
    # ADOTTATO 07/08/2026 a 0.06, sul verdetto ROBUST di `default` (gate §7-duovicies). Serie A:
    # media +0.77%, **peggior fold +0.13%** - nessuna finestra peggiora - e il cross-fit sceglie 0.06 su
    # tutte e sei le pieghe, all'unanimita'. euro: media +0.35%, peggior fold -0.07%, cioe' positivo ma
    # sotto il pavimento dello 0.5%. L'ottimo e' INTERNO su una griglia che arriva a 0.12 ed e' lo
    # STESSO 0.06 sulle due piattaforme, quindi il valore unico non e' un compromesso fra due ottimi
    # diversi: e' l'ottimo di entrambe, il che rende questa adozione meno delicata di quella di R19
    # (che su euro era CONTRO, 0 finestre su 5).
    # DA TENERE D'OCCHIO, dichiarato adesso e non dopo: e' un'adozione senza `passes`, quindi piu'
    # fragile di una sullo strict. Se il prossimo giro di sweep la trova peggiorata, esce senza
    # discutere - e chi la difende deve saperlo.
    # E il canale gemello NON e' entrato: `level_rank_weight` (il rango nel reparto) e' stato misurato
    # nello stesso giro e il cross-fit lo azzera su entrambe le piattaforme.
    level_gap_weight: float = 0.06
    # ...and the third of the family: WHERE HE STANDS IN THE DEPARTMENT HE JOINS, by the level of the
    # football he has played (`elo.personal_levels`, five seasons, minutes-weighted). The operator's
    # question was «cosa differenzia un giocatore acquistato per riempire la rosa da uno preso per
    # giocare titolare», and this is the answer that reads no quotation at all.
    # A BLEND and not a lift, and that is the whole lesson of gate §7-tervicies: as a CLASSIFIER the
    # rank is weak (it separates 40% from 34% of the next season's minutes), because for a man whose
    # minutes already say he plays it is answering a question that has an answer. Read as a second
    # term over the minutes it is the best thing measured on this population - r +0.286 for the
    # minutes alone, +0.109 for the rank alone, **+0.346 for 0.75 x minutes + 0.25 x rank**, with an
    # INTERIOR maximum (0.15 -> +0.329, 0.25 -> +0.346, 0.35 -> +0.339, 0.50 -> +0.283).
    # It fixes both directions: Atta, 75% of the minutes at Udinese, was last by rank and comes back
    # 10th of 48; Valdepenas, 2% of a season at Real Madrid, was FIRST and falls to 0.27.
    # 0.0 until the sweep says otherwise.
    level_rank_weight: float = 0.0
    # HOW MUCH OF A SEASON the standing was measured on, as a shrinkage: `m x r/(r+K) + prior x K/(r+K)`,
    # with r the rounds he was there for. K = 0 is the incumbent (no shrinkage) and there is no meaningful
    # negative direction - the null IS zero, which is why this grid is one-sided and says so.
    # MEASURED first (gate §7-quaterdecies, 2195 player-seasons): a standing built on few rounds does not
    # hold. Error = next season's real start share minus the standing - 3-10 rounds **+0.073**, 11-19
    # +0.048, 20-28 −0.021, 29-34 −0.027, 35+ −0.008; and isolating the high standings (> 0.55), a short
    # sample overshoots by **−0.190** against −0.092 for a full one. It cuts both ways, which is why a
    # shrinkage toward the mean is the right shape rather than a one-sided discount.
    # ADOTTATO 06/08/2026 a 10 giornate, ed è il verdetto più netto di tutta la sessione: euro **strict E
    # robust** (guadagno medio +2.82%, peggior fold +1.97%, tutti e quattro scelgono 10), default robust
    # (+1.96%, ogni fold positivo, cross-fit 10 su tre e 6 su tre). Minimo INTERNO su entrambe le curve, che
    # risalgono a 15 e 25: euro 0.20023 (K=0) -> 0.19454 (10) -> 0.19907 (25). Un ordine di grandezza sopra
    # ogni altro canale misurato oggi. Il prior di popolazione esce ~0.46-0.51, cioè mezza stagione.
    standing_prior_rounds: float = 10.0
    investment_shape: str = "standing"
    # QUANTO PESA LA STAGIONE IN CORSO CONTRO QUELLA PRECEDENTE, in giornate di prior (`blend_seasons`).
    #
    # «2 partite non devono valere una stagione ma solo 2/38 di stagione ... troppo poco per bastare da
    # sole, quindi completiamo il quadro con le partite pregresse» (operatore, 04/09/2026). Prima di
    # questa riga il pannello COMMUTAVA: sopra una soglia leggeva solo la stagione in corso, quindi due
    # giornate di Serie A decidevano la titolarita' di 358 righe su 602 - Douvikas 2/2 letto `titolare`
    # a 75', Kean un ingresso da 27' letto `riserva`, e 313 righe su 358 in disaccordo col proprio Pa.
    #
    # IL VALORE NON E' SCELTO QUI, ED E' STATO RIMISURATO IL 05/09/2026 SU QUESTA STESSA DOMANDA.
    # Le 10 giornate erano PRESE IN PRESTITO da R20 (`evaluate.R20_ROUNDS`, gate §7-duotricies), che e' la
    # K misurata per l'ACCURATEZZA di `engine_pv_pred` su finestre a k = 6 e 10 giornate giocate; qui la
    # quantita' e' `appearance_share` e il momento e' k = 2. «Una costante appartiene alla domanda su cui
    # e' stata misurata, non solo alla popolazione» - stessa famiglia del vantaggio campo del 03/09.
    #
    # Misurata fuori campione sulla quantita' che questo file pubblica: alla giornata k, prevedere la
    # quota di presenze nelle giornate che RESTANO (nessuna delle quali entra nel predittore), su 6.719
    # uomo-stagione con una stagione precedente e una corrente nello stesso campionato a un club solo,
    # cinque campionati, 2020-21 -> 2025-26. MAE a k = 2:
    #
    #   K        0      2      3      4      5      6      8     10     15     20   solo prior
    #   MAE  0.2876 0.1998 0.1935 0.1912 0.1908 0.1912 0.1925 0.1942 0.1974 0.1997     0.2095
    #
    # Ottimo INTERNO a 5, piatto fra 4 e 6; le 10 in vigore costano +1.8% di errore. Tre conferme che lo
    # rendono adottabile: l'ottimo e' lo STESSO a k = 2, 4 e 6 - che e' la proprieta' che deve avere un
    # prior, una quantita' fissa di prova e non una che cresce col campione, ed e' l'argomento misurato
    # contro la percentuale fissa che l'operatore aveva proposto (un 50/50, cioe' K = k, costa +4.7%);
    # e' stabile per stagione (6·6·6·6·4·4); e 6 e' la K che il gate aveva gia' adottato per R20 su euro,
    # cioe' due strade indipendenti sullo stesso numero.
    #
    # IL SUO MECCANISMO E' VERO E NON SPOSTA IL CAMBIO («le partite del passato hanno un contesto diverso
    # e quindi meno veritiere», 05/09/2026): separando chi e' rimasto al suo club da chi ha cambiato,
    # l'ottimo e' 5 contro 4 - un punto, dentro il rumore - perche' il cambio di contesto peggiora TUTTE
    # E DUE le meta' (solo-prior 0.196 -> 0.262, solo le due partite 0.272 -> 0.350) e quindi il rapporto
    # fra loro quasi non si muove. Niente K per popolazione: una seconda manopola per un effetto che non
    # separa. La forma resta quella di `model.blend_with_seen` e di `standing_prior_rounds`: k osservate
    # contro K di prior, inerte a k = 0 (una pre-stagione non cambia di un decimale).
    season_prior_rounds: float = 5.0
    # ...e le AMICHEVOLI, «in maniera molto lieve» (sua richiesta, stessa data). DICHIARATO e non
    # misurato: un ritiro non e' un campionato - avversari di categoria diversa, minuti spartiti per
    # farli giocare tutti - e la forma piu' vicina che questo progetto ha gia' misurato (PRESEASON_WEIGHT
    # sui MODULI) e' stata rifiutata con l'ottimo sul bordo. Vale una giornata di evidenza: con due
    # giornate giocate e dieci di prior pesa l'8%. Sweep-abile come ogni altro parametro di questo file.
    friendly_rounds: float = 1.0
    # WHICH absences come off the denominator of the start rate:
    #   "measured" - the rounds he actually missed inside the measured season. A fact about the sample.
    #   "forecast" - the three-season weighted estimate, which is what the panel used until v9.11. It is
    #                also the number `availability` multiplies back in, so subtracting it here cancels
    #                out of `presence` almost exactly and the injury history becomes decoration.
    # Both are on the table and the gate decides; the shapes are named so a report can say which it ran.
    contested_from: str = "measured"
    # ------------------------------------------------------------------ LA FINESTRA CORTA
    # LE ULTIME PARTITE, che sono una DOMANDA DIVERSA da tutto il resto di questo file e per questo hanno
    # parametri loro: le funzioni sopra prevedono la stagione che resta - il bersaglio su cui
    # `season_prior_rounds` e' stato misurato - e queste tre prevedono la PROSSIMA PARTITA. Due bersagli,
    # due letture, due nomi (`recent_share`, `recent_claim`), come `engine_replacement_fm` e lo zero
    # schierato sono due zeri per due domande.
    #
    # E STANNO QUI E NON NEL PANNELLO, che e' dove le due che ne esistevano hanno vissuto un anno:
    # `gui.FORM_WEIGHT` = 0.60 e `gui.RECENT_PRIOR` = 3.0, dichiarate scelte di visualizzazione, MAI
    # misurate e irraggiungibili da `sweep` - contro la regola di casa che questo file incarna, «un
    # parametro che nessun banco raggiunge e' un parametro che nessuno puo' misurare». Il rimando che
    # portavano («gate §7-octies») oggi punta a un'altra sezione.
    #
    # MISURATE FUORI CAMPIONE il 10/09/2026, sul bersaglio che pubblicano: al match m di un club si legge
    # solo il calcio < m e si giudica su m - chi parte titolare, chi prende il voto, i minuti. 3.638
    # partite-club, 72.022 righe, due stagioni complete x cinque campionati (2024-25, 2025-26).
    #
    #   lettura                                   Brier (parte titolare)   dei veri undici
    #   gli stessi di ieri (null)                          0.2314                8.43
    #   la stagione (cio' che il foglio fa oggi)            0.1696                8.46
    #   solo le ultime 3                                   0.1749                8.60
    #   ultime 3 + prior di 3                              0.1581                8.68
    #   ...con la prova in MINUTI invece che in partenze    0.1544                8.69
    #
    # Due cose che quella tabella dice e vanno lette insieme: le ultime tre DA SOLE scelgono l'undici
    # meglio della stagione (8.60 contro 8.46) e sono tarate PEGGIO (0.1749 contro 0.1696), che e' la
    # ragione per cui quello che si adotta e' la miscela e non la finestra nuda - tiene il guadagno
    # sull'ordine e aggiusta il numero.
    #
    # `recent_window` e' piatta fra 2 e 4 e scende da 5 in su, quindi le 3 dell'operatore cadono
    # sull'ottimo; `recent_prior` ottima a 3, cioe' lo stesso valore che `gui.RECENT_PRIOR` portava senza
    # misura - due strade indipendenti sullo stesso numero, come per `season_prior_rounds` e la K di R20.
    # UNA miscela e non due: la forma del pannello ne faceva due in cascata (accorciare verso lo standing,
    # poi mescolare con `FORM_WEIGHT`), e la forma misurata e' quella che questo repository scrive da
    # sempre, k osservate contro K di prior.
    recent_window: float = 3.0
    recent_prior: float = 3.0
    # QUANTO VALE UNA PARTITA come prova, e la regola che decide e' quella di casa: LA PROVA DI UNA
    # QUANTITA' E' LA QUANTITA' STESSA. `recent_share` e' la quota delle partite in cui prende il VOTO -
    # l'asse su cui la scala a sei parole e' costruita - quindi la sua prova e' «ha preso il voto», non i
    # minuti.
    #
    # QUESTO CAMPO E' STATO SPEDITO A "minutes" IL 10/09/2026 ED E' UN DIFETTO, corretto lo stesso giorno
    # su richiesta dell'operatore («verifica se i ragionamenti sui titolari a breve termine sono corretti
    # confrontando l'andamento con le stagioni passate»). I minuti avevano vinto una misura vera - ma su
    # un ALTRO bersaglio, «chi comincia la prossima partita» - e sono stati applicati a una quantita' su
    # cui nessuno li aveva misurati: un uomo che entra ogni partita per 45' vale 1,0 di presenze e 0,5 di
    # minuti, e la prova in minuti lo schiaccia. E' «un parametro appartiene alla domanda su cui e' stato
    # misurato», commesso dentro la sessione che quella regola stava applicando altrove.
    #
    # MISURATO fuori campione sulla PROPRIA quantita' (76.315 osservazioni, due stagioni x cinque
    # campionati; alla partita m si legge solo il calcio < m, l'esito e' la quota delle partite
    # successive in cui era disponibile che ha giocato). Errore medio a +3 partite:
    #
    #   prova            +1       +3       +5
    #   nessuna       0.2103   0.1716   0.1607     (la sola stagione: il null di questa domanda)
    #   minuti        0.2566   0.2073   0.1944     spedita il 10/09: PEGGIO del non avere la finestra
    #   presenze      0.1956   0.1614   0.1531     ADOTTATA: -6% sul null
    #
    # Le altre due forme restano nominate perche' un rifiuto cancellato non si puo' ri-correre, e perche'
    # sull'ALTRO bersaglio i minuti vincono davvero: sulla quota da TITOLARE leggono 0.2187 contro 0.2199
    # delle partenze e 0.2359 della sola stagione. Li' pero' la quantita' e' `recent_starting_share`, che
    # ha la sua prova (le partenze) per la stessa regola: 0,0012 di errore non vale un'eccezione che
    # rende inspiegabile perche' due funzioni vicine leggano assi diversi.
    #   "appearances" - ha preso il voto. ADOTTATA.
    #   "minutes"     - min(minuti, 90)/90. Vince su «chi comincia» e perde qui.
    #   "start"       - parte titolare si'/no.
    #   "full"        - la partita finita vale 1, una partenza sostituita 0,5, un ingresso 0. E' la
    #                   lettura LETTERALE di «giocare 90' e' un segnale molto forte di titolarita'»
    #                   (l'operatore, 10/09/2026) e sul suo stesso bersaglio legge PEGGIO della binaria
    #                   (0.1746 contro 0.1710 di Brier): il meccanismo e' vero e una soglia e' la forma
    #                   sbagliata per esprimerlo.
    recent_evidence: str = "appearances"
    # QUANTO E' «A BREVE» un rientro, in PARTITE DEL SUO CLUB e non in giorni. DICHIARATO: l'operatore ha
    # detto «un mese» (10/09/2026) e quattro partite sono il suo mese in Serie A, ma una soglia in giorni
    # non si confronta fra due calendari - una giornata euro non e' una giornata di Serie A, ed e' la
    # lezione di R20 («una soglia di scoring e' una QUOTA del calendario che si sta prevedendo, non un
    # numero») applicata a un rientro. Letto da chi disegna le due board, per decidere se il padrone di
    # un posto torna dentro l'orizzonte: sopra questa soglia si IGNORA, cioe' per il breve termine il
    # posto e' di chi lo sta occupando.
    recent_owner_matches: float = 4.0

    def with_value(self, name: str, value) -> Params:
        return replace(self, **{name: value})


DEFAULTS = Params()


@dataclass(frozen=True)
class Inputs:
    """What one player's presence is computed from - all of it measurable before the auction.

    Deliberately not a CSV row: the panel builds this from the sheet, the sweep builds it from the DB for
    a window that was played years ago, and neither has to know the other's column names.
    """

    # the measured season, LEAGUE ONLY (his championship, not the cups)
    starts: float = 0.0
    # ...and the WINDOW, for a man who has no season here at all: the matches we could measure elsewhere
    # and the minutes in them. Its own denominator is the point - ten matches at 69 minutes is 77% of the
    # football that was available to him, and reading those minutes against a 38-round season would call
    # the same man a 20% player.
    window_matches: float = 0.0
    window_minutes: float = 0.0
    appearances: float = 0.0
    minutes: float = 0.0
    # his club's calendar: the championship's rounds, and every fixture we know it played
    league_matches: float = 38.0
    fixtures: float = 0.0
    # ...and, ONLY when the two are not the same number, the rounds his MEASURED season is a share of:
    # `features.measured_season_rounds`, filled for a man who played two championships in one season.
    # `league_matches` is the calendar being PREDICTED and stays what it is, because `absences_per_season`
    # counts absences per FULL season and dividing that by a shortened exposure would change its unit;
    # this one is the denominator of what was OBSERVED, and only `contested` reads it. None = the two
    # coincide, which is every man who did not change championship - and «vuoto = ignoto» keeps his
    # club's calendar rather than guessing a window.
    measured_rounds: float | None = None
    # Absences, in LEAGUE ROUNDS. `rounds_by_season` is most recent first, aligned with
    # `params.injury_weights`, with None for a season we had no calendar to count on - which is what makes
    # the weights SWEEPABLE: a pre-weighted total would freeze them at the values it was written with.
    rounds_measured: float | None = None
    rounds_by_season: tuple[float | None, ...] = ()
    # The source's own figure, over every competition, already weighted with the DEFAULT recency: the
    # fallback for a player whose club we have no calendar for. Not sweepable, and it says so.
    weighted_all: float | None = None
    known_injuries: bool = False
    # Da quanti GIORNI e' rientrato dal suo ultimo stop CHIUSO, alla data della previsione. None = non lo
    # sappiamo o non ne ha avuti, e allora il canale tace: «vuoto = ignoto», mai «e' integro da sempre».
    # Uno stop ancora APERTO non arriva qui - quello e' un'altra cosa e lo dicono le assenze.
    days_since_return: float | None = None
    # whose season it was
    minutes_here: float = 0.0
    minutes_elsewhere: float = 0.0
    was_here_before: bool = False
    # ...and whether the club has just PAID a transfer fee for him. It exists to say which of the two
    # discounts `was_here_before` earns: the harsher one means «it sent him away, and that is its own
    # judgement», and a club spending 41.2M to sign a man back is making the opposite statement. Kolo
    # Muani was PSG's player on loan at Juventus, then Tottenham's, and has now been bought - the loan
    # discount read him as a man Juventus had discarded and charged him 0.60 where his 1670 minutes would
    # otherwise put him ahead of the incumbent. NOT a claim about how much was paid, which the gate has
    # falsified twice (§7-quater, and the fee «does not separate»): the AMOUNT says nothing here, only its
    # existence, and where there is no fee on file the incumbent discount stands - «vuoto = ignoto».
    resigned: bool = False
    # what the club put into him: his fee as a share of what it spent that window (0 = no new spending,
    # None = we have no fees for that club), and his Qt.I percentile within his role (None = unquoted)
    fee_share: float | None = None
    stature: float | None = None
    value_share: float | None = None
    # ...and what he SHOWED with the minutes he had: his measured fantamedia relative to his role, in
    # standard deviations (None = no season to read). Not a valuation and not a forecast - the operator's
    # hypothesis is that a coach watches, so the thing that has to be in here is what a coach saw.
    fm_z: float | None = None
    # ...and the LEVEL of the football those minutes were played at: the Elo of the club he played them for,
    # in standard deviations, and ONLY for a man who has changed club (None otherwise). Restricted on
    # purpose - it is the population the coefficient was measured on, and for a man who stayed the term
    # would silently become "his own club is strong", which is a different claim nobody has measured.
    level_z: float | None = None
    # ...and the SALTO between the two levels, standardised over the same population: how far he steps DOWN
    # (positive) or UP (negative) by moving. None for a man who stayed - his gap is zero by construction -
    # and None when either Elo is missing, which is «vuoto = ignoto» and not a gap of zero.
    level_gap_z: float | None = None
    # ...and his place in the department he JOINS, 0..1, by the level of the football he has played -
    # 0 the lowest of his role in the new squad, 1 the highest. None where it cannot be computed (no
    # matched club, or a department too thin to rank in), which is «vuoto = ignoto» and NOT a 0.5.
    level_rank: float | None = None
    # What a SHORT sample is shrunk toward. Supplied by the caller (the panel from its sheet, the sweep from
    # its window) because `presence` is dependency-free and an average is a property of a population.
    # CONDITIONAL ON THE ROUNDS OBSERVED since 06/08/2026, and that is the whole point: the mean of everybody
    # is 0.53, but a man measured over 3-10 rounds actually plays **0.207** of the next season, not 0.53 -
    # he is not a random member of the population, he is a fringe player, and the rounds say so. Shrinking
    # him toward everybody's mean was pulling him UP (Milik, two rounds, came out at 26% of claim). The
    # bands are the ones already published in gate §7-quaterdecies: 0.207 / 0.411 / 0.463 / 0.571 / 0.574.
    # None = no prior, no shrinkage.
    standing_prior: float | None = None
    # ...and WHAT KIND of arrival he is: True when the club he left plays in another championship. Measured
    # 06/08/2026 over 2324 player-seasons - the two are not the same event and the model had one discount
    # for both (gate §7-quindecies).
    cross_league: bool = False
    # What he had already SHOWN before last season, relative to his role, in standard deviations - and only
    # for FORWARDS, which is the population it was measured on (gate §7-vicies). None everywhere else.
    career_z: float | None = None
    # HIS AGE in the target season. None = unknown (no birth year on file), which is not "young".
    # It is here for ONE measured shape and not as a general "age matters" (see `age_lift`).
    age: float | None = None


def investment_lift(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """How much the club's investment should move him, in shares of a season. 0.0 when the term is off.

    The fee channel is one-sided (no spending is not evidence against a man), the stature channel is
    CENTRED: above-median Qt.I lifts, below-median pushes down, because the claim has two sides and the
    youngster losing his place to a signing is the same statement as the signing keeping it.

    An unknown channel contributes nothing - not knowing what a club spent is not knowing.
    """
    lift = 0.0
    if params.fee_weight and inputs.fee_share is not None:
        lift += params.fee_weight * inputs.fee_share
    if params.stature_weight and inputs.stature is not None:
        lift += params.stature_weight * (inputs.stature - 0.5) * 2.0
    # The value channel is ONE-SIDED like the fee, and for the same reason: being a small part of a rich
    # squad is not evidence against a man. It is also scaled to the squad, so an eleventh of it - what a
    # starter is by construction - reads about 0.09.
    if params.value_weight and inputs.value_share is not None:
        lift += params.value_weight * inputs.value_share
    # ...and the null, which reads nothing about him at all
    lift += params.shrink_weight
    return lift


def career_lift(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """What he had shown BEFORE last season, in shares of a season. 0.0 when off or outside its role.

    Centred like the others. Distinct from `quality_lift`, which reads the INPUT season and was falsified
    (§7-duodecies): this reads the seasons before it, which the standing has never seen at all.
    """
    if not params.career_weight or inputs.career_z is None:
        return 0.0
    return params.career_weight * inputs.career_z


def age_lift(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """The DECLINE of a man past a threshold age, in shares of a season. 0.0 when off or unknown.

    A THRESHOLD, not a trend, and that distinction is the whole measurement. Over 500 (player, season)
    pairs with 15+ Serie A starts in the input season, across two seasons so one year's quirk cannot
    carry it, the share of those starts kept the next season is:

        <= 23   66%   (47% lose 10+ starts)
        24-26   72%   (40%)
        27-29   77%   (35%)   <- the BEST band, not the youngest
        >= 30   51%   (56%)

    So the relationship is an inverted U and a linear term would be the wrong model: it would penalise
    the twenty-year-olds, who are second-worst, and dilute the one real effect. The linear correlation is
    accordingly weak (r -0.139, partial -0.122 controlling for the input starts) which is exactly what a
    threshold looks like when you fit a line to it.

    ⚠️ THIS IS NOT R4. R4 («age») is falsified on ten windows and predicts the FANTAVOTO; this predicts
    WHO PLAYS. Those are the two questions this project keeps apart everywhere - claim against valuation -
    and the second one had never been measured. Stated here because without it this reads as a dead rule
    dug up again.

    One-sided by construction (a discount, never a bonus): the measurement says the old lose the shirt,
    not that the young gain it - the young lose it too. Where the birth year is missing the term is off,
    «vuoto = ignoto»: an unknown age is not a young one.
    """
    if not params.age_decline or inputs.age is None:
        return 0.0
    if inputs.age < params.age_decline_from:
        return 0.0
    # Ramped over `age_decline_span` years rather than a cliff, for the reason every other threshold here
    # is ramped: nothing may turn on one birthday, and a 34-year-old is not a 30-year-old.
    span = max(params.age_decline_span, 1e-9)
    reach = min(1.0, (inputs.age - params.age_decline_from) / span)
    return -params.age_decline * reach


def quality_lift(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """How much what he SHOWED should move his standing, in shares of a season. 0.0 when the term is off.

    CENTRED, like the stature channel and for the same reason: the claim has two sides, and «he played
    well and earned minutes» is the same sentence as «he played badly and lost them». A one-sided version
    would be a hypothesis that only allows the sign it expects.

    Unknown is not zero: a man with no season to read contributes nothing rather than an average.
    """
    if not params.quality_weight or inputs.fm_z is None:
        return 0.0
    return params.quality_weight * inputs.fm_z


def level_lift(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """How much the LEVEL of the football behind his minutes should move his standing. 0.0 when off.

    Centred, like the other two: coming from a stronger side lifts, coming from a weaker one pushes down.
    The same minutes are not the same evidence - a starter at PSG (Elo 1970) and a starter at a mid-table
    Serie A club (1610) are two different men, and the standing reads them identically today.
    """
    if not params.level_weight or inputs.level_z is None:
        return 0.0
    return params.level_weight * inputs.level_z


def level_gap_lift(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """How much the STEP between the two levels should move him. 0.0 when off. See `Params.level_gap_weight`.

    Deliberately a separate term from `level_lift` and not a replacement for it, because the two share
    `elo_prev` and the sweep has to be able to tell them apart: with both on the grid, a run where this one
    wins and `level_weight` falls to zero says the gap SUBSUMES the level, and a run where both stay
    positive says they read different things. Collapsing them here would have decided that by hand.
    """
    if not params.level_gap_weight or inputs.level_gap_z is None:
        return 0.0
    return params.level_gap_weight * inputs.level_gap_z


@dataclass(frozen=True)
class SeasonWindow:
    """Il calcio misurato di una finestra: quanto ha giocato, e su quante giornate di quel calendario.

    Una finestra e' un pezzo di calcio con il SUO denominatore. Tenerli insieme e' l'unica difesa contro
    l'errore che questo progetto paga da sempre - numeratore e denominatore contati su competizioni
    diverse - e qui l'aveva gia' pagato: su un foglio in-season il pannello divideva le 2 presenze di
    Douvikas per le 2 giornate giocate e l'unico ingresso di Kean per le 38 di una stagione intera
    (`gui.SnapshotView.season_calendar` usa il calendario d'ORIGINE per chi ha giocato solo altrove),
    cioe' due unita' nella stessa colonna.
    """

    appearances: float = 0.0
    starts: float = 0.0
    minutes: float = 0.0
    #: I minuti spezzati in due: qui e altrove. `at_club_weight` legge questa divisione, quindi va
    #: mescolata insieme al resto o la scala dell'una non e' la scala dell'altra.
    minutes_here: float = 0.0
    minutes_elsewhere: float = 0.0
    #: Le giornate di campionato di cui quei numeri sono una quota. 0 = finestra assente.
    rounds: float = 0.0
    #: ...E QUANTE DI QUELLE GIORNATE ERA INFORTUNATO, cioe' la correzione del PROPRIO denominatore.
    #
    # Viaggia con la finestra per la ragione scritta qui sopra - «una finestra e' un pezzo di calcio con
    # il SUO denominatore» - e ci e' arrivata il 07/09/2026 perche' per tre giorni non c'e' stata.
    # `contested` sottrae UN numero (`Inputs.rounds_measured`) da un denominatore che dal 04/09 e' una
    # MISCELA di due stagioni, e quel numero era le giornate saltate nella sola stagione bersaglio:
    # quelle del prior si perdevano. Berardi ha preso il voto in 26 giornate su 38 saltandone DIECI per
    # infortunio - quota condizionale 26/28 = 0.929, che e' la frase dell'operatore su di lui («e' un
    # titolarissimo che gioca poco per via dei continui infortuni») - e il prior entrava a 26/38 = 0.684,
    # facendolo leggere `panchina`. Su un foglio di PRE-stagione la stessa quota era giusta, perche' li'
    # numeratore e denominatore stanno su una stagione sola: la miscela ha rotto una condizionalita' che
    # funzionava, ed e' la terza volta che questo repository paga «il denominatore segue il suo
    # NUMERATORE» (20/08 sui due campionati, 05/09 sulla quota da titolare, questa).
    #
    # Non e' una previsione e non e' uno sconto di disponibilita': `appearance_share` risponde alla
    # domanda dell'ALLENATORE («quando e' disponibile, lo usa?»), quindi una giornata dentro uno stop
    # datato esce dal denominatore invece di contare come una preferenza per un altro. Chi cammina le
    # giornate e le conta e' `snapshot.rounds_missed`; qui si mescolano soltanto.
    missed: float = 0.0


def blend_seasons(now: SeasonWindow, prev: SeasonWindow,
                  friendly: SeasonWindow | None = None,
                  params: Params = DEFAULTS) -> SeasonWindow:
    """Le finestre pesate in UNA sola, con il suo denominatore: la stagione in corso, quella scorsa e il ritiro.

    LA FORMA E' QUELLA DI R20 e della shrinkage per taglia del campione, che e' la stessa cosa scritta
    due volte in questo repository: `k` giornate osservate contro `K` di prior, cioe'

        quota = (k x osservata + K x prior) / (k + K)

    scritta qui sui NUMERATORI invece che sulle quote, perche' chi chiama ha bisogno anche dei minuti e
    della divisione qui/altrove. A `now.rounds` = 0 restituisce la stagione precedente INTATTA, che e'
    cio' che rende la miscela inerte su ogni foglio di pre-stagione - e quindi su ogni finestra su cui il
    gate ha pubblicato un numero.

    PERCHE' UNA MISCELA E NON UN INTERRUTTORE. Fino al 04/09/2026 `snapshot.measured_season` COMMUTAVA:
    superate cinque giornate (contate su cinque campionati insieme, quindi sempre) tutte le colonne
    descrittive passavano alla stagione in corso, e due giornate di Serie A diventavano una stagione.
    Misurato sul foglio del 03/09: 358 righe su 602 avevano una «stagione misurata» il cui massimo era 2
    partite, e 313 di quelle 358 erano in disaccordo con il proprio Pa - le `bandiera` promettono il 90%
    delle partite e la loro mediana leggeva 0,58, i `riserva` 0,50. Un campione di due partite non e' una
    stagione, ed e' esattamente quello che la miscela dice con un numero.

    La stagione precedente entra RISCALATA a `season_prior_rounds` giornate: quello che conta di lei non
    e' quanto era lunga ma quanto vale come prior, altrimenti un campionato da 34 giornate peserebbe meno
    di uno da 38 per una ragione che non riguarda il calciatore.
    """
    windows: list[tuple[SeasonWindow, float]] = []
    if now.rounds > 0:
        windows.append((now, 1.0))
    # IL PRIOR SI RISCALA A `K` GIORNATE DI CALCIO CONTENDIBILE, non di calendario (07/09/2026), perche'
    # e' quella la sua taglia come PROVA: la quantita' che questa miscela serve e' `appearance_share`,
    # «delle partite in cui era disponibile, quante ne ha giocate», e una giornata passata in infermeria
    # non e' una prova su di lui. Con il calendario al denominatore le due meta' non erano nella stessa
    # unita' e Berardi entrava a 26/38 = 0.684 invece di 26/28 = 0.929.
    #
    # E IL TAPPO A 1.0 IMPEDISCE AL PRIOR DI ESSERE GONFIATO oltre il calcio che contiene davvero. Senza
    # di lui, chi era disponibile per tre giornate ne porterebbe cinque, cioe' due inventate; e nel caso
    # limite - chi ha saltato l'intera stagione - il prior sottrae tutto il proprio denominatore e si
    # CANCELLA, lasciando l'uomo sulle due partite di quest'anno. Trovato dalla misura e non dalla
    # rilettura: sul foglio del 07/09 Pieragnolo (33 giornate perse su 38) leggeva **0.300 -> 1.000** e
    # Frigan (38 su 38) 0.200 -> 0.700, cioe' `bandiera` su due partite - il difetto esatto per cui
    # questa funzione e' stata scritta, rientrato dalla porta degli infortuni.
    #
    # Chi non ha NESSUNA giornata contendibile non ha un prior misurato affatto, e la decisione non e'
    # qui: `snapshot.prior_window` gli da' quello sintetico della sua popolazione, come a chi non ha mai
    # giocato. Qui il prior si limita a non entrare, o sarebbe una finestra vuota che pesa.
    contended_prev = prev.rounds - prev.missed
    if prev.rounds > 0 and contended_prev > 0 and params.season_prior_rounds > 0:
        windows.append((prev, min(params.season_prior_rounds / contended_prev, 1.0)))
    # I MINUTI DEL RITIRO SONO IMPUTATI, e fino al 05/09/2026 questa riga diceva il contrario di quello
    # che faceva. Il commento al punto di chiamata prometteva gia' che il ritiro «entra con i minuti della
    # media delle altre e non ne sposta il rapporto di un decimale»; il chiamante passava una finestra
    # SENZA minuti, quindi il ritiro aggiungeva una giornata da ZERO minuti a tutti. Misurato su un
    # titolare da 85' con dieci giornate di prior: la quota di minuti che `standing` legge scende di
    # **0.060 a K=10 e di 0.100 a K=5**, cioe' il difetto peggiora proprio con la K adottata oggi. Terza
    # istanza in questo repository di «una finestra vuota non e' una finestra a zero», e la prima trovata
    # leggendo un commento invece di una colonna.
    #
    # Imputati al TASSO delle altre finestre e spartiti nella loro stessa proporzione fra qui e altrove:
    # e' la lettura letterale di «i minuti della media delle altre», e lasciando `at_club_weight` fermo
    # non introduce di straforo una seconda affermazione (che il ritiro sia una prova su questo club) in
    # una correzione che riguarda i minuti.
    if friendly and friendly.rounds > 0 and params.friendly_rounds > 0:
        if not friendly.minutes and windows:
            # IL TASSO E' PER PRESENZA E NON PER GIORNATA (07/09/2026, sera tardi), ed e' la seconda volta
            # che questa riga dice il contrario di cio' che promette. Il commento al punto di chiamata
            # dice «entra con i minuti della media delle altre e non ne sposta il RAPPORTO di un
            # decimale»: il rapporto in questione e' minuti/PRESENZA, che e' quello che `minutes.
            # per_appearance` legge e che per un portiere E' l'intera colonna. Diviso per le GIORNATE, il
            # ritiro affermava «ha cominciato 4 amichevoli, 39,6 minuti ciascuna» - una finestra che
            # contraddice se stessa, perche' le sue presenze sono PARTENZE DA TITOLARE.
            #
            # Trovato dall'operatore su un paradosso apparente («perche' Meret ha minuti attesi 80 e
            # contemporaneamente Milinkovic-S. ha 79?»), che non era un paradosso - sono minuti QUANDO
            # GIOCA, e due portieri non giocano la stessa partita - ma sotto c'era un numero sbagliato:
            # la misura vera e' Meret **89,1'** e Milinkovic-Savic **90,0'**, il foglio diceva 80 a
            # tutt'e due. Senza la finestra del ritiro Meret legge 89,5; con lei, 79,8.
            #
            # E COLPISCE CHI GIOCA POCO, in proporzione a quanto poco: per un uomo che gioca ogni
            # giornata per-giornata e per-presenza coincidono e il ritiro e' neutro (come il commento
            # promette), per un portiere di rotazione il tasso per giornata e' la META' di quello per
            # presenza. Misurato sui 22 portieri del foglio Serie A con almeno tre presenze: **11 sotto
            # la misura e ZERO sopra**, mediana -2,2' e i peggiori sono i piu' saltuari (Pessina 35
            # contro 88 su 4 presenze, Motta 58 contro 90 su 9). Un difetto in un verso solo, e la firma
            # e' un denominatore che conta piu' del numeratore.
            #
            # Con il tasso per presenza la finestra del ritiro e' neutra sui DUE rapporti che contano,
            # per costruzione e non per taratura: presenze/giornate (le sue presenze sono le sue
            # giornate) e minuti/presenza (il tasso e' quello delle altre finestre).
            appearances = sum(one.appearances * weight for one, weight in windows)
            played = sum(one.minutes * weight for one, weight in windows)
            here = sum(one.minutes_here * weight for one, weight in windows)
            rate = played / appearances if appearances else 0.0
            share = here / played if played else 1.0
            friendly = replace(friendly, minutes=rate * friendly.appearances,
                               minutes_here=rate * friendly.appearances * share,
                               minutes_elsewhere=rate * friendly.appearances * (1.0 - share))
        windows.append((friendly, params.friendly_rounds / friendly.rounds))
    if not windows:
        return SeasonWindow()
    return SeasonWindow(
        appearances=sum(one.appearances * weight for one, weight in windows),
        starts=sum(one.starts * weight for one, weight in windows),
        minutes=sum(one.minutes * weight for one, weight in windows),
        minutes_here=sum(one.minutes_here * weight for one, weight in windows),
        minutes_elsewhere=sum(one.minutes_elsewhere * weight for one, weight in windows),
        rounds=sum(one.rounds * weight for one, weight in windows),
        # ...e le giornate saltate con GLI STESSI PESI del denominatore da cui verranno sottratte, che e'
        # tutto il punto: dieci giornate perse in una stagione riscalata a cinque non sono dieci giornate
        # di questa miscela. Sommarle grezze e' l'errore di unita' al contrario, e con `contested` che
        # tappa a 1.0 avrebbe fatto leggere 1.000 a chiunque si sia rotto per due mesi.
        missed=sum(one.missed * weight for one, weight in windows),
    )


def at_club_weight(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """How much of his measured season counts toward THIS club's shirt: 1.0 all of it, less if elsewhere.

    The share of his minutes played where he is now, with the rest weighed at `loan_discount` if this club
    had already had him - it sent him away, and that is its own judgement - or at the milder
    `arrival_discount` if he arrives from a club that is not this one, which has never judged him. A man
    who never moved is untouched, a man whose whole season was elsewhere is discounted once, and a January
    transfer lands in between - which is also the answer to "the discount should shrink as he accumulates
    matches here": it already does, one match at a time, with no second parameter.

    ...unless the club has just BOUGHT HIM BACK (`resigned`), and then the harsher discount is asserting
    something the club has just contradicted with money. It is a question about WHICH sentence describes
    him, not about how much was paid - the amount is a falsified signal here and is deliberately not read.

    Minutes rather than starts because they are the continuous measure: a substitute has a share too. No
    minutes on either side reads 1.0 - an unknown split must not penalise him.
    """
    total = inputs.minutes_here + inputs.minutes_elsewhere
    if not total:
        return 1.0
    if inputs.was_here_before and not inputs.resigned:
        discount = params.loan_discount
    elif inputs.cross_league:
        discount = params.arrival_discount_cross
    else:
        discount = params.arrival_discount
    weight = (inputs.minutes_here + discount * inputs.minutes_elsewhere) / total
    if params.investment_shape == "arrival":
        # The investment closes part of what the discount took away, and only that part: a man whose whole
        # season is already here is at 1.0 and cannot be lifted, which is right - his minutes have said it.
        weight = min(weight + investment_lift(inputs, params) * (1.0 - weight), 1.0)
    return max(weight, 0.0)


def absences_per_season(inputs: Inputs, params: Params = DEFAULTS) -> float | None:
    """His forecast absences for a season, in LEAGUE ROUNDS. None when there is no history at all.

    None is not zero, and the difference is deliberate: not knowing whether a man gets injured is not
    knowing, and a player with no id at the source must not be penalised for our gap.
    """
    if not inputs.known_injuries:
        return None
    counted = [(weight, rounds) for weight, rounds
               in zip(params.injury_weights, inputs.rounds_by_season, strict=False)
               if rounds is not None]
    # ...and the weights of the seasons he HAS. Zero is a real possibility and not a corner case: the
    # sweep's own grid contains (1.0, 0, 0), and for a man with no absence recorded last season but some
    # in the two before it every counted weight is 0. That is not "he misses nothing", it is "this
    # weighting has nothing to say about him" - so it falls through to the un-split history below, the
    # same «vuoto = ignoto» every other branch here follows. It used to divide by zero and kill the run:
    # a latent defect since the grid was written, surfaced on 08/08/2026 when the measured layer grew and
    # somebody finally had that exact profile.
    weight_total = sum(weight for weight, _rounds in counted)
    if counted and weight_total:
        # The average is over the seasons really measured, so a man with one missing season is not read as
        # having been healthy in it.
        return sum(weight * rounds for weight, rounds in counted) / weight_total
    if inputs.weighted_all is None:
        return None
    # Fallback: the source counted every competition, so its number is scaled onto the league calendar by
    # the share of the club's fixtures that are league rounds. Approximate, and only as good as the
    # fixtures we parsed - which is exactly why counting the rounds exists.
    share = inputs.league_matches / inputs.fixtures if inputs.fixtures else 1.0
    return inputs.weighted_all / (sum(DEFAULTS.injury_weights) or 1.0) * share


def return_penalty(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """Quanto toglie l'essere RIENTRATI DA POCO, in quota di stagione. Zero se il canale e' spento.

    Decade linearmente: pieno il giorno del rientro, nullo al bordo della finestra. Lineare e non a
    gradino perche' un gradino chiederebbe alla griglia di indovinare due cose (dove sta e quanto vale)
    con un solo parametro, ed e' quello che fa sembrare «senza effetto» un canale mal tagliato.
    """
    if not params.return_recency_weight or params.return_recency_days <= 0:
        return 0.0
    days = inputs.days_since_return
    if days is None or days < 0 or days >= params.return_recency_days:
        return 0.0
    return params.return_recency_weight * (1.0 - days / params.return_recency_days)


def availability(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """The share of a season a man like this one is fit for: 1.0 healthy, less for the injury-prone.

    Il rientro recente si toglie DOPO gli infortuni e prima del pavimento, cosi' il pavimento resta
    quello che dice di essere - «una storia brutta e' uno sconto, non un verdetto» - e vale per tutt'e
    due i motivi insieme invece che per uno solo.
    """
    missed = absences_per_season(inputs, params)
    recent = return_penalty(inputs, params)
    if missed is None:
        # Nessuna storia di infortuni: il rientro recente, se lo conosciamo, parla da solo.
        return max(1.0 - recent, params.availability_floor) if recent else 1.0
    share = 1.0 - missed / max(inputs.league_matches, 1.0) - recent
    return max(share, params.availability_floor)


def contested(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """The championship rounds he was in CONTENTION for: the calendar, less what he missed of it.

    The denominator of every start rate here. Which absences come off it is `params.contested_from`, and
    the two answers are not interchangeable - see the note on the field.
    """
    if params.contested_from == "measured" and inputs.rounds_measured is not None:
        missed = inputs.rounds_measured
    else:
        missed = absences_per_season(inputs, params) or 0.0
    # The calendar his measured season BELONGS TO, which is his club's for everybody who spent it in one
    # championship and the sum of two windows for the man who changed in January (`measured_rounds`).
    # Charging him the rounds of a championship he was playing in another country during is the same
    # defect as Kane's 49% off 25 starts in 34 rounds, one level down: there the numerator was league-only
    # and the denominator every competition, here the numerator is one championship and the denominator
    # two. It cost Malen 18/38 = 0.444 where he played 18 of 18.
    calendar = inputs.measured_rounds if inputs.measured_rounds else inputs.league_matches
    return max(calendar - missed, 1.0)


def window_only(inputs: Inputs, params: Params = DEFAULTS) -> bool:
    """True when his whole standing comes from a measured WINDOW: nothing on file here at all.

    One definition, because three places ask it - `standing` (which formula to use), `sample_rounds` (how
    much of a season is behind the answer) and the callers that bucket a population by that sample. Two
    copies would be two populations, which is how the shortest sample in the panel ended up the only one
    nobody shrank.
    """
    return bool(params.window_standing and inputs.window_matches
                and not inputs.starts and not inputs.appearances and not inputs.minutes)


def sample_rounds(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """How many rounds the standing is MEASURED over - what the shrinkage, and its prior, are about.

    `contested` for a man with a season here. For a man who has none, the WINDOW's own matches: ten
    matches somewhere else are his whole sample, and reading his new club's 38 rounds instead would say
    his standing rests on a season when it rests on ten games. The distinction is the entire point of
    `standing_prior_rounds` (gate §7-quaterdecies, adopted on euro strict AND robust), so the caller that
    picks a prior BAND has to ask this and not `contested`.
    """
    return inputs.window_matches if window_only(inputs, params) else contested(inputs, params)


def _shrunk(measured: float, inputs: Inputs, params: Params) -> float:
    """`measured` pulled toward the population's prior by how little of a season is behind it.

    «Twelve rounds and thirty-eight say the same thing with very different confidence, and the standing
    said them identically» - so this is applied to EVERY shape of standing, including the window one. It
    used to sit inline after the window branch had already returned, which exempted exactly the men the
    shrinkage was adopted for: Oulai, ten matches in Turkey and no season on file, read 0.609 and outranked
    a midfielder with 2563 measured minutes.
    """
    if not params.standing_prior_rounds or inputs.standing_prior is None:
        return measured
    rounds = sample_rounds(inputs, params)
    share = rounds / (rounds + params.standing_prior_rounds)
    return share * measured + (1.0 - share) * inputs.standing_prior


def standing(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """His absolute standing in the side - the blasone - as a share of a season, 0..1.

    Two measured facts about how much the coach used him, both over the rounds he was there for: his START
    RATE, and his SHARE OF THE MINUTES. Neither is a fantacalcio quantity - surplus and quotation answer
    "is he worth buying", and a coach does not pick a side by them.

    Both are weighed by WHOSE season it was (`at_club_weight`): a standing built somewhere else is
    evidence about this shirt too, and weaker evidence. A man with no minutes on file is judged on his
    starts alone: no minutes recorded is not zero minutes played.
    """
    rounds = contested(inputs, params)
    weight = at_club_weight(inputs, params)
    if window_only(inputs, params):
        # NOTHING measured here, and a window measured elsewhere: his share of the minutes he could have
        # played in it, discounted by whose football it was (`at_club_weight` - the arrival discount) and
        # by how much of a window it is (`window_standing`). Ten matches are not a season and the number
        # must not pretend otherwise; zero is not the alternative, it is the other error.
        share = min(inputs.window_minutes / (inputs.window_matches * 90.0), 1.0)
        # ...and the discount is taken EXPLICITLY, not through `at_club_weight`: that one splits his
        # minutes between here and elsewhere, and a man whose whole window is elsewhere has no minutes
        # here to split, so it reads 1.0 - «an unknown split must not penalise him», which is right for a
        # missing split and wrong for a known one. This window was played somewhere else by construction
        # (it is what `recent_form` fetches), so the arrival discount applies to all of it.
        discount = (params.loan_discount if inputs.was_here_before and not inputs.resigned
                    else params.arrival_discount)
        measured = min(max(params.window_standing * share * discount, 0.0), 1.0)
        # ...and SHRUNK like any other standing, on the window's own ten matches. This branch used to
        # return here, which made the shortest sample the panel ever reads the only one exempt from the
        # parameter adopted because short samples do not hold - and it decided elevens: a ten-match window
        # read 0.609 and displaced a 2563-minute starter.
        # ...and it takes the two LEVEL lifts, which it also used to escape. They are claims about an
        # ARRIVAL - at what level the football behind his minutes was played, and what step he takes by
        # moving - and this man is an arrival by construction: the window is football played somewhere
        # else. Refusing them here was reading «ten matches» as «no evidence about the level», which is
        # not the same sentence. The other three lifts stay out: investment, quality and career are about
        # a man whose SEASON has been seen, and this one has none.
        return min(max(_shrunk(measured, inputs, params) + level_lift(inputs, params)
                       + level_gap_lift(inputs, params), 0.0), 1.0)
    starts = min(inputs.starts * weight / rounds, 1.0)
    if not inputs.minutes:
        measured = starts
    else:
        by_starts, by_minutes = params.standing_weights
        measured = (by_starts * starts
                    + by_minutes * min(inputs.minutes * weight / (rounds * 90.0), 1.0))
    # The two lifts share the shape because they make the same KIND of claim - something the minutes did
    # not see should move the standing - and differ only in what they read: what the club paid, and what
    # the man showed.
    lift = (investment_lift(inputs, params) + quality_lift(inputs, params)
            + level_lift(inputs, params) + level_gap_lift(inputs, params)
            + career_lift(inputs, params) + age_lift(inputs, params))
    # ...and how much of a season is BEHIND that number. Twelve rounds and thirty-eight say the same thing
    # with very different confidence, and the standing said them identically.
    measured = _shrunk(measured, inputs, params)
    # ...and WHERE HE STANDS in the department he joins, blended in - the shape that was measured, and
    # not an additive lift like the three above. The difference matters: a lift moves everybody by the
    # same amount for the same evidence, while a blend lets the minutes keep most of the say and pulls
    # only toward the level of the men he will compete with. See `Params.level_rank_weight`.
    if params.level_rank_weight and inputs.level_rank is not None:
        measured = ((1.0 - params.level_rank_weight) * measured
                    + params.level_rank_weight * inputs.level_rank)

    if params.investment_shape == "standing":
        return min(max(measured + lift, 0.0), 1.0)
    if params.investment_shape == "unplayed":
        # ...and the CONDITIONAL form: what the minutes could not see, and only that. A man at 1.0 cannot be
        # lifted at all, which is the whole point - his minutes have already said he plays.
        return min(max(measured + lift * (1.0 - measured), 0.0), 1.0)
    # Any other shape ("arrival") applies the INVESTMENT lift of its own, elsewhere - so only the quality
    # term is added here, and adding `lift` would have double-counted the other one.
    return min(max(measured + quality_lift(inputs, params) + level_lift(inputs, params)
                   + level_gap_lift(inputs, params) + career_lift(inputs, params)
                   + age_lift(inputs, params), 0.0), 1.0)


def presence(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """The share of the club's MATCHDAYS he is expected to START in - the one number a shirt carries."""
    return min(standing(inputs, params) * availability(inputs, params), 1.0)


def appearance_share(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """The share of the rounds he is IN CONTENTION FOR in which he is expected to get a VOTO.

    The same question `voto_share` answers, asked WITHOUT the injury discount - «when he is fit, does the
    coach use him?». It is `voto_share`'s own first factor, split out because two callers need the two
    different questions and computing one from the other by division would be a second definition:

      * `voto_share` (this x `availability`) answers the AUCTION's question - how many matchdays will he
        give me - and an injury-prone man must be discounted there;
      * this one answers the COACH's, and is what the titolarita ladder is built on (`engine/status.py`),
        for the same reason `claim` is `standing` and not `presence`: the typical eleven is the side with
        everybody fit, so a state that has to agree with it cannot carry the injury discount. A man who
        played every match he was available for reads 1.0 here and is right to: what he missed is a fact
        about his body, and the app draws it as its own mark.

    Measured 20/08/2026 and left UNSHRUNK, which is not an oversight: shrinking it toward the sheet's mean
    by the same rule `standing` obeys was tried on four back-dated pre-season windows (prior rounds 3, 5,
    10, 20) and is worse on three of four - mean gap between what each rung promises and what it delivered
    0.076 unshrunk against 0.078 / 0.079 / 0.088 / 0.109. The reason is the conditional reading itself:
    the man a shrinkage would protect against is the one with a short sample because he was hurt, and the
    denominator here has already taken those rounds off.
    """
    rounds = contested(inputs, params)
    return min(inputs.appearances * at_club_weight(inputs, params) / rounds, 1.0)


def voto_share(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """The share of the season's matchdays he is expected to get a VOTO in - not to START in.

    The difference is what a fantacalcio squad is actually bought on: a substitute who comes on every week
    scores every week, and `presence` deliberately does not count him. So this reads APPEARANCES over the
    rounds he was there for, discounted by `availability` exactly as `presence` is.

    An appearance is taken as a voto, which is the honest limit of the layer: the season aggregate cannot
    tell a ten-minute cameo from a full match.
    """
    return min(appearance_share(inputs, params) * availability(inputs, params), 1.0)


# ---------------------------------------------------------------------------- la finestra CORTA
#: Da quanti minuti una partita e' «finita», per la sola forma `recent_evidence="full"`. 85 e non 90
#: perche' un cambio all'88' non e' una staffetta: e' la stessa lettura che `minutes.START_MINUTES` fa
#: dall'altro lato (una partenza dura 84,5' per un difensore e 78,5' per un attaccante).
FULL_MATCH_MINUTES = 85.0


@dataclass(frozen=True)
class RecentWindow:
    """Le ultime partite del club in cui era DISPONIBILE, con il suo denominatore accanto.

    Stessa disciplina di `SeasonWindow`: una finestra e' un pezzo di calcio col SUO denominatore, e
    tenerli insieme e' l'unica difesa contro l'errore che questo progetto paga da sempre - numeratore e
    denominatore contati su cose diverse.

    COS'E' `available`, che e' la meta' che conta: le partite del club in cui lui aveva una RIGA nel
    livello per-partita, panchina compresa. Una partita senza riga non e' uno zero, e' IGNOTO - fuori
    rosa, infortunato o squalificato, e nessuna delle tre e' una preferenza dell'allenatore per un
    altro. E' anche il modo in cui questa finestra osserva un'indisponibilita' senza unire tre tabelle:
    la distinta di una partita e' una lettura-di-rosa completa, quindi vale la regola del 05/08/2026
    («solo una lettura completa puo' esprimere un'ASSENZA») e la panchina batte uno stop datato, perche'
    un uomo stampato in distinta era disponibile e non e' stato scelto (14/08/2026).

    `available` = 0 e' una finestra VUOTA, non una finestra a zero: chi non ha giocato nessuna delle
    ultime partite del suo club perche' era fuori non ha una lettura corta, e le funzioni qui sotto
    restituiscono la lettura di stagione intatta. Quarta istanza in questo file di «una finestra vuota
    non e' una finestra a zero».
    """

    #: In quante delle ultime partite del club aveva una riga. Il denominatore.
    available: float = 0.0
    #: In quante e' partito titolare, e in quante ha preso il voto.
    starts: float = 0.0
    appearances: float = 0.0
    #: I minuti, ognuno TAPPATO a 90 prima di sommarli: 151 righe su 91.096 stanno sopra (i supplementari
    #: di una coppa), e sommare un 120 renderebbe una partita una prova e un terzo.
    minutes_capped: float = 0.0
    #: Quante di quelle partite ha finito (>= `FULL_MATCH_MINUTES`). Serve alla sola forma `full`.
    full_matches: float = 0.0


def recent_evidence(window: RecentWindow, params: Params = DEFAULTS) -> float | None:
    """Quanto dicono quelle partite, 0..1, o None se la finestra e' vuota.

    Tre forme, una adottata e due misurate e respinte: vedi `Params.recent_evidence`. La scelta vive qui
    e non nel chiamante perche' e' un parametro del MODELLO - la finestra porta i contatori grezzi, non
    un'opinione su quanto valga una partita, o `sweep` non potrebbe piu' rimisurare il rifiuto.
    """
    if window.available <= 0:
        return None
    shape = params.recent_evidence
    if shape == "appearances":
        return min(window.appearances / window.available, 1.0)
    if shape == "minutes":
        return min(window.minutes_capped / (window.available * 90.0), 1.0)
    if shape == "start":
        return min(window.starts / window.available, 1.0)
    if shape == "full":
        # La partita finita vale uno, la partenza sostituita mezzo, l'ingresso zero.
        return min((window.full_matches + 0.5 * max(window.starts - window.full_matches, 0.0))
                   / window.available, 1.0)
    raise ValueError(f"unknown recent_evidence shape: {shape!r}")


def blend_recent(short: float | None, season: float | None, available: float,
                 params: Params = DEFAULTS) -> float | None:
    """`k` partite osservate contro `recent_prior` di prior, che e' la forma di casa scritta una volta.

    La stessa aritmetica di `blend_seasons`, di `model.blend_with_seen` e della shrinkage per taglia del
    campione - qui sulle QUOTE invece che sui numeratori, perche' chi chiama ha gia' due quote in mano.

        quota = (k x corta + K x stagione) / (k + K)

    `k` e' tappata a `recent_window`: una finestra che portasse dieci partite peserebbe dieci volte il
    prior, e la misura dice che da 5 in su si peggiora. Con la finestra vuota restituisce la lettura di
    stagione INTATTA, che e' cio' che rende tutto questo inerte su una pre-stagione - e quindi su ogni
    finestra su cui il gate ha pubblicato un numero.
    """
    if short is None:
        return season
    if season is None:
        return short
    k = min(available, params.recent_window)
    if k <= 0:
        return season
    return (k * short + params.recent_prior * season) / (k + params.recent_prior)


def recent_share(window: RecentWindow, season: float | None,
                 params: Params = DEFAULTS) -> float | None:
    """La sua TITOLARITA' nell'ultimo periodo: quanto le ultime partite dicono che gioca, 0..1.

    Nel senso che questo progetto da' alla parola (CLAUDE.md): la quota delle partite in cui prende il
    VOTO, non quella in cui e' in distinta - e la prova per partita e' quella STESSA quantita', «ha preso
    il voto». Spedita il 10/09/2026 con i MINUTI per prova e corretta lo stesso giorno: quel parametro
    aveva vinto su un altro bersaglio ed era peggio del non avere finestra affatto qui (0.2073 contro
    0.1716 della sola stagione, 0.1614 con la prova giusta). Vedi `Params.recent_evidence`.

    E' il gemello corto di `appearance_share` e ne condivide il denominatore CONDIZIONALE: «delle partite
    per cui era disponibile, quante ne ha giocate». La ragione e' la stessa - la board e' l'undici con
    tutti disponibili, quindi uno stato che deve concordare con lei non puo' portare lo sconto degli
    infortuni - e qui e' anche l'unica lettura possibile, perche' una partita saltata non ha una riga da
    cui leggere niente.
    """
    return blend_recent(recent_evidence(window, params), season, window.available, params)


def recent_starting_share(window: RecentWindow, season: float | None,
                          params: Params = DEFAULTS) -> float | None:
    """La sua QUOTA DA TITOLARE nell'ultimo periodo: in quante e' partito dal principio.

    L'altra quantita', e le due non si scambiano - «titolarita'» e «quota da titolare» sono due cose in
    questo repository e la seconda ha il suo nome. Qui la prova e' per forza la PARTENZA e non i minuti:
    la domanda e' «comincia lui?», e i minuti risponderebbero a quella accanto.
    """
    short = None if window.available <= 0 else min(window.starts / window.available, 1.0)
    return blend_recent(short, season, window.available, params)


def recent_minutes(window: RecentWindow, season: float | None,
                   params: Params = DEFAULTS) -> float | None:
    """I minuti che gioca IN UNA PARTITA CHE GIOCA, nell'ultimo periodo.

    Il denominatore sono le sue PRESENZE e non le partite disponibili, che e' la stessa scelta che
    `minutes.per_appearance` fa e per la stessa ragione: per un portiere di rotazione i due rapporti
    stanno uno al doppio dell'altro, e quello che la scala legge come pavimento e' questo (07/09/2026,
    il caso Meret 89,1' contro 80).

    Il prior si mescola con lo STESSO peso delle altre due - le partite DISPONIBILI e non le presenze -
    perche' quella e' la taglia della finestra come prova: un uomo entrato una volta in tre partite non
    ha una lettura dei minuti che pesi tre.
    """
    short = None if window.appearances <= 0 else window.minutes_capped / window.appearances
    return blend_recent(short, season, window.available, params)
