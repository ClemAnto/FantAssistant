import { Injectable } from '@angular/core';

/** A table as the export writes it: a header and rows of positional values. */
export interface BundleTable {
  table: string;
  columns: string[];
  rows: unknown[][];
}

/**
 * One league's engine numbers, as the export declares them.
 *
 * The league is part of the fact and not a label: the replacement level a surplus is measured
 * against comes from `teams x squad_slots`, so two entries of the same platform and game can carry
 * different numbers. `matchdays_target` is the calendar `engine_pv_pred` is expressed on, which is
 * what lets a competition of n rounds be scaled by n/N instead of guessed.
 */
export interface EngineSheetEntry {
  league: string;
  platform: 'default' | 'euro';
  game: 'classic' | 'mantra';
  teams: number | null;
  squad_slots: Record<string, number> | null;
  matchdays_target: number | null;
  sheet_revision: number | null;
  generated_at: string | null;
  auction_date: string | null;
  rows: number;
  priced: number;
  estimated: number;
  /** Bundle-relative path, e.g. `sheets/euroleghe.json.gz`. */
  path: string;
}

/** The part of the manifest the UI reads. It is normative: refuse a schema we do not know. */
export interface BundleManifest {
  schema_version: number;
  generated_at: string;
  target_season: string;
  input_season: string;
  heavy_seasons: string[];
  sheet_revision?: number;
  /** Empty when the bundle carries no engine numbers - which the panel must SAY, not paper over. */
  engine_sheets?: EngineSheetEntry[];
  /** True only for the generated bundle the public build ships: invented clubs, players and
   *  votes. The real one is paid content and never leaves the machine. */
  demo?: boolean;
  known_gaps?: string[];
}

/** Only the terms a match can carry. `clean_sheet_bonus_gk` is deliberately absent from every
 *  computation: the config's own note records that the SOURCE does not apply it - measured on
 *  16,017 keeper rows, exact in 100% of them - and every reader must keep leaving it out. */
export interface ScoringTerms {
  goal_bonus: number;
  penalty_scored_bonus: number;
  penalty_missed_malus: number;
  assist_bonus: number;
  assist_set_piece_bonus: number;
  own_goal_malus: number;
  yellow_card_malus: number;
  red_card_malus: number;
  goal_conceded_malus_gk: number;
  penalty_saved_bonus_gk: number;
}

/** The shape of `mantra_modules.json`, as the toolkit ships it. */
export interface MantraModulesFile {
  edition?: string;
  slot_roles: Record<string, string[]>;
  modules: Record<string, Record<string, string[]>>;
}

export interface ScoringConfig {
  default: ScoringTerms;
  leagues: Record<string, Partial<ScoringTerms>>;
}

const KNOWN_SCHEMA = 1;

/** Reads the toolkit's export bundle. The app has no other data source: no scraping, no DB. */
@Injectable({ providedIn: 'root' })
export class Bundle {
  private readonly base = 'data';
  private readonly cache = new Map<string, Promise<BundleTable>>();
  private manifestPromise?: Promise<BundleManifest>;
  private scoringPromise?: Promise<ScoringConfig>;
  private modulesPromise?: Promise<MantraModulesFile | null>;
  private crestsPromise?: Promise<Record<string, string>>;

  manifest(): Promise<BundleManifest> {
    this.manifestPromise ??= fetch(`${this.base}/manifest.json`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(
            `manifest.json non trovato (${res.status}). Lancia "npm run data:pull" dopo un export del toolkit.`,
          );
        }
        return res.json() as Promise<BundleManifest>;
      })
      .then((manifest) => {
        if (manifest.schema_version !== KNOWN_SCHEMA) {
          throw new Error(
            `Bundle schema_version ${manifest.schema_version}: questa app conosce solo la ${KNOWN_SCHEMA}.`,
          );
        }
        return manifest;
      });
    return this.manifestPromise;
  }

  /** The per-CHAMPIONSHIP bonus/malus. It is read, never hard-coded: a league with
   *  non-standard scoring changes what a match was worth, and both the toolkit and the engine
   *  read this same file. */
  scoring(): Promise<ScoringConfig> {
    this.scoringPromise ??= fetch(`${this.base}/scoring_config.json`)
      .then((res) => (res.ok ? (res.json() as Promise<ScoringConfig>) : Promise.reject(
        new Error(`scoring_config.json non trovato (${res.status}).`))));
    return this.scoringPromise;
  }

  /**
   * The GAME's rules: the eleven legal Mantra shapes and which listone role fits each slot type.
   *
   * Read and never measured (`assistente-asta-v1.md` §12.3): it is a regulation, so estimating it
   * would be guessing at something that is written down. An older bundle simply does not carry it, and
   * the caller has to cope rather than pretend - hence null instead of a throw.
   */
  modules(): Promise<MantraModulesFile | null> {
    this.modulesPromise ??= fetch(`${this.base}/mantra_modules.json`).then((res) =>
      res.ok ? (res.json() as Promise<MantraModulesFile>) : null,
    );
    return this.modulesPromise;
  }

  /** fc_club_id -> file name, written by the export next to the badges themselves. */
  crests(): Promise<Record<string, string>> {
    this.crestsPromise ??= fetch(`${this.base}/crests/index.json`).then((res) =>
      res.ok ? (res.json() as Promise<Record<string, string>>) : {},
    );
    return this.crestsPromise;
  }

  table(name: string): Promise<BundleTable> {
    let pending = this.cache.get(name);
    if (!pending) {
      pending = this.load(name);
      this.cache.set(name, pending);
    }
    return pending;
  }

  private async load(name: string): Promise<BundleTable> {
    const res = await fetch(`${this.base}/${name}.json.gz`);
    if (!res.ok) {
      throw new Error(`Tabella "${name}" non disponibile nel bundle (${res.status}).`);
    }
    const raw = new Uint8Array(await res.arrayBuffer());
    // Whether the bytes are still gzipped depends on the server: some set Content-Encoding
    // and the fetch layer has already inflated them. Sniff the magic number instead of
    // assuming - assuming is how this breaks in production and not in dev.
    const gzipped = raw[0] === 0x1f && raw[1] === 0x8b;
    const text = gzipped
      ? await new Response(
          new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')),
        ).text()
      : new TextDecoder().decode(raw);
    return JSON.parse(text) as BundleTable;
  }
}

/** For a column a NEWER export added: an older bundle simply does not have it, and that is
 *  "unknown", not a reason to refuse the whole table. Returns -1, and the caller reads null. */
export function optionalIndex(table: BundleTable, name: string): number {
  return table.columns.indexOf(name);
}

/** Positional access without materialising an object per row: 110k rows go through here. */
export function columnIndex(table: BundleTable, ...names: string[]): number[] {
  return names.map((name) => {
    const at = table.columns.indexOf(name);
    if (at < 0) throw new Error(`La tabella "${table.table}" non ha la colonna "${name}".`);
    return at;
  });
}
