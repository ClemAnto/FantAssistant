import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

/**
 * Live feed of a fanta-asta-live session.
 *
 * fanta-asta-live keeps every session in a Firebase Realtime Database. Its web API key is public
 * by design - it ships inside the browser client of every participant - and anonymous sign-in is
 * what the site itself performs on load, so reusing both is not a way around anything.
 *
 * We only ever READ. The assistant never registers a peer and never writes a pick, so it does not
 * appear at the table and cannot alter the auction it is watching.
 *
 * This is the ONE place in the app that talks to the network: everything else reads the bundle.
 * Reading the live table is the app's own open work (parent doc §6, app/README.md «live mode»),
 * and a session's state is not a thing an offline export could ever carry.
 */

const FIREBASE_API_KEY = 'AIzaSyAji5aMonqYhjfCnHU6YW4TgwOIh8x302Y';
const DATABASE_URL = 'https://leghe-fantagazzetta-app.firebaseio.com';

/** Codes are `FA-` plus two base-36 triplets, generated lowercase. Matching case-insensitively
 *  and normalising is not cosmetic: the code IS the database key, so `FA-Y6K-VG9` would 404. */
const CODE_PATTERN = /FA-[a-z0-9]{3}-[a-z0-9]{3}/i;

/** Where the followed session is remembered, so a refresh mid-auction does not cost a setup. */
const STORAGE_KEY = 'fantassistant.auction';

/** And the table itself, so a refresh SHOWS something before the network answers. */
const SNAPSHOT_KEY = 'fantassistant.auction.snapshot';

/** At most one write per this many ms: a draft writes the whole state on every pick. */
const SNAPSHOT_THROTTLE_MS = 1500;

export type FeedStatus = 'idle' | 'connecting' | 'connected' | 'error';

/** fanta-asta-live's own market modes. */
export enum MarketType {
  Bids = 0,
  Draft = 1,
}

export enum DraftStatus {
  Loading = 0,
  Idle = 1,
  Started = 2,
  Completed = 3,
  Terminated = 4,
}

export enum GameType {
  Classic = 1,
  Mantra = 2,
}

/** Classic splits the outfield into three, Mantra keeps it as one `mov` pool. */
export type Zone = 'gk' | 'def' | 'mid' | 'atk' | 'mov';

/** Which listone the host loaded - the same two words this repository calls `platform`. */
export type Platform = 'default' | 'euro';

/**
 * What the host says he uploaded. `custom` is a THIRD value and not a platform: fanta-asta-live
 * writes it whenever the list is his own instead of one of the two official ones, which is exactly
 * what a customised pool of free agents is - observed live on `FA-zna-v85`, 09/08/2026.
 */
export type ListType = Platform | 'custom';

export interface AuctionPlayer {
  id: number;
  name: string;
  club: string;
  /** Mantra roles as the listone spells them (`dc`, `m/c`, `pc`, ...). */
  roles: string[];
  zoneClassic: Zone;
  zoneMantra: Zone;
  /** The championship the listone files him under - the only way to place a CUSTOM list. */
  championship: string | null;
  /**
   * The listone's market value. The feed spells it `fmv`; in this repository it is the FVM, and in a
   * draft it is also the PRICE - fanta-asta-live forces `playerValueType` to `fmv` there.
   *
   * The quotation is deliberately NOT read. The feed carries four price numbers per player
   * (`prices[]`, a classic pair and a Mantra pair) and nothing in its source says which of each pair
   * is Qt.I and which is Qt.A - and Qt.I is the only auction-safe one in this project. Operator's
   * decision, 09/08/2026: ignore it and refer to the FVM.
   */
  fvm: number;
}

export interface SquadEntry {
  index: number;
  player: AuctionPlayer | null;
  zone: Zone;
  cost: number;
}

export interface AuctionTeam {
  id: number;
  label: string;
  colour: string;
  online: boolean;
  host: boolean;
  spent: number;
  budgetLeft: number;
  squad: SquadEntry[];
  missing: Record<string, number>;
  missingTotal: number;
  /** Position in the current pick order; 0 is on the clock. -1 when the team is not in it. */
  orderIndex: number;
  onTheClock: boolean;
}

export interface RawPick {
  index: number;
  teamId: number;
  playerId: number;
  cost?: number;
  value?: number;
  released?: unknown;
}

export interface RawState {
  status?: DraftStatus;
  marketType?: MarketType;
  settings?: Record<string, any>;
  playerListType?: string;
  options?: { bids?: Record<string, any>; draft?: Record<string, any> };
  teams?: any[];
  picks?: RawPick[];
  pickOrder?: number[];
  turnTeamId?: number;
}

/**
 * The LEAGUE's own facts - budget, game, roster slots. They live in `state.settings`, which is a
 * `LeagueSettings` in fanta-asta-live's source; `options.bids` is the RILANCI mechanics and merely
 * happens to carry them too when a host publishes the whole blob, so it is only the fallback.
 */
export function leagueSettings(state: RawState): Record<string, any> {
  return state.settings ?? state.options?.bids ?? {};
}

/**
 * What the host uploaded, from `state.playerListType`. `settings.listType` looks like the same fact
 * and is not: on the session observed on 09/08/2026 it read `euro` over a listone of 20 Serie A
 * clubs, left behind by the setup preset.
 */
export function listTypeOf(state: RawState): ListType | null {
  const value = state.playerListType;
  return value === 'default' || value === 'euro' || value === 'custom' ? value : null;
}

/**
 * Which platform the table is on - the dimension that fixes the replacement level, so it is never
 * guessed. The two official lists say it themselves; a CUSTOM list carries no platform at all, so it
 * is read from the championships of its own rows: Serie A alone is `default`, more than one is the
 * euro perimeter, and anything else stays null and says so rather than defaulting to a side.
 */
export function platformOf(state: RawState, players: Iterable<AuctionPlayer> = []): Platform | null {
  const listType = listTypeOf(state);
  if (listType === 'default' || listType === 'euro') return listType;
  if (listType !== 'custom') return null;

  const championships = new Set<string>();
  for (const player of players) {
    if (player.championship) championships.add(player.championship);
  }
  if (!championships.size) return null;
  if (championships.size > 1) return 'euro';
  return championships.has('Serie A') ? 'default' : null;
}

/** Classic reads the outfield split in three, Mantra as one pool - and the listone carries both. */
export function zoneOf(player: AuctionPlayer | null, mantra: boolean): Zone {
  if (!player) return null as unknown as Zone;
  return mantra ? player.zoneMantra : player.zoneClassic;
}

/**
 * How the league counts goalkeepers.
 *
 * `players` is what fanta-asta-live knows: a keeper is a man and a slot is a man. `goals` is the
 * league's own rule (`docs/model/assistente-asta-v1.md` §14.1) - a «porta» is a CLUB, all of its
 * keepers, and you buy it by taking that club's first keeper. The tool cannot express it, so where
 * the two disagree the regulation wins and the counting is ours.
 */
export type KeeperMode = 'players' | 'goals';

export interface Porta {
  club: string;
  /** Every keeper of the club: ANY of them takes the goal, so they are alternatives, not a hierarchy. */
  keepers: AuctionPlayer[];
  /** What taking it costs: the dearest keeper, the one a bid would actually be made on. */
  price: number;
  /** Who owns it - the FIRST manager who took any keeper of the club - and the pick that did it. */
  teamId: number | null;
  pickIndex: number | null;
}

export interface PortaPick {
  pick: RawPick;
  porta: Porta;
}

/**
 * The goals of the session's listone, owned by the picks.
 *
 * Operator's rule, 09/08/2026: **the porta belongs to the first manager who took ANY keeper of that
 * club**, so ownership is decided by the pick order and not by which keeper is the first choice - the
 * defect the listone would otherwise hand us (Torino 2026-27 quotes all three keepers at FVM 1, so no
 * hierarchy is readable there) simply does not arise. In that mode nobody should be able to take a
 * second keeper of a club at all; if the table lets it happen anyway it is a mistake and it is
 * IGNORED - `strayPicks` reports it and no porta is granted twice.
 */
export function porteOf(
  players: Iterable<AuctionPlayer>,
  picks: RawPick[],
  mantra: boolean,
): { porte: Porta[]; strayPicks: PortaPick[] } {
  const byClub = new Map<string, Porta>();
  for (const player of players) {
    if (zoneOf(player, mantra) !== 'gk') continue;
    const porta =
      byClub.get(player.club) ??
      ({ club: player.club, keepers: [], price: 0, teamId: null, pickIndex: null } as Porta);
    porta.keepers.push(player);
    porta.price = Math.max(porta.price, player.fvm);
    byClub.set(player.club, porta);
  }

  const strayPicks: PortaPick[] = [];
  // `picks` arrives in pick order, which is what decides who got there first.
  for (const pick of picks) {
    const porta = [...byClub.values()].find((candidate) =>
      candidate.keepers.some((keeper) => keeper.id === pick.playerId),
    );
    if (!porta) continue;
    if (porta.teamId === null) {
      porta.teamId = pick.teamId;
      porta.pickIndex = pick.index;
    } else {
      strayPicks.push({ pick, porta });
    }
  }

  return { porte: [...byClub.values()], strayPicks };
}

export interface DeriveContext {
  budget: number;
  zones: Zone[];
  roles: Record<string, number[] | number>;
  mantra: boolean;
}

/**
 * What each team is, read from the picks.
 *
 * The spend is NOT taken from `currentBudget`: the host recomputes that field and republishes it a
 * moment later, so mid-round it still reads the pre-auction budget. The picks are written first and
 * are the only field that is right at every instant.
 */
export function deriveTeams(
  state: RawState,
  players: Map<number, AuctionPlayer>,
  context: DeriveContext,
): AuctionTeam[] {
  const picks = livePicks(state);
  const order = state.pickOrder ?? [];
  const onTheClockId = state.turnTeamId ?? order[0];

  return (state.teams ?? []).filter(Boolean).map((team) => {
    const connection = team.connection ?? {};

    const squad: SquadEntry[] = picks
      .filter((pick) => pick.teamId === team.id)
      .map((pick) => {
        const player = players.get(pick.playerId) ?? null;
        return {
          index: pick.index,
          player,
          zone: zoneOf(player, context.mantra),
          cost: pick.cost ?? pick.value ?? 0,
        };
      });

    const spent = squad.reduce((total, entry) => total + entry.cost, 0);

    const missing: Record<string, number> = {};
    let missingTotal = 0;
    for (const zone of context.zones) {
      const slots = context.roles[zone];
      // The pair is [min, max] and what «still to fill» counts against is the MIN: it is what the
      // host's own `getMissingPlayers` uses, so any other index makes the panel contradict the table.
      const required = Array.isArray(slots) ? slots[0] : (slots ?? 0);
      const left = Math.max(0, required - squad.filter((entry) => entry.zone === zone).length);
      missing[zone] = left;
      missingTotal += left;
    }

    return {
      id: team.id,
      label: connection.label || team.name || `Squadra ${team.id}`,
      colour: team.color ?? 'currentColor',
      online: !!connection.active,
      host: !!connection.host,
      spent,
      budgetLeft: context.budget - spent,
      squad,
      missing,
      missingTotal,
      orderIndex: order.indexOf(team.id),
      onTheClock: team.id === onTheClockId,
    };
  });
}

/** Picks that still count: a released one is undone, not history. */
export function livePicks(state: RawState): RawPick[] {
  return (state.picks ?? [])
    .filter((pick) => !!pick && !pick.released)
    .sort((a, b) => a.index - b.index);
}

/**
 * Applies one Firebase stream event to the mirror and returns it.
 *
 * `put` REPLACES the node at `path`, `patch` MERGES the given keys into it. Getting the two
 * confused is how a mirror silently drifts from the table it is supposed to reflect.
 */
export function applyStreamEvent(
  mirror: RawState,
  kind: 'put' | 'patch',
  path: string,
  data: unknown,
): RawState {
  const steps = (path ?? '/').split('/').filter(Boolean);

  if (!steps.length) {
    return kind === 'put' ? ((data ?? {}) as RawState) : { ...mirror, ...(data as object) };
  }

  let node: any = mirror;
  for (const step of steps.slice(0, -1)) {
    if (node[step] === null || typeof node[step] !== 'object') node[step] = {};
    node = node[step];
  }

  const last = steps[steps.length - 1];
  const target = Array.isArray(node) ? node[Number(last)] : node[last];

  if (kind === 'patch' && target && typeof target === 'object' && data && typeof data === 'object') {
    Object.assign(target, data);
    return mirror;
  }

  if (Array.isArray(node)) {
    node[Number(last)] = data ?? null;
  } else if (data === null || data === undefined) {
    delete node[last];
  } else {
    node[last] = data;
  }
  return mirror;
}

@Injectable({ providedIn: 'root' })
export class AuctionFeed {
  private destroyRef = inject(DestroyRef);

  readonly code = signal<string | null>(null);
  readonly status = signal<FeedStatus>('idle');
  readonly error = signal<string | null>(null);
  readonly followedTeamId = signal<number | null>(null);

  /**
   * How the league counts keepers. It is NOT read from the session: fanta-asta-live has no notion of
   * a porta, so this is the one thing the operator has to tell the panel - hence the switch.
   */
  readonly keeperMode = signal<KeeperMode>('players');

  /**
   * True while what you are looking at is the SAVED table and not the live one.
   *
   * A refresh mid-auction must show the panel at once, so the mirror is restored from storage before
   * the network is asked anything - and then it says so, because a stale pick order read as live is
   * exactly the kind of number this project refuses to print. The first stream event clears it.
   */
  readonly stale = signal(false);
  readonly savedAt = signal<string | null>(null);

  /**
   * WHY a connection failed, because the two reasons need opposite treatments.
   *
   * `missing` = the host removed the session (a 200 carrying null): retrying it at every refresh is
   * pointless, so the saved table is dropped. `network` = we could not reach the server at all, and
   * that says nothing about the auction - dropping the saved table there would delete the operator's
   * only copy of the table exactly when the network is down. Conflating them cost that, and only
   * blocking the host in a browser showed it.
   */
  readonly failure = signal<'missing' | 'network' | null>(null);

  private readonly state = signal<RawState>({});
  private readonly players = signal<Map<number, AuctionPlayer>>(new Map());

  /** The live mirror the stream writes into; `state` publishes a copy of it after every event. */
  private mirror: RawState = {};
  private stream: EventSource | null = null;
  private token: string | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.closeStream();
      if (this.trailing) clearTimeout(this.trailing);
    });
  }

  readonly connected = computed(() => this.status() === 'connected');

  /**
   * Whether there is a table to SHOW - which is not the same as being connected.
   *
   * After a refresh the saved mirror is on screen while the stream is still opening, and gating the
   * panel on the socket meant the operator looked at the code card with the whole table already in
   * memory. What the panel needs is a state; what the header needs is to say whether it is live.
   */
  readonly hasTable = computed(() => this.connected() || (this.stale() && !!this.state().teams));

  readonly league = computed(() => leagueSettings(this.state()));
  readonly listType = computed<ListType | null>(() => listTypeOf(this.state()));
  readonly platform = computed<Platform | null>(() =>
    platformOf(this.state(), this.players().values()),
  );

  /** The raise mechanics: countdown, minimum bid, buzzer. Unused until the bids mode is followed. */
  readonly bidRules = computed(() => this.state().options?.bids ?? null);
  readonly draftRules = computed(() => this.state().options?.draft ?? null);

  readonly isDraft = computed(() => this.state().marketType === MarketType.Draft);
  readonly draftStatus = computed(() => this.state().status ?? DraftStatus.Loading);
  readonly budget = computed<number>(() => this.league()['budget'] ?? 0);
  readonly game = computed<GameType>(() => this.league()['game'] ?? GameType.Classic);
  readonly isMantra = computed(() => this.game() === GameType.Mantra);

  readonly zones = computed<Zone[]>(() =>
    this.isMantra() ? ['gk', 'mov'] : ['gk', 'def', 'mid', 'atk'],
  );

  readonly picks = computed<RawPick[]>(() => livePicks(this.state()));

  readonly teams = computed<AuctionTeam[]>(() =>
    deriveTeams(this.state(), this.players(), {
      budget: this.budget(),
      zones: this.zones(),
      roles: this.league()['roles'] ?? {},
      mantra: this.isMantra(),
    }),
  );

  /** The teams in the order they will choose: index 0 is on the clock. */
  readonly pickOrder = computed<AuctionTeam[]>(() =>
    this.teams()
      .filter((team) => team.orderIndex >= 0)
      .sort((a, b) => a.orderIndex - b.orderIndex),
  );

  readonly followed = computed<AuctionTeam | null>(
    () => this.teams().find((team) => team.id === this.followedTeamId()) ?? null,
  );

  readonly onTheClock = computed<AuctionTeam | null>(
    () => this.teams().find((team) => team.onTheClock) ?? null,
  );

  /** How many picks happen before mine - the first of the three numbers §11.7 asks for. */
  readonly picksUntilMyTurn = computed<number | null>(() => {
    const index = this.followed()?.orderIndex;
    return index === undefined || index < 0 ? null : index;
  });

  /** The listone still free, dearest first. */
  readonly available = computed<AuctionPlayer[]>(() => {
    const taken = new Set(this.picks().map((pick) => pick.playerId));
    return [...this.players().values()]
      .filter((player) => !taken.has(player.id))
      .sort((a, b) => b.fvm - a.fvm);
  });

  /**
   * Every id the session's own listone carries, taken and free alike.
   *
   * It is what «which of our sheets knows this table» is counted against, and it has to be the WHOLE
   * list rather than the free part: coverage is a property of the list the host uploaded, and it must
   * not drift as the auction empties the pool.
   */
  readonly listoneIds = computed<number[]>(() => [...this.players().keys()]);

  readonly isGoalsMode = computed(() => this.keeperMode() === 'goals');

  /** Every club's goal, with who owns it. Only meaningful while the porte rule is on. */
  private readonly portaState = computed(() =>
    porteOf(this.players().values(), this.picks(), this.isMantra()),
  );

  /** The goals still free, dearest first: one row per CLUB, not per keeper. */
  readonly freePorte = computed<Porta[]>(() =>
    this.portaState()
      .porte.filter((porta) => porta.teamId === null)
      .sort((a, b) => b.price - a.price),
  );

  /** The goals I own. */
  readonly myPorte = computed<Porta[]>(() =>
    this.portaState().porte.filter((porta) => porta.teamId === this.followedTeamId()),
  );

  /**
   * How many goals I still have to take: the session's own keeper slots, counted in porte.
   *
   * The slot count comes from the table (`roles.gk`) because that is what the banditore will ask for;
   * the UNIT comes from the league. If the two disagree - three keeper slots declared where the
   * regulation plays two porte - the panel shows the table's number and the mismatch is visible.
   */
  readonly porteMissing = computed<number>(() => {
    const slots = this.league()['roles']?.['gk'];
    const required = Array.isArray(slots) ? slots[0] : (slots ?? 0);
    return Math.max(0, required - this.myPorte().length);
  });

  /**
   * Keeper picks that took a goal somebody already owned. In this mode the table should not allow
   * them; when one happens anyway it is a mistake and it is ignored - reported here so it is not
   * silently counted as a porta (operator's rule, 09/08/2026).
   */
  readonly strayKeeperPicks = computed<PortaPick[]>(() => this.portaState().strayPicks);

  /** Mine among those, which are the ones the panel has to warn about. */
  readonly myStrayKeeperPicks = computed<PortaPick[]>(() =>
    this.strayKeeperPicks().filter((entry) => entry.pick.teamId === this.followedTeamId()),
  );

  readonly lastPicks = computed(() => {
    const teams = this.teams();
    const players = this.players();
    return this.picks()
      .slice()
      .reverse()
      .map((pick) => ({
        index: pick.index,
        cost: pick.cost ?? pick.value ?? 0,
        player: players.get(pick.playerId) ?? null,
        team: teams.find((team) => team.id === pick.teamId) ?? null,
      }));
  });

  zoneOf(player: AuctionPlayer | null): Zone {
    return zoneOf(player, this.isMantra());
  }

  async connect(input: string, preserve = false): Promise<boolean> {
    const matched = input?.match(CODE_PATTERN)?.[0];
    if (!matched) {
      this.fail('Codice non valido. Il formato è FA-xxx-xxx.');
      return false;
    }
    const code = `FA-${matched.slice(3).toLowerCase()}`;

    // `preserve` is for the re-join after a refresh: the saved table is already on screen and wiping it
    // would blank the panel for as long as the network takes.
    if (!preserve) this.disconnect();
    this.status.set('connecting');

    try {
      this.token = await this.signInAnonymously();

      const listone = await this.read<Record<string, any>>(`${code}/env/playerList`);
      if (!listone) {
        // A 200 carrying null: the session is gone, which is a fact about the auction and not a glitch.
        this.failure.set('missing');
        throw new Error(`Nessuna asta trovata con il codice ${code}.`);
      }
      this.players.set(this.parseListone(listone));

      this.code.set(code);
      this.openStream(code);
      this.remember();
      this.rememberState();
      return true;
    } catch (error) {
      // Carry the real message: on an unexpected failure that is where the information lives.
      if (!this.failure()) this.failure.set('network');
      this.fail(error instanceof Error ? error.message : 'Connessione fallita.');
      return false;
    }
  }

  /**
   * Re-joins the session this browser was following, after a refresh.
   *
   * The followed team is restored WITHOUT waiting for the stream: `followed()` looks it up among the
   * teams as soon as they arrive, and answers null if the id is gone - so a session that changed shape
   * falls back to the picker instead of showing somebody else's squad.
   */
  async restore(): Promise<boolean> {
    const stored = this.stored();
    if (!stored?.code) return false;

    this.keeperMode.set(stored.keeperMode ?? 'players');
    if (stored.teamId !== null && stored.teamId !== undefined) {
      this.followedTeamId.set(stored.teamId);
    }
    // Paint what we had BEFORE going to the network: the panel is useful in the same instant, and the
    // stream replaces it a moment later. `preserve` keeps it from being wiped by the connect.
    const painted = this.paintSnapshot(stored.code);
    const connected = await this.connect(stored.code, painted);
    if (!connected) {
      // Only a session the host REMOVED is forgotten. A network failure leaves everything in place:
      // the saved table stays on screen and the header says the re-join did not happen.
      if (this.failure() === 'missing') this.forget();
      return painted;
    }
    return true;
  }

  /**
   * Puts the saved table on screen without touching the network. Returns whether anything was painted.
   *
   * Read-only by construction - it is a copy of what the host had published - and marked `stale` until
   * the stream speaks. The listone is saved with it, because a state without names is a table nobody
   * can read; if the browser refused the space for it, the state alone still shows the mechanics.
   */
  private paintSnapshot(code: string): boolean {
    const saved = this.snapshot();
    if (!saved || saved.code !== code || !saved.state) return false;

    this.mirror = saved.state;
    this.state.set({ ...saved.state });
    if (saved.players?.length) {
      this.players.set(new Map(saved.players.map((player) => [player.id, player])));
    }
    this.code.set(code);
    this.savedAt.set(saved.savedAt ?? null);
    this.stale.set(true);
    this.status.set('connecting');
    return true;
  }

  follow(teamId: number) {
    this.followedTeamId.set(teamId);
    this.remember();
  }

  unfollow() {
    this.followedTeamId.set(null);
    this.remember();
  }

  setKeeperMode(mode: KeeperMode) {
    this.keeperMode.set(mode);
    this.remember();
  }

  /** Closes the stream and empties the mirror. It does NOT forget the session: `connect` calls it. */
  disconnect() {
    this.closeStream();
    this.mirror = {};
    this.state.set({});
    this.players.set(new Map());
    this.code.set(null);
    this.followedTeamId.set(null);
    this.status.set('idle');
    this.error.set(null);
  }

  /** Leaving the table on purpose is the one thing that must not survive a refresh. */
  forget() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SNAPSHOT_KEY);
    } catch {
      // A browser that refuses storage still follows an auction; it just forgets it on refresh.
    }
  }

  private remember() {
    const code = this.code();
    if (!code) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          code,
          teamId: this.followedTeamId(),
          keeperMode: this.keeperMode(),
        }),
      );
    } catch {
      // Same as above: storage is a convenience here, never a requirement.
    }
  }

  private lastSaved = Number.NEGATIVE_INFINITY;
  private trailing: ReturnType<typeof setTimeout> | null = null;

  /**
   * Saves the mirror, throttled ON BOTH EDGES.
   *
   * The trailing write is not a refinement, it is the whole point: at `connect` the mirror is still
   * empty and the stream's first event arrives inside the throttle window, so a leading-only throttle
   * stored `state: {}` for ever and the refresh painted nothing. An idle session sends no further
   * events, so «the next one will save it» is false.
   */
  private rememberState(): void {
    const code = this.code();
    if (!code) return;
    const now = performance.now();
    if (now - this.lastSaved < SNAPSHOT_THROTTLE_MS) {
      if (!this.trailing) {
        this.trailing = setTimeout(() => {
          this.trailing = null;
          this.rememberState();
        }, SNAPSHOT_THROTTLE_MS - (now - this.lastSaved));
      }
      return;
    }
    this.lastSaved = now;

    const players = [...this.players().values()];
    const savedAt = new Date().toISOString();
    const write = (withPlayers: boolean) =>
      localStorage.setItem(
        SNAPSHOT_KEY,
        JSON.stringify({ code, state: this.mirror, players: withPlayers ? players : [], savedAt }),
      );
    try {
      write(true);
    } catch {
      // Out of quota with the listone in: the state alone is still worth having, so try without it.
      try {
        write(false);
      } catch {
        // A browser that refuses storage still follows the auction live.
      }
    }
    this.savedAt.set(savedAt);
  }

  private snapshot(): {
    code?: string;
    state?: RawState;
    players?: AuctionPlayer[];
    savedAt?: string;
  } | null {
    try {
      return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? 'null');
    } catch {
      return null;
    }
  }

  private stored(): { code?: string; teamId?: number | null; keeperMode?: KeeperMode } | null {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    } catch {
      return null;
    }
  }

  private fail(message: string) {
    this.status.set('error');
    this.error.set(message);
  }

  private async signInAnonymously(): Promise<string> {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnSecureToken: true }),
      },
    );
    if (!response.ok) {
      throw new Error("Autenticazione al server dell'asta non riuscita.");
    }
    return (await response.json()).idToken;
  }

  private async read<T>(path: string): Promise<T | null> {
    const response = await fetch(`${DATABASE_URL}/sessions/${path}.json?auth=${this.token}`);
    if (!response.ok) {
      throw new Error(`Il server dell'asta ha risposto ${response.status}.`);
    }
    return (await response.json()) as T | null;
  }

  private parseListone(raw: Record<string, any>): Map<number, AuctionPlayer> {
    const players = new Map<number, AuctionPlayer>();
    const key = this.isMantraListone(raw) ? 'mantra' : 'classic';
    for (const entry of Object.values(raw)) {
      players.set(entry.id, {
        id: entry.id,
        name: entry.name ?? entry.fullName,
        club: entry.team,
        roles: entry.roles ?? [],
        zoneClassic: entry.zone?.classic,
        zoneMantra: entry.zone?.mantra,
        championship: entry.championship?.label ?? null,
        fvm: entry.stats?.fmv?.[key] ?? 0,
      });
    }
    return players;
  }

  /** The listone is read before the state arrives, so the game type is not known yet. Mantra is
   *  the safe read here: both keys exist on every row and only the number differs. */
  private isMantraListone(raw: Record<string, any>): boolean {
    return Object.values(raw).some((entry) => entry.stats?.fmv?.mantra !== undefined);
  }

  /**
   * Firebase streams a session over server-sent events: one `put` with the whole node on connect,
   * then a `put` or `patch` per change. Applying them to a local mirror is what keeps the panel
   * in step with the table without polling.
   */
  private openStream(code: string) {
    const stream = new EventSource(`${DATABASE_URL}/sessions/${code}/state.json?auth=${this.token}`);
    this.stream = stream;

    const apply = (kind: 'put' | 'patch') => (event: MessageEvent) => {
      const message = JSON.parse(event.data) as { path: string; data: unknown };
      this.mirror = applyStreamEvent(this.mirror, kind, message.path, message.data);
      this.state.set({ ...this.mirror });
      if (this.status() !== 'connected') this.status.set('connected');
      this.stale.set(false);
      this.rememberState();
    };

    stream.addEventListener('put', apply('put'));
    stream.addEventListener('patch', apply('patch'));

    // The anonymous token lasts an hour; Firebase says so explicitly instead of just dropping us.
    stream.addEventListener('auth_revoked', () => {
      this.closeStream();
      this.reconnect(code);
    });

    stream.onerror = () => {
      if (stream.readyState === EventSource.CLOSED) {
        this.closeStream();
        this.reconnect(code);
      }
    };
  }

  private async reconnect(code: string) {
    try {
      this.token = await this.signInAnonymously();
      this.openStream(code);
    } catch {
      this.fail("Connessione all'asta persa. Riprova a collegarti.");
    }
  }

  private closeStream() {
    this.stream?.close();
    this.stream = null;
  }

}
