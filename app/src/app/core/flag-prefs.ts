import { Injectable, computed } from '@angular/core';

import { FLAG_LABEL, PlayerFlag } from './player-status';
import { storedList } from './view-state';

/**
 * QUALI ICONCINE SI DISEGNANO, e la scelta segue l'operatore da una vista all'altra.
 *
 * Richiesta dell'operatore (03/09/2026): «nell'interfaccia mettimi anche un menù dove poter
 * attivare/disattivare le iconcine». È una preferenza su COME si legge, non su cosa la pagina mostra,
 * quindi vive in `localStorage` e non nell'indirizzo - la regola che `view-state.ts` scrive di sé - e
 * vale ovunque i marchi siano disegnati, perché il servizio è letto da `ui-flags`, che è l'unico
 * componente che li disegna. Due preferenze per una vocabolario solo finirebbero per far dire a due
 * schermi due cose diverse sullo stesso uomo.
 *
 * Si tiene la lista di chi è SPENTO e non di chi è acceso, ed è una scelta con una conseguenza: un
 * marchio NUOVO nasce acceso. Al contrario, una preferenza salvata mesi fa spegnerebbe in silenzio una
 * segnalazione che non esisteva quando è stata scritta, che è la stessa famiglia di «vuoto = ignoto».
 */
@Injectable({ providedIn: 'root' })
export class FlagPrefs {
  /** Gli spenti, come stanno sul disco. Un valore di un'altra versione viene scartato, non creduto. */
  private readonly hidden = storedList<PlayerFlag>('flags:hidden', isFlag);

  private readonly hiddenSet = computed(() => new Set(this.hidden()));

  /** Se questo marchio si disegna. Chiamato per ogni icona di ogni riga: è un Set, non una scansione. */
  shows(flag: PlayerFlag): boolean {
    return !this.hiddenSet().has(flag);
  }

  /** Quanti ne sono spenti: il numero che il menù mostra sulla sua etichetta senza doverlo aprire. */
  readonly hiddenCount = computed(() => this.hiddenSet().size);

  toggle(flag: PlayerFlag): void {
    const off = new Set(this.hiddenSet());
    if (!off.delete(flag)) off.add(flag);
    this.hidden.set([...off]);
  }

  /** Tutte accese: la via del ritorno, che un menù di interruttori deve avere in un click. */
  showAll(): void {
    this.hidden.set([]);
  }

  /** Tutte spente - la plancia nuda, che è il motivo per cui questo menù è stato chiesto. */
  hideAll(): void {
    this.hidden.set([...FLAG_GROUPS.flatMap((group) => group.flags)]);
  }
}

/**
 * Il menù, nell'ordine in cui si legge, e i gruppi sono quelli che i marchi hanno già:
 * `player-status.marksFor` li mette in fila così - prima quello che uno È, poi quello che FA, poi le
 * letture - quindi l'elenco non inventa un ordine suo, lo dichiara.
 */
export const FLAG_GROUPS: readonly { title: string; flags: readonly PlayerFlag[] }[] = [
  {
    title: 'Stato',
    flags: [
      'unavailable_press',
      'long_injury',
      'back_from_long',
      'fragile',
      'mystery',
      'dispute',
      'intl_cup',
    ],
  },
  {
    title: 'Abitudini',
    flags: [
      'yellows',
      'reds',
      'own_goals',
      'penalty_risk',
      'penalty_saved',
      'set_pieces',
      'clean_sheets',
    ],
  },
  {
    title: 'Letture',
    flags: [
      'promise',
      'flop_risk',
      'place_gained',
      'place_lost',
      'rotation_risk',
      'rotation_early',
      'starter_signs',
    ],
  },
];

/** Un marchio scritto sul disco è tale solo se il vocabolario di OGGI lo conosce. */
function isFlag(one: unknown): one is PlayerFlag {
  return typeof one === 'string' && one in FLAG_LABEL;
}
