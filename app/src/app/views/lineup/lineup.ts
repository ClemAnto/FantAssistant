import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { LEGHE } from '../../core/leghe-api';
import { NextMatchRow } from '../../core/leghe-matchday';
import { moduleLabel, rulesSummary } from '../../core/leghe-rules';
import { LegheSession, keyOf } from '../../core/leghe-session';
import { AppHeader } from '../../ui/app-header/app-header';
import { LegheConnect } from '../../ui/leghe-connect/leghe-connect';
import { RoleSet } from '../../ui/role-set/role-set';

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

/** One row of the roster table: the man plus where the lineup already sent puts him. */
export interface RosterLine extends NextMatchRow {
  /** «Titolare», «Panchina 3», or null when the lineup sent does not name him. */
  placed: string | null;
  outLabel: string | null;
}

/**
 * LA FORMAZIONE DELLA PROSSIMA GIORNATA (the operator, 08/10/2026: «una nuova pagina che ti aiuti ad
 * inserire la formazione per la prossima giornata ... caricare la tua rosa e le regole per inserire
 * formazione/panchina e competizione»).
 *
 * THIS FIRST STEP SHOWS WHAT LEGHE SAYS, and nothing of ours yet: the roster with each man's next real
 * match and the platform's probable-starter percentage, the league's lineup rules read from its settings,
 * every competition with this matchday's opponent and whether a lineup was already sent, and when lineups
 * close. The advice (module, eleven, bench order) is the next step and will be computed on exactly these
 * facts - so they are on screen first, where a wrong reading can be seen before anything is built on it.
 *
 * Nothing here writes to Leghe: the operator's decision of 08/10/2026 is «per il momento basta il
 * consiglio».
 */
@Component({
  selector: 'app-lineup',
  imports: [
    AppHeader,
    FormsModule,
    LegheConnect,
    NzAlertModule,
    NzButtonModule,
    NzIconModule,
    NzSelectModule,
    NzTableModule,
    NzTooltipModule,
    RoleSet,
  ],
  templateUrl: './lineup.html',
})
export class Lineup {
  protected readonly session = inject(LegheSession);
  protected readonly connecting = signal(false);

  /** The matchday read, or null while there is none (a resource in error throws on `value()`). */
  protected readonly md = computed(() =>
    this.session.matchday.hasValue() ? this.session.matchday.value() : null,
  );

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

  protected readonly roster = computed<RosterLine[]>(() => {
    const md = this.md();
    if (!md) return [];
    const saved = this.current()?.saved;
    const starts = new Set(saved?.starts ?? []);
    const bench = saved?.bench ?? [];
    const rank = (r: NextMatchRow) => {
      const i = ROLE_ORDER.indexOf(r.roles[0] ?? '');
      return i < 0 ? ROLE_ORDER.length : i;
    };
    return [...md.roster]
      .sort((a, b) => rank(a) - rank(b) || (b.percent ?? -1) - (a.percent ?? -1) || a.name.localeCompare(b.name))
      .map((r) => ({
        ...r,
        placed: starts.has(r.fcId) ? 'Titolare' : bench.includes(r.fcId) ? `Panchina ${bench.indexOf(r.fcId) + 1}` : null,
        outLabel: r.out ? OUT_LABEL[r.out] : null,
      }));
  });

  protected chooseLeague(key: string): void {
    const league = this.session.leagues().find((l) => keyOf(l) === key);
    if (league) this.session.choose(league);
  }
}
