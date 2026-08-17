import { describe, expect, it } from 'vitest';

import { SQUAD_COLUMNS } from './squad-table';

/**
 * I DUE ZERI, affiancati - e la ragione per cui questo test esiste è che la prossima persona che legge
 * due colonne di surplus penserà che una sia di troppo.
 *
 * Non lo è: `Surplus` conta dal marginale di ROSA (l'ottantesimo centrocampista di dieci squadre) e
 * risponde a «chi conviene comprare»; `Margine` conta dal rimpiazzo che ENTRA (il rango «squadre ×
 * posti che il regolamento schiera») e risponde a «quanto costa una giornata saltata». Sono due
 * domande, non due risposte alla stessa, e sui primi venticinque del foglio Serie A condividono sette
 * nomi su venticinque: chi sta in alto in tutt'e due è forte davvero (metrica-asta-surplus-v1.md §21).
 *
 * La decisione dell'operatore (§21.1) è di vederle INSIEME e di scegliere soltanto per quale ordinare,
 * ed è quello che questo file protegge: che nessuna delle due sparisca «perché ridondante», e che la
 * seconda nasca accesa - il selettore ricorda le colonne SPENTE, quindi una chiave nuova è visibile
 * anche per chi ha già una preferenza salvata.
 */
describe('le colonne della tabella', () => {
  it('porta tutt\'e due i surplus, uno accanto all\'altro', () => {
    const keys = SQUAD_COLUMNS.map((one) => one.key);
    expect(keys).toContain('surplus');
    expect(keys).toContain('surplusFielded');
    expect(keys.indexOf('surplusFielded')).toBe(keys.indexOf('surplus') + 1);
  });

  it('le chiama con due nomi diversi, perché sono due domande', () => {
    const byKey = new Map(SQUAD_COLUMNS.map((one) => [one.key, one.label]));
    expect(byKey.get('surplus')).toBe('Surplus');
    expect(byKey.get('surplusFielded')).toBe('Margine');
  });
  it('offre le due AL NETTO DELLA COPPA in coppia, e DOPO le due gated', () => {
    // L'adiacenza fra «Surplus» e «Margine» è una decisione dell'operatore e il test sopra la protegge,
    // quindi le due nuove vanno in coda alla coppia e non in mezzo. Restano adiacenti fra loro per la
    // stessa ragione per cui lo sono le prime due: sono lo stesso conto da due zeri diversi.
    const keys = SQUAD_COLUMNS.map((one) => one.key);
    expect(keys.indexOf('surplusCup')).toBe(keys.indexOf('surplusFielded') + 1);
    expect(keys.indexOf('surplusFieldedCup')).toBe(keys.indexOf('surplusCup') + 1);
    const byKey = new Map(SQUAD_COLUMNS.map((one) => [one.key, one.label]));
    // Il nome dice che è la stessa cosa MENO qualcosa: «−C» invece di un secondo nome, o due colonne
    // diverse sembrerebbero due metriche diverse.
    expect(byKey.get('surplusCup')).toBe('Surplus −C');
    expect(byKey.get('surplusFieldedCup')).toBe('Margine −C');
  });
});
