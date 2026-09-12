import { LineupMan, laneCost, lineupOf, placeX } from './match-lineup';

/**
 * UN ID PER NOME, e diverso per ogni nome.
 *
 * La prima versione era `lunghezza * 100 + prima lettera`, e `MedianoA`, `MedianoB` e `MedianoC`
 * leggevano lo STESSO `fcId` - come i quattro difensori e i tre attaccanti. Finche' il disegno
 * guardava solo posizione e minuti non si vedeva; dal momento in cui una regola si chiave sull'id
 * (chi ha preso il posto di chi) un fixture cosi' non puo' provarla, e il test che l'ha trovata
 * sembrava un difetto del codice.
 */
const idOf = (name: string): number =>
  [...name].reduce((sum, letter) => (sum * 31 + letter.charCodeAt(0)) % 1_000_003, 7);

const man = (name: string, over: Partial<LineupMan> = {}): LineupMan => ({
  fcId: idOf(name),
  name,
  position: 'D',
  started: true,
  minutes: 90,
  slot: null,
  ...over,
});

/** Un undici di comodo: 1 + 4 + 3 + 3, coi posti che la fonte scrive (0 = portiere, 10 = l'ultimo). */
const eleven = (): LineupMan[] => [
  man('Portiere', { position: 'G', slot: 0 }),
  man('DifensoreA', { slot: 1 }),
  man('DifensoreB', { slot: 2 }),
  man('DifensoreC', { slot: 3 }),
  man('DifensoreD', { slot: 4 }),
  man('MedianoA', { position: 'M', slot: 5 }),
  man('MedianoB', { position: 'M', slot: 6 }),
  man('MedianoC', { position: 'M', slot: 7 }),
  man('AttaccanteA', { position: 'F', slot: 8 }),
  man('AttaccanteB', { position: 'F', slot: 9 }),
  man('AttaccanteC', { position: 'F', slot: 10 }),
];

const names = (drawn: ReturnType<typeof lineupOf>, line: string): (string | null)[] =>
  drawn.rows.find((row) => row.line === line)?.places.map((one) => one.man?.name ?? null) ?? [];

describe('laneCost', () => {
  /** Quanto sta male su una riga di tre: sinistra dello schermo = destra della squadra. */
  const row = (codes: string[]) => [0, 0.5, 1].map((x) => laneCost(codes, x));

  it('reads the flank from the granular codes AND from the listone ones', () => {
    expect(row(['DR'])).toEqual([0, 0.5, 1]);
    expect(row(['DL'])).toEqual([1, 0.5, 0]);
    // I due vocabolari dicono la stessa cosa e si leggono insieme: `dd`/`ds` esistono anche per chi il
    // provider non ha mai osservato.
    expect(row(['dd'])).toEqual([0, 0.5, 1]);
    expect(row(['ds'])).toEqual([1, 0.5, 0]);
  });

  it('KNOWS "wide with no side" and "strictly central", which one number cannot say', () => {
    // `w` (ala) e `e` (esterno): di fascia, ma non quale. Sta bene su TUTT'E DUE gli estremi.
    expect(row(['w'])).toEqual([0, 1, 0]);
    // `pc`, `dc`, `ST`: al centro, e male su tutt'e due gli estremi.
    expect(row(['pc'])).toEqual([1, 0, 1]);
    expect(row(['ST'])).toEqual([1, 0, 1]);
  });

  it('averages the codes that SPEAK and ignores the ones that say nothing about the flank', () => {
    // `DC;DR` tira verso il centro-destra: una media, non un massimo.
    expect(laneCost(['DC', 'DR'], 0)).toBe(0.5);
    expect(laneCost(['DC', 'DR'], 0.5)).toBe(0.25);
    // `AM`, `MC`, `T`, `A` non dicono niente sulla fascia: farli parlare sarebbe inventare.
    expect(row(['AM', 'MC', 'T', 'A'])).toEqual([0, 0, 0]);
    expect(row([])).toEqual([0, 0, 0]);
    expect(row(null as unknown as string[])).toEqual([0, 0, 0]);
  });
});

describe('placeX', () => {
  it('spreads the places from the right of the team to its left, and centres a row of one', () => {
    expect([0, 1, 2].map((at) => placeX(at, 3))).toEqual([0, 0.5, 1]);
    expect(placeX(0, 1)).toBe(0.5);
  });
});

describe('lineupOf', () => {
  it('places the men on the lines the provider gave them, keeper first and attack last', () => {
    const drawn = lineupOf('4-3-3', eleven());
    expect(drawn.rows.map((row) => [row.line, row.wanted, row.places.length])).toEqual([
      ['P', 1, 1],
      ['D', 4, 4],
      ['M', 3, 3],
      ['A', 3, 3],
    ]);
    expect(drawn.named).toBe(11);
    expect(drawn.wanted).toBe(11);
    expect(drawn.problems).toEqual([]);
  });

  it('ORDERS A LINE BY THE SOURCE\'S OWN SLOT, which is where the formation lives', () => {
    // Il caso dell'operatore: tre uomini tutti CENTRALI per i codici (`ST`, `AM;ST`, `MC;AM`), quindi
    // i codici non li separano e l'ordine finirebbe per essere quello dei minuti. La distinta della
    // fonte dice che il centravanti sta in mezzo, e quello e' il fatto.
    const attack = [
      man('Elmas', { position: 'F', slot: 10, minutes: 66 }),
      man('Scamacca', { position: 'F', slot: 9, minutes: 45 }),
      man('De Ketelaere', { position: 'F', slot: 8, minutes: 90 }),
    ];
    const drawn = lineupOf('4-3-3', [...eleven().filter((one) => one.position !== 'F'), ...attack]);
    expect(names(drawn, 'A')).toEqual(['De Ketelaere', 'Scamacca', 'Elmas']);
    expect(drawn.deduced).toBe(0);
  });

  it('falls back to the CODES only when the whole line has no slot, and says how many rows', () => {
    // Mescolare chi ha un posto e chi non ce l'ha vorrebbe dire ordinare su due scale nella stessa
    // fila: la riga usa la fonte per intero o per niente.
    const sides = new Map<number, string[]>();
    const right = man('Terzino destro', { minutes: 80 });
    const left = man('Terzino sinistro', { minutes: 70 });
    const centre = man('Centrale', { minutes: 90 });
    sides.set(right.fcId, ['DR']);
    sides.set(left.fcId, ['DL']);
    sides.set(centre.fcId, ['DC']);
    const drawn = lineupOf(
      '3-4-3',
      [left, centre, right, ...eleven().filter((one) => one.position !== 'D')],
      (fcId) => sides.get(fcId) ?? null,
    );
    expect(names(drawn, 'D')).toEqual(['Terzino destro', 'Centrale', 'Terzino sinistro']);
    // la difesa e' dedotta, le altre righe no: una riga di UN uomo (la porta) non conta
    expect(drawn.deduced).toBe(1);
  });

  it('lets the man with the STRONGEST claim choose first, so an order cannot steal his place', () => {
    // Un `Pc` ha una casa sola e un `AM` nessuna: se scegliesse per primo chi non ha niente da dire,
    // il centravanti finirebbe sull'ala per il caso in cui i due capitano nell'elenco.
    const codes = new Map<number, string[]>();
    const vague = man('Generico', { position: 'F', minutes: 90 });
    const centre = man('Centravanti', { position: 'F', minutes: 45 });
    const wide = man('Ala', { position: 'F', minutes: 60 });
    codes.set(vague.fcId, ['AM', 'a']);
    codes.set(centre.fcId, ['pc']);
    codes.set(wide.fcId, ['LW']);
    const drawn = lineupOf(
      '4-3-3',
      [vague, centre, wide, ...eleven().filter((one) => one.position !== 'F')],
      (fcId) => codes.get(fcId) ?? null,
    );
    expect(names(drawn, 'A')).toEqual(['Generico', 'Centravanti', 'Ala']);
  });


  it('CUTS THE LINES ON THE FORMATION THE SOURCE DECLARES, trequarti included', () => {
    // I conteggi delle posizioni G/D/M/F hanno TRE linee: la Juventus del 23/08/2026 leggeva `4-5-1`
    // con Conceicao, McKennie e Yildiz in mezzo al campo, mentre la fonte dichiara `4-2-3-1`. Il
    // taglio si fa sulla SEQUENZA dei posti, senza guardare le posizioni - sono proprio quelle che non
    // sanno distinguere un trequartista da un centrocampista.
    const men = [
      man('Portiere', { position: 'G', slot: 0 }),
      ...[1, 2, 3, 4].map((at) => man(`Dif${at}`, { position: 'D', slot: at })),
      ...[5, 6].map((at) => man(`Med${at}`, { position: 'M', slot: at })),
      ...[7, 8, 9].map((at) => man(`Treq${at}`, { position: 'M', slot: at })),
      man('Punta', { position: 'F', slot: 10 }),
    ];
    const drawn = lineupOf('4-5-1', men, () => null, '4-2-3-1');
    expect(drawn.shape).toBe('4-2-3-1');
    expect(drawn.fromSource).toBe(true);
    expect(drawn.rows.map((row) => [row.line, row.places.length])).toEqual([
      ['P', 1], ['D', 4], ['M', 2], ['T', 3], ['A', 1],
    ]);
    expect(names(drawn, 'T')).toEqual(['Treq7', 'Treq8', 'Treq9']);
    expect(names(drawn, 'A')).toEqual(['Punta']);
  });

  it('puts the CENTRE-FORWARD of a 3-4-1-2 in the front line and not on a wing', () => {
    // Il caso Roma del 05/09/2026: i conteggi dicono `3-4-3` e Malen finisce sull'ala; la fonte
    // dichiara `3-4-1-2`, dove lui e' uno dei due davanti.
    const men = [
      man('Svilar', { position: 'G', slot: 0 }),
      ...[1, 2, 3].map((at) => man(`Dif${at}`, { position: 'D', slot: at })),
      ...[4, 5, 6, 7].map((at) => man(`Med${at}`, { position: 'M', slot: at })),
      man('Mora', { position: 'F', slot: 8 }),
      man('Dybala', { position: 'F', slot: 9 }),
      man('Malen', { position: 'F', slot: 10 }),
    ];
    const drawn = lineupOf('3-4-3', men, () => null, '3-4-1-2');
    expect(drawn.shape).toBe('3-4-1-2');
    expect(names(drawn, 'T')).toEqual(['Mora']);
    expect(names(drawn, 'A')).toEqual(['Dybala', 'Malen']);
  });

  it('REFUSES the declared formation when the eleven is not a sequence it can cut', () => {
    // Con un uomo senza posto l'array non e' una sequenza, e tagliarla sposterebbe tutti quelli dopo
    // di lui: un difetto silenzioso che muove una linea intera. Meglio tre linee dichiarate tali.
    const men = eleven().map((one) => (one.name === 'MedianoB' ? { ...one, slot: null } : one));
    const drawn = lineupOf('4-3-3', men, () => null, '4-2-3-1');
    expect(drawn.shape).toBe('4-3-3');
    expect(drawn.fromSource).toBe(false);
  });

  it('says the shape was COUNTED when the source did not declare one', () => {
    const drawn = lineupOf('4-3-3', eleven());
    expect(drawn.shape).toBe('4-3-3');
    expect(drawn.fromSource).toBe(false);
  });

  it('LEAVES A PLACE EMPTY where the shape asks for a man this bundle cannot name', () => {
    // Il modulo viene dai conteggi di CLUB, completi; i nomi passano dall'imbuto delle identita' e dal
    // perimetro del listone. Togliere il posto direbbe che il club ha giocato in dieci.
    const short = eleven().filter((one) => one.name !== 'DifensoreD');
    const drawn = lineupOf('4-3-3', short);
    expect(names(drawn, 'D')).toEqual(['DifensoreA', 'DifensoreB', 'DifensoreC', null]);
    expect(drawn.named).toBe(10);
    expect(drawn.wanted).toBe(11);
  });

  it('never invents a trequarti: the club counts have three lines and cannot say 4-2-3-1', () => {
    const drawn = lineupOf('4-3-3', eleven());
    expect(drawn.rows.some((row) => row.line === 'T')).toBe(false);
  });

  it('draws what it has when the shape is unknown, instead of inventing one from the names', () => {
    // Una distinta che non fa undici titolari non produce un modulo (`buildShapes` la scarta): allora
    // le righe descrivono quello che si e' potuto leggere, e il campetto lo dice.
    const drawn = lineupOf(null, eleven().slice(0, 6));
    expect(drawn.shape).toBeNull();
    expect(drawn.wanted).toBe(6);
    expect(drawn.rows.every((row) => row.places.every((one) => one.man != null))).toBe(true);
  });

  it('PUTS WHO CAME ON IN THE POSITION HE CAME ON IN, from his own profile', () => {
    // Il caso dell'operatore (12/09/2026): «Lucca e' una Pc e va al centro, Neres e' una W e va di
    // lato». Con un numero solo per uomo i due leggevano uguale - nessuno dei due ha un codice di LATO
    // - e l'ordine finiva per essere quello dei minuti, che li scambiava. `pc` e `w` sono due cose
    // diverse e il modello a quattro fasce le distingue.
    const codes = new Map<number, string[]>();
    const lucca = man('Lucca', { position: 'F', started: false, minutes: 18 });
    const neres = man('Neres', { position: 'F', started: false, minutes: 28 });
    codes.set(lucca.fcId, ['pc']);
    codes.set(neres.fcId, ['w', 'a']);
    const drawn = lineupOf('4-3-3', [...eleven(), lucca, neres], (fcId) => codes.get(fcId) ?? null);
    const attack = drawn.rows.find((row) => row.line === 'A');
    const where = (name: string) =>
      attack?.places.findIndex((one) => one.came.some((sub) => sub.name === name));
    expect(where('Lucca')).toBe(1);                 // al centro, come dice il suo `pc`
    expect([0, 2]).toContain(where('Neres'));       // di lato, come dice la sua `w`
    expect(drawn.came.map((one) => one.name)).toEqual(['Neres', 'Lucca']);
  });

  it('sends a LEFT winger to the left of the row and not merely to some extreme', () => {
    const codes = new Map<number, string[]>();
    const winger = man('Ala sinistra', { position: 'F', started: false, minutes: 24 });
    codes.set(winger.fcId, ['LW']);
    const drawn = lineupOf('4-3-3', [...eleven(), winger], (fcId) => codes.get(fcId) ?? null);
    const attack = drawn.rows.find((row) => row.line === 'A');
    expect(attack?.places.map((one) => one.came.map((sub) => sub.name))).toEqual([
      [], [], ['Ala sinistra'],
    ]);
  });

  it('spreads several substitutes instead of stacking them on one shirt', () => {
    const subs = ['Uno', 'Due', 'Tre'].map((name, at) =>
      man(name, { position: 'M', started: false, minutes: 30 - at }));
    const drawn = lineupOf('4-3-3', [...eleven(), ...subs]);
    const midfield = drawn.rows.find((row) => row.line === 'M');
    expect(midfield?.places.map((one) => one.came.length)).toEqual([1, 1, 1]);
  });

  it('PUTS THE SUBSTITUTE IN THE PLACE THAT WAS REALLY VACATED, over his own profile', () => {
    // Il caso dell'operatore (12/09/2026): la Juventus parte 4-4-2 e diventa 4-2-3-1, e Gonzalez N.
    // finiva sotto Kolo Muani - che ha giocato NOVANTA MINUTI, quindi il suo posto non si e' mai
    // liberato. Il cambio vero dice che e' entrato per David.
    const men = eleven();
    const left = men.find((one) => one.name === 'AttaccanteC')!;
    left.minutes = 57;
    const codes = new Map<number, string[]>();
    const sub = man('Subentrato', { position: 'F', started: false, minutes: 33,
      cameFor: left.fcId });
    codes.set(sub.fcId, ['pc']);                    // il profilo lo manderebbe al CENTRO
    const drawn = lineupOf('4-3-3', [...men, sub], (fcId) => codes.get(fcId) ?? null);
    const attack = drawn.rows.find((row) => row.line === 'A');
    expect(attack?.places.map((one) => one.came.map((who) => who.name))).toEqual([
      [], [], ['Subentrato'],                       // il posto di AttaccanteC, che e' l'unico uscito
    ]);
  });

  it('WALKS THE CHAIN when a substitute came on for another substitute', () => {
    // 29/08/2026: Koopmeiners entra al 86' per Cambiaso, entrato al 76' per Conceicao. Il posto del
    // modulo e' quello di Conceicao, e fermarsi al primo anello non lo troverebbe.
    const men = eleven();
    const starter = men.find((one) => one.name === 'MedianoA')!;
    starter.minutes = 76;
    const first = man('Primo', { position: 'M', started: false, minutes: 10,
      cameFor: starter.fcId });
    const second = man('Secondo', { position: 'M', started: false, minutes: 9,
      cameFor: first.fcId });
    const drawn = lineupOf('4-3-3', [...men, first, second]);
    const midfield = drawn.rows.find((row) => row.line === 'M');
    expect(midfield?.places.map((one) => one.came.map((who) => who.name))).toEqual([
      ['Primo', 'Secondo'], [], [],
    ]);
  });

  it('does not hang on a came_for that points back at itself, and falls back instead', () => {
    // Un dato sporco non deve poter impedire al campetto di finire di disegnarsi.
    const loop = man('Anello', { position: 'M', started: false, minutes: 20 });
    loop.cameFor = loop.fcId;
    const drawn = lineupOf('4-3-3', [...eleven(), loop]);
    expect(drawn.rows.find((row) => row.line === 'M')?.places
      .flatMap((one) => one.came.map((who) => who.name))).toEqual(['Anello']);
  });

  it('PREFERS A VACATED PLACE in the fallback: a man who played the whole match gave up no shirt', () => {
    // Senza il cambio (una coppa, un pacchetto vecchio, un uscente fuori dal listone) resta comunque
    // vero che chi e' rimasto in campo novanta minuti non ha ceduto il posto a nessuno.
    const men = eleven();
    men.find((one) => one.name === 'AttaccanteC')!.minutes = 60;
    const codes = new Map<number, string[]>();
    const sub = man('Senza cambio', { position: 'F', started: false, minutes: 30 });
    codes.set(sub.fcId, ['pc']);                    // il centro, che pero' non si e' liberato
    const drawn = lineupOf('4-3-3', [...men, sub], (fcId) => codes.get(fcId) ?? null);
    const attack = drawn.rows.find((row) => row.line === 'A');
    expect(attack?.places.findIndex((one) => one.came.length)).toBe(2);
  });

  it('reads the MEASURED side of a substitute before his listone profile, in the fallback', () => {
    // `avg_y` e' una media dei suoi tocchi IN QUELLA PARTITA, nello stesso verso di `lineup_slot`
    // (misurato: 86,0% di accordo su 683 linee). Un codice di listone dice il mestiere per cui lo
    // compri, e su chi non ne ha nessuno che parli non direbbe niente affatto.
    const mute = man('Misurato', { position: 'M', started: false, minutes: 25, lateral: 92 });
    const drawn = lineupOf('4-3-3', [...eleven(), mute]);
    expect(drawn.rows.find((row) => row.line === 'M')?.places
      .map((one) => one.came.length)).toEqual([0, 0, 1]);
  });

  it('leaves an UNUSED substitute out: he did not play, and a minute of zero is not a minute', () => {
    const men = [
      ...eleven(),
      man('Entrato', { started: false, minutes: 23 }),
      man('Panchina', { started: false, minutes: null }),
      man('Panchina zero', { started: false, minutes: 0 }),
    ];
    const drawn = lineupOf('4-3-3', men);
    expect(drawn.came.map((one) => one.name)).toEqual(['Entrato']);
    expect(drawn.named).toBe(11);
  });

  it('counts a starter with NO position apart instead of dropping him into a row', () => {
    const men = eleven().map((one) =>
      one.name === 'MedianoC' ? { ...one, position: null } : one);
    const drawn = lineupOf('4-3-3', men);
    expect(drawn.unplaced.map((one) => one.name)).toEqual(['MedianoC']);
    expect(names(drawn, 'M')).toEqual(['MedianoA', 'MedianoB', null]);
  });

  it('says so when the names found are MORE than the shape asks, instead of hiding one', () => {
    const men = [...eleven(), man('Quinto difensore', { slot: 11 })];
    const drawn = lineupOf('4-3-3', men);
    expect(drawn.problems.length).toBe(1);
    expect(drawn.problems[0]).toContain('linea D');
    expect(names(drawn, 'D').length).toBe(5);
  });
});
