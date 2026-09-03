import { Component, computed, inject, input, model, signal } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { NzTooltipDirective } from 'ng-zorro-antd/tooltip';

import { GridCell, PairRow } from '../../../core/keeper-pairs';
import { shortNames } from '../../../core/clubs-store';
import { PlanciaStore } from '../../../core/plancia-store';

/** A cell as the template needs it: its two clubs, its numbers, and the tone it is painted in. */
export interface GridSquare {
  row: string;
  column: string;
  cell: GridCell;
  /** 0..1 inside THIS grid, so the shading is a ranking of what is on screen and not of an absolute. */
  weight: number;
  /** Which of the `BANDS` classes the cell's own VALUE falls in, by quantile. */
  band: number;
  diagonal: boolean;
}

/** Five classes: enough to rank at a glance, few enough that each one is a colour and not a shade. */
export const BANDS = 5;

/**
 * The five tints, as a share of `--color-success` mixed into the surface.
 *
 * The lowest class carries NO tint: on a grid this dense a floor of colour is what made everything
 * read as green. The steps are uneven on purpose - the eye separates the top of a scale worse than
 * the bottom, so the last two are further apart than the first two.
 */
export const BAND_MIX = [0, 16, 34, 58, 88];

/**
 * LA GRIGLIA: ogni club contro ogni altro, e quante giornate della competizione la coppia copre.
 *
 * Sulle COLONNE c'e' anche il portiere che quel club schiera, e non e' scelto qui: e' il primo della
 * linea P della board che il TOOLKIT disegna. «L'app legge la board e mai la propria» - un undici di un
 * club vero e' una previsione su una persona, quindi vive dove le previsioni si misurano, e sceglierlo
 * in un secondo modo darebbe a un club due portieri titolari. Un club la cui board non c'e' porta la
 * colonna senza nome, che e' «vuoto = ignoto» su un'intestazione.
 *
 * LA TINTA E' RELATIVA A QUESTA GRIGLIA, e va detto: la casella piu' scura e' la migliore fra quelle a
 * schermo, non «una buona copertura» in assoluto. Il numero resta scritto sopra, perche' una scala di
 * colore senza la cifra e' una figura che nessuno puo' controllare.
 *
 * ...E LA SCALA E' SUI QUANTILI E NON SUL VALORE, per una ragione misurata e non estetica (03/09/2026,
 * «ora sembra tutto verde e non risalta niente»). La distribuzione di questa griglia e' AMMASSATA IN
 * ALTO - su 190 caselle piu' di cento stanno fra il 68% e il 100% del massimo - quindi una scala
 * lineare le dipinge tutte fra il 48% e il 70% di verde: indistinguibili proprio dove si decide.
 * Cinque classi per quantile danno ~38 caselle ciascuna per costruzione, e i PARI cadono sempre nella
 * stessa classe (la classe si assegna al VALORE, col suo percentile medio, non alla cella) - o due
 * caselle che dicono 32 avrebbero due colori, che e' peggio di non colorare affatto.
 *
 * LA DIAGONALE E' VUOTA, per decisione dell'operatore (03/09/2026): ATA/ATA non e' una coppia, e una
 * casella col numero dentro si legge come se lo fosse. Quello che quella casella misurava - il club DA
 * SOLO, che e' il termine di paragone della sua riga - non si butta: e' un fatto su UN club e non su
 * una coppia, quindi va nell'intestazione della riga, che e' il posto dove i fatti su un club stanno.
 *
 * LE SIGLE SONO QUELLE DI `shortNames`, non tre lettere tagliate qui: quella funzione sa che il POOL fa
 * parte dell'etichetta e allunga la coda quando due club leggerebbero uguale. Venti colonne devono
 * stare in una modale, e un'etichetta che nomina due squadre e' peggio di una piu' lunga.
 */
@Component({
  selector: 'plancia-keeper-grid',
  templateUrl: './keeper-grid.html',
  imports: [NzIconModule, NzModalModule, NzPopoverModule, NzTooltipDirective],
})
export class KeeperGrid {
  private readonly store = inject(PlanciaStore);

  readonly open = model(false);
  /** The club the pairing modal is about: its row and column are marked, never re-sorted. */
  readonly highlight = input<string | null>(null);

  protected readonly window = computed(() => this.store.pairingWindow());
  protected readonly keeperOf = computed(() => this.store.keeperOfClub());

  private readonly grid = computed(() => this.store.keeperGrid());

  protected readonly clubs = computed(() => this.grid()?.clubs ?? []);

  /** Le sigle, calcolate sui club A SCHERMO: il pool fa parte dell'etichetta. */
  protected readonly short = computed(() => shortNames(this.clubs()));

  protected sigla(club: string): string {
    return this.short().get(club) ?? club.slice(0, 3);
  }

  /**
   * The squares, and the shading's own scale, from ONE pass.
   *
   * Both come out of the same walk on purpose: a `computed` that produced the rows and wrote the
   * maximum into a signal on the way out is the defect that cost this app a whole histogram - Angular
   * throws on the write and the template silently draws nothing.
   */
  protected readonly rows = computed<
    { club: string; alone: number; squares: GridSquare[] }[]
  >(() => {
    const grid = this.grid();
    if (!grid) return [];
    const values: number[] = [];
    for (let i = 0; i < grid.clubs.length; i += 1) {
      for (let j = i + 1; j < grid.clubs.length; j += 1) {
        const cell = grid.cells.get(grid.clubs[i])?.get(grid.clubs[j]);
        if (cell) values.push(cell.facili);
      }
    }
    const top = values.length ? Math.max(...values) : 0;
    // The class of every VALUE on screen, by its own mid-percentile: equal cells always share a class.
    const bands = new Map<number, number>();
    if (values.length) {
      const sorted = [...values].sort((left, right) => left - right);
      for (const value of new Set(sorted)) {
        const below = sorted.findIndex((one) => one === value);
        const count = sorted.filter((one) => one === value).length;
        const mid = (below + count / 2) / sorted.length;
        bands.set(value, Math.min(BANDS - 1, Math.floor(mid * BANDS)));
      }
    }
    return grid.clubs.map((club) => ({
      club,
      // The diagonal is no longer drawn, so the club-alone figure is read off it once and put on the
      // row's own header - the same object, not a second pass over the same question.
      alone: grid.cells.get(club)?.get(club)?.facili ?? 0,
      squares: grid.clubs.map((column) => {
        // The fallback is a whole GridCell and not a subset: a partial object here compiled once and
        // then the template read `aloneA` off nothing. It names its own two columns and adds nothing.
        const cell: GridCell = grid.cells.get(club)?.get(column) ?? {
          clubA: club, clubB: column, facili: 0, covered: null, rows: [],
          aloneA: 0, aloneB: 0, gain: 0,
        };
        return {
          row: club,
          column,
          cell,
          weight: top > 0 ? Math.min(1, cell.facili / top) : 0,
          band: bands.get(cell.facili) ?? 0,
          diagonal: club === column,
        };
      }),
    }));
  });

  /** The strongest pair on the board, so the scale has a stated top instead of an implied one. */
  protected readonly top = computed(() =>
    Math.max(
      0,
      ...this.rows().flatMap((row) =>
        row.squares.filter((s) => !s.diagonal).map((s) => s.cell.facili),
      ),
    ),
  );

  /** A token, never a literal: the tint is the success colour at the cell's own class. */
  protected tone(square: GridSquare): string {
    if (square.diagonal) return 'transparent';
    const share = BAND_MIX[Math.min(BAND_MIX.length - 1, Math.max(0, square.band))];
    return share === 0
      ? 'transparent'
      : `color-mix(in srgb, var(--color-success) ${share}%, transparent)`;
  }

  /** La legenda: le cinque tinte in fila, per dire che il colore e' una CLASSE e non una misura. */
  protected readonly legend = computed(() =>
    BAND_MIX.map((share, at) => ({
      at,
      background: share === 0
        ? 'transparent'
        : `color-mix(in srgb, var(--color-success) ${share}%, transparent)`,
    })),
  );

  /**
   * The cell the panel is about, which is what the ONE popover template draws.
   *
   * One template and not four hundred: a popover per cell would build four hundred views to show one.
   * It is a signal and not a plain field because the template reads it - a bare property written from
   * an event binding happens to work and stops working the day the read moves behind an `OnPush`
   * boundary.
   *
   * OPENED BY A CLICK AND NOT BY THE POINTER PASSING (his instruction, 03/09/2026): on a grid of four
   * hundred cells a hover panel opens on the way to somewhere else, and it covers the cells you were
   * reading.
   */
  protected readonly hovered = signal<GridSquare | null>(null);

  /**
   * The cell that was picked, and the diagonal is not one.
   *
   * WRITTEN ON `pointerdown` AND NOT ON `click`, deliberately: `nz-popover` opens on the click itself,
   * and two listeners on one element run in the order they were registered - so setting the signal in a
   * `(click)` is a race whose prize is the PREVIOUS cell's calendar. `pointerdown` always precedes the
   * click, which makes the order a fact instead of a hope. Same family as the two dropdowns that
   * fought over one template on 20/08.
   *
   * It refuses the diagonal HERE and not only in the trigger: leaving the signal on a diagonal square
   * would have the panel draw that club twice the next time it opens, which is the empty cell
   * answering a question it was told not to answer.
   */
  protected onCell(square: GridSquare): void {
    if (!square.diagonal) this.hovered.set(square);
  }

  protected label(row: PairRow, side: 'a' | 'b'): string {
    const match = row[side];
    if (!match) return '—';
    return `${match.home ? '' : '@ '}${match.opponent}`;
  }
}
