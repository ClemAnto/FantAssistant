/**
 * LE DRITTE DELL'OPERATORE SU CHI GIOCA, e quante giornate valgono le sue parole.
 *
 * Richiesta del 07/09/2026: «cliccando su un calciatore, nella card di dettaglio, fosse possibile
 * cliccare sulla riga "titolarita" e impostare la mia indicazione ... dovrebbe aggiornarsi il campetto
 * nella pagina squadre, il numero di partite attese, il surplus, lo swing e tutti i valori derivati».
 *
 * E' la terza cosa DICHIARATA di questa app, con la stessa forma delle altre due (`board_rulings.json`
 * per il modulo di un club, `player_notes.json` per chi e' fuori rosa): unita per `fc_id`, datata,
 * revocabile con un click, e di PRECEDENZA MASSIMA su quello che il foglio dice della stessa domanda -
 * perche' e' una risposta alla stessa domanda, data da chi sa qualcosa che i dati non sanno.
 *
 * DUE COSE VIVONO IN DUE POSTI, e la differenza e' quella che il progetto ha gia' dichiarato altrove:
 *
 *  - il TOOLKIT ha il suo `config/player_rulings.json` (07/09/2026), che entra nel DISEGNO dell'undici
 *    tipo come VINCOLO e non muove nessun numero - «non gli si sposta il claim: quel numero e' misurato
 *    e deve continuare a leggersi per quello che e'»;
 *  - qui la stessa dichiarazione viene PREZZATA, che e' l'altra meta' della richiesta. Sta nell'app per
 *    la stessa ragione per cui ci sta l'assicurazione infortuni (`expected-play.ts`): non e' una
 *    previsione nuova sul calcio - nessun gate la possiede - e' una quantita' DICHIARATA che riscala
 *    numeri che il foglio ha gia' calcolato.
 *
 * Vive in `localStorage` e non nel bundle, che e' un limite da dire e non da nascondere: e' del BROWSER
 * di chi la scrive, e per farla entrare nei fogli va ridichiarata nel file del toolkit. Le due non si
 * pestano - una dritta del toolkit arriva qui GIA' COTTA dentro `desc_titolarita` e la board, e
 * dichiarare qui la stessa parola non muove il disegno di un pixel (`pitchOf`, e `ruledShare` qui
 * sotto: una conferma non riscrive nessun numero).
 *
 * ==================================================================================================
 * QUANTO VALE UNA PAROLA: la MEDIANA della sua popolazione, sul foglio che si sta leggendo
 * ==================================================================================================
 *
 * Una parola non e' un numero, e i numeri li vuole tutta l'app (le presenze attese, e da quelle il
 * surplus, lo SWING, la banda d'offerta). La conversione non si SCEGLIE: la scala a sei parole la
 * decide il toolkit su due assi (la quota di partite a voto e un pavimento di MINUTI), quindi «quanto
 * gioca un titolare» e' una domanda sulla POPOLAZIONE di quel gradino - la stessa risposta che questo
 * progetto ha dato al prior di chi non ha mai giocato qui: quello che fa la sua popolazione, e se
 * nessuno l'ha misurato si misura.
 *
 * E LA MISURA GREZZA NON RISPETTA L'ORDINE DELLA SCALA, misurato sui tre fogli del pacchetto del
 * 07/09/2026 (Serie A classic 562 righe, euro mantra 944, Serie A mantra 562; le mediane di `default`
 * sono le stesse sui due giochi, che e' giusto - la scala parla di calcio giocato e non del gioco per
 * cui lo compri):
 *
 *     bandiera 0,967 (n=29)  ·  titolarissimo 0,858 (n=17)  ·  titolare 0,949 (n=59)
 *     ballottaggio 0,807 (n=155)  ·  panchina 0,631 (n=119)  ·  riserva 0,243 (n=183)
 *
 * `titolarissimo` sta SOTTO `titolare` sulla quota perche' e' il gradino RESIDUO fra gli altri due
 * (piu' dell'80% delle partite E almeno 75 minuti), mentre `titolare` prende chi gioca quasi sempre con
 * un pavimento di minuti piu' basso. Ma L'ORDINE DELLA SCALA E' UNA DICHIARAZIONE dell'operatore
 * («titolarissimo deve essere meglio di titolare», 08/09/2026), quindi la conversione lo RISPETTA: si
 * muove solo il gradino che lo contraddice, in mezzo ai suoi vicini misurati - l'ordine viene da lui, il
 * livello dal dato, e nessun numero entra fuori dalla banda che la misura disegna. Il conto e il prezzo
 * di questa scelta stanno in `orderedShares`.
 *
 * UNA CONFERMA NON MUOVE NIENTE: se il gradino dichiarato e' quello che il foglio dice gia', la quota
 * resta la SUA e non diventa la mediana del gruppo. Altrimenti un `bandiera` letto 0,99 e dichiarato
 * `bandiera` scenderebbe a 0,967, cioe' una dichiarazione che CONFERMA peggiorerebbe il numero.
 */

import { Injectable, computed, inject, signal } from '@angular/core';

import { Bundle, type PressRungsFile } from './bundle';
import type { Platform } from './players-store';
import { TITOLARITA_LADDER, Titolarita, isTitolarita, normalizeTitolarita } from './titolarita';
import { storedFlag, storedJson } from './view-state';

/** Una dritta come viene salvata: la parola, il giorno, e il perche' se l'ha scritto. */
export interface PlayerRuling {
  rung: Titolarita;
  /** `YYYY-MM-DD`: una dichiarazione senza data non si puo' rileggere fra un mese. */
  decidedOn: string;
  note?: string | null;
  /**
   * CHI L'HA DETTO: l'operatore dalla card, oppure la rilevazione della STAMPA (`config/press_rungs.json`).
   * Assente = operatore, cosi' tutto quello che nasceva prima del 28/09/2026 resta quello che era.
   * Serve a due cose che non possono sbagliare: il pallino «tua indicazione» marca solo le sue, e la
   * card dice di chi e' la parola - una rilevazione di stampa scritta «tua» sarebbe una frase falsa.
   */
  source?: 'operator' | 'press';
  /** La parola della STAMPA, nella sua scala (`comprimario`, `scarto`...): la riga la conserva. */
  pressTier?: string | null;
  /** La quota di partenze da titolare in campionato, quando sano, che la stampa stima. */
  startPct?: number | null;
}

/**
 * LA PAROLA DELLA STAMPA NEL NOSTRO GRADINO. Dal 01/10/2026 la scala e' UNA (operatore: «dobbiamo uniformare
 * i gradini nelle varie formule e nelle varie etichette altrimenti ci confondiamo ... adottiamo quelle
 * utilizzate nella formula della Pa»): la rilevazione scrive le nostre parole, e le due che scriveva prima
 * convergono dove lui ha deciso - `titolarissimo` in `bandiera` («concordo che titolarissimo converga in
 * bandiera»; fino a quel giorno andava in `titolare`, cioe' la parola piu' forte della stampa valeva le giornate
 * del gradino sotto), `comprimario` in `panchina`, che promette la stessa cosa («spesso entra, senza
 * certezze»; `ballottaggio` gli darebbe 27,4 giornate invece di 23,0 senza un posto conteso da nominare).
 *
 * `scarto` resta la parola della stampa sotto `riserva`: finche' il foglio non ha quel gradino si prezza come
 * `riserva`, e la parola originale resta scritta sulla riga cosi' la distinzione non sparisce dallo schermo.
 */
export const PRESS_TO_RUNG: Readonly<Record<string, Titolarita>> = {
  bandiera: 'bandiera',
  titolarissimo: 'bandiera',
  titolare: 'titolare',
  ballottaggio: 'ballottaggio',
  panchina: 'panchina',
  comprimario: 'panchina',
  riserva: 'riserva',
  scarto: 'riserva',
};

/** Il blocco di una stagione del file della stampa, ripulito: una parola sconosciuta si IGNORA. */
export function pressRulings(file: PressRungsFile | null, season: string): Map<number, PlayerRuling> {
  const out = new Map<number, PlayerRuling>();
  const block = file && season ? file[season] : null;
  if (!block || typeof block !== 'object') return out;
  const asOf = typeof block.as_of === 'string' ? block.as_of : '';
  for (const [key, entry] of Object.entries(block.players ?? {})) {
    const rung = entry && typeof entry.tier === 'string' ? PRESS_TO_RUNG[entry.tier] : undefined;
    if (!rung || !Number.isFinite(Number(key))) continue;
    // il giorno in cui la stampa ha letto il SUO club: le rilevazioni sono piu' d'una (EuroLeghe 28/09,
    // Serie A 01/10) e una data sola sul blocco direbbe di meta' dei nomi un giorno che non e' il loro
    const own = typeof entry.as_of === 'string' && /^\d{4}-\d\d-\d\d$/.test(entry.as_of) ? entry.as_of : '';
    out.set(Math.trunc(Number(key)), {
      rung,
      decidedOn: own || asOf,
      source: 'press',
      pressTier: entry.tier ?? null,
      startPct: typeof entry.start_pct === 'number' ? entry.start_pct : null,
    });
  }
  return out;
}

/**
 * COSA FA UNA DRITTA AL DISEGNO, in tre parole - le stesse tre del toolkit
 * (`SnapshotView.PLAYER_RULINGS`), perche' i due lati devono applicare la stessa dichiarazione.
 *
 * La proiezione non e' una scelta: la decide il CANCELLO che la scala a sei parole ha su se stessa
 * (`engine/status.py`) - «chi la board non schiera non puo' essere titolare, chi schiera non scende
 * sotto ballottaggio». Quindi i primi tre gradini PRETENDONO l'undici, gli ultimi due lo escludono, e
 * `ballottaggio` e' l'unica parola compatibile con tutt'e due - il dato lo conferma: 115 dei 155
 * ballottaggi del foglio Serie A sono nell'undici disegnato, 40 no.
 */
export type RulingBoard = 'starter' | 'alternative' | 'reserve';

export const BOARD_EFFECT: Record<Titolarita, RulingBoard> = {
  bandiera: 'starter',
  titolare: 'starter',
  ballottaggio: 'alternative',
  panchina: 'reserve',
  riserva: 'reserve',
};

/** Come si chiama in tre parole quello che una dritta fa al campetto: il selettore lo dice prima. */
export const BOARD_EFFECT_LABEL: Record<RulingBoard, string> = {
  starter: 'entra nell’undici',
  alternative: 'si vede fra i ballottaggi',
  reserve: 'esce dall’undici',
};

/**
 * QUELLO CHE UN GRADINO PROMETTE, e sono DUE numeri perche' la scala vive su due assi.
 *
 * Correzione dell'operatore, 08/09/2026: «per il toolkit l'etichetta viene assegnata non solo per le
 * partite giocate ma anche per i minuti giocati... quindi quando si customizza un calciatore con una
 * etichetta di titolarita' devi impostare sia le partite che i minuti adeguatamente». E' esatto:
 * `engine/status.py` decide la parola su una quota E su un pavimento di MINUTI, e i due si leggono nel
 * dato - le mediane dei minuti sul foglio Serie A sono 80 · 80 · 71 · 61 · 55 · 52, coi pavimenti della
 * scala visibili (i due gradini alti stanno tutt'e due sopra i 75'). Impostarne uno solo lascerebbe una
 * riga che si contraddice: «titolarissimo» accanto a «46 minuti attesi».
 */
export interface RungValues {
  /** La quota di partite a voto (`desc_titolarita_play`). */
  play: number;
  /** I minuti attesi quando gioca (`desc_minutes_next`). Null = quel foglio non li porta per quel gradino. */
  minutes: number | null;
}

/** Cosa promette ogni gradino, su un foglio. Vuota = il foglio non porta la scala. */
export type RungShares = ReadonlyMap<Titolarita, RungValues>;

/** Una riga come questa misura la legge: la parola del foglio e i due numeri che l'hanno decisa. */
export interface RungRow {
  titolarita: string | null;
  titolaritaPlay: number | null;
  minutesNext?: number | null;
}

/** La mediana di una lista non vuota. */
function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * QUANTO GIOCA CHI STA SU QUEL GRADINO, MISURATO sulle righe del foglio: la mediana e nient'altro.
 *
 * Questa e' la misura pura, e va letta cosi': un gradino che quel foglio non popola non entra nella
 * mappa - «vuoto = ignoto, mai zero» applicato a una conversione - e l'ordine NON e' garantito, perche'
 * la scala vive su due assi e su quello delle presenze `titolarissimo` sta sotto `titolare`.
 *
 * Chi PREZZA non legge questa: legge `rungShares`, che e' questa piu' l'ordine dichiarato.
 */
export function rungMedians(rows: Iterable<RungRow>): Map<Titolarita, RungValues> {
  const plays = new Map<Titolarita, number[]>();
  const minutes = new Map<Titolarita, number[]>();
  for (const row of rows) {
    if (!isTitolarita(row.titolarita) || row.titolaritaPlay == null) continue;
    const pool = plays.get(row.titolarita);
    pool ? pool.push(row.titolaritaPlay) : plays.set(row.titolarita, [row.titolaritaPlay]);
    // I MINUTI HANNO IL LORO DENOMINATORE: una riga con la quota e senza i minuti entra nella prima
    // mediana e non nella seconda, invece di tenere fuori tutt'e due o di contarsi come uno zero.
    if (row.minutesNext == null) continue;
    const also = minutes.get(row.titolarita);
    also ? also.push(row.minutesNext) : minutes.set(row.titolarita, [row.minutesNext]);
  }
  const out = new Map<Titolarita, RungValues>();
  for (const rung of TITOLARITA_LADDER) {
    const pool = plays.get(rung);
    if (!pool?.length) continue;
    const also = minutes.get(rung);
    out.set(rung, { play: median(pool), minutes: also?.length ? median(also) : null });
  }
  return out;
}

/**
 * ...E L'ORDINE DELLA SCALA E' UNA DICHIARAZIONE, quindi la conversione lo rispetta.
 *
 * Correzione dell'operatore, 08/09/2026: «titolarissimo deve essere meglio di titolare». La sua scala
 * e' ORDINATA per definizione - l'indice di `TITOLARITA_LADDER` E' la scala - quindi dichiarare un
 * gradino piu' alto non puo' abbassare le presenze attese: sarebbe una dichiarazione che punisce chi
 * la fa, e nessuno la userebbe due volte.
 *
 * LA MISURA GREZZA NON RISPETTA QUELL'ORDINE, e non e' un difetto del dato: la scala vive su DUE assi
 * (la quota di partite a voto e un pavimento di MINUTI), e `titolarissimo` e' il gradino RESIDUO fra
 * `bandiera` e `titolare` - piu' dell'80% delle partite E almeno 75 minuti - mentre `titolare` prende
 * chi gioca quasi sempre con un pavimento piu' basso. Sul foglio Serie A del 07/09/2026: bandiera 0,967
 * (n=29) · titolarissimo **0,858** (17) · titolare **0,949** (59) · ballottaggio 0,807 (155) · panchina
 * 0,631 (119) · riserva 0,243 (183).
 *
 * QUELLO CHE SI FA E' IL MINIMO: si muove SOLO il gradino che contraddice l'ordine, e lo si mette in
 * MEZZO ai suoi vicini, che sono misurati. Cosi' l'ordine viene da lui e il livello dal dato, e non
 * entra nessun numero fuori dalla banda che la misura disegna: `titolarissimo` diventa 0,958, cioe' fra
 * `titolare` (0,949) e `bandiera` (0,967). Un violatore in cima ha per tetto 1 e uno in fondo ha per
 * pavimento 0, perche' li' un vicino non c'e'.
 *
 * IL PREZZO VA DETTO: sull'asse che questa app prezza - le PRESENZE - i due gradini sono davvero quasi
 * identici, e quello che li separa sono i MINUTI, che non entrano in nessuna valutazione. Quindi
 * dichiarare `titolarissimo` invece di `titolare` vale tre decimi di giornata, non una stagione: la
 * differenza c'e' e ha il verso giusto, ma e' piccola perche' e' piccola nel dato.
 */
export function orderedShares(measured: RungShares): Map<Titolarita, RungValues> {
  const out = new Map(measured);
  for (const axis of ['play', 'minutes'] as const) {
    // Sei gradini, quindi al massimo sei passate: si ripete finche' nessuno viola piu' l'ordine, cosi'
    // due violatori di fila (che il dato non ha, ma un altro foglio potrebbe) si sistemano entrambi.
    for (let pass = 0; pass < TITOLARITA_LADDER.length; pass += 1) {
      let moved = false;
      // I gradini che quel foglio popola SU QUEST'ASSE: un gradino assente non e' un vicino, e usarlo
      // come tale vorrebbe dire interpolare fra un numero e un buco.
      const seats = TITOLARITA_LADDER
        .map((rung) => ({ rung, value: out.get(rung)?.[axis] ?? null }))
        .filter((one): one is { rung: Titolarita; value: number } => one.value != null);
      for (let index = 0; index < seats.length - 1; index += 1) {
        const stronger = seats[index];
        const weaker = seats[index + 1];
        // SI RIPARA SOLO UN'INVERSIONE, non un pareggio: due gradini possono promettere lo stesso su un
        // asse e distinguersi sull'altro, ed e' esattamente il caso di `bandiera` e `titolarissimo`, che
        // condividono il pavimento dei 75 minuti e si separano sulla quota. Un pareggio non contraddice
        // un ordine; inventare uno scarto dove il dato non ne ha vorrebbe dire scrivere una misura.
        if (stronger.value >= weaker.value) continue;
        const above = index > 0 ? seats[index - 1].value : null;
        // Il piu' forte sale in MEZZO ai suoi vicini; se sopra non c'e' nessuno si mette almeno PARI a
        // chi gli sta sotto - il minimo che l'ordine richiede, senza un tetto inventato (e i minuti non
        // hanno un tetto naturale come l'1 di una quota).
        const repaired = above == null ? weaker.value : (weaker.value + above) / 2;
        out.set(stronger.rung, { ...out.get(stronger.rung)!, [axis]: repaired });
        moved = true;
      }
      if (!moved) break;
    }
  }
  return out;
}

/**
 * LA CONVERSIONE CHE L'APP PREZZA: la mediana di ogni gradino, con l'ordine della scala rispettato.
 *
 * Una funzione sola per i due passi, cosi' nessun chiamante puo' prezzare con la misura grezza per
 * distrazione - e la misura resta raggiungibile (`rungMedians`) per chi la vuole leggere per quello che
 * e'. Vedi `orderedShares` per il perche' l'ordine e' una dichiarazione e non un dato.
 */
export function rungShares(rows: Iterable<RungRow>): Map<Titolarita, RungValues> {
  const measured = rungMedians(rows);
  const out = new Map<Titolarita, RungValues>();
  for (const rung of TITOLARITA_LADDER) {
    out.set(rung, { play: RUNG_VOTE_SHARE[rung], minutes: measured.get(rung)?.minutes ?? null });
  }
  return orderedShares(out);
}

/**
 * QUANTE GIORNATE A VOTO VALE UNA PAROLA DICHIARATA (stampa o dritta), come quota delle giornate che restano.
 *
 * Operatore, 01/10/2026: «è fondamentale tarare bene le giornate attese dai gradini letti dalla stampa». Fino a
 * quel giorno la parola valeva la MEDIANA DEL FOGLIO (`desc_titolarita_play`), che conta le PRESENZE e solo le
 * partite in cui l'uomo è disponibile: un `titolare` valeva 36 giornate su 38, cioè il caso stabile e senza
 * imprevisti, mentre un titolare vero ne prende in media 29-30. Gli infortuni che verranno, le volte che entra
 * senza prendere il voto, un esonero o gennaio stanno dentro questo numero e non dentro quello.
 *
 * MISURATI (`toolkit/scripts/presence_test/press_calib.py` e `press_calib2.py`): il caso migliore della stampa -
 * chi azzecca il 5 settembre il ruolo che l'allenatore gli dà adesso, cioè il gradino delle sue 10 partite
 * successive - e i VOTI veri sulle giornate che restano, Serie A 2019-26. È un TETTO: una lettura vera a volte
 * sbaglia. La «via di mezzo» è sua: sui due gradini alti il valore che mette più uomini nella banda 80-125%,
 * sotto la mediana, così la scala resta in ordine (31,2 · 29,6 · 27,4 · 23,0 · 6,3 giornate su 38).
 *
 * RIPETUTA SU ALTRI DATI, e regge dove conta: sulle quattro leghe estere di EuroLeghe e sulla Serie A 2015-19 il
 * valore migliore di `bandiera` e `titolare` sta entro una giornata (30,4-31,5 e 29,6-30,4 su 38), e cambiare la
 * finestra di lettura da 10 a 5 o 15 partite non lo sposta. Sui gradini bassi quella ripetizione legge le
 * presenze e non i voti, e lì le due cose divergono (chi entra per pochi minuti spesso resta senza voto), quindi
 * per `ballottaggio`, `panchina` e `riserva` vale la misura sui voti veri. Il portiere `bandiera` legge lo stesso
 * numero del movimento (31,5 contro 31,2), quindi la tabella è una sola.
 */
export const RUNG_VOTE_SHARE: Readonly<Record<Titolarita, number>> = {
  bandiera: 0.82,
  titolare: 0.78,
  ballottaggio: 0.722,
  panchina: 0.605,
  riserva: 0.167,
};

/**
 * LA QUOTA CHE UNA DRITTA IMPONE A UN UOMO, o null se non c'e' niente da imporre.
 *
 * `own` e' la parola che il FOGLIO gli da'. Se e' la stessa della dritta, la dichiarazione conferma e
 * non c'e' niente da riscrivere: torna null, e la riga continua a leggere i suoi numeri misurati.
 */
export function ruledShare(
  ruling: PlayerRuling | null | undefined,
  own: string | null,
  shares: RungShares,
): RungValues | null {
  if (!ruling) return null;
  if (isTitolarita(own) && own === ruling.rung) return null;
  return shares.get(ruling.rung) ?? null;
}

/** Il giorno di oggi in `YYYY-MM-DD`, che e' la data con cui una dichiarazione nasce. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Il file come sta su disco: `{stagione: {fc_id: {...}}}`, la stessa forma del file del toolkit. */
interface RulingsOnDisk {
  [season: string]: Record<string, { rung?: unknown; decided_on?: unknown; note?: unknown }>;
}

/**
 * Quello che c'e' scritto, ripulito: una parola che non e' un gradino si IGNORA invece di essere
 * interpretata.
 *
 * Stessa regola del lettore del toolkit, e per la stessa ragione: quello che sta su disco puo' venire
 * da un'altra versione di questa app, e una dichiarazione che nessuno sa applicare non deve cambiare un
 * undici in silenzio. Si accetta anche `standing`, che e' il nome del campo nel file del toolkit, cosi'
 * un JSON copiato da la' si legge qui senza tradurlo.
 */
export function sanitiseRulings(raw: unknown): RulingsOnDisk {
  const out: RulingsOnDisk = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [season, entries] of Object.entries(raw as Record<string, unknown>)) {
    if (!entries || typeof entries !== 'object') continue;
    const kept: RulingsOnDisk[string] = {};
    for (const [key, entry] of Object.entries(entries as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue;
      const one = entry as { rung?: unknown; standing?: unknown; decided_on?: unknown; note?: unknown };
      // A declaration saved before 01/10/2026 may say `titolarissimo`: it reads as the rung it merged into.
      const declared = normalizeTitolarita(one.rung);
      const standing = normalizeTitolarita(one.standing);
      const rung = isTitolarita(declared)
        ? declared
        : isTitolarita(standing) ? standing : null;
      if (!rung || !Number.isFinite(Number(key))) continue;
      kept[String(Math.trunc(Number(key)))] = {
        rung,
        decided_on: typeof one.decided_on === 'string' ? one.decided_on : today(),
        note: typeof one.note === 'string' ? one.note : null,
      };
    }
    if (Object.keys(kept).length) out[season] = kept;
  }
  return out;
}

@Injectable({ providedIn: 'root' })
export class PlayerRulings {
  private readonly bundle = inject(Bundle);

  /** Il file, per stagione: una rosa e' di una stagione, e una dritta dell'anno scorso non e' su questa. */
  private readonly file = storedJson<RulingsOnDisk>('rulings.players', sanitiseRulings);

  /**
   * La stagione a cui una dritta si riferisce: quella BERSAGLIO del pacchetto, come per le note
   * dichiarate. Vuota finche' il manifest non e' atterrato, e allora non c'e' nessuna dritta - che e'
   * vero, non si sa ancora di quale stagione si stia parlando.
   */
  private readonly season = signal<string>('');

  /** Il file della stampa come e' arrivato col pacchetto: null finche' non arriva, o se non c'e'. */
  private readonly pressFile = signal<PressRungsFile | null>(null);

  /**
   * L'INTERRUTTORE: il gradino della stampa al posto di quello del foglio (operatore, 28/09/2026:
   * «il giudizio della stampa e' superiore a quello dell'engine: reagisce piu' velocemente ai
   * cambiamenti e legge piu' dettagli ... aggiungiamo (ed attiviamo) un'opzione»). ACCESO di default
   * perche' e' lui ad averlo chiesto acceso; una preferenza del browser, come le colonne spente.
   */
  readonly pressOn = storedFlag('rulings.pressSource', true);

  /** Il giorno della rilevazione di stampa di questa stagione (`YYYY-MM-DD`), o '' se non ce n'e'. */
  readonly pressAsOf = computed(() => {
    const block = this.pressFile()?.[this.season()];
    return block && typeof block === 'object' && typeof block.as_of === 'string' ? block.as_of : '';
  });

  /** Le parole della stampa di questa stagione, per `fc_id`, qualunque sia lo stato dell'interruttore. */
  readonly press = computed(() => pressRulings(this.pressFile(), this.season()));

  /**
   * LE RILEVAZIONI, una per giorno, con quanti calciatori ciascuna copre - dalla piu' vecchia. Contate sulle
   * righe e non lette dal campo `source`, cosi' l'opzione dice quello che l'app sta davvero applicando.
   */
  readonly pressSurveys = computed(() => {
    const byDay = new Map<string, number>();
    for (const ruling of this.press().values()) byDay.set(ruling.decidedOn, (byDay.get(ruling.decidedOn) ?? 0) + 1);
    return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([asOf, count]) => ({ asOf, count }));
  });

  /**
   * LE QUOTE PER GRADINO, per piattaforma: le MISURA chi ha in mano le righe di un foglio e le consegna
   * qui con `observe`, perche' una popolazione e' parte della misura e i fogli sono due.
   *
   * Un segnale scritto da fuori e non una lettura di questo servizio, la stessa forma di
   * `PlayerStatus.screens`: qui non si sa quale foglio una piattaforma stia leggendo, e andarselo a
   * prendere vorrebbe dire una seconda risposta a una domanda che quei negozi hanno gia' dato.
   */
  private readonly measured = signal<ReadonlyMap<Platform, RungShares>>(new Map());

  readonly shares = this.measured.asReadonly();

  /**
   * «Su questo listone i gradini valgono queste quote»: si FONDE per piattaforma invece di sostituire.
   *
   * I LETTORI DEL FOGLIO SONO DUE e non uno, ed e' un fatto sulla struttura dell'app: `ValuationStore`
   * legge il foglio di ogni piattaforma per le tabelle, la PLANCIA legge da se' il suo
   * `default|classic` e non passa da quel negozio - trovato da un banco che leggeva un trattino al
   * posto delle giornate su ogni parola del selettore. Una sostituzione secca farebbe sparire le quote
   * di `euro` appena la plancia consegna le sue.
   *
   * Le due misure non possono contraddirsi in modo interessante: la funzione e' la stessa e legge le
   * stesse due colonne, e il gradino lo scrive la STESSA passata che disegna le board - misurato, i
   * due fogli `default` (classic e mantra) danno le stesse sei mediane al millesimo.
   */
  observe(platform: Platform, shares: RungShares): void {
    if (!shares.size) return;
    const before = this.measured().get(platform);
    if (before && before.size === shares.size
        && [...shares].every(([rung, share]) => before.get(rung) === share)) {
      return;                                     // niente di nuovo: non si sveglia nessun lettore
    }
    this.measured.update((all) => new Map(all).set(platform, shares));
  }

  constructor() {
    // Il `catch` non e' cortesia: senza di lui un ambiente senza bundle (un test, un pacchetto non
    // ancora scaricato) lascia una promessa rifiutata in giro, e una rejection non gestita e' il
    // rumore in cui un errore vero non si vede piu'.
    void this.bundle
      .manifest()
      .then((one) => this.season.set(one?.target_season ?? ''))
      .catch(() => this.season.set(''));
    void this.bundle
      .pressRungs()
      .then((file) => this.pressFile.set(file))
      .catch(() => this.pressFile.set(null));
  }

  /**
   * TUTTO QUELLO CHE BATTE IL FOGLIO, per `fc_id`: le TUE dritte, e sotto di loro - se l'interruttore
   * e' acceso - la parola della stampa. E' la mappa che leggono il campetto, le presenze, il surplus, lo
   * SWING e le liste, quindi la stampa arriva ovunque arrivava gia' una dritta, con la stessa aritmetica
   * e nessuna copia.
   *
   * LA PRECEDENZA E' QUESTA E NON L'INVERSA: una dritta tua e' una risposta data guardando anche la
   * stampa, quindi vince lei. Spegnere l'interruttore toglie la stampa e lascia le tue dritte dove sono.
   */
  readonly all = computed<ReadonlyMap<number, PlayerRuling>>(() => {
    const own = this.own();
    if (!this.pressOn()) return own;
    const out = new Map(this.press());
    for (const [id, ruling] of own) out.set(id, ruling);
    return out;
  });

  /** Solo le TUE dritte di questa stagione, per `fc_id`: la stampa non c'e'. */
  readonly own = computed<ReadonlyMap<number, PlayerRuling>>(() => {
    const season = this.season();
    const out = new Map<number, PlayerRuling>();
    if (!season) return out;
    for (const [key, entry] of Object.entries(this.file()[season] ?? {})) {
      const rung = normalizeTitolarita(entry.rung);
      if (!isTitolarita(rung)) continue;
      out.set(Number(key), {
        rung,
        decidedOn: typeof entry.decided_on === 'string' ? entry.decided_on : today(),
        note: typeof entry.note === 'string' ? entry.note : null,
        source: 'operator',
      });
    }
    return out;
  });

  /** La parola che batte il foglio su quest'uomo - tua, o della stampa se l'interruttore e' acceso. */
  of(fcId: number | null | undefined): PlayerRuling | null {
    return fcId == null ? null : this.all().get(fcId) ?? null;
  }

  /** Solo la TUA dritta su quest'uomo: e' quella che il selettore della card mostra scelta e revoca. */
  ownOf(fcId: number | null | undefined): PlayerRuling | null {
    return fcId == null ? null : this.own().get(fcId) ?? null;
  }

  /** Il gradino dichiarato: la parola che ogni schermata mostra AL POSTO di quella del foglio. */
  rungOf(fcId: number | null | undefined): Titolarita | null {
    return this.of(fcId)?.rung ?? null;
  }

  /** Cosa la dritta fa al DISEGNO dell'undici, o null se non ce n'e' una. */
  boardOf(fcId: number | null | undefined): RulingBoard | null {
    const rung = this.rungOf(fcId);
    return rung ? BOARD_EFFECT[rung] : null;
  }

  /** Quello che ogni gradino promette su quella piattaforma: vuoto se il foglio non porta la scala. */
  sharesOf(platform: Platform): RungShares {
    return this.shares().get(platform) ?? new Map<Titolarita, RungValues>();
  }

  /**
   * LE GIORNATE E I MINUTI che una PAROLA comporta su quel calendario: i due numeri che il selettore
   * mostra accanto a ogni gradino, perche' sono i due assi su cui la parola e' stata assegnata.
   */
  promiseOf(
    platform: Platform,
    rung: Titolarita,
    matchdays: number | null,
  ): { rounds: number | null; minutes: number | null } {
    const values = this.sharesOf(platform).get(rung);
    return {
      rounds: values == null || !matchdays ? null : values.play * matchdays,
      minutes: values?.minutes ?? null,
    };
  }

  /**
   * QUELLO CHE LA DRITTA IMPONE a quest'uomo su quel foglio, o null se non c'e' niente da imporre -
   * nessuna dritta, una dritta che conferma il foglio, o un gradino che quel foglio non popola.
   */
  shareFor(platform: Platform, fcId: number | null | undefined, own: string | null): RungValues | null {
    return ruledShare(this.of(fcId), own, this.sharesOf(platform));
  }

  /** Dichiara (o revoca, con `null`) la dritta su quest'uomo. */
  declare(fcId: number, rung: Titolarita | null, note?: string | null): void {
    const season = this.season();
    if (!season) return;
    this.file.update((disk) => {
      const entries = { ...(disk[season] ?? {}) };
      if (rung) entries[String(fcId)] = { rung, decided_on: today(), note: note ?? null };
      else delete entries[String(fcId)];
      const out = { ...disk };
      if (Object.keys(entries).length) out[season] = entries;
      else delete out[season];
      return out;
    });
  }
}
