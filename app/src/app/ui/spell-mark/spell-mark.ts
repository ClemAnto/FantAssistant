import { Component, computed, input } from '@angular/core';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { MatchSpell } from '../../core/match-bonuses';

/**
 * I DUE TRIANGOLINI DI UNA PARTITA: verde in su chi e' SUBENTRATO, rosso in giu' chi e' USCITO.
 *
 * Parole dell'operatore (10/09/2026, sulle celle della tabella delle ultime partite): «un piccolo
 * triangolino verde verso l'alto se il giocatore e' subentrato e un piccolo triangolino verso il basso
 * se e' uscito (entrambi se e' entrato e uscito)». Il colore dice un VERSO e non un giudizio - entrare
 * non e' un merito e uscire non e' una colpa - che e' l'uso del colore che questa app concede.
 *
 * UN COMPONENTE E NON DUE `nz-icon` SCRITTI IN OGNI TEMPLATE, perche' e' la condizione che l'operatore
 * ha posto sul vocabolario dei marchi (05/09/2026): «assicurati che le icone abbiano lo stesso
 * significato in ogni pagina della piattaforma». Lo stesso fatto era gia' disegnato nella riga compatta
 * della card, con una FRECCIA: due glifi per un fatto solo sono esattamente cio' che `ui/bonus-mark`
 * esiste per impedire, quindi la card e' passata al triangolo insieme alla tabella - la parola nuova e'
 * sua, e vale per tutte e due.
 *
 * E I DUE SEGNI SONO DUE FATTI INDIPENDENTI, non un'etichetta a scelta multipla: se accendessero
 * entrambi si disegnerebbero entrambi. Oggi non capita mai, e non e' una scelta di disegno: chi
 * subentra non ha un MINUTO D'INGRESSO in questi dati, quindi «e' poi uscito?» non ha risposta e la
 * seconda freccia resta spenta - «vuoto = ignoto, mai zero» applicato a un triangolino. Quanto pesa,
 * misurato sul bundle del 10/09/2026 (120.945 righe del livello per-partita, tre stagioni): 25.103
 * subentrati per cui l'uscita e' inosservabile, contro 26.881 uscite osservate e 37.380 novanta minuti
 * pieni. La condizione per accenderla e' un'ACQUISIZIONE (le sostituzioni stanno negli `incidents`
 * della fonte, che oggi scarichiamo solo per le amichevoli coi gol da attribuire), non una formula.
 */
@Component({
  selector: 'ui-spell',
  templateUrl: './spell-mark.html',
  imports: [NzTooltipModule],
  host: { class: 'inline-flex items-center gap-px leading-none' },
})
export class SpellMark {
  readonly spell = input.required<MatchSpell>();
  /** `xs` e' la taglia della CELLA (48px da compatti), `sm` quella della card e del tooltip. */
  readonly size = input<'xs' | 'sm'>('xs');
  /** La frase sul segno. Spenta dove il marchio sta gia' dentro un altro tooltip: due tooltip
   *  sovrapposti sono il difetto delle buste chiuse. */
  readonly hint = input(true);

  /**
   * Sei pixel nella cella e otto nella card (operatore, 10/09/2026: «i triangolini falli un po' piu'
   * piccoli»). Un triangolo pieno regge la riduzione dove una freccia diventerebbe un trattino, che e'
   * anche la ragione per cui e' disegnato qui invece di essere un `nz-icon`.
   */
  protected readonly glyph = computed(() => (this.size() === 'xs' ? 'h-1.5 w-1.5' : 'h-2 w-2'));
}
