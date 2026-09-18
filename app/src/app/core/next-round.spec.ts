import { describe, expect, it } from 'vitest';

import {
  afterOfficial, leadMinutes, linesFor, nextClubFor, nextPitch, nextShapes, parseNextRound,
} from './next-round';

/**
 * IL PROSSIMO TURNO SECONDO LE FONTI.
 *
 * I payload qui sono SINTETICI e non una presa vera: quel JSON porta nomi e undici derivati da pagine a
 * pagamento e questo repository e' pubblico, quindi la verifica sul dato reale si fa a parte
 * (`app/scripts/probe-sheet-endpoint.mjs`, che legge l'endpoint vivo) e qui si prova la RIDUZIONE.
 *
 * Il caso che conta e' l'ultimo: l'undicesima maglia contesa a pari voti, che e' il motivo per cui
 * questa lettura esiste - sulla presa vera del turno 5 capitava su 18 club di 20.
 */

const man = (player: string, votes: number, of = 4, extra: Record<string, unknown> = {}) => ({
  fc_id: 1000 + player.length, player, role: 'C', votes, of, by: [], prob: null, ...extra,
});

const payload = (men: unknown[], extra: Record<string, unknown> = {}) => ({
  round: 5,
  generated_at: '2026-09-18T17:56:19Z',
  sources: ['fantacalcio.it', 'sport.sky.it', 'corrieredellosport.it', 'sosfanta.com'],
  what: 'what the sources published, counted - not a prediction of ours',
  clubs: {
    monza: {
      club: 'Monza', kickoff: '2026-09-18T18:45:00Z', taken_at: '2026-09-18T17:33:05Z',
      of: 4, men, ...extra,
    },
  },
});

const eleven = (votes = 4) => Array.from({ length: 11 }, (_, i) => man(`P${i}`, votes));

describe('parseNextRound', () => {
  it('reads the round, what it declares of itself, and the sources that were read', () => {
    const r = parseNextRound(payload(eleven()))!;
    expect(r.round).toBe(5);
    expect(r.sources).toHaveLength(4);
    // La frase viaggia nel payload apposta: chi legge deve sapere che e' la stampa e non una nostra
    // previsione, e ripeterla a mano nella vista sarebbe una seconda definizione della stessa cosa.
    expect(r.what).toContain('not a prediction of ours');
  });

  it('takes the eleven most voted and leaves the rest out', () => {
    const r = parseNextRound(payload([...eleven(4), man('Dodici', 2), man('Tredici', 1)]))!;
    const club = r.clubs[0];
    expect(club.certain).toHaveLength(11);
    expect(club.contested).toHaveLength(0);
    expect(club.out.map((m) => m.player)).toEqual(['Dodici', 'Tredici']);
    expect(club.unanimous).toBe(11);
  });

  it('NAMES both men of a contested shirt and picks NEITHER', () => {
    // Il caso vero del Monza: nove certi, uno a 3/4, e due uomini a 2/4 per UNA maglia sola. La prima
    // versione ne sceglieva uno in ordine alfabetico - invisibile e sbagliato meta' delle volte.
    const men = [...eleven(4).slice(0, 9), man('Robinson', 3), man('Cutrone', 2), man('Colpani', 2)];
    const club = parseNextRound(payload(men))!.clubs[0];
    expect(club.certain).toHaveLength(10);
    expect(club.contestedPlaces).toBe(1);
    expect(club.contested.map((m) => m.player).sort()).toEqual(['Colpani', 'Cutrone']);
    expect(club.unanimous).toBe(9);
  });

  it('calls no contest when the tied men are exactly the shirts left', () => {
    // Due a pari merito per DUE maglie: entrano entrambi, e dire "contesa" sarebbe inventarla.
    const men = [...eleven(4).slice(0, 9), man('Uno', 2), man('Due', 2), man('Fuori', 1)];
    const club = parseNextRound(payload(men))!.clubs[0];
    expect(club.certain).toHaveLength(11);
    expect(club.contested).toHaveLength(0);
    expect(club.out.map((m) => m.player)).toEqual(['Fuori']);
  });

  it('does not call a tie where the eleventh is better voted than the twelfth', () => {
    const men = [...eleven(4).slice(0, 10), man('Undici', 3), man('Dodici', 2)];
    const club = parseNextRound(payload(men))!.clubs[0];
    expect(club.contested).toHaveLength(0);
    expect(club.certain).toHaveLength(11);
  });

  it('uses the probability to ORDER the contested men and never to settle them', () => {
    // La probabilita' la pubblicano due fonti su quattro: va bene per mostrarli in un ordine, non per
    // dichiarare che la contesa non c'e' - altrimenti un metro parziale deciderebbe una maglia.
    const men = [...eleven(4).slice(0, 10), man('Alto', 2, 4, { prob: 0.9 }), man('Basso', 2, 4, { prob: 0.4 })];
    const club = parseNextRound(payload(men))!.clubs[0];
    expect(club.certain).toHaveLength(10);
    expect(club.contestedPlaces).toBe(1);
    expect(club.contested.map((m) => m.player)).toEqual(['Alto', 'Basso']);
  });

  it('keeps a man the sources name but our identity could not resolve', () => {
    // Un nome senza fc_id resta un uomo: toglierlo farebbe leggere come "nessuno lo nomina" un uomo
    // che due fonti nominano, ed e' "vuoto = ignoto" applicato a una persona.
    const club = parseNextRound(payload([...eleven(4).slice(0, 10), man('Senza', 3, 4, { fc_id: null })]))!.clubs[0];
    expect(club.certain).toHaveLength(11);
    expect(club.certain[10].fcId).toBeNull();
  });

  it('refuses a payload it cannot read, and that is not an empty round', () => {
    expect(parseNextRound(null)).toBeNull();
    expect(parseNextRound({ round: 5 })).toBeNull();
    // Letto, e nessuna presa ancora: un turno con zero club, che e' un'altra cosa da `null`.
    expect(parseNextRound({ round: null, clubs: {} })!.clubs).toHaveLength(0);
  });

  it('drops a man with no name or no vote instead of drawing a blank', () => {
    const club = parseNextRound(payload([man('Vero', 4), { player: '', votes: 4 }, man('Zero', 0)]))!.clubs[0];
    expect(club.certain.map((m) => m.player)).toEqual(['Vero']);
  });

  it('orders the clubs by kick-off, because the first fixture is the one to look at first', () => {
    const r = parseNextRound({
      clubs: {
        tardi: { club: 'Tardi', kickoff: '2026-09-20T13:00:00Z', of: 4, men: eleven() },
        presto: { club: 'Presto', kickoff: '2026-09-18T18:45:00Z', of: 4, men: eleven() },
      },
    })!;
    expect(r.clubs.map((c) => c.club)).toEqual(['Presto', 'Tardi']);
  });
});

describe('how old the reading is', () => {
  it('measures the lead in minutes before that club kick-off', () => {
    const club = parseNextRound(payload(eleven()))!.clubs[0];
    expect(leadMinutes(club)).toBe(72);           // 17:33:05 -> 18:45
    expect(afterOfficial(club)).toBe(false);      // le ufficiali escono a 30'
  });

  it('says a reading taken inside the official window is one', () => {
    const club = parseNextRound(payload(eleven(), { taken_at: '2026-09-18T18:30:00Z' }))!.clubs[0];
    expect(leadMinutes(club)).toBe(15);
    expect(afterOfficial(club)).toBe(true);
  });

  it('answers null when an instant is missing, which is not "it is fine"', () => {
    const club = parseNextRound(payload(eleven(), { kickoff: null }))!.clubs[0];
    expect(leadMinutes(club)).toBeNull();
    expect(afterOfficial(club)).toBeNull();
  });
});

describe('which club of the payload is the one on screen', () => {
  // Il foglio chiama i club con la sua tabella di alias e l'app col nome canonico del listone: due
  // vocabolari, quindi l'aggancio passa per la CHIAVE PRIMARIA del progetto e mai per la stringa.
  const withIds = (ids: readonly number[]) =>
    ids.map((id, i) => man(`M${i}`, 4, 4, { fc_id: id }));

  const two = {
    clubs: {
      alfa: { club: 'Alfa', of: 4, men: withIds([1, 2, 3, 4]) },
      beta: { club: 'Beta', of: 4, men: withIds([10, 11, 12, 13]) },
    },
  };

  it('picks the club our squad shares the most men with', () => {
    expect(nextClubFor(parseNextRound(two), [10, 11, 12])!.club).toBe('Beta');
  });

  it('refuses a club that shares fewer men than a coincidence would', () => {
    // Due nomi in comune possono essere un'identità risolta male; tre no.
    expect(nextClubFor(parseNextRound(two), [1, 2])).toBeNull();
  });

  it('refuses a TIE instead of drawing one of the two', () => {
    // Non può succedere con rose vere: se succede l'identità ha sbagliato, e sceglierne uno sarebbe
    // inventare quale. Lo stesso motivo per cui l'undicesima maglia non si spareggia sul nome.
    expect(nextClubFor(parseNextRound(two), [1, 2, 3, 10, 11, 12])).toBeNull();
  });

  it('counts the men OUT of the eleven too: they are still his', () => {
    const payload = {
      clubs: { alfa: { club: 'Alfa', of: 4, men: [...withIds([1, 2, 3]).map((m) => ({ ...m, votes: 1 }))] } },
    };
    expect(nextClubFor(parseNextRound(payload), [1, 2, 3])!.club).toBe('Alfa');
  });

  it('answers null with nothing read and null with an empty squad, which are two silences', () => {
    expect(nextClubFor(null, [1, 2, 3])).toBeNull();
    expect(nextClubFor(parseNextRound(two), [])).toBeNull();
  });
});

describe('the shape, and the eleven placed on it', () => {
  /**
   * I MODULI SONO QUELLI VERI e non quelli del regolamento mantra (operatore, 18/09/2026). Il caso che
   * lo impone e' il Monza: cinque difensori di listone, che nessuno schema mantra ha - perche' due sono
   * i QUINTI, e in un 3-4-3 giocano a centrocampo.
   */
  const codes = new Map<string, readonly string[]>();
  const withCodes = (name: string, list: string, votes = 4) => {
    codes.set(name, list.split(';'));
    return man(name, votes, 4, { role: null });
  };
  const codesFor = (one: { player: string }) => codes.get(one.player) ?? [];
  const linesOf = (one: { player: string; role: string | null }) =>
    linesFor(codesFor(one), one.role);
  const clubOf = (men: unknown[], extra: Record<string, unknown> = {}) =>
    parseNextRound(payload(men, extra))!.clubs[0];

  /** Il Monza vero del turno 5: 1 portiere, CINQUE difensori di listone, 2 centrocampisti, 3 attaccanti. */
  const monza = () => [
    withCodes('Tornqvist', 'por'), withCodes('Carboni', 'ds;dc'), withCodes('Lucchesi', 'dc'),
    withCodes('Kouadio', 'dd;dc'), withCodes('Birindelli', 'dd;ds;e'), withCodes('Mangas', 'ds;e'),
    withCodes('Folorunsho', 'c;t'), withCodes('Akinsanmiro', 'c'),
    withCodes('Varela', 'pc'), withCodes('Cutrone', 'pc'), withCodes('Robinson', 'a'),
  ];
  const REPERTOIRE = [
    { shape: '3-4-2-1', odds: 0.571 }, { shape: '3-4-3', odds: 0.422 },
    { shape: '3-5-2', odds: 0.004 }, { shape: '4-3-3', odds: 0.002 },
  ];

  it('reads a real 3-4-3 where the LISTONE roles count five defenders', () => {
    // Col regolamento mantra questi undici non esistevano: nessuno schema ha cinque difensori. Coi
    // QUINTI a centrocampo sono il modulo che il loro allenatore gioca da sempre.
    const shape = nextShapes(clubOf(monza()), linesOf, REPERTOIRE);
    expect(shape.shapes).toEqual(['3-4-3']);
    expect(shape.ours).toBe(true);
  });

  it('uses the module the SOURCES declare, before any repertoire', () => {
    const shape = nextShapes(clubOf(monza(), { shapes: { '3-5-2': ['fantacalcio.it', 'sosfanta.com'] } }),
      linesOf, REPERTOIRE);
    expect(shape.shapes).toEqual(['3-5-2']);
    expect(shape.by).toEqual(['fantacalcio.it', 'sosfanta.com']);
    expect(shape.ours).toBe(false);
  });

  it('names both when the sources declare two modules with the same weight', () => {
    const shape = nextShapes(clubOf(monza(), { shapes: { '3-4-3': ['a'], '3-5-2': ['b'] } }),
      linesOf, REPERTOIRE);
    expect(shape.shapes).toEqual(['3-4-3', '3-5-2']);
    expect(shape.why).toContain('moduli diversi');
  });

  it('puts the wing-backs in MIDFIELD and the centre-backs in defence', () => {
    const drawn = nextPitch(clubOf(monza()), '3-4-3', linesOf, codesFor)!;
    expect(drawn.rows.map((row) => `${row.line}${row.places.length}`)).toEqual(['P1', 'D3', 'M4', 'A3']);
    expect(drawn.named).toBe(11);
    const on = (line: string) => drawn.rows.find((row) => row.line === line)!
      .places.map((place) => place.man!.player);
    expect(on('D').sort()).toEqual(['Carboni', 'Kouadio', 'Lucchesi']);
    expect(on('M').sort()).toEqual(['Akinsanmiro', 'Birindelli', 'Folorunsho', 'Mangas']);
    expect(on('A').sort()).toEqual(['Cutrone', 'Robinson', 'Varela']);
  });

  it('draws each line from the team\'s RIGHT to its left, on the side the codes declare', () => {
    // Il verso e' quello gia' misurato e in uso sugli altri due campetti: `dd` a destra, `ds` a sinistra.
    const on = nextPitch(clubOf(monza()), '3-4-3', linesOf, codesFor)!
      .rows.find((row) => row.line === 'D')!.places.map((place) => place.man!.player);
    expect(on.indexOf('Kouadio')).toBeLessThan(on.indexOf('Carboni'));
  });

  it('leaves the contested shirt EMPTY and puts both names in it', () => {
    // Dieci certi e DUE uomini a pari voti per l'undicesima maglia: tre a pari merito sarebbero un'altra
    // situazione, ed e' l'errore che questo fixture ha fatto la prima volta.
    const men = [...monza().slice(0, 10), man('Uno', 2, 4, { role: null }), man('Due', 2, 4, { role: null })];
    codes.set('Uno', ['pc']);
    codes.set('Due', ['pc']);
    const club = clubOf(men);
    expect(club.contestedPlaces).toBe(1);
    const drawn = nextPitch(club, '3-4-3', linesOf, codesFor)!;
    expect(drawn.named).toBe(10);
    const open = drawn.rows.flatMap((row) => row.places).filter((place) => !place.man);
    expect(open).toHaveLength(1);
    expect(open[0].line).toBe('A');
    expect(open[0].contested.map((one) => one.player).sort()).toEqual(['Due', 'Uno']);
  });

  it('IGNORES a declared shape that is not a module, instead of going mute', () => {
    // Il modulo dichiarato arriva dalla marcatura di quattro siti: puo' essere un refuso o un formato
    // nuovo. Senza il filtro passava dritto al disegno, che restituisce null, e la sezione restava senza
    // campetto E senza ragione - lo stato che questa pagina ha il compito di non produrre mai.
    const shape = nextShapes(clubOf(monza(), { shapes: { '3-4-4': ['fantacalcio.it'] } }),
      linesOf, REPERTOIRE);
    expect(shape.shapes).toEqual(['3-4-3']);   // si torna a dedurre
    expect(shape.by).toEqual([]);
  });

  it('says so when no module of the club fits, and invents none', () => {
    const shape = nextShapes(clubOf(monza()), linesOf, [{ shape: '4-4-2', odds: 1 }]);
    expect(shape.shapes).toEqual([]);
    expect(shape.why).toContain('non stanno in nessuno');
  });

  it('says so when the bundle carries no repertoire for this club', () => {
    const shape = nextShapes(clubOf(monza()), linesOf, []);
    expect(shape.shapes).toEqual([]);
    expect(shape.why).toContain('repertorio');
  });

  it('falls back to the MACRO-ROLE for a man the listone does not quote', () => {
    // «Un difensore, e non so quale»: puo' essere un terzino o un quinto, e l'assegnazione decide.
    expect(linesFor([], 'D')).toEqual(['D', 'M']);
    expect(linesFor([], 'P')).toEqual(['P']);
    // ...e di chi non ha nemmeno quello si sa solo che non e' il portiere: sta dove resta posto, e il
    // suo posto non porta nessuna etichetta. Tenerlo fuori faceva sparire l'INTERO campetto per due
    // nomi su tredici.
    expect(linesFor([], null)).toEqual(['D', 'M', 'T', 'A']);
  });
});
