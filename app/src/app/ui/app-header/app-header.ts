import { NgTemplateOutlet } from '@angular/common';
import { booleanAttribute, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { navPages, pageAt } from '../../core/nav';
import { APP_VERSION } from '../../version';

/**
 * L'INTESTAZIONE, UNA SOLA PER TUTTE LE PAGINE, CON IL NAV DENTRO.
 *
 * Richiesta dell'operatore (06/09/2026): «rendere l'header comune a tutte le pagine e inserire un unico
 * nav che mi permetta di navigare su ogni pagina». Prima c'erano NOVE intestazioni che si somigliavano -
 * lo stesso `<h1>`, la stessa pastiglia della versione copiata otto volte - e ognuna teneva la sua
 * manciata di collegamenti: sette dalla pagina Calciatori, uno dalle Buste, ZERO dal pannello d'asta,
 * che quindi era una pagina da cui non si tornava. Sei template scrivevano da soli il difetto nel
 * commento («without it /charts is reachable by URL alone») invece di curarlo.
 *
 * IL NAV E' ICONE, E LE ICONE HANNO IL TOOLTIP: nove nomi per esteso sono ~590px, che su una pagina
 * che non scorre (plancia, strategia) e' una riga rubata alla cosa che si sta guardando - lo stesso
 * conto che al pannello Tk e' costato 105px di campetto. Nove icone sono ~230px, stanno in ogni barra,
 * e il tooltip corto sull'icona e' la convenzione dichiarata dell'operatore (05/09/2026). Il nome della
 * pagina non manca comunque: e' il `<h1>` accanto, e la voce attiva e' accesa.
 *
 * UNA SOLA DEFINIZIONE DI «SU CHE PAGINA SONO»: `pageAt(router.config, url)`, letta dal titolo E
 * dall'accensione della voce. Con `routerLinkActive` per l'accensione ce ne sarebbero due, e due
 * risposte a una domanda finiscono per non essere d'accordo (il path vuoto e' il caso in cui succede).
 *
 * QUELLO CHE LA PAGINA CI METTE DENTRO viaggia in due fessure, perche' sono due posti diversi dello
 * schermo: quella PREDEFINITA sta accanto al titolo (le pastiglie che dicono quale foglio, che tavolo,
 * che snapshot, e gli interruttori che devono restare a schermo) e `[actions]` va a destra, prima del
 * nav (i bottoni della pagina). Nessuna pagina passa il proprio titolo: quello lo dichiara la rotta,
 * quindi il nome nel nav e il nome in cima non possono dire due cose diverse.
 */
@Component({
  selector: 'ui-app-header',
  templateUrl: './app-header.html',
  imports: [NgTemplateOutlet, NzIconModule, NzTooltipModule, RouterLink],
  // `display: contents`: il `<header>` deve essere lui il figlio della colonna flex della pagina, o
  // `shrink-0` e i `gap` finirebbero su un involucro che nessuno ha chiesto.
  host: { class: 'contents' },
})
export class AppHeader {
  /**
   * La barra compatta delle pagine che NON scorrono: `h-[100dvh]` e' un budget, quindi la' il titolo
   * e' una riga di testo piccolo e non un titolo da pagina.
   */
  readonly dense = input(false, { transform: booleanAttribute });
  /**
   * Il riquadro (bordo e superficie): solo dove l'intestazione E' la barra del regolamento e deve
   * leggersi come un pannello sempre a schermo, cioe' la plancia.
   */
  readonly framed = input(false, { transform: booleanAttribute });

  private readonly router = inject(Router);
  /** La rotta di QUESTA pagina: l'header sta dentro la vista, quindi l'iniezione risale a lei. */
  private readonly route = inject(ActivatedRoute);

  protected readonly version = APP_VERSION;
  protected readonly pages = navPages(this.router.config);
  /** Le pagine del giro di lavoro e quelle di servizio: due gruppi, un separatore, un ordine solo. */
  protected readonly main = this.pages.filter((page) => !page.aside);
  protected readonly asides = this.pages.filter((page) => page.aside);

  /**
   * I segmenti della rotta attivata. Un segnale e non lo snapshot perche' il router puo' RIUSARE il
   * componente quando cambiano solo i parametri; lo snapshot e' il valore iniziale, che e' gia' quello
   * giusto al primo disegno.
   */
  private readonly segments = toSignal(this.route.url, { initialValue: this.route.snapshot.url });

  protected readonly page = computed(() =>
    pageAt(this.router.config, `/${this.segments().map((one) => one.path).join('/')}`),
  );

  protected readonly shell = computed(() =>
    [
      'flex shrink-0 flex-wrap gap-x-3',
      this.dense() ? 'items-center gap-y-1 text-xs' : 'items-baseline gap-y-2',
      this.framed() ? 'rounded-lg border border-border bg-surface px-3 py-1.5' : '',
    ]
      .join(' ')
      .trim(),
  );

  protected readonly heading = computed(() =>
    this.dense() ? 'text-sm font-semibold text-fg' : 'text-2xl font-semibold text-fg',
  );

  /** Acceso solo dove si e': un nav che non dice dove sei e' un elenco di collegamenti. */
  protected here(link: string): boolean {
    return this.page()?.link === link;
  }
}
