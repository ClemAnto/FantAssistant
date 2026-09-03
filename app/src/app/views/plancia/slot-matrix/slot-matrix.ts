import { DecimalPipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { Alternative, ROLES, Role } from '../../../core/plancia';
import { BoardBlock, BoardMan } from '../../../core/plancia-store';

const ROLE_TONE: Record<Role, string> = {
  P: 'bg-role-keeper',
  D: 'bg-role-defence',
  C: 'bg-role-midfield',
  A: 'bg-role-attack',
};

/** The state of a row. Four states, and the ink alone has to separate them at 17px. */
const ROW_TONE: Record<BoardMan['state'], string> = {
  asta: 'bg-success/20 text-fg font-semibold',
  mio: 'bg-primary/15 text-fg',
  altro: 'text-muted/60',
  urna: 'text-fg hover:bg-control',
};

/** The widest line has eight blocks, so eight is the grid every line is cut on. */
const COLUMNS = 8;

/**
 * THE BOARD, whole: four lines of role, one block per place in the roster, TEN NAMES IN EVERY BLOCK.
 *
 * Nothing is collapsed and nothing opens: at the fourth hour the question «who is left in this slot»
 * has to be answered by looking, not by clicking. 25 blocks x 10 men is 250 rows and they fit, because
 * a row carries exactly two things - the name and ONE number.
 *
 * That number is the MAX OFFER while he is in the urn and the PRICE PAID once somebody has him. Two
 * meanings in one column is a thing this project normally refuses; here the row says which by its own
 * ink and by the owner's colour on its left edge, and the legend says it in words - so the column is
 * readable rather than ambiguous. Dropping the price paid would cost the more useful half: what the
 * room actually paid for this slot is the only live reading of the market there is.
 *
 * EVERY BLOCK IS THE SAME WIDTH, the keepers' three included: a slot is a rank divided by the number of
 * squads, so a block is one unit of the market whatever role it belongs to, and drawing the keepers
 * wider would say they are worth more of the screen than a defender. The room left over on the short
 * lines carries the CODA and the legend instead of stretching the blocks.
 */
@Component({
  selector: 'plancia-slot-matrix',
  templateUrl: './slot-matrix.html',
  imports: [DecimalPipe, NzTooltipModule],
  host: { class: 'block min-h-0' },
})
export class SlotMatrix {
  readonly blocks = input.required<BoardBlock[]>();
  readonly lotBlockId = input<string | null>(null);
  readonly tail = input(0);
  /** The pair from the slot below, by man: what you would buy instead of him, at the same currency. */
  readonly pairs = input<Map<number, Alternative | null>>(new Map());
  /**
   * My own purse, drawn in the room the attack line leaves over.
   *
   * It is here and not only in the strip because at a FREE extraction it is the constraint one loses
   * track of: any role can come up at any moment, so «how much can I still spend per place I have to
   * fill» is the number that decides whether the next bid is affordable at all. The spare columns are
   * the price of drawing every block the same width; filling them with a real figure is cheaper than
   * leaving a hole and cheaper than stretching the blocks.
   */
  readonly myCredits = input(0);
  readonly myMissing = input<number[]>([]);

  protected readonly myPlaces = computed(() =>
    this.myMissing().reduce((total, left) => total + left, 0),
  );
  protected readonly perPlace = computed(() => {
    const places = this.myPlaces();
    return places > 0 ? Math.floor(this.myCredits() / places) : null;
  });

  /** Naming a lot is a two-click job and this is the first click: press a name, it goes on the table. */
  readonly pick = output<BoardMan>();

  protected readonly roles = ROLES;
  protected readonly roleTone = ROLE_TONE;

  protected readonly byRole = computed(() => {
    const out = new Map<Role, BoardBlock[]>();
    for (const role of ROLES) out.set(role, []);
    for (const block of this.blocks()) out.get(block.role)?.push(block);
    return out;
  });

  /** How many grid columns are left over on a line: they carry the coda and the legend. */
  protected spare(role: Role): number {
    return Math.max(0, COLUMNS - (this.byRole().get(role)?.length ?? 0));
  }

  protected blockTone(block: BoardBlock): string {
    const lot = block.id === this.lotBlockId();
    return [
      lot ? 'border-primary ring-1 ring-primary/40' : 'border-border',
      block.left === 0 ? 'opacity-50' : '',
    ].join(' ');
  }

  protected blockTip(block: BoardBlock): string {
    if (block.left === 0) {
      return `${block.id} esaurito: nessuno più nell'urna — è ciò che alza la max offerta di chi sta sopra.`;
    }
    return (
      `${block.left} ancora nell'urna su ${block.id} · mediana pagata ` +
      `${Math.round(block.medianFvm)} cr${block.mine ? ' · uno è tuo' : ''}`
    );
  }

  protected rowTone(man: BoardMan): string {
    return ROW_TONE[man.state];
  }

  /**
   * What the hover says, and for a man in the urn it is the PAIR: the two of the slot below you would
   * buy instead of him, each at his own max offer and with the total. It is what makes a bid doubtable,
   * and it is on every row and not only on the lot because that is the count nobody holds in his head.
   */
  protected rowTip(man: BoardMan): string {
    if (man.state === 'altro') return `${man.name} — di ${man.ownerLabel}, pagato ${man.price} cr.`;
    if (man.state === 'mio') return `${man.name} — è tuo, pagato ${man.price} cr.`;

    const head =
      `${man.name} (${man.club}) · FVM ${Math.round(man.fvm)} · max offerta ${man.price ?? '—'} cr` +
      (man.state === 'asta' ? ' · IN ASTA ADESSO' : '');
    const pair = this.pairs().get(man.id);
    if (!pair) return `${head}\nNessuna alternativa: sotto di lui la profondità è finita.`;
    const detail = pair.men
      .map((entry, at) => `${entry.name} ${Math.round(pair.costs[at] ?? 0)}`)
      // A pair is bought TOGETHER and a keeper's two alternatives are one OR the other: the joiner says
      // which, and only the first of the two has a total that means anything.
      .join(pair.together ? ' + ' : ' oppure ');
    const total = pair.total === null ? '' : ` = ${Math.round(pair.total)} cr`;
    return `${head}\nInvece di lui, ${pair.note}: ${detail}${total}`;
  }
}
