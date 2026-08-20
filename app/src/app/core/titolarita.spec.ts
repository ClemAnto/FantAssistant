import { describe, expect, it } from 'vitest';

import {
  TITOLARITA_LADDER,
  TITOLARITA_SHORT,
  isTitolarita,
  titolaritaNote,
  titolaritaRank,
} from './titolarita';

/**
 * Il vocabolario della scala, e i due vincoli che una sigla di tre caratteri deve rispettare.
 *
 * Il gradino lo decide il toolkit: qui non si prova nessuna soglia - quelle stanno in `engine/status.py`
 * con la resa misurata su quattro finestre. Si prova che la LETTURA non tradisca la misura.
 */
describe('la titolarità in una parola', () => {
  it('ha le sei parole dell\'operatore, nell\'ordine della scala', () => {
    expect([...TITOLARITA_LADDER]).toEqual([
      'bandiera', 'titolarissimo', 'titolare', 'ballottaggio', 'panchina', 'riserva',
    ]);
    expect(TITOLARITA_LADDER.map(titolaritaRank)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('dà TRE caratteri a ciascuna, e sei sigle diverse', () => {
    const codes = TITOLARITA_LADDER.map((word) => TITOLARITA_SHORT[word]);
    for (const code of codes) expect(code).toHaveLength(3);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('non lascia che i due gradini più LONTANI abbiano le sigle più simili', () => {
    // La ragione per cui `ballottaggio` non è `BAL`: `BAN`/`BAL` differiscono per l'ultimo carattere e
    // sono il gradino 1 e il gradino 4, cioè l'errore di lettura più caro possibile.
    const distance = (a: string, b: string) =>
      [...a].filter((ch, at) => ch !== b[at]).length;
    expect(distance(TITOLARITA_SHORT.bandiera, TITOLARITA_SHORT.ballottaggio)).toBeGreaterThan(1);
  });

  it('non inventa un gradino per una parola che non è sulla scala', () => {
    // «Vuoto = ignoto, mai zero»: un foglio più vecchio della revisione 35 non porta la colonna, e uno
    // costruito senza display non porta l'undici che la decide. Nessuno dei due è una riserva.
    expect(isTitolarita('titolare')).toBe(true);
    expect(isTitolarita('panchinaro')).toBe(false);
    expect(titolaritaRank(null)).toBeNull();
    expect(titolaritaRank('')).toBeNull();
    expect(titolaritaNote(null, 0.9, 80)).toBeNull();
  });

  it('la frase porta la parola intera E i due numeri, perché un gradino si ribalta su un minuto', () => {
    const note = titolaritaNote('bandiera', 0.963, 85) ?? '';
    expect(note).toContain('BANDIERA');
    expect(note).toContain('96%');
    expect(note).toContain("85'");
    // ...e dice da dove viene il gradino, che è l'unica cosa che spiega perché due uomini con gli
    // stessi numeri possono leggersi diversi: uno lo schiera la board e l'altro no.
    expect(note).toContain('undici tipo');
  });

  it('non pretende i numeri: la parola resta leggibile anche senza', () => {
    const note = titolaritaNote('riserva', null, null) ?? '';
    expect(note).toContain('RISERVA');
    expect(note).not.toContain('NaN');
  });
});
