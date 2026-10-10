import { CdkDrag, CdkDragDrop, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { ManOdds, OddsMan, joinOdds, oddsSortValue, sameClub } from '../../core/bookmaker-odds';
import { BookmakerOddsStore } from '../../core/bookmaker-odds-store';
import { Bundle } from '../../core/bundle';
import { LEGHE } from '../../core/leghe-api';
import { LegheLineupBody, SaveMan, legheModuleCode, saveBody, saveRefusal, switchModules } from '../../core/leghe-lineup';
import { NextMatchRow, fcTeamNames } from '../../core/leghe-matchday';
import { moduleLabel, rulesSummary } from '../../core/leghe-rules';
import { DropTarget, LineupDraft, NO_SWITCH, draftOf, drawDraft, move, relayout } from '../../core/lineup-edit';
import { LegheSession, keyOf } from '../../core/leghe-session';
import { FvaInput, fvaOf, fvaWords, oddsScale, restPerMatch } from '../../core/fva';
import { calendarBookFrom } from '../../core/keeper-pairs';
import { TimeTravel } from '../../core/time-travel';
import {
  LineupMan,
  LineupPlan,
  adviseLineup,
  bestOnModules,
  drawSent,
  readByDefence,
  rulebookName,
  voteChance,
  withLeagueModules,
} from '../../core/lineup-advice';
import { placesIn } from '../../core/mantra-legal';
import { PlayerRatingsStore } from '../../core/player-ratings-store';
import { ROLE_STEADY, steadyShareFor } from '../../core/swing';
import { ExpectedPlay } from '../../core/expected-play';
import {
  CardKey,
  CardMan,
  CardStack,
  clubCard,
  clubOfCard,
  playerCard,
  playerOfCard,
  seasonTotals,
} from '../../core/player-card';
import { EDGE_BASE, Role } from '../../core/plancia';
import { TrendCell, trendVoteMean } from '../../core/player-trend';
import { Standings, placeOf, standingsOf } from '../../core/standings';
import { PlayersStore, isChampionship } from '../../core/players-store';
import { ValuationStore } from '../../core/valuation-store';
import { WidgetFeed, widgetMen } from '../../core/widget-feed';
import { AppHeader } from '../../ui/app-header/app-header';
import { ClubCard } from '../../ui/club-card/club-card';
import { ClubCrest } from '../../ui/club-crest/club-crest';
import { LegheConnect } from '../../ui/leghe-connect/leghe-connect';
import { PlayerCard } from '../../ui/player-card/player-card';
import { PlayerFlags } from '../../ui/player-flags/player-flags';
import { RoleBadge } from '../../ui/role-badge/role-badge';
import { RoleFilter } from '../../ui/role-filter/role-filter';
import { RoleSet } from '../../ui/role-set/role-set';
import { VoteTrend } from '../../ui/vote-trend/vote-trend';

/** Role order on screen, the order a lineup is written in. */
const ROLE_ORDER = ['P', 'Por', 'D', 'Dc', 'B', 'Dd', 'Ds', 'E', 'C', 'M', 'T', 'W', 'A', 'Pc'];
/** The role filter's chips, as the Draft Assistant offers them (`auction.ts`, `roleOptions`). */
const CLASSIC_ROLES = ['P', 'D', 'C', 'A'];
const MANTRA_ROLES = ['Por', 'Dd', 'Dc', 'Ds', 'B', 'E', 'M', 'C', 'W', 'T', 'A', 'Pc'];

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
  /** The match in full: `Atalanta (3°) - Bologna (12°)`, the places from the league tables (`core/standings.ts`). */
  matchTip: string;
  /** The FVA (`core/fva.ts`) and its sum in words, for the tooltip. */
  fva: number | null;
  fvaWhy: string;
  /** His club's last five matches from the sheet (`desc_trend_detail`), drawn as `ui-vote-trend`. */
  trend: readonly TrendCell[];
  /** Goals and assists of this season's championship, as the player card counts them (`seasonTotals`). */
  ga: { goals: number; assists: number } | null;
}

/** The roster table's sortable columns. */
export type LineupSort = 'role' | 'name' | 'trend' | 'ga' | 'chance' | 'fm' | 'fva' | 'odds' | 'advised';

/** Three drawings of the same pitch: ours, his own edit of it, or what Leghe already holds. */
export type PitchSource = 'advised' | 'edited' | 'sent';

/** Where the last save stands: nothing yet, on its way, written (and then read back), or refused with a reason. */
type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'done'; body: LegheLineupBody }
  | { kind: 'failed'; text: string };

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
 * Since 09/10/2026 the page also WRITES: the lineup on the pitch can be changed by drag & drop (`lineup-edit.ts`)
 * and saved on Leghe (`leghe-lineup.ts`), the operator's three requests of that evening. Until then his decision of
 * 08/10/2026 was «per il momento basta il consiglio».
 */
@Component({
  selector: 'app-lineup',
  imports: [
    AppHeader,
    CdkDrag,
    CdkDropList,
    CdkDropListGroup,
    ClubCard,
    ClubCrest,
    DatePipe,
    DecimalPipe,
    FormsModule,
    LegheConnect,
    NzAlertModule,
    NzButtonModule,
    NzInputModule,
    NzCheckboxModule,
    NzIconModule,
    NzPopconfirmModule,
    NzRadioModule,
    NzSelectModule,
    NzTooltipModule,
    PlayerCard,
    PlayerFlags,
    RoleBadge,
    RoleFilter,
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
  private readonly play = inject(ExpectedPlay);
  private readonly ratings = inject(PlayerRatingsStore);
  private readonly clock = inject(TimeTravel);
  protected readonly connecting = signal(false);

  /** «Invia al widget» (10/10/2026): the Android widget's squad, sent to the Sheet (`core/widget-feed.ts`). */
  protected readonly widget = inject(WidgetFeed);
  protected readonly widgetOpen = signal(false);
  private readonly sofascoreClubs = resource({ loader: () => this.bundle.sofascoreClubs() });

  /** The men of the team on screen, each with his club's SofaScore id where the bundle has one. */
  protected readonly widgetSquad = computed(() =>
    widgetMen(
      this.roster().map((r) => ({ name: r.name, role: r.roles.join(';'), club: r.club, clubId: r.clubId })),
      this.sofascoreClubs.hasValue() ? this.sofascoreClubs.value() : null,
    ),
  );

  /** Sends the team on screen to the widget, or (`remove`) takes it out. */
  protected sendToWidget(remove = false): void {
    const key = this.leagueKey();
    if (!key) return;
    const label = this.leagueOptions().find((o) => o.key === key)?.label ?? key;
    const squad = this.widgetSquad();
    void this.widget.send(key, label, remove ? [] : squad.men, remove ? [] : squad.missing);
  }

  protected copyWidgetUrl(): void {
    void navigator.clipboard?.writeText(this.widget.readUrl());
  }

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

  /** The select's value for «automatic»: a string, because nz-select draws a null value as an empty box. */
  protected readonly autoModule = 'auto';

  protected chooseModule(value: string): void {
    this.chosenModule.set(value === this.autoModule ? null : value);
  }

  /** The chosen module if this league's rulebook has it (a league of the other game has other modules). */
  protected readonly module = computed(() => {
    const chosen = this.chosenModule();
    return chosen && this.moduleOptions().some((o) => o.name === chosen) ? chosen : null;
  });

  /**
   * The FVA total each module of the rulebook fields with this roster (operator, 09/10/2026: «il modulo migliore
   * è semplicemente la somma dei singoli FVA»; it was the FMA until then): the best legal eleven per module on
   * the SAME weight the advised lineup is chosen on, men Leghe marks out left out - so the menu and the pitch
   * cannot disagree about which module is best.
   */
  private readonly moduleTotals = computed(() => {
    const book = this.book();
    const scores = book?.modules ? (bestOnModules(this.men(), book, this.game())?.scores ?? []) : [];
    return new Map(scores.map((one) => [one.module, one]));
  });

  /** The league pays a steadiness term (R-Factor or defence modifier): the totals are then not FVA alone. */
  protected readonly modifiersOn = computed(() => {
    const rules = this.md()?.rules;
    return !!rules && (!!rules.performance || !!rules.defence);
  });

  /** The module with the highest FVA total, more men placed first: the one the selector highlights. */
  protected readonly bestModule = computed(() => {
    let best: { module: string; total: number; placed: number } | null = null;
    for (const one of this.moduleTotals().values()) {
      if (!best || one.placed > best.placed || (one.placed === best.placed && one.total > best.total)) best = one;
    }
    return best?.module ?? null;
  });

  /**
   * Every module of the rulebook, best FVA total first, marked when the league does not allow it - and, on a
   * CLASSIC league with the defence modifier, when it fields fewer than four defenders: Leghe pays that modifier
   * only when at least four defenders played (and the keeper, where the league counts him:
   * `ModificatoriHelper.ModificatoreDifesa`, read 09/10/2026), so a 3-4-3 gives it up whatever its FVA. A rule of
   * the league, stated; the totals still do not count the modifier itself.
   */
  protected readonly moduleOptions = computed(() => {
    const book = this.book();
    const rules = this.md()?.rules;
    const allowed = new Set((rules?.modules ?? []).map(rulebookName));
    const defence = rules?.game === 'classic' && !!rules.defence;
    const totals = this.moduleTotals();
    const best = this.bestModule();
    return Object.keys(book?.modules ?? {})
      .map((name) => {
        const score = totals.get(name);
        const total = score ? score.total.toFixed(1) + (score.placed < 11 ? ` (${score.placed}/11)` : '') : '–';
        const fewDefenders = defence && !!book && placesIn(book, name).filter((p) => p.line === 'D').length < 4;
        const tags = [
          name === best ? '★ migliore' : '',
          allowed.size && !allowed.has(name) ? 'non ammesso' : '',
          fewDefenders ? 'senza mod. difesa' : '',
        ]
          .filter(Boolean)
          .join(' · ');
        // With a modifier the total is the FVA PLUS the steadiness it pays (`weightOn`), so it is not called FVA.
        const what = this.modifiersOn() ? 'valore' : 'FVA';
        return { name, best: name === best, sort: score ? score.placed * 1000 + score.total : -1, label: `${name} · ${what} ${total}${tags ? ' · ' + tags : ''}` };
      })
      .sort((x, y) => y.sort - x.sort);
  });
  protected readonly sortKey = signal<LineupSort>('advised');
  protected readonly sortDesc = signal(false);

  /** The roles the table is filtered on (operator, 09/10/2026), lowercase: any of them; none = everybody. */
  protected readonly roleFilter = signal<ReadonlySet<string>>(new Set());

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

  /**
   * The role filter's chips (`ui/role-filter`, the Draft Assistant's own), in the league's game: the four
   * macro-roles on classic, on Mantra the rulebook's own vocabulary - read, never transcribed - exactly as
   * the draft page reads it.
   */
  protected readonly roleOptions = computed<readonly string[]>(() => {
    if (this.game() !== 'mantra') return CLASSIC_ROLES;
    const rules = this.rulebook.hasValue() ? this.rulebook.value() : null;
    return rules?.roles ?? MANTRA_ROLES;
  });

  /** The sheet of this (listone, game); the same listone's other game where the bundle carries only that. */
  protected readonly sheet = computed(() => {
    const sheets = this.store.sheets().filter((s) => s.platform === this.platform());
    return sheets.find((s) => s.game === this.game()) ?? sheets[0] ?? null;
  });

  private readonly expectations = resource({
    params: () => this.sheet() ?? undefined,
    loader: ({ params }) => this.store.expectationsFor(params),
  });

  /** The five league tables (`calendar.json`, ESPN via the toolkit), for the match tooltip. */
  private readonly table = resource({
    loader: async () => standingsOf(await this.bundle.calendar()),
  });

  /**
   * fantacalcio.it's clubs by id (`fc_teams`, from the probabili pages): the name of an opponent that Leghe's
   * `championship/teams` does not list, i.e. every club outside the EuroLeghe perimeter. Only the TOOLTIP
   * reads it - the calendar and odds joins keep Leghe's own names, which they were measured on.
   */
  private readonly fcTeams = resource({
    loader: async () => fcTeamNames(await this.bundle.table('fc_teams').catch(() => null)),
  });

  /** The bundle's calendar by championship: the edge and the clean-sheet probability of each man's match. */
  private readonly calendarBook = resource({
    loader: async () => calendarBookFrom(await this.bundle.calendar()),
  });

  /**
   * EACH MAN'S MATCH AS THE CALENDAR READS IT: how much easier than his club's ordinary match it is (`delta`,
   * what the FVA adds to the base vote and the bonuses) and, for a keeper, P(clean sheet). The calendar's next
   * match of his club is taken only if it IS Leghe's match - same venue, and the same opponent where Leghe names
   * one - because the calendar carries dates and Leghe the matchday, and a match read on the wrong round would
   * price the wrong opponent. Not confirmed = no match term at all («vuoto = ignoto, mai zero»).
   */
  private readonly matchTerms = computed(() => {
    const out = new Map<number, { delta: number | null; cleanSheet: number | null }>();
    const md = this.md();
    const book = this.calendarBook.hasValue() ? this.calendarBook.value() : null;
    if (!md || !book) return out;
    const rows = this.bundleRows();
    const today = this.clock.realToday;
    for (const r of md.roster) {
      const club = rows.get(r.fcId)?.club;
      const calendar = club ? book.forClub(club) : null;
      const match = club && calendar ? calendar.next(club, today) : null;
      if (!club || !calendar || !match) continue;
      if (r.home !== null && match.home !== r.home) continue;
      const opponent = r.opponentId !== null ? (md.realTeams.get(r.opponentId)?.name ?? null) : null;
      if (opponent && !sameClub(match.opponent, opponent)) continue;
      const ordinary = calendar.ordinaryEdge(club);
      out.set(r.fcId, {
        delta: match.edge != null && ordinary != null ? match.edge - ordinary : null,
        cleanSheet: match.cleanSheet,
      });
    }
    return out;
  });

  /**
   * «Atalanta (3°) - Bologna (12°)»: the full names of the two clubs, home first, with their place. The name
   * is Leghe's where Leghe lists the club, fantacalcio.it's (`fc_teams`, same id) where it does not, and the
   * three letters only when neither knows it.
   */
  private matchTip(r: NextMatchRow): string {
    const md = this.md();
    const table: Standings | null = this.table.hasValue() ? this.table.value() : null;
    const fc = this.fcTeams.hasValue() ? this.fcTeams.value() : null;
    const name = (id: number | null) =>
      id === null ? null : (md?.realTeams.get(id)?.name ?? fc?.get(id) ?? null);
    const own = { name: name(r.clubId) ?? r.club, fcClubId: this.bundleRows().get(r.fcId)?.clubId ?? null };
    const codes = r.match.split('-');
    const other = { name: name(r.opponentId) ?? (r.home === false ? codes[0] : (codes[1] ?? '')), fcClubId: null };
    const label = (club: { name: string; fcClubId: number | null }) => {
      const place = table && club.name ? placeOf(table, { ...club, championship: r.championship }) : null;
      return place ? `${club.name} (${place.position}°)` : club.name;
    };
    const sides = r.home === false ? [other, own] : [own, other];
    return sides.filter((club) => club.name).map(label).join(' - ');
  }

  /** The rulebook of the league's game: a classic module is not a Mantra one (`classic_modules.json`). */
  private readonly rulebook = resource({
    params: () => this.game() ?? undefined,
    loader: ({ params }) => (params === 'mantra' ? this.bundle.modules() : this.bundle.classicModules()),
  });

  /**
   * The rulebook the page reads everywhere (menu, pitch, lineup sent): the file, plus on CLASSIC every module the
   * league allows - and the one it was sent in - that the file does not write, built from its three numbers
   * (`lineup-advice.withLeagueModules`). One computed, so the menu, the advice and the sent lineup cannot read
   * two different lists of modules.
   */
  private readonly book = computed(() => {
    const raw = this.rulebook.hasValue() ? this.rulebook.value() : null;
    const md = this.md();
    if (!raw?.modules || !md) return raw;
    const sent = this.current()?.saved?.module;
    return withLeagueModules(raw, sent ? [...md.rules.modules, sent] : md.rules.modules, md.rules.game);
  });

  /** The league chosen in the selector, as its key (the select works on strings). */
  protected readonly leagueKey = computed(() => {
    const league = this.session.league();
    return league ? keyOf(league) : null;
  });

  /**
   * ONE ENTRY PER FANTASQUADRA, of every account (operator, 09/10/2026: «aggiungere più fantasquadre ognuna con il
   * suo account o dello stesso account»): «Leghe · Lega · Squadra», the team's name from the stored reading of
   * that league (`LegheSession.teamName`, no request), and the user where two entries would still read the same -
   * one league reached by two accounts before either was read.
   */
  protected readonly leagueOptions = computed(() => {
    this.session.matchday.value(); // a pass is when a team's name can first be stored
    const options = this.session.leagues().map((l) => {
      const team = this.session.teamName(l);
      return { key: keyOf(l), user: l.userId ?? 0, label: `${LEGHE[l.platform].label} · ${l.name}${team ? ` · ${team}` : ''}` };
    });
    return options.map((one) =>
      options.some((other) => other !== one && other.label === one.label)
        ? { key: one.key, label: `${one.label} · utente ${one.user}` }
        : { key: one.key, label: one.label },
    );
  });

  /**
   * When Leghe was read: «alle 14:32» today, the day too otherwise - a cached reading of yesterday drawn as
   * a bare hour would read as today's.
   */
  protected readonly readTime = computed(() => {
    const at = this.md()?.readAt;
    if (!at) return '';
    const hour = at.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    return at.toDateString() === new Date().toDateString() ? `alle ${hour}` : WHEN.format(at);
  });

  /**
   * Without a login in this tab the page draws the STORED readings (operator, 09/10/2026: «mostra solo la data
   * dell'ultimo aggiornamento»): always the day, because the whole point is that it may not be today.
   */
  protected readonly storedOn = computed(() => {
    const at = this.md()?.readAt;
    return at ? WHEN.format(at) : '';
  });

  /** «Rileggi» needs a token: without one the button opens the login instead of failing. */
  protected reread(): void {
    if (this.session.offline()) this.connecting.set(true);
    else this.session.refresh();
  }

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
    const minutes = Math.round((at.getTime() - this.md()!.servedAt.getTime()) / 60_000);
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

  /** Every man's bookmakers' price, joined once: the table, the FVA and the pitch read the same join. */
  private readonly oddsByMan = computed(() => joinOdds(this.odds.matches(), this.oddsMen()));

  /**
   * EACH MAN'S CHAMPIONSHIP FOOTBALL, walked ONCE per roster: goals per appearance over this season and the
   * last (what the FVA splits the fantamedia with, and the level the prices are rescaled to, `fva.oddsScale`)
   * and this season's goals and assists (the G:A column). One walk, so the two readers cannot count two
   * different populations.
   */
  private readonly football = computed(() => {
    const out = new Map<
      number,
      { goalsPerMatch: number | null; restPerMatch: number | null; ga: { goals: number; assists: number } | null }
    >();
    const platform = this.platform();
    const [input, target] = [this.store.inputSeason(), this.store.targetSeason()];
    for (const r of this.md()?.roster ?? []) {
      const cellsNow = target ? this.players.matchesOf(r.fcId, platform, target) : [];
      const cellsBefore = input ? this.players.matchesOf(r.fcId, platform, input) : [];
      const now = target ? seasonTotals(cellsNow) : null;
      const before = input ? seasonTotals(cellsBefore) : null;
      const played = (now?.played ?? 0) + (before?.played ?? 0);
      // The rest of the bonus on the SAME matches the goal rate is counted on (`seasonTotals`' own filter).
      const championship = [...cellsNow, ...cellsBefore].filter(
        (one) => isChampionship(one.kind) && (one.state === 'played' || one.state === 'no_vote'),
      );
      out.set(r.fcId, {
        goalsPerMatch: played ? ((now?.goals ?? 0) + (before?.goals ?? 0)) / played : null,
        restPerMatch: restPerMatch(championship),
        ga: gaOf(now),
      });
    }
    return out;
  });

  /**
   * WHAT EACH MAN'S STEADINESS IS WORTH TO THE LEAGUE'S MODIFIERS, per match (operator, 09/10/2026: «se il
   * modificatore di rendimento è attivo aggiungi una valutazione migliore per quelli che hanno una continuità
   * migliore (frequenza alta di voti con 6>=0); se il modificatore di difesa è attivo ... ai difensori ... e ricorda
   * che le difese con < 4 difensori non ottengono questo bonus»).
   *
   * The steadiness is the app's one COSTANZA (`player-ratings.steadyOf`: the share of base votes of at least 6, read
   * from `PlayerRatingsStore`), the role's median where he has none (`swing.ROLE_STEADY`, «vuoto = ignoto, mai
   * zero»). The weight is the operator's own `STEADY_SHARE` with the league's size read from Leghe
   * (`steadyShareFor`: the modifier's top value over eleven). The R-Factor term goes to everybody; the defence term
   * to the men the modifier reads (`readByDefence`), and the eleven counts it only on a module with four defenders
   * on classic (`earnsDefence`). Absent where the league pays neither.
   */
  private readonly steadiness = computed(() => {
    const out = new Map<number, { rFactor: number | null; defence: number | null; words: string }>();
    const md = this.md();
    if (!md) return out;
    const rules = md.rules;
    const rPoints = rules.performance ? Math.max(...rules.performance) : 0;
    const dPoints = rules.defence ? Math.max(...rules.defence.values) : 0;
    if (rPoints <= 0 && dPoints <= 0) return out;
    this.ratings.ready(); // the ratings land after the bundle: read so this recomputes when they do
    const platform = this.platform();
    const rows = this.bundleRows();
    for (const r of md.roster) {
      const measured = this.ratings.for(platform, r.fcId)?.steady?.share ?? null;
      const role = rows.get(r.fcId)?.role as Role | undefined;
      const steady = measured ?? (role && role in ROLE_STEADY ? ROLE_STEADY[role] : null);
      if (steady === null) continue;
      const rFactor = rPoints > 0 ? steady * steadyShareFor(rPoints) : null;
      const reads =
        dPoints > 0 && readByDefence(r.roles.map((c) => c.toLowerCase()), rules.game, !!rules.defence?.withKeeper);
      const defence = reads ? steady * steadyShareFor(dPoints) : null;
      const parts = [
        rFactor ? `+${rFactor.toFixed(2)} rendimento` : '',
        defence ? `+${defence.toFixed(2)} difesa${rules.game === 'classic' ? ' (con 4 difensori)' : ''}` : '',
      ].filter(Boolean);
      const of = `costanza ${Math.round(steady * 100)}%${measured === null ? ' del ruolo' : ''}`;
      out.set(r.fcId, { rFactor, defence, words: parts.length ? `${of}: ${parts.join(', ')}` : '' });
    }
    return out;
  });

  /**
   * Every man of the roster priced for this matchday: the ONE list the table, the pitch and the bench read, so
   * the number beside a name in the table is the number the pitch was chosen on. The number SHOWN is the FVA
   * (`core/fva.ts`), and since 09/10/2026 it is also the number the eleven is chosen on (`points`).
   */
  private readonly men = computed<(LineupMan & { fmFromLeghe: boolean; fvaWhy: string })[]>(() => {
    const md = this.md();
    if (!md) return [];
    const sheet = this.expectations.hasValue() ? this.expectations.value() : null;
    const odds = this.oddsByMan();
    const steadiness = this.steadiness();
    const inputs = md.roster.map((r) => {
      const expected = sheet?.get(r.fcId);
      const fromSheet = expected?.fm ?? null;
      const fm = fromSheet ?? r.fantavote;
      const keeper = r.roles.some((c) => c === 'P' || c === 'Por');
      const price = odds.get(r.fcId);
      return {
        r,
        fm,
        fromSheet,
        keeper,
        input: {
          keeper,
          mv: expected?.mv ?? r.vote,
          fm,
          minutes: expected?.minutesNext ?? null,
          goalsPerMatch: keeper ? null : (this.football().get(r.fcId)?.goalsPerMatch ?? null),
          restPerMatch: keeper ? null : (this.football().get(r.fcId)?.restPerMatch ?? null),
          oddsProb: price && price.kind === (keeper ? 'clean-sheet' : 'goal') ? price.prob : null,
          delta: this.matchTerms().get(r.fcId)?.delta ?? null,
          cleanSheet: this.matchTerms().get(r.fcId)?.cleanSheet ?? null,
        } satisfies FvaInput,
      };
    });
    const scale = oddsScale(
      inputs
        .filter((one) => !one.keeper && one.input.goalsPerMatch !== null && one.input.oddsProb !== null)
        .map((one) => ({ goalsPerMatch: one.input.goalsPerMatch!, oddsProb: one.input.oddsProb! })),
    );
    return inputs.map(({ r, fm, fromSheet, keeper, input }) => {
      const chance = voteChance(r.percent, r.out);
      const fva = fvaOf(input, scale);
      const steady = steadiness.get(r.fcId) ?? null;
      return {
        id: r.fcId,
        name: r.name,
        roles: r.roles.map((c) => c.toLowerCase()),
        shown: r.roles,
        chance,
        fm,
        fva: fva.value,
        fvaWhy: fvaWords(fva, keeper) + (steady?.words ? ` · ${steady.words}` : ''),
        steadyBonus: steady?.rFactor ?? null,
        defenceBonus: steady?.defence ?? null,
        fmFromLeghe: fromSheet === null && fm !== null,
        // THE ELEVEN IS CHOSEN ON THE FVA ALONE (operator, 09/10/2026: «il modulo migliore è semplicemente la
        // somma dei singoli FVA, non pensare alla probabilità di prendere il voto»). Only a man Leghe marks OUT
        // (chance 0: unavailable, suspended, not called) is never fielded - that is a fact, not a probability.
        points: fva.value === null || chance === 0 ? null : fva.value,
      };
    });
  });

  protected readonly advised = computed<LineupPlan | null>(() => {
    const md = this.md();
    const book = this.book();
    if (!md || !book) return null;
    const chosen = this.module();
    const modules = chosen ? [chosen] : md.rules.modules;
    // The SUBSTITUTIONS are the league's whatever module is drawn: a module change lands on the league's list.
    return adviseLineup(this.men(), book, modules, md.rules.bench, md.rules.game, {
      kind: md.rules.substitutions.kind,
      modules: md.rules.modules,
    });
  });

  protected readonly sent = computed<LineupPlan | null>(() => {
    const saved = this.current()?.saved;
    const book = this.book();
    if (!saved?.savedAt || !book) return null;
    return drawSent(this.men(), book, saved);
  });

  /**
   * HOW THE BENCH ENTERS, in one line under the pitch: the advised bench's order is the league's substitution
   * rule (`lineup-advice.benchOf`), and a classic queue that mixes roles would otherwise read as a mistake.
   */
  protected readonly benchNote = computed(() => {
    const rules = this.md()?.rules;
    if (rules?.game !== 'classic') return '';
    switch (rules.substitutions.kind) {
      case 'traditional':
        return 'Sostituzioni Traditional: entra il primo dello stesso ruolo, quindi la panchina è ordinata per ruolo.';
      case 'dynamic':
      case 'hybrid':
        return `Sostituzioni ${rules.substitutions.kind === 'dynamic' ? 'Dynamic' : 'Hybrid'}: entra il primo della panchina che gioca, anche cambiando modulo, quindi la panchina è una coda unica per FVA.`;
      default:
        return 'Sostituzioni non lette: la panchina è una coda unica per FVA.';
    }
  });

  /** The pitch on screen: what was asked for, and nothing in its place when it does not exist. */
  protected readonly pitch = computed(() => {
    switch (this.pitchSource()) {
      case 'sent':
        return this.sent();
      case 'edited':
        return this.edited() ?? this.advised();
      default:
        return this.advised();
    }
  });

  // ---------------------------------------------------------------- his own lineup: drag & drop

  /**
   * WHOSE LINEUP THE EDIT IS: the fantasquadra and the matchday. A draft belongs to one of them, and a draft made
   * for another league or another matchday is simply not drawn - the roster under it is a different one.
   */
  private readonly owner = computed(() => {
    const league = this.session.league();
    const day = this.current()?.saved?.matchday ?? this.md()?.status.matchday ?? null;
    return league ? `${keyOf(league)}:${day ?? '?'}` : null;
  });

  private readonly draftState = signal<LineupDraft | null>(null);

  /** His edit of the lineup, when he has made one for THIS fantasquadra and matchday. */
  protected readonly draft = computed(() => {
    const draft = this.draftState();
    return draft && draft.owner === this.owner() ? draft : null;
  });

  private readonly subs = computed(() => {
    const rules = this.md()?.rules;
    return rules ? { kind: rules.substitutions.kind, modules: rules.modules } : undefined;
  });

  /** The edit drawn with the numbers of the moment (`lineup-edit.drawDraft`). */
  protected readonly edited = computed(() => {
    const draft = this.draft();
    return draft ? drawDraft(this.men(), this.book(), draft, this.game(), this.subs()) : null;
  });

  private readonly menById = computed(() => new Map(this.men().map((man) => [man.id, man])));

  /** The switch the SENT lineup carries, in the page's words (module by its rulebook name). */
  private readonly sentSwitch = computed(() => {
    const sw = this.current()?.saved?.switch;
    return sw ? { out: sw.out, in: sw.in, module: sw.module ? moduleLabel(sw.module) : null } : NO_SWITCH;
  });

  /**
   * WHAT A GESTURE STARTS FROM: his edit when he is looking at it, otherwise the lineup on screen - so the first
   * drag on the advised (or the sent) lineup copies it into his own and changes that.
   */
  private readonly workingDraft = computed<LineupDraft | null>(() => {
    const owner = this.owner();
    const book = this.book();
    if (!owner || !book) return null;
    const source = this.pitchSource();
    const draft = this.draft();
    if (source === 'edited' && draft) return draft;
    const plan = this.pitch();
    if (!plan) return null;
    return draftOf(plan, owner, placesIn(book, plan.module).length, source === 'sent' ? this.sentSwitch() : NO_SWITCH);
  });

  /** The man being dragged, for the places that light up. */
  protected readonly dragging = signal<number | null>(null);

  /** The places the man being dragged may land on: the same `move` the drop runs, so the light cannot lie. */
  protected readonly openPlaces = computed(() => {
    const id = this.dragging();
    const base = this.workingDraft();
    const book = this.book();
    if (id === null || !base || !book) return null;
    const open = new Set<number>();
    base.places.forEach((_, at) => {
      if ('draft' in move(base, id, { kind: 'place', at }, this.menById(), book)) open.add(at);
    });
    return open;
  });

  /** What the last refused gesture was refused for (one sentence), cleared by the next one that works. */
  protected readonly editNote = signal<string | null>(null);

  protected readonly outTarget: DropTarget = { kind: 'out' };
  protected readonly benchTarget: DropTarget = { kind: 'bench', index: 0 };
  protected readonly switchOutTarget: DropTarget = { kind: 'switch-out' };
  protected readonly switchInTarget: DropTarget = { kind: 'switch-in' };
  /** One target per place of a module (eleven at most), built once: the template indexes it by `place.at`. */
  protected readonly placeTargets: DropTarget[] = Array.from({ length: 11 }, (_, at) => ({ kind: 'place', at }));
  protected readonly switchSides = ['out', 'in'] as const;

  /**
   * CDK asks before a drop list takes a man: a place he cannot play, a switch side he is not on, are refused while
   * he is still in the air - so the drop never lands somewhere `move` would refuse. An arrow function, because CDK
   * calls it without `this`.
   */
  protected readonly canEnter = (drag: CdkDrag<number>, drop: CdkDropList<DropTarget>): boolean => {
    const target = drop.data;
    if (target.kind === 'place') return this.openPlaces()?.has(target.at) ?? false;
    if (target.kind === 'switch-out' || target.kind === 'switch-in') {
      const base = this.workingDraft();
      const book = this.book();
      return !!base && !!book && 'draft' in move(base, drag.data, target, this.menById(), book);
    }
    return true;
  };

  /**
   * ONE DROP = ONE `move`: on a place, on the bench at the index CDK declares, back on the roster table, on a side
   * of the switch. The DOM is CDK's to move and the lineup stays ours: the page redraws from the new draft.
   */
  protected dropped(event: CdkDragDrop<DropTarget>): void {
    const id = event.item.data as number;
    const book = this.book();
    const base = this.workingDraft();
    let target = event.container.data;
    if (!book || !base || !target) return;
    if (target.kind === 'bench') target = { kind: 'bench', index: event.currentIndex };
    else if (event.previousContainer === event.container) return; // put back where it was
    const result = move(base, id, target, this.menById(), book);
    if ('refused' in result) {
      this.editNote.set(result.refused);
      return;
    }
    this.editNote.set(null);
    this.saveState.set({ kind: 'idle' });
    this.draftState.set(result.draft);
    this.pitchSource.set('edited');
  }

  /**
   * CLICK OR DRAG on the same name: CDK starts a drag only past its threshold (5px), but does not swallow the
   * `click` the browser sends after a release - so the card would open on every drop. The guard goes down on a
   * timeout and not inside the click (the Strategia page's lesson: a guard that waits for a click that never comes
   * eats the next one).
   */
  private draggingNow = false;

  protected dragStarted(id: number): void {
    this.draggingNow = true;
    this.dragging.set(id);
  }

  protected dragEnded(): void {
    this.dragging.set(null);
    setTimeout(() => (this.draggingNow = false));
  }

  /** «Torna alla consigliata»: his edit forgotten. */
  protected resetDraft(): void {
    this.draftState.set(null);
    this.editNote.set(null);
    this.pitchSource.set('advised');
  }

  /** The module of HIS lineup: the same men laid out on another one (`relayout`). */
  protected chooseEditedModule(module: string): void {
    const draft = this.draft();
    const book = this.book();
    if (!draft || !book || module === this.autoModule) return;
    this.draftState.set(relayout(draft, module, this.menById(), book));
  }

  /** The one handler of the module menu: the advised lineup's module, or his own lineup laid out again. */
  protected onModule(value: string): void {
    if (this.pitchSource() === 'edited' && this.draft()) this.chooseEditedModule(value);
    else this.chooseModule(value);
  }

  protected readonly previewClass = ['rounded-md', 'opacity-60'];

  // ---------------------------------------------------------------- the switch

  /**
   * THE SWITCH of the lineup on screen, when the league has one (operator, 09/10/2026: «se nelle regole della lega
   * è disponibile lo SWITCH (DEFAULT o PLUS) permettimi anche di impostarli»): who goes out, who comes in, and -
   * once both are set - whether Leghe would take it, with the modules it can land on (`leghe-lineup.switchModules`,
   * the same rule the save checks). On the sent lineup it is read only.
   */
  protected readonly switchView = computed(() => {
    const mode = this.md()?.rules.switchMode;
    const plan = this.pitch();
    if ((mode !== 'basic' && mode !== 'plus') || !plan) return null;
    const source = this.pitchSource();
    const sw = source === 'sent' ? this.sentSwitch() : source === 'edited' ? (this.draft()?.switch ?? NO_SWITCH) : NO_SWITCH;
    const byId = this.menById();
    const out = sw.out === null ? null : (byId.get(sw.out) ?? null);
    const into = sw.in === null ? null : (byId.get(sw.in) ?? null);
    let modules: string[] = [];
    let problem: string | null = null;
    if (out && into) {
      const rules = this.md()!.rules;
      const code = legheModuleCode(plan.module, rules.modules);
      const starters = plan.rows.flatMap((row) => row.places.flatMap((place) => (place.man ? [asSaveMan(place.man)] : [])));
      modules = code
        ? switchModules(starters, asSaveMan(out), asSaveMan(into), code, rules.modules, this.game(), mode).map(moduleLabel)
        : [];
      if (!modules.length) {
        problem =
          mode === 'basic'
            ? `${into.name} non può prendere il posto di ${out.name}`
            : `con ${into.name} al posto di ${out.name} nessun modulo della lega è schierabile`;
      }
    }
    const chosen = sw.module && modules.includes(sw.module) ? sw.module : (modules[0] ?? null);
    return { mode, readonly: source === 'sent', out, into, modules, chosen, problem };
  });

  protected clearSwitch(side: 'out' | 'in'): void {
    const draft = this.draft();
    if (!draft) return;
    this.draftState.set({ ...draft, switch: side === 'out' ? NO_SWITCH : { ...draft.switch, in: null } });
  }

  protected chooseSwitchModule(module: string): void {
    const draft = this.draft();
    if (draft) this.draftState.set({ ...draft, switch: { ...draft.switch, module } });
  }

  // ---------------------------------------------------------------- saving on Leghe

  /** «Anche nelle altre competizioni»: his choice, else what the lineup already sent says, else no (Leghe's own default). */
  protected readonly allCompetitionsChoice = signal<boolean | null>(null);

  protected readonly activeCompetitions = computed(() => (this.md()?.competitions ?? []).filter((c) => c.active));

  protected readonly allCompetitions = computed(() => {
    const saved = this.current()?.saved;
    return this.allCompetitionsChoice() ?? (saved?.savedAt ? (saved.allCompetitions ?? false) : false);
  });

  /**
   * THE LINEUP ON SCREEN AS LEGHE WOULD TAKE IT, or the one reason it would not: the body is built before the
   * click, so the button says why it cannot save instead of finding out from a refusal.
   */
  protected readonly savePlan = computed(() => {
    const md = this.md();
    const plan = this.pitch();
    const day = this.current();
    if (!md || !plan || this.pitchSource() === 'sent') return null;
    if (this.session.offline()) return { refusal: 'Collegati a Leghe per salvare.' };
    if (!day || !md.team) return { refusal: 'Nessuna competizione con una giornata da schierare.' };
    if (this.closes()?.past) return { refusal: 'Le formazioni sono chiuse.' };
    const starters = plan.rows.flatMap((row) => row.places.flatMap((place) => (place.man ? [asSaveMan(place.man)] : [])));
    const sw = this.pitchSource() === 'edited' ? (this.draft()?.switch ?? NO_SWITCH) : NO_SWITCH;
    return saveBody({
      game: md.rules.game,
      rules: md.rules,
      module: plan.module,
      starters,
      bench: plan.bench.map(asSaveMan),
      switchPair: sw.out !== null && sw.in !== null ? { out: sw.out, in: sw.in, module: sw.module } : null,
      competitionId: day.competition.id,
      matchday: day.saved?.matchday ?? null,
      championshipMatchday: day.saved?.championshipMatchday ?? null,
      teamId: md.team.id,
      allCompetitions: this.allCompetitions(),
      // Kept as it was sent: a hidden lineup stays hidden. Never sent = visible, Leghe's own default.
      visible: day.saved?.savedAt ? (day.saved.visible ?? true) : true,
    });
  });

  /** The button's state and the sentence beside it, each its own number (one pass over `savePlan`). */
  protected readonly canSave = computed(() => {
    const plan = this.savePlan();
    return !!plan && 'body' in plan && this.saveState().kind !== 'saving';
  });

  protected readonly saveBlock = computed(() => {
    const plan = this.savePlan();
    return plan && 'refusal' in plan ? plan.refusal : null;
  });

  protected readonly saveState = signal<SaveState>({ kind: 'idle' });

  protected readonly saveError = computed(() => {
    const state = this.saveState();
    return state.kind === 'failed' ? state.text : null;
  });

  /**
   * THE SAVE READ BACK: after the write the page re-reads the lineup Leghe holds (`LegheSession.saveLineup`), and
   * says whether it is the one just sent - module, eleven in order and bench - rather than trusting the 200.
   */
  protected readonly saveCheck = computed<{ ok: boolean; text: string } | null>(() => {
    const state = this.saveState();
    if (state.kind !== 'done') return null;
    if (this.session.matchday.isLoading()) return { ok: true, text: 'Salvata: rileggo da Leghe…' };
    const saved = this.current()?.saved;
    const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
    if (!saved?.savedAt) return { ok: false, text: 'Salvata, ma Leghe non la mostra ancora: rileggi.' };
    const ok = saved.module === state.body.mdl && same(saved.starts, state.body.starts) && same(saved.bench, state.body.bench);
    return ok
      ? { ok, text: `Salvata su Leghe alle ${saved.savedAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}: Leghe la conferma.` }
      : { ok, text: 'Salvata, ma Leghe mostra una formazione diversa da quella inviata.' };
  });

  protected async save(): Promise<void> {
    const md = this.md();
    const plan = this.savePlan();
    if (!md || !plan || !('body' in plan) || this.saveState().kind === 'saving') return;
    this.saveState.set({ kind: 'saving' });
    try {
      await this.session.saveLineup(md, plan.body);
      this.saveState.set({ kind: 'done', body: plan.body });
      // What Leghe now holds is «Inviata»: shown, so the save is seen as Leghe recorded it.
      this.pitchSource.set('sent');
    } catch (err) {
      this.saveState.set({ kind: 'failed', text: saveRefusal(err) });
    }
  }

  /**
   * THE LINEUP THE TABLE'S «CONSIGLIO» COLUMN READS: his own once he has edited one («Mia»), the advised otherwise -
   * so the column says where the lineup he is about to save puts each man.
   */
  protected readonly planned = computed(() => (this.draft() ? this.edited() : this.advised()));

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
    const advised = this.planned();
    const sent = this.sent();
    const rows = this.bundleRows();
    const sheet = this.expectations.hasValue() ? this.expectations.value() : null;
    const oddsByMan = this.oddsByMan();
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
        fva: man.fva ?? null,
        fvaWhy: man.fvaWhy,
        matchTip: this.matchTip(r),
        clubName: own?.club ?? null,
        clubId: own?.clubId ?? null,
        odds: oddsByMan.get(r.fcId) ?? null,
        trend: sheet?.get(r.fcId)?.recentVotes ?? [],
        ga: this.football().get(r.fcId)?.ga ?? null,
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
        case 'fva':
          return num(b.fva) - num(a.fva);
        case 'odds':
          // Lower price = likelier: ascending is the natural order, unknown last. A clean-sheet price is
          // another quantity, so it sorts NEGATED (the operator, 09/10/2026) and the keepers never mix with
          // the goal prices; the cell still prints the price as it is.
          return oddsSortValue(a.odds) - oddsSortValue(b.odds);
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

  // ---------------------------------------------------------------- the player card

  /**
   * THE CARD OF A MAN, opened by a click on his name in the table, on the pitch or on the bench (operator,
   * 09/10/2026: «quando clicco sul nome di un calciatore si deve aprire la sua scheda di dettaglio» - on
   * every page). The same `ui/player-card` as the other pages, with the page's own `CardStack`.
   */
  private readonly cards = new CardStack();

  protected readonly openCards = computed(() => {
    const rows = this.bundleRows();
    const sheet = this.expectations.hasValue() ? this.expectations.value() : null;
    const rounds = this.store.seasonRoundsFor(this.sheet());
    const platform = this.platform();
    const game = this.game() === 'mantra' ? 'mantra' : 'classic';
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
        // No table: this page fields a squad, it does not buy one.
        market: null,
      };
      return man;
    });
  });

  protected readonly clubCards = computed(() => this.cards.place((key) => clubOfCard(key) ?? undefined));
  protected readonly cardCount = computed(() => this.openCards().length + this.clubCards().length);
  protected readonly frontCard = computed(() => this.cards.front());

  protected openPlayer(id: number): void {
    if (this.draggingNow) return; // the click a drop leaves behind (`dragStarted`)
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

  /** The FVA total of the men on the pitch (empty places count nothing). */
  protected fvaTotal(plan: LineupPlan): number {
    return plan.rows.reduce((sum, row) => sum + row.places.reduce((part, p) => part + (p.man?.fva ?? 0), 0), 0);
  }

  /** An FVA, one decimal; a dash where nobody can price him. */
  protected pts(value: number | null): string {
    return value === null ? '–' : value.toFixed(1);
  }

  /**
   * The rows the TABLE draws: the roster, kept to the chosen roles (a man passes with ANY of his, as on the
   * Draft Assistant). Only the table: the advice, the pitch and the odds count keep reading the whole roster.
   * A choice the league's game does not offer (a Mantra code after switching to a classic league) is ignored.
   */
  protected readonly shown = computed<RosterLine[]>(() => {
    const options = new Set(this.roleOptions().map((role) => role.toLowerCase()));
    const wanted = new Set([...this.roleFilter()].filter((role) => options.has(role)));
    const all = this.roster();
    return wanted.size ? all.filter((man) => man.roles.some((role) => wanted.has(role.toLowerCase()))) : all;
  });

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
    if (!league) return;
    this.saveState.set({ kind: 'idle' });
    this.session.choose(league);
  }
}

/** A man as the save needs him: who he is and Leghe's roles. */
function asSaveMan(man: LineupMan): SaveMan {
  return { id: man.id, name: man.name, roles: man.roles };
}

/** The pair the table prints `3:1`; null when he has no championship match this season. */
function gaOf(totals: { goals: number; assists: number } | null): { goals: number; assists: number } | null {
  return totals ? { goals: totals.goals, assists: totals.assists } : null;
}
