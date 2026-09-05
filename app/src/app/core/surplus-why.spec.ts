import {
  REBUILD_TOLERANCE,
  WhyColumns,
  WhyInput,
  coreFormula,
  explainSurplus,
  parseRungs,
} from './surplus-why';

/**
 * La pagina del «perche'» spiega un numero che non calcola, e questi test difendono esattamente quello.
 *
 * Due cose sole, e sono le due che rendono la pagina utile invece che decorativa: la SCALA si legge come
 * il foglio la scrive (compreso un gradino muto, che e' un'informazione e non un buco), e la
 * RICOSTRUZIONE si confronta col foglio invece di essere stampata accanto - un audit che stampa il numero
 * atteso senza confrontarlo risponde «nessun problema» dopo aver guardato niente.
 */
const COLUMNS: WhyColumns = {
  fmPrev: 6.7,
  mvPrev: 6.1,
  pvPrev: 30,
  sharePrev: 0.789,
  matchdaysPrev: 38,
  beta: 0.5,
  clubChange: false,
  minutesShare: 0.64,
  pvSeen: 2,
  roundsSeen: 2,
  fmSteps: 'R0:6.312;R19:6.312;R23:6.298',
  pvSteps: 'R0:20.7;R3:24.4;R20K10:26.3',
};

function input(over: Partial<WhyInput> = {}): WhyInput {
  return {
    fm: 7.916,
    pv: 26.7,
    replacement: 5.605,
    sheetSurplus: 61.7,
    confidence: 1,
    fmIsEstimate: false,
    pvIsEstimate: false,
    estBasis: null,
    estNote: null,
    anchor: 6.832,
    matchdays: 36,
    why: COLUMNS,
    factor: 1,
    ...over,
  };
}

describe('parseRungs', () => {
  it('legge un gradino per regola, con lo scarto rispetto al precedente', () => {
    const rungs = parseRungs('R0:20.7;R3:24.4;R20K10:26.3');
    expect(rungs.map((one) => one.key)).toEqual(['R0', 'R3', 'R20K10']);
    expect(rungs[0].delta).toBeNull(); // il primo e' il punto di partenza, non uno spostamento
    expect(rungs[1].delta).toBeCloseTo(3.7, 5);
    expect(rungs[2].delta).toBeCloseTo(1.9, 5);
  });

  it('una regola che non lo tocca resta a schermo MUTA, invece di sparire', () => {
    // «non lo tocca» e' un'informazione: chi legge deve poter distinguere una regola che ha taciuto da
    // una che non e' stata percorsa affatto.
    const rungs = parseRungs('R0:6.312;R19:6.312;R23:6.298');
    expect(rungs[1].silent).toBe(true);
    expect(rungs[1].value).toBeCloseTo(6.312, 5);
    expect(rungs[2].silent).toBe(false);
  });

  it('un valore VUOTO non e’ uno zero: la regola non ha prodotto un numero', () => {
    const rungs = parseRungs('R0:;R0c:6.05');
    expect(rungs[0].value).toBeNull();
    expect(rungs[0].silent).toBe(false);
    expect(rungs[1].value).toBeCloseTo(6.05, 5);
    // ...e lo scarto del secondo e' vuoto, perche' non c'e' un «prima» da cui contarlo
    expect(rungs[1].delta).toBeNull();
  });

  it('una stringa che non e’ una scala non produce gradini inventati', () => {
    expect(parseRungs(null)).toEqual([]);
    expect(parseRungs('')).toEqual([]);
    expect(parseRungs('non una scala')).toEqual([]);
  });
});

describe('explainSurplus', () => {
  it('ricostruisce il surplus del foglio e dichiara che torna', () => {
    const why = explainSurplus(input());
    expect(why.perPlayed).toBeCloseTo(2.311, 3);
    expect(why.rebuilt).toBeCloseTo(61.7, 1);
    expect(why.agrees).toBe(true);
  });

  it('...e dove NON torna lo dice, invece di stampare una catena plausibile', () => {
    const why = explainSurplus(input({ sheetSurplus: 40 }));
    expect(why.agrees).toBe(false);
    // il numero del foglio resta quello che la riga porta: la catena e' il sospetto, non la verita'
    expect(why.sheetSurplus).toBe(40);
  });

  it('la tolleranza copre l’arrotondamento del foglio e non un errore di modello', () => {
    const why = explainSurplus(input({ sheetSurplus: 61.7 + REBUILD_TOLERANCE * 0.9 }));
    expect(why.agrees).toBe(true);
    const wrong = explainSurplus(input({ sheetSurplus: 61.7 + REBUILD_TOLERANCE * 3 }));
    expect(wrong.agrees).toBe(false);
  });

  it('due numeri assenti non sono d’accordo per caso', () => {
    // Senza uno dei due non c'e' niente da confrontare, e dire «in disaccordo» accenderebbe un allarme
    // su ogni riga che il motore non prezza - che sono la meta' di un foglio di Serie A.
    const why = explainSurplus(input({ fm: null, pv: null, sheetSurplus: null }));
    expect(why.basis).toBe('none');
    expect(why.rebuilt).toBeNull();
    expect(why.agrees).toBe(true);
  });

  it('la CONFIDENZA di una stima e’ gia’ dentro il surplus del foglio, quindi entra anche nella catena', () => {
    const why = explainSurplus(
      input({ fmIsEstimate: true, confidence: 0.5, sheetSurplus: 61.7 * 0.5 }),
    );
    expect(why.basis).toBe('estimate');
    expect(why.agrees).toBe(true);
  });

  it('il PER GIORNATA e’ una divisione, e il PER PARTITA e’ un’altra unita’', () => {
    const why = explainSurplus(input());
    expect(why.sheetPerMatch).toBeCloseTo(61.7 / 36, 5);
    // Un uomo da mezza stagione rende molto per partita e poco per giornata: e' la dinamica che la
    // pagina esiste per mostrare, quindi i due numeri non possono essere lo stesso numero.
    expect(why.perPlayed).not.toBeCloseTo(why.sheetPerMatch!, 2);
  });

  it('il riprezzo dell’app e’ il surplus del foglio per il suo fattore, e si chiama in un altro modo', () => {
    const why = explainSurplus(input({ factor: 0.5 }));
    expect(why.sheetSurplus).toBe(61.7);
    expect(why.appSurplus).toBeCloseTo(30.85, 2);
    expect(why.appPerMatch).toBeCloseTo(30.85 / 36, 5);
  });

  it('senza le colonne del foglio la spiegazione esiste ancora, senza scala', () => {
    const why = explainSurplus(input({ why: null }));
    expect(why.fmRungs).toEqual([]);
    expect(why.pvRungs).toEqual([]);
    expect(why.rebuilt).toBeCloseTo(61.7, 1);
  });
});

describe('coreFormula', () => {
  it('scrive il core coi SUOI numeri, cosi’ si controlla a occhio', () => {
    // Col PUNTO: e' la regola dell'operatore del 05/09/2026, e questa formula sta accanto alle celle
    // della tabella - due separatori sullo stesso schermo sono la contraddizione che ha fatto nascere
    // quella regola.
    expect(coreFormula(COLUMNS, 6.05, false)).toBe('6.05 + 0.50 × (6.70 − 6.05) = 6.38');
  });

  it('per un PORTIERE non si stampa: quella formula non e’ la sua', () => {
    // Il core di un portiere parte dal voto base e sottrae i gol attesi del suo club. Una formula
    // sbagliata accanto al numero giusto e' peggio di nessuna formula.
    expect(coreFormula(COLUMNS, 4.9, true)).toBeNull();
  });

  it('...e nemmeno dove manca un pezzo del conto', () => {
    expect(coreFormula({ ...COLUMNS, fmPrev: null }, 6.05, false)).toBeNull();
    expect(coreFormula(COLUMNS, null, false)).toBeNull();
    expect(coreFormula(null, 6.05, false)).toBeNull();
  });
});
