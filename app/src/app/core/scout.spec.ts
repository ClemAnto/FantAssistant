import { MantraModules } from './auction-value';
import { CLASSIC_QUOTAS, FORM_TOLERANCE, appealOf, ScoutMan, ScoutRole, expendableStarters, groupTrades, pairSwaps, quotasHold, rivalReports, runSearch, simpleSwaps, strengthOf, withoutPadding } from './scout';

/** A classic rulebook with two shapes, enough to make the matching choose. */
const RULES = {
  slot_roles: { P: ['P'], D: ['D'], C: ['C'], A: ['A'] },
  modules: {
    '4-4-2': { D: ['D', 'D', 'D', 'D'], M: ['C', 'C', 'C', 'C'], T: [], A: ['A', 'A'] },
    '3-4-3': { D: ['D', 'D', 'D'], M: ['C', 'C', 'C', 'C'], T: [], A: ['A', 'A', 'A'] },
  },
} as unknown as MantraModules;

let next = 1;
function man(role: ScoutRole, fm: number, pv: number, fvm = 10): ScoutMan {
  const id = next++;
  return { id, name: `${role}${id}`, club: 'X', role, roles: [role.toLowerCase()], shown: [role], fm, pv, fvm };
}

/** A full classic squad (3/8/8/6) of ordinary men, with overrides on top. */
function squad(level: number): ScoutMan[] {
  const out: ScoutMan[] = [];
  for (const [role, n] of Object.entries(CLASSIC_QUOTAS) as [ScoutRole, number][]) {
    for (let i = 0; i < n; i += 1) out.push(man(role, level - i * 0.1, 30 - i * 3));
  }
  return out;
}

describe('scout', () => {
  it('names a rival hole and the men of our bench who would fill it', () => {
    const mine = squad(6);
    mine.filter((m) => m.role === 'A').forEach((m) => { m.fm = 8; m.pv = 32; });
    const weak = squad(6);
    weak.filter((m) => m.role === 'A').forEach((m) => { m.fm = 3; m.pv = 10; });
    const reports = rivalReports({ name: 'Noi', men: mine }, [{ name: 'Debole', men: weak }, { name: 'Pari', men: squad(6) }], RULES, 38);
    const hole = reports[0].holes.find((h) => h.line === 'A');
    expect(hole).toBeDefined();
    expect(hole!.offers.length).toBeGreaterThan(0);
    expect(hole!.offers.every((m) => m.role === 'A')).toBe(true);
  });

  it('a strong man on the bench adds cover, not his whole value', () => {
    const men = squad(6);
    const base = strengthOf(men, RULES, 38);
    const strongBench = man('A', 9, 20);
    const more = strengthOf([...men, strongBench], RULES, 38);
    expect(more.perRound).toBeGreaterThan(base.perRound);
    // An empty pitch place is worth nothing; a starter is worth his value over the rounds.
    expect(base.perRound).toBeCloseTo(base.starters + base.cover, 6);
  });

  it('a full classic squad cannot swap a defender for a forward, but D+A for A+D is fine', () => {
    const men = squad(6);
    const d = men.find((m) => m.role === 'D')!;
    const a = men.find((m) => m.role === 'A')!;
    const otherD = man('D', 6, 30);
    const otherA = man('A', 6, 30);
    expect(quotasHold(men, [...men.filter((m) => m !== d), otherA], false)).toBe(false);
    expect(quotasHold(men, [...men.filter((m) => m !== d && m !== a), otherA, otherD], false)).toBe(true);
    // Mantra binds only the keepers.
    expect(quotasHold(men, [...men.filter((m) => m !== d), otherA], true)).toBe(true);
  });

  it('finds the trade that helps both: our idle striker for their missing defender', () => {
    const mine = squad(6);
    // We have a great forward stuck on the bench (four strong forwards for three places) and a weak defence.
    const ourA = mine.filter((m) => m.role === 'A');
    ourA.forEach((m, i) => { m.fm = 8 - i * 0.2; m.pv = 32; });
    mine.filter((m) => m.role === 'D').forEach((m) => { m.fm = 5; });
    const theirs = squad(6);
    // They lack forwards and are deep at the back.
    theirs.filter((m) => m.role === 'A').forEach((m) => { m.fm = 5; });
    theirs.filter((m) => m.role === 'D').forEach((m, i) => { m.fm = 7.5 - i * 0.1; m.pv = 32; });
    const trades = runSearch({
      mine: { name: 'Noi', men: mine },
      rivals: [{ name: 'Loro', men: theirs }],
      rules: RULES,
      rounds: 38,
      mantra: false,
      maxSize: 2,
    });
    expect(trades.length).toBeGreaterThan(0);
    for (const trade of trades) {
      expect(trade.ours).toBeGreaterThanOrEqual(0.1);
      expect(trade.theirs).toBeGreaterThanOrEqual(0.1);
    }
    // Role-for-role totals hold on a full classic squad.
    const top = trades[0];
    const roles = (men: ScoutMan[]) => men.map((m) => m.role).sort().join('');
    expect(roles(top.give)).toBe(roles(top.take));
  });

  it('groups the variants of one offer under its main pair, the rival once', () => {
    const big = man('C', 7, 34);
    const ours = man('A', 7, 30);
    const s1 = man('D', 5, 10);
    const s2 = man('D', 5.1, 10);
    const t1 = man('D', 5, 10);
    const t2 = man('D', 5.2, 10);
    const trade = (give: ScoutMan[], take: ScoutMan[], gain: number, rival = 'R') =>
      ({ rival, give, take, ours: gain, theirs: 0.2, fvmGive: null, fvmTake: null, spare: [], legal: true });
    const groups = groupTrades(
      [trade([ours, s1], [big, t1], 0.8), trade([ours, s2], [big, t2], 0.9), trade([ours], [t1], 0.3, 'S')],
      (t) => t.ours,
    );
    expect(groups.map((g) => g.rival)).toEqual(['R', 'S']);
    expect(groups[0].offers.length).toBe(1);
    const offer = groups[0].offers[0];
    expect(offer.take.id).toBe(big.id);
    expect(offer.giveCore.map((m) => m.id)).toEqual([ours.id]);
    // Best variant first, and only the SECONDARY men on each line.
    expect(offer.variants.map((v) => [v.give.map((m) => m.id), v.take.map((m) => m.id)])).toEqual([
      [[s2.id], [t2.id]],
      [[s1.id], [t1.id]],
    ]);
    expect(groups[1].offers[0].variants[0].give).toEqual([]);
  });

  it('one target, one offer: different ways of paying for him are its lines (and who replaces him for them)', () => {
    const fernandez = man('C', 7.5, 34);
    const sub = man('C', 6, 20);
    const barnes = man('A', 6, 30);
    const perez = man('A', 6.1, 30);
    const standIns = new Map([[fernandez.id, sub]]);
    const trade = (give: ScoutMan[], gain: number) =>
      ({ rival: 'R', give, take: [fernandez], ours: gain, theirs: 0.2, fvmGive: null, fvmTake: null, spare: [], legal: true, standIns });
    const [group] = groupTrades([trade([barnes], 0.5), trade([perez], 0.6)], (t) => t.ours);
    expect(group.offers.length).toBe(1);
    const offer = group.offers[0];
    expect(offer.giveCore).toEqual([]);
    expect(offer.variants.map((v) => v.give.map((m) => m.id))).toEqual([[perez.id], [barnes.id]]);
    expect(offer.standIn?.id).toBe(sub.id);
  });

  it('never shows the same secondary man twice in one offer', () => {
    const big = man('C', 7, 34);
    const ours = man('A', 7, 30);
    const chabot = man('D', 5, 20);
    const other = man('D', 5, 20);
    const t1 = man('D', 5, 10);
    const t2 = man('D', 5.2, 10);
    const trade = (give: ScoutMan[], take: ScoutMan[], gain: number) =>
      ({ rival: 'R', give, take, ours: gain, theirs: 0.2, fvmGive: null, fvmTake: null, spare: [], legal: true });
    const [group] = groupTrades(
      [trade([ours, chabot], [big, t1], 0.9), trade([ours, chabot], [big, t2], 0.8), trade([ours, other], [big, t2], 0.7)],
      (t) => t.ours,
    );
    const lines = group.offers[0].variants.map((v) => [...v.give, ...v.take].map((m) => m.id));
    // The second line would repeat Chabot and goes; the third repeats nobody kept and stays.
    expect(lines).toEqual([[chabot.id, t1.id], [other.id, t2.id]]);
  });

  it('writes once, on the head line, the men every shown variant moves', () => {
    const big = man('C', 7, 34);
    const ours = man('A', 7, 30);
    const always = man('D', 6, 20);
    const t1 = man('D', 5, 10);
    const t2 = man('D', 5.2, 10);
    const t3 = man('D', 5.1, 10);
    const trade = (take: ScoutMan[], gain: number) =>
      ({ rival: 'R', give: [ours, always], take, ours: gain, theirs: 0.2, fvmGive: null, fvmTake: null, spare: [], legal: true });
    const [group] = groupTrades([trade([big, t1], 0.9), trade([big, t2], 0.8), trade([big, t3], 0.1)], (t) => t.ours, 2);
    const offer = group.offers[0];
    expect(offer.giveCore.map((m) => m.id)).toEqual([ours.id, always.id]);
    expect(offer.takeCore.map((m) => m.id)).toEqual([big.id]);
    expect(offer.variants.map((v) => [v.give.length, v.take.map((m) => m.id)])).toEqual([[0, [t1.id]], [0, [t2.id]]]);
    expect(offer.hidden).toBe(1);
  });

  it('lists a starter only against a reserve of his BASE role (Chabot is no reserve for Grimaldo)', () => {
    const men = squad(6);
    const only442 = { ...RULES, modules: { '4-4-2': (RULES.modules as Record<string, unknown>)['4-4-2'] } } as unknown as MantraModules;
    // Two strong forwards on the pitch; a third just as good on the bench, but his BASE role is another one.
    const forwards = men.filter((m) => m.role === 'A');
    forwards.forEach((m, i) => { m.fm = i < 3 ? 7 : 3; m.pv = 30; });
    forwards[2].roles = ['d', 'a'];
    forwards[2].role = 'D';
    const backedBy = (id: number) => expendableStarters(men, only442, 38).filter((one) => one.replacement.id === id);
    expect(backedBy(forwards[2].id)).toEqual([]);
    // Same base role: now the reserve backs ONE of the two starters, not both.
    forwards[2].roles = ['a'];
    forwards[2].role = 'A';
    const listed = backedBy(forwards[2].id);
    expect(listed.length).toBe(1);
    expect(listed[0].man.role).toBe('A');
  });

  it('a 1x1 swap: who we take beats one of our starters, who we give beats one of theirs', () => {
    const only442 = { ...RULES, modules: { '4-4-2': (RULES.modules as Record<string, unknown>)['4-4-2'] } } as unknown as MantraModules;
    // Ours: weak midfield starters, a strong forward on the bench (three good forwards for two places).
    const mine = squad(6);
    mine.filter((m) => m.role === 'C').forEach((m) => { m.fm = 5; m.pv = 30; });
    const ourA = mine.filter((m) => m.role === 'A');
    ourA.forEach((m, i) => { m.fm = i < 3 ? 7.5 : 3; m.pv = 30; });
    // Theirs: a strong midfielder, weak forwards.
    const theirs = squad(6);
    theirs.filter((m) => m.role === 'A').forEach((m) => { m.fm = 4; m.pv = 30; });
    const star = theirs.find((m) => m.role === 'C')!;
    // Their midfield is deep, so losing the star costs them little; close to what we give, so the gains compare.
    theirs.filter((m) => m.role === 'C').forEach((m) => { m.fm = 6.5; m.pv = 30; });
    star.fm = 7;
    const swaps = simpleSwaps({ mine: { name: 'Noi', men: mine }, rivals: [{ name: 'Loro', men: theirs }], rules: only442, rounds: 38, mantra: true });
    const pick = swaps.find((s) => s.take.id === star.id && s.give.role === 'A');
    expect(pick).toBeDefined();
    expect(pick!.ourOut?.role).toBe('C');
    expect(pick!.theirOut?.role).toBe('A');
    expect(pick!.ours).toBeGreaterThan(0.1);
    expect(pick!.theirs).toBeGreaterThan(0.1);
    // Classic full squads keep their quotas: a forward for a midfielder is not a legal 1x1.
    const classic = simpleSwaps({ mine: { name: 'Noi', men: mine }, rivals: [{ name: 'Loro', men: theirs }], rules: only442, rounds: 38, mantra: false });
    expect(classic.every((s) => s.give.role === s.take.role)).toBe(true);
  });

  it('a 1x1 swap keeps the two gains comparable and a supertop only for a supertop', () => {
    const only442 = { ...RULES, modules: { '4-4-2': (RULES.modules as Record<string, unknown>)['4-4-2'] } } as unknown as MantraModules;
    const mine = squad(6);
    mine.filter((m) => m.role === 'C').forEach((m) => { m.fm = 5; m.pv = 30; });
    mine.filter((m) => m.role === 'A').forEach((m, i) => { m.fm = i < 3 ? 7.5 : 3; m.pv = 30; });
    const theirs = squad(6);
    theirs.filter((m) => m.role === 'A').forEach((m) => { m.fm = 4; m.pv = 30; });
    const star = theirs.find((m) => m.role === 'C')!;
    star.fm = 8;
    const run = () => simpleSwaps({ mine: { name: 'Noi', men: mine }, rivals: [{ name: 'Loro', men: theirs }], rules: only442, rounds: 38, mantra: true });
    for (const s of run()) expect(Math.min(s.ours, s.theirs)).toBeGreaterThanOrEqual(0.5 * Math.max(s.ours, s.theirs) - 1e-9);
    // A supertop target is offered only for a supertop of ours.
    star.category = 'super';
    expect(run().filter((s) => s.take.id === star.id)).toEqual([]);
    mine.filter((m) => m.role === 'A').forEach((m) => { m.category = 'super'; });
    expect(run().filter((s) => s.take.id === star.id).every((s) => s.give.category === 'super')).toBe(true);
  });

  it('paying with one of our starters costs what his reserve makes less (Rice for Stiller)', () => {
    const only442 = { ...RULES, modules: { '4-4-2': (RULES.modules as Record<string, unknown>)['4-4-2'] } } as unknown as MantraModules;
    const mine = squad(6);
    const mids = mine.filter((m) => m.role === 'C');
    // Rice: a starter with a reserve of his role close enough to make him «expendable»; Hojbjerg the weakest starter.
    mids.forEach((m, i) => { m.fm = [7, 6.5, 6.4, 5.5, 5.3, 2, 2, 2][i]; m.pv = 30; });
    const rice = mids[0];
    const theirs = squad(6);
    theirs.filter((m) => m.role === 'C').forEach((m) => { m.fm = 4; m.pv = 30; });
    const stiller = theirs.find((m) => m.role === 'C')!;
    stiller.fm = 6.9; // better than our weakest starter, worse than Rice
    const swaps = simpleSwaps({ mine: { name: 'Noi', men: mine }, rivals: [{ name: 'Loro', men: theirs }], rules: only442, rounds: 38, mantra: true });
    for (const s of swaps) {
      if (s.giveCover) expect(s.ourCost).toBeGreaterThan(0);
      expect(s.ours).toBeGreaterThanOrEqual(0.1);
    }
    expect(swaps.some((s) => s.take.id === stiller.id && s.give.id === rice.id)).toBe(false);
  });

  it('never swaps two men of very different worth, both super in their roles (Olise for Baku)', () => {
    const only442 = { ...RULES, modules: { '4-4-2': (RULES.modules as Record<string, unknown>)['4-4-2'] } } as unknown as MantraModules;
    const mine = squad(6);
    mine.filter((m) => m.role === 'A').forEach((m) => { m.fm = 5; m.pv = 30; });
    const baku = mine.find((m) => m.role === 'D')!;
    baku.fm = 6.5;
    baku.category = 'super';
    const theirs = squad(6);
    const olise = theirs.find((m) => m.role === 'A')!;
    olise.fm = 10;
    olise.category = 'super';
    const swaps = simpleSwaps({ mine: { name: 'Noi', men: mine }, rivals: [{ name: 'Loro', men: theirs }], rules: only442, rounds: 38, mantra: true });
    expect(swaps.some((s) => s.take.id === olise.id && s.give.id === baku.id)).toBe(false);
    for (const s of swaps) {
      const [a, b] = [s.give.fm! * s.give.pv!, s.take.fm! * s.take.pv!];
      expect(Math.min(a, b)).toBeGreaterThanOrEqual(0.8 * Math.max(a, b) - 1e-9);
    }
  });

  it('they never lose on the swap: taking their better starter for a worse man of his role is out (Cunha)', () => {
    const only442 = { ...RULES, modules: { '4-4-2': (RULES.modules as Record<string, unknown>)['4-4-2'] } } as unknown as MantraModules;
    const mine = squad(6);
    const ourA = mine.filter((m) => m.role === 'A');
    ourA.forEach((m, i) => { m.fm = [5.6, 5.0, 5.5, 2, 2, 2][i]; m.pv = 30; });
    const theirs = squad(6);
    const theirA = theirs.filter((m) => m.role === 'A');
    theirA.forEach((m, i) => { m.fm = [6.4, 5.2, 2, 2, 2, 2][i]; m.pv = 30; });
    const cunha = theirA[0];
    const swaps = simpleSwaps({ mine: { name: 'Noi', men: mine }, rivals: [{ name: 'Loro', men: theirs }], rules: only442, rounds: 38, mantra: true });
    // Our bench forward (5.5) beats their weaker starter (5.2), Cunha (6.4) beats our weaker one (5.0): both bare
    // comparisons hold, and they would still lose Cunha for a worse man.
    expect(swaps.some((s) => s.take.id === cunha.id && s.give.role === 'A')).toBe(false);
    for (const s of swaps) expect(s.theirs).toBeGreaterThanOrEqual(0.1);
  });

  it('a great starter is not «expendable» behind a reserve worth half of him (Kane, Romulo)', () => {
    const only442 = { ...RULES, modules: { '4-4-2': (RULES.modules as Record<string, unknown>)['4-4-2'] } } as unknown as MantraModules;
    const men = squad(6);
    const forwards = men.filter((m) => m.role === 'A');
    forwards.forEach((m, i) => { m.fm = [12, 6, 6.5, 2, 2, 2][i]; m.pv = 30; });
    const kane = forwards[0];
    expect(expendableStarters(men, only442, 38).some((one) => one.man.id === kane.id)).toBe(false);
  });

  it('a 2x2: both elevens gain comparably, every man moves an eleven, and it beats the 1x1 inside it', () => {
    const only442 = { ...RULES, modules: { '4-4-2': (RULES.modules as Record<string, unknown>)['4-4-2'] } } as unknown as MantraModules;
    const mine = squad(6);
    mine.filter((m) => m.role === 'C').forEach((m, i) => { m.fm = i < 4 ? 5 : 2; m.pv = 30; });
    mine.filter((m) => m.role === 'A').forEach((m, i) => { m.fm = i < 4 ? 7.2 : 2; m.pv = 30; });
    mine.filter((m) => m.role === 'D').forEach((m, i) => { m.fm = i < 6 ? 6.6 : 2; m.pv = 30; });
    const theirs = squad(6);
    theirs.filter((m) => m.role === 'C').forEach((m, i) => { m.fm = i < 6 ? 7 : 2; m.pv = 30; });
    theirs.filter((m) => m.role === 'A').forEach((m) => { m.fm = 5; m.pv = 30; });
    theirs.filter((m) => m.role === 'D').forEach((m) => { m.fm = 5; m.pv = 30; });
    const it = pairSwaps({ mine: { name: 'Noi', men: mine }, rivals: [{ name: 'Loro', men: theirs }], rules: only442, rounds: 38, mantra: true });
    let step = it.next();
    while (!step.done) step = it.next();
    for (const s of step.value) {
      expect(Math.min(s.ours, s.theirs)).toBeGreaterThanOrEqual(0.1);
      expect(Math.min(s.ours, s.theirs)).toBeGreaterThanOrEqual(0.5 * Math.max(s.ours, s.theirs) - 1e-9);
      const moved = [...s.ourChange.enter, ...s.ourChange.leave, ...s.theirChange.enter, ...s.theirChange.leave].map((m) => m.id);
      for (const m of [...s.give, ...s.take]) expect(moved).toContain(m.id);
    }
  });

  it('the form we offer over the form we ask: a man in better form than what we pay is not proposed', () => {
    const hot = man('A', 7, 30);
    const cold = man('D', 6, 30);
    hot.form = 7.3;
    cold.form = 6.0;
    expect(appealOf([cold], [hot])).toBeCloseTo(-1.3, 6);
    expect(appealOf([hot], [cold])).toBeCloseTo(1.3, 6);
    cold.form = null;
    expect(appealOf([cold], [hot])).toBeNull();
    expect(FORM_TOLERANCE).toBeLessThan(0);
  });

  it('drops a bigger trade that only carries a passenger', () => {
    const a = man('A', 8, 30);
    const b = man('D', 7, 30);
    const c = man('C', 6, 30);
    const d = man('C', 6, 30);
    const small = { rival: 'R', give: [a], take: [b], ours: 1, theirs: 1, fvmGive: null, fvmTake: null, spare: [], legal: true };
    const big = { rival: 'R', give: [a, c], take: [b, d], ours: 1.02, theirs: 1, fvmGive: null, fvmTake: null, spare: [], legal: true };
    expect(withoutPadding([small, big])).toEqual([small]);
  });
});
