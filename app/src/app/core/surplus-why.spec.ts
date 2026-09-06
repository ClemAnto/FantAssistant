import {
  REBUILD_TOLERANCE,
  WhyColumns,
  WhyInput,
  calibrationOf,
  coreFormula,
  explainSurplus,
  outcomeFloor,
  outcomeOf,
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

/**
 * L'ESITO, che e' la sola cosa in questa pagina capace di SMENTIRE il motore invece di descriverlo.
 *
 * Quello che i test difendono e' la disciplina attorno al numero, non il numero: il verso della
 * sottrazione (una convenzione sola, o due colonne si leggono al contrario a turno), il fatto che una
 * media su zero partite non esista, e che la soglia che decide chi puo' giudicare una fantamedia sia
 * quella del gate e non una scelta di schermo.
 */
describe('outcomeOf', () => {
  const actual = { rounds: 36, pv: 33, mv: 6.7, fm: 7.8, value: 257.5 };

  it('il verso della sottrazione e’ PREVISTO − REALE: positivo vuol dire ottimista', () => {
    const out = outcomeOf(actual, { fm: 6.412, pv: 26.8 }, 2)!;
    expect(out.pvGap).toBeCloseTo(26.8 - 33, 5);
    expect(out.pvGap).toBeLessThan(0);            // il motore lo dava per assente sei giornate in piu'
    expect(out.fmGap).toBeCloseTo(6.412 - 7.8, 5);
    expect(out.valuePred).toBeCloseTo(6.412 * 26.8, 3);
    expect(out.valueGap).toBeCloseTo(6.412 * 26.8 - 257.5, 3);
  });

  it('senza esito sul foglio non c’e’ un esito: e’ ogni foglio costruito oggi', () => {
    expect(outcomeOf(null, { fm: 6.4, pv: 26 }, 2)).toBeNull();
    expect(outcomeOf({ ...actual, rounds: null }, { fm: 6.4, pv: 26 }, 2)).toBeNull();
  });

  it('zero presenze e’ un ESITO, una media su zero partite non esiste', () => {
    // Si e' fatto male, e' partito, non ha piu' giocato: `pv` 0 e' un fatto e si legge, mentre `fm`
    // resta vuota e il suo scarto con lei - «vuoto = ignoto» dai due lati contemporaneamente.
    const out = outcomeOf({ rounds: 36, pv: 0, mv: null, fm: null, value: null },
                          { fm: 6.4, pv: 20 }, 2)!;
    expect(out.pvGap).toBe(20);
    expect(out.fmGap).toBeNull();
    expect(out.valueGap).toBeNull();
    expect(out.fmScorable).toBe(false);
  });

  it('la soglia della fantamedia e’ una QUOTA del calendario giudicato, come nel gate', () => {
    // `evaluate.scoring_floor`: 15 su 38 e' il 39% delle giornate previste, quindi su un esito piu'
    // corto la soglia scende con lui. Una soglia assoluta di 15 su un esito da 14 giornate non sarebbe
    // severa: sarebbe irraggiungibile, e la guardia smetterebbe di misurare invece di fallire.
    expect(outcomeFloor(36, 2)).toBe(14);
    expect(outcomeFloor(14, 24)).toBe(6);
    expect(outcomeFloor(38, null)).toBe(15);       // pre-stagione: il resto della stagione E' la stagione
    expect(outcomeFloor(2, 36)).toBe(3);           // mai sotto tre partite
  });
});

describe('calibrationOf', () => {
  const row = (pvPred: number, fmPred: number, pv: number, fm: number | null) =>
    outcomeOf({ rounds: 36, pv, mv: null, fm, value: fm == null ? null : fm * pv },
              { fm: fmPred, pv: pvPred }, 2);

  it('dice quanto si sbaglia E da che parte, che sono due cose indipendenti', () => {
    // Due righe che sbagliano di sei giornate in versi opposti: l'errore medio e' sei, lo scarto col
    // segno e' zero. Un errore senza il suo segno lascerebbe credere che il modello penda; uno scarto
    // senza l'errore, che sia preciso.
    const answer = calibrationOf([row(30, 6.5, 24, 6.5), row(24, 6.5, 30, 6.5)]);
    expect(answer.judged).toBe(2);
    expect(answer.pvError).toBeCloseTo(6, 5);
    expect(answer.pvBias).toBeCloseTo(0, 5);
  });

  it('la fantamedia ha il suo denominatore, e non e’ quello delle presenze', () => {
    // Chi ha giocato due partite ha una media fatta di due partite: entra nel conto delle presenze -
    // dove due partite sono l'esito - e resta fuori da quello della fantamedia, con la stessa soglia
    // che il gate applica. Il pannello STAMPA quel denominatore, o il numero accanto non si interpreta.
    const answer = calibrationOf([row(30, 6.5, 33, 7.0), row(20, 7.5, 2, 4.0)]);
    expect(answer.judged).toBe(2);
    expect(answer.fmJudged).toBe(1);
    expect(answer.fmFloor).toBe(14);
    expect(answer.fmError).toBeCloseTo(0.5, 5);
  });

  it('una lista senza esiti non produce numeri, e non produce zeri', () => {
    const answer = calibrationOf([null, null]);
    expect(answer.judged).toBe(0);
    expect(answer.pvError).toBeNull();
    expect(answer.pvBias).toBeNull();
    expect(answer.rounds).toBeNull();
  });
});

describe('il surplus realizzato', () => {
  const actual = { rounds: 36, pv: 30, mv: 6.4, fm: 7.0, value: 210 };
  const predicted = { fm: 6.5, pv: 26, replacement: 5.8, surplus: 18.2 };

  it('si conta con lo zero che il foglio PREVEDEVA, o lo scarto mescola due cose', () => {
    // Cambiando anche il rimpiazzo, la differenza col surplus previsto conterrebbe l'errore su
    // quest'uomo E lo spostamento del livello di rimpiazzo, che è un fatto sulla lega: non si
    // potrebbe attribuire a nessuna delle due. Si muove una variabile sola.
    const out = outcomeOf(actual, predicted, 2)!;
    expect(out.surplus).toBeCloseTo((7.0 - 5.8) * 30, 5);
    // ...e lo scarto è contro il surplus DEL FOGLIO, non contro una nostra ricostruzione
    expect(out.surplusGap).toBeCloseTo(18.2 - 36, 5);
  });

  it('chi non ha giocato ha reso ZERO, ed è un esito e non un vuoto', () => {
    // È il solo posto di questa pagina dove uno zero è una misura: il rimpiazzo ha giocato al posto
    // suo, quindi sopra di lui ha aggiunto esattamente niente. La fantamedia resta vuota - una media
    // su zero partite non esiste - e il surplus no.
    const out = outcomeOf({ rounds: 36, pv: 0, mv: null, fm: null, value: null }, predicted, 2)!;
    expect(out.surplus).toBe(0);
    expect(out.fm).toBeNull();
    expect(out.surplusGap).toBeCloseTo(18.2, 5);
  });

  it('senza il metro non si stampa un numero', () => {
    const out = outcomeOf(actual, { fm: 6.5, pv: 26 }, 2)!;
    expect(out.surplus).toBeNull();
    expect(out.surplusGap).toBeNull();
  });
});
