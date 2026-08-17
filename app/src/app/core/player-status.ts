import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { Bundle, BundleTable, PlayerNote, PlayerNotesFile, columnIndex, optionalIndex } from './bundle';
import { TimeTravel } from './time-travel';
import { itDate } from './tooltip';

/**
 * What a name carries beside its numbers: a long absence, a return from one, a broken relationship.
 *
 * Three states the operator asked to see EVERYWHERE (11/08/2026), because they are the kind of fact that
 * changes a bid and that no fantamedia can express: a man out for months is not the man the sheet priced, one
 * just back from months out is the same man with a caveat, and one who has fallen out with his club may not
 * play at all whatever his numbers say.
 *
 * The first two are MEASURED, from the bundle's own `injuries` table - dated spells from Transfermarkt, the
 * same rows the consultation table reads to explain an empty round, so there is one definition of «he was
 * injured» in this app and not two. The third cannot be measured at all: nobody publishes a table of
 * quarrels, so it is DECLARED - the same treatment `config/board_rulings.json` gives a judgement the model
 * cannot reach, dated and revocable, and never inferred from a transfer or an absence.
 *
 * TWO THRESHOLDS, and they are DISPLAY choices rather than model parameters: nothing here enters a valuation,
 * a ranking or the gate - it decorates a row the engine already priced. They are declared here, in one place,
 * so changing them is one line and so nobody reads them as measured.
 */

/** Above how many days an absence stops being a knock and becomes the kind of fact that changes a bid. */
export const LONG_INJURY_DAYS = 45;

/** For how long after his return a man is still «just back»: about two months of calendar. */
export const BACK_FROM_LONG_DAYS = 60;

/**
 * How far back «si infortuna spesso» is asked: three years, because one season is an accident and a
 * career is a different man - Berardi lost 318 days over three years in three long spells, and in one
 * of those seasons he played 33 matches.
 */
export const FRAGILITY_YEARS = 3;

/**
 * Above which share of those three years a man is marked FRAGILE.
 *
 * Measured on the Serie A listone (499 quoted, 15/08/2026): the median man loses 5.3% of three years to
 * injury, the ninth decile 21.9%, the worst 42.3%. A fifth of three years is therefore the top tenth of
 * the listone, and it is exactly where the three men the operator named sit - Dybala 32% in 16 spells,
 * Berardi 29%, Buongiorno 23% - while a Yildiz (3%) or a Di Lorenzo (8%) stay clean.
 *
 * A DISPLAY threshold like the two above it, declared here so nobody reads it as a fitted parameter.
 * What it does to a VALUATION is a different matter and lives in `player-ratings.ts`.
 */
export const FRAGILE_SHARE = 0.20;

export type PlayerFlag =
  | 'long_injury'
  | 'back_from_long'
  | 'fragile'
  | 'mystery'
  | 'yellows'
  | 'reds'
  | 'own_goals'
  | 'penalty_risk'
  | 'penalty_saved'
  | 'set_pieces'
  | 'clean_sheets'
  | 'dispute'
  | 'promise'
  | 'flop_risk'
  | 'place_gained'
  | 'place_lost'
  | 'rotation_risk'
  | 'rotation_early'
  | 'starter_signs'
  | 'intl_cup';

/**
 * Come si chiama ogni marchio, in una riga. Sta QUI e non nel componente che lo disegna perché ormai lo
 * legge anche il filtro «mostrami tutti i misteri»: un'icona e la voce che la sceglie devono essere la
 * stessa parola, o l'elenco dei filtri e la legenda finiscono per dire due cose diverse.
 */
export const FLAG_LABEL: Record<PlayerFlag, string> = {
  long_injury: 'Infortunio lungo in corso',
  back_from_long: 'Rientrato da poco da un infortunio lungo',
  fragile: 'Si infortuna spesso',
  mystery: 'Mistero: disponibile, quotato, e non gioca',
  yellows: 'Si fa ammonire spessissimo',
  reds: 'Si fa espellere: −1 e il voto rovinato',
  own_goals: 'Fa autogol più della norma',
  penalty_risk: 'Sbaglia spesso i rigori',
  penalty_saved: 'Para i rigori',
  set_pieces: 'Batte i rigori',
  // Il soggetto è la SQUADRA e la frase lo dice: il merito non è suo (`club-defence.ts`).
  clean_sheets: 'Squadra che tiene la porta inviolata spesso',
  dispute: 'Fuori rosa / rottura con la società',
  promise: 'Possibile promessa',
  flop_risk: 'Possibile flop',
  place_gained: 'Ha guadagnato il posto',
  place_lost: 'Ha perso il posto',
  rotation_risk: 'Preso per titolare, ma ruotato',
  rotation_early: 'Preso per titolare, segnali di incertezza',
  starter_signs: 'Dato per riserva, gioca da titolare',
  // «Coppa» da sola sarebbe ambigua: questa stessa vista ha già un filtro «Coppe e altre competizioni»,
  // che sono le coppe dei CLUB nella tabella delle partite. Qui il soggetto è la NAZIONALE.
  intl_cup: 'In nazionale a una coppa continentale, a campionato in corso',
};

/**
 * I marchi che le due tabelle di consultazione sanno produrre, nell'ordine in cui si leggono.
 *
 * Gli altri - i due screen calibrati, il posto guadagnato o perso, i due di rotazione - li registra il
 * PANNELLO D'ASTA, che è l'unico a conoscere il listone in gioco e i prezzi: offrirli qui sarebbe un
 * filtro che non trova mai niente, cioè una bugia con l'aria di una funzione.
 */
export const CONSULTABLE_FLAGS: PlayerFlag[] = [
  // La coppa continentale c'è anche qui, a differenza degli screen e dei due marchi di rotazione: il suo
  // marchio lo registra `ValuationStore`, che ogni lista carica, non il pannello d'asta - quindi il filtro
  // «fammi vedere chi parte a gennaio» trova davvero qualcuno invece di essere una funzione vuota.
  'intl_cup',
  'mystery',
  'fragile',
  'yellows',
  'reds',
  'own_goals',
  'penalty_risk',
  'penalty_saved',
  'set_pieces',
  'clean_sheets',
  'long_injury',
  'back_from_long',
  'dispute',
];

export interface PlayerMark {
  flag: PlayerFlag;
  /** One line, in the language of the table: what it is and since when. */
  note: string;
}

/** One absence, as the bundle's `injuries` table dates it. */
export interface Spell {
  from: string;
  /** Null = no end recorded. A date in the FUTURE is an expected return, so he is still out. */
  to: string | null;
  /** The source's own count of days out. Null happens, and then the dates answer instead. */
  days: number | null;
  kind: string | null;
  detail: string | null;
}

const DAY_MS = 86_400_000;

/** Whole days between two ISO dates, positive when `to` is the later one. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/** dd/mm/yyyy: a date in a tooltip is read by a person, not by a parser. One definition, shared. */
const it = itDate;

/**
 * How long a spell has lasted by `today`, in days.
 *
 * The source's own `days_out` and the dates can disagree - it is written when the page is read, and the page
 * may be older than the bundle - so the LONGER of the two is taken: an absence that is still running has, at
 * the very least, lasted as long as the calendar says.
 */
export function spellDays(spell: Spell, today: string): number {
  const end = spell.to && spell.to < today ? spell.to : today;
  return Math.max(spell.days ?? 0, Math.max(0, daysBetween(spell.from, end)));
}

/** Still out on `today`: no end recorded, or an end that has not arrived. */
export function isOpen(spell: Spell, today: string): boolean {
  return spell.from <= today && (spell.to === null || spell.to >= today);
}

/**
 * The injury mark a man carries today, or null.
 *
 * The open spell WINS over the return: a man who came back in June and broke down in August is out now, and a
 * faded «just back» beside him would say the opposite of the truth. `back_from_long` is therefore only ever
 * about a squad with nothing open.
 */
export function injuryMark(spells: readonly Spell[], today: string): PlayerMark | null {
  let open: Spell | null = null;
  let openDays = 0;
  let back: Spell | null = null;
  let backDays = 0;
  for (const spell of spells) {
    if (!spell.from || spell.from > today) continue;
    const days = spellDays(spell, today);
    if (isOpen(spell, today)) {
      if (!open || days > openDays) {
        open = spell;
        openDays = days;
      }
      continue;
    }
    // A CLOSED spell, and only a recent long one counts: the most recent return wins, because that is the
    // one his condition is about.
    if (days < LONG_INJURY_DAYS || !spell.to) continue;
    if (daysBetween(spell.to, today) > BACK_FROM_LONG_DAYS) continue;
    if (!back || spell.to > back.to!) {
      back = spell;
      backDays = days;
    }
  }

  if (open) {
    if (openDays < LONG_INJURY_DAYS) return null;
    const what = open.detail ?? 'Infortunio';
    const until = open.to ? `, rientro previsto il ${it(open.to)}` : '';
    return {
      flag: 'long_injury',
      note: `${what}: fuori dal ${it(open.from)}, ${openDays} giorni${until}`,
    };
  }
  if (back) {
    return {
      flag: 'back_from_long',
      note: `${back.detail ?? 'Infortunio'}: ${backDays} giorni fuori, rientrato il ${it(back.to!)}`
        + ` (${daysBetween(back.to!, today)} giorni fa)`,
    };
  }
  return null;
}

/** What a career of absences says about a man: days lost, and in how many separate spells. */
export interface Fragility {
  /** Days spent injured inside the window, counted ONCE where two diagnoses overlap. */
  days: number;
  /** ...and how many distinct spells they came in: «tante partite saltate» is not «un crociato». */
  episodes: number;
  /** Those days as a share of the window. The number the threshold is read against. */
  share: number;
}

/**
 * How much of the last `FRAGILITY_YEARS` a man spent injured, and in how many separate spells.
 *
 * Overlapping spells are MERGED before they are counted, for the reason the injury share already had to
 * learn: the source records one row per DIAGNOSIS, so a man hurt twice at once read 591 days out of 365.
 * A spell that started before the window counts only its part inside it - what is being asked is «how
 * much of the last three years did this cost», not «how long was the injury».
 */
export function fragilityOf(
  spells: readonly Spell[],
  today: string,
  years: number = FRAGILITY_YEARS,
): Fragility {
  const end = Date.parse(today);
  const start = end - years * 365 * DAY_MS;
  const windows: [number, number][] = [];
  for (const spell of spells) {
    if (!spell.from) continue;
    const from = Math.max(Date.parse(spell.from), start);
    const to = Math.min(spell.to ? Date.parse(spell.to) : end, end);
    if (to > from) windows.push([from, to]);
  }
  windows.sort((left, right) => left[0] - right[0]);
  let days = 0;
  let episodes = 0;
  let open: [number, number] | null = null;
  for (const one of windows) {
    if (open && one[0] <= open[1]) {
      open[1] = Math.max(open[1], one[1]);
      continue;
    }
    if (open) days += (open[1] - open[0]) / DAY_MS;
    open = [one[0], one[1]];
    episodes += 1;
  }
  if (open) days += (open[1] - open[0]) / DAY_MS;
  return { days: Math.round(days), episodes, share: days / (years * 365) };
}

/** The mark for a man who breaks down often, or null. Says the days, the spells and the window. */
export function fragilityMark(spells: readonly Spell[], today: string): PlayerMark | null {
  const one = fragilityOf(spells, today);
  if (one.share < FRAGILE_SHARE) return null;
  return {
    flag: 'fragile',
    note: `${one.days} giorni fuori in ${FRAGILITY_YEARS} anni (${Math.round(one.share * 100)}%)`
      + `, in ${one.episodes} episodi`,
  };
}

/** The dated spells per player, from the bundle's own table. */
export function buildSpells(table: BundleTable, cutoff?: string): Map<number, Spell[]> {
  const [id, from, to, kind] = columnIndex(table, 'fc_id', 'start_date', 'end_date', 'kind');
  // An older bundle may not carry them, and that is «unknown»: the dates still answer.
  const days = optionalIndex(table, 'days_out');
  const detail = optionalIndex(table, 'detail');
  const out = new Map<number, Spell[]>();
  for (const row of table.rows) {
    const start = row[from] as string | null;
    if (!start) continue;
    // IL VIAGGIO NEL TEMPO, e uno spell è il caso che lo spiega meglio: quello che comincia DOPO la data
    // non esiste ancora, e quello che finisce dopo quel giorno era ancora APERTO - dire «è durato 40
    // giorni» sarebbe sapere il futuro. Anche `days_out` se ne va per la stessa ragione: è la durata
    // totale, che quel giorno nessuno conosceva.
    if (cutoff && start > cutoff) continue;
    const ended = (row[to] as string | null) ?? null;
    const open = cutoff != null && ended != null && ended > cutoff;
    const fcId = Number(row[id]);
    let list = out.get(fcId);
    if (!list) out.set(fcId, (list = []));
    list.push({
      from: start,
      to: open ? null : ended,
      days: open || days < 0 ? null : ((row[days] as number | null) ?? null),
      kind: (row[kind] as string | null) ?? null,
      detail: detail < 0 ? null : ((row[detail] as string | null) ?? null),
    });
  }
  return out;
}

/**
 * What every name is carrying, ready for any list that draws players.
 *
 * It is a service and not a computed of the auction panel because the operator asked for the marks «nei
 * suggerimenti ma anche dalle altre parti»: one source, so two lists can never disagree about whether a man
 * is injured. The injuries table is fetched once and cached by `Bundle`, like every other table.
 */
@Injectable({ providedIn: 'root' })
export class PlayerStatus {
  private readonly bundle = inject(Bundle);

  private readonly spells = signal<Map<number, Spell[]>>(new Map());

  /**
   * The day the marks are read against.
   *
   * The DATA is as old as the bundle and the QUESTION is about now, so both dates matter and neither is
   * assumed: this one is the CLOCK's - o quella del box di debug, se si sta viaggiando nel tempo - e
   * `readAt` carries the bundle's, which the tooltip states: an open spell in a month-old bundle may have
   * closed the day after it was written.
   */
  private readonly travel = inject(TimeTravel);
  private readonly today = this.travel.today;

  readonly readAt = signal<string | null>(null);

  /** True once the table is in: before that a missing mark means «not loaded», not «nothing wrong». */
  readonly loaded = signal(false);

  private loading = false;

  constructor() {
    void this.ensure();
    // Gli spell si RITAGLIANO alla data: uno che comincia dopo non esiste, uno che finisce dopo era
    // ancora aperto. Quindi al cambio di data la tabella va riletta, non solo ri-giudicata.
    effect(() => {
      this.travel.today();
      if (this.loaded()) void this.reread();
    });
  }

  private async reread(): Promise<void> {
    const cutoff = this.travel.travelling() ? this.travel.today() : undefined;
    this.spells.set(buildSpells(await this.bundle.table('injuries'), cutoff));
  }

  private async ensure(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    const manifest = await this.bundle.manifest().catch(() => null);
    this.readAt.set(manifest?.generated_at ?? null);
    // The DECLARED notes are about a SEASON, and the one that matters is the season this bundle is for:
    // a note about last summer's quarrel is not a fact about this auction.
    this.declared.set(declaredFor(await this.bundle.playerNotes(), manifest?.target_season ?? null));
    try {
      this.spells.set(buildSpells(await this.bundle.table('injuries')));
      this.loaded.set(true);
    } catch {
      // An older bundle without the table: no injury mark is shown, and `loaded` stays false so nothing
      // reads the silence as «nobody is injured».
    }
  }

  /** The declared notes of this bundle's season, keyed by `fc_id`. Empty when nothing is declared. */
  readonly declared = signal<Map<number, PlayerNote>>(new Map());

  private readonly injuryMarks = computed(() => {
    const today = this.today();
    const out = new Map<number, PlayerMark>();
    for (const [id, spells] of this.spells()) {
      const mark = injuryMark(spells, today);
      if (mark) out.set(id, mark);
    }
    return out;
  });

  /** ...and who breaks down OFTEN, which is a different fact from being hurt today. */
  private readonly fragileMarks = computed(() => {
    const today = this.today();
    const out = new Map<number, PlayerMark>();
    for (const [id, spells] of this.spells()) {
      const mark = fragilityMark(spells, today);
      if (mark) out.set(id, mark);
    }
    return out;
  });

  /** How much of the last three years a man lost, for whoever prices him. Zero when nothing is on file. */
  fragility(playerId: number): Fragility {
    return fragilityOf(this.spells().get(playerId) ?? [], this.today());
  }

  /**
   * Le due abitudini misurate: cartellini e rigori sbagliati. Registrate da fuori come i misteri e per
   * la stessa ragione - la carriera che le misura la legge chi calcola le letture.
   */
  readonly habits = signal<Map<number, PlayerMark[]>>(new Map());

  /**
   * I MISTERI: chi non gioca pur essendo disponibile e prezzato per giocare.
   *
   * Registrati da fuori come gli screen, e per la stessa ragione: il percentile del prezzo è un fatto
   * sul RUOLO dentro UN listone, e solo chi possiede la selezione sa quale listone sia.
   */
  readonly mysteries = signal<Map<number, PlayerMark>>(new Map());

  /**
   * The two calibrated SCREENS, pushed in by whoever holds the pool.
   *
   * They are not computed here on purpose: a screen's price percentile is measured inside the ROLE and
   * inside the LISTONE being played, and only the panel knows which listone that is - «the pool of a
   * percentile is part of the measurement» is a rule this project has already paid for. So the owner of
   * the selection computes them (`player-screens.ts`, pure and tested) and registers them here, which
   * keeps ONE marks pipeline and one component instead of a second way of decorating a name.
   *
   * Empty is the normal case, and before a season's first two rounds it is empty BY CONSTRUCTION: the
   * screens read minutes actually played, so in August nothing lights up and that is not a fault.
   */
  readonly screens = signal<Map<number, PlayerMark>>(new Map());

  /**
   * Who took a shirt during the measured season and who lost one, registered the same way and for the
   * same reason: it is MEASURED by the toolkit (`desc_place_*`) and read off the sheet that is in play,
   * so only the panel knows which sheet that is. The app never re-derives it - it writes the sentence.
   */
  readonly places = signal<Map<number, PlayerMark>>(new Map());

  /**
   * ...e chi una COPPA CONTINENTALE porta via in mezzo al campionato.
   *
   * Registrato da fuori come i precedenti, e dalla stessa fonte: il FOGLIO. Chi va a un torneo è una
   * previsione su una persona - il toolkit la calcola, l'app la disegna - e il calendario delle giornate
   * a rischio dipende dal campionato del club, che solo il foglio conosce. Vuoto è lo stato normale: in
   * una stagione senza coppe in mezzo nessuno lo porta, e nel 2026-27 la Coppa d'Africa è estiva.
   */
  readonly cups = signal<Map<number, PlayerMark>>(new Map());

  /** Every mark a man carries, in the order they are drawn. Empty is the normal case. */
  marksFor(playerId: number | null | undefined): PlayerMark[] {
    if (playerId == null) return [];
    const marks: PlayerMark[] = [];
    const injury = this.injuryMarks().get(playerId);
    if (injury) marks.push(injury);
    // Being hurt NOW and breaking down OFTEN are two different facts, and a man can carry both: the
    // state of today is drawn first, the habit beside it.
    const fragile = this.fragileMarks().get(playerId);
    if (fragile) marks.push(fragile);
    // ...and the man who is neither hurt nor fragile and still does not play.
    const mystery = this.mysteries().get(playerId);
    if (mystery) marks.push(mystery);
    // Le abitudini vengono dopo gli stati: quello che È viene prima di quello che FA.
    marks.push(...(this.habits().get(playerId) ?? []));
    const declared = this.declared().get(playerId);
    if (declared) marks.push(declaredMark(declared));
    // La coppa continentale sta fra gli STATI e le letture: è un fatto sul calendario che verrà - non
    // uno stato di oggi come l'infortunio, e non una proiezione come gli screen - e riguarda proprio le
    // giornate che si stanno comprando.
    const cup = this.cups().get(playerId);
    if (cup) marks.push(cup);
    // Then what happened to his shirt LAST season - a measured fact about the past, which outranks a
    // projection and is outranked by a state of now.
    const place = this.places().get(playerId);
    if (place) marks.push(place);
    // The screen goes LAST: an availability fact outranks a projection about form, and the order the
    // marks are pushed in is the order they are drawn.
    const screen = this.screens().get(playerId);
    if (screen) marks.push(screen);
    return marks;
  }
}

/** What each declared kind is called at the table. One icon for the three; the word is the difference. */
const DECLARED_LABEL: Record<PlayerNote['kind'], string> = {
  out_of_squad: 'Fuori rosa',
  dispute: 'Ha litigato con la società',
  wants_out: 'Ha chiesto di andare via',
};

/**
 * The notes of ONE season, keyed by `fc_id`.
 *
 * The file's own `_comment` and `edition` keys sit beside the seasons, so a reader that walked every key
 * would take them for one: only the requested season is read, and a note whose key is not a number is
 * dropped rather than shown under an id nobody can join.
 */
export function declaredFor(
  file: PlayerNotesFile | null,
  season: string | null,
): Map<number, PlayerNote> {
  const out = new Map<number, PlayerNote>();
  const entries = season ? file?.[season] : null;
  if (!entries || typeof entries !== 'object') return out;
  for (const [id, note] of Object.entries(entries as Record<string, PlayerNote>)) {
    const fcId = Number(id);
    if (!Number.isFinite(fcId) || !note?.kind || !(note.kind in DECLARED_LABEL)) continue;
    out.set(fcId, note);
  }
  return out;
}

/** A declared note as a mark: what it is, what he said about it, and the day he said it. */
export function declaredMark(note: PlayerNote): PlayerMark {
  const bits = [DECLARED_LABEL[note.kind]];
  if (note.note) bits.push(note.note);
  if (note.decided_on) bits.push(`dichiarato il ${it(note.decided_on)}`);
  return { flag: 'dispute', note: bits.join(' · ') };
}
