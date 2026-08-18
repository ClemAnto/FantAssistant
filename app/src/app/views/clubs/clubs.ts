import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { ClubsStore } from '../../core/clubs-store';
import { Platform, PlayersStore } from '../../core/players-store';
import { ClubBoard } from '../../ui/club-board/club-board';
import { ClubCrest } from '../../ui/club-crest/club-crest';
import { MatchesTable } from '../../ui/matches-table/matches-table';
import { SquadTable } from '../../ui/squad-table/squad-table';
import { bindQuery } from '../../core/view-state';
import { APP_VERSION } from '../../version';

/**
 * The two questions this page can answer about the same rosa.
 *
 * `values` is what each man is WORTH, `matches` what he DID in the last ten rounds - the consultation
 * view's own table, the same component fed by the same `PlayersStore.matchTable`, because «come nella
 * schermata calciatori» has to mean the same cells and not a second drawing of them.
 */
export type SquadMode = 'values' | 'matches';

/**
 * Le squadre: what each real club has, in today's snapshot.
 *
 * Two answers side by side and they come from two different places on purpose. The PITCH is the board the
 * toolkit drew - a prediction about a real coach, so it is a measurement and lives where measurements are
 * made and judged - and this app only reads it. The TABLE is the club's whole quoted squad with what each
 * man actually did last season and what the engine expects of him: it is the same `ui-squad-table` the
 * consultation view draws for the whole listone, reading the same `ValuationStore`, so a man cannot read
 * one way here and another there.
 */
@Component({
  selector: 'app-clubs',
  templateUrl: './clubs.html',
  imports: [
    ClubBoard,
    ClubCrest,
    FormsModule,
    MatchesTable,
    NzAlertModule,
    NzButtonModule,
    NzIconModule,
    NzRadioModule,
    NzSpinModule,
    NzTooltipModule,
    RouterLink,
    SquadTable,
  ],
  host: { class: 'view-host' },
})
export class Clubs {
  protected readonly store = inject(ClubsStore);
  /** The per-match layer, for the other reading of the same rosa. Loaded only when it is asked for. */
  protected readonly matches = inject(PlayersStore);
  protected readonly appVersion = APP_VERSION;

  /** Which of the two tables is on screen. The values one is what this page has always been. */
  protected readonly mode = signal<SquadMode>('values');

  /**
   * The last ten league rounds of the MEASURED season, for this rosa, in the table's own order.
   *
   * The query is written here rather than taken from the consultation view's filter bar: that bar is a
   * different screen's state, and a table that followed it would change under this club without anybody
   * touching this page. The season is the one the values table is about (`input_season`), so the two
   * modes describe the same football; the men are passed in the SAME order, so it is one list twice.
   */
  protected readonly matchTable = computed(() => {
    const club = this.store.club();
    const platform = this.store.platform();
    const season = this.store.inputSeason();
    if (!club || !season || this.matches.status() !== 'ready') {
      return { columns: [], lines: [] };
    }
    const last = this.matches.lastMatchdayOf(platform, season);
    return this.matches.matchTable(
      {
        platform,
        season,
        from: Math.max(1, last - 9),
        to: last,
        // League only: a rosa's ten rounds are ten rounds. With cups a column becomes a WEEK, which is
        // a different unit and a different question - it belongs where the filters for it live.
        withCups: false,
        withFriendlies: false,
        club,
      },
      this.store.squad(),
    );
  });

  constructor() {
    void this.store.load();

    /**
     * The selection lives in the URL, and the URL is the only place it lives.
     *
     * The click sets the store and the binder writes the address, never two writers for one field: with
     * two sources of truth a refresh, a Back and a shared link would eventually disagree about what is
     * on screen. Held until the bundle is in - applying `?club=Napoli` to a store with no clubs yet
     * would resolve to nothing and then be written back as an empty address.
     */
    bindQuery(
      [
        {
          param: 'platform',
          read: () => this.store.platform(),
          apply: (raw) => {
            const platform: Platform = raw === 'euro' ? 'euro' : 'default';
            if (platform !== this.store.platform()) this.store.selectPlatform(platform);
          },
        },
        {
          param: 'club',
          // A club is a CLICK, and the Back button should walk back through the ones looked at.
          push: true,
          read: () => this.store.club(),
          apply: (raw) => {
            const clubs = this.store.clubs();
            // A name this listone does not carry - a stale link, or the other platform's club: the page
            // shows the first one rather than an empty panel, and the address is corrected to match.
            const known = raw != null && clubs.some((one) => one.name === raw);
            this.store.select(known ? raw : (clubs[0]?.name ?? null));
          },
        },
        {
          param: 'vista',
          read: () => (this.mode() === 'values' ? null : this.mode()),
          apply: (raw) => this.show(raw === 'matches' ? 'matches' : 'values'),
        },
      ],
      computed(() => this.store.status() === 'ready'),
    );
  }

  /** A club chosen from the strip: the store holds it and the address follows. */
  protected choose(club: string): void {
    this.store.select(club);
  }

  /**
   * The other table, and its data is fetched only when it is asked for.
   *
   * The per-match layer is the heaviest thing the bundle carries (`match_ratings` plus the provider's
   * own rows): the page that opens by default does not owe it. `load()` is idempotent and shared with
   * the consultation view, so a session pays for it once whichever screen asks first.
   */
  protected show(mode: SquadMode): void {
    this.mode.set(mode);
    if (mode === 'matches') void this.matches.load();
  }

  /** The other listone: the store takes the club with it, because the two lists barely overlap. */
  protected choosePlatform(platform: Platform): void {
    this.store.selectPlatform(platform);
  }

  protected readonly selected = computed(() =>
    this.store.clubs().find((club) => club.name === this.store.club()) ?? null,
  );
}
