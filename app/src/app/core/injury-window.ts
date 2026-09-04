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

/**
 * QUANTO SI TOGLIE IN PIU' DI QUELLO CHE LA FONTE DICHIARA, come frazione dell'assenza che resta.
 *
 * DICHIARATO dall'operatore (04/09/2026) e non misurato: «se la data di rientro e' "ottimistica" noi
 * dobbiamo valutare il rientro effettivo, quindi dobbiamo togliere piu' giorni di quelli dichiarati».
 * La DIREZIONE e' misurata e non e' in discussione - sui 35.792 spell chiusi in archivio la durata
 * residua CRESCE con quella gia' trascorsa (fuori da 7 giorni: ne restano 14 di mediana; da 30: 23;
 * da 60: 38; da 120: 62), quindi gli sforamenti sono la norma e i rientri anticipati l'eccezione.
 * L'ENTITA' no, e non lo puo' essere finche' la previsione non viene archiviata: la riga di
 * `injuries` e' sostituita a ogni lettura, quindi in archivio resta l'esito e mai la stima che era
 * stata fatta. Diventa misurabile il giorno in cui la si data, la forma di `fvm_history`.
 *
 * Perche' 0,25 e non un altro numero, per quanto si puo' argomentare senza fingere una misura: nello
 * stesso archivio la durata residua MEDIA e' 1,27-2,20 volte la MEDIANA a seconda di quanto e' gia'
 * durata, e una previsione medica si comporta come una mediana. Se la data dichiarata non sapesse
 * niente della diagnosi, il margine implicito sarebbe fra +27% e +120%; la data la diagnosi la sa,
 * quindi si sta al PAVIMENTO di quella banda. E' una scelta e si cambia qui, in una riga.
 *
 * PROPORZIONALE e non un numero di giorni, e questo lo decide l'azzardo crescente: uno dato per fuori
 * tre settimane e uno dato per fuori quattro mesi non sbagliano dello stesso numero di giorni. Un
 * fisso sarebbe inerte sul secondo e brutale sul primo.
 */
export const RETURN_SLIP = 0.25;

/** Quante giornate perde, quante ne restano, e la quota che ne segue. */
export interface OutWindow {
  /**
   * La data di rientro PRUDENTE: quella dichiarata piu' `RETURN_SLIP` dell'assenza che resta.
   *
   * `null` SOLO quando la stagione e' finita per lui: la fonte lo dice a parole e non nomina nessun
   * mese, e mettere qui l'ultima giornata del calendario stamperebbe una precisione che nessuno ha
   * scritto. Il campo che lo distingue da «non lo sappiamo» e' `seasonOver`.
   */
  until: string | null;
  /** ...e quella che la fonte ha davvero scritto, che e' l'unica cosa che qualcuno ha osservato. */
  declared: string | null;
  /** La stagione e' finita: nessuna giornata giocabile, e nessun prezzo. */
  seasonOver: boolean;
  /**
   * CHI L'HA DETTA, e con due fonti in campo non e' un dettaglio.
   *
   * «La fonte dice il 5 ottobre» era una frase onesta finche' la fonte era una; da quando la data puo'
   * venire dalla prosa quotidiana degli indisponibili o dall'archivio settimanale, non dire quale
   * lascia l'operatore senza il modo di valutarla - e la prima cosa che ha chiesto guardandola e'
   * stata «da dove viene?». Stessa regola dei due zeri e delle due mediane: due domande, due nomi.
   */
  source: 'press' | 'file' | null;
  /** I giorni aggiunti dal margine. Zero quando il margine e' spento. */
  slipDays: number;
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
  /** Il margine di prudenza. Si passa per poterlo SPEGNERE in un test, non per sceglierlo per riga. */
  slip?: number;
  /** La fonte dice che la sua stagione e' finita: non c'e' una data e non serve. */
  seasonOver?: boolean;
  /** Quale delle due fonti ha dato la data (`PlayerStatus.openInjury` lo decide sulla freschezza). */
  source?: 'press' | 'file' | null;
}): OutWindow | null {
  const { calendar, club, today, until } = input;
  if (!calendar || !calendar.has(club)) return null;

  // LA STAGIONE FINITA E' UNA FINESTRA COMPLETA, non un'assenza di dati: perde tutte le giornate che
  // restano, quindi la quota e' zero e la soglia della plancia lo lascia fuori da se'. Sta davanti al
  // controllo sulla data perche' quel fatto una data non ce l'ha.
  if (input.seasonOver) {
    const left = calendar
      .window(club, 1, calendar.rounds)
      .filter((match) => match.date >= today).length;
    if (!left) return null;
    return {
      until: null,
      declared: null,
      seasonOver: true,
      source: input.source ?? null,
      slipDays: 0,
      lost: left,
      playable: 0,
      remaining: left,
      share: 0,
    };
  }
  if (!until || until <= today) return null;

  // IL MARGINE SI APPLICA ALL'ASSENZA CHE RESTA, non alla durata totale dello spell: quello che si
  // sta comprando comincia oggi, e i giorni gia' passati non li sbaglia piu' nessuno.
  const left = daysBetween(today, until);
  const slipDays = Math.round(left * Math.max(0, input.slip ?? RETURN_SLIP));
  const prudent = addDays(until, slipDays);

  const fixtures = calendar.window(club, 1, calendar.rounds);
  const remaining = fixtures.filter((match) => match.date >= today);
  if (!remaining.length) return null;

  const playable = remaining.filter((match) => match.date >= prudent).length;
  const lost = remaining.length - playable;
  if (!lost) return null;

  return {
    until: prudent,
    declared: until,
    seasonOver: false,
    source: input.source ?? null,
    slipDays,
    lost,
    playable,
    remaining: remaining.length,
    share: playable / remaining.length,
  };
}

const DAY_MS = 86_400_000;

/** Giorni interi fra due date ISO. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/** Una data ISO piu' N giorni, sempre in ISO. */
function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * La frase che accompagna il numero: cosa perde, cosa resta, e LE DUE DATE.
 *
 * La dichiarata e la prudente si dicono tutt'e due, sempre. Una sola direbbe una bugia in un senso o
 * nell'altro: stampare solo la prudente attribuirebbe alla fonte una data che non ha scritto, stampare
 * solo la dichiarata farebbe leggere un numero di giornate che non torna con quella data.
 */
export function outWindowNote(window: OutWindow, name?: string): string {
  const who = name ? `${name}: ` : '';
  if (window.seasonOver || !window.until || !window.declared) {
    return (
      `${who}la stampa dice che la sua STAGIONE E' FINITA. Perde tutte le ${window.remaining} ` +
      `giornate che restano: non c'e' un prezzo a cui valga un posto in rosa.`
    );
  }
  const said =
    window.source === 'press'
      ? 'La stampa di oggi dice'
      : window.source === 'file'
        ? "L'archivio infortuni dice"
        : 'La fonte dice';
  const declared = `${said} ${itDate(window.declared)}`;
  const slip = window.slipDays
    ? `, ma le stime di rientro sfondano piu' spesso di quanto anticipino: qui si contano ` +
      `${window.slipDays} giorni in piu'.`
    : '.';
  return (
    `${who}rientro stimato il ${itDate(window.until)}. Perde ${window.lost} giornate delle ` +
    `${window.remaining} che restano, quindi ne gioca ${window.playable}: presenze attese e max ` +
    `offerta sono ridotte di conseguenza. ${declared}${slip}`
  );
}
