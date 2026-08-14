import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { AuctionAdvice } from '../../../core/auction-advice';
import { AuctionFeed, AuctionTeam, Zone } from '../../../core/auction-feed';
import { PitchLine } from '../../../core/club-eleven';
import { FantaMan, FantaPlace, fantaElevenOf } from '../../../core/fanta-eleven';
import { PlayerFlags } from '../../../ui/player-flags/player-flags';
import { RoleBadge } from '../../../ui/role-badge/role-badge';

/** What each drawn line is called, in the language of the pitch. */
const LINE_LABEL: Record<PitchLine, string> = {
  A: 'attacco',
  T: 'trequarti',
  M: 'centrocampo',
  D: 'difesa',
  P: 'porta',
};

/**
 * The classic macro-role of a man, from the zone the feed itself files him under.
 *
 * On classic the listone's own `roles` are not what legality is decided on - the rulebook rations MACRO-ROLES
 * and nothing finer - and the zone IS that macro-role, computed by the table for its own slot counting. So it
 * is read rather than re-derived, and a Mantra code is never bent into a classic one by analogy (the
 * operator's warning of 10/08/2026, and the reason the two rulebooks are two files).
 */
const CLASSIC_ROLE: Partial<Record<Zone, string>> = { gk: 'P', def: 'D', mid: 'C', atk: 'A' };

/**
 * A FANTA squad on a pitch: the strongest legal eleven the rulebook lets it field, with its ballottaggi.
 *
 * It is the mirror of `app-club-pitch` and answers the opposite question. That one draws a REAL club and reads
 * the board the toolkit drew, because predicting a coach is a measurement; this one draws a squad at this
 * table, where there is no coach to predict - only the rulebook, which is read (`mantra_modules.json` /
 * `classic_modules.json`) and the panel's own value, which is what the draft bench measured as this format's
 * currency.
 *
 * The module is CHOSEN here and not asked for: it is the one whose places let the strongest eleven on the
 * pitch, out of the legal shapes of the game being played. The card says which shapes came close, so an
 * automatic choice can still be doubted.
 */
@Component({
  selector: 'app-fanta-pitch',
  templateUrl: './fanta-pitch.html',
  imports: [
    DecimalPipe,
    FormsModule,
    NzEmptyModule,
    NzSelectModule,
    NzTagModule,
    NzTooltipModule,
    PlayerFlags,
    RoleBadge,
  ],
  host: { class: 'block' },
})
export class FantaPitch {
  protected readonly advice = inject(AuctionAdvice);
  protected readonly feed = inject(AuctionFeed);

  protected readonly label = LINE_LABEL;

  /** What the operator picked. Null = his own squad, which is the one he is playing. */
  private readonly chosen = signal<number | null>(null);

  protected readonly teams = computed(() => this.feed.teams());

  protected readonly team = computed<AuctionTeam | null>(() => {
    const teams = this.teams();
    const picked = this.chosen();
    return (
      teams.find((team) => team.id === picked)
      ?? teams.find((team) => team.id === this.feed.followedTeamId())
      ?? teams[0]
      ?? null
    );
  });

  choose(teamId: number | null): void {
    this.chosen.set(teamId);
  }

  /** True while the pitch is showing MY squad: the card says whose eleven it is drawing. */
  protected readonly isMine = computed(() => this.team()?.id === this.feed.followedTeamId());

  /** The squad as the rulebook sees it: roles to match on, and the numbers the panel prices them with. */
  private readonly squad = computed<FantaMan[]>(() => {
    const mantra = this.feed.isMantra();
    const values = this.advice.valueBy();
    const worth99 = this.advice.value99By();
    const numbers = this.advice.numbers();
    const men: FantaMan[] = [];
    for (const entry of this.team()?.squad ?? []) {
      const player = entry.player;
      if (!player) continue;
      const shown = mantra ? player.roles : [CLASSIC_ROLE[this.feed.zoneOf(player)] ?? ''].filter(Boolean);
      const row = numbers.get(player.id);
      men.push({
        id: player.id,
        name: player.name,
        club: player.club,
        shown,
        roles: shown.map((role) => role.toLowerCase()),
        value: values.get(player.id) ?? null,
        value99: worth99.get(player.id) ?? null,
        cost: entry.cost,
        minutesPerMatch:
          row?.minutesFullSeason != null && row.seasonMatches
            ? Math.round(row.minutesFullSeason / row.seasonMatches)
            : null,
      });
    }
    return men;
  });

  protected readonly eleven = computed(() => fantaElevenOf(this.squad(), this.advice.rules()));

  /** True when the bundle carries no rulebook for this game: then there is no legal shape to draw on. */
  protected readonly noRules = computed(() => this.advice.rules() === null);

  /** The runner-up shapes, with what they cost: an automatic choice has to be doubtable. */
  protected readonly runnersUp = computed(() => {
    const drawn = this.eleven();
    if (!drawn?.scores.length) return [];
    return drawn.scores.filter((score) => score.module !== drawn.module).slice(0, 3);
  });

  /** A place's tooltip: the man on it, or what the squad is missing to fill it. */
  protected placeHint(place: FantaPlace): string {
    if (place.man) return this.hint(place.man);
    return `Posto ${place.slot}: in rosa non c'è nessuno che possa occuparlo`;
  }

  /** A man's tooltip: what he is, what he is worth here, and what he cost. */
  protected hint(man: FantaMan): string {
    const bits = [man.name, man.club];
    if (man.shown.length) bits.push(`listone ${man.shown.join('/')}`);
    if (man.minutesPerMatch != null) bits.push(`${man.minutesPerMatch}′ medi a partita`);
    if (man.value != null) bits.push(`vale ${man.value.toFixed(1)} fantapunti`);
    if (man.value99 != null) bits.push(`valore ${man.value99}/99 su questo listone`);
    bits.push(`pagato ${man.cost}`);
    return bits.join(' · ');
  }

  protected rivalHint(man: FantaMan): string {
    return `Primo cambio per questo posto: ${this.hint(man)}`;
  }
}
