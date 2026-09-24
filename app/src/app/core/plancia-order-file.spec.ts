import { describe, expect, it } from 'vitest';

import {
  ORDER_FILE_KIND,
  ORDER_FILE_VERSION,
  countsOf,
  orderFileOf,
  readOrderFile,
} from './plancia-order-file';

describe('orderFileOf', () => {
  it('porta le due liste insieme, perché una senza l’altra è un’altra lista', () => {
    // L'ordine dice CHI viene prima, i buttati CHI non c'è più: chi esporta «l'ordinamento» intende la
    // lista che ha davanti, e quella è il risultato di tutt'e due.
    const file = orderFileOf(
      { 'default|D': [10, 20], 'default|A': [] },
      { 'default|D': [99] },
      '2026-09-24',
    );
    expect(file.kind).toBe(ORDER_FILE_KIND);
    expect(file.version).toBe(ORDER_FILE_VERSION);
    expect(file.saved).toBe('2026-09-24');
    expect(file.order).toEqual({ 'default|D': [10, 20] });
    expect(file.binned).toEqual({ 'default|D': [99] });
  });

  it('non porta dentro una lista vuota: una chiave senza nomi non è un ordine', () => {
    expect(orderFileOf({ 'default|C': [] }, {}, '2026-09-24').order).toEqual({});
  });
});

describe('readOrderFile', () => {
  const written = JSON.stringify(orderFileOf({ 'default|D': [1, 2, 3] }, { 'default|C': [7] }, '2026-09-24'));

  it('rilegge quello che ha scritto, campo per campo', () => {
    const back = readOrderFile(written);
    expect(typeof back).not.toBe('string');
    if (typeof back === 'string') return;
    expect(back.order).toEqual({ 'default|D': [1, 2, 3] });
    expect(back.binned).toEqual({ 'default|C': [7] });
    expect(countsOf(back)).toEqual({ lists: 1, names: 3, binned: 1 });
  });

  it('RIFIUTA quello che non porta il nostro marchio, e dice perché', () => {
    // Incollare il file sbagliato deve dirlo: un import che ci prova e svuota una lista preparata in
    // un'ora è peggio di uno che si ferma.
    const said = readOrderFile(JSON.stringify({ order: { 'default|D': [1] } }));
    expect(typeof said).toBe('string');
    expect(String(said)).toContain('marchio');
    expect(String(readOrderFile('{ non è json'))).toContain('valido');
  });

  it('si ferma davanti a un formato più NUOVO del suo', () => {
    // Un lettore che accetta una forma che non conosce perde metà del lavoro in silenzio.
    const future = JSON.stringify({ kind: ORDER_FILE_KIND, version: ORDER_FILE_VERSION + 1, order: {} });
    expect(String(readOrderFile(future))).toContain('più nuova');
  });

  it('scarta la chiave sporca e tiene il resto: il lavoro vero non si butta per una riga', () => {
    const mixed = JSON.stringify({
      kind: ORDER_FILE_KIND,
      version: ORDER_FILE_VERSION,
      order: { 'default|D': [1, 2], 'default|C': ['x', 3], 'default|A': null },
      binned: { 'default|P': [5] },
    });
    const back = readOrderFile(mixed);
    if (typeof back === 'string') throw new Error(back);
    expect(back.order).toEqual({ 'default|D': [1, 2] });
    expect(back.binned).toEqual({ 'default|P': [5] });
  });
});
