import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { Bundle } from '../../../core/bundle';
import { looseMatch } from '../../../core/loose-search';
import { PresenceSort, PresenceTestFile, PresenceTestView, presenceRows } from '../../../core/presence-test';

/**
 * «PARTITE ATTESE» on /why (operator, 30/09/2026: «una sezione con una tabella con tutti i calciatori e i dati che
 * stiamo testando, in modo da poter verificare la bontà dei calcoli»).
 *
 * Every number comes from `presence_test.json`, which the toolkit writes: the season before split into its reasons,
 * the two factors D and S the formula makes of them, the formula's Pa, the engine's Pa and what he really played.
 * The page computes only the two errors. The window is a choice because the two answer different questions: T1 is
 * where the formula was FITTED, so it flatters it; T2 is the season it had never seen, and that is the verdict.
 */
@Component({
  selector: 'app-presence-test',
  imports: [FormsModule, NzInputModule, NzRadioModule, NzTooltipModule],
  templateUrl: './presence-test.html',
})
export class PresenceTest {
  private readonly bundle = inject(Bundle);

  protected readonly file = signal<PresenceTestFile | null>(null);
  protected readonly loaded = signal(false);
  protected readonly window = signal<'T1' | 'T2'>('T2');
  protected readonly role = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly sort = signal<PresenceSort>('gain');
  protected readonly descending = signal(true);

  constructor() {
    void this.bundle.presenceTest().then((file) => {
      this.file.set(file);
      this.loaded.set(true);
    });
  }

  protected readonly summary = computed(() => this.file()?.summary[this.window()] ?? null);

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

  /** How many of the listed men the formula got closer on than the engine, and the other way round. */
  protected readonly duel = computed(() => {
    const both = this.rows().filter((row) => row.errEngine != null);
    const closer = both.filter((row) => Math.abs(row.errFormula) < Math.abs(row.errEngine!)).length;
    const farther = both.filter((row) => Math.abs(row.errFormula) > Math.abs(row.errEngine!)).length;
    return { closer, farther, even: both.length - closer - farther };
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
      this.descending.set(key !== 'name');
    }
  }

  protected arrow(key: PresenceSort): string {
    return this.sort() === key ? (this.descending() ? ' ↓' : ' ↑') : '';
  }

  protected signed(value: number | null): string {
    if (value == null) return '—';
    return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
  }

  /** How much closer the formula got than the engine, in matches: positive is the formula's win. */
  protected gain(row: PresenceTestView): number | null {
    return row.errEngine == null ? null : Math.round((Math.abs(row.errEngine) - Math.abs(row.errFormula)) * 10) / 10;
  }

  protected pct(value: number | null): string {
    return value == null ? '—' : `${Math.round(value * 100)}%`;
  }

  /** The error's ink: within three matches neutral, beyond it the direction (over red, under blue). */
  protected errInk(value: number | null): string {
    if (value == null || Math.abs(value) < 3) return 'text-muted';
    return value > 0 ? 'text-danger' : 'text-primary';
  }
}
