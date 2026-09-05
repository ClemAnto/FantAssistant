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
import { MatchCell, Platform, RecentMatch, clubNameKey, isChampionship } from './players-store';

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


/**
 * UNA RIGA DELL'ELENCO con i DIVISORI che le vanno sopra: la stagione, e il cambio di squadra.
 *
 * Richiesta dell'operatore (05/09/2026): «metti un divisore (simile a quello con l'anno della stagione)
 * per indicare il cambio di squadra». Sono due annunci diversi e possono cadere sulla stessa riga - chi
 * si trasferisce lo fa quasi sempre fra due stagioni - quindi sono due campi e non uno: un divisore solo
 * costringerebbe a scegliere quale delle due cose dire, e sono tutt'e due vere.
 *
 * UNA FUNZIONE PURA e non un conto nel template, per la ragione di sempre: e' una regola su una lista,
 * e nel template sarebbe raggiungibile solo da un browser.
 */
export interface CardRow {
  match: RecentMatch;
  /** La stagione da annunciare sopra questa riga, o null. */
  season: string | null;
  /** La squadra da annunciare sopra questa riga, o null. */
  club: string | null;
}

/**
 * L'elenco con i suoi divisori, nell'ordine in cui si legge (dalla piu' recente).
 *
 * IL CLUB SI CONFRONTA SULLA CHIAVE NORMALIZZATA, o `Tottenham Hotspur` e `Tottenham` sarebbero due
 * squadre e il divisore comparirebbe fra due partite dello stesso club - le due grafie convivono perche'
 * le righe arrivano da due fonti (i VOTI scrivono la grafia del listone, il layer per-partita quella
 * del provider).
 *
 * E UNA RIGA SENZA SQUADRA NON E' UN CAMBIO DI SQUADRA: una giornata saltata non porta nessun club, e
 * leggerla come un trasferimento stamperebbe due divisori attorno a ogni infortunio. Si tiene l'ultimo
 * club NOMINATO e si va avanti - «vuoto = ignoto», applicato a un divisore.
 */
export function cardRows(matches: readonly RecentMatch[], currentClub: string): CardRow[] {
  const out: CardRow[] = [];
  let season: string | null = null;
  // SI PARTE DAL CLUB DI OGGI, e non da «niente»: cosi' la prima riga si annuncia da se' se gia' non
  // e' la sua squadra attuale. Serve per un caso intero e non per un dettaglio - Beto ha
  // quarantasei righe e TUTTE dell'Everton, quindi di «cambio» dentro l'elenco non ce n'e' nessuno e
  // senza questo la card evidenziava quarantasei righe senza mai dire di quale squadra fossero.
  let club: string | null = clubNameKey(currentClub) || null;
  for (const match of matches) {
    const newSeason = season != null && match.season !== season ? match.season : null;
    const key = clubNameKey(match.cell.team);
    const newClub = key && club != null && key !== club ? match.cell.team : null;
    out.push({ match, season: newSeason, club: newClub });
    season = match.season;
    if (key) club = key;
  }
  return out;
}


/**
 * COSA HA FATTO IN UNA STAGIONE, nelle stesse quattro colonne delle sue partite.
 *
 * Richiesta dell'operatore (05/09/2026): «sotto la riga della stagione, aggiungi incolonnate
 * correttamente minuti medi a partita | mv | gol fatti e assist fatti | fm a partita». Le quattro
 * quantita' cadono ESATTAMENTE sulle quattro colonne che una riga di partita ha gia' - minuti, voto,
 * bonus, fantavoto - quindi il riepilogo non e' una tabella nuova: e' la stessa griglia, letta per
 * stagione invece che per partita, e nella prima colonna ci va il DENOMINATORE.
 *
 * LA POPOLAZIONE E' IL CAMPIONATO, suo o di un altro paese, e non tutto quello che l'elenco disegna.
 * Coppe e amichevoli restano fuori, e non e' una comodita': sono esattamente le righe che la card
 * mostra al 50% di opacita' perche' non entrano nel fantavoto, non hanno un voto - una coppa non e' una
 * competizione calibrata, tutto quello che ha e' il rating del provider, che sta su un'altra scala - e
 * mettere i loro gol in un totale accanto a una media di voti che li ignora darebbe quattro numeri che
 * non parlano degli stessi novanta minuti.
 *
 * OGNI MEDIA HA IL SUO DENOMINATORE e non si prende quello del vicino: i minuti si dividono per le
 * partite di cui si conoscono i minuti, il voto per quelle che hanno un voto, il fantavoto per quelle
 * che hanno un fantavoto. Sono tre numeri diversi - una giornata senza pagella ha i minuti e non il
 * voto - e usarne uno solo e' la famiglia di difetti che questo progetto paga da sempre. Il conto in
 * prima colonna e' quello delle partite GIOCATE, che e' la domanda che uno si fa guardando la riga.
 */
export interface SeasonTotals {
  /** Quante partite di campionato ha giocato: il denominatore che si legge. */
  played: number;
  /** Minuti medi per partita giocata, e null se di nessuna si sanno i minuti. */
  minutes: number | null;
  mv: number | null;
  fm: number | null;
  goals: number;
  assists: number;
  /** Se le medie poggiano su un voto SINTETICO: allora sono sintetiche anche loro, e portano il `~`. */
  synthetic: boolean;
}

export function seasonTotals(cells: readonly MatchCell[]): SeasonTotals | null {
  const own = cells.filter((one) => isChampionship(one.kind));
  const played = own.filter((one) => one.state === 'played' || one.state === 'no_vote');
  if (!played.length) return null;

  const mean = (values: number[]) =>
    values.length ? values.reduce((sum, one) => sum + one, 0) / values.length : null;
  const minutes = mean(played.map((one) => one.minutes).filter((one): one is number => one != null));
  const votes = played.filter((one) => one.vote != null);
  const fantavoti = played.filter((one) => one.fantavoto != null);

  return {
    played: played.length,
    minutes: minutes == null ? null : Math.round(minutes),
    mv: mean(votes.map((one) => one.vote as number)),
    fm: mean(fantavoti.map((one) => one.fantavoto as number)),
    // I RIGORI SEGNATI SONO GOL, e gli assist da fermo sono assist: la riga di una partita li tiene
    // separati perche' valgono punti diversi, ma «gol fatti» e' una domanda sul calcio e non sul
    // punteggio - e un rigorista che ne segna dieci non ha fatto zero gol.
    goals: played.reduce((sum, one) => sum + one.goals + one.penScored, 0),
    assists: played.reduce((sum, one) => sum + one.assists + one.assistsSetPiece, 0),
    synthetic: [...votes, ...fantavoti].some((one) => one.voteSynthetic),
  };
}
