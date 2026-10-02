/* CHAIN LENGTH ON THE FVM ORDER (the operator, 02/10/2026, for the Serie A classic draft of 6 October, whose order
 * is the roster's FVM): «fai una simulazione con 10 partecipanti di cui 1 che ragiona con una catena a 2, uno a 3 e
 * uno a 4». Three seats of the same head (`priority`, the rollout that takes a man now, lets the rivals call by the
 * real order rule, then takes our best at each of our next turns), differing ONLY in how many of our turns a
 * candidate is judged over; the other seven are the table's usual heads (`MIXED`). Ten Serie A seasons, the
 * league's quotas, every head rotated over the three seats so a seat is never a head's luck.
 *
 * Usage: node chains.mjs [windowsFile] [--seeds=N]
 */
import { priority } from './priority.mjs';
import { SEEDS, annotate, loadShapes, loadWindows, setup, verdict } from './bench.mjs';
import { MIXED, ahead, appNeed, bestUnder, legalPoolFor, makeDraft, matchdayXI } from './engine.mjs';
import { adoptedCover } from './policies.mjs';

/**
 * The same chain on the classic advice's own currency (value x the classic cover ladder, `adoptedCover`): take a
 * candidate now, the rivals call by price under the real order rule, then our best by value x cover at each of our
 * next turns; the candidate is worth the sum of value x cover over our `turns` picks. No survival discount on top:
 * the chain IS the survival reasoning, written out.
 */
function valueChain(turns, K = 10) {
  const need = adoptedCover();
  const cache = new WeakMap();
  const evaluate = (ctx) => {
    const { team, setup, places } = ctx;
    const keeperSlot = ctx.keeperSlot;
    const score = (t, p, c) => (p.value ?? 0) * need(t, p, places, c);
    const okKeeper = (t, p) => p.slot !== keeperSlot || t.slots.filter((s) => s === keeperSlot).length < setup.keepers;
    const legal = legalPoolFor(team, ctx.pool, setup).filter((p) => okKeeper(team, p));
    const ranked = legal.map((p) => ({ p, s: score(team, p, ctx) })).sort((a, b) => b.s - a.s);
    const out = new Map(ctx.pool.map((p) => [p.id, -1e6 + score(team, p, ctx)]));
    for (const { p, s } of ranked) out.set(p.id, s);
    if (turns > 1 && ctx.table && ctx.order) {
      for (const { p: first, s: s0 } of ranked.slice(0, K)) {
        let pool = ctx.pool.filter((x) => x.id !== first.id);
        const teams = new Map(ctx.table.map((t) => [t.id, { ...t }]));
        const add = (id, c) => {
          const t = teams.get(id);
          pool = pool.filter((x) => x.id !== c.id);
          teams.set(id, { ...t, slots: [...t.slots, c.slot], roster: [...t.roster, c], rosterValue: t.rosterValue + c.price,
            pickValues: [...t.pickValues, c.price], picksCount: t.picksCount + 1 });
        };
        const meId = team.id;
        add(meId, first);
        let total = s0, taken = 1, order = ctx.order, at = ctx.at;
        while (taken < turns && teams.get(meId).picksCount < setup.rounds) {
          at += 1;
          if (at >= order.length) {
            order = [...teams.values()].sort((a, b) => ahead(a, b, setup.maxAhead ?? 1, setup.orderType)).map((t) => t.id);
            at = 0;
          }
          const t = teams.get(order[at]);
          if (t.picksCount >= setup.rounds) continue;
          const c2 = { ...ctx, pool, team: t };
          if (t.id !== meId) {
            const c = bestUnder({ team: t, pool: legalPoolFor(t, pool, setup), places, keeperCap: setup.keepers, tail: false,
              quality: (x) => x.price, need: appNeed, ctx: c2 });
            if (c) add(t.id, c);
            continue;
          }
          let best = null, bs = -Infinity;
          for (const x of legalPoolFor(t, pool, setup)) {
            if (!okKeeper(t, x)) continue;
            const v = score(t, x, c2);
            if (v > bs) { bs = v; best = x; }
          }
          if (!best) break;
          total += bs; add(meId, best); taken += 1;
        }
        out.set(first.id, total);
      }
    }
    return out;
  };
  return { need: () => 1, floor: Infinity, noTail: true,
    currency: (p, ctx) => { let e = cache.get(ctx.pool); if (!e) { e = evaluate(ctx); cache.set(ctx.pool, e); } return e.get(p.id) ?? -1e9; } };
}

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const file = args.find((a) => !a.startsWith('--')) ?? 'leghe-classic-wide.json';
const seeds = flag('seeds') ? SEEDS.slice(0, Number(flag('seeds'))) : SEEDS;
// --head=priority (the operator's squad-worth rollout, priority.mjs) or --head=value (value x classic cover).
const headKind = flag('head') ?? 'priority';
const makeHead = (n) => (headKind === 'value' ? valueChain(n) : priority({ turns: n, doubles: false }));

const base = setup('Leghe');
const table = { ...base, quotas: base.lineQuotas };
const shapes = loadShapes(table.game);
const windows = loadWindows(file);
const HEADS = (flag('heads') ?? '2,3,4').split(',').map(Number);
console.log(`head ${headKind}; league ${table.name}: ${table.teams} teams, ${table.rounds} rounds, quotas ${JSON.stringify(table.quotas)}, order ${table.orderType ?? 'default (roster FVM)'}`);

const rows = Object.fromEntries(HEADS.map((n) => [n, { mine: [], adv: [], spent: [], early: [], cover: [], pos6: [] }]));
const tableMean = [];
const started = Date.now();
for (const [key, w] of Object.entries(windows)) {
  const draft = makeDraft(annotate(w.players, w.rounds), shapes, table);
  const acc = Object.fromEntries(HEADS.map((n) => [n, { pts: [], adv: [], spent: [], early: [], filled: 0, places: 0, pos6: [] }]));
  const tablePts = [];
  for (const [si, seed] of seeds.entries()) {
    const first = si % table.teams;
    const seats = [first, (first + 3) % table.teams, (first + 6) % table.teams];
    for (let r = 0; r < HEADS.length; r += 1) {
      const seatOf = new Map(HEADS.map((n, i) => [n, seats[(i + r) % seats.length]]));
      const seatPolicies = {};
      for (const n of HEADS) seatPolicies[seatOf.get(n)] = makeHead(n);
      const { got, orders } = draft({ seat: -1, seed, policy: null, table: MIXED, seatPolicies });
      const scores = got.map((roster) => matchdayXI(roster, shapes, w.votes, w.rounds));
      const others = scores.filter((_, i) => ![...seatOf.values()].includes(i)).map((s) => s.points / w.rounds);
      const othersMean = others.reduce((a, b) => a + b, 0) / others.length;
      tablePts.push(othersMean);
      for (const n of HEADS) {
        const seat = seatOf.get(n);
        const pts = scores[seat].points / w.rounds;
        const a = acc[n];
        a.pts.push(pts);
        a.adv.push(100 * (pts - othersMean) / othersMean);
        a.spent.push(got[seat].reduce((s, p) => s + p.price, 0));
        a.early.push(got[seat].slice(0, 5).reduce((s, p) => s + p.price, 0));
        a.filled += scores[seat].filled; a.places += scores[seat].places;
        a.pos6.push(orders[5].indexOf(seat) + 1);
      }
    }
  }
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  for (const n of HEADS) {
    const a = acc[n], row = rows[n];
    row.mine.push(mean(a.pts)); row.adv.push(mean(a.adv)); row.spent.push(mean(a.spent));
    row.early.push(mean(a.early)); row.cover.push(100 * a.filled / a.places); row.pos6.push(mean(a.pos6));
  }
  tableMean.push(mean(tablePts));
  console.log(`done ${key} (${w.target}, ${w.rounds} md) ${HEADS.map((n) => `c${n} ${mean(acc[n].pts).toFixed(1)}`).join(' ')} table ${mean(tablePts).toFixed(1)}  [${Math.round((Date.now() - started) / 1000)}s]`);
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const signed = (x, d = 2) => (x >= 0 ? '+' : '') + x.toFixed(d);
console.log('\nhead        pts/md  vs table   covered  FVM spent  FVM first 5  place in round 6');
for (const n of HEADS) {
  const r = rows[n];
  console.log(`catena a ${n}  ${mean(r.mine).toFixed(2).padStart(6)}  ${signed(mean(r.adv)).padStart(7)}%  ${mean(r.cover).toFixed(1).padStart(6)}%  ${mean(r.spent).toFixed(0).padStart(9)}  ${mean(r.early).toFixed(0).padStart(11)}  ${mean(r.pos6).toFixed(2).padStart(8)}`);
}
console.log(`table (7)   ${mean(tableMean).toFixed(2).padStart(6)}`);
console.log('\npaired gain on points per matchday, per season:');
for (const [n, m] of HEADS.flatMap((a, i) => HEADS.slice(0, i).map((b) => [a, b]))) {
  const xs = rows[n].mine.map((v, i) => 100 * (v - rows[m].mine[i]) / rows[m].mine[i]);
  const v = verdict(xs);
  console.log(`catena ${n} vs ${m}: ${xs.map((x) => signed(x)).join(' ')}  mean ${signed(v.mean)}% won ${v.wins}/${xs.length} strict ${v.strict ? 'PASS' : '-'} robust ${v.robust ? 'PASS' : '-'}`);
}
