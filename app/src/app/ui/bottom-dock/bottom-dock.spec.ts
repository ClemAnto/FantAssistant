import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { appConfig } from '../../app.config';
import { BottomDocks } from '../../core/bottom-docks';
import { BottomDock } from './bottom-dock';

/**
 * LA REGOLA DEL COLLASSO, inchiodata: si nascondono i CONTROLLI, mai gli ALLARMI.
 *
 * E' la sola parte di questa scatola che un lettore futuro potrebbe togliere credendo di semplificare -
 * «tutto dentro l'`@if`, che e' piu' pulito» - e costerebbe le due frasi che questa app dice apposta per
 * non lasciarsi dimenticare: la pastiglia che dichiara gli allarmi spenti e la data in cui l'app crede
 * di trovarsi. Il resto (che colore ha il bordo, dove sta la freccia) e' disegno e non si asserisce.
 */
@Component({
  imports: [BottomDock],
  template: `
    <ui-bottom-dock side="left" label="le opzioni">
      <span always>ALLARME</span>
      <button>CONTROLLO</button>
    </ui-bottom-dock>
    <ui-bottom-dock side="right" label="il viaggio">
      <span always>DESTRA</span>
    </ui-bottom-dock>
  `,
})
class Host {}

function docks() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return fixture;
}

const textOf = (fixture: ReturnType<typeof docks>, side: string) =>
  (fixture.nativeElement as HTMLElement).querySelector(`[data-dock="${side}"]`)?.textContent ?? '';

const toggleOf = (fixture: ReturnType<typeof docks>, side: string) =>
  (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
    `[data-dock="${side}"] button[aria-expanded]`,
  );

describe('ui-bottom-dock', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [...appConfig.providers] });
  });

  it('nasce aperta: una barra che nasce piegata e\' una funzione che nessuno trova', () => {
    const fixture = docks();
    expect(textOf(fixture, 'left')).toContain('CONTROLLO');
    expect(toggleOf(fixture, 'left')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('piegata toglie i CONTROLLI e tiene quello che sta in `always`', () => {
    const fixture = docks();
    TestBed.inject(BottomDocks).toggle('left');
    fixture.detectChanges();
    expect(textOf(fixture, 'left')).toContain('ALLARME');
    expect(textOf(fixture, 'left')).not.toContain('CONTROLLO');
  });

  it('...e il bottone per riaprirla resta, o il controllo sarebbe irraggiungibile', () => {
    const fixture = docks();
    const toggle = toggleOf(fixture, 'left');
    toggle?.click();
    fixture.detectChanges();
    const after = toggleOf(fixture, 'left');
    expect(after).not.toBeNull();
    expect(after?.getAttribute('aria-expanded')).toBe('false');
    after?.click();
    fixture.detectChanges();
    expect(textOf(fixture, 'left')).toContain('CONTROLLO');
  });

  it('i due angoli sono indipendenti: piegare le opzioni non piega il viaggio nel tempo', () => {
    const fixture = docks();
    TestBed.inject(BottomDocks).toggle('left');
    fixture.detectChanges();
    expect(toggleOf(fixture, 'left')?.getAttribute('aria-expanded')).toBe('false');
    expect(toggleOf(fixture, 'right')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('lo stato si ricorda, e UNA chiave ha UN solo scrittore', () => {
    const fixture = docks();
    TestBed.inject(BottomDocks).toggle('left');
    fixture.detectChanges();
    expect(localStorage.getItem('fantassistant.dock:left')).toBe('1');
    // Il servizio e' `providedIn: 'root'`, quindi due scatole dello stesso lato leggerebbero lo stesso
    // segnale: e' la ragione per cui lo stato non sta nel componente.
    expect(TestBed.inject(BottomDocks).collapsed('left')()).toBe(true);
    expect(TestBed.inject(BottomDocks).collapsed('right')()).toBe(false);
  });
});
