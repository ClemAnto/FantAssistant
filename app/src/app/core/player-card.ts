/**
 * LA CARD DI UN CALCIATORE: cosa serve per disegnarla, e chi e' aperto.
 *
 * Nata sulla PLANCIA (04/09/2026) e resa comune il 05/09/2026, quando l'operatore ha chiesto la stessa
 * card sulla Strategia: «se draggo un calciatore ordino, se invece clicco solo si apre la card con il
 * dettaglio del calciatore (la stessa della plancia)». Due card sarebbero due letture degli stessi
 * `engine_*`, cioe' due valutazioni per un uomo - il difetto che questo repository ha gia' pagato.
 *
 * IL MODELLO E' UN VALORE E NON UNA RIGA DI UNA PAGINA. La plancia lo costruisce dal suo `BoardMan`, la
 * Strategia dal suo `StrategyBidder` piu' le colonne del foglio che sta leggendo - e sono FOGLI DIVERSI:
 * la plancia prezza sempre `default|classic`, la Strategia il foglio della combinazione dichiarata
 * (euro|mantra, default|mantra, default|classic). Una card che leggesse i numeri della plancia dentro
 * una lista mantra direbbe di un uomo il surplus di un altro gioco. Quindi la card riceve i numeri; non
 * va a prenderseli.
 *
 * QUELLO CHE LA CARD SI PRENDE DA SE' sono i fatti che NON dipendono dal foglio: i marchi
 * (`PlayerStatus`), la nota dichiarata, e le ultime partite (`PlayersStore`), che sono un fatto sul
 * calcio giocato e non sul gioco per cui lo compri.
 */

import { computed, signal } from '@angular/core';

import { OutWindow } from './injury-window';
import { Platform } from './players-store';

/**
 * LA META' D'ASTA di una card: esiste sulla plancia e NON sulla Strategia.
 *
 * Non e' una semplificazione: la max offerta, il prezzo pagato e il padrone sono fatti su un TAVOLO, e
 * la Strategia e' quello che si prepara prima di sedersi - non ce n'e' uno. Disegnarli li' vorrebbe dire
 * mostrare i numeri di un tavolo inventato accanto a una lista che non lo riguarda.
 */
export interface CardMarket {
  /** `max offerta` finche' e' nell'urna, `pagato` quando e' di qualcuno: due significati, e la riga
   *  dice quale dei due e'. */
  label: string;
  band: { low: number; high: number } | null;
  price: number | null;
  ownerLabel: string | null;
  ownerColour: string | null;
  /** Perche' il tetto e' quello, quando non e' il suo slot a deciderlo. Vuoto = lo decide lo slot. */
  capNote: string | null;
  /** Se e' ancora comprabile: decide se il bottone «e' il lotto in asta» ha senso. */
  inUrn: boolean;
  /** Se e' un portiere, e quindi se gli abbinamenti hanno senso. */
  keeper: boolean;
}

/** Un uomo come la card lo disegna: identita', i numeri del FOGLIO di chi la apre, e nient'altro. */
export interface CardMan {
  id: number;
  name: string;
  club: string;
  /** Il club come identita', per lo stemma: il nome non e' una chiave. */
  clubId: number | null;
  /** Dove lo mette la pagina che apre la card: `A1` sulla plancia, `Dc` sulla Strategia. */
  where: string;
  /** Quale listone prezza questi numeri: decide anche di quali partite si parla. */
  platform: Platform;
  /** Quanto rende una sua partita sopra il sei, e quante ne gioca sul calendario del foglio. */
  edge: number | null;
  pv: number | null;
  rounds: number | null;
  /** La fantamedia attesa, gia' scelta fra misurata e stimata da chi costruisce la riga. */
  fm: number | null;
  /** Se quel numero sta in piedi sul ripiego dichiarato: il `~`. */
  estimated: boolean;
  estNote: string | null;
  titolarita: string | null;
  minutesNext: number | null;
  seasonMatches: number | null;
  minutesFullSeason: number | null;
  unpricedReason: string | null;
  fvm: number | null;
  /** La finestra di uno stop aperto: il conto delle giornate che perde, non un giudizio. */
  out: OutWindow | null;
  market: CardMarket | null;
}

/**
 * CHI E' APERTO E DOVE STA, una definizione per tutte le pagine che aprono card.
 *
 * Una CLASSE SEMPLICE e non un servizio: due pagine ne vogliono una ciascuna - le card della plancia
 * non devono seguirti sulla Strategia - ma la regola del POSTO deve essere una sola, o due pagine
 * disporrebbero le stesse card in due modi. Quindi `new CardStack()` due volte, e un solo posto in cui
 * quel numero e' deciso.
 *
 * IL POSTO E' ASSEGNATO ALLA NASCITA E NON E' L'INDICE NELL'ELENCO (richiesta dell'operatore, 04/09:
 * «quando chiudo una card le altre non si devono spostare»): con l'indice, chiudere la prima faceva
 * scalare tutte le altre, e una card che si sposta da se' mentre la guardi rompe il confronto per cui e'
 * aperta. Ognuna prende il POSTO LIBERO piu' basso e lo tiene finche' e' aperta.
 *
 * ...e CHI STA DAVANTI e' un'altra domanda: l'elenco tiene l'ordine di APERTURA e non si riordina mai,
 * questo tiene l'ultima TOCCATA. Leggerle dallo stesso numero fa saltare le card di posto ogni volta che
 * ne porti una avanti.
 */
export class CardStack {
  private readonly open = signal<{ id: number; slot: number }[]>([]);
  private readonly frontId = signal<number | null>(null);

  readonly ids = computed(() => this.open());
  readonly front = computed(() => this.frontId());
  readonly count = computed(() => this.open().length);

  /** Apre una card, o le chiude tutte con `null`. Ri-cliccare un uomo aperto lo porta davanti. */
  openCard(id: number | null): void {
    if (id == null) {
      this.open.set([]);
      this.frontId.set(null);
      return;
    }
    this.open.update((cards) => {
      if (cards.some((one) => one.id === id)) return cards;
      const taken = new Set(cards.map((one) => one.slot));
      let slot = 0;
      while (taken.has(slot)) slot += 1;
      return [...cards, { id, slot }];
    });
    this.frontId.set(id);
  }

  /** Toccata: davanti alle altre. Un click o un trascinamento, che per questo sono la stessa cosa. */
  raiseCard(id: number): void {
    this.frontId.set(id);
  }

  closeCard(id: number): void {
    this.open.update((cards) => cards.filter((one) => one.id !== id));
    if (this.frontId() === id) this.frontId.set(null);
  }

  /**
   * Le card aperte con addosso la riga VIVA, nell'ordine di apertura.
   *
   * Tiene gli ID e non gli uomini per la ragione di sempre: la riga si ricostruisce a ogni
   * aggiudicazione e a ogni cambio di foglio, e una card che tenesse la COPIA continuerebbe a mostrare
   * i numeri di dieci minuti prima. Chi non e' piu' in mappa esce da se'.
   */
  place<T>(byId: (id: number) => T | undefined): { man: T; slot: number }[] {
    const out: { man: T; slot: number }[] = [];
    for (const one of this.open()) {
      const man = byId(one.id);
      if (man !== undefined) out.push({ man, slot: one.slot });
    }
    return out;
  }
}

/**
 * DOVE NASCE UNA CARD: AFFIANCATE, non a cascata.
 *
 * Le card servono a CONFRONTARE (sua richiesta), e due card sfalsate di 28px si coprono per il 90%.
 * Quindi quattro per riga a 300px di passo (288 di card piu' 12 di aria), poi si scende di 44px e si
 * ricomincia. Dal bordo SINISTRO e non dal centro, cosi' la posizione non dipende dalla larghezza della
 * finestra; il posto vero glielo da' poi lui trascinandola.
 */
export function cardLeft(slot: number): number {
  return 16 + (slot % 4) * 300;
}

export function cardTop(slot: number): number {
  return 96 + (Math.floor(slot / 4) % 3) * 44;
}

/** Quante partite mostra la card chiusa: la richiesta dell'operatore del 05/09/2026, non una misura. */
export const RECENT_MATCHES = 5;

/** ...e quante STAGIONI mostra aperta: questa e la precedente, sempre su sua richiesta. */
export const RECENT_SEASONS = 2;
