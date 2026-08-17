import { describe, expect, it } from 'vitest';

import { SQUAD_COLUMNS, orderColumns } from './squad-table';

/**
 * I DUE ZERI, affiancati - e la ragione per cui questo test esiste è che la prossima persona che legge
 * due colonne di surplus penserà che una sia di troppo.
 *
 * Non lo è: `Surplus` conta dal marginale di ROSA (l'ottantesimo centrocampista di dieci squadre) e
 * risponde a «chi conviene comprare»; `Lead` conta dal rimpiazzo che ENTRA (il rango «squadre ×
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
    expect(byKey.get('surplusFielded')).toBe('Lead');
  });
  it('NON offre le due al netto della coppa: decisione dell\'operatore, 17/08/2026', () => {
    // Nate e tolte lo stesso giorno. Il fatto non si è perso - il globo accanto al nome dice chi parte
    // e il tooltip delle presenze attese dice quante giornate costa - e il foglio le porta ancora
    // (`desc_surplus_cup`), quindi rimetterle è una riga. Questo test esiste perché la prossima persona
    // che legge `SquadMan.surplusCup` penserà che manchi una colonna: non manca, è stata tolta.
    const keys = SQUAD_COLUMNS.map((one) => one.key);
    expect(keys).not.toContain('surplusCup');
    expect(keys).not.toContain('surplusFieldedCup');
  });

  it('mette il valore di MERCATO accanto all\'FVM, e non lo chiama né «Valore» né «MV»', () => {
    // I due prezzi si leggono insieme perché sono due giudizi sulla stessa persona da due tavoli: l'FVM
    // è quello che il listone chiede, il mercato è quello che il mercato vero ha pagato.
    const keys = SQUAD_COLUMNS.map((one) => one.key);
    expect(keys.indexOf('market')).toBe(keys.indexOf('fvm') + 1);
    const byKey = new Map(SQUAD_COLUMNS.map((one) => [one.key, one.label]));
    // «Valore» sono i Fantapunti e «MV» è la media voto: due colonne che quelle parole hanno già, e un
    // terzo prezzo chiamato con una delle due renderebbe le tre indistinguibili a colpo d'occhio.
    expect(byKey.get('market')).toBe('Mercato');
    expect(byKey.get('value')).toBe('Fantapunti');
    expect(byKey.get('mv')).toBe('MV');
  });
});

describe('orderColumns', () => {
  const listino = ['mantra', 'club', 'codes', 'expected', 'surplus', 'value', 'fvm', 'market'];

  it('tiene l\'ordine salvato e ignora le chiavi che questa vista non offre', () => {
    // «Squadra» non c'è nella rosa di un club: una chiave salvata che non è offerta non deve spostare nulla.
    const saved = ['surplus', 'club', 'mantra', 'codes', 'expected', 'value', 'fvm', 'market'];
    const offered = listino.filter((one) => one !== 'club');
    expect(orderColumns(saved, offered)).toEqual(
      ['surplus', 'mantra', 'codes', 'expected', 'value', 'fvm', 'market'],
    );
  });

  it('una colonna NUOVA nasce accanto alla sua vicina di listino, non in coda', () => {
    // Il caso vero: chi ha un ordine salvato di ieri deve trovare «Mercato» accanto all'FVM, che è dove
    // SQUAD_COLUMNS la mette - in coda nessuno la cercherebbe, e nascerebbe invisibile di fatto.
    const saved = ['mantra', 'club', 'codes', 'expected', 'surplus', 'value', 'fvm'];
    expect(orderColumns(saved, listino).indexOf('market')).toBe(
      orderColumns(saved, listino).indexOf('fvm') + 1,
    );
  });

  it('senza niente di salvato è il listino, in ordine', () => {
    expect(orderColumns([], listino)).toEqual([...listino]);
  });

  it('le colonne SPENTE restano nell\'ordine: si accendono al posto in cui stavano', () => {
    // Spegnere non è togliere: l'ordine salvato porta tutte le chiavi, accese o no (`squad.hidden` è un
    // elenco a parte), quindi riaccendere una colonna la rimette dove era e non in fondo.
    const saved = ['market', 'mantra', 'club', 'codes', 'expected', 'surplus', 'value', 'fvm'];
    expect(orderColumns(saved, listino)).toEqual(saved);
  });
});
