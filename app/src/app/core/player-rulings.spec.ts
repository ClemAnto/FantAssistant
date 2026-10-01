import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { Bundle, type PressRungsFile } from './bundle';
import {
  BOARD_EFFECT,
  PRESS_TO_RUNG,
  PlayerRuling,
  PlayerRulings,
  pressRulings,
  RungValues,
  orderedShares,
  ruledShare,
  rungMedians,
  rungShares,
  RUNG_VOTE_SHARE,
  sanitiseRulings,
} from './player-rulings';
import { TITOLARITA_LADDER, Titolarita } from './titolarita';

/** Una riga del foglio come questa misura la legge: la parola e i DUE numeri che l'hanno decisa. */
function row(titolarita: string | null, titolaritaPlay: number | null, minutesNext: number | null = 75) {
  return { titolarita, titolaritaPlay, minutesNext };
}

/** Una scala come la misura la restituisce: due assi per gradino. */
function scale(entries: [Titolarita, number, number | null][]): Map<Titolarita, RungValues> {
  return new Map(entries.map(([rung, play, minutes]) => [rung, { play, minutes }]));
}

function ruling(rung: Titolarita): PlayerRuling {
  return { rung, decidedOn: '2026-09-07' };
}

describe('rungMedians', () => {
  it('prende la MEDIANA di ogni gradino, e la misura non raddrizza niente', () => {
    // Le mediane vere del foglio Serie A del 07/09/2026, con le loro popolazioni:
    // bandiera 0,967 (29) · titolare 0,858 (17) · ballottaggio 0,949 (59) · ballottaggio 0,807 (155)
    // · panchina 0,631 (119) · riserva 0,243 (183). NON sono monotone, e la misura non le raddrizza.
    const shares = rungMedians([
      row('ballottaggio', 0.90), row('ballottaggio', 0.949), row('ballottaggio', 1.0),
      row('titolare', 0.85), row('titolare', 0.858), row('titolare', 0.87),
    ]);
    expect(shares.get('ballottaggio')!.play).toBeCloseTo(0.949, 5);
    expect(shares.get('titolare')!.play).toBeCloseTo(0.858, 5);
    // La cosa che sorprende ed è vera: `titolare` è il gradino RESIDUO fra `bandiera` e
    // `ballottaggio` (>80% delle partite E almeno 75 minuti), quindi sulla QUOTA sta più in basso. Qui si
    // asserisce la MISURA per quello che è; l'ordine della scala lo rimette `orderedShares`.
    expect(shares.get('titolare')!.play).toBeLessThan(shares.get('ballottaggio')!.play);
  });

  it('I MINUTI SONO L’ALTRO ASSE, e hanno il loro denominatore', () => {
    // La parola la assegna il toolkit su una quota E su un pavimento di minuti (operatore,
    // 08/09/2026), quindi la misura ne porta due. Le mediane vere del foglio Serie A: 80 · 80 · 71 ·
    // 61 · 55 · 52, coi pavimenti visibili - i due gradini alti stanno tutt'e due sopra i 75'.
    const shares = rungMedians([
      row('ballottaggio', 0.90, 70), row('ballottaggio', 0.95, 71), row('ballottaggio', 1.0, 72),
      // Una riga con la quota e SENZA i minuti entra nella prima mediana e non nella seconda: tenere
      // fuori tutt'e due butterebbe una misura buona, contarla zero ne inventerebbe una falsa.
      row('panchina', 0.6, null),
    ]);
    expect(shares.get('ballottaggio')!.minutes).toBe(71);
    expect(shares.get('panchina')!.play).toBeCloseTo(0.6, 5);
    expect(shares.get('panchina')!.minutes).toBeNull();
  });

  it('un gradino che il foglio non popola non entra nella mappa: vuoto = ignoto, mai zero', () => {
    const shares = rungMedians([row('panchina', 0.6), row(null, 0.9), row('titolare', null)]);
    expect(shares.get('panchina')!.play).toBeCloseTo(0.6, 5);
    expect(shares.has('bandiera')).toBe(false);
    // Una parola che il foglio non conosce e una riga senza quota non contano: la prima non è un
    // gradino, la seconda non ha un numero da mettere in una mediana.
    expect(shares.has('ballottaggio')).toBe(false);
    expect(shares.size).toBe(1);
  });

  it('la mediana di un numero pari di righe è la media delle due centrali', () => {
    expect(rungMedians([row('riserva', 0.2), row('riserva', 0.4)]).get('riserva')!.play)
      .toBeCloseTo(0.3, 5);
  });
});

describe('orderedShares', () => {
  /** Le sei mediane vere del foglio Serie A del 07/09/2026, sui due assi. */
  const measured = scale([
    ['bandiera', 0.967, 80], ['titolare', 0.858, 80], ['ballottaggio', 0.949, 71],
    ['panchina', 0.631, 55], ['riserva', 0.243, 52],
  ]);

  it('L’ORDINE DELLA SCALA È UNA DICHIARAZIONE: `titolare` sta sopra `ballottaggio`', () => {
    // Correzione dell'operatore, 08/09/2026: «titolare deve essere meglio di titolare». La sua
    // scala è ordinata per definizione, quindi dichiarare un gradino più alto non può abbassare le
    // presenze attese - sarebbe una dichiarazione che punisce chi la fa, e nessuno la userebbe due volte.
    const shares = orderedShares(measured);
    const ladder = [...TITOLARITA_LADDER].map((rung) => shares.get(rung)!);
    for (let at = 0; at < ladder.length - 1; at += 1) {
      // NON DECRESCENTE su ognuno dei due assi: un pareggio non contraddice un ordine, un'inversione
      // sì - e sui minuti `bandiera` e `titolare` pareggiano davvero, perché condividono il
      // pavimento dei 75' e si separano sulla quota.
      expect(ladder[at].play).toBeGreaterThanOrEqual(ladder[at + 1].play);
      expect(ladder[at].minutes!).toBeGreaterThanOrEqual(ladder[at + 1].minutes!);
    }
    // ...e sulla QUOTA la richiesta dell'operatore è soddisfatta in senso STRETTO.
    expect(shares.get('titolare')!.play).toBeGreaterThan(shares.get('ballottaggio')!.play);
  });

  it('...e si muove SOLO il gradino che contraddice l’ordine, fra i suoi vicini misurati', () => {
    const shares = orderedShares(measured);
    // `titolare` finisce fra `ballottaggio` (0,949) e `bandiera` (0,967): l'ordine viene da lui, il
    // livello dal dato, e non entra nessun numero fuori dalla banda che la misura disegna.
    expect(shares.get('titolare')!.play).toBeCloseTo((0.949 + 0.967) / 2, 5);
    // I MINUTI NON SI TOCCANO: là non c'è nessuna inversione, e i suoi 80' sono la sua mediana.
    expect(shares.get('titolare')!.minutes).toBe(80);
    // Gli altri cinque restano la loro mediana su tutt'e due gli assi: una riparazione che tocca
    // tutto sarebbe una scala inventata con l'aria di una misura.
    for (const rung of ['bandiera', 'ballottaggio', 'panchina', 'riserva'] as Titolarita[]) {
      expect(shares.get(rung)!.play).toBeCloseTo(measured.get(rung)!.play, 6);
      expect(shares.get(rung)!.minutes).toBe(measured.get(rung)!.minutes);
    }
  });

  it('un’inversione sui MINUTI si ripara come una sulla quota, e solo lei', () => {
    const shares = orderedShares(scale([
      ['bandiera', 0.967, 82], ['titolare', 0.958, 60], ['ballottaggio', 0.949, 71],
    ]));
    // 60 sotto i 71 di `ballottaggio` è un'inversione: sale in mezzo ai vicini (71 e 82).
    expect(shares.get('titolare')!.minutes).toBeCloseTo((71 + 82) / 2, 5);
    // ...e la quota, che era già ordinata, non si muove di un millesimo.
    expect(shares.get('titolare')!.play).toBeCloseTo(0.958, 6);
  });

  it('un violatore in CIMA si mette PARI a chi gli sta sotto, senza inventare un tetto', () => {
    // Sopra di lui non c'è un vicino da cui interpolare, e i minuti non hanno un tetto naturale come
    // l'1 di una quota: il minimo che l'ordine richiede è il pareggio, e più di così sarebbe un numero
    // inventato.
    const shares = orderedShares(scale([['bandiera', 0.80, 60], ['titolare', 0.90, 71]]));
    expect(shares.get('bandiera')!.play).toBeCloseTo(0.90, 5);
    expect(shares.get('bandiera')!.minutes).toBe(71);
  });

  it('un gradino ASSENTE non e un vicino: si interpola fra quelli che il foglio popola', () => {
    // Senza `ballottaggio` sul foglio, il vicino di sotto di `titolare` e `panchina`.
    const shares = orderedShares(scale([
      ['bandiera', 0.967, 80], ['titolare', 0.70, 80], ['panchina', 0.807, 61],
    ]));
    expect(shares.has('ballottaggio')).toBe(false);
    expect(shares.get('titolare')!.play).toBeCloseTo((0.807 + 0.967) / 2, 5);
  });

  it('una scala gia ordinata non si tocca', () => {
    const shares = orderedShares(scale([['titolare', 0.9, 71], ['panchina', 0.5, 55]]));
    expect(shares.get('titolare')).toEqual({ play: 0.9, minutes: 71 });
    expect(shares.get('panchina')).toEqual({ play: 0.5, minutes: 55 });
  });
});

describe('rungShares', () => {
  it('e la misura CON l’ordine dichiarato: e quella che prezza', () => {
    const rows = [
      row('bandiera', 0.967, 80), row('titolare', 0.858, 80), row('ballottaggio', 0.949, 71),
    ];
    expect(rungShares(rows).get('titolare')!.play)
      .toBeGreaterThan(rungShares(rows).get('ballottaggio')!.play);
    // ...e la QUOTA è quella tarata sui voti, non la mediana del foglio (01/10/2026).
    expect(rungShares(rows).get('titolare')!.play).toBe(RUNG_VOTE_SHARE['titolare']);
    expect(rungShares(rows).get('riserva')!.play).toBe(RUNG_VOTE_SHARE['riserva']);
    // i MINUTI restano misurati sul foglio
    expect(rungShares(rows).get('bandiera')!.minutes).toBe(80);
    // ...e la misura grezza resta leggibile per quello che e', accanto.
    expect(rungMedians(rows).get('titolare')!.play)
      .toBeLessThan(rungMedians(rows).get('ballottaggio')!.play);
  });
});

describe('ruledShare', () => {
  const shares = scale([['titolare', 0.949, 71], ['riserva', 0.243, 52]]);

  it('impone i due numeri del gradino dichiarato a chi il foglio mette da un’altra parte', () => {
    expect(ruledShare(ruling('titolare'), 'riserva', shares)).toEqual({ play: 0.949, minutes: 71 });
    // ...e anche a chi il foglio non sa collocare affatto, che è metà della richiesta: un uomo senza
    // calcio misurato qui legge una costante di ruolo, e la dritta è l'unica cosa che ne sa di più.
    expect(ruledShare(ruling('titolare'), null, shares)).toEqual({ play: 0.949, minutes: 71 });
  });

  it('UNA CONFERMA NON MUOVE NIENTE: la sua quota misurata resta la sua', () => {
    // Se la dichiarazione dicesse la mediana anche qui, un `titolare` letto 0,99 scenderebbe a 0,949:
    // una dritta che CONFERMA il foglio peggiorerebbe il numero.
    expect(ruledShare(ruling('titolare'), 'titolare', shares)).toBeNull();
  });

  it('un gradino che quel foglio non popola non prezza niente, e la parola resta', () => {
    expect(ruledShare(ruling('bandiera'), 'riserva', shares)).toBeNull();
  });

  it('nessuna dritta, nessuna quota', () => {
    expect(ruledShare(null, 'titolare', shares)).toBeNull();
  });
});

describe('BOARD_EFFECT', () => {
  it('le tre parole vengono dal CANCELLO che la scala ha su se stessa', () => {
    // «chi la board non schiera non può essere titolare, chi schiera non scende sotto ballottaggio»
    // (`engine/status.py`): i primi tre gradini pretendono l'undici, gli ultimi due lo escludono.
    expect(BOARD_EFFECT.bandiera).toBe('starter');
    expect(BOARD_EFFECT.titolare).toBe('starter');
    // `ballottaggio` è l'unica parola compatibile con tutt'e due, e infatti 115 dei 155 ballottaggi
    // del foglio Serie A sono nell'undici disegnato e 40 no: quindi non muove il disegno.
    expect(BOARD_EFFECT.ballottaggio).toBe('alternative');
    expect(BOARD_EFFECT.panchina).toBe('reserve');
    expect(BOARD_EFFECT.riserva).toBe('reserve');
  });

  it('ogni parola della scala ha un effetto dichiarato: un settimo gradino non passa in silenzio', () => {
    for (const rung of TITOLARITA_LADDER) expect(BOARD_EFFECT[rung]).toBeTruthy();
    expect(Object.keys(BOARD_EFFECT).length).toBe(TITOLARITA_LADDER.length);
  });
});

describe('sanitiseRulings', () => {
  it('legge il campo del toolkit (`standing`) oltre al proprio, così un JSON copiato da là si legge', () => {
    const disk = sanitiseRulings({ '2026-27': { '5273': { standing: 'ballottaggio' } } });
    expect(disk['2026-27']['5273'].rung).toBe('ballottaggio');
  });

  it('una parola che nessuno sa applicare si IGNORA invece di essere interpretata', () => {
    const disk = sanitiseRulings({
      '2026-27': {
        '1': { rung: 'starter' },        // una parola del file del toolkit, non un gradino della scala
        '2': { rung: 'titolare' },
        tre: { rung: 'titolare' },       // una chiave che non è un fc_id
        '4': {},                          // una riga senza dichiarazione
      },
    });
    expect(Object.keys(disk['2026-27'])).toEqual(['2']);
  });

  it('un file illeggibile o di un’altra versione è silenzio, non una pagina che non si apre', () => {
    expect(sanitiseRulings(null)).toEqual({});
    expect(sanitiseRulings('{ questo non e json')).toEqual({});
    expect(sanitiseRulings({ '2026-27': 42 })).toEqual({});
    // Una stagione che non resta con nessuna riga valida non resta affatto.
    expect(sanitiseRulings({ '2026-27': { '1': { rung: 'boh' } } })).toEqual({});
  });

  it('la data si conserva, e chi non ce l’ha ne prende una: una dichiarazione senza data non si rilegge', () => {
    const kept = sanitiseRulings({ '2026-27': { '9': { rung: 'panchina', decided_on: '2026-08-01' } } });
    expect(kept['2026-27']['9'].decided_on).toBe('2026-08-01');
    const dated = sanitiseRulings({ '2026-27': { '9': { rung: 'panchina' } } });
    expect(String(dated['2026-27']['9'].decided_on)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

const PRESS: PressRungsFile = {
  _comment: 'ignored',
  '2026-27': {
    as_of: '2026-09-28',
    players: {
      '10': { tier: 'titolare', start_pct: 80 },
      '11': { tier: 'comprimario', start_pct: 35 },
      '12': { tier: 'scarto', start_pct: 2 },
      '13': { tier: 'fantasia', start_pct: 50 },
    },
  },
};

describe('pressRulings', () => {
  it('traduce la scala della stampa nella nostra e IGNORA una parola sconosciuta', () => {
    const map = pressRulings(PRESS, '2026-27');
    expect(map.get(10)?.rung).toBe('titolare');
    expect(map.get(11)?.rung).toBe('panchina');
    expect(map.get(12)?.rung).toBe('riserva');
    expect(map.has(13)).toBe(false);
    // la parola originale e la quota restano sulla riga: la distinzione della stampa non sparisce
    expect(map.get(12)).toMatchObject({ source: 'press', pressTier: 'scarto', startPct: 2, decidedOn: '2026-09-28' });
  });

  it('una riga con la SUA data tiene quella, una senza prende quella del blocco', () => {
    const file: PressRungsFile = {
      '2026-27': {
        as_of: '2026-10-01',
        players: {
          '20': { tier: 'titolare', start_pct: 80, as_of: '2026-09-28' },
          '21': { tier: 'titolare', start_pct: 80 },
          '22': { tier: 'titolare', start_pct: 80, as_of: 'ieri' },
        },
      },
    };
    const map = pressRulings(file, '2026-27');
    expect(map.get(20)?.decidedOn).toBe('2026-09-28');
    expect(map.get(21)?.decidedOn).toBe('2026-10-01');
    expect(map.get(22)?.decidedOn).toBe('2026-10-01');
  });

  it('una stagione che il file non porta, o nessun file, non danno nessuna parola', () => {
    expect(pressRulings(PRESS, '2025-26').size).toBe(0);
    expect(pressRulings(null, '2026-27').size).toBe(0);
  });

  it('ogni parola della stampa ha una traduzione, e ogni traduzione e\' un nostro gradino', () => {
    expect(Object.keys(PRESS_TO_RUNG).sort()).toEqual(
      ['ballottaggio', 'bandiera', 'comprimario', 'panchina', 'riserva', 'scarto', 'titolare', 'titolarissimo']);
    for (const rung of Object.values(PRESS_TO_RUNG)) expect(TITOLARITA_LADDER).toContain(rung);
  });
});

describe('PlayerRulings con la stampa', () => {
  async function service(): Promise<PlayerRulings> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{
        provide: Bundle,
        useValue: { manifest: async () => ({ target_season: '2026-27' }), pressRungs: async () => PRESS },
      }],
    });
    const one = TestBed.inject(PlayerRulings);
    await new Promise((resolve) => setTimeout(resolve));
    return one;
  }

  beforeEach(() => {
    try { localStorage.clear(); } catch { /* a runner without storage still runs the rest */ }
  });

  it('acceso di default: la stampa batte il foglio, e dice di essere la stampa', async () => {
    const rulings = await service();
    expect(rulings.pressOn()).toBe(true);
    expect(rulings.pressAsOf()).toBe('2026-09-28');
    expect(rulings.of(11)).toMatchObject({ rung: 'panchina', source: 'press' });
    expect(rulings.ownOf(11)).toBeNull();
  });

  it('la TUA dritta batte la stampa, e revocarla torna alla stampa', async () => {
    const rulings = await service();
    rulings.declare(11, 'titolare');
    expect(rulings.of(11)).toMatchObject({ rung: 'titolare', source: 'operator' });
    rulings.declare(11, null);
    expect(rulings.of(11)).toMatchObject({ rung: 'panchina', source: 'press' });
  });

  it('spento: resta solo quello che hai dichiarato tu', async () => {
    const rulings = await service();
    rulings.declare(10, 'bandiera');
    rulings.pressOn.set(false);
    expect(rulings.of(11)).toBeNull();
    expect(rulings.of(10)).toMatchObject({ rung: 'bandiera', source: 'operator' });
  });
});
