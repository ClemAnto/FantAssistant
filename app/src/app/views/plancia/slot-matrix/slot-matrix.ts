import { DecimalPipe } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { PlayerFlags } from '../../../ui/player-flags/player-flags';
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
  // I MIEI: un grigio un po' piu' chiaro (sua richiesta, 03/09/2026). Erano nel primario, che e' il
  // colore con cui questa pagina segna quello su cui si sta DECIDENDO - e un uomo che ho gia' preso
  // non e' una decisione, e' un fatto. Il grigio li tiene visibili in cima al blocco senza chiamare
  // l'occhio dove non c'e' niente da fare.
  mio: 'bg-control/70 text-fg',
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
  imports: [DecimalPipe, NzTooltipModule, PlayerFlags],
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

  /**
   * ...except on a KEEPER, where the click asks with whom to pair him and puts nothing on the table.
   *
   * Two gestures and not one with two effects, the operator's instruction of 03/09/2026. The reason it
   * is the keeper's own row and not a second control: a squad fields ONE keeper, so «which of the ten»
   * is the only question that row ever asks, while for a man of movement the question is the lot.
   */
  // L'evento del portiere non c'e' piu': un click emette `pick` per tutti e gli abbinamenti sono un
  // bottone della card. Un output che nessuno emette e' un contratto che mente a chi lo legge.

  /** Un click, un evento, per ogni ruolo: chi lo ascolta apre la card. */
  protected press(man: BoardMan): void {
    this.pick.emit(man);
  }

  /**
   * NESSUNA RIGA È SPENTA, da quando il click apre una CARD (04/09/2026).
   *
   * Prima lo era per chi ha un padrone e non è portiere: non si poteva nominare come lotto, e non
   * c'era altro da fare su di lui. Ma la card si chiede anche di un uomo già venduto - a che prezzo è
   * andato, quanto rendeva, chi ce l'ha - e i due gesti che dipendono dallo stato sono ora BOTTONI
   * dentro la card, che appaiono quando hanno senso. *Disabilitare una riga per un'azione che non è
   * più quella del click è una riga spenta per un motivo che non c'è più.*
   */
  protected inert(_man: BoardMan): boolean {
    return false;
  }

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
    // CHI OGGI NON GIOCA si vede prima di leggere il nome: barrato e in rosso, sopra ogni altro stato.
    // È l'unico posto in cui questa tabella usa il rosso, ed è l'uso che la regola dei colori consente -
    // stai per offrire su un uomo che sabato non c'è.
    if (man.outNow) return 'text-danger line-through decoration-danger/60 hover:bg-control';
    return ROW_TONE[man.state];
  }

  /**
   * What the hover says, and for a man in the urn it is the PAIR: the two of the slot below you would
   * buy instead of him, each at his own max offer and with the total. It is what makes a bid doubtable,
   * and it is on every row and not only on the lot because that is the count nobody holds in his head.
   */
  /**
   * L'UOMO SOTTO IL PUNTATORE, e i due che comprerei invece di lui.
   *
   * Sostituisce il tooltip di riga («è fastidioso», 03/09/2026): la coppia alternativa non si
   * RISCRIVE in un riquadro, si ACCENDE dove i due uomini stanno gia' - una riga della mappa e' il
   * posto dove quel nome vive, e un pannello che copre le righe vicine nasconde proprio il confronto
   * per cui esiste.
   *
   * Su `mouseenter` e non su `pointerenter`, e la ragione e' una misura: con i pointer events il
   * banco leggeva ZERO righe accese dopo un hover vero (`Input.dispatchMouseEvent` e' quello che
   * genera un puntatore reale qui, ed e' anche quello che il vecchio tooltip usava). Un gesto che il
   * banco non riesce a far scattare e' un gesto che non si puo' verificare, e quindi non si spedisce:
   * su un touch un hover non esiste comunque.
   */
  private readonly hovered = signal<number | null>(null);

  /** Gli id dei due uomini alternativi all'uomo in hover: un insieme, non una lista da riscorrere. */
  private readonly insteadOf = computed<Set<number>>(() => {
    const at = this.hovered();
    if (at == null) return new Set();
    const pair = this.pairs().get(at);
    return new Set((pair?.men ?? []).map((one) => one.id));
  });

  protected hover(man: BoardMan | null): void {
    this.hovered.set(man?.id ?? null);
  }

  /**
   * La tinta dell'alternativa: rosso leggerissimo, su token e mai un colore letterale.
   *
   * Il 10% e non di piu' perche' la riga porta un nome e due numeri che devono restare leggibili: la
   * tinta e' un richiamo, non qualcosa da leggere al posto del testo.
   */
  protected readonly INSTEAD_TINT = 'color-mix(in srgb, var(--color-danger) 10%, transparent)';

  /** Vero se questa riga e' uno dei due che comprerei invece dell'uomo sotto il puntatore. */
  protected instead(man: BoardMan): boolean {
    return this.insteadOf().has(man.id);
  }

  protected rowTip(man: BoardMan): string {
    if (man.state === 'altro') return `${man.name} — di ${man.ownerLabel}, pagato ${man.price} cr.`;
    if (man.state === 'mio') return `${man.name} — è tuo, pagato ${man.price} cr.`;
    // LA RAGIONE PER CUI È IN FONDO STA IN CIMA: un vincolo che agisce in silenzio è indistinguibile da
    // un ordinamento rotto, e il prezzo resta sotto perché la decisione è comunque dell'operatore.
    const out = man.outNow
      ? `${man.name} — OGGI NON GIOCA. È in fondo al suo slot per questo, non perché valga meno.\n`
      : '';
    return out + this.priceTip(man);
  }

  /** Il prezzo, e la coppia che compreresti al suo posto. */
  private priceTip(man: BoardMan): string {
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
