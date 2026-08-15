import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { ClubsStore, SquadMan } from '../../core/clubs-store';
import {
  ANCHOR_HINT,
  RATING_HINT,
  RATING_KEYS,
  RATING_LABEL,
  RatingKey,
} from '../../core/player-ratings';
import { ClassicRole, Platform } from '../../core/players-store';
import { ClubCrest } from '../../ui/club-crest/club-crest';
import { PlayerFlags } from '../../ui/player-flags/player-flags';
import { RoleBadge } from '../../ui/role-badge/role-badge';
import { StarRating } from '../../ui/star-rating/star-rating';
import { APP_VERSION } from '../../version';
import { BoardPitch } from './board-pitch/board-pitch';

const ROLE_LABEL: Record<ClassicRole, string> = {
  P: 'Portiere',
  D: 'Difensore',
  C: 'Centrocampista',
  A: 'Attaccante',
};

/** The listone's own reading order, and the table's default one. */
const ROLE_ORDER: Record<string, number> = { P: 0, D: 1, C: 2, A: 3 };

/**
 * Le squadre: what each real club has, in today's snapshot.
 *
 * Two answers side by side and they come from two different places on purpose. The PITCH is the board the
 * toolkit drew - a prediction about a real coach, so it is a measurement and lives where measurements are
 * made and judged - and this app only reads it. The TABLE is the club's whole quoted squad with what each
 * man actually did last season: read from the bundle, nothing computed here.
 *
 * MV and FM are MEASURED, never predicted, and they are measured on the selected platform's calendar:
 * euro and Serie A are the same season seen from two different ones, so the header says which.
 */
@Component({
  selector: 'app-clubs',
  templateUrl: './clubs.html',
  imports: [
    BoardPitch,
    ClubCrest,
    DecimalPipe,
    FormsModule,
    NzAlertModule,
    NzButtonModule,
    NzIconModule,
    NzRadioModule,
    NzSpinModule,
    NzTableModule,
    NzTooltipModule,
    PlayerFlags,
    RoleBadge,
    RouterLink,
    StarRating,
  ],
  host: { class: 'view-host' },
})
export class Clubs {
  protected readonly store = inject(ClubsStore);
  protected readonly appVersion = APP_VERSION;
  protected readonly roleLabel = ROLE_LABEL;
  protected readonly ratingKeys = RATING_KEYS;
  protected readonly ratingLabel = RATING_LABEL;
  protected readonly ratingHint = RATING_HINT;
  protected readonly anchorHint = ANCHOR_HINT;

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /**
   * The selection lives in the URL, and the URL is the only place it lives.
   *
   * The click NAVIGATES and the store is set from the address, never the other way round: with two
   * sources of truth a refresh, a Back and a shared link would eventually disagree about what is on
   * screen. Same shape as the rule the rest of this project keeps - one definition, read by everybody.
   */
  private readonly params = toSignal(this.route.queryParamMap);

  constructor() {
    void this.store.load();
    effect(() => {
      const params = this.params();
      // The club list only exists once the bundle is in: applying `?club=` before that would find no
      // such club and fall back to the first one, which is exactly the wrong answer.
      if (!params || this.store.status() !== 'ready') return;
      const platform = params.get('platform');
      if (platform === 'euro' || platform === 'default') this.store.selectPlatform(platform);
      const club = params.get('club');
      if (!club) {
        // Nothing asked for: write down what is on screen, so the address always says what it shows.
        this.remember(this.store.club(), true);
        return;
      }
      const clubs = this.store.clubs();
      // A name this listone does not carry - a stale link, or the other platform's club: the page shows
      // the first one rather than an empty panel, and the address is corrected to match it.
      this.store.select(clubs.some((one) => one.name === club) ? club : (clubs[0]?.name ?? null));
      if (!clubs.some((one) => one.name === club)) this.remember(this.store.club(), true);
    });
  }

  /** A club chosen from the strip: it goes in the address, and the address drives the page. */
  protected choose(club: string): void {
    this.remember(club, false);
  }

  /** The other listone: the club goes with it, because the two lists barely overlap. */
  protected choosePlatform(platform: Platform): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { platform, club: null },
      queryParamsHandling: 'merge',
    });
  }

  private remember(club: string | null, replace: boolean): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { platform: this.store.platform(), club },
      queryParamsHandling: 'merge',
      // A correction is not a step the Back button should have to walk through; a click is.
      replaceUrl: replace,
    });
  }

  /** What the two measured columns are about: one season, one calendar, said once. */
  protected readonly measuredOn = computed(() => {
    const platform = this.store.platform() === 'euro' ? 'EuroLeghe' : 'Serie A';
    return `${this.store.inputSeason()} · calendario ${platform}`;
  });

  protected readonly selected = computed(() =>
    this.store.clubs().find((club) => club.name === this.store.club()) ?? null,
  );

  /** How the table sorts by role: the listone's order, never the alphabet. */
  protected readonly byRole = (left: SquadMan, right: SquadMan): number =>
    (ROLE_ORDER[left.role] ?? 9) - (ROLE_ORDER[right.role] ?? 9);

  protected readonly byName = (left: SquadMan, right: SquadMan): number =>
    left.name.localeCompare(right.name);

  /** A man with no measured season sorts last in both directions: he has no number, not a zero. */
  protected readonly byMv = (left: SquadMan, right: SquadMan): number =>
    (left.mv ?? -1) - (right.mv ?? -1);

  protected readonly byFm = (left: SquadMan, right: SquadMan): number =>
    (left.fm ?? -1) - (right.fm ?? -1);

  protected readonly byExpected = (left: SquadMan, right: SquadMan): number =>
    (left.expected ?? -1) - (right.expected ?? -1);

  /** What P is, said once in its header: a number of matches needs the calendar it is out of. */
  protected readonly expectedHeader = computed(() => {
    const sheet = this.store.boardSheet();
    const rounds = sheet?.matchdays_target;
    return 'Partite attese A VOTO: quante ne prevede il motore su questo calendario'
      + (rounds ? ` (${rounds} giornate)` : '')
      + (sheet ? `, dal foglio «${sheet.league}»` : '')
      + '. È il suo numero, non ricalcolato qui; «~» segna la stima per chi il motore non riesce a '
      + 'valutare, e vuoto vuol dire ignoto.';
  });

  protected readonly byExpectedFm = (left: SquadMan, right: SquadMan): number =>
    (left.expectedFm ?? -1) - (right.expectedFm ?? -1);

  protected readonly byExpectedMv = (left: SquadMan, right: SquadMan): number =>
    (left.expectedMv ?? -1) - (right.expectedMv ?? -1);

  /** The expected base vote, and the bonus rate that separates it from the expected fantamedia. */
  protected expectedMvHint(man: SquadMan): string {
    if (man.expectedMv == null) {
      return man.expectedFm == null
        ? 'Il foglio del motore non lo valuta: ignoto, mai zero.'
        : 'Il foglio non porta una MV attesa per lui: senza un ruolo il bonus a presenza non è '
          + 'ricavabile — va da −1.29 di un portiere a +0.74 di un attaccante, e tirarlo a indovinare '
          + 'sposterebbe la MV di più di un voto. (Oppure il bundle è più vecchio della revisione 18.)';
    }
    const bonus = man.expectedFm == null ? null : man.expectedFm - man.expectedMv;
    return `${man.expectedMv.toFixed(2)} di media voto attesa`
      + (bonus == null ? '' : ` · ${bonus >= 0 ? '+' : ''}${bonus.toFixed(2)} di bonus a presenza`)
      + (man.expectedFmIsEstimate ? ' · costruita sulla STIMA della fantamedia' : '');
  }

  /** What FM att. is: the engine's number, and the fallback it declares for who it cannot price. */
  protected readonly expectedFmHeader = computed(() => {
    const sheet = this.store.boardSheet();
    return 'Fantamedia ATTESA dal motore per la stagione che viene'
      + (sheet ? `, dal foglio «${sheet.league}»` : '')
      + '. Non è la FM misurata qui accanto: quella dice quanto ha fatto, questa quanto ci si aspetta, '
      + 'e per chi ha giocato in un altro campionato solo questa può esistere. «~» segna la STIMA '
      + 'dichiarata (est_fm) per chi il motore non riesce a valutare: il tooltip della riga dice su cosa '
      + 'è costruita.';
  });

  /** ...and on the row: the number, and - per una stima - la parola che il toolkit le ha scritto. */
  protected expectedFmHint(man: SquadMan): string {
    if (man.expectedFm == null) {
      return 'Il foglio del motore non lo valuta e non offre nemmeno una stima: ignoto, mai zero.';
    }
    if (!man.expectedFmIsEstimate) return `${man.expectedFm.toFixed(2)} di fantamedia attesa dal motore`;
    return `STIMA ${man.expectedFm.toFixed(2)}`
      + (man.estimateBasis ? ` · base «${man.estimateBasis}»` : '')
      + (man.estimateNote ? ` · ${man.estimateNote}` : '');
  }

  /** ...and on the row: the number, what it is out of, and whether it is the estimate. */
  protected expectedHint(man: SquadMan): string {
    if (man.expected == null) {
      return 'Il foglio del motore non lo prevede: nessuna partita attesa, che non vuol dire zero.';
    }
    const rounds = this.store.boardSheet()?.matchdays_target;
    return `${man.expected.toFixed(1)} partite a voto attese`
      + (rounds ? ` su ${rounds}` : '')
      + (man.expectedIsEstimate ? ' · è la STIMA (est_pv): il motore non riesce a valutarlo' : '');
  }

  /**
   * The star columns sort on the 0-99 behind them, never on the stars: half a star is a real gap.
   *
   * Built ONCE, not per call: a `[nzSortFn]` that returns a new closure on every read makes nz-th see a
   * changed input at every cycle, which re-sorts the table, which asks for another cycle - measured at
   * ~34 change-detection passes a second with nobody touching the page.
   */
  private readonly ratingSorters: Record<RatingKey, (left: SquadMan, right: SquadMan) => number> =
    Object.fromEntries(
      RATING_KEYS.map((key) => [
        key,
        (left: SquadMan, right: SquadMan) =>
          (left.rating?.[key].score ?? -1) - (right.rating?.[key].score ?? -1),
      ]),
    ) as Record<RatingKey, (left: SquadMan, right: SquadMan) => number>;

  protected byRating(key: RatingKey): (left: SquadMan, right: SquadMan) => number {
    return this.ratingSorters[key];
  }

  /** The real-role cell: when it was observed, and which of the codes the typical eleven would use. */
  protected codesHint(man: SquadMan): string {
    const bits: string[] = [];
    if (man.codesOn) bits.push(`osservato il ${man.codesOn.split('-').reverse().join('/')}`);
    bits.push(
      man.place
        ? `nella formazione tipo gioca da ${man.place}`
        : 'non è nella formazione tipo di questa squadra',
    );
    return bits.join(' · ');
  }

  /**
   * What the two measured cells are worth, and WHY one is empty - the three cases are different facts.
   *
   * No row at all: he played that season somewhere this listone does not count. A row with zero
   * appearances: he was quoted and never got a vote, so he has no average - which is not an average of
   * zero. Otherwise the number, with the appearances it rests on beside it.
   */
  protected measuredHint(man: SquadMan): string {
    if (man.pv === 0) {
      return `Nessuna presenza in ${this.measuredOn()}: non ha una media, che è cosa diversa da una `
        + 'media di zero.';
    }
    if (man.fm == null && man.mv == null) {
      return `Nessuna stagione misurata in ${this.measuredOn()}: può essere un arrivo da un altro `
        + 'campionato, un promosso o un esordiente. Vuoto = ignoto, mai zero.';
    }
    const played = man.pv != null ? `${man.pv} presenze` : 'presenze ignote';
    return `${this.measuredOn()} · ${played}`;
  }
}
