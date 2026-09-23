import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { appConfig } from '../../app.config';
import { DigitInput } from './digit-input';

/**
 * L'ARITMETICA DELL'ODOMETRO, che e' la parte che puo' sbagliare in silenzio.
 *
 * Quante colonne, quanto muove una freccetta, quando e' spenta, cosa succede a una cifra battuta che non
 * ci sta. Il DISEGNO non si asserisce (dove stanno le freccette, che icona hanno): quello lo guarda il
 * banco in un browser vero, che e' l'unico posto dove un gesto si puo' provare.
 */
@Component({
  imports: [DigitInput],
  template: `<ui-digit-input [(value)]="price" [max]="max()" what="il prezzo" />`,
})
class Host {
  readonly price = signal(0);
  readonly max = signal(1000);
}

function mount(max = 1000, value = 0) {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.max.set(max);
  fixture.componentInstance.price.set(value);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    price: () => fixture.componentInstance.price(),
    digits: () =>
      [...el.querySelectorAll<HTMLInputElement>('[data-digit]')].map((one) => one.value).join(''),
    /** Le freccette di una colonna, contate da sinistra: 0 e' il posto piu' pesante. */
    up: (at: number) => el.querySelectorAll<HTMLButtonElement>('[data-step="up"]')[at],
    down: (at: number) => el.querySelectorAll<HTMLButtonElement>('[data-step="down"]')[at],
    reset: () => el.querySelector<HTMLButtonElement>('[data-reset]')!,
    type: (at: number, text: string) => {
      const cell = el.querySelectorAll<HTMLInputElement>('[data-digit]')[at];
      cell.value = cell.value + text;
      cell.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    },
    press: (button: HTMLButtonElement | undefined) => {
      button?.click();
      fixture.detectChanges();
    },
  };
}

describe('ui-digit-input', () => {
  // I PROVIDER VERI, e non per abitudine: senza di loro le icone non sono registrate e ogni montaggio
  // lascia un errore non gestito in coda alla corsa. Vitest lo dice - «this might cause false positive
  // tests» - e un verde con degli errori sotto e' il genere di verde che questo progetto non accetta.
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [...appConfig.providers] });
  });

  it('disegna una colonna per cifra del TETTO, non un numero fisso', () => {
    expect(mount(1000).digits()).toBe('0000');
    expect(mount(500).digits()).toBe('000');
    expect(mount(50).digits()).toBe('00');
    // Un tetto a zero non e' «nessuna colonna»: sarebbe un controllo che non si vede.
    expect(mount(0).digits()).toBe('0');
  });

  it('una freccetta muove il SUO posto, e il riporto e\' aritmetica', () => {
    const it1 = mount(1000, 95);
    it1.press(it1.up(2)); // le decine
    expect(it1.price()).toBe(105);
    expect(it1.digits()).toBe('0105');
    it1.press(it1.down(1)); // le centinaia
    expect(it1.price()).toBe(5);
  });

  it('una freccetta che porterebbe fuori dai due estremi e\' SPENTA', () => {
    const low = mount(1000, 0);
    expect(low.down(3)?.disabled).toBe(true);
    expect(low.up(3)?.disabled).toBe(false);
    const high = mount(1000, 1000);
    expect(high.up(0)?.disabled).toBe(true);
    expect(high.up(3)?.disabled).toBe(true);
    expect(high.down(3)?.disabled).toBe(false);
  });

  it('una cifra battuta sostituisce il suo posto', () => {
    const one = mount(1000, 0);
    one.type(2, '4'); // le decine
    expect(one.price()).toBe(40);
    one.type(3, '5'); // le unita'
    expect(one.price()).toBe(45);
    // ...e sostituisce invece di accodarsi: una seconda cifra sullo stesso posto lo RIscrive.
    one.type(3, '7');
    expect(one.price()).toBe(47);
  });

  it('una cifra che sfora il tetto e\' RIFIUTATA e non limata al massimo', () => {
    const one = mount(1000, 0);
    one.type(0, '4'); // 4000 su un tetto di 1000
    // Il difetto che il banco ha trovato: con la limatura questo leggeva 1000, cioe' il controllo
    // rispondeva col massimo a una cifra che nessuno aveva chiesto.
    expect(one.price()).toBe(0);
    expect(one.digits()).toBe('0000');
  });

  it('quello che non e\' una cifra non muove niente', () => {
    const one = mount(1000, 42);
    one.type(3, 'x');
    expect(one.price()).toBe(42);
    expect(one.digits()).toBe('0042');
  });

  it('il tastino azzera, ed e\' spento quando non c\'e\' niente da azzerare', () => {
    const one = mount(1000, 137);
    expect(one.reset().disabled).toBe(false);
    one.press(one.reset());
    expect(one.price()).toBe(0);
    expect(one.digits()).toBe('0000');
    expect(mount(1000, 0).reset().disabled).toBe(true);
  });

  it('un valore fuori dagli estremi si legge dentro: le cifre e il totale non si contraddicono', () => {
    const over = mount(500, 900);
    expect(over.digits()).toBe('500');
  });
});
