import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { AuctionFeed, AuctionPlayer, Zone, portaStandIns } from './auction-feed';
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
  score99,
  surplusOf,
  valuationOf,
  valueOf,
} from './auction-value';
import {
  Plan,
  PlanPlayer,
  PlanRoot,
  PlanTeam,
  RivalHead,
  classifyRivals,
  coverNeedOf,
  goneBeforeOurNextTurn,
  plan,
  planRoots,
  predictRivalPick,
  startingPlaces,
} from './auction-plan';
import { Board, BoardsFile, Bundle, EngineSheetEntry } from './bundle';
import {
  PlaceChange,
  RotationWatch,
  StarterSigns,
  placeMark,
  rotationMark,
  starterSignsMark,
} from './player-place';
import { MACRO_ROLE, ScreenInput, screenMark, screensFor, windowOf } from './player-screens';
import { PlayerMark, PlayerStatus } from './player-status';
import { PlayerTrend, isKnownAbsence, parseTrend, trendScores } from './player-trend';

/** Where the priced window lives between sessions: it is a setting, not a derived value. */
const HORIZON_KEY = 'fantassistant.auction.horizon';

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
}

@Injectable({ providedIn: 'root' })
export class AuctionAdvice {
  private readonly feed = inject(AuctionFeed);
  private readonly bundle = inject(Bundle);
  private readonly status = inject(PlayerStatus);

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
  /** ...and its mirror: given as a reserve, playing like a starter. */
  private readonly risers = signal<Map<number, StarterSigns>>(new Map());

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
  private readonly window = signal<Map<number, { minutes: number; xg: number; xa: number }>>(new Map());

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
    // The mirror cannot collide with them: a man cannot be in the reserve band and the starter band
    // at once, and the two screens read opposite windows.
    for (const [id, signs] of this.risers()) {
      const mark = starterSignsMark(signs);
      if (mark) out.set(id, mark);
    }
    return out;
  });

  /** The rounds of the platform's own calendar, from the sheet: `engine_pv_pred` is expressed on it. */
  readonly matchdaysTarget = computed(() => this.entry()?.matchdays_target ?? null);

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
    rows.sort((a, b) => (b.value ?? -1e9) - (a.value ?? -1e9));
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

  /** Everything except `net`, which needs the whole list first: lambda is a property of the pool. */
  private readonly priced = computed<Omit<RankedPlayer, 'net' | 'netPer10'>[]>(() => {
    const numbers = this.numbers();
    const replacements = this.replacements();
    const mine = this.mineBySlot();
    const horizon = this.horizon();
    const total = this.matchdaysTarget();
    const spread = this.spread();
    const valueMax = this.valueMax();

    return this.feed.available().map((player) => {
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
      const personal = slot ? Math.max(replacement ?? 0, mine.get(slot) ?? 0) || replacement : replacement;
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
      };
    });
  });

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
    for (const player of this.feed.available()) {
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
      out.set(player.id, valueOf(valuationOf(numbers.get(player.id))));
    }
    return out;
  });

  /** The REAL clubs at this listone, in alphabetical order - the axis of the pitch selector. */
  readonly realClubs = computed<string[]>(() => {
    const clubs = new Set<string>();
    for (const row of this.listone()) if (row.player.club) clubs.add(row.player.club);
    return [...clubs].sort((left, right) => left.localeCompare(right, 'it'));
  });

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
        slot: numbers.get(player.id)?.slot ?? null,
        roles: player.roles,
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
    });
  });

  /** How many keepers a squad may hold, as the session states it. */
  private readonly keeperSlots = computed(() => {
    const roles = this.feed.league()['roles'] ?? {};
    const slots = Array.isArray(roles['gk']) ? roles['gk'][1] : (roles['gk'] ?? 3);
    return Number(slots) || 3;
  });

  /** The inputs a plan needs, gathered once: the roots and the plans share them. */
  private readonly planInput = computed(() => {
    const mineId = this.feed.followedTeamId();
    const teams = this.feed.teams();
    if (mineId === null || !teams.length) return null;
    const numbers = this.numbers();
    const roles = this.feed.league()['roles'] ?? {};
    const keeperSlots = Array.isArray(roles['gk']) ? roles['gk'][1] : (roles['gk'] ?? 3);
    const order = this.feed.pickOrder().map((team) => team.id);

    // THE PORTE RULE, which the tool cannot express and the plan was ignoring (§14.1, todolist item 1.6).
    // With it on, a keeper is not a man and a slot is not a man: the unit is the CLUB - taking any keeper of
    // a club takes its goal, and nobody can take a second one. So the pool must offer ONE row per free goal,
    // priced at what a bid would actually be made on (the dearest keeper of that club) and worth what you
    // would field (its best keeper). Leaving three keeper rows per club in the pool made the plan believe it
    // could buy the same goal three times, and made it spend picks on keepers that buy nothing at all.
    //
    // The SURPLUS is the right currency here even though the draft's currency is the value, and it is not an
    // exception: you field exactly one keeper, so his replacement really is the marginal keeper - the whole
    // reason the porta was measured as the place where the scarcity is real (§26.1). It picks WHICH keeper of
    // the club stands for the goal; the value still decides whether a pick is spent on a goal at all.
    const goalsMode = this.feed.isGoalsMode();
    const bySurplus = new Map(this.ranked().map((row) => [row.player.id, row.surplus]));
    const { standIn, drop } = portaStandIns(
      goalsMode ? this.feed.freePorte() : [],
      (id) => bySurplus.get(id) ?? null,
    );

    return {
      teams: teams.map((team) => ({
        id: team.id,
        label: team.label,
        slots: team.squad
          .map((entry) => (entry.player ? (numbers.get(entry.player.id)?.slot ?? '') : ''))
          .filter(Boolean),
        // The complete Mantra codes, which is what legality is decided on - the primary code alone would
        // throw away the flexibility of the 497 men of 1014 who carry two or more.
        held: team.squad
          .filter((entry) => entry.player?.roles?.length)
          .map((entry) => ({ roles: entry.player!.roles.map((role) => role.toLowerCase()) })),
        heldIds: team.squad
          .filter((entry) => entry.player?.roles?.length)
          .map((entry) => entry.player!.id),
        rosterValue: team.spent,
        pickValues: team.squad.map((entry) => entry.cost),
        picksCount: team.squad.length,
        firstRoundIndex: Math.max(0, order.indexOf(team.id)),
      })) as PlanTeam[],
      order,
      pool: this.ranked()
        // In porte mode every keeper of a club except the one standing for its goal leaves the pool: he is
        // not a thing that can be bought, and a row nobody can take is worse than no row.
        .filter((row) => !drop.has(row.player.id))
        .map((row) => {
          const porta = standIn.get(row.player.id);
          return {
            id: row.player.id,
            name: porta ? `porta ${porta.club}` : row.player.name,
            club: row.player.club,
            slot: numbers.get(row.player.id)?.slot ?? null,
            roles: row.player.roles,
            // The goal costs what its dearest keeper costs: that is the bid the table would receive.
            price: porta ? porta.price : row.price,
            net: row.net ?? row.surplus,
            surplus: row.surplus,
            value: row.value,
          };
        }) as PlanPlayer[],
      mineId,
      shapes: this.shapes(),
      // The cap is the session's own keeper slots, and in porte mode it needs no separate arithmetic: with
      // one row per goal, a squad's `por` entries ARE the goals it owns. The one case where the two differ
      // is a table that wrongly let somebody take a second keeper of a club, and the panel already reports
      // that as a mistake (`myStrayKeeperPicks`) rather than counting it.
      keeperCap: Number(keeperSlots) || 3,
      maxAheadPicks: Number(this.feed.draftRules()?.['maxAheadPicks'] ?? 1) || 1,
      heads: this.rivalHeads(),
      game: (this.feed.isMantra() ? 'mantra' : 'classic') as 'mantra' | 'classic',
      // What a man is worth to whoever holds him. The same VALUE the panel ranks by, because the question a
      // denial answers is about the football and not about the rival's opinion of it.
      worthOf: (playerId: number) => valueOf(valuationOf(numbers.get(playerId))),
    };
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
      const choice = predictRivalPick(team, pool, places, input.keeperCap, Infinity,
                                      input.heads?.get(team.id));
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
      gone: mine ? goneBeforeOurNextTurn({
        teams: input.teams, order: input.order, pool: input.pool,
        places: startingPlaces(input.shapes), mineId: input.mineId,
        keeperCap: input.keeperCap, maxAheadPicks: input.maxAheadPicks, heads: input.heads,
      }) : null,
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
      if (player) {
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

      this.entry.set(chosen);
      this.numbers.set(best);
      this.coverage.set({ matched, total: wanted.size });
      // BOTH rulebooks matter now: the panel's own rationing was measured per GAME, so on classic it
      // needs the classic places rather than nothing at all (measured: no rationing costs 4.93%).
      this.shapes.set(game === 'mantra' ? await this.bundle.modules() : await this.bundle.classicModules());
      this.measured.set(await this.lastSeason(chosen, manifest.input_season));
      // Read from the CHOSEN sheet and no other: the window is measured per sheet, so taking it from
      // one and the valuation from another would put two different populations on one row.
      const measured = await this.readMeasuredWindows(chosen);
      this.trends.set(measured.trends);
      this.places.set(measured.places);
      this.rotations.set(measured.rotations);
      this.risers.set(measured.risers);
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
  private async playedWindow(
    season: string,
  ): Promise<Map<number, { minutes: number; xg: number; xa: number }>> {
    try {
      const table = await this.bundle.table('external_match_stats');
      const [id, when, source, minutes, xg, xa] = [
        'fc_id', 'season', 'source', 'minutes', 'xg', 'xa',
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
  private async readMeasuredWindows(
    sheet: EngineSheetEntry,
  ): Promise<{
    trends: Map<number, PlayerTrend>;
    places: Map<number, PlaceChange>;
    rotations: Map<number, RotationWatch>;
    risers: Map<number, StarterSigns>;
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
      const riser = {
        watch: at('desc_riser_watch'),
        minutes: at('desc_riser_minutes'),
        starts: at('desc_riser_starts'),
        window: at('desc_riser_window'),
        keeper: at('desc_riser_keeper'),
      };
      const risers = new Map<number, StarterSigns>();
      if (id >= 0 && riser.watch >= 0) {
        for (const row of table.rows) {
          if (!row[riser.watch]) continue;
          risers.set(Number(row[id]), {
            minutes: (row[riser.minutes] as number) ?? null,
            starts: (row[riser.starts] as number) ?? null,
            window: riser.window < 0 ? null : ((row[riser.window] as number) ?? null),
            keeper: riser.keeper >= 0 && !!row[riser.keeper],
          });
        }
      }
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
      if (id < 0 || detail < 0) return { trends: new Map(), places, rotations, risers };
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
      return { trends: out, places, rotations, risers };
    } catch {
      // An older bundle without the sheet columns: the strip is simply not drawn.
      return { trends: new Map(), places: new Map(), rotations: new Map(), risers: new Map() };
    }
  }

  /** Canonical club name -> `fc_club_id`, so a badge can be looked up by the only key the two sides share. */
  private async clubIndex(): Promise<Map<string, number>> {
    try {
      const table = await this.bundle.table('clubs');
      const [id, name] = ['fc_club_id', 'canonical_name'].map((column) => table.columns.indexOf(column));
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
    {
      const table = await this.bundle.table(sheet.path.replace(/\.json(\.gz)?$/, ''));
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
  }
}
