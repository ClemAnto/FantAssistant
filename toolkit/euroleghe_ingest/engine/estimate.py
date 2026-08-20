"""The FALLBACK valuation: every player gets a number, and the number says how much it is worth.

Operator's rule, 05/08/2026: «Ogni calciatore DEVE avere il suo SURPLUS altrimenti è impossibile valutarli
oggettivamente. Se mancano dei valori per calcolare il SURPLUS, ricaviamoli/ricostruiamoli
approssimativamente (ma razionalmente) ... se non ci sono tutti i requisiti, penalizziamo il SURPLUS
(l'indeterminazione è comunque una nota negativa) ma dobbiamo comunque avere un valore di riferimento (un
attaccante titolare della Juve anche se sconosciuto è sempre meglio di un attaccante sconosciuto del
Verona)».

WHAT THIS IS NOT. It is not the engine and it is not gated: `engine_*` stays exactly what passed the
pre-registered gate, blanks included, and nothing here touches a published number. This is a THIRD class of
column, `est_*`, and the manifest says so - estimated, neither measured (`desc_*`) nor validated
(`engine_*`). The gate's own verdict on the closest thing to it is on the record and it is negative: R1
(«price a newcomer from his FM-equivalent abroad») was measured on six windows and does WORSE than the role
anchor on five of them. So the cascade below never prefers a foreign equivalent to an anchor - the ladder is
ordered by what the numbers say, not by what sounds like more information.

THE LADDER, and every rung carries the measurement that put it there (05/08/2026, on our own DB):
  * `core`            his own season here, >= MIN_PV_PREV votes. The engine's, untouched.        conf 1.00
  * `other_platform`  the SAME season on the other platform. euro and default measure the same football on
                      different calendars: over 870 player-seasons with >= 15 votes on both, the difference
                      of the two fantamedie has mean **+0.001**, sd 0.185, and |diff| <= 0.3 on **92%** -
                      per role within 0.03. So it stands in almost exactly, and it is not a prediction at
                      all, it is the same season seen from the other calendar.                   conf 0.95
  * `older`           his most recent season further back. Using an old fantamedia as the prediction gives
                      MAE 0.396 at t-2 and 0.434 at t-3 against 0.368 at t-1 (rho 0.712 / 0.649 / 0.741):
                      a season two years old is worth nearly as much as last year's - for the FANTAMEDIA.
                      His PRESENCES are a different question and were measured 19/08/2026, three years
                      late: an old pv is worth almost nothing on default and the population's own share
                      answers instead (`OLDER_SHARE`, `presences_from_older`).            conf 0.85 / 0.75
  * `shrunk`          a season here with 1..14 votes: his own mean is real but thin, so it is blended with
                      the club-adjusted anchor in proportion to the votes he HAS - which is exactly the
                      operator's «aggiungiamo i voti che mancano come la media del ruolo», written as
                      arithmetic.                                                     conf 0.50 + 0.50 x w
  * `anchor`          nothing at all: the role's anchor, moved toward his CLUB's own level for that role.
                      Measured on 25/26 Serie A: the spread between the best and the worst club's mean
                      fantamedia is 1.36 for forwards (Inter 7.38, Pisa 6.02), 1.10 for midfielders, 0.75
                      for defenders and 0.25 for keepers - which is the operator's Juve-vs-Verona point,
                      quantified, and it is why the adjustment is per ROLE and not a single number.
                                                                                                 conf 0.50

THE PENALTY multiplies the SURPLUS and nothing else. Indeterminacy is a fact about the number, not about the
player's fantamedia: his level is our best guess either way, while what an auction ranks - points over the
bench - is what should be discounted for not knowing. And it is a DECLARED product choice, not a fitted
coefficient: the ladder is ordered by the measured errors above, the exact rungs are ours, and the sheet
carries them per row so nobody has to trust this docstring.
"""

from __future__ import annotations

from dataclasses import dataclass

# The ONE surplus arithmetic. `model` is pure formulas with no DB and no I/O, so importing it keeps this
# file as portable as it was and removes the third copy of a subtraction that had already drifted once.
from euroleghe_ingest.engine import model

# How many votes the core needs before it will predict at all - `model.MIN_PV_PREV`, restated here because
# this module must stay importable on its own (the gate's harness reaches both).
FULL_SEASON_VOTES: int = 15

# The confidence of each rung. Ordered by the measured errors in the docstring; the values themselves are a
# product choice and are stated on every row that uses them.
CONFIDENCE: dict[str, float] = {
    "core": 1.00,
    "other_platform": 0.95,
    "older": 0.85,             # t-2; one more season back takes OLDER_DECAY off it
    "shrunk_floor": 0.50,      # a shrunk estimate with one vote is barely more than the anchor...
    "shrunk_span": 0.50,       # ...and with 14 it is nearly the core
    "anchor": 0.50,
}
OLDER_DECAY: float = 0.10      # per season beyond t-2, floored at the anchor's own confidence

# HOW MANY MATCHES a man the engine cannot price actually plays, as a share of the platform's calendar -
# MEASURED over three windows on our own seasons, not chosen. It matters because the first version invented
# "half a calendar" for a man with nothing measured, and that made an UNKNOWN keeper (est 9.3) worth more
# than his club's third keeper who had played once (4.4), which is the opposite of what the sheet should say.
#   nothing measured before  ->  median share 0.289 default (n=719) · 0.194 euro (n=1174)
#   a thin season (1-14)     ->  median share 0.421 default (n=244) · 0.290 euro (n=696)
# The thin man plays MORE, and the ordering now comes from the data instead of from a round number.
PRESENCE_SHARE: dict[str, dict[str, float]] = {
    "unmeasured": {"default": 0.29, "euro": 0.19},
    "thin": {"default": 0.42, "euro": 0.29},
}

# ...E LA STESSA COSTANTE, MISURATA PER RUOLO, perche' a ruoli mescolati era tre volte troppo alta per i
# portieri. Trovata il 19/08/2026 dalla domanda dell'operatore («un terzo portiere dovrebbe avere pv=0,
# perche' risulta 15?»), cercando prima nel posto sbagliato: il foglio prevede 56 presenze da portiere per
# club contro le 38 che un club distribuisce davvero (una a partita, le sostituzioni sono rarissime), e la
# cura sembrava un vincolo di bilancio. Misurato, il bilancio SUGLI ALTRI RUOLI e' gia' giusto - D +7%,
# C +4%, A -0% contro P +47% - quindi non c'era niente da normalizzare: c'era una costante applicata fuori
# dalla popolazione su cui era stata misurata.
#
#   unmeasured, media della quota realizzata      P       D       C       A     (in vigore per tutti)
#   default (n 178/298/296/211)                 0.098   0.308   0.332   0.282        0.29
#   euro    (n 186/234/269/177)                 0.076   0.229   0.223   0.293        0.19
#
# IL CONTROLLO CHE LA RENDE ADOTTABILE e' che l'aggregato non si muove: pesando i quattro ruoli sulla loro
# numerosita' si ottiene 0.272 su default e 0.207 su euro, cioe' lo 0.29 e lo 0.19 che erano in vigore.
# Non si sta cambiando la misura, la si sta DIVIDENDO - e il pezzo che era sbagliato e' uno solo.
# Per il portiere la mediana e' letteralmente ZERO e il 77% di loro non gioca: la costante pooled gli dava
# 11 giornate su 38, e nessuna curva della scala poteva rimediare a un ingresso sbagliato di tre volte.
#
# DUE COSE RIFIUTATE PRIMA DI QUESTA, e stanno scritte perche' nessuno le riprovi. Il vincolo di bilancio
# per club «a cascata» (il primo portiere tiene la sua previsione, gli altri si dividono il resto) pareva
# il piu' sensato e su una finestra di sei fa **-17.9%**: quando tutta la porta di un club sta sulla
# costante le previsioni sono indistinguibili, il «primo» esce a sorte e l'avanzo finisce addosso al
# secondo - Sherri da 11 a 27 giornate previste contro 7 realizzate, Meret da 25 a 6 contro 34. E il
# vincolo IN PROPORZIONE, che non inventa avanzi, passa su euro (+9.0%, 4 finestre su 4) e non su default
# (-4.7% sulla peggiore): resta una voce da rimisurare DOPO questa correzione, non prima, perche' meta'
# dell'eccesso che doveva curare era la costante.
PRESENCE_SHARE_BY_ROLE: dict[str, dict[str, dict[str, float]]] = {
    "unmeasured": {
        "default": {"P": 0.098, "D": 0.308, "C": 0.332, "A": 0.282},
        "euro": {"P": 0.076, "D": 0.229, "C": 0.223, "A": 0.293},
    },
}

# ...and the man who HAS a measured season, only not on THIS platform - the new signing from abroad.
# Pricing him at the share above says «nobody has ever seen him play», which is false and expensive:
# measured over the men with no season here at t-1 and league minutes abroad at t-1 who then played here
# (323 on default, 929 on euro), their real share is a median **0.447 / 0.290** against the 0.29 / 0.19 the
# unmeasured constant gives them - six matchdays of 38 handed back. And their OWN minutes carry more than
# the band does:
#     share = a + b x (his league minutes / (90 x that league's rounds))
# fitted on `external_stats` league rows over `features.league_rounds`, i.e. the two denominators the
# measurement itself used - a cup is not a matchday of the championship he played. Judged
# LEAVE-ONE-SEASON-OUT, so the coefficients never see the season they are scored on: MAE **0.2300 against
# 0.2803** for the constant on default (**+17.9%**) and **0.2831 against 0.2983** on euro (**+5.1%**). The
# band median alone is worth less than the line on default (0.2455) and is WORSE than the constant on euro
# (0.3256), which is why what ships is the line and not a second constant.
# REPORTING, like the whole of this module: `engine_*` does not move a decimal, the gate never sees it.
ABROAD_SHARE: dict[str, tuple[float, float]] = {
    "default": (0.339, 0.320),
    "euro": (0.183, 0.357),
}
# His share of a foreign calendar cannot exceed it, and the line's intercept keeps it off zero - so the
# clip is about the INPUT being outside the range it was fitted on, not about tidying the output.
ABROAD_MAX_SHARE: float = 1.0


# ...and the man whose only measured season is OLD - the `older` rung, MEASURED 19/08/2026 because it never
# had been. The rung has always REGRESSED his fantamedia toward the anchor (`OLDER_BETA`, and the comment
# there says why: an old number used raw is the naive baseline the core beats) and handed over his old
# PRESENCES untouched - not even converted between the two calendars. It is the same defect that comment
# describes, on the other half of the pair, and it surfaced where a raw presence hurts most: the app's
# Overall is `presenze x (voto + bonus)`, so Arthur Melo - 32 votes at Fiorentina in 2023-24, nothing since
# - read 32 of 38 and came out FOURTH of the whole Serie A listone with an unremarkable 6.34 of fantamedia.
#
# THE POPULATION IS THE MEN WHOSE OLD PV ACTUALLY SHIPS, and that is not everybody the rung prices: nothing
# measured at t-1 on either platform AND no league minutes abroad at t-1, because `presences_from_abroad`
# answers first for those. Scored on the share of the target calendar he really got, LEAVE-ONE-SEASON-OUT
# (the anchor never sees the season it is scored on), with a man quoted and never rated counting as the ZERO
# he was - the sheet predicts for everybody quoted, so scoring only the survivors would grade a different
# question:
#
#                                     default (n=221, 8 seasons)   euro (n=48, 3 seasons)
#   his old pv, raw (what shipped)           MAE 0.3749                 MAE 0.3510
#   ...just converted between calendars           0.3756                     0.3064   (+12.7%)
#   the population's own share alone              0.2704                     0.3482
#   anchor + b(his share - anchor)                0.2689 (+28.3%)            0.2993 (+14.7%)
#
# WHAT THE TWO PLATFORMS SAY IS NOT THE SAME THING, and the mechanism is why. On default the median old
# share is 0.632 and the median outcome 0.289, so his old season carries almost nothing: b* is 0.10, INSIDE
# the grid, positive on 8 seasons of 8 (+13.9% to +36.7%) and picked by the cross-fit on 6 folds of 8. And
# the anchor it lands on, 0.29, is to the decimal the `unmeasured` constant above: a man quoted in Serie A
# who did not play last season anywhere is, FOR PRESENCES, a man nobody has ever measured. On euro he is
# not (0.61 against that platform's 0.19), because there «nothing measured at t-1» usually means «played in
# a championship we do not cover» rather than «did not play» - the five leagues are the perimeter, not the
# world.
# THE EURO VALUE IS FRAGILE AND IS ADOPTED SAYING SO: 3 seasons and 48 rows, whose own optima are 0.90 /
# 0.00 / 0.55 - the direction is identified (every point of the grid beats the raw pv, +3.7% to +16.1%) and
# the value is not. 0.55 is the minimum of the leave-one-out curve on the other convention (score only the
# men who played: +20.3%) and sits in the flat basin of this one. It comes out without argument the first
# time another season says otherwise.
OLDER_SHARE: dict[str, float] = {"default": 0.29, "euro": 0.61}
OLDER_PV_BETA: dict[str, float] = {"default": 0.10, "euro": 0.55}


def presences_from_older(calendar: int | None, platform: str, pv_old: float | None,
                         calendar_old: int | None) -> float | None:
    """The presences of a man whose most recent measured season is two or more years back.

    His own share of THAT calendar, pulled toward the share his population really gets - the same shape
    `regress` gives the fantamedia below, and for the same reason. The two calendars are part of the
    arithmetic: 32 votes are 84% of a Serie A season and 100% of a euro one, and handing the number
    across without converting it was worth 12.7% of error on its own.
    """
    anchor, beta = OLDER_SHARE.get(platform), OLDER_PV_BETA.get(platform)
    if not calendar or anchor is None or beta is None:
        return None
    if not pv_old or not calendar_old:
        # «Vuoto = ignoto»: with no readable old season the population's own share answers, which is what
        # this rung's neighbours already do - never his pv on somebody else's calendar.
        return round(calendar * anchor, 1)
    his = min(1.0, pv_old / calendar_old)
    return round(calendar * min(1.0, max(0.0, anchor + beta * (his - anchor))), 1)


def default_presences(calendar: int | None, platform: str, kind: str = "unmeasured",
                      role: str | None = None) -> float | None:
    """The presences of a man whose appearances nobody can predict, from the measured shares above.

    `role` picks the per-ROLE share where one is measured, and the pooled one answers otherwise: without
    it a third keeper reads 11 appearances of 38 where his population's median is ZERO. Optional on
    purpose - a caller that does not know the role gets the aggregate, which is what shipped before and
    is still true about the population as a whole.
    """
    if not calendar:
        return None
    share = (PRESENCE_SHARE_BY_ROLE.get(kind, {}).get(platform, {}).get(role or "")
             or PRESENCE_SHARE.get(kind, {}).get(platform))
    return None if share is None else round(calendar * share, 1)


def presences_from_abroad(calendar: int | None, platform: str,
                          minutes_share: float | None) -> float | None:
    """The presences of a man measured ELSEWHERE last season, from how much of it he actually played.

    None when there is nothing to read - no calendar, no measured minutes, or a platform without a fitted
    line - and then the caller falls back to the unmeasured constant. A None here is «we have not watched
    him», which is a different sentence from «he played a third of a season», and only one of them is true
    for a €74M signing with 1320 minutes in Ligue 1.
    """
    line = ABROAD_SHARE.get(platform)
    if not calendar or line is None or minutes_share is None or minutes_share <= 0:
        return None
    intercept, slope = line
    share = min(max(intercept + slope * minutes_share, 0.0), ABROAD_MAX_SHARE)
    return round(calendar * share, 1)


# ...E QUANTO IL CLUB HA INVESTITO SU DI LUI RISPETTO A CHI GLI CONTENDE LA MAGLIA - misurato il
# 19/08/2026, dalla domanda dell'operatore: «Ramos ha giocato 30 partite su 34 con 44 minuti a presenza,
# 13 da titolare: al Milan sara' titolare, 18 su 38 e' troppo poco. Come possiamo migliorarlo con
# parametri oggettivi?»
#
# TRE COSE CHE NON HANNO FUNZIONATO, scritte perche' nessuno le riprovi: le PRESENZE all'estero al posto
# dei minuti (-0.7% su default, -6.9% su euro, 1/6 e 0/6 finestre - il modello del pannello lo fa gia' e
# prevede 0.73 per il profilo di Ramos contro lo 0.47 realizzato); il PASSO DI LIVELLO Elo (-3.1% / +1.1%,
# correlazioni parziali +0.08 / +0.18); e il reparto definito dal MACRO-ruolo, che mette insieme ali e
# centravanti e legge Leao come rivale pieno di Ramos (-0.6% su default, peggiore finestra -7.3%).
#
# QUELLO CHE FUNZIONA E' IL CONFRONTO COI RIVALI PER QUELLA MAGLIA, e i rivali si pesano invece di
# contarli. Con `tm_appearances.position_id` - la posizione partita per partita di Transfermarkt, l'unico
# posto del progetto dove esiste una posizione granulare STORICA - la domanda «e' un rivale?» diventa una
# quota: Leao ha giocato da centravanti nel 27% delle sue partite e da esterno nel 60%, quindi contende a
# Ramos un quarto di maglia, non una. Due termini, e il secondo e' il canale che il gate aveva respinto:
#
#   top       il suo valore diviso il migliore dei rivali PESATO dalla rivalita' (tappato a 3)
#   absolute  il suo valore di mercato in percentile di listone
#
# `absolute` non e' una ri-litigazione di §7-quinquies/§7-untricies: li' era misurato su TUTTO il listone
# dentro `presence.standing` e valeva +0.26%, qui e' misurato sulla popolazione per cui esiste - i soli
# uomini che il core non prezza - e vale quattro volte tanto. Il progetto lo aveva gia' scritto: «l'arm
# che passa e' cieco sugli uomini per cui esiste».
#
# CROSS-FIT leave-one-window-out, popolazione ripulita dai sei club stranieri archiviati come `serie_a`:
#
#                                    default (259, 6 finestre)   euro (560, 4 finestre)
#   reparto per codice mantra            +4.86%, 6/6                +4.00%, 3/4
#   reparto per POSIZIONI pesate         +4.74%, 5/6 (peggio -0.55%)  +5.56%, 4/4
#
# SI SPEDISCONO LE POSIZIONI su tutt'e due, ed e' una scelta con un prezzo dichiarato: su default costa
# 0.12 punti contro il mantra ed e' l'unica delle due con una finestra negativa, dentro il rumore di un
# cross-fit a sei pieghe; su euro rende 1.56 punti. In cambio c'e' UNA definizione invece di due, e liste
# di rivali che al tavolo si possono contestare a occhio (Ramos: Gimenez 100% x18M, Nkunku 68% x25M, e
# Leao fuori). Chi Transfermarkt non ha mai visto ripiega sul codice mantra - 2 righe su 259 e 8 su 560 -
# e la riga dichiara quale reparto ha risposto.
INVESTMENT_SHARE: dict[str, tuple[float, float, float, float]] = {
    #          intercetta   quota all'estero   top sul reparto   percentile di valore
    "default": (-0.001,       0.463,             0.049,            0.311),
    "euro":    (-0.055,       0.687,             0.073,            0.300),
}
# Oltre il triplo del migliore del reparto la differenza non dice piu' niente: un tappo, non una taratura.
INVESTMENT_TOP_CAP: float = 3.0


def presences_from_investment(calendar: int | None, platform: str, abroad_share: float | None,
                              top: float | None, value_percentile: float | None) -> float | None:
    """Le presenze di un nuovo arrivo, corrette da quanto il club ha investito su di lui.

    `abroad_share` e' l'USCITA di `presences_from_abroad` come quota del calendario, non i minuti grezzi:
    i due strati restano componibili e il rapporto fra la retta vecchia e questa resta leggibile.

    None quando manca un ingrediente, e allora il chiamante tiene `presences_from_abroad`: e' un
    RAFFINAMENTO di quella retta, non un suo sostituto, e senza i due termini nuovi non ha niente da
    aggiungere. Mai uno zero - «vuoto = ignoto».
    """
    coeffs = INVESTMENT_SHARE.get(platform)
    if (not calendar or coeffs is None or abroad_share is None
            or top is None or value_percentile is None):
        return None
    intercept, on_abroad, on_top, on_value = coeffs
    share = intercept + on_abroad * abroad_share + on_top * top + on_value * value_percentile
    return round(calendar * min(max(share, 0.0), ABROAD_MAX_SHARE), 1)


# ...E QUANTO IL CLUB HA PAGATO PER AVERLO, in rapporto a quello che ha speso in tutto - misurato il
# 20/08/2026, dalla domanda dell'operatore su Kolo Muani: «l'anno scorso ha giocato circa 30 partite col
# Tottenham e mi aspetto almeno 28: perche' le partite attese sono solo 20?». Il canale sopra leggeva il
# suo VALORE DI MERCATO al 03/06/2026, cioe' un prezzo che PRECEDE il trasferimento (quella curva si
# aggiorna a trimestri), e lo confrontava coi 30M di David: `top` = 0,83, il secondo centravanti della
# Juve. La fee - 41,2M in `transfers_history` - era in casa e nessuno la leggeva; il progetto l'aveva
# gia' nominata («the signal that would see them is the FEE») e mai misurata.
#
# LA FEE GREZZA NON FUNZIONA, e sono quattro bracci PRE-REGISTRATI tutti respinti: la fee al posto del
# valore dentro `top` (-1,08% default, -0,50% euro), piu' il percentile della fee (-9,76% / -0,68%), e il
# rapporto fee/valore (-0,45% / -0,84%), tutti 1-2 finestre su 3. Le parziali sono positive (+0,235 il
# rapporto su default) e le correlazioni GREZZE negative (-0,058, -0,122), cioe' quel poco che c'e' e'
# tutto «a parita' di quello che si legge gia'» - la stessa forma che questo progetto ha respinto per il
# passo di livello Elo a +0,08/+0,18.
#
# QUELLO CHE FUNZIONA E' LA FEE IN RAPPORTO A QUELLO CHE IL CLUB HA SPESO IN TUTTO, che e' anche la sola
# forma il progetto avesse scritto prima di oggi («the FEE, 54% and 27% of what their clubs spent»). E'
# POST-HOC e si dichiara: i quattro bracci sopra sono caduti prima, quindi questo braccio e' stato
# guardato dopo aver visto una curva - il criterio NON e' stato allargato (pavimento 0,5%, robusto/strict,
# cross-fit leave-one-window-out, tutto invariato), ma l'evidenza vale meno di una pre-registrata.
#
# CROSS-FIT leave-one-window-out su T0/T1/T2 - TRE finestre, perche' `transfers_history` comincia nel 2023:
#
#                                          default (57 righe)      euro (148 righe)
#   quota di spesa, sulle righe con fee       +4,08%, 3/3            +4,30%, 3/3   STRICT
#   ...con la SPESA DEL CLUB nel modello      +3,41%, 3/3            +2,71%, 3/3
#   la sola spesa del club                    -1,65%, 1/3            -0,02%, 2/3   (non e' lei)
#   su TUTTA la popolazione                   +1,18%                 +1,16%
#
# DUE CONTROLLI CHE DECIDONO, e il primo e' la trappola di sempre: il denominatore e' la spesa del club,
# quindi una quota alta potrebbe voler dire «il club ha speso poco» invece di «hanno speso su di lui» -
# «a difference between two groups is not a virtue of whoever carries it», quarta volta. Messa la spesa
# del club nel modello come termine suo, la quota SOPRAVVIVE su tutt'e due (riga 2) e la spesa da sola non
# porta niente (riga 3): parla dell'uomo. Il secondo e' che quel denominatore e' la somma delle fee che la
# FONTE ha pubblicato, non quello che il club ha speso: tenendo solo i club con almeno 5 fee pubblicate
# euro resta strict a ogni soglia della griglia (0/3/5/8: +4,3% · +6,4% · +5,0% · +6,3%, sempre 3/3) e
# **default crolla** (+4,08% -> -0,50%, peggiore finestra -6,66%) togliendo TRE righe su 57.
#
# QUINDI SI ADOTTA SU EURO E NON SU DEFAULT, ed e' la stessa asimmetria di R19: su default la direzione e'
# identica (k = +0,40 contro +0,21) e il VALORE non e' identificato su 57 righe, dove tre righe ribaltano
# il verdetto. Da rimisurare quando arriva una quarta finestra, e allora esce senza discutere se peggiora.
#
# IL TERMINE E' ADDITIVO SOPRA LA RETTA CONGELATA e non un rifit congiunto, che e' la differenza fra
# +1,16% e +0,35% sulla popolazione intera: rifittare tutti i coefficienti con un termine in piu' muove
# anche chi la fee non l'ha, e su euro T0 costava -0,86% a gente che non c'entra. Cosi' invece chi non ha
# una fee resta identico per costruzione, ed e' come il modulo dice gia' di comporre («un RAFFINAMENTO di
# quella retta, non un suo sostituto»).
#
# NESSUNA SOGLIA sulle fee pubblicate, e la ragione e' misurata e non comoda: la prima versione di questo
# conto guardava il solo anno d'asta e leggeva quote di 1,00 (Geubbels, 4,6M sui 5M «spesi» dal Lecce,
# +30 giornate su 38) - un artefatto della MIA finestra, non della fonte. Con la finestra che la misura
# usa davvero (da gennaio della stagione di input alla data d'asta, cioe' come una rosa si costruisce) sul
# foglio 2026-27 le righe a quota 1,00 sono **ZERO** su 410, e la soglia toccherebbe 8 righe su 410.
# Metterla per prudenza avrebbe voluto dire scegliere un punto di griglia guardando i guadagni.
#
# QUANTO PESA DAVVERO, perche' un canale va dichiarato anche quando delude: sul foglio 2026-27 la mediana
# e' **+0,6 giornate** su 31 e il massimo +3,9. Kolo Muani ha una quota di 0,142 (41,2M sui 290,7M che la
# Juventus ha speso in due mercati) e ne guadagna **+1,0**, non le otto che mancano ai suoi 28 - e su euro
# non lo tocca affatto, perche' li' il core lo prezza. «A channel that passes need not rescue the case
# that suggested it», come il passo di livello con Ramos.
INVESTMENT_FEE_WEIGHT: dict[str, float] = {"default": 0.0, "euro": 0.21}


def presences_from_fee(calendar: int | None, platform: str, share: float | None,
                       fee_share: float | None) -> float | None:
    """Le presenze corrette da quanto il club ha pagato per lui sul totale che ha speso.

    `share` e' l'USCITA del gradino precedente come quota del calendario - `presences_from_investment` se
    ha risposto, `presences_from_abroad` altrimenti - e `fee_share` la sua quota della spesa del club.
    Additivo, per la ragione scritta sopra: senza fee non ha niente da aggiungere e il chiamante tiene il
    numero che aveva, identico.

    None quando manca un ingrediente o quando la piattaforma pesa zero (default): «vuoto = ignoto», e un
    peso di zero e' una MISURA - la riga 3 della tabella sopra - non un canale spento per prudenza.
    """
    weight = INVESTMENT_FEE_WEIGHT.get(platform)
    if not calendar or not weight or share is None or fee_share is None:
        return None
    moved = share + weight * min(max(fee_share, 0.0), 1.0)
    return round(calendar * min(max(moved, 0.0), ABROAD_MAX_SHARE), 1)


def rivalry(mine: dict[int, float], his: dict[int, float]) -> float:
    """Quanto due uomini si contendono la stessa maglia: l'intersezione dei due profili di posizione.

    Un profilo e' la distribuzione delle posizioni in cui ha giocato sulle ULTIME DUE STAGIONI (scelta
    dell'operatore, 19/08/2026, dichiarata e non misurata). `sum_p min(pA, pB)` vale 1 per due uomini che
    hanno sempre giocato nello stesso posto e 0 per due che non si sono mai incrociati; Ramos (68% ST)
    contro Leao (27% ST, 60% LW) da' 0.27.
    """
    return sum(min(share, his.get(position, 0.0)) for position, share in mine.items())


def weighted_top(value: float | None, rivals: list[tuple[float, float]],
                 cap: float = INVESTMENT_TOP_CAP) -> float | None:
    """Il suo valore diviso il migliore dei rivali PESATO dalla rivalita'. `rivals` = [(peso, valore)].

    Un rivale al 27% conta il 27% del suo valore, che e' come Leao esce dal reparto di Ramos senza doverlo
    dichiarare a mano. Senza rivali leggibili torna il tappo: un uomo solo nel suo ruolo e' il massimo di
    quello che questa grandezza sa dire, non un ignoto.
    """
    if value is None:
        return None
    best = max((weight * worth for weight, worth in rivals), default=0.0)
    if best <= 0:
        return cap
    return min(cap, value / best)


# How many measured players of a role a club needs before its own level is trusted over the role anchor.
# Three, because a club fields 3-4 defenders and 2-3 forwards a week: with one man the "club level" is one
# man's season wearing a club's name.
CLUB_PRIOR: float = 3.0


@dataclass(frozen=True)
class Estimate:
    """One player's fallback valuation, with the reason it exists attached to it."""

    fm: float | None
    pv: float | None
    basis: str
    confidence: float
    note: str
    # The base vote behind that fantamedia. It is DERIVED from `fm` and never estimated on its own - see
    # `mv_predict` - and the BONUS RATE is what falls out of the pair: `fm - mv` is the bonus per
    # appearance the row expects of him, which is a number a reader can disagree with. Until 19/08/2026 the
    # derived half was this one instead, and it was the wrong half (see `MV_BETA`).
    mv: float | None = None

    @property
    def estimated(self) -> bool:
        return self.basis != "core"


def club_anchor(role_anchor: float, club_mean: float | None, club_measured: int) -> float:
    """The role's anchor moved toward the CLUB's own level for that role, by how much of it we measured.

    «Un attaccante titolare della Juve anche se sconosciuto è sempre meglio di un attaccante sconosciuto del
    Verona» - and the size of that difference is measured, not assumed: 1.36 of fantamedia between the best
    and the worst Serie A club's forwards in 25/26, 0.25 between their keepers. Nothing here decides how big
    it is; it comes out of the club's own mean, so a league where clubs are alike moves the anchor less.
    """
    if club_mean is None or club_measured <= 0:
        return role_anchor
    weight = club_measured / (club_measured + CLUB_PRIOR)
    return role_anchor + (club_mean - role_anchor) * weight


def shrink(fm: float, votes: int, anchor: float, full: int = FULL_SEASON_VOTES) -> tuple[float, float]:
    """(fantamedia, confidence) for a season measured with too few votes to be a season.

    The operator's own remedy, as arithmetic: pad the votes he is missing with the anchor. Padding `full -
    votes` matches at the anchor and keeping his own `votes` at his own mean IS the weighted mean below, so
    the two descriptions are the same number - which is why this is a blend and not a taste.
    """
    weight = max(0.0, min(1.0, votes / full))
    value = weight * fm + (1.0 - weight) * anchor
    confidence = CONFIDENCE["shrunk_floor"] + CONFIDENCE["shrunk_span"] * weight
    return value, confidence


# THE BASE VOTE, and which half of the pair is DERIVED. `FM = MV + (bonuses - maluses) / Pv`, so one of the
# two is predicted and the other one falls out; the pair can never contradict itself either way. Until
# 19/08/2026 the derived half was the MV (`FM_pred - his own raw bonus rate`) and that was the wrong choice,
# found by the operator on a striker: «come e' possibile che Malen ha solo 5.67 come MVa?». It is the same
# defect the `_rung_for` comment already warns about for every OTHER rung - «deriving it there too would
# dump the whole regression toward the anchor onto the base vote» - committed by the one rung that derived.
#
# The role's bonus per appearance, still the anchor of the RATE. Measured 15/08/2026, 3750 Serie A
# player-seasons with >= 15 votes:
#
#     role   n     mean    sd     p10     p90
#     P     247   -1.293  0.388  -1.77   -0.82      (the goals-conceded malus, and it is huge)
#     D    1348   +0.045  0.178  -0.14   +0.28
#     C    1395   +0.239  0.301  -0.08   +0.64
#     A     760   +0.735  0.519  +0.17   +1.43
#
# WHY THE OLD SHAPE WAS WRONG, measured 19/08/2026 on 2092 Serie A and 1708 euro season pairs with >= 15
# votes in both (`rate = anchor + b(his - anchor)`, MAE against next season's rate):
#
#     b       0.00     0.45      1.00
#     MAE    0.2449   0.2163    0.2470      <- b = 1 is the WORST point of the grid
#
# Taking a man's own rate whole loses to IGNORING IT ENTIRELY. And the justification written here for taking
# it whole - «r = +0.842, far above anything else this project carries season to season» - reproduces to the
# decimal and is a POOLED correlation: within the role it is **+0.488** (P +0.51 D +0.40 C +0.51 A +0.49),
# and nearly all of the rest is the separation between a keeper at -1.29 and a forward at +0.74. Same lesson
# the age channel taught: a difference between two GROUPS is not a virtue of whoever carries it.
#
# WHY THE MV IS THE HALF TO PREDICT. The operator's football reason came first - «un attaccante con una FMa
# alta e' impossibile che abbia una MVa cosi' bassa: chi segna ha sempre o quasi un voto buono» - and it is
# true and large: within the role, `r(MV, bonus rate)` is **+0.787** for Serie A forwards (+0.79 on euro,
# C +0.63, D +0.50, P +0.28). Subtracting the rate from a fixed FM imposes a slope of -1 on a relation the
# data puts at +0.39, which is why the column collapsed for exactly the men who make the most bonus.
# The arithmetic reason is that the two are the SAME transform: with the same b on both halves,
# `FM_pred - (role_rate + b(rate - role_rate))` IS `anchor_mv + b(MV - anchor_mv)`, so nothing is lost by
# predicting the MV instead - the only difference is which half absorbs the regression toward the anchor.
# And the number this file needed was already in this file: the block replaced here recorded «anchor +
# b(his - anchor) 0.148 at b = 0.45» and then refused it for fear of a second number free to contradict the
# first. Deriving the RATE instead removes that fear entirely - there is still one number and one
# derivation, and `fm - mv` is still the bonus rate the row expects.
#
# HOW MUCH OF HIS OWN BASE VOTE SURVIVES. Leave-one-season-out on the pairs above, and the cross-fit is
# UNANIMOUS: 0.45 on all ten Serie A folds, 0.40 on all five euro folds (MAE 0.1478 / 0.1491 against 0.1656
# / 0.1618 for the role anchor alone). Corroboration nobody fitted for this: the GATED engine already
# predicts a keeper's base vote as `GK_MV_ANCHOR + GK_MV_BETA x (mv_prev - anchor)` with
# `model.GK_MV_BETA = 0.40` - the same shape and the same value, arrived at from the other side.
MV_BETA: dict[str, float] = {"default": 0.45, "euro": 0.40}

# ...and whether his own RATE adds anything once his own base vote is read. It does not: a joint grid over
# (b, d) in `MV = anchor + b(his MV - anchor) + d(his rate - role rate)` picks **d = 0 on ten folds of ten**
# on default, and on euro d = 0.05-0.10 worth 0.0013 of MAE - under any floor this project uses. The
# population relation is real and it is ALREADY INSIDE his own MV; counting it again is the age channel's
# mistake, and stating the zero is the point - it is a measurement and not an omission.
MV_OWN_RATE_WEIGHT: float = 0.0

# WHERE HE HAS NO MEASURED BASE VOTE AT ALL - 166 `core` rows of 998 on the euro sheet, 11 of 295 on Serie
# A, plus every `anchor` rung - the operator's sentence is the only thing left to read it off, so it is read
# off the FANTAMEDIA the row already carries. Self-consistently, since the rate is `FM - MV`:
#
#     MV = anchor_mv + g x (FM - MV - role_rate)   ->   MV = (anchor_mv + g x (FM - role_rate)) / (1 + g)
#
# Cross-fit on the same pairs: **g = 0.55 on both platforms**, folds 0.50-0.65, an INTERIOR optimum that
# beats both ends - MAE 0.1534 against 0.1656 for the anchor alone (g = 0) and 0.1847 for `FM - role_rate`
# (g = infinity), which is what the old code did here. Its effective slope on the FM, `g / (1 + g)` = 0.355,
# lands on the cross-sectional +0.385 / +0.350 measured independently, which is the check that it is the
# same relation and not a second one.
MV_FROM_FM: float = 0.55

# HOW MUCH OF A CLUB'S LEVEL IS BASE VOTE. `club_anchor` moves the FANTAMEDIA anchor toward the club's own
# mean for the role, and the old code took the MV anchor as `that - role_rate`, which hands the club's whole
# advantage to the base vote. Measured within season over 469 / 451 / 453 / 360 club-seasons (both
# platforms, each club's mean MV regressed on its mean FM), a club's advantage is base vote only in part,
# and the part is ORDERED the way football says it should be: a solid defence is clean sheets and good
# marks, a strong attack is bonus. Serie A 25/26 in one line - between the best and the worst club the
# spread is 1.33 of FM for forwards against 0.56 of MV, 0.75 against 0.42 for defenders.
CLUB_MV_SHARE: dict[str, float] = {"P": 0.17, "D": 0.59, "C": 0.44, "A": 0.33}
CLUB_MV_SHARE_DEFAULT: float = 0.42


def mv_anchor(role_anchor: float | None, role_rate: float | None,
              club_anchor_fm: float | None, role: str) -> float | None:
    """The anchor of the BASE VOTE: the role's own, moved by the part of the club's level that IS base vote.

    A keeper's sits ABOVE his fantamedia anchor (-1.29 of rate) and a forward's well below (+0.74), which is
    the whole reason the two anchors cannot be one number. Null when the role's rate is unknown, because a
    base-vote anchor guessed without it would be a fantamedia wearing another name.
    """
    if role_anchor is None or role_rate is None:
        return None
    base = role_anchor - role_rate
    if club_anchor_fm is None:
        return base
    return base + CLUB_MV_SHARE.get(role, CLUB_MV_SHARE_DEFAULT) * (club_anchor_fm - role_anchor)


def mv_predict(own: float | None, votes: int | None, anchor_mv: float | None,
               fm: float | None, role_rate: float | None, platform: str) -> float | None:
    """His PREDICTED base vote. Whatever comes out, `fm - this` is the bonus per appearance the row expects.

    Two routes, the better one first: his own measured base vote regressed toward the anchor (`MV_BETA`,
    cross-fit unanimous), padded for the votes he has NOT got exactly as `shrink` pads a thin fantamedia;
    and where he has none, read off the fantamedia itself (`MV_FROM_FM`), which is the operator's «chi segna
    ha sempre o quasi un voto buono» written as arithmetic.
    """
    if anchor_mv is not None and own is not None and votes:
        weight = max(0.0, min(1.0, votes / FULL_SEASON_VOTES))
        return anchor_mv + MV_BETA.get(platform, MV_BETA["default"]) * weight * (own - anchor_mv)
    if anchor_mv is None or fm is None or role_rate is None:
        return anchor_mv
    return (anchor_mv + MV_FROM_FM * (fm - role_rate)) / (1.0 + MV_FROM_FM)


def older_confidence(seasons_back: int) -> float:
    """A season further back is worth less, and never less than the anchor it would otherwise be replaced by."""
    return max(CONFIDENCE["anchor"], CONFIDENCE["older"] - OLDER_DECAY * max(0, seasons_back - 2))


# How much of an OLD fantamedia survives as a prediction. MEASURED 06/08/2026 on our own Serie A seasons,
# after the operator asked the right question - «un calciatore che torna in serie A dopo un anno, la sua FM
# è confrontabile con chi gioca due anni consecutivi?». Predicting season t from t-2, anchor out of sample:
#
#                              n     raw FM(t-2)   role anchor   anchor + b(FM-anchor)
#   returners (no Serie A t-1)   203      0.407         0.369      0.326   (b 0.40)
#   continuous (Serie A at t-1) 1264      0.395         0.376      0.336   (b 0.45)
#
# Two answers in one table. The one he asked for: YES, comparable - the year away costs 0.012 of MAE and the
# best b is the same, so an old Serie A fantamedia is as good a reference for a returner as for anybody.
# The one he did not ask for and that matters more: taken RAW it loses to the plain role anchor on both
# groups, and it is biased UPWARD for returners (+0.079 overall, +0.144 for forwards) - a man who was good
# enough two years ago and left tends to come back worse than his old number. So the rung hands its season
# to the same transform the core uses on `fm_prev` instead of passing it through; 0.40 is the returners'
# own value and 0.45 the runner-up, and both sit inside a grid swept at 0.05 from 0 to 1.
OLDER_BETA: float = 0.40


def regress(fm: float, anchor: float, beta: float = OLDER_BETA) -> float:
    """A measured fantamedia turned into a PREDICTED one, the way the core turns `fm_prev` into `fm_pred`.

    The core never predicts last season's number: it shrinks it toward the role's anchor (`beta_mantra`
    0.397 and 0.446 on the two published windows), and that is most of why it beats the naive baseline the
    backtest prints beside it. An estimate that hands over a raw fantamedia is that naive baseline wearing
    the sheet's third prefix - which is exactly what made Kolo Muani, a striker whose Serie A season is two
    years old, come out at 6.98 with +17.8 of surplus.
    """
    return anchor + beta * (fm - anchor)


def surplus(fm: float | None, pv: float | None, replacement: float | None,
            confidence: float) -> float | None:
    """(fm - replacement) x pv, THEN penalized - the SAME arithmetic as the sheet's `engine_surplus`.

    Identical on purpose, times the confidence: the whole point of this column is that one ranking can read
    every player, so a core row must come out at exactly its gated surplus (confidence 1.00) and an estimated
    row must be comparable with it. Weighting for catchability here and not there would have made the two
    columns two different questions - measured, it moved Hojlund from 28.4 to 24.6 while nothing about him
    had changed. The catchability weight belongs to whoever RANKS (`evaluate.auction_view` applies it to both
    sides of its own comparison); it does not belong to the column.

    The penalty is on the surplus alone: his fantamedia is our best guess either way, while what an auction
    ranks - points over the man you would have fielded instead - is the thing that should cost for not being
    known. Without a replacement level there is nothing to be over, so it falls back to VALUE, exactly as
    `snapshot._surplus` does.

    The paragraph above turned out to be the project's position and NOT the project's code: `auction_view`
    weighted and this did not, under one name. Both call `model.surplus_of` now with the exponent as an
    explicit argument, so the sentence and the arithmetic can no longer disagree (17/08/2026).
    """
    surplus_value = model.surplus_of(fm, pv, replacement)
    return None if surplus_value is None else surplus_value * confidence
