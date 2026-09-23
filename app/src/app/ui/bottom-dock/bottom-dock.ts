import { Component, computed, inject, input } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { BottomDocks, DockSide } from '../../core/bottom-docks';

/**
 * LE DUE SCATOLE IN BASSO, e adesso si piegano (sua richiesta, 23/09/2026: «facciamo in modo che i
 * menu' in basso siano position fixed e non occupino spazio nella pagina ... facciamo anche che i menu'
 * in basso siano collassabili»).
 *
 * Una sola definizione per tutte e due, perche' erano due copie della stessa cornice - stesso `fixed`,
 * stesso fondo, stesso bordo, stessa ombra, stesso `z` - e due modi di piegarsi sarebbero stati due
 * gesti da imparare. Quello che le distingue e' l'ANGOLO, che e' un input, e il contenuto.
 *
 * LA REGOLA DEL COLLASSO: **si nascondono i CONTROLLI, mai gli ALLARMI.** Quello che sopravvive va
 * nello slot `always` e si disegna in tutt'e due gli stati; tutto il resto e' nel contenuto normale e
 * sparisce. Non e' una preferenza di forma: questa app ha due fatti che esistono APPOSTA per non
 * lasciarsi dimenticare - la pastiglia rossa che dice «allarmi spenti» (uno schermo senza allarmi si
 * legge come «non c'e' nessuno fuori», che e' la bugia piu' cara che questa app possa dire) e il
 * viaggio nel tempo attivo (un'app che mostra agosto credendosi a settembre e non lo dice) - e un
 * collasso che li spegnesse sarebbe il difetto che quei due riquadri sono stati scritti per impedire.
 *
 * E IL BOTTONE RESTA SEMPRE, perche' un controllo che sparisce e' un controllo irraggiungibile: da
 * piegata la scatola e' quella freccia piu' cio' che l'allarme porta con se'.
 */
@Component({
  selector: 'ui-bottom-dock',
  templateUrl: './bottom-dock.html',
  imports: [NzIconModule, NzTooltipModule],
})
export class BottomDock {
  private readonly docks = inject(BottomDocks);

  readonly side = input.required<DockSide>();
  /** Cosa la scatola porta, per la frase del bottone: «Apri le opzioni», «Riduci il viaggio nel tempo». */
  readonly label = input.required<string>();
  /**
   * Il bordo ambra, che le due scatole usavano gia' per dire «qui c'e' qualcosa di attivo» (squadre
   * escluse, viaggio in corso). Resta acceso anche da piegata, per la stessa ragione dello slot
   * `always`: e' un fatto invisibile per costruzione.
   */
  readonly flagged = input(false);

  protected readonly collapsed = computed(() => this.docks.collapsed(this.side())());

  protected toggle(): void {
    this.docks.toggle(this.side());
  }

  /**
   * Il verso della freccia dice cosa FA il click e non dove sta la scatola: piegata si apre verso
   * l'alto, aperta si chiude verso il basso.
   */
  protected readonly icon = computed(() => (this.collapsed() ? 'up' : 'down'));

  protected readonly hint = computed(() =>
    this.collapsed() ? `Apri ${this.label()}` : `Riduci ${this.label()}`,
  );
}
