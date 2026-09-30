/* Todolist classic, item 1.3: do the page's predictions of a rival's pick beat «he takes the dearest», on REAL
 * rivals? The draft bench cannot answer that - its table is DECLARED (heads we wrote), so a predictor scored there
 * is scored against our own model of the rivals. Here the rivals are the squads of real finished drafts, replayed
 * pick by pick: before every rival pick the predictors see exactly the table as it stood, and are scored on the man
 * he really took.
 *
 * The predictors are the app's own functions (`predictRivalPick`, `classifyRivals`, from `appcode.mjs`), and the
 * nulls are plain orderings of the free pool:
 *   dearest         the free man with the highest classic FVM, whatever his line;
 *   dearest-legal   the same, among the men his squad may still take (line quotas and keepers);
 *   app             `predictRivalPick` with the default head - what the page predicts for a rival it knows nothing of;
 *   app-no-tail     the same without the tail rule (the last two of a round buy surplus per credit);
 *   app-heads       the head guessed from the rival's own picks so far (`classifyRivals`), as the page does.
 *
 * The session files are dumps of fanta-asta-live (`sessions/<code>`: `env.playerList` + `state`) and carry paid
 * content: they stay OUT of the repository. The sheet is the app's own bundle copy (`app/public/data/sheets`).
 *
 *   node build.mjs && node real-rivals.mjs PATH [PATH ...] [--phases]
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { DEFAULT_HEAD, capBlocks, classifyRivals, predictRivalPick, startingPlaces } from './appcode.mjs';
import { ROOT } from './paths.mjs';

const CLASSIC = { gk: 'P', def: 'D', mid: 'C', atk: 'A' };
const LINE = { P: 'por', D: 'dif', C: 'cen', A: 'att' };
const listOf = (items) => (Array.isArray(items) ? items : Object.values(items ?? {})).filter((one) => one != null);

/** The engine's numbers of one sheet: the surplus a `surplus` head reads, the VALUE a `valore` head reads, the slot. */
function sheetOf(file) {
  const sheet = JSON.parse(gunzipSync(readFileSync(`${ROOT}app/public/data/sheets/${file}`)).toString('utf-8'));
  const col = (name) => sheet.columns.indexOf(name);
  return new Map(sheet.rows.map((row) => {
    const fm = row[col('engine_fm_pred')] ?? row[col('est_fm')];
    const pv = row[col('engine_pv_pred')] ?? row[col('est_pv')];
    return [row[col('fc_id')], {
      surplus: row[col('engine_surplus')] ?? row[col('est_surplus')] ?? null,
      value: fm != null && pv != null ? fm * pv : null,
      slot: col('engine_role_slot') >= 0 ? row[col('engine_role_slot')] : null,
    }];
  }));
}
const rulebook = (file) => JSON.parse(readFileSync(`${ROOT}config/${file}`, 'utf-8'));

/**
 * The two games. CLASSIC: the Serie A sheet, the slot is the listone's zone and the line quotas bind. MANTRA: the
 * only real mantra draft is the EuroLeghe one (FA-jo5-zai), so the EuroLeghe sheet, the engine's slot, no line
 * quota, and that league's declared ceiling (FVM >= 213 frozen for the first 5 turns). Its porte rule is NOT
 * modelled: every predictor pays for that alike.
 */
const GAMES = {
  1: { sheet: 'leghe.json.gz', rules: 'classic_modules.json', fvm: 'classic', cap: null },
  2: { sheet: 'euroleghe.json.gz', rules: 'mantra_modules.json', fvm: 'mantra', cap: { fvm: 213, frozenTurns: 5 } },
};

const PHASED = process.argv.includes('--phases');
const PREDICTORS = ['dearest', 'dearest-legal', 'value-legal', 'surplus-legal', 'app', 'app-no-tail', 'app-heads'];
const ORDERINGS = ['dearest', 'dearest-legal', 'value-legal', 'surplus-legal'];
const PHASES = [['giri 1-5', 0, 5], ['giri 6-20', 5, 20], ['giri 21+', 20, 99]];
const total = () => Object.fromEntries(PREDICTORS.map((name) => [name, { hit: 0, line: 0, top5: 0, ranks: [] }]));

function replay(path) {
  const root = JSON.parse(readFileSync(path, 'utf-8'));
  const state = root.state;
  const game = GAMES[state.settings?.game];
  if (!game) throw new Error(`${path}: unknown game ${state.settings?.game}`);
  const mantra = state.settings.game === 2;
  const engine = sheetOf(game.sheet);
  const places = startingPlaces(rulebook(game.rules));
  const roles = state.settings.roles;
  const keeperCap = roles.gk[1];
  // Mantra has no line quota: only the keepers are counted, as the page counts them.
  const limits = mantra ? { por: keeperCap } : { por: keeperCap, dif: roles.def[1], cen: roles.mid[1], att: roles.atk[1] };
  const pool = listOf(root.env.playerList).filter((one) => CLASSIC[one.zone?.classic]).map((one) => {
    const keeper = one.zone.classic === 'gk';
    const slot = mantra
      ? (keeper ? 'por' : (engine.get(one.id)?.slot ?? (one.roles?.[0] ?? '').toLowerCase()))
      : CLASSIC[one.zone.classic];
    return {
      id: one.id,
      name: one.name,
      club: one.team,
      slot,
      line: CLASSIC[one.zone.classic],
      roles: mantra ? one.roles ?? [] : [CLASSIC[one.zone.classic]],
      price: one.stats?.fmv?.[game.fvm] ?? 0,
      net: engine.get(one.id)?.surplus ?? null,
      surplus: engine.get(one.id)?.surplus ?? null,
      value: engine.get(one.id)?.value ?? null,
    };
  });
  const picks = listOf(state.picks).filter((one) => !one.released).sort((a, b) => a.index - b.index);
  // THE CLUBS THE LEAGUE PLAYED: a finished session no longer publishes `inactiveTeams` (the EuroLeghe draft
  // excluded whole championships), so the evidence left is the picks themselves - a club nobody took a man from
  // is read as excluded. Without it «the dearest» on FA-jo5-zai was a Serie A man nobody could call (median rank
  // of the real pick 123). On the classic drafts every club was picked from, so nothing moves there.
  const clubOf = new Map(pool.map((one) => [one.id, one.club]));
  const played = new Set(picks.map((one) => clubOf.get(one.playerId)));
  pool.splice(0, pool.length, ...pool.filter((one) => played.has(one.club)));
  const byId = new Map(pool.map((one) => [one.id, one]));
  const teams = new Map(listOf(state.teams).map((one) => [one.id, {
    id: one.id, label: one.connection?.label ?? '', slots: [], held: [], heldIds: [], rosterValue: 0, pickValues: [],
    picksCount: 0, firstRoundIndex: 0, limits, lines: [],
  }]));
  const taken = new Set();
  const score = { all: total(), phases: PHASES.map(total), picks: 0 };

  picks.forEach((pick, index) => {
    const team = teams.get(pick.teamId);
    const real = byId.get(pick.playerId);
    if (team && real) {
      // `--phases`: the draft was played BY DEPARTMENT (FA-l1n-0pn: 24 keepers, then 64 defenders, 64 midfielders,
      // 48 forwards), a table convention the session publishes nowhere. The line on the clock is then a fact of the
      // phase, and every predictor is asked only within it.
      const free = pool.filter((one) => !taken.has(one.id) && (!PHASED || one.line === real.line));
      const legal = free.filter((one) => {
        if (capBlocks(team.picksCount, one.price, game.cap)) return false;
        const line = LINE[one.line];
        return limits[line] == null || team.lines.filter((held) => held === one.line).length < limits[line];
      });
      const inRound = [...teams.values()].filter((one) => one.picksCount === team.picksCount).length;
      const heads = classifyRivals({
        picks: picks.slice(0, index), pool, places, keeperCap, mineId: -1, cap: game.cap,
      });
      const dear = (list) => [...list].sort((a, b) => b.price - a.price);
      const guess = {
        'dearest': dear(free.filter((one) => !capBlocks(team.picksCount, one.price, game.cap))),
        'dearest-legal': dear(legal),
        'value-legal': [...legal].sort((a, b) => (b.value ?? -1e9) - (a.value ?? -1e9)),
        'surplus-legal': [...legal].sort((a, b) => (b.surplus ?? -1e9) - (a.surplus ?? -1e9)),
        'app': [predictRivalPick(team, free, places, keeperCap, inRound, DEFAULT_HEAD, game.cap)],
        'app-no-tail': [predictRivalPick(team, free, places, keeperCap, Infinity, DEFAULT_HEAD, game.cap)],
        'app-heads': [predictRivalPick(team, free, places, keeperCap, inRound, heads.get(team.id) ?? DEFAULT_HEAD, game.cap)],
      };
      const round = team.picksCount;
      const phase = PHASES.findIndex(([, from, to]) => round >= from && round < to);
      for (const name of PREDICTORS) {
        const list = guess[name].filter(Boolean);
        for (const bucket of [score.all, score.phases[phase]]) {
          bucket[name].hit += list[0]?.id === real.id ? 1 : 0;
          bucket[name].line += list[0]?.line === real.line ? 1 : 0;
          bucket[name].top5 += list.slice(0, 5).some((one) => one.id === real.id) ? 1 : 0;
          if (ORDERINGS.includes(name)) {
            const at = list.findIndex((one) => one.id === real.id);
            bucket[name].ranks.push(at < 0 ? list.length : at + 1);
          }
        }
      }
      score.picks += 1;
      score.phases[phase].n = (score.phases[phase].n ?? 0) + 1;
    }
    taken.add(pick.playerId);
    if (team) {
      team.slots.push(real?.slot ?? '');
      team.lines.push(real?.line ?? '');
      team.pickValues.push(real?.price ?? 0);
      team.rosterValue += real?.price ?? 0;
      team.picksCount += 1;
    }
  });
  return { code: root.id, order: state.pickOrderType, score };
}

const pc = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');
const runs = process.argv.slice(2).filter((one) => !one.startsWith('--')).map(replay);
if (!runs.length) {
  console.error('node real-rivals.mjs SESSION.json [SESSION.json ...]');
  process.exit(2);
}
for (const run of [...runs, { code: 'TUTTE', order: '', score: null }]) {
  const all = run.score?.all ?? total();
  const n = run.score?.picks ?? runs.reduce((a, one) => a + one.score.picks, 0);
  if (!run.score) {
    for (const one of runs) {
      for (const name of PREDICTORS) {
        for (const key of ['hit', 'line', 'top5']) all[name][key] += one.score.all[name][key];
        all[name].ranks.push(...one.score.all[name].ranks);
      }
    }
  }
  console.log(`\n${run.code} ${run.order} - ${n} scelte`);
  console.log('predittore       esatto   reparto  primi 5  rango mediano della scelta vera');
  for (const name of PREDICTORS) {
    const one = all[name];
    const ordering = ORDERINGS.includes(name);
    const ranks = [...one.ranks].sort((a, b) => a - b);
    const median = ranks.length ? ranks[Math.floor(ranks.length / 2)] : null;
    console.log(`${name.padEnd(15)}  ${pc(one.hit, n).padStart(6)}   ${pc(one.line, n).padStart(6)}   `
      + `${(ordering ? pc(one.top5, n) : '').padStart(6)}   ${ordering ? median : ''}`);
  }
  if (run.score) {
    for (const [at, [label]] of PHASES.entries()) {
      const bucket = run.score.phases[at];
      console.log(`  ${label.padEnd(10)} (${bucket.n ?? 0}): ${PREDICTORS.map((name) => `${name} ${pc(bucket[name].hit, bucket.n)}`).join(' · ')}`);
    }
  }
}
