import { Injectable, computed, inject, signal } from '@angular/core';

import { Bundle, BundleManifest, BundleTable, ScoringConfig, columnIndex, optionalIndex } from './bundle';
import { GlobalOptions } from './global-options';
import { LineupMan, MatchPosition } from './match-lineup';
import { roundVote, syntheticFantavoto } from './match-bonuses';
import { PlayerFlag, PlayerStatus } from './player-status';

export type ClassicRole = 'P' | 'D' | 'C' | 'A';
export const CLASSIC_ROLES: ClassicRole[] = ['P', 'D', 'C', 'A'];

/** `default` = the classic Serie A listone (20 clubs, 38 rounds). `euro` = EuroLeghe (the five
 *  championships' top clubs, 31 rounds). They are two different games with two different
 *  calendars and two different quotations, so the platform is part of every key. */
export type Platform = 'default' | 'euro';

/**
 * What the column is a match OF. The distinction is not cosmetic: only a CHAMPIONSHIP match can carry
 * a fantacalcio vote, and only the platform's own one has a scoreline we can derive from the ratings.
 *
 * `other_league` is a championship too - it is just not the one this platform plays. It used to be
 * filed under `cup`, and `buildOtherMatches` said so about itself («another country's league is not a
 * cup»); nothing read it, so the mislabel was free. It stopped being free the day the card started
 * drawing a man's whole history: the toolkit CALIBRATES a synthetic base voto on exactly those five
 * championships (`synth.calibrated_competitions`) and on nothing else, so «is this number on the
 * fantacalcio scale?» is answered here and a trophy beside a Premier League match would be a lie.
 */
export type MatchKind = 'league' | 'other_league' | 'cup' | 'friendly';

/** Le quattro posizioni che il layer per-partita scrive, e nessuna quinta: vedi `core/match-lineup.ts`. */
const POSITIONS = new Set<string>(['G', 'D', 'M', 'F']);

/** Un campionato, il suo o un altro: le due righe che possono portare un voto di fantacalcio. */
export function isChampionship(kind: MatchKind): boolean {
  return kind === 'league' || kind === 'other_league';
}

/** Why the cell looks the way it does. Measured on Serie A 2025-26 over the 499 quoted men and
 *  38 rounds: played or s.v. 45.9%, bench 14.9%, never in this championship 24.6%, injured
 *  7.6%, and only 6.9% genuinely unaccounted for. An empty cell used to be all five at once. */
export type CellState =
  | 'played'
  | 'no_vote'
  /** The match is on file and carries nothing measurable. NOT the same as `bench`: that
   *  reading was measured on the LEAGUE layer, where a row without minutes matches a man with
   *  no ratings row. In a friendly the provider often records the line-up and no minutes at
   *  all - 0 of Napoli's 63 rows in 2026-27 have any - so calling it a bench would be a claim
   *  about the player made out of a gap in the source. */
  | 'no_data'
  | 'bench'
  | 'injured'
  | 'not_in_league'
  | 'absent';

/**
 * QUANTO INDIETRO ANDARE: un numero di partite, un numero di STAGIONI, o tutt'e due.
 *
 * Due limiti e non uno perche' sono due domande diverse, e la card le fa tutt'e due: chiusa mostra «le
 * ultime cinque» (un conteggio), aperta «questa stagione e la precedente» (un confine di stagione).
 * Chi non ne passa nessuno chiede tutto quello che c'e', ed e' una scelta esplicita.
 */
export interface RecentWant {
  count?: number;
  seasons?: number;
}

/** Una partita di una lista che ATTRAVERSA LE STAGIONI: la cella, e di che stagione e'. */
export interface RecentMatch {
  season: string;
  cell: MatchCell;
}

export interface MatchCell {
  kind: MatchKind;
  state: CellState;
  /** For `injured`: what the source says, and when the spell ran. */
  injury: { detail: string | null; from: string; to: string | null } | null;
  /** The role he was fielded in for THIS match, from the ratings row: the keeper's terms of
   *  the fantavoto only apply to a row that played as one. */
  role: string | null;
  competition: string;
  competitionLabel: string;
  /** Only a league match has one. */
  matchday: number | null;
  date: string | null;
  /** The fantacalcio vote, or the calibrated synthetic one. CHAMPIONSHIPS only - his own, where
   *  the vote is published, and any of the other four, where `mv_synth` converts the provider's
   *  rating onto the same scale. */
  vote: number | null;
  voteSynthetic: boolean;
  /** The provider's own 1-10 rating. A DIFFERENT SCALE from the fantacalcio vote - it is all a cup
   *  or a friendly has, because those competitions are NOT calibrated (`mv_synth` is null on every
   *  one of them, which is the toolkit's own answer and not a list of ours), and the two must never
   *  be shown as the same number. */
  providerRating: number | null;
  fantavoto: number | null;
  goals: number;
  assists: number;
  assistsSetPiece: number;
  penScored: number;
  penMissed: number;
  penSaved: number;
  ownGoals: number;
  goalsConceded: number | null;
  yellows: number;
  reds: number;
  /**
   * xG E xA DI QUESTA PARTITA, dal layer per-partita e non dai voti: il fantacalcio non li pubblica.
   *
   * NULL E' IGNOTO E NON UNO ZERO, e quale delle due cose sia lo dice `expectedScope` leggendo i dati:
   * dentro un (stagione, competizione) in cui la fonte pubblica gli attesi, una cella vuota e' uno zero
   * (misurato sul bundle: 41.859 righe vuote su 78.626, di cui 41.852 con ZERO tiri e nessuna con un
   * gol); fuori, la fonte non li ha mai emessi e leggerli come zero direbbe che nessuno ha mai tirato.
   */
  xg: number | null;
  xa: number | null;
  minutes: number | null;
  /**
   * SE ERA IN DISTINTA DAL PRINCIPIO, che con i minuti fa la frase intera: chi e' SUBENTRATO e chi e'
   * USCITO. `minutes` da solo non la sa dire - 45' e' un uomo entrato all'intervallo tanto quanto uno
   * uscito all'intervallo - e le due cose sono la freccia verde e la freccia rossa.
   *
   * Viene dal livello per-partita e non dai voti: `match_ratings.started` e' NULL su tutte le 62.594
   * righe del bundle (l'Excel dei voti non porta ne' i minuti ne' la distinta), quindi dove il provider
   * non ha una riga resta vuoto - «vuoto = ignoto», e nessuna freccia si disegna.
   */
  started: boolean | null;
  team: string;
  opponent: string | null;
  home: boolean | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  /** The shape his club started with, from the line counts of that match's own line-up:
   *  `4-3-3`. Joined on (match_id, club) - two outputs of the SAME parser - and never by
   *  matching a club NAME across sources, which is how `coach_repertoire` once lost 13,830
   *  elevens of 24,042. */
  shape: string | null;
  /**
   * ...E IL MODULO COME LA FONTE LO DICHIARA, che non e' la stessa cosa e la differenza e' il
   * TREQUARTISTA (12/09/2026).
   *
   * `shape` qui sopra viene dai conteggi delle posizioni G/D/M/F, che hanno TRE linee: un 4-2-3-1 si
   * legge `4-5-1` e i suoi tre trequartisti finiscono in mezzo al campo (la Juventus del 23/08/2026),
   * un 3-4-1-2 si legge `3-4-3` e il centravanti finisce sull'ala (la Roma del 05/09). La fonte
   * pubblica il modulo per ogni lato e il downloader lo scartava.
   *
   * Null su un turno scaricato prima di quella data: ignoto, e allora si torna ai conteggi e lo si
   * dice - non si deduce una quarta linea che il dato non distingue.
   */
  formation: string | null;
  /**
   * L'IDENTITA' DELLA PARTITA, che e' la stessa chiave con cui `shape` viene letto: l'id dell'evento
   * del provider e la grafia del club che LUI usa (`AC Milan`, non `Milan`).
   *
   * Le due cose viaggiano insieme perche' insieme sono una chiave e da sole non lo sono: il layer
   * per-partita ha una riga per (uomo, partita) e una partita ha due squadre, quindi «chi e' sceso in
   * campo» si chiede a una COPPIA. Sono i due campi che il costruttore gia' aveva in mano per il
   * modulo e buttava via - la settima istanza di «il dato c'era e mancava un lettore».
   *
   * Null dove la riga non ha una partita del provider dietro (una giornata senza la sua riga, un
   * confine): «vuoto = ignoto», e chi legge non ha niente da ricostruire.
   */
  matchId: string | null;
  matchClub: string | null;
  /** Set only in the mixed view, when the week held more than one match for this player. */
  alsoInWeek?: number;
}

export interface PlayerRow {
  fcId: number;
  name: string;
  /** The club's own id, which is what a crest is filed under - the NAME is not a key. */
  clubId: number | null;
  role: ClassicRole;
  /** The listone's Mantra roles as one label: `Dc Ds`. */
  mantra: string;
  /** The same roles as the codes they are, for a list that draws one badge each. */
  mantraCodes: string[];
  club: string;
  league: string | null;
  /**
   * SE IL LISTONE DI QUESTA PIATTAFORMA LO QUOTA, che non e' la stessa cosa che essere sul foglio.
   *
   * Il foglio si costruisce sulle ROSE VERE, quindi porta anche chi il listone non ha: 70 righe su 602
   * il 03/09/2026 (Cheddira, Banda, Pierini...). Sono uomini che non si possono comprare - nessun prezzo
   * esiste per loro - e una lista di nomi da comprare non li deve contenere. Restano nel perimetro
   * perche' la tabella di consultazione li mostra e il campetto li disegna: e' una domanda diversa, e
   * il taglio lo fa chi chiede «chi compro» (operatore, 03/09/2026, la regola gia' viva sulla plancia).
   */
  quoted: boolean;
  /**
   * ...E SE QUESTO LISTONE LO DA' PER CEDUTO, che e' un TERZO fatto e il piu' forte dei tre: l'asterisco
   * accanto al nome sul sito, cioe' il foglio `Ceduti` del file delle quotazioni (`listone_quotes.sold`,
   * acquisito il 03/09/2026). E' la piattaforma che dichiara chi non gioca piu' qui - l'autorita' su cosa
   * si compra, perche' e' cio' da cui si compra - ed e' un fatto PER PIATTAFORMA: sette uomini sono ceduti
   * in Serie A e comprabili su euro.
   *
   * Il dato viaggiava nel pacchetto dal 03/09 (145 righe con `sold=1`) e nessuna riga di codice dell'app
   * lo leggeva: i fogli del motore quelle righe non le portano piu' affatto, ma questa lista si costruisce
   * dalle QUOTAZIONI, quindi Lukaku restava al Napoli con il suo prezzo (operatore, 07/09/2026: «perche'
   * nel Napoli c'e' ancora Lukaku?»). Sesta istanza di «il dato c'era e mancava un lettore».
   *
   * Come `quoted`: chi chiede «CHI COMPRO» lo taglia, la consultazione lo MOSTRA con il suo marchio -
   * la sua storia con quel club e' un fatto, e togliergliela sarebbe l'errore opposto.
   */
  sold: boolean;
}

export interface PlayerLine extends PlayerRow {
  cells: (MatchCell | null)[];
}

/** One column of the mixed-competition view: a WEEK, so that a round spread over Friday to
 *  Monday and the midweek cup tie of the same week share a column across every player. */
/** Uno spell di panchina: chi allena quel club, da quando e fino a quando (null = ancora in carica). */
export interface CoachSpell {
  name: string;
  from: string;
  to: string | null;
}

/**
 * Gli spell per club, dal piu' RECENTE: `{fc_club_id: [{name, from, to}]}`.
 *
 * L'ordine e' quello in cui si cerca - chi cerca una data vuole il primo spell che la copre - e le
 * righe senza data d'inizio escono: uno spell che non sa quando comincia non puo' dire chi c'era.
 */
export function buildCoachSpells(table: BundleTable | null): Map<number, CoachSpell[]> {
  const out = new Map<number, CoachSpell[]>();
  if (!table) return out;
  try {
    const [club, name, from, to] = columnIndex(table, 'fc_club_id', 'coach_name', 'valid_from',
                                               'valid_to');
    for (const row of table.rows) {
      const id = Number(row[club]);
      const since = (row[from] as string) ?? null;
      if (!Number.isFinite(id) || !since) continue;
      const list = out.get(id);
      const spell = { name: String(row[name] ?? '').trim(), from: since,
                      to: (row[to] as string) ?? null };
      list ? list.push(spell) : out.set(id, [spell]);
    }
    for (const list of out.values()) list.sort((left, right) => right.from.localeCompare(left.from));
  } catch {
    return new Map();
  }
  return out;
}

/** Chi allenava quel club in quella data, o null: il primo spell che la copre. */
export function coachOn(spells: readonly CoachSpell[] | undefined, date: string): string | null {
  for (const spell of spells ?? []) {
    if (spell.from <= date && (!spell.to || spell.to >= date)) return spell.name;
  }
  return null;
}

/**
 * LE COLONNE CON I CONFINI DI PANCHINA DENTRO: un separatore fra due partite allenate da due persone.
 *
 * Richiesta dell'operatore, 11/09/2026. Stesso MECCANISMO del confine fra due stagioni - una colonna
 * che non e' una partita, con le celle vuote - e aspetto diverso, perche' sono due fatti diversi:
 * quello dice «un altro campionato», questo «un altro criterio di scelta».
 *
 * SOLO CON UN CLUB A SCHERMO, ed e' una condizione e non una cautela: un allenatore e' un fatto di
 * CLUB, e nella vista Calciatori le righe sono di venti club diversi - una colonna condivisa non
 * potrebbe dire di chi e' il cambio. La vista Squadre ha un club solo e li' la domanda ha una risposta.
 *
 * SI LEGGE PER DATA e mai per giornata: con un rinvio la giornata 16 si gioca dopo la 20, e un confine
 * messo sul numero cadrebbe fra due partite che non sono consecutive nel tempo.
 */
export function withCoachBreaks(
  columns: readonly ColumnSlot[],
  cells: (MatchCell | null)[][],
  spells: readonly CoachSpell[] | undefined,
): { columns: ColumnSlot[]; cells: (MatchCell | null)[][] } {
  if (!spells?.length) return { columns: [...columns], cells: cells.map((row) => [...row]) };
  const out: ColumnSlot[] = [];
  const rows: (MatchCell | null)[][] = cells.map(() => []);
  let previous: { coach: string; date: string } | null = null;
  columns.forEach((column, at) => {
    const coach = column.date ? coachOn(spells, column.date) : null;
    // Le colonne sono dalla piu' RECENTE, quindi il cambio sta fra questa e quella prima di lei: il
    // nome nuovo e' quello della colonna PRECEDENTE nella lettura, cioe' della partita successiva.
    if (coach && previous && coach !== previous.coach) {
      out.push({
        key: `coach|${previous.date}|${column.date}`,
        label: '',
        detail: null,
        score: null,
        outcome: null,
        sides: null,
        shape: null,
        formation: null,
        matchId: null,
        matchClub: null,
        divider: `${coach} → ${previous.coach}`,
        breakKind: 'coach',
        date: null,
        kind: null,
        title: `Cambio in panchina: da ${coach} a ${previous.coach}`,
      });
      for (const row of rows) row.push(null);
    }
    out.push(column);
    cells.forEach((row, index) => rows[index].push(row[at] ?? null));
    if (coach && column.date) previous = { coach, date: column.date };
  });
  return { columns: out, cells: rows };
}

export interface ColumnSlot {
  key: string;
  /** The matchday, the date, or - with one club on screen - the fixture: `Nap-Mil`. */
  label: string;
  /** What goes under the label beside the score: the shape, or the round when there is no score. */
  detail: string | null;
  /**
   * IL RISULTATO, SEPARATO dal resto e col suo ESITO - perche' va colorato (operatore, 06/09/2026:
   * «nei titoli delle colonne, metti in verde i risultati delle partite vincenti e in rosso quelle
   * perdenti»), e un colore non si puo' dare a mezza stringa.
   *
   * L'esito e' dal punto di vista del CLUB della tabella (`goalsFor` contro `goalsAgainst` della sua
   * riga), non di chi gioca in casa: la colonna descrive la partita di QUELLA squadra. Vuoto dove non
   * c'e' un club sullo schermo o dove il punteggio non e' noto - ignoto, non zero a zero.
   */
  score: string | null;
  outcome: 'win' | 'draw' | 'loss' | null;
  /**
   * LE DUE SQUADRE DELLA PARTITA, in casa per prima, ognuna coi suoi gol: e' l'intestazione che
   * l'operatore ha disegnato il 10/09/2026 - una riga per squadra invece di `Gen-Com 1-4` su due
   * righe che si leggono a zig-zag.
   *
   * SONO CAMPI E NON UNA STRINGA DA SPEZZARE: `label` e `score` restano quello che erano (il tooltip e
   * le viste che non impilano), ma ricavare le due meta' con uno `split('-')` sarebbe un join per
   * stringa - la famiglia di difetti piu' cara di questo progetto - e si romperebbe il giorno che
   * un'abbreviazione contiene un trattino. Vuoto dove la colonna non e' una partita (una giornata
   * senza club a schermo, il confine fra due stagioni).
   */
  sides: { name: string; goals: number | null }[] | null;
  /** Il modulo con cui il club della tabella e' sceso in campo, sotto la riga di separazione. */
  shape: string | null;
  /** ...e come la FONTE lo dichiara, che sa dire una quarta linea dove i conteggi no. Vedi `MatchCell`. */
  formation: string | null;
  /**
   * IL CONFINE FRA DUE STAGIONI: una colonna che non e' una partita (operatore, 06/09/2026: «tra una
   * stagione e l'altra metti una colonna divisoria»).
   *
   * Porta la frase del passaggio (`2025-26 → 2026-27`) e non un'etichetta a schermo: e' larga dieci
   * pixel e un nome di stagione non ci sta, quindi la dice il tooltip. Le sue celle sono vuote per
   * costruzione - non c'e' nessuna partita in un confine - e chi disegna la tabella salta la cella
   * invece di stamparci il trattino delle giornate non giocate, che significa un'altra cosa.
   */
  divider: string | null;
  /**
   * CHE TIPO DI CONFINE E', perche' dall'11/09/2026 ce ne sono DUE e l'operatore ha chiesto che si
   * vedano diversi: «evidenzia quando viene cambiato allenatore ... con un separatore diverso da quello
   * del cambio stagione».
   *
   * Due confini e non uno perche' sono due fatti diversi sulla stessa striscia: una stagione nuova e' un
   * altro campionato, un allenatore nuovo e' un altro criterio di scelta - e le presenze di un uomo
   * prima e dopo sono due popolazioni in tutt'e due i casi. Null dove la colonna e' una partita.
   */
  breakKind: 'season' | 'coach' | null;
  /**
   * QUALE PARTITA E', come chiave: l'id dell'evento del provider e la grafia che LUI da' al club di
   * questa tabella. E' la coppia con cui il modulo della colonna e' gia' stato letto.
   *
   * Piena soltanto dove la colonna E' una partita di UN club, cioe' con un club a schermo - senza
   * filtro una settimana ne contiene molte, e nominarne una sarebbe scrivere la partita di qualcun
   * altro su questa colonna. E' quello che permette di chiedere «chi ha giocato QUESTA»: senza una
   * chiave si arriverebbe alla riposta per (data, nome del club), che e' il join per stringa che a
   * questo progetto e' costato Milan, Roma e Napoli.
   */
  matchId: string | null;
  matchClub: string | null;
  /**
   * LA DATA della partita che questa colonna descrive, o null (una giornata senza club a schermo, un
   * confine). Serve a dire quale allenatore era in carica, che e' un fatto DATATO per club: senza di
   * lei il confine andrebbe dedotto dal numero di giornata, che con un rinvio e' la data sbagliata -
   * «l'unita' e' la PARTITA, mai la giornata».
   */
  date: string | null;
  /** What kind of match the column is about - known only when one club is on screen, because
   *  without a filter a week holds a league round AND its cup ties AND friendlies at once. */
  kind: MatchKind | null;
  title: string;
}

/**
 * WHAT a match table is about: which listone, which season, which window, which competitions.
 *
 * It exists so that the table can be asked for a selection that is NOT the one the filter bar holds:
 * the squads view draws the same ten columns for one club's rosa, and a second implementation of «le
 * ultime partite» would be a second answer to the question this store already answers.
 */
export interface MatchQuery {
  platform: Platform;
  season: string;
  /** The window of league rounds, inclusive. The last ten of it are drawn - see `COLUMNS`. */
  from: number;
  to: number;
  withCups: boolean;
  withFriendlies: boolean;
  /** One club on screen: only then can a column name the fixture, because only then is there one. */
  club: string | null;
}

/** The two halves of one answer, built together: a column and the cells under it must agree. */
export interface MatchTable {
  columns: ColumnSlot[];
  lines: PlayerLine[];
}

const COLUMNS = 10;

/** Adding a cup or a friendly changes the UNIT of a column: no cup match has a matchday. */
function byMatchdayOf(query: MatchQuery): boolean {
  return !query.withCups && !query.withFriendlies;
}

/**
 * QUALE DEI DUE INTERRUTTORI possiede una cella delle «altre competizioni», in una definizione sola.
 *
 * Un campionato straniero sta con le COPPE e non con le amichevoli, che e' dove stava prima di avere un
 * nome suo: l'interruttore si chiama «altre competizioni» e chi lo accende vuole vedere anche quello.
 * Scritto una volta perche' i due lettori - l'asse delle colonne e le righe sotto - devono per forza
 * dare la stessa risposta, o una colonna esisterebbe senza le celle che l'hanno prodotta.
 */
function shownBy(cell: MatchCell, query: MatchQuery): boolean {
  return cell.kind === 'friendly' ? query.withFriendlies : query.withCups;
}

/** The football week runs THURSDAY to WEDNESDAY, and that is measured rather than chosen: on
 *  Serie A 2025-26 a Monday-anchored week splits 28 matchdays of 38 across two columns, a
 *  Thursday-anchored one splits 4. Clustering by gaps does not work at all - across five
 *  leagues and their cups there is football almost every day, so 240 dates collapse into 14
 *  groups, one of them 59 days long. */
const WEEK_ANCHOR = 4; // Thursday, as Date#getUTCDay counts it (Sunday = 0)

function weekOf(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`);
  const back = (day.getUTCDay() - WEEK_ANCHOR + 7) % 7;
  day.setUTCDate(day.getUTCDate() - back);
  return day.toISOString().slice(0, 10);
}

/** The championships a player's own league rows live under: everything else in the per-match
 *  layer is another competition. Measured on the bundle, not guessed. */
const LEAGUE_COMPETITIONS = new Set([
  'serie_a',
  'premier_league',
  'la_liga',
  'bundesliga',
  'ligue_1',
  'serie_b',
]);

/** Friendlies and pre-season tournaments. An unknown slug deliberately does NOT land here: it
 *  falls into the "other competitions" bucket, where it is visible and labelled, rather than
 *  being silently dropped. */
const FRIENDLY_COMPETITIONS = new Set([
  'club-friendly-games',
  'como-cup',
  'emirates-cup',
  'kings-cup',
]);

const COMPETITION_LABELS: Record<string, string> = {
  serie_a: 'Serie A',
  premier_league: 'Premier League',
  la_liga: 'LaLiga',
  bundesliga: 'Bundesliga',
  ligue_1: 'Ligue 1',
  serie_b: 'Serie B',
  'uefa-champions-league': 'Champions League',
  'uefa-europa-league': 'Europa League',
  'uefa-europa-conference-league': 'Conference League',
  'club-world-championship': 'Mondiale per club',
  'coppa-italia': 'Coppa Italia',
  'fa-cup': 'FA Cup',
  'efl-cup': 'EFL Cup',
  'copa-del-rey': 'Copa del Rey',
  'dfb-pokal': 'DFB-Pokal',
  'coupe-de-france': 'Coupe de France',
  'club-friendly-games': 'Amichevole',
  'como-cup': 'Como Cup',
  'emirates-cup': 'Emirates Cup',
};

export function competitionLabel(slug: string): string {
  return (
    COMPETITION_LABELS[slug] ??
    slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export function competitionKind(slug: string): MatchKind {
  if (LEAGUE_COMPETITIONS.has(slug)) return 'league';
  return FRIENDLY_COMPETITIONS.has(slug) ? 'friendly' : 'cup';
}

type Status = 'idle' | 'loading' | 'ready' | 'error';

@Injectable({ providedIn: 'root' })
export class PlayersStore {
  private readonly bundle = inject(Bundle);

  /**
   * CHI ALLENA UN CLUB E DA QUANDO: spell datati, per `fc_club_id`, dal piu' recente.
   *
   * Vuota su un bundle che non porta la tabella, e allora il confine non si disegna - che NON e' «non
   * ci sono stati cambi»: e' ignoto, e un separatore inventato sarebbe peggio di nessun separatore.
   */
  private readonly coaches = signal<Map<number, CoachSpell[]>>(new Map());
  /** I marchi che un nome porta: li possiede `PlayerStatus`, e il filtro legge quelli e non una copia. */
  private readonly marks = inject(PlayerStatus);
  /** Le squadre reali che l'operatore ha escluso: valgono per ogni vista, quindi tagliano il listone. */
  private readonly options = inject(GlobalOptions);

  readonly status = signal<Status>('idle');
  /** Le tabelle sono in casa: chi disegna aspetta questo invece di leggere mappe ancora vuote. */
  readonly ready = computed(() => this.status() === 'ready');
  readonly error = signal<string | null>(null);
  readonly generatedAt = signal<string | null>(null);
  readonly demo = signal(false);
  readonly scoring = signal<ScoringConfig | null>(null);
  /** fc_club_id -> the badge's file name. Missing club, missing file: the mark falls back to a
   *  monogram, which is what every club had before the badges existed. */
  readonly crests = signal<Record<string, string>>({});

  private readonly rosters = signal<Map<Platform, PlayerRow[]>>(new Map());
  /** `platform|season` -> fc_id -> matchday -> cell */
  private readonly league = signal<Map<string, Map<number, Map<number, MatchCell>>>>(new Map());
  /** season -> fc_id -> the cups and friendlies, already sorted by date */
  private readonly other = signal<Map<string, Map<number, MatchCell[]>>>(new Map());
  /** `platform|season` -> fc_id -> matchday -> why he is NOT in the ratings of that round */
  private readonly absence = signal<Map<string, Map<number, Map<number, MatchCell>>>>(new Map());

  readonly platform = signal<Platform>('default');
  readonly seasons = signal<string[]>([]);
  readonly season = signal<string>('');
  readonly lastMatchday = signal<number>(COLUMNS);
  readonly windowFrom = signal<number>(1);
  readonly windowTo = signal<number>(COLUMNS);

  readonly role = signal<ClassicRole | null>(null);
  readonly club = signal<string | null>(null);
  readonly sortBy = signal<'played' | 'name' | 'role'>('played');
  /** Un nome o un `fc_id`: la ricerca del tavolo, dove quello che si ha è il nome detto ad alta voce. */
  readonly search = signal<string>('');
  /** «Mostrami tutti i misteri»: i marchi che un uomo deve portare per restare in lista. Vuoto = tutti. */
  readonly flags = signal<PlayerFlag[]>([]);

  /** Which competitions the columns may show. Adding anything to `league` changes the unit of
   *  a column: a cup match has no matchday, so the columns become the player's last matches. */
  readonly withCups = signal(false);
  readonly withFriendlies = signal(false);
  readonly byMatchday = computed(() => !this.withCups() && !this.withFriendlies());

  /**
   * Il listone di questa piattaforma, SENZA le squadre reali escluse dalle opzioni globali.
   *
   * Il taglio sta qui e non nei filtri perché non è un filtro: è la popolazione di cui la vista parla.
   * `filtered`, l'elenco dei club, le colonne e ogni numero che descrive «questa lista» partono da qui,
   * quindi non può succedere che una lista sia una e i suoi numeri di un'altra - il difetto che questo
   * progetto ha già pagato più volte.
   */
  readonly roster = computed(() => this.options.keep(this.rosters().get(this.platform()) ?? []));

  readonly clubs = computed(() =>
    [...new Set(this.roster().map((p) => p.club))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
  );

  readonly matchdays = computed(() => this.daysOf(this.query()));

  /** The window as rounds, at most the last ten: more columns than that stop being readable. */
  private daysOf(query: MatchQuery): number[] {
    const to = query.to;
    const from = Math.max(query.from, to - COLUMNS + 1);
    const days: number[] = [];
    // LA PIU' RECENTE A SINISTRA (operatore, 06/09/2026: «l'ordine delle colonne deve essere inverso, a
    // sinistra le più recenti e a destra le più vecchie»). E' anche l'ordine che `recentMatches` - le
    // ultime partite della CARD - dichiara di se' da sempre: una tabella e una card che leggono la
    // stessa storia in due direzioni sono due vocabolari per un fatto solo.
    for (let md = to; md >= from; md--) days.push(md);
    return days;
  }

  /** The players the filters keep. Both the axis and the rows are built from this and nothing
   *  else, so the columns describe the table you are looking at - and the other mode of the same
   *  view values exactly these men, so the two tables can never be about two different lists. */
  readonly filtered = computed(() => {
    const role = this.role();
    const club = this.club();
    const wanted = plain(this.search());
    const byId = /^\d+$/.test(wanted);
    // Un uomo basta che ne porti UNO dei marchi chiesti: chi ne seleziona due vuole vedere le due liste
    // insieme, non l'intersezione, che è quasi sempre vuota.
    const flags = this.flags();
    const marked = (fcId: number): boolean =>
      this.marks.marksFor(fcId).some((mark) => flags.includes(mark.flag));
    return this.roster().filter(
      (p) =>
        (!role || p.role === role)
        && (!club || p.club === club)
        // Un id si cerca INTERO - `25` non deve tirar fuori tutti i 25xx - mentre un nome si cerca per
        // pezzo: al tavolo si sente «Esposito» e la riga giusta è «Esposito F.P.».
        && (!wanted || (byId ? String(p.fcId) === wanted : plain(p.name).includes(wanted)))
        && (!flags.length || marked(p.fcId)),
    );
  });

  /**
   * WHAT the table on screen is about, as one value.
   *
   * The filter bar owns these seven things and nothing else does; gathering them into a query is what
   * lets the SAME builder answer for another selection - one club's rosa in the squads view - without a
   * second copy of «le ultime partite» that could drift from this one.
   */
  readonly query = computed<MatchQuery>(() => ({
    platform: this.platform(),
    season: this.season(),
    from: this.windowFrom(),
    to: this.windowTo(),
    withCups: this.withCups(),
    withFriendlies: this.withFriendlies(),
    club: this.club(),
  }));

  private readonly table = computed(() => this.matchTable(this.query(), this.filtered()));

  /** The columns of the table on screen. Built with its rows, from the same query. */
  readonly columns = computed<ColumnSlot[]>(() => this.table().columns);

  readonly lines = computed<PlayerLine[]>(() => {
    const lines = [...this.table().lines];
    if (this.sortBy() === 'role') {
      const order: Record<ClassicRole, number> = { P: 0, D: 1, C: 2, A: 3 };
      lines.sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name));
    } else if (this.sortBy() === 'played') {
      // Counting non-empty cells would now count the ABSENCES too - every round has a cell
      // since they carry their reason. What the operator asked to sort by is appearances.
      const played = (line: PlayerLine) =>
        line.cells.reduce((n, c) => n + (c && (c.state === 'played' || c.state === 'no_vote') ? 1 : 0), 0);
      lines.sort((a, b) => played(b) - played(a) || a.name.localeCompare(b.name));
    }
    return lines;
  });

  /**
   * The match table of ANY selection: the axis and the rows, built together and in the order given.
   *
   * A METHOD and not a computed, because two views ask it about two different lists - the whole listone
   * behind the filter bar, and one club's rosa in the squads view - and the answer must be one
   * definition for both. The ORDER of `players` is kept, so the caller decides how the list reads and
   * the two tables of a view can be the same list twice.
   */
  /**
   * GLI SPELL DI PANCHINA DI UN CLUB, dal suo NOME - e null senza un club a schermo.
   *
   * Il nome si risolve sull'INDICE che la tabella dei club dichiara (`fc_club_id` <-> nome canonico) e
   * non con un confronto fuzzy: e' una chiave letta all'incontrario, non il join per stringa che a
   * questo progetto e' costato Milan, Roma e Napoli. Un club che quella tabella non nomina non ha
   * spell, e allora il confine non si disegna.
   */
  private spellsFor(club: string | null | undefined): CoachSpell[] | undefined {
    if (!club) return undefined;
    for (const [id, name] of this.clubNames()) if (name === club) return this.coaches().get(id);
    return undefined;
  }

  matchTable(query: MatchQuery, players: readonly PlayerRow[]): MatchTable {
    const slots = byMatchdayOf(query)
      ? this.daysOf(query).map((md) => ({
          key: String(md),
          label: String(md),
          detail: null,
          score: null,
          outcome: null,
          sides: null,
          shape: null,
          formation: null,
          matchId: null,
          matchClub: null,
          divider: null,
          breakKind: null,
          date: null,
          kind: null,
          title: `Giornata ${md}`,
        }))
      : this.weekSlots(query, players);
    return {
      columns: this.namedColumns(query, players, slots),
      lines: this.rowsOf(query, players, slots),
    };
  }

  /**
   * L'IDENTITA' DI UN CLUB dal nome che una fonte usa per chiamarlo - e solo per uno STEMMA.
   *
   * Di un avversario questo progetto tiene il nome del provider e niente che lo identifichi, quindi
   * finora ogni avversario si disegnava col monogramma. Il nome si normalizza dai DUE lati con la
   * stessa lista di parole vuote che `nameWords` usa gia' per abbreviare (`AC Milan` -> `milan`,
   * `SSC Napoli` -> `napoli`), che e' l'alias di casa e non una lista nuova.
   *
   * MISURATO PRIMA DI TENERLO, perche' un join per NOME e' il difetto che questo repository paga da
   * sempre: sui 106 club del bundle le chiavi normalizzate sono 106, cioe' ZERO collisioni; sulle
   * ultime due stagioni risolve il 95,2% delle righe di Serie A (22 avversari su 23) e molto meno
   * altrove (Bundesliga 10,9%, dove il provider scrive `1. FC Koln` e il listone `Colonia`). Per
   * questo la risposta e' `null` e non un ripiego: chi non si risolve resta col MONOGRAMMA, che e'
   * esattamente quello che aveva prima. Un fatto che decide un numero non passerebbe mai di qui.
   */
  clubIdOf(name: string | null): number | null {
    return this.clubIds().get(clubNameKey(name)) ?? null;
  }

  /**
   * L'indice dei nomi normalizzati, costruito su TUTTA la tabella dei club.
   *
   * Prima si costruiva sulle ROSE, cioe' sui soli club che hanno almeno un quotato: **47 chiavi**
   * contro le 106 della tabella - ed e' la tabella quella su cui la misura qui sopra («sui 106 club
   * del bundle le chiavi normalizzate sono 106, zero collisioni») era stata fatta. Il commento
   * descriveva un indice e il codice ne costruiva un altro, che e' «verifica la FUNZIONE, non la
   * colonna che le somiglia» applicato a se stesso.
   *
   * Quanto costava, misurato sul bundle del 05/09/2026: il club di una riga di CAMPIONATO
   * (`match_ratings.team`) si risolveva **90,1%** delle volte invece del 100% - restavano fuori
   * Verona, Pisa, Cremonese, Empoli, cioe' i club senza un quotato in questo listone, che sono
   * esattamente quelli di cui si guarda una stagione passata - e il layer per-partita passava dal
   * 48,4% al 61,3%. Nessuna riga in piu' nel bundle: la tabella era gia' in casa.
   */
  private readonly clubIds = computed<Map<string, number>>(() => {
    const out = new Map<string, number>();
    for (const [id, name] of this.clubNames()) {
      const key = clubNameKey(name);
      if (key) out.set(key, id);
    }
    return out;
  });

  /** `fc_club_id` -> il nome canonico, dalla tabella dei club: la sola cosa che serve qui. */
  private readonly clubNames = signal<Map<number, string>>(new Map());

  /**
   * IL NOME DI OGNI UOMO CHE IL PACCHETTO CONOSCE, non solo di quelli che un listone quota.
   *
   * `rosters` risponde «chi e' in questo listone quest'anno» e questa tabella «chi e' questo `fc_id`»:
   * sono due domande, e chi ricostruisce una formazione gia' giocata ha bisogno della seconda - su 656
   * titolari di Serie A del 2026-27, otto righe sono di uomini che il listone non quota o da' per
   * ceduti (David, Dia, Pedersen...), e nominarli `#5544` sarebbe un buco al posto di un fatto.
   */
  private readonly playerNames = signal<Map<number, string>>(new Map());

  /**
   * CHI HA GIOCATO UNA PARTITA, per la coppia (id dell'evento, club nella grafia del provider).
   *
   * Legge il layer per-partita GREZZO e non le righe della tabella, ed e' una scelta: le righe di una
   * tabella sono la rosa QUOTATA, quindi un titolare che il listone non ha sparirebbe dall'undici - e
   * sono misurati, otto su 656 in Serie A, fra cui uomini che quel giorno hanno giocato dal primo
   * minuto. Qui la domanda e' «chi c'era», non «chi posso comprare».
   *
   * UNA SCANSIONE E NON UN INDICE, di proposito: la tabella e' gia' in memoria (`Bundle` tiene la
   * promessa in cache e altri due lettori la chiedono) e un indice per partita sarebbe centoventottomila
   * voci tenute in piedi per un click. Il risultato dell'ultima richiesta resta da parte, perche' il
   * gesto che la produce - passare da una colonna all'altra - la rifa' subito.
   */
  async lineupOf(matchId: string, club: string): Promise<LineupMan[]> {
    const key = `${matchId}|${club}`;
    if (this.lastLineup?.key === key) return this.lastLineup.men;
    const table = await this.bundle.table('external_match_stats');
    const [id, match, team, position, started, minutes] = columnIndex(
      table, 'fc_id', 'match_id', 'club', 'position', 'started', 'minutes');
    // IL POSTO NEL MODULO, quando il pacchetto lo porta: e' arrivato il 12/09/2026, quindi su uno piu'
    // vecchio la colonna non esiste proprio - `optionalIndex` risponde -1 e la riga legge null, che e'
    // ignoto e fa tornare il disegno al ripiego dei codici.
    const slot = optionalIndex(table, 'lineup_slot');
    // DI CHI HA PRESO IL POSTO chi e' entrato, e dove ha giocato davvero: arrivate il 12/09/2026
    // dall'endpoint delle posizioni medie, che porta i due fatti in una risposta sola. Su un pacchetto
    // piu' vecchio le colonne non esistono e la riga legge null - ignoto, e il disegno torna al
    // ripiego dei profili.
    const cameFor = optionalIndex(table, 'came_for');
    const lateral = optionalIndex(table, 'avg_y');
    const names = this.playerNames();
    const men: LineupMan[] = [];
    for (const row of table.rows) {
      if (row[match] !== matchId || row[team] !== club) continue;
      const fcId = row[id] as number;
      men.push({
        fcId,
        name: names.get(fcId) ?? `#${fcId}`,
        // Solo le quattro che la fonte scrive: qualunque altra cosa e' ignoto, e un ignoto non si
        // disegna in una riga scelta a caso.
        position: POSITIONS.has(row[position] as string) ? (row[position] as MatchPosition) : null,
        started: row[started] === 1,
        minutes: (row[minutes] as number) ?? null,
        slot: slot < 0 ? null : ((row[slot] as number) ?? null),
        cameFor: cameFor < 0 ? null : ((row[cameFor] as number) ?? null),
        lateral: lateral < 0 ? null : ((row[lateral] as number) ?? null),
      });
    }
    this.lastLineup = { key, men };
    return men;
  }

  private lastLineup: { key: string; men: LineupMan[] } | null = null;

  /**
   * LE ULTIME `count` PARTITE di un uomo - OGNI competizione - la piu' recente per prima.
   *
   * Un METODO su questo store e non un conto scritto dove serve, per la ragione che `MatchQuery` gia'
   * scrive di se': «una seconda implementazione di "le ultime partite" sarebbe una seconda risposta a
   * una domanda che questo store risponde gia'». La card di un calciatore e' il terzo lettore dopo la
   * tabella e le rose, e le sue righe devono essere le stesse celle - stato, voto, bonus e fantavoto -
   * o lo stesso uomo finirebbe con due storie.
   *
   * ATTRAVERSA LE STAGIONI, ed e' il motivo per cui non passa da `matchTable`: quella risponde su UNA
   * stagione, e alla seconda giornata di campionato «le ultime cinque» sono due di quest'anno e tre
   * dell'anno scorso. Le stagioni si camminano dalla piu' recente all'indietro e ci si ferma appena si
   * hanno le partite chieste.
   *
   * OGNI GIORNATA HA UNA RIGA, giocata o no: se non e' nei voti la cella viene dalle ASSENZE e porta la
   * sua ragione (panchina, infortunio, non in questo campionato). E' il punto della richiesta - «una
   * icona che mi indica se era infortunato | non disponibile | panchina» - e senza le assenze una
   * lista di cinque partite mostrerebbe le ultime cinque in cui ha giocato, che e' un'altra domanda e
   * una molto piu' lusinghiera.
   *
   * E DAL 05/09/2026 NON E' PIU' SOLO IL SUO CAMPIONATO (richiesta dell'operatore: «i voti sintetici
   * devono essere utilizzati anche dall'app per ricostruire lo storico del calciatore anche quando ha
   * giocato fuori dalla serie A ... dobbiamo sempre mostrare cosa ha fatto, non mi basta vedere la data
   * della partita»). Il perche' e' una misura sul bundle e non un'opinione: Kolo Muani non ha UNA SOLA
   * riga di Serie A nel 2025-26, quindi la card diceva «nessuna sua giornata in questo campionato» a
   * proposito di un uomo che quella stagione ha giocato **32 partite di Premier League** col Tottenham
   * - e di ognuna il bundle porta gia' l'avversario, il campo, i minuti, il rating e il risultato.
   * `seasonMatches` fonde le tre sorgenti; qui restano solo le stagioni e il conteggio.
   */
  recent(fcId: number, platform: Platform, want: RecentWant): RecentMatch[] {
    const out: RecentMatch[] = [];
    const seasons = this.seasonsWith(fcId, platform);
    for (const season of want.seasons == null ? seasons : seasons.slice(0, want.seasons)) {
      for (const cell of this.matchesOf(fcId, platform, season)) {
        // La STAGIONE viaggia accanto alla cella e non dentro: `MatchCell` non la porta - la tabella di
        // consultazione ne guarda una alla volta - e chi disegna una lista che le attraversa deve poter
        // dire dove finisce l'una e comincia l'altra senza dedurlo dal numero di giornata.
        out.push({ season, cell });
        if (want.count != null && out.length >= want.count) return out;
      }
    }
    return out;
  }

  /**
   * LE STAGIONI IN CUI HA GIOCATO QUALCOSA, la piu' recente per prima.
   *
   * UNA STAGIONE SI CONTA SE PRODUCE QUALCOSA, ed e' il motivo per cui questo elenco esiste invece di
   * `seasons()`: una stagione in cui non ha giocato non e' una stagione «vista», quindi non deve
   * consumare il numero di stagioni chieste. Contandola, l'elenco APERTO leggeva meno partite di quello
   * chiuso - misurato: un portiere del Venezia passava da cinque righe a due, perche' la sua seconda
   * stagione era di Serie B e bruciava il posto della terza.
   *
   * Lo leggono in due e devono dare la stessa risposta: `recent`, per sapere dove fermarsi, e la CARD,
   * per sapere quale stagione offrire col tasto «carica». Un secondo conto di «quali sono le sue
   * stagioni» finirebbe per offrire un tasto che non carica niente.
   */
  seasonsWith(fcId: number, platform: Platform): string[] {
    // `seasons()` e' ordinato crescente e porta anche quella bersaglio, che a inizio agosto non ha
    // ancora una riga - e allora si scavalca da se'.
    return [...this.seasons()]
      .reverse()
      .filter((season) => this.matchesOf(fcId, platform, season).length > 0);
  }

  /**
   * Tutto il calcio di UNA stagione, gia' in ordine: le tre sorgenti fuse da `seasonMatches`.
   *
   * PUBBLICO perche' il riepilogo di stagione della card lo legge da qui e non dalle righe che sta
   * disegnando: l'elenco puo' essere troncato (chiuso ne mostra cinque), e una media calcolata su
   * quelle direbbe «stagione» a proposito di tre partite. Lo stesso lettore di `recent`, quindi le due
   * cose non possono descrivere due popolazioni diverse.
   */
  matchesOf(fcId: number, platform: Platform, season: string): MatchCell[] {
    return seasonMatches(
      this.league().get(`${platform}|${season}`)?.get(fcId),
      this.absence().get(`${platform}|${season}`)?.get(fcId),
      this.other().get(season)?.get(fcId),
      season,
    );
  }

  /** The last league round this season has ratings for: where «le ultime partite» end. */
  lastMatchdayOf(platform: Platform, season: string): number {
    let last = COLUMNS;
    for (const byDay of this.league().get(`${platform}|${season}`)?.values() ?? []) {
      for (const md of byDay.keys()) if (md > last) last = md;
    }
    return last;
  }

  /**
   * L'ULTIMA GIORNATA CHE HA DAVVERO UNA RIGA, o zero: e non `lastMatchdayOf`, che ha un PAVIMENTO di
   * dieci - giusto per una finestra da mostrare («le ultime dieci» di una stagione appena cominciata
   * sono comunque dieci colonne), sbagliato per chiedersi quanto calcio c'e' in archivio.
   */
  playedMatchdayOf(platform: Platform, season: string): number {
    let last = 0;
    for (const byDay of this.league().get(`${platform}|${season}`)?.values() ?? []) {
      for (const md of byDay.keys()) if (md > last) last = md;
    }
    return last;
  }

  /**
   * LE ULTIME `COLUMNS` GIORNATE IN ASSOLUTO, attraversando le stagioni (operatore, 06/09/2026:
   * «mostra le ultime 10 partite in assoluto e non solo della stagione precedente»).
   *
   * `matchTable` risponde su UNA stagione e resta com'e': un asse di colonne e' una stagione e una
   * finestra, e la seconda giornata di campionato ha due colonne e non dieci. Questa le COMPONE - la
   * piu' recente per prima, indietro finche' le colonne bastano - e fra due blocchi mette un CONFINE,
   * che e' una colonna che non e' una partita. Le righe si concatenano per POSIZIONE, che e' lecito
   * perche' `matchTable` conserva l'ordine dei giocatori che gli si passa: e' scritto nel suo
   * docstring, ed e' anche la ragione per cui le due tabelle di una vista possono essere la stessa
   * lista due volte.
   *
   * Le stagioni si passano dalla PIU' RECENTE: chi chiama sa quali sono (il foglio dichiara la sua
   * stagione bersaglio e quella misurata) e questo store non le indovina.
   */
  matchTableAcross(
    query: MatchQuery,
    seasons: readonly string[],
    players: readonly PlayerRow[],
  ): MatchTable {
    const blocks: { season: string; table: MatchTable }[] = [];
    let need = COLUMNS;
    for (const season of seasons) {
      if (need <= 0) break;
      const last = this.playedMatchdayOf(query.platform, season);
      if (!last) continue;
      const table = this.matchTable(
        { ...query, season, from: Math.max(1, last - need + 1), to: last },
        players,
      );
      if (!table.columns.length) continue;
      blocks.push({ season, table });
      need -= table.columns.length;
    }
    if (blocks.length < 2) return blocks[0]?.table ?? this.matchTable(query, players);

    // I blocchi restano nell'ordine in cui sono stati raccolti - dalla stagione PIU' RECENTE - perche'
    // le colonne si leggono da sinistra con la partita piu' recente per prima (operatore, 06/09/2026).
    const columns: ColumnSlot[] = [];
    const cells: (MatchCell | null)[][] = players.map(() => []);
    blocks.forEach((block, at) => {
      if (at > 0) {
        // Il confine porta le due stagioni NELL'ORDINE IN CUI SONO DISEGNATE: a sinistra la piu'
        // recente, quindi la freccia va indietro nel tempo come la lettura della tabella.
        const before = blocks[at - 1].season;
        columns.push({
          key: `border|${before}|${block.season}`,
          label: '',
          detail: null,
          score: null,
          outcome: null,
          sides: null,
          shape: null,
          formation: null,
          matchId: null,
          matchClub: null,
          divider: `${before} → ${block.season}`,
          breakKind: 'season',
          date: null,
          kind: null,
          title: `Confine fra le stagioni ${before} e ${block.season}`,
        });
        for (const row of cells) row.push(null);
      }
      columns.push(...block.table.columns);
      block.table.lines.forEach((line, index) => cells[index]?.push(...line.cells));
    });
    // ...E I CONFINI DI PANCHINA, che stanno DENTRO una stagione e non fra due: si inseriscono dopo
    // aver unito i blocchi, cosi' un cambio a cavallo di due stagioni non ne produce due (quello la'
    // e' gia' detto dal confine di stagione, e due separatori attaccati direbbero la stessa cosa due
    // volte). Solo con un club a schermo: un allenatore e' un fatto di CLUB.
    const withCoaches = withCoachBreaks(columns, cells, this.spellsFor(query.club));
    // L'identita' delle righe viene dal primo blocco: sono gli stessi uomini nello stesso ordine.
    const lines = blocks[0].table.lines.map(
      (line, index) => ({ ...line, cells: withCoaches.cells[index] ?? [] }));
    return { columns: withCoaches.columns, lines };
  }

  /**
   * The columns, in both modes. With a club selected each one also names the fixture it is about -
   * possible only then, because without a filter one week holds many matches.
   */
  private namedColumns(
    query: MatchQuery,
    players: readonly PlayerRow[],
    slots: ColumnSlot[],
  ): ColumnSlot[] {
    if (!query.club) return slots;
    const leagueBySeason = this.league().get(`${query.platform}|${query.season}`);
    const otherBySeason = this.other().get(query.season);

    /**
     * WHICH club these columns are about, in the spelling the ratings use, and which of its matches
     * falls in each column.
     *
     * «Qualunque uomo del club va bene: hanno giocato la stessa partita» is false for exactly the men
     * a summer listone is full of: the rosa is next season's and the rows are last season's, so a
     * signing carries his OLD club's fixtures - measured here, an Arsenal column read `Oly-???`, a
     * Ligue 1 match of a man Arsenal has just bought. The club is therefore taken as the team that
     * carries the MOST cells over the whole table - one man's ten rows cannot outweigh a squad's two
     * hundred - which settles it by weight of evidence and never by joining a club NAME across two
     * sources, the defect this project keeps paying for.
     *
     * A column with no match OF THAT TEAM keeps its plain round number: on a euro round the calendar
     * did not bundle for this championship the rosa has no rated row at all, and naming the column
     * after the only foreign match in it would write somebody else's fixture over this club's.
     * «Vuoto = ignoto», applied to a header.
     */
    const bySlot = new Map<string, MatchCell[]>();
    const weight = new Map<string, number>();
    for (const player of players) {
      const candidates = [
        ...(leagueBySeason?.get(player.fcId)?.values() ?? []),
        ...(otherBySeason?.get(player.fcId) ?? []),
      ];
      for (const cell of candidates) {
        const key = this.slotOf(cell, query);
        if (!key) continue;
        const found = bySlot.get(key);
        found ? found.push(cell) : bySlot.set(key, [cell]);
        // Only the LEAGUE rows vote for the club's spelling: a cup tie is played by the same club
        // under the same name, and a friendly can be played by a squad the rosa barely shares.
        if (cell.kind === 'league') weight.set(cell.team, (weight.get(cell.team) ?? 0) + 1);
      }
    }
    let team: string | null = null;
    for (const [name, seen] of weight) if (!team || seen > weight.get(team)!) team = name;

    return slots.map((slot) => {
      const own = (bySlot.get(slot.key) ?? []).filter((cell) => cell.team === team);
      // Where the same club has both in one week, the league match is the column's subject: the cup
      // tie is named in the tooltip of the cell, not in the header of the column.
      const chosen = own.find((cell) => cell.kind === 'league') ?? own[0];
      if (!chosen || (!chosen.opponent && !chosen.team)) return slot;
      const fixture = fixtureLabel(chosen);
      return {
        ...slot,
        label: fixture.label,
        // Il RISULTATO viaggia a parte perche' ha un colore suo; sotto resta il modulo, e il numero di
        // giornata solo dove un punteggio non c'e' - altrimenti la seconda riga direbbe due volte
        // «quale partita e' questa».
        score: fixture.detail,
        outcome: fixture.outcome,
        sides: fixture.sides,
        shape: chosen.shape,
        formation: chosen.formation,
        // DALLA CELLA SCELTA e non da un'altra: la colonna e il suo undici devono descrivere la stessa
        // partita, che e' la stessa ragione per cui `shape` viene da qui e non da un secondo conto.
        matchId: chosen.matchId,
        matchClub: chosen.matchClub,
        detail: [fixture.detail ? null : slot.label, chosen.shape].filter(Boolean).join(' · ') || null,
        date: chosen.date ?? null,
        kind: chosen.kind,
        title: `${chosen.competitionLabel} · ${fixture.long}${chosen.shape ? ' · modulo ' + chosen.shape : ''} · ${slot.title}`,
      };
    });
  }

  /** Which column a cell belongs to: the matchday, or the week. */
  private slotOf(cell: MatchCell, query: MatchQuery): string {
    if (byMatchdayOf(query)) return cell.matchday == null ? '' : String(cell.matchday);
    return cell.date ? weekOf(cell.date) : '';
  }

  /** The shared axis of the mixed view: the last ten WEEKS in which anything was played BY THE
   *  PLAYERS ON SCREEN, so column 3 is the same week for every row and no column is spent on a
   *  week none of them played. Filter by club and the axis follows the club. */
  private weekSlots(query: MatchQuery, players: readonly PlayerRow[]): ColumnSlot[] {
    const leagueBySeason = this.league().get(`${query.platform}|${query.season}`);
    const otherBySeason = this.other().get(query.season);

    /** week -> the matchdays played in it, and the earliest date seen */
    const weeks = new Map<string, { matchdays: Set<number>; first: string; last: string }>();
    const note = (cell: MatchCell) => {
      const week = cell.date ? weekOf(cell.date) : null;
      if (!week) return;
      let entry = weeks.get(week);
      if (!entry) weeks.set(week, (entry = { matchdays: new Set(), first: cell.date!, last: cell.date! }));
      if (cell.matchday != null && cell.kind === 'league') entry.matchdays.add(cell.matchday);
      if (cell.date! < entry.first) entry.first = cell.date!;
      if (cell.date! > entry.last) entry.last = cell.date!;
    };
    for (const player of players) {
      for (const cell of leagueBySeason?.get(player.fcId)?.values() ?? []) note(cell);
      for (const cell of otherBySeason?.get(player.fcId) ?? []) {
        if (shownBy(cell, query)) note(cell);
      }
    }

    return [...weeks.entries()]
      // Le ultime `COLUMNS` settimane, e poi girate: la piu' recente a sinistra come le giornate.
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-COLUMNS)
      .reverse()
      .map(([key, entry]) => {
        const days = [...entry.matchdays].sort((a, b) => a - b);
        const range =
          entry.first === entry.last ? day(entry.first) : `${day(entry.first)}-${day(entry.last)}`;
        return {
          key,
          label: days.length ? days.join('/') : day(entry.first).slice(0, 5),
          detail: null,
          score: null,
          outcome: null,
          sides: null,
          shape: null,
          formation: null,
          matchId: null,
          matchClub: null,
          divider: null,
          breakKind: null,
          date: null,
          kind: null,
          title: days.length ? `Giornata ${days.join(', ')} · ${range}` : range,
        };
      });
  }

  /** One row per player: his cell under every column of the axis, in the axis's own order. */
  private rowsOf(
    query: MatchQuery,
    players: readonly PlayerRow[],
    slots: ColumnSlot[],
  ): PlayerLine[] {
    const leagueBySeason = this.league().get(`${query.platform}|${query.season}`);
    const absenceBySeason = this.absence().get(`${query.platform}|${query.season}`);
    const otherBySeason = this.other().get(query.season);
    const byMatchday = byMatchdayOf(query);

    return players.map((p) => {
      const own = leagueBySeason?.get(p.fcId);
      if (byMatchday) {
        // A round he is not in the ratings of is not an empty cell: it has a reason, and the
        // reason is the point of the column.
        const missing = absenceBySeason?.get(p.fcId);
        return {
          ...p,
          cells: slots.map((slot) => {
            const md = Number(slot.key);
            return own?.get(md) ?? missing?.get(md) ?? null;
          }),
        };
      }
      // Mixed competitions: a column is a WEEK of the shared axis, not this player's own
      // nth-from-last match - otherwise column 3 means a different date on every row.
      const matches = [...(own?.values() ?? [])];
      for (const cell of otherBySeason?.get(p.fcId) ?? []) {
        if (shownBy(cell, query)) matches.push(cell);
      }
      const byWeek = new Map<string, MatchCell[]>();
      for (const cell of matches) {
        if (!cell.date) continue; // no date, no column it can honestly sit in
        const week = weekOf(cell.date);
        const list = byWeek.get(week);
        list ? list.push(cell) : byWeek.set(week, [cell]);
      }
      return {
        ...p,
        cells: slots.map((slot) => {
          const week = byWeek.get(slot.key);
          if (!week?.length) return null;
          // Two matches in one week: the league one is the column's subject, the other is
          // named in the tooltip rather than dropped in silence.
          const chosen = week.find((c) => c.kind === 'league') ?? week[0];
          return week.length > 1 ? { ...chosen, alsoInWeek: week.length - 1 } : chosen;
        }),
      };
    });
  }

  /** One load for every caller: the squads view asks for the same layer and must AWAIT this one,
   *  not walk past it while it is still being built. */
  private pending: Promise<void> | null = null;

  load(): Promise<void> {
    this.pending ??= this.read();
    return this.pending;
  }

  private async read(): Promise<void> {
    this.status.set('loading');
    this.error.set(null);
    try {
      const manifest = await this.bundle.manifest();
      const [players, clubs, rosters, quotes, ratings, external, map, injuries, lineups, scoring,
        crests, coaches] = await Promise.all([
        this.bundle.table('players'),
        this.bundle.table('clubs'),
        this.bundle.table('rosters'),
        this.bundle.table('listone_quotes'),
        this.bundle.table('match_ratings'),
        this.bundle.table('external_match_stats'),
        this.bundle.table('matchday_map'),
        this.bundle.table('injuries'),
        this.bundle.table('club_match_lineups'),
        // A missing scoring file must not take the table down with it: the panel then shows
        // the events without their points, which is less than the truth but never a wrong one.
        this.bundle.scoring().catch(() => null),
        // Optional by design: a bundle exported before the badges existed simply has none.
        this.bundle.crests().catch(() => null),
        // CHI ALLENA E DA QUANDO: opzionale allo stesso modo, e un bundle che non la porta semplicemente
        // non disegna il confine - che e' diverso da «non ci sono stati cambi».
        this.bundle.table('coaches').catch(() => null),
      ]);

      this.generatedAt.set(manifest.generated_at);
      this.demo.set(manifest.demo === true);
      this.scoring.set(scoring);
      this.crests.set(crests ?? {});
      this.coaches.set(buildCoachSpells(coaches));

      /* LE RIGHE DEL FOGLIO, per completare e correggere il listone. Dal `SHEET_REVISION` 26 il foglio è
       * costruito sulle rose OSSERVATE, quindi porta chi il listone non quota e il club vero di chi si è
       * mosso: senza questo, la vista mostrava Molina all'Atlético su euro e non lo mostrava affatto su
       * Serie A, mentre il foglio lo aveva già alla Roma. Le tabelle sono in cache, quindi leggerle qui non
       * costa una richiesta in più: le legge anche il ValuationStore. */
      const roster = buildRosters(players, clubs, rosters, quotes, manifest.target_season,
                                  await sheetIdentities(this.bundle, manifest));
      this.rosters.set(roster);
      // ...e la tabella dei GIOCATORI intera, per la stessa ragione: chi ricostruisce una formazione
      // gia' giocata incontra uomini che questo listone non quota piu'.
      const [nameId, nameOf] = columnIndex(players, 'fc_id', 'canonical_name');
      this.playerNames.set(
        new Map(players.rows.map((row) => [row[nameId] as number, row[nameOf] as string])),
      );
      // La tabella dei club serve intera - e non solo per chi ha un quotato - all'indice degli stemmi.
      const [clubId, clubName] = columnIndex(clubs, 'fc_club_id', 'canonical_name');
      this.clubNames.set(
        new Map(clubs.rows.map((row) => [row[clubId] as number, row[clubName] as string])),
      );

      const leagueOf = new Map<number, string | null>();
      for (const list of roster.values()) for (const p of list) leagueOf.set(p.fcId, p.league);

      // UNA DEFINIZIONE SOLA di dove gli attesi esistono, passata ai due lettori del layer per-partita:
      // due copie darebbero a una partita due xG, uno misurato e uno inventato.
      const expected = expectedScope(external);
      const provider = buildProviderIndex(external, expected);
      const euroToReal = buildMatchdayMap(map);
      const shapes = buildShapes(lineups);
      const built = buildLeagueMatches(ratings, provider.index, leagueOf, euroToReal, shapes, scoring);
      this.league.set(built);
      this.absence.set(
        buildAbsences(built, roster, provider, euroToReal, buildInjuries(injuries)),
      );

      // LA STAGIONE BERSAGLIO STA GIA' DENTRO se qualcuno ha giocato una giornata, quindi il `Set` la
      // deve contenere: aggiungerla FUORI la elencava due volte, e chi cammina questa lista leggeva le
      // stesse partite due volte (la card di un calciatore mostrava «le ultime cinque» con due doppioni).
      const seasons = [
        ...new Set([...[...built.keys()].map((key) => key.split('|')[1]), manifest.target_season]),
      ].sort();
      this.seasons.set(seasons);
      const roleOf = new Map<number, ClassicRole>();
      for (const list of roster.values()) for (const p of list) roleOf.set(p.fcId, p.role);
      this.other.set(
        buildOtherMatches(external, expected, new Set(seasons), leagueOf, shapes, scoring, roleOf),
      );

      this.selectSeason(seasons.at(-2) ?? seasons.at(-1) ?? '');
      this.status.set('ready');
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
      this.status.set('error');
      // A failure must not be cached as an answer: the next view that asks gets a real attempt.
      this.pending = null;
    }
  }

  selectPlatform(platform: Platform): void {
    this.platform.set(platform);
    this.club.set(null); // the club lists do not overlap: keeping a filter would empty the table
    this.selectSeason(this.season());
  }

  selectSeason(season: string): void {
    this.season.set(season);
    const last = this.lastMatchdayOf(this.platform(), season);
    this.lastMatchday.set(last);
    this.windowFrom.set(Math.max(1, last - COLUMNS + 1));
    this.windowTo.set(last);
  }

  setWindow([from, to]: [number, number]): void {
    this.windowFrom.set(from);
    this.windowTo.set(to);
  }
}

/** Club-form words neither side of a fixture label needs. */
const ABBREVIATION_SKIP = new Set(['ac', 'as', 'ss', 'ssc', 'fc', 'rc', 'afc', 'us', 'ol', 'rb']);

/** The words of a club's name that actually name it: `AC Milan` -> `['Milan']`. */
export function nameWords(name: string | null): string[] {
  return (name ?? '').split(/\s+/).filter((word) => word && !ABBREVIATION_SKIP.has(word.toLowerCase()));
}

/** Lo stesso nome come CHIAVE, senza le parole che non nominano nessuno: `SSC Napoli` e `Napoli`
 *  sono lo stesso club, e questa e' la sola cosa che li fa incontrare. Usata solo per gli STEMMI
 *  (`PlayersStore.clubIdOf`), mai per un numero. */
export function clubNameKey(name: string | null): string {
  return nameWords(name ?? '')
    .map((word) => plain(word))
    .filter(Boolean)
    .join(' ');
}

/** `Napoli` -> `Nap`, `Borussia Dortmund` -> `Bor`, `AC Milan` -> `Mil`. Three letters is what
 *  fits a column; the full fixture stays in the header's title. */
export function abbreviate(name: string | null): string {
  if (!name) return '???';
  return (nameWords(name)[0] ?? name).slice(0, 3);
}

/** The fixture as it is written: home first, plus how it ended FOR THIS CELL'S CLUB. */
function fixtureLabel(cell: MatchCell): {
  label: string;
  detail: string | null;
  outcome: 'win' | 'draw' | 'loss' | null;
  sides: { name: string; goals: number | null }[];
  long: string;
} {
  const away = cell.home === false;
  const left = away ? cell.opponent : cell.team;
  const right = away ? cell.team : cell.opponent;
  const leftGoals = away ? cell.goalsAgainst : cell.goalsFor;
  const rightGoals = away ? cell.goalsFor : cell.goalsAgainst;
  const score =
    leftGoals != null && rightGoals != null ? `${leftGoals}-${rightGoals}` : null;
  // L'esito e' del CLUB della riga e non di chi giocava in casa: `goalsFor` e `goalsAgainst` sono suoi.
  const outcome =
    cell.goalsFor == null || cell.goalsAgainst == null
      ? null
      : cell.goalsFor > cell.goalsAgainst
        ? 'win'
        : cell.goalsFor < cell.goalsAgainst
          ? 'loss'
          : 'draw';
  return {
    label: `${abbreviate(left)}-${abbreviate(right)}`,
    detail: score,
    outcome,
    // In casa per prima, che e' come si scrive un tabellino: chi guarda impara che se il suo club sta
    // sopra ha giocato in casa, e non serve un secondo marchio per dirlo.
    sides: [
      { name: abbreviate(left), goals: leftGoals ?? null },
      { name: abbreviate(right), goals: rightGoals ?? null },
    ],
    long: `${left ?? 'Ignota'} - ${right ?? 'Ignota'}${score ? ' ' + score : ''}`,
  };
}

/**
 * Un testo come lo si digita: senza accenti, senza maiuscole, senza spazi ai bordi.
 *
 * Gli accenti si tolgono da TUTTI E DUE i lati, o «Perez» non troverebbe «Pérez» - e chi cerca non ha
 * modo di sapere quale delle due grafie abbia il listone.
 */
export function plain(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** dd/mm/yyyy: a date in a header is read by a person. */
/** `2026-09-07` -> `07/09/2026`. Esportata perche' chi legge una `ColumnSlot.date` la stampa: la data
 *  di una partita e' scritta qui, quindi il modo di leggerla sta qui e non in una quarta copia. */
export function day(iso: string): string {
  return iso.split('-').reverse().join('/');
}

/**
 * LE TRE SORGENTI DI UNA STAGIONE fuse in un elenco solo, in ordine di data, la piu' recente per prima.
 *
 * Una FUNZIONE e non un metodo perche' e' la definizione di «tutto il calcio che ha giocato», e una
 * definizione dev'essere raggiungibile da un test senza costruire mezzo bundle: `PlayersStore` le passa
 * le tre mappe e non fa altro.
 *
 * L'ORDINE E' LA DATA e non la giornata, perche' mescolando i campionati la giornata non e' piu' un
 * asse: la 38ª di Premier e la 3ª di Serie A stanno in due calendari diversi. `sortKey` e' la stessa
 * scala d'ordinamento che la tabella usa gia', col ripiego sulla giornata per le celle senza data.
 *
 * I VOTI BATTONO L'ASSENZA: una giornata sta in tutt'e due le mappe solo se qualcosa non torna, e la
 * riga che porta il voto e' quella che ne sa di piu'.
 *
 * ...e UNA GIORNATA DI CUI NON SI SA NIENTE NON E' UNA SUA PARTITA. `not_in_league` e `absent` vogliono
 * dire che di lui, quel giorno, questo campionato non ha nessuna traccia - ne' una pagella ne' una
 * distinta - quindi non si sa nemmeno contro chi giocasse, ne' che il suo club fosse questo. Restano
 * fuori a maggior ragione da quando le altre competizioni entrano: la partita vera che ha giocato quel
 * giorno arriva dall'altra sorgente, e tenerle tutt'e due stamperebbe due righe per una sera sola.
 * `bench` e `injured` restano, perche' una distinta e uno stop datato sono prove su di lui.
 */
export function seasonMatches(
  played: Map<number, MatchCell> | undefined,
  missing: Map<number, MatchCell> | undefined,
  other: readonly MatchCell[] | undefined,
  season: string,
): MatchCell[] {
  const cells: MatchCell[] = [];
  for (const md of new Set([...(played?.keys() ?? []), ...(missing?.keys() ?? [])])) {
    const cell = played?.get(md) ?? missing?.get(md);
    if (cell && cell.state !== 'not_in_league' && cell.state !== 'absent') cells.push(cell);
  }
  cells.push(...(other ?? []));
  return cells.sort((a, b) => sortKey(b, season) - sortKey(a, season));
}

/** Sorting mixed competitions needs one axis, and it is the date. A league match whose provider row
 *  did not match has no date, so it falls back to a position derived from its matchday - approximate,
 *  and better than dropping it to the front of the list. */
function sortKey(cell: MatchCell, season: string): number {
  if (cell.date) return Date.parse(cell.date);
  const startYear = Number(season.slice(0, 4));
  return Date.UTC(startYear, 7, 20) + (cell.matchday ?? 0) * 7 * 86400000;
}

/**
 * Who is quoted on each platform for `targetSeason`, with his identity, club and roles.
 *
 * Exported because it is the ONE definition of the perimeter: a platform's listone is decided by
 * `listone_quotes` and never by `rosters`, which holds a single unattributed last read. A second view
 * building its own club list from the roster alone would show a different set of men under the same
 * words - the defect this project keeps paying for.
 */
/**
 * Una riga che il FOGLIO porta e il listone no: dal `SHEET_REVISION` 26 il foglio è costruito sulle ROSE
 * OSSERVATE, quindi contiene chi non è quotato (93 su 589 in Serie A) e chi è in un club diverso da quello
 * del listone - Molina, alla Roma dal 14/08 mentre `rosters` lo tiene ancora all'Atlético.
 */
export interface SheetRow {
  fcId: number;
  name: string;
  club: string;
  league: string | null;
  role: ClassicRole;
  mantra: string | null;
}

/**
 * Le righe dei fogli del motore, per piattaforma, ridotte all'IDENTITÀ: chi c'è e in che club.
 *
 * Solo quello serve qui - i numeri li legge il `ValuationStore` - e per questo si prendono le sette colonne
 * che il foglio porta dal 17/08/2026 (`export.SHEET_COLUMNS`). Un bundle più vecchio non le ha: allora la
 * mappa è vuota e la vista è quella del listone, com'era prima. `optionalIndex` lo consente per costruzione.
 */
export async function sheetIdentities(
  bundle: Bundle,
  manifest: BundleManifest,
): Promise<Map<Platform, SheetRow[]>> {
  const out = new Map<Platform, SheetRow[]>();
  for (const sheet of manifest.engine_sheets ?? []) {
    let table: BundleTable;
    try {
      table = await bundle.table(sheet.path.replace(/\.json(\.gz)?$/, ''));
    } catch {
      continue;                       // un foglio che non si legge non fa cadere la lista
    }
    const id = optionalIndex(table, 'fc_id');
    const name = optionalIndex(table, 'name');
    const club = optionalIndex(table, 'club');
    const league = optionalIndex(table, 'league');
    const role = optionalIndex(table, 'role_classic');
    const mantra = optionalIndex(table, 'roles_mantra');
    if (id < 0 || club < 0 || role < 0) continue;
    const rows: SheetRow[] = [];
    for (const row of table.rows) {
      const kind = row[role] as ClassicRole | null;
      const where = row[club] as string | null;
      if (!kind || !where) continue;
      rows.push({
        fcId: Number(row[id]),
        name: name < 0 ? '' : ((row[name] as string) ?? ''),
        club: where,
        league: league < 0 ? null : ((row[league] as string) ?? null),
        role: kind,
        mantra: mantra < 0 ? null : ((row[mantra] as string) ?? null),
      });
    }
    // Due fogli della stessa piattaforma (classic e mantra della stessa lega) portano la stessa
    // popolazione: il primo vince, e il secondo non aggiunge nulla che il primo non abbia già.
    if (!out.has(sheet.platform)) out.set(sheet.platform, rows);
  }
  return out;
}


export function buildRosters(
  players: BundleTable,
  clubs: BundleTable,
  rosters: BundleTable,
  quotes: BundleTable,
  targetSeason: string,
  /**
   * Le righe del foglio di quella piattaforma, per aggiungere chi il listone non ha e per CORREGGERE il
   * club di chi ha cambiato squadra: l'autorità su chi è in rosa è la fonte che la legge ogni giorno
   * (operatore, 17/08/2026), e il foglio la porta già decisa. Assente = la vista è quella del listone,
   * com'era prima, che è anche quello che vede un bundle più vecchio.
   */
  fromSheet: ReadonlyMap<Platform, readonly SheetRow[]> = new Map(),
): Map<Platform, PlayerRow[]> {
  const [pId, pName] = columnIndex(players, 'fc_id', 'canonical_name');
  const names = new Map<number, string>();
  for (const row of players.rows) names.set(row[pId] as number, row[pName] as string);

  const [cId, cName] = columnIndex(clubs, 'fc_club_id', 'canonical_name');
  const clubNames = new Map<number, string>();
  const clubIds = new Map<string, number>();
  for (const row of clubs.rows) {
    clubNames.set(row[cId] as number, row[cName] as string);
    clubIds.set(row[cName] as string, row[cId] as number);
  }

  const [rId, rSeason, rClub, rRoles, rRoleClassic, rLeague] = columnIndex(
    rosters,
    'fc_id',
    'season',
    'fc_club_id',
    'roles',
    'role_classic',
    'league',
  );
  const byId = new Map<number, PlayerRow>();
  for (const row of rosters.rows) {
    if (row[rSeason] !== targetSeason) continue;
    const fcId = row[rId] as number;
    const role = row[rRoleClassic] as ClassicRole | null;
    if (!role) continue;
    const codes = mantraCodes(row[rRoles] as string | null);
    byId.set(fcId, {
      fcId,
      name: names.get(fcId) ?? `#${fcId}`,
      clubId: (row[rClub] as number) ?? null,
      role,
      mantra: codes.join(' '),
      mantraCodes: codes,
      club: clubNames.get(row[rClub] as number) ?? '',
      league: (row[rLeague] as string) ?? null,
      // ...deciso sotto, quando si sa su quale listone e' finito: `rosters` e' una riga sola per uomo
      // e le due piattaforme sono due giochi. Vale per tutt'e due: un uomo puo' essere ceduto su un
      // listone e comprabile sull'altro.
      quoted: false,
      sold: false,
    });
  }

  /* WHO is on a platform is the quotation's business, not the roster's: `rosters` holds one
   * row per player while the two listoni are two different games, so the perimeter comes
   * from `listone_quotes` - the table that exists precisely because of that. */
  const [qId, qSeason, qPlatform, qSold] = columnIndex(quotes, 'fc_id', 'season', 'platform', 'sold');
  const out = new Map<Platform, PlayerRow[]>([
    ['default', []],
    ['euro', []],
  ]);
  for (const row of quotes.rows) {
    if (row[qSeason] !== targetSeason) continue;
    const player = byId.get(row[qId] as number);
    const list = out.get(row[qPlatform] as Platform);
    if (player && list) list.push({ ...player, quoted: true, sold: row[qSold] === 1 });
  }
  /* IL FOGLIO COMPLETA E CORREGGE: chi non c'è entra, e chi ha cambiato club prende quello che la fonte
   * gli dà. Non è un secondo listone - il prezzo e il ruolo restano quelli del listone dove ci sono - è la
   * stessa lista con l'autorità giusta su una colonna sola. Chi entra così non ha quotazione: `fvm` e
   * `price_initial` restano vuoti, e la riga lo mostra come mostra ogni altra cosa che non sa. */
  for (const [platform, extra] of fromSheet) {
    const list = out.get(platform);
    if (!list) continue;
    const known = new Map(list.map((one) => [one.fcId, one]));
    for (const row of extra) {
      const already = known.get(row.fcId);
      if (already) {
        if (row.club && already.club !== row.club) {
          already.club = row.club;
          already.clubId = clubIds.get(row.club) ?? already.clubId;
          already.league = row.league ?? already.league;
        }
        continue;
      }
      const codes = mantraCodes(row.mantra);
      list.push({
        fcId: row.fcId,
        name: row.name || names.get(row.fcId) || `#${row.fcId}`,
        clubId: clubIds.get(row.club) ?? null,
        role: row.role,
        mantra: codes.join(' '),
        mantraCodes: codes,
        club: row.club,
        league: row.league,
        quoted: false,
        // il foglio non porta piu' i ceduti (`snapshot` li toglie), quindi chi entra da qui non lo e'
        sold: false,
      });
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** `dc;ds` -> `['Dc', 'Ds']`. One parsing of the listone's roles, whatever shape the caller wants. */
function mantraCodes(roles: string | null): string[] {
  if (!roles) return [];
  return roles
    .split(';')
    .map((code) => code.trim())
    .filter(Boolean)
    .map((code) => code[0].toUpperCase() + code.slice(1));
}

interface ProviderMatch {
  matchId: string | null;
  club: string | null;
  opponent: string | null;
  home: boolean | null;
  /** Se era in distinta dal principio: e' il solo modo di sapere se e' SUBENTRATO. */
  started: boolean | null;
  minutes: number | null;
  voteSynth: number | null;
  rating: number | null;
  /** Gli attesi di quella giornata, gia' risolti fra «zero» e «ignoto» (vedi `expectedScope`). */
  xg: number | null;
  xa: number | null;
  date: string | null;
}

/**
 * DOVE UN xG ASSENTE E' UNO ZERO E DOVE E' UN IGNOTO: derivato dai DATI, mai da una lista di nomi.
 *
 * La fonte ha cambiato forma nel tempo e non lo dichiara da nessuna parte: fino al 2021-22 non emette
 * affatto gli attesi (e infatti in quelle stagioni ci sono righe con un GOL e nessun xG), dal 2022-23
 * li emette e omette la chiave quando il valore e' zero. Un lettore che credesse all'encoding
 * leggerebbe mezza tabella come «non ha mai tirato», e uno che leggesse tutto come ignoto butterebbe
 * via il 53% delle righe buone.
 *
 * Quindi l'ammissibilita' e' una proprieta' del (stagione, competizione) e si legge dal bundle stesso:
 * se li' dentro la fonte ha pubblicato almeno un attesa, allora li' una cella vuota e' uno ZERO. E'
 * la stessa forma di `synth.calibrated_competitions` nel toolkit - dove un numero si puo' applicare e'
 * una proprieta' della popolazione su cui e' stato osservato - e sui dati del 05/09/2026 separa
 * esattamente quello che deve: i cinque campionati dal 2024-25 in poi dentro, coppe e amichevoli
 * fuori (0 attesi su 2.500 righe, con 134 gol a smentire lo zero).
 *
 * DUE INSIEMI E NON UNO, perche' le due colonne hanno coperture diverse: xa e' pubblicato sul 98,3%
 * delle righe giocate dei cinque campionati e xg sul 46,6%. Il prezzo della convenzione e' misurato e
 * non stimato: 0 righe con un gol e nessun xg, 2 righe su 78.626 con un assist e nessun xa.
 */
export interface ExpectedScope {
  xg: ReadonlySet<string>;
  xa: ReadonlySet<string>;
}

function expectedScope(external: BundleTable): ExpectedScope {
  const xg = new Set<string>();
  const xa = new Set<string>();
  const season = optionalIndex(external, 'season');
  const competition = optionalIndex(external, 'competition');
  const xgAt = optionalIndex(external, 'xg');
  const xaAt = optionalIndex(external, 'xa');
  // Un bundle senza quelle colonne (la demo) non ha attesi da nessuna parte: insiemi vuoti, e ogni
  // riga legge «ignoto». E' «vuoto = ignoto» applicato alla forma del pacchetto e non a una cella.
  if (season < 0 || competition < 0) return { xg, xa };
  for (const row of external.rows) {
    const key = `${row[season]}|${row[competition]}`;
    if (xgAt >= 0 && row[xgAt] != null) xg.add(key);
    if (xaAt >= 0 && row[xaAt] != null) xa.add(key);
  }
  return { xg, xa };
}

/** Il valore di una riga dentro il suo blocco: zero dove la fonte pubblica, ignoto dove non pubblica. */
function expectedOf(known: ReadonlySet<string>, key: string, value: unknown): number | null {
  if (!known.has(key)) return null;
  return (value as number | null) ?? 0;
}

/** Keyed on (fc_id, season, competition, real_md): the competition belongs in the key because
 *  a player can have a league round and a cup tie under the same number. */
function buildProviderIndex(external: BundleTable, scope: ExpectedScope): {
  index: Map<string, ProviderMatch>;
  present: Set<string>;
  roundDates: Map<string, string>;
} {
  const [fcId, season, competition, realMd, date, club, opponent, home, started, minutes, rating,
    mvSynth, matchId] = columnIndex(
      external,
      'fc_id',
      'season',
      'competition',
      'real_md',
      'match_date',
      'club',
      'opponent',
      'home',
      'started',
      'minutes',
      'rating',
      'mv_synth',
      'match_id',
    );
  // Facoltative: un pacchetto costruito senza il layer degli attesi non ne ha, e la card lo dira'.
  const xgAt = optionalIndex(external, 'xg');
  const xaAt = optionalIndex(external, 'xa');
  const index = new Map<string, ProviderMatch>();
  /** He appears in this championship this season - on the pitch or on the bench. Without it a
   *  man who never left the bench would read as "never in this league". */
  const present = new Set<string>();
  /** When a round was played, taken from the earliest match of that round: an absence has no
   *  date of its own, and an injury spell has to be checked against something. */
  const roundDates = new Map<string, string>();
  for (const row of external.rows) {
    if (row[realMd] == null || !LEAGUE_COMPETITIONS.has(row[competition] as string)) continue;
    present.add(`${row[fcId]}|${row[season]}|${row[competition]}`);
    const matchDate = (row[date] as string) ?? null;
    const roundKey = `${row[season]}|${row[competition]}|${row[realMd]}`;
    if (matchDate && (!roundDates.has(roundKey) || matchDate < roundDates.get(roundKey)!)) {
      roundDates.set(roundKey, matchDate);
    }
    const key = `${row[fcId]}|${row[season]}|${row[competition]}|${row[realMd]}`;
    if (index.has(key)) continue;
    index.set(key, {
      matchId: (row[matchId] as string) ?? null,
      club: (row[club] as string) ?? null,
      opponent: (row[opponent] as string) ?? null,
      home: row[home] == null ? null : row[home] === 1,
      started: row[started] == null ? null : row[started] === 1,
      minutes: (row[minutes] as number) ?? null,
      voteSynth: (row[mvSynth] as number) ?? null,
      rating: (row[rating] as number) ?? null,
      xg: xgAt < 0 ? null : expectedOf(scope.xg, `${row[season]}|${row[competition]}`, row[xgAt]),
      xa: xaAt < 0 ? null : expectedOf(scope.xa, `${row[season]}|${row[competition]}`, row[xaAt]),
      date: matchDate,
    });
  }
  return { index, present, roundDates };
}

/** One EuroLeghe round bundles a DIFFERENT real round in each of the five championships, so
 *  the map is keyed by league too. Without it the euro columns would join the provider layer
 *  on a number that means something else. */
function buildMatchdayMap(map: BundleTable): Map<string, number> {
  const [season, euroMd, league, realMd] = columnIndex(
    map,
    'season',
    'euro_md',
    'league',
    'real_md',
  );
  const index = new Map<string, number>();
  for (const row of map.rows) {
    index.set(`${row[season]}|${row[euroMd]}|${row[league]}`, row[realMd] as number);
  }
  return index;
}

function buildLeagueMatches(
  ratings: BundleTable,
  provider: Map<string, ProviderMatch>,
  leagueOf: Map<number, string | null>,
  euroToReal: Map<string, number>,
  shapes: Map<string, { counted: string; declared: string | null }>,
  scoring: ScoringConfig | null,
) {
  const [
    fcId,
    season,
    matchday,
    role,
    team,
    platform,
    mv,
    goals,
    assists,
    ownGoals,
    penScored,
    penMissed,
    conceded,
    yellows,
    reds,
    fantavoto,
    assistsSetPiece,
    penSaved,
  ] = columnIndex(
    ratings,
    'fc_id',
    'season',
    'matchday',
    'role',
    'team',
    'platform',
    'mv',
    'goals',
    'assists',
    'own_goals',
    'pen_scored',
    'pen_missed',
    'goals_conceded',
    'yellows',
    'reds',
    'fantavoto',
    'assists_set_piece',
    'pen_saved',
  );

  /* The scoreline is derived inside match_ratings and never by matching club names across
   * sources: goals-for is the team's own goals plus its converted penalties, goals-against is
   * what its goalkeeper conceded. */
  const scores = new Map<string, { for: number; against: number | null }>();
  for (const row of ratings.rows) {
    const key = `${row[platform]}|${row[season]}|${row[matchday]}|${row[team]}`;
    let score = scores.get(key);
    if (!score) scores.set(key, (score = { for: 0, against: null }));
    score.for += ((row[goals] as number) ?? 0) + ((row[penScored] as number) ?? 0);
    if (row[role] === 'P' && row[conceded] != null) score.against = row[conceded] as number;
  }

  const out = new Map<string, Map<number, Map<number, MatchCell>>>();
  for (const row of ratings.rows) {
    if (row[role] === 'ALL') continue; // the coach has a rating row and is not a player
    const plat = row[platform] as Platform;
    const s = row[season] as string;
    const id = row[fcId] as number;
    const md = row[matchday] as number;
    const key = `${plat}|${s}`;

    let seasonMap = out.get(key);
    if (!seasonMap) out.set(key, (seasonMap = new Map()));
    let playerMap = seasonMap.get(id);
    if (!playerMap) seasonMap.set(id, (playerMap = new Map()));

    // On `default` the matchday IS the real round; on `euro` it is a EuroLeghe round and has
    // to be translated, per league, before the provider layer can be reached at all.
    const league = leagueOf.get(id) ?? null;
    const realMd = plat === 'euro' ? euroToReal.get(`${s}|${md}|${league}`) : md;
    const extra =
      league && realMd != null ? provider.get(`${id}|${s}|${league}|${realMd}`) : undefined;

    const teamName = row[team] as string;
    const score = scores.get(`${plat}|${s}|${md}|${teamName}`);
    const realVote = row[mv] as number | null;

    const cell: MatchCell = {
      kind: 'league',
      state: realVote == null && extra?.voteSynth == null ? 'no_vote' : 'played',
      injury: null,
      role: (row[role] as string) ?? null,
      competition: league ?? '',
      competitionLabel: league ? competitionLabel(league) : 'Campionato',
      matchday: md,
      date: extra?.date ?? null,
      // IL SINTETICO ARROTONDATO AL MEZZO PUNTO: e' l'alfabeto in cui i voti veri sono scritti
      // (misurato: 57.925 su 57.925), quindi `5,88` accanto a un `6,0` vero e' una precisione che la
      // fonte non ha mai. `roundVote` sta in `match-bonuses` perche' il fantavoto si somma a QUESTO
      // numero e non a quello prima dell'arrotondamento: la riga deve tornare.
      vote: realVote ?? (extra?.voteSynth == null ? null : roundVote(extra.voteSynth)),
      voteSynthetic: realVote == null && extra?.voteSynth != null,
      providerRating: extra?.rating ?? null,
      fantavoto: (row[fantavoto] as number) ?? null,
      goals: (row[goals] as number) ?? 0,
      assists: (row[assists] as number) ?? 0,
      assistsSetPiece: (row[assistsSetPiece] as number) ?? 0,
      penScored: (row[penScored] as number) ?? 0,
      penMissed: (row[penMissed] as number) ?? 0,
      penSaved: (row[penSaved] as number) ?? 0,
      ownGoals: (row[ownGoals] as number) ?? 0,
      goalsConceded: (row[conceded] as number) ?? null,
      yellows: (row[yellows] as number) ?? 0,
      reds: (row[reds] as number) ?? 0,
      // GLI ATTESI VENGONO DAL PROVIDER e non dai voti, come i minuti e la distinta: dove non c'e' una
      // riga sua per quella giornata restano vuoti, che e' quello che sono.
      xg: extra?.xg ?? null,
      xa: extra?.xa ?? null,
      minutes: extra?.minutes ?? null,
      started: extra?.started ?? null,
      team: teamName,
      opponent: extra?.opponent ?? null,
      home: extra?.home ?? null,
      goalsFor: score?.for ?? null,
      goalsAgainst: score?.against ?? null,
      shape: extra ? (shapes.get(`${extra.matchId}|${extra.club}`)?.counted ?? null) : null,
      formation: extra ? (shapes.get(`${extra.matchId}|${extra.club}`)?.declared ?? null) : null,
      // La stessa coppia con cui il modulo e' stato appena letto: e' una CHIAVE, non due etichette.
      matchId: extra?.matchId ?? null,
      matchClub: extra?.club ?? null,
    };
    // IL FANTAVOTO SI CALCOLA SOLO DOVE LA FONTE NON LO PUBBLICA. Qui succede su una giornata senza
    // pagella recuperata dal sintetico: i bonus li porta la riga dei VOTI, quindi sono completi -
    // cartellini e gol subiti compresi - e la somma e' esatta invece che ottimista.
    cell.fantavoto ??= syntheticFantavoto(cell, scoring);
    playerMap.set(md, cell);
  }
  return out;
}

/** Cups, friendlies and anything else the provider recorded that is not the player's league.
 *  None of these carries a fantacalcio vote, and none is a calibrated competition, so
 *  `mv_synth` is null on every one of them - all they have is the provider's own rating. */
function buildOtherMatches(
  external: BundleTable,
  scope: ExpectedScope,
  seasons: Set<string>,
  leagueOf: Map<number, string | null>,
  shapes: Map<string, { counted: string; declared: string | null }>,
  scoring: ScoringConfig | null,
  roleOf: Map<number, ClassicRole>,
): Map<string, Map<number, MatchCell[]>> {
  const [fcId, season, competition, date, club, opponent, home, startedOther, minutes, rating, goals,
    assists, yellows, reds, matchIdOther] = columnIndex(
      external,
      'fc_id',
      'season',
      'competition',
      'match_date',
      'club',
      'opponent',
      'home',
      'started',
      'minutes',
      'rating',
      'goals',
      'assists',
      'yellows',
      'reds',
      'match_id',
    );
  /* IL VOTO SINTETICO CALIBRATO, che e' il solo motivo per cui un campionato straniero puo' portare un
   * numero sulla scala del fantacalcio. Si legge la colonna e basta: `synth` la scrive dove la retta e'
   * stata fittata e la lascia NULL dappertutto altrove (`calibrated_competitions`), quindi una coppa
   * arriva qui gia' vuota e non serve una nostra lista di competizioni ammesse - che sarebbe una
   * seconda risposta a una domanda che il toolkit risponde gia'. Facoltativa: un bundle esportato
   * prima che la colonna viaggiasse semplicemente non ce l'ha. */
  const mvSynth = optionalIndex(external, 'mv_synth');
  /**
   * I GOL DI OGNI CLUB IN OGNI PARTITA, per dire quanti ne ha subiti un portiere.
   *
   * «Li prendi pari pari ai gol segnati nella partita dall'avversario» (operatore, 05/09/2026), e i
   * gol per giocatore sono la colonna piu' solida di questo layer - misurata contro i voti veri su
   * 24.393 partite di Serie A, concorda al 100% leggendo NULL come zero.
   *
   * IL LIMITE E' IL PERIMETRO E NON IL METODO, e sta scritto in `syntheticFantavoto`: una riga esiste
   * solo per chi sappiamo identificare, quindi un marcatore avversario fuori dal listone non viene
   * contato. Sull'estero la ricostruzione e' esatta il 72,5% delle volte e sbaglia per difetto di
   * 0,325 gol in media; sulla Serie A il 95,1%. Dove la fonte porta il RISULTATO (`opponent_goals`)
   * si usa quello, che e' esatto per costruzione - oggi e' su pochissime righe e lo sara' sempre di
   * piu' man mano che le giornate vengono riscaricate.
   */
  const scoredByMatch = new Map<string, Map<string, number>>();
  for (const row of external.rows) {
    const key = row[matchIdOther] as string | null;
    if (!key) continue;
    let clubs = scoredByMatch.get(key);
    if (!clubs) scoredByMatch.set(key, (clubs = new Map()));
    const team = (row[club] as string) ?? '';
    clubs.set(team, (clubs.get(team) ?? 0) + ((row[goals] as number) ?? 0));
  }
  // The scoreline the provider published - a cup or a friendly has no ratings row to derive one
  // from. Optional: a bundle exported before 09/08/2026 has no such column, and that is a gap in
  // the data, not a reason to refuse to draw the table.
  const teamGoals = optionalIndex(external, 'team_goals');
  const opponentGoals = optionalIndex(external, 'opponent_goals');
  const xgAt = optionalIndex(external, 'xg');
  const xaAt = optionalIndex(external, 'xa');

  const out = new Map<string, Map<number, MatchCell[]>>();
  for (const row of external.rows) {
    const s = row[season] as string;
    if (!seasons.has(s)) continue;
    const slug = row[competition] as string;
    const kind = competitionKind(slug);
    // His own championship is already covered by the ratings; another country's league is
    // not a cup, but it is football he played and it belongs in "other competitions".
    if (kind === 'league' && slug === leagueOf.get(row[fcId] as number)) continue;
    const synth = mvSynth < 0 ? null : ((row[mvSynth] as number) ?? null);
    let seasonMap = out.get(s);
    if (!seasonMap) out.set(s, (seasonMap = new Map()));
    const id = row[fcId] as number;
    let list = seasonMap.get(id);
    if (!list) seasonMap.set(id, (list = []));

    /* IL PORTIERE si decide sul ruolo di LISTONE e non sulla posizione che il provider scrive per
     * quella partita: il listone ce l'ha per tutti mentre `position` manca sull'1,4% delle righe, e
     * un portiere non gioca da attaccante - il caso contrario e' la rarita' che l'operatore ha detto
     * di ignorare. `role` e' quello che `bonusesOf` legge per decidere se il malus dei gol subiti si
     * applica, e qui e' l'unica cosa che quel campo deve dire. */
    const keeper = roleOf.get(id) === 'P';
    const declared = opponentGoals < 0 ? null : ((row[opponentGoals] as number) ?? null);
    const conceded = !keeper
      ? null
      : (declared ?? concededBy(scoredByMatch.get(row[matchIdOther] as string), (row[club] as string) ?? ''));

    const cell: MatchCell = {
      kind: kind === 'league' ? 'other_league' : kind,
      state:
        (row[minutes] as number | null) == null && (row[rating] as number | null) == null
          ? 'no_data'
          : 'played',
      injury: null,
      role: keeper ? 'P' : null,
      competition: slug,
      competitionLabel: competitionLabel(slug),
      // LA GIORNATA RESTA VUOTA anche se la riga porta il suo `real_md`: le colonne della tabella sono
      // le giornate di QUESTA piattaforma, e stampare «38ª» accanto a una partita di Premier dentro un
      // elenco di Serie A direbbe un numero del calendario sbagliato. Il campionato lo dice l'etichetta.
      matchday: null,
      date: (row[date] as string) ?? null,
      // Arrotondato al mezzo punto come nel ramo dei voti: e' lo stesso numero e la stessa ragione.
      vote: synth == null ? null : roundVote(synth),
      voteSynthetic: synth != null,
      providerRating: (row[rating] as number) ?? null,
      fantavoto: null,
      goals: (row[goals] as number) ?? 0,
      assists: (row[assists] as number) ?? 0,
      assistsSetPiece: 0,
      penScored: 0,
      penMissed: 0,
      penSaved: 0,
      ownGoals: 0,
      goalsConceded: conceded,
      yellows: (row[yellows] as number) ?? 0,
      reds: (row[reds] as number) ?? 0,
      xg: xgAt < 0 ? null : expectedOf(scope.xg, `${s}|${slug}`, row[xgAt]),
      xa: xaAt < 0 ? null : expectedOf(scope.xa, `${s}|${slug}`, row[xaAt]),
      minutes: (row[minutes] as number) ?? null,
      started: row[startedOther] == null ? null : row[startedOther] === 1,
      team: (row[club] as string) ?? '',
      opponent: (row[opponent] as string) ?? null,
      home: row[home] == null ? null : row[home] === 1,
      goalsFor: teamGoals < 0 ? null : ((row[teamGoals] as number) ?? null),
      goalsAgainst: opponentGoals < 0 ? null : ((row[opponentGoals] as number) ?? null),
      shape: shapes.get(`${row[matchIdOther]}|${row[club]}`)?.counted ?? null,
      formation: shapes.get(`${row[matchIdOther]}|${row[club]}`)?.declared ?? null,
      matchId: (row[matchIdOther] as string) ?? null,
      matchClub: (row[club] as string) ?? null,
    };
    // IL FANTAVOTO SINTETICO, dove c'e' un voto sintetico da cui partire. Per un portiere si fa solo
    // se i gol subiti si sono potuti contare: la funzione lo decide sul DATO e non sul ruolo.
    cell.fantavoto = syntheticFantavoto(cell, scoring);
    list.push(cell);
  }
  for (const seasonMap of out.values()) {
    for (const list of seasonMap.values()) {
      list.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    }
  }
  return out;
}

/**
 * Quanti gol ha segnato l'AVVERSARIO in quella partita: la somma dei gol di ogni altro club.
 *
 * `null` quando di quella partita abbiamo righe di un solo club - allora non si sa, e uno zero sarebbe
 * una porta inviolata inventata. Un club solo capita spesso fuori dal perimetro: e' la stessa ragione
 * per cui la ricostruzione sbaglia per difetto, vista dal caso limite.
 */
function concededBy(clubs: Map<string, number> | undefined, own: string): number | null {
  if (!clubs || clubs.size < 2) return null;
  let goals = 0;
  for (const [team, scored] of clubs) if (team !== own) goals += scored;
  return goals;
}

interface InjurySpell {
  from: string;
  to: string | null;
  detail: string | null;
}

/** The shape a club STARTED a match with, from the counts of its own line-up: `4-3-3`. Keyed on
 *  (match_id, club), both written by the same parser from the same payload - so this is not a
 *  name join across sources. Only complete elevens count: 24,378 rows of 24,379 have eleven
 *  starters, and the odd one out cannot say a shape. */
function buildShapes(lineups: BundleTable): Map<string, { counted: string; declared: string | null }> {
  const [matchId, club, starters, defenders, midfielders, forwards] = columnIndex(
    lineups,
    'match_id',
    'club',
    'starters',
    'defenders',
    'midfielders',
    'forwards',
  );
  // IL MODULO DICHIARATO DALLA FONTE, quando il pacchetto lo porta: e' arrivato il 12/09/2026, quindi
  // su uno piu' vecchio la colonna non esiste - `optionalIndex` risponde -1 e la riga legge null, che
  // e' ignoto e fa tornare il disegno ai conteggi.
  const formation = optionalIndex(lineups, 'formation');
  const out = new Map<string, { counted: string; declared: string | null }>();
  for (const row of lineups.rows) {
    if (row[starters] !== 11) continue;
    out.set(`${row[matchId]}|${row[club]}`, {
      counted: `${row[defenders]}-${row[midfielders]}-${row[forwards]}`,
      declared: formation < 0 ? null : ((row[formation] as string) ?? null),
    });
  }
  return out;
}

/** Dated spells from the source, over EVERY competition: the question they answer is "was he
 *  injured on this date", which is exactly what an empty round needs asking. */
function buildInjuries(injuries: BundleTable): Map<number, InjurySpell[]> {
  const [fcId, start, end, detail] = columnIndex(
    injuries,
    'fc_id',
    'start_date',
    'end_date',
    'detail',
  );
  const out = new Map<number, InjurySpell[]>();
  for (const row of injuries.rows) {
    const from = row[start] as string | null;
    if (!from) continue;
    const id = row[fcId] as number;
    let list = out.get(id);
    if (!list) out.set(id, (list = []));
    list.push({ from, to: (row[end] as string) ?? null, detail: (row[detail] as string) ?? null });
  }
  return out;
}

/**
 * Why a player is missing from a round's ratings. Five answers, in this order:
 * he was on the BENCH (the provider has his row with no minutes - 5,068 such rows against
 * 5,070 with no rating at all, which is what makes the reading safe); he was NEVER IN THIS
 * CHAMPIONSHIP that season (123 of the 499 quoted men, and calling that "left out" would be a
 * category error); he was INJURED on the day the round was played; or nothing accounts for it,
 * and the cell says exactly that rather than inventing a reason.
 *
 * The order matters: "not in this league" comes before "injured" because a Ligue 1 man's
 * injury has no business being read as a missed Serie A round.
 */
function buildAbsences(
  league: Map<string, Map<number, Map<number, MatchCell>>>,
  rosters: Map<Platform, PlayerRow[]>,
  provider: {
    index: Map<string, ProviderMatch>;
    present: Set<string>;
    roundDates: Map<string, string>;
  },
  euroToReal: Map<string, number>,
  injuries: Map<number, InjurySpell[]>,
): Map<string, Map<number, Map<number, MatchCell>>> {
  const out = new Map<string, Map<number, Map<number, MatchCell>>>();

  for (const [key, bySeason] of league) {
    const [platform, season] = key.split('|') as [Platform, string];
    let lastMd = 0;
    for (const byDay of bySeason.values()) {
      for (const md of byDay.keys()) if (md > lastMd) lastMd = md;
    }
    if (!lastMd) continue;

    const seasonOut = new Map<number, Map<number, MatchCell>>();
    for (const player of rosters.get(platform) ?? []) {
      const own = bySeason.get(player.fcId);
      const competition = player.league;
      if (!competition) continue; // no championship on his roster row: nothing to be absent from
      const everThere =
        (own?.size ?? 0) > 0 || provider.present.has(`${player.fcId}|${season}|${competition}`);
      const spells = injuries.get(player.fcId) ?? [];
      const missing = new Map<number, MatchCell>();

      for (let md = 1; md <= lastMd; md++) {
        if (own?.has(md)) continue;
        const realMd = platform === 'euro' ? euroToReal.get(`${season}|${md}|${competition}`) : md;
        if (realMd == null) continue;
        const roundKey = `${season}|${competition}|${realMd}`;
        const when = provider.roundDates.get(roundKey) ?? null;
        const bench = provider.index.get(`${player.fcId}|${season}|${competition}|${realMd}`);

        let state: CellState;
        let injury: MatchCell['injury'] = null;
        if (bench) {
          state = 'bench';
        } else if (!everThere) {
          state = 'not_in_league';
        } else {
          const spell = when
            ? spells.find((s) => s.from <= when && when <= (s.to ?? '2100-01-01'))
            : undefined;
          if (spell) {
            state = 'injured';
            injury = { detail: spell.detail, from: spell.from, to: spell.to };
          } else {
            state = 'absent';
          }
        }

        missing.set(md, {
          kind: 'league',
          state,
          injury,
          role: null,
          competition,
          competitionLabel: competitionLabel(competition),
          matchday: md,
          date: bench?.date ?? when,
          vote: null,
          voteSynthetic: false,
          providerRating: null,
          fantavoto: null,
          goals: 0,
          assists: 0,
          assistsSetPiece: 0,
          penScored: 0,
          penMissed: 0,
          penSaved: 0,
          ownGoals: 0,
          goalsConceded: null,
          yellows: 0,
          reds: 0,
          // Una giornata che non ha giocato non ha attesi: non e' uno zero, e' una partita che non c'e'.
          xg: null,
          xa: null,
          // A bench row knows he was there and against whom; it does NOT get a scoreline,
          // because reaching one would mean joining the provider's club name to the ratings'
          // spelling, and a name join is the defect this project keeps paying for.
          minutes: bench ? 0 : null,
          // Chi non ha una riga nei voti non e' partito titolare, e dove non c'e' nemmeno la panchina
          // non si sa niente: la distinzione e' la stessa dei minuti qui sopra.
          started: bench ? false : null,
          team: bench?.club ?? '',
          opponent: bench?.opponent ?? null,
          home: bench?.home ?? null,
          goalsFor: null,
          goalsAgainst: null,
          shape: null,
          formation: null,
          // UNA PANCHINA SA QUAL E' LA SUA PARTITA e chi non ha nemmeno quella no: e' la stessa
          // distinzione dei minuti due righe piu' su, e la colonna che la legge ricostruisce l'undici
          // anche da una giornata in cui questo club aveva tutti in panchina.
          matchId: bench?.matchId ?? null,
          matchClub: bench?.club ?? null,
        });
      }
      if (missing.size) seasonOut.set(player.fcId, missing);
    }
    if (seasonOut.size) out.set(key, seasonOut);
  }
  return out;
}
