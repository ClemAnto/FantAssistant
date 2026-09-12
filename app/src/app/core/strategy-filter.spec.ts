import { READINGS } from './strategy';
import {
  COMPARE_OPS,
  FilterClause,
  FILTERABLE_READINGS,
  decimalsOf,
  describeClause,
  filterFields,
  filterReadings,
  isFilterSet,
  passesClause,
  passesFilter,
  readClauses,
  readFilterSet,
} from './strategy-filter';

const clause = (over: Partial<FilterClause> = {}): FilterClause => ({
  key: 'played',
  season: null,
  op: 'gte',
  value: 25,
  ...over,
});

/** Le stagioni come il pacchetto le dichiara, per le voci del menu'. */
const SEASONS = { pickable: ['2026-27', '2025-26', '2024-25'], target: '2026-27', input: '2025-26' };

describe('i sei criteri', () => {
  it('sono i sei che l operatore ha dettato', () => {
    expect(COMPARE_OPS).toEqual(['lt', 'lte', 'eq', 'gte', 'gt', 'ne']);
  });

  it('confrontano il numero vero sui quattro di disuguaglianza', () => {
    expect(passesClause(clause({ op: 'gte', value: 25 }), 25, 0)).toBe(true);
    expect(passesClause(clause({ op: 'gt', value: 25 }), 25, 0)).toBe(false);
    expect(passesClause(clause({ op: 'lte', value: 25 }), 25, 0)).toBe(true);
    expect(passesClause(clause({ op: 'lt', value: 25 }), 24.9, 0)).toBe(true);
  });

  /**
   * `=` E `≠` RISPONDONO ALLA PRECISIONE CHE LA RIGA STAMPA, o sarebbero due controlli che non fanno
   * niente: una fantamedia attesa vale 6,4999999 e nessuno scrivera' mai quel numero in una casella.
   */
  it("l uguaglianza e' quella che si vede sullo schermo, non quella del float", () => {
    expect(passesClause(clause({ key: 'fm', op: 'eq', value: 6.5 }), 6.4999999, 2)).toBe(true);
    expect(passesClause(clause({ key: 'fm', op: 'ne', value: 6.5 }), 6.4999999, 2)).toBe(false);
    expect(passesClause(clause({ key: 'fm', op: 'eq', value: 6.5 }), 6.46, 2)).toBe(false);
    // ...e con zero cifre, «= 25» prende la riga che stampa 25 anche se dietro c'e' 24,6.
    expect(passesClause(clause({ op: 'eq', value: 25 }), 24.6, 0)).toBe(true);
  });

  /**
   * «VUOTO = IGNOTO» IN TUTTE E SEI LE DIREZIONI, `≠` compreso: di un uomo senza xG non sappiamo che
   * il suo xG sia diverso da uno, quindi non entra in nessuna delle due liste.
   */
  it('chi non ha il numero non passa nessun criterio, nemmeno il diverso', () => {
    for (const op of COMPARE_OPS) {
      expect(passesClause(clause({ op, value: 1 }), null, 2)).toBe(false);
    }
  });

  it('un riferimento che non e un numero non filtra niente', () => {
    expect(passesClause(clause({ value: Number.NaN }), 30, 0)).toBe(false);
  });
});

describe('il filtro intero', () => {
  // Un uomo con due stagioni diverse sulla stessa lettura: e' il caso che l'operatore ha chiesto.
  const numbers: Record<string, number | null> = {
    gain: 1.5, 'played|': 30, 'fm|': 6.8, 'xg|': null,
    'mv|2026-27': 7.4, 'mv|2025-26': 5.8,
  };
  const valueOf = (clause: FilterClause) =>
    numbers[clause.key === 'gain' ? 'gain' : `${clause.key}|${clause.season ?? ''}`] ?? null;

  /**
   * LA STAGIONE E' PARTE DELLA CONDIZIONE, ed e' l'esempio dell'operatore alla lettera: senza di lei
   * «mv > 7 E mv < 6» non avrebbe soluzioni, e con lei seleziona chi e' esploso quest'anno.
   */
  it('due condizioni sulla stessa lettura e due stagioni non si contraddicono', () => {
    const now = clause({ key: 'mv', season: '2026-27', op: 'gt', value: 7 });
    const before = clause({ key: 'mv', season: '2025-26', op: 'lt', value: 6 });
    expect(passesFilter([now, before], valueOf)).toBe(true);
    // ...e la stessa coppia SENZA le stagioni non passa mai, perche' e' una contraddizione.
    expect(passesFilter(
      [clause({ key: 'fm', op: 'gt', value: 7 }), clause({ key: 'fm', op: 'lt', value: 6 })],
      valueOf,
    )).toBe(false);
  });

  it('sono in AND: bastano tutte, e ne basta una a mancare', () => {
    expect(passesFilter([clause({ key: 'played', op: 'gte', value: 25 })], valueOf)).toBe(true);
    expect(
      passesFilter(
        [clause({ key: 'played', op: 'gte', value: 25 }), clause({ key: 'fm', op: 'gte', value: 6.5 })],
        valueOf,
      ),
    ).toBe(true);
    expect(
      passesFilter(
        [clause({ key: 'played', op: 'gte', value: 25 }), clause({ key: 'fm', op: 'gte', value: 7 })],
        valueOf,
      ),
    ).toBe(false);
  });

  it('un filtro vuoto passa tutti: e lo stato in cui la pagina si apre', () => {
    expect(passesFilter([], valueOf)).toBe(true);
  });

  it("una condizione su un numero che non c'e toglie l'uomo, e non lo tiene", () => {
    expect(passesFilter([clause({ key: 'xg', op: 'lt', value: 99 })], valueOf)).toBe(false);
  });

  /**
   * L'ORDINE NON CONTA, ed e' proprio quello che l'AND compra: e' la proprieta' che rende sicuro
   * cancellare una condizione a meta' lista senza chiedersi cosa succede alle altre.
   */
  it("l'ordine delle condizioni non cambia la risposta", () => {
    const one = clause({ key: 'played', op: 'gte', value: 25 });
    const two = clause({ key: 'fm', op: 'lt', value: 6 });
    expect(passesFilter([one, two], valueOf)).toBe(passesFilter([two, one], valueOf));
  });
});

describe('il vocabolario dei filtri', () => {
  /**
   * DERIVATO da `READINGS` e non riscritto: una lettura nuova compare da se' fra quelle filtrabili, ed
   * e' la stessa disciplina dell'elenco dell'ordinamento.
   */
  it('si filtra su ogni lettura che porti un numero, e su nessun altra', () => {
    expect(FILTERABLE_READINGS).toEqual(
      READINGS.filter((one) => !one.pair && !one.word).map((one) => one.key),
    );
    // Le coppie stampano `12:5` e non hanno un numero dietro; la titolarita' e' una parola.
    expect(FILTERABLE_READINGS).not.toContain('gaNow');
    expect(FILTERABLE_READINGS).not.toContain('titolarita');
    // ...e le quattro frequenze ci sono, che sono il motivo per cui questo elenco e' derivato.
    expect(FILTERABLE_READINGS).toContain('longPlay');
    expect(FILTERABLE_READINGS).toContain('poorMatch');
  });

  it('il gain e la prima voce e porta il nome della sua asta', () => {
    const fields = filterFields('SURPLUS a giornata', SEASONS);
    expect(fields[0]).toEqual({
      key: 'gain', label: 'SURPLUS a giornata', seasonal: false, seasons: [], season: null, decimals: 2,
    });
    expect(fields.length).toBe(FILTERABLE_READINGS.length + 1);
  });

  /**
   * LE STAGIONI LE OFFRE CHI PUO' PRENDERLE, e `tutte` solo dove la spec lo dichiara: offrirla a una
   * media voto vorrebbe dire promettere «la MV di tutte le stagioni insieme», che nessuno ha misurato.
   */
  it('ogni lettura stagionale offre le stagioni del pacchetto, e le frequenze anche «tutte»', () => {
    const fields = filterFields('SURPLUS', SEASONS);
    const mv = fields.find((one) => one.key === 'mv')!;
    expect(mv.seasonal).toBe(true);
    expect(mv.season).toBe('2026-27');
    expect(mv.seasons.map((one) => one.value)).toEqual(['2026-27', '2025-26', '2024-25']);
    expect(mv.seasons.map((one) => one.label)).toEqual(['26/27', '25/26', '24/25']);
    const long = fields.find((one) => one.key === 'longPlay')!;
    expect(long.season).toBe('tutte');
    expect(long.seasons[0]).toEqual({ value: 'tutte', label: 'tutte' });
    // ...e una lettura del FOGLIO non ne offre nessuna: una previsione di una stagione finita non esiste.
    expect(fields.find((one) => one.key === 'played')!.seasons).toEqual([]);
  });

  it('le cifre di una voce sono quelle del suo formato', () => {
    expect(decimalsOf('1.2-2')).toBe(2);
    expect(decimalsOf('1.0-0')).toBe(0);
    expect(decimalsOf('1.1-1')).toBe(1);
    expect(decimalsOf('boh')).toBe(0);
  });

  it('un gettone si legge col segno del criterio', () => {
    expect(describeClause(clause({ key: 'played', op: 'gte', value: 25 }), 'Pa')).toBe('Pa ≥ 25');
    expect(describeClause(clause({ key: 'fm', op: 'lt', value: 6 }), 'FM')).toBe('FM < 6');
  });

  /**
   * QUALI STAGIONI CARICARE DIPENDE ANCHE DAL FILTRO: senza, una condizione su `xG` leggerebbe una
   * colonna che nessuno ha caricato, cioe' svuoterebbe ogni blocco in silenzio.
   */
  it('dice quali letture interroga CON la loro stagione, e il gain non ne e una', () => {
    expect(filterReadings([
      clause({ key: 'xg', season: '2026-27' }),
      clause({ key: 'gain' }),
      clause({ key: 'xg', season: '2026-27' }),
      clause({ key: 'xg', season: '2025-26' }),
    ])).toEqual([{ key: 'xg', season: '2026-27' }, { key: 'xg', season: '2025-26' }]);
    expect(filterReadings([])).toEqual([]);
  });
});

describe('quello che sta sul disco', () => {
  it('si valida invece di fidarsi, e quello che non si capisce si butta', () => {
    const read = readClauses([
      { key: 'played', op: 'gte', value: 25, season: null },
      { key: 'una-lettura-che-non-esiste', op: 'gte', value: 1 },
      { key: 'fm', op: 'circa', value: 6 },
      { key: 'fm', op: 'gte', value: 'sei' },
      null,
    ]);
    expect(read).toEqual([{ key: 'played', season: null, op: 'gte', value: 25 }]);
  });

  it('quello che non e nemmeno una lista torna vuoto invece di far cadere la pagina', () => {
    expect(readClauses(null)).toEqual([]);
    expect(readClauses('filtri')).toEqual([]);
  });

  it('un insieme salvato si riconosce dal nome, e le sue condizioni si validano come le altre', () => {
    expect(isFilterSet({ id: 'a', name: 'Titolari' })).toBe(true);
    expect(isFilterSet({ name: 'senza id' })).toBe(false);
    expect(isFilterSet(null)).toBe(false);
    expect(
      readFilterSet({ id: 'a', name: 'Titolari', clauses: [{ key: 'boh', op: 'gte', value: 1 }] as never }),
    ).toEqual({ id: 'a', name: 'Titolari', clauses: [] });
  });
});
