import { describe, expect, it } from 'vitest';

import {
  CEILING_ALWAYS_WRONG,
  DEPTH_HANDS,
  DEPTH_TIER,
  LADDER,
  PlanciaMan,
  Role,
  ROLES,
  adviseLot,
  alternativeFor,
  buildMap,
  depthFactor,
  discountFor,
  offerBand,
  worthWaiting,
} from './plancia';

function man(id: number, role: Role, fvm: number, points: number | null = fvm): PlanciaMan {
  return { id, name: `M${id}`, club: 'C', role, fvm, points, pv: 30, basis: 'measured' };
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
