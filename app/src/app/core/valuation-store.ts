import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { valueOf } from './auction-value';
import { BoardsFile, Bundle, EngineSheetEntry, columnIndex, optionalIndex } from './bundle';
import { DRAW_ORDER, occupiedCode } from './club-eleven';
import { cupMark, windowFromNote } from './player-cup';
import { EngineForecast, PlayerRating, rank99ByRole } from './player-ratings';
import { PlayerRatingsStore } from './player-ratings-store';
import { PlayerMark, PlayerStatus } from './player-status';
import { Platform, PlayerRow, buildRosters } from './players-store';
import { TimeTravel } from './time-travel';

/**
 * What today's snapshot says a quoted man is WORTH: measured season, engine forecast, four readings.
 *
 * It exists as its own store because two views ask the same question - the SQUADRE table asks it of one
 * club, the CALCIATORI table of the whole listone - and two copies of the answer would eventually be two
 * different answers under the same column headers, which is the defect this project keeps paying for.
 * Everything here is READ from the bundle and nothing is re-derived:
 *
 *  - the PERIMETER is `listone_quotes` through `buildRosters`, the same function the consultation table
 *    uses, because a platform's list is decided by who is quoted on THAT listone and not by the roster's
 *    single unattributed row (`rosters` keeps the last read of either list);
 *  - MV and FM are `season_stats` of the input season on the sheet's own platform - a fantamedia is a
 *    fact about a CALENDAR, so the euro number and the Serie A number are two different measurements of
 *    the same season and must never be shown under one label;
 *  - P, FM att. and MV att. are the SHEET's own columns (`engine_pv_pred`, `engine_fm_pred`, `est_mv`)
 *    or its declared fallbacks, and the row says which of the two it is showing;
 *  - the PLACE comes from the toolkit's boards (`modules/boards.py`). The app reads them and never
 *    computes a real club's eleven.
 *
 * The granular real role comes from `player_roles`, which is a SNAPSHOT and says so: the provider serves
 * only "now" (it accepts a seasonId and ignores it), so each row carries the day it was observed.
 */

/** One man as the snapshot has him: his listone row, plus everything measured or expected of him. */
export interface SquadMan extends PlayerRow {
  /** The twelve granular codes, `GK`, `DC`, `MC`, `LW`... - the only thing that says WHERE he plays. */
  codes: string[];
  /** The day those codes were observed. They are a snapshot, so the date travels with them. */
  codesOn: string | null;
  /**
   * Last season's MEASURED media voto on this platform's calendar. Null = unknown, never zero.
   *
   * A man with NO appearance is null here even though the table stores 0.0 for him: 147 of the 1,635
   * rows of the input season read mv = fm = 0.0 and every one of them has `pv` = 0, so the zero is the
   * aggregation's and not the player's. Printing it would say «he averaged nothing», which is a claim
   * about football; the truth is that there is no average to have.
   */
  mv: number | null;
  /** ...and his fantamedia, on the same calendar, under the same rule. */
  fm: number | null;
  /** The appearances behind those two: a fantamedia over three matches is not the same claim. */
  pv: number | null;
  /**
   * PARTITE ATTESE: how many matches WITH A VOTE the engine expects of him, on this platform's own
   * calendar. It is the sheet's `engine_pv_pred` - the engine's number, read and never recomputed here -
   * or its declared fallback `est_pv` for a man the core refuses to price, and then `expectedIsEstimate`
   * says so instead of passing an estimate off as a prediction.
   */
  expected: number | null;
  expectedIsEstimate: boolean;
  /**
   * ...and the fantamedia the engine EXPECTS of him this season - `engine_fm_pred`, or its declared
   * fallback `est_fm` for a man the core refuses to price.
   *
   * It is a different quantity from `fm` beside it and the two are never mixed: `fm` is what he DID on
   * this listone's calendar last season, this is what the engine says he will do on the next one. For a
   * man who played elsewhere the first is empty by construction and only this one can answer.
   */
  expectedFm: number | null;
  expectedFmIsEstimate: boolean;
  /**
   * ...and the base vote behind it: `est_mv`, which the sheet DERIVES from the fantamedia by subtracting
   * the bonus per appearance it expects of him. So `expectedFm − expectedMv` is that bonus rate, and the
   * two numbers can never say different things about one player.
   */
  expectedMv: number | null;
  /** Which rung of the cascade produced the estimate, and the sentence the toolkit wrote for it. */
  estimateBasis: string | null;
  estimateNote: string | null;
  /**
   * The code he would occupy in his club's typical eleven, when the board draws him: `DR` for a man with
   * `DC · DR · DL` played at right back. Null for everybody the board does not field - the question
   * «where would he play» has no answer for a man who would not.
   */
  place: string | null;
  /**
   * Il FANTAVALORE DI MERCATO del suo listone, nella valuta del gioco che quel foglio dichiara.
   *
   * È un PREZZO e non un'opinione in unità arbitrarie: la scala è calibrata su un'asta di riferimento
   * (massimo 500, dieci squadre con mille crediti), e a differenza della Qt.I si muove a ogni evento
   * saliente - quindi è il giudizio più FRESCO che il listone dia. Resta un giudizio: questo progetto lo
   * mostra e non lo fa entrare in nessuna valutazione («la quotazione la usiamo quando non abbiamo
   * risorse oggettive»). Vuoto = quel listone non lo quota, che non è zero.
   */
  fvm: number | null;
  /**
   * Il SURPLUS del motore: fantapunti sopra il rimpiazzo del suo ruolo, su tutta la stagione.
   *
   * È il numero con cui il pannello d'asta del toolkit ordina la sua lista, e qui è letto dal foglio e
   * mai ricalcolato. Vuoto = il motore non lo valuta e non offre nemmeno una stima.
   */
  surplus: number | null;
  surplusIsEstimate: boolean;
  /**
   * LO STESSO SURPLUS CONTATO DALL'ALTRO ZERO: il rimpiazzo che ENTRA (`desc_surplus_fielded`).
   *
   * Non è una seconda risposta alla stessa domanda, sono due domande (metrica-asta-surplus-v1.md §21):
   * `surplus` conta dal marginale di ROSA - l'ottantesimo centrocampista di dieci squadre - e risponde a
   * «chi conviene comprare»; questo conta dal rango `squadre × posti che il regolamento SCHIERA`, cioè
   * dal migliore dei tuoi che ha il voto quel giorno, e risponde a «quanto costa una giornata saltata».
   * Mezzo punto di fantamedia più in alto, e sul foglio Serie A i primi venticinque cambiano metà: P5 D1
   * C0 A19 contro P3 D8 C11 A3.
   *
   * Si mostrano AFFIANCATE e si sceglie solo per quale ordinare (decisione dell'operatore, §21.1): chi
   * sta in alto in tutt'e due è forte davvero, e chi scende è un uomo il cui valore era in gran parte
   * merito dei riempitivi del suo ruolo. Letto dal foglio e mai ricalcolato, come il primo, e assente su
   * un bundle scritto prima della revisione 22 - allora la colonna non c'è invece di portare uno zero.
   */
  surplusFielded: number | null;
  /** Il rimpiazzo che entra, per la nota della cella: un numero che non dice il suo zero non è un fatto. */
  replacementFielded: number | null;
  /**
   * Lo stesso surplus in CREDITI, e quanto dista dal prezzo del listone: `dvm = spm − fvm`, positivo
   * per chi il mercato prezza SOTTO quello che il motore gli dà. Letti dal foglio (revisione 20+).
   */
  spm: number | null;
  dvm: number | null;
  /**
   * ...e il VALORE, che è l'altra metà dello stesso conto: fantamedia × presenze attese, senza sottrarre
   * niente (`surplus = valore − rimpiazzo × presenze`). In tabella la colonna si chiama **Fantapunti**
   * (operatore, 16/08/2026): «valore» stava accanto all'FVM, che è il fantaVALORE di mercato, e un
   * numero in fantapunti e un prezzo in crediti non possono portare lo stesso nome. Il campo resta
   * `value` perché gli identificatori del codice stanno in inglese e non seguono l'etichetta.
   *
   * Sono due domande diverse e vanno lette insieme: il surplus dice quanto ti dà IN PIÙ di chi
   * giocherebbe al suo posto - giusto a un'asta a crediti, dove la risorsa scarsa è quello che sottrae -
   * mentre il valore dice quanti fantapunti PORTA, ed è la valuta che il banco dei draft ha misurato
   * come migliore in quel formato (`metrica-asta-surplus-v1.md` §16). Calcolato con `valueOf`, che è la
   * sola definizione che questo progetto ha, la stessa che legge il pannello d'asta.
   */
  value: number | null;
  /**
   * LA COPPA CONTINENTALE in mezzo al campionato, per la riga: il torneo, le giornate a rischio su questo
   * calendario, e le presenze e i fantapunti al netto (`desc_cup`, `desc_cup_rounds`, `desc_pv_cup`,
   * `desc_value_cup`). Letti dal foglio, mai ricalcolati.
   *
   * Stanno ACCANTO a `expected` e `value` e non al loro posto, per la ragione che questo progetto ha già
   * scritto due volte: `engine_pv_pred` è la colonna che il gate possiede, e una correzione misurata
   * fuori dal gate le si affianca - come «Margine» sta accanto a «Surplus» - invece di riscriverla.
   */
  cup: string | null;
  cupRounds: number | null;
  pvCup: number | null;
  valueCup: number | null;
  /** The four readings, 0-99 inside this listone. Null before they are computed, and it says so. */
  rating: PlayerRating | null;
  /** Dove stanno le sue quattro fantamedie fra quelle del SUO RUOLO, 0-99: è quello che le colora. */
  tones: ValueTones;
}

/**
 * Il posto delle quattro colonne di fantamedia e media voto DENTRO IL RUOLO, 0-99 - o null dove non c'è
 * un numero da collocare.
 *
 * Serve a una cosa sola: colorare la cella, così scorrendo la tabella si vede subito chi è buono e chi no
 * senza leggere mille decimali (richiesta dell'operatore, 16/08/2026). Sono percentili e non giudizi
 * nuovi: nessuna valutazione li legge, nessun gate li possiede, e la scala di colore è quella che le
 * letture a stelline già usano (`player-ratings.toneOf`) invece di una seconda che finirebbe per dire
 * un'altra cosa dello stesso numero.
 *
 * DENTRO IL RUOLO, e non sul listone intero, per la ragione scritta in `rank99ByRole`: 6,20 di fantamedia
 * è un portiere ottimo e un attaccante mediocre, quindi un colore cross-ruolo direbbe soprattutto che
 * ruolo gioca.
 */
export interface ValueTones {
  fm: number | null;
  mv: number | null;
  expectedFm: number | null;
  expectedMv: number | null;
  /**
   * ...e il posto del **dVM**, che è quello che colora la cella dell'**FVM**: due grandezze diverse per
   * una cella sola, ed è voluto.
   *
   * Un prezzo alto non è una brutta notizia - un fuoriclasse costa - quindi colorare l'FVM per quanto è
   * grande direbbe soltanto «è caro», che si legge già dal numero. La notizia è il CONFRONTO: quanto il
   * listone lo prezza sopra o sotto quello che il motore dice che vale, e la sola conversione onesta fra
   * le due valute è `dVM = SpM − FVM`, tarata dal toolkit come un problema di budget (il surplus in
   * crediti, non i fantapunti: quello che un credito compra è il margine sopra la panchina).
   */
  dvm: number | null;
}

const NO_TONES: ValueTones = {
  fm: null, mv: null, expectedFm: null, expectedMv: null, dvm: null,
};

/** Quali colonne portano un colore. Una chiave sola per la cella, la nota e il rango. */
export type ToneKey = keyof ValueTones;

/** What the engine's sheet says it expects of a player, prediction and declared fallback alike. */
interface EngineExpectation {
  pv: number | null;
  pvIsEstimate: boolean;
  fm: number | null;
  fmIsEstimate: boolean;
  /** The sheet's `est_mv`, absent on a bundle written before revision 18. */
  mv: number | null;
  /**
   * The fantamedia of the man you would field INSTEAD - `engine_replacement_fm`, the marginal rostered
   * player of his role slot, computed by the toolkit with this league's own teams and slots.
   *
   * It is the zero every valuation in this project is measured from («metrica-asta-surplus-v1.md»), and
   * it is per ROLE because the zeros are nothing like each other: on the Serie A sheet a keeper's is
   * 4.13 and a midfielder's 5.87, so counting from zero flatters whoever simply plays a lot.
   */
  replacementFm: number | null;
  /**
   * Il SURPLUS del foglio - `engine_surplus`, o `est_surplus` per chi il motore non riesce a valutare.
   *
   * LETTO e mai ricalcolato, come `engine_pv_pred`: è la metrica con cui il pannello d'asta del toolkit
   * ordina, il gate la possiede, e una seconda aritmetica qui sarebbe una seconda risposta a una domanda
   * già risolta. Nella stima la penalità di confidenza è GIÀ dentro (moltiplica il surplus e mai la
   * fantamedia: l'indeterminazione è un fatto sul numero, non sul giocatore).
   */
  surplus: number | null;
  surplusIsEstimate: boolean;
  /**
   * L'ALTRO ZERO del foglio (revisione 22+): il surplus contato dal rimpiazzo che ENTRA, e il livello
   * su cui è contato. Letti, mai ricalcolati - stessa cascata e stesso slot del primo, cambia solo la
   * profondità (`snapshot.auction_level(..., slot=)`).
   */
  surplusFielded: number | null;
  replacementFielded: number | null;
  /**
   * IL SURPLUS IN CREDITI (`desc_spm`) e la sua distanza dal prezzo del listone (`desc_dvm` = SpM − FVM).
   *
   * Letti dal foglio, mai ricalcolati: il tasso è una taratura di BUDGET fatta per ruolo di listone sui
   * `squadre × slot` uomini che il mercato compra davvero, con due alternative già misurate e scartate
   * (un tasso unico riduce la colonna a un'affermazione sui ruoli, un pool per slot mantra spacca due
   * ali identiche). Rifarla qui sarebbe una seconda risposta a una domanda già decisa.
   *
   * Assenti su un bundle scritto prima della revisione 20 del foglio: allora la cella dell'FVM non ha
   * colore e il suo tooltip lo dice, invece di far credere che il confronto sia stato fatto.
   */
  spm: number | null;
  dvm: number | null;
  /** `est_confidence`: quanto della stima è suo. 1 per una riga misurata, che non ha nulla da scontare. */
  confidence: number;
  basis: string | null;
  note: string | null;
  /**
   * LA COPPA CONTINENTALE che cade dentro il campionato (revisione 23+): il torneo, il paese, se è già
   * nazionale, le giornate a rischio su QUESTO calendario e le presenze attese al netto.
   *
   * Tutto letto dal foglio e niente ricalcolato qui, nemmeno la sottrazione: quanto perde uno di quel
   * profilo è una misura (difference-in-differences su quattro finestre-torneo), e il tappo che impedisce
   * a un riservista di perdere più giornate di quante ne avrebbe giocate sta nella stessa funzione che
   * l'ha misurata. Vuoti per chiunque nessun torneo dichiarato tocchi, che nel 2026-27 è tutta l'Africa.
   */
  cup: string | null;
  cupCountry: string | null;
  cupCapped: boolean;
  cupRounds: number | null;
  pvCup: number | null;
  valueCup: number | null;
  cupNote: string | null;
}

type Status = 'idle' | 'loading' | 'ready' | 'error';

/** The order a listone is read in, and it is the game's own. */
const ROLE_ORDER: Record<string, number> = { P: 0, D: 1, C: 2, A: 3 };

/**
 * Where the drawn elevens put their men, over EVERY club of one boards file.
 *
 * One pass over the whole file rather than over the club on screen: the squads table asks for one club
 * and the listone table for all of them, and a man belongs to exactly one board, so the two questions
 * have the same answer and must not have two implementations. The duels are deliberately left out - a
 * ballottaggio is a man who MIGHT play there, not one who does - and a club the panel could not draw
 * carries an `error` and contributes nobody.
 */
export function placesFrom(file: BoardsFile | null): Map<number, string> {
  const out = new Map<number, string>();
  for (const board of Object.values(file?.clubs ?? {})) {
    if (board.error) continue;
    for (const line of DRAW_ORDER) {
      for (const man of board.lines?.[line] ?? []) {
        if (man.fc_id == null) continue;
        const codes = (man.codes ?? '').split(';').map((code) => code.trim()).filter(Boolean);
        const place = occupiedCode(line, man.badge, codes);
        if (place) out.set(man.fc_id, place);
      }
    }
  }
  return out;
}

@Injectable({ providedIn: 'root' })
export class ValuationStore {
  private readonly bundle = inject(Bundle);
  private readonly ratings = inject(PlayerRatingsStore);
  private readonly travel = inject(TimeTravel);
  private readonly marks = inject(PlayerStatus);

  /**
   * Il marchio per giocatore, da qualunque foglio lo dichiari.
   *
   * Un uomo può stare su entrambi i listoni con giornate a rischio diverse (4 in Serie A, 3,3 su euro), e
   * il marchio è UNO: porta quindi solo quello che non dipende dalla piattaforma - torneo, finestra,
   * paese, se è già nazionale - e le giornate restano nella colonna, che sa su quale calendario contarle.
   */
  private readonly cupMarks = computed<Map<number, PlayerMark>>(() => {
    const out = new Map<number, PlayerMark>();
    for (const [key, engine] of this.expected()) {
      if (!engine.cup || !engine.cupCountry) continue;
      const fcId = Number(key.split('|')[1]);
      if (out.has(fcId)) continue;                 // il primo foglio che lo dichiara basta
      const mark = cupMark({
        cup: engine.cup,
        window: windowFromNote(engine.cupNote),
        country: engine.cupCountry,
        capped: engine.cupCapped,
      });
      if (mark) out.set(fcId, mark);
    }
    return out;
  });

  readonly status = signal<Status>('idle');
  readonly error = signal<string | null>(null);

  /** When the bundle was written: these views are «lo snapshot odierno» and must say which day that is. */
  readonly generatedAt = signal<string | null>(null);
  readonly demo = signal(false);
  /** The season the squads are FOR, and the season MV/FM were measured in. Two different years. */
  readonly targetSeason = signal<string>('');
  readonly inputSeason = signal<string>('');

  readonly crests = signal<Record<string, string>>({});

  private readonly rostersByPlatform = signal<Map<Platform, PlayerRow[]>>(new Map());
  /** Who each listone quotes for the target season. The one perimeter, handed to whoever draws a list. */
  readonly rosters = this.rostersByPlatform.asReadonly();

  /** `fc_club_id` -> the championship the CLUB plays in, as the clubs table states it. */
  private readonly leagues = signal<Map<number, string | null>>(new Map());
  readonly clubLeagues = this.leagues.asReadonly();

  /** `platform|fc_id` -> il fantavalore, nelle due valute: mantra e classic non sono la stessa scala. */
  private readonly values = signal<Map<string, { classic: number | null; mantra: number | null }>>(
    new Map(),
  );

  /** `platform|fc_id` -> the measured season. Keyed by platform because the calendars differ. */
  private readonly measured = signal<Map<string, { pv: number | null; mv: number | null; fm: number | null }>>(
    new Map(),
  );
  private readonly roles = signal<Map<number, { codes: string[]; on: string | null }>>(new Map());
  /** `platform|fc_id` -> what the engine expects of him, and whether each half is the estimate. */
  private readonly expected = signal<Map<string, EngineExpectation>>(new Map());
  /** ...and the calendar THOSE numbers were predicted on, per platform: a share needs its own total. */
  private readonly expectedRounds = signal<Map<Platform, number | null>>(new Map());
  /** The boards per platform, and the sheet each one came from - so a card can name it. */
  private readonly boards = signal<Map<Platform, { file: BoardsFile; sheet: EngineSheetEntry }>>(
    new Map(),
  );

  /** One load for every caller: a second view must AWAIT the first one, not walk past it. */
  private pending: Promise<void> | null = null;

  /** The sheet a platform's boards and engine columns come from, or null when no sheet carries any. */
  sheetFor(platform: Platform): EngineSheetEntry | null {
    return this.boards().get(platform)?.sheet ?? null;
  }

  /** The drawn boards of a platform, or null: then there is nothing honest to draw. */
  boardsFor(platform: Platform): BoardsFile | null {
    return this.boards().get(platform)?.file ?? null;
  }

  /** What the two measured columns are about: one season, one calendar, said once for both tables. */
  measuredOn(platform: Platform): string {
    return `${this.inputSeason()} · calendario ${platform === 'euro' ? 'EuroLeghe' : 'Serie A'}`;
  }

  /**
   * Il posto di ogni fantamedia dentro il suo RUOLO, per piattaforma: `platform|fc_id` -> i quattro 0-99.
   *
   * Calcolato QUI e non nella tabella perché il pool giusto è il LISTONE - chi puoi comprare - mentre la
   * tabella riceve ora una rosa di ventisei uomini e ora il listone intero. Con il pool delle righe la
   * stessa cella cambierebbe colore passando da una vista all'altra, e «buono» vorrebbe dire «il migliore
   * di questi ventisei»: è il difetto che il pannello del toolkit ha già pagato una volta.
   *
   * I numeri sono gli STESSI che la riga mostra, presi con la stessa regola (niente media per chi non ha
   * presenze: quello 0.0 è dell'aggregazione, non suo). Rankare valori diversi da quelli scritti sarebbe
   * una lista i cui colori descrivono un'altra lista.
   */
  private readonly toneScores = computed<Map<string, ValueTones>>(() => {
    const measured = this.measured();
    const expected = this.expected();
    const out = new Map<string, ValueTones>();
    for (const [platform, pool] of this.rostersByPlatform()) {
      const columns: Record<ToneKey, Map<number, number | null>> = {
        fm: new Map(), mv: new Map(), expectedFm: new Map(), expectedMv: new Map(), dvm: new Map(),
      };
      for (const player of pool) {
        const key = `${platform}|${player.fcId}`;
        const season = measured.get(key);
        const engine = expected.get(key);
        const played = !!season?.pv;
        columns.fm.set(player.fcId, played ? (season?.fm ?? null) : null);
        columns.mv.set(player.fcId, played ? (season?.mv ?? null) : null);
        columns.expectedFm.set(player.fcId, engine?.fm ?? null);
        columns.expectedMv.set(player.fcId, engine?.mv ?? null);
        columns.dvm.set(player.fcId, engine?.dvm ?? null);
      }
      const ranked = {
        fm: rank99ByRole(pool, columns.fm),
        mv: rank99ByRole(pool, columns.mv),
        expectedFm: rank99ByRole(pool, columns.expectedFm),
        expectedMv: rank99ByRole(pool, columns.expectedMv),
        dvm: rank99ByRole(pool, columns.dvm),
      };
      for (const player of pool) {
        out.set(`${platform}|${player.fcId}`, {
          fm: ranked.fm.get(player.fcId) ?? null,
          mv: ranked.mv.get(player.fcId) ?? null,
          expectedFm: ranked.expectedFm.get(player.fcId) ?? null,
          expectedMv: ranked.expectedMv.get(player.fcId) ?? null,
          dvm: ranked.dvm.get(player.fcId) ?? null,
        });
      }
    }
    return out;
  });

  /** How many men of each role the colours were ranked against, so a tooltip can say the pool. */
  readonly rolePool = computed<Map<string, number>>(() => {
    const out = new Map<string, number>();
    for (const [platform, pool] of this.rostersByPlatform()) {
      for (const player of pool) {
        const key = `${platform}|${player.role}`;
        out.set(key, (out.get(key) ?? 0) + 1);
      }
    }
    return out;
  });

  /** Where each drawn eleven puts its men, for one platform. */
  private readonly places = computed<Map<Platform, Map<number, string>>>(() => {
    const out = new Map<Platform, Map<number, string>>();
    for (const [platform, entry] of this.boards()) out.set(platform, placesFrom(entry.file));
    return out;
  });

  /**
   * The valuation of a list of men, in the order a listone is read: P, D, C, A, and inside a role the
   * best measured fantamedia first.
   *
   * A man with no measured season sorts last - he has no number, which is not a zero, and putting him
   * among the worst would be a claim nobody measured. The POOL is the caller's: this answers about the
   * men it is given and never re-selects them, so the figures always describe the list on screen.
   */
  valuations(platform: Platform, players: readonly PlayerRow[]): SquadMan[] {
    const measured = this.measured();
    const values = this.values();
    // Il gioco che questo listone gioca, dal manifest: su un foglio mantra il fantavalore è quello
    // mantra, e mostrare l'altro sarebbe un prezzo di un gioco diverso sotto la stessa intestazione.
    const mantra = this.sheetFor(platform)?.game === 'mantra';
    const roles = this.roles();
    const places = this.places().get(platform);
    const expected = this.expected();
    const tones = this.toneScores();
    // Read once so the rows recompute when the ratings land, instead of staying empty.
    const rated = this.ratings.ready();
    return players
      .map((player) => {
        const season = measured.get(`${platform}|${player.fcId}`);
        const real = roles.get(player.fcId);
        const engine = expected.get(`${platform}|${player.fcId}`);
        // No appearance, no average: the stored 0.0 of a `pv` = 0 row is the aggregation's zero.
        const played = !!season?.pv;
        return {
          ...player,
          codes: real?.codes ?? [],
          codesOn: real?.on ?? null,
          mv: played ? (season?.mv ?? null) : null,
          fm: played ? (season?.fm ?? null) : null,
          pv: season?.pv ?? null,
          expected: engine?.pv ?? null,
          expectedIsEstimate: engine?.pvIsEstimate ?? false,
          expectedFm: engine?.fm ?? null,
          expectedFmIsEstimate: engine?.fmIsEstimate ?? false,
          expectedMv: engine?.mv ?? null,
          estimateBasis: engine?.basis ?? null,
          estimateNote: engine?.note ?? null,
          surplus: engine?.surplus ?? null,
          surplusIsEstimate: engine?.surplusIsEstimate ?? false,
          surplusFielded: engine?.surplusFielded ?? null,
          replacementFielded: engine?.replacementFielded ?? null,
          spm: engine?.spm ?? null,
          dvm: engine?.dvm ?? null,
          // La coppa continentale: le giornate a rischio su QUESTO calendario e le presenze al netto.
          cup: engine?.cup ?? null,
          cupRounds: engine?.cupRounds ?? null,
          pvCup: engine?.pvCup ?? null,
          valueCup: engine?.valueCup ?? null,
          // La confidenza moltiplica anche qui, per la stessa ragione per cui moltiplica il surplus:
          // una colonna sola deve poter ordinare tutta la lista, misurati e stimati insieme.
          value: valueOf({
            basis: engine?.fmIsEstimate ? 'estimated' : 'measured',
            fm: engine?.fm ?? null,
            pv: engine?.pv ?? null,
            slot: null,
            confidence: engine?.confidence ?? 1,
            note: null,
          }),
          fvm: (mantra
            ? values.get(`${platform}|${player.fcId}`)?.mantra
            : values.get(`${platform}|${player.fcId}`)?.classic) ?? null,
          place: places?.get(player.fcId) ?? null,
          rating: rated ? this.ratings.for(platform, player.fcId) : null,
          // Un uomo che il listone di questa piattaforma non quota non ha un posto nel suo ruolo: la
          // cella resta senza colore invece di prenderne uno da un pool a cui non appartiene.
          tones: tones.get(`${platform}|${player.fcId}`) ?? NO_TONES,
        };
      })
      .sort(
        (left, right) =>
          (ROLE_ORDER[left.role] ?? 9) - (ROLE_ORDER[right.role] ?? 9) ||
          (right.fm ?? -1) - (left.fm ?? -1) ||
          left.name.localeCompare(right.name),
      );
  }

  load(): Promise<void> {
    this.pending ??= this.read();
    return this.pending;
  }

  constructor() {
    // IL VIAGGIO NEL TEMPO con un pacchetto cambia il MOTORE, non solo il taglio delle date: fogli,
    // campetti e persino la STAGIONE bersaglio (nel novembre 2025 il listone 2026-27 non esisteva).
    // Quindi tutto quello che lo store deriva va rifatto - le tabelle grezze sono già in cache, quindi
    // costa qualche centinaio di millisecondi e il box mostra il loader.
    effect(() => {
      const wanted = this.travel.pack()?.date ?? null;
      if (this.status() !== 'idle' && wanted !== this.loadedPack) {
        this.pending = this.read();
      }
    });
    // I MARCHI DELLA COPPA, registrati appena i fogli sono in casa.
    //
    // Da QUI e non dal pannello d'asta, perché questo è il negozio che ogni lista legge - la tabella di
    // consultazione compresa - e il marchio deve comparire dove compare il nome. Una definizione sola, e
    // sta nel FOGLIO: se l'app se lo ricalcolasse da nazionalità e finestre, prima o poi segnerebbe un
    // uomo che il foglio non segna (una nazionale non qualificata, un'eccezione dichiarata, un calendario
    // che non copre quella lega) - il difetto «una lista mostrata i cui numeri descrivono un'altra lista».
    effect(() => this.marks.cups.set(this.cupMarks()));
  }

  /** Il pacchetto su cui è costruita la risposta attuale (null = il bundle di oggi). */
  private loadedPack: string | null = null;

  private async read(): Promise<void> {
    this.status.set('loading');
    this.error.set(null);
    this.travel.busy.set(true);
    try {
      const manifest = await this.bundle.manifest();
      // Le date disponibili le pubblica chi legge il manifest: il servizio del viaggio nel tempo non
      // conosce il bundle, e il box non deve conoscere nessuno dei due.
      this.travel.packs.set(manifest.timepacks ?? []);
      const chosen = this.travel.pack();
      this.loadedPack = chosen?.date ?? null;
      const pack = chosen ? await this.bundle.timepack(chosen.path) : null;
      this.generatedAt.set(manifest.generated_at);
      this.demo.set(manifest.demo === true);
      // LE STAGIONI SONO QUELLE DEL PACCHETTO quando se ne sta usando uno, e non è un dettaglio: nel
      // settembre 2025 il listone 2026-27 non esisteva, quindi un viaggio a quella data mostra un'altra
      // lista di uomini e altri prezzi. Il pacchetto le dichiara entrambe; senza, sono quelle di oggi.
      const target = pack?.target_season ?? manifest.target_season;
      const input = pack?.input_season ?? manifest.input_season;
      this.targetSeason.set(target);
      this.inputSeason.set(input);

      const [players, clubs, rosters, quotes, seasons, crests] = await Promise.all([
        this.bundle.table('players'),
        this.bundle.table('clubs'),
        this.bundle.table('rosters'),
        this.bundle.table('listone_quotes'),
        this.bundle.table('season_stats'),
        // Optional by design: a bundle exported before the badges existed simply has none, and every
        // club falls back to its monogram.
        this.bundle.crests().catch(() => null),
      ]);

      this.rostersByPlatform.set(buildRosters(players, clubs, rosters, quotes, target));
      this.crests.set(crests ?? {});

      const [cId, cLeague] = columnIndex(clubs, 'fc_club_id', 'league');
      const leagues = new Map<number, string | null>();
      for (const row of clubs.rows) leagues.set(Number(row[cId]), (row[cLeague] as string) ?? null);
      this.leagues.set(leagues);

      const [vId, vSeason, vPlatform, vFvm, vFvmMantra] = columnIndex(
        quotes, 'fc_id', 'season', 'platform', 'fvm', 'fvm_mantra',
      );
      const worth = new Map<string, { classic: number | null; mantra: number | null }>();
      for (const row of quotes.rows) {
        if (row[vSeason] !== target) continue;
        worth.set(`${row[vPlatform]}|${row[vId]}`, {
          classic: (row[vFvm] as number | null) ?? null,
          mantra: (row[vFvmMantra] as number | null) ?? null,
        });
      }
      this.values.set(worth);

      const [sId, sSeason, sPlatform, sPv, sMv, sFm] = columnIndex(
        seasons,
        'fc_id',
        'season',
        'platform',
        'pv',
        'mv',
        'fm',
      );
      const stats = new Map<string, { pv: number | null; mv: number | null; fm: number | null }>();
      for (const row of seasons.rows) {
        if (row[sSeason] !== input) continue;
        stats.set(`${row[sPlatform]}|${row[sId]}`, {
          pv: (row[sPv] as number) ?? null,
          mv: (row[sMv] as number) ?? null,
          fm: (row[sFm] as number) ?? null,
        });
      }
      this.measured.set(stats);

      this.roles.set(await this.realRoles());
      // I fogli del PACCHETTO se c'è, quelli di oggi altrimenti - stesso formato, perché li scrive la
      // stessa funzione dell'export. I percorsi diventano relativi al bundle qui e in un posto solo.
      const sheets: EngineSheetEntry[] = pack
        ? pack.leagues.map((one) => ({
          league: one.league, platform: one.platform, game: one.game,
          teams: one.teams, squad_slots: one.squad_slots,
          matchdays_target: one.matchdays_target,
          sheet_revision: null, generated_at: null,
          auction_date: pack.date, rows: one.rows ?? 0, priced: 0, estimated: 0,
          path: `timepacks/${pack.date}/${one.sheet}`,
          boards: one.boards ? `timepacks/${pack.date}/${one.boards}` : null,
        }))
        : (manifest.engine_sheets ?? []);
      const boards = await this.boardsByPlatform(sheets);
      this.boards.set(boards);
      this.expected.set(await this.expectedByPlatform(boards, sheets));

      this.status.set('ready');
      // The four readings need the heavy per-match layer, so they land AFTER the page is drawable: the
      // list is on screen with a dash in the star columns, and the stars fill in when the ranking of
      // the whole listone exists. A percentile cannot be shown player by player as it arrives.
      //
      // The engine's expected SHARE of the calendar travels with them: the presences star is about what
      // he will play, and the calendar it is a share of is the sheet's own (31 euro rounds, 38 default).
      void this.ratings.ensure(this.rosters(), this.expectedShares());
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
      this.status.set('error');
      // A failure must not be cached as an answer: the next view that asks gets a real attempt.
      this.pending = null;
    } finally {
      // Il loader si spegne comunque: un box che gira per sempre dopo un errore direbbe «sto
      // lavorando» a proposito di niente. Le letture accendono il loro subito dopo.
      this.travel.busy.set(false);
    }
  }

  /**
   * The granular real role per player: the LAST observation, with the day it was made.
   *
   * The provider serves only "now" - it accepts a seasonId and ignores it - so these rows are a dated
   * snapshot and the newest one is the only one that describes today's squad. A player the snapshot
   * never reached has no codes at all, and the view says «ignoto» rather than drawing a role.
   */
  private async realRoles(): Promise<Map<number, { codes: string[]; on: string | null }>> {
    try {
      const table = await this.bundle.table('player_roles');
      const [id, from, roles] = columnIndex(table, 'fc_id', 'valid_from', 'roles');
      const out = new Map<number, { codes: string[]; on: string | null }>();
      for (const row of table.rows) {
        const fcId = Number(row[id]);
        const on = (row[from] as string) ?? null;
        const seen = out.get(fcId);
        if (seen && (seen.on ?? '') > (on ?? '')) continue;
        out.set(fcId, {
          codes: String(row[roles] ?? '')
            .split(';')
            .map((code) => code.trim())
            .filter(Boolean),
          on,
        });
      }
      return out;
    } catch {
      // A bundle pulled before the table travelled: the column is empty and says so, and nothing else
      // depends on it.
      return new Map();
    }
  }

  /**
   * The engine's expected matches turned into a SHARE of the calendar they were predicted on.
   *
   * The calendar is the one of the sheet the numbers were READ from - `expectedRounds`, filled beside
   * them - and not the first sheet of that platform: two leagues of one platform can declare different
   * `matchdays_target`, and dividing one sheet's `pv` by another's rounds is a share of nothing.
   */
  private expectedShares(): Map<string, EngineForecast> {
    const rounds = this.expectedRounds();
    const out = new Map<string, EngineForecast>();
    for (const [key, one] of this.expected()) {
      const platform = key.split('|')[0] as Platform;
      const total = rounds.get(platform);
      out.set(key, {
        share: one.pv == null || !total ? null : Math.min(1, one.pv / total),
        estimated: one.pvIsEstimate,
        // The zero his worth is measured from travels with it: one number, read from one sheet.
        replacement: one.replacementFm,
        // ...e la FANTAMEDIA ATTESA, che è quello su cui l'Overall si basa: il numero del motore per la
        // stagione che viene, non la media di quello che ha fatto altrove.
        fm: one.fm,
        fmIsEstimate: one.fmIsEstimate,
      });
    }
    return out;
  }

  /**
   * The boards to draw per platform, and which sheet they came from.
   *
   * A platform can declare more than one league (Serie A has a classic sheet and a mantra one) and the
   * BOARD is the same question in both - it is a prediction about a real coach, not about the game we
   * play - so the first sheet of the platform that actually carries boards is used, and its league is
   * named in the card so the reader knows which file he is looking at.
   */
  private async boardsByPlatform(
    sheets: EngineSheetEntry[],
  ): Promise<Map<Platform, { file: BoardsFile; sheet: EngineSheetEntry }>> {
    const out = new Map<Platform, { file: BoardsFile; sheet: EngineSheetEntry }>();
    for (const sheet of sheets) {
      if (out.has(sheet.platform) || !sheet.boards) continue;
      const file = await this.bundle.boards(sheet.boards);
      if (file) out.set(sheet.platform, { file, sheet });
    }
    return out;
  }

  /**
   * The engine's EXPECTED MATCHES WITH A VOTE per player, from the sheet of each platform.
   *
   * It is `engine_pv_pred` - read, never recomputed: this app has no engine, and a second way of
   * predicting appearances would be a second answer to a question the toolkit already answers. Where the
   * core refuses to price a man, his declared fallback `est_pv` answers and the row says it is an
   * estimate. The sheet is the SAME one the boards come from, so a card names one file for both.
   *
   * The number lives on the platform's own calendar (31 euro rounds, 38 default), which the manifest
   * states per sheet - the tooltip says which, or «22 partite» would be a number without a total.
   */
  private async expectedByPlatform(
    chosen: ReadonlyMap<Platform, { sheet: EngineSheetEntry }>,
    sheets: EngineSheetEntry[],
  ): Promise<Map<string, EngineExpectation>> {
    const out = new Map<string, EngineExpectation>();
    const rounds = new Map<Platform, number | null>();
    for (const platform of ['default', 'euro'] as Platform[]) {
      const sheet = chosen.get(platform)?.sheet ?? sheets.find((one) => one.platform === platform);
      if (!sheet) continue;
      // The calendar of THIS sheet, recorded with its numbers: what the pv values are a share of.
      rounds.set(platform, sheet.matchdays_target ?? null);
      try {
        const table = await this.bundle.table(sheet.path.replace(/\.json(\.gz)?$/, ''));
        const [id] = columnIndex(table, 'fc_id');
        const at = (name: string) => optionalIndex(table, name);
        const columns = {
          pv: at('engine_pv_pred'), estPv: at('est_pv'),
          fm: at('engine_fm_pred'), estFm: at('est_fm'),
          mv: at('est_mv'), replacement: at('engine_replacement_fm'),
          surplus: at('engine_surplus'), estSurplus: at('est_surplus'),
          // L'ALTRO ZERO: una colonna sola, perché il foglio la scrive già per tutta la lista - motore
          // dove c'è, stima altrove, con la stessa penale. Assente prima della revisione 22.
          surplusFielded: at('desc_surplus_fielded'),
          replacementFielded: at('desc_replacement_fielded'),
          spm: at('desc_spm'), dvm: at('desc_dvm'),
          confidence: at('est_confidence'),
          basis: at('est_basis'), note: at('est_note'),
          // La coppa continentale in mezzo al campionato, revisione 23+: assenti prima, e allora la
          // colonna è muta invece di dire «nessuno parte».
          cup: at('desc_cup'), cupCountry: at('desc_cup_country'),
          cupCapped: at('desc_cup_capped'), cupRounds: at('desc_cup_rounds'),
          pvCup: at('desc_pv_cup'), valueCup: at('desc_value_cup'),
          cupNote: at('desc_cup_note'),
        };
        const read = (row: unknown[], engineAt: number, estimateAt: number) => {
          const engine = engineAt < 0 ? null : (row[engineAt] as number | null);
          const estimate = estimateAt < 0 ? null : (row[estimateAt] as number | null);
          return { value: engine ?? estimate, isEstimate: engine == null && estimate != null };
        };
        for (const row of table.rows) {
          const pv = read(row, columns.pv, columns.estPv);
          const fm = read(row, columns.fm, columns.estFm);
          const surplus = read(row, columns.surplus, columns.estSurplus);
          if (pv.value == null && fm.value == null) continue;
          out.set(`${platform}|${Number(row[id])}`, {
            pv: pv.value,
            pvIsEstimate: pv.isEstimate,
            fm: fm.value,
            fmIsEstimate: fm.isEstimate,
            surplus: surplus.value,
            surplusIsEstimate: surplus.isEstimate,
            surplusFielded: columns.surplusFielded < 0
              ? null : ((row[columns.surplusFielded] as number | null) ?? null),
            replacementFielded: columns.replacementFielded < 0
              ? null : ((row[columns.replacementFielded] as number | null) ?? null),
            spm: columns.spm < 0 ? null : ((row[columns.spm] as number | null) ?? null),
            dvm: columns.dvm < 0 ? null : ((row[columns.dvm] as number | null) ?? null),
            confidence:
              columns.confidence < 0 ? 1 : ((row[columns.confidence] as number | null) ?? 1),
            mv: columns.mv < 0 ? null : ((row[columns.mv] as number | null) ?? null),
            replacementFm:
              columns.replacement < 0 ? null : ((row[columns.replacement] as number | null) ?? null),
            basis: columns.basis < 0 ? null : ((row[columns.basis] as string) ?? null),
            note: columns.note < 0 ? null : ((row[columns.note] as string) ?? null),
            cup: columns.cup < 0 ? null : ((row[columns.cup] as string) ?? null),
            cupCountry:
              columns.cupCountry < 0 ? null : ((row[columns.cupCountry] as string) ?? null),
            // «yes»/«no» e non un booleano: il foglio scrive parole, e questo progetto ha già pagato una
            // volta un `Boolean(...)` su una colonna che sembrava un flag e portava una parola.
            cupCapped: columns.cupCapped >= 0 && row[columns.cupCapped] === 'yes',
            cupRounds:
              columns.cupRounds < 0 ? null : ((row[columns.cupRounds] as number | null) ?? null),
            pvCup: columns.pvCup < 0 ? null : ((row[columns.pvCup] as number | null) ?? null),
            valueCup:
              columns.valueCup < 0 ? null : ((row[columns.valueCup] as number | null) ?? null),
            cupNote: columns.cupNote < 0 ? null : ((row[columns.cupNote] as string) ?? null),
          });
        }
      } catch {
        // A sheet the bundle does not carry: the column stays empty and says «ignoto», which is the
        // truth - the engine has not been run for this platform.
        rounds.delete(platform);
      }
    }
    this.expectedRounds.set(rounds);
    return out;
  }
}
