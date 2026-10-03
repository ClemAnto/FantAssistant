/* The odds of «gone before our next turn» (`app/src/app/core/rival-odds.ts`), replayed on REAL finished drafts with the
 * app's own `goneOdds`: at every turn of every squad, the table as it stood, scored on the men the rivals really took
 * before that squad's next pick (priorita-draft-v1.md §35).
 *
 *   sure       of the men given >= SURE_ODDS, how many were really gone (the 80% the operator asked for), and how many
 *   top-n      the n likeliest, n = the rivals' real picks in the window, against the n dearest free (the null)
 *   by phase   a squad's first EARLY_PICKS turns (the price alone) and the rest
 *
 * The session dumps carry paid content and stay OUT of the repository. A local session (`FL-`) carries no listone:
 * pass the listone of a session of the same game and championship after it, `--listone PATH`.
 * The weights were fitted on these same drafts: what is printed here checks that the shipped code reproduces the
 * bench, it is NOT a held-out figure. The held-out ones (one table out, fitted on the others) are in §35.
 *
 *   node build.mjs && node rival-odds.mjs SESSION.json [--listone LISTONE.json]
 */
import { readFileSync } from 'node:fs';

import { EARLY_PICKS, goneOdds, SHOWN_ODDS, SURE_ODDS } from './appcode.mjs';

const argv = process.argv.slice(2);
const at = argv.indexOf('--listone');
const file = argv.find((one, i) => !one.startsWith('--') && (at < 0 || i !== at + 1));
const listOf = (items) => (Array.isArray(items) ? items : Object.values(items ?? {})).filter((one) => one != null);
const root = JSON.parse(readFileSync(file, 'utf-8'));
const env = at >= 0 ? JSON.parse(readFileSync(argv[at + 1], 'utf-8')).env : root.env;
const state = root.state;
const game = state.settings?.game ?? 1;
const mantra = game === 2;
const roles = state.settings.roles;
const LINE = { gk: 'P', def: 'D', mid: 'C', atk: 'A' };
const picks = listOf(state.picks).filter((one) => !one.released).sort((a, b) => a.index - b.index);
let listone = listOf(env.playerList).filter((one) => LINE[one.zone?.classic]);
const clubOfId = new Map(listone.map((one) => [one.id, one.team]));
const played = new Set(picks.map((one) => clubOfId.get(one.playerId)));
listone = listone.filter((one) => played.has(one.team));
const byId = new Map(listone.map((one) => [one.id, one]));
const slotOf = (one) => (mantra ? (one.zone.classic === 'gk' ? 'por' : (one.roles?.[0] ?? '')) : LINE[one.zone.classic]);
const price = (one) => one.stats?.fmv?.[mantra ? 'mantra' : 'classic'] ?? 0;
const seen = new Map(listone.map((one) => [one.id, {
  line: one.zone.classic, club: one.team, fm: Number(one.stats?.avgFantaGrade) || null, mv: Number(one.stats?.avgGrade) || null,
  played: Number(one.stats?.playeds) || 0,
}]));
const teamIds = listOf(state.teams).map((one) => one.id);
const firstRound = [];
for (const pick of picks) if (!firstRound.includes(pick.teamId)) firstRound.push(pick.teamId);
const limits = mantra ? { por: roles.gk[1] } : { por: roles.gk[1], dif: roles.def[1], cen: roles.mid[1], att: roles.atk[1] };
const rounds = roles.size[1];

const score = { early: { n: 0, hit: 0, nul: 0 }, late: { n: 0, hit: 0, nul: 0 }, sure: 0, sureHit: 0, shown: 0, shownHit: 0, bins: Array.from({ length: 10 }, () => [0, 0]) };
for (let k = 0; k < picks.length; k += 1) {
  const me = picks[k].teamId;
  let next = k + 1;
  while (next < picks.length && picks[next].teamId !== me) next += 1;
  if (next >= picks.length || next === k + 1) continue;
  const before = picks.slice(0, k).filter((one) => byId.has(one.playerId));
  const taken = new Set(before.map((one) => one.playerId));
  const teams = teamIds.map((id) => {
    const own = before.filter((one) => one.teamId === id).map((one) => byId.get(one.playerId));
    return {
      id, label: String(id), slots: own.map(slotOf), held: own.map((one) => ({ roles: one.roles ?? [] })),
      heldIds: own.map((one) => one.id), rosterValue: own.reduce((sum, one) => sum + price(one), 0),
      pickValues: own.map(price), picksCount: own.length, firstRoundIndex: Math.max(0, firstRound.indexOf(id)), limits,
    };
  });
  const pool = listone.filter((one) => !taken.has(one.id)).map((one) => ({
    id: one.id, name: one.name, club: one.team, slot: slotOf(one), roles: one.roles ?? [], price: price(one),
    net: null, surplus: null, value: null,
  }));
  const odds = goneOdds({
    teams, pool, mineId: me, keeperCap: roles.gk[1], maxAheadPicks: 1,
    orderType: state.pickOrderType === 'pingpong' ? 'pingpong' : 'default', cap: null, rounds, seen, seed: k + 1,
  });
  // Our own pick leaves the list the moment it is made, so it is scored on nobody: the odds are read before we choose.
  odds.delete(picks[k].playerId);
  const went = new Set(picks.slice(k + 1, next).map((one) => one.playerId));
  const n = went.size;
  const likeliest = [...odds].sort((a, b) => b[1] - a[1]).slice(0, n);
  const dearest = [...pool].sort((a, b) => b.price - a.price).slice(0, n);
  const bucket = teams.find((one) => one.id === me).picksCount < EARLY_PICKS ? score.early : score.late;
  bucket.n += n;
  bucket.hit += likeliest.filter(([id]) => went.has(id)).length;
  bucket.nul += dearest.filter((one) => went.has(one.id)).length;
  for (const [id, p] of odds) {
    const bin = Math.min(9, Math.floor(p * 10)); score.bins[bin][0] += 1; score.bins[bin][1] += went.has(id) ? 1 : 0;
    if (p >= SURE_ODDS) { score.sure += 1; score.sureHit += went.has(id) ? 1 : 0; }
    if (p >= SHOWN_ODDS) { score.shown += 1; score.shownHit += went.has(id) ? 1 : 0; }
  }
}
const pc = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');
const turns = picks.length / teamIds.length;
console.log(`${root.id} (${mantra ? 'mantra' : 'classic'}, ${state.pickOrderType ?? 'default'}, ${teamIds.length} squadre)`);
console.log(`  primi ${EARLY_PICKS} turni: ${pc(score.early.hit, score.early.n)} dei nomi (piu' cari ${pc(score.early.nul, score.early.n)})`);
console.log(`  dal ${EARLY_PICKS + 1}°:        ${pc(score.late.hit, score.late.n)} dei nomi (piu' cari ${pc(score.late.nul, score.late.n)})`);
console.log(`  sicuri (>= ${SURE_ODDS}): ${pc(score.sureHit, score.sure)} usciti davvero, ${score.sure} nomi (${(score.sure / (picks.length - teamIds.length)).toFixed(2)} a turno)`);
console.log(`  mostrati (>= ${SHOWN_ODDS}):  ${pc(score.shownHit, score.shown)} usciti davvero, ${score.shown} nomi`);
console.log(`  taratura: ${score.bins.map(([n, h], i) => `${i / 10}: ${pc(h, n)}/${n}`).join(' · ')}`);
