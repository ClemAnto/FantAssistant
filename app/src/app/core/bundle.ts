import { Injectable } from '@angular/core';

import type { CalendarFile } from './keeper-pairs';

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
/**
 * Il manifest di un pacchetto: il motore di una data passata, lega per lega.
 *
 * `known_gaps` è la parte che va MOSTRATA e non solo trasportata: sono le tre cose che nemmeno il
 * toolkit può retrodatare (probabili, ruolo granulare, scadenza di contratto) più la contaminazione a
 * favore del modello, e un pacchetto che le tacesse si farebbe leggere come una fotografia perfetta.
 */
export interface TimePackFile {
  date: string;
  target_season: string;
  input_season: string | null;
  window?: string;
  rounds_played?: Record<string, number>;
  /**
   * La `SHEET_REVISION` con cui i fogli di QUESTO pacchetto sono stati scritti.
   *
   * Un pacchetto sotto la revisione del bundle porta il motore di allora - non è un errore, è un fatto
   * che va detto: si rifà con `timepack --refresh`. Null su un pacchetto costruito prima del campo
   * (20/08/2026), che è «non dichiarata» e non «aggiornata».
   */
  sheet_revision?: number | null;
  known_gaps?: string[];
  leagues: {
    league: string;
    platform: 'default' | 'euro';
    game: 'classic' | 'mantra';
    teams: number | null;
    squad_slots: Record<string, number> | null;
    matchdays_target: number | null;
    rows: number | null;
    /** Percorso RELATIVO al pacchetto, es. `sheets/leghe.json.gz`. */
    sheet: string;
    boards: string | null;
  }[];
}

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
  /** Il file del calendario, o null: il bundle e' stato costruito senza una corsa di `fixtures`. */
  calendar?: string | null;
  engine_sheets?: EngineSheetEntry[];
  /**
   * Le date per cui il bundle porta il MOTORE di quel giorno (`timepack`), per il viaggio nel tempo.
   *
   * Assente su un bundle costruito prima: allora il viaggio retrodata solo quello che è datato qui
   * dentro - letture, trend, marchi - e il box lo dichiara invece di far credere il resto.
   */
  timepacks?: {
    date: string; target_season: string; input_season: string | null;
    window?: string; leagues: number; path: string;
    /** La revisione dei fogli del pacchetto: sotto quella del bundle è il motore di allora. */
    sheet_revision?: number | null;
  }[];
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
  /**
   * La PORTA INVIOLATA, che è il solo termine del config che la fonte NON applica.
   *
   * Sta nel `scoring_config` da sempre come termine configurabile per lega, e ogni lettore che
   * ricostruisce il fantavoto di fantacalcio.it deve continuare a lasciarlo fuori (misurato: su 16.017
   * righe di portiere `fm = mv − subiti + 3×parati − cartellini` è esatto al 100%). Qui si legge perché
   * la lega dell'operatore lo paga (sua decisione, 16/08/2026) e questa colonna dice quanto vale una
   * sua partita NELLA TUA LEGA, non quanto ha scritto il sito.
   */
  clean_sheet_bonus_gk: number;
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
  /** The LISTONE's own role(s), which is what the game scores by and what a bid is made against. */
  mantra: string | null;
  classic: string | null;
  /**
   * The one role he wears IN THIS MODULE - `Td`, `Dc`, `C`, `Pc`, `As`... - as the PANEL names it
   * (`_line_codes`, with its own corrections: a centre-forward stays a `Pc` and never becomes an `As`).
   * It is the marker a pitch shows, and it is not his whole code list.
   */
  badge: string | null;
  role_line: string | null;
  role_side: string | null;
  minutes: string | null;
  matches: string | null;
  minutes_club: string | null;
  starts_club: string | null;
  minutes_per_match: string | null;
  starter_prob: string | null;
  /**
   * LA FINESTRA CORTA, in due numeri: in quante delle ultime partite del suo club era DISPONIBILE e in
   * quante ha giocato. Su una board dell'ULTIMO PERIODO servono a dire l'unica cosa che il disegno da
   * solo non direbbe — che quella finestra lui non l'ha giocata: la sua quota viene allora dalla
   * stagione, perché una finestra vuota restituisce il prior intatto. Assenti su una board più vecchia
   * delle colonne, e allora è ignoto e la carta tace invece di inventare uno zero.
   */
  recent_available?: string | null;
  recent_played?: string | null;
  x?: number;
  claim: number | null;
  /**
   * I MINUTI CHE CI SI ASPETTA DA LUI IN UNA PARTITA CHE GIOCA, stagione che viene - `engine/minutes.py`.
   *
   * Previsione, non misura, e la calcola il TOOLKIT: quanto un uomo resta in campo è una previsione su una
   * persona, quindi si fa dove si fanno e si giudicano le previsioni. Assente su una board più vecchia
   * della colonna (i pacchetti del viaggio nel tempo, per esempio): allora è ignoto e la carta lo dice.
   */
  minutes_next?: number | null;
  /** Up to two, in the panel's own order. */
  duels?: BoardMan[];
  /** False when his granular real role is unknown: then the duels are UNKNOWN, not absent. */
  duels_known?: boolean;
  /**
   * IL PADRONE DEL SUO POSTO STA RIENTRANDO, quindi il gradino è tappato a `ballottaggio` (regola
   * dell'operatore, 10/09/2026). Presente solo sulla board dell'ULTIMO PERIODO: la regola confronta le
   * due board, e sulla lunga non c'è niente da confrontare. Viaggia perché un gradino che dice
   * `ballottaggio` accanto a una quota di 0,95 deve poter spiegarsi — «un vincolo che agisce in silenzio
   * è indistinguibile da un ordinamento rotto». `null`/assente = non lo sappiamo, che NON è «il posto è
   * suo»: senza una data di rientro non c'è un orizzonte da confrontare.
   */
  owner_returning?: boolean | null;
  /**
   * OGGI NON PUÒ GIOCARE, e per questo è elencato fra i ballottaggi di una board che gli indisponibili
   * li ESCLUDE dall'undici (regola dell'operatore, 11/09/2026).
   *
   * `true` solo su quei rivali, e mai altrove: sulla board di stagione un infortunato è disegnato per
   * definizione («la squadra che schiera quando sono tutti disponibili») e lì la board non dice niente
   * su oggi — assente = non lo afferma, come `owner_returning`.
   *
   * SI LEGGE E NON SI DEDUCE dalla tabella `injuries` del bundle: `ui-flags` risponde a un'altra domanda
   * e solo per gli stop lunghi (45+ giorni) o per una lettura della stampa di tre giorni, e sul foglio
   * del 10/09/2026 **34 di questi 67 uomini non porterebbero nessuna icona**. La board sa perché ce li
   * ha messi.
   */
  out_today?: boolean | null;
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
  /**
   * GLI ALTRI MODULI CHE IL CLUB POTREBBE DAVVERO DISEGNARE, con il loro undici (dal 18/08/2026).
   *
   * Uno per ogni forma sopra il 30% di probabilità (`boards.ALTERNATIVE_MIN_ODDS`), disegnato dal TOOLKIT
   * con le stesse funzioni del modulo scelto - un undici di un club vero è una previsione su una persona,
   * quindi l'app non ne calcola nessuno: legge questi. Assente su un bundle più vecchio, e allora il
   * campetto mostra solo il modulo disegnato, che è il comportamento di prima.
   */
  alternatives?: Record<string, {
    picture?: string | null;
    p?: number;
    lines?: Record<'P' | 'D' | 'M' | 'T' | 'A', BoardMan[]>;
  }>;
  /** Present when the panel could not draw this club at all: then there is nothing to show. */
  error?: string;
}

/**
 * LA BOARD DELL'ULTIMO PERIODO: lo stesso disegno, letto sulle ultime partite di campionato invece che
 * sulla stagione (`presence.recent_*`, misurate fuori campione il 10/09/2026 — Brier 0.1696 → 0.1544 e
 * 8.46 → 8.69 dei veri undici contro la lettura di stagione, su 3.638 partite-club).
 *
 * Nello STESSO file della lunga, e non in un secondo: le due descrivono lo stesso foglio, e due file
 * sarebbero una coppia che qualcuno un giorno riscrive per metà. La disegna il TOOLKIT come l'altra —
 * l'undici di un club vero è una previsione su una persona, quindi l'app non ne calcola nessuno e qui
 * SWITCHA fra due disegni già fatti.
 *
 * Assente su un bundle scritto prima del 10/09/2026: allora è IGNOTO e il pulsante non si disegna, che è
 * diverso da «l'ultimo periodo non dice niente».
 */
export interface ShortBoards {
  mode: string;
  /** Quante partite guarda la finestra, e con che prior: DICHIARATE da chi le ha usate, così
   *  l'etichetta a schermo («le ultime 3») non è una costante ricopiata in TypeScript. */
  window: number;
  prior: number;
  evidence: string;
  /** Entro quante partite del suo club un rientro conta come «a breve». */
  owner_matches: number;
  clubs: Record<string, Board>;
  titolarita?: Record<string, BoardRung>;
}

/**
 * I DUE ORIZZONTI su cui un undici tipo si legge, e sono due DOMANDE e non due freschezze:
 * `season` prevede la stagione che resta - il bersaglio con cui si compra a un'asta - e `short` la
 * prossima partita, sulle ultime giornate di campionato. Le due letture hanno due bersagli misurati
 * separatamente, quindi due nomi: chiamarle «vecchia» e «nuova» sarebbe dire che una è sbagliata.
 */
export type BoardHorizon = 'season' | 'short';

/** Il gradino di un uomo e i numeri da cui esce, come `boards._statuses` lo scrive. */
export interface BoardRung {
  status: string | null;
  play: number | null;
  minutes: number | null;
  in_eleven?: boolean;
  contended?: boolean | null;
  owner_returning?: boolean | null;
}

export interface BoardsFile {
  sheet: string;
  mode: string;
  /** True for the panel's own boards: they honour the operator's rulings, unlike the judges'. */
  apply_rulings: boolean;
  clubs: Record<string, Board>;
  titolarita?: Record<string, BoardRung>;
  /** L'ultimo periodo, quando il bundle lo porta. Vedi `ShortBoards`. */
  short?: ShortBoards;
}

/**
 * One declared note about a player: what the operator states, and when he stated it.
 *
 * The three kinds share ONE icon (his own grouping, 11/08/2026) because they are one question at the
 * table - «will this man play at all?» - and the word is what the tooltip says.
 */
export interface PlayerNote {
  kind: 'out_of_squad' | 'dispute' | 'wants_out';
  note?: string | null;
  decided_on?: string | null;
}

/**
 * `config/nightly.json`: l'interruttore DICHIARATO dell'aggiornamento notturno, con la sua data.
 *
 * `enabled` assente vuol dire ACCESO - la stessa direzione che prendono il runner e il pannello.
 */
export interface NightlyFile {
  enabled?: boolean;
  decided_on?: string | null;
}

/** `config/player_notes.json`: `{season: {fc_id: PlayerNote}}`, plus its own comment keys. */
export interface PlayerNotesFile {
  [season: string]: Record<string, PlayerNote> | unknown;
}

/** The shape of `mantra_modules.json`, as the toolkit ships it. */
export interface MantraModulesFile {
  edition?: string;
  /** The listone's roles in the rulebook's own order. See `MantraModules.roles` for who reads them. */
  roles?: string[];
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
  private playerNotesPromise?: Promise<PlayerNotesFile | null>;
  private nightlyPromise?: Promise<NightlyFile | null>;
  private readonly boardsByPath = new Map<string, Promise<BoardsFile | null>>();
  private readonly packsByPath = new Map<string, Promise<TimePackFile | null>>();
  private crestsPromise?: Promise<Record<string, string>>;
  private calendarPromise?: Promise<CalendarFile | null>;

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
  /**
   * Il manifest di un PACCHETTO del viaggio nel tempo: quali fogli e quali campetti porta quella data.
   *
   * Un file a parte e non dentro il manifest grande, per la stessa ragione per cui i fogli sono file a
   * parte: una data che nessuno apre non deve costare niente a chi apre la pagina.
   */
  timepack(path: string): Promise<TimePackFile | null> {
    let pending = this.packsByPath.get(path);
    if (!pending) {
      pending = fetch(`${this.base}/${path}`)
        .then((res) => (res.ok ? (res.json() as Promise<TimePackFile>) : null))
        .catch(() => null);
      this.packsByPath.set(path, pending);
    }
    return pending;
  }

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

  /**
   * The operator's DECLARED notes on single players, by season and `fc_id`.
   *
   * `config/player_notes.json`, the same standing as `board_rulings.json`: nothing in this project
   * observes a quarrel, a man kept out of the squad or a transfer request, so those are written down by
   * whoever knows them, dated, and revocable by deleting the entry. It is REPORTING only - it draws an
   * icon beside a name and enters no valuation, no ranking and no gate.
   *
   * Null on a bundle that carries no file, which is the normal case for a project with nothing declared:
   * the caller must read that as «nothing declared», never as «nothing to declare».
   */
  playerNotes(): Promise<PlayerNotesFile | null> {
    this.playerNotesPromise ??= fetch(`${this.base}/player_notes.json`)
      .then((res) => (res.ok ? (res.json() as Promise<PlayerNotesFile>) : null))
      .catch(() => null);
    return this.playerNotesPromise;
  }

  /**
   * LO STATO DEL CONTROLLO NOTTURNO (`config/nightly.json`), che questa pagina MOSTRA e non tocca.
   *
   * L'aggiornamento non presidiato gira sulla macchina dell'operatore (un'attivita' pianificata alle
   * 03:00) e obbedisce a questo file. L'app lo legge per una ragione sola: un pacchetto vecchio e un
   * aggiornamento spento sono due CAUSE diverse dello stesso schermo, e distinguerle e' tutto il
   * valore - «i dati sono di tre giorni fa» con l'interruttore spento e' una decisione, con
   * l'interruttore acceso e' un guasto.
   *
   * NON PUO' SCRIVERLO, e non e' una scelta: un browser non ha modo di raggiungere il Task Scheduler
   * di Windows, misurato il 10/09/2026 prima di decidere dove mettere l'interruttore (`app/src` non
   * aveva un solo riferimento a localhost). Quindi il fatto viaggia in UNA direzione e chi lo scrive
   * e' il pannello del toolkit, dove l'autorita' locale gia' vive.
   *
   * ASSENTE VUOL DIRE ACCESO, come lo leggono le altre due meta' (il runner e il pannello): una
   * macchina a cui nessuno ha detto niente tiene i dati freschi, e leggere un file mancante come
   * «spento» fermerebbe l'acquisizione in silenzio.
   */
  nightly(): Promise<NightlyFile | null> {
    this.nightlyPromise ??= fetch(`${this.base}/nightly.json`)
      .then((res) => (res.ok ? (res.json() as Promise<NightlyFile>) : null))
      .catch(() => null);
    return this.nightlyPromise;
  }

  /**
   * IL CALENDARIO ANCORA DA GIOCARE, per campionato, gia' prezzato (`fixtures.schedule`).
   *
   * Il toolkit lo scrive perche' dire se una partita e' facile e' una MISURA - servono i due livelli, il
   * campo e una soglia - mentre contare quante ne cadono in una finestra e' aritmetica sulle impostazioni
   * che l'operatore dichiara qui. Ed e' anche l'unica cosa che l'app non potrebbe dedurre da sola:
   * `fixtures` e `club_levels` sono chiavati su `matching.club_identity`, che e' una tabella di alias in
   * Python, quindi rifarne il join qui vorrebbe dire ripetere quello che una volta ha perso Milan, Roma e
   * Napoli dal calendario di tutti. Risolto una volta la', e l'app unisce sul nome canonico che gia'
   * legge su una riga del foglio.
   *
   * Null su un bundle costruito senza una corsa di `fixtures`: chi legge lo DEVE dire, invece di
   * disegnare accoppiamenti vuoti.
   */
  calendar(): Promise<CalendarFile | null> {
    this.calendarPromise ??= fetch(`${this.base}/calendar.json`)
      .then((res) => (res.ok ? (res.json() as Promise<CalendarFile>) : null))
      .catch(() => null);
    return this.calendarPromise;
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
