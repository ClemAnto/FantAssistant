import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { BonusRow } from '../../core/match-bonuses';

/**
 * IL MARCHIO DI UN BONUS: un'icona sola, e la STESSA in ogni pagina.
 *
 * Richiesta dell'operatore (05/09/2026), che ha dettato anche il vocabolario: pallone per il gol (verde
 * fatto, rosso autogol), scarpetta per l'assist, bersaglio per il rigore (verde segnato, rosso
 * sbagliato), rettangolino giallo per l'ammonizione e rosso per l'espulsione, una x in un cerchietto
 * per il gol subito e un check in un cerchietto per il rigore parato. E la sua condizione: «assicurati
 * che le icone abbiano lo stesso significato in ogni pagina della piattaforma» - che e' la ragione per
 * cui questo e' un componente e non un `@switch` scritto dentro la riga compatta.
 *
 * SI SCEGLIE SUL `kind` E MAI SULL'ETICHETTA: due pagine che leggessero il testo finirebbero per
 * dipingere due cose diverse il giorno in cui una delle due frasi cambia parola.
 *
 * IL PALLONE E LA SCARPETTA SONO SVG SCRITTI QUI perche' il set di antd non li ha, e l'alternativa
 * sarebbe un'emoji - che questo progetto non usa come icona (app/CLAUDE.md). Tutto il resto e' un
 * `nz-icon` registrato in `nz-icons.ts`. Il colore viene dal token e non da un letterale, e il verde e
 * il rosso qui dicono un VERSO - bonus o malus - che e' l'uso del colore che questa app concede.
 */
@Component({
  selector: 'ui-bonus',
  templateUrl: './bonus-mark.html',
  imports: [NgTemplateOutlet, NzIconModule, NzTooltipModule],
  host: { class: 'inline-flex' },
})
export class BonusMark {
  readonly bonus = input.required<BonusRow>();

  /** L'inchiostro: il VERSO dell'evento, che la riga dichiara e non si deduce dal segno dei punti. */
  protected readonly ink = computed(() => (this.bonus().good ? 'text-success' : 'text-danger'));

  /**
   * La frase, e sta in POCHE PAROLE: il nome dell'evento e quanto vale (operatore, 05/09/2026 - «i
   * tooltip devono essere SEMPRE brevi e sintetici»). Senza il file dei punteggi il valore non c'e' e
   * non si stampa: l'evento resta un fatto.
   */
  protected readonly hint = computed(() => {
    const row = this.bonus();
    const many = row.count > 1 ? `${row.count} ` : '';
    const points = row.points == null ? '' : ` ${row.points > 0 ? '+' : ''}${row.points}`;
    return `${many}${row.label.toLowerCase()}${points}`;
  });
}
