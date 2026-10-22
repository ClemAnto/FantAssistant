import { DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzDrawerModule } from 'ng-zorro-antd/drawer';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { Bundle } from '../../core/bundle';
import { ExpectedPlay } from '../../core/expected-play';
import { LEGHE } from '../../core/leghe-api';
import { CardKey, CardMan, CardStack, clubCard, clubOfCard, playerCard, playerOfCard } from '../../core/player-card';
import { EDGE_BASE, Role } from '../../core/plancia';
import { PlayerRulings } from '../../core/player-rulings';
import { TrendCell, VOTE_TREND_MATCHES, trendVoteMean } from '../../core/player-trend';
import { Platform, PlayersStore } from '../../core/players-store';
import { SeasonLine, seasonLines, seasonLinesFromSheet } from '../../core/season-line';
import { RosterFileStore, leagueOfFile } from '../../core/roster-file';
import { storedFlag, storedJson } from '../../core/view-state';
import {
  RivalNeed,
  RivalReport,
  ScoutMan,
  ScoutRole,
  ScoutSquad,
  ElevenChange,
  PairSwap,
  FORM_TOLERANCE,
  SimpleSwap,
  appealOf,
  contribution,
  elevenWithoutNeedy,
  Extension,
  extendOffer,
  groupTrades,
  needMet,
  pairSwaps,
  expendableStarters,
  rivalReports,
  simpleSwaps,
  strengthOf,
} from '../../core/scout';
import { ValuationStore } from '../../core/valuation-store';
import { AppHeader } from '../../ui/app-header/app-header';
import { ClubCard } from '../../ui/club-card/club-card';
import { PlayerCard } from '../../ui/player-card/player-card';
import { RoleSet } from '../../ui/role-set/role-set';
import { VoteTrend } from '../../ui/vote-trend/vote-trend';
import { RosterUpload } from '../../ui/roster-upload/roster-upload';

/**
 * SCOUT (operator, 22/10/2026): the trades with the other squads of the league that make BOTH squads better, the
 * rivals' men they would let go most easily, and the holes in their elevens worth an offer.
 *
 * The squads come from the league's roster export the Lineup page loads (`core/roster-file.ts`: the file carries
 * EVERY squad of the league, not only his), each man priced as every page prices him - the sheet's fantamedia and
 * the app's expected appearances (`ExpectedPlay`). The arithmetic is `core/scout.ts`; this page only builds its
 * input and draws its answer, in points a matchday.
 */
/** A 2x2 search as it is stored: ids and the numbers found, never the men (they are rebuilt from today's listone). */
interface SavedChange { moduleBefore: string; moduleAfter: string; enter: number[]; leave: number[]; reserves: number[] }
interface SavedPair {
  rival: string; give: number[]; take: number[]; ours: number; theirs: number;
  ourChange: SavedChange; theirChange: SavedChange; spare: number[]; fvmGive: number | null; fvmTake: number | null;
}
interface SavedPairs { roster: string; at: string; swaps: SavedPair[] }

function readSavedPairs(raw: unknown): SavedPairs | null {
  const o = raw as Partial<SavedPairs> | null;
  return o && typeof o.roster === 'string' && typeof o.at === 'string' && Array.isArray(o.swaps) ? (o as SavedPairs) : null;
}

const saveChange = (c: ElevenChange): SavedChange => ({
  moduleBefore: c.moduleBefore, moduleAfter: c.moduleAfter,
  enter: c.enter.map((m) => m.id), leave: c.leave.map((m) => m.id), reserves: c.reserves.map((m) => m.id),
});

function savePair(one: PairSwap): SavedPair {
  return {
    rival: one.rival, give: one.give.map((m) => m.id), take: one.take.map((m) => m.id), ours: one.ours, theirs: one.theirs,
    ourChange: saveChange(one.ourChange), theirChange: saveChange(one.theirChange),
    spare: one.spare, fvmGive: one.fvmGive, fvmTake: one.fvmTake,
  };
}

/** A stored pair back on today's men; null when one of them is no longer on the listone (the line would lie). */
function restorePair(one: SavedPair, men: ReadonlyMap<number, ScoutMan>): PairSwap | null {
  const all = (ids: number[]) => {
    const out = ids.map((id) => men.get(id));
    return out.every((m): m is ScoutMan => !!m) ? out : null;
  };
  const change = (c: SavedChange): ElevenChange | null => {
    const enter = all(c.enter), leave = all(c.leave), reserves = all(c.reserves);
    return enter && leave && reserves ? { moduleBefore: c.moduleBefore, moduleAfter: c.moduleAfter, enter, leave, reserves } : null;
  };
  const give = all(one.give), take = all(one.take), ours = change(one.ourChange), theirs = change(one.theirChange);
  if (!give || !take || !ours || !theirs) return null;
  // The form is TODAY's (it moves every matchday): recomputed on the men as they are, and an offer that has turned
  // impossible since the search drops out.
  const appeal = appealOf(give, take);
  if (appeal != null && appeal < FORM_TOLERANCE) return null;
  return { ...one, give, take, ourChange: ours, theirChange: theirs, appeal };
}

/** His last club matches (up to five that exist) and how many gave him no vote. */
function recentOf(cells: readonly TrendCell[] | null): { matches: number; noVote: number } | null {
  const played = (cells ?? []).slice(0, VOTE_TREND_MATCHES).filter((cell) => cell.state !== null);
  return played.length ? { matches: played.length, noVote: played.filter((cell) => cell.vote === null).length } : null;
}

type Swap = SimpleSwap | PairSwap;

/** One row of the list: an offer's best line, and the other ways of paying for the same target. */
export interface OfferRow {
  key: string;
  swap: Swap;
  alternatives: Swap[];
  /** Lines cut by the 2x2 grouping (`groupTrades`'s `hidden`). */
  hiddenLines: number;
}

/** One man of an offer in its comparison table. */
export interface CompareRow {
  man: ScoutMan;
  last: SeasonLine | null;
  now: SeasonLine | null;
  /** The press survey's word, as it wrote it. */
  press: string | null;
  /** When the press has no word: the sheet's rung, marked as ours. */
  sheetRung: string | null;
  trend: readonly TrendCell[];
}

/** One row of an offer's four-sided table: MY man on the left, THEIRS on the right, and which way it goes. */
export interface MatrixRow {
  left: CompareRow | null;
  right: CompareRow | null;
  /** true = my man replaces theirs (→), false = their man replaces mine (←). */
  toRight: boolean;
  /** Whether the arriving man is really better: «meglio di», else «al posto di». */
  better: boolean;
  /** The arriving man replaces nobody because he does not make that eleven: he stays on the bench. */
  bench: boolean;
}

/** Targets shown per rival when every rival is listed: the rest open by choosing that rival. */
const TARGETS_PER_RIVAL = 5;

@Component({
  selector: 'app-scout',
  imports: [
    AppHeader,
    ClubCard,
    DatePipe,
    DecimalPipe,
    NgTemplateOutlet,
    FormsModule,
    NzButtonModule,
    NzCheckboxModule,
    NzDrawerModule,
    NzIconModule,
    NzRadioModule,
    NzSelectModule,
    NzTooltipModule,
    PlayerCard,
    RoleSet,
    RosterUpload,
    VoteTrend,
  ],
  templateUrl: './scout.html',
})
export class Scout {
  protected readonly store = inject(ValuationStore);
  private readonly bundle = inject(Bundle);
  private readonly players = inject(PlayersStore);
  private readonly play = inject(ExpectedPlay);
  protected readonly rosterFile = inject(RosterFileStore);
  private readonly rulings = inject(PlayerRulings);
  protected readonly connecting = signal(false);

  /** Rival filter of the trade list; null = all. */
  protected readonly rivalFilter = signal<string | null>(null);
  /**
   * THE ORDER: «fattibili» first by default - the form we offer over the form we ask, the operator's «focalizzarci
   * sugli scambi utili e possibili» (the useful part is already the filter) - or by the gain, the smaller of the two.
   */
  protected readonly order = storedJson<'feasible' | 'gain' | 'need'>('scout.order', (raw) =>
    raw === 'gain' || raw === 'need' ? raw : 'feasible',
  );

  /**
   * The key every list sorts on, highest first. «Bisogno» (`roadmap-scambi-v1.md` step 4) puts first the offers that
   * solve a problem the rival already feels, and orders the rest as «Fattibili».
   */
  protected rank(one: SimpleSwap | PairSwap): number {
    const gain = Math.min(one.ours, one.theirs);
    if (this.order() === 'gain') return gain;
    const feasible = (one.appeal ?? -9) + gain / 100;
    return this.order() === 'need' && this.needOf(one) ? 100 + feasible : feasible;
  }

  /**
   * ONLY OFFERS WHERE THE FVM FAVOURS HIM (`roadmap-scambi-v1.md` step 2): what we give is worth, on his own price
   * list, at least what we ask. A line with no FVM on one side is left OUT when the filter is on - an unknown is not a
   * favour - and the count of what survives is on screen, because few survivors is itself the information.
   */
  protected readonly fvmFair = storedFlag('scout.fvmFair', false);
  private fairToHim(one: { fvmGive: number | null; fvmTake: number | null }): boolean {
    const balance = this.fvmBalance(one);
    return !this.fvmFair() || (balance !== null && balance >= 0);
  }
  /** 1x1 (immediate, computed at once) or 2x2 (a search, launched by hand). */
  protected readonly mode = storedJson<'1x1' | '2x2'>('scout.mode', (raw) => (raw === '2x2' ? '2x2' : '1x1'));
  /**
   * THE LAST 2x2 SEARCH, kept across a refresh (operator, 22/10/2026: «salva l'ultima ricerca e mostrala al refresh»).
   * Stored by IDS with the numbers it found, per fantasquadra, and rebuilt on the men of today's listone; the page
   * says when it was run, because the sheet may have moved since and a search is a reading that ages.
   */
  private readonly savedPairs = storedJson<SavedPairs | null>('scout.pairs', readSavedPairs);
  protected readonly pairState = signal<
    { kind: 'idle' } | { kind: 'running'; done: number; total: number } | { kind: 'done'; swaps: PairSwap[]; ms: number }
  >({ kind: 'idle' });
  /** The 2x2 search in flight: another one (or another roster) stops it. */
  private pairRun = 0;

  constructor() {
    void this.store.load();
    void this.players.load();
  }

  private readonly platform = computed(() => (this.rosterFile.file()?.platform === 'euro' ? 'euro' : 'default'));
  protected readonly mantra = computed(() => this.rosterFile.file()?.game === 'mantra');

  protected readonly leagueKey = computed(() => this.rosterFile.file()?.key ?? null);
  protected readonly leagueOptions = computed(() =>
    this.rosterFile.rosters().map((one) => ({
      key: one.key,
      label: `${LEGHE[one.platform].label} · ${leagueOfFile(one.fileName)} · ${one.team}`,
    })),
  );

  protected chooseRoster(key: string): void {
    this.rivalFilter.set(null);
    this.pick(null);
    this.pairRun += 1;
    this.pairState.set({ kind: 'idle' });
    this.rosterFile.choose(key);
  }

  private readonly sheet = computed(() => {
    const sheets = this.store.sheets().filter((s) => s.platform === this.platform());
    const game = this.mantra() ? 'mantra' : 'classic';
    return sheets.find((s) => s.game === game) ?? sheets[0] ?? null;
  });

  private readonly expectations = resource({
    params: () => this.sheet() ?? undefined,
    loader: ({ params }) => this.store.expectationsFor(params),
  });

  private readonly rulebook = resource({
    params: () => (this.rosterFile.file() ? (this.mantra() ? 'mantra' : 'classic') : undefined),
    loader: ({ params }) => (params === 'mantra' ? this.bundle.modules() : this.bundle.classicModules()),
  });

  protected readonly rounds = computed(() => this.store.seasonRoundsFor(this.sheet()));

  private readonly bundleRows = computed(() => {
    const rows = this.store.allRosters().get(this.platform()) ?? [];
    return new Map(rows.map((r) => [r.fcId, r]));
  });

  /**
   * Every squad of the file, each man priced: the fantamedia of the sheet, the appearances of `ExpectedPlay` (the
   * one formula of the app, declarations included). A man the listone does not know is left out and counted.
   */
  protected readonly squads = computed<{ mine: ScoutSquad; rivals: ScoutSquad[]; unknown: number } | null>(() => {
    const file = this.rosterFile.file();
    const sheet = this.expectations.hasValue() ? this.expectations.value() : null;
    const rounds = this.rounds();
    if (!file || !sheet || !rounds) return null;
    const rows = this.bundleRows();
    const platform = this.platform();
    const game = this.mantra() ? 'mantra' : 'classic';
    let unknown = 0;
    const squadOf = (name: string, ids: number[]): ScoutSquad => {
      const men: ScoutMan[] = [];
      for (const id of ids) {
        const row = rows.get(id);
        if (!row) {
          unknown += 1;
          continue;
        }
        const numbers = sheet.get(id) ?? null;
        const outlook = this.play.outlook(
          { id, club: row.club, platform },
          {
            pv: numbers?.pv ?? null,
            pvIsEstimate: numbers?.pvIsEstimate ?? false,
            playShare: numbers?.titolaritaPlay ?? null,
            titolarita: numbers?.titolarita ?? null,
          },
          rounds,
        );
        const shown = game === 'mantra' && row.mantraCodes.length ? row.mantraCodes : [row.role];
        men.push({
          id,
          name: row.name,
          club: row.club,
          role: row.role as ScoutRole,
          roles: shown.map((r) => r.toLowerCase()),
          shown,
          fm: numbers?.fm ?? null,
          pv: outlook.expected,
          fvm: this.store.fvmOf(platform, id, game),
          category: numbers?.category ?? null,
          form: trendVoteMean((numbers?.recentVotes ?? []).slice(0, VOTE_TREND_MATCHES)),
          outFor: outlook.window ? (outlook.window.seasonOver ? rounds : outlook.window.lost) : null,
          recent: recentOf(numbers?.recentVotes ?? null),
        });
      }
      return { name, men };
    };
    const mineTeam = file.teams.find((t) => t.name === file.team);
    if (!mineTeam) return null;
    return {
      mine: squadOf(mineTeam.name, mineTeam.ids),
      rivals: file.teams.filter((t) => t !== mineTeam).map((t) => squadOf(t.name, t.ids)),
      unknown,
    };
  });

  private readonly rules = computed(() => (this.rulebook.hasValue() ? this.rulebook.value() : null));

  /** His squad on the rulebook: the eleven, and the strong men who are not in it (the operator's starting point). */
  protected readonly ours = computed(() => {
    const squads = this.squads();
    const rounds = this.rounds();
    const rules = this.rules();
    if (!squads || !rounds || !rules) return null;
    const strength = strengthOf(squads.mine.men, rules, rounds);
    const bench = squads.mine.men
      .filter((man) => !strength.eleven.has(man.id) && (this.perRound(man) ?? 0) > 0)
      .sort((a, b) => this.perRound(b)! - this.perRound(a)!)
      .slice(0, 10)
      // What each is worth TO THE SQUAD: the cover he gives when a starter misses (`scout.contribution`).
      .map((man) => ({ man, worth: contribution(squads.mine.men, man, rules, rounds) }));
    return { strength, bench, expendable: expendableStarters(squads.mine.men, rules, rounds) };
  });

  /** The rivals: what each can spare and where each eleven is short. */
  protected readonly reports = computed<RivalReport[]>(() => {
    const squads = this.squads();
    const rounds = this.rounds();
    const rules = this.rules();
    if (!squads || !rounds || !rules) return [];
    return rivalReports(squads.mine, squads.rivals, rules, rounds);
  });

  /** Each rival's needs, by name (`scout.rivalReports`). */
  private readonly needs = computed(() => new Map(this.reports().map((report) => [report.name, report.needs])));

  /**
   * The need of the rival each offer meets (`scout.needMet`), computed ONCE per list - it rebuilds an eleven per offer,
   * which a template must not do at every change detection.
   */
  private readonly needByOffer = computed(() => {
    const out = new Map<SimpleSwap | PairSwap, RivalNeed | null>();
    const squads = this.squads();
    const rules = this.rules();
    const rounds = this.rounds();
    if (!squads || !rules || !rounds) return out;
    const menOf = new Map(squads.rivals.map((squad) => [squad.name, squad.men]));
    const offers: (SimpleSwap | PairSwap)[] = [
      ...this.allSwaps(),
      ...(this.pairResult()?.swaps ?? []),
      ...this.trail(),
      ...(this.extended() ?? []),
    ];
    for (const one of offers) {
      const needs = this.needs().get(one.rival) ?? [];
      if (!needs.length) {
        out.set(one, null);
        continue;
      }
      const give = [one.give].flat();
      const take = [one.take].flat();
      const gone = new Set(take.map((m) => m.id));
      const after = [...(menOf.get(one.rival) ?? []).filter((m) => !gone.has(m.id)), ...give];
      const replaced = 'theirChange' in one ? this.pushed(one.theirChange, one.take) : [one.theirOut];
      out.set(one, needMet(needs, give, take, replaced, elevenWithoutNeedy(after, needs, rules, rounds)));
    }
    return out;
  });

  protected needOf(one: SimpleSwap | PairSwap): RivalNeed | null {
    return this.needByOffer().get(one) ?? null;
  }

  protected needText(need: RivalNeed): string {
    const who = need.holder?.name ?? 'nessuno';
    if (need.kind === 'out') return `${need.slot}: ${who} fuori ${need.holder?.outFor ?? 0} g`;
    if (need.kind === 'novote') {
      return `${need.slot}: ${who} senza voto in ${need.holder?.recent?.noVote} delle ultime ${need.holder?.recent?.matches}`;
    }
    return `${need.slot} sotto la media della lega`;
  }

  /** Points a matchday a man makes when fielded every round he plays: fm x pv / rounds. */
  protected perRound(man: ScoutMan): number | null {
    const rounds = this.rounds();
    return man.fm == null || man.pv == null || !rounds ? null : (man.fm * man.pv) / rounds;
  }

  protected readonly rivalNames = computed(() => this.squads()?.rivals.map((r) => r.name) ?? []);

  /**
   * THE 1x1 SWAPS (`scout.simpleSwaps`), as they are proposed: per rival, per man we go for, the men we can pay with.
   * Computed at once - a few hundred comparisons - so there is no search to launch.
   */
  private readonly allSwaps = computed<SimpleSwap[]>(() => {
    const squads = this.squads();
    const rounds = this.rounds();
    const rules = this.rules();
    if (!squads || !rounds || !rules) return [];
    return simpleSwaps({ mine: squads.mine, rivals: squads.rivals, rules, rounds, mantra: this.mantra() });
  });

  /** The 1x1 on screen: the rival filter and the order only regroup, they never rerun the comparisons. */
  protected readonly swaps = computed(() => {
    const rival = this.rivalFilter();
    const all = this.allSwaps().filter((one) => (!rival || one.rival === rival) && this.fairToHim(one));
    // One offer per (target, starter of ours he beats): the head line names that starter, so lines paying with a
    // man who IS that starter (and therefore compare the target with somebody else) are a different offer.
    const byRival = new Map<string, Map<string, SimpleSwap[]>>();
    for (const one of all) {
      const offers = byRival.get(one.rival) ?? new Map<string, SimpleSwap[]>();
      const key = `${one.take.id}|${one.ourOut?.id ?? 'empty'}`;
      byRival.set(one.rival, offers);
      offers.set(key, [...(offers.get(key) ?? []), one]);
    }
    // Our gain decides the order of the targets; for one target, the payment they gain most from comes first
    // (the easiest to accept).
    return [...byRival]
      .map(([name, offers]) => ({
        rival: name,
        offers: [...offers.values()]
          .map((lines) => ({
            first: lines[0],
            best: Math.max(...lines.map((one) => this.rank(one))),
            lines: [...lines].sort((a, b) => this.rank(b) - this.rank(a)),
          }))
          .sort((a, b) => b.best - a.best),
      }))
      // Over every rival the best `TARGETS_PER_RIVAL` targets each; with one rival chosen, all of them.
      .map((group) => ({
        ...group,
        hidden: rival ? 0 : Math.max(0, group.offers.length - TARGETS_PER_RIVAL),
        offers: rival ? group.offers : group.offers.slice(0, TARGETS_PER_RIVAL),
      }))
      .sort((a, b) => b.offers[0].best - a.offers[0].best);
  });

  /** The 2x2 search, in slices so the page stays alive and draws its bar (`scout.pairSwaps`). */
  protected async searchPairs(): Promise<void> {
    const squads = this.squads();
    const rounds = this.rounds();
    const rules = this.rules();
    if (!squads || !rounds || !rules) return;
    const run = ++this.pairRun;
    const started = performance.now();
    const it = pairSwaps({ mine: squads.mine, rivals: squads.rivals, rules, rounds, mantra: this.mantra() });
    let slice = performance.now();
    for (;;) {
      const step = it.next();
      if (run !== this.pairRun) return;
      if (step.done) {
        this.pairState.set({ kind: 'done', swaps: step.value, ms: performance.now() - started });
        const key = this.leagueKey();
        if (key) this.savedPairs.set({ roster: key, at: new Date().toISOString(), swaps: step.value.map(savePair) });
        return;
      }
      if (performance.now() - slice > 40) {
        this.pairState.set({ kind: 'running', done: step.value.done, total: step.value.total });
        await new Promise((go) => setTimeout(go));
        slice = performance.now();
      }
    }
  }

  /** What the FVM filter leaves, of the lines it looks at (the rival filter applied first). */
  protected readonly fvmCount = computed(() => {
    const rival = this.rivalFilter();
    const pool: { rival: string; fvmGive: number | null; fvmTake: number | null }[] =
      this.mode() === '1x1' ? this.allSwaps() : (this.pairResult()?.swaps ?? []);
    const seen = pool.filter((one) => !rival || one.rival === rival);
    return { kept: seen.filter((one) => this.fairToHim(one)).length, total: seen.length };
  });

  // ---------------------------------------------------------------- the list and the offer open beside it

  /**
   * THE LIST (operator, 22/10/2026: «cerchiamo di fare rientrare tutto in una schermata, manteniamo il focus sulle cose
   * principali, dettagli ed alternative solo a richiesta»): per rival, one row per offer - its best line, named and
   * nothing else. The other ways of paying for the same target are its ALTERNATIVES, shown only in the panel.
   */
  protected readonly rows = computed<{ rival: string; hidden: number; offers: OfferRow[] }[]>(() => {
    if (this.mode() === '1x1') {
      return this.swaps().map((group) => ({
        rival: group.rival,
        hidden: group.hidden,
        offers: group.offers.map((offer) => this.rowOf(offer.lines)),
      }));
    }
    return this.pairGroups().map((group) => ({
      rival: group.rival,
      hidden: group.hidden,
      offers: group.offers.map((offer) => this.rowOf(offer.lines, offer.hidden)),
    }));
  });

  private rowOf(lines: readonly Swap[], hiddenLines = 0): OfferRow {
    const [swap, ...alternatives] = lines;
    return { key: this.keyOf(swap), swap, alternatives, hiddenLines };
  }

  protected keyOf(one: Swap): string {
    return this.offerKey(one.rival, [one.give].flat(), [one.take].flat());
  }

  /** The row picked, by its key; none picked (or no longer in the list) = the first row. */
  private readonly pickedKey = signal<string | null>(null);
  /** The line shown of that row: its own, or one of its alternatives. */
  private readonly pickedLine = signal<Swap | null>(null);
  /** Extensions walked from that line, one man more each (`scout.extendOffer`): the last is what the panel shows. */
  protected readonly trail = signal<Extension[]>([]);
  /** The extensions offered for what the panel shows, once asked for; null = not asked. */
  protected readonly extended = signal<Extension[] | null>(null);

  protected readonly openRow = computed<OfferRow | null>(() => {
    const all = this.rows().flatMap((group) => group.offers);
    return all.find((row) => row.key === this.pickedKey()) ?? all[0] ?? null;
  });

  /** What the panel shows: the end of the trail, else the picked line of the open row. */
  protected readonly current = computed<Swap | null>(() => {
    const row = this.openRow();
    if (!row) return null;
    const trail = this.trail();
    if (trail.length) return trail[trail.length - 1];
    const line = this.pickedLine();
    return line && (line === row.swap || row.alternatives.includes(line)) ? line : row.swap;
  });

  protected pick(row: OfferRow | null, line: Swap | null = null): void {
    this.pickedKey.set(row?.key ?? null);
    this.pickedLine.set(line);
    this.trail.set([]);
    this.extended.set(null);
  }

  /** ONE MAN MORE (`roadmap-scambi-v1.md` step 3): computed when asked, on the offer the panel shows. */
  protected extend(): void {
    const one = this.current();
    const squads = this.squads();
    const rules = this.rules();
    const rounds = this.rounds();
    if (!one || !squads || !rules || !rounds) return;
    const base = { rival: one.rival, give: [one.give].flat(), take: [one.take].flat() };
    this.extended.set(extendOffer(base, { mine: squads.mine, rivals: squads.rivals, rules, rounds, mantra: this.mantra() }));
  }

  protected walk(ext: Extension): void {
    this.trail.set([...this.trail(), ext]);
    this.extended.set(null);
  }

  protected back(): void {
    this.trail.set(this.trail().slice(0, -1));
    this.extended.set(null);
  }

  protected isExtension(one: Swap): one is Extension {
    return 'added' in one;
  }

  /** The four-sided table of whatever the panel shows: a 1x1, a 2x2 or an extension. */
  protected matrixOf(one: Swap): MatrixRow[] {
    return 'theirChange' in one
      ? this.matrix(one.give, one.take, this.pushed(one.theirChange, one.take), this.pushed(one.ourChange, one.give), {
          mine: one.ourChange.enter,
          theirs: one.theirChange.enter,
        })
      : this.matrix([one.give], [one.take], one.theirOut ? [one.theirOut] : [], one.ourOut ? [one.ourOut] : []);
  }

  protected spareOf(one: Swap): number[] {
    return 'theirChange' in one ? one.spare : one.spare ? [one.take.id] : [];
  }

  /** The drawers: his squad, and the rivals' cards. */
  protected readonly drawer = signal<'mine' | 'rivals' | null>(null);

  /** What an extension made better for the rival, in words. */
  protected betterText(ext: Extension): string {
    const parts: string[] = [];
    if (ext.better.theirs != null) parts.push(`per loro +${ext.better.theirs.toFixed(2)}`);
    if (ext.better.fvm != null) parts.push(`FVM +${Math.round(ext.better.fvm)} a suo favore`);
    if (ext.better.form != null) parts.push(`forma +${ext.better.form.toFixed(2)}`);
    return parts.join(' · ');
  }

  protected pairPercent(): number {
    const state = this.pairState();
    return state.kind === 'running' && state.total ? Math.round((100 * state.done) / state.total) : 0;
  }

  /** The 2x2 on screen: the search just run, or the last one saved for this fantasquadra. */
  protected readonly pairResult = computed<{ swaps: PairSwap[]; ms: number | null; at: string | null } | null>(() => {
    const state = this.pairState();
    if (state.kind === 'done') return { swaps: state.swaps, ms: state.ms, at: null };
    if (state.kind === 'running') return null;
    const saved = this.savedPairs();
    const squads = this.squads();
    if (!saved || !squads || saved.roster !== this.leagueKey()) return null;
    const men = new Map([squads.mine, ...squads.rivals].flatMap((squad) => squad.men.map((m) => [m.id, m] as const)));
    const swaps = saved.swaps.map((one) => restorePair(one, men)).filter((one): one is PairSwap => !!one);
    return { swaps, ms: null, at: saved.at };
  });

  /**
   * The 2x2 as they are read: per rival, one offer per TARGET (the most valuable man we take), its lines the ways of
   * paying for him, no man twice in an offer (`scout.groupTrades`).
   */
  protected readonly pairGroups = computed(() => {
    const state = this.pairResult();
    if (!state) return [];
    const rival = this.rivalFilter();
    const swaps = state.swaps.filter((one) => (!rival || one.rival === rival) && this.fairToHim(one));
    return groupTrades(swaps, (one) => this.rank(one), rival ? Infinity : 3).map((group) => ({
      rival: group.rival,
      hidden: rival ? 0 : Math.max(0, group.offers.length - TARGETS_PER_RIVAL),
      offers: rival ? group.offers : group.offers.slice(0, TARGETS_PER_RIVAL),
    }));
  });

  // ---------------------------------------------------------------- the comparison table of an offer

  /**
   * THE FACTS BEHIND AN OFFER (operator, 22/10/2026: «per valutare uno scambio ho bisogno di vedere una tabella con i
   * calciatori che chiedo e per ogni calciatore devo vedere la fantamedia, media voto e presenze della scorsa stagione
   * e di quella attuale e poi il gradino della stampa e il trend ... nella tabella ci devono essere anche i calciatori
   * che offro»). Facts and not our numbers: the seasons are what the game SCORED (`season-line.seasonLines`, the
   * reader the Draft Assistant already uses - a rebuilt line in italic where the platform did not score his club),
   * the word is the press survey's, the strip is the sheet's last five (`ui-vote-trend`, as on the Lineup page).
   */
  private readonly readings = resource({
    params: () => {
      const sheet = this.sheet();
      return sheet ? { path: sheet.path, platform: this.platform() as Platform } : undefined;
    },
    loader: async ({ params }) => {
      const [stats, manifest, sheet] = await Promise.all([
        this.bundle.table('season_stats'),
        this.bundle.manifest(),
        this.bundle.table(params.path.replace(/\.json(\.gz)?$/, '')),
      ]);
      const now = manifest.target_season ?? null;
      const last = manifest.input_season ?? null;
      const wanted = [now, last].filter((one): one is string => !!one);
      return {
        now,
        last,
        lines: seasonLines({ seasonStats: stats, platform: params.platform, seasons: wanted }),
        rebuilt: last ? seasonLinesFromSheet(sheet, last) : new Map<number, SeasonLine>(),
      };
    },
  });

  protected readonly seasonsShown = computed(() => {
    const r = this.readings.hasValue() ? this.readings.value() : null;
    return { now: r?.now ?? null, last: r?.last ?? null };
  });

  protected offerKey(rival: string, give: readonly ScoutMan[], take: readonly ScoutMan[]): string {
    return `${rival}|${give.map((m) => m.id).join(',')}|${take.map((m) => m.id).join(',')}`;
  }

  protected namesOf(men: readonly ScoutMan[]): string {
    return men.map((m) => m.name).join(' + ');
  }

  /** One row per man of the offer: last season, this season, the press word, the strip. */
  private compare(men: readonly ScoutMan[]): CompareRow[] {
    const r = this.readings.hasValue() ? this.readings.value() : null;
    const sheet = this.expectations.hasValue() ? this.expectations.value() : null;
    const press = this.rulings.press();
    return men.map((man): CompareRow => {
      const mine = r?.lines.get(man.id);
      const last = (r?.last ? mine?.get(r.last) : undefined) ?? (r?.last ? r?.rebuilt.get(man.id) : undefined) ?? null;
      const now = (r?.now ? mine?.get(r.now) : undefined) ?? null;
      const word = press.get(man.id);
      const numbers = sheet?.get(man.id) ?? null;
      return {
        man,
        last,
        now,
        press: word ? (word.pressTier ?? word.rung) : null,
        // Without a press word, the sheet's own rung - said as ours, not as the press's.
        sheetRung: word ? null : (numbers?.titolarita ?? null),
        trend: numbers?.recentVotes ?? [],
      };
    });
  }

  /**
   * THE OFFER AS FOUR SIDES (operator, 22/10/2026: «per i richiesti e per gli offerti mostra i calciatori che andrebbero
   * a sostituire»): MY men on the left, THEIRS on the right, one row per replacement -
   *   my man I give  --- meglio di --->  their starter he replaces;
   *   my starter he replaces  <--- meglio di ---  their man I take.
   * The replaced are what each eleven pushes OUT (`ElevenChange.leave`, the men traded away excluded); on a 1x1 they are
   * the starters the two comparisons named. A pair is matched by base role first; an arrow says «meglio di» only when
   * it is true, «al posto di» otherwise (a change of shape can replace a man with a weaker one on another line), and a
   * side with nobody reads «posto vuoto».
   */
  protected matrix(
    give: readonly ScoutMan[],
    take: readonly ScoutMan[],
    theirOut: readonly ScoutMan[],
    ourOut: readonly ScoutMan[],
    /** On a 2x2, who enters each eleven: a man with no partner who does NOT enter it stays on the bench. */
    enters?: { mine: readonly ScoutMan[]; theirs: readonly ScoutMan[] },
  ): MatrixRow[] {
    const r = this.compare([...take, ...ourOut, ...give, ...theirOut]);
    const of = (man: ScoutMan) => r.find((one) => one.man.id === man.id) ?? null;
    const pair = (from: readonly ScoutMan[], to: readonly ScoutMan[]): [ScoutMan | null, ScoutMan | null][] => {
      const left = [...to];
      const out: [ScoutMan | null, ScoutMan | null][] = [];
      for (const man of from) {
        const same = left.findIndex((o) => o.roles[0] === man.roles[0]);
        const fits = left.findIndex((o) => o.roles.some((x) => man.roles.includes(x)));
        const pick = same >= 0 ? same : fits >= 0 ? fits : left.length ? 0 : -1;
        out.push([man, pick >= 0 ? left.splice(pick, 1)[0] : null]);
      }
      for (const rest of left) out.push([null, rest]);
      return out;
    };
    const better = (a: ScoutMan | null, b: ScoutMan | null) => !!a && (!b || (this.perRound(a) ?? 0) > (this.perRound(b) ?? 0));
    const benched = (man: ScoutMan | null, eleven: readonly ScoutMan[] | undefined) =>
      !!man && !!eleven && !eleven.some((m) => m.id === man.id);
    return [
      ...pair(give, theirOut).map(([mine, theirs]) => ({
        left: mine && of(mine), right: theirs && of(theirs), toRight: true, better: better(mine, theirs),
        bench: !theirs && benched(mine, enters?.theirs),
      })),
      ...pair(take, ourOut).map(([theirs, mine]) => ({
        left: mine && of(mine), right: theirs && of(theirs), toRight: false, better: better(theirs, mine),
        bench: !mine && benched(theirs, enters?.mine),
      })),
    ];
  }

  /** The men each eleven pushes out on a 2x2: who leaves it, except the men traded away. */
  protected pushed(change: ElevenChange, traded: readonly ScoutMan[]): ScoutMan[] {
    return change.leave.filter((m) => !traded.some((t) => t.id === m.id));
  }

  protected fvmBalance(one: { fvmGive: number | null; fvmTake: number | null }): number | null {
    return one.fvmGive == null || one.fvmTake == null ? null : one.fvmGive - one.fvmTake;
  }

  // ---------------------------------------------------------------- the player card (click on a name, every page)

  private readonly cards = new CardStack();

  protected readonly openCards = computed(() => {
    const rows = this.bundleRows();
    const sheet = this.expectations.hasValue() ? this.expectations.value() : null;
    const rounds = this.rounds();
    const platform = this.platform();
    const game = this.mantra() ? 'mantra' : 'classic';
    return this.cards.place((key) => {
      const id = playerOfCard(key);
      const row = id === null ? undefined : rows.get(id);
      if (!row) return undefined;
      const numbers = sheet?.get(row.fcId) ?? null;
      const outlook = this.play.outlook(
        { id: row.fcId, club: row.club, platform },
        {
          pv: numbers?.pv ?? null,
          pvIsEstimate: numbers?.pvIsEstimate ?? false,
          playShare: numbers?.titolaritaPlay ?? null,
          titolarita: numbers?.titolarita ?? null,
        },
        rounds,
      );
      const man: CardMan = {
        id: row.fcId,
        name: row.name,
        club: row.club,
        clubId: row.clubId,
        where: game === 'mantra' && row.mantraCodes.length ? row.mantraCodes.join('/') : row.role,
        role: row.role as Role,
        platform,
        edge: numbers?.fm == null ? null : numbers.fm - EDGE_BASE,
        pv: outlook.expected,
        rounds,
        swing: null,
        fm: numbers?.fm ?? null,
        estimated: numbers?.fmIsEstimate ?? false,
        estNote: numbers?.note ?? null,
        titolarita: numbers?.titolarita ?? null,
        titolaritaPlay: numbers?.titolaritaPlay ?? null,
        minutesNext: numbers?.minutesNext ?? null,
        seasonMatches: numbers?.seasonMatches ?? null,
        minutesFullSeason: numbers?.minutesFullSeason ?? null,
        category: numbers?.category ?? null,
        categoryLevel: numbers?.categoryLevel ?? null,
        categoryBars: numbers?.categoryBars ?? null,
        unpricedReason: null,
        fvm: this.store.fvmOf(platform, row.fcId, game),
        out: outlook.window,
        market: null,
      };
      return man;
    });
  });

  protected readonly clubCards = computed(() => this.cards.place((key) => clubOfCard(key) ?? undefined));
  protected readonly cardCount = computed(() => this.openCards().length + this.clubCards().length);
  protected readonly frontCard = computed(() => this.cards.front());

  protected openPlayer(id: number): void {
    this.cards.openCard(playerCard(id));
  }

  protected openClubCard(platform: 'default' | 'euro', club: string): void {
    this.cards.openCard(clubCard(platform, club));
  }

  protected closeCard(key: CardKey): void {
    this.cards.closeCard(key);
  }

  protected raiseCard(key: CardKey): void {
    this.cards.raiseCard(key);
  }

  protected closeAllCards(): void {
    this.cards.openCard(null);
  }
}
