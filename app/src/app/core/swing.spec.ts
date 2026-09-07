import { describe, expect, it } from 'vitest';

import {
  GOALS_PER_POINT,
  LADDER_FLOOR,
  LADDER_KINK,
  LADDER_RUNG,
  MATCHDAY_MEAN,
  MATCHDAY_SD,
  ROLE_STEADY,
  SEEN_MATCHES,
  STEADY_MARGINAL,
  STEADY_SHARE,
  swingOf,
} from './swing';

describe('la scala dei gol', () => {
  it('e il ginocchio mezzo gradino sotto il pavimento, che e la media della scalinata', () => {
    // Il gradino [66, 72) vale 1 gol, e (69 - 63) / 6 = 1: e' la verifica che la retta lisciata passa
    // per il valor medio del gradino invece che per uno dei suoi due estremi.
    expect(LADDER_KINK).toBe(63);
    expect((69 - LADDER_KINK) / LADDER_RUNG).toBe(1);
    expect((LADDER_FLOOR + LADDER_RUNG + LADDER_RUNG / 2 - LADDER_KINK) / LADDER_RUNG).toBe(2);
  });

  /**
   * LA FORMA CHIUSA RIPRODUCE LA SIMULAZIONE, ed e' la sola prova che le due costanti sono giuste.
   *
   * Misurato sul bundle giocando dieci rose sulle giornate vere (2024-25 e 2025-26): un fantapunto a
   * giornata vale 6,04 e 6,00 gol di stagione. Se qualcuno tocca media o dispersione senza rimisurare,
   * questo test cade - che e' il suo mestiere.
   */
  it('converte un fantapunto a giornata negli stessi 6,0 gol che la simulazione ha misurato', () => {
    expect(GOALS_PER_POINT * 38).toBeGreaterThan(5.9);
    expect(GOALS_PER_POINT * 38).toBeLessThan(6.15);
  });

  /**
   * LA GIORNATA DI UNA ROSA STA DOVE LE DUE STAGIONI L'HANNO MESSA, e vale ~75 e non ~70.
   *
   * E' anche la ragione per cui il termine CONVESSO e' stato provato e tolto: una rosa vera i 66 li
   * supera nel 90% delle giornate, quindi la troncatura quasi non morde. Chi riporta la media a 70
   * senza rimisurare riapre quel discorso, e questo test glielo dice.
   */
  it('la giornata di una rosa supera i 66 quasi sempre, ed e per questo che la troncatura non paga', () => {
    expect(MATCHDAY_MEAN).toBeGreaterThan(74);
    expect(MATCHDAY_MEAN).toBeLessThan(75.5);
    expect(MATCHDAY_SD).toBeGreaterThan(6.5);
    expect(MATCHDAY_SD).toBeLessThan(7.5);
    expect(GOALS_PER_POINT * LADDER_RUNG).toBeGreaterThan(0.9);
  });
});

describe('il peso della costanza', () => {
  /**
   * IL PESO E' DELL'OPERATORE ED E' `2/11`, cioe' i due punti massimi dell'R-Factor della sua lega
   * spalmati sugli undici uomini che li producono — «il k dovrebbe dipendere da quanti punti e'
   * impostato il mod.dif e r-factor» (07/09/2026, e prima era 1/11). Il test fissa il valore perche'
   * **nessuna misura lo distingue da un altro, zero compreso**: sul banco curato (spartizione per
   * reparto di un tavolo vero, calendario simmetrizzato, null a +0,000 esatto) la griglia e' piatta e
   * i vicini cambiano segno — 1/11 −0,11 · **2/11 −0,25** · 6/11 +1,07 · 12/11 −0,55 · 96/11 +0,03.
   * La griglia che stava scritta qui era presa su un tavolo che non sapeva spendere ed e' RITIRATA
   * (il docstring di `swing.ts` racconta come).
   *
   * QUELLO CHE IL TEST DIFENDE DAVVERO E' IL TETTO, che non e' di nessuno ed e' aritmetico: oltre
   * `STEADY_MARGINAL` il termine prezzerebbe due volte la stessa cosa, perche' il surplus contiene
   * gia' una parte della costanza. Un peso e' una dichiarazione, un tetto e' un conto.
   */
  it('e la taglia dei modificatori della sua lega, e sta sotto il marginale aritmetico', () => {
    expect(STEADY_SHARE).toBeCloseTo(2 / 11, 12);
    expect(STEADY_SHARE).toBeLessThan(STEADY_MARGINAL);
  });

  /** «Vuoto = ignoto, mai zero»: chi non ha una costanza misurata prende la mediana del suo ruolo. */
  it('chi non ha una costanza misurata prende la mediana del suo ruolo, non uno zero', () => {
    const noto = swingOf({ role: 'C', surplus: 40, pv: 30, steady: ROLE_STEADY.C })!;
    const ignoto = swingOf({ role: 'C', surplus: 40, pv: 30, steady: null })!;
    expect(ignoto).toBeCloseTo(noto, 9);
    // ...e un vero zero e' un'altra cosa, che vale MENO della mediana: le due non si confondono.
    expect(swingOf({ role: 'C', surplus: 40, pv: 30, steady: 0 })!).toBeLessThan(noto);
  });

  /** I portieri sono il ruolo piu' costante e gli attaccanti il meno: e' la misura, non una scelta. */
  it('le mediane di ruolo sono ordinate come il calcio dice', () => {
    expect(ROLE_STEADY.P).toBeGreaterThan(ROLE_STEADY.D);
    expect(ROLE_STEADY.D).toBeGreaterThan(ROLE_STEADY.C);
    expect(ROLE_STEADY.C).toBeGreaterThan(ROLE_STEADY.A);
  });
});

describe('swingOf', () => {
  it('non prezza chi il foglio non prezza: vuoto e non zero', () => {
    expect(swingOf({ role: 'A', surplus: null, pv: 30, steady: 0.8 })).toBeNull();
  });

  /**
   * SENZA LE PRESENZE il termine di costanza non si puo' formare - «quante giornate chiude bene» ha
   * bisogno di quante ne gioca - e allora resta il surplus convertito, che e' l'informazione che c'e'.
   */
  it('senza le presenze resta il solo surplus, invece di inventare una costanza', () => {
    expect(swingOf({ role: 'A', surplus: 50, pv: null, steady: 0.9 })!)
      .toBeCloseTo(50 * GOALS_PER_POINT, 9);
  });

  /**
   * L'ESEMPIO DELL'OPERATORE, che e' la ragione per cui il termine esiste: due uomini con la STESSA
   * fantamedia (6 · 6,5+1 · 6,5+1 contro 5,5+0 · 5,5+0 · 7+3 fanno 21 tutt'e due) e quindi lo stesso
   * surplus, ma uno chiude in sufficienza tre volte su tre e l'altro una su tre.
   */
  it('a parita di surplus preferisce il costante, che e la ragione per cui esiste', () => {
    const costante = swingOf({ role: 'C', surplus: 40, pv: 30, steady: 1.0 })!;
    const discontinuo = swingOf({ role: 'C', surplus: 40, pv: 30, steady: 1 / 3 })!;
    expect(costante).toBeGreaterThan(discontinuo);
    // ...e di quanto: due terzi di costanza su 30 presenze, cioe' 1,8 fantapunti convertiti in gol.
    expect(costante - discontinuo).toBeCloseTo((2 / 3) * 30 * STEADY_SHARE * GOALS_PER_POINT, 9);
  });

  /**
   * ...E IL SURPLUS RESTA IL TERMINE GROSSO. Il test fissa l'ordine di grandezza perche' e' quello che
   * impedisce di raccontare SWING come «la colonna della costanza»: fra due uomini dello stesso slot
   * la costanza sposta pochi decimi, il surplus decine di fantapunti.
   */
  it('la costanza non puo scavalcare un surplus piu grande di qualche fantapunto', () => {
    const bravo = swingOf({ role: 'C', surplus: 50, pv: 30, steady: 0.5 })!;
    const costante = swingOf({ role: 'C', surplus: 44, pv: 30, steady: 1.0 })!;
    expect(bravo).toBeGreaterThan(costante);
  });

  it('e uno zero di surplus con nessuna presenza e zero gol, che qui e una misura', () => {
    expect(swingOf({ role: 'D', surplus: 0, pv: null, steady: null })).toBe(0);
    // Un surplus NEGATIVO fa segnare meno del suo rimpiazzo, e il segno va conservato.
    expect(swingOf({ role: 'D', surplus: -20, pv: null, steady: null })!).toBeLessThan(0);
  });
});

describe('la fantamedia gia tenuta in questa stagione (R25)', () => {
  const base = { role: 'A' as const, surplus: 40, pv: 30, steady: 0.65, fm: 7.0, confidence: 1 };

  /**
   * A STAGIONE NON COMINCIATA IL TERMINE NON ESISTE, e non e' una comodita': senza partite giocate non
   * c'e' una fantamedia da miscelare. E' la stessa proprieta' che rende R25 inerte su ogni finestra
   * pre-stagione del gate, cioe' su tutti i numeri gia' pubblicati.
   */
  it('e inerte a stagione non cominciata, e chi non ha ancora giocato non ne e toccato', () => {
    const senza = swingOf({ ...base, seasonFm: null, seasonPlayed: null })!;
    const zero = swingOf({ ...base, seasonFm: 8.5, seasonPlayed: 0 })!;
    const solo = swingOf(base)!;
    expect(senza).toBeCloseTo(solo, 9);
    expect(zero).toBeCloseTo(solo, 9);
  });

  /**
   * IL PESO CRESCE COL CAMPIONE, che e' tutto il senso di una miscela: a due partite quasi niente, a
   * quindici un terzo. I due numeri sono quelli che l'esperimento ha misurato - a settembre il termine
   * e' quasi inerte, a febbraio decide.
   */
  it('pesa col numero di partite giocate: quasi niente a settembre, un terzo a febbraio', () => {
    const set = swingOf({ ...base, seasonFm: 8.0, seasonPlayed: 2 })!;
    const feb = swingOf({ ...base, seasonFm: 8.0, seasonPlayed: 15 })!;
    const solo = swingOf(base)!;
    expect((set - solo) / (feb - solo)).toBeLessThan(0.2);
    // ...e il peso e' esattamente n/(n+K), che e' la forma dichiarata e non una curva scelta
    expect(feb - solo).toBeCloseTo((15 / (15 + SEEN_MATCHES)) * (8.0 - 7.0) * 30 * GOALS_PER_POINT, 9);
  });

  /** Chi sta rendendo MENO di quanto il foglio dica scende: una miscela tira in tutt'e due i versi. */
  it('scende per chi sta rendendo meno del previsto, o sarebbe un premio e non una misura', () => {
    expect(swingOf({ ...base, seasonFm: 5.5, seasonPlayed: 15 })!)
      .toBeLessThan(swingOf(base)!);
  });

  /**
   * SI SOMMA AL SURPLUS INVECE DI RICALCOLARLO, e il test lo fissa: il surplus e' lineare nella
   * fantamedia, quindi la correzione e' `Δfm × presenze × confidenza` ESATTAMENTE. Ricostruire il
   * surplus da capo sarebbe una seconda lettura di una colonna che il gate possiede.
   */
  it('la correzione e lineare, e una stima la sconta come sconta tutto il resto', () => {
    const pieno = swingOf({ ...base, seasonFm: 8.0, seasonPlayed: 15, confidence: 1 })!;
    const meta = swingOf({ ...base, seasonFm: 8.0, seasonPlayed: 15, confidence: 0.5 })!;
    const solo = swingOf(base)!;
    expect(meta - solo).toBeCloseTo((pieno - solo) / 2, 9);
  });

  /** Senza la fantamedia del FOGLIO non c'e' un prior contro cui miscelare: si tace invece di inventare. */
  it('senza il prior del foglio non miscela niente', () => {
    expect(swingOf({ ...base, fm: null, seasonFm: 8.0, seasonPlayed: 15 })!)
      .toBeCloseTo(swingOf({ ...base, fm: null })!, 9);
  });
});
