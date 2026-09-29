/* Shows ONE simulated draft on the current listone, squad by squad - a thing to LOOK at, not a measurement.
 *
 *   node show.mjs [current.json] [--seed=N] [--out=FILE.md]
 *
 * The operator's table (28/09/2026): the ODD squads (1, 3, ..., 11) draft with the priority, the EVEN ones
 * take «the dearest FVM in the role they need» - the bench's price head with the app's own role need. The
 * first round's order is the squad number; after it, fewest picks first, then lowest roster FVM. The league's
 * rules: exactly 2 doors + 30 outfield, no Italian clubs, nobody at 213+ FVM in a squad's first 5 picks.
 *
 * The «punti attesi» column is the same arithmetic the priority optimises (the declared eleven, its real
 * reserves chained, the R-Factor's expectation), so it is NOT an independent judge of the priority: it says
 * what each squad is worth by the priority's own lights, and the bench's `multi.mjs priority --declared` on
 * the past seasons is where the two are compared on what really happened. */
import { writeFileSync } from 'node:fs';

import { annotate, loadShapes, loadWindows, setup } from './bench.mjs';
import { bestEleven } from './appcode.mjs';
import { makeDraft } from './engine.mjs';
import { baseRole, preferredRules, priority, roleStats, squadWorth } from './priority.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const file = args.find((a) => !a.startsWith('--')) ?? 'current.json';
const seed = Number(flag('seed') ?? 7);
const out = flag('out');

const table = { ...setup('EuroLeghe'), exactKeepers: true, cap: { fvm: 213, turns: 5 } };
const window = Object.values(loadWindows(file))[0];
const shapes = loadShapes('mantra');
const players = annotate(window.players, window.rounds);
const draft = makeDraft(players, shapes, table);
const seatPolicies = {};
for (let i = 0; i < table.teams; i += 2) seatPolicies[i] = priority();
const { got } = draft({ seat: -1, seed, seatPolicies, table: () => 'prezzo' });

const stats = roleStats(players, { teams: table.teams, keepers: table.keepers, rounds: table.rounds });
const rules = preferredRules(shapes);
const wctx = { rules, stats, rounds: table.rounds };
const weight = (m) => (m.p ?? 0) * (m.fm_pred ?? 0);
const fmt = (x, d = 1) => x.toFixed(d);

const lines = [];
const say = (s = '') => lines.push(s);
say(`# Draft simulato — ${window.league} ${window.target}, seed ${seed}`);
say();
say(`Squadre dispari = priorità · pari = FVM più alto nel ruolo che serve. ${window.rounds} giornate da giocare.`);
say();
const summary = [];
got.forEach((roster, i) => {
  const xi = bestEleven(roster, rules, weight);
  const starters = new Set(xi.men.map((m) => m.id));
  const rel = squadWorth(roster, wctx);
  // squadWorth is relative to each place's Z - its holder's, or for an EMPTY place its own role's - so the
  // absolute figure adds back EVERY place's Z: a hole then reads as the 0 it scores, not as -Z.
  const zSum = xi.holders.reduce((s, m, k) => s + (stats.get(baseRole(m
    ?? { roles: xi.places[k].roles, slot: xi.places[k].roles[0] }))?.z ?? 0), 0);
  const fvm = roster.reduce((s, m) => s + m.price, 0);
  const who = i % 2 === 0 ? 'PRIORITÀ' : 'FVM';
  summary.push({ n: i + 1, who, module: xi.module, points: rel + zSum, fvm });
  say(`## Squadra ${i + 1} — ${who} · modulo ${xi.module} · punti attesi ${fmt(rel + zSum, 2)} a giornata · FVM ${fvm}`);
  say();
  say('| # | Calciatore | Club | Ruoli | FVM | FM | Pv | |');
  say('|---|---|---|---|---|---|---|---|');
  roster.forEach((m, k) => {
    say(`| ${k + 1} | ${m.name} | ${m.club} | ${m.roles.join(';')} | ${m.price} | ${fmt(m.fm_pred, 2)} | ${fmt(m.pv_pred)} | ${starters.has(m.id) ? 'XI' : ''} |`);
  });
  say();
});
say('## Riepilogo');
say();
say('| Squadra | Motore | Modulo | Punti attesi a giornata | FVM totale |');
say('|---|---|---|---|---|');
for (const s of summary) say(`| ${s.n} | ${s.who} | ${s.module} | ${fmt(s.points, 2)} | ${s.fvm} |`);
const mean = (who) => { const xs = summary.filter((s) => s.who === who); return xs.reduce((a, s) => a + s.points, 0) / xs.length; };
say();
say(`Media PRIORITÀ ${fmt(mean('PRIORITÀ'), 2)} · media FVM ${fmt(mean('FVM'), 2)} punti attesi a giornata.`);

const text = lines.join('\n');
if (out) writeFileSync(out, text, 'utf8');
console.log(text);
