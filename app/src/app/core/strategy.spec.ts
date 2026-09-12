import { MantraModules } from './auction-value';
import {
  DEFAULT_READINGS,
  READINGS,
  SORTABLE_READINGS,
  RankedMan,
  ReadingRef,
  ReadingKey,
  StrategyBidder,
  StrategySetup,
  blockLabel,
  blocksOf,
  deepestRole,
  demandOf,
  gainOf,
  mantraBlocks,
  readingHas,
  readingIsRough,
  readingPair,
  readingShort,
  readingValue,
  readingsOf,
  roleDepth,
  shortSeason,
  wantsPlayedFootball,
  HEAVY_READINGS,
  SeasonFootball,
  WHOLE_CAREER,
  defaultSeasonOf,
  readRef,
  refText,
  seasonSample,
  seasonsFor,
  seasonsNeeded,
} from './strategy';

/**
 * Un rulebook mantra ridotto all'osso, con quello che serve a questa pagina: un posto che accetta UNA
 * scelta di ruoli (`DC/B`) - cioè la ragione per cui una rosa mantra non ha quote per ruolo - e un ruolo
 * (`B`) la cui domanda è più corta della stanza, che è il caso che il pavimento esiste per coprire.
 */
const SHAPES: MantraModules = {
  roles: ['Por', 'Dc', 'B', 'A', 'Pc'],
  slot_roles: { P: ['Por'], DC: ['Dc'], 'DC/B': ['Dc', 'B'], 'A/PC': ['A', 'Pc'] },
  modules: {
    'three-at-the-back': { D: ['DC', 'DC', 'DC/B'], M: [], T: [], A: ['A/PC'] },
  },
};

/**
 * ...e uno con QUATTRO LINEE, che serve alla regola del posto più arretrato: `C/T` è un posto della
 * trequarti (come nel rulebook vero), quindi un `c;t` ha il suo posto più indietro nella linea M.
 */
const DEEP = {
  roles: ['Por', 'Dc', 'B', 'C', 'T', 'A', 'Pc'],
  slot_roles: {
    P: ['Por'], DC: ['Dc'], 'DC/B': ['Dc', 'B'], C: ['C'],
    'C/T': ['C', 'T'], 'T/A': ['T', 'A'], 'A/PC': ['A', 'Pc'],
  },
  modules: {
    shape: { D: ['DC', 'DC', 'DC/B'], M: ['C', 'C'], T: ['C/T'], A: ['T/A', 'A/PC'] },
  },
};

const CLASSIC: StrategySetup = {
  game: 'classic',
  slots: { classic: { P: 3, D: 8, C: 8, A: 6 }, mantra: { por: 2, mov: 23 } },
  budget: 1000,
  auction: 'rilanci',
  teams: 8,
  view: 'all',
};

const MANTRA: StrategySetup = { ...CLASSIC, game: 'mantra', teams: 10 };

let next = 1;
const man = (over: Partial<StrategyBidder> = {}): StrategyBidder => ({
  fcId: next++,
  name: `Uomo ${next}`,
  club: 'Club',
  clubId: null,
  role: 'D',
  mantraCodes: ['Dc'],
  surplus: null,
  surplusIsEstimate: false,
  value: null,
  valueIsEstimate: false,
  swing: null,
  fm: null,
  mv: null,
  pv: null,
  minutes: null,
  steady: null,
  steadyWeight: 0,
  steadyNote: '',
  fvm: null,
  // Il conto delle giornate a riposo: questi test parlano di liste e di domanda, non di infortuni.
  outlook: {
    matchdays: null, base: null, basis: 'core', out: 0, window: null, insurance: 0,
    expected: null, factor: 1,
  },
  ...over,
});


/** Le due stagioni che il pacchetto dichiara, come ogni lettore le riceve. */
const SEASONS = { target: '2026-27', input: '2025-26' };

/** Un riferimento: una lettura E la stagione su cui si legge. */
const at = (key: ReadingKey, season: string | null = null): ReadingRef => ({ key, season });

/** Il calcio di una stagione, per un uomo che l'ha giocata. */
const football = (over: Partial<SeasonFootball> = {}): SeasonFootball => ({
  played: null, mv: null, fm: null, goals: null, assists: null,
  xg: null, xa: null, ga: null, frequencies: null, ...over,
});

/** ...e un uomo che porta una stagione sola. */
const withSeason = (season: string, one: Partial<SeasonFootball>, rest: Partial<StrategyBidder> = {}) =>
  man({ seasons: new Map([[season, football(one)]]), ...rest });

describe('demandOf', () => {
  it('su classic conta la stanza: otto difensori per otto partecipanti fanno 64', () => {
    const demand = demandOf(CLASSIC, null);
    expect(demand.get('D')).toBe(64);
    expect(demand.get('P')).toBe(24);
    expect(demand.get('A')).toBe(48);
  });

  it('su mantra i portieri sono un conto di rosa e il resto viene dalle forme', () => {
    const demand = demandOf({ ...MANTRA, slots: { ...MANTRA.slots, mantra: { por: 2, mov: 20 } } }, SHAPES);
    // Un `Por` per posto in porta e due portieri per squadra: il portiere sta fuori dalle linee dei moduli.
    expect(demand.get('Por')).toBe(20);
    // `Dc` prende i due posti centrali interi più metà del posto ibrido: 2,5 dei 4 posti della forma.
    expect(demand.get('Dc')).toBe(125);
    expect(demand.get('B')).toBe(25);
  });

  it('...e nessuna lista è più corta della stanza, o metà dei partecipanti non ha alternative', () => {
    // Con quattro uomini di movimento la quota di `B` è 5 su dieci partecipanti: il pavimento la porta a 10.
    const demand = demandOf({ ...MANTRA, slots: { ...MANTRA.slots, mantra: { por: 1, mov: 4 } } }, SHAPES);
    expect(demand.get('B')).toBe(10);
    expect(demand.get('Dc')).toBe(25);
  });

  it('senza il regolamento mantra non ci sono blocchi, e la pagina lo dichiara', () => {
    const demand = demandOf(MANTRA, null);
    // Nessuna forma da leggere: nessun blocco, perché il vocabolario dei ruoli è del regolamento.
    expect(demand.size).toBe(0);
  });
});

describe('mantraBlocks', () => {
  it('legge i ruoli dichiarati dal regolamento, nel suo ordine', () => {
    expect(mantraBlocks(SHAPES)).toEqual(['Por', 'Dc', 'B', 'A', 'Pc']);
  });

  it('...e quando non li dichiara li ricava dai posti, che è l\'altra cosa scritta nel file', () => {
    const { roles, ...silent } = SHAPES;
    expect(roles?.length).toBe(5);
    expect(mantraBlocks(silent)).toEqual(['Por', 'Dc', 'B', 'A', 'Pc']);
  });
});

describe('blockLabel', () => {
  it('«C» è un centrocampista a classic e un centrale a mantra: due mestieri, due parole', () => {
    expect(blockLabel('C', 'classic')).toBe('Centrocampisti');
    expect(blockLabel('C', 'mantra')).toBe('Centrali');
    expect(blockLabel('A', 'classic')).toBe('Attaccanti');
    expect(blockLabel('A', 'mantra')).toBe('Attaccanti esterni');
  });
});

describe('gainOf', () => {
  it('coi rilanci ordina il surplus, nel draft il valore', () => {
    const one = man({ surplus: 12, value: 300 });
    expect(gainOf(one, 'rilanci')).toBe(12);
    expect(gainOf(one, 'draft')).toBe(300);
  });

  it('vuoto resta vuoto e non diventa zero', () => {
    expect(gainOf(man({ surplus: null, value: 200 }), 'rilanci')).toBeNull();
    expect(gainOf(man({ surplus: 5, value: null }), 'draft')).toBeNull();
  });
});

describe('blocksOf', () => {
  const setup: StrategySetup = {
    ...CLASSIC,
    teams: 2,
    slots: { ...CLASSIC.slots, classic: { P: 1, D: 1, C: 1, A: 1 } },
  };

  it('ordina per gain, taglia alla domanda e non mette in classifica chi non ha un numero', () => {
    const pool = [
      man({ name: 'Meglio', surplus: 30 }),
      man({ name: 'Peggio', surplus: 10 }),
      man({ name: 'Medio', surplus: 20 }),
      man({ name: 'Ignoto', surplus: null }),
    ];
    const blocks = blocksOf({ pool, setup, rules: null });
    const defence = blocks.find((one) => one.role === 'D')!;
    expect(defence.demand).toBe(2);
    expect(defence.men.map((row) => row.man.name)).toEqual(['Meglio', 'Medio']);
    expect(defence.pool).toBe(4);
    expect(defence.unranked).toBe(1);
  });

  /**
   * IL SELETTORE ORDINA DAVVERO, E IL TAGLIO LO SEGUE (operatore, 06/09/2026).
   *
   * Non e' un effetto collaterale: la domanda taglia DOPO l'ordine, quindi scegliere una chiave cambia
   * anche chi resta in lista. Il test lo asserisce invece di lasciarlo scoprire a un tavolo.
   */
  it('ordina su una lettura qualunque quando gliela si chiede, e il taglio la segue', () => {
    const pool = [
      man({ name: 'Ricco', surplus: 30, swing: 1 }),
      man({ name: 'Spinto', surplus: 10, swing: 9 }),
      man({ name: 'Medio', surplus: 20, swing: 5 }),
    ];
    expect(
      blocksOf({ pool, setup, rules: null }).find((one) => one.role === 'D')!.men.map((r) => r.man.name),
    ).toEqual(['Ricco', 'Medio']);
    expect(
      blocksOf({ pool, setup, rules: null, sort: 'swing' })
        .find((one) => one.role === 'D')!
        .men.map((r) => r.man.name),
    ).toEqual(['Spinto', 'Medio']);
  });

  /** Chi quel numero non ce l'ha va in fondo: un ignoto non e' uno zero, nemmeno in un ordinamento. */
  it('mette in fondo chi non ha la lettura su cui si sta ordinando', () => {
    const pool = [
      man({ name: 'Senza', surplus: 30, swing: null }),
      man({ name: 'Con', surplus: 10, swing: 2 }),
    ];
    const defence = blocksOf({ pool, setup, rules: null, sort: 'swing' }).find(
      (one) => one.role === 'D',
    )!;
    expect(defence.men.map((row) => row.man.name)).toEqual(['Con', 'Senza']);
    // ...e resta in lista col suo gain: ordinarlo per ultimo non e' toglierlo.
    expect(defence.unranked).toBe(0);
  });

  it('nel draft la stessa lista può invertirsi, perché la valuta è un\'altra', () => {
    const pool = [
      man({ name: 'Surplus alto', surplus: 30, value: 100 }),
      man({ name: 'Valore alto', surplus: 10, value: 400 }),
    ];
    const raises = blocksOf({ pool, setup, rules: null }).find((one) => one.role === 'D')!;
    const draft = blocksOf({ pool, setup: { ...setup, auction: 'draft' }, rules: null }).find(
      (one) => one.role === 'D',
    )!;
    expect(raises.men[0].man.name).toBe('Surplus alto');
    expect(draft.men[0].man.name).toBe('Valore alto');
  });

  it('su mantra un uomo con due codici sta in tutt\'e due i blocchi', () => {
    const both = man({ name: 'Braccetto', mantraCodes: ['Dc', 'B'], surplus: 15 });
    const only = man({ name: 'Centrale', mantraCodes: ['Dc'], surplus: 25 });
    const blocks = blocksOf({ pool: [both, only], setup: MANTRA, rules: SHAPES });
    const centre = blocks.find((one) => one.role === 'Dc')!;
    const wide = blocks.find((one) => one.role === 'B')!;
    expect(centre.men.map((row) => row.man.name)).toEqual(['Centrale', 'Braccetto']);
    expect(wide.men.map((row) => row.man.name)).toEqual(['Braccetto']);
  });

  it('e i ruoli accanto al nome sono quelli del gioco che si sta giocando', () => {
    const one = man({ role: 'D', mantraCodes: ['Dc', 'B'], surplus: 15 });
    const classic = blocksOf({ pool: [one], setup, rules: null }).find((block) => block.role === 'D')!;
    const mantra = blocksOf({ pool: [one], setup: MANTRA, rules: SHAPES }).find(
      (block) => block.role === 'Dc',
    )!;
    expect(classic.men[0].shown).toEqual(['D']);
    expect(mantra.men[0].shown).toEqual(['Dc', 'B']);
  });

  it('un blocco senza nessuno lo dice invece di sparire', () => {
    const blocks = blocksOf({ pool: [man({ role: 'D', surplus: 5 })], setup, rules: null });
    const keepers = blocks.find((one) => one.role === 'P')!;
    expect(keepers.men).toEqual([]);
    expect(keepers.pool).toBe(0);
    expect(blocks.map((one) => one.role)).toEqual(['P', 'D', 'C', 'A']);
  });

  it('la stima è marcata, perché una stima che si legge come una misura è la cosa peggiore', () => {
    const pool = [man({ surplus: 9, surplusIsEstimate: true })];
    const block = blocksOf({ pool, setup, rules: null }).find((one) => one.role === 'D')!;
    expect(block.men[0].estimated).toBe(true);
  });
});

describe('roleDepth', () => {
  it('legge dai moduli la linea più arretrata di ogni ruolo, e il portiere sta prima di tutte', () => {
    const depth = roleDepth(DEEP);
    expect(depth.get('por')).toBe(0);
    expect(depth.get('dc')).toBe(1);
    expect(depth.get('b')).toBe(1);
    expect(depth.get('c')).toBe(2);
    expect(depth.get('t')).toBe(3);
    expect(depth.get('a')).toBe(4);
  });
});

describe('deepestRole', () => {
  it("un C/T è un C, un T/A è un T, un Dc/B è un Dc: la regola dell'operatore, letta dal rulebook", () => {
    expect(deepestRole(['C', 'T'], DEEP)).toBe('C');
    expect(deepestRole(['T', 'A'], DEEP)).toBe('T');
    expect(deepestRole(['A', 'Pc'], DEEP)).toBe('A');
    expect(deepestRole(['Dc', 'B'], DEEP)).toBe('Dc');
  });

  it('...e di chi non porta un ruolo leggibile non si dice niente', () => {
    expect(deepestRole([], DEEP)).toBeNull();
    expect(deepestRole(['Sconosciuto'], DEEP)).toBeNull();
    expect(deepestRole(['C'], null)).toBeNull();
  });
});

describe('come si legge un blocco', () => {
  const setup: StrategySetup = {
    ...CLASSIC,
    game: 'mantra',
    teams: 10,
    slots: { ...CLASSIC.slots, mantra: { por: 2, mov: 20 } },
    view: 'all',
  };
  const flexible = man({ name: 'Mezzala', mantraCodes: ['C', 'T'], surplus: 30 });
  const pure = man({ name: 'Trequartista', mantraCodes: ['T', 'A'], surplus: 10 });

  it('MARCA E NON RIORDINA: il gain ordina, e chi ha un posto più arretrato porta il suo marchio', () => {
    // Mettere davanti i nativi porta la somma dei gain del blocco T da 256 a MENO 9 sul foglio vero:
    // una lista i cui primi nomi valgono meno del rimpiazzo non è una lista da cui comprare.
    const block = blocksOf({ pool: [flexible, pure], setup, rules: DEEP }).find(
      (one) => one.role === 'T',
    )!;
    expect(block.men.map((row) => row.man.name)).toEqual(['Mezzala', 'Trequartista']);
    expect(block.men[0].fromBehind).toBe(true);
    expect(block.men[0].deepest).toBe('C');
    expect(block.men[1].fromBehind).toBe(false);
    expect(block.natives).toBe(1);
  });

  it('«solo di mestiere» tiene chi non può giocare più arretrato, e conta quelli che esistono', () => {
    const block = blocksOf({ pool: [flexible, pure], setup: { ...setup, view: 'natives' }, rules: DEEP })
      .find((one) => one.role === 'T')!;
    expect(block.men.map((row) => row.man.name)).toEqual(['Trequartista']);
    expect(block.nativePool).toBe(1);
    // ...e nel blocco dei centrali il polivalente è di mestiere, quindi ci resta.
    const centre = blocksOf({ pool: [flexible, pure], setup: { ...setup, view: 'natives' }, rules: DEEP })
      .find((one) => one.role === 'C')!;
    expect(centre.men.map((row) => row.man.name)).toEqual(['Mezzala']);
  });

  it('IL PREZZO DI QUELLA LETTURA è un blocco vuoto, e il blocco deve poterlo dire', () => {
    // Ogni braccetto quotato è anche un Dc o un Dd: sul listone vero quel blocco resta a ZERO nomi su
    // 12 (misurato il 27/08/2026 su tutt'e due i listoni), e `nativePool` è come la pagina lo spiega.
    const braccetto = man({ name: 'Braccetto', mantraCodes: ['Dc', 'B'], surplus: 12 });
    const all = blocksOf({ pool: [braccetto], setup, rules: DEEP }).find((one) => one.role === 'B')!;
    expect(all.men.map((row) => row.man.name)).toEqual(['Braccetto']);
    expect(all.men[0].fromBehind).toBe(true);
    expect(all.natives).toBe(0);
    const natives = blocksOf({ pool: [braccetto], setup: { ...setup, view: 'natives' }, rules: DEEP })
      .find((one) => one.role === 'B')!;
    expect(natives.men).toEqual([]);
    expect(natives.pool).toBe(1);
    expect(natives.nativePool).toBe(0);
  });

  it('su classic la domanda non esiste, quindi nessuno «arriva da dietro»', () => {
    const block = blocksOf({
      pool: [man({ role: 'D', mantraCodes: ['Dc', 'B'], surplus: 5 })],
      setup: { ...CLASSIC, teams: 2, view: 'natives' },
      rules: DEEP,
    }).find((one) => one.role === 'D')!;
    expect(block.men[0].fromBehind).toBe(false);
    expect(block.men[0].deepest).toBeNull();
    expect(block.natives).toBe(1);
  });
});

describe("l'ordine personale dentro un blocco", () => {
  const setup: StrategySetup = {
    ...CLASSIC,
    teams: 2,
    slots: { ...CLASSIC.slots, classic: { P: 1, D: 1, C: 1, A: 1 } },
  };
  const pool = [
    man({ fcId: 101, name: 'Primo', surplus: 30 }),
    man({ fcId: 102, name: 'Secondo', surplus: 20 }),
    man({ fcId: 103, name: 'Terzo', surplus: 10 }),
  ];

  it('mette i suoi nomi in cima e DICE quanti sono', () => {
    const block = blocksOf({
      pool,
      setup,
      rules: null,
      priority: new Map([['D', [103]]]),
    }).find((one) => one.role === 'D')!;
    expect(block.men.map((row) => row.man.name)).toEqual(['Terzo', 'Primo']);
    expect(block.pinned).toBe(1);
  });

  it('e si applica PRIMA del taglio, o un nome sistemato in fondo non si vedrebbe mai', () => {
    // La domanda è 2, quindi «Terzo» sarebbe tagliato: sistemato, deve restare a schermo.
    const block = blocksOf({
      pool,
      setup,
      rules: null,
      priority: new Map([['D', [103]]]),
    }).find((one) => one.role === 'D')!;
    expect(block.demand).toBe(2);
    expect(block.men.map((row) => row.man.fcId)).toContain(103);
  });

  it('senza un ordine suo nessun blocco ne dichiara uno', () => {
    const blocks = blocksOf({ pool, setup, rules: null });
    expect(blocks.every((one) => one.pinned === 0)).toBe(true);
  });
});

describe('il filtro dentro un blocco', () => {
  const setup: StrategySetup = {
    ...CLASSIC,
    teams: 2,
    slots: { ...CLASSIC.slots, classic: { P: 1, D: 1, C: 1, A: 1 } },
  };
  const pool = [
    man({ fcId: 101, name: 'Primo', surplus: 30, pv: 30 }),
    man({ fcId: 102, name: 'Secondo', surplus: 20, pv: 10 }),
    man({ fcId: 103, name: 'Terzo', surplus: 10, pv: 28 }),
  ];
  const keepPlayers = (row: RankedMan) => (row.man.pv ?? 0) >= 25;

  /**
   * SI FILTRA PRIMA DEL TAGLIO: un filtro serve a TROVARE i nomi che rispondono, e applicandolo dopo
   * risponderebbe solo su quelli che la stanza comprerà comunque - cioè su una lista in cui si stava
   * già guardando. La domanda è 2 e «Terzo» è il terzo per surplus: senza filtro non si vede.
   */
  it('trova anche i nomi che il taglio alla domanda avrebbe tolto', () => {
    const block = blocksOf({ pool, setup, rules: null, keep: keepPlayers })
      .find((one) => one.role === 'D')!;
    expect(block.men.map((row) => row.man.name)).toEqual(['Primo', 'Terzo']);
    expect(block.dropped).toBe(1);
  });

  /**
   * ...E IL POSTO RESTA QUELLO VERO, che è quello che `RankedMan.at` promette di sé: rinumerare da uno
   * le righe rimaste direbbe che il terzo difensore è il secondo.
   */
  it('non rinumera niente: il posto è quello della lista intera', () => {
    const block = blocksOf({ pool, setup, rules: null, keep: keepPlayers })
      .find((one) => one.role === 'D')!;
    expect(block.men.map((row) => row.at)).toEqual([0, 2]);
  });

  it('la lunghezza resta la domanda della stanza, non il numero di chi passa', () => {
    const block = blocksOf({ pool, setup, rules: null, keep: () => true })
      .find((one) => one.role === 'D')!;
    expect(block.demand).toBe(2);
    expect(block.men.length).toBe(2);
    expect(block.dropped).toBe(0);
  });

  /**
   * I NOMI SISTEMATI A MANO CHE IL FILTRO HA TOLTO NON SI CONTANO PIÙ: «i primi due vengono dalla tua
   * lista» detto su una lista da cui uno è uscito è una frase falsa sul confine fra preferenza e misura.
   */
  it('conta i nomi sistemati che restano, non quelli che erano', () => {
    const block = blocksOf({
      pool,
      setup,
      rules: null,
      priority: new Map([['D', [102, 103]]]),
      keep: keepPlayers,
    }).find((one) => one.role === 'D')!;
    // Sistemati: 102 e 103. Il filtro toglie 102, quindi ne resta uno solo in cima.
    expect(block.men.map((row) => row.man.fcId)).toEqual([103, 101]);
    expect(block.pinned).toBe(1);
  });

  it('senza predicato non si filtra affatto, e nessun blocco dichiara di aver tolto qualcosa', () => {
    const blocks = blocksOf({ pool, setup, rules: null });
    expect(blocks.every((one) => one.dropped === 0)).toBe(true);
  });
});

describe('le tre pastiglie di una riga', () => {
  it('quanto rende una sua partita e la fantamedia attesa MENO il sei, non un punteggio a giornata', () => {
    // Il 6 e' la media di riferimento di un voto (`EDGE_BASE`), e la lettura e' PER PARTITA GIOCATA:
    // quante ne gioca lo dice il numero accanto, e schiacciare i due fatti in una cifra e' esattamente
    // quello che l'operatore aveva fatto ritirare sulla plancia il 03/09/2026.
    expect(readingsOf(man({ fm: 7.5 })).edge).toBeCloseTo(1.5, 6);
    expect(readingsOf(man({ fm: 5.7 })).edge).toBeCloseTo(-0.3, 6);
  });

  it('...e senza una fantamedia non dice zero: uno zero si leggerebbe «rende esattamente il sei»', () => {
    expect(readingsOf(man({ fm: null })).edge).toBeNull();
  });

  it('le partite buone sono le presenze attese per la quota di sufficienze MISURATA', () => {
    const one = readingsOf(man({ pv: 30, steady: 0.7, steadyWeight: 1 }));
    expect(one.played).toBe(30);
    expect(one.passed).toBeCloseTo(21, 6);
    expect(one.passedIsHis).toBe(true);
  });

  it('una quota che viene quasi tutta dall ancora del ruolo si DICHIARA spannometrica', () => {
    // `MOSTLY_ANCHOR` = 0,5: sotto quella soglia il numero e' del suo ruolo al suo club, non suo. Una
    // stima che si legge come una misura e' la cosa peggiore che una lista possa fare.
    expect(readingsOf(man({ pv: 30, steady: 0.6, steadyWeight: 0 })).passedIsHis).toBe(false);
    expect(readingsOf(man({ pv: 30, steady: 0.6, steadyWeight: 0.5 })).passedIsHis).toBe(true);
  });

  it('senza presenze o senza costanza il secondo numero manca invece di valere zero', () => {
    expect(readingsOf(man({ pv: null, steady: 0.7 })).passed).toBeNull();
    expect(readingsOf(man({ pv: 30, steady: null })).passed).toBeNull();
    // ...ma le presenze restano: e' l'altra meta' della stessa pastiglia e la sa il foglio.
    expect(readingsOf(man({ pv: 30, steady: null })).played).toBe(30);
  });

  it('i minuti sono quelli del foglio e non si inventano: 244 righe di 602 non li portano', () => {
    expect(readingsOf(man({ minutes: 75 })).minutes).toBe(75);
    expect(readingsOf(man({ minutes: null })).minutes).toBeNull();
  });

  it('ogni riga in classifica se le porta dietro, o la pastiglia sarebbe un oggetto nuovo a ogni giro', () => {
    const block = blocksOf({
      pool: [man({ fcId: 501, surplus: 10, fm: 6.4, pv: 28, minutes: 66, steady: 0.75, steadyWeight: 1 })],
      setup: CLASSIC,
      rules: null,
    }).find((one) => one.role === 'D')!;
    const row = block.men[0];
    expect(row.readings.edge).toBeCloseTo(0.4, 6);
    expect(row.readings.passed).toBeCloseTo(21, 6);
    expect(row.readings.minutes).toBe(66);
    // Lo stesso oggetto a ogni lettura della riga: e' quello che un template puo' confrontare.
    expect(row.readings).toBe(block.men[0].readings);
  });
});

describe('le sette letture di una riga', () => {
  it("IL BPM È `FM − MV` e non «sopra il 6»: sono due domande, e questo è il nome che l'operatore ha dato alla prima", () => {
    // La definizione è la sua, dettata il 18/08/2026 per la colonna «Bonus»: i bonus da soli, FMa − MVa.
    expect(readingsOf(man({ fm: 7.5, mv: 6.2 })).bonus).toBeCloseTo(1.3, 6);
    // ...mentre `edge` resta l'altra domanda, quella della plancia, e vive accanto senza mescolarsi.
    expect(readingsOf(man({ fm: 7.5, mv: 6.2 })).edge).toBeCloseTo(1.5, 6);
  });

  it('una sottrazione con un termine ignoto è IGNOTA, non zero', () => {
    expect(readingsOf(man({ fm: 7.5, mv: null })).bonus).toBeNull();
    expect(readingsOf(man({ fm: null, mv: 6.2 })).bonus).toBeNull();
  });

  it('ogni sigla pesca il proprio numero, e nessuna ne inventa uno', () => {
    const readings = readingsOf(withSeason(
      SEASONS.target,
      { played: 2, mv: 6.25, fm: 8.5 },
      { fm: 7, mv: 6, pv: 30, steady: 0.5, steadyWeight: 1, minutes: 78, fvm: 210 },
    ));
    expect(readingValue(at('bonus'), readings)).toBeCloseTo(1, 6);
    expect(readingValue(at('played'), readings)).toBe(30);
    expect(readingValue(at('passed'), readings)).toBe(15);
    expect(readingValue(at('minutes'), readings)).toBe(78);
    expect(readingValue(at('fvm'), readings)).toBe(210);
  });

  /**
   * LA STESSA LETTURA SU DUE STAGIONI E' DUE NUMERI (operatore, 12/09/2026), ed e' il fatto che rende
   * possibile la sua domanda: «mv > 7 quest'anno e mv < 6 l'anno scorso».
   */
  it('la stessa lettura su due stagioni da due numeri', () => {
    const readings = readingsOf(man({
      seasons: new Map([
        [SEASONS.target, football({ mv: 7.4, played: 3 })],
        [SEASONS.input, football({ mv: 5.8, played: 34 })],
      ]),
    }));
    expect(readingValue(at('mv', SEASONS.target), readings)).toBe(7.4);
    expect(readingValue(at('mv', SEASONS.input), readings)).toBe(5.8);
    // ...e una stagione che nessuno ha chiesto e' IGNOTA, non zero.
    expect(readingValue(at('mv', '2024-25'), readings)).toBeNull();
    // Il campione lo dichiara la stagione, non la riga: due medie, due denominatori.
    expect(seasonSample(SEASONS.target, readings)).toBe(3);
    expect(seasonSample(SEASONS.input, readings)).toBe(34);
  });

  it('LA TITOLARITA ORDINA PER LA SCALA e non per la sigla, che darebbe l’alfabeto', () => {
    // Richiesta dell'operatore, 07/09/2026. Ordinando per le tre lettere si leggerebbe BAL, BAN, PAN,
    // RIS, TIS, TIT: il gradino 4 in cima e il 3 in fondo. La chiave e' il rango della scala col segno
    // meno, perche' la lista scende e `bandiera` e' lo zero.
    const rank = (rung: string | null) =>
      readingValue(at('titolarita'), readingsOf(man({ titolarita: rung })));
    expect(rank('bandiera')).toBe(-0);
    expect(rank('ballottaggio')).toBe(-3);
    expect(rank('riserva')).toBe(-5);
    expect(rank('bandiera')!).toBeGreaterThan(rank('riserva')!);
    // Una parola che la scala non conosce, e il vuoto: ignoti, quindi vanno in fondo e non in mezzo.
    expect(rank('boh')).toBeNull();
    expect(rank(null)).toBeNull();
  });

  it('e’ l’UNICA lettura che porta una parola, dichiarata come tale', () => {
    // `word` dice a chi disegna di non passare da `DecimalPipe`: un formato numerico su una stringa
    // stampa `NaN`. Asserito che l'eccezione e' una sola, cosi' una seconda non entra in silenzio.
    expect(READINGS.filter((one) => one.word).map((one) => one.key)).toEqual(['titolarita']);
  });

  it('i gol e gli assist sono PER PARTITA come i loro attesi, e uno zero non e un vuoto', () => {
    // Le due misurate accanto alle due attese, nella stessa unita' (sua correzione del 05/09/2026):
    // `G 0,50` accanto a `xG 0,45` e' una frase, `G 1` accanto a `xG 0,45` sono due cifre che non si
    // confrontano. Zero e' un fatto - ha giocato e non ha segnato - e va distinto dal vuoto.
    const scored = readingsOf(withSeason(SEASONS.target, { goals: 0, assists: 0.5 }));
    expect(readingValue(at('goals', SEASONS.target), scored)).toBe(0);
    expect(readingValue(at('assists', SEASONS.target), scored)).toBe(0.5);
    const unknown = readingsOf(man({ fm: 7 }));
    expect(readingValue(at('goals', SEASONS.target), unknown)).toBeNull();
    expect(readingValue(at('assists', SEASONS.target), unknown)).toBeNull();
  });

  it('xG e xA sono gli ATTESI della stagione scelta, e vuoti non sono zeri', () => {
    const his = readingsOf(withSeason(SEASONS.target, { xg: 0.41, xa: 0.08 }));
    expect(readingValue(at('xg', SEASONS.target), his)).toBe(0.41);
    expect(readingValue(at('xa', SEASONS.target), his)).toBe(0.08);
    // La fonte non pubblica gli attesi per tutte le stagioni: li' la pastiglia non ha un numero, e un
    // trattino dice «non lo so» mentre uno zero direbbe «non ha mai tirato».
    const nobody = readingsOf(man({ fm: 7, mv: 6 }));
    expect(readingValue(at('xg', SEASONS.target), nobody)).toBeNull();
    expect(readingValue(at('xa', SEASONS.target), nobody)).toBeNull();
  });

  it('MV E FM SONO QUELLE MISURATE, non le previste (operatore, 05/09/2026)', () => {
    // Le previste restano dentro il `bonus`, che è il tasso ATTESO: due nature, due nomi.
    const readings = readingsOf(withSeason(
      SEASONS.target, { played: 2, mv: 6.25, fm: 8.5 }, { fm: 7, mv: 6 },
    ));
    expect(readingValue(at('mv', SEASONS.target), readings)).toBe(6.25);
    expect(readingValue(at('fm', SEASONS.target), readings)).toBe(8.5);
    expect(readingValue(at('bonus'), readings)).toBeCloseTo(1, 6);
    expect(seasonSample(SEASONS.target, readings)).toBe(2);
  });

  it('chi non ha ancora giocato non ha una media: vuoto, e non uno zero', () => {
    const readings = readingsOf(man({ fm: 7, mv: 6 }));
    expect(readingValue(at('mv', SEASONS.target), readings)).toBeNull();
    expect(readingValue(at('fm', SEASONS.target), readings)).toBeNull();
  });

  it('SOLO le partite sufficienti possono essere spannometriche, perché solo loro portano una quota misurata', () => {
    const his = readingsOf(man({ pv: 30, steady: 0.5, steadyWeight: 1 }));
    const anchor = readingsOf(man({ pv: 30, steady: 0.5, steadyWeight: 0 }));
    expect(readingIsRough(at('passed'), his)).toBe(false);
    expect(readingIsRough(at('passed'), anchor)).toBe(true);
    for (const key of ['bonus', 'played', 'minutes', 'fvm'] as const) {
      expect(readingIsRough(at(key), anchor)).toBe(false);
    }
    expect(readingIsRough(at('mv', SEASONS.target), anchor)).toBe(false);
  });

  it("le accese all'inizio sono LE PRIME TRE dell'elenco dichiarato, non tre a caso", () => {
    expect(DEFAULT_READINGS).toEqual(READINGS.slice(0, 3).map((one) => one.key));
  });

  it('ogni lettura dichiara come si stampa e quanto è larga, o le pastiglie non sarebbero incolonnate', () => {
    for (const spec of READINGS) {
      expect(spec.format).toMatch(/^1\.\d-\d$/);
      expect(spec.width).toMatch(/^min-w-/);
    }
  });

  /**
   * LE SIGLE STANNO IN TRE CARATTERI, CON UNA ECCEZIONE DICHIARATA, e l'asserto e' STRETTO invece che
   * allargato.
   *
   * La regola nasceva perche' la fila delle pastiglie in barra deve restare compatta. Il 06/09/2026
   * l'operatore ha dichiarato che il termine e' SWING e non si abbrevia, che e' una sua decisione sul
   * vocabolario e non una misura. Allargare la soglia a cinque per tutti sarebbe «un criterio non si
   * allarga perche' un caso ci e' caduto»: qui si asserisce che l'eccezione e' UNA SOLA e si chiama
   * SWING, cosi' una seconda sigla lunga non entra in silenzio.
   */
  it('le sigle stanno in tre caratteri, e la sola eccezione e SWING', () => {
    const long = READINGS.filter((one) => one.short.length > 3);
    expect(long.map((one) => one.short)).toEqual(['SWING']);
    for (const spec of READINGS.filter((one) => one.short.length <= 3)) {
      expect(spec.short.length).toBeGreaterThan(0);
    }
  });
});


describe('le letture che costano un caricamento', () => {
  const refs = (...keys: ReadingKey[]) =>
    keys.map((key) => ({ key, season: SEASONS.target }));

  it("una pastiglia che non c'entra col livello per-partita non ne chiede nemmeno una riga", () => {
    // La prova che serve non e' sul valore: e' che il RISULTATO non cambia accendendo e spegnendo le
    // altre. `pool` dipende da questa risposta - non dall'elenco - quindi un true/false stabile e'
    // esattamente cio' che tiene ferme le seicento righe mentre si accende `Bpm`.
    expect(wantsPlayedFootball(refs('bonus', 'played', 'passed'))).toBe(false);
    expect(wantsPlayedFootball(refs('minutes', 'fvm', 'paid', 'swing'))).toBe(false);
    expect(wantsPlayedFootball([])).toBe(false);
  });

  /**
   * LA MEDIA VOTO NON COSTA, e da qui viene la meta' economica della richiesta del 12/09/2026: chiedere
   * la MV di un'altra stagione e' gratis (l'aggregato ne porta undici ed e' gia' in casa), chiedere i
   * suoi xG no. Se un giorno `mv` diventasse `heavy`, cambiare stagione su una lista di seicento nomi
   * costerebbe un caricamento - e questo asserto e' quello che lo direbbe.
   */
  it('la media voto e la fantamedia NON costano un caricamento, gli attesi si', () => {
    expect(wantsPlayedFootball(refs('mv', 'fm'))).toBe(false);
    expect(wantsPlayedFootball(refs('xg'))).toBe(true);
    expect([...HEAVY_READINGS].sort())
      .toEqual(['assists', 'bonusMatch', 'ga', 'goals', 'goodMatch', 'longPlay', 'poorMatch', 'xa', 'xg']);
  });

  /**
   * SI CARICANO SOLO LE STAGIONI CHIESTE, e una lettura che non costa non ne fa caricare nessuna: e'
   * quello che rende gratis avere `MV 24/25` accanto a `MV 26/27`.
   */
  it('dice quali stagioni ricostruire, e solo per le letture che costano', () => {
    expect(seasonsNeeded([
      { key: 'xg', season: '2026-27' },
      { key: 'mv', season: '2024-25' },
      { key: 'ga', season: '2025-26' },
      { key: 'xg', season: '2026-27' },
      { key: 'bonus', season: null },
    ])).toEqual(['2026-27', '2025-26']);
    expect(seasonsNeeded([])).toEqual([]);
  });

  it('le frequenze chiedono TUTTO il calcio, che e una finestra e non una stagione', () => {
    const whole = READINGS.filter((one) => one.whole).map((one) => one.key);
    expect([...whole].sort()).toEqual(['bonusMatch', 'goodMatch', 'longPlay', 'poorMatch']);
    for (const key of whole) {
      const spec = READINGS.find((one) => one.key === key)!;
      expect(defaultSeasonOf(spec, SEASONS)).toBe(WHOLE_CAREER);
      expect(seasonsNeeded([{ key, season: WHOLE_CAREER }])).toEqual([WHOLE_CAREER]);
      // ...e possono anche prendere una stagione sola, che e' la scelta di chi la chiede.
      expect(seasonsFor(spec, ['2026-27'])).toEqual([WHOLE_CAREER, '2026-27']);
    }
    // Una lettura stagionale che NON e' una frequenza non offre «tutte»: la media voto di tutte le
    // stagioni insieme non e' un numero che qualcuno abbia misurato.
    expect(seasonsFor(READINGS.find((one) => one.key === 'mv')!, ['2026-27'])).toEqual(['2026-27']);
    expect(seasonsFor(READINGS.find((one) => one.key === 'played')!, ['2026-27'])).toEqual([]);
  });
});

/**
 * IL RIFERIMENTO `chiave@stagione` (operatore, 12/09/2026), e la MIGRAZIONE delle due `G:A`.
 */
describe('una lettura e la sua stagione', () => {
  it('si scrive e si rilegge, e la stagione di default viene dal pacchetto', () => {
    expect(refText({ key: 'mv', season: '2025-26' })).toBe('mv@2025-26');
    expect(refText({ key: 'bonus', season: null })).toBe('bonus');
    expect(readRef('mv@2025-26', SEASONS)).toEqual({ key: 'mv', season: '2025-26' });
    // Una lettura stagionale senza stagione scritta cade sul suo default, che e' un fatto del manifest.
    expect(readRef('mv', SEASONS)).toEqual({ key: 'mv', season: SEASONS.target });
    expect(readRef('bonus', SEASONS)).toEqual({ key: 'bonus', season: null });
  });

  /**
   * LE DUE COPPIE SI MIGRANO invece di essere buttate: erano la stessa lettura con la stagione cablata
   * nella chiave, e chi le aveva accese ieri deve ritrovarle accese oggi.
   */
  it('le due vecchie G:A diventano la stessa lettura su due stagioni', () => {
    expect(readRef('gaPrev', SEASONS)).toEqual({ key: 'ga', season: SEASONS.input });
    expect(readRef('gaNow', SEASONS)).toEqual({ key: 'ga', season: SEASONS.target });
    expect(READINGS.filter((one) => one.key === 'ga').length).toBe(1);
  });

  it('quello che questa versione non capisce piu non ordina e non si disegna', () => {
    expect(readRef('una-lettura-che-non-esiste', SEASONS)).toBeNull();
    expect(readRef('', SEASONS)).toBeNull();
    expect(readRef(42, SEASONS)).toBeNull();
  });
});

/**
 * LE QUATTRO FREQUENZE (operatore, 12/09/2026), viste dal lato della riga.
 *
 * Quello che si misura sta in `match-frequency.spec.ts`; qui si prova la cosa che questo file possiede:
 * l'UNITA' in cui quel numero arriva a schermo, e quando va sbiadito.
 */
describe('le quattro frequenze sulla riga', () => {
  const counted = {
    played: 30, timed: 30, rated: 30, long: 0.6, good: 0.4, bonus: 0.2, poor: 0.1, synthetic: false,
  };
  const FREQUENCIES: ReadingKey[] = ['longPlay', 'goodMatch', 'bonusMatch', 'poorMatch'];

  it('si leggono in percentuale, che e anche l unita in cui si scrive un filtro', () => {
    const one = readingsOf(withSeason(WHOLE_CAREER, { frequencies: counted }));
    expect(readingValue(at('longPlay', WHOLE_CAREER), one)).toBeCloseTo(60, 10);
    expect(readingValue(at('goodMatch', WHOLE_CAREER), one)).toBeCloseTo(40, 10);
    expect(readingValue(at('bonusMatch', WHOLE_CAREER), one)).toBeCloseTo(20, 10);
    expect(readingValue(at('poorMatch', WHOLE_CAREER), one)).toBeCloseTo(10, 10);
  });

  /**
   * ...E SU UNA STAGIONE SOLA, che e' la meta' nuova (operatore, 12/09/2026): la stessa quota misurata
   * su una finestra diversa e' un numero diverso, e le due possono stare accanto.
   */
  it('la stessa quota su due finestre da due numeri', () => {
    const one = readingsOf(man({
      seasons: new Map([
        [WHOLE_CAREER, football({ frequencies: counted })],
        [SEASONS.target, football({ frequencies: { ...counted, long: 0.2, timed: 3 } })],
      ]),
    }));
    expect(readingValue(at('longPlay', WHOLE_CAREER), one)).toBeCloseTo(60, 10);
    expect(readingValue(at('longPlay', SEASONS.target), one)).toBeCloseTo(20, 10);
  });

  it('chi non ha calcio in archivio non ha una quota, e non ha uno zero', () => {
    const one = readingsOf(man());
    for (const key of FREQUENCIES) {
      expect(readingValue(at(key, WHOLE_CAREER), one)).toBeNull();
      expect(readingHas(at(key, WHOLE_CAREER), one)).toBe(false);
    }
  });

  /**
   * SBIADITA SOTTO LE DIECI PARTITE, e ognuna guarda il SUO denominatore: i minuti li porta il livello
   * per-partita e il fantavoto i voti, quindi la stessa riga puo' avere una quota solida e una
   * spannometrica.
   */
  it('e spannometrica sotto le dieci partite, ognuna sul suo denominatore', () => {
    const thin = readingsOf(withSeason(
      WHOLE_CAREER, { frequencies: { ...counted, timed: 4, rated: 30, played: 30 } },
    ));
    expect(readingIsRough(at('longPlay', WHOLE_CAREER), thin)).toBe(true);
    expect(readingIsRough(at('goodMatch', WHOLE_CAREER), thin)).toBe(false);
    expect(readingIsRough(at('bonusMatch', WHOLE_CAREER), thin)).toBe(false);
    const solid = readingsOf(withSeason(WHOLE_CAREER, { frequencies: counted }));
    for (const key of FREQUENCIES) expect(readingIsRough(at(key, WHOLE_CAREER), solid)).toBe(false);
  });
});

/**
 * LA COPPIA `G:A` (operatore, 06/09/2026), e quello che la distingue dalle medie accanto.
 *
 * E' la stessa lettura in un'altra unita', quindi il test che conta e' quello che lega le due: una
 * media e un conteggio che si contraddicono sono la famiglia di errori piu' cara di questo progetto.
 */
describe('la coppia gol:assist', () => {
  it('una coppia non ha un numero, quindi non ordina e non si stampa come tale', () => {
    const one = readingsOf(withSeason(SEASONS.target, { ga: { goals: 12, assists: 5 } }));
    expect(readingValue(at('ga', SEASONS.target), one)).toBeNull();
    expect(readingPair(at('ga', SEASONS.target), one)).toEqual({ goals: 12, assists: 5 });
    // ...e la cella NON e' vuota, che e' la ragione per cui `readingHas` esiste: leggere il valore e
    // basta avrebbe disegnato vuota la pastiglia di chi ha segnato dodici gol.
    expect(readingHas(at('ga', SEASONS.target), one)).toBe(true);
  });

  it('vuoto e vuoto: chi non ha giocato quella stagione non porta uno 0:0', () => {
    const nobody = readingsOf(man());
    expect(readingPair(at('ga', SEASONS.input), nobody)).toBeNull();
    expect(readingHas(at('ga', SEASONS.input), nobody)).toBe(false);
    // Zero gol e' un fatto (ha giocato e non ha segnato) e si stampa.
    const scored = readingsOf(withSeason(SEASONS.input, { ga: { goals: 0, assists: 0 } }));
    expect(readingHas(at('ga', SEASONS.input), scored)).toBe(true);
  });

  it('nessuna coppia e ordinabile, e tutte le altre lo sono', () => {
    // L'asserto e' sulle DUE liste insieme: una pastiglia che finisse fuori da entrambe sarebbe una
    // voce che non ordina niente e che nessuno ha dichiarato tale.
    expect([...SORTABLE_READINGS].sort())
      .toEqual(READINGS.filter((one) => !one.pair).map((one) => one.key).sort());
    for (const key of SORTABLE_READINGS) {
      expect(readingPair(at(key, SEASONS.target), readingsOf(man()))).toBeNull();
    }
    expect(SORTABLE_READINGS).not.toContain('ga');
  });

  it("la sigla NOMINA la sua stagione, e la prende dal RIFERIMENTO invece di calcolarla", () => {
    const spec = (key: ReadingKey) => READINGS.find((one) => one.key === key)!;
    expect(readingShort(spec('ga'), at('ga', '2025-26'))).toBe('G:A 25/26');
    expect(readingShort(spec('ga'), at('ga', '2026-27'))).toBe('G:A 26/27');
    // OGNI lettura stagionale nomina la sua, da quando la stessa puo' essere accesa su due: due
    // riquadri con lo stesso nome sarebbero due numeri indistinguibili.
    expect(readingShort(spec('goals'), at('goals', '2024-25'))).toBe('G 24/25');
    expect(readingShort(spec('longPlay'), at('longPlay', WHOLE_CAREER))).toBe('85′ tutte');
    // Quelle del FOGLIO no: non hanno una stagione da nominare.
    expect(readingShort(spec('swing'), at('swing'))).toBe('SWING');
    expect(readingShort(spec('played'), at('played'))).toBe('Pa');
  });

  it('una stagione fuori formato torna come e, invece di essere tagliata a caso', () => {
    expect(shortSeason('2025-26')).toBe('25/26');
    expect(shortSeason('2026-27')).toBe('26/27');
    expect(shortSeason('2099-00')).toBe('99/00');
    expect(shortSeason('boh')).toBe('boh');
    expect(shortSeason('')).toBe('');
  });
});
