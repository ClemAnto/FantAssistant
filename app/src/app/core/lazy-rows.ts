import { DestroyRef, ElementRef, Signal, computed, effect, inject, signal } from '@angular/core';

/**
 * LE RIGHE SI CARICANO SCORRENDO, e la paginazione va via (operatore, 17/08/2026).
 *
 * Perché non la paginazione. Un listone è mille uomini e la pagina da trenta chiedeva 34 click per
 * guardarli: a un tavolo d'asta si scorre, non si sfoglia. E perché non lo scroll virtuale di ng-zorro:
 * vuole un'altezza di riga FISSA, mentre qui una riga cresce coi badge dei ruoli e con le icone - una
 * misura sbagliata là non «sposta un po'», salta righe.
 *
 * Quello che fa: mostra le prime `LAZY_FIRST` righe e ne aggiunge `LAZY_STEP` quando lo scorrimento arriva
 * vicino al fondo. Due cose che questo progetto ha già pagato e che qui sono requisiti:
 *
 *   * IL CONTEGGIO NON DEVE MENTIRE. Chi mostra 40 righe di 1.028 deve dirlo, o è «una lista mostrata i cui
 *     numeri descrivono un'altra lista» - il difetto che la paginazione nascosta di nz-table aveva già
 *     prodotto (26 uomini nel titolo, dieci sullo schermo).
 *   * LA FINESTRA SI RIAZZERA quando la lista cambia. Filtrare per ruolo e restare al quattrocentesimo
 *     rigo di prima mostrerebbe righe nuove sotto una posizione vecchia.
 *
 * Il contenitore che scorre è quello che nz-table crea da sé (`.ant-table-body`, esiste perché il pannello
 * passa `nzScroll`): si prende dal DOM invece di inventare un secondo scroller, che porterebbe due barre.
 */

/** Quante righe al primo colpo: abbastanza da riempire due schermate, così il primo scroll non è vuoto. */
export const LAZY_FIRST = 60;

/** Quante se ne aggiungono per volta. */
export const LAZY_STEP = 60;

/** A quanti pixel dal fondo si chiede il pezzo successivo: prima che l'utente veda la fine. */
export const LAZY_MARGIN = 500;

export interface LazyWindow<T> {
  /** Le righe da disegnare: le prime `shown` della lista. */
  rows: Signal<T[]>;
  /** Quante se ne vedono e quante sono in tutto, per la riga che lo dice a schermo. */
  shown: Signal<number>;
  total: Signal<number>;
  /** True quando non c'è più niente da caricare. */
  complete: Signal<boolean>;
}

/**
 * Aggancia una finestra pigra a una lista e al contenitore che scorre.
 *
 * Da chiamare nel costruttore di un componente: usa `inject` per l'host e per il ciclo di vita, quindi
 * vive e muore col componente che la usa.
 */
export function lazyRows<T>(all: Signal<readonly T[]>, selector = '.ant-table-body'): LazyWindow<T> {
  const host: ElementRef<HTMLElement> = inject(ElementRef);
  const destroy = inject(DestroyRef);
  const shown = signal(LAZY_FIRST);

  // La lista è cambiata (un filtro, un altro listone, un ordinamento): si riparte dall'alto, o si
  // mostrerebbero righe nuove sotto una posizione vecchia.
  effect(() => {
    all();
    shown.set(LAZY_FIRST);
  });

  /* CHI SCORRE. Dal 17/08/2026 (sera) la tabella non ha piu' un'altezza fissa - «non ci deve essere il
   * doppio scroll» - quindi lo scroller e' la PAGINA e non `.ant-table-body`. Si prova prima il contenitore
   * interno, che esiste ancora su altre viste, e si ricade sul documento: un lazy load agganciato a un
   * elemento che non scorre non e' lento, e' morto, e a schermo si vede come una lista che finisce a 60. */
  let attached: HTMLElement | null = null;
  const nearBottom = (): boolean => {
    if (attached) {
      return attached.scrollTop + attached.clientHeight >= attached.scrollHeight - LAZY_MARGIN;
    }
    const doc = document.documentElement;
    return window.scrollY + window.innerHeight >= doc.scrollHeight - LAZY_MARGIN;
  };
  const onScroll = (): void => {
    if (nearBottom()) shown.update((one) => Math.min(one + LAZY_STEP, all().length));
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  /* Il contenitore lo crea nz-table, quindi non c'è al primo giro: si riprova finché non c'è, e si smette
   * quando il componente muore. Un `setInterval` che sopravvive al componente è il modo classico di
   * tenere in vita una lista che nessuno guarda più. */
  const timer = setInterval(() => {
    const found = host.nativeElement.querySelector<HTMLElement>(selector);
    // Solo se scorre DAVVERO in verticale: `.ant-table-body` esiste anche quando scorre di lato, e
    // agganciarsi a un contenitore che non scorre in verticale spegne il caricamento in silenzio.
    if (!found || found === attached || found.scrollHeight <= found.clientHeight + 1) return;
    attached?.removeEventListener('scroll', onScroll);
    found.addEventListener('scroll', onScroll, { passive: true });
    attached = found;
    onScroll();
  }, 250);
  destroy.onDestroy(() => {
    clearInterval(timer);
    window.removeEventListener('scroll', onScroll);
    attached?.removeEventListener('scroll', onScroll);
  });

  return {
    rows: computed(() => all().slice(0, shown()) as T[]),
    shown: computed(() => Math.min(shown(), all().length)),
    total: computed(() => all().length),
    complete: computed(() => shown() >= all().length),
  };
}
