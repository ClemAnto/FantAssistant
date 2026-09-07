import { Component, computed, inject, input } from '@angular/core';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { PlayerRulings } from '../../core/player-rulings';

/**
 * IL PALLINO DI UNA PERSONALIZZAZIONE, dopo il nome (richiesta dell'operatore, 07/09/2026: «quando un
 * calciatore ha una personalizzazione attiva, aggiungi un piccolo pallino dopo il nome»).
 *
 * UN COMPONENTE e non un `@switch` copiato in cinque template, che e' la sua condizione del 05/09/2026:
 * un marchio significa la stessa cosa in ogni pagina, quindi il disegno sta in un posto solo. E si
 * legge da SE' la dichiarazione (`[playerId]`, come `ui-flags`): un fatto su una PERSONA non dipende
 * dal foglio che la pagina sta prezzando, quindi non deve passare per la riga - e cosi' aggiungerlo a
 * una lista e' una riga di template senza nessun ingresso da portare.
 *
 * QUANDO NON C'E' NIENTE NON DISEGNA NIENTE, nemmeno uno spazio: un pallino sempre presente e spento
 * sarebbe un marchio che non marca, e in una lista di duecentocinquanta righe si legge come rumore.
 */
@Component({
  selector: 'ui-ruling-dot',
  templateUrl: './ruling-dot.html',
  imports: [NzTooltipModule],
  host: { class: 'contents' },
})
export class RulingDot {
  private readonly rulings = inject(PlayerRulings);

  /** Chi: senza un `fc_id` non c'e' niente da leggere - «vuoto = ignoto», applicato a un marchio. */
  readonly playerId = input<number | null>(null);

  protected readonly ruling = computed(() => this.rulings.of(this.playerId()));

  /** Tre parole: chi l'ha detto e cosa. Il perche' sta nel codice, non in un tooltip. */
  protected readonly hint = computed(() => {
    const one = this.ruling();
    return one ? `tua indicazione: ${one.rung}` : '';
  });
}
