import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { Bundle } from '../../../core/bundle';
import { looseMatch } from '../../../core/loose-search';
import { PresenceSort, PresenceTestFile, presenceRows } from '../../../core/presence-test';

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
  protected readonly sort = signal<PresenceSort>('ratioFormula');
  protected readonly descending = signal(false);

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

  /**
   * THE SAMPLE'S OWN VERDICT beside the file's (which is over everybody): how many of the shown men each prediction
   * put within 80%-125% of what they really played, and how many played nothing at all.
   */
  protected readonly band = computed(() => {
    const rows = this.rows();
    const within = (value: number | null) => value != null && value >= 0.8 && value <= 1.25;
    return {
      formula: rows.filter((row) => within(row.ratioFormula)).length,
      engine: rows.filter((row) => within(row.ratioEngine)).length,
      zero: rows.filter((row) => row.ratioFormula == null).length,
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
      this.descending.set(key !== 'name' && key !== 'ratioFormula' && key !== 'ratioEngine');
    }
  }

  protected arrow(key: PresenceSort): string {
    return this.sort() === key ? (this.descending() ? ' ↓' : ' ↑') : '';
  }

  protected signed(value: number | null): string {
    if (value == null) return '—';
    return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
  }

  /** A ratio as the operator reads it: 100% exact, 50% he played twice the expected, 200% half. */
  protected ratio(value: number | null): string {
    return value == null ? '—' : `${Math.round(value * 100)}%`;
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
