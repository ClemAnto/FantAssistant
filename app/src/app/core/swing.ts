/**
 * SWING — quanto un uomo ti fa vincere le fanta-partite: PUNTI SOPRA IL 6 A GIORNATA.
 *
 * L'UNITA' E' DELL'OPERATORE (07/09/2026): «per me sarebbe piu' leggibile se lo SWING fosse espresso
 * come il surplus ovvero punti sopra il 6 per giornata (es: se un calciatore ha una fantamedia di 10
 * allora il suo swing dovrebbe essere 4)». Quindi lo ZERO e' il SEI — `EDGE_BASE`, lo stesso della
 * colonna della plancia, una definizione e due lettori — e non il rimpiazzo: e' una DICHIARAZIONE di
 * scala come «Overall» (che per sua definizione non sottrae nessuno zero), non una misura, e il prezzo
 * e' detto — SWING non ordina piu' IDENTICO al surplus, perche' lo scarto fra i due zeri e'
 * `(rimpiazzo − base) × presenze` e il rimpiazzo cambia per ruolo. UNA ECCEZIONE, trovata
 * dall'operatore lo stesso giorno: per il PORTIERE la base e' un 5 (`KEEPER_BASE`, sotto) — il suo
 * fantavoto porta il malus dei gol subiti, quindi il 6 sul suo mestiere e' la porta inviolata
 * settimanale e ordinava i portieri per NON giocare.
 * Prima era in GOL DI CLASSIFICA sulla stagione; la conversione resta qui sotto come TASSO misurato
 * (0,159 gol/fantapunto: un punto a giornata di SWING ≈ 6 gol di stagione), per il tooltip e per i
 * test, non per la colonna.
 *
 * IL NOME E' SWING ANCHE A SCHERMO, per decisione dell'operatore (06/09/2026), e la decisione ha
 * ribaltato quella di un'ora prima: era stata proposta «Spinta» in interfaccia e `swing` in codice,
 * con l'argomento che «spinta» e' una parola NOSTRA e quindi va tradotta, mentre `titolarissimo`,
 * `bandiera`, `por` e `pc` restano non tradotte perche' sono le parole del GIOCO. L'argomento era
 * buono e la decisione non e' sua da prendere: il vocabolario che l'operatore legge al tavolo lo
 * dichiara lui, come ha dichiarato «SLOT» invece di «blocco» — e il precedente esisteva gia',
 * «Overall», «Lead» e «Bonus» sono inglesi su un'interfaccia italiana da sempre.
 *
 * DUE TERMINI E UNA RIBASATURA.
 *
 *  1. il SURPLUS, letto dal foglio e mai ricalcolato: e' la colonna che il gate possiede, ed e' la
 *     migliore risposta disponibile alla domanda «quale dei due compro» — misurata contro dieci
 *     alternative su due stagioni fuori campione, sia sul listone intero sia a parita' di prezzo.
 *     La ribasatura verso il 6 e' aritmetica ESATTA su colonne dello stesso foglio
 *     (`+ (rimpiazzo − 6) × presenze`), quindi la penalita' di confidenza resta dove il foglio l'ha
 *     messa — sul surplus — e niente viene ricalcolato.
 *  2. la COSTANZA, che il surplus non puo' vedere: le giornate in cui ci si aspetta che chiuda almeno
 *     in sufficienza (`quota × presenze attese`), pesate `STEADY_SHARE`. La quota e' misurata sul VOTO
 *     BASE e non sul fantavoto, perche' e' il voto base che i due modificatori di questa lega pagano —
 *     l'R-Factor conta chi sta sotto il sei, il modificatore di difesa fa la media dei tre migliori.
 *     La fantamedia i due uomini li legge uguali: 6 · 6,5+1 · 6,5+1 e 5,5+0 · 5,5+0 · 7+3 fanno
 *     entrambi 21, e solo il primo incassa i modificatori.
 *
 * Il totale e' diviso per le giornate che il foglio prevede, perche' i risultati si riportano in punti
 * A GIORNATA (regola dell'operatore, 03/09/2026): un totale nasconde l'ordine di grandezza.
 *
 * ==================================================================================================
 * L'EVIDENZA E' DICHIARATAMENTE DEBOLE, e questo e' il posto in cui si legge prima di fidarsi
 * ==================================================================================================
 *
 * Il termine di costanza e' dell'operatore (06/09/2026), formula sua e peso suo: «k = la parte di
 * bonus da R-Factor o Mod. Difesa = 1/11 — vorrei un valore ragionevole ma non frutto di mille
 * calcoli». Misurato su quattro banchi diversi, ha perso tre volte e vinto una:
 *
 *  · DIECI stagioni, rose appaiate sulle stesse 25 fasce agli stessi prezzi (nessun budget):
 *    **−0,03%, 3 finestre su 10**, con tre finestre che scelgono gli stessi identici uomini del
 *    surplus e una sola che porta tutto il guadagno.
 *  · DIECI stagioni, quattro rose e un campionato A/R, snake draft senza budget: **−0,29 punti
 *    (t −0,63), avanti in 4 stagioni su 10**.
 *  · UNA stagione (5/9/2025), stesso formato: **+1,22 fantapunti a giornata, t 1,53** — la finestra
 *    in cui vince.
 *  · QUATTRO stagioni CON UN BUDGET di 250 crediti, che e' la situazione dell'operatore: avanti in
 *    **3 impostazioni su 4** (12 giornate 12,5 contro 11,6 · 36 giornate 36,5 contro 34,3 · per
 *    credito 13,5 contro 13,3) e dietro nella quarta, per un totale di 9 confronti vinti su 16.
 *    **RILETTO IL 07/09 SU UN BANCO CURATO, e la vittoria non c'e' piu': −0,11 punti (t −0,3),
 *    3 finestre su 10.** Quel tavolo non sapeva spendere - i bracci avversari si svenavano sui primi
 *    nomi e riempivano con uomini da un credito, tanto che il braccio a CASO li batteva tutti - quindi
 *    premiava chi RIEMPIE, e un termine proporzionale alle presenze razionava di nascosto. Con la
 *    spartizione per reparto di un tavolo vero il CASO va ultimo e la griglia si appiattisce.
 *
 * LA LETTURA CHE NE FA L'ADOZIONE, riscritta dopo quella rilettura: **nessun banco lo trova utile e
 * nessuno lo trova dannoso.** Resta perche' e' la formula dell'operatore e perche' e' piccolo per
 * costruzione, non perche' una misura lo promuova — e' la stessa fragilita' di R19, adottata sul solo
 * verdetto robusto, con la stessa clausola: **se la prossima misura lo trova peggiore, esce senza
 * discutere.**
 *
 * IL MECCANISMO E' VISIBILE E PICCOLO, e questa e' la ragione per cui il verdetto e' incerto invece
 * che negativo: il termine fa salire davvero i modificatori (R-Factor da 0,479 a 0,726 e mod. difesa
 * da 0,627 a 0,724 sulla finestra del 2025), ma su una stagione intera parliamo di meno di un punto.
 *
 * ==================================================================================================
 * E TRE ALTRI TERMINI SONO STATI PROVATI E RESPINTI, coi numeri, perche' nessuno li riproponga
 * ==================================================================================================
 *
 *  · LA COPERTURA (i buchi evitati, `HOLE_COST` = 4,73): pesata da 0 a 1 su 200 campionati, **peso 0
 *    rende 63,0 punti e il 78% dei titoli, peso 1 ne rende 35,8**. Il braccio con la copertura chiude
 *    con 0,25 buchi in 36 giornate e le giornate sotto i 66 piu' alte del tavolo: la copertura la
 *    compra tutta e non la converte in punti. LA RAGIONE, che vale oltre questo file: **il surplus e
 *    la copertura rispondono a due domande diverse** — «chi e' meglio» e «quanto offrire». Sul banco
 *    d'asta la copertura porta il braccio motore da ultimo di undici a primo, e la' e' giusta: prezza
 *    un'OFFERTA sotto un budget, dove un posto puo' restare davvero vuoto. In una lista di nomi il
 *    posto vuoto non esiste — la rosa la riempi comunque — e pagare per la presenza e' pagare per
 *    qualcosa che avresti gratis.
 *  · LA CONVESSITA' (la troncatura a 66 rende la varianza un bene, e la varianza di un uomo si legge
 *    dal suo tasso di bonus: r **+0,92** sugli attaccanti): reale e **INERTE**. Sposta **2 uomini su
 *    474 di una posizione**, e appaiata su 400 repliche vale +1,9 fantapunti (t 1,05). Il meccanismo
 *    non arriva mai a riordinare due uomini, perche' una rosa vera i 66 li supera nel 90% delle
 *    giornate (74,8 ± 7,0 di media).
 *  · LA MEDIA del voto base (invece della sua costanza): 40,3% di vittorie contro il 41,7% del
 *    pavimento. E' un'altra quantita' — nell'esempio dell'operatore le due medie sono quasi identiche
 *    (6,33 contro 6,00) mentre le costanze sono 100% e 33%.
 */

import { EDGE_BASE, Role } from './plancia';

/**
 * IL «6» DEL PORTIERE E' UN 5, e senza questa eccezione la colonna ordinava i portieri per NON giocare.
 *
 * Trovato dall'operatore il 07/09/2026, il giorno stesso della scala nuova: «quelli che giocano
 * normalmente e' logico che prendano dei malus (gol subiti) e quelli che non giocano non li prendono,
 * quindi nei primi posti ci sono tutti portieri che non giocano». La causa e' di SCALA: il fantavoto di
 * un portiere porta il malus dei gol subiti, quindi sul suo mestiere «6» vuol dire porta inviolata ogni
 * settimana — la FMa dei portieri titolari sta fra 4,91 e 5,24, cioe' TUTTI sotto il 6 — e uno zero
 * sopra l'intera scala del ruolo rende il giocare un moltiplicatore di numeri negativi. E' il difetto
 * dei «primi portieri tutti a 99» (16/08) incontrato dal verso opposto: un ruolo misurato col metro di
 * un altro.
 *
 * LO ZERO GIUSTO E' QUELLO CHE ENTRA QUANDO NON GIOCA, e per i portieri e' MISURATO invece che scelto:
 * lo zero FIELDED del ruolo P legge **5,01 / 5,03** per due strade indipendenti (la simulazione della
 * stagione e il rango squadre x posti schierati — `letture-app-v1.md` §21, colonna
 * `desc_replacement_fielded`). Arrotondato a 5 come base DICHIARATA, esattamente come il 6 lo e' per
 * gli altri tre ruoli — dove il 6 funziona perche' sta dentro la banda fielded misurata (5,8-6,9),
 * mentre per il portiere ne e' fuori di un punto intero, cioe' di un gol a partita.
 */
export const KEEPER_BASE = 5;

/**
 * LA SCALA DEI GOL, dichiarata: e' il regolamento della lega e non una misura nostra.
 *
 * 66 fantapunti sono un gol e ogni 6 sopra e' un altro (66 -> 1, 72 -> 2, 78 -> 3); sotto i 66, nulla.
 */
/**
 * LO ZERO DELLO SWING per un ruolo, che e' il SEI per tutti tranne il portiere.
 *
 * Esportata perche' la legge anche il TOOLTIP della card: una frase che dice «sopra il 6» accanto al
 * numero di un portiere - dove la base e' 5 - sarebbe una spiegazione falsa di un numero vero, e due
 * posti in cui scegliere quella cifra sono il modo in cui una schermata finisce per dirne due.
 */
export function swingBase(role: Role): number {
  return role === 'P' ? KEEPER_BASE : EDGE_BASE;
}

export const LADDER_FLOOR = 66;
export const LADDER_RUNG = 6;

/**
 * LA SCALINATA LISCIATA, e perche' il ginocchio sta a 63 e non a 66.
 *
 * La scala e' una scalinata: dentro un gradino 66,0 e 71,9 danno lo stesso gol. Su una giornata la
 * posizione dentro il gradino e' arbitraria, quindi quello che conta e' la MEDIA della scalinata sul
 * gradino — ed e' esattamente `(T - 63)/6`, perche' il gradino [66, 72) vale 1 e (69-63)/6 = 1.
 */
export const LADDER_KINK = LADDER_FLOOR - LADDER_RUNG / 2;

/**
 * LA GIORNATA DI UNA ROSA: media e dispersione del totale di undici uomini schierati.
 *
 * MISURATE sul bundle (`match_ratings`, piattaforma `default`) e non scelte: dieci rose costruite a
 * serpentina sull'FVM, schierate in 4-3-3 sulle giornate VERE, 380 giornate-rosa per stagione.
 * 2024-25: media 74,95 · sd 6,91 · sotto 66 l'8,2%. 2025-26: media 74,71 · sd 7,10 · sotto 66 il 10,5%.
 * Due stagioni indipendenti che concordano alla prima cifra.
 *
 * Servono per una cosa sola: dire quanti gol vale un fantapunto. Sono anche il motivo per cui la
 * troncatura non paga — una rosa vera i 66 li supera quasi sempre.
 */
export const MATCHDAY_MEAN = 74.8;
export const MATCHDAY_SD = 7.0;

/** Abramowitz-Stegun 7.1.26: l'errore e' sotto 1,5e-7, tre ordini sotto quello delle costanti sopra. */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * QUANTI GOL VALE UN FANTAPUNTO: la pendenza della scalinata dove la giornata di una rosa vive.
 *
 * Non e' 1/6: e' 1/6 moltiplicato per la probabilita' di arrivare sopra il ginocchio, perche' sotto
 * quello i punti non valgono niente. Con le costanti misurate legge **0,159** — un fantapunto a
 * giornata sono 6,0 gol su una stagione da 38, che e' esattamente quello che la simulazione misura
 * (6,04 e 6,00 sulle due stagioni). La forma chiusa riproduce il banco, ed e' l'unica prova che le due
 * costanti qui sopra sono quelle giuste.
 *
 * DAL 07/09/2026 LA COLONNA NON MOLTIPLICA PIU' PER QUESTO NUMERO — l'unita' di SWING e' dichiarata
 * dall'operatore in punti sopra il 6 a giornata — ma il tasso resta il fatto misurato che collega le
 * due scale (un punto a giornata ≈ 6 gol di stagione), per il tooltip e per i test che lo difendono.
 */
export const GOALS_PER_POINT = normalCdf((MATCHDAY_MEAN - LADDER_KINK) / MATCHDAY_SD) / LADDER_RUNG;

/**
 * QUANTO VALE UNA GIORNATA CHIUSA IN SUFFICIENZA, in fantapunti — **il peso e' dell'operatore, e la
 * quantita' su cui e' indicizzato e' il REGOLAMENTO**.
 *
 * `2/11`, dichiarato il 07/09/2026: «il k dovrebbe dipendere da quanti punti e' impostato il mod.dif e
 * r-factor — mettiamolo a 2/11». Il valore precedente era `1/11`, dettato il giorno prima come «la
 * parte di bonus da R-Factor o Mod. Difesa attribuibile a un uomo» con la richiesta esplicita di «un
 * valore ragionevole ma non frutto di mille calcoli»; la correzione non e' un ripensamento sul numero,
 * e' l'indicizzazione che mancava — nella sua lega l'R-Factor vale al massimo **2** punti, e due punti
 * spalmati sugli undici uomini che li producono sono `2/11`.
 *
 * QUINDI QUESTO E' UN PARAMETRO DI LEGA, non una costante del gioco, e chi ne gioca una con modificatori
 * di taglia diversa lo deve RIDICHIARARE. Dal 07/09/2026 la PRESENZA del modificatore e' dichiarata a
 * schermo (`LeagueSettings.rFactor`, sua richiesta: «il termine k intervenga solo quando l'r-factor e'
 * attivo nella lega giocata»): dove la lega non paga l'R-Factor il termine non esiste — `SwingInput`
 * porta il fatto e `swingOf` mette la quota a zero. La TAGLIA invece resta non dichiarata (qui e' un
 * interruttore, e la scala vive solo in `bench/auction/rules.py`): il giorno in cui servisse una lega
 * con un R-Factor di taglia diversa, e' li' che va aggiunta, e questa costante diventa una sua funzione
 * invece di un numero.
 *
 * NESSUNA MISURA DISTINGUE UN PESO DA UN ALTRO, ZERO COMPRESO, e i numeri che stavano qui a difesa
 * dell'1/11 sono RITIRATI (07/09/2026) perche' erano presi su un banco rotto in due modi. Primo: con
 * 250 crediti i bracci avversari compravano senza guardare il prezzo, si svenavano sui primi nomi e
 * finivano la rosa con uomini da un credito — quindi quel tavolo premiava chi RIEMPIE, e un termine
 * proporzionale alle presenze razionava di nascosto. Il numero che lo denunciava era il braccio a CASO
 * primo di quattro. Secondo: il calendario del banco nominava i partecipanti per INDICE, quindi due
 * bracci IDENTICI non pareggiavano — 0,4 punti di regalo alla posizione 0, sempre quella del braccio
 * giudicato. Con la spartizione per reparto di un tavolo vero (`profiles.MARKET`) e il calendario
 * simmetrizzato, il null legge +0,000 esatto e la griglia si appiattisce: contro il surplus nudo,
 * 10 stagioni x 24 configurazioni x 2 calendari, 1/11 **−0,11** (t −0,3) · **2/11 −0,25** (t −0,7,
 * 5 finestre su 10) · 3/11 +0,55 · 6/11 +1,07 (t 3,5) · 12/11 **−0,55** (t −2,2) · 24/11 −0,26 ·
 * 48/11 +0,10 · 96/11 +0,03. Due punti adiacenti con segni opposti e tutt'e due «significativi» sono
 * la firma di una superficie piatta, non di un effetto: **non c'e' un `k` da adottare, e non c'e' un
 * `k` da temere** — il 2/11 e' stato MISURATO e non interpolato, e sta in quella piattezza come tutti.
 *
 * QUINDI IL VALORE E' SUO E RESTA SUO, e il termine e' piccolo per costruzione: sposta pochi decimi di
 * gol fra due uomini dello stesso slot e non puo' scavalcare un surplus piu' grande di qualche
 * fantapunto (il test lo fissa). Il TETTO invece non e' suo ed e' aritmetico: il marginale esatto
 * dell'R-Factor sull'undici tipo (Poisson-binomiale, 3,3 insufficienti attesi su 11) e' **0,298** di
 * fantamedia per unita' di costanza, e **il surplus contiene gia' una parte della costanza** — un uomo
 * costante gioca di piu' e rende di piu' — quindi si paga il DIFFERENZIALE e mai il totale, che e' la
 * stessa regola gia' scritta per le squalifiche. `2/11` = 0,182 e' il 61% di quel tetto; oltre 0,298 il
 * termine prezzerebbe due volte la stessa cosa, ed e' quello che il test asserisce.
 */
export const STEADY_SHARE = 2 / 11;

/**
 * IL TETTO ARITMETICO DEL PESO QUI SOPRA, e non e' una preferenza di nessuno.
 *
 * Il marginale ESATTO dell'R-Factor sull'undici tipo: con 3,32 insufficienti attesi su 11 (Poisson-
 * binomiale sui voti base) e un R-Factor atteso di 0,50 su 2, un'unita' di costanza in piu' vale
 * **0,298 di fantamedia**. E' un tetto e mai un peso, perche' il surplus contiene gia' una parte della
 * costanza: pagare il totale sarebbe comprare due volte la stessa cosa. Non e' costante — e' una
 * SOGLIA, quindi il tasso dipende da quanto e' gia' solido l'undici (0,086 a 0,50 di costanza media,
 * 0,298 a 0,68, **0,494** a 0,90) — e 0,298 e' il valore sull'undici tipo, cioe' quello che serve a
 * decidere un acquisto.
 */
export const STEADY_MARGINAL = 0.298;

/**
 * QUANTE PARTITE DI PRIOR VALE LA FANTAMEDIA GIA' TENUTA IN QUESTA STAGIONE (R25).
 *
 * La stessa forma che R20 applica alle presenze - `(k x visto + K x prior) / (k + K)` - portata sulla
 * fantamedia, e con `k` in PARTITE GIOCATE e non in giornate: la taglia del campione di una media e'
 * quante volte quella media e' stata misurata.
 *
 * DAL 07/09/2026 IL MOTORE LA LEGGE: R25K40 e' ADOTTATA su `default` sulla griglia allargata
 * pre-registrata (gate §7-quinquagies) - l'ottimo e' INTERNO (la media scende oltre il 40: +5,0% ->
 * +4,0% -> +3,4% -> +2,5%), robusto su classic (11/12, peggiore -0,6%) e STRICT su mantra (12/12).
 * Quindi su un foglio `default` la fantamedia del MOTORE porta gia' la miscela, e riapplicarla qui
 * sarebbe contarla due volte: `SwingInput.fmBlendsSeen` e' la guardia, e i lettori la accendono
 * sulle righe che il motore prezza. La correzione resta VIVA dove il foglio non puo' portarla - le
 * righe stimate (`est_*`, la cascata non legge le partite viste) e i fogli `euro`, dove R25 non e'
 * adottata (3 sole finestre, verdetto negativo).
 *
 * Il 40 e' lo stesso K adottato, e non per coincidenza: era gia' il punto del verdetto robusto della
 * prima corsa, scelto qui dall'operatore («adottiamo solo per lo SWING questo tipo di fantamedia
 * attesa») quando l'adozione nel motore era ferma per la ragione procedurale del bordo.
 *
 * MISURATO SUL DELIVERABLE, quattro finestre retrodatate, quattro rose e campionato A/R (72 campionati
 * per finestra). Con budget 250: vince 3 finestre su 4, e le due di FEBBRAIO le vince largo - 78% e 60%
 * dei titoli contro il 14% e il 15% dello SWING senza. A SETTEMBRE e' quasi inerte per costruzione (2-3
 * partite viste, la miscela pesa il 5%) e infatti li' i due bracci leggono quasi uguale. La finestra che
 * perde la vince la QUOTAZIONE, il che e' il promemoria che quattro finestre restano quattro.
 */
export const SEEN_MATCHES = 40;

/**
 * LA COSTANZA DI CHI NON NE HA UNA MISURATA: la mediana del suo ruolo, mai zero.
 *
 * «Vuoto = ignoto»: uno zero direbbe «non prende mai la sufficienza», che e' una frase sul calciatore
 * e non sulla nostra ignoranza — e su un listone sono meta' delle righe (248 di 474 hanno abbastanza
 * voti). Misurate sulla stagione 2024-25 di Serie A, uomini con almeno dieci voti.
 */
export const ROLE_STEADY: Record<Role, number> = { P: 0.89, D: 0.71, C: 0.67, A: 0.65 };

/** Quello che serve sapere di un uomo per dargli lo SWING. Tutto letto, niente ricalcolato. */
export interface SwingInput {
  role: Role;
  /** `engine_surplus` (o il ripiego dichiarato `est_surplus`), sulle giornate che restano. */
  surplus: number | null;
  /** Le presenze attese, gia' ridotte da `expected-play`: il denominatore delle sue sufficienze. */
  pv: number | null;
  /**
   * `engine_replacement_fm`: lo zero del surplus, che qui serve a SPOSTARLO sul 6 — la ribasatura e'
   * `(rimpiazzo − 6) × presenze`, aritmetica esatta su colonne dello stesso foglio. Senza di lui la
   * ribasatura non esiste, e un numero con un altro zero nella stessa colonna e' un errore di unita':
   * si tace invece di mescolare.
   */
  replacement: number | null;
  /**
   * Le giornate che il foglio sta prevedendo (`matchdays_target`, quelle che RESTANO): il calendario
   * su cui vivono `pv` e il surplus, e il divisore che rende SWING un numero a giornata.
   */
  matchdays: number | null;
  /** La fantamedia che il foglio prevede: il PRIOR contro cui si miscela quella gia' tenuta. */
  fm?: number | null;
  /** La quota di partite chiuse almeno in sufficienza, MISURATA sul voto base. Vuota = ignota. */
  steady: number | null;
  /**
   * LA FANTAMEDIA CHE HA GIA' TENUTO IN QUESTA STAGIONE, e su quante partite (R25).
   *
   * Vuote a stagione non cominciata e per chi non ha ancora giocato: chi non e' mai sceso in campo non
   * ha una fantamedia bassa, non ne ha nessuna, e la miscela non lo tocca.
   */
  seasonFm?: number | null;
  seasonPlayed?: number | null;
  /**
   * Quanto e' solido il numero del foglio (`est_confidence`), che serve SOLO al termine in-season.
   *
   * Il surplus che arriva qui la porta gia' dentro; la correzione della fantamedia no, perche' la
   * ricostruisce da capo - e applicarla senza sarebbe dare a una stima l'autorita' di una misura.
   */
  confidence?: number | null;
  /**
   * LA FANTAMEDIA DEL FOGLIO PORTA GIA' LA MISCELA IN-SEASON? Vero per una riga che il MOTORE prezza
   * su un foglio `default`, da quando R25K40 e' adottata (07/09/2026): li' riapplicare la correzione
   * sarebbe contare due volte le stesse partite. Falso (o assente) per le righe stimate e per i fogli
   * `euro`, dove la correzione resta il solo canale. Il transitorio e' detto invece che nascosto: con
   * un bundle piu' vecchio dell'adozione una riga motore perde la correzione per un giro di export -
   * un errore che OMETTE un termine piccolo, mentre il verso opposto lo conterebbe due volte.
   */
  fmBlendsSeen?: boolean;
  /**
   * LA LEGA GIOCATA PAGA L'R-FACTOR? Il termine di costanza e' indicizzato sulla SUA scala (2/11 = i
   * suoi due punti spalmati sull'undici che li produce), quindi dove il modificatore non esiste il
   * termine non esiste - dichiarato dall'operatore (07/09/2026), non misurato. `false` lo spegne;
   * assente vale attivo, che e' il regolamento di partenza (`DEFAULT_LEAGUE.rFactor`).
   */
  rFactor?: boolean;
  /**
   * LA LEGA PAGA IL +1 A PORTA INVIOLATA? (operatore, 07/09/2026: «aggiungiamolo in maniera
   * condizionata con una opzione nelle opzioni di lega come fatto per l'r-factor»). Il bonus NON e'
   * nel fantavoto pubblicato — misurato: 1.218 portieri su 1.222 a porta inviolata leggono
   * `voto + bonus` senza premio (`rosa-3-giornate-v1.md`) — quindi ne' la fantamedia ne' il surplus
   * lo contengono, e va aggiunto qui. `false` lo spegne; assente vale attivo, come `rFactor`.
   */
  cleanSheetBonus?: boolean;
  /**
   * P(porta inviolata) media del SUO club sulle partite che restano (`keeper-pairs.cleanSheetOutlook`)
   * e la stessa media su tutto il campionato (`cleanSheetBaseline`). Il termine paga il DIFFERENZIALE
   * `(sua − media) × presenze`, mai il totale: anche il portiere che giocherebbe al posto suo incassa
   * porte inviolate, e il totale conterebbe due volte quello che la panchina restituisce — la regola
   * delle squalifiche, coerente con lo zero del portiere («quello che entra quando non gioca»).
   * Vuote = ignoto: senza calendario il termine non esiste.
   */
  cleanSheetShare?: number | null;
  cleanSheetMean?: number | null;
}

/**
 * SWING, in punti sopra il 6 a giornata sulle giornate che restano. `null` dove il foglio non prezza
 * l'uomo — e anche dove mancano le presenze o il rimpiazzo, perche' senza di loro la ribasatura verso
 * il 6 non si puo' formare: un numero rimasto sullo zero del rimpiazzo dentro una colonna basata sul 6
 * sarebbe un errore di unita', la famiglia piu' cara di questo progetto. (Prima della scala nuova il
 * ramo senza presenze restituiva il solo surplus convertito; nella scala nuova tacere e' piu' onesto
 * che mescolare due zeri.)
 */
export function swingOf(input: SwingInput): number | null {
  const { surplus, pv, role, replacement, matchdays } = input;
  if (surplus == null || pv == null || replacement == null || !matchdays) return null;
  // La lega senza R-Factor non paga la costanza, quindi il termine non esiste (operatore, 07/09/2026).
  const share = input.rFactor === false ? 0 : STEADY_SHARE;
  const steady = input.steady ?? ROLE_STEADY[role];
  // Il «6» del portiere e' un 5 (vedi KEEPER_BASE): sul suo fantavoto il 6 e' la porta inviolata
  // settimanale, e uno zero sopra l'intera scala del ruolo ordina i portieri per NON giocare.
  const base = swingBase(role);
  const rebase = (replacement - base) * pv;
  return (surplus + rebase + inSeason(input) + steady * pv * share + cleanSheets(input, pv)) / matchdays;
}

/**
 * IL +1 A PORTA INVIOLATA, al DIFFERENZIALE: `(P(porta inviolata) del suo club − media del campionato)
 * × presenze`. Solo per il portiere, solo dove la lega lo paga (`cleanSheetBonus`), e zero senza un
 * calendario da leggere — «vuoto = ignoto», non un premio inventato.
 */
function cleanSheets(input: SwingInput, pv: number): number {
  if (input.role !== 'P' || input.cleanSheetBonus === false) return 0;
  if (input.cleanSheetShare == null || input.cleanSheetMean == null) return 0;
  return (input.cleanSheetShare - input.cleanSheetMean) * pv;
}

/**
 * LA CORREZIONE IN-SEASON, in fantapunti: quanto il surplus cambierebbe con la fantamedia miscelata.
 *
 * SI SOMMA INVECE DI RICALCOLARE IL SURPLUS, e non e' un'astuzia: il surplus e' LINEARE nella
 * fantamedia, quindi `surplus(fm miscelata) = surplus(fm) + Δfm × presenze × confidenza` esattamente.
 * Ricostruirlo da capo vorrebbe dire riscrivere una colonna che il foglio porta e che il gate possiede
 * - due letture dello stesso numero, che e' il difetto che questo progetto paga da sempre.
 *
 * Zero dove manca un pezzo, e sono tutti «vuoto = ignoto»: senza fantamedia di stagione non c'e' niente
 * da miscelare, e senza `fm` del foglio non c'e' un prior contro cui miscelarla.
 */
function inSeason(input: SwingInput): number {
  const { seasonFm, seasonPlayed, fm, pv } = input;
  // Il foglio porta gia' la miscela (R25K40 adottata, riga motore su `default`): rifarla qui sarebbe
  // pesare due volte le stesse partite viste.
  if (input.fmBlendsSeen) return 0;
  if (seasonFm == null || !seasonPlayed || fm == null || pv == null) return 0;
  const weight = seasonPlayed / (seasonPlayed + SEEN_MATCHES);
  return weight * (seasonFm - fm) * pv * (input.confidence ?? 1);
}
