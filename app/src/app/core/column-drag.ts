/**
 * IL GESTO CHE RIORDINA, la parte che non tocca il DOM.
 *
 * Sta in `core/` dal 27/08/2026, non per ordine ma perché ha un secondo lettore: le liste per ruolo della
 * pagina STRATEGIA si riordinano con lo stesso gesto, e l'aritmetica di `gapAt` è **a una dimensione** -
 * quale sia l'asse è un affare del chiamante (`manual-order.rowGapAt` le passa top/bottom e la y). Un
 * modulo di `core/` che importasse da `ui/` rovescerebbe gli strati; una seconda copia darebbe due
 * risposte alla domanda «in quale varco».
 *
 *
 * Sta in un file suo perché è l'unica metà del gesto che si possa MISURARE senza un browser: dove
 * finirebbe la colonna in mano, e che ordine ne viene. Il resto - i `pointer*`, la cattura, il click da
 * mangiare - vive nel componente, dove ci sono gli elementi veri.
 *
 * NIENTE CDK, e non è una preferenza: è la cura del difetto che l'operatore ha visto come «buchi /
 * disallineamenti» il 18/08/2026 (CDK muoveva il DOM che Angular possiede, e nemmeno riordinava - le due
 * misure stanno in `docs/model/letture-app-v1.md`). Il pacchetto non è più nemmeno una dipendenza.
 *
 * DUE REGOLE, e sono le due cose che nella prima riscrittura non c'erano:
 *
 *   * SI LASCIA IN UN VARCO, non su una colonna. «Sopra quale intestazione sta il dito» non è una
 *     domanda con una risposta sempre: fra due celle, oltre l'ultima, sopra le due fisse la risposta era
 *     `null` e il rilascio non spostava niente - il gesto sembrava rotto proprio dove lo si usa, cioè
 *     portando una colonna in testa o in coda. Un VARCO invece esiste sempre: sono `n + 1` posizioni e
 *     `gapAt` ne restituisce una qualunque sia la x, perché conta quante mezzerie sono a sinistra.
 *   * L'ORDINE SCRITTO È QUELLO INTERO, colonne spente comprese, e la colonna si àncora alla VICINA DI
 *     DESTRA. Il segnale salvato porta anche le spente (è una preferenza sulla tabella, non su questa
 *     vista), quindi tradurre un varco visibile in una posizione della lista intera è un passaggio a
 *     sé - e farlo con l'indice del vicino, invece che con l'indice del varco, è quello che tiene fermo
 *     tutto il resto.
 */

/** Un'intestazione a schermo: dove comincia e dove finisce, in coordinate del viewport. */
export interface HeadBox {
  left: number;
  right: number;
}

/**
 * IN QUALE VARCO cadrebbe il dito: `0` = prima della prima colonna, `n` = dopo l'ultima.
 *
 * Le mezzerie e non i bordi, che è la convenzione di ogni riordino trascinabile: finché il dito non ha
 * superato metà della cella vicina, la colonna resta di qua. Non torna mai `null`: una x fuori da ogni
 * cella è a sinistra di tutte (0) o a destra di tutte (n), e sono due risposte utili.
 */
export function gapAt(boxes: readonly HeadBox[], x: number): number {
  let gap = 0;
  while (gap < boxes.length && x > (boxes[gap].left + boxes[gap].right) / 2) gap += 1;
  return gap;
}

/**
 * L'ordine INTERO con `key` spostata nel varco `gap` della lista VISIBILE - o `null` se non si muove.
 *
 * `null` e non una copia uguale: al chiamante serve sapere se c'è qualcosa da scrivere, e confrontare
 * due liste per scoprirlo è un modo di rispondere a una domanda che questa funzione ha già in mano.
 * I due varchi ai lati della colonna in mano sono per definizione «lasciala dov'è».
 */
export function withColumnMoved(
  all: readonly string[],
  visible: readonly string[],
  key: string,
  gap: number,
): string[] | null {
  const from = visible.indexOf(key);
  if (from < 0) return null;
  // Il varco è contato sulla lista CON la colonna dentro: togliendola, i varchi alla sua destra
  // scalano di uno. Senza questa riga trascinare a destra atterra sempre una posizione più in là.
  const wanted = gap > from ? gap - 1 : gap;
  const at = Math.max(0, Math.min(wanted, visible.length - 1));
  if (at === from) return null;

  const rest = visible.filter((one) => one !== key);
  // La VICINA DI DESTRA è l'ancora: «prima di lei» è una posizione che vale anche nella lista intera,
  // dove fra le due possono starci colonne spente che nessuno ha chiesto di spostare.
  const anchor = rest[at] ?? null;
  const out = all.filter((one) => one !== key);
  const where = anchor == null ? out.length : out.indexOf(anchor);
  if (where < 0) return null;
  out.splice(where, 0, key);
  return out;
}
