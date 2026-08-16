import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { appConfig } from '../../app.config';
import { TimeTravel } from '../../core/time-travel';
import { TimeMachine } from './time-machine';

/**
 * Il box del viaggio nel tempo, verificato su quello che DEVE dire.
 *
 * La cosa da inchiodare non è il disegno ma la DICHIARAZIONE: mentre si viaggia il box deve scrivere a
 * schermo - non dentro un tooltip - che le colonne del motore non sono retrodatate. Un viaggio nel tempo
 * che ne retrodata metà in silenzio è peggio di nessun viaggio nel tempo, ed è l'unica parte di questa
 * funzione che un lettore futuro potrebbe togliere credendo di semplificare.
 */
function box() {
  const fixture = TestBed.createComponent(TimeMachine);
  fixture.detectChanges();
  return fixture;
}

describe('ui-time-machine', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [...appConfig.providers] });
  });

  it('sta zitto quando non si viaggia: nessun avviso su una pagina usata a un tavolo vero', () => {
    const text = (box().nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Viaggio nel tempo');
    expect(text).not.toContain('NON retrodatati');
  });

  it('DICHIARA a schermo che il motore non è retrodatato, appena si viaggia', () => {
    const travel = TestBed.inject(TimeTravel);
    const fixture = box();
    travel.travelTo('2025-11-03');
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('2025-11-03');
    expect(text).toContain('NON retrodatati');
    expect(text).toContain('Fantapunti');
    expect(text).toContain('ricalcolati');
  });

  it('torna a oggi, e una data futura non è un viaggio nel tempo', () => {
    const travel = TestBed.inject(TimeTravel);
    travel.travelTo('2025-11-03');
    expect(travel.travelling()).toBe(true);
    travel.travelTo(null);
    expect(travel.travelling()).toBe(false);
    expect(travel.today()).toBe(travel.realToday);
    // Domani è oggi con un'etichetta sbagliata: il servizio lo rifiuta invece di fingere.
    travel.travelTo('2099-01-01');
    expect(travel.travelling()).toBe(false);
  });

  it('«sa» tutto quello che è datato prima, e una riga senza data resta ignota e non tagliata', () => {
    const travel = TestBed.inject(TimeTravel);
    travel.travelTo('2025-11-03');
    expect(travel.knows('2025-11-02')).toBe(true);
    expect(travel.knows('2025-11-03')).toBe(true);
    expect(travel.knows('2025-11-04')).toBe(false);
    expect(travel.knows(null)).toBe(true);
  });
});
