import { describe, expect, it } from 'vitest';

import { gapAt, withColumnMoved } from './column-drag';

/**
 * IL GESTO CHE RIORDINA, misurato dove si può misurare senza un browser.
 *
 * Questo file esiste perché il riordino è stato riscritto due volte, e la seconda volta (20/08/2026)
 * perché «funziona malissimo». Ognuno dei casi qui sotto è uno dei modi in cui non funzionava: non sono
 * casi limite inventati, sono il gesto che l'operatore faceva e che non produceva niente. La metà DOM -
 * la cattura del puntatore, il click da mangiare, la barra a schermo - resta in e2e
 * (`scripts/e2e-table.mjs`), che è l'unico posto da cui si vede.
 */

/** Sei colonne larghe cento pixel a partire da zero: mezzerie a 50, 150, 250, ... */
const BOXES = Array.from({ length: 6 }, (_, at) => ({ left: at * 100, right: at * 100 + 100 }));

describe('in quale varco cade il dito', () => {
  it('risponde SEMPRE, anche fuori da ogni intestazione', () => {
    // È il difetto che ha fatto riscrivere il gesto: `columnAt` tornava `null` fuori dalle celle, e un
    // rilascio con `null` non spostava niente - cioè portare una colonna in testa o in coda, che è
    // esattamente quello che si fa, non faceva assolutamente nulla.
    expect(gapAt(BOXES, -500)).toBe(0);
    expect(gapAt(BOXES, 5000)).toBe(BOXES.length);
    expect(gapAt([], 42)).toBe(0);
  });

  it('taglia sulle MEZZERIE, non sui bordi', () => {
    // La convenzione di ogni riordino trascinabile: finché il dito non ha passato metà della cella
    // vicina, la colonna resta di qua. Sui bordi il varco cambierebbe due volte per una cella.
    expect(gapAt(BOXES, 49)).toBe(0);
    expect(gapAt(BOXES, 51)).toBe(1);
    expect(gapAt(BOXES, 149)).toBe(1);
    expect(gapAt(BOXES, 151)).toBe(2);
  });
});

describe('l\'ordine dopo un trascinamento', () => {
  const all = ['a', 'b', 'c', 'd'];

  it('porta una colonna in TESTA e in CODA, che era il caso che non funzionava', () => {
    expect(withColumnMoved(all, all, 'c', 0)).toEqual(['c', 'a', 'b', 'd']);
    expect(withColumnMoved(all, all, 'a', 4)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('atterra nel varco scelto e non uno più in là', () => {
    // Trascinando a DESTRA il varco è contato sulla lista che contiene ancora la colonna in mano: senza
    // lo scalo di uno, «fra b e c» diventava «fra c e d» - il gesto arrivava sempre lungo.
    expect(withColumnMoved(all, all, 'a', 2)).toEqual(['b', 'a', 'c', 'd']);
    expect(withColumnMoved(all, all, 'd', 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('non fa niente nei due varchi ai lati della colonna in mano', () => {
    // «Lasciala dov'è» non è un ordine da riscrivere: tornando una copia, il segnale cambierebbe
    // identità e la tabella si ridisegnerebbe per niente a ogni click andato lungo di due pixel.
    expect(withColumnMoved(all, all, 'b', 1)).toBeNull();
    expect(withColumnMoved(all, all, 'b', 2)).toBeNull();
  });

  it('scrive l\'ordine INTERO e lascia le colonne SPENTE dove sono', () => {
    // Sul disco va anche quello che non si vede (è una preferenza sulla tabella, non su questa vista),
    // quindi il varco visibile va tradotto: la colonna si àncora alla vicina di DESTRA, e la spenta che
    // stava in mezzo non si muove di un posto.
    const withHidden = ['a', 'hidden', 'b', 'c'];
    const visible = ['a', 'b', 'c'];
    expect(withColumnMoved(withHidden, visible, 'c', 1)).toEqual(['a', 'hidden', 'c', 'b']);
    expect(withColumnMoved(withHidden, visible, 'a', 3)).toEqual(['hidden', 'b', 'c', 'a']);
  });

  it('non muove niente per una colonna che non è fra le visibili', () => {
    expect(withColumnMoved(all, ['a', 'b'], 'c', 0)).toBeNull();
    expect(withColumnMoved(all, ['a'], 'a', 1)).toBeNull();
  });

  it('regge un varco fuori scala invece di produrre una lista rotta', () => {
    // `gapAt` non può darne uno, ma il valore arriva da una misura del DOM: se un giorno arrivasse
    // sbagliato, il peggio che può fare è mettere la colonna in fondo.
    expect(withColumnMoved(all, all, 'a', 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(withColumnMoved(all, all, 'd', -5)).toEqual(['d', 'a', 'b', 'c']);
  });
});
