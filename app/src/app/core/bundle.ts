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
  /** The drawn boards of this sheet, or null when it was built before they existed. */
  boards?: string | null;
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

/**
 * One man of a drawn board, as `modules/boards.py` writes him.
 *
 * Every field is a MEASURED column of the sheet or the panel's own output - nothing here is derived a second
 * time by the app. `x` is the horizontal position the panel draws him at (0 = the team's right touchline,
 * 1 = its left), flank ordering and the pull toward the centre already applied.
 */
export interface BoardMan {
  fc_id: number | null;
  name: string | null;
  /** The granular real role codes, `;`-separated: the only thing that separates a left back from a centre. */
  codes: string | null;
  role_line: string | null;
  role_side: string | null;
  minutes: string | null;
  matches: string | null;
  minutes_club: string | null;
  starts_club: string | null;
  minutes_per_match: string | null;
  starter_prob: string | null;
  x?: number;
  claim: number | null;
  /** Up to two, in the panel's own order. */
  duels?: BoardMan[];
  /** False when his granular real role is unknown: then the duels are UNKNOWN, not absent. */
  duels_known?: boolean;
}

export interface Board {
  coach?: string | null;
  new_coach?: string | null;
  formation_typical?: string | null;
  /** The module the fit was solved on. */
  board_shape?: string | null;
  /** The module the DRAWN men actually form, after the panel's transformations: the numbers of the pitch. */
  picture?: string | null;
  why?: string | null;
  odds?: Record<string, number>;
  lines?: Record<'P' | 'D' | 'M' | 'T' | 'A', BoardMan[]>;
  /** Present when the panel could not draw this club at all: then there is nothing to show. */
  error?: string;
}

export interface BoardsFile {
  sheet: string;
  mode: string;
  /** True for the panel's own boards: they honour the operator's rulings, unlike the judges'. */
  apply_rulings: boolean;
  clubs: Record<string, Board>;
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
  private classicModulesPromise?: Promise<MantraModulesFile | null>;
  private readonly boardsByPath = new Map<string, Promise<BoardsFile | null>>();
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
  /**
   * The CLASSIC rulebook. Same shape, different law: a classic place is a MACRO-ROLE, so its `slot_roles`
   * map each of P/D/C/A to itself and there are no hybrid places at all. It is a separate file because
   * classic legality is not deducible from Mantra by analogy - and the panel needs it because its own role
   * rationing was measured PER GAME (`metrica-asta-surplus-v1.md` §17: the places-based target wins on
   * mantra and loses on classic).
   *
   * Null on an older bundle that does not carry it: the panel then rations with what `startingPlaces` can
   * say from nothing, which is «one per role, then depth». Reported, never silently treated as a rule.
   */
  classicModules(): Promise<MantraModulesFile | null> {
    this.classicModulesPromise ??= fetch(`${this.base}/classic_modules.json`).then((res) =>
      res.ok ? (res.json() as Promise<MantraModulesFile>) : null,
    ).catch(() => null);
    return this.classicModulesPromise;
  }


  /**
   * The DRAWN BOARDS of a league's sheet: per club the module, the eleven the PANEL places, and the duels.
   *
   * `path` comes from the manifest's own `engine_sheets[].boards`, so the app never guesses a file name - and
   * a sheet built before the boards existed simply carries null there, which the caller must treat as «no
   * board» rather than as an empty one.
   */
  boards(path: string): Promise<BoardsFile | null> {
    let pending = this.boardsByPath.get(path);
    if (!pending) {
      pending = fetch(`${this.base}/${path}`)
        .then((res) => (res.ok ? (res.json() as Promise<BoardsFile>) : null))
        .catch(() => null);
      this.boardsByPath.set(path, pending);
    }
    return pending;
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
