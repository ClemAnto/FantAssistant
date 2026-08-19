"""projection - Fpi, il RENDIMENTO PREVISTO di una stagione, con dentro il calcio che Overall lascia fuori.

Richiesta dell'operatore, 19/08/2026: «vorrei creare un valore che cerca di "pronosticare" il rendimento
stagionale utilizzando tutti i criteri che abbiamo trattato nel corso del tempo in questo progetto e che non
rientrano in overall, in modo da avvicinarci di piu' (ma non troppo) al criterio dell'FVM (giudizio basato
sulla notizia) ... non lasci indietro i nuovi acquisti (come Ramos e K.Muani) e non supervaluti chi ha delle
fantamedie basse (Kelly, Pongracic) ... la cosa assolutamente fondamentale e' valorizzare correttamente FMa e
MVa anche quando non ci sono dati da fantacalcio della scorsa stagione: dobbiamo sempre avere uno storico di
almeno 10 partite sintetiche verosimili». Il nome e' suo: **Fpi**, `Fπ` dove l'encoding regge.

DOVE FINISCE OVERALL E DOVE COMINCIA QUESTA COLONNA, perche' la prima cosa che ha chiesto e' che Overall
resti «un termine matematico sempre semplice». Overall e' `presenze x (MVa + Bonus)`: un TOTALE, senza zero,
sui numeri che il foglio porta gia'. Fpi risponde a un'altra domanda - «quanto mi rendera' in piu' del
rimpiazzo, su queste giornate» - e per farlo tocca gli INGREDIENTI, mai la formula dell'altra. Le due
colonne stanno affiancate proprio per poter dissentire: dove Fpi si stacca da Overall c'e' una notizia che
Overall non puo' vedere, e dove si stacca dal FVM c'e' un prezzo che il campo non giustifica.

I CONFINI, dichiarati qui perche' sono la parte che un lettore futuro potrebbe erodere senza accorgersene:

  * NIENTE PREZZI, in nessuna forma. Scelta dell'operatore fra tre («solo calcio misurato + calendario»),
    ed e' anche la sola che tiene leggibile il confronto col FVM: una colonna che leggesse la quotazione
    sarebbe in parte il FVM, e la divergenza smetterebbe di essere informazione. Quindi ne' Qt.I, ne' FVM,
    ne' valore di mercato, ne' costo del cartellino - i due ultimi il gate li ha misurati e respinti per il
    motore (§7-quinquies, §7-untricies), e riprenderli qui sarebbe adottarli dalla finestra.
  * NESSUNA NOTA DICHIARATA arriva fin qui. La regola del progetto e' netta: «nothing under `engine/` reads
    a declared note and nothing ever should - a declared fact that moved a FITTED number would make every
    measurement his own answer». Le tre note dell'operatore (fuori rosa, rotto con la societa', ha chiesto
    di andarsene) sono un fattore che il CHIAMANTE applica sopra `Projected.points`, e la firma lo dice:
    questo modulo restituisce la meta' misurata e si ferma.
  * NESSUN GATE, e va scritto invece di lasciarlo capire: `engine_*` non si muove di un decimale, questa e'
    una colonna di reporting come `est_*` e `desc_*`. Ma «non gatata» non vuol dire «non misurata»: i tre
    parametri qui sotto sono misurati fuori campione, e chi ne cambia uno rifa' la misura.

Dependency-free come tutto `engine/`: nessun DB, nessuna I/O, cosi' un harness lo raggiunge e il motore
TypeScript si porta da qui.
"""

from __future__ import annotations

from dataclasses import dataclass

# Il vocabolario dei ruoli si LEGGE, non si ricopia: `MANTRA_BY_CLASSIC` e' la sola partizione dei dodici
# codici nei quattro macro-ruoli, e una seconda copia qui sarebbe la quinta istanza della regola sulle
# definizioni ripetute che questo progetto ha gia' pagato.
from euroleghe_ingest.engine.model import MANTRA_BY_CLASSIC

# ---------------------------------------------------------------- 0. quale ruolo, in quale vocabolario
#
# I DUE PARAMETRI DI QUESTO MODULO SONO CHIAVATI SUL MACRO-RUOLO, e va detto qui perche' un foglio mantra
# porta `por`/`dc`/`pc` e non P/D/C/A: senza questa traduzione il controllo sul portiere (`role == "P"`) non
# scatterebbe mai su mantra - i portieri passerebbero da un ramo misurato a -0.9% - e `CALENDAR_PER_100.get`
# tornerebbe None per tutti, cioe' calendario SILENZIOSAMENTE ZERO su meta' dei fogli. E' esattamente la
# forma del difetto che costo' la razione classic al pannello d'asta: «leggere "nessuna forma caricata" come
# "nessuna regola da applicare"». Trovato prima di spedire perche' l'operatore ha chiesto di verificare
# tutt'e due i giochi (19/08/2026).
_MACRO_OF_MANTRA: dict[str, str] = {
    code: classic for classic, codes in MANTRA_BY_CLASSIC.items() for code in codes
}


def macro_role(role: str | None) -> str | None:
    """P/D/C/A da un ruolo scritto in uno dei due vocabolari, o None se non e' nessuno dei due.

    UN TOKEN SOLO, e il chiamante e' responsabile di quale: per un uomo con piu' codici mantra il ruolo da
    passare e' il suo `role_classic`, perche' e' con quello che il gioco lo mette in rosa (3/8/8/6 anche a
    mantra - `sources.MANTRA_BY_CLASSIC` lo dice dove quella partizione e' definita). Dedurlo da una lista
    di codici sarebbe ambiguo di suo: `e` e' un centrocampista e `w` un attaccante.
    """
    if not role:
        return None
    one = role.strip()
    if one.upper() in MANTRA_BY_CLASSIC:
        return one.upper()
    return _MACRO_OF_MANTRA.get(one.lower())


# ---------------------------------------------------------------- 1. il valore di una sua partita
#
# QUANTO DELL'EQUIVALENTE SINTETICO SOPRAVVIVE COME PREVISIONE - misurato il 19/08/2026, ed e' la seconda
# volta che questa domanda viene fatta al nostro DB. La prima fu R1 («prezza un nuovo arrivo con la sua
# FM-equivalente all'estero»), respinta dal gate su cinque finestre di sei perche' fa PEGGIO dell'ancora di
# ruolo. Quel verdetto e' ancora vero e la misura di oggi lo riproduce: l'equivalente messo al posto
# dell'ancora legge MAE 0.4096 contro 0.3781 su default e 0.4217 contro 0.4176 su euro.
#
# Cambia la FORMA della domanda, non il verdetto. Non si sostituisce l'ancora: si misura quanto
# dell'equivalente e' previsione, che e' la stessa forma di `estimate.OLDER_BETA` e di `OLDER_PV_BETA` -
# `anchor + b(equivalente - anchor)`. Popolazione: chi ha un ESITO sulla piattaforma a t (pv >= 15), che il
# core NON prezza (pv(t-1) < 15), e un equivalente a t-1 su almeno dieci partite. Ancora ricalcolata sulle
# sole stagioni < t con il gioco del foglio, `b` scelto LEAVE-ONE-SEASON-OUT:
#
#   piattaforma/gioco     n    ancora   b*     cross-fit  guadagno   stagioni   b scelti
#   default / classic    289   0.3772   0.40    0.3522     +6.6%      6/6      0.35-0.50
#   default / mantra     289   0.3742   0.45    0.3544     +5.3%      5/6      0.35-0.50
#   euro    / classic    929   0.4234   0.50    0.3740    +11.7%      5/5      0.50-0.55
#   euro    / mantra     929   0.3963   0.45    0.3606     +9.0%      5/5      0.40-0.45
#
# QUATTRO VALORI E NON UNO, perche' `b` e' quanto dell'ECCESSO SULL'ANCORA sopravvive e a mantra l'ancora e'
# un'altra: quella frazionaria per slot. Applicare il valore classic a un foglio mantra sarebbe usare una
# trasformazione fuori dalla popolazione su cui e' stata misurata, che e' la regola che questo file non ha
# licenza di rompere. Misurato il 19/08/2026 su richiesta dell'operatore, che ha chiesto di verificare
# tutt'e quattro le combinazioni prima di spedire - e la verifica e' servita, vedi sotto.
# Tutti e quattro gli ottimi sono INTERNI alla griglia (0 e' l'ancora, 1 e' l'equivalente grezzo). L'unico
# che non e' positivo su ogni stagione e' default/mantra (5 di 6): passa come ROBUSTO e non come strict, e
# sta scritto qui invece di essere arrotondato. Per ruolo, con le ancore classic (pooled): A +8.4% ·
# D +7.3% · C +6.8% su default, A +12.0% · C +14.5% · D +6.4% su euro.
#
# LA PRIMA VERSIONE DI QUESTA TABELLA ERA CONTAMINATA E DICEVA 0.50 / 0.60 A MANTRA, con una spiegazione
# plausibile accanto («l'ancora per slot e' piu' fine, quindi da sola predice peggio e resta piu' spazio al
# calcio suo»). Era falsa in tutt'e due i pezzi: `model.fractional_anchor` vuole la TUPLA dei codici e la
# misura gli passava la stringa grezza del listone, `"dc;ds"`, che itera i CARATTERI - e `c`, `b`, `e`, `m`,
# `w`, `t`, `a` sono chiavi valide del dizionario mantra, quindi l'ancora non risultava assente, risultava
# di un altro ruolo. Corretta, l'ancora mantra predice MEGLIO della classic (0.3742 contro 0.3772 su
# default, 0.3963 contro 0.4234 su euro), che e' quello che una partizione piu' fine dovrebbe fare, e `b`
# non sale affatto. Due lezioni del progetto in una riga di codice: «un difetto si spiega da se' con una
# storia plausibile, se lo si lascia fare», e un join ambiguo e' peggio di uno mancante - qui a salvarci e'
# stato un `None` che ha fatto crashare lo script su un'altra combinazione.
#
# ...E I PORTIERI RESTANO FUORI, con il loro numero. `foreign_fm_equivalent` li instrada gia' sulla loro
# aritmetica (`keeper_fm_equivalent`, gate §7-decies) perche' il loro fantavoto e' dominato dai gol subiti,
# e proprio quella arriva a +0.0% qui: euro n=54, ancora 0.3190 contro 0.3217 (-0.9%), ottimo suo 0.30 e
# nessun guadagno; su default il campione e' n=6, cioe' niente. Quindi b = 0 per la P - il che significa
# che per un portiere Fpi legge quello che leggerebbe `est_fm`, ne' meglio ne' peggio - e la cosa si riapre
# quando il campione cresce, non prima.
BETA_ABROAD: dict[str, dict[str, float]] = {
    "default": {"classic": 0.40, "mantra": 0.45},
    "euro": {"classic": 0.50, "mantra": 0.45},
}
BETA_ABROAD_KEEPER: float = 0.0

# QUANTE PARTITE FANNO UNO STORICO - la soglia dell'operatore, e sopra di essa il peso non cresce piu'.
# Sotto, non si rifiuta: si PADDA con l'ancora, che e' il suo stesso rimedio del 05/08/2026 scritto come
# aritmetica («aggiungiamo i voti che mancano come la media del ruolo») e la stessa cosa che fa
# `estimate.shrink`. Cosi' «almeno dieci partite verosimili» e' vero per tutti alla lettera: chi ne ha otto
# ne ha otto sue e due dell'ancora, e la riga dichiara quante.
SYNTHETIC_FULL: int = 10

# La confidenza del ramo, DICHIARATA come tutta la scala di `estimate.CONFIDENCE`: l'ordine viene dagli
# errori misurati sopra, i valori sono una scelta di prodotto e la riga li porta con se'. A peso pieno sta
# dove sta `older` (0.85): il suo errore trattenuto, 0.3526, cade nella stessa banda. Il pavimento e'
# quello dell'ancora, perche' a zero partite Fpi E' l'ancora.
CONFIDENCE_ABROAD_FLOOR: float = 0.50
CONFIDENCE_ABROAD_SPAN: float = 0.35


# ---------------------------------------------------------------- 2. il calendario della finestra
#
# QUANTO VALE UN AVVERSARIO PIU' DEBOLE, IN FANTAVOTO - misurato il 19/08/2026 su 74.978 partite di Serie A
# col fantavoto VERO di `match_ratings`, DENTRO l'uomo (si demedia in ogni coppia uomo-stagione, o si
# misurerebbe che i forti giocano nei club forti) e contro il null dei margini RIMESCOLATI dentro l'uomo,
# che e' la regola di Miller-Sanjurjo applicata qui. Per +100 di Elo di margine (Elo mio - suo, col
# vantaggio casalingo di `fixtures.HOME_ADVANTAGE`):
#
#     ruolo   fantavoto vero   null      solo voto base    coppie
#     P          +0.175       +0.019        -0.014           171
#     D          +0.076       +0.002        +0.046          1061
#     C          +0.076       +0.012        +0.037          1059
#     A          +0.128       +0.025        +0.045           590
#
# IL PORTIERE E' QUELLO CHE GUADAGNA DI PIU', e la prima misura diceva il contrario: fatta sulla
# ricostruzione di `foreign_fm_equivalent`, che non ha il termine dei gol subiti, leggeva **-0.006** per la
# P e avrebbe spedito un coefficiente nullo esattamente nel ruolo dove il calendario conta il doppio.
# «Verify the FUNCTION, not the column that looks like it», quarta o quinta volta. La stessa misura sulle
# cinque leghe (243.483 partite, fantavoto ricostruito) conferma gli altri tre: D +0.062 · C +0.081 ·
# A +0.143, e non puo' vedere la P per la ragione appena detta.
#
# UN SOLO VALORE PER TUTT'E DUE I GIOCHI, e la ragione e' nell'unita': il coefficiente e' misurato sul
# FANTAVOTO DI UNA PARTITA, che classic e mantra condividono - i modificatori di mantra sono una proprieta'
# dell'UNDICI schierato (reparto, chi gioca con chi), non della partita di quest'uomo contro quell'avversario.
# Quindi non gli si da' un secondo valore per non far credere che sia stato misurato due volte. Se un giorno
# servisse, la misura da rifare e' questa con il fantavoto mantra al posto di `match_ratings.fantavoto`.
CALENDAR_PER_100: dict[str, float] = {"P": 0.175, "D": 0.076, "C": 0.076, "A": 0.128}

# IL TERMINE E' UNA DEVIAZIONE, NON UN LIVELLO, e questa e' la meta' della misura che si dimentica.
# Il margine medio di un club su TUTTA la stagione e' la sua forza, che sta gia' dentro la fantamedia
# misurata dei suoi giocatori: applicarlo cosi' regalerebbe un bonus permanente ai giocatori dell'Inter e
# una tassa a quelli del Pisa, cioe' conterebbe due volte lo stesso fatto - «a difference between two
# groups is not a virtue of whoever carries it». Quindi si applica alla differenza fra il margine della
# FINESTRA scelta e il margine della stagione intera dello stesso club.
# Conseguenza da dichiarare e non da scoprire: **a girone completo il termine e' esattamente zero**, che e'
# anche la verita' del calendario (un girone all'italiana fa giocare tutti contro tutti, e lo spread fra
# club del margine medio su 38 giornate e' 6 Elo, cioe' 0.005 di fantavoto). Il selettore delle giornate
# muove Fpi sulle finestre CORTE, dove lo spread e' 19.6 alla riparazione di febbraio e 33.8 su una coda di
# sei giornate (`assistente-asta-v1.md` §21.5), e li' vale 0.015-0.027 di fantavoto a partita per un
# centrocampista e il triplo per un portiere. E' un termine piccolo, ed e' scritto qui che lo e'.


# ---------------------------------------------------------------- 3. la scala che si legge
#
# DOVE STA IL 50, e perche' non e' un percentile. Fpi si legge 0-99 come Overall, ma con un'ancora
# DICHIARATA dall'operatore (19/08/2026): «un calciatore che ha una media uguale alla media della scala
# abbia un Fpi di 50 circa», precisata due volte da lui fino a «la media di lista sui PRIMI 250
# CALCIATORI». Quindi due punti fissi - la media dei primi 250 legge 50, il migliore legge 99 - e in
# mezzo si interpola dritto.
#
# PERCHE' I PRIMI 250 E NON TUTTI: la media del listone intero e' 121 fantapunti e comprende trecento
# uomini che nessuno compra, quindi «medio» finiva per voler dire «piu' che discreto» - Pongracic, un
# difensore da 5.83 che gioca 28 partite, leggeva 73. Sui primi 250 la media e' 158 e lui legge 56, che
# e' il numero che l'operatore aveva in testa (aveva detto 60, e Kelly 70 contro i 66 che escono). E 250
# non e' un numero tondo per caso: e' `teams x squad_slots` della sua lega classic (10 x 25), cioe' gli
# uomini che a quel tavolo vengono davvero comprati. Resta una COSTANTE DICHIARATA e non derivata: una
# lega con altri slot vorrebbe il suo numero, e il giorno che serve si deriva invece di ritararla.
#
# E LA SCALA HA DUE TRATTI, perche' con una retta sola le due ancore non lasciano gradi di liberta' sotto
# la media: prolungata all'ingiu' tocca lo zero a 102 fantapunti, e 183 uomini su 600 leggevano 0 tutti
# insieme. L'operatore l'ha visto su un nome - «uno come Stones con 6.4x16 non puo' avere Fpi=0» - e
# aveva ragione: Stones fa 103 fantapunti ed e' il 417° di 600, non l'ultimo.
#
#   sopra l'ancora:  50 -> 99   fra la media dei primi 250 e il migliore
#   sotto l'ancora:   1 -> 50   fra il peggiore del listone e la media dei primi 250
#
# Sopra non cambia NIENTE (stesso segmento, stessi numeri: Malen 99, Yildiz 94, Kelly 66, Pongracic 55) e
# sotto la coda si distende: Stones 0 -> 27, Skorupski 0 -> 27, Pisseri 0 -> 14. Uomini a zero da 183 a
# ZERO, gruppo piu' affollato da 183 a 35 - il che sistema anche l'altra richiesta dello stesso giorno,
# «meno calciatori che convergono tutti allo stesso punteggio».
#
# IL PREZZO, dichiarato: le due pendenze sono diverse, quindi il doppio dei fantapunti NON e' il doppio
# del punteggio attraverso l'ancora - sopra un fantapunto vale ~0.9 punti di scala, sotto ~0.4. E' una
# scelta di presentazione e non una misura. L'argomento che la regge: sotto l'ancora ci sono 108 uomini
# ammassati fra 95 e 115 fantapunti perche' il modello li prezza tutti con le stesse costanti di ripiego,
# quindi comprimere una zona dove gli ingressi sono una costante e' onesto - li' non c'e' informazione da
# preservare. Dove ce n'e', sopra, la proporzionalita' e' intatta.
#
# COSA SI GUADAGNA E COSA SI PERDE, misurato sul foglio mantra di Serie A (518 uomini):
#
#                        valori distinti   gruppo piu' affollato   uomini a 99   media   dispersione
#   percentile (rank99)       98/99                 23                  4         49.4      28.7
#   lineare sul massimo       73/99                 42                  1         56.2      17.6
#   ancorata (questa)         84/99                 37                  1         50.0      20.1
#
# Il percentile e' PIU' frazionato, e va detto perche' la richiesta nasceva da li': quello che fa male
# non e' la dispersione, e' la CIMA - quattro uomini leggono 99 e Yildiz, che gioca 30 partite a 7.00,
# legge lo stesso numero del migliore del listone. Qui ne legge 96 e a 99 c'e' un uomo solo.
#
# E UNA COSA CHE L'ANCORA NON PUO' FARE, scritta perche' e' stata chiesta: «Pongracic dovrebbe leggere
# 60». Pongracic produce 164 fantapunti contro una media di listone di 121, cioe' il 36% sopra la media;
# su qualsiasi scala in cui la media legge 50 lui atterra nei 70. Per portarlo a 60 il pavimento dovrebbe
# salire a 89 fantapunti e la media leggerebbe 26. Non e' una taratura da trovare: e' che il TOTALE di un
# mediocre che gioca sempre e' davvero grosso, ed e' la colonna Lead che risponde all'altra domanda.
ANCHOR_SCORE = 50.0
# Quanti uomini fanno il riferimento. Dichiarato dall'operatore; coincide con `teams x squad_slots` della
# sua lega classic, cioe' con quanti ne vengono comprati al suo tavolo.
ANCHOR_TOP = 250


def anchor_value(scores, ranked_by=None, top: int = ANCHOR_TOP) -> float | None:
    """La media dei `top` MIGLIORI: il punto che legge 50.

    `ranked_by` sceglie CHI sono i migliori e `scores` dice quanto valgono. L'operatore ha chiesto «i primi
    250 per OVERALL» (19/08/2026), quindi la selezione la fa la colonna che c'e' gia' e la media si prende
    sui valori di Fpi: cosi' l'ancora non si muove quando Fpi cambia - una scala il cui riferimento e'
    definito dalla cosa che sta scalando si sposta da sola a ogni ritocco. Senza `ranked_by` i due
    coincidono, che e' il caso in cui la colonna scala se stessa.

    None quando la pool e' piu' corta del riferimento: allora l'ancora sarebbe la media di tutti sotto un
    altro nome, e una scala che non sa dire cosa sia il suo 50 e' meglio che non risponda.
    """
    pairs = [(rank, value) for rank, value in
             zip(ranked_by if ranked_by is not None else scores, scores)
             if rank is not None and value is not None]
    if len(pairs) < top:
        return None
    pairs.sort(key=lambda one: one[0], reverse=True)
    return sum(value for _rank, value in pairs[:top]) / top


def scale99(value: float | None, mean: float | None, best: float | None, worst: float | None,
            anchor: float = ANCHOR_SCORE) -> int | None:
    """I fantapunti previsti sulla scala 0-99, a due tratti: peggiore -> 1, media dei primi 250 -> 50,
    migliore -> 99.

    Tre punti fissi e due segmenti, per la ragione scritta sopra: con una retta sola la coda collassa
    tutta su zero. Nessuno legge 0 - il peggiore del listone e' l'ultimo, non un uomo di cui non si sa, e
    quella differenza la porta il None.

    None resta None: un uomo senza previsione non e' l'ultimo della scala, e' uno che non si sa dove
    mettere. Anche una pool incoerente (media fuori dai suoi estremi) torna None invece di inventare.
    """
    if value is None or mean is None or best is None or worst is None:
        return None
    if not (worst < mean < best):
        return None
    if value >= mean:
        return int(min(99, round(anchor + (99.0 - anchor) * (value - mean) / (best - mean))))
    return int(max(1, round(1.0 + (anchor - 1.0) * (value - worst) / (mean - worst))))


@dataclass(frozen=True)
class Projected:
    """Fpi per un giocatore: il numero, i tre fattori che lo fanno, e da dove viene il valore a partita."""

    # I fantapunti che ci si aspetta da lui in piu' del rimpiazzo, sulla finestra chiesta. None = ignoto:
    # senza una previsione di presenze o di valore non c'e' un pronostico, e uno zero direbbe un'altra cosa.
    points: float | None
    # I due fattori, esposti perche' una colonna che non si puo' scomporre e' una colonna da credere.
    pv: float | None
    fm: float | None
    mv: float | None
    # Quello che il calendario della finestra aggiunge (o toglie) al valore di una sua partita.
    calendar: float
    # `core` | `abroad` | il gradino di `estimate` che ha risposto. E quante partite lo sostengono.
    basis: str
    matches: int
    confidence: float
    note: str


def synthetic_weight(matches: int | None, full: int = SYNTHETIC_FULL) -> float:
    """Quanto pesa il suo storico sintetico: 1 da `full` partite in su, la quota di `full` sotto.

    Zero partite pesano zero, che e' come Fpi diventa l'ancora senza un ramo in piu'.
    """
    if not matches or matches <= 0:
        return 0.0
    return min(1.0, matches / full)


def fm_from_abroad(equivalent: float | None, matches: int | None, anchor: float | None,
                   platform: str, game: str, role: str | None,
                   beta: dict[str, dict[str, float]] | None = None) -> tuple[float, float, int] | None:
    """(fantamedia, confidenza, partite) dal calcio che ha giocato ALTROVE, o None se non c'e' niente.

    L'aritmetica in una riga, e ognuno dei tre pezzi e' misurato o dichiarato sopra:

        fm = anchor + b x (w x equivalente + (1 - w) x anchor - anchor)     w = partite / 10, tappato a 1

    `anchor` e' quella del GIOCO del foglio (frazionaria per slot a mantra) e `b` e' il suo, perche' sono
    stati misurati insieme; `role` puo' arrivare in uno dei due vocabolari e ci pensa `macro_role`.

    None quando manca l'ancora (senza di essa non c'e' niente verso cui regredire), quando l'equivalente non
    esiste o quando la coppia piattaforma-gioco non ha un `b` misurato: «vuoto = ignoto», e il chiamante
    scende al gradino dopo. Un portiere torna None per costruzione, perche' il suo b e' zero e un ramo che
    non aggiunge niente non deve dichiarare di aver risposto - la riga direbbe `abroad` mostrando l'ancora.
    """
    if anchor is None or equivalent is None:
        return None
    macro = macro_role(role)
    factor = (BETA_ABROAD_KEEPER if macro == "P"
              else (beta or BETA_ABROAD).get(platform, {}).get(game))
    if not factor:
        return None
    weight = synthetic_weight(matches)
    if weight <= 0:
        return None
    padded = weight * equivalent + (1.0 - weight) * anchor
    confidence = CONFIDENCE_ABROAD_FLOOR + CONFIDENCE_ABROAD_SPAN * weight
    return anchor + factor * (padded - anchor), confidence, int(matches or 0)


def calendar_lift(role: str | None, window_margin: float | None, season_margin: float | None,
                  per_100: dict[str, float] | None = None) -> float:
    """Quanto il calendario della finestra aggiunge al fantavoto di una sua partita.

    `window_margin` e `season_margin` sono margini Elo medi (mio - suo, col vantaggio casalingo) del suo
    CLUB: il primo sulle giornate scelte, il secondo su tutta la stagione. Si applica alla differenza, per
    la ragione scritta sopra - a girone completo i due coincidono e questo termine vale zero.

    `role` arriva in uno dei due vocabolari (`A` o `pc`, indifferente): il coefficiente e' del MACRO-ruolo,
    e senza questa traduzione un foglio mantra leggerebbe zero per tutti senza dirlo.

    Zero anche quando manca uno dei due margini o il ruolo non e' riconoscibile: un calendario che non
    sappiamo leggere non e' un calendario medio, e trattarlo come tale sarebbe «vuoto = zero».
    """
    if window_margin is None or season_margin is None:
        return 0.0
    coefficient = (per_100 or CALENDAR_PER_100).get(macro_role(role) or "")
    if not coefficient:
        return 0.0
    return coefficient * (window_margin - season_margin) / 100.0


def projection(pv: float | None, fm: float | None, replacement: float | None, *,
               calendar: float = 0.0, availability: float = 1.0) -> float | None:
    """I fantapunti previsti in piu' del rimpiazzo: `pv x (fm + calendario - rimpiazzo) x disponibilita'`.

    LO ZERO E' QUELLO DI LEAD (`engine_replacement_fm`, il marginale di rosa della lega), scelto
    dall'operatore fra i due che il foglio porta. E' quello che impedisce a Fpi di ripetere il difetto per
    cui Overall era stato chiamato in causa: un difensore da 6.05 su 35 giornate accumula un totale grande
    e un margine piccolo, e da solo questo zero lo sposta dal 39° al 155° posto del listone.

    `availability` e' il gancio che tiene le NOTE DICHIARATE fuori da `engine/`: vale 1 qui e il chiamante
    ci mette dentro quello che sa e che a noi non e' lecito leggere (fuori rosa, rottura con la societa',
    richiesta di cessione) piu' la fragilita' se la vuole. Un fattore e non un addendo, perche' quello che
    resta di lui e' una quota della stagione su cui si puo' contare.

    None quando manca un fattore. Un pronostico senza presenze previste non e' zero: e' ignoto.
    """
    if pv is None or fm is None or replacement is None:
        return None
    return pv * (fm + calendar - replacement) * availability
