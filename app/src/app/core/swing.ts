/**
 * SWING — quanti GOL DI CLASSIFICA fa segnare un uomo: il surplus piu' la sua COSTANZA, in gol.
 *
 * IL NOME E' SWING ANCHE A SCHERMO, per decisione dell'operatore (06/09/2026), e la decisione ha
 * ribaltato quella di un'ora prima: era stata proposta «Spinta» in interfaccia e `swing` in codice,
 * con l'argomento che «spinta» e' una parola NOSTRA e quindi va tradotta, mentre `titolarissimo`,
 * `bandiera`, `por` e `pc` restano non tradotte perche' sono le parole del GIOCO. L'argomento era
 * buono e la decisione non e' sua da prendere: il vocabolario che l'operatore legge al tavolo lo
 * dichiara lui, come ha dichiarato «SLOT» invece di «blocco» — e il precedente esisteva gia',
 * «Overall», «Lead» e «Bonus» sono inglesi su un'interfaccia italiana da sempre.
 *
 * DUE TERMINI E UNA CONVERSIONE.
 *
 *  1. il SURPLUS, letto dal foglio e mai ricalcolato: e' la colonna che il gate possiede, ed e' la
 *     migliore risposta disponibile alla domanda «quale dei due compro» — misurata contro dieci
 *     alternative su due stagioni fuori campione, sia sul listone intero sia a parita' di prezzo.
 *  2. la COSTANZA, che il surplus non puo' vedere: le giornate in cui ci si aspetta che chiuda almeno
 *     in sufficienza (`quota × presenze attese`), pesate `STEADY_SHARE`. La quota e' misurata sul VOTO
 *     BASE e non sul fantavoto, perche' e' il voto base che i due modificatori di questa lega pagano —
 *     l'R-Factor conta chi sta sotto il sei, il modificatore di difesa fa la media dei tre migliori.
 *     La fantamedia i due uomini li legge uguali: 6 · 6,5+1 · 6,5+1 e 5,5+0 · 5,5+0 · 7+3 fanno
 *     entrambi 21, e solo il primo incassa i modificatori.
 *
 * Il totale e' poi convertito in GOL, perche' la lega non paga fantapunti: 66 fantapunti sono un gol,
 * poi uno ogni 6, e sotto i 66 non c'e' niente.
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
 *
 * LA LETTURA CHE NE FA L'ADOZIONE: il termine vale qualcosa **solo quando i soldi vincolano**, cioe'
 * esattamente dove si gioca e in nessuno dei banchi che lo bocciano. Adottato su questa base e non su
 * un verdetto — e' la stessa fragilita' di R19, adottata sul solo verdetto robusto, e vale la stessa
 * clausola: **se la prossima misura lo trova peggiore, esce senza discutere.**
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

import { Role } from './plancia';

/**
 * LA SCALA DEI GOL, dichiarata: e' il regolamento della lega e non una misura nostra.
 *
 * 66 fantapunti sono un gol e ogni 6 sopra e' un altro (66 -> 1, 72 -> 2, 78 -> 3); sotto i 66, nulla.
 */
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
 */
export const GOALS_PER_POINT = normalCdf((MATCHDAY_MEAN - LADDER_KINK) / MATCHDAY_SD) / LADDER_RUNG;

/**
 * QUANTO VALE UNA GIORNATA CHIUSA IN SUFFICIENZA, in fantapunti — **il peso e' dell'operatore**.
 *
 * `1/11`, cioe' «la parte di bonus da R-Factor o Mod. Difesa attribuibile a un uomo», dettato il
 * 06/09/2026 con la richiesta esplicita di «un valore ragionevole ma non frutto di mille calcoli».
 *
 * LA SUA PRUDENZA HA BATTUTO LA MIA ARITMETICA, e va scritto perche' e' la lezione. Il marginale
 * ESATTO dell'R-Factor sull'undici tipo (Poisson-binomiale, 3,3 insufficienti attesi su 11) e' 0,30
 * di fantamedia per unita' di costanza — dieci volte questo peso — e misurato a 0,30 il termine e'
 * **DANNOSO** (−2,12 fantapunti a giornata). La ragione e' una regola che questo progetto ha gia'
 * scritto per le squalifiche: **il surplus contiene gia' una parte della costanza** — un uomo
 * costante gioca di piu' e rende di piu' — quindi si paga solo il DIFFERENZIALE, non il totale.
 * La griglia misurata (contro il surplus nudo, 24 configurazioni): 0,05 +0,11 · **1/11 +0,19** ·
 * 0,15 −0,27 · 0,20 −0,68 · 0,30 −2,12 · 1,0 −3,40. Ottimo interno, e il suo `k` ci cade sopra.
 */
export const STEADY_SHARE = 1 / 11;

/**
 * LA COSTANZA DI CHI NON NE HA UNA MISURATA: la mediana del suo ruolo, mai zero.
 *
 * «Vuoto = ignoto»: uno zero direbbe «non prende mai la sufficienza», che e' una frase sul calciatore
 * e non sulla nostra ignoranza — e su un listone sono meta' delle righe (248 di 474 hanno abbastanza
 * voti). Misurate sulla stagione 2024-25 di Serie A, uomini con almeno dieci voti.
 */
export const ROLE_STEADY: Record<Role, number> = { P: 0.89, D: 0.71, C: 0.67, A: 0.65 };

/** Quello che serve sapere di un uomo per convertirlo in gol. Tutto letto, niente ricalcolato. */
export interface SwingInput {
  role: Role;
  /** `engine_surplus` (o il ripiego dichiarato `est_surplus`), sulle giornate che restano. */
  surplus: number | null;
  /** Le presenze attese, gia' ridotte da `expected-play`: il denominatore delle sue sufficienze. */
  pv: number | null;
  /** La quota di partite chiuse almeno in sufficienza, MISURATA sul voto base. Vuota = ignota. */
  steady: number | null;
}

/**
 * SWING, in gol di classifica sulle giornate che restano. `null` dove il foglio non prezza l'uomo.
 *
 * Senza le presenze il termine di costanza non si puo' formare — «quante giornate chiude bene» ha
 * bisogno di quante ne gioca — e allora resta il solo surplus convertito, che e' l'informazione che
 * c'e'. Vale la pena dirlo invece di scrivere uno zero: sono due situazioni diverse.
 */
export function swingOf(input: SwingInput): number | null {
  const { surplus, pv, role } = input;
  if (surplus == null) return null;
  if (pv == null) return surplus * GOALS_PER_POINT;
  const steady = input.steady ?? ROLE_STEADY[role];
  return (surplus + steady * pv * STEADY_SHARE) * GOALS_PER_POINT;
}
