import { Board, BoardMan } from './bundle';
import {
  BOARD_ENGINE_GAP,
  OnTable,
  PitchMan,
  disagreementHint,
  disagreementOf,
  lineCounts,
  pitchOf,
} from './club-eleven';

const man = (name: string, x: number, over: Partial<BoardMan> = {}): BoardMan => ({
  fc_id: name.length,
  name,
  codes: 'DC',
  mantra: 'dc',
  classic: 'D',
  badge: 'Dc',
  role_line: 'D',
  role_side: '0.0',
  minutes: '1800',
  matches: '24',
  minutes_club: '1800',
  starts_club: '20',
  minutes_per_match: '75',
  starter_prob: null,
  x,
  claim: 0.8,
  duels: [],
  duels_known: true,
  ...over,
});

const board = (picture: string, lines: Partial<Board['lines']>, over: Partial<Board> = {}): Board => ({
  picture,
  board_shape: picture,
  formation_typical: picture,
  coach: 'Mister',
  new_coach: 'no',
  why: 'perché',
  odds: { [picture]: 0.5 },
  lines: { P: [], D: [], M: [], T: [], A: [], ...lines } as Board['lines'],
  ...over,
});

const free: OnTable = { taken: false, price: 20, onTable: true, value99: 55 };
const nowhere = (): OnTable => ({ taken: false, price: null, onTable: false, value99: null });

describe('disagreementOf', () => {
  it('says nothing while the two models are within the declared gap', () => {
    expect(disagreementOf(0.7, 0.6)).toBeNull();
    expect(disagreementOf(0.7, 0.7 - BOARD_ENGINE_GAP + 0.001)).toBeNull();
  });

  it('names WHICH of the two is the optimist, because the sentence differs', () => {
    // La board gli dà la maglia, il motore lo prevede a voto in molte meno giornate.
    expect(disagreementOf(0.87, 0.5)).toBe('board');
    // ...e il contrario: spesso vuol dire che per quel posto la board non aveva nessuno di meglio.
    expect(disagreementOf(0.08, 0.5)).toBe('engine');
  });

  it('non risponde su un uomo di cui manca una delle due: ignoto, mai «d\'accordo»', () => {
    expect(disagreementOf(null, 0.5)).toBeNull();
    expect(disagreementOf(0.9, null)).toBeNull();
  });
});

describe('lineCounts', () => {
  it('reads three numbers as defence, midfield and attack, with the keeper always alone', () => {
    expect(lineCounts('4-3-3')).toEqual({ P: 1, D: 4, M: 3, T: 0, A: 3 });
    expect(lineCounts('3-5-2')).toEqual({ P: 1, D: 3, M: 5, T: 0, A: 2 });
  });

  it('reads FOUR numbers with the third as the trequarti and the last always the attack', () => {
    expect(lineCounts('4-2-3-1')).toEqual({ P: 1, D: 4, M: 2, T: 3, A: 1 });
    expect(lineCounts('3-4-1-2')).toEqual({ P: 1, D: 3, M: 4, T: 1, A: 2 });
  });

  it('refuses what it cannot read instead of guessing a shape', () => {
    expect(lineCounts('')).toBeNull();
    expect(lineCounts(null)).toBeNull();
    expect(lineCounts('4-4-2-1-1')).toBeNull();
  });
});

describe('pitchOf and the two models', () => {
  it('carries the engine\'s own forecast onto the chip and marks where it contradicts the board', () => {
    const drawn = pitchOf(
      board('4-3-3', { P: [man('Portiere', 0.5, { claim: 0.9 })] }),
      () => ({ ...free, expectedShare: 0.4 }),
    )!;
    const keeper = drawn.rows[0].men[0];
    expect(keeper.expectedShare).toBe(0.4);
    expect(keeper.disagreement).toBe('board');
    // ...e la frase nomina le DUE domande invece di dichiarare un vincitore.
    const said = disagreementHint(keeper)!;
    expect(said).toContain('90%');
    expect(said).toContain('40%');
    expect(said).toContain('subentrato');
  });

  it('non marca niente quando il chiamante non porta la quota del motore', () => {
    const drawn = pitchOf(board('4-3-3', { P: [man('Portiere', 0.5, { claim: 0.9 })] }), () => free)!;
    expect(drawn.rows[0].men[0].expectedShare).toBeNull();
    expect(drawn.rows[0].men[0].disagreement).toBeNull();
    expect(disagreementHint(drawn.rows[0].men[0])).toBeNull();
  });
});

describe('pitchOf', () => {
  it('reads `new_coach` as the WORD it is: `no` is not a new coach', () => {
    // The column that looks like a flag is `yes`/`no`, so `Boolean(...)` reads `no` as true - which would
    // have called every coach of the listone new. Found by this test before it shipped.
    const old = pitchOf(board('4-3-3', { P: [man('Portiere', 0.5)] }, { new_coach: 'no' }), () => free)!;
    const fresh = pitchOf(board('4-3-3', { P: [man('Portiere', 0.5)] }, { new_coach: 'yes' }), () => free)!;
    expect(old.newCoach).toBe(false);
    expect(fresh.newCoach).toBe(true);
  });

  it('draws the rows the module asks for, the KEEPER first and the attack last', () => {
    const drawn = pitchOf(board('4-3-3', {
      P: [man('Portiere', 0.5)],
      D: [man('A', 0.1), man('B', 0.37), man('C', 0.63), man('D', 0.89)],
      M: [man('E', 0.28), man('F', 0.5), man('G', 0.72)],
      A: [man('H', 0.11), man('I', 0.5), man('J', 0.89)],
    }), () => free)!;
    expect(drawn.rows.map((row) => row.line)).toEqual(['P', 'D', 'M', 'A']);
    expect(drawn.rows.map((row) => row.wanted)).toEqual([1, 4, 3, 3]);
    expect(drawn.problems).toEqual([]);
    // The panel's own horizontal position travels through untouched: that is what makes a flank a flank.
    expect(drawn.rows[0].men[0].x).toBe(0.5);
    expect(drawn.rows[1].men[0].x).toBe(0.1);
  });

  it('keeps the TREQUARTI as its own row when the module has four numbers', () => {
    const drawn = pitchOf(board('4-2-3-1', {
      P: [man('Portiere', 0.5)],
      D: [man('A', 0.1), man('B', 0.37), man('C', 0.63), man('D', 0.89)],
      M: [man('E', 0.35), man('F', 0.65)],
      T: [man('G', 0.15), man('H', 0.5), man('I', 0.85)],
      A: [man('J', 0.5)],
    }), () => free)!;
    expect(drawn.rows.map((row) => row.line)).toEqual(['P', 'D', 'M', 'T', 'A']);
    expect(drawn.rows[3].wanted).toBe(3);        // the trequarti, third number of a four-number module
  });

  it('REPORTS a line where the module and the drawn men disagree, and still draws it', () => {
    const drawn = pitchOf(board('4-3-3', {
      P: [man('Portiere', 0.5)],
      D: [man('A', 0.2), man('B', 0.8)],          // the module says four
      M: [man('E', 0.28), man('F', 0.5), man('G', 0.72)],
      A: [man('H', 0.11), man('I', 0.5), man('J', 0.89)],
    }), () => free)!;
    expect(drawn.problems.length).toBe(1);
    expect(drawn.problems[0]).toContain('linea D');
    expect(drawn.rows.find((row) => row.line === 'D')!.men.length).toBe(2);
  });

  it('marks who is already TAKEN, which is the only thing the board cannot know', () => {
    const gone = (name: string): OnTable =>
      ({ taken: name === 'B', price: 30, onTable: true, value99: 40 });
    const drawn = pitchOf(board('3-4-3', {
      P: [man('Portiere', 0.5)],
      D: [man('A', 0.2), man('B', 0.5), man('C', 0.8)],
      M: [man('D', 0.1), man('E', 0.4), man('F', 0.6), man('G', 0.9)],
      A: [man('H', 0.2), man('I', 0.5), man('J', 0.8)],
    }), (candidate) => gone(candidate.name ?? ''))!;
    expect(drawn.taken).toBe(1);
    expect(drawn.rows.find((row) => row.line === 'D')!.men[1].taken).toBe(true);
  });

  it('a man the session listone does not carry is not «free»: he is not on the table', () => {
    const drawn = pitchOf(board('4-3-3', { P: [man('Portiere', 0.5)] }), nowhere)!;
    const keeper = drawn.rows[0].men[0];
    expect(keeper.onTable).toBe(false);
    expect(keeper.taken).toBe(false);
    expect(keeper.price).toBeNull();
    // No row on the table means no worth either: a square with «—», never a zero.
    expect(keeper.value99).toBeNull();
  });

  it('carries the ballottaggi, and «unknown» is not «no rival»', () => {
    const withDuels = man('Titolare', 0.5, {
      duels: [
        man('Rivale1', 0.5, { fc_id: 41, claim: 0.4 }),
        man('Rivale2', 0.5, { fc_id: 42, claim: 0.3 }),
      ],
      duels_known: true,
    });
    const blind = man('Senza ruolo', 0.5, { duels: [], duels_known: false, codes: null });
    const drawn = pitchOf(board('4-3-3', { P: [withDuels], D: [blind] }), () => free)!;
    expect(drawn.rows[0].men[0].duels.map((rival) => rival.name)).toEqual(['Rivale1', 'Rivale2']);
    const unknown = drawn.rows.find((row) => row.line === 'D')!.men[0];
    expect(unknown.duels.length).toBe(0);
    expect(unknown.duelsKnown).toBe(false);
    expect(unknown.codes).toEqual([]);
  });

  it('non disegna un ballottaggio sotto la soglia, e dice quanti ne ha nascosti', () => {
    // Operatore, 18/08/2026: «se non ci sono ballottaggi accetta qualsiasi claim; nel caso di
    // ballottaggi scarta quelli sotto il 0,20». Vale sui RIVALI: il titolare resta disegnato comunque,
    // o l'undici avrebbe un posto vuoto che il toolkit non ha lasciato.
    const starter = man('Titolare', 0.5, {
      claim: 0.08,
      duels: [
        man('Credibile', 0.5, { fc_id: 11, claim: 0.35 }),
        man('Rumore', 0.5, { fc_id: 12, claim: 0.05 }),
      ],
      duels_known: true,
    });
    const drawn = pitchOf(board('4-3-3', { P: [starter] }), () => free)!;
    const drawnStarter = drawn.rows[0].men[0];
    expect(drawnStarter.name).toBe('Titolare');
    expect(drawnStarter.claim).toBe(0.08);
    expect(drawnStarter.duels.map((rival) => rival.name)).toEqual(['Credibile']);
    expect(drawn.hiddenDuels.floor).toBe(1);
    expect(drawn.hiddenDuels.duplicate).toBe(0);
  });

  it('lo stesso uomo compare in ballottaggio su UN posto solo', () => {
    // Misurato sul bundle: 171 voci di ballottaggio su 610 sono ripetizioni dello stesso uomo (euro), e
    // il pannello le produce perché calcola i rivali posto per posto. Dove tenerlo: dove il posto chiede
    // uno dei suoi codici granulari e, a pari fit, dove il titolare è più debole.
    const rival = () => man('Vice', 0.5, { fc_id: 21, claim: 0.4, codes: 'DR' });
    const right = man('Terzino destro', 0.1, {
      fc_id: 31, claim: 0.7, badge: 'Dd', codes: 'DR', duels: [rival()], duels_known: true,
    });
    const centre = man('Centrale', 0.5, {
      fc_id: 32, claim: 0.6, badge: 'Dc', codes: 'DC', duels: [rival()], duels_known: true,
    });
    const drawn = pitchOf(board('4-3-3', { D: [right, centre] }), () => free)!;
    const defence = drawn.rows.find((row) => row.line === 'D')!;
    const shown = defence.men.filter((one) => one.duels.length);
    expect(shown.length).toBe(1);
    // Il posto che chiede `DR` è quello del terzino destro: è là che il vice si vede.
    expect(shown[0].name).toBe('Terzino destro');
    expect(drawn.hiddenDuels.duplicate).toBe(1);
  });

  it('spartisce i ballottaggi fra i posti invece di ammucchiarli su uno', () => {
    // Operatore, 18/08/2026: «evitiamo posizioni con tanti calciatori in alternativa e posizioni senza
    // alternative». Due riserve centrali elencate dal toolkit su TUTT'E TRE i posti della difesa: la
    // regola vecchia le metteva tutt'e due sul titolare più debole e lasciava due posti vuoti.
    const vice = (id: number, name: string, claim: number) =>
      man(name, 0.5, { fc_id: id, claim, codes: 'DC;DL' });
    const place = (id: number, name: string, x: number, claim: number) => man(name, x, {
      fc_id: id, claim, badge: 'Dc', codes: 'DC',
      duels: [vice(91, 'Vice1', 0.45), vice(92, 'Vice2', 0.4)],
      duels_known: true,
    });
    const drawn = pitchOf(board('4-3-3', {
      D: [place(51, 'Centrale1', 0.3, 0.7), place(52, 'Centrale2', 0.5, 0.65),
        place(53, 'Centrale3', 0.7, 0.6)],
    }), () => free)!;
    const defence = drawn.rows.find((row) => row.line === 'D')!;
    expect(defence.men.map((one) => one.duels.length).sort()).toEqual([0, 1, 1]);
    // ...e ognuno è disegnato UNA volta sola: la vecchia regola vale ancora, non è stata sostituita.
    expect(defence.men.flatMap((one) => one.duels.map((rival) => rival.name)).sort())
      .toEqual(['Vice1', 'Vice2']);
    expect(drawn.hiddenDuels.duplicate).toBe(4);
  });

  it('manda il mancino sul posto di sinistra anche se il toolkit lo elencava a destra', () => {
    // «Fai una valutazione sui ruoli REALI» (stesso giorno). Il ballottaggio resta dentro la sua LINEA -
    // nessuno viene inventato - ma quale posto della linea lo dice il ruolo reale, non l'ordine in cui il
    // pannello lo ha elencato.
    const right = man('Terzino destro', 0.1, {
      fc_id: 61, claim: 0.7, badge: 'Td', codes: 'DR',
      duels: [man('Mancino', 0.5, { fc_id: 62, claim: 0.5, codes: 'DL;ML' })],
      duels_known: true,
    });
    const left = man('Terzino sinistro', 0.9, { fc_id: 63, claim: 0.6, badge: 'Ts', codes: 'DL' });
    const drawn = pitchOf(board('4-3-3', { D: [right, left] }), () => free)!;
    const defence = drawn.rows.find((row) => row.line === 'D')!;
    const shown = defence.men.filter((one) => one.duels.length);
    expect(shown.length).toBe(1);
    expect(shown[0].name).toBe('Terzino sinistro');
  });

  it('non disegna lo stesso uomo su due LINEE diverse', () => {
    // Il caso vero: Pasalic è ballottaggio in mezzo e sulla trequarti insieme, quindi l'assegnazione è
    // una per tutto il campetto - una per riga lo faceva ricomparire.
    const jolly = () => man('Jolly', 0.5, { fc_id: 71, claim: 0.5, codes: 'MC;AM' });
    const drawn = pitchOf(board('4-3-1-2', {
      M: [man('Mediano', 0.5, { fc_id: 72, badge: 'C', codes: 'MC', duels: [jolly()], duels_known: true })],
      T: [man('Trequartista', 0.5, {
        fc_id: 73, badge: 'T', codes: 'AM', duels: [jolly()], duels_known: true,
      })],
    }), () => free)!;
    const drawnNames = drawn.rows.flatMap((row) => row.men.flatMap((one) => one.duels.map((r) => r.name)));
    expect(drawnNames).toEqual(['Jolly']);
    expect(drawn.hiddenDuels.duplicate).toBe(1);
  });

  it('shows the minutes as an AVERAGE PER MATCH, and keeps the club average apart', () => {
    const drawn = pitchOf(board('4-3-3', {
      P: [man('Portiere', 0.5, { minutes: '2278', matches: '26', minutes_per_match: '44.7' })],
      D: [man('Ignoto', 0.1, { minutes: null, matches: null, minutes_per_match: null })],
    }), () => free)!;
    const keeper = drawn.rows[0].men[0];
    expect(keeper.perMatch).toBe(88);                 // 2278 / 26, the matches he PLAYED
    expect(keeper.minutesPerClubMatch).toBe(44.7);    // the sheet's own, over the CLUB's last ten
    // Missing minutes are unknown, never zero: the chip says «minuti ignoti».
    expect(drawn.rows[1].men[0].perMatch).toBeNull();
  });

  it('legge i minuti PREVISTI dalla board e non ne calcola nessuno', () => {
    // È il numero che il chip stampa dal 19/08/2026, e lo decide il toolkit (`engine/minutes.py`): quanto
    // un uomo resta in campo è una previsione su una persona, quindi qui si legge e basta. La misura resta
    // accanto, con un altro nome, perché una previsione e una misura sotto una cifra sola sono due cose.
    const drawn = pitchOf(board('4-3-3', {
      P: [man('Previsto', 0.5, { minutes: '2278', matches: '26', minutes_next: 71 })],
      D: [man('Board vecchia', 0.1, { minutes: '1800', matches: '24' })],
    }), () => free)!;
    const priced = drawn.rows[0].men[0];
    expect(priced.minutesNext).toBe(71);
    expect(priced.perMatch).toBe(88);                  // la misura non si muove di un minuto
    // Una board scritta prima della colonna non ne ha una: ignoto, mai un ripiego silenzioso sulla misura.
    expect(drawn.rows[1].men[0].minutesNext).toBeNull();
    expect(drawn.rows[1].men[0].perMatch).toBe(75);
  });

  it('carries the ONE role of the module and the listone role beside it', () => {
    const drawn = pitchOf(board('4-3-3', {
      P: [man('Portiere', 0.5, { badge: 'P', mantra: 'por', codes: 'GK' })],
      D: [man('Terzino', 0.1, { badge: 'Td', mantra: 'dd;e', codes: 'DR;DC' })],
    }), () => free)!;
    const back = drawn.rows.find((row) => row.line === 'D')!.men[0];
    // The marker is ONE code - the job the module gave him - while his own list stays available for the
    // tooltip: printing `DR;DC` on the pitch said two jobs where the module gave him one.
    expect(back.badge).toBe('Td');
    expect(back.mantra).toEqual(['dd', 'e']);
    expect(back.codes).toEqual(['DR', 'DC']);
  });

  it('says when the fit was solved on a DIFFERENT module than the one drawn', () => {
    const drawn = pitchOf(board('4-2-3-1', { P: [man('Portiere', 0.5)] },
                                { board_shape: '4-3-3' }), () => free)!;
    expect(drawn.module).toBe('4-2-3-1');
    expect(drawn.solvedOn).toBe('4-3-3');
  });

  it('draws nothing for a club the panel could not draw, and nothing for an unreadable module', () => {
    expect(pitchOf({ error: 'boom' } as Board, () => free)).toBeNull();
    expect(pitchOf(board('quattro-tre-tre', { P: [man('Portiere', 0.5)] }), () => free)).toBeNull();
    expect(pitchOf(null, () => free)).toBeNull();
  });
});

describe('pitchOf e le dritte dichiarate', () => {
  /** Una board con un posto e un ballottaggio: il minimo in cui uno scambio ha senso. */
  const oneDuel = (starterClaim = 0.8, rivalClaim = 0.4): Board => board('4-3-3', {
    D: [man('Titolare', 0.5, {
      claim: starterClaim,
      duels: [man('Rivale', 0.5, { claim: rivalClaim })],
    })],
  });

  const drawnNames = (pitch: NonNullable<ReturnType<typeof pitchOf>>): string[] =>
    pitch.rows.flatMap((row) => row.men.map((one) => one.name));

  /** Il posto della difesa: `rows[0]` e' la PORTA, che su queste board di prova e' vuota. */
  const defence = (pitch: NonNullable<ReturnType<typeof pitchOf>>): PitchMan =>
    pitch.rows.find((row) => row.line === 'D')!.men[0];

  it('senza dritte il disegno è quello del toolkit, riga per riga', () => {
    const plain = pitchOf(oneDuel(), () => free)!;
    const asked = pitchOf(oneDuel(), () => free, null, () => null)!;
    expect(drawnNames(asked)).toEqual(drawnNames(plain));
    expect(defence(asked).duels.map((one) => one.name)).toEqual(['Rivale']);
  });

  it('un `titolare` DICHIARATO prende la maglia del posto in cui il toolkit lo mette in discussione', () => {
    const pitch = pitchOf(oneDuel(), () => free, null,
      (fcId) => (fcId === 'Rivale'.length ? 'titolare' : null))!;
    const place = pitch.rows.find((row) => row.line === 'D')!.men[0];
    expect(place.name).toBe('Rivale');
    expect(place.ruled).toBe('titolare');
    // ...e chi esce non sparisce: diventa il ballottaggio di quel posto, che e' quello che e'.
    expect(place.duels.map((one) => one.name)).toEqual(['Titolare']);
  });

  it('un `panchina` DICHIARATO lascia la maglia al ricambio disegnato', () => {
    const pitch = pitchOf(oneDuel(), () => free, null,
      (fcId) => (fcId === 'Titolare'.length ? 'panchina' : null))!;
    const place = pitch.rows.find((row) => row.line === 'D')!.men[0];
    expect(place.name).toBe('Rivale');
    expect(place.duels.map((one) => one.name)).toEqual(['Titolare']);
    // Le lamentele sulle linee vuote di questa board di prova ci sono e non c'entrano: quello che
    // conta e' che uno scambio riuscito non si lamenti di un ricambio che manca.
    expect(pitch.problems.join(' ')).not.toContain('ricambio');
  });

  it('...e se quel posto non ha nessun ricambio, lo DICE invece di lasciare un undici di dieci', () => {
    const alone = board('4-3-3', { D: [man('Solo', 0.5)] });
    const pitch = pitchOf(alone, () => free, null, () => 'riserva')!;
    expect(pitch.rows.find((row) => row.line === 'D')!.men[0].name).toBe('Solo');
    expect(pitch.problems.join(' ')).toContain('nessun ricambio');
  });

  it('`ballottaggio` non muove il disegno: sta bene nell’undici e in panchina', () => {
    // Il cancello della scala dice che chi la board schiera non scende sotto `ballottaggio` e chi non
    // schiera non sale sopra: quindi la parola non è un'informazione sul DISEGNO. Sul foglio Serie A
    // 115 dei 155 ballottaggi sono nell'undici e 40 no.
    const pitch = pitchOf(oneDuel(), () => free, null, () => 'ballottaggio')!;
    expect(pitch.rows.find((row) => row.line === 'D')!.men[0].name).toBe('Titolare');
  });

  it('È IDEMPOTENTE: su una board che la dichiarazione rispetta già non si muove niente', () => {
    // È la proprietà che rende sicuro avere due lettori della stessa dritta - questo file e il
    // toolkit: una board costruita DOPO che l'operatore l'ha messa in `config/player_rulings.json`
    // la rispetta già, e riapplicarla qui non deve riordinare nulla.
    const already = pitchOf(oneDuel(), () => free, null, () => null)!;
    const again = pitchOf(oneDuel(), () => free, null,
      (fcId) => (fcId === 'Titolare'.length ? 'titolare' : null))!;
    expect(drawnNames(again)).toEqual(drawnNames(already));
    expect(defence(again).duels.map((one) => one.name)).toEqual(['Rivale']);
  });

  it('...e chi entra in campo NON resta ballottaggio di un altro posto', () => {
    // Trovato dal banco in un browser vero e non da una rilettura: il toolkit elenca lo stesso rivale
    // su piu' posti, quindi dopo lo scambio il campetto disegnava il promosso DUE volte - titolare di
    // un posto e ballottaggio di un altro. E' l'invariante che `spreadDuels` protegge per il posto di
    // cui uno e' titolare, detto per l'intero campetto.
    const twice = board('4-3-3', {
      D: [
        man('Primo', 0.2, { fc_id: 1, duels: [man('Vice', 0.2, { fc_id: 9, claim: 0.4 })] }),
        man('Secondo', 0.8, { fc_id: 2, duels: [man('Vice', 0.8, { fc_id: 9, claim: 0.4 })] }),
      ],
    });
    const pitch = pitchOf(twice, () => free, null, (fcId) => (fcId === 9 ? 'titolare' : null))!;
    const drawn = pitch.rows.find((row) => row.line === 'D')!.men;
    expect(drawn.map((one) => one.name)).toEqual(['Vice', 'Secondo']);
    expect(drawn.flatMap((one) => one.duels.map((rival) => rival.name))).not.toContain('Vice');
  });

  it('UNA MAGLIA PER UOMO: un dichiarato elencato su due posti entra in uno solo', () => {
    // Il toolkit elenca lo stesso rivale su più posti (171 voci su 610 sono ripetizioni): promuoverlo
    // in tutti lo disegnerebbe due volte, che è il difetto che `spreadDuels` esiste per togliere.
    const twice = board('4-3-3', {
      D: [
        man('Primo', 0.2, { fc_id: 1, duels: [man('Vice', 0.2, { fc_id: 9, claim: 0.4 })] }),
        man('Secondo', 0.8, { fc_id: 2, duels: [man('Vice', 0.8, { fc_id: 9, claim: 0.4 })] }),
      ],
    });
    const pitch = pitchOf(twice, () => free, null, (fcId) => (fcId === 9 ? 'titolare' : null))!;
    const drawn = drawnNames(pitch);
    expect(drawn.filter((name) => name === 'Vice').length).toBe(1);
    expect(drawn.length).toBe(2);
  });
});

describe('il ballottaggio che oggi non può giocare', () => {
  /**
   * Richiesta dell'operatore, 11/09/2026: sulla board dell'ULTIMO PERIODO un uomo che la board stessa
   * non schiera - perché oggi è indisponibile - deve comunque vedersi fra i ballottaggi, marcato. Chi lo
   * mette in lista è il TOOLKIT (`gui.eleven`, in coda e mai al posto di un rivale sano); qui si pinna
   * quello che l'app ne fa, che è l'altra metà.
   */
  const hurt = (over: Partial<BoardMan> = {}): BoardMan =>
    man('Infortunato', 0.5, { fc_id: 9, claim: 0.9, out_today: true, ...over });

  const withHurt = (): Board => board('4-3-3', {
    D: [man('Titolare', 0.5, {
      fc_id: 1,
      claim: 0.7,
      duels: [man('Rivale', 0.5, { fc_id: 2, claim: 0.5 }), hurt()],
    })],
  });

  const defence = (pitch: NonNullable<ReturnType<typeof pitchOf>>): PitchMan =>
    pitch.rows.find((row) => row.line === 'D')!.men[0];

  it('si legge dalla board e non si deduce: `out_today` viaggia fino alla riga', () => {
    const drawn = defence(pitchOf(withHurt(), () => free)!);
    expect(drawn.duels.map((one) => one.outToday)).toEqual([null, true]);
    // ...e chi la board non marca non è «disponibile»: è una board che non lo afferma.
    expect(drawn.outToday).toBeNull();
  });

  it('STA IN CODA anche col claim più alto di tutti, perché quella quota è di STAGIONE', () => {
    // La finestra corta di un infortunato è vuota, quindi la miscela gli restituisce il prior intatto:
    // ordinato per claim finirebbe primo, sopra il rivale che quella maglia se la gioca ADESSO.
    expect(defence(pitchOf(withHurt(), () => free)!).duels.map((one) => one.name))
      .toEqual(['Rivale', 'Infortunato']);
  });

  it('...e si vede anche dove nessun rivale sano esiste, che è il caso per cui è nato', () => {
    // 26 dei 59 posti senza nessun ballottaggio disegnato, sul foglio Serie A del 10/09/2026, ne hanno
    // uno che semplicemente oggi non può giocare: quella maglia sembrava incontrastata e non lo è.
    const alone = board('4-3-3', { D: [man('Titolare', 0.5, { fc_id: 1, duels: [hurt()] })] });
    const drawn = defence(pitchOf(alone, () => free)!);
    expect(drawn.duels.map((one) => one.name)).toEqual(['Infortunato']);
    expect(drawn.duels[0].outToday).toBe(true);
  });

  it('UNA DRITTA NON LO MANDA IN CAMPO, e il campetto lo dice', () => {
    // Promuoverlo rimetterebbe nell'undici esattamente l'uomo che il cancello di questa board toglie -
    // il toolkit lo aveva già escluso, e il riordino dell'app lo rifarebbe entrare dalla finestra.
    const pitch = pitchOf(withHurt(), () => free, null, (fcId) => (fcId === 9 ? 'titolare' : null))!;
    expect(defence(pitch).name).toBe('Titolare');
    expect(pitch.problems.join(' ')).toContain('oggi è indisponibile');
  });

  it('il pavimento dei ballottaggi vale anche per lui: sotto non è un ballottaggio', () => {
    const weak = board('4-3-3', {
      D: [man('Titolare', 0.5, { fc_id: 1, duels: [hurt({ claim: 0.05 })] })],
    });
    const pitch = pitchOf(weak, () => free)!;
    expect(defence(pitch).duels).toEqual([]);
    expect(pitch.hiddenDuels.floor).toBe(1);
  });
});
