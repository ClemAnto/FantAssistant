import { Injectable, computed } from '@angular/core';

import { LegheLeague, LeghePlatform } from './leghe-api';
import { LegheTeam, NextMatchRow } from './leghe-matchday';
import { LegheGame, parseRules } from './leghe-rules';
import { LeagueMatchday } from './leghe-session';
import { PlayerRow } from './players-store';
import { parseAwards } from './sealed-bid';
import { storedJson } from './view-state';

/**
 * THE ROSTER FROM A FILE (16/10/2026), and no login at all (operator: «cambiamo completamente paradigma: non ci
 * serve fare il login sulla piattaforma ... utilizziamo semplicemente il file csv esportabile»).
 *
 * The file is the league's own roster export - Leghe and EuroLeghe write the same one: `team,fc_id,credits`,
 * one line per man, `$,$,$` between two squads. It is parsed by `sealed-bid.parseAwards`, the reader the
 * sealed-bid page already uses on the same export, so the two pages cannot read two different rosters out of
 * one file. The `fc_id` is fantacalcio.it's id, which is the bundle's key: a man joins the listone by identity.
 *
 * WHAT THE FILE DOES NOT CARRY, said rather than filled in: the league's lineup RULES (allowed modules, bench,
 * modifiers - the rulebook's whole module list applies), the competitions and this matchday's OPPONENT, the
 * platform's probable-starter percentage, and the deadline. And so no lineup is SAVED anywhere: the page draws
 * it, he types it into Leghe. What he declares here instead - the listone (which platform), the game and which
 * of the squads is his - is stored with the file.
 */

/** One squad of the file, in the file's order. */
export interface FileTeam {
  name: string;
  ids: number[];
}

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
      roles: file.game === 'mantra' ? (row.mantraCodes.length ? row.mantraCodes : []) : [row.role],
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
    name: file.fileName,
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

const sanitise = (raw: unknown): RosterFile | null => {
  const o = raw as Partial<RosterFile> | null;
  if (!o || typeof o !== 'object' || !Array.isArray(o.teams) || typeof o.fileName !== 'string') return null;
  const teams = o.teams.filter(
    (t): t is FileTeam => !!t && typeof t.name === 'string' && Array.isArray(t.ids) && t.ids.every(Number.isFinite),
  );
  if (!teams.length) return null;
  return {
    fileName: o.fileName,
    loadedAt: typeof o.loadedAt === 'string' ? o.loadedAt : new Date().toISOString(),
    teams,
    team: typeof o.team === 'string' && teams.some((t) => t.name === o.team) ? o.team : null,
    platform: o.platform === 'euro' ? 'euro' : 'classic',
    game: o.game === 'mantra' ? 'mantra' : 'classic',
  };
};

/** The loaded file and his declarations, remembered by this browser (`localStorage`): rosters, not credentials. */
@Injectable({ providedIn: 'root' })
export class RosterFileStore {
  readonly file = storedJson<RosterFile | null>('lineup.roster-file', sanitise);

  readonly ready = computed(() => !!this.file()?.team);

  /** A new export: his previous choice of squad survives when the new file still has a squad of that name. */
  load(fileName: string, csv: string, platform: LeghePlatform, game: LegheGame): number {
    const teams = parseRosterFile(csv);
    if (!teams.length) return 0;
    const before = this.file()?.team ?? null;
    this.file.set({
      fileName,
      loadedAt: new Date().toISOString(),
      teams,
      team: before && teams.some((t) => t.name === before) ? before : null,
      platform,
      game,
    });
    return teams.length;
  }

  update(change: Partial<Pick<RosterFile, 'team' | 'platform' | 'game'>>): void {
    const file = this.file();
    if (file) this.file.set({ ...file, ...change });
  }

  forget(): void {
    this.file.set(null);
  }
}
