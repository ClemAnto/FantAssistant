/**
 * QUANTE GIORNATE PERDE chi ha una data di rientro, e quindi quanta stagione si sta comprando.
 *
 * Richiesta dell'operatore (04/09/2026, sul caso McTominay): «in base alla data di ritorno ricalcola
 * le partite attese e di conseguenza anche la massima offerta». Fino a ieri un infortunio era un
 * VINCOLO e mai un prezzo, e la ragione era scritta: «non sappiamo per quanto stara' fuori, quindi
 * riprezzarlo sarebbe inventare» (03/09/2026). Dove una data di rientro c'e', quella ragione cade -
 * e il numero fa il lavoro meglio del vincolo, perche' dice DI QUANTO invece di dire soltanto «dopo».
 *
 * IL DATO C'ERA GIA': `injuries.end_date` porta la data di rientro STIMATA dalla fonte finche' lo
 * spell e' aperto (Transfermarkt la pubblica nella colonna «fino al»), viaggia nel bundle da sempre e
 * l'app la stampava gia' nel tooltip - «rientro previsto il ...» - senza che nessun numero la
 * leggesse. Sui 44 quotati di Serie A con uno spell aperto al 04/09/2026, 27 ne hanno una.
 *
 * SI CONTANO GIORNATE, MAI GIORNI. «L'unita' e' la PARTITA, mai la giornata» ha qui la sua forma piu'
 * semplice: due mesi di novembre non valgono due mesi di gennaio, e le giornate che perde sono quelle
 * del suo CLUB - il calendario del bundle le porta con la loro data. Un uomo il cui club il calendario
 * non conosce non si riprezza: «vuoto = ignoto», e una quota inventata su una media di campionato
 * sarebbe un numero che nessuno ha misurato.
 *
 * E IL DENOMINATORE PARTE DA OGGI, non dall'inizio della stagione. Le giornate gia' giocate le hanno
 * perse tutti, quindi contarle nel denominatore sconterebbe l'infortunato per una cosa che non e' sua:
 * la quota e' «delle giornate che restano, quante ne gioca», ed e' l'unica forma in cui si puo'
 * moltiplicare per un `pv` di stagione intera senza cambiare la posizione relativa di nessun altro.
 *
 * LA QUOTA E' LINEARE, E QUESTA E' UNA MISURA E NON UNA SEMPLIFICAZIONE. Il sospetto naturale e' che
 * un uomo appena rientrato giochi meno del solito per qualche giornata; misurato sui 2872 rientri da
 * spell di almeno 45 giorni che il layer per-partita copre (5 campionati, dal 2019-20), la quota di
 * partite giocate nelle prime 5 giornate dopo il rientro e' 0,400 contro 0,402 nelle giornate 6-20
 * DELLO STESSO UOMO: differenza appaiata **-0,002 +/- 0,006 (t -0,34)**. Il rodaggio non c'e', quindi
 * non si mette un coefficiente: quello che si perde sono le giornate prima del rientro, e basta.
 *
 * QUELLO CHE QUESTA QUOTA NON SA, e va detto invece di essere nascosto in un decimale: la data e' una
 * PREVISIONE della fonte, ed e' ottimistica per costruzione. Sui 35.792 spell chiusi in archivio la
 * durata residua CRESCE con quella gia' trascorsa - chi e' fuori da 7 giorni ne ha ancora 14 di
 * mediana, chi e' fuori da 60 ne ha 38, chi e' fuori da 120 ne ha 62 - quindi gli sforamenti sono la
 * norma e i rientri anticipati l'eccezione. Di QUANTO sia ottimistica non e' misurabile oggi, perche'
 * la previsione non viene archiviata: la riga di `injuries` e' sostituita a ogni lettura, quindi in
 * archivio resta solo l'esito. Diventa misurabile il giorno in cui la si data (la forma di
 * `fvm_history`), e fino ad allora nessun margine di sicurezza inventato entra in questo file.
 */

import { LeagueCalendar } from './keeper-pairs';
import { itDate } from './tooltip';

/** Quante giornate perde, quante ne restano, e la quota che ne segue. */
export interface OutWindow {
  /** La data di rientro come la dichiara la fonte. */
  until: string;
  /** Le giornate del suo club che cadono prima del rientro, contate da oggi. */
  lost: number;
  /** Quelle che restano dopo il rientro: le uniche che si stanno comprando. */
  playable: number;
  /** Le giornate che restano in tutto da oggi - il denominatore, uguale per tutti. */
  remaining: number;
  /** `playable / remaining`. Uno vuol dire «non perde niente», e allora non c'e' finestra. */
  share: number;
}

/**
 * La finestra di un uomo, o `null` quando non c'e' niente da riprezzare.
 *
 * `null` in quattro casi diversi e tutti e quattro sono «non lo sappiamo» o «non serve»: nessuna data
 * di rientro, un rientro gia' passato, un club che il calendario non conosce, un calendario che il
 * pacchetto non porta. Nessuno dei quattro e' uno zero.
 */
export function outWindow(input: {
  calendar: LeagueCalendar | null;
  club: string;
  today: string;
  until: string | null;
}): OutWindow | null {
  const { calendar, club, today, until } = input;
  if (!calendar || !until || until <= today || !calendar.has(club)) return null;

  const fixtures = calendar.window(club, 1, calendar.rounds);
  const remaining = fixtures.filter((match) => match.date >= today);
  if (!remaining.length) return null;

  const playable = remaining.filter((match) => match.date >= until).length;
  const lost = remaining.length - playable;
  if (!lost) return null;

  return { until, lost, playable, remaining: remaining.length, share: playable / remaining.length };
}

/** La frase che accompagna il numero: cosa perde e cosa resta, mai la sola quota. */
export function outWindowNote(window: OutWindow, name?: string): string {
  const day = itDate(window.until);
  const who = name ? `${name}: ` : '';
  return (
    `${who}rientro previsto il ${day}. Perde ${window.lost} giornate delle ${window.remaining} che ` +
    `restano, quindi ne gioca ${window.playable}: presenze attese e max offerta sono ridotte di ` +
    `conseguenza. La data e' una stima della fonte, e le stime di rientro sfondano piu' spesso di ` +
    `quanto anticipino.`
  );
}
