import { Injectable, TemplateRef, signal } from '@angular/core';

/**
 * I GESTI DI UNA PAGINA, disegnati nella scatola fissa in basso a sinistra.
 *
 * Nasce il 22/09/2026 dalla sua istruzione «ripulisci l'header con le cose fuori contesto»: «estrai»,
 * «azzera le rose» e il menu dei marchi sono gesti di PREPARAZIONE e non d'asta, quindi non stanno
 * nella barra che si guarda per quattro ore - e non si possono nemmeno cancellare, perché azzerare le
 * rose è come si comincia a segnare un'asta vera sul tavolo inventato.
 *
 * PERCHÉ UN REGISTRO E NON UNA SECONDA SCATOLA FISSA: `ui/global-options` lo dichiara di sé stesso -
 * «due riquadri fissi nello stesso angolo si coprono appena uno cresce» - e quella scatola cresce
 * davvero (la pastiglia dei club esclusi compare e sparisce), quindi uno scostamento scritto a mano
 * andrebbe storto il giorno in cui compare. Una scatola sola, e chi ci mette dentro qualcosa è la
 * pagina.
 *
 * PERCHÉ NON UNA PROIEZIONE: `ui-global-options` sta in `app.html`, fuori dall'outlet, quindi una
 * vista non lo contiene e non gli può proiettare niente. Il registro è la stessa idea attraverso un
 * segnale: la pagina dichiara un `ng-template`, la scatola lo disegna con `ngTemplateOutlet`.
 *
 * SI SPEGNE CON LA PAGINA. Una vista che non pulisce lascerebbe i propri tasti sotto la vista dopo -
 * cioè «azzera le rose» sulla pagina Calciatori, un gesto che là non vuol dire niente - quindi
 * `clear` prende il template di chi chiama e non azzera alla cieca: due pagine che si succedono
 * registrano in un ordine che non è quello in cui si distruggono, e un `set(null)` secco del primo
 * cancellerebbe i tasti del secondo.
 */
@Injectable({ providedIn: 'root' })
export class PageActions {
  private readonly current = signal<TemplateRef<unknown> | null>(null);

  /** Cosa la scatola fissa deve disegnare adesso, o `null` se la pagina non ha gesti suoi. */
  readonly template = this.current.asReadonly();

  set(template: TemplateRef<unknown> | null): void {
    this.current.set(template);
  }

  /** Toglie il proprio, e solo il proprio: vedi la nota sull'ordine di distruzione. */
  clear(template: TemplateRef<unknown> | null): void {
    if (this.current() === template) this.current.set(null);
  }
}
