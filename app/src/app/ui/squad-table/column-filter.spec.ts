import { describe, expect, it } from 'vitest';

import {
  NO_VALUE,
  describeFilter,
  fold,
  isActive,
  passesPick,
  passesRange,
  passesText,
  readFilters,
} from './column-filter';

/**
 * FILTRARE UNA COLONNA, e in particolare che cosa succede alle CELLE VUOTE.
 *
 * Metà di questa tabella porta celle vuote per costruzione - un arrivo da un altro campionato non ha una
 * stagione misurata in questo listone - e la regola di casa è che vuoto vuol dire IGNOTO e mai zero. Un
 * filtro è il posto dove quella regola si rompe più facilmente: `value >= min` su `null` in JavaScript è
 * `false` per caso e non per ragionamento, e `value <= max` sarebbe `true`. Quindi qui si dichiara.
 */

describe('un intervallo di numeri', () => {
  it('lascia passare tutti quando non chiede niente', () => {
    expect(passesRange(6.5, {})).toBe(true);
    expect(passesRange(null, {})).toBe(true);
  });

  it('include gli estremi', () => {
    expect(passesRange(6, { min: 6, max: 7 })).toBe(true);
    expect(passesRange(7, { min: 6, max: 7 })).toBe(true);
    expect(passesRange(5.99, { min: 6, max: 7 })).toBe(false);
    expect(passesRange(7.01, { min: 6, max: 7 })).toBe(false);
  });

  it('NON conta un ignoto come «sotto il minimo»', () => {
    // Un uomo senza fantamedia misurata non è un uomo con una fantamedia bassa: non ha un numero da
    // confrontare, quindi con un estremo scelto esce, e non entra nemmeno da un solo lato.
    expect(passesRange(null, { min: 6 })).toBe(false);
    expect(passesRange(null, { max: 6 })).toBe(false);
  });

  it('sa cercare SOLO gli ignoti, che è una domanda vera di un\'asta', () => {
    // «Chi non ha una stagione misurata in questo listone» è chi il motore deve stimare: sono i promossi
    // e gli arrivi dall'estero, e senza questa opzione non c'era modo di chiederli.
    expect(passesRange(null, { blanks: 'only' })).toBe(true);
    expect(passesRange(6.5, { blanks: 'only' })).toBe(false);
    // ...e vince sugli estremi, perché un ignoto non ha un numero da confrontare con loro.
    expect(passesRange(null, { blanks: 'only', min: 6 })).toBe(true);
  });

  it('sa chiedere solo chi HA un numero, senza dire quale', () => {
    expect(passesRange(4, { blanks: 'known' })).toBe(true);
    expect(passesRange(null, { blanks: 'known' })).toBe(false);
  });
});

describe('un elenco da spuntare', () => {
  it('passa se ALMENO UNO dei suoi valori è spuntato', () => {
    // Un uomo con `dc; ds` è un centrale E un difensore di fascia: chiedere «i centrali» e non vederlo
    // sarebbe una risposta sbagliata a una domanda giusta.
    expect(passesPick(['dc', 'ds'], { pick: ['dc'] })).toBe(true);
    expect(passesPick(['dc', 'ds'], { pick: ['dd'] })).toBe(false);
  });

  it('tratta «nessun valore» come una voce spuntabile e non come un caso a parte', () => {
    expect(passesPick([], { pick: [NO_VALUE] })).toBe(true);
    expect(passesPick([], { pick: ['dc'] })).toBe(false);
    expect(passesPick(['dc'], { pick: [NO_VALUE] })).toBe(false);
  });

  it('nessuna spunta vuol dire TUTTI, non nessuno', () => {
    expect(passesPick(['dc'], { pick: [] })).toBe(true);
    expect(passesPick([], {})).toBe(true);
  });
});

describe('una parola da cercare', () => {
  it('ignora accenti e maiuscole', () => {
    expect(passesText('Højlund', { text: 'hojlund' })).toBe(true);
    expect(passesText('Gonçalo Ramos', { text: 'goncalo' })).toBe(true);
    expect(passesText('Lautaro Martinez', { text: 'MARTIN' })).toBe(true);
    expect(passesText('Lautaro Martinez', { text: 'kane' })).toBe(false);
  });

  it('un testo vuoto non filtra niente', () => {
    expect(passesText('Kane', { text: '   ' })).toBe(true);
    expect(fold('  Aá  ')).toBe('aa');
  });
});

describe('un filtro acceso si riconosce', () => {
  it('e uno spento non deve né filtrare né accendere l\'imbuto', () => {
    expect(isActive(undefined)).toBe(false);
    expect(isActive({})).toBe(false);
    expect(isActive({ text: '  ' })).toBe(false);
    expect(isActive({ pick: [] })).toBe(false);
    expect(isActive({ blanks: 'any' })).toBe(false);
    expect(isActive({ min: 0 })).toBe(true);
    expect(isActive({ pick: [NO_VALUE] })).toBe(true);
    expect(isActive({ blanks: 'only' })).toBe(true);
  });

  it('e uno zero è un filtro, non un campo vuoto', () => {
    // `min: 0` con un controllo scritto male («se il minimo è falsy non filtrare») sparirebbe, e
    // «Surplus >= 0» - cioè «solo chi vale più del rimpiazzo» - è una delle domande dell'asta.
    expect(isActive({ min: 0 })).toBe(true);
    expect(passesRange(-1, { min: 0 })).toBe(false);
  });
});

describe('il filtro in una frase', () => {
  it('dice l\'intervallo con la virgola, come la tabella', () => {
    expect(describeFilter('range', { min: 6.5 })).toBe('≥ 6,5');
    expect(describeFilter('range', { max: 7 })).toBe('≤ 7');
    expect(describeFilter('range', { min: 6, max: 7 })).toBe('6–7');
    expect(describeFilter('range', { blanks: 'only' })).toBe('solo ignoti');
    expect(describeFilter('range', { blanks: 'known' })).toBe('solo con un numero');
  });

  it('elenca le spunte finché sono poche, e poi le conta', () => {
    expect(describeFilter('pick', { pick: ['P', 'D'] }, (one) => one)).toBe('P, D');
    expect(describeFilter('pick', { pick: ['a', 'b', 'c', 'd'] })).toBe('4 valori');
    expect(describeFilter('pick', { pick: [NO_VALUE] })).toBe('ignoto');
  });

  it('e lo dice anche per una parola', () => {
    expect(describeFilter('text', { text: 'kane' })).toBe('contiene «kane»');
  });
});

describe('quello che c\'è sul disco', () => {
  it('tiene quello che capisce e butta il resto', () => {
    const saved = readFilters({
      expectedFm: { min: 6, max: 7 },
      club: { pick: ['Napoli', 42, null] },
      broken: 'not an object',
      empty: {},
      role: { pick: [], blanks: 'nonsense' },
    });
    expect(Object.keys(saved).sort()).toEqual(['club', 'expectedFm']);
    expect(saved['club']?.pick).toEqual(['Napoli']);
    expect(saved['expectedFm']).toEqual({ min: 6, max: 7 });
  });

  it('sopravvive a qualunque cosa, perché una preferenza non vale un\'eccezione', () => {
    expect(readFilters(null)).toEqual({});
    expect(readFilters('[]')).toEqual({});
    expect(readFilters([1, 2, 3])).toEqual({});
    expect(readFilters({ fm: { min: Number.NaN } })).toEqual({});
  });
});
