import { describe, expect, it } from 'vitest';

import {
  CEILING_ALWAYS_WRONG,
  DEPTH_HANDS,
  DEPTH_TIER,
  BET_CAP_HIGH,
  BET_CAP_LOW,
  LADDER,
  MIN_PLAY_SHARE,
  PlanciaMan,
  Role,
  ROLES,
  adviseLot,
  alternativeFor,
  buildMap,
  depthFactor,
  regroupByOffer,
  discountFor,
  offerBand,
  worthWaiting,
  EDGE_BASE,
} from './plancia';

function man(
  id: number,
  role: Role,
  fvm: number,
  points: number | null = fvm,
  outNow = false,
): PlanciaMan {
  return {
    id,
    name: `M${id}`,
    club: 'C',
    role,
    fvm,
    points,
    pv: 30,
    // `fantamedia − 6`, per PARTITA giocata: le presenze stanno accanto (`pv`) e non dentro
    edge: points == null ? null : points / 30 - EDGE_BASE,
    // Lo SWING la riempie lo store, non la mappa: qui e' vuota di default e i test che la vogliono
    // se la mettono, cosi' ogni asserzione sull'ordine dice da se' su quale numero e' fatta.
    swing: null,
    basis: 'measured',
    confidence: 1,
    outNow,
  };
}

/** A listone big enough to fill every slot of a ten-team league, plus a tail. */
function listone(teams = 10, extra = 7): PlanciaMan[] {
  const slots: Record<Role, number> = { P: 3, D: 8, C: 8, A: 6 };
  const out: PlanciaMan[] = [];
  let id = 1;
  for (const role of ROLES) {
    const count = slots[role] * teams + extra;
    for (let at = 0; at < count; at += 1) out.push(man(id++, role, count - at));
  }
  return out;
}

describe('la mappa a slot', () => {
  const slots: Record<Role, number> = { P: 3, D: 8, C: 8, A: 6 };

  it('è 25 blocchi da `teams` uomini, perché una rosa è un uomo per slot', () => {
    const map = buildMap(listone(), 10, slots);
    expect(map.blocks).toHaveLength(3 + 8 + 8 + 6);
    for (const block of map.blocks) expect(block.men).toHaveLength(10);
  });

  it('taglia per FVM: il primo blocco porta i dieci più cari del ruolo', () => {
    const map = buildMap(listone(), 10, slots);
    const first = map.byRole.get('D')![0];
    const second = map.byRole.get('D')![1];
    const cheapestOfFirst = Math.min(...first.men.map((entry) => entry.fvm));
    const dearestOfSecond = Math.max(...second.men.map((entry) => entry.fvm));
    expect(cheapestOfFirst).toBeGreaterThan(dearestOfSecond);
  });

  it('conta la coda invece di nasconderla', () => {
    const map = buildMap(listone(10, 7), 10, slots);
    expect(map.tail).toHaveLength(7 * 4);
  });

  it('ordina DENTRO il blocco per valore atteso e non per prezzo', () => {
    // Due uomini nello stesso blocco: il più caro è quello che il motore prezza peggio.
    const men = [man(1, 'P', 50, 100), man(2, 'P', 90, 10)];
    const block = buildMap(men, 2, { P: 1, D: 0, C: 0, A: 0 }).byRole.get('P')![0];
    expect(block.men.map((entry) => entry.id)).toEqual([1, 2]);
    // ...e l'appartenenza resta decisa dal prezzo: sono entrambi nel primo slot.
    expect(block.men).toHaveLength(2);
  });

  it('è deterministica: due letture dello stesso listone danno una mappa sola', () => {
    const first = buildMap(listone(), 10, slots);
    const second = buildMap([...listone()].reverse(), 10, slots);
    expect(first.blocks.map((block) => block.men.map((entry) => entry.id))).toEqual(
      second.blocks.map((block) => block.men.map((entry) => entry.id)),
    );
  });
});

describe('la max offerta', () => {
  const base = { role: 'A' as Role, slotIndex: 1, points: 100, medianPoints: 100 };

  it('è una banda e mai una cifra secca', () => {
    const band = offerBand({ ...base, budget: 1000, room: 1000 })!;
    expect(band.high).toBeGreaterThan(band.low);
  });

  it('scala col budget: la stessa QUOTA a 500, 1000 e 2000', () => {
    const shares = [500, 1000, 2000].map(
      (budget) => offerBand({ ...base, budget, room: budget })!.share,
    );
    for (const share of shares) expect(share).toBeCloseTo(LADDER.A[0], 6);
  });

  it('non consiglia un tetto che la borsa non può raggiungere', () => {
    const band = offerBand({ ...base, budget: 1000, room: 40 })!;
    expect(band.high).toBe(40);
    expect(band.capped).toBe(true);
  });

  it('dichiara quando sfonda il 20% del budget, che è la riga che la misura sa dire secca', () => {
    const band = offerBand({ ...base, budget: 1000, room: 1000 })!;
    expect(band.share).toBeGreaterThan(CEILING_ALWAYS_WRONG);
    expect(band.overCeiling).toBe(true);
    const cheap = offerBand({ ...base, slotIndex: 3, budget: 1000, room: 1000 })!;
    expect(cheap.overCeiling).toBe(false);
  });

  it('usa il valore atteso dell’uomo solo per spostarlo DENTRO la banda del suo slot', () => {
    const rich = offerBand({ ...base, points: 1000, budget: 1000, room: 1000 })!;
    const poor = offerBand({ ...base, points: 1, budget: 1000, room: 1000 })!;
    // Il termine è tosato: la banda resta un fatto sullo slot, non una nostra graduatoria.
    expect(rich.share / poor.share).toBeCloseTo(1.35 / 0.65, 5);
  });

  it('sale quando sotto di lui la profondità è finita, e non prima', () => {
    expect(depthFactor(0)).toBe(1);
    expect(depthFactor(1)).toBeCloseTo(1.05, 5);
    expect(depthFactor(2)).toBeCloseTo(1.52, 5);
  });

  it('la difesa è pagata sopra il mercato sui primi QUATTRO slot, non su un top', () => {
    // §19.3: i quattro difensori migliori sono l'investimento, il resto è al prezzo del mercato o sotto.
    expect(LADDER.D.slice(0, 4).every((share) => share >= 0.025)).toBe(true);
    expect(LADDER.D.slice(4).every((share) => share <= 0.005)).toBe(true);
  });
});

describe('lo sconto di fine asta', () => {
  it('non esiste per i primi due slot: al massimo il 20%', () => {
    expect(discountFor(1, 10, 10)).toBe(1);
    expect(discountFor(2, 3, 10)).toBe(0.8);
  });

  it('dimezza dal terzo slot e taglia di cinque volte dal quinto', () => {
    expect(discountFor(3, 7, 10)).toBe(0.5);
    expect(discountFor(6, 3, 10)).toBe(0.21);
  });

  it('è una soglia sulle MANI e non una curva sul tempo', () => {
    expect(discountFor(6, 10, 10)).toBe(1);
    expect(discountFor(6, 9, 10)).toBe(1);
    expect(discountFor(6, 8, 10)).toBe(0.36);
  });
});

describe('il tempismo', () => {
  it('lascia passare solo dal terzo slot in giù, e solo a tavolo aperto', () => {
    expect(worthWaiting(DEPTH_TIER, 10, 10)).toBe(false);
    expect(worthWaiting(DEPTH_TIER + 1, DEPTH_HANDS, 10)).toBe(true);
    expect(worthWaiting(DEPTH_TIER + 1, DEPTH_HANDS - 1, 10)).toBe(false);
  });
});

describe('l’alternativa', () => {
  const slots: Record<Role, number> = { P: 3, D: 8, C: 8, A: 6 };
  const map = buildMap(listone(), 10, slots);

  /** The board quotes the pair in MAX OFFER, so the test states the currency the way a caller does. */
  const asFvm = (entry: PlanciaMan) => Math.round(entry.fvm);

  it('per un uomo di movimento è la COPPIA dello slot successivo', () => {
    const block = map.byRole.get('D')![0];
    const alt = alternativeFor(map, block, () => true, block.men[0].id, asFvm)!;
    expect(alt.men).toHaveLength(2);
    expect(map.slotOf.get(alt.men[0].id)!.id).toBe('D2');
    expect(alt.total).toBe(alt.men.reduce((sum, entry) => sum + Math.round(entry.fvm), 0));
  });

  it('porta il costo di CIASCUNO dei due, non solo il totale', () => {
    const block = map.byRole.get('C')![0];
    const alt = alternativeFor(
      map,
      block,
      () => true,
      block.men[0].id,
      () => 7,
    )!;
    expect(alt.costs).toEqual([7, 7]);
    expect(alt.together).toBe(true);
    expect(alt.total).toBe(14);
  });

  it('la valuta è del CHIAMANTE: lo stesso uomo vale quello che il chiamante dice', () => {
    const block = map.byRole.get('C')![0];
    const cheap = alternativeFor(
      map,
      block,
      () => true,
      -1,
      () => 1,
    )!;
    const dear = alternativeFor(
      map,
      block,
      () => true,
      -1,
      () => 100,
    )!;
    expect(cheap.men.map((entry) => entry.id)).toEqual(dear.men.map((entry) => entry.id));
    expect(cheap.total).toBe(2);
    expect(dear.total).toBe(200);
  });

  it('per un PORTIERE non è una coppia: se ne schiera uno, quindi è un altro dello stesso slot', () => {
    const block = map.byRole.get('P')![0];
    const alt = alternativeFor(map, block, () => true, block.men[0].id, asFvm)!;
    expect(map.slotOf.get(alt.men[0].id)!.id).toBe('P1');
    expect(alt.men.some((entry) => entry.id === block.men[0].id)).toBe(false);
  });

  it('...e per lui NON esiste un totale, perché i due sono alternative fra loro', () => {
    // Ne schieri uno: sommarli confronterebbe il suo prezzo con una cifra che nessuno pagherebbe.
    const keepers = alternativeFor(map, map.byRole.get('P')![0], () => true, 1, asFvm)!;
    expect(keepers.together).toBe(false);
    expect(keepers.total).toBeNull();
    const movers = alternativeFor(map, map.byRole.get('A')![0], () => true, -1, asFvm)!;
    expect(movers.together).toBe(true);
    expect(movers.total).toBeGreaterThan(0);
  });

  it('si calcola su chi è ancora nell’urna, non sui due migliori di sempre', () => {
    const block = map.byRole.get('D')![0];
    const second = map.byRole.get('D')![1];
    const gone = new Set(second.men.slice(0, 9).map((entry) => entry.id));
    const alt = alternativeFor(map, block, (entry) => !gone.has(entry.id), block.men[0].id, asFvm)!;
    // Nel secondo slot ne resta uno solo, quindi la coppia arriva dal terzo.
    expect(map.slotOf.get(alt.men[0].id)!.id).toBe('D3');
  });
});

describe('il verdetto', () => {
  const shared = {
    role: 'C' as Role,
    medianFvm: 40,
    teams: 10,
    exhaustedBelow: 0,
    priced: true,
  };
  const band = offerBand({
    role: 'C',
    slotIndex: 3,
    budget: 1000,
    room: 1000,
    points: 100,
    medianPoints: 100,
  })!;

  it('un uomo che il foglio non prezza è IGNOTO, non un «lascia» morbido', () => {
    const advice = adviseLot({
      ...shared,
      slotIndex: 3,
      band,
      tablePrice: 1,
      hands: 2,
      priced: false,
    });
    expect(advice.verdict).toBe('ignoto');
  });

  it('oltre la banda è LASCIA', () => {
    const advice = adviseLot({
      ...shared,
      slotIndex: 3,
      band,
      tablePrice: band.high + 1,
      hands: 2,
    });
    expect(advice.verdict).toBe('lascia');
  });

  it('a tavolo aperto e dal terzo slot in giù è ASPETTA', () => {
    const advice = adviseLot({ ...shared, slotIndex: 3, band, tablePrice: 1, hands: 10 });
    expect(advice.verdict).toBe('aspetta');
  });

  it('nei primi due slot non aspetta mai, perché non arrivano in saldo', () => {
    const top = offerBand({
      role: 'C',
      slotIndex: 1,
      budget: 1000,
      room: 1000,
      points: 100,
      medianPoints: 100,
    })!;
    const advice = adviseLot({ ...shared, slotIndex: 1, band: top, tablePrice: 1, hands: 10 });
    expect(advice.verdict).toBe('prendi');
  });

  it('porta il prezzo che il mercato paga davvero, scontato per le mani alzate', () => {
    const open = adviseLot({ ...shared, slotIndex: 6, band, tablePrice: 1, hands: 10 });
    const thin = adviseLot({ ...shared, slotIndex: 6, band, tablePrice: 1, hands: 2 });
    expect(open.expectedPrice).toBeGreaterThan(thin.expectedPrice);
  });
});

describe('chi oggi non gioca', () => {
  it('NON viene spostato di una riga: e informazione e non un vincolo', () => {
    // Il migliore dello slot salta la prossima. Resta primo, perche una gara saltata non e un fatto
    // di mercato (operatore, 04/09/2026) - e senza il barrato, che era l inchiostro con cui il
    // vincolo si dichiarava, farlo scendere sarebbe un riordino MUTO.
    const men = [man(1, 'C', 100, 900, true), man(2, 'C', 90, 500), man(3, 'C', 80, 100)];
    const block = buildMap(men, 3, { P: 0, D: 0, C: 1, A: 0 }).byRole.get('C')![0];
    expect(block.men.map((entry) => entry.id)).toEqual([1, 2, 3]);
    expect(block.men).toHaveLength(3);
  });

  it('...e l ordine e lo STESSO che avrebbe se non fosse fuori: il campo non entra nel confronto', () => {
    const key = (rows: PlanciaMan[]) =>
      buildMap(rows, 3, { P: 0, D: 0, C: 1, A: 0 })
        .byRole.get('C')![0]
        .men.map((entry) => entry.id);
    const healthy = [man(1, 'C', 100, 900), man(2, 'C', 90, 500), man(3, 'C', 80, 100)];
    const hurt = [man(1, 'C', 100, 900, true), man(2, 'C', 90, 500), man(3, 'C', 80, 100)];
    expect(key(hurt)).toEqual(key(healthy));
  });

  it('e sulla griglia PERSONALE e elencato come tutti gli altri', () => {
    const men = [man(1, 'C', 100, 900, true), man(2, 'C', 90, 500), man(3, 'C', 80, 100)];
    const blocks = regroupByOffer(men, (one) => one.points ?? -1, 3, {
      P: 0,
      D: 0,
      C: 1,
      A: 0,
    });
    expect(blocks[0].men.map((one) => one.id)).toEqual([1, 2, 3]);
  });

  it('il verdetto diventa FERMO, prima di ogni prezzo', () => {
    const band = offerBand({
      role: 'C',
      slotIndex: 1,
      budget: 1000,
      room: 1000,
      points: 100,
      medianPoints: 100,
    })!;
    const advice = adviseLot({
      role: 'C',
      slotIndex: 1,
      band,
      medianFvm: 40,
      tablePrice: 1,
      hands: 10,
      teams: 10,
      exhaustedBelow: 0,
      priced: true,
      outNow: true,
      outReason: 'La stampa lo dà indisponibile.',
    });
    expect(advice.verdict).toBe('fermo');
    expect(advice.reason).toContain('stampa');
    // ...e la banda resta quella: non sappiamo per quanto starà fuori, quindi non lo riprezziamo.
    expect(advice.band).toBe(band);
  });

  it('batte anche il caso «non prezzato», perché è una prova più forte', () => {
    const advice = adviseLot({
      role: 'C',
      slotIndex: 1,
      band: null,
      medianFvm: 40,
      tablePrice: 0,
      hands: 10,
      teams: 10,
      exhaustedBelow: 0,
      priced: false,
      outNow: true,
    });
    expect(advice.verdict).toBe('fermo');
  });
});

describe('chi ha una data di rientro', () => {
  const window = {
    until: '2026-11-25',
    declared: '2026-11-15',
    seasonOver: false,
    source: 'file' as const,
    slipDays: 10,
    lost: 10,
    playable: 26,
    remaining: 36,
    share: 26 / 36,
  };

  it('la quota di calendario scende SOTTO il pavimento della clamp, che vale per le opinioni', () => {
    // Un uomo esattamente sulla mediana del suo slot, con e senza la finestra. `points` porta gia' la
    // riduzione: senza la quota la clamp lo bloccherebbe a 0,65 e l'offerta direbbe «paga il 65%» a
    // chi gioca il 58% delle giornate che restano.
    //
    // SU UNO SLOT BASSO di proposito: in cima morderebbe il tetto DICHIARATO della scommessa e il
    // passo si troverebbe a misurare due regole insieme, attribuendo il difetto a quella sbagliata.
    const median = 200;
    const share = 0.58;
    const at = (points: number, available?: number) =>
      offerBand({
        role: 'C',
        slotIndex: 4,
        budget: 1000,
        room: 1000,
        points,
        medianPoints: median,
        available,
      })!;
    const full = at(median);
    const clamped = at(median * share);
    const priced = at(median * share, share);
    expect(clamped.bet).toBe(false);
    expect(clamped.share).toBeCloseTo(full.share * 0.65, 6);
    expect(priced.share).toBeCloseTo(full.share * share, 6);
    expect(priced.high).toBeLessThan(clamped.high);
  });

  it('senza un numero sul foglio, la quota prezza da sola', () => {
    const band = offerBand({
      role: 'C',
      slotIndex: 2,
      budget: 1000,
      room: 1000,
      points: null,
      medianPoints: null,
      available: 0.5,
    })!;
    expect(band.share).toBeCloseTo(LADDER.C[1] * 0.5, 6);
  });

  it("NON scende in fondo allo slot: scende da se', di quanto dicono le sue giornate", () => {
    // Due uomini dello stesso slot, il secondo migliore ma fuori fino a novembre: l'ordine lo decide
    // il valore atteso gia' ridotto, e non un gradino che li separerebbe comunque.
    const healthy = man(1, 'A', 100, 150);
    const hurt: PlanciaMan = { ...man(2, 'A', 100, 260 * window.share), out: window };
    const map = buildMap([healthy, hurt], 2, { P: 3, D: 8, C: 8, A: 6 });
    expect(map.blocks[0].men.map((one) => one.id)).toEqual([2, 1]);
  });

  it('il verdetto resta un prezzo e la ragione dice la finestra', () => {
    const advice = adviseLot({
      role: 'A',
      slotIndex: 1,
      band: {
        low: 60,
        high: 70,
        share: 0.07,
        capped: false,
        overCeiling: false,
        pricedAt: 2,
        bet: false,
      },
      medianFvm: 60,
      tablePrice: 50,
      hands: 3,
      teams: 10,
      exhaustedBelow: 0,
      priced: true,
      out: window,
    });
    expect(advice.verdict).toBe('prendi');
    expect(advice.reason).toContain('25/11/2026');
    expect(advice.reason).toContain('26 giornate su 36');
  });
});

describe('lo sconto per un club che ho già', () => {
  it('scende col secondo uomo e scende di più col terzo', () => {
    // Sua istruzione del 04/09/2026, e la forma è sua: l'offerta cala già dal SECONDO uomo di un club
    // e peggiora dal terzo. Il banco misura invece `CLUB_FREE` = 2 e `CLUB_PENALTY` = 0,45 - i primi
    // due gratis e il 45% dal terzo - quindi questa scala comincia un uomo prima ed è più cauta: i
    // valori sono DICHIARATI, e questo test è il posto che lo dice.
    const shape = {
      role: 'A' as const,
      slotIndex: 1,
      budget: 1000,
      room: 1000,
      points: 100,
      medianPoints: 100,
    };
    const alone = offerBand({ ...shape, sameClub: 0 })!;
    const second = offerBand({ ...shape, sameClub: 1 })!;
    const third = offerBand({ ...shape, sameClub: 2 })!;
    expect(second.high).toBeLessThan(alone.high);
    expect(third.high).toBeLessThan(second.high);
    // Le due quote dichiarate, non un ordine qualsiasi: −10% e −25%.
    expect(second.high / alone.high).toBeCloseTo(0.9, 2);
    expect(third.high / alone.high).toBeCloseTo(0.75, 2);
    // E dal quarto in poi non peggiora oltre: una scala che continua a scendere finirebbe a zero su
    // una rosa che pesca molto da un club, e nessuno ha misurato quel fondo.
    expect(offerBand({ ...shape, sameClub: 5 })!.high).toBe(third.high);
  });

  it('non tocca chi non ha compagni in rosa', () => {
    const shape = {
      role: 'D' as const,
      slotIndex: 2,
      budget: 1000,
      room: 1000,
      points: 50,
      medianPoints: 50,
    };
    expect(offerBand({ ...shape, sameClub: 0 })).toEqual(offerBand(shape));
  });
});

describe('chi rientra troppo tardi non entra in plancia', () => {
  const late = (id: number, fvm: number, share: number): PlanciaMan => ({
    ...man(id, 'D', fvm, fvm),
    out: {
      until: '2027-01-20',
      declared: '2027-01-03',
      seasonOver: false,
      source: 'press' as const,
      slipDays: 17,
      lost: 15,
      playable: 21,
      remaining: 36,
      share,
    },
  });

  /** Undici difensori: il terzo per FVM rientra a gennaio, gli altri stanno bene. */
  const eleven = () => [
    man(1, 'D', 100, 100),
    man(2, 'D', 90, 90),
    late(3, 80, 0.58),
    ...[4, 5, 6, 7, 8, 9, 10, 11].map((id) => man(id, 'D', 80 - id, 80 - id)),
  ];

  it('la sua riga non si disegna, e il blocco lo dice invece di tacere', () => {
    const block = buildMap(eleven(), 10, { P: 3, D: 8, C: 8, A: 6 }).byRole.get('D')![0];
    expect(block.men.map((one) => one.id)).not.toContain(3);
    expect(block.excluded.map((one) => one.id)).toEqual([3]);
  });

  it('RESTA NEL RANGO: nessuno sale di slot al suo posto', () => {
    // Undici uomini: dieci in D1 e l-undicesimo in D2, e ci RESTA. Se l-escluso liberasse il suo
    // posto, la mia plancia parlerebbe di slot diversi da quelli su cui la scala e- misurata.
    const map = buildMap(eleven(), 10, { P: 3, D: 8, C: 8, A: 6 });
    expect(map.byRole.get('D')![0].men.length).toBe(9);
    expect(map.byRole.get('D')![1].men.map((one) => one.id)).toEqual([11]);
  });

  it('la mediana del PREZZO lo conta comunque: la stanza lo compra ancora', () => {
    const withHim = buildMap(eleven(), 10, { P: 3, D: 8, C: 8, A: 6 }).byRole.get('D')![0];
    const healthy = eleven().map((one) => (one.id === 3 ? man(3, 'D', 80, 80) : one));
    const without = buildMap(healthy, 10, { P: 3, D: 8, C: 8, A: 6 }).byRole.get('D')![0];
    expect(withHim.medianFvm).toBe(without.medianFvm);
  });

  it('la soglia e- una QUOTA e chi la supera resta, riprezzato', () => {
    const men = eleven().map((one) => (one.id === 3 ? late(3, 80, MIN_PLAY_SHARE + 0.01) : one));
    const block = buildMap(men, 10, { P: 3, D: 8, C: 8, A: 6 }).byRole.get('D')![0];
    expect(block.men.map((one) => one.id)).toContain(3);
    expect(block.excluded).toEqual([]);
  });
});

describe('il tetto di chi non gioca oggi', () => {
  const band = (extra: Partial<Parameters<typeof offerBand>[0]>) =>
    offerBand({
      role: 'C',
      slotIndex: 1,
      budget: 1000,
      room: 1000,
      points: 200,
      medianPoints: 200,
      ...extra,
    })!;

  it('chi e infortunato oggi si paga come lo slot SOTTO, con o senza una data', () => {
    const healthy = band({});
    const dated = band({ hurt: true, available: 0.92 });
    const undated = band({ hurt: true });
    expect(healthy.pricedAt).toBe(1);
    expect(dated.pricedAt).toBe(2);
    // Chi non dice quando torna e quello di cui sappiamo MENO: non puo avere il tetto pieno.
    expect(undated.pricedAt).toBe(2);
    expect(dated.high).toBeLessThan(healthy.high);
  });

  it('sotto la soglia della scommessa comanda il tetto DICHIARATO, e sono le sue due cifre', () => {
    const wager = band({ hurt: true, available: 0.64 });
    expect(wager.bet).toBe(true);
    expect(wager.low).toBe(BET_CAP_LOW * 1000);
    expect(wager.high).toBe(BET_CAP_HIGH * 1000);
  });

  it('...ma non ALZA mai: chi vale gia meno di 30 crediti resta dov e', () => {
    const cheap = band({ role: 'C', slotIndex: 6, hurt: true, available: 0.64 });
    expect(cheap.bet).toBe(false);
    expect(cheap.high).toBeLessThan(BET_CAP_HIGH * 1000);
  });

  it('una STIMA non si paga come una misura: la confidenza entra nel tetto', () => {
    const measured = band({});
    const guessed = band({ confidence: 0.5 });
    expect(guessed.high).toBeCloseTo(measured.high / 2, 0);
    // ...e non tocca l ORDINE, che resta il valore atteso: `points` non passa da qui.
    expect(guessed.pricedAt).toBe(measured.pricedAt);
  });
});

describe('la griglia PERSONALE', () => {
  const slots: Record<Role, number> = { P: 3, D: 8, C: 8, A: 6 };

  /** Un ruolo in cui la mia offerta e' l'ESATTO CONTRARIO del prezzo: due tagli che non si somigliano. */
  function upsideDown(teams = 10): { men: PlanciaMan[]; offerOf: (man: PlanciaMan) => number } {
    const men: PlanciaMan[] = [];
    const count = slots.D * teams;
    for (let at = 0; at < count; at += 1) men.push(man(at + 1, 'D', count - at));
    // fvm 80...1, offerta 1...80: chi la stanza prezza per ultimo e' quello che io pago di piu'.
    return { men, offerOf: (one) => count + 1 - one.fvm };
  }

  it('taglia sulla MIA offerta e non sul prezzo: il primo blocco porta i dieci che pago di piu', () => {
    const { men, offerOf } = upsideDown();
    const mine = regroupByOffer(men, offerOf, 10, slots);
    const market = buildMap(men, 10, slots);

    expect(mine[0].id).toBe('D1');
    expect(mine[0].men.map((one) => one.id)).toEqual([80, 79, 78, 77, 76, 75, 74, 73, 72, 71]);
    // ...che sono esattamente gli ULTIMI dieci del mercato: due tagli, due insiemi.
    expect(
      market.byRole
        .get('D')?.[7]
        .men.map((one) => one.id)
        .sort((a, b) => a - b),
    ).toEqual([...mine[0].men.map((one) => one.id)].sort((a, b) => a - b));
  });

  it('e la stessa gente: nessuno promosso da fuori, nessuno perso per strada', () => {
    const men = listone();
    const offerOf = (one: PlanciaMan) => (one.points ?? 0) * 2;
    const market = buildMap(men, 10, slots);
    const drawn = market.blocks.flatMap((block) => block.men);
    const mine = regroupByOffer(drawn, offerOf, 10, slots);

    expect(mine).toHaveLength(market.blocks.length);
    for (const block of mine) expect(block.men).toHaveLength(10);
    expect(mine.flatMap((block) => block.men.map((one) => one.id)).sort()).toEqual(
      drawn.map((one) => one.id).sort(),
    );
  });

  it('e deterministica: due letture della stessa plancia danno una griglia sola', () => {
    const { men, offerOf } = upsideDown();
    const once = regroupByOffer(men, offerOf, 10, slots);
    const twice = regroupByOffer([...men].reverse(), offerOf, 10, slots);
    expect(twice.map((block) => block.men.map((one) => one.id))).toEqual(
      once.map((block) => block.men.map((one) => one.id)),
    );
  });

  it('a offerta pari decide il prezzo della stanza, non l ordine di arrivo', () => {
    const flat: PlanciaMan[] = [man(1, 'P', 5), man(2, 'P', 40), man(3, 'P', 20)];
    const blocks = regroupByOffer(flat, () => 30, 3, { P: 1, D: 0, C: 0, A: 0 });
    expect(blocks[0].men.map((one) => one.id)).toEqual([2, 3, 1]);
  });

  /**
   * IL TAGLIO E' IL TETTO, L'ORDINE DENTRO E' LO SWING (operatore, 06/09/2026).
   *
   * Sono due domande - «quanto pagherei» e «chi mi fa vincere di piu'» - e per questo sono due chiavi.
   * Il test le separa muovendole in direzioni opposte: l'uomo per cui pagherei meno di tutti e' quello
   * che fa segnare di piu', e deve finire primo del blocco senza cambiare blocco.
   */
  it('taglia i blocchi personali sul tetto e li ORDINA sullo SWING', () => {
    const men: PlanciaMan[] = [];
    for (let at = 0; at < 20; at += 1) {
      men.push({ ...man(at + 1, 'D', 20 - at), swing: at });
    }
    const blocks = regroupByOffer(men, (one) => one.fvm, 10, { P: 0, D: 2, C: 0, A: 0 });

    // I due blocchi restano quelli del TETTO: i primi dieci per offerta, poi gli altri dieci.
    expect(blocks[0].men.map((one) => one.id).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    // ...e dentro ognuno comanda lo SWING, che qui e' l'opposto dell'offerta.
    expect(blocks[0].men.map((one) => one.id)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(blocks[1].men[0].id).toBe(20);
  });

  /** Un numero che non c'e' non si ordina: va in fondo, e il pareggio lo rompe il tetto come prima. */
  it('chi non ha uno SWING va in fondo al suo blocco, non in mezzo', () => {
    const men: PlanciaMan[] = [
      { ...man(1, 'P', 30), swing: null },
      { ...man(2, 'P', 20), swing: 1 },
      { ...man(3, 'P', 10), swing: 5 },
    ];
    const blocks = regroupByOffer(men, (one) => one.fvm, 3, { P: 1, D: 0, C: 0, A: 0 });
    expect(blocks[0].men.map((one) => one.id)).toEqual([3, 2, 1]);
  });

  it('elenca anche chi oggi non gioca, e lo mette dove il suo tetto lo mette', () => {
    const men: PlanciaMan[] = [];
    for (let at = 0; at < 20; at += 1) men.push(man(at + 1, 'D', 20 - at));
    // Il nome per cui pagherei di piu' salta la prossima giornata: resta, e resta primo.
    men[0] = { ...men[0], outNow: true };
    const blocks = regroupByOffer(men, (one) => one.fvm, 10, { P: 0, D: 2, C: 0, A: 0 });

    // Tolto per un'ora su sua richiesta e RIMESSO da lui stesso: «e' solo una gara saltata», e la
    // causa vera era il barrato, non la lista.
    expect(blocks[0].men.map((one) => one.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(blocks.flatMap((one) => one.men)).toHaveLength(20);
  });

  it('chi ha una DATA di rientro sta dove il suo tetto lo mette, e non in fondo per decreto', () => {
    const men: PlanciaMan[] = [];
    for (let at = 0; at < 10; at += 1) men.push(man(at + 1, 'P', 10 - at));
    men[0] = { ...men[0], points: 4, out: null };
    const blocks = regroupByOffer(men, (one) => one.points ?? -1, 10, { P: 1, D: 0, C: 0, A: 0 });
    // Fra il 6 e il 4 di punti attesi: il gradino binario servirebbe solo dove il numero manca.
    expect(blocks[0].men.map((one) => one.id)).toEqual([2, 3, 4, 5, 6, 1, 7, 8, 9, 10]);
  });

  it('chi il foglio non prezza affonda invece di ereditare il gradino del suo slot', () => {
    const men: PlanciaMan[] = [];
    for (let at = 0; at < 10; at += 1)
      men.push(man(at + 1, 'P', 30 - at, at === 0 ? null : 30 - at));
    // Un tetto che non esiste vale meno di qualunque tetto: e la stessa regola di «vuoto = ignoto».
    const blocks = regroupByOffer(men, (one) => one.points ?? -1, 10, { P: 1, D: 0, C: 0, A: 0 });
    expect(blocks[0].men.at(-1)?.id).toBe(1);
  });

  it('porta DUE mediane, e quella dell intestazione e la coordinata su cui ha tagliato', () => {
    const { men, offerOf } = upsideDown();
    const first = regroupByOffer(men, offerOf, 10, slots)[0];
    // La mia offerta mediana del blocco: 71...80, quindi 75,5.
    expect(first.medianOffer).toBe(75.5);
    // ...e quello che la stanza chiede per gli stessi dieci, che non e piu una proprieta del blocco.
    expect(first.medianFvm).toBe(5.5);
  });
});
