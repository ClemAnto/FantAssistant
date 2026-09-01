import { describe, expect, it } from 'vitest';

import { SORTABLE_COLUMNS, SQUAD_COLUMNS, orderColumns } from './squad-table';
import { CATEGORIA_LADDER, CATEGORIA_SHORT } from '../../core/categoria';
import { TITOLARITA_SHORT } from '../../core/titolarita';

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
  it('porta la TITOLARITÀ accanto alla P, e la si può ordinare', () => {
    // Le due colonne rispondono alla stessa domanda in due unità - «quanto gioca» a parole e in
    // partite - quindi stanno vicine: una parola letta a mezza tabella di distanza dal suo numero è
    // una parola che nessuno confronta. E si ordina per la SCALA, non per la sigla: in ordine
    // alfabetico verrebbe BAL, BAN, PAN, RIS, TIS, TIT, cioè nessun ordine.
    // Dall'01/09/2026 fra le due c'è la CATEGORIA, che è l'altra metà della stessa domanda («quanto
    // porta», dove la titolarità dice «quanto gioca»): le tre restano un blocco unico, e quello che
    // questo test protegge è che nessuno le separi mettendoci in mezzo una colonna di cifre.
    const keys = SQUAD_COLUMNS.map((one) => one.key);
    expect(keys).toContain('titolarita');
    expect(keys.indexOf('categoria')).toBe(keys.indexOf('titolarita') + 1);
    expect(keys.indexOf('expected')).toBe(keys.indexOf('categoria') + 1);
    expect(SORTABLE_COLUMNS).toContain('titolarita');
    expect(SORTABLE_COLUMNS).toContain('categoria');
  });

  it('è larga quanto tre caratteri e non di più', () => {
    // L'operatore ha chiesto TRE caratteri: la larghezza è la prova che nessuno ci rimetterà la parola
    // intera, che è quello che il tooltip già fa. La somma delle colonne accese decide quando la
    // tabella scorre di lato, quindi una colonna larga è un costo pagato da tutte le altre.
    const column = SQUAD_COLUMNS.find((one) => one.key === 'titolarita');
    expect(column?.width).toBeLessThanOrEqual(48);
    expect(Object.values(TITOLARITA_SHORT).every((code) => code.length === 3)).toBe(true);
    // ...e la categoria accanto obbedisce alla stessa regola, con la stessa ragione.
    expect(SQUAD_COLUMNS.find((one) => one.key === 'categoria')?.width).toBeLessThanOrEqual(48);
    expect(Object.values(CATEGORIA_SHORT).every((code) => code.length === 3)).toBe(true);
    // Due sigle uguali per due parole diverse renderebbero la colonna illeggibile: SCM e SCT esistono
    // per questo, e sono le due che una troncatura a tre avrebbe reso quasi identiche.
    expect(new Set(Object.values(CATEGORIA_SHORT)).size).toBe(CATEGORIA_LADDER.length);
  });

  it('porta la COSTANZA subito dopo la MVa, e la si può ordinare e filtrare', () => {
    // Le due colonne sono le due metà del voto BASE: la MVa dice il livello, la costanza quanto spesso
    // quel livello supera il 6, che è la soglia su cui pagano tutt'e due i modificatori di questa lega.
    // Lette lontane sono due numeri, lette accanto sono una frase, e quello che il test protegge è che
    // nessuno le separi. La colonna è arrivata il 01/09/2026 al posto della lettura 0-99 che l'operatore
    // aveva fatto togliere il 17/08: quella era un rank sul listone, questa è la QUOTA, perché le soglie
    // dei modificatori sono assolute e un rank non dice se supera il 6.
    const keys = SQUAD_COLUMNS.map((one) => one.key);
    expect(keys.indexOf('steady')).toBe(keys.indexOf('expectedMv') + 1);
    expect(SORTABLE_COLUMNS).toContain('steady');
    const column = SQUAD_COLUMNS.find((one) => one.key === 'steady');
    expect(column?.filter).toBe('range');
    expect(column?.align).toBe('right');
    // L'intestazione è troncata e il nome intero vive nel selettore, come per Tit. e Cat.: in 58px non
    // ci sta «Costanza», e una testa più larga del suo numero è larghezza pagata da tutte le altre.
    expect(column?.head).toBe('Cost.');
    expect(column?.label).toBe('Costanza');
  });

  it('porta tutt\'e due i surplus, uno accanto all\'altro', () => {
    const keys = SQUAD_COLUMNS.map((one) => one.key);
    expect(keys).toContain('surplus');
    expect(keys).toContain('surplusFielded');
    expect(keys.indexOf('surplusFielded')).toBe(keys.indexOf('surplus') + 1);
  });

  it('le chiama con due nomi diversi, perché sono due domande', () => {
    const byKey = new Map(SQUAD_COLUMNS.map((one) => [one.key, one.label]));
    expect(byKey.get('surplus')).toBe('Surplus');
    // «Lead» dal 18/08/2026 è la colonna dell'ASTA (lo zero marginale di rosa, la definizione
    // dell'operatore «Overall − rimpiazzo»), quindi questa è tornata «Margine»: un nome per domanda.
    expect(byKey.get('surplusFielded')).toBe('Margine');
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

/**
 * QUALI COLONNE SI POSSONO ORDINARE - e dove vive la garanzia vera, che non e' qui.
 *
 * Il difetto misurato in e2e il 18/08/2026: `nzSortFn` ordina `nzData`, e `nzData` sono le sole righe gia'
 * caricate, quindi ordinando per Overall si vedeva 95 in cima con un massimo di 99 sul listone. Un test
 * unitario non lo vede - in jsdom le righe non arrivano scorrendo e il `colgroup` non esiste - e il
 * template non e' leggibile da qui (esbuild non carica un `.html?raw` e `node:fs` non c'e' lato browser).
 * Quindi la verifica sta in `node scripts/e2e-table.mjs`, che apre un browser vero, ordina, scorre fino in
 * fondo e confronta la cima col massimo. Qui resta il vocabolario, che e' quello che il disco puo'
 * contenere: una chiave fuori da questo elenco torna al default invece di lasciare la tabella senz'ordine.
 */
describe('le colonne per cui si ordina', () => {
  it('ci sono tutte quelle di numeri, comprese le due fisse', () => {
    for (const key of ['role', 'name', 'overall', 'value', 'surplus', 'surplusFielded', 'expected']) {
      expect(SORTABLE_COLUMNS).toContain(key);
    }
  });

  it('non ci sono le due che portano badge: in ordine di ruolo reale non e una domanda', () => {
    expect(SORTABLE_COLUMNS).not.toContain('mantra');
    expect(SORTABLE_COLUMNS).not.toContain('codes');
  });

  it('ogni colonna ordinabile e una colonna che esiste', () => {
    // Una chiave che non e' fra le colonne offerte sarebbe un ordinamento per una colonna che nessuno
    // vede: `role` e `name` sono le due fisse e stanno fuori da SQUAD_COLUMNS di proposito.
    const offered = new Set([...SQUAD_COLUMNS.map((one) => one.key), 'role', 'name']);
    for (const key of SORTABLE_COLUMNS) expect(offered).toContain(key);
  });
});
