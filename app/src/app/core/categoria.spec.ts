import { describe, expect, it } from 'vitest';

import { NZ_ICONS } from '../nz-icons';
import {
  CATEGORIA_ICON,
  CATEGORIA_LABEL,
  CATEGORIA_LADDER,
  CATEGORIA_SHORT,
  CATEGORIA_TONE,
  categoriaNote,
  categoriaRank,
  isCategoria,
} from './categoria';

/**
 * Il vocabolario delle sette categorie, e i vincoli che la LETTURA deve rispettare.
 *
 * La parola la decide il toolkit: qui non si prova nessuna sbarra - quelle stanno in
 * `engine/categories.py` con la misura che le ha scelte e i quindici verdetti dell'operatore come
 * specifica. Si prova che la lettura non tradisca la misura.
 */
describe('le sette parole dentro il ruolo', () => {
  it('ha le parole dell\'operatore, nell\'ordine della scala', () => {
    expect([...CATEGORIA_LADDER]).toEqual([
      'super', 'top', 'semi', 'solido', 'riserva', 'scommessa', 'scarto',
    ]);
  });

  it('ordina per la SCALA e non per la sigla', () => {
    expect(categoriaRank('super')).toBe(0);
    expect(categoriaRank('scarto')).toBe(6);
    // `scommessa` sta SOPRA `scarto` (sua graduatoria, 22/09 sera): «nessuno l'ha ancora misurato»
    // promette più di «è misurato e non gioca».
    expect(categoriaRank('scommessa')).toBe(5);
    // le sigle in ordine alfabetico direbbero un'altra cosa, ed è la ragione per cui si ordina qui
    const byShort = [...CATEGORIA_LADDER].sort((a, b) =>
      CATEGORIA_SHORT[a].localeCompare(CATEGORIA_SHORT[b]));
    expect(byShort).not.toEqual([...CATEGORIA_LADDER]);
  });

  it('non riconosce le parole della scala VECCHIA, così un foglio a revisione 71 non mente', () => {
    // Le sei del 01/09/2026, sostituite il 22/09: una di loro su una riga vuol dire che il pacchetto
    // è più vecchio del codice, e la lettura deve dirlo tacendo invece di tradurla a caso.
    for (const old of ['oro', 'argento', 'bronzo', 'cristallo', 'supertop', 'tappabuchi']) {
      expect(isCategoria(old)).toBe(false);
      expect(categoriaRank(old)).toBeNull();
      expect(categoriaNote(old, 7.0, '6.87/6.97/7.09/7.61')).toBeNull();
    }
  });

  it('ha sigle di tre caratteri, e le due che dicono il CONTRARIO non si somigliano', () => {
    for (const word of CATEGORIA_LADDER) {
      expect(CATEGORIA_SHORT[word]).toHaveLength(3);
    }
    expect(new Set(Object.values(CATEGORIA_SHORT)).size).toBe(CATEGORIA_LADDER.length);
    const distance = (a: string, b: string) =>
      [...a].filter((ch, i) => ch !== b[i]).length;
    // `scarto` = «misurato e rende poco», `scommessa` = «nessuno l'ha misurato»: dicono il CONTRARIO
    // l'una dell'altra e le loro sigle non devono somigliarsi, per la ragione di BAN/BAL un file più
    // in là. DUE lettere su tre e non tre: le due parole sono dell'operatore (22/09/2026) e iniziano
    // entrambe per S, quindi tre è irraggiungibile senza una sigla che nessuno riconoscerebbe - e
    // due è comunque il doppio della distanza che quel difetto aveva. SRT contro SCM.
    expect(distance(CATEGORIA_SHORT.scarto, CATEGORIA_SHORT.scommessa)).toBeGreaterThanOrEqual(2);
    // ...e le due che sono VICINE sulla scala non devono confondersi a colpo d'occhio
    expect(distance(CATEGORIA_SHORT.super, CATEGORIA_SHORT.semi)).toBeGreaterThan(1);
  });

  it('ha un nome per esteso per ognuna', () => {
    for (const word of CATEGORIA_LADDER) {
      expect(CATEGORIA_LABEL[word]).toBeTruthy();
    }
    expect(CATEGORIA_LABEL.super).toBe('Super');
  });
});

describe('la frase che spiega la parola', () => {
  it('porta il livello e le quattro sbarre del ruolo, così la riga si può controllare', () => {
    const note = categoriaNote('super', 8.49, '6.87/6.97/7.09/7.61') ?? '';
    expect(note).toContain('SUPER');
    expect(note).toContain('8.49');
    // tutte e quattro le sbarre, ognuna col nome della parola a cui apre
    expect(note).toContain('6.87 solido');
    expect(note).toContain('7.61 super');
  });

  it('per una scommessa dice che manca la MISURA, e non stampa sbarre che non la riguardano', () => {
    const note = categoriaNote('scommessa', null, '6.87/6.97/7.09/7.61') ?? '';
    expect(note).toContain('assenza di misura');
    expect(note).not.toContain('6.87');
  });

  it('senza le sbarre dice comunque la parola e il livello', () => {
    const note = categoriaNote('riserva', 6.53, null) ?? '';
    expect(note).toContain('RISERVA');
    expect(note).toContain('6.53');
  });

  it('senza parola non inventa una frase', () => {
    expect(categoriaNote(null, 7.0, '6.87/6.97/7.09/7.61')).toBeNull();
    expect(categoriaNote(undefined, null, null)).toBeNull();
  });
});

describe('il pallino: tinta e icona', () => {
  it('ogni parola ha una tinta e una sola, e il ROSSO non si usa', () => {
    for (const word of CATEGORIA_LADDER) {
      expect(CATEGORIA_TONE[word]).toBeTruthy();
      // Il rosso resta al pericolo e alle azioni distruttive: un calciatore scarso non e' un
      // pericolo. Sotto il centro si scende in ambra (regola del 25/08/2026, `ui/gain-chip`).
      expect(CATEGORIA_TONE[word]).not.toContain('danger');
    }
  });

  it('il CENTRO non si dipinge e l’IGNOTO non ha un colore di qualita', () => {
    // «Uno schermo dove ogni numero e dipinto e uno schermo che urla»: `riserva` e la parola di
    // meta listone e porta il fondo neutro.
    expect(CATEGORIA_TONE.riserva).toContain('bg-control');
    // `scommessa` non e un giudizio: nessun fondo, come `ignoto` nella scala del gain.
    expect(CATEGORIA_TONE.scommessa).not.toContain('bg-');
  });

  it('la scala del verde SCENDE dal migliore al peggiore', () => {
    // Il pieno solo in cima, poi traslucidi calanti: se due gradini avessero la stessa tinta, il
    // pallino direbbe che due categorie sono la stessa cosa.
    const green = ['super', 'top', 'semi', 'solido'] as const;
    const tones = green.map((word) => CATEGORIA_TONE[word]);
    expect(new Set(tones).size).toBe(green.length);
    expect(tones[0]).toContain('bg-success ');   // pieno, senza opacita
    for (const tone of tones.slice(1)) expect(tone).toContain('bg-success/');
  });

  it('ogni icona e REGISTRATA, o disegna una casella vuota', () => {
    // Il difetto pagato il 13/09 su `user-add` e il 04/09 su `eye`: un'icona non registrata non si
    // vede e la pagina urla «<svg> tag not found» in console.
    // La FORMA di una definizione: `name` e' lo slug ('tool') e `theme` un campo a parte - la prima
    // versione di questo test le concatenava e falliva su tutte e sette, che e' il modo in cui un
    // arnese accusa il codice del proprio difetto.
    const registered = new Set(NZ_ICONS.map((one) => `${one.name}:${one.theme}`));
    for (const word of CATEGORIA_LADDER) {
      const icon = CATEGORIA_ICON[word];
      expect(registered.has(`${icon.type}:${icon.theme}`), `${word} -> ${icon.type}`).toBe(true);
    }
  });

  it('ogni parola ha la SUA icona: due gradini non si disegnano uguali', () => {
    const drawn = CATEGORIA_LADDER.map((word) => `${CATEGORIA_ICON[word].type}`);
    expect(new Set(drawn).size).toBe(CATEGORIA_LADDER.length);
  });
});
