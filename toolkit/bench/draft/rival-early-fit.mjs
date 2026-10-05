/* THE EARLY PHASE OF THE RIVALS' PICK, refitted (operator, 05/10/2026: «elabora un modello che sia in grado di adattarsi
 * sempre anche in futuro quando cambierà il listone ... prendere come prima scelta il top del mercato è quasi sempre la
 * scelta presa dai partecipanti»). `rival-odds.ts` read a squad's first EARLY_PICKS picks on the price alone,
 * exp(w · log FVM), and that is too soft at the top: it gave the dearest man of a Serie A listone 26% at the first call,
 * where on the real tables he goes first nearly every time.
 *
 * What makes a feature ADAPT to a new listone is that it is RELATIVE to the men still free: a conditional logit drops
 * every constant of a choice set, so log FVM already ignores the scale of the FVM, and the rank among the free men and
 * the step to the next one are invariant to everything but the order. No absolute FVM threshold enters.
 *
 * Conditional logit over the men the squad may legally take (the clubs somebody picked from, as the late fit did; the
 * keeper cap; on classic the line quotas), L2 0.02, scored LEAVE ONE DRAFT OUT: fitted on the other tables, read on the
 * one left out. Printed per candidate set of features: the log-likelihood per pick and how often the man given the
 * highest odds is the man really taken.
 *
 * The dumps carry paid content and stay OUT of the repository (`data/raw/draft-sessions/`, gitignored). A local session
 * (`FL-`) carries no listone: it is read on the listone of the FA- session named after it with `=`.
 *
 *   node rival-early-fit.mjs DIR/FA-a.json DIR/FA-b.json DIR/FL-c.json=DIR/FA-a.json ...
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const EARLY_PICKS = 6;
const L2 = 0.02;
const LINE = { gk: 'P', def: 'D', mid: 'C', atk: 'A' };
const listOf = (items) => (Array.isArray(items) ? items : Object.values(items ?? {})).filter((one) => one != null);

/** One table as choice sets: per early pick, the features of every legal free man and the index of the one taken. */
function choiceSets(path, listonePath) {
  const root = JSON.parse(readFileSync(path, 'utf-8'));
  const env = listonePath ? JSON.parse(readFileSync(listonePath, 'utf-8')).env : root.env;
  const state = root.state;
  const mantra = (state.settings?.game ?? 1) === 2;
  const roles = state.settings.roles;
  const quota = mantra ? null : { P: roles.gk[1], D: roles.def[1], C: roles.mid[1], A: roles.atk[1] };
  const keeperCap = roles.gk[1];
  const picks = listOf(state.picks).filter((one) => !one.released).sort((a, b) => a.index - b.index);
  let listone = listOf(env.playerList).filter((one) => LINE[one.zone?.classic]);
  const clubOf = new Map(listone.map((one) => [one.id, one.team]));
  const played = new Set(picks.map((one) => clubOf.get(one.playerId)));
  listone = listone.filter((one) => played.has(one.team));
  const byId = new Map(listone.map((one) => [one.id, one]));
  const price = (one) => one.stats?.fmv?.[mantra ? 'mantra' : 'classic'] ?? 0;
  const line = (one) => LINE[one.zone.classic];
  const fm = (one) => Number(one.stats?.avgFantaGrade) || null;
  const maxPlayed = Math.max(1, ...listone.map((one) => Number(one.stats?.playeds) || 0));

  const sets = [];
  const taken = new Set();
  const held = new Map();
  for (const pick of picks) {
    const chosen = byId.get(pick.playerId);
    const mine = held.get(pick.teamId) ?? [];
    if (chosen && mine.length < EARLY_PICKS) {
      const lineCount = (l) => mine.filter((one) => line(one) === l).length;
      const legal = listone.filter((one) => !taken.has(one.id)
        && !(line(one) === 'P' && lineCount('P') >= keeperCap)
        && !(quota && lineCount(line(one)) >= quota[line(one)]));
      if (legal.some((one) => one.id === chosen.id)) {
        const sorted = [...legal].sort((a, b) => price(b) - price(a));
        const rank = new Map(sorted.map((one, at) => [one.id, at + 1]));
        const logP = (one) => Math.log(price(one) + 1);
        const next = new Map(sorted.map((one, at) => [one.id, at + 1 < sorted.length ? logP(sorted[at + 1]) : 0]));
        const rows = legal.map((one) => {
          const r = rank.get(one.id);
          const f = fm(one);
          return {
            logP: logP(one),
            logRank: Math.log(r),
            top: r === 1 ? 1 : 0,
            top2: r <= 2 ? 1 : 0,
            gapNext: logP(one) - next.get(one.id),
            fmMinus6: f == null ? 0 : f - 6,
            fmMissing: f == null ? 1 : 0,
            played: (Number(one.stats?.playeds) || 0) / maxPlayed,
            // The squad's FIRST call: where «the top of the market» is meant to bite.
            topFirst: r === 1 && mine.length === 0 ? 1 : 0,
            logRankFirst: mine.length === 0 ? Math.log(r) : 0,
            logPFirst: mine.length === 0 ? logP(one) : 0,
          };
        });
        sets.push({ rows, chosen: legal.findIndex((one) => one.id === chosen.id), turn: mine.length,
          names: legal.map((one) => one.name), prices: legal.map(price),
          form: rows.map((row) => [row.fmMinus6, row.fmMissing, row.played]) });
      }
    }
    if (chosen) {
      taken.add(chosen.id);
      held.set(pick.teamId, [...mine, chosen]);
    }
  }
  return sets;
}

function utilities(set, w, keys) {
  return set.rows.map((row) => keys.reduce((sum, key, k) => sum + w[k] * row[key], 0));
}

function probabilities(set, w, keys) {
  const u = utilities(set, w, keys);
  const top = Math.max(...u);
  const e = u.map((x) => Math.exp(x - top));
  const total = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / total);
}

/** Newton on the penalised mean log-likelihood: convex, a handful of features, converges in a few steps. */
function fit(sets, keys) {
  const K = keys.length;
  const w = keys.map(() => 0);
  for (let it = 0; it < 30; it += 1) {
    const grad = new Array(K).fill(0);
    const hess = Array.from({ length: K }, () => new Array(K).fill(0));
    for (const set of sets) {
      const p = probabilities(set, w, keys);
      const mean = keys.map((key) => set.rows.reduce((sum, row, i) => sum + p[i] * row[key], 0));
      keys.forEach((key, a) => { grad[a] += set.rows[set.chosen][key] - mean[a]; });
      set.rows.forEach((row, i) => {
        for (let a = 0; a < K; a += 1) {
          const da = row[keys[a]] - mean[a];
          for (let b = 0; b < K; b += 1) hess[a][b] += p[i] * da * (row[keys[b]] - mean[b]);
        }
      });
    }
    for (let a = 0; a < K; a += 1) {
      grad[a] = grad[a] / sets.length - 2 * L2 * w[a];
      for (let b = 0; b < K; b += 1) hess[a][b] = hess[a][b] / sets.length + (a === b ? 2 * L2 : 0);
    }
    const delta = solve(hess, grad);
    // Backtracking: a Newton step on a flat, nearly collinear surface can overshoot, so it is halved until it helps.
    const before = objective(sets, w, keys);
    let scale = 1;
    let trial = w.map((x, a) => x + delta[a]);
    while (scale > 1e-4 && !(objective(sets, trial, keys) >= before)) {
      scale /= 2;
      trial = w.map((x, a) => x + scale * delta[a]);
    }
    if (scale <= 1e-4) break;
    for (let a = 0; a < K; a += 1) w[a] = trial[a];
    if (Math.max(...delta.map((d) => Math.abs(d * scale))) < 1e-7) break;
  }
  return w;
}

/** The penalised mean log-likelihood the fit maximises. */
function objective(sets, w, keys) {
  let ll = 0;
  for (const set of sets) ll += Math.log(probabilities(set, w, keys)[set.chosen] + 1e-300);
  return ll / sets.length - L2 * w.reduce((sum, x) => sum + x * x, 0);
}

/** Gaussian elimination: H x = g. */
function solve(H, g) {
  const n = g.length;
  const m = H.map((row, i) => [...row, g[i]]);
  for (let c = 0; c < n; c += 1) {
    let pivot = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r;
    [m[c], m[pivot]] = [m[pivot], m[c]];
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k += 1) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

function score(sets, w, keys) {
  let ll = 0;
  let hit = 0;
  for (const set of sets) {
    if (process.env.FIRST_ONLY && set.turn !== 0) continue;
    const p = probabilities(set, w, keys);
    ll += Math.log(p[set.chosen] + 1e-12);
    if (p.indexOf(Math.max(...p)) === set.chosen) hit += 1;
  }
  const n = process.env.FIRST_ONLY ? sets.filter((s) => s.turn === 0).length : sets.length;
  return { ll: ll / n, hit: hit / n, n };
}

const tables = process.argv.slice(2).map((arg) => {
  const [path, listone] = arg.split('=');
  return { name: basename(path, '.json'), sets: choiceSets(path, listone) };
});

const MODELS = {
  shipped: { keys: ['logP'], fixed: [2.7078] },
  logP: { keys: ['logP'] },
  'logP+top': { keys: ['logP', 'top'] },
  'logP+logRank': { keys: ['logP', 'logRank'] },
  'logP+logRank+top': { keys: ['logP', 'logRank', 'top'] },
  'logP+logRank+gap': { keys: ['logP', 'logRank', 'gapNext'] },
  'logP+logRank+top+gap': { keys: ['logP', 'logRank', 'top', 'gapNext'] },
  'logP+logRank+top+form': { keys: ['logP', 'logRank', 'top', 'fmMinus6', 'fmMissing', 'played'] },
  'logP+first': { keys: ['logP', 'logPFirst', 'logRankFirst', 'topFirst'] },
  'logP+logRank+first': { keys: ['logP', 'logRank', 'logPFirst', 'logRankFirst', 'topFirst'] },
  'logP+logRank+first+form': { keys: ['logP', 'logRank', 'logPFirst', 'logRankFirst', 'topFirst', 'fmMinus6', 'fmMissing', 'played'] },
  adopted: { keys: ['logP', 'logRank', 'logPFirst', 'logRankFirst', 'fmMinus6', 'fmMissing', 'played'] },
};

console.log(`tavoli: ${tables.map((t) => `${t.name} (${t.sets.length})`).join(', ')}\n`);
console.log('leave one draft out: log-verosimiglianza per scelta · quante volte il favorito e\' il preso');
for (const [label, model] of Object.entries(MODELS)) {
  const per = tables.map((table) => {
    const train = tables.filter((one) => one !== table).flatMap((one) => one.sets);
    const w = model.fixed ?? fit(train, model.keys);
    return { name: table.name, ...score(table.sets, w, model.keys) };
  });
  const n = per.reduce((s, x) => s + x.n, 0);
  const ll = per.reduce((s, x) => s + x.ll * x.n, 0) / n;
  const hit = per.reduce((s, x) => s + x.hit * x.n, 0) / n;
  console.log(`${label.padEnd(24)} ll ${ll.toFixed(3)} · favorito ${(hit * 100).toFixed(1)}%   `
    + per.map((x) => `${x.name} ${(x.hit * 100).toFixed(0)}%`).join(' '));
}

const all = tables.flatMap((one) => one.sets);
for (const label of ['adopted']) {
  const keys = MODELS[label].keys;
  const w = fit(all, keys);
  console.log(`\npesi su tutti i tavoli, ${label}: ${keys.map((key, k) => `${key} ${w[k].toFixed(4)}`).join(' · ')}`);
  // The first call of each table: what the model gives the dearest free man.
  for (const table of tables) {
    const first = table.sets[0];
    const p = probabilities(first, w, keys);
    const order = p.map((x, i) => [x, i]).sort((a, b) => b[0] - a[0]).slice(0, 3);
    console.log(`  ${table.name} prima chiamata: ${order.map(([x, i]) => `${first.names[i]} ${(x * 100).toFixed(0)}%`).join(', ')}`
      + ` → presa ${first.names[first.chosen]}`);
  }
}

/**
 * THE QUESTION THAT STARTED IT: with the first round's callers all on their FIRST pick, how likely is it that the two
 * dearest men are both gone after four calls - i.e. that the fifth caller gets neither. Price-only features.
 */
function bothGoneAfter(set, w, keys, calls, sims = 20000) {
  const order = set.prices.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]);
  const top2 = new Set([order[0][1], order[1][1]]);
  let gone = 0;
  for (let s = 0; s < sims; s += 1) {
    const alive = set.prices.map(() => true);
    const taken = new Set();
    for (let c = 0; c < calls; c += 1) {
      const free = order.filter(([, i]) => alive[i]);
      const u = free.map(([p, i], r) => {
        const logP = Math.log(p + 1);
        const next = r + 1 < free.length ? Math.log(free[r + 1][0] + 1) : 0;
        const row = { logP, logRank: Math.log(r + 1), top: r === 0 ? 1 : 0, top2: r <= 1 ? 1 : 0, gapNext: logP - next,
          topFirst: r === 0 ? 1 : 0, logRankFirst: Math.log(r + 1), logPFirst: logP,
          fmMinus6: set.form[i][0], fmMissing: set.form[i][1], played: set.form[i][2] };
        return keys.reduce((sum, key, k) => sum + w[k] * row[key], 0);
      });
      const max = Math.max(...u);
      const e = u.map((x) => Math.exp(x - max));
      let x = Math.random() * e.reduce((a, b) => a + b, 0);
      let at = 0;
      for (; at < e.length - 1; at += 1) { x -= e[at]; if (x <= 0) break; }
      alive[free[at][1]] = false;
      taken.add(free[at][1]);
    }
    if ([...top2].every((i) => taken.has(i))) gone += 1;
  }
  return gone / sims;
}

console.log('\nprobabilita\' che i due piu\' cari siano GIA\' presi dopo 4 chiamate (il quinto non ne trova nessuno):');
for (const label of ['shipped', 'logP', 'adopted']) {
  const model = MODELS[label];
  const w = model.fixed ?? fit(all, model.keys);
  console.log(`  ${label.padEnd(20)} ${tables.map((t) => `${t.name} ${(bothGoneAfter(t.sets[0], w, model.keys, 4) * 100).toFixed(0)}%`).join(' ')}`);
}
