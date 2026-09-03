import { Component, computed, inject, input, model, signal } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzPopoverModule } from 'ng-zorro-antd/popover';

import { GridCell, PairRow } from '../../../core/keeper-pairs';
import { PlanciaStore } from '../../../core/plancia-store';

/** A cell as the template needs it: its two clubs, its numbers, and the tone it is painted in. */
export interface GridSquare {
  row: string;
  column: string;
  cell: GridCell;
  /** 0..1 inside THIS grid, so the shading is a ranking of what is on screen and not of an absolute. */
  weight: number;
  diagonal: boolean;
}

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
 * LA DIAGONALE E' IL CLUB DA SOLO, non accoppiato con se stesso: e' il termine di paragone della sua
 * riga - quanto guadagni davvero mettendogli accanto qualcun altro - e sommare due volte le stesse
 * partite direbbe che un club si copre da se'.
 */
@Component({
  selector: 'plancia-keeper-grid',
  templateUrl: './keeper-grid.html',
  imports: [NzIconModule, NzModalModule, NzPopoverModule],
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

  /**
   * The squares, and the shading's own scale, from ONE pass.
   *
   * Both come out of the same walk on purpose: a `computed` that produced the rows and wrote the
   * maximum into a signal on the way out is the defect that cost this app a whole histogram - Angular
   * throws on the write and the template silently draws nothing.
   */
  protected readonly rows = computed<{ club: string; squares: GridSquare[] }[]>(() => {
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
    return grid.clubs.map((club) => ({
      club,
      squares: grid.clubs.map((column) => {
        const cell = grid.cells.get(club)?.get(column) ?? { facili: 0, covered: null, rows: [] };
        return {
          row: club,
          column,
          cell,
          weight: top > 0 ? Math.min(1, cell.facili / top) : 0,
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

  /** A token, never a literal: the tint is the success colour thinned by the cell's own weight. */
  protected tone(square: GridSquare): string {
    if (square.diagonal) return 'var(--color-control)';
    const share = Math.round(square.weight * 70);
    return `color-mix(in srgb, var(--color-success) ${share}%, transparent)`;
  }

  /**
   * The cell the pointer is over, which is what the ONE popover template draws.
   *
   * One template and not four hundred: a popover per cell would build four hundred views to show one.
   * It is a signal and not a plain field because the template reads it - a bare property written from
   * an event binding happens to work and stops working the day the read moves behind an `OnPush`
   * boundary.
   */
  protected readonly hovered = signal<GridSquare | null>(null);

  protected label(row: PairRow, side: 'a' | 'b'): string {
    const match = row[side];
    if (!match) return '—';
    return `${match.home ? '' : '@ '}${match.opponent}`;
  }
}
