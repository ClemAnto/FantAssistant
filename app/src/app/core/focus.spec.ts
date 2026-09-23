import { needOf, nextGoal, serves, topsOwned, COVER_TARGET, GOALS, TOP_TARGET, FocusRules, Owned } from './focus';

/**
 * IL FOCUS: quello che asserisce non e' la formula, sono i BERSAGLI MISURATI che la decidono.
 *
 * Un test che ricalcolasse la convoluzione dei buchi verificherebbe se stesso; questi verificano che
 * l'ordine dei bisogni sia quello che le misure mettono - prima il buco (4,73 fantapunti a giornata),
 * poi la parola alta dove paga, il posto per ultimo - e che il bersaglio delle parole alte sia il sette
 * distribuito su difesa e attacco, che e' la correzione che la misura ha fatto alla sua lista.
 */
const RULES: FocusRules = { matchdays: 38, coverShare: 25 / 38 };

const man = (role: Owned['role'], expected: number | null, category: string | null = null,
             club = 'C'): Owned => ({ role, expected, club, category });

describe('il FOCUS della plancia', () => {
  it('somma a SETTE parole alte, e il centrocampo ne prende una sola', () => {
    // Il bersaglio non e' l undici che aveva chiesto (le tre parole alte sono 51 in tutto sul listone,
    // 5,1 per rosa): e' il sette che il banco misura su chi vince, e sta quasi tutto dove paga.
    expect(TOP_TARGET.D + TOP_TARGET.A).toBe(6);
    expect(TOP_TARGET.C).toBe(1);
    expect(TOP_TARGET.P).toBe(0);
    const total = TOP_TARGET.P + TOP_TARGET.D + TOP_TARGET.C + TOP_TARGET.A;
    expect(total).toBe(7);
  });

  it('UN BUCO E URGENTE SOLO CONTRO I POSTI CHE RESTANO, che e la dinamica di un asta random', () => {
    // La misura che ha scritto questa regola: a estrazione libera i top escono UNIFORMEMENTE lungo
    // tutta l asta (mediana 0,46) e il riempimento si trova tardi (0,57-0,69). Quindi un buco con
    // tanti posti ancora da comprare non e un emergenza - lo diventa quando i posti non bastano piu.
    // Tre uomini che giocano mezza stagione e NESSUNA parola alta: il reparto ha 2,5 buchi su quattro
    // posti. Con cinque posti ancora liberi c e tempo per coprirli, quindi l obiettivo e la parola
    // alta - il momento in cui i top escono e il budget c e.
    const scoperta = [man('D', 19), man('D', 19), man('D', 19)];
    expect(needOf(scoperta, 'D', 4, 5, RULES)).toBe('top');
    // ...e con UN posto solo per chiudere due buchi e mezzo diventa un emergenza.
    expect(needOf(scoperta, 'D', 4, 1, RULES)).toBe('cover');
    // Il difetto che questa regola cura: a rosa VUOTA guardava solo «c e un buco» e metteva tutti e
    // quattro i reparti su «titolare», cioe faceva guardare altrove proprio mentre i top uscivano.
    expect(needOf([], 'D', 4, 8, RULES)).toBe('top');
  });

  it('col bersaglio pieno un buco vale ancora piu del riempimento', () => {
    // Bersaglio pieno (D 3) e un quarto uomo che non gioca: resta un posto intero scoperto, e quello
    // vale ancora piu' del riempimento - un buco costa 4,73 fantapunti a giornata.
    const tre = [man('D', 36, 'top'), man('D', 36, 'top'), man('D', 36, 'super'), man('D', 0)];
    expect(topsOwned(tre, 'D')).toBe(3);
    expect(needOf(tre, 'D', 4, 4, RULES)).toBe('cover');
    // ...e con lo stesso bersaglio pieno ma il reparto COPERTO, resta la copertura dei posti liberi.
    const coperta = [man('D', 36, 'top'), man('D', 36, 'top'), man('D', 36, 'super'), man('D', 36)];
    expect(needOf(coperta, 'D', 4, 4, RULES)).toBe('rest');
  });

  it('un reparto pieno non ha obiettivi, e uno a bersaglio chiede solo la copertura', () => {
    const piena = [man('D', 36, 'top'), man('D', 36, 'top'), man('D', 36, 'super'), man('D', 36)];
    // `left` a zero: non c e piu niente da comprare, quindi non c e piu niente da mostrare.
    expect(needOf(piena, 'D', 4, 0, RULES)).toBeNull();
    // ...e col bersaglio raggiunto e nessun buco resta la copertura, la soglia piu bassa delle due.
    expect(needOf(piena, 'D', 4, 2, RULES)).toBe('rest');
  });

  it('le QUATTRO parole girano, e ognuna chiede una cosa DIVERSA', () => {
    // Sue parole e suo ordine (23/09/2026). Quello che NON sono e quattro altezze di una quantita
    // sola: COPERTURA e una quantita («Pa >= 25»), TITOLARE un confronto con la mia rosa («completa
    // il nostro 11»), RESTO una relazione con quelli che ho.
    expect([...GOALS]).toEqual(['top', 'starter', 'cover', 'rest']);
    expect(nextGoal('top')).toBe('starter');
    expect(nextGoal('rest')).toBe('top');

    // COPERTURA: la sua cifra, e basta quella.
    const sempre = { role: 'D' as const, expected: 30, category: null, club: 'X' };
    const ogniTanto = { role: 'D' as const, expected: 15, category: null, club: 'X' };
    expect(serves('cover', sempre, 'D', RULES)).toBe(true);
    expect(serves('cover', ogniTanto, 'D', RULES)).toBe(false);

    // TITOLARE: lo stesso uomo entra o no a seconda di CHI HO GIA. Nessuna soglia puo dire questo.
    const tre = [man('D', 34), man('D', 33), man('D', 32), man('D', 31)];
    expect(serves('starter', sempre, 'D', RULES, tre, 4)).toBe(false);   // 30 < il peggiore dei miei
    const scarsi = [man('D', 20), man('D', 19), man('D', 18), man('D', 17)];
    expect(serves('starter', sempre, 'D', RULES, scarsi, 4)).toBe(true); // 30 batte il peggiore
    // ...e un posto vuoto lo completa chiunque, perche un posto vuoto lo migliora qualunque uomo.
    expect(serves('starter', ogniTanto, 'D', RULES, [man('D', 30)], 4)).toBe(true);

    // RESTO: complementa chi NON condivide il calendario con i miei di quel ruolo.
    const miei = [man('D', 30, null, 'Inter')];
    expect(serves('rest', { ...sempre, club: 'Inter' }, 'D', RULES, miei, 4)).toBe(false);
    expect(serves('rest', { ...sempre, club: 'Roma' }, 'D', RULES, miei, 4)).toBe(true);
  });

  it('CHI CHIUDE UN BUCO E CHI GIOCA, non chi rende', () => {
    // «Il lavoro di un riserva e coprire»: uno comprato per il voto non lo fa, e la misura dice che
    // senza ricambio servirebbe una fantamedia di 14,32 per pareggiare chi gioca tutte le giornate.
    const gioca = { role: 'D' as const, expected: 30, category: 'operaio', club: 'X' };
    const rende = { role: 'D' as const, expected: 8, category: 'super', club: 'Y' };
    expect(serves('cover', gioca, 'D', RULES)).toBe(true);
    expect(serves('cover', rende, 'D', RULES)).toBe(false);
    // ...e il bersaglio delle parole alte lo chiude solo una parola alta, per quante ne giochi.
    expect(serves('top', gioca, 'D', RULES)).toBe(false);
    expect(serves('top', rende, 'D', RULES)).toBe(true);
  });

  it('non serve mai un uomo di un altro ruolo, e senza bisogno non serve nessuno', () => {
    const uno = { role: 'A' as const, expected: 30, category: 'top', club: 'X' };
    expect(serves('top', uno, 'D', RULES)).toBe(false);
    expect(serves(null, uno, 'A', RULES)).toBe(false);
  });

  it('il pavimento della copertura e UN POSTO, dichiarato e non misurato', () => {
    // Quanto COSTA un buco e una misura (4,73 a giornata); quando vale la pena spendere un credito per
    // chiuderlo e una preferenza, ed e la stessa soglia della pagina delle buste.
    expect(COVER_TARGET).toBe(1);
  });
});
