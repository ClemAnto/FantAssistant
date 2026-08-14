import { Injectable, computed, inject, signal } from '@angular/core';

import { Bundle, BundleTable, PlayerNote, PlayerNotesFile, columnIndex, optionalIndex } from './bundle';

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

export type PlayerFlag =
  | 'long_injury'
  | 'back_from_long'
  | 'dispute'
  | 'promise'
  | 'flop_risk'
  | 'place_gained'
  | 'place_lost';

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

/** dd/mm/yyyy: a date in a tooltip is read by a person, not by a parser. */
const it = (iso: string): string => iso.split('-').reverse().join('/');

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

/** The dated spells per player, from the bundle's own table. */
export function buildSpells(table: BundleTable): Map<number, Spell[]> {
  const [id, from, to, kind] = columnIndex(table, 'fc_id', 'start_date', 'end_date', 'kind');
  // An older bundle may not carry them, and that is «unknown»: the dates still answer.
  const days = optionalIndex(table, 'days_out');
  const detail = optionalIndex(table, 'detail');
  const out = new Map<number, Spell[]>();
  for (const row of table.rows) {
    const start = row[from] as string | null;
    if (!start) continue;
    const fcId = Number(row[id]);
    let list = out.get(fcId);
    if (!list) out.set(fcId, (list = []));
    list.push({
      from: start,
      to: (row[to] as string | null) ?? null,
      days: days < 0 ? null : ((row[days] as number | null) ?? null),
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
   * assumed: this one is the clock's, and `readAt` carries the bundle's, which the tooltip states - an open
   * spell in a month-old bundle may have closed the day after it was written.
   */
  private readonly today = signal(new Date().toISOString().slice(0, 10));

  readonly readAt = signal<string | null>(null);

  /** True once the table is in: before that a missing mark means «not loaded», not «nothing wrong». */
  readonly loaded = signal(false);

  private loading = false;

  constructor() {
    void this.ensure();
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

  /** Every mark a man carries, in the order they are drawn. Empty is the normal case. */
  marksFor(playerId: number | null | undefined): PlayerMark[] {
    if (playerId == null) return [];
    const marks: PlayerMark[] = [];
    const injury = this.injuryMarks().get(playerId);
    if (injury) marks.push(injury);
    const declared = this.declared().get(playerId);
    if (declared) marks.push(declaredMark(declared));
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
