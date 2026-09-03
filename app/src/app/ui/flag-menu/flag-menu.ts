import { Component, computed, inject } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDropdownModule } from 'ng-zorro-antd/dropdown';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { FLAG_GROUPS, FlagPrefs } from '../../core/flag-prefs';
import { FLAG_LABEL, PlayerFlag } from '../../core/player-status';
import { FLAG_ICON, FLAG_TONE } from '../player-flags/player-flags';

/**
 * IL MENÙ DELLE ICONCINE: quali marchi si disegnano accanto ai nomi.
 *
 * Richiesto dall'operatore il 03/09/2026 insieme alle icone stesse, e la ragione è la plancia: 250
 * righe alte 17px, dove un'icona in più è un nome in meno leggibile. La preferenza non è di questa
 * pagina - vive in `FlagPrefs` e vale ovunque i marchi siano disegnati - quindi questo componente non
 * tiene stato: legge e scrive il servizio, e due schermi non possono finire per dire cose diverse.
 *
 * Ogni voce porta la SUA icona accanto alla frase, con l'inchiostro con cui verrà disegnata: si sceglie
 * riconoscendo il simbolo che si è visto sulla riga, non leggendo un elenco di parole.
 */
@Component({
  selector: 'ui-flag-menu',
  templateUrl: './flag-menu.html',
  imports: [NzButtonModule, NzDropdownModule, NzIconModule, NzTooltipModule],
  host: { class: 'inline-flex' },
})
export class FlagMenu {
  protected readonly prefs = inject(FlagPrefs);

  protected readonly groups = FLAG_GROUPS;
  protected readonly label = FLAG_LABEL;
  // Una sola definizione dell'icona e del suo inchiostro, letta da chi la disegna sulla riga e da qui:
  // due copie darebbero al menu' un simbolo e alla riga un altro per lo stesso fatto.
  protected readonly icon = FLAG_ICON;
  protected readonly tone = FLAG_TONE;

  /** Quante sono spente, per dirlo sul bottone: un menù che nasconde di nascondere è un menù bugiardo. */
  protected readonly off = computed(() => this.prefs.hiddenCount());

  protected shows(flag: PlayerFlag): boolean {
    return this.prefs.shows(flag);
  }

  protected toggle(flag: PlayerFlag, event: Event): void {
    // Il menù NON si chiude a ogni interruttore: si accendono e spengono a gruppi, e riaprirlo dodici
    // volte è esattamente il tipo di attrito che al tavolo fa smettere di usare una funzione.
    event.stopPropagation();
    event.preventDefault();
    this.prefs.toggle(flag);
  }
}
