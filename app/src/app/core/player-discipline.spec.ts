import { describe, expect, it } from 'vitest';

import { CARDS_MIN_APPEARANCES, CareerEvents, habitMarks } from './player-discipline';

/**
 * Le sei abitudini misurate. Ogni prova qui è uno dei modi in cui una lista di «lo fa spesso» diventa
 * una lista di gente sfortunata: un episodio solo, un campione corto, una quota su due tentativi.
 */
const career = (over: Partial<CareerEvents> = {}): CareerEvents => ({
  appearances: 100, yellows: 0, reds: 0, ownGoals: 0, penScored: 0, penMissed: 0, penSaved: 0,
  ...over,
});
const flags = (one: CareerEvents) => habitMarks(one).map((mark) => mark.flag);

describe('habitMarks', () => {
  it('non dice niente del giocatore normale', () => {
    // Mediane del listone: 0,129 gialli a presenza. I rigori restano fuori perché due non fanno un
    // rigorista - ed è la prova che ha corretto la prima stesura di questo test, dove il «giocatore
    // normale» ne aveva cinque, cioè uno ogni venti partite: quello è il rigorista della squadra.
    expect(flags(career({ yellows: 13, penScored: 2 }))).toEqual([]);
  });

  it('segna chi prende un giallo ogni tre partite e mezzo, non chi ne prende uno ogni cinque', () => {
    expect(flags(career({ yellows: 28 }))).toEqual(['yellows']);
    expect(flags(career({ yellows: 20 }))).toEqual([]);
  });

  it('chiede DUE espulsioni prima di parlare di abitudine', () => {
    // Con una sola non si distingue il falloso dallo sfortunato: 138 quotati su 324 ne hanno una.
    expect(flags(career({ appearances: 40, reds: 1 }))).toEqual([]);
    expect(flags(career({ appearances: 40, reds: 2 }))).toEqual(['reds']);
  });

  it('idem per gli autogol, che sono ancora più rari', () => {
    expect(flags(career({ ownGoals: 1 }))).toEqual([]);
    expect(flags(career({ appearances: 60, ownGoals: 2 }))).toEqual(['own_goals']);
  });

  it('tace su tutto quando le presenze sono poche: un campione corto non è un\'abitudine', () => {
    const corto = career({ appearances: CARDS_MIN_APPEARANCES - 1, yellows: 20, reds: 3, ownGoals: 3 });
    expect(flags(corto)).toEqual([]);
  });

  it('segna il rigorista, e a parte chi ne sbaglia due su cinque', () => {
    // La soglia dell'operatore: due su cinque. Sotto, resta solo «batte i rigori».
    expect(flags(career({ penScored: 8, penMissed: 2 }))).toEqual(['set_pieces']);
    expect(flags(career({ penScored: 3, penMissed: 2 }))).toEqual(['set_pieces', 'penalty_risk']);
  });

  it('non chiama rigorista chi ne ha battuti due perché mancava il titolare', () => {
    expect(flags(career({ penScored: 1, penMissed: 1 }))).toEqual([]);
  });

  it('segna il portiere che para i rigori, che è l\'unica buona notizia del gruppo', () => {
    expect(flags(career({ appearances: 90, penSaved: 3 }))).toEqual(['penalty_saved']);
    // Uno solo è fortuna, non un'abitudine.
    expect(flags(career({ appearances: 90, penSaved: 1 }))).toEqual([]);
  });

  it('mette tutti i marchi che uno merita, senza sceglierne uno solo', () => {
    const cattivo = career({ appearances: 100, yellows: 30, reds: 3, ownGoals: 2 });
    expect(flags(cattivo)).toEqual(['yellows', 'reds', 'own_goals']);
  });
});
