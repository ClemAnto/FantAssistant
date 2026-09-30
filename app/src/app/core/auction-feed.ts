import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

import type { PickOrderType } from './auction-plan';
import { teamColour } from './team-colours';

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

/**
 * What stands where a session code would be while the table is INVENTED.
 *
 * It is not a code and it cannot be one: `CODE_PATTERN` would refuse it, so nothing that talks to the
 * network can ever be handed this by accident.
 */
export const DEMO_CODE = 'DEMO';

export type FeedStatus = 'idle' | 'connecting' | 'connected' | 'demo' | 'error';

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
  /**
   * The listone's TWO market values, as a live session serves them (`stats.fmv.classic` / `.mantra`). They
   * differ on 140 of the 535 Serie A men of 2026-27 (Calhanoglu 220 against 250), so which one is `fvm` is
   * decided by the GAME the table declares, which arrives after the listone (`AuctionFeed.players`). Absent
   * on a table built from the bundle, where `fvm` is already the game's own.
   */
  fvmByGame?: { classic: number; mantra: number };
}

/** A listone row priced in the table's game: the value the host orders and caps a draft on. */
export function pricedFor(player: AuctionPlayer, mantra: boolean): AuctionPlayer {
  const both = player.fvmByGame;
  if (!both) return player;
  const fvm = mantra ? both.mantra : both.classic;
  return fvm === player.fvm ? player : { ...player, fvm };
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
  /**
   * LE ROSE E LE AGGIUDICAZIONI ARRIVANO COME ARRAY *O* COME OGGETTO, e il tipo lo dice invece di
   * lasciarlo scoprire a chi ci chiama `.filter` sopra: vedi `listOf`, che e' l'unico modo di leggerle.
   */
  teams?: unknown;
  picks?: unknown;
  pickOrder?: number[];
  /** The order RULE (`default` | `pingpong`), read by `AuctionFeed.orderType`. */
  pickOrderType?: string;
  turnTeamId?: number;
  /**
   * CHI E' IN ASTA ADESSO, e il tavolo lo pubblica: LETTO il 24/09/2026 su una sessione a RILANCI
   * viva (`appVer` 1.22.2-live), non dedotto. IL CODICE DELLA SESSIONE E' REDATTO ovunque in
   * questo repository (`FA-xxx-xxx` sta per quello vero): il repo e' PUBBLICO e la web API key di
   * fanta-asta-live ci sta dentro per costruzione, quindi un codice vivo scritto qui aprirebbe in
   * lettura l'asta di chi la sta giocando. Quello che serve alla provenienza e' la DATA e la
   * versione dell'host, non la chiave.
   *
   * Fino a quel giorno questo file diceva che un nodo del genere «non e' mai stato osservato», ed era
   * vero alla lettera e falso come misura: le due sole sessioni mai lette erano DRAFT (`marketType`
   * 1), dove un lotto non esiste - c'e' un turno. La prima sessione a rilanci guardata lo porta alla
   * prima lettura. Verificato contro quello che l'operatore vedeva a schermo in quel momento
   * (`selectedPlayerId` 6875 = Paz N., Como) e stabile su quattordici letture in quaranta secondi.
   *
   * NON E' `lastPick`, che e' l'ultima AGGIUDICAZIONE: nella stessa lettura valevano 6875 e 7561
   * (Lontani, gia' venduto a un credito). Sono due fatti diversi e il tavolo li tiene separati.
   */
  selectedPlayerId?: number | null;

  /**
   * L'OFFERTA CORRENTE SUL CALCIATORE IN ASTA, e anche questa il tavolo la pubblica: LETTA il
   * 24/09/2026 sulla stessa sessione a rilanci (`FA-xxx-xxx`), non dedotta.
   *
   * CHE `value` SIA L'OFFERTA IN CREDITI E NON IL VALORE DELL'UOMO e' la sola cosa che il primo
   * sguardo lasciava ambigua, perche' `lastPick` porta DUE numeri - `cost` 1 e `value` 15 - quindi
   * la stessa parola li' vuol dire un'altra cosa. L'ha sciolta il tempo e non un ragionamento: alle
   * 23:11 `currentBid` leggeva `{playerId 5555, value 5}`, trentasei secondi dopo quell'uomo era in
   * `lastPick` con `cost` **5** e il nodo era gia' passato al successivo con `value` 13. L'offerta
   * corrente diventa il prezzo pagato, quindi e' l'offerta.
   *
   * VIAGGIA COL NOME DI CHI RIGUARDA, ed e' per questo che si puo' leggere: chi la usa confronta
   * `playerId` col calciatore in asta e scarta quella che nomina un altro - fra due lotti questo
   * nodo puo' restare fermo sull'ultimo, esattamente come `lastPick` resta sull'ultima
   * aggiudicazione. Mostrare l'una per l'altra sarebbe una cifra vera detta sull'uomo sbagliato.
   *
   * `teamId` e' chi sta offrendo e `comment` l'orologio dell'host: nessuno dei due e' letto.
   */
  currentBid?: {
    playerId?: number | null;
    value?: number | null;
    teamId?: number | null;
    timestamp?: number | null;
  } | null;
}

/**
 * LE CHIAVI DI `state` CHE QUESTO LETTORE GUARDA. Tutto il resto e' roba che il tavolo pubblica e noi
 * non leggiamo, ed e' esattamente li' che vive il calciatore attualmente in asta.
 *
 * Derivata da `RawState` a mano e non dal tipo, perche' un'interfaccia TypeScript non esiste a runtime:
 * il prezzo e' che aggiungendo un campo a `RawState` va aggiunto anche qui, e un test lo pretende - una
 * chiave letta che continua a comparire fra le «non lette» e' una diagnostica che mente.
 */
export const READ_KEYS: readonly string[] = [
  'status',
  'marketType',
  'settings',
  'playerListType',
  'options',
  'teams',
  'picks',
  'pickOrder',
  'turnTeamId',
  'selectedPlayerId',
  'currentBid',
];

/**
 * The LEAGUE's own facts - budget, game, roster slots. They live in `state.settings`, which is a
 * `LeagueSettings` in fanta-asta-live's source; `options.bids` is the RILANCI mechanics and merely
 * happens to carry them too when a host publishes the whole blob, so it is only the fallback.
 */
export function leagueSettings(state: RawState): Record<string, any> {
  return state.settings ?? state.options?.bids ?? {};
}

/**
 * THE CLUBS THE HOST SWITCHED OFF, from `state.settings.inactiveTeams` - observed on a live draft (FA-xxx-xxx, ppVer 1.25.0-live, 29/09/2026 - the code is redacted, as everywhere in this public repository): an
 * array of the listone's own club names (the ten Italian clubs of his EuroLeghe), while the players of those
 * clubs STAY in `env/playerList` (283 rows there). So a table that switches clubs off does not remove them
 * from its list, and reading the list alone would put them back in every pool. Lowercased, because the list
 * writes a club the way the listone does and a stray capital must not bring a club back.
 */
export function inactiveClubsOf(state: RawState): Set<string> {
  const raw = leagueSettings(state)['inactiveTeams'];
  return new Set(
    listOf<unknown>(raw).filter((one): one is string => typeof one === 'string').map((one) => one.trim().toLowerCase()),
  );
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
export function platformOf(
  state: RawState,
  players: Iterable<AuctionPlayer> = [],
): Platform | null {
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

/** The classic macro-role of each classic zone: on classic the zone IS the role. */
export const CLASSIC_OF_ZONE: Partial<Record<Zone, string>> = { gk: 'P', def: 'D', mid: 'C', atk: 'A' };

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
  /**
   * ...and the CHEAPEST keeper of the club, which in a DRAFT takes the same goal for less: the price of a
   * pick is the FVM of the man called, and any keeper grants the porta. It matters for the order (every
   * credit sends a squad back, §11.5) and for the FVM ceiling of the first turns, so it is on the row.
   */
  cheapest: number;
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
      ({ club: player.club, keepers: [], price: 0, cheapest: Infinity, teamId: null, pickIndex: null } as Porta);
    porta.keepers.push(player);
    porta.price = Math.max(porta.price, player.fvm);
    porta.cheapest = Math.min(porta.cheapest, player.fvm);
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

  // LO SLOT DI COLORE È IL RANGO PER `id` e non la posizione nell'array: l'ospite ripubblica lo stato
  // intero a ogni evento e niente promette che le rose tornino nello stesso ordine, mentre un colore
  // che cambia fra due poll è peggio di un colore brutto - «una rosa e' quella rossa» smetterebbe di
  // essere vero a metà asta. Il rango è deterministico e non dipende da quante rose ci sono.
  const seats = new Map<number, number>();
  [...listOf<any>(state.teams)]
    .filter(Boolean)
    .map((team) => team.id as number)
    .sort((a, b) => a - b)
    .forEach((id, rank) => seats.set(id, rank));

  return listOf<any>(state.teams).map((team) => {
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
      // IL NOME SI LEGGE DA TUTT'E TRE I POSTI IN CUI PUO' STARE. `label` e `nick` convivono sulla
      // stessa connessione - sul tavolo letto il 24/09/2026 l'host aveva entrambi a «host» - e chi
      // entra dopo puo' cambiarselo: leggerne uno solo farebbe restare a schermo il nome di prima.
      label: connection.label || connection.nick || team.name || `Squadra ${team.id}`,
      // IL COLORE LO DECIDE UN POSTO SOLO, e la sorgente resta l'asta vera quando ne pubblica uno: è
      // ciò che si vede sullo schermo della stanza, e ridipingerlo qui vorrebbe dire che la sua app e
      // il tabellone del banditore non sono d'accordo su chi è il rosso. Quando non ne pubblica -
      // ed è il caso del tavolo INVENTATO, che è quello su cui l'operatore segna la sua asta - vale
      // la palette, che prima di oggi era `currentColor`: dieci rose dello STESSO colore, cioè il
      // canale spento proprio dove non c'era nient'altro a distinguerle.
      colour: team.color ?? teamColour(seats.get(team.id) ?? 0),
      online: !!connection.active,
      host: !!connection.host,
      spent,
      /**
       * LA BORSA: il budget di lega PIU' I CREDITI EXTRA che l'host ha dato a questa rosa, meno quello
       * che ha speso.
       *
       * `deltaBudget` e' LETTO (24/09/2026, sessione `FA-xxx-xxx`: l'host ne aveva +8) e non e'
       * `currentBudget`, che resta il campo in RITARDO gia' misurato il 09/08 - nella stessa lettura
       * diceva 975 contro i 974 veri, cioe' era indietro di un pick da un credito. Quindi la spesa
       * continua a venire dai PICK, che sono giusti a ogni istante, e l'unica cosa che si prende dalla
       * rosa e' il regalo, che dai pick non si puo' dedurre.
       *
       * Assente vuol dire zero e non ignoto: e' un DELTA, e su sette rose di otto quel campo non c'era
       * affatto perche' nessuno aveva ricevuto niente.
       */
      budgetLeft: context.budget + (Number(team.deltaBudget) || 0) - spent,
      squad,
      missing,
      missingTotal,
      orderIndex: order.indexOf(team.id),
      onTheClock: team.id === onTheClockId,
    };
  });
}

/** Picks that still count: a released one is undone, not history. */
/**
 * UNA LISTA COME FIREBASE LA MANDA, CHE NON E' SEMPRE UNA LISTA.
 *
 * Il Realtime Database non ha array: li emula su chiavi `"0"`, `"1"`, ... e li serializza come ARRAY
 * solo finche' quelle chiavi sono contigue da zero. **Basta un buco e arriva un OGGETTO**, e un buco e'
 * esattamente quello che fa un'aggiudicazione ANNULLATA: togliendo il pick 1 di tre restano `{0, 2}`.
 * Da quel momento `(state.picks ?? []).filter(...)` non e' piu' un'operazione su un array - e' un
 * `TypeError` dentro un `computed`, cioe' la plancia che si spegne nell'istante in cui il banditore
 * corregge un errore. L'operatore l'ha chiesto per nome («le assegnazioni possono essere anche
 * annullate o modificate»), e la cura e' la stessa regola che questo progetto ha gia' scritto per gli
 * xG del provider: **il lettore impone la convenzione e non si fida della codifica.**
 *
 * Le chiavi si riordinano per NUMERO e non per stringa, o `"10"` starebbe fra `"1"` e `"2"`; i buchi
 * spariscono, perche' un posto vuoto non e' una riga.
 */
export function listOf<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value.filter((one) => one != null) as T[];
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => /^\d+$/.test(key))
      .sort((left, right) => Number(left[0]) - Number(right[0]))
      .map(([, one]) => one)
      .filter((one) => one != null) as T[];
  }
  return [];
}

export function livePicks(state: RawState): RawPick[] {
  return listOf<RawPick>(state.picks)
    .filter((pick) => !pick.released)
    .sort((a, b) => a.index - b.index);
}

/**
 * THE TABLE AS IT STOOD AFTER ITS FIRST `at` PICKS, for reviewing a draft one pick at a time.
 *
 * The picks after the cursor leave, and with them everything derived from them (squads, purses, the free
 * pool). What does NOT follow from the picks alone is the CALL ORDER, which the host recomputes after every
 * pick and publishes only as it is now - so it is rebuilt from the history instead: the order in which the
 * squads FIRST call again from the cursor on IS the order the table showed at the cursor. Under the
 * platform's rule (`auction-plan.ahead`) a pick moves only the squad that made it and never reorders the
 * others, so the squads that have not called since keep their relative order, and each reaches the head in
 * that order. Measured on the real draft FA-jo5-zai: the rule reproduces 384 picks of 384. It reads the
 * future only to recover a fact that was already fixed at the cursor, which is why nothing computed on the
 * result can see what was chosen after it. Squads that never call again (full rosters) come last, in the
 * order the host publishes now.
 *
 * The status goes back to «started»: at the cursor the draft is still being played. The two raise-auction
 * nodes are dropped, since they describe the room now and not then.
 */
export function rewindState(state: RawState, at: number): RawState {
  const picks = livePicks(state);
  if (at >= picks.length) return state;
  const cut = Math.max(0, Math.floor(at));
  const order: number[] = [];
  for (const pick of picks.slice(cut)) if (!order.includes(pick.teamId)) order.push(pick.teamId);
  const ids = listOf<any>(state.teams).filter(Boolean).map((team) => team.id as number);
  for (const id of [...(state.pickOrder ?? []), ...ids]) if (!order.includes(id)) order.push(id);
  return {
    ...state,
    picks: picks.slice(0, cut),
    pickOrder: order,
    turnTeamId: order[0],
    status: DraftStatus.Started,
    selectedPlayerId: null,
    currentBid: null,
  };
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

  if (
    kind === 'patch' &&
    target &&
    typeof target === 'object' &&
    data &&
    typeof data === 'object'
  ) {
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
  /**
   * The porte rule, as the LEAGUE declares it (`LeagueSettings.porte`): written by `GlobalOptions` and read
   * here, because it is a regulation and not a fact about a session. It used to be stored with the session.
   */
  readonly keeperMode = signal<KeeperMode>('players');

  /**
   * QUANTE PORTE ha una rosa, come la LEGA le dichiara (il campo dei portieri nelle rose delle Opzioni).
   * Scritto da `GlobalOptions` come `keeperMode`. Con le porte accese è il regolamento a dire quante se ne
   * prendono (operatore, 28/09/2026: «2 porte»), e la sessione le può dichiarare diversamente - i posti
   * portiere del software non sono le porte della lega. Null = nessuna dichiarazione, vale il tavolo.
   */
  readonly porteSlots = signal<number | null>(null);

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

  /** The table as the host publishes it (or as the demo holds it): what the stream writes and a refresh saves. */
  private readonly live = signal<RawState>({});

  /**
   * RIVEDERE UN DRAFT SCELTA PER SCELTA (operatore, 30/09/2026: «tasti avanti e indietro per navigare
   * un'asta draft passata: premendo indietro il cursore si sposta di una scelta indietro ignorando tutto
   * quello che succede dopo»). Quante scelte sono a schermo, o `null` per tutto quello che il tavolo ha.
   *
   * Vive QUI e non nella pagina perche' ogni numero del pannello - rose, borse, svincolati, ordine di
   * chiamata, consigli, scenari - si legge da `state`: troncare a monte e' il solo modo in cui nessuno di
   * loro possa sapere cosa e' successo dopo. Il salvataggio e lo stream restano su `live`, quindi rivedere
   * non tocca il tavolo vero ne' la copia che un refresh riprende.
   */
  readonly cursor = signal<number | null>(null);

  /** Every pick the table holds, whatever the cursor says: the «of M» of the review. */
  readonly totalPicks = computed(() => livePicks(this.live()).length);
  readonly reviewing = computed(() => this.cursor() !== null);

  private readonly state = computed<RawState>(() => {
    const at = this.cursor();
    return at === null ? this.live() : rewindState(this.live(), at);
  });
  /** The listone as it was served or saved, with both of its market values (`fvmByGame`). */
  private readonly listone = signal<Map<number, AuctionPlayer>>(new Map());
  /**
   * The listone PRICED IN THE TABLE'S GAME. The listone is read before the state that says the game, so it
   * keeps both values and the price is chosen here: until 30/09/2026 the mantra one was taken for every
   * table, and a classic Serie A draft read Calhanoglu at 250 where the host prices him 220.
   */
  private readonly players = computed<Map<number, AuctionPlayer>>(() => {
    const all = this.listone();
    const mantra = this.isMantra();
    if (![...all.values()].some((player) => player.fvmByGame)) return all;
    return new Map([...all].map(([id, player]) => [id, pricedFor(player, mantra)]));
  });

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
   * True while the table on screen is INVENTED (`startDemo`).
   *
   * It is a state of the FEED and not a flag of the view, because three different things have to obey
   * it - the panel must say so, nothing may be saved, and `connected()` must stay false - and three
   * copies of «are we pretending?» would eventually disagree.
   */
  readonly demo = computed(() => this.status() === 'demo');

  /**
   * Whether there is a table to SHOW - which is not the same as being connected.
   *
   * After a refresh the saved mirror is on screen while the stream is still opening, and gating the
   * panel on the socket meant the operator looked at the code card with the whole table already in
   * memory. What the panel needs is a state; what the header needs is to say whether it is live.
   */
  readonly hasTable = computed(
    () => this.connected() || this.demo() || (this.stale() && !!this.state().teams),
  );


  /**
   * IL MARCHIO DELLA TAVOLA SALVATA, in un posto solo per le due pagine d'asta.
   *
   * Deve dire due cose e non una: che quello che si legge e' SALVATO, e se il riaggancio sta ancora
   * andando o e' fallito. Un tavolo vecchio letto come vivo e' esattamente il numero che questo
   * progetto rifiuta di stampare, e un refresh che non dice niente si legge come un collegamento
   * perso. Vive qui e non nelle viste perche' `stale`, `savedAt`, `status` ed `error` sono del feed:
   * due copie della stessa frase finirebbero per raccontare due stati.
   */
  readonly savedLabel = computed(() =>
    this.status() === 'error' ? '· salvato · riaggancio non riuscito' : '· salvato · riaggancio in corso',
  );

  readonly savedNote = computed(() => {
    const saved = this.savedAt();
    const when = saved ? ` (${new Date(saved).toLocaleTimeString('it-IT')})` : '';
    return this.status() === 'error'
      ? `Ultimo stato salvato in questo browser${when}. Il riaggancio non è riuscito: ${this.error() ?? ''} I numeri restano quelli di quel momento.`
      : `Ultimo stato salvato in questo browser${when}. Il collegamento è in corso: appena arriva, la pagina si aggiorna da sé.`;
  });

  /**
   * COSA IL TAVOLO PUBBLICA E NOI NON LEGGIAMO, chiave per chiave e col suo valore accanto.
   *
   * Non e' un attrezzo di sviluppo: e' lo strumento che risponde alla domanda aperta di questo file -
   * dove sta, in una sessione A RILANCI, il calciatore attualmente in asta. Le due sole sessioni che
   * questo progetto ha mai letto erano DRAFT (`marketType: 1`), dove un lotto non esiste, quindi
   * «non e' pubblicato» era un'assenza di sguardo e non una misura. Questa riga la trasforma in una
   * lettura, senza terminale e senza chiedere a nessuno di incollare un payload.
   *
   * I VALORI SONO TRONCATI e i nomi dei calciatori non ci passano comunque - qui c'e' lo `state`, non
   * il listone - ma un numero e' un numero: se una di queste chiavi porta un `playerId`, si vede.
   */
  readonly unreadState = computed<{ key: string; value: string }[]>(() => {
    const state = this.state() as Record<string, unknown>;
    return Object.keys(state)
      .filter((key) => !READ_KEYS.includes(key))
      .map((key) => {
        let value: string;
        try {
          value = JSON.stringify(state[key]) ?? String(state[key]);
        } catch {
          value = '(non serializzabile)';
        }
        return { key, value: value.length > 300 ? `${value.slice(0, 300)}…` : value };
      });
  });

  /**
   * IL CALCIATORE CHE IL TAVOLO HA IN ASTA ADESSO, o `null` se non lo dice.
   *
   * Un `0` non e' un id e non e' «nessuno»: e' un campo che qualcuno ha azzerato, quindi si legge come
   * un'assenza invece di andare a cercare un giocatore che non esiste - «vuoto = ignoto, mai zero»
   * dal lato di chi riceve.
   *
   * QUELLO CHE NON SI SA, e va detto invece di lasciarlo scoprire: cosa porta questo campo FRA due
   * lotti. Alla lettura del 24/09/2026 un nome era sempre in asta, quindi se il tavolo lo azzeri o lo
   * lasci sull'ultimo non e' osservato. Chi lo legge non ne ha bisogno per stare in piedi: un uomo
   * gia' venduto esce da se' dal confronto con gli acquisti (`plancia.lotUp`).
   */
  readonly selectedPlayerId = computed<number | null>(() => {
    const id = this.state().selectedPlayerId;
    return typeof id === 'number' && id > 0 ? id : null;
  });

  /**
   * QUANTO E' STATO OFFERTO, e SU CHI - i due fatti viaggiano insieme perche' separarli e' il modo di
   * stampare una cifra vera sull'uomo sbagliato (vedi `RawState.currentBid`).
   *
   * Zero e' un'offerta legittima e non un'assenza: subito dopo un'estrazione la stanza e' ferma, e
   * dirlo e' il contrario di «non lo so». Quello che si rifiuta e' un `playerId` che non e' un id - e'
   * il `0` di `selectedPlayerId` letto qui - e un valore che non e' un numero.
   */
  readonly currentBid = computed<{ playerId: number; value: number } | null>(() => {
    const bid = this.state().currentBid;
    const who = bid?.playerId;
    const value = bid?.value;
    if (typeof who !== 'number' || !(who > 0)) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
    return { playerId: who, value };
  });

  readonly league = computed(() => leagueSettings(this.state()));
  readonly listType = computed<ListType | null>(() => listTypeOf(this.state()));
  readonly platform = computed<Platform | null>(() =>
    platformOf(this.state(), this.players().values()),
  );

  /** The raise mechanics: countdown, minimum bid, buzzer. Unused until the bids mode is followed. */
  readonly bidRules = computed(() => this.state().options?.bids ?? null);
  readonly draftRules = computed(() => this.state().options?.draft ?? null);

  /** Con che meccanismo si compra, o `null` se il tavolo non lo dice: «vuoto = ignoto, mai rilanci». */
  readonly market = computed<MarketType | null>(() => {
    const kind = this.state().marketType;
    return kind === MarketType.Draft || kind === MarketType.Bids ? kind : null;
  });

  readonly isDraft = computed(() => this.state().marketType === MarketType.Draft);
  readonly draftStatus = computed(() => this.state().status ?? DraftStatus.Loading);
  readonly budget = computed<number>(() => this.league()['budget'] ?? 0);
  readonly game = computed<GameType>(() => this.league()['game'] ?? GameType.Classic);
  readonly isMantra = computed(() => this.game() === GameType.Mantra);

  readonly zones = computed<Zone[]>(() =>
    this.isMantra() ? ['gk', 'mov'] : ['gk', 'def', 'mid', 'atk'],
  );

  readonly picks = computed<RawPick[]>(() => livePicks(this.state()));

  /**
   * THE HOST'S ORDER RULE (`auction-plan.PickOrderType`): `state.pickOrderType`, else `options.draft`'s, else
   * `default` - the rule the page was built on. Observed `pingpong` on the classic draft FA-yei-458 (30/09/2026):
   * a snake, where a dear pick sends nobody down the order.
   */
  readonly orderType = computed<PickOrderType>(() => {
    const raw = this.state().pickOrderType ?? this.draftRules()?.['pickOrderType'];
    return raw === 'pingpong' ? 'pingpong' : 'default';
  });

  /**
   * THE FIRST ROUND'S ORDER, which a snake repeats and reverses: the squads in the order of their first pick, then
   * the ones that have not picked yet in the order the host publishes. Read from the HISTORY because the published
   * `pickOrder` is the round being played, which after the first round is not the first one.
   */
  readonly firstRoundOrder = computed<number[]>(() => {
    const order: number[] = [];
    for (const pick of this.picks()) if (!order.includes(pick.teamId)) order.push(pick.teamId);
    for (const id of this.state().pickOrder ?? []) if (!order.includes(id)) order.push(id);
    return order;
  });

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

  /**
   * WHETHER THE TABLE SAYS ANYTHING ABOUT SWITCHED-OFF CLUBS, which is not the same as «none are off». Read on
   * FA-jo5-zai on 30/09/2026: during the live draft `settings.inactiveTeams` carried the Serie A clubs (283 of
   * their men, and not one of the 384 picks is Serie A), and once the draft was over the key was GONE while
   * the 284 men were still in the listone. Firebase also drops an empty list, so an absent key cannot tell
   * «none are off» from «the host no longer publishes it»: absent is unknown («vuoto = ignoto, mai zero»).
   */
  readonly declaresInactive = computed(() => leagueSettings(this.state())['inactiveTeams'] != null);

  /** The clubs the host switched off (`inactiveClubsOf`). Their men are not considered anywhere. */
  readonly inactiveClubs = computed(() => inactiveClubsOf(this.state()));

  /**
   * THE LISTONE WITHOUT THE CLUBS THE HOST SWITCHED OFF (the operator, 29/09/2026: «nascondi, non considerarli
   * proprio»): every pool the panels read - the free men, the listone a sheet is matched and a zero is measured
   * on, the goals - comes from here. What stays on the whole list is only what resolves a PICK already made
   * (`teams`, `lastPicks`) and the saved snapshot, which must reproduce the session as it was served.
   */
  private readonly activePlayers = computed<Map<number, AuctionPlayer>>(() => {
    const off = this.inactiveClubs();
    const all = this.players();
    if (!off.size) return all;
    return new Map([...all].filter(([, player]) => !off.has((player.club ?? '').trim().toLowerCase())));
  });

  /** The listone still free, dearest first. */
  readonly available = computed<AuctionPlayer[]>(() => {
    const taken = new Set(this.picks().map((pick) => pick.playerId));
    return [...this.activePlayers().values()]
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
  readonly listoneIds = computed<number[]>(() => [...this.activePlayers().keys()]);

  /** The real clubs the session's listone names, taken and free alike: what the excluded clubs follow. */
  readonly listoneClubs = computed<string[]>(() => [...new Set([...this.activePlayers().values()].map((p) => p.club))]);

  readonly isGoalsMode = computed(() => this.keeperMode() === 'goals');

  /** Every club's goal, with who owns it. Only meaningful while the porte rule is on. */
  private readonly portaState = computed(() =>
    porteOf(this.activePlayers().values(), this.picks(), this.isMantra()),
  );

  /** The goals still free, dearest first: one row per CLUB, not per keeper. */
  readonly freePorte = computed<Porta[]>(() =>
    this.portaState()
      .porte.filter((porta) => porta.teamId === null)
      .sort((a, b) => b.price - a.price),
  );

  /**
   * Which goal each keeper belongs to, for EVERY club of the listone.
   *
   * With the porte rule on the unit on screen is the CLUB (operator, 28/09/2026: «non mostrassi più il nome
   * del portiere ma della squadra»), so whoever draws a keeper - a squad, the last picks, the pitch - asks
   * here which porta he stands for. One map and not a lookup per reader, or two lists would name the same
   * pick two ways.
   */
  readonly portaOfKeeper = computed<Map<number, Porta>>(() => {
    const out = new Map<number, Porta>();
    for (const porta of this.portaState().porte) {
      for (const keeper of porta.keepers) out.set(keeper.id, porta);
    }
    return out;
  });

  /** Every goal of the listone, owned or free. */
  readonly porte = computed<Porta[]>(() => this.portaState().porte);

  /**
   * The name a man is SHOWN under: the club for a keeper while the porte rule is on, his own otherwise.
   * The keeper who was called is not a fact about the squad any more - the goal is.
   */
  shownName(player: AuctionPlayer | null | undefined): string {
    if (!player) return '';
    const porta = this.isGoalsMode() ? this.portaOfKeeper().get(player.id) : undefined;
    return porta ? porta.club : player.name;
  }

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
    const required = this.porteSlots() ?? (Array.isArray(slots) ? slots[0] : (slots ?? 0));
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

  /**
   * A man's roles IN THE TABLE'S GAME: his Mantra codes on a mantra table, his classic macro-role on a classic one.
   * The live listone carries the Mantra codes on every row whatever the game (30/09/2026), so reading `roles` on a
   * classic table drew «Dc» where the game scores a D, and the P/D/C/A filter matched nobody. One reader for the
   * list, the pitch, the plans and the Draft Priority.
   */
  gameRoles(player: AuctionPlayer | null): string[] {
    if (!player) return [];
    if (this.isMantra()) return player.roles;
    const classic = CLASSIC_OF_ZONE[player.zoneClassic];
    return classic ? [classic] : [];
  }

  async connect(input: string, preserve = false, follow: number | null = null): Promise<boolean> {
    const matched = input?.match(CODE_PATTERN)?.[0];
    if (!matched) {
      this.fail('Codice non valido. Il formato è FA-xxx-xxx.');
      return false;
    }
    const code = `FA-${matched.slice(3).toLowerCase()}`;

    // `preserve` is for the re-join after a refresh: the saved table is already on screen and wiping it
    // would blank the panel for as long as the network takes.
    if (!preserve) this.disconnect();
    // THE SQUAD A RE-JOIN FOLLOWS survives the wipe (30/09/2026, found replaying a real classic draft): with the
    // code saved and no snapshot to paint, `disconnect` above forgot the squad `restore` had just set, and the
    // `remember` below then wrote `teamId: null` - so the panel came back following nobody, with no predictions
    // and no «pieno», and every later refresh stayed that way.
    if (follow !== null) this.followedTeamId.set(follow);
    this.status.set('connecting');

    try {
      this.token = await this.signInAnonymously();

      const listone = await this.read<Record<string, any>>(`${code}/env/playerList`);
      if (!listone) {
        // A 200 carrying null: the session is gone, which is a fact about the auction and not a glitch.
        this.failure.set('missing');
        throw new Error(`Nessuna asta trovata con il codice ${code}.`);
      }
      this.listone.set(this.parseListone(listone));

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

    if (stored.teamId !== null && stored.teamId !== undefined) {
      this.followedTeamId.set(stored.teamId);
    }
    // Paint what we had BEFORE going to the network: the panel is useful in the same instant, and the
    // stream replaces it a moment later. `preserve` keeps it from being wiped by the connect.
    const painted = this.paintSnapshot(stored.code);
    const connected = await this.connect(stored.code, painted, stored.teamId ?? null);
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

    this.cursor.set(null);
    this.mirror = saved.state;
    this.live.set({ ...saved.state });
    if (saved.players?.length) {
      this.listone.set(new Map(saved.players.map((player) => [player.id, player])));
    }
    this.code.set(code);
    this.savedAt.set(saved.savedAt ?? null);
    this.stale.set(true);
    this.status.set('connecting');
    return true;
  }

  /**
   * Shows an INVENTED table, so the panel can be looked at without a real auction behind it.
   *
   * Everything a session brings from the network is fabricated by the caller - the squads, the pick
   * order, the picks already made - while the PLAYERS are the bundle's own. That asymmetry is the whole
   * point and not a shortcut: a demo built on invented names would join no sheet at all (the join is on
   * `fc_id`), so every engine column would read «—» and the operator would be shown the layout of a
   * panel with none of the numbers it exists for.
   *
   * It touches no network and no storage. Not saving it is a requirement rather than a simplification:
   * a demo that survived a refresh would be indistinguishable from a followed session at the next look,
   * and writing it would overwrite the real table this browser may be holding for a live auction.
   */
  startDemo(session: { players: AuctionPlayer[]; state: RawState; mineId: number }): void {
    this.disconnect();
    this.mirror = session.state;
    this.live.set({ ...session.state });
    this.listone.set(new Map(session.players.map((player) => [player.id, player])));
    this.code.set(DEMO_CODE);
    this.followedTeamId.set(session.mineId);
    this.savedAt.set(null);
    this.stale.set(false);
    this.failure.set(null);
    this.status.set('demo');
  }

  /**
   * ONE PICK WRITTEN BY HAND, on the invented table only.
   *
   * The operator's own auction is run by somebody else's software and this panel is not connected to
   * it (his decision of 03/09/2026: the connection is a button), so the only way the board can follow
   * a real room is for him to say who took the lot - which is what the double click on a squad card
   * asks for (04/09/2026).
   *
   * NEVER on a live session, and that is a requirement rather than caution: a real table's picks
   * belong to the host, the next stream event would erase the row a moment after it appeared, and a
   * mirror that disagrees with its table is the one defect this file is built to avoid. Refusing a man
   * somebody already has is the same rule from the other side - two picks for one player would give
   * him two owners, and `livePicks` would hand both of them out.
   */
  awardByHand(playerId: number, teamId: number, cost: number): boolean {
    if (!this.demo()) return false;
    this.cursor.set(null);
    const picks = listOf<RawPick>(this.mirror.picks);
    if (picks.some((pick) => !pick.released && pick.playerId === playerId)) return false;
    // The index is the ORDER of the awards, so it continues the fixture's own numbering instead of
    // restarting at the length: `livePicks` sorts on it, and a repeated index is a shuffled history.
    const index = picks.reduce((top, pick) => Math.max(top, pick.index), -1) + 1;
    this.mirror = { ...this.mirror, picks: [...picks, { index, teamId, playerId, cost }] };
    this.live.set({ ...this.mirror });
    return true;
  }

  /**
   * EMPTIES EVERY SQUAD of the invented table: no picks, full budgets, every man back in the urn.
   *
   * It is what the board opens on at a REAL auction (his request of 04/09/2026), because the fixture
   * plays a third of its own auction before handing over and those purchases are nobody's. The league
   * itself - seats, budget, slots, the ten labels - is left exactly as it is: what is being reset is
   * the rosters and not the regulation.
   *
   * Demo only, for `awardByHand`'s reason: a live table's picks are not ours to erase.
   */
  emptySquads(): boolean {
    if (!this.demo()) return false;
    this.cursor.set(null);
    this.mirror = { ...this.mirror, picks: [] };
    this.live.set({ ...this.mirror });
    return true;
  }

  /**
   * L'ORDINE DI CHIAMATA del tavolo inventato, riscritto da chi lo ricalcola dopo una scelta a mano.
   *
   * Solo sulla demo, per la ragione di `awardByHand`: l'ordine di un tavolo vero lo pubblica l'host. Il
   * feed non sa calcolarlo (la regola e' `auction-plan.ahead`, e importarla qui chiuderebbe un ciclo), quindi
   * lo riceve gia' fatto da `AuctionDemo`, che e' anche chi ha costruito quello iniziale.
   */
  setDemoOrder(order: number[]): boolean {
    if (!this.demo()) return false;
    this.mirror = { ...this.mirror, pickOrder: order, turnTeamId: order[0] };
    this.live.set({ ...this.mirror });
    return true;
  }

  /** Toglie l'ULTIMA scelta del tavolo inventato: un doppio click sbagliato non deve costare un'asta. */
  undoLastByHand(): boolean {
    if (!this.demo()) return false;
    this.cursor.set(null);
    const picks = listOf<RawPick>(this.mirror.picks).filter((pick) => !pick.released);
    if (!picks.length) return false;
    const last = picks.reduce((top, pick) => (pick.index > top.index ? pick : top));
    this.mirror = { ...this.mirror, picks: picks.filter((pick) => pick !== last) };
    this.live.set({ ...this.mirror });
    return true;
  }

  /** One pick back: from the end, the last pick leaves the screen. */
  back(): void {
    const at = this.cursor() ?? this.totalPicks();
    if (at > 0) this.cursor.set(at - 1);
  }

  /** One pick forward; past the last one the review ends and the table is shown whole again. */
  forward(): void {
    const at = this.cursor();
    if (at === null) return;
    this.cursor.set(at + 1 >= this.totalPicks() ? null : at + 1);
  }

  /** To the first pick: the draft before anybody chose. */
  toStart(): void {
    if (this.totalPicks() > 0) this.cursor.set(0);
  }

  /** Back to everything the table holds. */
  toEnd(): void {
    this.cursor.set(null);
  }

  follow(teamId: number) {
    this.followedTeamId.set(teamId);
    this.remember();
  }

  unfollow() {
    this.followedTeamId.set(null);
    this.remember();
  }

  /** Closes the stream and empties the mirror. It does NOT forget the session: `connect` calls it. */
  disconnect() {
    this.closeStream();
    this.cursor.set(null);
    this.mirror = {};
    this.live.set({});
    this.listone.set(new Map());
    this.code.set(null);
    this.followedTeamId.set(null);
    this.status.set('idle');
    this.error.set(null);
  }

  /**
   * LASCIARE IL TAVOLO SU RICHIESTA, in un posto solo: lo stream se ne va e la sessione si dimentica.
   *
   * Le due chiamate hanno una condizione che e' facile sbagliare, ed e' la ragione per cui vivono qui e
   * non in chi preme il bottone: **lasciare una DEMO non deve dimenticare l'asta vera** che questo
   * browser puo' avere in memoria. Il tavolo inventato non e' mai stato salvato, quindi non ha niente
   * di suo da togliere, e un `forget()` li' cancellerebbe la sessione di qualcun altro - cioe' proprio
   * quella che un refresh deve riprendere.
   *
   * Quello che NON fa e' rimettere un tavolo a schermo: quale sia il tavolo di ripiego e' una decisione
   * della PAGINA (la plancia torna alla finzione, il pannello draft alla sua), e deciderlo qui
   * vorrebbe dire che il feed sa quale pagina lo sta usando.
   */
  leave() {
    const wasDemo = this.demo();
    this.disconnect();
    if (!wasDemo) this.forget();
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
    // An invented table is never remembered: see `startDemo`.
    if (!code || this.demo()) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          code,
          teamId: this.followedTeamId(),
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
    if (!code || this.demo()) return;
    const now = performance.now();
    if (now - this.lastSaved < SNAPSHOT_THROTTLE_MS) {
      if (!this.trailing) {
        this.trailing = setTimeout(
          () => {
            this.trailing = null;
            this.rememberState();
          },
          SNAPSHOT_THROTTLE_MS - (now - this.lastSaved),
        );
      }
      return;
    }
    this.lastSaved = now;

    const players = [...this.listone().values()];
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
      const classic = Number(entry.stats?.fmv?.classic);
      const mantra = Number(entry.stats?.fmv?.mantra);
      players.set(entry.id, {
        id: entry.id,
        name: entry.name ?? entry.fullName,
        club: entry.team,
        roles: entry.roles ?? [],
        zoneClassic: entry.zone?.classic,
        zoneMantra: entry.zone?.mantra,
        championship: entry.championship?.label ?? null,
        fvm: entry.stats?.fmv?.[key] ?? 0,
        // Both, when the row carries both: the game is not known yet, and `players` prices by it.
        ...(Number.isFinite(classic) && Number.isFinite(mantra) ? { fvmByGame: { classic, mantra } } : {}),
      });
    }
    return players;
  }

  /** The listone is read before the state arrives, so the game type is not known yet: this picks only the
   *  PROVISIONAL `fvm`, and `players` re-prices every row that carries both values once the game is known. */
  private isMantraListone(raw: Record<string, any>): boolean {
    return Object.values(raw).some((entry) => entry.stats?.fmv?.mantra !== undefined);
  }

  /**
   * Firebase streams a session over server-sent events: one `put` with the whole node on connect,
   * then a `put` or `patch` per change. Applying them to a local mirror is what keeps the panel
   * in step with the table without polling.
   */
  private openStream(code: string) {
    const stream = new EventSource(
      `${DATABASE_URL}/sessions/${code}/state.json?auth=${this.token}`,
    );
    this.stream = stream;

    const apply = (kind: 'put' | 'patch') => (event: MessageEvent) => {
      const message = JSON.parse(event.data) as { path: string; data: unknown };
      this.mirror = applyStreamEvent(this.mirror, kind, message.path, message.data);
      this.live.set({ ...this.mirror });
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
