/* SeSw x RAR: the NEW Draft Priority the operator asked for on 30/09/2026 («troviamo la giusta formula per unire
 * SeSw al Rar»), and whether the 70% discount proposed for it is right. A CANDIDATE: it lives here until it wins.
 *
 *   SeSw(x) = the app's own `draft-priority.manValue` (the DP as it ships today), read through `appcode.mjs`;
 *   RAR(x)  = the app's own `draft-rarity.rarity`: the other free men of x's base role as good or better;
 *   k(x)    = the picks the OTHERS make before our next turn, if we take x now - the rest of this round, plus the
 *             rivals that the platform's order (roster FVM, cheapest first) puts ahead of us after paying x;
 *   s(x)    = min(1, RAR / k)   (or the STEP 1[RAR >= k]): how sure it is that one like him is still free then;
 *   DP(x)   = SeSw(x) - d * s(x) * (SeSw(x) - B),   B = the lowest SeSw we could call now.
 *
 * The discount is applied to SeSw - B and not to SeSw itself because SeSw is SIGNED (below the average starter it
 * is negative), and `SeSw * (1 - d s)` would RAISE a common man below zero - the opposite of what the operator
 * asked. The literal product is measured too (`form: 'raw'`), so the difference is a number and not an argument.
 *
 * What the historical windows cannot carry, stated: RAR here reads THREE of its six readings - steadiness, the
 * predicted fantamedia in place of base vote + bonus (the windows carry no split of the two), and the share of the
 * calendar. The titolarità word and the injury history of a past August are not in `windows-porte.json`; a missing
 * reading of HIS constrains nobody, so the bench's RAR counts MORE men as similar than the app's does. */
import { manValue, priorityBaseRole, priorityRoleStats, rarity } from './appcode.mjs';
import { appNeed, legalPoolFor } from './engine.mjs';

const toPriority = (m) => ({ id: m.id, roles: m.roles, slot: m.slot, price: m.price, fm: m.fm_pred ?? null,
  share: m.p ?? null, steady: m.steady ?? null });

export function seswRar({ discount = 0, form = 'relative', step = false, ration = false } = {}) {
  const cache = new WeakMap();
  let statsFor = null; // the population is the same all draft long (pool + rosters = the listone)

  const evaluate = (ctx) => {
    const team = ctx.team;
    const everybody = [...ctx.pool, ...(ctx.table ?? []).flatMap((t) => t.roster)];
    const key = everybody.length + ':' + everybody.reduce((a, m) => a + m.id, 0);
    if (!statsFor || statsFor.key !== key) {
      statsFor = { key, stats: priorityRoleStats(everybody.map(toPriority), ctx.shapes,
        { teams: ctx.teams, keepers: ctx.keepers, rounds: ctx.rounds }) };
    }
    const worth = { rules: ctx.shapes, stats: statsFor.stats };
    // manValue reads pv = share x N and divides by N again, so N is only a unit here.
    const sesw = new Map(ctx.pool.map((m) => [m.id, manValue(toPriority(m), worth, 38)]));
    const out = new Map();
    if (!discount) {
      for (const [id, v] of sesw) out.set(id, v ?? -1e6);
      return out;
    }
    const group = (m) => priorityBaseRole(ctx.shapes, m.roles, m.slot);
    const rar = rarity(ctx.pool.map((m) => ({ id: m.id, group: group(m), rung: null, steady: m.steady ?? null,
      mv: m.fm_pred ?? null, bonus: null, share: m.p ?? null, fragility: null })));
    // k: the rivals still to call in this round, then those the next round's order puts before us. Next round
    // everybody has the same number of picks, so the order is the roster's price: a rival still to call here is
    // taken to add the dearest free man (the rivals at this table call by price), one each, in turn.
    const { order, at } = ctx;
    const rest = order ? order.slice(at + 1).map((id) => ctx.table.find((t) => t.id === id))
      .filter((t) => t.picksCount < ctx.rounds) : [];
    const dear = ctx.pool.map((m) => m.price).sort((a, b) => b - a);
    const rivalsNext = (ctx.table ?? []).filter((t) => t.id !== team.id)
      .map((t) => t.rosterValue + (rest.includes(t) ? (dear[rest.indexOf(t)] ?? 0) : 0));
    const legal = legalPoolFor(team, ctx.pool, ctx.setup);
    const floor = Math.min(...legal.map((m) => sesw.get(m.id) ?? Infinity));
    for (const m of ctx.pool) {
      const v = sesw.get(m.id);
      if (v == null) { out.set(m.id, -1e6); continue; }
      const mine = team.rosterValue + m.price;
      const before = rivalsNext.filter((value) => value < mine).length;
      const k = Math.max(1, rest.length + before);
      const r = rar.get(m.id)?.count ?? 0;
      const s = step ? (r >= k ? 1 : 0) : Math.min(1, r / k);
      out.set(m.id, form === 'raw' ? v * (1 - discount * s) : v - discount * s * (v - (Number.isFinite(floor) ? floor : v)));
    }
    return out;
  };

  return {
    need: ration ? appNeed : () => 1,
    floor: Infinity,
    noTail: true,
    currency: (man, ctx) => {
      let entry = cache.get(ctx.pool);
      if (!entry) cache.set(ctx.pool, (entry = evaluate(ctx)));
      return entry.get(man.id) ?? -1e9;
    },
  };
}

const GRID = [0.1, 0.2, 0.3, 0.5, 0.7, 1.0];
const STEPS = [0.3, 0.5, 0.7, 1.0];

/** Baseline first: the DP as it ships (SeSw alone), then the discount on its grid, then the two variant forms. */
export const RARITY = [
  { name: 'SeSw (DP di oggi)', ...seswRar() },
  ...GRID.map((d) => ({ name: `SeSw x RAR d=${d}`, ...seswRar({ discount: d }) })),
  ...STEPS.map((d) => ({ name: `SeSw x RAR gradino d=${d}`, ...seswRar({ discount: d, step: true }) })),
  { name: 'SeSw x RAR d=0.7 prodotto grezzo', ...seswRar({ discount: 0.7, form: 'raw' }) },
];

/** The same grid with the app's own coverage rationing on both arms (`needFor`), in case SeSw alone hoards. */
export const RARITY_RATIONED = [
  { name: 'SeSw razionata', ...seswRar({ ration: true }) },
  ...GRID.map((d) => ({ name: `razionata d=${d}`, ...seswRar({ discount: d, ration: true }) })),
  ...STEPS.map((d) => ({ name: `razionata gradino d=${d}`, ...seswRar({ discount: d, step: true, ration: true }) })),
];
