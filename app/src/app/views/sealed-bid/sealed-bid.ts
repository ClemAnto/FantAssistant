import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzRateModule } from 'ng-zorro-antd/rate';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';
import { NzUploadModule } from 'ng-zorro-antd/upload';

import { ClassicRole } from '../../core/players-store';
import {
  Award,
  Bid,
  Candidate,
  DEFAULT_RULES,
  Reference,
  ReferenceChoice,
  STANDARD_ELEVEN,
  referenceShape,
  shapesOf,
  GainScale,
  LadderBand,
  LONG_OUT_DAYS,
  LeagueRules,
  ROLES,
  RoleAdvice,
  RoleStrength,
  RoundLog,
  Settled,
  Snapshot,
  TACTIC_HINT,
  TACTIC_LABEL,
  TeamRating,
  TeamState,
  Verdict,
  adviceFor,
  allocate,
  alternativesTo,
  appearancesIn,
  boardFor,
  buyable,
  calibrationOf,
  canAdd,
  candidatesOf,
  Contested,
  contestedOf,
  dealsOf,
  emptyByRole,
  expectedGainOf,
  gainBandOf,
  gainOf,
  gainScale,
  ladderOf,
  numbered,
  marginalGains,
  marketRate,
  parseAwards,
  playsOften,
  precedentsOf,
  priced,
  ratingsOf,
  rivalPlan,
  roleDemand,
  roundsOf,
  settle,
  strategyCheck,
  strengthsOf,
  sureTarget,
  tacticOf,
  teamStates,
  verdicts,
  winChance,
} from '../../core/sealed-bid';
import { Bundle } from '../../core/bundle';
import { PlayerStatus } from '../../core/player-status';
import { SeasonLine, seasonLines } from '../../core/season-line';
import { SquadMan, ValuationStore } from '../../core/valuation-store';
import { shortNames } from '../../core/clubs-store';
import { APP_VERSION } from '../../version';
import { GainChip } from '../../ui/gain-chip/gain-chip';
import { PlayerFlags } from '../../ui/player-flags/player-flags';
import { RoleBadge } from '../../ui/role-badge/role-badge';

/** The listone this league is played on. Its sheet is the default-platform CLASSIC one. */
const PLATFORM = 'default' as const;

const KEY = {
  snapshots: 'sealedBid.snapshots',
  me: 'sealedBid.me',
  rules: 'sealedBid.rules',
  swaps: 'sealedBid.swaps',
  logs: 'sealedBid.logs',
  offers: 'sealedBid.offers',
  dropped: 'sealedBid.dropped',
  banned: 'sealedBid.banned',
  extras: 'sealedBid.extras',
  rosters: 'sealedBid.rosters',
};

/** What the operator sets by hand, because the league's regulation is not in the bundle. */
interface Settings {
  budget: number;
  rounds: number;
  roleLock: boolean;
  /**
   * The first and the last matchday the COMPETITION covers.
   *
   * Declared and not deduced: a market held after the opening round usually buys from the second, but
   * nothing in the bundle knows that - and reading it off «which rounds are already played» would be a
   * guess about a regulation. Defaults to «from the second», which is this league's own, and the field
   * says so on screen so it can be corrected in one click.
   */
  from: number;
  to: number;
  /**
   * Credits held back for the rounds that come after this one.
   *
   * DECLARED and zero by default, because nothing measured what it should be: the pool thins while the
   * money does not, so a credit kept has an option value nobody in this project has priced yet
   * (`todolist-buste-chiuse-v1.md` §3.1). What the screen CAN do without a parameter is state the
   * consequence - how many credits and how many slots you expect to be left with - and let him choose.
   */
  reserve: number;
  /**
   * Does the league pay the DEFENCE MODIFIER? An input, in his own words (25/08/2026).
   *
   * «sì è attivo e deve essere una informazione da mettere come input (come le impostazioni delle
   * rose)». It is a regulation, so it is declared and never inferred - and it changes what an eleven has
   * to look like, because the bonus needs four defenders on the pitch: `referenceShape` reads it to
   * choose between the 3-4-3 and the 4-3-3 the envelopes are tuned on.
   */
  defenceModifier: boolean;
}

const SETTINGS: Settings = {
  budget: 1000,
  rounds: 9,
  roleLock: true,
  from: 2,
  to: 38,
  reserve: 0,
  // His league's own, declared on 25/08/2026 - the same standing as `roleLock` above it.
  defenceModifier: true,
};

/** The stored preferences over the defaults, with every number that is not a number left behind. */
function mergeSettings(stored: Partial<Settings>): Settings {
  const out = { ...SETTINGS };
  for (const key of Object.keys(SETTINGS) as (keyof Settings)[]) {
    const value = stored[key];
    if (value == null) continue;
    if (typeof SETTINGS[key] === 'number' && !Number.isFinite(value as number)) continue;
    if (typeof value !== typeof SETTINGS[key]) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`fantassistant.${key}`);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(`fantassistant.${key}`, JSON.stringify(value));
  } catch {
    // A browser that refuses storage still plans the round; it just forgets it on reload.
  }
}

/**
 * ASTE A BUSTA CHIUSA - the round that comes, read off the round that finished.
 *
 * The page owns no arithmetic: everything it draws comes from `core/sealed-bid.ts`, which a unit test
 * reaches and a node script drives over the real bundle. What lives here is the screen - and the two
 * decisions the operator has to be able to take on it: change a suggestion (every bid opens its own
 * alternatives) and see WHY (every figure carries the precedents or the rule it rests on).
 */
@Component({
  selector: 'app-sealed-bid',
  imports: [
    DecimalPipe,
    FormsModule,
    GainChip,
    NzAlertModule,
    NzButtonModule,
    NzCardModule,
    NzEmptyModule,
    NzIconModule,
    NzInputModule,
    NzInputNumberModule,
    NzModalModule,
    NzPopoverModule,
    NzRadioModule,
    NzRateModule,
    NzSelectModule,
    NzSwitchModule,
    NzTagModule,
    NzTooltipModule,
    NzUploadModule,
    PlayerFlags,
    RoleBadge,
    RouterLink,
  ],
  templateUrl: './sealed-bid.html',
  host: { class: 'block' },
})
export class SealedBid {
  protected readonly store = inject(ValuationStore);
  private readonly bundle = inject(Bundle);
  /** Chi e' fuori oggi, e da quanto: una definizione sola, la stessa che disegna l'icona in riga. */
  private readonly status = inject(PlayerStatus);
  protected readonly appVersion = APP_VERSION;
  protected readonly roles = ROLES;
  protected readonly tacticLabel = TACTIC_LABEL;

  /** One cumulative roster export per round played. The rounds are their differences. */
  protected readonly snapshots = signal<Snapshot[]>(readJson<Snapshot[]>(KEY.snapshots, []));
  protected readonly me = signal<string>(readJson<string>(KEY.me, ''));
  // Merged with the defaults, never taken whole: a preference written by an earlier version of this page
  // has no competition window, and `undefined - undefined + 1` is a NaN that would silently empty the
  // whole board. «A stored value the code no longer understands» is the case `view-state.ts` guards too.
  // The same guard is applied to what IS there, not only to what is missing: a `budget` of null saved
  // by an earlier session (the emptied number field, see `setSetting`) survives a reload otherwise.
  protected readonly settings = signal<Settings>(mergeSettings(readJson<Partial<Settings>>(KEY.rules, {})));
  /** The operator's own substitutions: the man the plan proposed -> the man he prefers. */
  protected readonly swaps = signal<Record<number, number>>(readJson<Record<number, number>>(KEY.swaps, {}));
  /**
   * ...and his own NUMBERS, per man: what he decided to write instead of what was suggested.
   *
   * Kept beside the swaps and not merged with them because they answer different questions - «somebody
   * else in this slot» against «the same man, at my price» - and a screen that could not tell them apart
   * would not know what to restore when «torna ai consigli» is pressed.
   */
  protected readonly offers = signal<Record<number, number>>(readJson<Record<number, number>>(KEY.offers, {}));
  /**
   * The envelopes we have actually SENT, one entry per round, with the chance each carried at the time.
   *
   * Kept because the league publishes winners and nothing else: our own losing numbers - and above all
   * the names NOBODY was awarded, which for a man we bid on can only mean somebody matched us - are
   * information no rival can reconstruct. And the chances are stored rather than recomputed, or the
   * forecast would be scored against a ladder that has since read the very round it is being judged on.
   */
  protected readonly logs = signal<RoundLog[]>(readJson<RoundLog[]>(KEY.logs, []));
  /**
   * The envelopes he took OUT of the plan, and the ones he put in by hand.
   *
   * Two lists and not one, for the same reason the swaps and the offers are two: «this name does not
   * belong here» and «this one does» are different decisions, and «torna ai consigli» has to be able to
   * undo both without guessing which was which. Keyed by the man on SCREEN, because that is what he
   * clicked - a swap is already recorded against the man the solver proposed.
   */
  protected readonly dropped = signal<number[]>(readJson<number[]>(KEY.dropped, []));
  /**
   * The men the operator has ruled OUT, and the difference from a deleted envelope is the whole point.
   *
   * «Togli questa busta» empties one slot and leaves the rest alone; «escludi e ricalcola» says «I know
   * something about this man that the sheet does not» and asks for a different plan built without him.
   * The second one MOVES the other rows on purpose - that is what re-solving means - so it is a
   * separate gesture with its own word, and both are undone by «torna ai consigli».
   */
  protected readonly banned = signal<number[]>(readJson<number[]>(KEY.banned, []));
  protected readonly extras = signal<number[]>(readJson<number[]>(KEY.extras, []));
  /** Which bid has its alternatives open. One at a time: a screen of open panels is not a screen. */
  protected readonly openBid = signal<number | null>(null);
  /**
   * The whole role, open in a modal: which role, and which envelope it would replace (null = adding).
   *
   * The short list under a row answers «chi altro potrebbe stare qui»; the operator asked (25/08/2026)
   * to be able to walk the WHOLE role too. Same list and same order - `boardFor` is read by both - so a
   * name cannot be available in one place and missing in the other.
   */
  protected readonly browse = signal<{ role: ClassicRole; bidId: number | null } | null>(null);
  protected readonly browseSearch = signal<string>('');
  /** Draw every squad as a list of names instead of four counters. A preference, so it is remembered. */
  protected readonly showRosters = signal<boolean>(readJson<boolean>(KEY.rosters, false));
  /** Which team's roster the tooltip is about. One tooltip is open at a time, so one signal is enough. */
  protected readonly hovered = signal<TeamState | null>(null);
  protected readonly problem = signal<string | null>(null);
  /** Last season and the one in progress, per player. Empty until the two tables are in. */
  private readonly lines = signal<Map<number, Map<string, SeasonLine>>>(new Map());
  private readonly linesFailed = signal(false);
  /** Which player's numbers the GAIN popover is about. One popover at a time, so one signal. */
  protected readonly hoverStats = signal<number | null>(null);
  /**
   * The classic rulebook's shapes, from the bundle's own `classic_modules.json`.
   *
   * Empty until it is in, and empty is a STATE and not a default: `referenceShape` says so on screen and
   * tunes on the standard eleven meanwhile, because a page that silently used 1-4-4-2 while claiming to
   * choose between 3-4-3 and 4-3-3 would be the «silent fallback» this project keeps paying for. Read
   * and never transcribed - the file is configuration.
   */
  private readonly shapes = signal<Reference[]>([]);

  constructor() {
    void this.store.load().then(() => this.loadSeasons());
    void this.bundle.classicModules().then((file) => this.shapes.set(shapesOf(file)));
  }

  /**
   * The two season lines behind the GAIN, loaded once and kept.
   *
   * Off the same two tables the rest of the app reads (`Bundle` caches them, so the consultation page
   * and this one never fetch twice), and deliberately AFTER the sheet: without the seasons the manifest
   * declares there is nothing to ask for, and asking for the wrong ones would draw a popover about a
   * year nobody is buying.
   */
  private loadSeasons(): void {
    const seasons = [this.store.inputSeason(), this.store.targetSeason()].filter(Boolean);
    if (!seasons.length) return;
    void Promise.all([
      this.bundle.table('season_stats'),
      this.bundle.table('external_match_stats'),
    ])
      .then(([seasonStats, matches]) =>
        this.lines.set(seasonLines({ seasonStats, matches, platform: PLATFORM, seasons })),
      )
      // An older bundle without one of the two tables draws no popover and says so on the card, which
      // is the honest failure: a silent empty table would read as «questo giocatore non ha giocato».
      .catch(() => this.linesFailed.set(true));
  }

  // ---------------------------------------------------------------- the data

  /** The sheet that prices this league, and the league setup it was built with. */
  protected readonly sheet = computed(() => this.store.sheetFor(PLATFORM));

  /**
   * The rules: the SHEET's own squad slots and calendar, the operator's own budget and rounds.
   *
   * Slots and matchdays are read and not typed in, because `config/league_config.json` already declares
   * them and the sheet's replacement level was computed with those exact numbers - a screen that let you
   * contradict them would be ranking with one league's zero under another league's rules.
   */
  protected readonly rules = computed<LeagueRules>(() => {
    const sheet = this.sheet();
    const slots = sheet?.squad_slots;
    const settings = this.settings();
    const matchdays = sheet?.matchdays_target ?? DEFAULT_RULES.matchdays;
    // Clamped to a calendar that exists, so a typo cannot buy a 400-round season.
    const from = Math.max(1, Math.min(Math.round(settings.from), matchdays));
    const to = Math.max(from, Math.min(Math.round(settings.to), matchdays));
    return {
      ...DEFAULT_RULES,
      budget: settings.budget,
      rounds: settings.rounds,
      roleLock: settings.roleLock,
      defenceModifier: settings.defenceModifier,
      matchdays,
      horizon: to - from + 1,
      slots: slots
        ? {
            P: slots['P'] ?? DEFAULT_RULES.slots.P,
            D: slots['D'] ?? DEFAULT_RULES.slots.D,
            C: slots['C'] ?? DEFAULT_RULES.slots.C,
            A: slots['A'] ?? DEFAULT_RULES.slots.A,
          }
        : DEFAULT_RULES.slots,
    };
  });

  /**
   * Every quoted man of this listone, with the sheet's own numbers on him - and his injury of today.
   *
   * The days he is still out travel WITH the row because that is what makes them impossible to forget:
   * `buyable` is asked inside `priced`, deep in the solver, where no service can be injected.
   */
  protected readonly pool = computed<
    (SquadMan & { outDays: number | null; outOfSquad: boolean })[]
  >(() => {
    const listone = this.store.rosters().get(PLATFORM) ?? [];
    const declared = this.status.declared();
    return this.store.valuations(PLATFORM, listone).map((one) => ({
      ...one,
      outDays: this.outDaysFor(one.fcId),
      // FUORI ROSA e' una DICHIARAZIONE, non una misura: nessuna riga del bundle la porta, e il foglio
      // non puo' saperlo (vedi `Bidder.outOfSquad`). Viaggia con la riga per la stessa ragione dei
      // giorni di infortunio - `buyable` la chiede dentro il solver, dove nessun servizio arriva.
      outOfSquad: declared.get(one.fcId)?.kind === 'out_of_squad',
    }));
  });

  /**
   * QUANTO RESTA FUORI, che e' la domanda che decide una busta - non quanto e' gia' stato fuori.
   *
   * Chi ha saltato due mesi e rientra sabato e' un uomo che vuoi; chi e' fuori da una settimana con
   * rientro previsto a novembre non lo e'. Quindi si legge la data di rientro quando c'e'; quando non
   * c'e' l'unica cosa misurata e' quanto e' gia' durata - ed e' anche il caso che nessuno sa datare,
   * cioe' esattamente l'assenza aperta che l'operatore non vuole vedere consigliata.
   */
  private outDaysFor(fcId: number): number | null {
    const open = this.status.openInjury(fcId);
    if (!open) return null;
    return open.remaining ?? open.days;
  }

  private readonly byId = computed(() => new Map(this.pool().map((one) => [one.fcId, one])));

  /**
   * The bands the GAIN chips are painted on, cut ONCE on the whole listone.
   *
   * On the free board they would move under his feet: the same man would turn from `buono` into
   * `ottimo` because somebody else was bought, which is a statement about the market and not about him.
   */
  protected readonly scale = computed<GainScale>(() => gainScale(this.pool(), this.rules()));

  /** Three letters per club, unique inside this listone - what a compact roster row can afford. */
  private readonly clubMarks = computed(() =>
    shortNames([...new Set(this.pool().map((one) => one.club))]),
  );

  protected readonly latest = computed<Award[]>(() => this.snapshots().at(-1) ?? []);

  protected readonly states = computed(() => teamStates(this.latest(), this.byId(), this.rules()));

  protected readonly teams = computed(() =>
    [...this.states().values()].sort((left, right) => right.spent - left.spent),
  );

  /**
   * How many awarded men this listone cannot name. Zero is the normal case and it is SHOWN when it is not.
   *
   * Their credits are charged (see `teamStates`) but their role is not, so those squads read with slots
   * they have already used. A silent count here is indistinguishable from a bundle that matches the
   * league, which is the one thing the operator cannot check by looking.
   */
  protected readonly unnamed = computed(() =>
    [...this.states().values()].reduce((sum, one) => sum + one.unknown, 0),
  );

  /** Names for the «which one is mine» selector, alphabetical so it can be found. */
  protected readonly teamNames = computed(() =>
    [...this.states().keys()].sort((left, right) => left.localeCompare(right)),
  );

  protected readonly mine = computed<TeamState | null>(() => this.states().get(this.me()) ?? null);

  private readonly takenIds = computed(() => new Set(this.latest().map((one) => one.fcId)));

  protected readonly free = computed(() =>
    this.pool().filter((one) => !this.takenIds().has(one.fcId)),
  );

  /** The rounds, rebuilt as the DIFFERENCES between the cumulative exports. One reconstruction, two readers. */
  private readonly rounds = computed(() => roundsOf(this.snapshots(), this.byId(), this.rules()));

  /** Every past award, priced against the demand its own envelope faced. */
  protected readonly precedents = computed(() => precedentsOf(this.rounds(), this.pool()));

  /** What the league has paid so far: the dearest names, and who got the most for his credits. */
  protected readonly deals = computed(() => dealsOf(this.rounds(), this.pool(), this.rules()));

  protected readonly candidates = computed<Candidate[]>(() => {
    const me = this.me();
    if (!me) return [];
    const out = candidatesOf({
      pool: this.free(),
      states: this.states(),
      precedents: this.precedents(),
      rules: this.rules(),
      me,
    });
    // The excluded men leave the BOARD and not just the plan: they must not come back as an
    // alternative, as a rival's target or as a name to add by hand - «escludi» is a statement about
    // the man, and a screen that kept offering him elsewhere would be arguing with it.
    const out_of = new Set(this.banned());
    return out_of.size ? out.filter((one) => !out_of.has(one.man.fcId)) : out;
  });

  /** The men he has ruled out, with their names: a list nobody can see is a list nobody can undo. */
  protected readonly bannedMen = computed(() =>
    this.banned()
      .map((fcId) => this.byId().get(fcId))
      .filter((one): one is NonNullable<typeof one> => !!one),
  );

  /**
   * WHICH MODULE THE ENVELOPES ARE TUNED ON - computed once here and read by the plan, the verdicts and
   * the line on screen.
   *
   * Once, because two choices of one shape would eventually disagree and the operator would be reading a
   * target the plan is not buying against. The plan CARRIES the one it used (`BidPlan.reference`), which
   * is what the department advice is then given.
   */
  protected readonly reference = computed<ReferenceChoice | null>(() => {
    const mine = this.mine();
    if (!mine) return null;
    return referenceShape({
      squad: mine,
      candidates: this.candidates(),
      rules: this.rules(),
      shapes: this.shapes(),
    });
  });

  private readonly autoPlan = computed(() => {
    const mine = this.mine();
    if (!mine) return null;
    // The squad travels with the call, because two of the operator's three rules are about the SET and
    // count what is already in it: two men per role who simply play, and never a lone bet on a keeper.
    // The cap is his credits MINUS whatever he decided to hold back for the rounds after this one.
    const cap = Math.max(1, mine.credits - Math.max(0, this.settings().reserve));
    return allocate(
      this.candidates(),
      mine.free,
      cap,
      this.rules(),
      mine,
      this.reference()?.chosen,
    );
  });

  /**
   * The plan as it stands - the automatic one with the operator's substitutions applied.
   *
   * A swap keeps the SLOT and changes the man, which is why it is stored as one id for another rather
   * than as a re-run with the man banned: re-solving would move the other eleven bids too, and a screen
   * whose other rows change when you touch one row cannot be reasoned about at a table.
   */
  protected readonly plan = computed(() => {
    const auto = this.autoPlan();
    if (!auto) return null;
    const swaps = this.swaps();
    const byMan = new Map(this.candidates().map((one) => [one.man.fcId, one]));
    const bids: Bid[] = auto.bids.map((bid) => {
      const wanted = swaps[bid.candidate.man.fcId];
      const other = wanted == null ? null : byMan.get(wanted);
      if (!other) return bid;
      const offer = other.ask.ask;
      // A name HE chose is a serious bid, never a lottery ticket: he picked the man, not the odds.
      // The gain is recomputed for the whole list below, so it is left at zero here rather than
      // carried over from the man he replaced.
      return { candidate: other, gain: 0, offer, raised: false, shot: false, chance: winChance(offer, other.ask) };
    });
    // Then what he took out and what he put in. The order matters: a name he added is not a suggestion
    // to be swapped, and a name he removed must not come back through the extras.
    const gone = new Set(this.dropped());
    const shown = bids.filter((bid) => !gone.has(bid.candidate.man.fcId));
    for (const fcId of this.extras()) {
      // NO SWAP LOOKUP HERE, and the reason is a bug that reached the e2e: `swaps` is keyed by «the man
      // the SOLVER proposed» while `extras` is keyed by «the man HE added», and those two key spaces
      // overlap - the same person can be both. Measured 25/08/2026: the solver proposed Esposito Se.,
      // the operator swapped that slot for Soulè and later added Esposito Se. by hand, and reading
      // `swaps[Esposito]` put SOULÈ in the hand-written envelope while Esposito never appeared - the
      // plan read 265 of 257 credits for a name nobody had chosen twice.
      //
      // A hand-written envelope is edited by editing HIS list (see `swapTo`), so there is nothing to
      // resolve: the id in `extras` is always the man on screen.
      const candidate = byMan.get(fcId);
      if (!candidate || shown.some((bid) => bid.candidate.man.fcId === candidate.man.fcId)) continue;
      const offer = Math.max(1, candidate.ask.ask);
      // Appended and never sorted in: a list that reshuffles when you add a name cannot be checked
      // against the one you were looking at a second ago.
      shown.push({ candidate, gain: 0, offer, raised: false, shot: false, chance: winChance(offer, candidate.ask) });
    }
    // The operator's own number wins over everything: it is the one thing on this screen that is not a
    // suggestion. The chance is re-read from it, so the percentage always describes the offer beside it.
    const chosen = this.offers();
    for (const bid of shown) {
      const wanted = chosen[bid.candidate.man.fcId];
      if (wanted == null || wanted === bid.offer) continue;
      bid.offer = Math.max(1, Math.round(wanted));
      bid.raised = false;
      bid.chance = winChance(bid.offer, bid.candidate.ask);
    }
    // Every aggregate is recomputed from the bids actually on screen. Carrying over the automatic
    // plan's totals after a swap would print figures that describe a different list - the defect this
    // project has already paid for once, an hour after making it. The two STRATEGY reports are read
    // the same way, by the same function the solver uses: a warning that describes the automatic plan
    // would go quiet exactly when he has just broken the rule by hand.
    const mine = this.mine()!;
    const check = strategyCheck(
      shown.map((bid) => bid.candidate.man),
      mine,
      this.rules(),
      auto.reference,
    );
    // WHAT EACH ENVELOPE ADDS, re-read after every hand edit and not only in the automatic plan: in
    // goal the department is one place, so removing a keeper changes what the other one is worth. The
    // same function the solver used, so the rows on screen and the total under them cannot disagree.
    const adds = marginalGains(shown.map((bid) => bid.candidate.man), mine.men, this.rules());
    for (const bid of shown) bid.gain = adds.get(bid.candidate.man.fcId) ?? 0;
    // `expectedGain` and `unfilled` are recomputed HERE and not inherited from `auto`: the first is
    // printed beside `gain` on the same line, so after a deletion the automatic one could read HIGHER
    // than the total it is a fraction of; the second is the «slot che non riesco a riempire» warning,
    // which went silent exactly when he had just emptied a slot by hand. `marketGain` is the only
    // figure that legitimately stays the automatic one - it is the NULL, «the same slots and the same
    // budget bought the way the room buys», and it must not move when we change our own answer.
    const filled = emptyByRole();
    for (const bid of shown) filled[bid.candidate.man.role] += 1;
    const unfilled = emptyByRole();
    for (const role of ROLES) unfilled[role] = Math.max(0, mine.free[role] - filled[role]);
    return {
      ...auto,
      bids: shown,
      spend: shown.reduce((sum, bid) => sum + bid.offer, 0),
      expectedSpend: shown.reduce((sum, bid) => sum + bid.offer * (bid.chance ?? 1), 0),
      expectedWins: shown.reduce((sum, bid) => sum + (bid.chance ?? 1), 0),
      gain: shown.reduce((sum, bid) => sum + bid.gain, 0),
      expectedGain: expectedGainOf(shown, mine.men, this.rules()),
      unfilled,
      missingSure: check.missingSure,
      keeperGamble: check.keeperGamble,
      holes: check.holes,
    };
  });

  protected readonly overBudget = computed(() => {
    const mine = this.mine();
    const plan = this.plan();
    return !!mine && !!plan && plan.spend > mine.credits;
  });

  protected readonly verdictOf = computed<Map<string, Verdict>>(() =>
    verdicts({ states: this.states(), pool: this.free(), rules: this.rules() }),
  );

  protected readonly strengthOf = computed<Map<string, RoleStrength[]>>(() =>
    strengthsOf(this.states(), this.rules()),
  );

  /** Two stars per manager: what he holds, and how he has played the market. A reading, never a measure. */
  protected readonly ratingOf = computed<Map<string, TeamRating>>(() =>
    ratingsOf({ states: this.states(), pool: this.free(), rules: this.rules() }),
  );

  /** OUR four departments, each with a verdict and what to do about it. */
  protected readonly advice = computed<RoleAdvice[]>(() => {
    const mine = this.mine();
    if (!mine) return [];
    return adviceFor({
      mine,
      states: this.states(),
      candidates: this.candidates(),
      scale: this.scale(),
      rules: this.rules(),
      // The envelopes ON SCREEN, so the verdict describes the plan he is looking at - not the automatic
      // one he may have edited five clicks ago.
      bids: this.plan()?.bids ?? [],
      // The shape the PLAN used, not a second choice of ours: one reference per screen.
      reference: this.plan()?.reference,
    });
  });

  /** What each rival can still reach, his own open roles first. Read from the SAME priced board. */
  protected readonly rivalTargets = computed<Map<string, Candidate[]>>(() => {
    const board = this.candidates();
    const rules = this.rules();
    const out = new Map<string, Candidate[]>();
    for (const state of this.states().values()) {
      if (state.team === this.me()) continue;
      out.set(state.team, rivalPlan(state, board, rules));
    }
    return out;
  });

  /**
   * The same rival model read ACROSS instead of down: per contested name, who is favourite for him.
   *
   * Ten rows where the per-manager lists were ten copies of the same four names, and the two facts it
   * adds are facts about the RULES: how many rivals may bid on his role at all, and which of them
   * cannot pay what he usually goes for.
   */
  protected readonly contested = computed<Contested[]>(() => {
    const me = this.me();
    if (!me) return [];
    return contestedOf({ candidates: this.candidates(), states: this.states(), rules: this.rules(), me });
  });

  /**
   * WHERE THIS ROUND LEAVES YOU: the credits and the slots you expect to carry into the next one.
   *
   * The question `todolist-buste-chiuse-v1.md` §3.1 asks, answered as a READING and not as a rule -
   * nothing here decides anything, because nobody has measured what a credit kept for round 5 is worth.
   * The two halves are the honest ones: losing costs nothing, so what you EXPECT to spend is the
   * forecast, and the envelopes you expect to lose are slots you will still have to fill.
   */
  protected readonly nextRounds = computed(() => {
    const mine = this.mine();
    const plan = this.plan();
    if (!mine || !plan) return null;
    const slotsLeft = mine.slotsFree - plan.expectedWins;
    const creditsLeft = mine.credits - plan.expectedSpend;
    return {
      roundsLeft: Math.max(0, this.rules().rounds - this.round()),
      slotsLeft,
      creditsLeft,
      perSlot: slotsLeft > 0.5 ? creditsLeft / slotsLeft : null,
      // What the room is paying per slot right now: the only yardstick that is not our own opinion.
      marketPerSlot: this.market().perSlot,
    };
  });

  /**
   * Quanta parte della tariffa di mercato è MISURATA e quanta è l'ipotesi «gli altri sono come questi».
   *
   * `marketRate` prende la media sui nomi che il foglio prezza e la proietta su tutti gli slot, perché
   * contare come zero un uomo che non sa prezzare sarebbe una frase su di lui che nessuno ha misurato.
   * Questa è la quota che regge quella media, pesata sulla domanda: il numero che dice quanto fidarsi.
   */
  protected readonly rateCoverage = computed(() => {
    const rate = marketRate(this.states(), this.free(), this.rules());
    let wanted = 0;
    let covered = 0;
    for (const role of ROLES) {
      wanted += rate.demand[role];
      covered += rate.demand[role] * rate.covered[role];
    }
    return wanted ? covered / wanted : 0;
  });

  /** The market as a whole: money left, slots left, and how much of the board carries a number. */
  protected readonly market = computed(() => {
    const states = [...this.states().values()];
    const credits = states.reduce((sum, one) => sum + one.credits, 0);
    const slots = states.reduce((sum, one) => sum + one.slotsFree, 0);
    const board = this.candidates();
    return {
      credits,
      slots,
      perSlot: slots ? credits / slots : 0,
      demand: roleDemand(this.states(), this.me() || null),
      free: this.free().length,
      // `numbered` e non `priced`: questa card descrive il TABELLONE, cioè quello su cui la stanza può
      // bustare, non quello che il piano si permette di consigliare. Contare qui la regola sugli
      // infortuni farebbe dire all'etichetta «con un numero» una cosa diversa dal suo numero - il
      // difetto che questo progetto ha già pagato con la colonna «Bonus».
      valued: numbered(board).length,
      hurt: numbered(board).length - priced(board).length,
    };
  });

  /** What it actually cost to win, by how deep in the demand the man sat. Bands, counts and real cases. */
  protected readonly ladder = computed<LadderBand[]>(() => ladderOf(this.precedents()));

  // ---------------------------------------------------------------- actions

  /** Read a roster export. Kept local: `nzBeforeUpload` returning false means nothing is sent anywhere. */
  protected readonly takeFile = (file: unknown): boolean => {
    const blob = (file as { originFileObj?: File }).originFileObj ?? (file as unknown as File);
    if (!(blob instanceof Blob)) {
      this.problem.set('Non riesco a leggere il file scelto.');
      return false;
    }
    void blob
      .text()
      .then((text) => {
        const awards = parseAwards(text);
        if (!awards.length) {
          this.problem.set(
            'Nel file non ho trovato nessuna riga «squadra, id, crediti». È il CSV delle rose della lega?',
          );
          return;
        }
        this.problem.set(null);
        this.setSnapshots([...this.snapshots(), awards]);
      })
      .catch((err: unknown) => {
        this.problem.set(
          `Il file non si lascia leggere: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`,
        );
      });
    return false;
  };

  /**
   * A new export closes a round, so everything that was ABOUT that round goes with it.
   *
   * The swaps and the numbers always did; the deletions and the hand-written envelopes did NOT, and
   * both are silent: a name he took out of the round-3 plan stayed out of the round-4 plan without a
   * word, and a name he added in round 3 came back as an envelope he never asked for. `banned` is the
   * one that survives on purpose - «escludi» is a statement about the MAN, not about a round - and it
   * is visible on screen with its own way back.
   */
  protected setSnapshots(next: Snapshot[]): void {
    this.snapshots.set(next);
    writeJson(KEY.snapshots, next);
    this.swaps.set({});
    writeJson(KEY.swaps, {});
    this.offers.set({});
    writeJson(KEY.offers, {});
    this.dropped.set([]);
    writeJson(KEY.dropped, []);
    this.extras.set([]);
    writeJson(KEY.extras, []);
    this.openBid.set(null);
  }

  protected dropLast(): void {
    this.setSnapshots(this.snapshots().slice(0, -1));
  }

  protected chooseMe(team: string): void {
    this.me.set(team);
    writeJson(KEY.me, team);
    this.swaps.set({});
    writeJson(KEY.swaps, {});
  }

  /**
   * One setting, kept usable whatever the field emits.
   *
   * `nz-input-number` sends `null` the instant the box is EMPTIED - `setValueByTyping('')` calls
   * `updateValue(null)` - and that null was being stored and persisted. With `budget` null every
   * manager's credits read `null - spent`, i.e. NEGATIVE, every ceiling collapsed to zero and
   * `state.spent / budget` printed «Infinity%» as his committed share; and because the value is
   * written to localStorage the page came back broken after a reload. A number field that has been
   * cleared has no number in it yet, so the last good one stands until he types the next.
   */
  protected setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    const current = this.settings();
    if (typeof current[key] === 'number' && (value == null || !Number.isFinite(value as number))) {
      return;
    }
    const next = { ...current, [key]: value };
    this.settings.set(next);
    writeJson(KEY.rules, next);
  }

  protected toggleBid(fcId: number): void {
    this.openBid.set(this.openBid() === fcId ? null : fcId);
  }

  protected alternativesFor(bid: Bid): { candidate: Candidate; delta: number | null; affordable: boolean }[] {
    const mine = this.mine();
    const plan = this.plan();
    if (!mine || !plan) return [];
    return alternativesTo(bid, this.candidates(), plan, mine.credits - plan.spend);
  }

  /**
   * The KEY a SOLVER slot is recorded under: the man the plan proposed for it, whoever is in it now.
   *
   * Only the automatic bids, and that is the whole point: a hand-written envelope is not a slot the
   * solver owns, so it is edited in its own list and never gets a `swaps` entry - the two key spaces
   * would otherwise collide on the same person (see the extras loop in `plan`).
   */
  private slotKey(shownId: number): number {
    const swaps = this.swaps();
    const auto = this.autoPlan();
    const proposed = auto?.bids.find(
      (one) => (swaps[one.candidate.man.fcId] ?? one.candidate.man.fcId) === shownId,
    );
    return proposed?.candidate.man.fcId ?? shownId;
  }

  /**
   * Swap the man in one row - and WHICH list it belongs to decides how.
   *
   * A suggested envelope keeps its slot and records «somebody else here», against the man the solver
   * proposed, so the note survives a re-solve. A hand-written one has no slot to keep: changing it is
   * editing his own list, so the id in `extras` is replaced outright. Two lists, two gestures, no
   * shared key - which is what the collision above cost.
   */
  protected swapTo(bid: Bid, other: Candidate): void {
    const shown = bid.candidate.man.fcId;
    const extras = this.extras();
    if (extras.includes(shown)) {
      const next = [...new Set(extras.map((one) => (one === shown ? other.man.fcId : one)))];
      this.extras.set(next);
      writeJson(KEY.extras, next);
      this.openBid.set(null);
      return;
    }
    const original = this.slotKey(shown);
    const next = { ...this.swaps(), [original]: other.man.fcId };
    if (other.man.fcId === original) delete next[original];
    this.swaps.set(next);
    writeJson(KEY.swaps, next);
    this.openBid.set(null);
  }

  /** Write your own number on one envelope. Clamped to a credit, which is the least a bid can be. */
  protected setOffer(bid: Bid, value: number | null): void {
    const fcId = bid.candidate.man.fcId;
    const next = { ...this.offers() };
    if (value == null || !Number.isFinite(value)) delete next[fcId];
    else next[fcId] = Math.max(1, Math.round(value));
    this.offers.set(next);
    writeJson(KEY.offers, next);
  }

  /** Everything he changed by hand goes back at once: swaps, numbers, deletions and additions. */
  protected clearSwaps(): void {
    this.swaps.set({});
    writeJson(KEY.swaps, {});
    this.offers.set({});
    writeJson(KEY.offers, {});
    this.dropped.set([]);
    writeJson(KEY.dropped, []);
    this.extras.set([]);
    writeJson(KEY.extras, []);
    this.banned.set([]);
    writeJson(KEY.banned, []);
  }

  protected readonly hasSwaps = computed(
    () =>
      Object.keys(this.swaps()).length > 0 ||
      Object.keys(this.offers()).length > 0 ||
      this.dropped().length > 0 ||
      this.extras().length > 0 ||
      this.banned().length > 0,
  );

  /**
   * Take one envelope out of the plan.
   *
   * The slot stays EMPTY rather than being refilled by the solver: he removed a name, and a screen that
   * answers a deletion with a different name has not done what he asked. «Torna ai consigli» puts the
   * whole plan back, and the modal adds whoever he wants in that place.
   */
  protected dropBid(bid: Bid): void {
    const fcId = bid.candidate.man.fcId;
    // A hand-written envelope always shows the id it is stored under (`swapTo` replaces it in place),
    // so the face IS the key here - and removing it is undoing his own addition, not overriding a
    // suggestion.
    const extras = this.extras().filter((one) => one !== fcId);
    if (extras.length !== this.extras().length) {
      this.extras.set(extras);
      writeJson(KEY.extras, extras);
      if (this.openBid() === fcId) this.openBid.set(null);
      return;
    }
    const next = [...new Set([...this.dropped(), fcId])];
    this.dropped.set(next);
    writeJson(KEY.dropped, next);
    if (this.openBid() === fcId) this.openBid.set(null);
  }

  /**
   * Rule a man out and let the plan rebuild itself around him.
   *
   * The other rows WILL move, and that is the difference from a swap: this is «he is not for me»,
   * which is a fact about the board, while a swap is «somebody else in this slot», which is a fact
   * about one envelope.
   */
  protected banMan(candidate: Candidate): void {
    const next = [...new Set([...this.banned(), candidate.man.fcId])];
    this.banned.set(next);
    writeJson(KEY.banned, next);
    // He cannot stay in the two hand-made lists either, or he would come back through them.
    const extras = this.extras().filter((one) => one !== candidate.man.fcId);
    this.extras.set(extras);
    writeJson(KEY.extras, extras);
    this.openBid.set(null);
  }

  protected unban(fcId: number): void {
    const next = this.banned().filter((one) => one !== fcId);
    this.banned.set(next);
    writeJson(KEY.banned, next);
  }

  /** Open the whole role: to replace one envelope (`bidId`) or to write a new one (`null`). */
  protected openBrowse(role: ClassicRole, bidId: number | null): void {
    this.browseSearch.set('');
    this.browse.set({ role, bidId });
  }

  protected closeBrowse(): void {
    this.browse.set(null);
  }

  protected browseRole(role: ClassicRole): void {
    const open = this.browse();
    if (open) this.browse.set({ ...open, role });
  }

  /**
   * The whole role, in the modal: the SAME list the short panel is cut from, plus a search.
   *
   * `boardFor` is read here and by `alternativesTo`, so a name cannot be offered under a row and be
   * missing from the full list - the two would be two definitions of «who is available».
   */
  protected readonly browseRows = computed<Candidate[]>(() => {
    const open = this.browse();
    const plan = this.plan();
    if (!open || !plan) return [];
    const exclude = open.bidId ?? undefined;
    const words = this.browseSearch().trim().toLowerCase();
    const rows = boardFor(open.role, this.candidates(), plan, exclude);
    return words
      ? rows.filter(
          (one) =>
            one.man.name.toLowerCase().includes(words) || one.man.club.toLowerCase().includes(words),
        )
      : rows;
  });

  /** The bid the modal would replace, when it was opened from a row. */
  protected readonly browsing = computed<Bid | null>(() => {
    const open = this.browse();
    const plan = this.plan();
    if (!open?.bidId || !plan) return null;
    return plan.bids.find((one) => one.candidate.man.fcId === open.bidId) ?? null;
  });

  /** Whether this man may be written into a new envelope, and what it would cost. */
  protected addCheck(candidate: Candidate) {
    const mine = this.mine();
    const plan = this.plan();
    if (!mine || !plan) return null;
    return canAdd(candidate, plan, mine, this.rules());
  }

  /** Click in the modal: replace the row it was opened from, or add a new envelope. */
  protected pickFromBrowse(candidate: Candidate): void {
    const open = this.browse();
    if (!open) return;
    const bid = this.browsing();
    if (bid) {
      this.swapTo(bid, candidate);
      this.browse.set(null);
      return;
    }
    const check = this.addCheck(candidate);
    if (!check) return;
    if (!check.ok) {
      this.problem.set(check.why);
      return;
    }
    const next = [...new Set([...this.extras(), candidate.man.fcId])];
    this.extras.set(next);
    writeJson(KEY.extras, next);
    this.problem.set(
      check.tight
        ? `${candidate.man.name} aggiunto a ${check.offer} crediti: così il tetto supera i crediti che ` +
          'hai, quindi abbassa un\'altra offerta o togli una busta.'
        : null,
    );
    this.browse.set(null);
  }

  /** Draw the squads as lists of names instead of four counters. A preference, so it is remembered. */
  protected toggleRosters(shown: boolean): void {
    this.showRosters.set(shown);
    writeJson(KEY.rosters, shown);
  }

  /** Whether THIS envelope carries a number the operator wrote himself. Not `mine()`, which is the TEAM. */
  protected isMyNumber(bid: Bid): boolean {
    return this.offers()[bid.candidate.man.fcId] != null;
  }

  /** The round the envelopes on screen are FOR: one past every export we have. */
  protected readonly round = computed(() => this.snapshots().length + 1);

  /** Have we already recorded what we are sending this round? */
  protected readonly sent = computed(() =>
    this.logs().find((one) => one.round === this.round()) ?? null,
  );

  /**
   * Every past round we both bid in and have the export for, newest first.
   *
   * A round with no export yet settles to nothing rather than to «lost»: an envelope whose result is
   * not published is not a defeat, and counting it as one would score our own model against a fact
   * that does not exist.
   */
  protected readonly settledRounds = computed(() => {
    const byId = this.byId();
    const me = this.me();
    if (!me) return [];
    return this.logs()
      .map((log) => ({ log, rows: settle(log, this.snapshots(), byId, me) }))
      .filter((one): one is { log: RoundLog; rows: Settled[] } => one.rows != null)
      .map((one) => ({ ...one, read: calibrationOf(one.rows) }))
      .sort((left, right) => right.log.round - left.log.round);
  });

  /** The newest settled round: the scoreboard the operator reads before writing the next envelopes. */
  protected readonly lastSettled = computed(() => this.settledRounds()[0] ?? null);

  // ---------------------------------------------------------------- actions

  /** Record the envelopes exactly as they stand. Never edited afterwards - that is the whole point. */
  protected sendBids(): void {
    const plan = this.plan();
    if (!plan) return;
    const log: RoundLog = {
      round: this.round(),
      bids: plan.bids.map((bid) => ({
        fcId: bid.candidate.man.fcId,
        offer: bid.offer,
        chance: bid.chance,
      })),
    };
    const next = [...this.logs().filter((one) => one.round !== log.round), log];
    this.logs.set(next);
    writeJson(KEY.logs, next);
  }

  protected forgetRound(round: number): void {
    const next = this.logs().filter((one) => one.round !== round);
    this.logs.set(next);
    writeJson(KEY.logs, next);
  }

  protected outcomeLabel(one: Settled): string {
    if (one.outcome.kind === 'won') return `presa a ${one.outcome.price}`;
    if (one.outcome.kind === 'lost') return `persa: ${one.outcome.team} a ${one.outcome.price}`;
    return 'nessuno lo ha preso: qualcuno ha scritto il tuo stesso numero';
  }

  // ---------------------------------------------------------------- reading helpers

  protected pressureLabel(pressure: number | null): string {
    // «Non quotato» and «fuori dalla domanda» are opposite statements and must never share a label:
    // the second says the room does not want him, the first says we cannot tell.
    if (pressure == null) return 'il listone Serie A non lo quota: prezzo ignoto, non zero';
    if (pressure >= 0.67) return 'in testa alla domanda';
    if (pressure >= 0.34) return 'a metà della domanda';
    if (pressure > 0) return 'in coda alla domanda';
    return 'fuori dalla domanda';
  }

  /** What to print in the pressure column: a percentage, or a mark that says there is no number. */
  protected pressureText(pressure: number | null): string {
    return pressure == null ? '?' : `${Math.round(pressure * 100)}%`;
  }

  /**
   * The one-line version of the price, for the hover. The reasoning in full is in the panel below.
   *
   * The operator's rule of 25/08/2026: he is not a statistician, so a tooltip says the thing in plain
   * words with real names in it, and the arithmetic gets its own place where there is room for it.
   */
  protected askExplain(candidate: Candidate): string {
    if (candidate.pressure == null) {
      return (
        'Il listone Serie A non lo quota, quindi non so né quanti lo vogliono né a quanto vada via: ' +
        'prezzo IGNOTO, che non vuol dire zero. Puoi sceglierlo tu, il piano non lo fa da solo.'
      );
    }
    const cases = candidate.ask.comparables
      .slice(0, 3)
      .map((one) => `${one.name} ${one.paid}`)
      .join(', ');
    // CORTO, e per una ragione misurata il 25/08/2026: un tooltip lungo si allarga sopra il campo che
    // sta spiegando - `document.elementFromPoint` sul numero rispondeva `div.ant-tooltip-inner` - e
    // così l'operatore non riesce più a scriverci dentro. Il resto (l'SpM, i casi, la probabilità)
    // sta nel pannello della riga, che ha lo spazio per dirlo.
    return `Consigliati ${candidate.ask.ask} crediti: simili andati via a ${cases || 'nessun caso'}. Clicca per il perché.`;
  }

  /**
   * The whole reasoning behind a price, in steps, the way it would be explained out loud.
   *
   * Every step carries the league's OWN numbers - names, credits, how many cases - because a rule
   * explained with an invented example is a rule explained with nothing (the operator's standing
   * request: elementary words, real data).
   */
  protected askSteps(bid: Bid): { title: string; text: string }[] {
    const candidate = bid.candidate;
    const ask = candidate.ask;
    const seen = ask.comparables.length;
    if (!seen) {
      return [
        {
          title: 'Non ho casi simili',
          text:
            'Di uomini come lui non ne è ancora stato assegnato nessuno, quindi non ho un prezzo da ' +
            'suggerire: il numero è il minimo, e la scelta è tua.',
        },
      ];
    }
    const demand = this.market().demand[candidate.man.role];
    const beaten = ask.comparables.filter((one) => one.paid < bid.offer).length;
    const dearest = ask.comparables.reduce((top, one) => (one.paid > top.paid ? one : top));
    const cheapest = ask.comparables.reduce((low, one) => (one.paid < low.paid ? one : low));
    const chance = Math.round((bid.chance ?? 0) * 100);
    const safeChance = Math.round((winChance(ask.safe, ask) ?? 0) * 100);
    const steps = [
      {
        title: '1 · Quanti lo vogliono',
        text:
          `Nel suo ruolo le altre squadre hanno ancora ${demand} caselle da riempire, e lui è ` +
          `${this.pressureLabel(candidate.pressure)}. ` +
          (candidate.pressure != null && candidate.pressure >= 0.34
            ? 'Vuol dire che quelle caselle arrivano fino a lui: aspettati compagnia.'
            : 'Vuol dire che quelle caselle finiscono prima di lui: probabilmente sei solo, o quasi.'),
      },
      {
        title: '2 · Quanto sono costati quelli come lui',
        text:
          `Ho preso i ${seen} giocatori più simili a lui fra quelli già assegnati - simili per quanto ` +
          `erano contesi e per quanto valgono di listone. Il più caro è andato a ${dearest.name} per ` +
          `${dearest.paid}, il più economico a ${cheapest.name} per ${cheapest.paid}, e la metà di loro ` +
          `è costata meno di ${ask.mid}.`,
      },
      {
        title: `3 · Perché ${bid.offer}`,
        text:
          `Con ${bid.offer} crediti avresti battuto ${beaten} di quei ${seen}: circa ${chance} volte su ` +
          '100. Non è una previsione sul giocatore, è quello che è successo davvero a chi gli somiglia.',
      },
    ];
    if (ask.safe > bid.offer) {
      steps.push({
        title: '4 · Se lo vuoi quasi sicuro',
        text:
          `Servono ${ask.safe} crediti, cioè ${ask.safe - bid.offer} in più: si passa da ${chance} a ` +
          `${safeChance} volte su 100. Se il nome ti serve davvero, questi crediti sono il prezzo della ` +
          'tranquillità; se no, quei crediti valgono di più su un\'altra busta.',
      });
    }
    if (candidate.man.spm != null) {
      steps.push({
        title: 'Quanto lo valuta il foglio',
        text:
          `Il motore, convertito in crediti su una lega come la tua, lo prezza ${candidate.man.spm.toFixed(0)}. ` +
          `Con ${bid.offer} stai ${bid.offer > candidate.man.spm ? 'pagando SOPRA' : 'restando sotto'} il suo metro. ` +
          'Attenzione: quel numero è tarato sul listone intero PRIMA che il mercato cominciasse, quando ' +
          'nessuno era ancora stato comprato - come confronto vale, come verità no.',
      });
    }
    const tie = this.tieExample();
    steps.push({
      title: 'E ricorda: pareggiare non basta',
      text: tie
        ? `In parità non lo prende nessuno: ${tie}. Per questo su una busta bassa un credito in più ` +
          'cambia tutto, mentre su una alta non sposta quasi niente.'
        : 'Se due scrivono lo stesso numero il giocatore non va a nessuno e torna in lista. Per questo ' +
          'su una busta da 2 crediti uno in più conta molto, mentre su una da 50 non sposta quasi niente.',
    });
    return steps;
  }

  /** A tie WE lived through, named. Real or nothing: an invented example teaches the wrong thing. */
  private tieExample(): string | null {
    for (const round of this.settledRounds()) {
      const tied = round.rows.find((one) => one.outcome.kind === 'unassigned');
      if (tied?.man) {
        return `nel round ${round.log.round} ${tied.man.name} non è andato a nessuno, e ci avevamo ` +
          `messo ${tied.bid.offer}`;
      }
    }
    return null;
  }

  /** What the chance is a frequency OF - a percentage with no population behind it is a decoration. */
  protected chanceExplain(bid: Bid): string {
    if (bid.chance == null) {
      return 'Nessun caso simile nello storico: non ho una frequenza da darti, e inventarne una sarebbe peggio del punto interrogativo.';
    }
    const seen = bid.candidate.ask.comparables.length;
    const beaten = bid.candidate.ask.comparables.filter((one) => one.paid < bid.offer).length;
    return (
      `Offrendo ${bid.offer} avresti superato ${beaten} dei ${seen} nomi simili già assegnati ` +
      `(${Math.round(bid.chance * 100)}%). Pareggiare non basta: in parità non lo prende nessuno, ` +
      'quindi il conto è fatto a «meno di».'
    );
  }

  /**
   * Cosa c'e' dietro il GAIN di QUESTO uomo, in parole. Vive nel popover e non piu' in un `title`.
   *
   * Prende l'uomo e non il candidato perche' il popover ha solo lui: il candidato e' una riga di una
   * lista, l'uomo e' la persona su cui si sta passando il dito.
   */
  protected gainWords(man: SquadMan): string {
    const gain = gainOf(man, this.rules());
    if (gain == null) {
      return man.surplus == null
        ? 'Il motore non lo prezza: nessun numero, che non è uno zero.'
        : 'Il foglio gli dà meno presenze della soglia della lega: non entra in una classifica di chi comprare.';
    }
    const surplus = man.surplus?.toFixed(1) ?? '?';
    const kind = man.surplusIsEstimate ? 'stimato' : 'del motore';
    const rules = this.rules();
    const collected = appearancesIn(man, rules);
    // Two numbers and not one: the engine forecasts the whole calendar, and what you buy is the window.
    // Printing the first under a competition that is shorter would quote a figure measured elsewhere.
    const window =
      rules.horizon === rules.matchdays
        ? `${man.expected?.toFixed(0) ?? '?'} presenze attese`
        : `${collected?.toFixed(0) ?? '?'} presenze nelle ${rules.horizon} giornate della competizione ` +
          `(${man.expected?.toFixed(0) ?? '?'} su ${rules.matchdays})`;
    return (
      `GAIN: quanto ti fa guadagnare rispetto a chi prenderesti al suo posto. Surplus ${kind} ` +
      `${surplus} su ${window}, scontato per quanta stagione si vede arrivare. ` +
      `${man.titolarita ?? 'gradino non calcolato'}.`
    );
  }

  /** The two-axis reading of how he played the round, drawn as one word with its numbers behind it. */
  protected tacticOfTeam(state: TeamState) {
    return tacticOf(state, this.rules()).tactic;
  }

  /** The word, then HIS numbers: a label that cannot show what produced it is a label to be trusted blind. */
  protected tacticHint(state: TeamState): string {
    const read = tacticOf(state, this.rules());
    return (
      `${TACTIC_LABEL[read.tactic]} — ${TACTIC_HINT[read.tactic]} ` +
      `Lui: ${state.men.length} uomini, ${Math.round(read.committed * 100)}% del budget speso, ` +
      `${Math.round(read.topThree * 100)}% di quella spesa sui suoi tre più cari` +
      (read.snipes ? `, ${read.snipes} presi a 1-2 crediti.` : '.')
    );
  }

  /** The men of a squad, role by role and dearest first inside the role: the order you read a rosa in. */
  protected rosterRows(state: TeamState) {
    const order = new Map(ROLES.map((role, at) => [role, at]));
    return [...state.men]
      .sort(
        (left, right) =>
          (order.get(left.role) ?? 9) - (order.get(right.role) ?? 9) || right.paid - left.paid,
      )
      .map((man) => ({ man, gain: gainOf(man, this.rules()) }));
  }

  /** The holes: how many men of each role are still missing from a complete squad. */
  protected holesOf(state: TeamState): { role: ClassicRole; count: number }[] {
    return ROLES.map((role) => ({ role, count: state.free[role] })).filter((one) => one.count > 0);
  }

  /** Three letters for a club, unique inside this listone. `Ata`, `Int`, `Juv`: what a compact row shows. */
  protected clubMark(club: string): string {
    return this.clubMarks().get(club) ?? club.slice(0, 3);
  }

  /**
   * WHY this man instead of that one, in words - and what it does to the ceiling BEFORE you click.
   *
   * An alternative is worse by construction (the solver already took the best), so a negative delta on
   * its own tells him nothing: what decides a swap is the REASON - «costa 30 in meno», «lo vogliono in
   * meno», «gioca sempre» - and the effect on the money, which used to arrive as an over-budget banner
   * AFTER the click.
   */
  protected swapReason(bid: Bid, other: { candidate: Candidate; delta: number | null }): string {
    const words: string[] = [];
    const price = other.candidate.ask.ask - bid.offer;
    if (price <= -3) words.push(`costa ${Math.abs(price)} crediti in meno`);
    else if (price >= 3) words.push(`costa ${price} crediti in più`);
    const pressure = (other.candidate.pressure ?? 0) - (bid.candidate.pressure ?? 0);
    if (pressure <= -0.2) words.push('lo vogliono in meno');
    else if (pressure >= 0.2) words.push('è più conteso');
    if (this.plays(other.candidate.man) === true && this.plays(bid.candidate.man) !== true) {
      words.push('gioca quasi ogni giornata');
    }
    if (other.delta == null) words.push('il motore non lo prezza: sceglierlo è una tua decisione');
    else if (other.delta > 0) words.push(`rende ${other.delta.toFixed(1)} di gain in più`);
    else if (other.delta < -3) words.push(`rende ${Math.abs(other.delta).toFixed(1)} di gain in meno`);
    if (!words.length) words.push('stesso profilo, a un prezzo simile');
    const effect =
      price === 0 ? 'il tetto non cambia' : `il tetto ${price > 0 ? 'sale' : 'scende'} di ${Math.abs(price)}`;
    return `${words.join(', ')} · ${effect}.`;
  }

  /** What the two stars mean, with the manager's own numbers in it - never «4 stelle su 5» and nothing else. */
  protected squadStarsHint(rating: TeamRating): string {
    return (
      `Valore della rosa: ${rating.squadRank}º di ${this.teams().length} in questa lega per ` +
      `quello che ha GIÀ in mano (${rating.gain.toFixed(0)} di gain sommato). Le stelle sono una ` +
      'classifica dentro questa lega, non un voto assoluto: chi ha ancora tutti i soldi in tasca ha per ' +
      'forza poche stelle qui, e le recupera nella stella accanto.'
    );
  }

  protected conductStarsHint(rating: TeamRating): string {
    const efficiency =
      rating.perHundred == null
        ? 'non ha ancora speso, quindi su questo lo metto a metà classifica invece che in cima'
        : `${rating.perHundred.toFixed(1)} di gain ogni 100 crediti spesi (${rating.perHundredRank}º)`;
    const reach =
      rating.reach >= 1
        ? `i crediti che ha tenuto bastano per ${rating.reach.toFixed(1)} volte quello che gli manca`
        : `i crediti che ha tenuto coprono solo ${Math.round(rating.reach * 100)}% di quello che gli manca`;
    return (
      `Condotta d'asta: come ha comprato e come sta messo per quello che gli resta. Due metà — ` +
      `${efficiency}; e ${reach}` +
      (rating.mostToBuy ? `, col grosso ancora da prendere in ${rating.mostToBuy}.` : '.')
    );
  }

  protected gapsOf(team: string): RoleStrength[] {
    return (this.strengthOf().get(team) ?? []).filter((one) => one.free > 0);
  }

  protected roleOf(role: string): ClassicRole {
    return role as ClassicRole;
  }

  /** Real awards of that band, named with what they cost: «Thuram 182 · Vlasic 3 · Dybala 2». */
  protected exampleList(band: LadderBand): string {
    return band.examples.map((one) => `${one.name} ${one.paid}`).join(' · ') || 'nessuno';
  }

  /** Which roles the plan cannot give its dependable men, as letters: «D, C». */
  protected missingSureRoles(plan: { missingSure: Record<ClassicRole, number> }): string[] {
    return ROLES.filter((role) => plan.missingSure[role] > 0);
  }

  /**
   * ...and the same roles WITH THE NUMBER THE RULE ACTUALLY ASKS FOR: «D 2 su 4, C 1 su 4».
   *
   * `SURE_PER_ROLE` is the FLOOR of that rule and not the rule: `sureTarget` raises it to what an
   * eleven fields (P1 D4 C4 A2), which is the same criterion the department verdict calls «scoperto»
   * with. The warning used to quote the floor, so it announced «non arrivo a 2» about a constraint
   * that had asked for four - a sentence that does not match its own arithmetic.
   */
  protected missingSureWords(plan: { missingSure: Record<ClassicRole, number> }): string {
    return ROLES.filter((role) => plan.missingSure[role] > 0)
      .map((role) => `${role} (ne mancano ${plan.missingSure[role]} su ${sureTarget(role)})`)
      .join(', ');
  }

  /**
   * Where «Aggiungi» opens: the first role that can actually take ANOTHER envelope.
   *
   * Not «the first role with a free slot», which is a different question and was the first version:
   * with one keeper slot left and a keeper already in the plan, that opened a list where every single
   * row said «non valida» - a door onto a wall. The rule is one envelope per open slot, so the role
   * has to have a slot the plan is not already using.
   */
  protected firstOpenRole(): ClassicRole {
    const mine = this.mine();
    const plan = this.plan();
    const room = (role: ClassicRole) =>
      (mine?.free[role] ?? 0) -
      (plan?.bids.filter((one) => one.candidate.man.role === role).length ?? 0);
    return (
      ROLES.find((role) => room(role) > 0) ??
      ROLES.find((role) => (mine?.free[role] ?? 0) > 0) ??
      'D'
    );
  }

  protected browseTitle(): string {
    const open = this.browse();
    if (!open) return '';
    const bid = this.browsing();
    return bid
      ? `Al posto di ${bid.candidate.man.name}: tutti i ${open.role} liberi`
      : `Aggiungi una busta: tutti i ${open.role} liberi`;
  }

  /** The colour of a department's verdict. Amber for «scoperto»: it is a warning, not a danger. */
  protected stateColour(state: RoleAdvice['state']): string {
    if (state === 'scoperto') return 'warning';
    if (state === 'solido') return 'success';
    return 'default';
  }

  protected stateHint(line: RoleAdvice): string {
    if (line.state === 'chiuso') return 'Non hai più slot liberi in questo ruolo.';
    if (line.state === 'scoperto') {
      return (
        `Non riesci a schierare ${line.fielded} uomini di questo ruolo che giochino davvero: ne hai ` +
        `${line.starters}. È il buco che costa più punti, perché ogni giornata lo copri con la panchina.`
      );
    }
    if (line.state === 'solido') {
      return `Undici coperto e ${line.rank}º della lega in questo ruolo: qui i crediti rendono meno che altrove.`;
    }
    return 'L\'undici è coperto, ma il reparto non è fra i migliori della lega: puoi ancora migliorarlo.';
  }

  /** Whether this man is one of those who play, for the row that says so. */
  protected plays(man: SquadMan | Candidate['man']): boolean | null {
    return playsOften(man, this.rules());
  }

  /** How many an eleven fields in that role, on the shape THIS plan is tuned on. */
  protected fielded(role: ClassicRole): number {
    return (this.plan()?.reference ?? this.reference()?.chosen ?? STANDARD_ELEVEN).places[role];
  }

  /**
   * WHAT THE GAIN IS BUILT ON: the two seasons of the man being hovered, in the game's own units.
   *
   * Built as ROWS with their labels here rather than in the template, for one reason worth stating: a
   * keeper's line is a different line (goals conceded and clean sheets, where an outfield player has
   * goals and assists), and a branch like that written in HTML gets out of step with itself the first
   * time somebody edits one half. One place decides what a row is.
   *
   * Every empty cell is drawn as «—» and never as 0: in August the season in progress has no football
   * in it at all, and a column of zeros would be a claim about a player instead of about the calendar.
   */
  protected readonly statsCard = computed(() => {
    const fcId = this.hoverStats();
    if (fcId == null) return null;
    const man = this.byId().get(fcId);
    if (!man) return null;
    const past = this.store.inputSeason();
    const now = this.store.targetSeason();
    const lines = this.lines().get(fcId);
    const of = (season: string) => lines?.get(season) ?? null;
    const one = (value: number | null | undefined, digits = 0): string =>
      value == null ? '—' : value.toFixed(digits);
    const keeper = man.role === 'P';
    const rows: { label: string; hint: string; past: string; now: string }[] = [
      {
        label: 'Media voto',
        hint: 'Il voto medio del giornale, senza bonus né malus.',
        past: one(of(past)?.mv, 2),
        now: one(of(now)?.mv, 2),
      },
      {
        label: 'Fantamedia',
        hint: 'Il voto con bonus e malus: è quello che porta punti alla tua squadra.',
        past: one(of(past)?.fm, 2),
        now: one(of(now)?.fm, 2),
      },
      {
        label: 'Partite a voto',
        hint: 'Le giornate in cui ha giocato abbastanza da prendere il voto. È il numero che pesa di più.',
        past: one(of(past)?.pv),
        now: one(of(now)?.pv),
      },
      {
        label: 'Minuti a partita',
        hint: 'Quanto sta in campo quando gioca, contando solo le partite di campionato.',
        past: one(of(past)?.minutesPerMatch),
        now: one(of(now)?.minutesPerMatch),
      },
      keeper
        ? {
            label: 'Gol subiti',
            hint: 'Quanti gliene hanno fatti in campionato: per un portiere è il malus principale.',
            past: one(of(past)?.conceded),
            now: one(of(now)?.conceded),
          }
        : {
            label: 'Gol (rigori compresi)',
            hint: 'Tutti i gol segnati, quelli su rigore inclusi.',
            past: one(of(past)?.goals),
            now: one(of(now)?.goals),
          },
      keeper
        ? {
            label: 'Porte inviolate',
            hint: 'Le giornate chiuse senza subire gol: è il bonus che dipende più dalla squadra che da lui.',
            past: one(of(past)?.cleanSheets),
            now: one(of(now)?.cleanSheets),
          }
        : {
            label: 'Assist',
            hint: 'Gli ultimi passaggi prima di un gol.',
            past: one(of(past)?.assists),
            now: one(of(now)?.assists),
          },
      {
        label: 'xG',
        hint: 'Quanti gol «meritava» per le occasioni avute: dice se i suoi gol nascono dal gioco o dalla fortuna.',
        past: one(of(past)?.xg, 1),
        now: one(of(now)?.xg, 1),
      },
      {
        label: 'xA',
        hint: 'Lo stesso per gli assist: quanti ne avrebbero prodotti i suoi passaggi.',
        past: one(of(past)?.xa, 1),
        now: one(of(now)?.xa, 1),
      },
    ];
    const played = of(now)?.matches ?? 0;
    const gain = gainOf(man, this.rules());
    const scale = this.scale();
    const band = gainBandOf(gain, scale);
    const out = man.outDays ?? null;
    return {
      man,
      band,
      // La fascia e la POOL su cui e' tagliata: una banda citata senza la sua pool non vuol dire niente,
      // ed e' il listone intero e non i liberi - o il colore si muoverebbe sotto i piedi.
      bands:
        scale.sample === 0
          ? ''
          : `Fasce sui ${scale.sample} quotati che il foglio prezza: ottimo da ${scale.top.toFixed(0)}, ` +
            `buono da ${scale.good.toFixed(0)}, medio da ${scale.fair.toFixed(0)}.`,
      words: this.gainWords(man),
      // Perche' NON lo trovi fra i consigli, detto dove si guarda il suo numero.
      out:
        out != null && out >= LONG_OUT_DAYS
          ? `Fuori per altri ${out} giorni: non entra nei consigli, ma puoi sceglierlo a mano.`
          : '',
      past,
      now,
      rows,
      fvm: man.fvm,
      surplus: man.surplus,
      estimate: man.surplusIsEstimate,
      gain: gainOf(man, this.rules()),
      // What the empty column MEANS, said out loud - otherwise a pre-season popover reads as «this
      // man has stopped playing».
      note: this.linesFailed()
        ? 'Il bundle non porta le tabelle delle statistiche: nessun numero da mostrare.'
        : played
          ? `Stagione in corso: ${played} partite di campionato sul file.`
          : 'Della stagione in corso non c\'è ancora niente sul file: il bundle è di pre-stagione.',
    };
  });
}
