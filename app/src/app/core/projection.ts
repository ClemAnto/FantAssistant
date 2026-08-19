/**
 * Fπ: la scala del rendimento previsto, portata da `engine/projection.py`.
 *
 * QUI STA SOLO LA SCALA, e la divisione è quella di sempre: il VALORE di una partita lo decide il
 * toolkit e viaggia nel foglio (`pi_fm`, con `pi_basis` che dice da quale calcio viene), perché è una
 * previsione su una persona e va misurata dove ci sono i banchi che la giudicano. Quanto vale quel
 * numero sulla scala 0-99 è invece una scelta di PRESENTAZIONE, dipende dalla pool che si guarda, e
 * l'app è il posto dove la pool si conosce.
 *
 * TRE PUNTI FISSI, dettati dall'operatore il 19/08/2026 e precisati tre volte fino a questa forma:
 *
 *     il peggiore del listone      →   0     «terzo portiere o calciatore che non giocherà mai»
 *     la media dei primi 250       →  50      per Overall, cioè gli uomini che a quel tavolo si comprano
 *     il migliore                  →  99
 *
 * e le sue bande di lettura: sotto 10 «inutile», sotto 30 «scarso», sotto 50 «riserva».
 *
 * DUE TRATTI E NON UNA RETTA, perché con una retta sola le due ancore alte non lasciano gradi di
 * libertà sotto: prolungata all'ingiù toccava lo zero a 102 fantapunti e 183 uomini su 600 leggevano 0
 * tutti insieme. L'operatore l'ha visto su un nome - «uno come Stones con 6.4x16 non può avere Fpi=0» -
 * e aveva ragione: Stones fa 103 fantapunti ed è il 417° di 600, non l'ultimo.
 *
 * E SOTTO L'ANCORA LA SCALA È UNA CURVA (`γ = 1.6`), non un segmento: serviva a dare tre bande leggibili
 * invece di una sola. Con la retta gli «inutili» erano ZERO uomini; con γ = 1.6 sono 11, gli «scarsi»
 * 245 e le «riserve» 221. Sopra l'ancora non cambia niente - Malen 99, Yildiz 94, Kelly 66, Pongracic
 * 55 - perché la curva agisce solo dove il modello prezza tutti con le stesse costanti di ripiego.
 *
 * IL PREZZO, dichiarato: le due pendenze sono diverse, quindi attraverso l'ancora il doppio dei
 * fantapunti non è il doppio del punteggio. È una scelta di presentazione e non una misura. L'argomento
 * che la regge: sotto l'ancora ci sono 108 uomini ammassati fra 95 e 115 fantapunti perché il modello li
 * prezza con una costante, quindi comprimere lì non butta via informazione - non ce n'è.
 */

/** Dove sta il 50: la media dei `ANCHOR_TOP` migliori. */
export const ANCHOR_SCORE = 50;

/**
 * Quanti uomini fanno il riferimento, e come si scelgono: i primi per OVERALL.
 *
 * Dichiarato dall'operatore. Coincide con `squadre × slot` della sua lega classic (10 × 25), cioè con
 * quanti uomini a quel tavolo vengono davvero comprati. Sceglierli per Overall e non per Fπ non è
 * pedanteria: un'ancora definita dalla colonna che sta scalando si sposta da sola a ogni ritocco di
 * quella colonna.
 */
export const ANCHOR_TOP = 250;

/**
 * La curvatura del tratto BASSO. 1 sarebbe una retta; 1.6 è quello che rende leggibili le tre bande che
 * l'operatore ha dichiarato, misurato sul foglio mantra di Serie A (600 uomini):
 *
 *     γ      <10 inutile   10-30 scarso   30-50 riserva   50+ titolare
 *     1.0          0            152            322            126
 *     1.6         11            245            221            123
 *     2.0         80            214            185            121
 */
export const LOW_CURVE = 1.6;

/** Le bande dichiarate dall'operatore: cosa vuol dire un numero, in parole. */
export const PI_BANDS: readonly { readonly above: number; readonly label: string }[] = [
  { above: 50, label: 'titolare' },
  { above: 30, label: 'riserva' },
  { above: 10, label: 'scarso' },
  { above: 0, label: 'inutile' },
  { above: -1, label: 'non gioca' },
];

/** In quale banda cade un punteggio. Null resta null: un uomo senza previsione non è «non gioca». */
export function piBand(score: number | null | undefined): string | null {
  if (score == null) return null;
  return PI_BANDS.find((band) => score > band.above)?.label ?? null;
}

/**
 * L'ancora: la media dei `top` migliori, scelti da `rankedBy` (l'Overall) e mediati su `scores` (Fπ).
 *
 * Null quando la pool è più corta del riferimento - allora l'ancora sarebbe la media di tutti sotto un
 * altro nome, e una scala che non sa dire cos'è il suo 50 è meglio che non risponda.
 */
export function anchorValue(
  scores: readonly (number | null)[],
  rankedBy?: readonly (number | null)[],
  top: number = ANCHOR_TOP,
): number | null {
  const by = rankedBy ?? scores;
  const pairs: [number, number][] = [];
  for (let at = 0; at < scores.length; at += 1) {
    const rank = by[at];
    const value = scores[at];
    if (rank != null && value != null) pairs.push([rank, value]);
  }
  if (pairs.length < top) return null;
  pairs.sort((left, right) => right[0] - left[0]);
  let total = 0;
  for (let at = 0; at < top; at += 1) total += pairs[at][1];
  return total / top;
}

/**
 * I fantapunti previsti sulla scala 0-99. `worst` è il peggiore della pool, `mean` l'ancora.
 *
 * Null resta null, ed è una cosa diversa da 0: 0 vuol dire «non giocherà», null «non lo sappiamo».
 */
export function scale99(
  value: number | null,
  mean: number | null,
  best: number | null,
  worst: number | null,
  curve: number = LOW_CURVE,
): number | null {
  if (value == null || mean == null || best == null || worst == null) return null;
  if (!(worst < mean && mean < best)) return null;
  if (value >= mean) {
    return Math.min(99, Math.round(ANCHOR_SCORE + (99 - ANCHOR_SCORE) * (value - mean) / (best - mean)));
  }
  // Sotto l'ancora: 0 al peggiore, 50 all'ancora, con la curva in mezzo.
  const share = Math.max(0, (value - worst) / (mean - worst));
  return Math.max(0, Math.round(ANCHOR_SCORE * Math.pow(share, curve)));
}
