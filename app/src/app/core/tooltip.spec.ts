import { describe, expect, it } from 'vitest';

import {
  ANCHOR_HINT,
  RATING_HINT,
  RATING_KEYS,
  STAR_SCALE_HINT,
} from './player-ratings';
import { TOOLTIP_MAX, itDate, localDay, short } from './tooltip';

/**
 * A tooltip is at most a couple of lines (the operator's rule, 15/08/2026), and it is a TEST and not a
 * promise: these strings grow one clause at a time, and nobody notices the day they stop being readable.
 * The long version is not lost - it lives in «Come si leggono queste colonne», under the table.
 */
describe('tooltip length', () => {
  const hints: Record<string, string> = {
    ...Object.fromEntries(RATING_KEYS.map((key) => [`RATING_HINT.${key}`, RATING_HINT[key]])),
    STAR_SCALE_HINT,
    ANCHOR_HINT,
  };

  it('keeps every hint the app hovers within two lines', () => {
    const tooLong = Object.entries(hints).filter(([, text]) => text.length > TOOLTIP_MAX);
    // Report WHAT was examined: an audit that checks nothing also finds nothing. Sei da quando la
    // COSTANZA non è più una colonna (operatore, 17/08/2026) ma un simbolo accanto ai Voti: erano sette.
    expect(Object.keys(hints).length).toBeGreaterThanOrEqual(6);
    expect(tooLong.map(([name, text]) => `${name} (${text.length})`)).toEqual([]);
  });

  it('says the sentence was cut instead of ending mid-word', () => {
    const cut = short('una frase lunghissima che non entra in nessun modo dentro il limite', 20);
    expect(cut.length).toBeLessThanOrEqual(20);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).not.toMatch(/ …$/);
  });

  it('leaves a sentence that already fits exactly as it is', () => {
    expect(short('corta', 20)).toBe('corta');
  });
});

describe('itDate: si lavora in UTC e si mostra in locale', () => {
  /**
   * La regola dell'operatore (16/09/2026) ha due metà, e quella che si sbaglia è la distinzione fra
   * una data e un istante. Sta dentro la funzione apposta: i punti di chiamata non devono ricordarsela.
   */
  it('una DATA PURA non ha un fuso, quindi si riscrive e basta', () => {
    // il giorno di una partita, di una lettura, di una dritta dichiarata: convertirlo vorrebbe dire
    // inventargli un'ora che non ha, e a seconda del segno lo sposterebbe di un giorno
    expect(itDate('2026-08-17')).toBe('17/08/2026');
    expect(itDate('2026-01-01')).toBe('01/01/2026');
    expect(itDate('2026-12-31')).toBe('31/12/2026');
  });

  it('un ISTANTE si mostra nel giorno che chi guarda stava vivendo', () => {
    // 23:30 UTC del 16 sono le 01:30 del 17 in Italia: il taglio a dieci caratteri direbbe «16», che è
    // il giorno del meridiano di Greenwich e non quello dell'operatore. Il test dichiara il fuso in cui
    // gira invece di assumerlo, cosi' dice la stessa cosa ovunque venga eseguito.
    const instant = '2026-09-16T23:30:00+00:00';
    const when = new Date(instant);
    const atteso = `${String(when.getDate()).padStart(2, '0')}/`
      + `${String(when.getMonth() + 1).padStart(2, '0')}/${when.getFullYear()}`;
    expect(itDate(instant)).toBe(atteso);
    // ...e in un fuso a est di Greenwich quel giorno NON e' il 16, che e' il caso per cui la regola esiste
    if (-new Date(instant).getTimezoneOffset() >= 60) expect(itDate(instant)).toBe('17/09/2026');
  });

  it('un istante di mezzogiorno cade nello stesso giorno ovunque, e resta quello', () => {
    expect(itDate('2026-09-16T12:00:00+00:00')).toBe('16/09/2026');
  });

  it('localDay conta quello che itDate stampa: una definizione, due formati', () => {
    // la pastiglia della freschezza SOMMA i giorni e la card li STAMPA: se le due meta' calcolassero
    // il giorno in due modi, l'eta' e la data scritta accanto si contraddirebbero
    for (const iso of ['2026-09-16T23:30:00+00:00', '2026-09-16T12:00:00+00:00', '2026-08-17']) {
      expect(itDate(iso)).toBe(localDay(iso).split('-').reverse().join('/'));
    }
    // e una data pura resta se stessa, perche' non ha un fuso da applicare
    expect(localDay('2026-08-17')).toBe('2026-08-17');
  });

  it("una stringa che non si riesce a leggere si mostra COM'E'", () => {
    // un manifest troncato non deve stampare un giorno inventato: un numero illeggibile lo si va a
    // guardare, uno inventato no
    expect(itDate('2026-09-16T')).toBe('2026-09-16T');
    expect(itDate('non-una-data-T')).toBe('non-una-data-T');
  });
});
