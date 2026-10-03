/**
 * THE ODDS THAT A FREE MAN IS GONE BEFORE OUR NEXT TURN, as PEOPLE pick (operator, 03/10/2026: «non contiamo chi prende
 * cosa ma che indoviniamo i giocatori scelti prima del prossimo nostro turno», then option 1: a probability per name,
 * with the sure ones marked). Details and every number: `docs/model/priorita-draft-v1.md` §35.
 *
 * WHY A SECOND MODEL OF THE RIVALS. `predictRivalPick` asks «which man is worth most to him», and the seven real drafts
 * replayed on the page say people do not choose on our sheet: they read the listone the host shows them - the FVM, the
 * line, and the numbers of the season in progress (fantamedia, base vote, appearances). So this is a conditional logit
 * of a HUMAN pick over the men his squad may legally take, fitted on five finished Serie A drafts (FA-yei-458,
 * FL-7zz-d10, FL-ixr-b6b classic; FA-blt-km4, FA-7xu-106 mantra), and the walk to our turn is SAMPLED from it many
 * times: the share of walks in which a man is taken is his odds.
 *
 * TWO PHASES, and the first is nothing but the price. Held out on a table it never saw, no feature beats the FVM order
 * in a squad's first `EARLY_PICKS` picks (FA-yei-458 52% against 54%, FL-7zz-d10 44% against 45%, FL-ixr-b6b 40% against
 * 38% of the real names, with as many names as real picks); after them the full model is 8-11 points over it on all
 * three. What the early phase adds is a CALIBRATED price: its weight is the temperature of «they take the dearest».
 *
 * WHAT «SURE» MEANS (`SURE_ODDS`): held out, a man given 0.8 or more is really gone 87-100% of the time on the three
 * classic tables (90% on FA-yei-458, 41 of 41 on FL-7zz-d10, 13 of 15 on FL-ixr-b6b). At 0.7 it is 77-92%, which does
 * not keep the 80% the operator asked for on every table. The price of 0.8 is coverage: a handful of names a turn.
 *
 * THE POOL is the free list the page offers (`AuctionAdvice.ranked`): the clubs the table excludes are out for everybody,
 * which is how the fit restricted it (to the clubs somebody picked from). In porte mode a goal is one row and its keeper
 * line counts once: the five drafts were not porte drafts, so there the odds of a goal are an extrapolation.
 *
 * Reporting only, like every rival prediction: it moves no valuation and no advice; the deterministic walk
 * (`takenBeforeOurTurn`) still feeds the plans and the survivor discount, which were measured on it.
 */
import {
  capBlocks,
  nextCaller,
  roleFull,
  take,
  type PlanPlayer,
  type PlanTeam,
  type RivalWalkInput,
} from './auction-plan';

/** The classic line of a man, which is what a person sees on the listone whatever the game. */
export type SeenLine = 'gk' | 'def' | 'mid' | 'atk';

/** What the table shows of a man: the session listone's own numbers for the season in progress. */
export interface SeenMan {
  line: SeenLine;
  club: string;
  /** `stats.avgFantaGrade`: null when he has not played (the host writes 0). */
  fm: number | null;
  /** `stats.avgGrade`. */
  mv: number | null;
  /** `stats.playeds`. */
  played: number;
}

/** How many of a squad's own picks are «early»: the price alone below, the full model from here. */
export const EARLY_PICKS = 6;

/** From here a man is drawn as SURE to be gone (see the header for the measurement). */
export const SURE_ODDS = 0.8;

/** Below this the row says nothing: a display choice, declared here so it is not read as measured. */
export const SHOWN_ODDS = 0.3;

/** Walks sampled per reading. 150 keeps the odds within ±0.04 of their limit and the page under a frame budget. */
export const ODDS_SIMS = 150;

/**
 * The fitted weights (L2 0.02, all five Serie A drafts; the fitting harness reads session dumps outside the
 * repository and its held-out numbers are in §35 - `toolkit/bench/draft/rival-odds.mjs` replays the shipped code). Every feature is computed
 * exactly as the fit computed it: on the free men of the WHOLE listone (taken out as they go), the line's rank and
 * gap by FVM, `t` = the squad's picks / the picks of a whole squad.
 */
export const HUMAN_WEIGHTS = {
  early: { logFVM: 2.7078 },
  late: {
    logFVM: 0.2135,
    logFVMxT: -0.513,
    logRankLine: -1.1092,
    topLine: -0.6722,
    gapNext: -0.2024,
    fmMinus6: 0.2787,
    fmMissing: -1.2298,
    played: 0.9568,
    bonusSeen: 0.2121,
    sameClub: 0.2841,
    gkSameClub: 1.7696,
    hot: -0.1589,
    hotXt: -0.0982,
    gk: -0.611,
    gkXt: -0.1402,
  },
} as const;

/** What the walk reads of the table: the order rule, the squads, the free men and the legality - nothing else. */
export interface OddsInput extends Pick<RivalWalkInput, 'teams' | 'pool' | 'mineId' | 'keeperCap' | 'maxAheadPicks' | 'orderType' | 'cap'> {
  /** What the table shows of every man, taken ones included (a squad's own picks set `sameClub`). */
  seen: Map<number, SeenMan>;
  /** Picks a whole squad makes: `t` is read against it. */
  rounds: number;
  sims?: number;
  /** The seed of the walks: the same table reads the same odds, so the list does not flicker. */
  seed?: number;
}

/** A small seeded generator (mulberry32): enough for sampling, and reproducible. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

interface Held {
  clubs: Map<string, number>;
  keeperClubs: Set<string>;
}

/**
 * player id -> the share of sampled walks in which he is taken before our next turn. Empty when we follow nobody.
 * When we are on the clock our own pick is counted and priced at zero, as `goneBeforeOurNextTurn` does, so the odds
 * are readable before we choose.
 */
export function goneOdds(input: OddsInput): Map<number, number> {
  const start = new Map(input.teams.map((team) => [team.id, team]));
  const me = start.get(input.mineId);
  const out = new Map<number, number>();
  if (!me) return out;
  if (nextCaller(start, input.maxAheadPicks, input.rounds, input.orderType)?.id === input.mineId) {
    start.set(me.id, { ...me, picksCount: me.picksCount + 1, pickValues: [...me.pickValues, 0] });
  }

  const pool = input.pool.filter((player) => input.seen.has(player.id));
  // Over the WHOLE listone, taken men included, as the fit read it: over the free men only it would fall as the regulars
  // go and lift every survivor's `played` term.
  const maxPlayed = Math.max(1, ...[...input.seen.values()].map((man) => man.played));
  // Per line, the pool dearest first: the rank and the gap are read off it, skipping who is gone in this walk.
  const lines = new Map<SeenLine, number[]>();
  pool.forEach((player, index) => {
    const line = input.seen.get(player.id)!.line;
    if (!lines.has(line)) lines.set(line, []);
    lines.get(line)!.push(index);
  });
  for (const list of lines.values()) list.sort((a, b) => pool[b].price - pool[a].price);
  const logPrice = pool.map((player) => Math.log(player.price + 1));
  const heldOf = (team: PlanTeam): Held => {
    const held: Held = { clubs: new Map(), keeperClubs: new Set() };
    for (const id of team.heldIds) {
      const man = input.seen.get(id);
      if (!man) continue;
      held.clubs.set(man.club, (held.clubs.get(man.club) ?? 0) + 1);
      if (man.line === 'gk') held.keeperClubs.add(man.club);
    }
    return held;
  };

  const sims = input.sims ?? ODDS_SIMS;
  const random = generator(input.seed ?? 1);
  const count = new Float64Array(pool.length);
  const logRank = new Float64Array(pool.length);
  const top = new Uint8Array(pool.length);
  const gap = new Float64Array(pool.length);
  const late = HUMAN_WEIGHTS.late;
  for (let sim = 0; sim < sims; sim += 1) {
    const teams = new Map(start);
    const held = new Map([...teams.values()].map((team) => [team.id, heldOf(team)]));
    const alive = new Uint8Array(pool.length).fill(1);
    for (let guard = 0; guard < teams.size * 3; guard += 1) {
      const caller = nextCaller(teams, input.maxAheadPicks, input.rounds, input.orderType);
      if (!caller || caller.id === input.mineId) break;
      const early = caller.picksCount < EARLY_PICKS;
      // The line's rank and gap only matter to the full model: an early caller reads the price alone.
      if (!early) for (const list of lines.values()) {
        let at = 0;
        let previous = -1;
        for (const index of list) {
          if (!alive[index]) continue;
          at += 1;
          logRank[index] = Math.log(at);
          top[index] = at === 1 ? 1 : 0;
          if (previous >= 0) gap[previous] = logPrice[previous] - logPrice[index];
          previous = index;
        }
        if (previous >= 0) gap[previous] = logPrice[previous];
      }
      const t = caller.picksCount / input.rounds;
      const mine = held.get(caller.id)!;
      // Keepers are counted on the LINE the listone states, not on the sheet's slot: on mantra a man the sheet does not
      // price has no slot, and his keepers would never count against the cap - exactly the men this model is about.
      const keepers = caller.heldIds.filter((id) => input.seen.get(id)?.line === 'gk').length;
      let best = -1;
      let bestScore = -Infinity;
      for (let index = 0; index < pool.length; index += 1) {
        if (!alive[index]) continue;
        const player = pool[index];
        const man = input.seen.get(player.id)!;
        if (man.line === 'gk' && keepers >= input.keeperCap) continue;
        if (roleFull(caller, player.slot)) continue;
        if (capBlocks(caller.picksCount, player.price, input.cap ?? null)) continue;
        let utility: number;
        if (early) utility = HUMAN_WEIGHTS.early.logFVM * logPrice[index];
        else {
          const keeper = man.line === 'gk' ? 1 : 0;
          const hot = man.fm ? Math.max(0, man.fm - 6) * Math.min(1, man.played / 4) : 0;
          utility = late.logFVM * logPrice[index] + late.logFVMxT * logPrice[index] * t
            + late.logRankLine * logRank[index] + late.topLine * top[index] + late.gapNext * gap[index]
            + (man.fm ? late.fmMinus6 * (man.fm - 6) : late.fmMissing) + late.played * (man.played / maxPlayed)
            + late.bonusSeen * (man.fm && man.mv ? man.fm - man.mv : 0) + late.sameClub * (mine.clubs.get(man.club) ?? 0)
            + late.gkSameClub * (keeper && mine.keeperClubs.has(man.club) ? 1 : 0)
            + late.hot * hot + late.hotXt * hot * t + late.gk * keeper + late.gkXt * keeper * t;
        }
        // Gumbel-max: the argmax of utility plus Gumbel noise IS a draw from the softmax.
        const score = utility - Math.log(-Math.log(random() || Number.MIN_VALUE));
        if (score > bestScore) {
          bestScore = score;
          best = index;
        }
      }
      if (best < 0) {
        // Nobody he can call: he still spends his turn, or the walk would wait on him for ever.
        teams.set(caller.id, { ...caller, picksCount: caller.picksCount + 1 });
        continue;
      }
      const chosen = pool[best];
      const man = input.seen.get(chosen.id)!;
      alive[best] = 0;
      count[best] += 1;
      teams.set(caller.id, take(caller, chosen));
      mine.clubs.set(man.club, (mine.clubs.get(man.club) ?? 0) + 1);
      if (man.line === 'gk') mine.keeperClubs.add(man.club);
    }
  }
  pool.forEach((player: PlanPlayer, index) => {
    if (count[index]) out.set(player.id, count[index] / sims);
  });
  return out;
}
