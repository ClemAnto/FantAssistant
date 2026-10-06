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
import { onSeasonBase, sheetSeasonScale } from './season-scale';
import { normalizeTitolarita } from './titolarita';

/**
 * «xG/xA NOTEVOLI» (operator, 06/10/2026, con l'uscita di R29: «aggiungiamo però un'icona per quelli come
 * Zaccagni che hanno xG o xA notevoli»): da questa fortuna non pagata per presenza (`EngineNumbers.xgLuck`)
 * la riga porta il marchio. Soglia di DISPLAY, dichiarata e fissata CONTANDO sul foglio rigenerato senza
 * R29 (revisione 84, Serie A classic): 0,10 marca 98 uomini su 564, 0,15 ne marca 53, 0,20 ne marca 29 —
 * il 5%, una manciata per ruolo — e il caso che ha dato il nome alla richiesta (Zaccagni, 0,23) è dentro
 * con margine. Nessuna valutazione la legge.
 */
export const XG_LUCK_NOTABLE = 0.2;

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
    // Il surplus e la media voto attesa che SWING legge: il primo col suo ripiego dichiarato, la
    // seconda perche' `est_fm - est_mv` e' il tasso di bonus. Nessuna delle due si ricalcola.
    estSurplus: at('est_surplus'),
    mv: at('est_mv'),
    reason: at('engine_unpriced_reason'),
    estFm: at('est_fm'),
    estPv: at('est_pv'),
    estConfidence: at('est_confidence'),
    estBasis: at('est_basis'),
    estNote: at('est_note'),
    minutes: at('desc_minutes_full_season'),
    matches: at('desc_season_matches'),
    xgLuck: at('desc_xg_luck'),
    // IL GRADINO e i minuti che si aspetta: `desc_titolarita` è la scala a cinque parole
    // dell'operatore (bandiera · titolare · ballottaggio · panchina · riserva) e
    // `desc_minutes_next` la previsione dei minuti per partita. Sono le due frasi che un'asta chiede
    // di un nome, e stanno qui e non in una seconda lettura perché due lettori dello stesso foglio
    // finiscono per dare a un uomo due risposte.
    titolarita: at('desc_titolarita'),
    // ...e la QUOTA che c'e' dietro quella parola: la meta' delle partite disponibili in cui il
    // pannello lo aspetta col voto. La legge `expected-play.ts` dove il motore ripiega su una
    // costante di ruolo - li' la board ne sa di piu' (il metro della plancia, 04/09/2026).
    titolaritaPlay: at('desc_titolarita_play'),
    minutesNext: at('desc_minutes_next'),
    // LA PAROLA DENTRO IL RUOLO coi numeri che la decidono, letta qui per la stessa ragione delle due
    // sopra: tre viste la mostrano e tre lettori dello stesso foglio finirebbero per dare a un uomo
    // tre categorie. `engine/categories.py` la misura, `core/categoria.ts` la traduce.
    category: at('desc_category'),
    categoryLevel: at('desc_category_level'),
    categoryBars: at('desc_category_bars'),
  };

  // OGNI NUMERO IN GIORNATE SU UNA STAGIONE PIENA (`season-scale.ts`, 22/09/2026): il foglio prevede
  // le giornate che RESTANO, e le pagine leggono sulla scala della stagione. Derivata dal foglio
  // STESSO invece di essere passata dal chiamante, perche' i due calendari sono scritti accanto alle
  // righe che si stanno leggendo - un parametro in piu' sarebbe una cosa da ricordare in ogni punto
  // di chiamata, ed e' cosi' che una meta' dell'app finirebbe su una base e l'altra su un'altra.
  // Una tabella che non e' un foglio non li ha, e allora la scala e' 1.
  const scale = sheetSeasonScale(table.matchdays);

  const numbers = new Map<number, EngineNumbers>();
  for (const row of table.rows) {
    const id = Number(row[columns.id]);
    if (!id) continue;
    numbers.set(id, {
      fm: row[columns.fm] as number | null,
      pv: onSeasonBase(row[columns.pv] as number | null, scale),
      slot: (row[columns.slot] as string | null) ?? null,
      replacementFm: row[columns.replacement] as number | null,
      surplusLeague: onSeasonBase(row[columns.surplus] as number | null, scale),
      // `?? null` come le due sotto: una colonna che il foglio non ha legge -1 dall'`indexOf`, e
      // `row[-1]` e' `undefined` - normalizzata qui, dove la colonna viene letta.
      estSurplus: onSeasonBase((row[columns.estSurplus] as number | null) ?? null, scale),
      mv: (row[columns.mv] as number | null) ?? null,
      unpricedReason: (row[columns.reason] as string | null) ?? null,
      estFm: row[columns.estFm] as number | null,
      estPv: onSeasonBase(row[columns.estPv] as number | null, scale),
      estConfidence: row[columns.estConfidence] as number | null,
      estBasis: (row[columns.estBasis] as string | null) ?? null,
      estNote: (row[columns.estNote] as string | null) ?? null,
      minutesFullSeason: row[columns.minutes] as number | null,
      seasonMatches: row[columns.matches] as number | null,
      // Un foglio anteriore alla revisione 84 non ha la colonna: `row[-1]` e' `undefined` -> null.
      xgLuck: (row[columns.xgLuck] as number | null) ?? null,
      // Una colonna che il foglio non ha (una revisione più vecchia) legge -1 dall'`indexOf`, e
      // `row[-1]` è `undefined`: si normalizza a null qui, dove la colonna viene letta, o ogni
      // lettore a valle finirebbe per inventarsi il proprio ripiego.
      // Un foglio scritto prima del 01/10/2026 porta ancora `titolarissimo`: si legge come `titolare`.
      titolarita: normalizeTitolarita((row[columns.titolarita] as string | null) ?? null),
      titolaritaPlay: (row[columns.titolaritaPlay] as number | null) ?? null,
      minutesNext: (row[columns.minutesNext] as number | null) ?? null,
      // ...e la categoria, con lo stesso `?? null` delle tre sopra e per la stessa ragione: un
      // foglio anteriore alla revisione 72 non ha la colonna e `row[-1]` e' `undefined`.
      category: (row[columns.category] as string | null) ?? null,
      categoryLevel: (row[columns.categoryLevel] as number | null) ?? null,
      categoryBars: (row[columns.categoryBars] as string | null) ?? null,
    });
  }
  return numbers;
}
