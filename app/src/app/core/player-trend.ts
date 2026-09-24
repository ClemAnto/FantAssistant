/**
 * The last ten CHAMPIONSHIP matches of a player's club, as the sheet's `desc_trend_detail` carries them.
 *
 * WHY THE WINDOW IS THE CHAMPIONSHIP and not «the last ten matches»: the EuroLeghe calendar skips 3 to 7
 * real rounds of each league every season, so a man read on his euro fantamedia alone is read on about
 * 82% of the football he played (measured 14/08/2026, `matchdays`). Those rounds are still in the
 * per-match layer, they still have a calibrated base voto, and the strip marks them - that is the whole
 * reason this window exists beside `desc_form_*`, which walks every competition, friendlies included.
 *
 * NOTHING IS COMPUTED HERE. The toolkit builds the record (`snapshot.trend_block`) because it is a
 * MEASUREMENT - which vote a match had, whether the game scored it, whether he was on the bench - and a
 * measurement lives where measurements are made and judged. This file parses it and ranks it, so the app
 * and the operator panel draw one picture and not two that drift.
 */

import { MatchSpell, spellFrom } from './match-bonuses';

/** What happened to a man in one match. `p` he played · `b` named on the bench and never used ·
 *  `i` injured · `s` suspended · `o` not in the squad · `n` no player-level data · `x` in the eleven of
 *  a match with no statistics at all. Four of them are absences and each is a different fact. */
export type TrendState = 'p' | 'b' | 'i' | 's' | 'o' | 'n' | 'x';

/** Where the voto comes from. `real` is the game's own; `synth` is the calibrated base voto for a round
 *  the euro calendar skipped - the same number, on the same scale, from a line fitted on the overlap. */
export type VoteSource = 'real' | 'synth' | null;

export interface TrendMatch {
  date: string;
  competition: string;
  opponent: string;
  home: boolean;
  state: TrendState;
  minutes: number | null;
  started: boolean;
  vote: number | null;
  voteSource: VoteSource;
  /** The fantapunti of that match. Null where nobody could score it - never a zero. */
  points: number | null;
  goals: number;
  assists: number;
  /** Only a really voted match carries them: the per-match layer has no bookings at all. */
  yellows: number | null;
  reds: number | null;
  /** The second layer. Null where the provider served no xG for that season, 0 where he did not shoot. */
  xga: number | null;
  /** False = the EuroLeghe calendar never counted this round. Null where no map exists for the season. */
  inEuro: boolean | null;
  /**
   * E' UNA PARTITA DEL CLUB IN CUI E' ADESSO, oppure di quello che ha lasciato.
   *
   * La finestra e' l'UNIONE dei club per cui ha giocato quest'anno - giusto per la media, che e' una
   * domanda su di lui - quindi chi la disegna una partita per volta ha bisogno di questo. `null` su un
   * pacchetto piu' vecchio del campo, che non e' `false`: non sapere non e' sapere di no.
   */
  ownClub: boolean | null;
}

export interface PlayerTrend {
  matches: TrendMatch[];
  /** Mean fantapunti over the window: a match he did not play counts 0, one nobody can score is out. */
  fp: number | null;
  /** How many entered that mean, so a mean over three never reads as a mean over ten. */
  scored: number;
  window: number;
  played: number;
  bench: number;
  /** How many of the ten the euro calendar never counted. */
  outsideEuro: number;
}

const ABSENT: ReadonlySet<TrendState> = new Set<TrendState>(['b', 'i', 's', 'o']);

/** Is this a match he did not play, for a reason we actually know? Those count ZERO in the mean. */
export function isKnownAbsence(state: TrendState): boolean {
  return ABSENT.has(state);
}

function num(value: string): number | null {
  if (value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * One `desc_trend_detail` string into its matches, oldest first - the order the toolkit wrote them in.
 *
 * A record shorter than the sixteen fields is a sheet older than the column: it is skipped rather than
 * padded, because a padded record would silently claim a vote of zero and a round inside the calendar.
 */
export function parseTrend(detail: string | null | undefined): TrendMatch[] {
  if (!detail) return [];
  const out: TrendMatch[] = [];
  for (const line of detail.split(';')) {
    if (!line) continue;
    const f = line.split('|');
    if (f.length < 16) continue;
    out.push({
      date: f[0],
      competition: f[1],
      opponent: f[2],
      home: f[3] === 'H',
      state: (f[4] || 'n') as TrendState,
      minutes: num(f[5]),
      started: f[6] === '1',
      vote: num(f[7]),
      voteSource: (f[8] || null) as VoteSource,
      points: num(f[9]),
      goals: num(f[10]) ?? 0,
      assists: num(f[11]) ?? 0,
      yellows: num(f[12]),
      reds: num(f[13]),
      xga: num(f[14]),
      inEuro: f[15] === '' ? null : f[15] === '1',
      // IL DICIASSETTESIMO CAMPO, in coda perche' un lettore piu' vecchio di lui deve continuare a
      // leggere i sedici di prima: assente o vuoto vuol dire che il foglio non lo dichiara.
      ownClub: f[16] == null || f[16] === '' ? null : f[16] === '1',
    });
  }
  return out;
}

/**
 * The 0-99 of a trend, inside a POOL that has to be stated: the same role, on the list being played.
 *
 * «He is going well» is a sentence relative to what his role can produce - a forward's ten matches are
 * worth more fantapunti than a defender's by construction - so one pool for everybody would rank the
 * roles and call it form. Linear against the best of the role, which is the scale `score99` already uses
 * for the value, so twice the fantapunti reads as twice the score.
 *
 * IT IS A DESCRIPTION AND NOT A FORECAST. Measured 14/08/2026 over ~65,000 windows against the reshuffled
 * null, a player's departure from his own averages does not predict his next rounds: the true excess is
 * +0.0167 / +0.0072 / -0.0007 at two, three and five matchdays and it changes SIGN. Ordering by it
 * answers «what has he done», which is legitimate and fast; selling it as «what will he do» would be the
 * third refused form of one idea. No valuation, no plan and no board reads it.
 */
export const MIN_TREND_POOL = 8;

export function trendScores(
  players: readonly { id: number; role: string | null; fp: number | null }[],
): Map<number, number> {
  const byRole = new Map<string, { id: number; fp: number }[]>();
  for (const man of players) {
    const role = (man.role ?? '').toUpperCase();
    if (!role || man.fp == null) continue;
    const group = byRole.get(role);
    if (group) group.push({ id: man.id, fp: man.fp });
    else byRole.set(role, [{ id: man.id, fp: man.fp }]);
  }
  const out = new Map<number, number>();
  for (const group of byRole.values()) {
    if (group.length < MIN_TREND_POOL) continue; // a 0-99 read against two men says nothing
    const top = Math.max(...group.map((man) => man.fp));
    if (top <= 0) continue;
    for (const man of group) {
      out.set(man.id, Math.max(0, Math.min(99, Math.round((man.fp / top) * 99))));
    }
  }
  return out;
}

/**
 * QUANTE PARTITE PORTA LA STRISCIA DI UNA RIGA DELLA PLANCIA: quattro.
 *
 * Numero dell'operatore (24/09/2026: «un nuovo preset TREND che mostra nelle righe dei calciatori gli
 * ultimi 4 fantavoti»). Non e' una soglia misurata e non deve sembrarlo: e' quanto di questa finestra
 * ci sta su una riga alta dieci pixel e mezzo, e l'etichetta della voce lo NOMINA invece di lasciarlo
 * scoprire contando le celle.
 */
export const ROW_TREND_MATCHES = 4;

/**
 * Una casella della striscia: il fantavoto di quella partita e i due triangolini.
 *
 * `state` a `null` e' la casella che non esiste - la finestra di quel club e' piu' corta di quattro, o
 * di quell'uomo il foglio non porta nessuna storia - e non e' la stessa cosa di uno `state` che dice
 * «era in panchina». A schermo si assomigliano (tutt'e due un trattino), nel dato no, e la distinzione
 * costa una riga: e' «vuoto = ignoto, mai zero» applicato a una casella.
 */
export interface TrendCell {
  date: string;
  state: TrendState | null;
  /** Il fantavoto di quella partita. `null` dove non ce n'e' uno: una non giocata non vale ZERO. */
  points: number | null;
  /** E' subentrato · e' stato sostituito, dalla definizione UNICA che disegna gli stessi triangolini
   *  nella card e nella tabella delle ultime partite. */
  spell: MatchSpell;
}

/**
 * LE ULTIME QUATTRO DEL CALENDARIO, e non le ultime quattro che ha GIOCATO.
 *
 * «Gli ultimi 4 fantavoti» ha due letture e non sono equivalenti. Prendere le ultime quattro partite in
 * cui un fantavoto c'e' stato riempie sempre la striscia di numeri, e per un uomo fermo da un mese
 * stampa quelli di un mese fa come se fossero di sabato scorso: nasconde l'ASSENZA, che e' la meta' che
 * decide un'asta - `Var(ln pv)` e' il 90% della varianza dei fantapunti. Le ultime quattro del
 * calendario invece dicono la verita' su tutt'e due le cose, e quando le celle sono tutte vuote quella
 * e' l'informazione. Misurato sul foglio del 24/09/2026: su 536 uomini con una finestra, 127 hanno le
 * quattro caselle vuote - cioe' un quarto del listone non ha giocato una sola delle ultime quattro del
 * suo club, e con l'altra lettura quei 127 avrebbero mostrato quattro numeri.
 *
 * LA PIU' RECENTE A SINISTRA, che e' il verso dichiarato di questa app per le «ultime partite»
 * (`players-store.daysOf`, operatore 06/09/2026): la finestra di `desc_trend_detail` arriva dalla piu'
 * vecchia, quindi si gira qui una volta sola invece che in ogni vista che la disegna.
 *
 * ESCE SEMPRE DI `count` CASELLE, riempiendo in coda - cioe' dal lato VECCHIO - perche' le colonne di
 * una riga devono incolonnarsi con quelle della riga sopra: una striscia piu' corta sposterebbe la max
 * offerta di chi ha meno storia, e una colonna che si muove riga per riga si legge come un tabellone
 * rotto.
 */
export function rowTrend(
  matches: readonly TrendMatch[],
  options: { league?: string | null; count?: number } = {},
): TrendCell[] {
  const count = options.count ?? ROW_TREND_MATCHES;
  const cells: TrendCell[] = ownLeague(matches, options.league)
    .slice(-count)
    .reverse()
    .map((match) => ({
      date: match.date,
      state: match.state,
      // Nessun ripiego: se `points` non c'e', quella partita un fantavoto non l'ha. Vale per chi non ha
      // giocato e per chi ha giocato una partita che il gioco non ha votato.
      points: match.points,
      spell: spellFrom(match.started, match.minutes),
    }));
  while (cells.length < count) {
    cells.push({ date: '', state: null, points: null, spell: EMPTY_SPELL });
  }
  return cells;
}

const EMPTY_SPELL: MatchSpell = { minutes: null, on: false, off: false };

/**
 * LA FINESTRA DEL SUO CAMPIONATO, dove il record ne mescola due.
 *
 * Difetto trovato dall'operatore il 24/09/2026 su un nome («non si vedono i fantavoti di Mastantuono
 * nel trend»): chi cambia CAMPIONATO a mercato aperto porta nel record le ultime partite di tutt'e due
 * i club, e in quelle del vecchio legge `o` - non convocato, perche' quella rosa non e' piu' la sua.
 * Mastantuono ha giocato quattro giornate di Serie A (5.5 · 5.0 · 18.0 · 6.0) e la striscia ne mostrava
 * UNA, perche' tre delle sue ultime quattro caselle erano partite del Real Madrid.
 *
 * MISURATO PRIMA DI CURARLO, sul pacchetto del 24/09/2026: 123 righe su 537 del foglio di Serie A hanno
 * una finestra mista, e il filtro restituisce 23 fantavoti che la striscia nascondeva (114 righe su 911
 * e 40 fantavoti sul foglio euro). Beto, Woltemade, Gnonto, Elmas, Jones C. sono gli altri nomi.
 *
 * IL CAMPIONATO E' QUELLO CHE IL FOGLIO DICHIARA SULLA SUA RIGA e non uno dedotto dall'ultima partita:
 * il record e' ordinato per DATA, e in una giornata in cui i due club giocano lo stesso giorno l'ultima
 * riga e' quella che il caso mette per seconda - il 20 settembre Mastantuono ne ha due, una per
 * campionato. Un fatto dichiarato sulla riga non ha quel problema.
 *
 * SI DISARMA DA SE' dove non decide niente: senza un campionato dichiarato, o quando il filtro
 * svuoterebbe la finestra - chi e' appena arrivato e qui non ha ancora giocato - resta il record
 * intero, perche' una striscia vuota direbbe «non gioca» di un uomo che nessuno ha ancora schierato.
 *
 * IL RIPIEGO E' IL CAMPIONATO, la regola vera e' il CLUB: `desc_trend_detail` dichiara da se', per
 * ogni partita, se e' del club in cui l'uomo e' adesso (`SHEET_REVISION` 76), ed e' quello che decide
 * quando c'e'. Il campionato resta perche' un pacchetto scritto prima di quel campo non lo porta - e
 * cura comunque la meta' piu' grossa, chi ha cambiato PAESE. Quello che NON cura e' Frattesi, che ha
 * cambiato club dentro la Serie A: li' serve il foglio nuovo.
 */
function ownLeague(matches: readonly TrendMatch[], league?: string | null): readonly TrendMatch[] {
  // IL CLUB BATTE IL CAMPIONATO dove il foglio lo dichiara, e non e' una seconda regola: e' la stessa
  // domanda («quali di queste partite sono sue») a cui il toolkit sa rispondere ESATTAMENTE, mentre il
  // campionato e' il ripiego che un pacchetto piu' vecchio del campo consente. La differenza si vede su
  // chi cambia club DENTRO lo stesso campionato - Frattesi, Inter e poi Lazio: cinque delle sue dieci
  // sono giornate dell'Inter, tutte `o`, e `competition` non ne separa una.
  const own = matches.filter((match) => match.ownClub);
  if (own.length) return own;
  if (!league) return matches;
  const mine = matches.filter((match) => match.competition === league);
  return mine.length ? mine : matches;
}
