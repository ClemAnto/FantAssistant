import { Injectable, computed, inject, signal } from '@angular/core';

import { LegheLeague, LeghePlatform } from './leghe-api';
import { LegheTeam, NextMatchRow } from './leghe-matchday';
import { LegheGame, parseRules } from './leghe-rules';
import { LeagueMatchday } from './leghe-session';
import { NextRoundStore } from './next-round-store';
import { PlayerRow } from './players-store';
import { parseAwards } from './sealed-bid';
import { storedJson, storedText } from './view-state';
import { WidgetFeed } from './widget-feed';

/**
 * THE ROSTERS FROM FILES (16/10/2026), and no login at all (operator: «cambiamo completamente paradigma: non ci
 * serve fare il login sulla piattaforma ... utilizziamo semplicemente il file csv esportabile»).
 *
 * The file is the league's own roster export - Leghe and EuroLeghe write the same one: `team,fc_id,credits`,
 * one line per man, `$,$,$` between two squads. It is parsed by `sealed-bid.parseAwards`, the reader the
 * sealed-bid page already uses on the same export, so the two pages cannot read two different rosters out of
 * one file. The `fc_id` is fantacalcio.it's id, which is the bundle's key: a man joins the listone by identity.
 *
 * AS MANY ROSTERS AS HE LOADS, each one fantasquadra (operator, same day: «si possano caricare più rose e che
 * restino tutte in memoria (come squadre diverse) e poi successivamente si possa semplicemente selezionare la
 * squadra»): one entry per (listone, league, his squad), and a newer export of the same league replaces its
 * entry instead of adding a twin. And ON EVERY DEVICE («caricando una rosa su un dispositivo poi la rosa resta
 * visibile per ogni dispositivo»): the list is merged with the press sheet's copy (`scripts/gas/rosters.gs`,
 * same deployment as the widget, same secret), per entry and by date, a removal travelling as a tombstone.
 *
 * WHAT THE FILE DOES NOT CARRY, said rather than filled in: the league's lineup RULES (allowed modules, bench,
 * modifiers - the rulebook's whole module list applies), the competitions and this matchday's OPPONENT, the
 * platform's probable-starter percentage, and the deadline. And so no lineup is SAVED anywhere: the page draws
 * it, he types it into Leghe.
 */

/** One squad of the file, in the file's order. */
export interface FileTeam {
  name: string;
  ids: number[];
}

/** A file loaded and the three things he declared about it. */
export interface RosterFile {
  fileName: string;
  /** When it was loaded: the date the page shows, because the file is a reading and it ages. */
  loadedAt: string;
  teams: FileTeam[];
  /** His squad, by name; null = not chosen yet. */
  team: string | null;
  platform: LeghePlatform;
  game: LegheGame;
}

/** One stored fantasquadra. `removed` = a tombstone, kept so a removal reaches the other devices too. */
export interface SavedRoster extends RosterFile {
  key: string;
  /** When this entry last changed on any device: the merge keeps the later one. */
  updatedAt: string;
  removed?: boolean;
}

/** The squads of an export, in the order the file lists them. Empty = not a roster export. */
export function parseRosterFile(csv: string): FileTeam[] {
  const byTeam = new Map<string, number[]>();
  for (const award of parseAwards(csv)) {
    const ids = byTeam.get(award.team) ?? [];
    if (!ids.includes(award.fcId)) ids.push(award.fcId);
    byTeam.set(award.team, ids);
  }
  return [...byTeam].map(([name, ids]) => ({ name, ids }));
}

/**
 * The league's name as the export file carries it: Leghe names it `<league>_rosters_<timestamp>.csv`, so
 * `neuroseghe_rosters_1792146043476.csv` is «neuroseghe». Anything else: the name without extension and digits.
 */
export function leagueOfFile(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '').replace(/^['"]+|['"]+$/g, '');
  const m = base.match(/^(.*?)_rosters(?:_\d+)?$/i);
  const name = (m ? m[1] : base.replace(/[_\s-]*\d+$/, '')).replace(/^['"]+/, '').trim();
  return name || base;
}

/**
 * A NEW FANTASQUADRA'S IDENTITY: a random id, minted once and kept for good (operator, 19/10/2026: «la chiave delle
 * squadre dovrebbe essere un id e non il nome»). The export carries no id of the squad or the league - only names and
 * the players' `fc_id` - so a name-derived key changed whenever the same squad arrived by another road (it did, from
 * the Leghe login to the file, and the widget showed every man twice). Entries stored before this keep the key they
 * had: it is an id now, whatever it was made of.
 */
export function newRosterId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  return `r-${c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

/**
 * WHICH STORED SQUAD a newer export most likely updates: same listone, same league (the file's own prefix) and a squad
 * of the same name. The ONLY place a name decides anything, and only as the default of a choice he can change - a
 * renamed squad is picked by hand.
 */
export function matchingRoster(
  rosters: readonly SavedRoster[],
  file: Pick<RosterFile, 'platform' | 'fileName' | 'team'>,
): SavedRoster | null {
  const league = leagueOfFile(file.fileName).toLowerCase();
  return (
    rosters.find(
      (one) =>
        !one.removed &&
        one.platform === file.platform &&
        one.team === file.team &&
        leagueOfFile(one.fileName).toLowerCase() === league,
    ) ?? null
  );
}

/** Per key, the later `updatedAt` wins - a tombstone included. The order: newest first. */
export function mergeRosters(a: readonly SavedRoster[], b: readonly SavedRoster[]): SavedRoster[] {
  const byKey = new Map<string, SavedRoster>();
  for (const one of [...a, ...b]) {
    const seen = byKey.get(one.key);
    if (!seen || one.updatedAt > seen.updatedAt) byKey.set(one.key, one);
  }
  return [...byKey.values()].sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : -1));
}

/**
 * WHICH LISTONE the file belongs to, read off the ids: the platform whose listone knows more of them. The two
 * listoni overlap (the Serie A men quoted on both), so the answer is a majority and not a membership, and it is
 * only a default - the modal lets him change it.
 */
export function guessPlatform(
  teams: readonly FileTeam[],
  rows: ReadonlyMap<'default' | 'euro', readonly PlayerRow[]>,
): LeghePlatform {
  const ids = teams.flatMap((t) => t.ids);
  const known = (platform: 'default' | 'euro') => {
    const listone = new Set((rows.get(platform) ?? []).map((r) => r.fcId));
    return ids.filter((id) => listone.has(id)).length;
  };
  return known('euro') > known('default') ? 'euro' : 'classic';
}

/** The championship code the page's tooltips read (`standings.placeOf`), from the bundle's league key. */
const CHAMPIONSHIP: Record<string, string> = {
  serie_a: 'ITA',
  premier_league: 'ENG',
  la_liga: 'ESP',
  bundesliga: 'GER',
  ligue_1: 'FRA',
};

/**
 * The page's model built from the file and the bundle's listone: one `NextMatchRow` per man of his squad, with the
 * facts the bundle knows (name, roles in the declared game, club, championship, sold) and NOTHING invented for the
 * ones only Leghe served - no match label, no percentage, no availability code, no season averages. A man the
 * listone does not know has no name or role to field him with, so he is left out and counted (`unknown`).
 */
export function matchdayFromFile(
  file: RosterFile,
  rows: ReadonlyMap<number, PlayerRow>,
  now: Date,
): (LeagueMatchday & { unknown: number[] }) | null {
  const mine = file.teams.find((t) => t.name === file.team);
  if (!mine) return null;
  const teams: LegheTeam[] = file.teams.map((t, i) => ({ id: i + 1, name: t.name, manager: '', division: 'A', roster: t.ids }));
  const roster: NextMatchRow[] = [];
  const unknown: number[] = [];
  for (const fcId of mine.ids) {
    const row = rows.get(fcId);
    if (!row) {
      unknown.push(fcId);
      continue;
    }
    roster.push({
      fcId,
      name: row.name,
      roles: file.game === 'mantra' ? row.mantraCodes : [row.role],
      club: row.club,
      championship: (row.league && CHAMPIONSHIP[row.league]) ?? '',
      match: '',
      home: null,
      percent: null,
      out: null,
      note: null,
      vote: null,
      fantavote: null,
      transferred: row.sold,
      clubId: null,
      opponentId: null,
    });
  }
  const league: LegheLeague = {
    platform: file.platform,
    id: 0,
    name: leagueOfFile(file.fileName),
    alias: '',
    jwt: '',
    game: file.game,
  };
  const loaded = new Date(file.loadedAt);
  return {
    league,
    status: { matchday: null, firstMatch: null, live: false },
    // Only the game is known: every other rule is «not read», and the rulebook's whole module list applies.
    rules: parseRules(null, null, { sroles: file.game === 'mantra' ? 2 : 1 }),
    team: teams.find((t) => t.name === file.team) ?? null,
    teams,
    competitions: [],
    roster,
    realTeams: new Map(),
    closesAt: null,
    readAt: Number.isNaN(loaded.getTime()) ? now : loaded,
    servedAt: now,
    requests: 0,
    unknown,
  };
}

const isTeam = (t: unknown): t is FileTeam =>
  !!t &&
  typeof (t as FileTeam).name === 'string' &&
  Array.isArray((t as FileTeam).ids) &&
  (t as FileTeam).ids.every((id) => typeof id === 'number' && Number.isFinite(id));

/** One stored entry as it came off the disk or the sheet; null = not one we can read. */
export function readSaved(raw: unknown): SavedRoster | null {
  const o = raw as Partial<SavedRoster> | null;
  if (!o || typeof o !== 'object' || typeof o.key !== 'string' || typeof o.updatedAt !== 'string') return null;
  if (o.removed) return { key: o.key, updatedAt: o.updatedAt, removed: true, fileName: '', loadedAt: o.updatedAt, teams: [], team: null, platform: 'classic', game: 'classic' };
  if (typeof o.fileName !== 'string' || !Array.isArray(o.teams)) return null;
  const teams = o.teams.filter(isTeam);
  if (!teams.length || typeof o.team !== 'string' || !teams.some((t) => t.name === o.team)) return null;
  return {
    key: o.key,
    updatedAt: o.updatedAt,
    fileName: o.fileName,
    loadedAt: typeof o.loadedAt === 'string' ? o.loadedAt : o.updatedAt,
    teams,
    team: o.team,
    platform: o.platform === 'euro' ? 'euro' : 'classic',
    game: o.game === 'mantra' ? 'mantra' : 'classic',
  };
}

const readList = (raw: unknown): SavedRoster[] =>
  Array.isArray(raw) ? raw.map(readSaved).filter((one): one is SavedRoster => !!one) : [];

export type RosterSync =
  | { kind: 'off'; why: string }
  | { kind: 'syncing' }
  | { kind: 'done'; at: Date }
  | { kind: 'failed'; why: string };

/** The rosters he loaded, remembered by this browser and merged with the sheet's copy. */
@Injectable({ providedIn: 'root' })
export class RosterFileStore {
  private readonly sheet = inject(NextRoundStore);
  private readonly widget = inject(WidgetFeed);

  /** Every entry, tombstones included (they are what tells another device a roster was removed). */
  private readonly saved = storedJson<SavedRoster[]>('lineup.rosters', readList);
  /** The fantasquadra on screen, by key. */
  private readonly chosenKey = storedText('lineup.roster', '');

  readonly sync = signal<RosterSync>({ kind: 'off', why: '' });

  /** The live entries, newest first. */
  readonly rosters = computed(() => this.saved().filter((one) => !one.removed));

  /** The one on screen: the chosen entry, else the newest. */
  readonly file = computed<SavedRoster | null>(() => {
    const all = this.rosters();
    return all.find((one) => one.key === this.chosenKey()) ?? all[0] ?? null;
  });

  readonly ready = computed(() => !!this.file());

  constructor() {
    void this.pull();
  }

  choose(key: string): void {
    this.chosenKey.set(key);
  }

  /**
   * A loaded file with his three declarations becomes an entry: it UPDATES the squad he chose (`replace`, its id kept,
   * so the widget and every device go on seeing the same squad) or is a new squad with a new id.
   */
  add(file: RosterFile, replace: string | null): string {
    const now = new Date().toISOString();
    const key = replace && this.rosters().some((one) => one.key === replace) ? replace : newRosterId();
    const entry: SavedRoster = { ...file, key, updatedAt: now };
    this.saved.set(mergeRosters(this.saved(), [entry]));
    this.chosenKey.set(entry.key);
    void this.push();
    return entry.key;
  }

  remove(key: string): void {
    const now = new Date().toISOString();
    const gone: SavedRoster = { key, updatedAt: now, removed: true, fileName: '', loadedAt: now, teams: [], team: null, platform: 'classic', game: 'classic' };
    this.saved.set(mergeRosters(this.saved(), [gone]));
    void this.push();
  }

  /** «Sincronizza»: the sheet's list merged into this one, and this one sent back. */
  async refresh(): Promise<void> {
    if (await this.pull()) await this.push();
  }

  private where(): { base: string; secret: string } | null {
    const base = this.sheet.url().trim();
    const secret = this.widget.secret().trim();
    if (!base) {
      this.sync.set({ kind: 'off', why: 'nessun indirizzo del foglio' });
      return null;
    }
    if (!secret) {
      this.sync.set({ kind: 'off', why: 'scrivi la chiave segreta per averle su ogni dispositivo' });
      return null;
    }
    return { base, secret };
  }

  /** Reads the sheet's list and merges it in. True = it answered. */
  private async pull(): Promise<boolean> {
    const at = this.where();
    if (!at) return false;
    this.sync.set({ kind: 'syncing' });
    const answer = await this.call(() =>
      fetch(`${at.base}${at.base.includes('?') ? '&' : '?'}what=rosters&secret=${encodeURIComponent(at.secret)}`, { redirect: 'follow' }),
    );
    if (!answer) return false;
    this.saved.set(mergeRosters(this.saved(), readList(answer.rosters)));
    this.sync.set({ kind: 'done', at: new Date() });
    return true;
  }

  /** Sends this list; the sheet answers the merge, which is adopted. */
  private async push(): Promise<void> {
    const at = this.where();
    if (!at) return;
    this.sync.set({ kind: 'syncing' });
    const body = JSON.stringify({ kind: 'rosters', secret: at.secret, rosters: this.saved() });
    const answer = await this.call(() =>
      fetch(at.base, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body }),
    );
    if (!answer) return;
    this.saved.set(mergeRosters(this.saved(), readList(answer.rosters)));
    this.sync.set({ kind: 'done', at: new Date() });
  }

  /**
   * One request with three tries, for the reason `NextRoundStore` and `WidgetFeed` have them: Apps Script's second
   * hop fails by itself now and then. A refusal the sheet SAYS (a wrong secret) is not retried.
   */
  private async call(request: () => Promise<Response>): Promise<{ rosters: unknown } | null> {
    let last = '';
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const res = await request();
        let raw: { ok?: boolean; why?: string; rosters?: unknown } | null = null;
        try {
          raw = JSON.parse(await res.text());
        } catch {
          raw = null;
        }
        if (raw?.ok) return { rosters: raw.rosters };
        if (raw && raw.ok === false) {
          this.sync.set({ kind: 'failed', why: raw.why ?? 'il foglio ha rifiutato' });
          return null;
        }
        last = res.ok ? 'il foglio non conosce ancora le rose (va aggiunto rosters.gs e ridistribuito)' : `il foglio ha risposto ${res.status}`;
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
      if (attempt < 3) await new Promise((go) => setTimeout(go, 600));
    }
    this.sync.set({ kind: 'failed', why: last });
    return null;
  }
}
