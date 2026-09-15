/**
 * LA PROSSIMA PARTITA DI UN CLUB, come colonna della tabella delle ultime partite.
 *
 * Richiesta dell'operatore (15/09/2026): «mostriamo sempre una colonna con la prossima partita da
 * giocare della squadra». Non e' calcio giocato, quindi non viene dai voti ne' dal livello per-partita:
 * viene dal CALENDARIO del bundle (`calendar.json`, che il toolkit scrive in `modules/fixtures.py` e
 * questa app legge e non ricalcola mai). Per questo la costruisce chi il calendario ce l'ha - la vista
 * Squadre - e non `PlayersStore`, che e' lo store del calcio GIOCATO: un secondo lettore del
 * calendario dentro quello store sarebbe una seconda risposta a «che partita hanno fra tre giorni».
 *
 * LE SUE CELLE SONO VUOTE PER COSTRUZIONE, come quelle di un confine e per la stessa ragione: di una
 * partita che nessuno ha giocato non c'e' niente da sapere, e riempirle con uno zero o con un trattino
 * direbbe una cosa che non e' vera - «vuoto = ignoto, mai zero». La colonna vive a SINISTRA di tutte le
 * altre perche' la tabella si legge dalla piu' recente: il futuro sta prima del passato piu' vicino.
 */
import { ClubMatch, LeagueCalendar } from './keeper-pairs';
import { ColumnSlot, MatchTable, abbreviate, day } from './players-store';

/**
 * IL NOME DI UN AVVERSARIO, e il caso in cui il calendario non ne ha uno.
 *
 * `LeagueCalendar` ripiega sulla sua CHIAVE quando un club e' fuori dal perimetro del listone
 * (`elche`, `nottingham forest`), ed e' giusto che ripieghi - e' l'unico nome che di lui esiste qui.
 * Quello che non va e' stamparlo com'e': in un'intestazione fatta di `Juv`, `Ata`, `Nap` un `elc`
 * minuscolo si legge come un difetto. Mettere la maiuscola e' PRESENTAZIONE e non un nome inventato,
 * e si applica solo dove non ce n'e' gia' una - un nome che il toolkit ha risolto non si tocca.
 *
 * Quanto pesa, misurato sul calendario del 15/09/2026: Serie A **0 club su 20** senza nome canonico,
 * quindi sul listone dell'operatore questo ramo non scatta mai; sugli altri campionati da 6 a 13 su
 * venti, e li' e' la differenza fra una testa leggibile e una che sembra rotta.
 */
function spell(name: string): string {
  if (/[A-ZÀ-Þ]/.test(name)) return name;
  return name.replace(/(^|[\s-])(\p{Ll})/gu, (_, before, letter) => before + letter.toUpperCase());
}

/**
 * La colonna che descrive una partita ancora da giocare.
 *
 * Il RISULTATO non c'e' e la testa lo dice da se': `sides` porta i due nomi con i gol a null, che la
 * tabella stampa gia' come `·`, e `outcome` nullo tiene la cifra neutra invece di verde o rossa. Non
 * c'e' `matchId`, quindi la colonna non promette il click che apre la formazione - una partita che
 * nessuno ha giocato non ha un undici da disegnare.
 */
export function upcomingColumn(match: ClubMatch, club: string): ColumnSlot {
  const other = spell(match.opponent);
  const left = match.home ? club : other;
  const right = match.home ? other : club;
  return {
    key: `next|${club}|${match.date}`,
    label: `${abbreviate(left)}-${abbreviate(right)}`,
    // La DATA sotto il filetto, dove per una partita giocata sta il modulo: e' l'unica cosa che di
    // questa partita si sa in piu' dei due nomi, e sta in cinque caratteri come il resto della riga.
    detail: day(match.date).slice(0, 5),
    score: null,
    outcome: null,
    sides: [
      { name: abbreviate(left), goals: null },
      { name: abbreviate(right), goals: null },
    ],
    shape: null,
    formation: null,
    matchId: null,
    matchClub: null,
    divider: null,
    breakKind: null,
    bench: null,
    unnamed: false,
    upcoming: true,
    date: match.date,
    kind: 'league',
    title:
      `Prossima partita · Giornata ${match.round} · ${left} - ${right} · ${day(match.date)}` +
      ' · non ancora giocata, quindi le sue celle sono vuote',
  };
}

/**
 * La stessa tabella con la colonna del futuro davanti, o intatta quando non c'e' un futuro da mostrare.
 *
 * Nessuna colonna e' il caso di una stagione finita o di un bundle costruito senza una corsa di
 * `fixtures`: non si inventa una partita che il calendario non porta, e una testa vuota si leggerebbe
 * come un guasto.
 */
export function withUpcoming(table: MatchTable, column: ColumnSlot | null): MatchTable {
  if (!column) return table;
  return {
    columns: [column, ...table.columns],
    lines: table.lines.map((line) => ({ ...line, cells: [null, ...line.cells] })),
  };
}

/** La colonna della prossima partita di questo club, letta dal calendario del bundle. */
export function upcomingFor(
  calendar: LeagueCalendar | null,
  club: string | null,
  today: string,
): ColumnSlot | null {
  if (!calendar || !club) return null;
  const match = calendar.next(club, today);
  return match ? upcomingColumn(match, club) : null;
}
