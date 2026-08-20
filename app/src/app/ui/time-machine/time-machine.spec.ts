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

  it('senza pacchetto DICHIARA a schermo che il motore non è retrodatato', () => {
    const travel = TestBed.inject(TimeTravel);
    const fixture = box();
    travel.travelTo('2025-11-03');
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('2025-11-03');
    expect(text).toContain('motore NON retrodatato');
    expect(travel.fidelity()).toBe('partial');
  });

  it('col PACCHETTO dice che è retrodatato tutto - e le tre istantanee restano dichiarate', () => {
    const travel = TestBed.inject(TimeTravel);
    travel.packs.set([{
      date: '2025-09-05', target_season: '2025-26', input_season: '2024-25',
      window: 'estiva', leagues: 3, path: 'timepacks/2025-09-05/manifest.json',
    }]);
    const fixture = box();
    travel.travelTo('2025-09-05');
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(travel.fidelity()).toBe('full');
    expect(text).toContain('motore compreso');
    expect(text).toContain('2025-26');
    // ...e la riga sulle istantanee NON sparisce col pacchetto: sono fatti che al tempo non tornano.
    expect(text).toContain('probabili');
  });

  it('un pacchetto INDIETRO di revisione lo dice, e uno pari o muto non inventa un avviso', () => {
    const travel = TestBed.inject(TimeTravel);
    const pack = {
      date: '2025-09-05', target_season: '2025-26', input_season: '2024-25',
      window: 'estiva', leagues: 3, path: 'timepacks/2025-09-05/manifest.json',
      sheet_revision: 29,
    };
    travel.packs.set([pack]);
    travel.revision.set(34);
    const fixture = box();
    travel.travelTo('2025-09-05');
    fixture.detectChanges();
    expect(travel.staleBy()).toBe(5);
    expect((fixture.nativeElement as HTMLElement).textContent ?? '').toContain('5 revisioni fa');

    // pari a oggi: niente da dire. E «non dichiarata» NON è «aggiornata», ma nemmeno un avviso che
    // nessuno può verificare - resta null in entrambi i casi, per due ragioni diverse.
    travel.packs.set([{ ...pack, sheet_revision: 34 }]);
    fixture.detectChanges();
    expect(travel.staleBy()).toBeNull();
    travel.packs.set([{ ...pack, sheet_revision: null }]);
    fixture.detectChanges();
    expect(travel.staleBy()).toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent ?? '').not.toContain('revisioni fa');
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
