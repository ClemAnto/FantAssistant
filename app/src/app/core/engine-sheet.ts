/**
 * ONE reader of the engine columns of a sheet.
 *
 * It exists because three pages now stand on the same numbers - the draft panel, the slot board and
 * whatever comes next - and two readers of `engine_fm_pred` would eventually give one man two
 * valuations. The first place anybody would notice is at a table.
 *
 * Pure on purpose: it takes the table the bundle already loaded and returns the numbers, so a test
 * can reach it without a network and without a store.
 */

import { BundleTable } from './bundle';
import { EngineNumbers } from './auction-value';

/** `fc_id` -> what the engine says about him. A row without an id is not a row. */
export function engineNumbersFrom(table: BundleTable): Map<number, EngineNumbers> {
  const at = (name: string) => table.columns.indexOf(name);
  const columns = {
    id: at('fc_id'),
    fm: at('engine_fm_pred'),
    pv: at('engine_pv_pred'),
    slot: at('engine_role_slot'),
    replacement: at('engine_replacement_fm'),
    surplus: at('engine_surplus'),
    reason: at('engine_unpriced_reason'),
    estFm: at('est_fm'),
    estPv: at('est_pv'),
    estConfidence: at('est_confidence'),
    estBasis: at('est_basis'),
    estNote: at('est_note'),
    minutes: at('desc_minutes_full_season'),
    matches: at('desc_season_matches'),
  };

  const numbers = new Map<number, EngineNumbers>();
  for (const row of table.rows) {
    const id = Number(row[columns.id]);
    if (!id) continue;
    numbers.set(id, {
      fm: row[columns.fm] as number | null,
      pv: row[columns.pv] as number | null,
      slot: (row[columns.slot] as string | null) ?? null,
      replacementFm: row[columns.replacement] as number | null,
      surplusLeague: row[columns.surplus] as number | null,
      unpricedReason: (row[columns.reason] as string | null) ?? null,
      estFm: row[columns.estFm] as number | null,
      estPv: row[columns.estPv] as number | null,
      estConfidence: row[columns.estConfidence] as number | null,
      estBasis: (row[columns.estBasis] as string | null) ?? null,
      estNote: (row[columns.estNote] as string | null) ?? null,
      minutesFullSeason: row[columns.minutes] as number | null,
      seasonMatches: row[columns.matches] as number | null,
    });
  }
  return numbers;
}
