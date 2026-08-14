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

/**
 * IL SECONDO FATTO SULLA MAGLIA, e ha una forma diversa dal primo: venduto come titolare, ruotato di
 * fatto. Non c'è nessun gradino da trovare — Lewandowski 2025-26 gioca ogni settimana (14, 12, 22, 90,
 * 25, 90, 90, 16, 90...) e semplicemente non è il titolare — quindi il changepoint sopra non vede
 * niente mentre al tavolo si perdono punti ogni domenica.
 *
 * MISURATO chiamando la funzione che spedisce, su quattro stagioni e le cinque leghe: 3.711 letture,
 * 471 segnalate (12,7%), **precisione 90,4% contro una base del 59,5%** — 1,52x. Nove su dieci di
 * quelli segnalati chiudono il resto della stagione sotto i 60 minuti a partita del club; il decimo
 * diventa titolare davvero, ed è per questo che è un marchio e non un numero.
 *
 * Legge la stagione CHE SI STA GIOCANDO ed è muto finché non ce n'è una: cinque giornate dietro e otto
 * ancora davanti. Su un foglio pre-stagione la colonna è vuota per costruzione.
 */
export interface RotationWatch {
  /** Media minuti sulla finestra letta, e quante partite ne ha iniziate. */
  minutes: number | null;
  starts: number | null;
  /** Quante giornate ci sono dentro: sotto le quattro la frase è più debole, e lo dice. */
  window: number | null;
  /** `watch` dalla quarta giornata (forte quanto la quinta), `early` dalla seconda. */
  strength: 'watch' | 'early' | null;
  from: string | null;
  to: string | null;
}

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

/**
 * «Preso per titolare, ruotato di fatto»: il marchio, con la misura che lo giustifica addosso.
 *
 * DUE MARCHI E NON UNO ANTICIPATO, ed è una richiesta dell'operatore risolta misurando: «anche prima
 * della quinta giornata segnala i top che mostrano segnali di incertezza». Alla QUARTA la lettura vale
 * quanto alla quinta (96,3% contro 94,9%), quindi il marchio pieno scatta lì; a due e tre giornate vale
 * l'81% contro una base del 58%, che è una ragione per guardare e non la stessa frase — dopo due
 * giornate del 2025-26 avrebbe segnalato Donnarumma al Manchester City con 0 minuti, e lui ha poi
 * chiuso a 85 di media. Sei dei suoi diciassette nomi sono diventati titolari.
 */
export function rotationMark(watch: RotationWatch | null | undefined): PlayerMark | null {
  if (!watch || watch.minutes == null) return null;
  const starts = watch.starts ?? 0;
  const rounds = watch.window ?? 5;
  const when = watch.from && watch.to ? ` (${day(watch.from)}–${day(watch.to)})` : '';
  const played = `sulle ultime ${rounds} di campionato del suo club ha una media di ` +
    `${watch.minutes.toFixed(0)} minuti con ${starts} ${starts === 1 ? 'partita' : 'partite'} da ` +
    `titolare${when}`;
  if (watch.strength === 'early') {
    return {
      flag: 'rotation_early',
      note:
        `Quotato fra i primi del suo ruolo, ma ${played} — segnali di incertezza, su una finestra ` +
        `CORTA. Misurato: a due o tre giornate questa lettura è giusta circa l'81% delle volte contro ` +
        `una base del 58% (1,40x), dove alla quarta è giusta al 96%. Vuol dire «guardalo», non «non è ` +
        `il titolare»: dopo due giornate del 2025-26 avrebbe segnalato anche Donnarumma, che ha poi ` +
        `chiuso a 85 minuti di media.`,
    };
  }
  return {
    flag: 'rotation_risk',
    note:
      `Quotato fra i primi del suo ruolo, ma ${played} — non è il titolare e non ha minutaggio. ` +
      `Misurato su 4 stagioni: il 90,4% di chi si legge così chiude il resto della stagione sotto i 60 ` +
      `minuti a partita, contro il 59,5% di chi non lo fa (1,52x). Uno su dieci diventa titolare ` +
      `davvero.`,
  };
}
