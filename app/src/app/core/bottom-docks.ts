import { Injectable, Signal, WritableSignal, computed } from '@angular/core';

import { storedFlag } from './view-state';

/** I due angoli in basso, che sono anche le due chiavi su cui lo stato si ricorda. */
export type DockSide = 'left' | 'right';

/**
 * SE LE DUE BARRE IN BASSO SONO PIEGATE (sua richiesta, 23/09/2026: «facciamo anche che i menu' in
 * basso siano collassabili»).
 *
 * E' un servizio e non un campo del componente perche' una chiave deve avere UN solo scrittore: le due
 * scatole sono due istanze dello stesso componente, e due copie dello stato si accorgerebbero l'una
 * dell'altra solo al prossimo caricamento della pagina.
 *
 * In `localStorage` e non nell'indirizzo, che e' la regola di `view-state.ts`: piegare una barra e' come
 * si legge lo schermo, non cosa la pagina mostra. Per ANGOLO e non per pagina, perche' queste scatole
 * vivono fuori dall'outlet - una preferenza per vista farebbe aprire e chiudere la stessa barra
 * passando da una pagina all'altra. Aperte all'inizio: una barra che nasce piegata su una macchina
 * nuova e' una funzione che nessuno trova.
 */
@Injectable({ providedIn: 'root' })
export class BottomDocks {
  private readonly flags: Record<DockSide, WritableSignal<boolean>> = {
    left: storedFlag('dock:left', false),
    right: storedFlag('dock:right', false),
  };

  collapsed(side: DockSide): Signal<boolean> {
    return computed(() => this.flags[side]());
  }

  toggle(side: DockSide): void {
    this.flags[side].set(!this.flags[side]());
  }
}
