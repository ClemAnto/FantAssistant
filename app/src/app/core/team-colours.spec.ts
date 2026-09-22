import { describe, expect, it } from 'vitest';

import { TEAM_COLOURS, teamColour } from './team-colours';
import { deriveTeams } from './auction-feed';

/**
 * sRGB -> OKLab, so the separation the palette CLAIMS is asserted instead of commented.
 *
 * The file says the worst pair at ten squads reads ΔE 13.0 and that the hand-picked list it replaced
 * read 11.0. Those are the numbers that justify the change, so a test recomputes them: swapping in a
 * careless hex is exactly the way a measured palette quietly stops being one.
 */
function oklab(hex: string): [number, number, number] {
  const to = (at: number) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = [to(1), to(3), to(5)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s) * 100,
    (1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s) * 100,
    (0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s) * 100,
  ];
}

const gap = (a: string, b: string) => {
  const [p, q] = [oklab(a), oklab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

/** The worst pair of the first `n` slots, all pairs: two swatches can always end up side by side. */
function worstPair(colours: readonly string[], n: number): number {
  const take = colours.slice(0, n);
  let worst = Infinity;
  for (let i = 0; i < take.length; i++) {
    for (let j = i + 1; j < take.length; j++) worst = Math.min(worst, gap(take[i], take[j]));
  }
  return worst;
}

/** WCAG relative luminance, for «is the near-black badge ink readable on this chip». */
function luminance(hex: string): number {
  const to = (at: number) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * to(1) + 0.7152 * to(3) + 0.0722 * to(5);
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('la palette delle rose: quello che promette e quello che non può promettere', () => {
  it('sono sedici tinte distinte, e ognuna è un esadecimale a sei cifre', () => {
    expect(TEAM_COLOURS).toHaveLength(16);
    expect(new Set(TEAM_COLOURS).size).toBe(16);
    for (const hex of TEAM_COLOURS) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  /**
   * L'ORDINE È IL MECCANISMO: i primi `k` slot sono i `k` meglio separati, quindi la coppia peggiore
   * può solo PEGGIORARE crescendo. Un riordino distratto la romperebbe senza rompere nient'altro.
   */
  it('i primi slot sono i meglio separati, e la coppia peggiore non migliora crescendo', () => {
    const eight = worstPair(TEAM_COLOURS, 8);
    const ten = worstPair(TEAM_COLOURS, 10);
    const twelve = worstPair(TEAM_COLOURS, 12);
    expect(eight).toBeGreaterThanOrEqual(ten);
    expect(ten).toBeGreaterThanOrEqual(twelve);
    expect(twelve).toBeGreaterThanOrEqual(worstPair(TEAM_COLOURS, 16));
  });

  /**
   * IL NUMERO PUBBLICATO, e il confronto con la lista scritta a mano che questa palette sostituisce.
   * Il 12 è un pavimento e non il valore: è il 13.0 misurato meno un margine, così il test non si
   * rompe per un decimale e cade se qualcuno rimette una tinta che collassa su un'altra.
   */
  it('a dieci rose la coppia peggiore batte la lista scritta a mano', () => {
    const handPicked = [
      '#6f8cff', '#f21a3c', '#63c617', '#6300ff', '#0096a0',
      '#c89614', '#a1400c', '#1169f7', '#fa824c', '#757780',
    ];
    expect(worstPair(TEAM_COLOURS, 10)).toBeGreaterThan(worstPair(handPicked, 10));
    expect(worstPair(TEAM_COLOURS, 10)).toBeGreaterThan(12);
  });

  /**
   * LA PASTIGLIA PORTA INCHIOSTRO QUASI NERO, quindi ogni chip deve reggerlo: è la ragione per cui la
   * banda di chiarezza sta più in alto di quella del metodo di riferimento, e senza questo asserto
   * quella scelta è solo una frase in un commento.
   */
  it("ogni chip regge l'inchiostro quasi nero della sigla", () => {
    for (const hex of TEAM_COLOURS) expect(contrast(hex, '#0a0a0f')).toBeGreaterThanOrEqual(4.5);
  });

  /** ...e si vede su tutt'e tre le superfici scure dei due temi, dove vive la barra del proprietario. */
  it('ogni chip si stacca dalle superfici dei due temi', () => {
    for (const surface of ['#14141c', '#141d19', '#1c1c26']) {
      for (const hex of TEAM_COLOURS) expect(contrast(hex, surface)).toBeGreaterThanOrEqual(3);
    }
  });

  it('oltre il sedicesimo posto ricicla, e un rango negativo non esce dalla lista', () => {
    expect(teamColour(0)).toBe(TEAM_COLOURS[0]);
    expect(teamColour(16)).toBe(TEAM_COLOURS[0]);
    expect(teamColour(-1)).toBe(TEAM_COLOURS[15]);
  });
});

describe('chi decide il colore di una rosa', () => {
  const context = { budget: 500, zones: [], roles: {}, mantra: false };

  /**
   * IL DIFETTO CHE QUESTA PALETTE CURA, e prima non lo vedeva nessun test: senza un colore pubblicato
   * ogni rosa leggeva `currentColor`, cioè dieci squadre dello STESSO colore - il canale spento
   * proprio dove non c'è nient'altro a distinguerle (la barretta del proprietario non porta sigla).
   */
  it('senza un colore pubblicato ogni rosa ne prende uno diverso', () => {
    const teams = deriveTeams({ teams: [{ id: 7 }, { id: 3 }, { id: 11 }] }, new Map(), context);
    const colours = teams.map((team) => team.colour);
    expect(new Set(colours).size).toBe(3);
    for (const colour of colours) expect(TEAM_COLOURS).toContain(colour);
  });

  /**
   * LO SLOT È IL RANGO PER `id` E NON LA POSIZIONE NELL'ARRAY: l'ospite ripubblica lo stato intero a
   * ogni evento, e un colore che cambia fra due poll è peggio di un colore brutto.
   */
  it("il colore non cambia se l'ospite ripubblica le rose in un altro ordine", () => {
    const one = deriveTeams({ teams: [{ id: 7 }, { id: 3 }, { id: 11 }] }, new Map(), context);
    const two = deriveTeams({ teams: [{ id: 11 }, { id: 7 }, { id: 3 }] }, new Map(), context);
    const byId = (list: typeof one) =>
      Object.fromEntries(list.map((team) => [team.id, team.colour]));
    expect(byId(two)).toEqual(byId(one));
  });

  /** E un'asta VERA che pubblica i suoi colori se li tiene: è ciò che si vede sullo schermo della stanza. */
  it("un colore pubblicato dall'asta vera vince sulla palette", () => {
    const teams = deriveTeams(
      { teams: [{ id: 1, color: '#123456' }, { id: 2 }] },
      new Map(),
      context,
    );
    expect(teams[0].colour).toBe('#123456');
    expect(TEAM_COLOURS).toContain(teams[1].colour);
  });
});
