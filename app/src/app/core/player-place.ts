/**
 * Chi ha GUADAGNATO il posto e chi l'ha PERSO, letto dal foglio e detto in italiano.
 *
 * Il fatto è misurato dal toolkit (`snapshot.place_changes`, colonne `desc_place_*`) e qui non si
 * ricalcola niente: il giorno in cui i minuti di un uomo cambiano stabilmente, e cosa succedeva sulla
 * sua linea quel giorno. Quello che l'app aggiunge è la FRASE - il foglio è un CSV inglese, il tavolo è
 * italiano, e un fatto con due formulazioni resta un fatto solo finché la formulazione è l'unica cosa
 * che cambia.
 *
 * LA PARTE CHE LO RENDE ONESTO È IL CONTROLLO SUL REPARTO, ed è la ragione per cui esiste la colonna
 * `cause`: un uomo che gioca perché il titolare davanti a lui è rotto **non ha vinto il posto**, e torna
 * indietro quando l'altro rientra. Il confronto è fra DATE e non fra stagioni, perché la sola
 * co-occorrenza risponde al contrario su un caso che l'operatore conosce: il primo 90' di Bartesaghi è
 * la giornata del 3-5 ottobre e la caviglia di Estupiñán è del 12 - l'infortunio ha consolidato il
 * posto, non l'ha causato.
 *
 * SOLO REPORTING. La forma predittiva di questa idea è stata misurata il 14/08/2026 («promozione nei
 * minuti», controllando prezzo e minuti già visti): media +0,049 su 8 istanze, 6 su 8 positive, cioè
 * debole e non stabile. Mostrarlo è utile, ordinarci sopra una valutazione no - e infatti niente lo
 * legge se non l'icona.
 */

import { PlayerMark } from './player-status';

/** Perché il posto è cambiato di mano. Sei risposte, e due sono l'una il contrario dell'altra. */
export type PlaceCause =
  /** È entrato mentre chi teneva il posto era GIÀ fuori: il posto può tornare indietro. */
  | 'front_injured'
  /** Ha preso il posto PRIMA, e l'infortunio dell'altro è arrivato dopo: l'ha consolidato. */
  | 'won_then_injury'
  /** Nessuno della sua linea era fuori quel giorno. */
  | 'won_it'
  /** L'ha perso perché era fuori lui. */
  | 'own_injury'
  /** Era DISPONIBILE e non schierato: è la mezza domanda che cambia un'offerta. */
  | 'benched'
  /** Non era fra i convocati, e nessuno spell lo spiega. */
  | 'out_of_squad';

export interface PlaceChange {
  change: 'gained' | 'lost';
  /** Il giorno in cui il posto cambia di mano, e la giornata reale di quel giorno. */
  on: string;
  matchday: number | null;
  /** «6 -> 73»: minuti per partita prima e dopo. */
  minutes: string | null;
  cause: PlaceCause | null;
  /** Chi mancava davanti a lui, o cosa dicono le partite che ha saltato. */
  who: string | null;
}

const SENTENCE: Record<PlaceCause, string> = {
  front_injured: 'è entrato mentre {who} era già fuori: il posto può tornare indietro al rientro',
  won_then_injury: 'ha preso il posto PRIMA, e {who} si è fatto male dopo: l’infortunio l’ha '
    + 'consolidato, non l’ha causato',
  won_it: 'nessuno della sua linea era fuori quel giorno',
  own_injury: 'era fuori lui ({who})',
  benched: 'era DISPONIBILE e non schierato ({who})',
  out_of_squad: 'non era fra i convocati ({who})',
};

/** Le squalifiche non sono controllabili per una stagione passata, e va detto invece che sottinteso. */
const UNCHECKED: ReadonlySet<PlaceCause> = new Set<PlaceCause>(['won_it', 'benched', 'out_of_squad']);

const day = (iso: string): string => iso.split('-').reverse().join('/');

/** Il fatto in una riga, con quello che NON è stato controllato. Null se il foglio non dice niente. */
export function placeMark(place: PlaceChange | null | undefined): PlayerMark | null {
  if (!place?.change || !place.on) return null;
  const what = place.change === 'gained' ? 'Ha guadagnato il posto' : 'Ha perso il posto';
  const when = `dal ${day(place.on)}${place.matchday ? ` (giornata ${place.matchday})` : ''}`;
  const how = place.minutes ? `, ${place.minutes} minuti a partita` : '';
  const why = place.cause ? ` — ${SENTENCE[place.cause].replace('{who}', place.who ?? '')}` : '';
  const caveat =
    place.cause && UNCHECKED.has(place.cause)
      ? '. Le squalifiche non sono controllate: nessuna fonte datata le copre per una stagione passata'
      : '';
  return {
    flag: place.change === 'gained' ? 'place_gained' : 'place_lost',
    note: `${what} ${when}${how}${why}${caveat}.`,
  };
}
