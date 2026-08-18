import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzSelectModule } from 'ng-zorro-antd/select';

import { AuctionAdvice } from '../../../core/auction-advice';
import { AuctionFeed } from '../../../core/auction-feed';
import { OnTable } from '../../../core/club-eleven';
import { ValuationStore } from '../../../core/valuation-store';
import { ClubBoard } from '../../../ui/club-board/club-board';
import { ClubCrest } from '../../../ui/club-crest/club-crest';

/**
 * IL CAMPETTO DI UN CLUB VERO AL TAVOLO: il selettore della squadra, e il disegno che è di tutti.
 *
 * Dal 18/08/2026 questo componente non disegna più niente da sé: «il campetto di una squadra reale deve
 * essere sempre uguale sia nella schermata dell'asta che in quello delle squadre» (operatore), e prima
 * erano due template che si assomigliavano. Il disegno sta in `ui-club-board`; qui resta quello che solo
 * un'asta sa - QUALE club guardare, chi è già stato preso e quanto chiede il tavolo.
 *
 * L'undici lo disegna sempre il TOOLKIT (`modules/boards.py`, il pannello guidato senza finestra con le
 * decisioni per club dell'operatore applicate): nessuna delle due schermate ne calcola uno.
 */
@Component({
  selector: 'app-club-pitch',
  templateUrl: './club-pitch.html',
  imports: [ClubBoard, ClubCrest, FormsModule, NzSelectModule],
  host: { class: 'block' },
})
export class ClubPitch {
  protected readonly advice = inject(AuctionAdvice);
  protected readonly feed = inject(AuctionFeed);
  /**
   * La valutazione della tabella Giocatori, per l'OVERALL accanto ai nomi.
   *
   * Letta da lì e non ricalcolata: è la richiesta dell'operatore del 18/08/2026 («mostra il suo overall»)
   * e la regola di casa - un uomo che legge 85 fra i Calciatori deve leggere 85 sul campetto, o la stessa
   * app porterebbe due giudizi sulla stessa persona. `load()` è idempotente.
   */
  private readonly valuation = inject(ValuationStore);

  /** What the operator picked. Null = follow the recommended pick's club, which is where he is looking. */
  private readonly chosen = signal<string | null>(null);

  protected readonly clubs = computed(() => this.advice.realClubs());

  constructor() {
    void this.valuation.load();
  }

  /**
   * The club on the pitch: his choice, or the club of the man the panel is recommending.
   *
   * Following the recommendation by default is the useful behaviour at the table - «and that club, what else
   * does it have» is the question a suggestion provokes - and it stops being followed the moment he chooses.
   */
  protected readonly club = computed(() => {
    const picked = this.chosen();
    if (picked && this.clubs().includes(picked)) return picked;
    const suggested = this.advice.planned()?.mine?.club;
    if (suggested && this.clubs().includes(suggested)) return suggested;
    return this.clubs()[0] ?? null;
  });

  choose(club: string | null): void {
    this.chosen.set(club);
  }

  protected readonly board = computed(() => this.advice.boardOf(this.club()));

  /** True when the sheet in use carries no boards at all: then there is nothing honest to draw. */
  protected readonly noBoards = computed(() => this.advice.boards() === null);

  /**
   * QUELLO CHE SOLO IL TAVOLO SA: chi è già stato preso, cosa chiede, chi non è in questo listone.
   *
   * Un uomo che la board disegna e la sessione non porta NON è «libero»: non si può comprare affatto, e
   * dire «preso» sarebbe un'altra affermazione. Il campetto lo disegna tratteggiato.
   */
  protected readonly table = computed<ReadonlyMap<number, OnTable>>(() => {
    const worth = this.advice.value99By();
    const share = this.advice.expectedShareBy();
    const rows = new Map<number, OnTable>();
    for (const row of this.advice.listone()) {
      rows.set(row.player.id, {
        taken: row.taken,
        price: row.player.fvm,
        onTable: true,
        value99: worth.get(row.player.id) ?? null,
        expectedShare: share.get(row.player.id) ?? null,
      });
    }
    return rows;
  });

  /** La quota di calendario del motore, per il marchio del disaccordo fra board e motore. */
  protected readonly shares = computed(() => this.advice.expectedShareBy());

  /**
   * L'OVERALL 0-99 degli uomini di QUESTO club, dal listone del bundle.
   *
   * Si valutano soltanto i suoi - il rango però è sul listone intero, che è come `valuations` è fatta -
   * così la carta non paga il conto di mille uomini per disegnarne undici.
   */
  protected readonly overall = computed<ReadonlyMap<number, number | null>>(() => {
    const club = this.club();
    const platform = this.advice.entry()?.platform ?? null;
    const out = new Map<number, number | null>();
    if (!club || !platform) return out;
    const rows = (this.valuation.rosters().get(platform) ?? []).filter((one) => one.club === club);
    for (const man of this.valuation.valuations(platform, rows)) {
      out.set(man.fcId, man.rating?.overall.score ?? null);
    }
    return out;
  });

  /** How many men of this club are in the session listone, and how many are gone. */
  protected readonly counted = computed(() => {
    const club = this.club();
    const rows = this.advice.listone().filter((row) => row.player.club === club);
    return { total: rows.length, taken: rows.filter((row) => row.taken).length };
  });
}
