import { Routes } from '@angular/router';

/**
 * LE PAGINE DELL'APP, DERIVATE DALLE ROTTE E NON SCRITTE ACCANTO A LORO.
 *
 * Nasce da una richiesta dell'operatore (06/09/2026: «rendere l'header comune a tutte le pagine e
 * inserire un unico nav che mi permetta di navigare su ogni pagina») e cura un difetto che i template
 * dichiaravano da soli, sette volte, con lo stesso commento: «The only way into the charts view:
 * without it /charts is reachable by URL alone». Ogni vista teneva la sua manciata di collegamenti -
 * la pagina Calciatori ne aveva sette, le Buste uno, il pannello d'asta nessuno - quindi «si arriva
 * a ogni pagina?» era una proprieta' di NOVE template invece di una sola, e la risposta era no.
 *
 * IL NAV NON E' UN ELENCO PARALLELO ALLE ROTTE: e' le rotte. Ogni rotta dichiara il suo `nav` dentro
 * `data`, e questa e' l'unica lettura - quindi una pagina nuova non puo' finire raggiungibile per sola
 * URL senza che un test lo dica (`nav.spec.ts` pretende che ogni rotta tranne il jolly dichiari il
 * suo). E' la stessa forma di `export.CONTRACT` nel toolkit: la lista si DERIVA da chi la usa, non si
 * mantiene a mano accanto.
 */

/** Quello che una rotta dichiara di se stessa in `data.nav`. */
export interface NavDeclaration {
  /** Il nome breve: il tooltip dell'icona nel nav. Corto per regola dell'operatore (05/09/2026). */
  readonly label: string;
  /** Il titolo pieno, che l'header disegna come `<h1>`: puo' essere piu' lungo dell'etichetta. */
  readonly title: string;
  /** L'icona nel nav. Deve essere REGISTRATA in `nz-icons.ts`, o a schermo non compare niente. */
  readonly icon: string;
  /**
   * Una pagina di servizio, fuori dal giro di lavoro (oggi solo `/hello`, la pagina dei ponteggi).
   * Resta raggiungibile - la richiesta era «ogni pagina» - e sta dopo un separatore: nasconderla
   * sarebbe l'esclusione silenziosa che questo file esiste per impedire.
   */
  readonly aside?: boolean;
}

/** Una voce del nav: quello che la rotta dichiara, piu' il link che la raggiunge. */
export interface NavPage extends NavDeclaration {
  /** Sempre con lo slash davanti: `routerLink` su un path relativo dipenderebbe da chi lo disegna. */
  readonly link: string;
  readonly aside: boolean;
}

/**
 * Le pagine nell'ORDINE IN CUI LE ROTTE SONO DICHIARATE, che e' anche l'ordine di lettura del nav:
 * il listone, poi l'asta, poi il motore. Un secondo ordinamento qui vorrebbe dire che spostare una
 * rotta non sposta il nav, cioe' due elenchi di nuovo.
 */
export function navPages(config: Routes): NavPage[] {
  const pages: NavPage[] = [];
  for (const route of config) {
    const nav = declarationOf(route.data);
    if (!nav || route.path === undefined) continue;
    pages.push({
      ...nav,
      aside: nav.aside === true,
      link: `/${route.path}`.replace(/\/$/, '') || '/',
    });
  }
  return pages;
}

/**
 * La pagina che una URL sta mostrando, o `null` se nessuna la riconosce - il che e' un fatto e non uno
 * zero: l'header scrive il nome dell'app invece di inventare un titolo.
 */
export function pageAt(config: Routes, url: string): NavPage | null {
  const at = pathOf(url);
  return navPages(config).find((page) => pathOf(page.link) === at) ?? null;
}

/**
 * Le rotte che NON dichiarano un nav, per path. Il jolly `**` e' l'unica legittima (non e' una pagina,
 * e' un rimando); qualunque altra qui dentro e' una pagina che si raggiunge solo scrivendo l'indirizzo.
 * Esiste per il test, e il test e' la ragione per cui il difetto non torna.
 */
export function routesWithoutNav(config: Routes): string[] {
  return config
    .filter((route) => route.path !== undefined && !declarationOf(route.data))
    .map((route) => route.path as string);
}

/** `data.nav`, verificato invece che creduto: una rotta puo' portare `data` per qualunque altra cosa. */
function declarationOf(data: unknown): NavDeclaration | null {
  const nav = (data as { nav?: unknown } | undefined)?.nav as NavDeclaration | undefined;
  if (!nav || typeof nav.label !== 'string' || typeof nav.title !== 'string') return null;
  return typeof nav.icon === 'string' ? nav : null;
}

/** Il path nudo: senza query, senza frammento, senza slash ai bordi. `/` resta `''`. */
function pathOf(url: string): string {
  return url.split(/[?#]/)[0].replace(/^\/+|\/+$/g, '');
}
