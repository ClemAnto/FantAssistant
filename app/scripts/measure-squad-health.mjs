#!/usr/bin/env node
/**
 * Where the five «squad health» stars get their SCALE, measured instead of chosen.
 *
 * A star is a quintile class of the REAL squads of `docs/real-data/` (the 131 auctions played with
 * the operator's own roster shape, 1.176 squads): «4 stars» therefore means «better than 60-80% of
 * the tables that really sat down», which is the only reading a number of this kind can carry - a
 * scale calibrated on a maximum, or on nothing at all, says «good» in the abstract.
 *
 * Two things this script deliberately does NOT do, because the archive cannot:
 *  - it does not WEIGH the stars. The archive is a judge of the ENVIRONMENT (what a real table
 *    looks like) and never of the yield; the yield belongs to the auction bench (`bench/auction`),
 *    which replays ten real seasons over hundreds of urns. Same division as §15 of the auction doc.
 *  - it does not score an OUTCOME. These auctions are dated 19-20/08/2026, i.e. the season they buy
 *    for has not been played, so what is measurable here is the distribution and nothing else.
 *
 * It also measures the REDUNDANCY between the candidates, which is what decides how many stars there
 * are: two readings of one number would eventually give one squad two verdicts.
 *
 * Read-only. Needs the app bundle (`npm run data:pull`) and `docs/real-data/`.
 *   node app/scripts/measure-squad-health.mjs [--all|--his]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SHEET = path.join(ROOT, 'app', 'public', 'data', 'sheets', 'leghe.json.gz');
const REAL = path.join(ROOT, 'docs', 'real-data');
/** His own two shapes (`referenceShape` picks the better of the two, so this measure does too). */
const SHAPES = [
  { name: '3-4-3', P: 1, D: 3, C: 4, A: 3 },
  { name: '4-3-3', P: 1, D: 4, C: 3, A: 3 },
];
/** The departmental quotas the auction bench ADOPTED (§19.3), the target of the «spartizione» star. */
const TARGET = { P: 0.098, D: 0.254, C: 0.239, A: 0.409 };

if (!fs.existsSync(SHEET)) {
  console.error(`no bundle at ${SHEET} - run \`npm run data:pull\` in app/ first`);
  process.exit(1);
}
const sheet = JSON.parse(zlib.gunzipSync(fs.readFileSync(SHEET)));
const col = Object.fromEntries(sheet.columns.map((c, i) => [c, i]));
/** `engine_pv_pred` lives on the platform's own calendar, which is what a share of it divides by. */
const MATCHDAYS = sheet.matchdays.platform_target;

const men = new Map();
for (const row of sheet.rows) {
  // The estimate is the declared fallback and carries its own confidence; a man the sheet cannot
  // price at all stays without a `p`, and an unknown is never counted as a zero.
  const pv = row[col.engine_pv_pred] ?? row[col.est_pv];
  const fm = row[col.engine_fm_pred] ?? row[col.est_fm];
  men.set(String(row[col.fc_id]), {
    role: row[col.role_classic],
    club: row[col.club],
    p: pv == null || pv === '' ? null : Math.min(1, Number(pv) / MATCHDAYS),
    fm: fm == null || fm === '' ? null : Number(fm),
  });
}

const csv = (file) => {
  const lines = fs.readFileSync(path.join(REAL, file), 'utf8').trim().split(/\r?\n/);
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])));
};
const auctions = csv('aste.csv');
const awards = csv('aggiudicazioni-compatte.csv');

const sameShape = (a) => a.slot_P === '3' && a.slot_D === '8' && a.slot_C === '8' && a.slot_A === '6';
const identical = (a) => sameShape(a) && a.squadre === '10' && a.budget === '1000';
const onlyHis = process.argv.includes('--his');
const pool = new Set(auctions.filter(onlyHis ? identical : sameShape).map((a) => a.asta_n));
console.log(
  `aste: ${auctions.length} totali · ${auctions.filter(sameShape).length} con la sua rosa 3/8/8/6 · ` +
    `${auctions.filter(identical).length} identiche alla sua (10 squadre, 1000 crediti)`,
);
console.log(`popolazione di questa corsa: ${pool.size} aste (${onlyHis ? '--his' : '--all'})`);

/**
 * Expected empty places of a department: the men are independent draws, «how many have a vote» is a
 * convolution, and the shortfall is a sum over it - exact, not simulated. The keepers are the
 * exception the regulation itself makes: exactly ONE keeper of a club plays, so their cover is the
 * department's own SUM and never a convolution.
 */
function expectedHoles(ps, places) {
  if (places <= 0) return 0;
  let dist = [1];
  for (const p of ps) {
    const next = new Array(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k++) {
      next[k] += dist[k] * (1 - p);
      next[k + 1] += dist[k] * p;
    }
    dist = next;
  }
  let expected = 0;
  for (let k = 0; k < dist.length; k++) expected += dist[k] * Math.max(0, places - k);
  return expected;
}

const bySquad = new Map();
for (const award of awards) {
  if (!pool.has(award.asta_n)) continue;
  const key = `${award.asta_n}|${award.squadra_n}`;
  if (!bySquad.has(key)) bySquad.set(key, []);
  bySquad.get(key).push(award);
}

let total = 0;
let resolved = 0;
const squads = [];
for (const [key, list] of bySquad) {
  const spend = { P: 0, D: 0, C: 0, A: 0 };
  const shares = { P: [], D: [], C: [], A: [] };
  const values = { P: [], D: [], C: [], A: [] };
  const clubs = new Map();
  let unknown = 0;
  let paid = 0;
  for (const award of list) {
    const man = men.get(award.id_calciatore);
    const credits = Number(award.crediti_pagati);
    total += 1;
    paid += credits;
    // A PRICE IS A FACT WHOEVER HE IS: an award we cannot attribute still left that pocket, so it
    // counts in the budget and only its ROLE is missing.
    if (!man || !shares[man.role]) {
      unknown += 1;
      continue;
    }
    resolved += 1;
    spend[man.role] += credits;
    if (man.p != null) {
      shares[man.role].push(man.p);
      if (man.fm != null) values[man.role].push(man.p * man.fm);
    }
    clubs.set(man.club, (clubs.get(man.club) ?? 0) + 1);
  }
  // A squad we cannot describe is left out rather than described wrong.
  if (unknown > list.length * 0.15) continue;

  let best = null;
  for (const shape of SHAPES) {
    const holes = { P: Math.max(0, shape.P - Math.min(1, shares.P.reduce((a, b) => a + b, 0))) };
    for (const role of ['D', 'C', 'A']) holes[role] = expectedHoles(shares[role], shape[role]);
    const sum = holes.P + holes.D + holes.C + holes.A;
    if (!best || sum < best.sum) best = { sum, holes, shape };
  }
  let value = 0;
  let presence = 0;
  let places = 0;
  for (const role of ['P', 'D', 'C', 'A']) {
    const k = best.shape[role];
    places += k;
    value += [...values[role]].sort((a, b) => b - a).slice(0, k).reduce((a, b) => a + b, 0);
    presence += [...shares[role]].sort((a, b) => b - a).slice(0, k).reduce((a, b) => a + b, 0);
  }
  squads.push({
    key,
    paid,
    holes: best.sum,
    perRole: best.holes,
    presence: presence / places,
    value,
    maxClub: Math.max(0, ...clubs.values()),
    quota: { P: spend.P / paid, D: spend.D / paid, C: spend.C / paid, A: spend.A / paid },
    // Half the total variation distance from the adopted split: a distance has a natural zero,
    // while a star on the quota alone would need an upper cut nobody has measured.
    drift:
      (Math.abs(spend.P / paid - TARGET.P) +
        Math.abs(spend.D / paid - TARGET.D) +
        Math.abs(spend.C / paid - TARGET.C) +
        Math.abs(spend.A / paid - TARGET.A)) /
      2,
  });
}
console.log(
  `aggiudicazioni: ${total} · risolte sul foglio ${resolved} (${((100 * resolved) / total).toFixed(1)}%)`,
);
console.log(`rose descrivibili: ${squads.length}\n`);

const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const line = (name, values, decimals = 3) => {
  const at = (q) => quantile(values, q).toFixed(decimals);
  console.log(
    `${name.padEnd(26)} p20 ${at(0.2)} · p40 ${at(0.4)} · mediana ${at(0.5)} · p60 ${at(0.6)} · p80 ${at(0.8)}`,
  );
};
console.log('I TAGLI DELLE STELLINE (quintili delle rose vere)');
line(
  'buchi attesi',
  squads.map((s) => s.holes),
  2,
);
line(
  'presenze undici',
  squads.map((s) => s.presence),
);
line(
  'scarto spartizione',
  squads.map((s) => s.drift),
);
line(
  'valore undici (fp/gg)',
  squads.map((s) => s.value),
  1,
);
console.log('\nDOVE STANNO I BUCHI, per reparto');
for (const role of ['P', 'D', 'C', 'A']) {
  line(
    `buchi ${role}`,
    squads.map((s) => s.perRole[role]),
  );
}
console.log('\nQUOTE DI BUDGET, e il bersaglio adottato');
for (const role of ['P', 'D', 'C', 'A']) {
  line(
    `quota ${role} (obiettivo ${TARGET[role].toFixed(3)})`,
    squads.map((s) => s.quota[role]),
  );
}
console.log('\nUOMINI DELLO STESSO CLUB');
const clubsPer = squads.map((s) => s.maxClub);
const share = (f) => {
  const n = clubsPer.filter(f).length;
  return `${n} (${((100 * n) / clubsPer.length).toFixed(0)}%)`;
};
console.log(
  `  <=2: ${share((x) => x <= 2)} · 3: ${share((x) => x === 3)} · 4: ${share((x) => x === 4)} · ` +
    `5: ${share((x) => x === 5)} · >=6: ${share((x) => x >= 6)}`,
);

const correlation = (xs, ys) => {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
};
console.log('\nRIDONDANZA — quante stelline esistono davvero');
const candidates = {
  buchi: (s) => s.holes,
  presenze: (s) => s.presence,
  valore: (s) => s.value,
  'quota D': (s) => s.quota.D,
  'quota A': (s) => s.quota.A,
  club: (s) => s.maxClub,
};
const names = Object.keys(candidates);
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const r = correlation(squads.map(candidates[names[i]]), squads.map(candidates[names[j]]));
    console.log(`  ${names[i]} ~ ${names[j]}`.padEnd(30) + r.toFixed(3));
  }
}
