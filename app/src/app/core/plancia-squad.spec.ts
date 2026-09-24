import { describe, expect, it } from 'vitest';

import { MantraModules } from './auction-value';
import { Role } from './plancia';
import { PITCH_MODULE, SquadMan, UrnMan, classicPlaces, squadPitchOf } from './plancia-squad';

/** Il regolamento classic come il pacchetto lo porta, ridotto al modulo che serve qui. */
const CLASSIC: MantraModules = {
  slot_roles: { P: ['P'], D: ['D'], C: ['C'], A: ['A'] },
  modules: {
    '4-3-3': { D: ['D', 'D', 'D', 'D'], M: ['C', 'C', 'C'], T: [], A: ['A', 'A', 'A'] },
    '4-4-2': { D: ['D', 'D', 'D', 'D'], M: ['C', 'C', 'C', 'C'], T: [], A: ['A', 'A'] },
  },
} as MantraModules;

/** ...e quello MANTRA, che ha posti che accettano piu' di un ruolo: qui non deve essere accettato. */
const MANTRA: MantraModules = {
  slot_roles: { Por: ['Por'], 'Dc/B': ['Dc', 'B'], M: ['M'], 'A/Pc': ['A', 'Pc'] },
  modules: { '4-3-3': { D: ['Dc/B'], M: ['M'], T: [], A: ['A/Pc'] } },
} as MantraModules;

let nextId = 1;
/** Un uomo che e' MIO, quindi con un prezzo pagato: e' cio' che lo distingue da uno dell'urna. */
function man(role: Role, points: number | null, coin: number | null = points): SquadMan {
  const id = (nextId += 1);
  return { id, name: `${role}${id}`, role, points, coin, paid: id };
}

/** ...e uno ancora nell'urna: `paid` e' `null` perche' nessuno lo ha comprato, e non zero. */
function urn(role: Role, points: number | null, price: number): UrnMan {
  const id = (nextId += 1);
  return {
    id,
    name: `urn-${role}${id}`,
    role,
    points,
    coin: points,
    paid: null,
    price,
    slot: `${role}1`,
  };
}

const FULL: Record<Role, number> = { P: 0, D: 0, C: 0, A: 0 };
const OPEN: Record<Role, number> = { P: 2, D: 6, C: 6, A: 5 };

function pitch(over: Partial<Parameters<typeof squadPitchOf>[0]> = {}) {
  return squadPitchOf({
    mine: [],
    urn: [],
    places: classicPlaces(CLASSIC),
    freeSlots: OPEN,
    credits: 500,
    ...over,
  });
}

describe('classicPlaces', () => {
  it('legge l’1-4-3-3 dal regolamento invece di trascriverlo', () => {
    const places = classicPlaces(CLASSIC);
    expect(places).toHaveLength(11);
    const counts = places.reduce<Record<string, number>>((out, place) => {
      out[place.role] = (out[place.role] ?? 0) + 1;
      return out;
    }, {});
    expect(counts).toEqual({ P: 1, D: 4, C: 3, A: 3 });
    // Il numero del modulo si rilegge dalle sue stesse righe: la stessa controprova di trascrizione
    // che `classic_modules.json` fa su di se'.
    expect(`${counts['D']}-${counts['C']}-${counts['A']}`).toBe(PITCH_MODULE);
  });

  it('non piega un posto MANTRA a un macro-ruolo: torna vuoto e la card lo dice', () => {
    expect(classicPlaces(MANTRA)).toEqual([]);
  });

  it('senza regolamento non inventa un modulo', () => {
    expect(classicPlaces(null)).toEqual([]);
    expect(classicPlaces(CLASSIC, '5-5-5')).toEqual([]);
  });
});

describe('squadPitchOf', () => {
  it('schiera i migliori per VALORE ATTESO e lascia gli altri in panchina', () => {
    const best = man('D', 120);
    const worst = man('D', 40);
    const middle = man('D', 80);
    const drawn = pitch({ mine: [worst, best, middle] });
    const defence = drawn.rows.find((row) => row.line === 'D')!;
    expect(defence.places.map((place) => place.man?.id)).toEqual([
      best.id,
      middle.id,
      worst.id,
      undefined,
    ]);
    expect(drawn.placed).toBe(3);
    expect(drawn.bench).toEqual([]);
  });

  it('ordina la panchina per RUOLO e poi per MONETA, e chi non ha moneta va in fondo', () => {
    // Cinque difensori per quattro posti: due restano fuori, piu' un portiere e un attaccante.
    const placed = [man('D', 100), man('D', 90), man('D', 80), man('D', 70)];
    const spareRich = { ...man('D', 60), coin: 30 };
    const sparePoor = { ...man('D', 50), coin: 5 };
    const spareBlind = { ...man('D', 45), coin: null };
    const keeper = { ...man('P', 200), coin: 1 };
    const forward = { ...man('A', 10), coin: 99 };
    const drawn = pitch({
      mine: [sparePoor, spareBlind, ...placed, spareRich, keeper, forward],
    });
    // Il portiere gioca (e' l'unico), l'attaccante pure: in panchina restano i tre difensori.
    expect(drawn.bench.map((one) => one.id)).toEqual([spareRich.id, sparePoor.id, spareBlind.id]);
  });

  it('la panchina mette i ruoli nell’ordine in cui la rosa li dichiara', () => {
    const extra = (role: Role) => [man(role, 10), man(role, 9), man(role, 8), man(role, 7)];
    const drawn = pitch({ mine: [...extra('A'), ...extra('P'), ...extra('C')] });
    // P ne schiera 1, C ne schiera 3, A ne schiera 3: in panchina 3 portieri, 1 centrocampista, 1 attaccante.
    expect(drawn.bench.map((one) => one.role)).toEqual(['P', 'P', 'P', 'C', 'A']);
  });

  it('un posto VUOTO riceve DUE suggerimenti, distinti fra un posto e l’altro', () => {
    const drawn = pitch({
      mine: [],
      urn: [
        urn('A', 90, 10),
        urn('A', 80, 10),
        urn('A', 70, 10),
        urn('A', 60, 10),
        urn('A', 50, 10),
      ],
    });
    const attack = drawn.rows.find((row) => row.line === 'A')!;
    const named = attack.places.flatMap((place) => place.hints.map((one) => one.id));
    expect(attack.places.map((place) => place.hints.length)).toEqual([2, 2, 1]);
    expect(new Set(named).size).toBe(named.length);
    // ...e in ordine di forza: il posto piu' in alto prende i due migliori.
    expect(attack.places[0].hints.map((one) => one.points)).toEqual([90, 80]);
  });

  it('un posto OCCUPATO riceve UN suggerimento, e solo se lo batte davvero', () => {
    const holder = man('C', 100);
    const drawn = pitch({
      mine: [holder],
      urn: [urn('C', 130, 10), urn('C', 90, 10)],
    });
    const midfield = drawn.rows.find((row) => row.line === 'M')!;
    expect(midfield.places[0].man?.id).toBe(holder.id);
    expect(midfield.places[0].hints.map((one) => one.points)).toEqual([130]);
    // Il 90 non batte il titolare, quindi scende sul primo posto VUOTO invece di sparire.
    expect(midfield.places[1].hints.map((one) => one.points)).toEqual([90]);
  });

  it('un candidato che non batte il primo puo’ battere il quarto: il posto scende, lui no', () => {
    const strong = man('D', 200);
    const weak = man('D', 30);
    const drawn = pitch({ mine: [strong, weak], urn: [urn('D', 100, 10)] });
    const defence = drawn.rows.find((row) => row.line === 'D')!;
    expect(defence.places[0].hints).toEqual([]);
    expect(defence.places[1].hints.map((one) => one.points)).toEqual([100]);
  });

  it('niente suggerimenti dove il foglio non prezza: ne’ il candidato, ne’ chi il posto ce l’ha', () => {
    const blind = man('C', null);
    const drawn = pitch({
      mine: [blind],
      urn: [urn('C', null, 10), urn('C', 120, 10)],
    });
    const midfield = drawn.rows.find((row) => row.line === 'M')!;
    // Sul posto suo non si dice «compra al posto suo»: il confronto non esiste.
    expect(midfield.places[0].man?.id).toBe(blind.id);
    expect(midfield.places[0].hints).toEqual([]);
    // Sui posti vuoti il candidato senza numero non compare: un suggerimento senza prova non e' un
    // suggerimento realistico.
    const named = midfield.places.flatMap((place) => place.hints.map((one) => one.points));
    expect(named).toEqual([120]);
  });

  it('non suggerisce chi non si puo’ pagare tenendo un credito per ogni posto che resta', () => {
    // 100 crediti e 19 posti liberi: su un uomo solo ne restano 100 - 18 = 82.
    const free: Record<Role, number> = { P: 3, D: 8, C: 8, A: 0 };
    const drawn = pitch({
      freeSlots: free,
      credits: 100,
      urn: [urn('C', 90, 83), urn('C', 80, 82)],
    });
    expect(drawn.spendable).toBe(82);
    const midfield = drawn.rows.find((row) => row.line === 'M')!;
    expect(midfield.places[0].hints.map((one) => one.points)).toEqual([80]);
  });

  it('non suggerisce un ruolo che il regolamento non lascia piu’ comprare', () => {
    const free: Record<Role, number> = { P: 1, D: 1, C: 0, A: 1 };
    const drawn = pitch({ freeSlots: free, urn: [urn('C', 90, 1), urn('A', 10, 1)] });
    expect(drawn.rows.find((row) => row.line === 'M')!.places[0].hints).toEqual([]);
    expect(drawn.rows.find((row) => row.line === 'A')!.places[0].hints).toHaveLength(1);
  });

  it('a rosa piena non si compra piu’ niente, e lo dice con uno zero', () => {
    const drawn = pitch({ freeSlots: FULL, credits: 900, urn: [urn('A', 90, 1)] });
    expect(drawn.spendable).toBe(0);
    expect(drawn.rows.flatMap((row) => row.places).every((place) => !place.hints.length)).toBe(
      true,
    );
  });

  it('senza regolamento non disegna un campetto: nessuna riga e nessun modulo', () => {
    const drawn = pitch({ places: [], mine: [man('A', 90)] });
    expect(drawn.module).toBe('');
    expect(drawn.rows).toEqual([]);
    // ...e chi ho comprato non sparisce: resta tutto in lista.
    expect(drawn.bench).toHaveLength(1);
  });

  it('due passate sulla stessa rosa danno lo stesso undici', () => {
    const squad = [man('D', 50), man('D', 50), man('D', 50), man('D', 50), man('D', 50)];
    const one = pitch({ mine: squad });
    const two = pitch({ mine: [...squad].reverse() });
    expect(one.rows.flatMap((row) => row.places.map((place) => place.man?.id))).toEqual(
      two.rows.flatMap((row) => row.places.map((place) => place.man?.id)),
    );
  });
});
