import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { Bundle, BundleTable, columnIndex } from './bundle';
import { TimeTravel } from './time-travel';

/**
 * IL VALORE DI MERCATO E LA SUA TENDENZA: quanto vale oggi, e se il mercato sta salendo o scendendo su di lui.
 *
 * Perché sta accanto all'FVM e non dentro una valutazione. L'FVM è il prezzo che il listone chiede, cioè
 * l'opinione di qualcuno; questo è il prezzo che il MERCATO VERO gli ha dato, con la data di ogni variazione
 * (`market_value_history`, la curva Transfermarkt). Sono due giudizi sulla stessa persona da due tavoli
 * diversi, e la differenza fra i due è la sola cosa che un'asta può usare. Quello che NON è: un canale del
 * motore. Il gate ha misurato l'unica ipotesi per cui la curva era stata acquisita - il canale
 * dell'investimento con l'input riparato - e l'ha respinta su tutt'e due le piattaforme (§7-untricies,
 * media +0,04% su euro e +0,26% su Serie A, sotto il pavimento dello 0,5%). Quindi qui si LEGGE e non si
 * prevede: nessuna valutazione, nessuna classifica, nessun gate.
 *
 * PERCHÉ IL MARCHIO È UNA DIREZIONE E MAI UNA GRADUATORIA. Una variazione in percentuale dipende dalla
 * BASE, e su questo listone la dipendenza è enorme: misurata il 17/08/2026 sui 1.092 quotati 2026-27 con
 * un anno di curva alle spalle, il quartile più povero (sotto 3,5 M) ha mediana +50% e nono decile
 * +1.614%, il più ricco (sopra 28 M) mediana −9% e nono decile +43%. Ordinare per percentuale metterebbe
 * in cima i ragazzi che passano da 200 mila a 3 milioni - vero, e non è la domanda di un'asta. È la stessa
 * lezione dei portieri: un numero deve dire di quale POOL è un fatto. Quindi la cella porta il valore in
 * euro (che rende visibile la base) più una freccia a tre stati, e il tooltip porta la percentuale con le
 * due date; nessuna colonna si ordina per la tendenza.
 *
 * DUE DATE E NESSUNA DELLE DUE SI PRESUME, come per i marchi degli infortuni: la curva si taglia al giorno
 * in cui l'app crede di trovarsi (`TimeTravel`), e il tooltip dice quando la fonte ha mosso il valore
 * l'ultima volta - misurato, la mediana è 77 giorni fa e il massimo 95, perché Transfermarkt aggiorna a
 * ondate. Un valore di due mesi fa non è vecchio: è l'ultimo che esiste.
 */

/**
 * Su quanti mesi si guarda la tendenza. Dodici: è una STAGIONE, quindi confronta un uomo con sé stesso in
 * un momento comparabile del calendario, ed è abbastanza lunga da contenere più di un'ondata della fonte
 * (mediana 3 punti in dodici mesi sui quotati 2026-27).
 */
export const TREND_MONTHS = 12;

/**
 * Oltre quale variazione relativa la tendenza si chiama salita o discesa.
 *
 * SCELTA DI VISUALIZZAZIONE e dichiarata qui in una riga sola, come le due soglie degli infortuni: non
 * entra in nessuna valutazione e nessun gate la possiede. Il ±15% produce, sui 1.092 quotati con un anno
 * di curva, 38,6% in salita · 24,1% ferma · 37,7% in discesa (misurato il 17/08/2026): tre gruppi che
 * qualcuno guarderebbe, invece di una freccia che ce l'hanno tutti.
 */
export const TREND_BAND = 0.15;

export type TrendDirection = 'up' | 'flat' | 'down';

/** Un punto della curva: quando la fonte ha mosso il valore, e a quanto. */
export interface MarketPoint {
  on: string;
  value: number;
}

/**
 * La lettura di un uomo a una data.
 *
 * `from` è nullo quando la curva non arriva a un anno prima: allora il valore c'è e la TENDENZA è ignota -
 * mai «ferma», che sarebbe inventare una notizia dal silenzio.
 */
export interface MarketTrend {
  /** L'ultimo punto alla data: quanto vale, per la fonte, il giorno che si sta guardando. */
  value: number;
  /** Il giorno in cui la fonte ha scritto quel valore. */
  at: string;
  /** Il punto di dodici mesi prima, se la curva arriva fino là. */
  from: MarketPoint | null;
  /** La variazione relativa fra i due, se ci sono entrambi. */
  change: number | null;
  direction: TrendDirection | null;
}

const DAY_MS = 86_400_000;

/** La stessa data, dodici mesi prima. Il 29 febbraio scivola al 28, che è quello che fa `Date` da sé. */
export function yearBefore(date: string, months = TREND_MONTHS): string {
  const when = new Date(`${date}T00:00:00Z`);
  when.setUTCMonth(when.getUTCMonth() - months);
  return when.toISOString().slice(0, 10);
}

/** Da quanti giorni la fonte non muove il suo valore. */
export function daysSince(on: string, today: string): number {
  return Math.round(
    (new Date(`${today}T00:00:00Z`).getTime() - new Date(`${on}T00:00:00Z`).getTime()) / DAY_MS,
  );
}

/**
 * La curva di ogni giocatore, in ordine di data, dal bundle.
 *
 * Un valore nullo si scarta e non diventa zero: la fonte, per un uomo appena arrivato o appena ritirato,
 * pubblica un punto senza cifra, e leggerlo come «non vale niente» è il difetto che questo repo paga da
 * sempre. `cutoff` serve al viaggio nel tempo: un punto scritto dopo quel giorno quel giorno non c'era.
 */
export function buildCurves(table: BundleTable, cutoff?: string): Map<number, MarketPoint[]> {
  const [idAt, onAt, valueAt] = columnIndex(table, 'fc_id', 'observed_on', 'value');
  const out = new Map<number, MarketPoint[]>();
  for (const row of table.rows) {
    const value = row[valueAt] as number | null;
    const on = row[onAt] as string | null;
    if (value == null || !on) continue;
    if (cutoff && on > cutoff) continue;
    const id = row[idAt] as number;
    const points = out.get(id);
    if (points) points.push({ on, value });
    else out.set(id, [{ on, value }]);
  }
  for (const points of out.values()) points.sort((left, right) => left.on.localeCompare(right.on));
  return out;
}

/**
 * La lettura di una curva a una data: l'ultimo punto, quello di un anno prima, e la direzione.
 *
 * Il punto di partenza è l'ULTIMO PUNTO PRIMA della data di un anno fa e non il primo dopo: il valore di
 * allora è quello che valeva quel giorno, e un punto successivo racconterebbe una variazione già avvenuta.
 */
export function trendOf(
  points: readonly MarketPoint[] | undefined,
  today: string,
  band = TREND_BAND,
): MarketTrend | null {
  if (!points?.length) return null;
  const upTo = points.filter((point) => point.on <= today);
  const last = upTo[upTo.length - 1];
  if (!last) return null;
  const boundary = yearBefore(today);
  const before = upTo.filter((point) => point.on <= boundary);
  const from = before[before.length - 1] ?? null;
  // Un punto di partenza a zero non produce una percentuale: una divisione per zero è un infinito, e un
  // infinito disegnato come «+∞%» sarebbe una notizia dove non c'è nemmeno un rapporto.
  const change = from && from.value > 0 && from !== last ? (last.value - from.value) / from.value : null;
  return {
    value: last.value,
    at: last.on,
    from,
    change,
    direction: change == null ? null : change >= band ? 'up' : change <= -band ? 'down' : 'flat',
  };
}

/** «12,5 M» · «800 mila» - la scala della fonte, in italiano, senza cifre che nessuno legge. */
export function euros(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions.toFixed(millions < 10 ? 1 : 0).replace('.', ',')} M`;
  }
  return `${Math.round(value / 1000)} mila`;
}

/**
 * Legge la curva del valore dal bundle e la ritaglia alla data dell'app.
 *
 * Un bundle più vecchio non porta la tabella: allora `loaded` resta falso e la colonna non si vede, che è
 * diverso da una colonna vuota - «non c'è il dato» e «il mercato non lo muove» non sono la stessa frase.
 */
@Injectable({ providedIn: 'root' })
export class MarketValues {
  private readonly bundle = inject(Bundle);
  private readonly travel = inject(TimeTravel);

  private readonly curves = signal<Map<number, MarketPoint[]>>(new Map());
  readonly loaded = signal(false);

  /** Il giorno in cui il bundle è stato scritto: la fonte non può essere più fresca di così. */
  readonly readAt = signal<string | null>(null);

  private loading = false;

  constructor() {
    void this.ensure();
    // La curva si RITAGLIA alla data, quindi al cambio di data va riletta e non solo ri-giudicata.
    effect(() => {
      this.travel.today();
      if (this.loaded()) void this.reread();
    });
  }

  private async ensure(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.readAt.set((await this.bundle.manifest().catch(() => null))?.generated_at ?? null);
    try {
      this.curves.set(buildCurves(await this.bundle.table('market_value_history')));
      this.loaded.set(true);
    } catch {
      // Un bundle scritto prima che la curva viaggiasse: nessuna colonna, e `loaded` resta falso perché
      // il silenzio non deve leggersi come «nessuno si muove».
    }
  }

  private async reread(): Promise<void> {
    const cutoff = this.travel.travelling() ? this.travel.today() : undefined;
    this.curves.set(buildCurves(await this.bundle.table('market_value_history'), cutoff));
  }

  /** Quanti uomini hanno una curva: un audit che dicesse «0 problemi» su una tabella vuota non è un audit. */
  readonly covered = computed(() => this.curves().size);

  /** La lettura di un uomo alla data dell'app, o null se la fonte non lo conosce. */
  trend(playerId: number | null | undefined): MarketTrend | null {
    if (playerId == null) return null;
    return trendOf(this.curves().get(playerId), this.travel.today());
  }
}
