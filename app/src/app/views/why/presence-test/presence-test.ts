import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { Bundle } from '../../../core/bundle';
import { looseMatch } from '../../../core/loose-search';
import { PresenceSort, PresenceTestFile, presenceRows } from '../../../core/presence-test';
import { TITOLARITA_SHORT, isTitolarita, titolaritaRank } from '../../../core/titolarita';

/**
 * «PARTITE ATTESE» on /why (operator, 30/09/2026: «una sezione con una tabella con tutti i calciatori e i dati che
 * stiamo testando, in modo da poter verificare la bontà dei calcoli»).
 *
 * Every number comes from `presence_test.json`, which the toolkit writes: the season before split into its reasons,
 * the two factors D and S the formula makes of them, the formula's Pa, the engine's Pa and what he really played.
 * The page computes only the two errors. v2 (01/10/2026): every window of the gate is judged with parameters fitted
 * on the other nine, so each one is out of sample and the choice is only which season to look at; the newest first.
 */
@Component({
  selector: 'app-presence-test',
  imports: [FormsModule, NzInputModule, NzRadioModule, NzSelectModule, NzTooltipModule],
  templateUrl: './presence-test.html',
})
export class PresenceTest {
  private readonly bundle = inject(Bundle);

  protected readonly file = signal<PresenceTestFile | null>(null);
  protected readonly loaded = signal(false);
  protected readonly window = signal('T2');
  protected readonly role = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly sort = signal<PresenceSort>('ratioFormula');
  protected readonly descending = signal(false);

  constructor() {
    void this.bundle.presenceTest().then((file) => {
      this.file.set(file);
      this.loaded.set(true);
    });
  }

  protected readonly summary = computed(() => this.file()?.summary[this.window()] ?? null);

  /** The windows the file judges, newest first (the order the toolkit writes them in is oldest first). */
  protected readonly windows = computed(() => {
    const file = this.file();
    return file ? Object.entries(file.summary).map(([key, sum]) => ({ key, sum })).reverse() : [];
  });

  /** The two club columns are named after the seasons they describe: «Squadra 24-25», «Squadra 25-26». */
  protected readonly seasons = computed(() => {
    const target = this.summary()?.target;
    if (!target) return { prev: 'prima', next: 'dopo' };
    const start = Number(target.slice(0, 4));
    const short = (year: number) => `${String(year).slice(2)}-${String(year + 1).slice(2)}`;
    return { prev: short(start - 1), next: short(start) };
  });

  protected readonly rows = computed(() => {
    const file = this.file();
    if (!file) return [];
    const query = this.query().trim();
    return presenceRows(file, this.window(), {
      role: this.role(),
      query: query ? (row) => looseMatch(query, row.name) : undefined,
      sort: this.sort(),
      descending: this.descending(),
    });
  });

  /**
   * THE SAMPLE'S OWN VERDICT beside the file's (which is over everybody): how many of the shown men each prediction
   * put within 80%-125% of what they really played.
   */
  protected readonly band = computed(() => {
    const rows = this.rows();
    const within = (value: number | null) => value != null && value >= 0.8 && value <= 1.25;
    return {
      formula: rows.filter((row) => within(row.ratioFormula)).length,
      engine: rows.filter((row) => within(row.ratioEngine)).length,
    };
  });

  protected readonly params = computed(() => {
    const file = this.file();
    return file ? Object.entries(file.params).map(([key, value]) => `${key} ${value}`).join(' · ') : '';
  });

  protected readonly priors = computed(() => {
    const file = this.file();
    return file ? Object.entries(file.priors).map(([key, value]) => `${key} ${value}`).join(' · ') : '';
  });

  protected sortBy(key: PresenceSort): void {
    if (this.sort() === key) this.descending.set(!this.descending());
    else {
      this.sort.set(key);
      // A ratio sorts by distance from 100%, closest first; a count largest first; a name A to Z.
      // A rung sorts by the ladder, strongest first.
      this.descending.set(key !== 'name' && key !== 'ratioFormula' && key !== 'ratioEngine'
        && key !== 'rung' && key !== 'rungActual');
    }
  }

  protected arrow(key: PresenceSort): string {
    return this.sort() === key ? (this.descending() ? ' ↓' : ' ↑') : '';
  }

  /** A ratio as the operator reads it: 100% exact, 50% he played twice the expected, 200% half. */
  protected ratio(value: number | null): string {
    return value == null ? '—' : `${Math.round(value * 100)}%`;
  }

  /** A verdict as the gate writes it: wins over windows, the mean gain and the worst one. */
  protected verdictText(v: { windows: number; wins: number; mean_gain: number; worst: number } | null | undefined): string {
    if (!v) return '—';
    const signed = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
    return `${v.wins} su ${v.windows}, media ${signed(v.mean_gain)}, peggiore ${signed(v.worst)}`;
  }

  /** The rung's three letters (`core/titolarita`), one vocabulary for every screen. */
  protected rungShort(value: string | null | undefined): string {
    return isTitolarita(value) ? TITOLARITA_SHORT[value] : '—';
  }

  /** The same weight the squad table gives a rung: the top two bold, the bottom two muted. */
  protected rungTone(value: string | null | undefined): string {
    const rank = titolaritaRank(value);
    if (rank == null) return 'text-muted';
    if (rank <= 1) return 'font-semibold';
    return rank >= 4 ? 'text-muted' : '';
  }

  protected pct(value: number | null): string {
    return value == null ? '—' : `${Math.round(value * 100)}%`;
  }

  /**
   * The ratio's ink: within 80%-125% green, within 67%-150% neutral, beyond it the direction - over-predicted
   * (he played less) red, under-predicted (he played more) blue. Symmetric, like the order.
   */
  protected ratioInk(value: number | null): string {
    if (value == null) return 'text-muted';
    if (value >= 0.8 && value <= 1.25) return 'text-success';
    if (value >= 2 / 3 && value <= 1.5) return 'text-fg';
    return value > 1 ? 'text-danger' : 'text-primary';
  }
}
