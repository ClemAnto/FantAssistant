import { Injectable, WritableSignal, computed, effect, inject, signal } from '@angular/core';

import { AuctionFeed, AuctionPlayer, Platform, Porta, Zone } from './auction-feed';
import { GlobalOptions } from './global-options';
import { FAVOURITE_AT_RISK, goneOdds, type SeenMan } from './rival-odds';
import {
  EngineNumbers,
  MantraModules,
  Valuation,
  demandBySlot,
  demandFromShapes,
  slotShares,
  lambdaOf,
  liveReplacements,
  netOf,
  per,
  portaValuation,
  score99,
  surplusOf,
  valuationOf,
  valueOf,
} from './auction-value';
import {
  Plan,
  PickCap,
  PlanPlayer,
  PlanRoot,
  PlanTeam,
  OurChooser,
  RivalHead,
  ahead,
  capBlocks,
  capContradiction,
  classifyRivals,
  RoundPick,
  coverNeedOf,
  goneBeforeOurNextTurn,
  pickScore,
  plan,
  planRoots,
  DEFAULT_HEAD,
  predictRivalPick,
  projectOurPicks,
  simulateRound,
  startingPlaces,
  take,
  takenBeforeOurTurn,
  nextCaller,
  isKeeperSlot,
  rivalPicksHorizon,
  roleFull,
  type Line,
} from './auction-plan';
import { TURN_PICKS, TurnMan, TurnScore, turnScores } from './draft-turn';
import { Board, BoardsFile, Bundle, EngineSheetEntry } from './bundle';
import { porteZero } from './porte';
import {
  CallRules,
  PriorityMan,
  PriorityRules,
  PriorityParts,
  PriorityState,
  WorthContext,
  baseRole,
  legalFor,
  manValue,
  priorityParts,
  priorities as draftPriorityScores,
  CLASSIC_STARTERS_PER_TEAM,
  preferredRules,
  priorityPick,
  roleStats,
} from './draft-priority';
import { COVER_OK, DraftPitch, DraftPlace, doorHolePrice, RECOMMENDED_MANTRA, addedYield, draftPitchOf, pitchYield, placeYield, recommendedModules, withSuggestions } from './draft-pitch';
import type { FantaMan } from './fanta-eleven';
import { RUNG_RANK, Rarity, RarityMan, rarity, shownRung } from './draft-rarity';
import { PlayerRulings, RUNG_VOTE_SHARE, ruledShare } from './player-rulings';
import { TITOLARITA_LADDER } from './titolarita';
import { ADVICE_GONE_ODDS, PlaceNeed, Scenario, ScenarioInput, SquadPitch, judge, keeperAllowed, scenarios as draftScenarios } from './draft-scenarios';
import type { Place } from './mantra-legal';
import { PlayerRatingsStore } from './player-ratings-store';
import { engineNumbersFrom } from './engine-sheet';
import { seasonRoundsOf } from './season-scale';
import {
  PlaceChange,
  RotationWatch,
  placeMark,
  rotationMark,
} from './player-place';
import { CalendarFile, calendarBookFrom, cleanSheetOutlook } from './keeper-pairs';
import { ROLE_STEADY, STEADY_SHARE, draftFertility, swingBase } from './swing';
import type { Role } from './plancia';
import { StartRecord, SUB_APPEARANCE_WEIGHT, subBonusShift, subShareNow } from './sub-bonus';
import { MACRO_ROLE, ScreenInput, screenMark, screensFor, windowOf } from './player-screens';
import { PlayerMark, PlayerStatus } from './player-status';
import { presenceNowOut, presenceNowShares } from './presence-now';
import { outWindow } from './injury-window';
import { PlayerTrend, isKnownAbsence, parseTrend, trendScores } from './player-trend';

/** The categories that count as a department's top (operator, 06/10/2026: «top/semitop»). */
const TOP_CATEGORIES: ReadonlySet<string> = new Set(['super', 'top', 'semi']);

/**
 * THE KEEPERS' WEEK BY WEEK READING - the calendar and the pairing bonus (`keeperWeeksBy`) - is OFF (operator,
 * 01/10/2026: «per il momento togliamo i bonus per gli accoppiamenti e il calendario»). One switch, so it comes back
 * in one line; with it off a keeper reads one season number against the average starter (`keeperZero`).
 */
const KEEPER_WEEKS = false;

/** Every rung's share of the votes, for a declared rung the draft prices (`draftShareBy`). */
const RULED_SHARES = new Map(TITOLARITA_LADDER.map((rung) => [rung, { play: RUNG_VOTE_SHARE[rung], minutes: null }]));

/** Where the priced window lives between sessions: it is a setting, not a derived value. */
const HORIZON_KEY = 'fantassistant.auction.horizon';
const EXCLUDED_KEY = 'fantassistant.auction.excluded';
const FAVOURITES_KEY = 'fantassistant.auction.favourites';

/** A set of men by session code, as saved under `key`; empty when nothing is saved or it cannot be read. */
function readExcluded(key = EXCLUDED_KEY): Record<string, number[]> {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
    const out: Record<string, number[]> = {};
    for (const [code, ids] of Object.entries(saved ?? {})) {
      if (Array.isArray(ids)) out[code] = ids.filter((id): id is number => typeof id === 'number');
    }
    return out;
  } catch {
    return {};
  }
}
/**
 * The engine's numbers, joined to the table that is actually being played.
 *
 * The join costs nothing and is exact: fanta-asta-live's player ids ARE `fc_id`, this project's
 * primary key (verified against `players` on 09/08/2026, 5 of 5). So the bundle's sheet and the live
 * listone meet on the id and never on a name - the defect this repository has paid for four times.
 *
 * What this service refuses to do is rank by the price. The FVM is the PRICE in a draft, and the
 * ranking is by SURPLUS over the live replacement, then by what is left of it after paying the going
 * rate (`netto`). The operator's rule: «utilizziamo la quotazione quando non abbiamo altre risorse
 * oggettive» - here we have them.
 */

export interface RankedPlayer {
  player: AuctionPlayer;
  zone: Zone;
  valuation: Valuation;
  /** The zero this row was measured against, so the number can explain itself. */
  replacementFm: number | null;
  surplus: number | null;
  /** Fantapunti per round: the same number in any competition, so two auctions can be compared. */
  surplusPerRound: number | null;
  /**
   * The same thing in the unit the table thinks in: points gained every TEN rounds of this
   * competition. His own absences are already inside it - `pv` is expected appearances, not rounds -
   * so a man who plays 20 rounds of 31 is diluted by exactly that, which is the honest answer to
   * «quanto mi fa guadagnare»: `Var(ln pv)` is 90% of the variance of fantapunti.
   */
  surplusPer10: number | null;
  netPer10: number | null;
  /** What is left after paying `lambda` per credit. Null when no rate can be computed. */
  net: number | null;
  /** Surplus per credit - the readable «qualità/prezzo», degenerate at the bottom of the listone. */
  ratio: number | null;
  /**
   * The GROSS worth on the 0-99 scale: 99 = the best man of this session's listone, taken or not, so
   * the number keeps its meaning as the pool empties. Unlike the surplus it subtracts nothing - it is
   * fantamedia x expected appearances, the currency the five-window draft measurement preferred.
   */
  value99: number | null;
  /** The same worth in fantapunti, which is what the ranking and the plan are computed on. */
  value: number | null;
  /**
   * IL LEAD: i punti in più che porta rispetto al suo rimpiazzo (definizione dell'operatore, 18/08/2026,
   * ed è la colonna che si chiamava «Valore»).
   *
   * `(FMa − rimpiazzo) × presenze attese × confidenza`, cioè l'Overall della tabella Giocatori meno il
   * valore del suo rimpiazzo. Lo zero è quello del FOGLIO - il marginale di ROSA, `engine_replacement_fm`,
   * il rango «squadre × slot» di una lega da dieci - e NON quello vivo fra i liberi, che è la colonna
   * «+/10g» accanto: due domande, «quanto vale in una lega da dieci» contro «quanto vale adesso, a questo
   * tavolo che si sta svuotando», e nessuna delle due sostituisce l'altra.
   *
   * In FANTAPUNTI e non su 0-99, che è il cambio più visibile: un lead può essere NEGATIVO (peggio del
   * rimpiazzo) e una scala 0-99 lo schiaccerebbe a zero, cancellando proprio la notizia. La confidenza
   * della stima moltiplica, per sua decisione dello stesso giorno: chi decide un rilancio sconta quello
   * che non sa.
   */
  lead: number | null;
  /** Lo zero da cui il lead è contato, così la riga sa spiegare la propria colonna. */
  leadZero: number | null;
  /** How much he would raise MY eleven: the personal zero of §4.1, secondary by decision. */
  surplusForMe: number | null;
  price: number;
  /** Last season's MEASURED fantamedia on this sheet's platform - what he did, not what we predict. */
  fmPrev: number | null;
  /** Minutes per match played, on his own championship's calendar. */
  minutesPerMatch: number | null;
  /** False when the zero is the sheet's league-wide one because no live demand exists for the slot. */
  zeroIsLive: boolean;
  /** His club's last ten CHAMPIONSHIP matches, as the sheet measured them. Null on an older bundle. */
  trend: PlayerTrend | null;
  /** The same window as a 0-99 inside his role. A description of what he has done, never a forecast. */
  trend99: number | null;
  /**
   * The GOAL this row stands for, with the porte rule on - and then the row is a CLUB and not a man: its
   * name is the club's, its valuation the mix of the club's keepers, its zero the marginal porta. Null for
   * every man, and for every keeper while the rule is off.
   */
  porta: Porta | null;
}

/** A starter and a reserve for each of the eleven places: how far the pitch's suggestion looks ahead. */
export const SUGGESTED_SQUAD = 22;

@Injectable({ providedIn: 'root' })
export class AuctionAdvice {
  private readonly feed = inject(AuctionFeed);
  private readonly bundle = inject(Bundle);
  private readonly status = inject(PlayerStatus);
  /** Le squadre reali escluse dalle opzioni globali: qui tolgono uomini dal pool LIBERO, e nient'altro. */
  private readonly options = inject(GlobalOptions);
  /** La costanza (quota di voti base da 6 in su): e' quello che l'R-Factor della Draft Priority conta. */
  private readonly ratings = inject(PlayerRatingsStore);
  /** The press's titolarità word: the rung reading of RAR, as the list shows it. */
  private readonly rulings = inject(PlayerRulings);

  /** The league sheet in use, and the numbers it carries per `fc_id`. */
  readonly entry = signal<EngineSheetEntry | null>(null);
  readonly numbers = signal<Map<number, EngineNumbers>>(new Map());
  readonly problem = signal<string | null>(null);

  /**
   * The competition being priced: the first and last matchday. Defaults to the whole platform
   * calendar; a draft played after the third round is a different horizon and every ABSOLUTE number
   * has to be on it (§19.5), which is why this is a setting and not an assumption.
   *
   * It is the operator's to set, so it survives a refresh - and it is only a UNIT: the factor n/N is
   * the same for everybody, so moving it changes every cifra and cannot reorder a single row.
   */
  readonly from = signal(1);
  readonly to = signal<number | null>(null);

  /** Sets the window, clamped to a calendar that exists, and remembers it. */
  setHorizon(from: number | null, to: number | null): void {
    const total = this.matchdaysTarget();
    const first = Math.max(1, Math.min(Math.round(from ?? 1), total ?? Infinity));
    const last = to == null ? null : Math.max(first, Math.min(Math.round(to), total ?? Infinity));
    this.from.set(first);
    this.to.set(last);
    try {
      localStorage.setItem(HORIZON_KEY, JSON.stringify({ from: first, to: last }));
    } catch {
      // A browser that refuses storage still prices the auction; it just forgets the window.
    }
  }

  private restoreHorizon(): void {
    try {
      const saved = JSON.parse(localStorage.getItem(HORIZON_KEY) ?? 'null');
      if (saved?.from) this.from.set(Math.max(1, Math.round(saved.from)));
      if (saved?.to) this.to.set(Math.max(1, Math.round(saved.to)));
    } catch {
      // Nothing saved, or unreadable: the whole calendar is the honest default.
    }
  }

  private loading: string | null = null;

  /** How many of the session's own listone the chosen sheet can price. Reported, never assumed. */
  readonly coverage = signal<{ matched: number; total: number } | null>(null);

  /** The game's shapes, and last season's measured fantamedia per player on the sheet's platform. */
  private readonly shapes = signal<MantraModules | null>(null);
  private readonly measured = signal<Map<number, number>>(new Map());
  /** The club's last ten CHAMPIONSHIP matches per player, as the chosen sheet measured them. */
  private readonly trends = signal<Map<number, PlayerTrend>>(new Map());
  /** ...and who gained or lost a place during the measured season, from the same sheet. */
  private readonly places = signal<Map<number, PlaceChange>>(new Map());
  /** ...and who is being ROTATED in the season being played. Empty on a pre-season sheet. */
  private readonly rotations = signal<Map<number, RotationWatch>>(new Map());
  // ...e il suo specchio - dato per riserva, gioca da titolare - NON si legge piu' qui: lo legge
  // `ValuationStore`, che ogni lista carica, cosi' il marchio compare anche in plancia e in Strategia
  // invece che nel solo pannello d'asta (05/09/2026). Due lettori di `desc_riser_*` darebbero a un
  // uomo due frasi, quindi quello che restava qui e' stato tolto e non affiancato.

  /**
   * The DRAWN BOARDS of the sheet in use: the toolkit's own, not a second eleven computed here.
   *
   * They come from the panel's own class driven headless (`modules/boards.py`), with the operator's shape
   * rulings applied - the same call the screen makes. Null on a sheet built before they existed, and the pitch
   * says so instead of drawing something else under the same name.
   */
  readonly boards = signal<BoardsFile | null>(null);

  /**
   * The clubs' badges, and the id each club is filed under.
   *
   * Both are needed together or neither works: `ui-crest` resolves a file from `fc_club_id` and the index, and
   * without them it draws a MONOGRAM - which is what the auction panel was doing for every club while the
   * bundle carried 93 badges and all 47 clubs of this listone had one. The data was there; nobody asked for it.
   *
   * The join is the club's canonical NAME, which is what the live listone and the bundle's `clubs` share.
   */
  readonly crests = signal<Record<string, string>>({});
  readonly clubIds = signal<Map<string, number>>(new Map());

  constructor() {
    this.restoreHorizon();
    void this.bundle.presenceNow().then((file) => {
      this.paShares.set(presenceNowShares(file));
      this.paOut.set(presenceNowOut(file));
    });
    // The priced calendar, for the keepers' clean-sheet bonus in the draft's FERTILITY (`fertilityBy`).
    void this.bundle.calendar().then((file) => this.calendarFile.set(file));
    effect(() => {
      const ids = [...this.feed.listoneIds()];
      const game = this.feed.isMantra() ? 'mantra' : 'classic';
      const teams = this.feed.teams().length;
      if (ids.length) void this.ensure(ids, game, teams);
    });
    // The two SCREENS are registered on `PlayerStatus`, so one component draws every mark a name carries
    // and two lists can never disagree. The direction is deliberate - this service knows the POOL (which
    // listone is being played, which is part of the measurement) and `PlayerStatus` must not.
    effect(() => this.status.screens.set(this.screenMarks()));
    // ...and the same for who gained or lost a place: the fact is the SHEET's, and which sheet is in
    // play is something only this service knows.
    effect(() => this.status.places.set(this.placeMarks()));
  }

  /**
   * The played window of THIS season, per player: minutes, xG and xA of the league matches.
   *
   * Empty before the season starts, which is the normal August case and is why nothing lights up at a
   * pre-season auction: the screens were calibrated on the first two ROUNDS and a rate needs minutes
   * actually played. `sofascore_extra` (friendlies, cups) is excluded on purpose - the calibration walked
   * the league calendar, and a friendly goal must never enter a number a threshold was fitted on.
   */
  /** Last season's league appearances and starts per player: the half of `subBonusShift` the fantamedia comes from. */
  private readonly prevStarts = signal<Map<number, StartRecord>>(new Map());

  private readonly window = signal<Map<number, { minutes: number; xg: number; xa: number }>>(
    new Map(),
  );

  /**
   * The screens, as marks ready to draw. The pool is the listone in play, and the price is the FVM.
   *
   * A DIFFERENCE from the calibration, stated rather than glossed: the thresholds were fitted on the
   * Qt.I percentile, and this app deliberately does not read the quotation at all (the feed carries four
   * price numbers and nothing says which of each pair is Qt.I - operator's decision, 09/08/2026). So the
   * percentile here is the FVM's. Both are the market's own judgement of the same man and only the RANK
   * inside the role is used, but they are not the same number and the difference is not measured.
   */
  readonly screenMarks = computed<Map<number, PlayerMark>>(() => {
    const played = this.window();
    if (!played.size) return new Map();
    const input: ScreenInput[] = [];
    for (const { player } of this.listone()) {
      const seen = played.get(player.id);
      if (!seen) continue;
      input.push({
        id: player.id,
        role: MACRO_ROLE[player.zoneClassic] ?? null,
        price: player.fvm ?? null,
        minutes: seen.minutes,
        xg: seen.xg,
        xa: seen.xa,
      });
    }
    const out = new Map<number, PlayerMark>();
    for (const [id, hit] of screensFor(input)) out.set(id, screenMark(hit));
    return out;
  });

  /** Who gained a place and who lost one, as marks. The sentence is written in `player-place.ts`. */
  readonly placeMarks = computed<Map<number, PlayerMark>>(() => {
    const out = new Map<number, PlayerMark>();
    for (const [id, place] of this.places()) {
      const mark = placeMark(place);
      if (mark) out.set(id, mark);
    }
    // The rotation watch goes in the SAME map and wins where both exist: «he is being rotated right
    // now» is a state of this season, and it outranks what happened to his shirt in the last one.
    for (const [id, watch] of this.rotations()) {
      const mark = rotationMark(watch);
      if (mark) out.set(id, mark);
    }
    return out;
  });

  /**
   * Le giornate su cui i numeri del foglio sono espressi: la STAGIONE PIENA della piattaforma.
   *
   * Dal 22/09/2026 `engine_pv_pred` e il surplus arrivano riportati li' (`season-scale.ts`), quindi
   * questo e' il loro denominatore. Viene dal FOGLIO e non dal manifest, perche' e' il foglio a
   * dichiarare i suoi due calendari accanto alle righe: leggerlo dal manifest darebbe la stagione
   * piena solo dopo un export nuovo, e nel frattempo i numeri sarebbero riportati e la base no.
   */
  readonly matchdaysTarget = computed(() => this.sheetSeasonRounds() ?? this.entry()?.matchdays_target ?? null);

  /**
   * LE GIORNATE DELLA COMPETIZIONE, dalle opzioni globali («giornate» da-a): l'operatore, 01/10/2026, «ho impostato
   * "giornate" 5-22 in opzioni globali quindi mi aspetterei che Pa e similari siano rimodulati su 18 giornate».
   * Tagliata sul calendario del foglio (una finestra oltre l'ultima giornata non e' piu' lunga) e nulla senza foglio.
   * Supera, per i numeri in giornate del draft, la regola del 22/09/2026 «tutto su base 38»: la base e' ora la
   * competizione dichiarata, e con la finestra 1-38 i due coincidono.
   */
  readonly competitionRounds = computed(() => {
    const full = this.matchdaysTarget();
    if (!full) return null;
    const league = this.options.league();
    const from = Math.min(full, Math.max(1, Math.round(league.from)));
    const to = Math.min(full, Math.max(from, Math.round(league.to)));
    return to - from + 1;
  });

  /** competizione / stagione piena: il fattore che porta un numero in giornate dalla stagione alla competizione. */
  readonly competitionScale = computed(() => {
    const full = this.matchdaysTarget();
    const rounds = this.competitionRounds();
    return full && rounds ? rounds / full : 1;
  });

  /** Popolato quando il foglio viene letto: e' la table a portare i due calendari. */
  private readonly sheetSeasonRounds = signal<number | null>(null);

  readonly lastMatchday = computed(() => this.to() ?? this.matchdaysTarget());

  /** n / N. One constant for everybody, so it moves the cifre and can never reorder the list. */
  readonly horizon = computed(() => {
    const total = this.matchdaysTarget();
    const last = this.lastMatchday();
    if (!total || !last) return 1;
    const rounds = Math.max(0, last - this.from() + 1);
    return Math.min(1, rounds / total);
  });

  readonly rounds = computed(() => {
    const last = this.lastMatchday();
    return last ? Math.max(0, last - this.from() + 1) : null;
  });

  /** The rounds every absolute number is spread over: the horizon, or the whole calendar. */
  private readonly spread = computed(() => this.rounds() ?? this.matchdaysTarget());

  /**
   * How many men of each slot the table will buy.
   *
   * Classic is exact: the zone IS the role and the session states the quota, so it is `teams x slots`.
   * Mantra is not, and the source matters - the places come from the GAME's shapes
   * (`mantra_modules.json`), because splitting a roster by macro-role quotas answered «all 124 left
   * backs» and doubled the best `ds`'s surplus. Without the modules file we fall back to reading the
   * sheet's own replacement levels, which is that same worse placeholder, and the panel says so.
   */
  private readonly demand = computed(() => {
    const teams = this.feed.teams().length;
    const roles = this.feed.league()['roles'] ?? {};
    const slots = (zone: string) => {
      const pair = roles[zone];
      return Array.isArray(pair) ? pair[0] : (pair ?? 0);
    };
    if (!teams) return new Map<string, number>();

    if (!this.feed.isMantra()) {
      return new Map<string, number>([
        ['P', teams * slots('gk')],
        ['D', teams * slots('def')],
        ['C', teams * slots('mid')],
        ['A', teams * slots('atk')],
      ]);
    }

    const shapes = this.shapes();
    if (!shapes) return demandBySlot(this.numbers().values());
    const demand = demandFromShapes(slotShares(shapes), teams, slots('mov'));
    demand.set('por', teams * slots('gk'));
    return demand;
  });

  /** True while the demand is the placeholder the modules file replaces. */
  readonly demandFromQuotas = computed(() => this.feed.isMantra() && !this.shapes());

  /** How many of each slot are already gone from the table. */
  private readonly taken = computed(() => {
    const taken = new Map<string, number>();
    for (const pick of this.feed.picks()) {
      const slot = this.numbers().get(pick.playerId)?.slot;
      if (slot) taken.set(slot, (taken.get(slot) ?? 0) + 1);
    }
    return taken;
  });

  /** The live zero per slot: the marginal man among those still free. */
  readonly replacements = computed(() =>
    liveReplacements(
      this.feed.available().map((player) => ({
        id: player.id,
        slot: this.numbers().get(player.id)?.slot ?? null,
        fm: valuationOf(this.numbers().get(player.id)).fm,
      })),
      this.demand(),
      this.taken(),
    ),
  );

  /** The slots the table still has to fill - the budget lambda is spent against in a draft. */
  readonly slotsLeft = computed(() => {
    let left = 0;
    for (const [slot, wanted] of this.demand()) {
      left += Math.max(0, wanted - (this.taken().get(slot) ?? 0));
    }
    return left;
  });

  /**
   * The 99 of the value scale: the best gross worth in THIS SESSION'S listone, taken players included.
   * Free men alone would re-scale everybody upward as the big names go, and a number that changes
   * meaning mid-auction cannot be read across two moments of the same table.
   */
  private readonly valueMax = computed(() => {
    const numbers = this.numbers();
    let max = 0;
    for (const id of this.feed.listoneIds()) {
      const value = valueOf(valuationOf(numbers.get(id)));
      if (value != null && value > max) max = value;
    }
    if (this.feed.isGoalsMode()) {
      for (const valuation of this.portaValuations().values()) {
        const value = valueOf(valuation);
        if (value != null && value > max) max = value;
      }
    }
    return max;
  });

  /** My own best man per slot: the zero of §4.1, the one that makes a fourth strong midfielder cheap. */
  private readonly mineBySlot = computed(() => {
    const mine = new Map<string, number>();
    for (const entry of this.feed.followed()?.squad ?? []) {
      const numbers = entry.player ? this.numbers().get(entry.player.id) : undefined;
      const valuation = valuationOf(numbers);
      if (!numbers?.slot || valuation.fm == null) continue;
      mine.set(numbers.slot, Math.max(mine.get(numbers.slot) ?? 0, valuation.fm));
    }
    return mine;
  });

  readonly lambda = computed(() =>
    lambdaOf(
      this.priced().map((row) => ({ id: row.player.id, surplus: row.surplus, price: row.price })),
      this.slotsLeft(),
    ),
  );

  /**
   * Every free man, ranked by the currency the FORMAT asks for - and this panel prices a DRAFT (§11).
   *
   * The key is the VALUE, fantamedia x expected appearances, and that is measured rather than preferred
   * (`docs/model/metrica-asta-surplus-v1.md` §16, five gate windows, 10/08/2026): ranking a draft by the
   * `net` scores −52% against the paired rivals on 0 of 5 windows, spends 34 credits over 25 picks and
   * leaves half the eleven uncovered. Lambda is the exchange rate between a credit and a fantapunto, so
   * subtracting it rewards being nearly free - and in a draft you do not spend credits, you spend PICKS
   * (§11.2). The surplus loses too (−1.48%), because it charges a per-slot scarcity the mantra rulebook
   * does not impose.
   *
   * `net` and `surplus` stay ON the row, and stay in the panel's columns: they are the right numbers in an
   * auction with raises, and this file will have to ask the format before choosing between them the day
   * one is played here. A man with no valuation at all keeps his row and sorts last - he has no number,
   * which is not a zero.
   */
  readonly ranked = computed<RankedPlayer[]>(() => {
    const lambda = this.lambda();
    const spread = this.spread();
    const rows = this.priced().map((row) => {
      const net = netOf(row.surplus, row.price, lambda);
      return { ...row, net, netPer10: per(net, spread) };
    });
    // CHI OGGI NON GIOCA SCENDE, prima di ogni valore (03/09/2026, richiesta dell'operatore: i casi come
    // McTominay vanno segnalati «in qualsiasi gerarchia fatta per prendere decisioni nell'immediato»).
    // È un VINCOLO e non un peso - non sappiamo per quanto starà fuori, quindi non lo riprezziamo - e la
    // sua riga porta comunque il campanello rosso, così la ragione dell'ordine è leggibile sulla riga
    // stessa. Resta nella lista: toglierlo nasconderebbe un fatto, e l'operatore può saperne più di noi.
    rows.sort(
      (a, b) =>
        this.status.sinksNow(a.player.id) - this.status.sinksNow(b.player.id) ||
        (b.value ?? -1e9) - (a.value ?? -1e9),
    );
    return rows;
  });

  bySlotOrZone(zone: Zone, limit: number): RankedPlayer[] {
    return this.ranked()
      .filter((row) => row.zone === zone)
      .slice(0, limit);
  }

  /** The surplus of a single player, for a card that already knows who it is about (a porta). */
  forPlayer(player: AuctionPlayer | null): RankedPlayer | null {
    if (!player) return null;
    return this.ranked().find((row) => row.player.id === player.id) ?? null;
  }

  /**
   * I LIBERI, senza le squadre reali che l'operatore ha escluso. Una definizione sola, due lettori.
   *
   * Il taglio è QUI e non sulle rose dei rivali, e la differenza non è una sfumatura: chi è escluso è uno
   * che IO non comprerò, quindi esce da quello che mi viene proposto e da ogni scala che parla della mia
   * lista; quello che i rivali hanno già preso resta dov'è, perché è un fatto sulla stanza e non sulla
   * mia lista - e il classificatore dei rivali rigioca il draft su quello.
   *
   * Il club si risolve con `clubIds`, cioè la chiave canonica, perché un nome non è una chiave. Finché
   * l'indice non è arrivato (lo legge la stessa passata che sceglie il foglio) nessuno viene escluso:
   * meglio una lista intera che una lista tagliata da un join a metà.
   */
  /**
   * Il listone le cui esclusioni valgono qui: quello del TAVOLO, e quello dichiarato finché il tavolo non lo
   * dice. Le esclusioni sono per listone (`GlobalOptions.excludedOn`): i club italiani esclusi dalla sua
   * EuroLeghe non devono svuotare un draft Serie A.
   */
  private readonly excludedPlatform = computed<Platform>(() => this.feed.platform() ?? this.options.league().platform);

  private readonly free = computed<AuctionPlayer[]>(() => {
    const available = this.feed.available();
    if (!this.options.excludedOn(this.excludedPlatform()).size) return available;
    const ids = this.clubIds();
    return available.filter((player) => this.options.keeps(ids.get(player.club) ?? null, this.excludedPlatform()));
  });

  /**
   * THE VALUATION OF EVERY GOAL, keyed by club: the mix of its keepers weighted by the matches each one is
   * expected to play (`portaValuation`, the operator's definition of 28/09/2026). Computed for the whole
   * listone, owned goals included, because the pitch prices the goals a squad already has.
   */
  readonly portaValuations = computed<Map<string, Valuation>>(() => {
    const numbers = this.numbers();
    const matchdays = this.matchdaysTarget();
    const out = new Map<string, Valuation>();
    for (const porta of this.feed.porte()) {
      const keepers = porta.keepers.map((keeper) => valuationOf(numbers.get(keeper.id)));
      out.set(porta.club, portaValuation(keepers, matchdays));
    }
    return out;
  });

  /**
   * The two zeros of a porta, measured the way a man's are but on GOALS: how many the table buys is the
   * session's keeper slots times the teams - and each slot is a porta now, not a man.
   *
   *   * `live` - the marginal FREE goal the table still has room for, which is what «+/10g» reads for a man;
   *   * `league` - the same rank over the whole listone, which is what the lead reads: «how much is it worth
   *     in this league», and it does not move as the table empties.
   *
   * Neither can be the sheet's `engine_replacement_fm` for keepers: that is the marginal MAN of a roster that
   * holds three keepers per team, i.e. a third-choice keeper, and a goal is never a third choice.
   */
  private readonly portaZeros = computed<{ live: number | null; league: number | null }>(() => {
    const roles = this.feed.league()['roles'] ?? {};
    const gk = this.feed.porteSlots() ?? (Array.isArray(roles['gk']) ? roles['gk'][0] : (roles['gk'] ?? 0));
    const demand = this.feed.teams().length * (Number(gk) || 0);
    const valuations = this.portaValuations();
    const fmOf = (porta: Porta) => valuations.get(porta.club)?.fm ?? null;
    const zeroOf = (porte: Porta[], rank: number) => porteZero(porte.map(fmOf), rank);
    const all = this.feed.porte();
    const owned = all.filter((porta) => porta.teamId !== null).length;
    return {
      live: zeroOf(this.feed.freePorte(), Math.max(0, demand - owned)),
      league: zeroOf(all, demand),
    };
  });

  /** The best goal I already own, by its mixed fantamedia: the personal zero of a porta. */
  private readonly myBestPortaFm = computed<number | null>(() => {
    const valuations = this.portaValuations();
    let best: number | null = null;
    for (const porta of this.feed.myPorte()) {
      const fm = valuations.get(porta.club)?.fm ?? null;
      if (fm != null && (best === null || fm > best)) best = fm;
    }
    return best;
  });

  /** Everything except `net`, which needs the whole list first: lambda is a property of the pool. */
  private readonly priced = computed<Omit<RankedPlayer, 'net' | 'netPer10'>[]>(() => {
    const goals = this.feed.isGoalsMode();
    const men = this.free().filter((player) => !(goals && this.feed.zoneOf(player) === 'gk'));
    const price = this.pricer();
    const rows: Omit<RankedPlayer, 'net' | 'netPer10'>[] = men.map(price);
    if (!goals) return rows;
    return this.withPorte(rows);
  });

  /**
   * THE MEN ALREADY IN A SQUAD, priced like the free ones (operator, 05/10/2026: «un check nella tabella per mostrare
   * anche i calciatori già scelti»): the same row, so a taken man reads the same numbers he read while free. Never fed
   * to a plan or a rival walk - the free pool is `ranked` - and with the porte rule a taken keeper stays a man.
   */
  readonly takenRanked = computed<RankedPlayer[]>(() => {
    const lambda = this.lambda();
    const spread = this.spread();
    const price = this.pricer();
    const seen = new Set<number>();
    const out: RankedPlayer[] = [];
    for (const team of this.feed.teams()) {
      for (const entry of team.squad) {
        if (!entry.player || seen.has(entry.player.id)) continue;
        seen.add(entry.player.id);
        const row = price(entry.player);
        const net = netOf(row.surplus, row.price, lambda);
        out.push({ ...row, net, netPer10: per(net, spread) });
      }
    }
    return out;
  });

  /** One man's row of the ranking, everything it reads taken once (`priced`, `takenRanked`). */
  private readonly pricer = computed(() => {
    const numbers = this.numbers();
    const replacements = this.replacements();
    const mine = this.mineBySlot();
    const horizon = this.horizon();
    const total = this.matchdaysTarget();
    const spread = this.spread();
    const valueMax = this.valueMax();
    return (player: AuctionPlayer): Omit<RankedPlayer, 'net' | 'netPer10'> => {
      const row = numbers.get(player.id);
      const valuation = valuationOf(row);
      const slot = row?.slot ?? null;
      const live = slot ? (replacements.get(slot) ?? null) : null;
      // A slot the live demand cannot speak for - a man the listone gives no Mantra role, so the sheet
      // priced him on his classic one - keeps the sheet's league zero and the row says which it is.
      const replacement = live ?? row?.replacementFm ?? null;
      const surplus = surplusOf(valuation, replacement, horizon);
      // MY zero is the better of the league's marginal man and the best I already hold there: a slot
      // I have covered is worth what it ADDS, which is the whole point of the personal replacement.
      const personal = slot
        ? Math.max(replacement ?? 0, mine.get(slot) ?? 0) || replacement
        : replacement;
      return {
        player,
        zone: this.feed.zoneOf(player),
        valuation,
        replacementFm: replacement,
        surplus,
        surplusPerRound: surplus != null && total ? surplus / (this.rounds() || total) : null,
        surplusPer10: per(surplus, spread),
        ratio: surplus != null && player.fvm > 0 ? surplus / player.fvm : null,
        value99: score99(valueOf(valuation), valueMax),
        // Il LEAD conta dal rimpiazzo del FOGLIO e non da quello vivo: `replacement` qui sopra è la
        // domanda dell'asta in corso, questo è «quanto vale in una lega da dieci» (vedi l'interfaccia).
        lead: surplusOf(valuation, row?.replacementFm ?? null),
        leadZero: row?.replacementFm ?? null,
        value: valueOf(valuation),
        surplusForMe: surplusOf(valuation, personal, horizon),
        price: player.fvm,
        fmPrev: this.measured().get(player.id) ?? null,
        minutesPerMatch:
          row?.minutesFullSeason != null && row.seasonMatches
            ? row.minutesFullSeason / row.seasonMatches
            : null,
        zeroIsLive: live != null,
        trend: this.trends().get(player.id) ?? null,
        trend99: this.trend99().get(player.id) ?? null,
        porta: null,
      };
    };
  });

  private withPorte(rows: Omit<RankedPlayer, 'net' | 'netPer10'>[]): Omit<RankedPlayer, 'net' | 'netPer10'>[] {
    const numbers = this.numbers();
    const total = this.matchdaysTarget();
    const spread = this.spread();
    const horizon = this.horizon();
    const valueMax = this.valueMax();
    // ONE ROW PER FREE GOAL, named after the CLUB (operator, 28/09/2026). The id is the keeper expected to
    // play most - it is who a pick is recorded under - and the FVM is the goal's own (`Porta.price`, the
    // dearest keeper: what a rival buying by price calls). Excluded clubs leave here as their men do.
    const valuations = this.portaValuations();
    const zeros = this.portaZeros();
    const zero = zeros.live ?? zeros.league;
    const ids = this.clubIds();
    const porte = this.feed.freePorte().filter((porta) => this.options.keeps(ids.get(porta.club) ?? null, this.excludedPlatform()));
    for (const porta of porte) {
      const valuation = valuations.get(porta.club) ?? portaValuation([], total);
      const pvOf = (player: AuctionPlayer) => valuationOf(numbers.get(player.id)).pv ?? -1;
      const standIn = [...porta.keepers].sort((a, b) => pvOf(b) - pvOf(a))[0];
      if (!standIn) continue;
      const surplus = surplusOf(valuation, zero, horizon);
      // You field ONE goal a matchday, so a second porta adds only where it beats the best one you hold.
      const personal = Math.max(zero ?? 0, this.myBestPortaFm() ?? 0) || zero;
      rows.push({
        player: { ...standIn, name: porta.club, fvm: porta.price },
        zone: 'gk',
        valuation,
        replacementFm: zero,
        surplus,
        surplusPerRound: surplus != null && total ? surplus / (this.rounds() || total) : null,
        surplusPer10: per(surplus, spread),
        ratio: surplus != null && porta.price > 0 ? surplus / porta.price : null,
        value99: score99(valueOf(valuation), valueMax),
        lead: surplusOf(valuation, zeros.league),
        leadZero: zeros.league,
        value: valueOf(valuation),
        surplusForMe: surplusOf(valuation, personal, horizon),
        price: porta.price,
        fmPrev: null,
        minutesPerMatch: null,
        zeroIsLive: zeros.live != null,
        trend: null,
        trend99: null,
        porta,
      });
    }
    return rows;
  }

  /**
   * The 0-99 of the trend, inside the ROLE and over the listone being played.
   *
   * The pool is part of the measurement, so it is the same one `value99` uses - this session's listone,
   * taken men included - and the role is the operator's own: «he is going well» is relative to what his
   * role can produce. It is a DESCRIPTION and not a forecast (see `core/player-trend`), which is why it
   * enters no plan, no advice and no eleven.
   */
  private readonly trend99 = computed(() => {
    const trends = this.trends();
    if (!trends.size) return new Map<number, number>();
    return trendScores(
      this.listone().map(({ player }) => ({
        id: player.id,
        role: MACRO_ROLE[player.zoneClassic] ?? null,
        fp: trends.get(player.id)?.fp ?? null,
      })),
    );
  });

  /**
   * Load the sheet that actually fits this table, and say how well it fits.
   *
   * The sheet is chosen by the OVERLAP OF IDS, not by the platform. `playerListType` says `custom`
   * whenever the host uploads his own list - which is the normal case here, since the pool of free
   * agents is customised - and a custom list may carry no championship on its rows at all, so the
   * platform is not readable from it (observed live on `FA-zna-v85`, 09/08/2026: every row without a
   * championship, the panel silently priced nobody). Ids are not a matter of interpretation: they are
   * `fc_id`, so «which sheet knows these men» is a countable question, and the count is reported.
   *
   * The GAME still filters, because it is stated by the session and it changes the slots a surplus is
   * measured in - 904 of 916 values move between classic and mantra.
   */
  /**
   * The recommended pick, with the picks it expects before our next turn.
   *
   * One assumption and it is named in the card: a rival takes the dearest man still free among the
   * roles his own squad has yet to cover (§17.3 requires the policy to be stated, not hidden). The
   * ORDER around it is not assumed - it is the platform's own rule, reproduced from its source.
   */
  /**
   * THE MEN TAKEN OUT OF THE ADVICE (operator, 05/10/2026: «dammi la possibilità di escludere dei calciatori dai
   * consigli»), per session code: never one of our moves in the plans (`ScenarioInput.excluded`), still free for the
   * rivals and still in the list, dimmed. A per-viewer preference, so `localStorage`, and a session of its own.
   */
  private readonly excludedBySession = signal<Record<string, number[]>>(readExcluded());
  readonly excluded = computed<ReadonlySet<number>>(() => new Set(this.excludedBySession()[this.feed.code() ?? ''] ?? []));

  toggleExcluded(playerId: number): void {
    const now = new Set(this.excluded());
    if (now.has(playerId)) now.delete(playerId);
    else now.add(playerId);
    this.writeExcluded([...now]);
  }

  clearExcluded(): void {
    this.writeExcluded([]);
  }

  private writeExcluded(ids: number[]): void {
    this.writeSessionSet(this.excludedBySession, EXCLUDED_KEY, ids);
  }

  /**
   * THE OPERATOR'S FAVOURITES (operator, 05/10/2026: «dammi la possibilità anche di marchiare i miei calciatori
   * preferiti»), per session code like the exclusions. A preference and not a weight: no plan ranks them higher - the
   * page only warns when one of them is likely gone before our turn (`favouritesAtRisk`).
   */
  private readonly favouritesBySession = signal<Record<string, number[]>>(readExcluded(FAVOURITES_KEY));
  readonly favourites = computed<ReadonlySet<number>>(
    () => new Set(this.favouritesBySession()[this.feed.code() ?? ''] ?? []),
  );

  toggleFavourite(playerId: number): void {
    const now = new Set(this.favourites());
    if (now.has(playerId)) now.delete(playerId);
    else now.add(playerId);
    this.writeSessionSet(this.favouritesBySession, FAVOURITES_KEY, [...now]);
  }

  /**
   * THE FAVOURITES LIKELY GONE BEFORE OUR NEXT TURN (operator, 05/10/2026: «quando uno di questi finisce in quelli che
   * probabilmente verranno presi da altri, aggiungi un consiglio particolare»): free favourites whose odds of being
   * taken (`goneOdds`) reach `FAVOURITE_AT_RISK`, most at risk first. Draft only, like the odds.
   */
  readonly favouritesAtRisk = computed<{ id: number; odds: number }[]>(() => {
    const favourites = this.favourites();
    if (!favourites.size) return [];
    const odds = this.goneOdds();
    return [...favourites]
      .map((id) => ({ id, odds: odds.get(id) ?? 0 }))
      .filter((one) => one.odds >= FAVOURITE_AT_RISK)
      .sort((a, b) => b.odds - a.odds);
  });

  private writeSessionSet(store: WritableSignal<Record<string, number[]>>, key: string, ids: number[]): void {
    const code = this.feed.code() ?? '';
    const all = { ...store() };
    if (ids.length) all[code] = ids;
    else delete all[code];
    store.set(all);
    try {
      localStorage.setItem(key, JSON.stringify(all));
    } catch {
      // A browser that refuses storage keeps the choice for this visit.
    }
  }

  /** Which of the divergent options the operator is looking at. Both views read the same one. */
  readonly chosenRoot = signal<number | null>(null);

  chooseRoot(playerId: number | null): void {
    this.chosenRoot.set(playerId);
  }

  /**
   * Every man of the session's listone, with whether he is already off the board.
   *
   * ONE definition, because two places need it and they must not disagree: the rival classifier replays the
   * whole draft (a man taken in round two WAS available then), and the club pitch draws the men who are gone
   * at 30% opacity. `available()` is the free pool, so the taken ones are recovered from the squads - which is
   * also the only public way to reach them.
   */
  readonly listone = computed<{ player: AuctionPlayer; taken: boolean }[]>(() => {
    const rows: { player: AuctionPlayer; taken: boolean }[] = [];
    const seen = new Set<number>();
    for (const player of this.free()) {
      seen.add(player.id);
      rows.push({ player, taken: false });
    }
    for (const team of this.feed.teams()) {
      for (const entry of team.squad) {
        if (!entry.player || seen.has(entry.player.id)) continue;
        seen.add(entry.player.id);
        rows.push({ player: entry.player, taken: true });
      }
    }
    return rows;
  });

  /**
   * The drawn board of one real club, joined by NAME.
   *
   * By name and not by identity because that is all these two artefacts share: the board's key is the sheet's
   * `club` (the canonical name the toolkit resolved) and the live listone spells the same club the same way -
   * both come from the same fc_site listone. Where a name does not match, the pitch has no board and says so;
   * inventing a fuzzy match here would be the name join this repository has already paid for four times.
   */
  boardOf(club: string | null): Board | null {
    if (!club) return null;
    const board = this.boards()?.clubs?.[club] ?? null;
    return board && !board.error ? board : null;
  }

  /**
   * The 0-99 worth of EVERY man of the listone, taken ones included, on the SAME scale the table reads.
   *
   * The same scale is the point: `value99` is measured against the best man of this session's listone, taken or
   * not, so a 60 said at the first pick is a 60 at the last. Computing it a second time from the free pool
   * alone would re-scale everybody upward as the big names go, and the number would stop meaning one thing.
   */
  readonly value99By = computed<Map<number, number | null>>(() => {
    const max = this.valueMax();
    const out = new Map<number, number | null>();
    for (const [id, value] of this.valueBy()) out.set(id, score99(value, max));
    return out;
  });

  /**
   * The same worth in FANTAPUNTI, for every man of the listone, taken ones included.
   *
   * `value99` is a rank and cannot be summed; an eleven's worth is a sum, so the fanta pitch needs the number
   * behind it. One definition for both - `value99By` is this map on the session's scale - because two ways of
   * pricing the same man would eventually disagree about which eleven is the strongest.
   */
  readonly valueBy = computed<Map<number, number | null>>(() => {
    const numbers = this.numbers();
    const out = new Map<number, number | null>();
    for (const { player } of this.listone()) {
      out.set(player.id, valueOf(this.valuationFor(player, numbers)));
    }
    return out;
  });

  /**
   * The share of the calendar the ENGINE expects each man to be RATED in, for the whole listone.
   *
   * The other half of the board's own answer, and it is here rather than in the pitch because the pitch
   * must not own a definition: the same fraction decides whether a chip is marked as disputed and it is
   * the number the sheet's `Presenze` column shows. It is `engine_pv_pred` (or the declared estimate)
   * over the calendar THAT sheet's appearances are expressed on - never another sheet's.
   */
  /**
   * THE NEW FORMULA'S SHARE of the rounds left (`presence_now.json`, `toolkit/scripts/presence_test/now.py`), by
   * fc_id: the «Pa» column of the draft, and the appearances the Draft Priority reads where it exists (operator,
   * 01/10/2026: «aggiorniamo il calcolo del DP utilizzando SeSw, Rar e Pa nuovo», «dove c'e', anche su euro»).
   * Serie A only and not gated - both said where the column is drawn. Empty until the file is read.
   */
  readonly paShares = signal<ReadonlyMap<number, number>>(new Map());
  private readonly paOut = signal<{ rounds: number; out: ReadonlyMap<number, number> }>({ rounds: 0, out: new Map() });

  /**
   * THE SHARE OF THE COMPETITION'S ROUNDS LEFT A MAN WITH AN OPEN STOP CAN PLAY (operator, 05/10/2026: «+Rosa deve
   * guardare il range di giornate specificato nelle opzioni (5-22) quindi deve valutare anche questo se un calciatore è
   * infortunato adesso»), by id: his club's fixtures of rounds `from`..`to` still to play, after his prudent return
   * (`injury-window.outWindow`, the plancia's own reading). Absent = nothing to take off.
   */
  readonly windowPlayable = computed<Map<number, number>>(() => {
    const book = this.calendarBook();
    const full = this.matchdaysTarget();
    const out = new Map<number, number>();
    if (!book || !full) return out;
    const league = this.options.league();
    const from = Math.min(full, Math.max(1, Math.round(league.from)));
    const to = Math.min(full, Math.max(from, Math.round(league.to)));
    const today = this.status.today();
    for (const { player } of this.listone()) {
      const injury = this.status.openInjury(player.id);
      if (!injury) continue;
      const window = outWindow({
        calendar: book.forClub(player.club) ?? null, club: player.club, today, until: injury.until ?? null,
        seasonOver: injury.seasonOver, source: injury.source, severity: injury.severity, from, to,
      });
      if (window) out.set(player.id, window.share);
    }
    return out;
  });

  /**
   * THE APPEARANCES THE DRAFT PRIORITY READS: the new formula's share where the file carries the man, the
   * engine's (`expectedShareBy`) elsewhere - his decision, with the price stated: on EuroLeghe a Serie A man and a
   * foreign one are then valued by two models, and in September the formula reads higher than the engine.
   * One map for SeSw (`priorityMen`) and RAR (`rarityReadings`), so the two halves of the DP read one number.
   */
  readonly draftShareBy = computed<Map<number, number | null>>(() => {
    const now = this.paShares();
    const paOut = this.paOut();
    const numbers = this.numbers();
    const out = new Map(this.expectedShareBy());
    for (const id of out.keys()) {
      // A DECLARED RUNG WINS (operator, 01/10/2026: «se il gradino stampa è aggiornato, usiamolo. Altrimenti usiamo
      // il gradino del motore»): his own dritta, or the press's when it is fresh (`PlayerRulings.all`), priced as
      // its word's share of the votes (`RUNG_VOTE_SHARE`). A word that confirms the sheet's rung changes nothing,
      // so the row keeps the new formula. Until today the draft read neither.
      const ruled = ruledShare(this.rulings.of(id), numbers.get(id)?.titolarita ?? null, RULED_SHARES);
      // The formula's share has already taken its OWN open-stop rounds off the season: given back here, so the stop is
      // priced once, on the competition's window, below.
      const taken = ruled ? 0 : (paOut.out.get(id) ?? 0);
      const raw = ruled?.play ?? now.get(id);
      const share = raw == null ? null
        : taken > 0 && paOut.rounds > taken ? raw * paOut.rounds / (paOut.rounds - taken) : raw;
      if (share != null) out.set(id, Math.min(1, Math.max(0, share)));
    }
    // AN OPEN STOP ON THE COMPETITION'S WINDOW (`windowPlayable`): the press's word, a declared rung and the engine's
    // season share say how often he plays when fit, and none of them knows he is out until December.
    for (const [id, playable] of this.windowPlayable()) {
      const share = out.get(id);
      if (share != null) out.set(id, share * playable);
    }
    return out;
  });

  readonly expectedShareBy = computed<Map<number, number | null>>(() => {
    const total = this.matchdaysTarget();
    const numbers = this.numbers();
    const out = new Map<number, number | null>();
    for (const { player } of this.listone()) {
      const pv = this.valuationFor(player, numbers).pv;
      out.set(player.id, pv == null || !total ? null : Math.min(1, pv / total));
    }
    return out;
  });

  private readonly calendarFile = signal<CalendarFile | null>(null);
  private readonly calendarBook = computed(() => calendarBookFrom(this.calendarFile()));

  /**
   * THE DRAFT'S FERTILITY PER APPEARANCE (operator, 01/10/2026: «nella fertilità dobbiamo aggiungere il contributo della
   * costanza (se r-factor è attivo o è un difensore/portiere e il mod-dif è attivo) ... anche il cleansheet per il
   * portiere se è attivo»): `bonusBy` plus two league modifiers the fantavoto does not contain.
   *   - STEADINESS: his share of sufficient base votes x `swing.STEADY_SHARE` (the part of the R-Factor or the
   *     defence modifier one man can claim, the SWING's own term and weight), where the league pays the R-Factor, or
   *     and once more for a defender or keeper where it pays the defence modifier: TWICE for them where both are
   *     paid (operator, same day: «se sono attivi tutti e due il bonus vale doppio per difensori e portieri»). A man with no measured
   *     steadiness reads his role's (`swing.ROLE_STEADY`), as the SWING does.
   *   - CLEAN SHEET: for a keeper where the league pays it, the expected share of clean sheets of HIS club on the
   *     calendar that is left (`keeper-pairs.cleanSheetOutlook`), +1 point each. ABSOLUTE and not the SWING's
   *     differential, because the fertility is an absolute bonus too (his malus is not net of any replacement).
   * Null where the bonus itself is unknown: the two terms are never a fertility on their own («vuoto = ignoto»).
   */
  readonly fertilityBy = computed<Map<number, number | null>>(() => {
    const out = new Map(this.fertilityAbsolute());
    // THE KEEPERS' ZERO, without the weeks (`KEEPER_WEEKS` off): the same «against the average starter» the weeks
    // apply (`keeperZero`), so a strong door is positive and a weak one negative. With the weeks the zero is already
    // inside them.
    if (!this.keeperWeeksBy().size) {
      const zero = this.keeperFertilityZero();
      for (const [id, value] of out) if (value != null && this.isKeeper(id)) out.set(id, value - zero);
    }
    return out;
  });

  /** `fertilityBy` before the keepers without weeks are moved onto the average starter. */
  private readonly fertilityAbsolute = computed<Map<number, number | null>>(() => {
    const bonus = this.bonusBy();
    const league = this.options.league();
    const platform = this.entry()?.platform ?? 'euro';
    const book = this.calendarBook();
    const weeksBy = this.keeperWeeksBy();
    const subNow = this.subNowBy();
    const subShift = this.subShiftBy();
    const numbers = this.numbers();
    const men = this.priorityMen();
    const worth = this.priorityWorth();
    const out = new Map<number, number | null>();
    for (const { player } of this.listone()) {
      // AN OUTFIELD MAN'S FERTILITY IS HIS FANTAMEDIA ABOVE A ZERO (operator, 05/10/2026: «la classifica degli attaccanti
      // dovrebbe essere più o meno Malen, Martinez, Hojlund ... subito dopo ci dovrebbero essere Thuram e Dybala»), and
      // no longer `fm − mv`: a difference of two forecasts read a LOW predicted base
      // vote as more bonus (Kean 6.01 against Lautaro's 6.38 put him ahead at a lower fantamedia), and a base vote is
      // points on the scoresheet like a goal. A keeper keeps his own pair: his «bonus» is the malus of a door, read
      // against the average starter below.
      const keeperRole = MACRO_ROLE[player.zoneClassic] === 'P';
      const fm = keeperRole ? null : valuationOf(numbers.get(player.id)).fm;
      // ...ABOVE THE MAN WHO WOULD PLAY INSTEAD (operator, 05/10/2026, «Maldini con un DP -4 come fa a stare così in
      // alto?»): the 6 is replaced by R, the Draft Priority's own fallback for his base role (`RoleStat.reserveFm`, the
      // mean of the role's bought reserves), so a man is worth what he gives over the reserve who covers his place -
      // the same zero the DP charges his absent rounds against. Without a DP context (no draft read) the 6 stays.
      const man = men.get(player.id);
      const stat = man && worth ? worth.stats.get(baseRole(worth.rules, man.roles, man.slot)) : undefined;
      const zero = stat ? (stat.reserveFm ?? stat.p10) : swingBase('A');
      const raw = keeperRole ? (bonus.get(player.id) ?? null)
        : fm == null ? null : fm - zero + (subShift.get(player.id) ?? 0);
      // THE APPEARANCES FROM THE BENCH COUNT `SUB_APPEARANCE_WEIGHT` OF A START in the fertility (declared, `sub-bonus.ts`):
      // here and not in `bonusBy`, which RAR also reads - the declaration is about +Rosa's fertility and nothing else.
      const sub = subNow.get(player.id);
      // Only on a positive fertility: shrinking a man below the 6 toward zero would make the bench a reward.
      const base = raw == null || sub == null || raw <= 0 ? raw : raw * (1 - (1 - SUB_APPEARANCE_WEIGHT) * sub);
      if (base == null) {
        out.set(player.id, null);
        continue;
      }
      const role = (MACRO_ROLE[player.zoneClassic] ?? null) as Role | null;
      // A keeper with a calendar reads the MEAN of his weeks (`keeperWeeksBy`): the competition window, its easy
      // matches and its clean sheets - so the column and the pitch say one number about him.
      const weeks = role === 'P' ? weeksBy.get(player.id) : undefined;
      const known = weeks?.filter((one): one is number => one != null) ?? [];
      if (known.length) {
        out.set(player.id, known.reduce((sum, one) => sum + one, 0) / known.length);
        continue;
      }
      const calendar = role === 'P' ? (book?.forClub(player.club) ?? null) : null;
      out.set(player.id, draftFertility(base, role, this.ratings.for(platform, player.id)?.steady?.share ?? null,
        calendar ? cleanSheetOutlook(calendar, player.club) : null, league));
    }
    return out;
  });

  private isKeeper(id: number): boolean {
    const player = this.listone().find((one) => one.player.id === id)?.player;
    return !!player && MACRO_ROLE[player.zoneClassic] === 'P';
  }

  /**
   * THE ZERO OF A KEEPER'S FERTILITY: the mean, over the clubs, of the fertility of each club's FIRST keeper (the one
   * with the most expected appearances) - the average starting keeper (operator, 01/10/2026). `values` is the keepers'
   * fertility by id.
   */
  private keeperZero(values: ReadonlyMap<number, number>): number {
    const shares = this.draftShareBy();
    const firstOf = new Map<string, { id: number; share: number }>();
    for (const { player } of this.listone()) {
      if (!values.has(player.id)) continue;
      const share = shares.get(player.id) ?? 0;
      const best = firstOf.get(player.club);
      if (!best || share > best.share) firstOf.set(player.club, { id: player.id, share });
    }
    const firsts = [...firstOf.values()].map((one) => values.get(one.id)!);
    return firsts.length ? firsts.reduce((sum, one) => sum + one, 0) / firsts.length : 0;
  }

  /**
   * A KEEPER'S FERTILITY MATCH BY MATCH over the competition window (operator, 01/10/2026: «diamo un bonus alla
   * fertilità dei portieri che hanno un calendario facile, limitatamente alle giornate della competizione», and the
   * pairing grid «una volta scelto il primo portiere»). For each matchday from `league.from` to `league.to` that his
   * club plays: his season bonus moved by how many goals that match should cost against his club's season average,
   * plus the steadiness and, where the league pays it, that match's clean-sheet probability (`draftFertility`).
   * The goals come from the calendar's own P(clean sheet): with goals conceded Poisson, E[conceded] = -ln P(0), and a
   * goal conceded is a point off a keeper's fantavoto. The draft pitch fields the keeper with the better match each
   * week (`draft-pitch.keeperYield`), which is what turns two complementary calendars into a bonus. A match with no
   * fitted probability counts at his season average; a club the calendar does not know has no weeks.
   */
  readonly keeperWeeksBy = computed<Map<number, (number | null)[]>>(() => {
    const { weeks, zero } = this.keeperWeeksAbsolute();
    return new Map([...weeks].map(([id, list]) => [id, list.map((one) => (one == null ? null : one - zero))]));
  });

  /** The keepers' weeks in ABSOLUTE fertility, and the zero `keeperWeeksBy` reads them against. */
  private readonly keeperWeeksAbsolute = computed<{ weeks: Map<number, (number | null)[]>; zero: number }>(() => {
    const out = new Map<number, (number | null)[]>();
    const book = this.calendarBook();
    if (!KEEPER_WEEKS || !book) return { weeks: out, zero: 0 };
    const keeperFm = this.keeperFmBy();
    const bonus = this.bonusBy();
    const league = this.options.league();
    const platform = this.entry()?.platform ?? 'euro';
    const goals = (p: number | null) => (p == null ? null : -Math.log(Math.min(0.98, Math.max(0.02, p))));
    for (const { player } of this.listone()) {
      if (MACRO_ROLE[player.zoneClassic] !== 'P') continue;
      const base = bonus.get(player.id) ?? null;
      const calendar = book.forClub(player.club);
      if (base == null || !calendar?.has(player.club)) continue;
      const season = calendar.window(player.club, 1, calendar.rounds).map((match) => goals(match.cleanSheet))
        .filter((one): one is number => one != null);
      const mean = season.length ? season.reduce((sum, one) => sum + one, 0) / season.length : null;
      const steady = this.ratings.for(platform, player.id)?.steady?.share ?? null;
      const calendarKeeper = keeperFm.has(player.id);
      const byRound = new Map(calendar.window(player.club, league.from, league.to).map((match) => [match.round, match]));
      const weeks: (number | null)[] = [];
      for (let round = Math.max(1, league.from); round <= Math.min(league.to, calendar.rounds); round += 1) {
        const match = byRound.get(round);
        if (!match) {
          weeks.push(null);
          continue;
        }
        const conceded = goals(match.cleanSheet);
        // With the club's goals read from the calendar (`keeperFmBy`), a week is that match's own goals; otherwise
        // the season bonus moved by how much easier the match is than his club's average.
        const easier = mean != null && conceded != null ? mean - conceded : 0;
        const week = calendarKeeper && conceded != null ? -conceded : base + easier;
        weeks.push(draftFertility(week, 'P', steady, match.cleanSheet, league));
      }
      if (weeks.some((one) => one != null)) out.set(player.id, weeks);
    }
    // THE ZERO OF A KEEPER'S FERTILITY (operator, 01/10/2026: «un portiere (qualunque esso sia) non porta
    // 'fertilità' ... ma scegliere quello forte significa subire meno malus, quindi la fertilità andrebbe rivista in
    // questo senso»): every keeper's weeks are read AGAINST the average starting keeper of the league - the mean, over
    // the clubs, of the window fertility of each club's first keeper (the one with the most expected appearances).
    // A strong door is then positive, a weak one negative, and an outfield man's bonus (which is not relative to
    // anybody) can be compared with what a keeper saves. The deputies are read against the same zero, so a strong
    // club's second keeper stays a little positive and plays little.
    const shares = this.draftShareBy();
    const firstOf = new Map<string, { id: number; share: number }>();
    for (const { player } of this.listone()) {
      if (!out.has(player.id)) continue;
      const share = shares.get(player.id) ?? 0;
      const best = firstOf.get(player.club);
      if (!best || share > best.share) firstOf.set(player.club, { id: player.id, share });
    }
    const meanOf = (weeks: (number | null)[]) => {
      const known = weeks.filter((one): one is number => one != null);
      return known.length ? known.reduce((sum, one) => sum + one, 0) / known.length : null;
    };
    const firsts = [...firstOf.values()].map((one) => meanOf(out.get(one.id)!)).filter((v): v is number => v != null);
    const zero = firsts.length ? firsts.reduce((sum, one) => sum + one, 0) / firsts.length : 0;
    return { weeks: out, zero };
  });

  /**
   * THE AVERAGE STARTING KEEPER'S FERTILITY, in absolute points per matchday: the zero every keeper's fertility is read
   * against. Negative - a keeper's «bonus» is the malus of the goals conceded - and it is what the pitch's «a partita»
   * adds back to the door (operator, 05/10/2026), or the sum of the fertilities would read a keeper as costing nothing.
   */
  readonly keeperFertilityZero = computed<number>(() => {
    const abs = this.keeperWeeksAbsolute();
    if (abs.weeks.size) return abs.zero;
    const keepers = new Map([...this.fertilityAbsolute()].filter(([id, value]) => value != null && this.isKeeper(id)) as [number, number][]);
    return this.keeperZero(keepers);
  });

  /**
   * The BONUS a man is expected to bring per appearance: predicted fantamedia minus predicted base vote, the two
   * halves the sheet already derives one from the other. What the pitch's FERTILITY of a place sums (operator,
   * 29/09/2026). Null where either half is missing.
   */
  /**
   * THE GOALS A CLUB IS EXPECTED TO CONCEDE PER MATCH over the competition's matchdays (operator, 05/10/2026: «dobbiamo
   * valutare anche i gol SUBITI in media dalla squadra ... secondo le partite del calendario reali nelle giornate
   * comprese nella competizione»): the mean of -ln P(clean sheet) over his club's real fixtures from `league.from` to
   * `league.to` (goals conceded Poisson, E = -ln P(0)), by club name. Absent where the calendar does not know the club.
   */
  readonly clubGoalsAgainst = computed<Map<string, number>>(() => {
    const out = new Map<string, number>();
    const book = this.calendarBook();
    if (!book) return out;
    const league = this.options.league();
    for (const club of new Set(this.listone().map(({ player }) => player.club))) {
      const calendar = book.forClub(club);
      if (!calendar?.has(club)) continue;
      const goals = calendar.window(club, league.from, Math.min(league.to, calendar.rounds))
        .map((match) => match.cleanSheet).filter((p): p is number => p != null)
        .map((p) => -Math.log(Math.min(0.98, Math.max(0.02, p))));
      if (goals.length) out.set(club, goals.reduce((sum, one) => sum + one, 0) / goals.length);
    }
    return out;
  });

  /**
   * A KEEPER'S FANTAMEDIA FOR THE DRAFT: his expected base vote minus the goals his club is expected to concede per
   * match on the competition's calendar (`clubGoalsAgainst`). The engine's fantamedia reads his own past, so a keeper
   * of a promoted club carried the goals of the league he came from (Palmisani 5.03, Frosinone 1.75 goals a match:
   * 4.39 here). Not gated - it is the app's reading for the draft, beside the engine's column. Null where either half
   * is missing, and then the engine's fantamedia stands.
   */
  readonly keeperFmBy = computed<Map<number, number>>(() => {
    const out = new Map<number, number>();
    const numbers = this.numbers();
    const goals = this.clubGoalsAgainst();
    for (const { player } of this.listone()) {
      if (MACRO_ROLE[player.zoneClassic] !== 'P') continue;
      const mv = numbers.get(player.id)?.mv ?? null;
      const against = goals.get(player.club);
      if (mv != null && against != null) out.set(player.id, mv - against);
    }
    return out;
  });

  readonly bonusBy = computed<Map<number, number | null>>(() => {
    const numbers = this.numbers();
    const keepers = this.keeperFmBy();
    const subShift = this.subShiftBy();
    const out = new Map<number, number | null>();
    for (const { player } of this.listone()) {
      // HIS OWN two halves, never `valuationFor`: with the doors on, that one is the PORTA's mix of fantamedia, and
      // subtracting this keeper's base vote from it would mix two men in one number. A keeper's own pair still
      // gives the malus of a door (a negative bonus), which is what the pitch's fertility shows.
      const fm = keepers.get(player.id) ?? valuationOf(numbers.get(player.id)).fm;
      const mv = numbers.get(player.id)?.mv ?? null;
      // THE BONUSES A SUBSTITUTE DOES NOT GET (operator, 05/10/2026: «tra i due Martinez è certamente meglio ... penso
      // che si debba abbassare un po' il valore delle partite dove si entra dalla panchina»): the same shift the Draft
      // Priority's fantamedia already reads (`subShiftBy`), so +Rosa's fertility and the DP agree. The base vote does not
      // move (measured: identical as a substitute), so the whole shift lands on the bonus.
      out.set(player.id, fm == null || mv == null ? null : fm - mv + (keepers.has(player.id) ? 0 : (subShift.get(player.id) ?? 0)));
    }
    return out;
  });

  /**
   * THE FANTAVOTO A MAN LOSES BY ENTERING FROM THE BENCH MORE OFTEN THAN IN THE SEASON HIS FANTAMEDIA COMES FROM
   * (`sub-bonus.subBonusShift`), by id; absent where a number is missing or the role does not pay (keepers). One map, two
   * readers - the Draft Priority's fantamedia and +Rosa's fertility - so the two cannot price a substitute two ways.
   */
  /** The share of his appearances from the bench NOW (`sub-bonus.subShareNow`), by id, outfield men with the press read. */
  readonly subNowBy = computed<Map<number, number>>(() => {
    const numbers = this.numbers();
    const rulings = this.rulings.all();
    const out = new Map<number, number>();
    for (const { player } of this.listone()) {
      const role = MACRO_ROLE[player.zoneClassic] ?? null;
      if (!role || role === 'P') continue;
      const ruling = rulings.get(player.id);
      const share = subShareNow(ruling?.source === 'press' ? ruling.startPct : null, numbers.get(player.id)?.titolaritaPlay);
      if (share != null) out.set(player.id, share);
    }
    return out;
  });

  readonly subShiftBy = computed<Map<number, number>>(() => {
    const numbers = this.numbers();
    // The word in force (`all`): the press only when switched on and fresh, and an operator's own ruling over it -
    // which carries no start share, so a man he declared keeps the engine's fantamedia.
    const rulings = this.rulings.all();
    const prevStarts = this.prevStarts();
    const out = new Map<number, number>();
    for (const { player } of this.listone()) {
      const ruling = rulings.get(player.id);
      const shift = subBonusShift(
        MACRO_ROLE[player.zoneClassic] ?? null,
        ruling?.source === 'press' ? ruling.startPct : null,
        numbers.get(player.id)?.titolaritaPlay,
        prevStarts.get(player.id),
      );
      if (shift != null) out.set(player.id, shift);
    }
    return out;
  });

  /**
   * The REAL clubs at this listone, in alphabetical order - the axis of the pitch selector.
   *
   * Le escluse non ci sono: `listone` porta ancora i loro uomini GIÀ PRESI (vedi `free`), quindi il
   * taglio va rifatto qui sul club, o si offrirebbe il campetto di una squadra che non si compra.
   */
  readonly realClubs = computed<string[]>(() => {
    const ids = this.clubIds();
    const clubs = new Set<string>();
    for (const row of this.listone()) {
      if (row.player.club && this.options.keeps(ids.get(row.player.club) ?? null, this.excludedPlatform())) {
        clubs.add(row.player.club);
      }
    }
    return [...clubs].sort((left, right) => left.localeCompare(right, 'it'));
  });

  /**
   * What a man is worth AS THE TABLE COUNTS HIM: himself, or - a keeper, with the porte rule on - the goal
   * he stands for. One place, so the pitch, the scale and the shares cannot price a keeper two ways.
   */
  private valuationFor(player: AuctionPlayer, numbers: Map<number, EngineNumbers>): Valuation {
    const porta = this.feed.isGoalsMode() ? this.feed.portaOfKeeper().get(player.id) : undefined;
    const mixed = porta ? this.portaValuations().get(porta.club) : undefined;
    return mixed ?? valuationOf(numbers.get(player.id));
  }

  /** The game's shapes as loaded, so a view can draw an eleven on them. */
  readonly rules = computed(() => this.shapes());

  /**
   * What each rival ranks by, guessed from the picks he has already made.
   *
   * Measured on the five gate windows (§17): it predicts a rival's next pick 82.8% of the time against
   * 69.2% for one head for all. It reads `feed.picks()`, so it is recomputed when a pick arrives and not
   * when a row is read - the replay walks the whole draft and is not free.
   *
   * The pool it replays against is the whole session listone and not the free men: a man taken in round two
   * WAS available in round two, and scoring a head against a pool he never faced would grade it on a
   * counterfactual.
   */
  readonly rivalHeads = computed<Map<number, RivalHead>>(() => {
    const mineId = this.feed.followedTeamId();
    if (mineId === null || !this.shapes()) return new Map();
    const numbers = this.numbers();
    const priced = new Map(this.priced().map((row) => [row.player.id, row]));
    // Every man of the listone, free or taken (`listone`): a man taken in round two WAS available in round
    // two, so a replay against the free pool alone would grade every head on a counterfactual - and the men
    // already taken are exactly the evidence.
    const pool: PlanPlayer[] = [];
    for (const { player } of this.listone()) {
      const row = priced.get(player.id);
      pool.push({
        id: player.id,
        name: player.name,
        club: player.club,
        slot: this.slotFor(player, numbers.get(player.id)?.slot),
        roles: this.feed.gameRoles(player),
        price: player.fvm,
        net: row?.surplus ?? null,
        surplus: row?.surplus ?? null,
        value: row?.value ?? null,
      });
    }
    if (!pool.length) return new Map();
    return classifyRivals({
      picks: this.feed.picks().map((pick) => ({ teamId: pick.teamId, playerId: pick.playerId })),
      pool,
      places: startingPlaces(this.shapes()),
      keeperCap: this.keeperSlots(),
      mineId,
      cap: this.pickCap(),
    });
  });

  /**
   * THE FVM CEILING OF THE FIRST TURNS, as the league declares it (`LeagueSettings.draftCap`), or `null`.
   *
   * Only in a DRAFT: in an auction with raises nobody «calls» a man at a price, and a ceiling there would be
   * a rule applied outside the mechanism it was written for. The table does not publish it in any field this
   * project has read, so it is declared and never adopted from the session.
   */
  readonly pickCap = computed<PickCap | null>(() => {
    const cap = this.declaredCap();
    return cap && !this.capOverruled() ? cap : null;
  });

  /** The ceiling as DECLARED in the league settings, before the table is asked whether it holds. */
  private readonly declaredCap = computed<PickCap | null>(() => {
    // The ceiling of the TABLE's listone (one per league, 06/10/2026), the declared one until the table says it.
    const cap = this.options.league().draftCaps[this.excludedPlatform()];
    if (!this.feed.isDraft() || !cap?.on) return null;
    return { fvm: cap.fvm, frozenTurns: cap.frozenTurns };
  });

  /**
   * THE CEILING THAT STILL BINDS SOMEBODY, for the header (operator, 06/10/2026: «evidenzia in modo chiaro quando
   * c'è un tetto attivo»): the cap in force while at least one squad is still inside its frozen turns. Once every
   * squad has called past them it binds nobody, and a warning that cannot change a pick is noise.
   */
  readonly capInForce = computed<(PickCap & { squads: number }) | null>(() => {
    const cap = this.pickCap();
    if (!cap) return null;
    const squads = this.feed.teams().filter((team) => team.squad.length < cap.frozenTurns).length;
    return squads ? { ...cap, squads } : null;
  });

  /**
   * The pick that proves the declared ceiling is NOT in force at this table (`capContradiction`), or null. The page
   * says it, because a declaration switched off in silence reads exactly like one that was never on.
   */
  readonly capOverruled = computed(() =>
    capContradiction(
      this.feed.teams().map((team) => ({
        label: team.label,
        picks: team.squad.map((entry) => ({
          index: entry.index,
          price: entry.player?.fvm ?? entry.cost,
          name: entry.player?.name ?? '?',
        })),
      })),
      this.declaredCap(),
    ),
  );

  /** The turn OUR squad is about to play, i.e. its own pick number. Null when we follow nobody. */
  readonly myTurn = computed<number | null>(() => {
    const team = this.feed.followed();
    return team ? team.squad.length + 1 : null;
  });

  /** Whether the ceiling keeps this price off OUR board on this turn. */
  lockedForMe(price: number): boolean {
    const turn = this.myTurn();
    return turn !== null && capBlocks(turn - 1, price, this.pickCap());
  }

  /** Our squad as the plans read it: its slots, and the quotas it is bound by. */
  private readonly myPlanTeam = computed<PlanTeam | null>(() => {
    const input = this.planInput();
    return input?.teams.find((team) => team.id === input.mineId) ?? null;
  });

  private readonly slotById = computed(() => new Map((this.planInput()?.pool ?? []).map((one) => [one.id, one.slot])));

  /**
   * OUR LINE IS FULL for this man (30/09/2026): the keepers we may hold, and on classic the 8/8/6 quotas. The same
   * guard the advice's own pick obeys (`legalFor`), so the list can say why a man high in the ranking is not the
   * one suggested. A fact about OUR squad and not about him: he stays in the list, dimmed.
   */
  fullForMe(playerId: number): boolean {
    const team = this.myPlanTeam();
    const input = this.planInput();
    if (!team || !input) return false;
    const slot = this.slotById().get(playerId) ?? null;
    if (isKeeperSlot(slot)) return team.slots.filter(isKeeperSlot).length >= input.keeperCap;
    return roleFull(team, slot);
  }

  /** How many keepers a squad may hold, as the session states it. */
  private readonly keeperSlots = computed(() => {
    const roles = this.feed.league()['roles'] ?? {};
    const slots = Array.isArray(roles['gk']) ? roles['gk'][1] : (roles['gk'] ?? 3);
    return Number(slots) || 3;
  });

  /**
   * LA DRAFT PRIORITY (`core/draft-priority.ts`, `docs/model/priorita-draft-v1.md`) prende il posto di
   * `pickForUs` in un DRAFT MANTRA con la matrice delle sostituzioni nel regolamento. Sul CLASSIC era stata
   * accesa il 30/09/2026 (il ruolo base e' il ruolo, i posti quelli dei sette moduli, le quote 3/8/8/6 limitano
   * chi si puo' chiamare - tutto questo resta scritto in `priorityWorth`/`lineQuotas`) e il banco l'ha spenta
   * la sera stessa, qui sotto. A un'asta a rilanci e sul classic resta il consiglio di prima.
   */
  readonly priorityOn = computed(() => {
    if (!this.priorityReadable()) return false;
    // SPENTA SUL CLASSIC dal 30/09/2026 (sera), sul verdetto pre-registrato del banco (todolist-draft-classic-v1
    // item 2.4, priorita-draft-v1.md §24): dieci stagioni Serie A, quote 8/8/6, pool largo, la DP spedita perde
    // -19,9% contro il consiglio di prima (`pickForUs`: valore x quote graduate x sopravvivenza), 0 finestre su
    // 10, e nessuna variante si salva (sconto di RAR 0-0,5, Z a 3 per partecipante, razionamento: tutte fra
    // -18,7% e -21,0%). Il consiglio di prima batte il tavolo 10/10. Riaccenderla e' togliere questa riga.
    // ...E RIACCESA OVUNQUE il 01/10/2026 per decisione dell'operatore («DP deve essere acceso sempre: sia su
    // Mantra che su Classic che su altro»), col prezzo del verdetto qui sopra davanti: e' una sua dichiarazione e
    // non un'adozione del banco, quindi resta a verbale accanto al numero che la contraddice. La matrice delle
    // sostituzioni non era letta dalla DP: era solo una guardia, e il classic non ne ha una.
    return true;
  });

  /**
   * LE LETTURE della priorita' - la SeSw di ogni uomo e il suo Z di ruolo - dove il regolamento le rende
   * calcolabili: ogni draft con dei moduli, classic compreso. E' un'altra domanda da `priorityOn`: la SeSw e'
   * un fatto sull'uomo (quanto rende sopra un titolare medio del suo ruolo) e resta a schermo sul classic;
   * quello che il banco ha bocciato li' e' usarla per SCEGLIERE, e il consiglio lo decide `priorityOn`.
   */
  readonly priorityReadable = computed(() => {
    const rules = this.shapes() as PriorityRules | null;
    return this.feed.isDraft() && !!rules?.roles?.length && !!Object.keys(rules.modules ?? {}).length;
  });

  /**
   * LE QUOTE DELLA ROSA per linea, dove il gioco ne ha (classic: 3/8/8/6, dalla sessione o dalla lega dichiarata).
   * Null sul mantra, che raziona solo i portieri (`keeperCap`).
   */
  private readonly lineQuotas = computed<Partial<Record<Line, number>> | null>(() => {
    if (this.feed.isMantra()) return null;
    const roles = this.feed.league()['roles'] ?? {};
    const max = (zone: string) => {
      const value = Array.isArray(roles[zone]) ? roles[zone][1] : roles[zone];
      return Number.isFinite(Number(value)) && value != null ? Number(value) : null;
    };
    const out: Partial<Record<Line, number>> = {};
    for (const [zone, line] of [['def', 'dif'], ['mid', 'cen'], ['atk', 'att']] as const) {
      const quota = max(zone);
      if (quota != null) out[line] = quota;
    }
    return Object.keys(out).length ? out : null;
  });

  /** Ogni uomo del listone letto come la priorita' lo legge, per id; una porta vale il mix dei suoi portieri. */
  private readonly priorityMen = computed<Map<number, PriorityMan>>(() => {
    const out = new Map<number, PriorityMan>();
    if (!this.priorityReadable()) return out;
    const numbers = this.numbers();
    const matchdays = this.matchdaysTarget();
    const platform = this.entry()?.platform ?? 'euro';
    const goals = this.feed.isGoalsMode();
    const subShift = this.subShiftBy();
    for (const { player } of this.listone()) {
      const porta = goals ? this.feed.portaOfKeeper().get(player.id) : undefined;
      const valuation = this.valuationFor(player, numbers);
      out.set(player.id, {
        id: player.id,
        // A keeper reads `por` in both games: the base-role key the Draft Priority measures doors on.
        roles: this.feed.gameRoles(player).map((role) => (isKeeperSlot(role) ? 'por' : role.toLowerCase())),
        slot: porta ? 'por' : this.slotFor(player, numbers.get(player.id)?.slot),
        price: porta ? porta.price : player.fvm,
        // A keeper's fantamedia reads his club's goals against on the competition's calendar (`keeperFmBy`).
        // ...and an outfield man's moves by the bonuses a substitute does not get (`sub-bonus.ts`, 05/10/2026):
        // the role the press gives him NOW against the one his fantamedia was earned in.
        fm: (porta ? null : this.keeperFmBy().get(player.id))
          ?? (valuation.fm == null ? null : valuation.fm + (porta ? 0 : (subShift.get(player.id) ?? 0))),
        // A door is a club and its mix stays the engine's; a man reads the new formula where it has him.
        share: (porta ? null : this.draftShareBy().get(player.id))
          ?? (valuation.pv != null && matchdays ? Math.min(1, valuation.pv / matchdays) : null),
        steady: porta ? null : (this.ratings.for(platform, player.id)?.steady?.share ?? null),
      });
    }
    return out;
  });

  /**
   * CHI LA LEGA COMPRA, su cui si misurano Z e le fasce: il listone di questa sessione, presi compresi, meno
   * i club esclusi dalle opzioni e gli infortunati pesanti (stop aperto da 45+ giorni, la soglia dell'icona:
   * la specifica li toglie, e l'app sa datarli mentre le finestre storiche del banco no). Con le porte, una
   * riga per club e non tre portieri.
   */
  private readonly priorityWorth = computed<WorthContext | null>(() => {
    if (!this.priorityReadable()) return null;
    const men = this.priorityMen();
    const ids = this.clubIds();
    const goals = this.feed.isGoalsMode();
    const population: PriorityMan[] = [];
    const seenPorte = new Set<string>();
    for (const { player } of this.listone()) {
      if (!this.options.keeps(ids.get(player.club) ?? null, this.excludedPlatform())) continue;
      const man = men.get(player.id);
      if (!man) continue;
      const porta = goals ? this.feed.portaOfKeeper().get(player.id) : undefined;
      if (porta) {
        if (seenPorte.has(porta.club)) continue;
        seenPorte.add(porta.club);
      } else if (this.status.longInjury(player.id)) {
        continue;
      }
      population.push(man);
    }
    const teams = this.feed.teams();
    const quotas = this.lineQuotas();
    const size = {
      teams: teams.length, keepers: this.planInput()?.keeperCap ?? 2, rounds: this.priorityRounds(),
      // Classic: a league buys its quota of each line, and Z is the best of each line by his declared count
      // (`CLASSIC_STARTERS_PER_TEAM`: P 2, D 4, C 4, A 3 per participant).
      ...(quotas ? { quotas, startersPerLine: CLASSIC_STARTERS_PER_TEAM } : {}),
      // Z and R by PRICE inside each base role (the operator, 01/10/2026; `draft-priority.ZERO_FVM_PERCENTILE`).
      byPrice: true,
    };
    const rules = preferredRules(this.shapes() as PriorityRules, RECOMMENDED_MANTRA);
    return {
      rules,
      stats: roleStats(population, rules, size),
    };
  });

  /** Picks a squad makes in the whole draft: the size of the roster. */
  private readonly priorityRounds = computed(() =>
    Math.max(0, ...this.feed.teams().map((team) => team.squad.length + team.missingTotal)));

  /**
   * THE SLOT A PLAN COUNTS A MAN IN: the sheet's, and on CLASSIC his zone where the sheet has none (30/09/2026,
   * found replaying the classic draft FA-yei-458 on the real page). The line quotas are counted on these slots
   * (`roleFull`), and a man the engine does not price had `null` - so a rival's unpriced forward did not count,
   * and the walk predicted him a 7th forward of 6, a pick the host refuses. On classic the zone IS the line the
   * host enforces the quota on, so it is a fact about the man and not a guess; on mantra the slot is a sheet
   * choice among his codes and stays empty where the sheet has none, as before.
   */
  private slotFor(player: AuctionPlayer, sheet: string | null | undefined): string | null {
    if (sheet || this.feed.isMantra()) return sheet ?? null;
    return this.feed.gameRoles(player)[0] ?? null;
  }

  /** The inputs a plan needs, gathered once: the roots and the plans share them. */
  private readonly planInput = computed(() => {
    const mineId = this.feed.followedTeamId();
    const teams = this.feed.teams();
    if (mineId === null || !teams.length) return null;
    const numbers = this.numbers();
    const roles = this.feed.league()['roles'] ?? {};
    const keeperSlots = Array.isArray(roles['gk']) ? roles['gk'][1] : (roles['gk'] ?? 3);
    const keeperCap = (this.feed.isGoalsMode() ? this.feed.porteSlots() : null) ?? (Number(keeperSlots) || 3);
    const quotas = this.lineQuotas();
    const order = this.feed.pickOrder().map((team) => team.id);
    const snake = this.feed.orderType() === 'pingpong';
    const firstRound = this.feed.firstRoundOrder();

    // THE PORTE RULE, which the tool cannot express and the plan was ignoring (§14.1, todolist item 1.6).
    // With it on, a keeper is not a man and a slot is not a man: the unit is the CLUB - taking any keeper of
    // a club takes its goal, and nobody can take a second one. `ranked()` already offers ONE row per free
    // goal, named after the club and valued as the mix of its keepers (28/09/2026), so the pool reads it as
    // it reads a man: three keeper rows per club made the plan believe it could buy the same goal three times.
    return {
      teams: teams.map((team) => ({
        id: team.id,
        label: team.label,
        slots: team.squad
          .map((entry) => (entry.player ? (this.slotFor(entry.player, numbers.get(entry.player.id)?.slot) ?? '') : ''))
          .filter(Boolean),
        // The complete Mantra codes, which is what legality is decided on - the primary code alone would
        // throw away the flexibility of the 497 men of 1014 who carry two or more.
        held: team.squad
          .filter((entry) => this.feed.gameRoles(entry.player).length)
          .map((entry) => ({ roles: this.feed.gameRoles(entry.player).map((role) => role.toLowerCase()) })),
        heldIds: team.squad
          .filter((entry) => this.feed.gameRoles(entry.player).length)
          .map((entry) => entry.player!.id),
        rosterValue: team.spent,
        pickValues: team.squad.map((entry) => entry.cost),
        picksCount: team.squad.length,
        // The DEFAULT rule reaches this only on a full tie, and the published order stands in for the host's draw;
        // a SNAKE reads it on every pick, so there it must be the first round's real order.
        firstRoundIndex: Math.max(0, (snake ? firstRound : order).indexOf(team.id)),
        // Who has called since our last pick, once the order has settled (`ORDER_SETTLES_AFTER`).
        ...(team.squad.length ? { lastPickAt: Math.max(...team.squad.map((entry) => entry.index)) } : {}),
        // The classic quotas, keepers included: a pick over them is one the host refuses.
        ...(quotas ? { limits: { ...quotas, por: keeperCap } } : {}),
      })) as PlanTeam[],
      order,
      pool: this.ranked().map((row) => ({
        id: row.player.id,
        name: row.player.name,
        club: row.player.club,
        slot: row.porta ? 'por' : this.slotFor(row.player, numbers.get(row.player.id)?.slot),
        roles: this.feed.gameRoles(row.player),
        // A goal costs what its dearest keeper costs (`Porta.price`): the man a rival buying by price calls.
        price: row.price,
        net: row.net ?? row.surplus,
        surplus: row.surplus,
        value: row.value,
      })) as PlanPlayer[],
      mineId,
      shapes: this.shapes(),
      // The cap is the session's own keeper slots, and in porte mode it needs no separate arithmetic: with
      // one row per goal, a squad's `por` entries ARE the goals it owns. The one case where the two differ
      // is a table that wrongly let somebody take a second keeper of a club, and the panel already reports
      // that as a mistake (`myStrayKeeperPicks`) rather than counting it.
      // Con le porte il tetto è il numero di porte che la LEGA dichiara, non i posti portiere del software.
      keeperCap,
      maxAheadPicks: Number(this.feed.draftRules()?.['maxAheadPicks'] ?? 1) || 1,
      orderType: this.feed.orderType(),
      heads: this.rivalHeads(),
      cap: this.pickCap(),
      game: (this.feed.isMantra() ? 'mantra' : 'classic') as 'mantra' | 'classic',
      // What a man is worth to whoever holds him. The same VALUE the panel ranks by, because the question a
      // denial answers is about the football and not about the rival's opinion of it.
      worthOf: (playerId: number) => valueOf(valuationOf(numbers.get(playerId))),
    };
  });

  /**
   * THE DRAFT PRIORITY OF ONE TABLE STATE (`draft-priority.ts`): the state a pick is made in, for the squad
   * that makes it. One reader for the column, the advice (`simulateRound`) and the projection
   * (`projectOurPicks` -> `plan`), so our simulated picks are the ones the column ranks first - and R moves
   * with them, because every simulated pick adds a man to the squad whose reserves R reads.
   */
  private readonly priorityEngine = computed(() => {
    // The ADVICE: our pick, the simulated picks, the parts. Off where the bench refused it (classic).
    if (!this.priorityOn()) return null;
    const worth = this.priorityWorth();
    const base = this.planInput();
    const matchdays = this.matchdaysTarget();
    if (!worth || !base || !matchdays) return null;
    const men = this.priorityMen();
    const rules = { cap: base.cap ?? null, keeperCap: base.keeperCap, rounds: this.priorityRounds() };
    const readings = this.rarityReadings();
    // The rarity travels in every state, simulated ones included (`choose`): a projected pick made on the SeSw
    // alone would be a different head from the one the column ranks by. THE RATIONING (`places`) IS NOT PASSED:
    // on the draft bench it fails the robust verdict (+2.0% mean, 3 windows of 5, one at -2.9%;
    // priorita-draft-v1.md §22), and so does RAR together with it (+2.33%, 2 of 5), while RAR alone passes
    // (+1.06%, 4 of 5). Turning it on is one argument here, and the operator's decision.
    const stateOf = (team: PlanTeam, pool: readonly PlanPlayer[], teams: readonly PlanTeam[]): PriorityState => ({
      team, pool, manOf: (id) => men.get(id) ?? null, worth, matchdays,
      rarityOf: (id) => readings.get(id) ?? null, teams, rounds: rules.rounds, orderType: base.orderType,
    });
    const choose: OurChooser = (state) => {
      const team = state.teams.find((one) => one.id === base.mineId);
      return team && team.picksCount < rules.rounds
        ? priorityPick(stateOf(team, state.pool, state.teams), rules) : null;
    };
    return { choose, stateOf, mineId: base.mineId };
  });

  /** Our pick with the Draft Priority, for `plan`/`simulateRound`/`projectOurPicks`. */
  private readonly chooser = computed<OurChooser | null>(() => this.priorityEngine()?.choose ?? null);

  /** The plan's inputs with our own chooser, when the Draft Priority applies. */
  private readonly choosingInput = computed(() => {
    const input = this.planInput();
    const choose = this.chooser();
    return input && choose ? { ...input, choose } : input;
  });

  /**
   * THE SIX READINGS RAR COMPARES A FREE MAN ON (`core/draft-rarity.ts`, the operator's list of 30/09/2026), by id:
   * the titolarità word the list shows (the press's, else the engine's rung), the steadiness, the expected base
   * vote and bonus, the expected share of the calendar, and the share of three years spent injured. The group is
   * the BASE role in a mantra draft - the one the Draft Priority measures him against - and the role in classic. A
   * goal (porte rule) is a club: it is compared on the fantamedia of the door, in the base vote's place, and on its
   * share. One definition for the RAR column, the Draft Priority and its simulated picks.
   */
  private readonly rarityReadings = computed<Map<number, RarityMan>>(() => {
    const out = new Map<number, RarityMan>();
    const numbers = this.numbers();
    const press = this.rulings.press();
    const platform = this.entry()?.platform ?? 'default';
    const shares = this.draftShareBy();
    const bonus = this.bonusBy();
    const rules = this.shapes() as MantraModules | null;
    const mantra = this.priorityOn() && !!rules?.slot_roles;
    const rosa = this.rosaYields();
    for (const row of this.ranked()) {
      const id = row.player.id;
      const share = shares.get(id) ?? null;
      if (row.porta) {
        out.set(id, { id, group: 'por', rung: null, steady: null, mv: row.valuation.fm, bonus: null, share,
          fragility: null });
        continue;
      }
      const roles = this.feed.gameRoles(row.player).map((role) => role.toLowerCase());
      const slot = numbers.get(id)?.slot ?? null;
      const word = shownRung(press.get(id)?.pressTier ?? numbers.get(id)?.titolarita ?? null);
      out.set(id, {
        id,
        group: mantra ? baseRole(rules!, roles, slot) : (slot ?? roles[0] ?? ''),
        rung: word && RUNG_RANK[word] != null ? RUNG_RANK[word] : null,
        steady: this.ratings.for(platform, id)?.steady?.share ?? null,
        mv: numbers.get(id)?.mv ?? null,
        bonus: bonus.get(id) ?? null,
        share,
        fragility: this.status.fragility(id).share,
        // +Rosa replaces the six readings wherever I follow a squad (operator, 01/10/2026).
        rosa: rosa.get(id) ?? null,
      });
    }
    return out;
  });

  /**
   * THE MODULE MY PITCH IS DRAWN ON when the operator forced one (the draft page writes it): the +Rosa of every man is
   * measured on it, so the column and RAR read the pitch he is looking at.
   */
  readonly pitchModule = signal<string | null>(null);

  /** A man as the draft pitch reads him: roles to match on, value, the appearances of the Pa and the bonus. */
  fantaManOf(player: AuctionPlayer, cost: number): FantaMan {
    const shown = this.feed.gameRoles(player);
    // THE ESTIMATE'S CONFIDENCE MULTIPLIES THE FERTILITY (the sheet's own rule: «la penalità moltiplica il
    // numero, perché l'indeterminatezza è un fatto sul NUMERO», and the plancia's lesson of 04/09/2026 - every
    // reader applies it). The fertility is relative to a population zero (the role's reserve, or the average
    // starting keeper), so an uncertain estimate shrinks toward it: found 06/10/2026 on Martinez Jo., a
    // `shrunk` keeper at 0.67 whose +Rosa read with a measured man's authority.
    const confidence = this.numbers().get(player.id)?.estConfidence ?? 1;
    const fertility = this.fertilityBy().get(player.id) ?? null;
    const weeks = this.keeperWeeksBy().get(player.id) ?? null;
    return {
      id: player.id,
      name: this.feed.shownName(player),
      club: player.club,
      shown,
      roles: shown.map((role) => role.toLowerCase()),
      value: this.valueBy().get(player.id) ?? null,
      value99: this.value99By().get(player.id) ?? null,
      cost,
      minutesPerMatch: null,
      share: this.draftShareBy().get(player.id) ?? null,
      bonus: fertility == null ? null : fertility * confidence,
      weeks: confidence === 1 ? weeks : (weeks?.map((week) => (week == null ? null : week * confidence)) ?? null),
      defenceBonus: this.defenceBonusOf(player),
    };
  }

  /**
   * HIS SHARE OF THE DEFENCE MODIFIER inside his fertility (`draftFertility`'s second steadiness term): a keeper or a
   * defender, where the league pays it. The pitch takes it off a module with fewer than four defenders (05/10/2026).
   */
  defenceBonusOf(player: AuctionPlayer): number {
    const role = (MACRO_ROLE[player.zoneClassic] ?? null) as Role | null;
    if (!this.options.league().defenceModifier || (role !== 'P' && role !== 'D')) return 0;
    const steady = this.ratings.for(this.entry()?.platform ?? 'euro', player.id)?.steady?.share ?? null;
    return (steady ?? ROLE_STEADY[role]) * STEADY_SHARE;
  }

  /**
   * +ROSA OF EVERY FREE MAN, by id (operator, 01/10/2026): what he adds to MY pitch in coverage (places) and fertility
   * (points per matchday), drawn ONCE on the module I forced or the one my real men field best, every man added to a
   * copy (`draft-pitch.addedYield`). The column prints it and RAR compares on it. Empty while I follow no squad.
   * In the SIMULATED turns of the plan RAR keeps these readings, i.e. my squad as it is now: re-drawing my pitch for
   * every projected pick would be a second pricing of the same men inside one advice.
   */
  /**
   * WHICH KEEPER OWNS HIS CLUB'S SHIRT: the one with the most expected appearances of his club (`draftShareBy`), and
   * every man's club, for the scenarios' keeper rule (`draft-scenarios.keeperAllowed`).
   */
  readonly keeperShirts = computed(() => {
    const shares = this.draftShareBy();
    const clubs = new Map<number, string>();
    const best = new Map<string, { id: number; share: number }>();
    for (const { player } of this.listone()) {
      clubs.set(player.id, player.club);
      if (MACRO_ROLE[player.zoneClassic] !== 'P') continue;
      const share = shares.get(player.id) ?? 0;
      const top = best.get(player.club);
      if (!top || share > top.share) best.set(player.club, { id: player.id, share });
    }
    return { firsts: new Set([...best.values()].map((one) => one.id)), clubOf: (id: number) => clubs.get(id) ?? null };
  });

  /**
   * THE PRICE OF AN UNCOVERED DOOR WEEK FOR MY SQUAD NOW (`draft-pitch.doorHolePrice`): its keeper places still open
   * over its picks left. One number for the pitch, +Rosa and the plans' increments on screen, so the three agree.
   */
  readonly doorHole = computed(() => {
    // `planInput` and not `scenarioInput`: the scenarios read +Rosa's men (`priorityMen`), so going through them
    // would make the price depend on itself.
    const input = this.planInput();
    const team = input?.teams.find((one) => one.id === input.mineId);
    if (!input || !team) return doorHolePrice(0, 0);
    const doors = team.slots.filter(isKeeperSlot).length;
    return doorHolePrice(input.keeperCap - doors, this.priorityRounds() - team.picksCount);
  });

  /** My real men as the pitch reads them: one list for the base drawing and the «+Giro» re-measures. */
  private readonly mySquadMen = computed<FantaMan[] | null>(() => {
    const me = this.feed.followed();
    if (!me) return null;
    return me.squad.filter((entry) => !!entry.player).map((entry) => this.fantaManOf(entry.player!, entry.cost));
  });

  /** MY PITCH, drawn once: +Rosa and the «+Giro» column measure every man against this same drawing. */
  private readonly myPitch = computed<DraftPitch | null>(() => {
    const squad = this.mySquadMen();
    if (!squad) return null;
    return draftPitchOf(squad, this.rules(), recommendedModules(this.feed.isMantra()), this.pitchModule(), true);
  });

  readonly rosaYields = computed<Map<number, { cover: number; fertility: number | null }>>(() => {
    const out = new Map<number, { cover: number; fertility: number | null }>();
    const drawn = this.myPitch();
    if (!drawn) return out;
    const door = this.doorHole();
    for (const row of this.ranked()) out.set(row.player.id, addedYield(drawn, this.fantaManOf(row.player, row.price), door));
    return out;
  });

  /**
   * «+GIRO» (operator, 06/10/2026, four picks the same day): his +Rosa fertility plus the +Rosa of the best men
   * predicted to STILL BE THERE at our next THREE turns once he is taken - the scenarios' chain total as a
   * column (`draft-turn.ts`, where the formula, the horizon and the declared approximations are written). ONE
   * rival walk over three future rounds (`rivalPicksHorizon`), and the chain's own prices decide how many of
   * its calls precede each of our turns, by the platform's order rule; every later pick obeys the same legality
   * as every simulated one (`legalFor` + `keeperAllowed`, our exclusions out) on my squad WITH the chain so
   * far. Empty while I follow no squad, like +Rosa.
   */
  readonly turnBy = computed<Map<number, TurnScore>>(() => {
    const input = this.planInput();
    const pitch = this.myPitch();
    const squad = this.mySquadMen();
    const rosa = this.rosaYields();
    if (!input || !pitch || !squad || !rosa.size) return new Map();
    const me = input.teams.find((team) => team.id === input.mineId);
    if (!me) return new Map();
    const rounds = this.priorityRounds();
    const calls: CallRules = { cap: input.cap ?? null, keeperCap: input.keeperCap, rounds };
    const readings = this.rarityReadings();
    const poolById = new Map(input.pool.map((player) => [player.id, player]));
    const players = new Map(this.listone().map(({ player }) => [player.id, player]));
    const men: TurnMan[] = [];
    for (const row of this.ranked()) {
      const now = rosa.get(row.player.id);
      if (!now) continue;
      men.push({ id: row.player.id, price: row.price, group: readings.get(row.player.id)?.group ?? '',
        fert: now.fertility, cover: now.cover });
    }
    const horizon = rivalPicksHorizon({
      teams: input.teams, order: input.order, pool: input.pool, places: startingPlaces(input.shapes),
      mineId: input.mineId, keeperCap: input.keeperCap, maxAheadPicks: input.maxAheadPicks,
      orderType: input.orderType, heads: input.heads, cap: input.cap, rounds,
    }, TURN_PICKS - 1);
    const keepers = this.keeperShirts();
    const excluded = this.excluded();
    const rules = this.rules();
    const preferred = recommendedModules(this.feed.isMantra());
    // My squad WITH the chain so far, memoised by its ids: `take` is the one definition of a pick.
    const chained = new Map<string, PlanTeam | null>();
    const teamWith = (taken: readonly TurnMan[]): PlanTeam | null => {
      const key = taken.map((man) => man.id).join(',');
      if (!chained.has(key)) {
        const picks = taken.map((man) => poolById.get(man.id));
        chained.set(key, picks.every((pick): pick is PlanPlayer => !!pick)
          ? picks.reduce((team, pick) => take(team, pick), me) : null);
      }
      return chained.get(key)!;
    };
    // A MAN LIKELY GONE BEFORE OUR NEXT CALL IS NO LATER PICK - the plans' own rule (`ScenarioInput.likelyGone`,
    // operator 05/10/2026) and the correction his first screen asked for (06/10/2026: «scegliere Conceicao non
    // può essere meglio di Paz o Pulisic», «Martinez e Svilar non possono essere meglio di Paz»): the
    // deterministic walk keeps a dear man alive whenever the rivals' heads point elsewhere, and every cheap
    // first pick then banked him as its own second term - «poi prendo Paz», nine calls later, against odds the
    // human model (fitted on real drafts) reads as gone. Taking him NOW stays allowed: that is «take who will
    // be gone», the measured survivor logic, and it is exactly what puts the dear man's own score on top.
    const gone = this.likelyGone();
    const lost = gone?.ids;
    const legal = (taken: readonly TurnMan[], candidate: TurnMan): boolean => {
      const team = teamWith(taken);
      const player = poolById.get(candidate.id);
      if (!team || !player || excluded.has(candidate.id)) return false;
      if (!legalFor(team, [player], calls).length) return false;
      return keeperAllowed(team, player, { keepers, calls }, rounds - team.picksCount);
    };
    const canPick = (taken: readonly TurnMan[], candidate: TurnMan): boolean =>
      !lost?.has(candidate.id) && legal(taken, candidate);
    // THE PICK BEING SCORED IS A PICK TOO (review 06/10/2026): the cap, the exclusions and the doors bind it as they
    // bind the later ones, and a man likely gone before the call about to be made (`beforeNow`, another squad on the
    // clock) cannot be ours either - the plans' own rule. On the clock he stays scorable: «take who will be gone».
    const canPickFirst = (candidate: TurnMan): boolean =>
      !(gone?.beforeNow && lost?.has(candidate.id)) && legal([], candidate);
    const exactOn = (taken: readonly TurnMan[], candidates: readonly TurnMan[]): Map<number, number | null> => {
      const out = new Map<number, number | null>();
      const held = taken.map((man) => players.get(man.id) && this.fantaManOf(players.get(man.id)!, man.price));
      if (!held.every((man): man is FantaMan => !!man)) return out;
      // FORCED on the base pitch's module: the used-group interaction is the question being measured, and the
      // shape must not move under one candidate or the column would compare two drawings.
      const drawn = draftPitchOf([...squad, ...held], rules, preferred, pitch.module, true);
      if (!drawn) return out;
      const doors = me.slots.filter(isKeeperSlot).length
        + taken.filter((man) => isKeeperSlot(poolById.get(man.id)?.slot ?? null)).length;
      const door = doorHolePrice(input.keeperCap - doors, rounds - me.picksCount - taken.length);
      for (const candidate of candidates) {
        const row = players.get(candidate.id);
        if (row) out.set(candidate.id, addedYield(drawn, this.fantaManOf(row, candidate.price), door).fertility);
      }
      return out;
    };
    return turnScores({
      men, steps: horizon.steps, myTurns: horizon.myTurns,
      orderType: input.orderType === 'pingpong' ? 'pingpong' : 'default',
      myValue: me.rosterValue,
      settle: { picksBefore: me.picksCount, nowAt: horizon.nowAt, rivals: horizon.rivals },
      picksLeft: rounds - me.picksCount,
      canPick, canPickFirst, exactOn,
    });
  });

  /** RAR of every free man (the whole free pool), by id: what the list's column shows. */
  readonly freeRarity = computed<Map<number, Rarity>>(() => rarity([...this.rarityReadings().values()]));

  /**
   * THE PARTS OF OUR DRAFT PRIORITY, man by man (`draft-priority.priorityParts`): SeSw, RAR, k, the rationing and
   * the score, on OUR squad as it stands. Empty outside a mantra draft.
   */
  readonly priorityPartsOfFree = computed<Map<number, PriorityParts>>(() => {
    const input = this.planInput();
    const engine = this.priorityEngine();
    if (!input || !engine || !this.priorityOn()) return new Map();
    const mine = input.teams.find((team) => team.id === input.mineId);
    return mine ? priorityParts(engine.stateOf(mine, input.pool, input.teams)) : new Map();
  });

  /**
   * LA DRAFT PRIORITY DI OGNI UOMO del listone, libero o gia' in una rosa: e' un fatto sull'UOMO e non sulla
   * rosa (`manValue`), quindi il campetto la mostra anche per chi e' gia' stato preso (sua richiesta,
   * 29/09/2026). Vuota fuori dal draft mantra.
   */
  readonly priorityOfMan = computed<Map<number, number>>(() => {
    const out = new Map<number, number>();
    const worth = this.priorityWorth();
    const matchdays = this.matchdaysTarget();
    if (!worth || !matchdays) return out;
    for (const [id, man] of this.priorityMen()) {
      const value = manValue(man, worth, matchdays);
      if (value != null) out.set(id, value);
    }
    return out;
  });

  /**
   * LA PRIORITA' di ogni libero: il punteggio con cui `pickForUs` sceglie la NOSTRA scelta, uomo per uomo
   * (`pickScore`, una definizione e due lettori - il consiglio e la colonna accanto al nome).
   *
   * VALORE x quanto copre di cio' che alla rosa manca x lo sconto di chi sara' ancora li' al prossimo
   * turno: le tre leve misurate sul banco del draft (§16, §18). `null` per chi non ha un valore. Chi il
   * tetto dei primi turni tiene fuori dalla nostra lavagna adesso NON e' `null` - un congelato non e' «poco
   * prioritario», non si puo' chiamare - e il punteggio resta, perche' fra pochi turni si sblocca: chi
   * legge la lista lo dice con `lockedForMe`, che e' la stessa guardia del consiglio.
   *
   * In a mantra draft (`priorityOn`) the column is the DRAFT PRIORITY instead - the operator's formula, per
   * matchday, on OUR squad as it stands (`draft-priority.priorities`): the same number the advice picks on.
   */
  readonly priorities = computed<Map<number, number | null>>(() => {
    const input = this.planInput();
    const out = new Map<number, number | null>();
    if (!input) return out;
    if (this.priorityOn()) {
      const engine = this.priorityEngine();
      const mine = input.teams.find((team) => team.id === input.mineId);
      if (!engine || !mine) return out;
      const scores = draftPriorityScores(engine.stateOf(mine, input.pool, input.teams));
      for (const player of input.pool) out.set(player.id, scores.get(player.id) ?? null);
      return out;
    }
    const mine = input.teams.find((team) => team.id === input.mineId);
    const need = coverNeedOf(mine?.held ?? [], input.shapes, input.game);
    const gone = mine
      ? goneBeforeOurNextTurn({
          teams: input.teams, order: input.order, pool: input.pool,
          places: startingPlaces(input.shapes), mineId: input.mineId,
          keeperCap: input.keeperCap, maxAheadPicks: input.maxAheadPicks, orderType: input.orderType,
          heads: input.heads, cap: input.cap, rounds: this.priorityRounds(),
        })
      : null;
    for (const player of input.pool) {
      const score = pickScore(player, need, mine, gone);
      out.set(player.id, Number.isFinite(score) ? score : null);
    }
    return out;
  });

  /**
   * CHI SPARIRA' PRIMA DEL NOSTRO PROSSIMO TURNO, e chi dovrebbe prenderlo (sua richiesta, 29/09/2026): id del
   * calciatore -> squadra (`takenBeforeOurTurn`), con la stessa previsione dei rivali del consiglio e del giro.
   */
  readonly takenBeforeUs = computed<Map<number, number>>(() => {
    const input = this.planInput();
    if (!input) return new Map();
    return takenBeforeOurTurn({
      teams: input.teams, order: input.order, pool: input.pool, places: startingPlaces(input.shapes),
      mineId: input.mineId, keeperCap: input.keeperCap, maxAheadPicks: input.maxAheadPicks, orderType: input.orderType,
      // A full roster calls no more (30/09/2026, the classic replay): without it the last round predicted the
      // squads at the end of a snake a second pick they do not have.
      heads: input.heads, cap: input.cap, rounds: this.priorityRounds(),
    });
  });

  /**
   * THE ODDS THAT A FREE MAN IS GONE BEFORE OUR NEXT TURN, as PEOPLE pick (operator, 03/10/2026, `rival-odds.ts`): id ->
   * the share of the sampled walks in which he is taken. Draft only. BESIDE `takenBeforeUs` and not instead of it: that
   * is the walk the plans and the survivor discount were measured on.
   */
  readonly goneOdds = computed<Map<number, number>>(() => {
    const input = this.planInput();
    if (!input || !this.feed.isDraft()) return new Map();
    const seen = new Map<number, SeenMan>();
    for (const { player } of this.listone()) {
      const line = player.zoneClassic;
      if (line !== 'gk' && line !== 'def' && line !== 'mid' && line !== 'atk') continue;
      seen.set(player.id, { line, club: player.club, fm: player.seen?.fm ?? null, mv: player.seen?.mv ?? null,
        played: player.seen?.played ?? 0 });
    }
    const picks = input.teams.reduce((sum, team) => sum + team.picksCount, 0);
    return goneOdds({
      teams: input.teams, pool: input.pool, mineId: input.mineId, keeperCap: input.keeperCap,
      maxAheadPicks: input.maxAheadPicks, orderType: input.orderType, cap: input.cap, rounds: this.priorityRounds(), seen,
      seed: picks + 1,
    });
  });

  /**
   * GLI SCENARI (sua richiesta, 29/09/2026, `core/draft-scenarios.ts`): quello che manca alla rosa sul modulo che
   * schiera insieme i nostri migliori, e tre catene «A --scelte--> A2». Solo nel draft mantra, dove la Draft
   * Priority c'e'.
   */
  private readonly scenarioInput = computed<ScenarioInput | null>(() => {
    if (!this.priorityOn()) return null;
    const input = this.planInput();
    const worth = this.priorityWorth();
    const matchdays = this.matchdaysTarget();
    if (!input || !worth || !matchdays) return null;
    const men = this.priorityMen();
    const numbers = this.numbers();
    return {
      teams: input.teams, order: input.order, pool: input.pool, places: startingPlaces(input.shapes),
      mineId: input.mineId, keeperCap: input.keeperCap, maxAheadPicks: input.maxAheadPicks, orderType: input.orderType,
      heads: input.heads, cap: input.cap,
      rules: worth.rules, worth, matchdays,
      calls: { cap: input.cap ?? null, keeperCap: input.keeperCap, rounds: this.priorityRounds() },
      manOf: (id) => men.get(id) ?? null,
      pitch: this.squadPitch(worth, matchdays, (id) => men.get(id) ?? null),
      // OUR next pick's survivors (`takenBeforeUs`): a rival's scenarios (`scenariosFor`) drop it, the walk is ours.
      gone: this.takenBeforeUs(),
      keepers: this.keeperShirts(),
      excluded: this.excluded(),
      likelyGone: this.likelyGone(),
      // Every department wants its top (`draft-scenarios.TOP_LEFT_MIN`): the SHEET's category, never re-derived.
      isTop: (id) => TOP_CATEGORIES.has(numbers.get(id)?.category ?? ''),
    };
  });

  /**
   * The men the advice must not plan on (`ScenarioInput.likelyGone`): their odds of going before our next call
   * reach `ADVICE_GONE_ODDS`, and whether that call is the one about to be made or the one after depends on the clock.
   */
  private readonly likelyGone = computed<ScenarioInput['likelyGone']>(() => {
    const input = this.planInput();
    if (!input) return undefined;
    const ids = new Set([...this.goneOdds()].filter(([, odds]) => odds > ADVICE_GONE_ODDS).map(([id]) => id));
    if (!ids.size) return undefined;
    const teams = new Map(input.teams.map((team) => [team.id, team]));
    const onClock = nextCaller(teams, input.maxAheadPicks, Infinity, input.orderType)?.id === input.mineId;
    return { ids, beforeNow: !onClock };
  });

  /**
   * THE DRAFT PITCH AS THE SCENARIOS READ IT (operator, 01/10/2026: «procedi con le correzioni: c, a, b»), so a plan
   * is ranked on what the pitch and +Rosa show and fixes the places the pitch paints:
   *   worth     the squad's FERTILITY with its reserves (`pitchYield`), coverage on a tie - +Rosa's own order;
   *   diagnose  on the pitch's eleven: an EMPTY place, a holder under an average starter (Draft Priority below
   *             zero, as before), then a place covered under `COVER_OK`, the most uncovered first;
   *   placeOf   where `withSuggestions` would put him - starting where he is the better starter, else as a reserve.
   * The same `draftPitchOf` call as +Rosa (`rosaYields`): the module the operator forced, or the best one.
   */
  private squadPitch(worth: WorthContext, matchdays: number, manOf: (id: number) => PriorityMan | null): SquadPitch {
    const players = new Map(this.listone().map(({ player }) => [player.id, player]));
    const rules = this.rules();
    const preferred = recommendedModules(this.feed.isMantra());
    const module = this.pitchModule();
    const fanta = new Map<number, FantaMan>();
    const fantaOf = (id: number): FantaMan | null => {
      if (!fanta.has(id)) {
        const player = players.get(id);
        if (!player) return null;
        fanta.set(id, this.fantaManOf(player, player.fvm));
      }
      return fanta.get(id)!;
    };
    const pitchOf = (roster: readonly PriorityMan[]): DraftPitch | null => rules
      ? draftPitchOf(roster.map((man) => fantaOf(man.id)).filter((m): m is FantaMan => !!m), rules, preferred, module, true)
      : null;
    const placeOfDrawn = (place: DraftPlace): Place => ({ line: place.line, slot: place.slot, roles: place.roles });
    return {
      worth: (roster, doorHole) => {
        const pitch = pitchOf(roster);
        if (!pitch) return 0;
        const { cover, fertility } = pitchYield(pitch, false, doorHole);
        return fertility + cover * 1e-3;
      },
      diagnose: (roster) => {
        const pitch = pitchOf(roster);
        if (!pitch) return null;
        const needs: PlaceNeed[] = [];
        for (const place of pitch.rows.flatMap((row) => row.places)) {
          const holder = place.man ? manOf(place.man.id) : null;
          if (!place.man) {
            needs.push({ kind: 'vuoto', place: placeOfDrawn(place), holder: null, gap: 0 });
            continue;
          }
          const value = holder ? manValue(holder, worth, matchdays) : null;
          if (value != null && value < 0) {
            needs.push({ kind: 'debole', place: placeOfDrawn(place), holder, gap: -value });
            continue;
          }
          const { cover } = placeYield(place);
          if (cover < COVER_OK) needs.push({ kind: 'scoperto', place: placeOfDrawn(place), holder, gap: COVER_OK - cover });
        }
        const urgency: Record<PlaceNeed['kind'], number> = { vuoto: 0, debole: 1, scoperto: 2, 'senza riserva': 3 };
        needs.sort((a, b) => urgency[a.kind] - urgency[b.kind] || b.gap - a.gap);
        return { module: pitch.module, needs };
      },
      placeOf: (roster, man) => {
        const pitch = pitchOf(roster);
        const one = fantaOf(man.id);
        if (!pitch || !one) return null;
        withSuggestions(pitch, [one]);
        const place = pitch.rows.flatMap((row) => row.places)
          .find((p) => p.suggested?.id === man.id || p.suggestedReserve?.id === man.id);
        return place ? placeOfDrawn(place) : null;
      },
    };
  }

  readonly scenarios = computed(() => {
    const input = this.scenarioInput();
    return input ? draftScenarios(input) : { diagnosis: null, list: [] };
  });

  /**
   * THE THREE SCENARIOS AS IF ANOTHER SQUAD WERE OURS (operator, 01/10/2026, for AUTO: «le scelte degli altri
   * vengano fatte calcolando i consigli anche per le altre squadre e scegliendo uno dei tre consigli a caso»).
   * The same chains, the same rules and the same rival walk, with `mineId` moved onto that squad. Not cached: it
   * is asked once per pick on the invented table.
   */
  scenariosFor(teamId: number): Scenario[] {
    const input = this.scenarioInput();
    if (!input) return [];
    // THEIR OWN survivors (01/10/2026): the walk from that squad's turn, so a rival played by the advice also waits
    // for who will still be there - without it the invented table rushed the keepers in round one.
    const gone = takenBeforeOurTurn({ ...input, mineId: teamId, rounds: input.calls.rounds });
    // The exclusions are OURS: a squad played by the advice on the invented table may take anybody.
    return draftScenarios({ ...input, mineId: teamId, gone, excluded: undefined, likelyGone: undefined }).list;
  }

  /**
   * WHERE THE SQUAD ON THE CLOCK LANDS IF IT TAKES THIS MAN (operator, 29/09/2026: «quando passo il mouse su un
   * calciatore ... mostra con una freccetta nella lista dell'ordine dove andrà a finire la squadra»): the order
   * recomputed right after that pick, by the platform's rule - which is what the host does after every pick.
   * `at` is its 0-based place in that order.
   */
  landingOf(playerId: number): { teamId: number; at: number } | null {
    const input = this.planInput();
    if (!input) return null;
    const teams = new Map(input.teams.map((team) => [team.id, team]));
    const clock = nextCaller(teams, input.maxAheadPicks, Infinity, input.orderType);
    const player = input.pool.find((one) => one.id === playerId);
    if (!clock || !player) return null;
    teams.set(clock.id, take(clock, player));
    const order = [...teams.values()].sort((a, b) => ahead(a, b, input.maxAheadPicks, input.orderType)).map((team) => team.id);
    return { teamId: clock.id, at: order.indexOf(clock.id) };
  }

  /**
   * WHO THIS SQUAD MAY CALL NOW, by the league's rules (the ceiling of the first turns, the doors, the line quotas:
   * `draft-priority.legalFor`), from the free pool with each man's FVM as `price`. For the simulated rivals that do
   * not follow the advice (`?rivals=human`, 02/10/2026).
   */
  legalChoicesFor(teamId: number): PlanPlayer[] {
    const input = this.planInput();
    const team = input?.teams.find((one) => one.id === teamId);
    if (!input || !team) return [];
    return legalFor(team, input.pool, { cap: input.cap ?? null, keeperCap: input.keeperCap, rounds: this.priorityRounds() });
  }

  /** The slots a squad holds, as the plan reads them (debug: the simulated «reparti» head, `?rivals=people`). */
  heldSlotsOf(teamId: number): string[] {
    return [...(this.planInput()?.teams.find((one) => one.id === teamId)?.slots ?? [])];
  }

  /** The chain from a man the operator names (his double click), judged against what the squad needs. */
  judgeScenario(playerId: number): ReturnType<typeof judge> | null {
    const input = this.scenarioInput();
    const player = input?.pool.find((one) => one.id === playerId);
    return input && player ? judge(input, player) : null;
  }

  /** Il giro che si sta giocando, seat per seat, e l'ordine che ne esce (`simulateRound`). */
  readonly round = computed<{ picks: RoundPick[]; nextOrder: number[] } | null>(() => {
    const input = this.choosingInput();
    return input ? simulateRound(input) : null;
  });

  /**
   * OUR PROJECTED PICKS, until the squad has a starter and a reserve for each of the eleven places - twice
   * eleven men - or its roster is full (`projectOurPicks`). What the Draft Assistant's pitch suggests.
   */
  readonly projection = computed<PlanPlayer[]>(() => {
    const input = this.choosingInput();
    const me = this.feed.followed();
    if (!input || !me) return [];
    const wanted = Math.min(me.missingTotal, Math.max(0, SUGGESTED_SQUAD - me.squad.length));
    return projectOurPicks(input, wanted);
  });

  /** The three divergent starting points (§17.3), each with the reason it is offered. */
  readonly roots = computed<PlanRoot[]>(() => {
    const input = this.planInput();
    if (!input) return [];

    // What each rival's squad will be worth once this round is over: his spend plus what the policy
    // expects him to take. It is what «keeping our place» has to be measured against - their current
    // values would flatter every big spend of ours, since everybody is about to add a name.
    const places = startingPlaces(input.shapes);
    let pool = input.pool;
    const rivalValues: number[] = [];
    for (const team of input.teams) {
      if (team.id === input.mineId) continue;
      const choice = predictRivalPick(
        team,
        pool,
        places,
        input.keeperCap,
        Infinity,
        input.heads?.get(team.id),
        input.cap,
      );
      if (choice) pool = pool.filter((player) => player.id !== choice.id);
      rivalValues.push(team.rosterValue + (choice?.price ?? 0));
    }
    const mine = input.teams.find((team) => team.id === input.mineId);

    return planRoots(input.pool, {
      mySpend: mine?.rosterValue ?? 0,
      rivalValues,
      // The first half of the order: past it «keeping our place» would be a claim nobody can read.
      keepWithin: Math.ceil((rivalValues.length + 1) / 2),
      // All three directions are rationed the way our own pick is, or the strips would offer a fourth
      // centre-back as «un altro reparto» while the plan below refuses to take him.
      need: coverNeedOf(mine?.held ?? [], input.shapes, input.game),
      mine,
      // Who will be gone before our next turn: the biggest lever on the bench (+4.54%, strict on 5/5), and
      // it needs no informational edge - only the platform's order rule and the rivals' public squads.
      gone: mine
        ? goneBeforeOurNextTurn({
            teams: input.teams,
            order: input.order,
            pool: input.pool,
            places: startingPlaces(input.shapes),
            mineId: input.mineId,
            keeperCap: input.keeperCap,
            maxAheadPicks: input.maxAheadPicks, orderType: input.orderType,
            heads: input.heads,
            cap: input.cap,
            rounds: this.priorityRounds(),
          })
        : null,
      cap: input.cap,
    });
  });

  /**
   * One plan per root, so switching option costs nothing and the two views stay in step.
   *
   * A root the operator picked by hand - clicking any name in either view - is appended as one more
   * option instead of replacing the three: «and if I took HIM» is a question about the same table, and
   * the three declared directions have to stay visible beside the answer.
   */
  readonly plans = computed<{ root: PlanRoot; plan: Plan }[]>(() => {
    const input = this.planInput();
    if (!input) return [];
    const roots = this.roots();
    const options = roots.map((root) => ({
      root,
      plan: plan({ ...input, rootId: root.player.id }),
    }));

    const chosen = this.chosenRoot();
    if (chosen !== null && !roots.some((root) => root.player.id === chosen)) {
      const player = input.pool.find((candidate) => candidate.id === chosen);
      // A man the ceiling forbids us THIS turn is not a what-if: `plan()` would refuse the root and draw
      // its own pick under the label «se prendi lui», which is a lie about whom the chain starts from.
      const me = input.teams.find((team) => team.id === input.mineId);
      if (player && !capBlocks(me?.picksCount ?? 0, player.price, input.cap)) {
        options.push({
          root: { player, why: 'se prendi lui' },
          plan: plan({ ...input, rootId: chosen }),
        });
      }
    }
    return options;
  });

  readonly planned = computed<Plan | null>(() => {
    const plans = this.plans();
    if (!plans.length) return null;
    const chosen = this.chosenRoot();
    return (plans.find((entry) => entry.root.player.id === chosen) ?? plans[0]).plan;
  });

  private async ensure(ids: number[], game: 'classic' | 'mantra', teams: number): Promise<void> {
    const key = `${game}/${teams}/${ids.length}`;
    if (this.loading === key) return;
    this.loading = key;
    try {
      const manifest = await this.bundle.manifest();
      const all = manifest.engine_sheets ?? [];
      const sheets = all.filter((sheet) => sheet.game === game);
      if (!sheets.length) {
        this.entry.set(null);
        this.numbers.set(new Map());
        this.coverage.set(null);
        this.problem.set(
          all.length
            ? `Il bundle porta i numeri del motore solo per ${all.map((sheet) => sheet.game).join(', ')}, ` +
                `e questa asta è ${game}: il SURPLUS non è confrontabile fra i due giochi, quindi il ` +
                `pannello non lo mostra. Lancia "snapshot --league NOME" con il game giusto, poi "export".`
            : `Il bundle non porta i numeri del motore: senza di essi il pannello non può ordinare per ` +
                `SURPLUS. Lancia "snapshot --league NOME" e poi "export".`,
        );
        return;
      }

      const wanted = new Set(ids);
      let chosen = sheets[0];
      let best: Map<number, EngineNumbers> = new Map();
      let matched = -1;
      for (const sheet of sheets) {
        const numbers = await this.read(sheet);
        const hits = [...wanted].filter((id) => numbers.has(id)).length;
        if (hits > matched) {
          matched = hits;
          best = numbers;
          chosen = sheet;
        }
      }

      // BEFORE the numbers: the Draft Priority reads it (`sub-bonus.ts`), and set afterwards the list would draw
      // once without it and reorder a moment later, under the pointer.
      this.prevStarts.set(await this.startRecord(manifest.input_season));
      this.entry.set(chosen);
      this.numbers.set(best);
      this.coverage.set({ matched, total: wanted.size });
      // BOTH rulebooks matter now: the panel's own rationing was measured per GAME, so on classic it
      // needs the classic places rather than nothing at all (measured: no rationing costs 4.93%).
      this.shapes.set(
        game === 'mantra' ? await this.bundle.modules() : await this.bundle.classicModules(),
      );
      this.measured.set(await this.lastSeason(chosen, manifest.input_season));
      // Read from the CHOSEN sheet and no other: the window is measured per sheet, so taking it from
      // one and the valuation from another would put two different populations on one row.
      const measured = await this.readMeasuredWindows(chosen);
      this.trends.set(measured.trends);
      this.places.set(measured.places);
      this.rotations.set(measured.rotations);
      // The boards of THIS sheet, by the path the manifest itself declares - never a guessed file name.
      this.boards.set(chosen.boards ? await this.bundle.boards(chosen.boards) : null);
      this.crests.set((await this.bundle.crests().catch(() => null)) ?? {});
      this.clubIds.set(await this.clubIndex());
      this.window.set(await this.playedWindow(manifest.target_season));
      const notes: string[] = [];
      if (chosen.teams !== teams) {
        notes.push(
          `il foglio è della lega "${chosen.league}" (${chosen.teams} squadre) e al tavolo ne siedono ` +
            `${teams}: il livello di rimpiazzo è quello di un'altra lega`,
        );
      }
      if (matched < wanted.size) {
        notes.push(
          `${wanted.size - matched} giocatori su ${wanted.size} non sono nel foglio: per loro non c'è ` +
            `nessun numero, e la riga lo dice invece di valere zero`,
        );
      }
      this.problem.set(notes.length ? notes.join(' · ') : null);
    } catch (error) {
      this.problem.set(
        error instanceof Error ? error.message : 'I numeri del motore non sono leggibili.',
      );
    }
  }

  /**
   * Last season's MEASURED fantamedia, on the same platform as the sheet.
   *
   * It is shown next to the prediction so a row can be judged and not only ranked - and it is read on
   * the sheet's platform because a fantamedia is a fact about a CALENDAR: euro and default are the same
   * season seen from two different ones.
   */
  private async lastSeason(sheet: EngineSheetEntry, season: string): Promise<Map<number, number>> {
    try {
      const table = await this.bundle.table('season_stats');
      const [id, when, platform, fm] = ['fc_id', 'season', 'platform', 'fm'].map((name) =>
        table.columns.indexOf(name),
      );
      const measured = new Map<number, number>();
      for (const row of table.rows) {
        if (row[when] !== season || row[platform] !== sheet.platform) continue;
        const value = row[fm] as number | null;
        if (value != null) measured.set(Number(row[id]), value);
      }
      return measured;
    } catch {
      // An older bundle does not carry it: one column stays empty, nothing else changes.
      return new Map();
    }
  }

  /**
   * The minutes, xG and xA each man has actually played THIS season, from the per-match layer.
   *
   * Only `sofascore` rows, i.e. the five leagues' own calendars: `sofascore_extra` carries friendlies,
   * cups and continental ties, and the screens were calibrated walking the league rounds - a friendly
   * goal must never enter a number a threshold was fitted on (the same rule that keeps the two sources
   * apart everywhere else in this project).
   *
   * Empty before the season starts, and that is the answer rather than a failure: at a pre-season auction
   * nobody has minutes, so no screen is drawn at all.
   */
  /**
   * LEAGUE APPEARANCES AND STARTS of one season, per player (05/10/2026, `sub-bonus.ts`): the role the engine's
   * fantamedia was earned in. Only `sofascore` rows (the five leagues' calendars), one per match, a man with
   * minutes; empty on an older bundle, and then no fantamedia moves.
   */
  private async startRecord(season: string): Promise<Map<number, StartRecord>> {
    try {
      const table = await this.bundle.table('external_match_stats');
      const [id, when, source, match, started, minutes] = ['fc_id', 'season', 'source', 'match_id', 'started', 'minutes']
        .map((name) => table.columns.indexOf(name));
      if (id < 0 || when < 0 || match < 0 || started < 0 || minutes < 0) return new Map();
      const seen = new Map<number, Map<unknown, boolean>>();
      for (const row of table.rows) {
        if (row[when] !== season || (source >= 0 && row[source] !== 'sofascore') || !(Number(row[minutes]) > 0)) continue;
        const key = Number(row[id]);
        if (!seen.has(key)) seen.set(key, new Map());
        seen.get(key)!.set(row[match], !!row[started]);
      }
      const out = new Map<number, StartRecord>();
      for (const [key, matches] of seen) {
        out.set(key, { apps: matches.size, starts: [...matches.values()].filter(Boolean).length });
      }
      return out;
    } catch {
      return new Map();
    }
  }

  private async playedWindow(
    season: string,
  ): Promise<Map<number, { minutes: number; xg: number; xa: number }>> {
    try {
      const table = await this.bundle.table('external_match_stats');
      const [id, when, source, minutes, xg, xa] = [
        'fc_id',
        'season',
        'source',
        'minutes',
        'xg',
        'xa',
      ].map((name) => table.columns.indexOf(name));
      if (id < 0 || when < 0 || minutes < 0) return new Map();
      const rows = new Map<number, { minutes: number; xg: number; xa: number }[]>();
      for (const row of table.rows) {
        if (row[when] !== season) continue;
        if (source >= 0 && row[source] !== 'sofascore') continue;
        const key = Number(row[id]);
        const one = {
          minutes: row[minutes] as number | null,
          xg: xg < 0 ? null : (row[xg] as number | null),
          xa: xa < 0 ? null : (row[xa] as number | null),
        };
        const list = rows.get(key);
        if (list) list.push(one as never);
        else rows.set(key, [one as never]);
      }
      const out = new Map<number, { minutes: number; xg: number; xa: number }>();
      for (const [key, list] of rows) out.set(key, windowOf(list));
      return out;
    } catch {
      // An older bundle without the per-match layer: no screens, and `screenMarks` returns empty.
      return new Map();
    }
  }

  /**
   * The trend window per player, straight from the sheet's own record.
   *
   * The AGGREGATES are recomputed here from the matches rather than read from their columns, and that is
   * deliberate: the picture and the number beside it then come from one array, so they cannot describe
   * two different windows. The rule they follow is the toolkit's own and is stated where it is applied -
   * a match he did not play counts ZERO because availability is half of what a fantamedia is worth, a
   * match nobody could score is left out of the denominator rather than counted as a bad one.
   */
  private async readMeasuredWindows(sheet: EngineSheetEntry): Promise<{
    trends: Map<number, PlayerTrend>;
    places: Map<number, PlaceChange>;
    rotations: Map<number, RotationWatch>;
  }> {
    try {
      const table = await this.bundle.table(sheet.path.replace(/\.json(\.gz)?$/, ''));
      const at = (name: string) => table.columns.indexOf(name);
      const id = at('fc_id');
      const detail = at('desc_trend_detail');
      const place = {
        change: at('desc_place_change'),
        on: at('desc_place_on'),
        md: at('desc_place_md'),
        minutes: at('desc_place_minutes'),
        cause: at('desc_place_cause'),
        who: at('desc_place_who'),
      };
      const rotation = {
        watch: at('desc_rotation_watch'),
        minutes: at('desc_rotation_minutes'),
        starts: at('desc_rotation_starts'),
        window: at('desc_rotation_window'),
        from: at('desc_rotation_from'),
        to: at('desc_rotation_to'),
      };
      const rotations = new Map<number, RotationWatch>();
      if (id >= 0 && rotation.watch >= 0) {
        for (const row of table.rows) {
          if (!row[rotation.watch]) continue;
          rotations.set(Number(row[id]), {
            minutes: (row[rotation.minutes] as number) ?? null,
            starts: (row[rotation.starts] as number) ?? null,
            window: rotation.window < 0 ? null : ((row[rotation.window] as number) ?? null),
            // `watch` from the fourth round, `early` from the second: the older bundles that carried
            // a plain «yes» read as the strong one, which is what that column meant.
            strength: row[rotation.watch] === 'early' ? 'early' : 'watch',
            from: (row[rotation.from] as string) ?? null,
            to: (row[rotation.to] as string) ?? null,
          });
        }
      }
      const places = new Map<number, PlaceChange>();
      if (id >= 0 && place.change >= 0) {
        for (const row of table.rows) {
          const change = row[place.change] as PlaceChange['change'] | null;
          if (!change) continue;
          places.set(Number(row[id]), {
            change,
            on: (row[place.on] as string) ?? '',
            matchday: (row[place.md] as number) ?? null,
            minutes: (row[place.minutes] as string) ?? null,
            cause: (row[place.cause] as PlaceChange['cause']) ?? null,
            who: (row[place.who] as string) ?? null,
          });
        }
      }
      // a bundle older than the column: no strip and no claim, and the places above may still be there
      if (id < 0 || detail < 0) return { trends: new Map(), places, rotations };
      const out = new Map<number, PlayerTrend>();
      for (const row of table.rows) {
        const matches = parseTrend(row[detail] as string | null);
        if (!matches.length) continue;
        const points: number[] = [];
        let played = 0;
        let bench = 0;
        let outsideEuro = 0;
        for (const match of matches) {
          if (match.state === 'b') bench += 1;
          if (isKnownAbsence(match.state)) points.push(0);
          if (match.state === 'p') {
            played += 1;
            if (match.points != null) points.push(match.points);
            if (match.inEuro === false) outsideEuro += 1;
          }
        }
        out.set(Number(row[id]), {
          matches,
          fp: points.length ? points.reduce((sum, one) => sum + one, 0) / points.length : null,
          scored: points.length,
          window: matches.length,
          played,
          bench,
          outsideEuro,
        });
      }
      return { trends: out, places, rotations };
    } catch {
      // An older bundle without the sheet columns: the strip is simply not drawn.
      return { trends: new Map(), places: new Map(), rotations: new Map() };
    }
  }

  /** Canonical club name -> `fc_club_id`, so a badge can be looked up by the only key the two sides share. */
  private async clubIndex(): Promise<Map<string, number>> {
    try {
      const table = await this.bundle.table('clubs');
      const [id, name] = ['fc_club_id', 'canonical_name'].map((column) =>
        table.columns.indexOf(column),
      );
      const out = new Map<string, number>();
      for (const row of table.rows) {
        const club = row[name] as string | null;
        if (club) out.set(club, Number(row[id]));
      }
      return out;
    } catch {
      // An older bundle without the table: every club falls back to its monogram, which still reads.
      return new Map();
    }
  }

  private async read(sheet: EngineSheetEntry): Promise<Map<number, EngineNumbers>> {
    // One reader for every page that stands on these columns (`engine-sheet.ts`): two would give one
    // man two valuations, and the first place anybody notices is at a table.
    const table = await this.bundle.table(sheet.path.replace(/\.json(\.gz)?$/, ''));
    // ...e la base su cui quel lettore li ha riportati, presa dallo stesso foglio e nello stesso
    // punto: un numero riportato e un denominatore che non lo e' sono due basi sotto un nome solo.
    this.sheetSeasonRounds.set(seasonRoundsOf(table.matchdays, sheet.matchdays_target));
    return engineNumbersFrom(table);
  }
}
