import { Component, computed, inject, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';

import { LEGHE, LeghePlatform } from '../../core/leghe-api';
import { LegheGame } from '../../core/leghe-rules';
import { RosterFile, RosterFileStore, guessPlatform, leagueOfFile, matchingRoster, parseRosterFile } from '../../core/roster-file';
import { ValuationStore } from '../../core/valuation-store';
import { WidgetFeed } from '../../core/widget-feed';

/** The select's value for «a new squad»: a key is never this string. */
const NEW = '__new__';

/**
 * «CARICA ROSA» (16/10/2026): the league's roster export instead of a login (`core/roster-file.ts`). The rosters
 * already loaded are listed - each one fantasquadra, the one on screen marked, each removable - and a new file is
 * read, then three declarations the file cannot make: which listone (guessed off the ids, changeable), which game,
 * and which of the squads is his. The secret is the widget's own: the same key shares the rosters between devices.
 */
@Component({
  selector: 'ui-roster-upload',
  templateUrl: './roster-upload.html',
  imports: [FormsModule, NzButtonModule, NzIconModule, NzInputModule, NzModalModule, NzRadioModule, NzSelectModule],
})
export class RosterUpload {
  protected readonly store = inject(RosterFileStore);
  private readonly valuation = inject(ValuationStore);
  protected readonly widget = inject(WidgetFeed);

  readonly open = model(false);

  protected readonly problem = signal<string | null>(null);

  /** The file being added, before he names his squad: nothing is stored until he does. */
  protected readonly draft = signal<RosterFile | null>(null);

  /**
   * WHICH STORED SQUAD THE FILE UPDATES - his choice, by id. `undefined` = not chosen, and then the default is the stored
   * squad of the same listone, league and name (`matchingRoster`); `null` = a new squad. A name only proposes: a squad
   * renamed in the league is picked here by hand and keeps its id.
   */
  private readonly chosenTarget = signal<string | null | undefined>(undefined);

  protected readonly target = computed<string | null>(() => {
    const chosen = this.chosenTarget();
    if (chosen !== undefined) return chosen;
    const draft = this.draft();
    return draft?.team ? (matchingRoster(this.store.rosters(), draft)?.key ?? null) : null;
  });

  /** The squads a file of this listone could update. */
  protected readonly targets = computed(() => {
    const draft = this.draft();
    return draft ? this.saved().filter((one) => this.store.rosters().find((r) => r.key === one.key)?.platform === draft.platform) : [];
  });

  protected readonly saved = computed(() =>
    this.store.rosters().map((one) => ({
      key: one.key,
      label: `${LEGHE[one.platform].label} · ${leagueOfFile(one.fileName)} · ${one.team}`,
      when: new Date(one.loadedAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }),
      game: one.game === 'mantra' ? 'Mantra' : 'Classic',
    })),
  );

  protected readonly syncText = computed(() => {
    const s = this.store.sync();
    switch (s.kind) {
      case 'off':
        return s.why ? `Solo su questo dispositivo: ${s.why}.` : '';
      case 'syncing':
        return 'Sincronizzo…';
      case 'done':
        return `Su ogni dispositivo · sincronizzate alle ${s.at.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
      case 'failed':
        return `Sincronizzazione non riuscita: ${s.why}`;
    }
  });

  /** How many men of each squad the chosen listone knows: a squad the listone cannot read says so. */
  protected readonly teams = computed(() => {
    const file = this.draft();
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
    const teams = parseRosterFile(await chosen.text());
    if (!teams.length) {
      this.problem.set('Il file non è un export delle rose (righe «squadra,id,crediti»).');
      return;
    }
    const platform = guessPlatform(teams, this.valuation.allRosters());
    // A newer export of a league already stored keeps the squad and the game he declared for it.
    const before = this.store.rosters().find((one) => one.platform === platform && leagueOfFile(one.fileName) === leagueOfFile(chosen.name));
    this.chosenTarget.set(undefined);
    this.draft.set({
      fileName: chosen.name,
      loadedAt: new Date().toISOString(),
      teams,
      team: before && teams.some((t) => t.name === before.team) ? before.team : null,
      platform,
      game: before?.game ?? (platform === 'euro' ? 'mantra' : 'classic'),
    });
  }

  protected setPlatform(platform: LeghePlatform): void {
    this.draft.update((d) => (d ? { ...d, platform } : d));
  }

  protected setGame(game: LegheGame): void {
    this.draft.update((d) => (d ? { ...d, game } : d));
  }

  protected setTarget(key: string): void {
    this.chosenTarget.set(key === NEW ? null : key);
  }

  protected readonly newSquad = NEW;

  protected setTeam(team: string): void {
    this.draft.update((d) => (d ? { ...d, team } : d));
  }

  protected add(): void {
    const draft = this.draft();
    if (!draft?.team) return;
    this.store.add(draft, this.target());
    this.draft.set(null);
    this.chosenTarget.set(undefined);
    this.open.set(false);
  }

  protected choose(key: string): void {
    this.store.choose(key);
    this.open.set(false);
  }
}
