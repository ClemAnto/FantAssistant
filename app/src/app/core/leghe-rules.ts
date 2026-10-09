/**
 * THE LEAGUE'S LINEUP RULES, READ FROM LEGHE (08/10/2026). The operator's rule has always been «il
 * regolamento della cosa vera si chiede, non si deduce» - and with the account connected it does not even
 * have to be asked: Leghe serves it. Two endpoints, two short-keyed payloads, one typed model.
 *
 *   GET /onboarding/v1/league/settings/lineup     modules, bench, captain, switch, deadline
 *   GET /onboarding/v1/league/settings/calculate  substitutions, office reserve, modifiers, goal steps
 *   GET /onboarding/v1/league/settings/rosters    which GAME the league plays (`sroles` 2 = Mantra)
 *
 * The meaning of every short key comes from the Leghe front-end's own mapping (services/my-league,
 * views/lineup) and was checked against the four leagues of the operator's account on 08/10/2026. A
 * key this file does not understand is left out of the model rather than guessed; a missing payload
 * gives a null section, never a default dressed up as the league's rule («vuoto = ignoto, mai zero»).
 */

export type LegheGame = 'classic' | 'mantra';

/** Classic: Dynamic, Hybrid, Traditional. Mantra: Basic, Easy, Master (sstype 1-6). */
export type SubstitutionKind = 'dynamic' | 'hybrid' | 'traditional' | 'basic' | 'easy' | 'master';

export const SUBSTITUTION_LABEL: Record<SubstitutionKind, string> = {
  dynamic: 'Dynamic (prima il cambio modulo)',
  hybrid: 'Hybrid (cambio modulo come ultima risorsa)',
  traditional: 'Traditional (solo pari ruolo)',
  basic: 'Basic (cambio modulo solo se indispensabile)',
  easy: 'Easy (mai cambio modulo, con malus)',
  master: "Master (comanda l'ordine della panchina)",
};

const SUBSTITUTION_KINDS: Record<number, SubstitutionKind> = {
  1: 'dynamic',
  2: 'hybrid',
  3: 'traditional',
  4: 'basic',
  5: 'easy',
  6: 'master',
};

export interface BenchRule {
  /** Players allowed on the bench; null = no limit (a variable bench with `tbench` 0). */
  size: number | null;
  /** A fixed bench has exactly `size` places; a variable one has up to `size`. */
  fixed: boolean;
  /**
   * Per-role counts in the league's own order (classic P/D/C/A, mantra Por/Mov): exact on a fixed
   * bench, minimums on a variable one. All zeros = no constraint.
   */
  perRole: number[];
  /** A fixed role per bench slot (`bseq`), when the league imposes one. */
  sequence: number[] | null;
}

export interface OfficeReserve {
  /** The «riserva d'ufficio»: a fictitious player who enters with a fixed vote when nobody else can. */
  on: boolean;
  keeper: number | null;
  outfield: number | null;
}

/** A modifier read as «value for each band of the average», bands every `step` from `from`. */
export interface BandModifier {
  from: number;
  to: number;
  /** Bonus per band, the first one being «below `from`». */
  values: number[];
  /** Whether the keeper's vote is in the average (defence modifier only). */
  withKeeper: boolean | null;
}

export interface LineupRules {
  game: LegheGame | null;
  /** Allowed modules as Leghe writes them (`343`, `4231`). */
  modules: string[];
  bench: BenchRule;
  substitutions: { kind: SubstitutionKind | null; max: number | null };
  officeReserve: OfficeReserve;
  /** A booked player without a vote stays on the pitch with 5.5 instead of being substituted. */
  bookedStays: boolean;
  captain: 'season' | 'match' | 'none' | null;
  switchMode: 'none' | 'basic' | 'plus' | null;
  /** Minutes before the first match at which lineups close. */
  closesMinutesBefore: number | null;
  /** Without a lineup, the previous one is used. */
  reusesLast: boolean | null;
  /** Classic defence modifier, or Mantra D-Factor (`smodd`). */
  defence: BandModifier | null;
  /** «Fattore rendimento» (R-Factor): bonus indexed by how many of the eleven reached a sufficient vote. */
  performance: number[] | null;
  /** Head-to-head scoring: the first goal at `first` points, then every `step` (Leghe's `stlmt`/`stgoal`). */
  goals: { first: number; steps: number[] } | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const nums = (v: unknown): number[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === 'number') ? (v as number[]) : null;
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** `343` -> `3-4-3`, `4231` -> `4-2-3-1`. One digit per line, which is how Leghe stores every module. */
export function moduleLabel(code: string): string {
  return /^\d+$/.test(code) ? code.split('').join('-') : code;
}

export function parseRules(lineupRaw: unknown, calcRaw: unknown, rostersRaw: unknown): LineupRules {
  const lineup = obj(lineupRaw) ?? {};
  const calc = obj(calcRaw) ?? {};
  const rosters = obj(rostersRaw);
  const subst = obj(calc['subst']) ?? {};
  const step = obj(calc['step']);
  const smodd = obj(calc['smodd']);
  const smodp = obj(calc['smodp']);
  const bnMls = obj(calc['bnMls']);

  const game: LegheGame | null = rosters ? (rosters['sroles'] === 2 ? 'mantra' : 'classic') : null;
  const tbench = num(lineup['tbench']);
  const fixed = lineup['fbench'] === true;
  const ssnum = num(subst['ssnum']);
  const lcap = num(lineup['lcap']);
  const lswi = num(lineup['lswi']);

  const defence = smodd
    ? {
        from: num(smodd['smodld']) ?? 6,
        to: num(smodd['smodlu']) ?? 6,
        values: nums(smodd['smodva']) ?? [],
        withKeeper: typeof smodd['smoddg'] === 'boolean' ? (smodd['smoddg'] as boolean) : null,
      }
    : null;

  return {
    game,
    modules: Array.isArray(lineup['mods']) ? (lineup['mods'] as unknown[]).map(String) : [],
    bench: {
      // With a variable bench 0 means «no limit»; with a fixed bench 0 means «no bench at all».
      size: tbench === null ? null : !fixed && tbench === 0 ? null : tbench,
      fixed,
      perRole: nums(lineup['brdrs']) ?? [],
      sequence: nums(lineup['bseq']),
    },
    substitutions: {
      kind: SUBSTITUTION_KINDS[num(subst['sstype']) ?? -1] ?? null,
      // 11 is how Leghe writes «unlimited»: there are only eleven men to replace.
      max: ssnum === null ? null : ssnum >= 11 ? null : ssnum,
    },
    officeReserve: {
      on: subst['ssdft'] === true,
      keeper: num(subst['ssdfg']),
      outfield: num(subst['ssdfm']),
    },
    bookedStays: (num(bnMls?.['bmycsv']) ?? 0) !== 0,
    captain: lcap === 1 ? 'season' : lcap === 2 ? 'match' : lcap === 3 ? 'none' : null,
    switchMode: lswi === 1 ? 'none' : lswi === 2 ? 'basic' : lswi === 3 ? 'plus' : null,
    closesMinutesBefore: num(lineup['elnp']),
    reusesLast: typeof lineup['rlnp'] === 'boolean' ? (lineup['rlnp'] as boolean) : null,
    defence: defence && defence.values.some((v) => v !== 0) ? defence : null,
    performance: (() => {
      const values = nums(smodp?.['smodva']);
      return values && values.some((v) => v !== 0) ? values : null;
    })(),
    goals: step
      ? { first: num(step['stlmt']) ?? 66, steps: nums(step['stgoal']) ?? [] }
      : null,
  };
}

/** One line per rule, in the operator's words, for the summary on the page. */
export function rulesSummary(rules: LineupRules): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  out.push({ label: 'Moduli', value: rules.modules.map(moduleLabel).join(' · ') || 'non letti' });
  const bench = rules.bench;
  // Mantra reads the bench as «at least this many keepers» whatever the flags say (the Leghe front-end
  // ignores the per-role counts there); classic reads them as exact on a fixed bench, minimums otherwise.
  const keepers = bench.perRole[0] ?? 0;
  // Classic, fixed bench: a zero is «any number» (Leghe: «se fixbench è true 0 vuol dire ruolo variabile»), so it
  // is printed as a dash; a fixed role per place (`bseq`, ids 1-4) is printed as that sequence.
  const perRole =
    rules.game === 'mantra'
      ? keepers > 0
        ? `, almeno ${keepers} ${keepers === 1 ? 'portiere' : 'portieri'}`
        : ''
      : bench.sequence?.length
        ? `, in sequenza ${bench.sequence.map((id) => 'PDCA'[id - 1] ?? '?').join(' ')}`
        : bench.perRole.some((n) => n > 0)
          ? ` (per ruolo P/D/C/A: ${bench.perRole.map((n) => (bench.fixed && n === 0 ? '–' : n)).join('/')}${bench.fixed ? '' : ' minimi'})`
          : '';
  out.push({
    label: 'Panchina',
    value:
      bench.size === null
        ? 'senza limite'
        : `${bench.size} ${bench.fixed ? 'posti fissi' : 'posti al massimo'}${perRole}`,
  });
  out.push({
    label: 'Sostituzioni',
    value:
      (rules.substitutions.kind ? SUBSTITUTION_LABEL[rules.substitutions.kind] : 'tipo non letto') +
      ` · ${rules.substitutions.max === null ? 'illimitate' : `al massimo ${rules.substitutions.max}`}`,
  });
  out.push({
    label: "Riserva d'ufficio",
    value: rules.officeReserve.on
      ? `sì (portiere ${rules.officeReserve.keeper ?? '?'}, movimento ${rules.officeReserve.outfield ?? '?'})`
      : 'no',
  });
  out.push({
    label: 'Capitano',
    value:
      rules.captain === 'none' ? 'no' : rules.captain === 'season' ? 'fisso per la stagione' : rules.captain === 'match' ? 'a ogni giornata' : 'non letto',
  });
  out.push({
    label: 'Switch',
    value: rules.switchMode === 'plus' ? 'Plus (con cambio modulo)' : rules.switchMode === 'basic' ? 'Basic' : rules.switchMode === 'none' ? 'no' : 'non letto',
  });
  if (rules.defence) {
    const d = rules.defence;
    // Classic pays it only when at least four defenders played (Leghe's `ModificatoriHelper.ModificatoreDifesa`):
    // said here because it is what makes a three-man defence give it up.
    out.push({
      label: rules.game === 'mantra' ? 'D-Factor' : 'Mod. difesa',
      value:
        `da ${d.from} a ${d.to}, fino a +${Math.max(...d.values)}${d.withKeeper ? ' (col portiere)' : ''}` +
        (rules.game === 'classic' ? ', solo con almeno 4 difensori' : ''),
    });
  }
  if (rules.performance) {
    const firstPaid = rules.performance.findIndex((v) => v !== 0);
    out.push({
      label: 'Fattore rendimento',
      value: `da ${firstPaid} sufficienti, fino a +${Math.max(...rules.performance)} con 11`,
    });
  }
  if (rules.goals) {
    out.push({
      label: 'Soglie gol',
      value: `${rules.goals.first}${rules.goals.steps.length ? `, poi ogni ${rules.goals.steps.join('/')}` : ''}`,
    });
  }
  if (rules.closesMinutesBefore !== null) {
    out.push({
      label: 'Chiusura',
      value:
        rules.closesMinutesBefore === 0
          ? "all'inizio della prima partita"
          : `${rules.closesMinutesBefore} ${rules.closesMinutesBefore === 1 ? 'minuto' : 'minuti'} prima della prima partita`,
    });
  }
  return out;
}
