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
   * questo test cade - che e' il suo mestiere. Dal 07/09/2026 la COLONNA non moltiplica piu' per questo
   * numero (l'unita' e' dichiarata in punti sopra il 6 a giornata), ma il tasso resta il fatto misurato
   * che collega le due scale.
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

/** Il calendario e lo zero usati nei test: rimpiazzo AL SEI, cosi' la ribasatura e' zero e ogni
 *  aritmetica relativa si legge in chiaro. La ribasatura ha i suoi test dedicati piu' sotto. */
const M = 30;
const AT_SIX = { replacement: 6, matchdays: M };

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
    const noto = swingOf({ role: 'C', surplus: 40, pv: 30, steady: ROLE_STEADY.C, ...AT_SIX })!;
    const ignoto = swingOf({ role: 'C', surplus: 40, pv: 30, steady: null, ...AT_SIX })!;
    expect(ignoto).toBeCloseTo(noto, 9);
    // ...e un vero zero e' un'altra cosa, che vale MENO della mediana: le due non si confondono.
    expect(swingOf({ role: 'C', surplus: 40, pv: 30, steady: 0, ...AT_SIX })!).toBeLessThan(noto);
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
    expect(swingOf({ role: 'A', surplus: null, pv: 30, steady: 0.8, ...AT_SIX })).toBeNull();
  });

  /**
   * L'UNITA' E' PUNTI SOPRA IL 6 A GIORNATA (operatore, 07/09/2026: «se un calciatore ha una
   * fantamedia di 10 allora il suo swing dovrebbe essere 4»), e questo test E' il suo esempio: un
   * attaccante da 10 di fantamedia che gioca tutte le giornate. Il surplus del foglio conta dal
   * rimpiazzo (5,61 per gli attaccanti), la ribasatura lo sposta sul 6, e resta ~4 piu' il termine
   * di costanza, che e' piccolo per costruzione.
   */
  it("l'esempio dell'operatore: fantamedia 10, sempre in campo, legge ~4", () => {
    const swing = swingOf({
      role: 'A', surplus: (10 - 5.61) * 38, pv: 38, replacement: 5.61, matchdays: 38, steady: 0.65,
    })!;
    expect(swing).toBeGreaterThan(3.9);
    expect(swing).toBeLessThan(4.3);
    expect(swing).toBeCloseTo(10 - 6 + 0.65 * STEADY_SHARE, 9);
  });

  /**
   * LA RIBASATURA E' `(rimpiazzo − base) × presenze`, aritmetica esatta su colonne dello stesso foglio:
   * spostare lo zero dal rimpiazzo alla base dichiarata e' una DICHIARAZIONE di scala dell'operatore,
   * e il suo prezzo dichiarato e' che un rimpiazzo basso abbassa lo SWING rispetto al surplus.
   */
  it('la ribasatura sposta lo zero sulla base dichiarata, e un rimpiazzo basso abbassa lo SWING', () => {
    const low = swingOf({ role: 'C', surplus: 60, pv: 30, steady: 0.9, replacement: 5.2, matchdays: M })!;
    const same = swingOf({ role: 'C', surplus: 60, pv: 30, steady: 0.9, replacement: 6, matchdays: M })!;
    expect(same - low).toBeCloseTo(((6 - 5.2) * 30) / M, 9);
  });

  /**
   * IL «6» DEL PORTIERE E' UN 5 (operatore, 07/09/2026: «nei primi posti ci sono tutti portieri che
   * non giocano»). Il fantavoto di un portiere porta il malus dei gol subiti — un titolare vero sta a
   * 4,91-5,24 di FMa — quindi con lo zero al 6 giocare moltiplicava un numero negativo e il terzo
   * portiere scavalcava il titolare. Con la base del mestiere (il 5, lo zero fielded misurato
   * 5,01/5,03) l'ordine torna quello del calcio.
   */
  it('un portiere che gioca sta sopra uno che non gioca, che era il difetto trovato', () => {
    // il titolare: fantamedia 5,2 su tutte le giornate (surplus dal rimpiazzo 4,13 del foglio)
    const starter = swingOf({
      role: 'P', surplus: (5.2 - 4.13) * 36, pv: 36, steady: 0.9, replacement: 4.13, matchdays: 38,
    })!;
    // il terzo: stima appena migliore a voto (5,4) e due presenze attese
    const third = swingOf({
      role: 'P', surplus: (5.4 - 4.13) * 2, pv: 2, steady: 0.9, replacement: 4.13, matchdays: 38,
    })!;
    expect(starter).toBeGreaterThan(third);
    expect(starter).toBeGreaterThan(0);
    // ...e la controprova del difetto: con la base al 6 lo stesso titolare leggeva NEGATIVO e sotto
    // il terzo, che e' esattamente la frase dell'operatore.
    const wrong = ((5.2 - 4.13) * 36 + (4.13 - 6) * 36 + 0.9 * 36 * STEADY_SHARE) / 38;
    const wrongThird = ((5.4 - 4.13) * 2 + (4.13 - 6) * 2 + 0.9 * 2 * STEADY_SHARE) / 38;
    expect(wrong).toBeLessThan(0);
    expect(wrong).toBeLessThan(wrongThird);
  });

  /**
   * SENZA LE PRESENZE, IL RIMPIAZZO O IL CALENDARIO la scala non si puo' formare: un numero rimasto
   * su un altro zero dentro la stessa colonna sarebbe un errore di unita', quindi si tace. (Prima
   * della scala nuova il ramo senza presenze restituiva il solo surplus convertito in gol.)
   */
  it('senza presenze, rimpiazzo o calendario tace, invece di mescolare due zeri', () => {
    expect(swingOf({ role: 'A', surplus: 50, pv: null, steady: 0.9, ...AT_SIX })).toBeNull();
    expect(swingOf({ role: 'A', surplus: 50, pv: 30, steady: 0.9, replacement: null, matchdays: M })).toBeNull();
    expect(swingOf({ role: 'A', surplus: 50, pv: 30, steady: 0.9, replacement: 6, matchdays: null })).toBeNull();
  });

  /**
   * L'ESEMPIO DELL'OPERATORE SULLA COSTANZA, che e' la ragione per cui il termine esiste: due uomini
   * con la STESSA fantamedia (6 · 6,5+1 · 6,5+1 contro 5,5+0 · 5,5+0 · 7+3 fanno 21 tutt'e due) e
   * quindi lo stesso surplus, ma uno chiude in sufficienza tre volte su tre e l'altro una su tre.
   */
  it('a parita di surplus preferisce il costante, che e la ragione per cui esiste', () => {
    const costante = swingOf({ role: 'C', surplus: 40, pv: 30, steady: 1.0, ...AT_SIX })!;
    const discontinuo = swingOf({ role: 'C', surplus: 40, pv: 30, steady: 1 / 3, ...AT_SIX })!;
    expect(costante).toBeGreaterThan(discontinuo);
    // ...e di quanto: due terzi di costanza su 30 presenze, spalmati sulle giornate del calendario.
    expect(costante - discontinuo).toBeCloseTo(((2 / 3) * 30 * STEADY_SHARE) / M, 9);
  });

  /**
   * IL TERMINE ESISTE SOLO DOVE LA LEGA PAGA L'R-FACTOR (operatore, 07/09/2026): il k e' indicizzato
   * sulla SUA scala, quindi in una lega senza quel modificatore la costanza non compra niente e i due
   * uomini dell'esempio tornano uguali. `false` spegne, assente vale attivo (il regolamento di partenza).
   */
  it('senza R-Factor nella lega la costanza non conta, e il surplus resta tutto', () => {
    const costante = swingOf({ role: 'C', surplus: 40, pv: 30, steady: 1.0, rFactor: false, ...AT_SIX })!;
    const discontinuo = swingOf({ role: 'C', surplus: 40, pv: 30, steady: 1 / 3, rFactor: false, ...AT_SIX })!;
    expect(costante).toBeCloseTo(discontinuo, 9);
    expect(costante).toBeCloseTo(40 / M, 9);
    // ...e l'interruttore non tocca la miscela in-season, che e' un altro canale (R25).
    const conR25 = swingOf({
      role: 'C', surplus: 40, pv: 30, steady: 1.0, rFactor: false,
      fm: 7.0, seasonFm: 8.0, seasonPlayed: 15, confidence: 1, ...AT_SIX,
    })!;
    expect(conR25).toBeGreaterThan(costante);
  });

  /**
   * ...E IL SURPLUS RESTA IL TERMINE GROSSO. Il test fissa l'ordine di grandezza perche' e' quello che
   * impedisce di raccontare SWING come «la colonna della costanza»: fra due uomini dello stesso slot
   * la costanza sposta pochi decimi, il surplus decine di fantapunti.
   */
  it('la costanza non puo scavalcare un surplus piu grande di qualche fantapunto', () => {
    const bravo = swingOf({ role: 'C', surplus: 50, pv: 30, steady: 0.5, ...AT_SIX })!;
    const costante = swingOf({ role: 'C', surplus: 44, pv: 30, steady: 1.0, ...AT_SIX })!;
    expect(bravo).toBeGreaterThan(costante);
  });

  it('uno zero di surplus con zero costanza e uno zero misurato, e un surplus negativo resta negativo', () => {
    expect(swingOf({ role: 'D', surplus: 0, pv: 30, steady: 0, ...AT_SIX })).toBe(0);
    // Un surplus NEGATIVO fa segnare meno del suo rimpiazzo, e il segno va conservato.
    expect(swingOf({ role: 'D', surplus: -20, pv: 30, steady: 0, ...AT_SIX })!).toBeLessThan(0);
  });
});

describe('il +1 a porta inviolata (opzione di lega, 07/09/2026)', () => {
  const P = { role: 'P' as const, surplus: 30, pv: 36, steady: 0.9, replacement: 4.13, matchdays: 38 };

  /**
   * IL BONUS NON E' NEL FANTAVOTO PUBBLICATO (misurato: 1.218 portieri su 1.222 a porta inviolata
   * leggono `voto + bonus` senza premio), quindi va aggiunto qui — e AL DIFFERENZIALE, mai al totale:
   * anche il sostituto incassa porte inviolate quando gioca lui, e il metro e' la media del campionato.
   */
  it('paga il differenziale sul calendario, e un calendario medio non compra niente', () => {
    const easy = swingOf({ ...P, cleanSheetShare: 0.4, cleanSheetMean: 0.28 })!;
    const level = swingOf({ ...P, cleanSheetShare: 0.28, cleanSheetMean: 0.28 })!;
    const hard = swingOf({ ...P, cleanSheetShare: 0.2, cleanSheetMean: 0.28 })!;
    expect(easy - level).toBeCloseTo((0.12 * 36) / 38, 9);
    expect(level).toBeCloseTo(swingOf(P)!, 9);
    expect(hard).toBeLessThan(level);
  });

  it('esiste solo per il portiere, e solo dove la lega lo paga', () => {
    const D = { ...P, role: 'D' as const, replacement: 6, steady: 0.7 };
    expect(swingOf({ ...D, cleanSheetShare: 0.4, cleanSheetMean: 0.28 })!)
      .toBeCloseTo(swingOf(D)!, 9);
    expect(swingOf({ ...P, cleanSheetShare: 0.4, cleanSheetMean: 0.28, cleanSheetBonus: false })!)
      .toBeCloseTo(swingOf(P)!, 9);
  });

  /** Senza calendario (o senza il metro) il termine non esiste: vuoto = ignoto, non un premio. */
  it('senza calendario tace', () => {
    expect(swingOf({ ...P, cleanSheetShare: 0.4 })!).toBeCloseTo(swingOf(P)!, 9);
    expect(swingOf({ ...P, cleanSheetMean: 0.28 })!).toBeCloseTo(swingOf(P)!, 9);
  });
});

describe('la fantamedia gia tenuta in questa stagione (R25)', () => {
  const base = {
    role: 'A' as const, surplus: 40, pv: 30, steady: 0.65, fm: 7.0, confidence: 1, ...AT_SIX,
  };

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
    expect(feb - solo).toBeCloseTo(((15 / (15 + SEEN_MATCHES)) * (8.0 - 7.0) * 30) / M, 9);
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

  /**
   * DOVE IL FOGLIO PORTA GIA' LA MISCELA LA CORREZIONE NON SI RIFA' (R25K40 adottata su `default`,
   * 07/09/2026): una riga che il motore prezza ha le partite viste DENTRO `engine_fm_pred`, e
   * riapplicarle qui sarebbe pesarle due volte. Il termine di costanza invece resta: e' un altro canale.
   */
  it('non riapplica la miscela a una riga il cui foglio la porta gia', () => {
    const doppio = swingOf({ ...base, seasonFm: 8.0, seasonPlayed: 15 })!;
    const gated = swingOf({ ...base, seasonFm: 8.0, seasonPlayed: 15, fmBlendsSeen: true })!;
    const solo = swingOf(base)!;
    expect(gated).toBeCloseTo(solo, 9);
    expect(doppio).toBeGreaterThan(gated);
  });
});
