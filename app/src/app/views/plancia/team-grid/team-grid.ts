import { Component, DestroyRef, computed, inject, input, output } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';

import { ROLES, Role } from '../../../core/plancia';
import { BoardTeam } from '../../../core/plancia-store';

/**
 * Quanto si aspetta per capire se un click e' solo un click: vedi `TeamGrid.press`.
 */
const DOUBLE_MS = 250;

/**
 * THE TEN PARTICIPANTS, as a column of cards beside the board.
 *
 * A column and not a strip along the bottom, because the board needs its height for 250 rows and this
 * needs to be read at every extraction: three states the card has to say without a word - RIVAL on this
 * lot (a free place in the role AND the credits to reach the band), not interested, out of it.
 *
 * The one that carries a number is the first: how many rosters still want that role is what decides the
 * second price (§23.1) and what the adopted timing rule reads (§24), and at a free extraction it changes
 * with every name drawn - so it has to be readable without counting by hand.
 *
 * «Out» is not painted red. It is an absence and not a danger, which is the house rule about colour; red
 * on this page means «this costs you points» and it is spent on one verdict only.
 */
@Component({
  selector: 'plancia-team-grid',
  templateUrl: './team-grid.html',
  imports: [NzIconModule],
  host: { class: 'block min-h-0' },
})
export class TeamGrid {
  constructor() {
    // Un timer che scatta su un componente distrutto emette su un output che non ascolta piu' nessuno:
    // innocuo qui, e si spegne comunque, perche' un timer non fermato e' il genere di cosa che diventa
    // un difetto il giorno che qualcuno gli mette dentro qualcos'altro.
    inject(DestroyRef).onDestroy(() => this.cancel());
  }

  readonly teams = input.required<BoardTeam[]>();
  /** The role of the lot on the table: the only one of the four numbers that lights up. */
  readonly role = input<Role | null>(null);

  /**
   * Whether a double click can assign the lot right now - a table of ours, with a name on it.
   *
   * It only decides what the tooltip PROMISES: the gesture is emitted anyway, because the store is the
   * one that knows why an award is impossible and says so on screen. A card that swallows a double
   * click in silence is indistinguishable from a broken one.
   */
  readonly assignable = input(false);

  /** «Il lotto va a questa rosa», by double click (operator, 04/09/2026). */
  readonly assign = output<number>();

  /** «Attiva quella squadra», by single click (operator, 04/09/2026): la plancia accende i suoi uomini. */
  readonly activate = output<number>();

  /**
   * UN CLICK ACCENDE LA LENTE, E UN DOPPIO CLICK NON LA TOCCA AFFATTO.
   *
   * La prima versione filtrava `MouseEvent.detail` - 1 per un click, 2 per il secondo di un doppio -
   * e IL BANCO L'HA BOCCIATA, che è la ragione per cui esiste: il guard fermava il secondo click, ma
   * il PRIMO di un doppio ha `detail` 1 come qualunque altro, quindi un doppio click su una card con
   * la lente accesa la spegneva prima di assegnare il lotto. Misurato: lente sulla card 2 prima del
   * gesto, nessuna dopo. *Un guard che ferma metà di un gesto lo rende metà rotto.*
   *
   * Quindi l'attivazione ASPETTA: se entro `DOUBLE_MS` arriva un doppio click, la si annulla e vince
   * l'assegnazione. Il ritardo sta sul gesto RARO (guardo cosa ha comprato una rosa) e non su quello
   * frequente (le assegno il lotto), che resta istantaneo - il contrario di quello che il commento
   * della prima versione sosteneva, perché pesava la latenza sul gesto sbagliato.
   *
   * 250 ms non è una misura nostra e non deve esserlo: il SECONDO click annulla, quindi il ritardo non
   * gareggia con la soglia del sistema (500 ms su Windows di default) - deve solo essere abbastanza
   * corto perché la lente si legga come istantanea.
   */
  private pending: ReturnType<typeof setTimeout> | null = null;

  protected press(team: BoardTeam, event: MouseEvent): void {
    // THE SECOND CLICK OF A DOUBLE CANCELS THE PENDING LENS, and it does not wait for a timer to run
    // out: the gap between the two clicks of a double can be up to the SYSTEM threshold (500 ms on
    // Windows by default), so any shorter delay lets the lens fire in the middle of the gesture -
    // exactly what this code exists to prevent. `detail` is 2 on the second click and that click
    // always arrives BEFORE `dblclick`, so cancelling here makes the threshold irrelevant and
    // `DOUBLE_MS` only has to be long enough to feel instant.
    if (event.detail > 1) return this.cancel();
    this.cancel();
    this.pending = setTimeout(() => {
      this.pending = null;
      this.activate.emit(team.id);
    }, DOUBLE_MS);
  }

  /** Il doppio click vince: annulla l'accensione che il suo primo click aveva messo in coda. */
  protected double(team: BoardTeam): void {
    this.cancel();
    this.assign.emit(team.id);
  }

  private cancel(): void {
    if (this.pending === null) return;
    clearTimeout(this.pending);
    this.pending = null;
  }

  protected readonly roles = ROLES;

  protected sigla(team: BoardTeam): string {
    const words = team.label.trim().split(/\s+/);
    const letters = words.length > 1 ? words.map((word) => word[0]).join('') : (words[0] ?? '');
    return letters.slice(0, 3).toUpperCase();
  }

  /**
   * L'INCHIOSTRO DELLA CARD, e la rosa ACCESA sta davanti a tutto.
   *
   * Perché è uno stato che l'operatore ha scelto lui, mentre gli altri tre sono fatti che la pagina
   * ha calcolato: uno stato scelto che si legge come uno stato calcolato è il modo in cui si perde di
   * vista che la plancia è smorzata *per una ragione*. E niente opacità sulla card accesa, anche se
   * fosse «out»: la card da cui si spegne la lente deve essere la più leggibile di tutte.
   */
  protected cardTone(team: BoardTeam): string {
    if (team.active) return 'border-primary bg-primary/25 ring-1 ring-primary/50';
    if (team.me) return 'border-primary bg-primary/15';
    if (team.rival) return 'border-primary/40 bg-control';
    if (team.out) return 'border-border opacity-40';
    return 'border-border opacity-70';
  }

  /** The lot's role lights up on the cards that can still take it, and nowhere else. */
  protected slotTone(team: BoardTeam, role: Role, missing: number): string {
    if (role === this.role() && missing > 0 && !team.out) return 'bg-success/20 text-success';
    return missing === 0 ? 'text-muted/50' : 'text-fg';
  }

  /** Il gesto non si vede, quindi va detto: due parole, e solo dove funziona davvero. */
  private readonly assignHint = computed(() =>
    this.assignable() ? ' Doppio click: il lotto va a questa rosa, al prezzo del lotto.' : '',
  );

  /**
   * LA CARD A PAROLE, e da oggi solo per chi non la vede.
   *
   * Era il tooltip, e l'operatore lo ha fatto togliere (04/09/2026) per la stessa ragione delle righe
   * della plancia il giorno prima: dieci card in colonna sono dieci pannelli che si aprono passando
   * sopra, e si aprono dove si sta guardando. La frase resta come `aria-label`, che non si disegna:
   * togliere un canale visivo non e' una ragione per togliere il fatto a chi non lo vede - e questa
   * card e' un controllo con due gesti e nessun testo che li annunci.
   *
   * Quello che il tooltip diceva e che la card mostra gia' (crediti, posti, chi rilancia) resta
   * comunque qui: un nome accessibile che dice meta' di quello che c'e' sullo schermo e' peggio di uno
   * che lo dice tutto.
   */
  protected describe(team: BoardTeam): string {
    const role = this.role();
    const hint =
      (team.active
        ? ' Click: spegne la lente.'
        : ' Click: accende i suoi acquisti sulla plancia.') + this.assignHint();
    const purse = `${team.credits} crediti · posti ${team.missing.join('·')} (P·D·C·A)`;
    if (team.me) return `La tua rosa — ${purse}.${hint}`;
    if (team.out) return `${team.label} non arriva alla banda — ${purse}.${hint}`;
    if (team.rival && role) {
      return `${team.label} è un rivale su questo lotto: ha ancora un posto in ${role} e i crediti per pagarlo — ${purse}.${hint}`;
    }
    if (role)
      return `${team.label} ha il reparto ${role} completo: non rilancia su questo lotto — ${purse}.${hint}`;
    return `${team.label} — ${purse}.${hint}`;
  }
}
