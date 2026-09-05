import { describe, expect, it } from 'vitest';

import {
  PlaceChange, placeMark, rotationMark, starterSignsFromSheet, starterSignsMark,
} from './player-place';

const base: PlaceChange = {
  change: 'gained',
  on: '2025-10-05',
  matchday: 6,
  minutes: '6 -> 73',
  cause: 'won_then_injury',
  who: 'Estupinan (ankle, 2025-10-12 -> 2025-10-31)',
};

describe('starterSignsMark, finestra corta', () => {
  it('parla dopo due giornate e dice MENO, coi numeri di quella finestra', () => {
    // Il marchio taceva del tutto sulle prime tre giornate - la finestra in cui si compra - e la cura
    // e' il regime che la famiglia rotazione ha gia'. Quello che si asserisce e' la FRASE: una lettura
    // da 1,49x che cita il 76,8% della finestra piena prometterebbe una precisione che non ha.
    const early = starterSignsMark({ minutes: 78, starts: 2, window: 2, keeper: false, early: true, rising: false, preseason: false })!;
    expect(early.flag).toBe('starter_signs');
    expect(early.note).toContain('76,5%');
    expect(early.note).toContain('1,49x');
    expect(early.note).toContain('guardalo');
    expect(early.note).not.toContain('76,8%');

    // ...e la finestra piena non prende in prestito i numeri di quella corta.
    const full = starterSignsMark({ minutes: 78, starts: 4, window: 5, keeper: false, early: false, rising: false, preseason: false })!;
    expect(full.note).toContain('76,8%');
    expect(full.note).not.toContain('76,5%');
  });

  it('dice la TERZA lettura con i numeri della terza, e viene prima delle altre due', () => {
    // L'istruzione dell'operatore: i limiti si tarano perche' Palestra ci rientri. Quello che si
    // asserisce e' che la frase sia la SUA - l'ultima giornata, non la media della finestra, che e'
    // la statistica che lo nascondeva.
    const rising = starterSignsMark({
      minutes: 41.5, starts: 1, window: 2, keeper: false, early: true, rising: true, preseason: false,
    })!;
    expect(rising.note).toContain('1,78x');
    expect(rising.note).toContain("COMINCIATO l'ultima giornata");
    expect(rising.note).toContain('raddoppiato');
    expect(rising.note).not.toContain('76,5%');
  });

  it('parla PRIMA della prima giornata, e le amichevoli informano senza decidere', () => {
    // La richiesta dell'operatore: un marchio entro la 1a giornata, che poi si consolida o cade. Le
    // amichevoli entrano nella FRASE e non nel grilletto - sono in archivio solo da una stagione,
    // quindi nessuno screen che le legga e' verificabile all'indietro.
    const pre = starterSignsMark({
      minutes: 70, starts: 2, window: 3, keeper: false,
      early: false, rising: false, preseason: true, friendlyStarts: 3, friendlyMatches: 6,
    })!;
    expect(pre.note).toContain('1,64x');
    expect(pre.note).toContain('3 amichevoli su 6');
    expect(pre.note).toContain('non una prova');
    expect(pre.note).not.toContain('1,78x');

    // ...e senza amichevoli in archivio la frase non le nomina invece di scrivere «0 su 0».
    const bare = starterSignsMark({
      minutes: 70, starts: 2, window: 3, keeper: false,
      early: false, rising: false, preseason: true, friendlyStarts: null, friendlyMatches: null,
    })!;
    expect(bare.note).not.toContain('amichevoli');
  });

  it('legge le quattro parole del foglio, e un «yes» nudo resta la lettura PIENA', () => {
    const fields = { minutes: 78, starts: 4, window: 5, keeper: false };
    // Un bundle precedente alla revisione 43 non conosce `early`: leggerlo come tale degraderebbe in
    // silenzio una frase forte, che e' l'errore opposto a quello che il regime nuovo cura.
    expect(starterSignsFromSheet('yes', fields)?.early).toBe(false);
    expect(starterSignsFromSheet('yes', fields)?.rising).toBe(false);
    expect(starterSignsFromSheet('early', fields)?.early).toBe(true);
    expect(starterSignsFromSheet('rising', fields)?.rising).toBe(true);
    expect(starterSignsFromSheet('preseason', fields)?.preseason).toBe(true);
    expect(starterSignsFromSheet('yes', fields)?.preseason).toBe(false);
    // E una colonna vuota non e' un uomo senza segnali: e' un foglio che non la porta.
    expect(starterSignsFromSheet(null, fields)).toBeNull();
  });
});

describe('placeMark', () => {
  it('says WHEN, and keeps the two sentences about an injury apart', () => {
    // The operator's own case, and the order is the measurement: he took the place on 5 October and
    // the ankle is of the 12th. «Gioca perché manca X» would be the opposite claim about the same man.
    const won = placeMark(base)!;
    expect(won.flag).toBe('place_gained');
    expect(won.note).toContain('05/10/2025');
    expect(won.note).toContain('giornata 6');
    expect(won.note).toContain('consolidato');

    const standIn = placeMark({ ...base, cause: 'front_injured' })!;
    expect(standIn.note).toContain('era già fuori');
    expect(standIn.note).toContain('tornare indietro');
  });

  it('marks a lost place and names what it is, without inventing a suspension', () => {
    const lost = placeMark({ ...base, change: 'lost', cause: 'benched', who: '20 di 31 in panchina' })!;
    expect(lost.flag).toBe('place_lost');
    expect(lost.note).toContain('DISPONIBILE e non schierato');
    // Where a ban cannot be seen the note says it was not looked at - never «no suspension».
    expect(lost.note).toContain('non sono controllate');
  });

  it('adds the caveat only where it belongs', () => {
    // He was out himself: there is nothing a suspension could add, so the sentence does not carry it.
    const hurt = placeMark({ ...base, change: 'lost', cause: 'own_injury', who: 'fuori per 9 partite' })!;
    expect(hurt.note).not.toContain('non sono controllate');
  });

  it('is null when the sheet says nothing, and never a neutral sentence', () => {
    expect(placeMark(null)).toBeNull();
    expect(placeMark({ ...base, change: '' as never })).toBeNull();
    expect(placeMark({ ...base, on: '' })).toBeNull();
  });
});

describe('rotationMark', () => {
  it('says the two things the operator asked for, and carries its own measurement', () => {
    const mark = rotationMark({ minutes: 27.6, starts: 1, window: 5, strength: 'watch',
      from: '2025-08-16', to: '2025-09-21' })!;
    expect(mark.flag).toBe('rotation_risk');
    expect(mark.note).toContain('28 minuti');
    expect(mark.note).toContain('1 partita da titolare');
    expect(mark.note).toContain('non è il titolare e non ha minutaggio');
    // a screen is a reason to look and never a certainty: the note says how often it is right
    expect(mark.note).toContain('90,4%');
    expect(mark.note).toContain('Uno su dieci diventa titolare davvero');
  });

  it('is null on a sheet that has no season to read yet', () => {
    // Pre-season: the columns are empty by construction, and an empty column is not a clean bill.
    expect(rotationMark(null)).toBeNull();
    expect(rotationMark({ minutes: null, starts: null, window: null, strength: null,
      from: null, to: null })).toBeNull();
  });

  it('says LESS on a window too short to say it, and names its own counter-example', () => {
    // The operator asked for a mark before the fifth round. The fourth is worth as much as the fifth
    // (96.3% against 94.9%); two and three are worth 81% against a 58% base, which is «look at him»
    // and not «he is not the starter» - and the honest way to say that is a different sentence.
    const early = rotationMark({ minutes: 7, starts: 0, window: 2, strength: 'early',
      from: '2025-08-16', to: '2025-08-23' })!;
    expect(early.flag).toBe('rotation_early');
    expect(early.note).toContain('finestra CORTA');
    expect(early.note).toContain("81%");
    expect(early.note).toContain('Donnarumma');
    expect(early.note).not.toContain('non è il titolare e non ha minutaggio');
  });
});

describe('starterSignsMark', () => {
  it('says the mirror fact, and a keeper gets a different sentence', () => {
    const outfield = starterSignsMark({ minutes: 73, starts: 5, window: 5, keeper: false, early: false, rising: false, preseason: false })!;
    expect(outfield.flag).toBe('starter_signs');
    expect(outfield.note).toContain('Quotato da riserva');
    expect(outfield.note).toContain('76,8%');
    // the honest half: this claim is weaker than the rotation one
    expect(outfield.note).toContain('più debole');

    // For a keeper the same reading means «he is the number one» - and it is the strongest cell of
    // the screen (81.9% against a 22.3% base), because the reserve band of keepers is real reserves.
    const keeper = starterSignsMark({ minutes: 90, starts: 4, window: 4, keeper: true, early: false, rising: false, preseason: false })!;
    expect(keeper.note).toContain('81,9%');
    expect(keeper.note).toContain('è il numero uno');
    expect(keeper.note).not.toContain('più debole');
  });

  it('is null when the sheet says nothing', () => {
    expect(starterSignsMark(null)).toBeNull();
    expect(starterSignsMark({ minutes: null, starts: null, window: null, keeper: false, early: false, rising: false, preseason: false })).toBeNull();
  });
});
