/**
 * LE PORTE, per ogni pagina che elenca portieri (operatore, 28/09/2026: «"porte" dovrebbe essere nelle
 * opzioni di lega globali», dopo averla chiesta per la pagina d'asta).
 *
 * Con la regola delle porte l'unità non è un uomo ma un CLUB: la porta è del primo che chiama un suo
 * portiere qualsiasi, e vale «un mix dei valori dei portieri che compongono quella rosa proporzionati con
 * le partite che giocheranno». Questo file è l'aritmetica di quella frase e niente altro, pura: la
 * pagina d'asta, la Strategia e la Plancia costruiscono le loro righe in tre modi diversi, e se ognuna
 * fondesse i portieri per conto suo una porta avrebbe tre valutazioni.
 *
 * La valutazione vera e propria è `auction-value.portaValuation` (una `Valuation` come quella di un
 * uomo): qui ci sono lo ZERO delle porte e il modo di sostituire, in una lista qualsiasi, le righe dei
 * portieri di un club con la riga della sua porta.
 */

import { Valuation, portaValuation } from './auction-value';

/** Quello che serve sapere di un portiere per fonderlo nella sua porta. */
export interface KeeperFacts {
  club: string;
  fm: number | null;
  /** Presenze attese, sul calendario su cui la pagina le esprime. */
  pv: number | null;
  confidence: number;
  estimated: boolean;
  /** La quota di sufficienze misurata, se la pagina ce l'ha. Pesata sulle presenze come la fantamedia. */
  steady?: number | null;
}

/** La porta di un club, fusa: la stessa `Valuation` di un uomo, più la costanza pesata. */
export interface PortaMix {
  valuation: Valuation;
  steady: number | null;
}

export function mixPorta(keepers: KeeperFacts[], matchdays: number | null): PortaMix {
  const valuation = portaValuation(
    keepers.map((keeper) => ({
      basis: keeper.estimated ? 'estimated' : 'measured',
      fm: keeper.fm,
      pv: keeper.pv,
      slot: 'por',
      confidence: keeper.confidence,
      note: null,
    })),
    matchdays,
  );
  // La costanza di una porta è quella di chi para, pesata come la fantamedia: un vice che gioca tre
  // partite non sposta la quota di sufficienze di una porta che ne gioca trentacinque col titolare.
  const weighed = keepers.filter((keeper) => keeper.steady != null && keeper.pv != null && keeper.pv > 0);
  const apps = weighed.reduce((sum, keeper) => sum + keeper.pv!, 0);
  const steady = apps > 0 ? weighed.reduce((sum, keeper) => sum + keeper.steady! * keeper.pv!, 0) / apps : null;
  return { valuation, steady };
}

/**
 * LO ZERO DELLE PORTE: la fantamedia della porta marginale, al rango che la lega compra.
 *
 * Quante porte si comprano è `squadre × posti portiere` - ogni posto è una porta, non un uomo - e lo zero
 * è la `domanda`-esima porta per fantamedia. Non può essere `engine_replacement_fm` dei portieri: quello è
 * il marginale di una rosa che tiene tre portieri per squadra, cioè un terzo portiere, e una porta non è
 * mai un terzo portiere. Se le porte sono MENO della domanda (senza la Serie A il listone euro ne ha 27
 * per 36 posti) lo zero è l'ultima: la lega le compra tutte.
 */
export function porteZero(fms: (number | null)[], demand: number): number | null {
  const sorted = fms.filter((fm): fm is number => fm != null).sort((a, b) => b - a);
  if (demand <= 0 || !sorted.length) return null;
  return sorted[Math.min(demand, sorted.length) - 1];
}

/**
 * Sostituisce, in una lista qualsiasi, le righe dei portieri di ogni club con UNA riga: la porta.
 *
 * La riga della porta prende il posto del PRIMO portiere di quel club, così una lista già ordinata resta
 * leggibile anche prima di essere riordinata; `merge` riceve tutti i portieri del club e decide come si
 * scrive la riga, perché ogni pagina ha la sua forma di riga. Un club per cui `merge` risponde `null` non
 * ha riga - «vuoto = ignoto» - e i suoi portieri escono lo stesso: non si comprano come uomini.
 */
export function collapseKeepers<T>(
  rows: T[],
  isKeeper: (row: T) => boolean,
  clubOf: (row: T) => string,
  merge: (keepers: T[]) => T | null,
): T[] {
  const byClub = new Map<string, T[]>();
  for (const row of rows) {
    if (!isKeeper(row)) continue;
    const club = clubOf(row);
    byClub.set(club, [...(byClub.get(club) ?? []), row]);
  }
  const done = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (!isKeeper(row)) {
      out.push(row);
      continue;
    }
    const club = clubOf(row);
    if (done.has(club)) continue;
    done.add(club);
    const porta = merge(byClub.get(club)!);
    if (porta) out.push(porta);
  }
  return out;
}
