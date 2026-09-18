import { Injectable, signal, untracked } from '@angular/core';

import { NextRound, parseNextRound } from './next-round';
import { storedText } from './view-state';

/**
 * L'indirizzo del foglio, come e' stato distribuito il 18/09/2026.
 *
 * E' un VALORE PREDEFINITO e non una costante del codice: Apps Script cambia l'indirizzo a ogni NUOVA
 * distribuzione - e' successo due volte mentre il foglio veniva messo in piedi - quindi l'operatore lo
 * puo' riscrivere dalla pagina senza che nessuno ricompili niente (`next-round-url` in `localStorage`).
 * Quello che non fa e' viaggiare in due posti: il predefinito sta qui, il valore vivo sta li'.
 *
 * E' PUBBLICO, e va detto: la distribuzione e' su «Chiunque», quindi questo indirizzo serve nomi e
 * undici derivati da pagine a pagamento a chiunque lo apra. E' la stessa decisione gia' presa
 * dall'operatore per il pacchetto su gh-pages (CLAUDE.md, «Rebuilding from nothing»), e quella espone
 * molto di piu' di questa: qui c'e' un turno di probabili, li' c'e' il listone intero.
 */
export const NEXT_ROUND_URL =
  'https://script.google.com/macros/s/AKfycbz2zdQx_9o8GLfzEQ3StKQs7_McW7SY2e8o2fnodtHbHTQ7myfB7fVc_dr8VWH7W5vl/exec';

/**
 * I QUATTRO STATI DI UNA LETTURA DALLA RETE, e sono quattro perche' nessuno dei quattro si legge come un
 * altro: `idle` nessuno ha ancora chiesto (la lettura si paga solo se si apre la sezione), `loading` sto
 * chiedendo, `read` il foglio ha risposto, `unreachable` non ha risposto o ha risposto qualcosa che non
 * si capisce. Una board vuota e una rete muta NON devono leggersi uguali: e' «vuoto = ignoto, mai zero»
 * applicato a una risposta HTTP, e senza la distinzione uno schermo senza nomi direbbe «le fonti non
 * schierano nessuno» mentre il vero significato e' «non ho parlato con nessuno».
 */
export type NextRoundState = 'idle' | 'loading' | 'read' | 'unreachable';

/**
 * QUANTE VOLTE SI RICHIEDE PRIMA DI DIRE CHE NON RISPONDE, e non e' prudenza generica: e' MISURATO, e il
 * difetto sta in un pezzo di trasporto che non e' nostro.
 *
 * Apps Script risponde a un `doGet` con un 302 verso `script.googleusercontent.com`, e quel secondo
 * salto porta un gettone monouso che ogni tanto non si risolve: su sei richieste separate del
 * 18/09/2026 il PRIMO salto ha risposto 302 sei volte su sei, e il secondo **404 due volte** (7.974 byte
 * di pagina d'errore, 5-27 secondi). Una richiesta nuova riparte da `script.google.com` e ottiene un
 * gettone nuovo, quindi ritentare non nasconde un guasto: richiede la stessa cosa a un trasporto che
 * fallisce da se'. Quello che NON si fa e' tacerlo - il messaggio dice quanti tentativi sono caduti, o
 * un endpoint rotto davvero si leggerebbe come uno lento.
 */
const TRIES = 3;

/** Quanto si aspetta fra due tentativi. Corto: il gettone e' nuovo subito, non c'e' niente da lasciar passare. */
const PAUSE_MS = 600;

/**
 * IL PROSSIMO TURNO SECONDO LE FONTI, letto dal foglio DAL VIVO.
 *
 * Non passa dal pacchetto, ed e' una decisione dell'operatore («lettura diretta», 18/09/2026) con una
 * ragione misurabile: il pacchetto lo scrive `export` sul suo portatile, mentre le prese avvengono a
 * quindici minuti da ogni calcio d'inizio col portatile magari spento - una board consegnata dal
 * pacchetto sarebbe vecchia di un giorno proprio per le partite per cui esiste. Che l'origine dell'app
 * possa davvero leggere quell'endpoint e' stato MISURATO prima di scrivere questo file
 * (`app/scripts/probe-sheet-endpoint.mjs`: 200, `type: cors`, 39.768 byte e 20 club da gh-pages E da
 * localhost) - una risposta `opaque` sarebbe stata un 200 che la pagina non puo' leggere.
 *
 * Quello che questo servizio NON fa e' interpretare: riduce il JSON con `parseNextRound`, che e' puro e
 * si prova senza rete, e tiene lo stato. Nessun percorso del motore lo rilegge - e' la stampa, che qui
 * e' un GIUDICE e mai un input.
 */
@Injectable({ providedIn: 'root' })
export class NextRoundStore {
  /** L'indirizzo in vigore. Scrivibile dalla pagina: una nuova distribuzione non e' una ricompilazione. */
  readonly url = storedText('next-round-url', NEXT_ROUND_URL);

  /**
   * L'ULTIMA LETTURA RIUSCITA, TENUTA SUL DISCO (operatore, 18/09/2026: «quando leggi da google sheet
   * metti in local storage, l'aggiornamento poi lo possiamo fare con un apposito tastino»).
   *
   * Due cose che valgono piu' della comodita'. La prima: la sezione si apre PIENA e senza rete, il che
   * conta davvero qui, perche' il secondo salto di Apps Script fallisce da se' (§ `TRIES`) e una lettura
   * gia' in mano non dipende da lui. La seconda, che e' il prezzo: una lettura salvata puo' essere di
   * ieri o di un altro turno, quindi il GIORNO in cui e' stata presa viaggia con lei e la pagina lo
   * stampa - una presa vecchia disegnata senza la sua data si leggerebbe come quella di oggi, che e' la
   * bugia piu' cara che questa sezione possa dire.
   *
   * Si tiene il TESTO com'e' arrivato e non l'oggetto ridotto: cosi' una versione futura del lettore
   * rilegge lo stesso payload invece di ereditare la riduzione di quella che l'ha scritto.
   */
  private readonly cache = storedText('next-round-cache', '');

  readonly state = signal<NextRoundState>('idle');
  readonly round = signal<NextRound | null>(null);
  /** Perche' non si e' potuto leggere, con le parole della causa: uno stato senza ragione non si ripara. */
  readonly why = signal('');
  /** Quando ABBIAMO letto - che e' un'altra cosa dal `generated_at` del foglio, e conta per la freschezza. */
  readonly readAt = signal<Date | null>(null);

  /**
   * Quale richiesta e' l'ultima. Una risposta lenta che arriva dopo una piu' recente scriverebbe sopra
   * di lei: il turno che si guarda sarebbe quello di due click fa, e nessuno lo vedrebbe.
   */
  private token = 0;

  constructor() {
    // La lettura salvata si applica SUBITO, prima che qualcuno chieda: chi apre la sezione vede il turno
    // e non uno spinner. Una lettura che non si capisce piu' - scritta da una versione precedente - e'
    // una lettura persa e va bene; una sezione che non si apre no.
    const saved = untracked(this.cache);
    if (!saved) return;
    try {
      const { at, body } = JSON.parse(saved) as { at: string; body: string };
      const round = parseNextRound(JSON.parse(body));
      if (!round) return;
      this.round.set(round);
      this.readAt.set(new Date(at));
      this.state.set('read');
    } catch {
      // Illeggibile: si riparte da `idle`, cioe' dalla rete, che e' esattamente quello che serve.
    }
  }

  /**
   * Chiedi, ma solo se non c'e' gia' niente in mano.
   *
   * Con una lettura salvata questo NON tocca la rete, ed e' la decisione dell'operatore: aggiornare e'
   * un gesto suo (`refresh`), non un effetto dell'aprire una pagina. Senza salvataggio - la prima volta
   * su questo browser - la prima apertura legge, o la sezione sarebbe vuota senza che nessuno l'abbia
   * chiesto.
   */
  load(): void {
    if (untracked(this.state) === 'idle') void this.read();
  }

  /** Chiedi di nuovo, comunque: e' il tasto «rileggi», ed e' l'unico modo di uscire da `unreachable`. */
  refresh(): void {
    void this.read();
  }

  private async read(): Promise<void> {
    const url = untracked(this.url).trim();
    const mine = (this.token += 1);
    if (!url) {
      this.fail(mine, 'nessun indirizzo: incollalo qui sotto');
      return;
    }
    this.state.set('loading');
    let last = '';
    for (let attempt = 1; attempt <= TRIES; attempt += 1) {
      const got = await this.once(url);
      if (mine !== this.token) return;                  // un'altra richiesta l'ha gia' sorpassata
      if (got.round) {
        const now = new Date();
        this.round.set(got.round);
        this.readAt.set(now);
        this.why.set('');
        this.state.set('read');
        // Il testo com'e' arrivato, con il momento in cui e' arrivato: due fatti, e il secondo e' quello
        // che impedisce a una presa di ieri di leggersi come quella di oggi.
        this.cache.set(JSON.stringify({ at: now.toISOString(), body: got.body }));
        return;
      }
      last = got.why;
      if (attempt < TRIES) await new Promise((go) => setTimeout(go, PAUSE_MS));
    }
    this.fail(mine, `${last} · ${TRIES} tentativi`);
  }

  /** Una richiesta sola: o un turno col testo da cui viene, o la ragione per cui non c'e'. */
  private async once(url: string): Promise<{ round: NextRound | null; why: string; body?: string }> {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      const text = await res.text();
      if (!res.ok) return { round: null, why: `il foglio ha risposto ${res.status}` };
      let raw: unknown = null;
      try {
        raw = JSON.parse(text);
      } catch {
        // Apps Script serve le PROPRIE eccezioni come una pagina HTML con stato 200: un 200 che non e'
        // una risposta. Dirlo per esteso, perche' e' lo stato in cui si finisce dopo una distribuzione
        // fatta male, ed e' esattamente quello che e' successo due volte il 18/09.
        return { round: null, why: "ha risposto qualcosa che non e' JSON (di solito: la distribuzione"
          + " non e' pubblica, o serve una versione vecchia dello script)" };
      }
      const round = parseNextRound(raw);
      return round
        ? { round, why: '', body: text }
        : { round: null, why: 'ha risposto un JSON che non ha la forma di un turno' };
    } catch (error) {
      // Rete assente, CORS, DNS: dal punto di vista della pagina sono la stessa cosa - non ho parlato
      // col foglio - e il messaggio del browser e' l'unico dettaglio che c'e'.
      return { round: null, why: error instanceof Error ? error.message : String(error) };
    }
  }

  private fail(mine: number, why: string): void {
    if (mine !== this.token) return;
    this.why.set(why);
    this.state.set('unreachable');
  }
}
