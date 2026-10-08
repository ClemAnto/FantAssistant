import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { ManOdds, OddsMan, joinOdds, sameClub } from '../../core/bookmaker-odds';
import { BookmakerOddsStore } from '../../core/bookmaker-odds-store';
import { Bundle } from '../../core/bundle';
import { LEGHE } from '../../core/leghe-api';
import { NextMatchRow } from '../../core/leghe-matchday';
import { moduleLabel, rulesSummary } from '../../core/leghe-rules';
import { LegheSession, keyOf } from '../../core/leghe-session';
import { LineupMan, LineupPlan, adviseLineup, drawSent, rulebookName, voteChance } from '../../core/lineup-advice';
import { bestEleven } from '../../core/mantra-legal';
import { seasonTotals } from '../../core/player-card';
import { TrendCell, trendVoteMean } from '../../core/player-trend';
import { PlayersStore } from '../../core/players-store';
import { ValuationStore } from '../../core/valuation-store';
import { AppHeader } from '../../ui/app-header/app-header';
import { ClubCrest } from '../../ui/club-crest/club-crest';
import { LegheConnect } from '../../ui/leghe-connect/leghe-connect';
import { PlayerFlags } from '../../ui/player-flags/player-flags';
import { RoleBadge } from '../../ui/role-badge/role-badge';
import { RoleSet } from '../../ui/role-set/role-set';
import { VoteTrend } from '../../ui/vote-trend/vote-trend';

/** Role order on screen, the order a lineup is written in. */
const ROLE_ORDER = ['P', 'Por', 'D', 'Dc', 'B', 'Dd', 'Ds', 'E', 'C', 'M', 'T', 'W', 'A', 'Pc'];

const WHEN = new Intl.DateTimeFormat('it-IT', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const OUT_LABEL: Record<NonNullable<NextMatchRow['out']>, string> = {
  unavailable: 'Indisponibile',
  suspended: 'Squalificato',
  'not-called': 'Non convocato',
};

/** One row of the roster table: the man, his price for this matchday, and where each lineup puts him. */
export interface RosterLine extends NextMatchRow {
  /** Where the ADVISED lineup puts him: «Titolare», «Panchina 3», or null. */
  advised: string | null;
  /** Where the lineup already SENT to Leghe puts him. */
  placed: string | null;
  outLabel: string | null;
  /** P(he gets a vote), from the platform's percentage (`lineup-advice.voteChance`). */
  chance: number;
  /** Expected fantavoto from the sheet; Leghe's season fantavote where the sheet has no row. */
  fm: number | null;
  /** True when `fm` is Leghe's season average and not the sheet's forecast. */
  fmFromLeghe: boolean;
  points: number | null;
  /** The bundle's club and its id, for the crest; null when the bundle does not know him. */
  clubName: string | null;
  clubId: number | null;
  /** The bookmakers' price: to score for an outfield man, a clean sheet for a keeper. Null = not found. */
  odds: ManOdds | null;
  /** His club's last five matches from the sheet (`desc_trend_detail`), drawn as `ui-vote-trend`. */
  trend: readonly TrendCell[];
  /** Goals and assists of this season's championship, as the player card counts them (`seasonTotals`). */
  ga: { goals: number; assists: number } | null;
}

/** The roster table's sortable columns. */
export type LineupSort = 'role' | 'name' | 'trend' | 'ga' | 'chance' | 'fm' | 'points' | 'odds' | 'advised';

/** Two drawings of the same pitch: ours, or what Leghe already holds. */
export type PitchSource = 'advised' | 'sent';

/**
 * LINEUP - LA FORMAZIONE DELLA PROSSIMA GIORNATA (the operator, 08/10/2026: «una nuova pagina che ti aiuti ad
 * inserire la formazione per la prossima giornata», then «una tabella con i calciatori della tua rosa (simile a
 * quella nella pagina draft) e un campo che mostra i calciatori schierati e sotto una griglia con quelli in
 * panchina»).
 *
 * The page shows what Leghe says (roster, percentages, rules, competitions, the lineup sent) and next to it the
 * ADVISED lineup of `lineup-advice.ts` - a first cut on expected points, stated as such on screen, which the
 * bench of `formazione-leghe-v1.md` §5 will judge before anything heavier is built on it.
 *
 * Nothing here writes to Leghe: the operator's decision of 08/10/2026 is «per il momento basta il consiglio».
 */
@Component({
  selector: 'app-lineup',
  imports: [
    AppHeader,
    ClubCrest,
    DatePipe,
    DecimalPipe,
    FormsModule,
    LegheConnect,
    NzAlertModule,
    NzButtonModule,
    NzIconModule,
    NzRadioModule,
    NzSelectModule,
    NzTooltipModule,
    PlayerFlags,
    RoleBadge,
    RoleSet,
    VoteTrend,
  ],
  templateUrl: './lineup.html',
  styles: `
    /* ONE track list for the header and every row, so a column never drifts out of line. */
    .lineup-grid {
      display: grid;
      grid-template-columns: 4.5rem minmax(0, 1fr) 6.5rem 2rem 2.5rem 2.5rem 2.75rem 2.25rem 3rem 4.75rem 4.75rem;
      column-gap: 0.5rem;
    }
    .sort { cursor: pointer; user-select: none; }
  `,
})
export class Lineup {
  protected readonly session = inject(LegheSession);
  protected readonly store = inject(ValuationStore);
  private readonly bundle = inject(Bundle);
  protected readonly odds = inject(BookmakerOddsStore);
  private readonly players = inject(PlayersStore);
  protected readonly connecting = signal(false);

  /** The league rules start FOLDED (operator, 08/10/2026: «mettili in un box collassabile»). */
  protected readonly rulesOpen = signal(false);

  /** The matchday box folds too (operator, 09/10/2026: «rendilo collassabile»); the header keeps the
   *  matchday and its deadline, which are the one thing that must stay on screen. */
  protected readonly matchdayOpen = signal(true);

  protected readonly pitchSource = signal<PitchSource>('advised');

  /**
   * The module the ADVISED lineup is drawn in: null = the best of those the league allows; otherwise ANY module
   * of the rulebook (operator, 09/10/2026: «dammi la possibilità di selezionare un qualsiasi modulo mantra»),
   * the league's own list included or not - the options say which ones the league does not allow.
   */
  protected readonly chosenModule = signal<string | null>(null);

  /** The chosen module if this league's rulebook has it (a league of the other game has other modules). */
  protected readonly module = computed(() => {
    const chosen = this.chosenModule();
    return chosen && this.moduleOptions().some((o) => o.name === chosen) ? chosen : null;
  });

  /**
   * The FMA total each module of the rulebook fields with this roster (operator, 09/10/2026: «evidenzia quale
   * modulo risulta il migliore, quello dove i calciatori schierati producono una FMA totale maggiore»): the
   * best legal eleven per module on the expected fantavoto, men Leghe marks unavailable left out.
   */
  private readonly moduleTotals = computed(() => {
    const book = this.rulebook.hasValue() ? this.rulebook.value() : null;
    const scores = bestEleven(this.men(), book, (m) => (m.chance > 0 ? m.fm : null))?.scores ?? [];
    return new Map(scores.map((one) => [one.module, one]));
  });

  /** The module with the highest FMA total, more men placed first: the one the selector highlights. */
  protected readonly bestModule = computed(() => {
    let best: { module: string; total: number; placed: number } | null = null;
    for (const one of this.moduleTotals().values()) {
      if (!best || one.placed > best.placed || (one.placed === best.placed && one.total > best.total)) best = one;
    }
    return best?.module ?? null;
  });

  /** Every module of the rulebook, best FMA total first, marked when the league does not allow it. */
  protected readonly moduleOptions = computed(() => {
    const book = this.rulebook.hasValue() ? this.rulebook.value() : null;
    const allowed = new Set((this.md()?.rules.modules ?? []).map(rulebookName));
    const totals = this.moduleTotals();
    const best = this.bestModule();
    return Object.keys(book?.modules ?? {})
      .map((name) => {
        const score = totals.get(name);
        const total = score ? score.total.toFixed(1) + (score.placed < 11 ? ` (${score.placed}/11)` : '') : '–';
        const tags = [name === best ? '★ migliore' : '', allowed.size && !allowed.has(name) ? 'non ammesso' : '']
          .filter(Boolean)
          .join(' · ');
        return { name, best: name === best, sort: score ? score.placed * 1000 + score.total : -1, label: `${name} · FMA ${total}${tags ? ' · ' + tags : ''}` };
      })
      .sort((x, y) => y.sort - x.sort);
  });
  protected readonly sortKey = signal<LineupSort>('advised');
  protected readonly sortDesc = signal(false);

  constructor() {
    void this.store.load();
    this.odds.load();
    void this.players.load();
  }

  /** The matchday read, or null while there is none (a resource in error throws on `value()`). */
  protected readonly md = computed(() =>
    this.session.matchday.hasValue() ? this.session.matchday.value() : null,
  );

  /** The bundle's listone for this league: Leghe is Serie A (`default`), EuroLeghe is `euro`. */
  private readonly platform = computed(() => (this.session.league()?.platform === 'euro' ? 'euro' : 'default'));

  private readonly game = computed(() => this.md()?.rules.game ?? null);

  /** The sheet of this (listone, game); the same listone's other game where the bundle carries only that. */
  protected readonly sheet = computed(() => {
    const sheets = this.store.sheets().filter((s) => s.platform === this.platform());
    return sheets.find((s) => s.game === this.game()) ?? sheets[0] ?? null;
  });

  private readonly expectations = resource({
    params: () => this.sheet() ?? undefined,
    loader: ({ params }) => this.store.expectationsFor(params),
  });

  /** The rulebook of the league's game: a classic module is not a Mantra one (`classic_modules.json`). */
  private readonly rulebook = resource({
    params: () => this.game() ?? undefined,
    loader: ({ params }) => (params === 'mantra' ? this.bundle.modules() : this.bundle.classicModules()),
  });

  /** The league chosen in the selector, as its key (the select works on strings). */
  protected readonly leagueKey = computed(() => {
    const league = this.session.league();
    return league ? keyOf(league) : null;
  });

  protected readonly leagueOptions = computed(() =>
    this.session.leagues().map((l) => ({ key: keyOf(l), label: `${LEGHE[l.platform].label} · ${l.name}` })),
  );

  protected readonly readTime = computed(() => {
    const at = this.md()?.readAt;
    return at ? at.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
  });

  /** One line per competition, already worded: the template prints and decides nothing. */
  protected readonly competitionLines = computed(() =>
    (this.md()?.competitions ?? []).map((day) => ({
      id: day.competition.id,
      name: day.competition.name,
      type: day.competition.typeLabel,
      active: day.active,
      opponent: day.fixture ? (day.opponent?.name ?? `squadra ${day.fixture.opponentId}`) : null,
      venue: day.fixture ? (day.fixture.home ? 'in casa' : 'in trasferta') : null,
      sent: day.saved?.savedAt ? `${WHEN.format(day.saved.savedAt)} · ${moduleLabel(day.saved.module)}` : null,
    })),
  );

  protected readonly rules = computed(() => {
    const md = this.md();
    return md ? rulesSummary(md.rules) : [];
  });

  /** The first competition with a matchday in play: its lineup is the one the roster marks. */
  private readonly current = computed(() => this.md()?.competitions.find((c) => c.active) ?? null);

  protected readonly closes = computed(() => {
    const at = this.md()?.closesAt;
    if (!at) return null;
    const minutes = Math.round((at.getTime() - this.md()!.readAt.getTime()) / 60_000);
    const left =
      minutes <= 0
        ? 'chiusa'
        : minutes < 60
          ? `fra ${minutes} min`
          : minutes < 48 * 60
            ? `fra ${Math.floor(minutes / 60)} h ${minutes % 60} min`
            : `fra ${Math.round(minutes / 1440)} giorni`;
    return { when: WHEN.format(at), left, past: minutes <= 0 };
  });

  /** The bundle's row of each man, for his club and crest: joined by `fc_id`, never by name. */
  private readonly bundleRows = computed(() => {
    const rows = this.store.allRosters().get(this.platform()) ?? [];
    return new Map(rows.map((r) => [r.fcId, r]));
  });

  /** Every club's squad on this listone, by the bundle's club id: the names a bookmakers' match is checked against. */
  private readonly squads = computed(() => {
    const out = new Map<number, { club: string; names: string[] }>();
    for (const row of this.store.allRosters().get(this.platform()) ?? []) {
      if (row.clubId === null || row.sold) continue;
      const one = out.get(row.clubId) ?? { club: row.club, names: [] };
      one.names.push(row.name);
      out.set(row.clubId, one);
    }
    return out;
  });

  /**
   * The roster as the odds join needs it: each man with HIS club's squad and the OPPONENT's.
   *
   * The opponent's club is found by identity first - a man of the roster whose Leghe club id is that
   * opponent id carries the bundle's club - and only then by Leghe's name for it against the bundle's club
   * names, refused when two bundle clubs fit. Not found = `opponentSquad` null, and the join then says so by
   * leaning on the weaker checks it declares.
   */
  private readonly oddsMen = computed<OddsMan[]>(() => {
    const md = this.md();
    if (!md) return [];
    const rows = this.bundleRows();
    const squads = this.squads();
    const bundleClubOfLeghe = new Map<number, number>();
    for (const r of md.roster) {
      const own = rows.get(r.fcId)?.clubId;
      if (r.clubId !== null && own !== null && own !== undefined) bundleClubOfLeghe.set(r.clubId, own);
    }
    const byName = (name: string): number | null => {
      const fits = [...squads].filter(([, squad]) => sameClub(squad.club, name));
      return fits.length === 1 ? fits[0][0] : null;
    };
    return md.roster.map((r) => {
      const own = rows.get(r.fcId)?.clubId ?? null;
      const oppName = r.opponentId !== null ? (md.realTeams.get(r.opponentId)?.name ?? null) : null;
      const oppClub =
        r.opponentId === null ? null : (bundleClubOfLeghe.get(r.opponentId) ?? (oppName ? byName(oppName) : null));
      return {
        id: r.fcId,
        name: r.name,
        club: r.club,
        match: r.match,
        home: r.home,
        keeper: r.roles.some((c) => c === 'P' || c === 'Por'),
        squad: own !== null ? (squads.get(own)?.names ?? []) : [],
        opponentSquad: oppClub !== null ? (squads.get(oppClub)?.names ?? null) : null,
        opponentName: oppName,
      };
    });
  });

  /**
   * Every man of the roster priced for this matchday: the ONE list the table, the pitch and the bench read, so
   * the number beside a name in the table is the number the pitch was chosen on.
   */
  private readonly men = computed<(LineupMan & { fmFromLeghe: boolean })[]>(() => {
    const md = this.md();
    if (!md) return [];
    const sheet = this.expectations.hasValue() ? this.expectations.value() : null;
    return md.roster.map((r) => {
      const fromSheet = sheet?.get(r.fcId)?.fm ?? null;
      const fm = fromSheet ?? r.fantavote;
      const chance = voteChance(r.percent, r.out);
      return {
        id: r.fcId,
        name: r.name,
        roles: r.roles.map((c) => c.toLowerCase()),
        shown: r.roles,
        chance,
        fm,
        fmFromLeghe: fromSheet === null && fm !== null,
        points: fm === null ? null : chance * fm,
      };
    });
  });

  protected readonly advised = computed<LineupPlan | null>(() => {
    const md = this.md();
    const book = this.rulebook.hasValue() ? this.rulebook.value() : null;
    if (!md || !book) return null;
    const chosen = this.module();
    const modules = chosen ? [chosen] : md.rules.modules;
    return adviseLineup(this.men(), book, modules, md.rules.bench, md.rules.game);
  });

  protected readonly sent = computed<LineupPlan | null>(() => {
    const saved = this.current()?.saved;
    const book = this.rulebook.hasValue() ? this.rulebook.value() : null;
    if (!saved?.savedAt || !book) return null;
    return drawSent(this.men(), book, saved);
  });

  /** The pitch on screen: what was asked for, and nothing in its place when it does not exist. */
  protected readonly pitch = computed(() => (this.pitchSource() === 'sent' ? this.sent() : this.advised()));

  private placeOf(plan: LineupPlan | null, id: number): string | null {
    if (!plan) return null;
    if (plan.rows.some((row) => row.places.some((p) => p.man?.id === id))) return 'Titolare';
    const at = plan.bench.findIndex((m) => m.id === id);
    return at < 0 ? null : `Panchina ${at + 1}`;
  }

  /** «Titolare» first, then the bench in order, then the rest: a lineup read as a ranking. */
  private placeRank(place: string | null): number {
    if (place === 'Titolare') return 0;
    const bench = place?.match(/^Panchina (\d+)$/);
    return bench ? Number(bench[1]) : 999;
  }

  protected readonly roster = computed<RosterLine[]>(() => {
    const md = this.md();
    if (!md) return [];
    const priced = new Map(this.men().map((m) => [m.id, m]));
    const advised = this.advised();
    const sent = this.sent();
    const rows = this.bundleRows();
    const sheet = this.expectations.hasValue() ? this.expectations.value() : null;
    const oddsByMan = joinOdds(this.odds.matches(), this.oddsMen());
    const lines: RosterLine[] = md.roster.map((r) => {
      const man = priced.get(r.fcId)!;
      const own = rows.get(r.fcId);
      return {
        ...r,
        advised: this.placeOf(advised, r.fcId),
        placed: this.placeOf(sent, r.fcId),
        outLabel: r.out ? OUT_LABEL[r.out] : null,
        chance: man.chance,
        fm: man.fm,
        fmFromLeghe: man.fmFromLeghe,
        points: man.points,
        clubName: own?.club ?? null,
        clubId: own?.clubId ?? null,
        odds: oddsByMan.get(r.fcId) ?? null,
        trend: sheet?.get(r.fcId)?.recentVotes ?? [],
        ga: gaOf(seasonTotals(this.players.matchesOf(r.fcId, this.platform(), this.store.targetSeason()))),
      };
    });
    const roleRank = (r: RosterLine) => {
      const i = ROLE_ORDER.indexOf(r.roles[0] ?? '');
      return i < 0 ? ROLE_ORDER.length : i;
    };
    const num = (v: number | null) => v ?? -Infinity;
    const key = this.sortKey();
    const compare = (a: RosterLine, b: RosterLine): number => {
      switch (key) {
        case 'role':
          return roleRank(a) - roleRank(b);
        case 'name':
          return a.name.localeCompare(b.name);
        case 'trend':
          return num(trendVoteMean(b.trend)) - num(trendVoteMean(a.trend));
        case 'ga':
          return num(b.ga?.goals ?? null) - num(a.ga?.goals ?? null) || num(b.ga?.assists ?? null) - num(a.ga?.assists ?? null);
        case 'chance':
          return b.chance - a.chance;
        case 'fm':
          return num(b.fm) - num(a.fm);
        case 'points':
          return num(b.points) - num(a.points);
        case 'odds':
          // Lower price = likelier: ascending is the natural order, unknown last.
          return (a.odds?.price ?? 1e9) - (b.odds?.price ?? 1e9);
        case 'advised':
          return this.placeRank(a.advised) - this.placeRank(b.advised) || roleRank(a) - roleRank(b);
      }
    };
    const sign = this.sortDesc() ? -1 : 1;
    return lines.sort(
      (a, b) => sign * compare(a, b) || roleRank(a) - roleRank(b) || num(b.points) - num(a.points),
    );
  });

  protected sortBy(key: LineupSort): void {
    if (this.sortKey() === key) this.sortDesc.update((d) => !d);
    else {
      this.sortKey.set(key);
      this.sortDesc.set(false);
    }
  }

  protected arrow(key: LineupSort): string {
    return this.sortKey() === key ? (this.sortDesc() ? ' ▲' : ' ▼') : '';
  }

  /** Expected points, one decimal; a dash where nobody can price him. */
  protected pts(value: number | null): string {
    return value === null ? '–' : value.toFixed(1);
  }

  /** How many roster men the prices reached, said beside the column so a blank reads as «not found». */
  protected readonly oddsCover = computed(() => {
    const rows = this.roster();
    return { found: rows.filter((r) => !!r.odds).length, of: rows.length };
  });

  protected oddsHint(odds: ManOdds): string {
    const what = odds.kind === 'goal' ? 'Quota gol' : 'Quota porta inviolata';
    const when = odds.kickoff ? ` ${WHEN.format(new Date(odds.kickoff))}` : '';
    return `${what}: media di ${odds.books} bookmaker (da ${odds.min} a ${odds.max}), ${odds.match}${when}`;
  }

  protected pct(value: number): string {
    return `${Math.round(value * 100)}%`;
  }

  protected chooseLeague(key: string): void {
    const league = this.session.leagues().find((l) => keyOf(l) === key);
    if (league) this.session.choose(league);
  }
}

/** The pair the table prints `3:1`; null when he has no championship match this season. */
function gaOf(totals: { goals: number; assists: number } | null): { goals: number; assists: number } | null {
  return totals ? { goals: totals.goals, assists: totals.assists } : null;
}
