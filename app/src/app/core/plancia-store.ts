/**
 * The state behind `/plancia`: the slot board of a random-extraction auction.
 *
 * Two sources, one shape. By DEFAULT the board opens on an invented table with the standard league
 * settings (`plancia-demo.ts`), and connecting to a real fanta-asta session is something the operator
 * ASKS for with a button - his decision of 03/09/2026, and it holds for the draft panel too. The rest
 * of this file cannot tell the two apart, which is the point: one set of numbers, and a banner that
 * says which table they describe.
 *
 * WHAT A LIVE SESSION DOES NOT CARRY, stated instead of invented: fanta-asta-live publishes the raise
 * MECHANICS (`options.bids`: countdown, minimum bid, buzzer) and this project has never observed a node
 * naming the lot currently on the table. So the lot is drawn by the fixture in demo and NAMED BY HAND
 * when live, and `lotSource` says which - a field guessed from a payload nobody has read would be the
 * defect this repository has already paid for.
 */

import { Injectable, computed, inject, signal } from '@angular/core';

import { AuctionFeed, AuctionPlayer, Zone } from './auction-feed';
import { demoPlayers } from './auction-demo';
import { EngineNumbers, ValuationBasis, valuationOf } from './auction-value';
import { Bundle, EngineSheetEntry } from './bundle';
import { engineNumbersFrom } from './engine-sheet';
import {
  Alternative,
  LotAdvice,
  PlanciaMan,
  PlanciaMap,
  Role,
  ROLES,
  SlotBlock,
  adviseLot,
  alternativeFor,
  buildMap,
  offerBand,
} from './plancia';
import { STANDARD_LEAGUE, buildRandomAuction, roleOf } from './plancia-demo';

/** The four letters of the board's lines, from the two alphabets the feed splits the outfield into. */
const ZONE_ROLE: Record<string, Role> = { gk: 'P', def: 'D', mid: 'C', atk: 'A' };
const ROLE_ZONE: Record<Role, Zone> = { P: 'gk', D: 'def', C: 'mid', A: 'atk' };

export type LotSource = 'demo' | 'manual' | 'none';

/** A row of the board: the man, and what has happened to him. */
export type ManState = 'urna' | 'mio' | 'altro' | 'asta';

export interface BoardMan extends PlanciaMan {
  state: ManState;
  /** What he was paid, once somebody has him; the max offer while he is still in the urn. */
  price: number | null;
  ownerId: number | null;
  ownerLabel: string | null;
  ownerColour: string | null;
}

export interface BoardBlock extends SlotBlock {
  rows: BoardMan[];
  /** How many of the `teams` men are still in the urn. Zero means exhausted - and that lifts a ceiling. */
  left: number;
  /** True when one of them is mine, which is the only thing a compact block has to say about me. */
  mine: boolean;
}

/** A participant as the strip draws him: credits, four numbers, and whether he is in on THIS lot. */
export interface BoardTeam {
  id: number;
  label: string;
  colour: string;
  credits: number;
  /** Places still to fill, in P·D·C·A order - four numbers and no four labels. */
  missing: number[];
  me: boolean;
  /** He has a free place in the lot's role AND the credits to reach the band. */
  rival: boolean;
  /** He cannot reach the band at all: an absence, not a danger. */
  out: boolean;
}

export interface Lot {
  man: BoardMan;
  block: BoardBlock;
  /** What the table is at right now. Zero before anybody has bid. */
  price: number;
  advice: LotAdvice;
  alternative: Alternative | null;
  /** How many blocks below his are already empty - the thing that lifts the ceiling by half. */
  exhaustedBelow: number;
}

@Injectable({ providedIn: 'root' })
export class PlanciaStore {
  private readonly bundle = inject(Bundle);
  private readonly feed = inject(AuctionFeed);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Which sheet prices the board, so the page can NAME it with its revision. */
  readonly sheet = signal<EngineSheetEntry | null>(null);

  private readonly numbers = signal<Map<number, EngineNumbers>>(new Map());
  private readonly listone = signal<AuctionPlayer[]>([]);

  private readonly lotId = signal<number | null>(null);
  readonly lotPrice = signal(0);
  readonly lotSource = signal<LotSource>('none');

  /** True while the table on screen is invented. It is the FEED's state, never a second copy. */
  readonly demo = computed(() => this.feed.demo());
  readonly live = computed(() => this.feed.connected());
  readonly ready = computed(() => this.feed.hasTable() && this.men().length > 0);

  readonly teamsCount = computed(() => this.feed.teams().length || STANDARD_LEAGUE.teams);
  readonly budget = computed(() => this.feed.budget() || STANDARD_LEAGUE.budget);

  /** The roster shape the league declares, in the board's own four letters. */
  readonly slots = computed<Record<Role, number>>(() => {
    const roles = this.feed.league()['roles'] ?? {};
    const read = (zone: Zone, fallback: number) => {
      const value = roles[zone];
      const declared = Array.isArray(value) ? value[0] : value;
      return Number(declared) > 0 ? Number(declared) : fallback;
    };
    return {
      P: read('gk', STANDARD_LEAGUE.slots.P),
      D: read('def', STANDARD_LEAGUE.slots.D),
      C: read('mid', STANDARD_LEAGUE.slots.C),
      A: read('atk', STANDARD_LEAGUE.slots.A),
    };
  });

  /**
   * The listone as the board needs it: the room's price and the engine's expectation on one row.
   *
   * A man his own listone never quoted has no price and therefore no place on the board - pricing him
   * at zero would put a free man nobody could refuse at the top of a slot. A man the SHEET cannot
   * price keeps his place and carries no number: «vuoto = ignoto, mai zero» cuts both ways, and the
   * two absences are different facts.
   */
  private readonly men = computed<PlanciaMan[]>(() => {
    const numbers = this.numbers();
    const out: PlanciaMan[] = [];
    for (const player of this.listone()) {
      const role = roleOf(player);
      if (!role || !(player.fvm > 0)) continue;
      const valuation = valuationOf(numbers.get(player.id));
      const points =
        valuation.fm != null && valuation.pv != null ? valuation.fm * valuation.pv : null;
      out.push({
        id: player.id,
        name: player.name,
        club: player.club,
        role,
        fvm: player.fvm,
        points,
        pv: valuation.pv,
        basis: valuation.basis as ValuationBasis,
      });
    }
    return out;
  });

  readonly map = computed<PlanciaMap>(() => buildMap(this.men(), this.teamsCount(), this.slots()));

  /** Who owns whom, at what price - the only field of a live session that is right at every instant. */
  private readonly owners = computed(() => {
    const teams = new Map(this.feed.teams().map((team) => [team.id, team]));
    const out = new Map<number, { teamId: number; price: number }>();
    for (const pick of this.feed.picks()) {
      if (!teams.has(pick.teamId)) continue;
      out.set(pick.playerId, { teamId: pick.teamId, price: pick.cost ?? pick.value ?? 0 });
    }
    return out;
  });

  readonly mineId = computed(() => this.feed.followedTeamId());

  readonly blocks = computed<BoardBlock[]>(() => {
    const owners = this.owners();
    const teams = new Map(this.feed.teams().map((team) => [team.id, team]));
    const mine = this.mineId();
    const lot = this.lotId();
    const budget = this.budget();

    return this.map().blocks.map((block) => {
      const medianPoints = middleOf(block.men.map((man) => man.points));
      let left = 0;
      let hasMine = false;

      const rows: BoardMan[] = block.men.map((man) => {
        const owner = owners.get(man.id);
        const state: ManState =
          man.id === lot ? 'asta' : owner ? (owner.teamId === mine ? 'mio' : 'altro') : 'urna';
        if (state === 'urna' || state === 'asta') left += 1;
        if (state === 'mio') hasMine = true;
        const team = owner ? teams.get(owner.teamId) : null;
        return {
          ...man,
          state,
          price:
            owner?.price ??
            offerBand({
              role: block.role,
              slotIndex: block.index,
              budget,
              room: budget,
              points: man.points,
              medianPoints,
            })?.high ??
            null,
          ownerId: owner?.teamId ?? null,
          ownerLabel: team?.label ?? null,
          ownerColour: team?.colour ?? null,
        };
      });

      return { ...block, rows, left, mine: hasMine };
    });
  });

  private readonly blockById = computed(
    () => new Map(this.blocks().map((block) => [block.id, block])),
  );

  /** My own squad, which is the one whose room decides every ceiling on screen. */
  readonly me = computed(() => this.feed.teams().find((team) => team.id === this.mineId()) ?? null);

  /**
   * How many rosters still want a role - the number that decides the second price (§23.1) and the one
   * nobody counts by hand at the fourth hour. Mine is NOT in it: it counts the hands raised against me.
   */
  handsFor(role: Role, floor = 0): number {
    const mine = this.mineId();
    return this.feed
      .teams()
      .filter(
        (team) =>
          team.id !== mine &&
          (team.missing[ROLE_ZONE[role]] ?? 0) > 0 &&
          team.budgetLeft >= Math.max(1, floor),
      ).length;
  }

  readonly lot = computed<Lot | null>(() => {
    const id = this.lotId();
    if (id == null) return null;
    const block = this.blocks().find((candidate) => candidate.rows.some((row) => row.id === id));
    const man = block?.rows.find((row) => row.id === id);
    if (!block || !man) return null;

    const budget = this.budget();
    const room = this.me()?.budgetLeft ?? budget;
    const medianPoints = middleOf(block.men.map((entry) => entry.points));
    const roleBlocks = this.map().byRole.get(block.role) ?? [];
    const exhaustedBelow = roleBlocks
      .filter((candidate) => candidate.index > block.index)
      .slice(0, 2)
      .filter((candidate) => (this.blockById().get(candidate.id)?.left ?? 0) === 0).length;

    const band = offerBand({
      role: block.role,
      slotIndex: block.index,
      budget,
      room,
      points: man.points,
      medianPoints,
      exhaustedBelow,
    });

    const hands = this.handsFor(block.role, band?.low ?? 1);
    const owners = this.owners();

    return {
      man,
      block,
      price: this.lotPrice(),
      exhaustedBelow,
      advice: adviseLot({
        role: block.role,
        slotIndex: block.index,
        band,
        medianFvm: block.medianFvm,
        tablePrice: this.lotPrice(),
        hands,
        teams: this.teamsCount(),
        exhaustedBelow,
        priced: man.basis !== 'none',
      }),
      alternative: alternativeFor(
        this.map(),
        block,
        (candidate) => !owners.has(candidate.id) && candidate.id !== id,
        id,
        (candidate) => this.offerOf(candidate.id),
      ),
    };
  });

  /** Max offer by id, from the board itself: one pricing, so a row and a pair cannot disagree. */
  private readonly offers = computed(() => {
    const out = new Map<number, number>();
    for (const block of this.blocks()) {
      for (const man of block.rows) if (man.price != null) out.set(man.id, man.price);
    }
    return out;
  });

  private offerOf(id: number): number {
    return this.offers().get(id) ?? 0;
  }

  /**
   * THE PAIR BEHIND EVERY NAME, precomputed once per board.
   *
   * It is on every row and not only on the lot because that count is the work the board exists for: the
   * alternative degrades as the auction empties, and at the fourth hour nobody holds «who is left in the
   * slot below» in his head. Cheap because it is a fact about the BLOCK and not about the man - the two
   * best still in the urn one slot down are the same for all ten of them - so it is computed 25 times
   * and not 250. The keepers are the exception and are done per man, because there the alternative is
   * another keeper of his OWN slot and he cannot be his own alternative.
   */
  readonly pairs = computed<Map<number, Alternative | null>>(() => {
    const owners = this.owners();
    const map = this.map();
    const free = (man: PlanciaMan) => !owners.has(man.id);
    const cost = (man: PlanciaMan) => this.offerOf(man.id);
    const out = new Map<number, Alternative | null>();

    for (const block of map.blocks) {
      if (block.role === 'P') {
        for (const man of block.men) {
          if (owners.has(man.id)) continue;
          out.set(man.id, alternativeFor(map, block, free, man.id, cost));
        }
        continue;
      }
      const shared = alternativeFor(map, block, free, -1, cost);
      for (const man of block.men) if (!owners.has(man.id)) out.set(man.id, shared);
    }
    return out;
  });

  readonly teams = computed<BoardTeam[]>(() => {
    const mine = this.mineId();
    const lot = this.lot();
    const role = lot?.block.role ?? null;
    const floor = lot?.advice.band?.low ?? 1;

    return this.feed.teams().map((team) => {
      const missing = ROLES.map((entry) => team.missing[ROLE_ZONE[entry]] ?? 0);
      const wantsRole = role ? (team.missing[ROLE_ZONE[role]] ?? 0) > 0 : false;
      const canPay = team.budgetLeft >= Math.max(1, floor);
      return {
        id: team.id,
        label: team.label,
        colour: team.colour,
        credits: team.budgetLeft,
        missing,
        me: team.id === mine,
        rival: team.id !== mine && wantsRole && canPay,
        out: team.id !== mine && !canPay,
      };
    });
  });

  /** How much of the auction is gone, per role: the only progress figure a free extraction has. */
  readonly progress = computed(() =>
    ROLES.map((role) => {
      const blocks = this.map().byRole.get(role) ?? [];
      const total = blocks.length * this.teamsCount();
      const left = blocks.reduce(
        (sum, block) => sum + (this.blockById().get(block.id)?.left ?? 0),
        0,
      );
      return { role, done: total - left, total };
    }),
  );

  /** The tail: a count and no names, because a board that hides it talks you into waiting. */
  readonly tail = computed(() => {
    const owners = this.owners();
    return this.map().tail.filter((man) => !owners.has(man.id)).length;
  });

  /**
   * Opens the board on an invented table. Called on load, so the page never opens on a code field.
   *
   * `force` re-rolls it; without it a board that already has a table is left alone, or navigating back
   * would throw away an auction the operator is in the middle of.
   */
  async startDemo(force = false): Promise<boolean> {
    if (!force && this.feed.hasTable() && this.men().length) return true;
    this.loading.set(true);
    this.error.set(null);
    try {
      const players = await this.loadListone();
      // The STANDARD settings and not the sheet's: what the fixture is for is testing the board on the
      // league every published number of the bench is measured against (ten seats, 1000 credits,
      // 3/8/8/6). A sheet built for a twelve-team league would silently change the width of every slot,
      // which is the one coordinate the whole page stands on.
      const auction = buildRandomAuction({ players, ...STANDARD_LEAGUE });
      this.feed.startDemo(auction);
      this.lotSource.set('demo');
      this.setLot(auction.lotId);
      // The drawn name can be one of the TAIL's, which has no block and therefore no advice: the board
      // must still open on a decision, so it falls back to the first man still in the urn - in map
      // order, so the fixture stays reproducible.
      if (!this.lot()) this.setLot(this.firstFree());
      return true;
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Non riesco ad aprire la plancia.');
      return false;
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Connects to a real session, keeping the sheet and the listone the board is already drawn on.
   *
   * The board's own listone comes from the SHEET and not from the session: the two meet on `fc_id`,
   * which is this project's primary key, so a live table prices its men with the same numbers the
   * demo did. What the live table brings is the squads, the credits and the picks.
   */
  async connect(code: string): Promise<boolean> {
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.loadListone();
      const ok = await this.feed.connect(code);
      if (ok) {
        this.lotSource.set('manual');
        this.setLot(null);
      } else {
        this.error.set(this.feed.error());
      }
      return ok;
    } finally {
      this.loading.set(false);
    }
  }

  /** Names the lot on the table. `null` clears it - between two extractions there is no lot. */
  setLot(id: number | null): void {
    this.lotId.set(id);
    this.lotPrice.set(0);
  }

  /** The first man still in the urn, in map order. Deterministic: a fixture nobody can reproduce is a
   *  fixture nobody can report a defect about. */
  private firstFree(): number | null {
    const owners = this.owners();
    for (const block of this.map().blocks) {
      const free = block.men.find((man) => !owners.has(man.id));
      if (free) return free.id;
    }
    return null;
  }

  /** Draws the next name out of the urn. Only the fixture can do this: a real urn is not ours to turn. */
  drawNext(): void {
    if (!this.demo()) return;
    const owners = this.owners();
    const free = this.map()
      .blocks.flatMap((block) => block.men)
      .filter((man) => !owners.has(man.id) && man.id !== this.lotId());
    if (!free.length) return this.setLot(null);
    this.setLot(free[Math.floor(Math.random() * free.length)].id);
  }

  private async loadListone(): Promise<AuctionPlayer[]> {
    if (this.listone().length) return this.listone();

    const manifest = await this.bundle.manifest();
    const sheets = manifest.engine_sheets ?? [];
    if (!sheets.length) {
      throw new Error(
        'Il bundle non porta nessun foglio del motore: senza numeri la plancia mostrerebbe solo caselle vuote. ' +
          'Lancia "snapshot --league NOME" e poi "export".',
      );
    }
    // THE SHEET HAS TO MATCH THE LEAGUE, and not merely be the fattest one.
    //
    // The ladder every max offer stands on is measured on the operator's OWN auctions - ten seats, 1000
    // credits, 3/8/8/6, the classic Serie A listone (§19.3) - so pricing a EuroLeghe board with it would
    // be applying a parameter outside the population it was fitted on, which is the mistake this
    // repository has paid for more than once. Serie A classic first, then whatever prices the most men,
    // and the header always NAMES the sheet it ended up with.
    const suits = (sheet: EngineSheetEntry) =>
      sheet.platform === 'default' && sheet.game === 'classic';
    const chosen =
      [...sheets].filter(suits).sort((a, b) => (b.priced ?? 0) - (a.priced ?? 0))[0] ??
      [...sheets].sort((a, b) => (b.priced ?? 0) - (a.priced ?? 0))[0];
    const table = await this.bundle.table(chosen.path.replace(/\.json(\.gz)?$/, ''));

    this.sheet.set(chosen);
    this.numbers.set(engineNumbersFrom(table));

    const prices = await this.prices(manifest.target_season, chosen.platform);
    const players = demoPlayers(table, prices, false);
    if (!players.length) {
      throw new Error(
        `Nessun giocatore del foglio "${chosen.league}" è quotato sul listone ${chosen.platform} ` +
          `${manifest.target_season}: senza prezzo non c'è una plancia da disegnare.`,
      );
    }
    this.listone.set(players);
    return players;
  }

  /**
   * The FVM of the auction day, per player.
   *
   * Frozen on purpose: a coordinate that reshuffles between two sessions is a bad coordinate - moving
   * from Qt.I to FVM today alone moves 154 men of 527 into a different slot.
   */
  private async prices(season: string, platform: string): Promise<Map<number, number>> {
    const table = await this.bundle.table('listone_quotes');
    const at = (name: string) => table.columns.indexOf(name);
    const columns = {
      id: at('fc_id'),
      season: at('season'),
      platform: at('platform'),
      fvm: at('fvm'),
    };
    const out = new Map<number, number>();
    for (const row of table.rows) {
      if (String(row[columns.season]) !== season) continue;
      if (String(row[columns.platform]) !== platform) continue;
      const fvm = Number(row[columns.fvm]);
      if (fvm > 0) out.set(Number(row[columns.id]), fvm);
    }
    return out;
  }
}

/** The median of the numbers that exist. A null is not a zero, so it is not in the sample. */
function middleOf(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value != null).sort((a, b) => a - b);
  if (!known.length) return null;
  const middle = known.length >> 1;
  return known.length % 2 ? known[middle] : (known[middle - 1] + known[middle]) / 2;
}
