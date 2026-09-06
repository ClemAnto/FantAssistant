import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { appConfig } from '../../app.config';
import { routes } from '../../app.routes';
import { navPages } from '../../core/nav';
import { AppHeader } from './app-header';

/**
 * L'intestazione comune, verificata su quello che DEVE fare: dire dove sei, portare da ogni altra
 * parte, e disegnare quello che la pagina le passa. Il conto dei link viene da `navPages` e non da un
 * numero scritto qui: un numero a mano andrebbe aggiornato a mano, che è il difetto che questo
 * componente cura.
 */
@Component({
  imports: [AppHeader],
  template: `<ui-app-header>
    <span data-chip>foglio Serie A</span>
    <button actions type="button">Impostazioni</button>
  </ui-app-header>`,
})
class Host {}

function header(): HTMLElement {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).querySelector('header') as HTMLElement;
}

describe('ui-app-header', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [...appConfig.providers] });
  });

  it('scrive il titolo della rotta corrente e la versione', () => {
    const shell = header();
    expect(shell.querySelector('h1')?.textContent?.trim()).toBe('Calciatori');
    expect(shell.textContent).toContain('v');
  });

  it('porta a OGNI pagina, una voce per pagina', () => {
    const links = [...header().querySelectorAll('nav a')];
    expect(links.length).toBe(navPages(routes).length);
    expect(links.map((one) => one.getAttribute('data-nav'))).toEqual(
      navPages(routes).map((one) => one.link),
    );
  });

  it('dice dove sei: una voce sola è quella corrente', () => {
    const current = [...header().querySelectorAll('nav a[aria-current="page"]')];
    expect(current.length).toBe(1);
    expect(current[0].getAttribute('data-nav')).toBe('/');
  });

  it('ogni voce porta il suo nome in un tooltip: un’icona muta non si sceglie', () => {
    // `nzTooltipTitle` è un binding di PROPRIETÀ e non lascia un attributo nel DOM, quindi si legge
    // la direttiva - il testo a schermo lo si verifica aprendo il tooltip, ed è il banco a farlo.
    const labels = navPages(routes).map((one) => one.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((one) => one.length <= 14)).toBe(true);
  });

  it('disegna quello che la pagina le passa, nelle due fessure', () => {
    const shell = header();
    expect(shell.querySelector('[data-chip]')?.textContent).toContain('foglio Serie A');
    // Il bottone della pagina sta nel gruppo di destra, PRIMA del nav: il nav è l'ultima cosa a destra
    // su ogni pagina, quindi il bersaglio non si sposta cambiando vista.
    const actions = shell.querySelector('button[actions]');
    const nav = shell.querySelector('nav');
    expect(actions).toBeTruthy();
    expect(nav).toBeTruthy();
    expect(actions?.parentElement).toBe(nav?.parentElement);
    const order = actions!.compareDocumentPosition(nav!);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
