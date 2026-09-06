import { describe, expect, it } from 'vitest';

import { routes } from '../app.routes';
import { NZ_ICONS } from '../nz-icons';
import { navPages, pageAt, routesWithoutNav } from './nav';

/**
 * IL NAV DEVE ARRIVARE A OGNI PAGINA, e questo è il test che lo impedisce di smettere.
 *
 * Il difetto che il nav cura era scritto nei template, sette volte, dentro un commento: «The only way
 * into the charts view: without it /charts is reachable by URL alone». Una lista di collegamenti scritta
 * a mano lo riporta alla prima pagina nuova; una lista DERIVATA dalle rotte no, purché qualcuno pretenda
 * che ogni rotta dichiari la sua voce. Quel qualcuno è questo file.
 */
describe('core/nav', () => {
  it('ogni rotta dichiara la sua voce, e il jolly è l’unica che non è una pagina', () => {
    expect(routesWithoutNav(routes)).toEqual(['**']);
  });

  it('il nav copre tutte le pagine, una volta ciascuna, con un link assoluto', () => {
    const pages = navPages(routes);
    const links = pages.map((one) => one.link);
    expect(links).toEqual([
      '/',
      '/clubs',
      '/charts',
      '/strategy',
      '/plancia',
      '/auction',
      '/sealed-bid',
      '/why',
      '/hello',
    ]);
    expect(new Set(links).size).toBe(links.length);
    expect(links.every((one) => one.startsWith('/'))).toBe(true);
  });

  it('ogni voce porta un nome corto, un titolo e un’icona REGISTRATA', () => {
    // Un'icona non registrata non è un errore a schermo: `nz-icon` la va a cercare per rete, la
    // richiesta muore in 404 e la casella resta vuota - un nav mezzo invisibile, che nessun conteggio
    // di link vedrebbe.
    const registered = new Set(NZ_ICONS.map((one) => one.name));
    for (const page of navPages(routes)) {
      expect(page.label.length, page.link).toBeGreaterThan(0);
      expect(page.title.length, page.link).toBeGreaterThan(0);
      expect(registered.has(page.icon), `${page.link} chiede l'icona ${page.icon}`).toBe(true);
    }
  });

  it('una sola pagina sta fuori dal giro di lavoro, e resta raggiungibile', () => {
    const aside = navPages(routes).filter((one) => one.aside);
    expect(aside.map((one) => one.link)).toEqual(['/hello']);
  });

  it('riconosce la pagina di una URL, query e frammento compresi', () => {
    expect(pageAt(routes, '/')?.title).toBe('Calciatori');
    expect(pageAt(routes, '/clubs')?.title).toBe('Squadre');
    expect(pageAt(routes, '/why#top')?.title).toBe('Perché quel surplus');
    expect(pageAt(routes, '/strategy?role=D')?.label).toBe('Strategia');
    // Il titolo pieno può essere più lungo dell'etichetta, e sono due usi diversi: uno è un `<h1>`,
    // l'altro è il tooltip di un'icona.
    expect(pageAt(routes, '/why')?.label).toBe('Perché');
  });

  it('una URL che nessuna rotta riconosce non inventa una pagina', () => {
    // «vuoto = ignoto»: l'header scrive il nome dell'app, non il titolo della prima pagina che passa.
    expect(pageAt(routes, '/qualcosa-che-non-esiste')).toBeNull();
  });
});
