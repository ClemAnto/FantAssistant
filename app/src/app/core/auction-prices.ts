import { Injectable, inject, signal } from '@angular/core';

import { Bundle, BundleTable, columnIndex, optionalIndex } from './bundle';

/**
 * QUELLO CHE UNA STANZA VERA HA PAGATO, per mese.
 *
 * È l'unico prezzo del pacchetto che non sia l'opinione di qualcuno su un calciatore. La Qt.I è
 * l'attesa del mercato prima della stagione, il FVM la stessa opinione rinfrescata a ogni evento
 * saliente: tutt'e due dicono quanto uno *vale*. Questo dice quanto è *costato* — dieci manager, i
 * loro soldi, la loro scadenza — ed è un fatto sulla STANZA e mai sul calciatore. Nessuna
 * valutazione lo legge e nessun ordinamento ci passa: risponde a «quanto ci vorrà», non a «chi
 * segnerà», e il senso di questo progetto è che le due domande hanno risposte diverse.
 *
 * QUANTO LE DUE DIVERGONO È MISURATO, ed è la ragione per cui la colonna esiste (28 aste vere di
 * settembre 2026, `docs/real-data/2026-27/`): il FVM è un prezzo onesto solo per i portieri e per i
 * grandi attaccanti — sopra gli 80 di FVM un attaccante costa **1,09** volte il suo FVM, un
 * centrocampista **0,79** e un difensore **0,80** — e sotto i 50 di FVM la stanza paga **un quarto**
 * di quello che il FVM dice. Su un uomo la differenza vale decine di crediti.
 */
export interface AuctionPrice {
  /** Il prezzo mediano, nella valuta della lega DICHIARATA (vedi `scaleTo`). */
  median: number;
  p25: number;
  p75: number;
  /** Su quante aste vere poggia. Sotto le cinque il toolkit non scrive nemmeno la riga. */
  auctions: number;
  /**
   * IN QUANTE DELLE ASTE DI RIFERIMENTO QUALCUNO L'HA PRESO, su quante.
   *
   * È la metà che nessuna quotazione può portare, e a un tavolo decide un ordine di acquisto prima
   * ancora del prezzo: 15/15 vuol dire che il posto è già deciso e lo prendi ora o non lo prendi,
   * 5/15 che puoi aspettare. Su settembre 2026, 131 uomini su 402 leggono 15/15 — due terzi dei 250
   * posti sono assegnati prima che qualcuno si sieda.
   */
  sold: number | null;
  soldOf: number | null;
  /** Il mese in cui quelle aste sono state GIOCATE, non quello in cui il file è stato letto. */
  month: string;
}

/**
 * La lega su cui ogni prezzo è archiviato, e su cui il FVM stesso è calibrato: è ciò che rende le
 * due colonne confrontabili senza convertire niente. Dev'essere la stessa coppia di
 * `modules/auctions.py`, e il test lo asserisce leggendo il commento dello schema.
 */
export const REF_TEAMS = 10;
export const REF_BUDGET = 1000;

/**
 * Il prezzo alla scala della lega DICHIARATA dall'operatore.
 *
 * Il fattore è la quota del montepremi, cioè l'inverso esatto della normalizzazione con cui il
 * toolkit ha scritto la riga: in una lega da 500 crediti lo stesso uomo costa la metà, e mostrargli
 * il prezzo di una lega da 1000 sarebbe una cifra che nel suo gioco nessuno può pagare. *Una soglia
 * assoluta non si confronta fra budget diversi*, applicato a un prezzo.
 */
export function scaleTo(price: number, teams: number, budget: number): number {
  return (price * teams * budget) / (REF_TEAMS * REF_BUDGET);
}

@Injectable({ providedIn: 'root' })
export class AuctionPricesStore {
  private readonly bundle = inject(Bundle);

  /** (piattaforma|gioco) -> fc_id -> il prezzo del mese PIÙ RECENTE che il pacchetto porta. */
  private readonly byBook = signal<Map<string, Map<number, AuctionPrice>>>(new Map());
  private loading: Promise<void> | null = null;

  /** Il mese che si sta mostrando, per libro: la pastiglia lo NOMINA invece di darlo per scontato. */
  readonly month = signal<Map<string, string>>(new Map());

  /**
   * COM'È ANDATA LA LETTURA, in chiaro: `null` finché nessuno ha chiesto, poi il numero di uomini
   * prezzati, e il MOTIVO se sono zero.
   *
   * Un `catch` muto rende «il pacchetto non porta la tabella» indistinguibile da «la fetch è
   * fallita», che è il difetto per cui questo progetto ha già pagato tre volte (i campetti,
   * `availability`, l'asterisco). Serve a un banco per accusare la cosa giusta, e a me è servito
   * subito: la prima corsa leggeva zero e senza questo campo non c'era modo di sapere perché.
   */
  readonly diagnosis = signal<{ men: number; why: string | null } | null>(null);

  /**
   * Carica la tabella una volta sola.
   *
   * Il fallimento è silenzioso e la mappa resta VUOTA, come per gli indisponibili: un pacchetto
   * vecchio non ha questa tabella, e «nessun prezzo osservato» è anche lo stato normale di un
   * listone che nessuno ha ancora messo all'asta. Quello che non deve succedere è che la pagina si
   * rompa per una colonna che è REPORTING.
   */
  async ensure(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      let table: BundleTable | null = null;
      let failure: string | null = null;
      try {
        table = await this.bundle.table('auction_prices');
      } catch (error) {
        table = null;
        failure = String((error as Error)?.message ?? error);
      }
      if (!table) {
        this.byBook.set(new Map());
        this.diagnosis.set({ men: 0, why: failure ?? 'il pacchetto non porta auction_prices' });
        return;
      }
      const byBook = buildAuctionPrices(table);
      this.byBook.set(byBook);
      this.month.set(latestMonths(table));
      const men = [...byBook.values()].reduce((sum, one) => sum + one.size, 0);
      this.diagnosis.set({
        men,
        why: men ? null : `${table.rows.length} righe lette e nessuna utilizzabile`,
      });
    })();
    return this.loading;
  }

  /** Il prezzo osservato di un uomo su quel listone e quel gioco, o `null` se nessuno l'ha visto. */
  priceOf(fcId: number, platform: string, game: string): AuctionPrice | null {
    return this.byBook().get(`${platform}|${game}`)?.get(fcId) ?? null;
  }

  /** Il mese che quel libro sta mostrando, per scriverlo nel tooltip invece di lasciarlo dedurre. */
  monthOf(platform: string, game: string): string | null {
    return this.month().get(`${platform}|${game}`) ?? null;
  }
}


/** Il mese più recente che il pacchetto porta, per (piattaforma, gioco). */
export function latestMonths(table: BundleTable): Map<string, string> {
  const [platform, game, month] = columnIndex(table, 'platform', 'game', 'month');
  const out = new Map<string, string>();
  for (const row of table.rows) {
    const book = `${String(row[platform])}|${String(row[game])}`;
    const value = String(row[month] ?? '');
    const seen = out.get(book);
    if (value && (!seen || value > seen)) out.set(book, value);
  }
  return out;
}

/**
 * La tabella -> (piattaforma|gioco) -> fc_id -> prezzo, tenendo SOLO IL MESE PIÙ RECENTE.
 *
 * Il mese e non una media dei mesi, perché un prezzo di mercato invecchia: agosto e settembre sullo
 * stesso uomo sono due fatti diversi - il secondo ha visto due giornate di campionato - e mediarli
 * darebbe un numero che non descrive nessuna delle due stanze. Quello che serve al tavolo è cosa
 * costa ADESSO, e il mese viaggia sulla riga perché la pastiglia possa dirlo.
 */
export function buildAuctionPrices(table: BundleTable): Map<string, Map<number, AuctionPrice>> {
  const [id, platform, game, month, auctions] =
    columnIndex(table, 'fc_id', 'platform', 'game', 'month', 'auctions');
  const med = columnIndex(table, 'price_med')[0];
  const p25 = optionalIndex(table, 'price_p25');
  const p75 = optionalIndex(table, 'price_p75');
  const sold = optionalIndex(table, 'sold');
  const soldOf = optionalIndex(table, 'sold_of');
  const latest = latestMonths(table);
  const out = new Map<string, Map<number, AuctionPrice>>();
  for (const row of table.rows) {
    const book = `${String(row[platform])}|${String(row[game])}`;
    const on = String(row[month] ?? '');
    // `Number(null)` è ZERO e zero è finito, quindi il controllo non può passare da lì: una riga
    // senza prezzo entrerebbe come «costa niente», che è «vuoto = ignoto, mai zero» rotto sul valore
    // che la pastiglia stampa. Trovato dal test che lo asseriva.
    const raw = row[med];
    const price = raw == null || raw === '' ? NaN : Number(raw);
    const key = Number(row[id]);
    if (!key || on !== latest.get(book) || !Number.isFinite(price)) continue;
    let map = out.get(book);
    if (!map) out.set(book, (map = new Map()));
    map.set(key, {
      median: price,
      p25: side(row[p25], p25, price),
      p75: side(row[p75], p75, price),
      auctions: Number(row[auctions]) || 0,
      sold: sold < 0 ? null : Number(row[sold]),
      soldOf: soldOf < 0 ? null : Number(row[soldOf]),
      month: on,
    });
  }
  return out;
}


/** Un estremo della banda, o la mediana se il pacchetto non lo porta: mai uno zero inventato. */
function side(raw: unknown, index: number, fallback: number): number {
  if (index < 0 || raw == null || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}
