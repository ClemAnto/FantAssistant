import { Component, computed, inject, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';

import { LeghePlatform } from '../../core/leghe-api';
import { LegheGame } from '../../core/leghe-rules';
import { RosterFileStore, guessPlatform, parseRosterFile } from '../../core/roster-file';
import { ValuationStore } from '../../core/valuation-store';

/**
 * «CARICA ROSA» (16/10/2026): the league's roster export instead of a login (`core/roster-file.ts`). One file,
 * then three declarations the file cannot make - which listone (guessed off the ids, changeable), which game, and
 * which of the squads is his.
 */
@Component({
  selector: 'ui-roster-upload',
  templateUrl: './roster-upload.html',
  imports: [FormsModule, NzButtonModule, NzIconModule, NzModalModule, NzRadioModule, NzSelectModule],
})
export class RosterUpload {
  protected readonly store = inject(RosterFileStore);
  private readonly valuation = inject(ValuationStore);

  readonly open = model(false);

  protected readonly problem = signal<string | null>(null);

  protected readonly file = this.store.file;

  /** How many men of each squad the chosen listone knows: a squad the listone cannot read says so. */
  protected readonly teams = computed(() => {
    const file = this.file();
    if (!file) return [];
    const rows = this.valuation.allRosters().get(file.platform === 'euro' ? 'euro' : 'default') ?? [];
    const known = new Set(rows.map((r) => r.fcId));
    return file.teams.map((t) => ({ name: t.name, men: t.ids.length, known: t.ids.filter((id) => known.has(id)).length }));
  });

  protected async pick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const chosen = input.files?.[0];
    input.value = '';
    if (!chosen) return;
    this.problem.set(null);
    const csv = await chosen.text();
    const teams = parseRosterFile(csv);
    if (!teams.length) {
      this.problem.set('Il file non è un export delle rose (righe «squadra,id,crediti»).');
      return;
    }
    const platform = guessPlatform(teams, this.valuation.allRosters());
    this.store.load(chosen.name, csv, platform, this.file()?.game ?? (platform === 'euro' ? 'mantra' : 'classic'));
  }

  protected setPlatform(platform: LeghePlatform): void {
    this.store.update({ platform });
  }

  protected setGame(game: LegheGame): void {
    this.store.update({ game });
  }

  protected setTeam(team: string): void {
    this.store.update({ team });
  }
}
