import { gapAt } from './column-drag';

/**
 * L'ORDINE PERSONALE dell'operatore sopra una lista che ha già il suo (27/08/2026).
 *
 * Richiesta: «nei vari blocchi le liste devono essere riordinabili in modo che posso impostare il mio
 * personale ordine di priorità». Le liste della pagina STRATEGIA sono ordinate per GAIN, che è una misura;
 * quello che si aggiunge qui è una PREFERENZA, e le due non si mescolano: si dichiara quale delle due
 * righe stai guardando.
 *
 * IL MODELLO È UN PREFISSO, e la scelta è quella che degrada meglio quando la lista sotto cambia. Quello
 * che si salva è la sequenza dei nomi che lui ha SISTEMATO; tutti gli altri restano sotto, nell'ordine del
 * gain. Le alternative e perché sono peggiori:
 *
 *  - salvare la lista INTERA a ogni trascinamento sarebbe più semplice, e mette un uomo NUOVO in fondo:
 *    un arrivo che il foglio prezza 40 finirebbe sotto ottanta difensori, cioè invisibile. Un prefisso lo
 *    fa comparire in cima alla parte a gain, che è appena sotto i nomi sistemati e si vede;
 *  - salvare solo le mosse («questo tre posti su») non sopravvive a una lista che cambia lunghezza, che è
 *    quello che succede a ogni cambio di impostazioni.
 *
 * QUELLO CHE È SUO E QUELLO CHE È NOSTRO resta distinguibile per costruzione: `pinned` dice quanti nomi
 * della lista disegnata vengono dal suo ordine, e sotto quel numero la lista è ancora la misura. Un blocco
 * che non lo dicesse sarebbe una lista i cui numeri descrivono un'altra lista - il difetto che questo
 * progetto paga più spesso.
 */

/** Una riga a schermo: dove comincia e dove finisce sull'asse verticale, in coordinate del viewport. */
export interface RowBox {
  top: number;
  bottom: number;
}

/**
 * IN QUALE VARCO cadrebbe il dito su una lista verticale: `0` = sopra la prima riga, `n` = sotto l'ultima.
 *
 * È `gapAt`, che è aritmetica a una dimensione: le si passano le mezzerie di questo asse invece dell'altro.
 * Una seconda implementazione darebbe due risposte alla stessa domanda, e la prima l'ha già pagata la
 * tabella (i varchi contro i bordi, `docs/model/letture-app-v1.md` §17).
 */
export function rowGapAt(rows: readonly RowBox[], y: number): number {
  return gapAt(
    rows.map((row) => ({ left: row.top, right: row.bottom })),
    y,
  );
}

/**
 * La lista come va disegnata: prima i nomi del SUO ordine che sono ancora qui, poi tutti gli altri.
 *
 * `order` può nominare uomini che questa lista non ha più - un foglio nuovo, un'impostazione cambiata - e
 * quelli sono semplicemente ignorati: un ordine è una preferenza sui nomi, non un elenco di righe.
 */
export function orderedBy<T>(
  men: readonly T[],
  idOf: (man: T) => number,
  order: readonly number[],
): { men: T[]; pinned: number } {
  if (!order.length) return { men: [...men], pinned: 0 };
  const byId = new Map(men.map((man) => [idOf(man), man]));
  const mine: T[] = [];
  const seen = new Set<number>();
  for (const id of order) {
    const man = byId.get(id);
    if (!man || seen.has(id)) continue;
    seen.add(id);
    mine.push(man);
  }
  const rest = men.filter((man) => !seen.has(idOf(man)));
  return { men: [...mine, ...rest], pinned: mine.length };
}

/**
 * L'ordine personale dopo un trascinamento, o `null` se il nome non si muove.
 *
 * `shown` è la sequenza che si sta guardando (già ordinata da `orderedBy`), `gap` il varco in cui il dito
 * ha lasciato. Il prefisso che ne esce contiene **tutto quello che sta sopra il nome mollato**, più quello
 * che era già sistemato: è la regola più prevedibile che ci sia, e senza di lei portare in cima un nome
 * dalla parte a gain butterebbe fuori dall'ordine i nomi sistemati che gli stavano sotto.
 *
 * `null` e non una copia uguale: al chiamante serve sapere se c'è qualcosa da scrivere - la stessa
 * convenzione di `withColumnMoved`, per la stessa ragione.
 */
export function withRowMoved(
  order: readonly number[],
  shown: readonly number[],
  id: number,
  gap: number,
): number[] | null {
  const from = shown.indexOf(id);
  if (from < 0) return null;
  // Il varco è contato sulla lista CON la riga dentro: togliendola, i varchi sotto scalano di uno.
  const wanted = gap > from ? gap - 1 : gap;
  const at = Math.max(0, Math.min(wanted, shown.length - 1));
  if (at === from) return null;
  const rest = shown.filter((one) => one !== id);
  rest.splice(at, 0, id);
  // Quanti nomi restano «sistemati»: quelli di prima (più questo, se non c'era) e comunque tutti quelli
  // sopra il punto in cui è stato lasciato.
  const keep = order.includes(id) ? order.length : order.length + 1;
  return rest.slice(0, Math.max(keep, at + 1));
}
