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
  /**
   * LA TAGLIA, e NON e' una seconda icona: il disegno e il significato restano quelli (sua condizione
   * del 05/09/2026, «le icone abbiano lo stesso significato in ogni pagina»), cambia quanto e' grande -
   * come per le pastiglie dei ruoli, che hanno tre taglie e un colore solo.
   *
   * `xs` e' la taglia della TABELLA delle ultime partite, dove il marchio sta ACCANTO al voto dentro una
   * cella larga 48px (operatore, 06/09/2026: «le icone dei gol e le altre mettile dopo il voto e non
   * sotto, riducile»); `sm` e' quella della card e del pannello, dove una riga e' larga quanto la card.
   */
  readonly size = input<'xs' | 'sm'>('sm');

  /** Il disegno di un pallone e di una scarpetta, e il corpo di un `nz-icon`: una taglia, tre lettori. */
  protected readonly glyph = computed(() => (this.size() === 'xs' ? 'h-2.5 w-2.5' : 'h-3 w-3'));
  protected readonly icon = computed(() => (this.size() === 'xs' ? 'text-[10px]' : 'text-[12px]'));
  /** Il cartellino: un rettangolino, che resta un rettangolino anche piu' piccolo. */
  protected readonly card = computed(() =>
    this.size() === 'xs' ? 'h-2 w-1.5' : 'h-2.5 w-1.5');
  protected readonly countSize = computed(() =>
    this.size() === 'xs' ? 'text-[8px]' : 'text-[9px]');

  /**
   * STAMPA IL CONTEGGIO ANCHE QUANDO E' UNO.
   *
   * Su una PARTITA «1» accanto a un pallone e' rumore - lo dice il template qui accanto - ma su una
   * STAGIONE e' un fatto: un gol in trenta partite e' esattamente il numero che si sta cercando, e un
   * pallone nudo si leggerebbe come «ha segnato», non come «uno». Due domande diverse sullo stesso
   * marchio, quindi un interruttore e non una seconda icona: le icone devono restare le stesse in
   * ogni pagina (sua condizione del 05/09/2026), ed e' l'unita' di misura che cambia.
   */
  readonly always = input(false);

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
