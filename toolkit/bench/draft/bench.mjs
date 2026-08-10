/* The shared harness: load a bench, run a set of policies over every window, and report with the project's
 * own vocabulary. Every script here goes through it, so nobody invents a second criterion.
 *
 * TWO READINGS of the same run and neither is allowed to hide the other:
 *   ADVANTAGE OVER THE RIVALS - paired inside the same draft, in per cent, because seasons have 29-31
 *   matchdays and raw points are not comparable across windows. This is what the 10/08/2026 campaign
 *   published, and it answers «is this head good at this table».
 *   GAIN OVER THE BASELINE - the first policy of the set, per window, relative on OUR OWN points. This is
 *   what a candidate has to win, and it is the reading the gate's floor was calibrated in: 0.5% of a
 *   quantity, not 0.5 percentage points of somebody else's margin.
 *
 * A number needs its null (the repository's rule): the advantage is against the MEAN of a table that
 * contains deliberately weak heads, so «+1.9%» is largely «being like the better rivals». That is why a
 * candidate is judged against the baseline and not against the table. */
import { readFileSync } from 'node:fs';

import { MIXED, makeDraft, matchdayXI, setupFrom, stat, totalXI } from './engine.mjs';
import { config, work } from './paths.mjs';

export const SEEDS = [7, 42, 1234, 99, 2026, 555, 8081, 31337];
export const FLOOR_PCT = 0.5, WORST_PCT = -2.0;
export const NL = String.fromCharCode(10);

/**
 * The RULEBOOK of the game being played. Two files, and they must not be swapped: mantra places are typed
 * and hybrid, classic places are macro-roles - which is the whole reason the currency has to be re-measured
 * per game (`todolist-draft-v1.md` item 3.1) and why classic legality is not deduced from mantra by analogy.
 */
export const loadShapes = (game = 'mantra') =>
  JSON.parse(readFileSync(config(game === 'classic' ? 'classic_modules.json' : 'mantra_modules.json'), 'utf8'));
export const loadLeagues = () => JSON.parse(readFileSync(config('league_config.json'), 'utf8'));

export function loadWindows(file = 'windows.json') {
  try {
    return JSON.parse(readFileSync(work(file), 'utf8'));
  } catch {
    throw new Error(
      `${file} is missing. It is NOT in git - it carries names, prices and votes of paid content - so it`
      + ` is regenerated from the DB: python extract.py ${file}   (about two minutes, read-only)`,
    );
  }
}

export const setup = (name = 'EuroLeghe') => setupFrom(loadLeagues(), name);

/**
 * The PERCENTILE of each signal inside this window's listone, added to the men once.
 *
 * A blend of two signals has to be on one scale or it is a blend of their units: a Qt.I runs 1-499 and a
 * value runs 0-400 of fantapunti, so «half price half value» on the raw numbers is neither. Percentiles are
 * the scale the pool itself defines, and they are what the panel can compute at the table.
 *
 * Ties share their mean rank, so a listone that quotes forty men at 1 credit does not order them by accident.
 */
export function annotate(players) {
  const put = (field, of) => {
    const rows = players.filter((p) => of(p) !== null && of(p) !== undefined)
      .sort((a, b) => of(a) - of(b));
    for (let i = 0; i < rows.length;) {
      let j = i;
      while (j + 1 < rows.length && of(rows[j + 1]) === of(rows[i])) j += 1;
      const pct = ((i + j) / 2 + 1) / rows.length;
      for (let k = i; k <= j; k += 1) rows[k][field] = pct;
      i = j + 1;
    }
    for (const p of players) if (p[field] === undefined) p[field] = 0;
  };
  put('pctPrice', (p) => p.price);
  put('pctValue', (p) => p.value);
  put('pctPv', (p) => p.pv_pred);
  return players;
}

/**
 * One pass per window: the draft is built ONCE on that window's listone, then every policy plays it from
 * every seat with every seed. Same board, same rivals, same order - so a difference between two rows is
 * the head and nothing else.
 */
export function measure(policies, { windows, shapes, setup: table, seeds = SEEDS, quiet = false } = {}) {
  const keys = Object.keys(windows);
  const results = new Map(policies.map((p) => [p.name, { adv: [], tot: [], mine: [], cover: [], spent: [] }]));
  for (const key of keys) {
    const w = windows[key];
    const draft = makeDraft(annotate(w.players), shapes, table);
    for (const policy of policies) {
      const adv = [], tot = [], mineRaw = [];
      let filled = 0, places = 0, spent = 0, runs = 0;
      for (const seed of seeds) for (let seat = 0; seat < table.teams; seat += 1) {
        const { got } = draft({ seat, seed, policy, table: policy.table ?? MIXED });
        const perMd = got.map((roster) => matchdayXI(roster, shapes, w.votes, w.rounds));
        const totals = got.map((roster) => totalXI(roster, shapes));
        const rivalsOf = (xs) => xs.filter((_, i) => i !== seat).reduce((a, v) => a + v, 0) / (table.teams - 1);
        const rivalMd = rivalsOf(perMd.map((x) => x.points));
        adv.push(100 * (perMd[seat].points - rivalMd) / rivalMd);
        tot.push(100 * (totals[seat] - rivalsOf(totals)) / rivalsOf(totals));
        mineRaw.push(perMd[seat].points / w.rounds);
        filled += perMd[seat].filled; places += perMd[seat].places;
        spent += got[seat].reduce((a, p) => a + p.price, 0);
        runs += 1;
      }
      const cell = results.get(policy.name);
      cell.adv.push(stat(adv));
      cell.tot.push(stat(tot));
      cell.mine.push(stat(mineRaw).m);
      cell.cover.push(100 * filled / places);
      cell.spent.push(spent / runs);
    }
    if (!quiet) {
      console.log(`done ${key} (${w.input} -> ${w.target}, ${w.rounds} matchdays, ${w.players.length} quoted)`);
    }
  }
  return { results, keys };
}

/** The gate's two verdicts, on whatever series is handed in. Never widened because a candidate failed. */
export function verdict(xs) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const wins = xs.filter((x) => x > 0).length;
  return {
    mean,
    wins,
    strict: wins === xs.length && mean >= FLOOR_PCT,
    robust: wins > xs.length / 2 && mean >= FLOOR_PCT && Math.min(...xs) >= WORST_PCT,
  };
}

const signed = (x, digits = 1) => (x >= 0 ? '+' : '') + x.toFixed(digits);

/** The published reading: advantage over the rivals, one column per window. */
export function reportAdvantage({ results, keys }, policies, label, pick = 'adv') {
  console.log(NL + `=== ADVANTAGE % OVER THE RIVALS, metric: ${label}`);
  console.log(`${'policy'.padEnd(36)}${keys.map((k) => k.padStart(9)).join('')}`
    + `${'mean'.padStart(9)}${'won'.padStart(7)}${'strict'.padStart(8)}${'robust'.padStart(8)}`);
  const rows = policies.map((p) => {
    const xs = results.get(p.name)[pick].map((s) => s.m);
    return { name: p.name, xs, v: verdict(xs) };
  }).sort((a, b) => b.v.mean - a.v.mean);
  for (const row of rows) {
    console.log(`${row.name.padEnd(36)}${row.xs.map((x) => signed(x).padStart(9)).join('')}`
      + `${signed(row.v.mean).padStart(9)}${(row.v.wins + '/' + row.xs.length).padStart(7)}`
      + `${(row.v.strict ? 'PASS' : '-').padStart(8)}${(row.v.robust ? 'PASS' : '-').padStart(8)}`);
  }
}

/** The candidate reading: relative gain on OUR OWN points per matchday, against the set's first policy. */
export function reportAgainstBaseline({ results, keys }, policies) {
  const base = results.get(policies[0].name).mine;
  console.log(NL + `=== GAIN % OVER THE BASELINE «${policies[0].name}», points per matchday, per window`);
  console.log(`${'candidate'.padEnd(36)}${keys.map((k) => k.padStart(9)).join('')}`
    + `${'mean'.padStart(9)}${'won'.padStart(7)}${'strict'.padStart(8)}${'robust'.padStart(8)}`);
  for (const p of policies.slice(1)) {
    const mine = results.get(p.name).mine;
    const xs = mine.map((v, i) => 100 * (v - base[i]) / base[i]);
    const v = verdict(xs);
    console.log(`${p.name.padEnd(36)}${xs.map((x) => signed(x, 2).padStart(9)).join('')}`
      + `${signed(v.mean, 2).padStart(9)}${(v.wins + '/' + xs.length).padStart(7)}`
      + `${(v.strict ? 'PASS' : '-').padStart(8)}${(v.robust ? 'PASS' : '-').padStart(8)}`);
  }
  console.log(NL + `${'policy'.padEnd(36)}${'pts/md'.padStart(9)}${'covered'.padStart(10)}${'spent'.padStart(9)}`);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  for (const p of policies) {
    const c = results.get(p.name);
    console.log(`${p.name.padEnd(36)}${mean(c.mine).toFixed(1).padStart(9)}`
      + `${(mean(c.cover).toFixed(1) + '%').padStart(10)}${mean(c.spent).toFixed(0).padStart(9)}`);
  }
}
