/**
 * THE DRAFT, DOWNLOADED FOR ANALYSIS (operator, 29/09/2026: «scaricare le rose costituite e la lista delle
 * scelte per analizzarle»). Two files from ONE set of records, so the squads and the pick list can never
 * disagree about who took whom and for how much: the pick list in call order, the squads grouped by team.
 *
 * The format is CSV for the operator's Excel: `;` between cells (an Italian Excel splits on it, not on a
 * comma), a UTF-8 BOM (or accented names open as mojibake), and the DECIMAL POINT - the app's own rule
 * (05/09/2026), which is also what any analysis tool reads without being told. An unknown number is an EMPTY
 * cell, never a zero: «vuoto = ignoto» holds in a file as on a screen.
 *
 * Nothing here is a valuation: the numbers of a man are the ones the page already shows, handed in by the
 * view, so a download cannot price a man differently from the screen it was taken from.
 */

import type { AuctionPlayer, AuctionTeam } from './auction-feed';

export type Cell = string | number | null | undefined;

/** What the view knows about a man beyond the listone row: the same readings its lists print. */
export interface ExportReadings {
  /** The titolarità word (press first, else the sheet's rung) and who said it. */
  rung: string | null;
  rungSource: 'stampa' | 'motore' | null;
  /** Expected fantamedia and appearances, as the «previste» view shows them. */
  fm: number | null;
  pv: number | null;
  /** Fantamedia x appearances, and the same worth on the session's 0-99 scale. */
  value: number | null;
  value99: number | null;
}

export interface PickRecord {
  /** 1 = the first pick of the draft. */
  overall: number;
  /** The squad's own turn for this pick: its 1st, 2nd, ... man. In a draft this IS the round. */
  round: number;
  team: AuctionTeam | null;
  player: AuctionPlayer | null;
  cost: number;
}

/**
 * The picks in CALL order, each with the squad's own turn counted as it goes - not derived from the
 * overall index, whose base and whose snake the feed does not declare.
 */
export function pickRecords(
  picks: readonly { cost: number; player: AuctionPlayer | null; team: AuctionTeam | null }[],
): PickRecord[] {
  const turns = new Map<number, number>();
  return picks.map((pick, at) => {
    const id = pick.team?.id ?? -1;
    const round = (turns.get(id) ?? 0) + 1;
    turns.set(id, round);
    return { overall: at + 1, round, team: pick.team, player: pick.player, cost: pick.cost };
  });
}

/** One cell as CSV: quoted only when it has to be, a number with the decimal POINT and at most two decimals. */
function cellOf(value: Cell): string {
  if (value == null) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return String(Math.round(value * 100) / 100);
  }
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  return [header, ...rows].map((row) => row.map(cellOf).join(';')).join('\r\n') + '\r\n';
}

const HEADER = [
  'scelta', 'giro', 'squadra', 'mia', 'fc_id', 'calciatore', 'club', 'ruolo', 'ruoli_mantra', 'fvm', 'costo',
  'titolarita', 'fonte_titolarita', 'fm_prevista', 'pv_prevista', 'valore', 'valore99',
];

function rowOf(record: PickRecord, mineId: number | null, readings: (id: number) => ExportReadings | null): Cell[] {
  const player = record.player;
  const read = player ? readings(player.id) : null;
  return [
    record.overall,
    record.round,
    record.team?.label ?? null,
    record.team && record.team.id === mineId ? 'si' : '',
    player?.id ?? null,
    player?.name ?? null,
    player?.club ?? null,
    player ? CLASSIC_LETTER[player.zoneClassic] ?? null : null,
    player?.roles.join(',') ?? null,
    player?.fvm ?? null,
    record.cost,
    read?.rung ?? null,
    read?.rungSource ?? null,
    read?.fm ?? null,
    read?.pv ?? null,
    read?.value ?? null,
    read?.value99 ?? null,
  ];
}

const CLASSIC_LETTER: Record<string, string> = { gk: 'P', def: 'D', mid: 'C', atk: 'A' };

/** The pick list, in the order the picks were made. */
export function picksCsv(
  records: readonly PickRecord[],
  mineId: number | null,
  readings: (id: number) => ExportReadings | null,
): string {
  return toCsv(HEADER, records.map((record) => rowOf(record, mineId, readings)));
}

/**
 * The squads: the same rows grouped by team, in the teams' order, and inside a team by its own turn. Same
 * columns as the pick list on purpose - one file can be pasted under the other and a pivot works on both.
 */
export function squadsCsv(
  records: readonly PickRecord[],
  teams: readonly AuctionTeam[],
  mineId: number | null,
  readings: (id: number) => ExportReadings | null,
): string {
  const order = new Map(teams.map((team, at) => [team.id, at]));
  const sorted = [...records].sort(
    (a, b) =>
      (order.get(a.team?.id ?? -1) ?? teams.length) - (order.get(b.team?.id ?? -1) ?? teams.length) ||
      a.round - b.round,
  );
  return toCsv(HEADER, sorted.map((record) => rowOf(record, mineId, readings)));
}

/** Hands the browser a file to save. The BOM makes an Italian Excel read the names as UTF-8. */
export function saveCsv(fileName: string, text: string): void {
  const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
