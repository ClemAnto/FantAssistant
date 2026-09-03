import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLAG_GROUPS, FlagPrefs } from './flag-prefs';
import { FLAG_LABEL, PlayerFlag } from './player-status';

/** Una SESSIONE nuova: il servizio si ricrea e rilegge il disco, che è il punto di una preferenza. */
function session(): FlagPrefs {
  TestBed.resetTestingModule();
  return TestBed.configureTestingModule({}).inject(FlagPrefs);
}

/**
 * Il salvataggio passa da un `effect`, quindi non è avvenuto finché non si fa girare il giro: senza
 * questo il test misurerebbe la memoria del processo e non il disco, cioè proprio la cosa da provare.
 */
function settle(): void {
  TestBed.tick();
}

function prefs(): FlagPrefs {
  localStorage.clear();
  return session();
}

describe('il menù delle iconcine', () => {
  beforeEach(() => localStorage.clear());

  it('offre OGNI marchio del vocabolario, o un segnale nuovo sarebbe irraggiungibile', () => {
    const offered = FLAG_GROUPS.flatMap((group) => group.flags);
    // Il vocabolario è `FLAG_LABEL`, che è anche quello che il menù mostra: se qualcuno aggiunge un
    // marchio e non lo mette in un gruppo, l'icona compare sulle righe e non si può spegnere.
    expect([...offered].sort()).toEqual(Object.keys(FLAG_LABEL).sort());
    // ...e nessuno due volte, che sarebbe due interruttori per un fatto.
    expect(new Set(offered).size).toBe(offered.length);
  });

  it('parte con tutte accese: si tiene la lista degli SPENTI', () => {
    const it_ = prefs();
    for (const flag of Object.keys(FLAG_LABEL) as PlayerFlag[]) expect(it_.shows(flag)).toBe(true);
    expect(it_.hiddenCount()).toBe(0);
  });

  it('spegne, riaccende, e ricorda fra due sessioni', () => {
    const first = prefs();
    first.toggle('fragile');
    expect(first.shows('fragile')).toBe(false);
    expect(first.shows('long_injury')).toBe(true); // un interruttore ne muove uno solo
    expect(first.hiddenCount()).toBe(1);

    // Una seconda istanza legge il DISCO: è la preferenza che segue l'operatore, non la pagina.
    settle();
    const later = session();
    expect(later.shows('fragile')).toBe(false);

    first.toggle('fragile');
    expect(first.shows('fragile')).toBe(true);
  });

  it('tutte / nessuna, in un click per parte', () => {
    const it_ = prefs();
    it_.hideAll();
    expect(it_.hiddenCount()).toBe(Object.keys(FLAG_LABEL).length);
    expect(it_.shows('reds')).toBe(false);
    it_.showAll();
    expect(it_.hiddenCount()).toBe(0);
    expect(it_.shows('reds')).toBe(true);
  });

  it('un marchio salvato che il vocabolario non conosce più viene scartato, non creduto', () => {
    // Scritto come lo scriverebbe una versione precedente: passando dal servizio, così il test non
    // duplica il prefisso della chiave - una seconda definizione di DOVE vive una preferenza è come si
    // finisce a provare una chiave che nessuno legge.
    const before = prefs();
    before.toggle('fragile');
    settle();
    const key = Object.keys(localStorage).find((one) => one.endsWith('flags:hidden'))!;
    localStorage.setItem(key, JSON.stringify(['fragile', 'un_marchio_di_ieri']));

    const it_ = session();
    expect(it_.shows('fragile')).toBe(false);
    expect(it_.hiddenCount()).toBe(1);
  });
});
