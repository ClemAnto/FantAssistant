import { describe, expect, it } from 'vitest';

import {
  CATEGORIA_LADDER,
  CATEGORIA_SHORT,
  categoriaNote,
  categoriaRank,
  isCategoria,
} from './categoria';

/**
 * Il vocabolario delle sei categorie, e i vincoli che la LETTURA deve rispettare.
 *
 * La parola la decide il toolkit: qui non si prova nessuna sbarra - quelle stanno in
 * `engine/categories.py` con la misura che le ha scelte e i sette nomi dell'operatore come specifica. Si
 * prova che la lettura non tradisca la misura.
 */
describe('le sei parole dentro il ruolo', () => {
  it('ha le parole dell\'operatore, nell\'ordine della scala', () => {
    expect([...CATEGORIA_LADDER]).toEqual([
      'oro', 'argento', 'bronzo', 'cristallo', 'scommessa', 'scarto',
    ]);
    expect(CATEGORIA_LADDER.map(categoriaRank)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('dà TRE caratteri a ciascuna, e sei sigle diverse', () => {
    const codes = CATEGORIA_LADDER.map((word) => CATEGORIA_SHORT[word]);
    for (const code of codes) expect(code).toHaveLength(3);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('non lascia che le due parole OPPOSTE abbiano le sigle più simili', () => {
    // La ragione per cui `scommessa` non è `SCO` e `scarto` non è `SCA`: differirebbero per l'ultimo
    // carattere, e dicono il contrario l'una dell'altra - «nessuno l'ha misurato» contro «è misurato e
    // porta poco». È lo stesso inciampo di BAN/BAL un file più in là.
    const distance = (a: string, b: string) => [...a].filter((ch, at) => ch !== b[at]).length;
    expect(distance(CATEGORIA_SHORT.scommessa, CATEGORIA_SHORT.scarto)).toBeGreaterThan(1);
  });

  it('non inventa una parola per quello che il foglio non porta', () => {
    // «Vuoto = ignoto»: un foglio più vecchio della revisione 38 non porta la colonna, e la lettura non
    // deve trasformare quel vuoto in `scarto`, che è un'affermazione MISURATA su di lui.
    expect(isCategoria('scarto')).toBe(true);
    expect(isCategoria('titolare')).toBe(false);
    expect(categoriaRank(null)).toBeNull();
    expect(categoriaRank('bandiera')).toBeNull();
    expect(categoriaNote(null, 1.2, '0.87/1.25')).toBeNull();
  });

  it('la frase porta il tasso misurato e le due sbarre del ruolo', () => {
    const note = categoriaNote('oro', 1.33, '0.87/1.25') ?? '';
    expect(note).toContain('ORO');
    expect(note).toContain('+1.33');
    expect(note).toContain('0.87');
    expect(note).toContain('1.25');
  });

  it('per una scommessa dice che manca la MISURA, e non stampa un tasso che non ha', () => {
    const note = categoriaNote('scommessa', null, '0.87/1.25') ?? '';
    expect(note).toContain('15 voti');
    expect(note).not.toContain('0.87');
  });

  it('sopravvive a una riga senza sbarre, invece di scrivere una frase rotta', () => {
    // Uno slot che le sbarre non conoscono esiste: il foglio potrebbe portare un ruolo nuovo, e allora la
    // parola resta senza scala invece di inventarne una.
    const note = categoriaNote('bronzo', 0.05, null) ?? '';
    expect(note).toContain('BRONZO');
    expect(note).toContain('+0.05');
    expect(note).not.toContain('sbarre');
  });
});
