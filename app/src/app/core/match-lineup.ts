/**
 * LA FORMAZIONE CHE HA GIOCATO UNA PARTITA - un FATTO, non una previsione.
 *
 * Perche' sta nell'app e non nel toolkit: la regola di casa («l'undici di un club vero lo disegna il
 * toolkit e l'app lo legge») vincola la board DISEGNATA, che e' una previsione su una persona e quindi
 * una misura da giudicare. Qui non si prevede niente - chi e' sceso in campo il 5 settembre e' scritto
 * nel layer per-partita che il pacchetto gia' porta, per intero - e farlo esportare di nuovo dal toolkit
 * sarebbe una seconda copia di un fatto solo, che e' la ragione per cui le coppe non viaggiano nel
 * bundle.
 *
 * LE TRE META' VENGONO DA TRE POSTI, e non e' un dettaglio.
 *  - Il MODULO e' un conteggio di CLUB (`club_match_lineups`, scritto su tutte le voci della distinta,
 *    risolte o no, proprio perche' contare quanti difensori schiera un club non ha bisogno
 *    dell'identita' dei suoi uomini): e' COMPLETO.
 *  - I NOMI passano dall'imbuto delle identita' e dal perimetro del listone: possono mancare.
 *  - Il POSTO DENTRO LA LINEA e' `external_match_stats.lineup_slot`, l'indice della voce nella distinta
 *    della fonte - l'ordine con cui la fonte stessa disegna il suo campetto.
 *
 * Quanto costa la seconda meta', misurato sul pacchetto del 12/09/2026 (stagioni 2025-26 e 2026-27, i
 * soli club che questo pacchetto copre davvero): Serie A nomina **11 uomini su 11 nel 99,4%** delle
 * partite-club e almeno 10 nel 100%; sugli altri quattro campionati - dove il listone EuroLeghe quota
 * una parte della rosa di un club estero - si scende al 65-67% e al 49% in Ligue 1. Per questo un posto
 * che non si riesce a nominare resta VUOTO e si conta, invece di far sparire il posto: un undici di
 * nove uomini disegnato come un undici direbbe che il club ha giocato in nove.
 *
 * E le LINEE vengono dalla posizione che il provider da' a quell'uomo IN QUELLA PARTITA (G/D/M/F), che
 * e' la stessa colonna da cui i conteggi di club sono ricavati: sulle 820 partite-club di Serie A le due
 * letture danno le stesse quattro linee **815 volte**, e le cinque che discordano sono quelle in cui un
 * nome manca. Mai il ruolo di listone (`P`/`D`/`C`/`A`), che dice il mestiere per cui lo compri e non
 * dove ha giocato quel giorno.
 */

import { DRAW_ORDER, PitchLine, lineCounts } from './club-eleven';

/** La posizione che il provider scrive per quella partita. Sono quattro, e non ce n'e' una quinta. */
export type MatchPosition = 'G' | 'D' | 'M' | 'F';

/**
 * DOVE VA DISEGNATO CHI HA GIOCATO LI'. Quattro posizioni e quattro righe: la trequarti (`T`) resta
 * vuota per costruzione, perche' la fonte del modulo ha tre linee e non sa dire un 4-2-3-1 - lo dice
 * lo schema di `club_match_lineups` di se'. Inventare una riga che il dato non distingue sarebbe
 * disegnare un modulo che nessuno ha osservato.
 */
const LINE_OF: Record<MatchPosition, PitchLine> = { G: 'P', D: 'D', M: 'M', F: 'A' };

/** Un uomo come il layer per-partita lo registra per QUELLA partita, e niente altro. */
export interface LineupMan {
  fcId: number;
  name: string;
  /** Dove il provider lo mette quel giorno. Null = la riga non lo dice, e allora non si disegna. */
  position: MatchPosition | null;
  started: boolean;
  minutes: number | null;
  /**
   * IL SUO POSTO NEL MODULO: l'indice della sua voce nella distinta della fonte.
   *
   * 0 e' il portiere e 10 l'ultimo uomo della linea piu' avanzata; DENTRO una linea l'array va dalla
   * DESTRA della squadra alla sua sinistra, che e' lo stesso verso della `x` con cui il pannello
   * scrive i suoi undici - quindi i due campetti si leggono nello stesso modo.
   *
   * Misurato sulle 24.201 distinte in cache prima di adottarlo: linee contigue (G, D, M, F senza
   * tornare indietro) nel **99,05%** dei casi, il PRIMO difensore dell'array e' un `DR` **10.620 volte
   * contro 146** `DL` e l'ultimo un `DL` 8.816 contro 1.085. Il verso e' misurato, non dedotto da un
   * caso.
   *
   * NULL PER UN SUBENTRATO, per costruzione: per lui l'indice della fonte e' l'ordine della panchina
   * (i minuti in ordine decrescente, poi i non utilizzati), cioe' un numero che non dice dove ha
   * giocato. E null su un pacchetto scritto prima del 12/09/2026: allora e' ignoto, e l'ordine dentro
   * la linea torna a essere quello dei CODICI, che e' il ripiego dichiarato qui sotto.
   */
  slot: number | null;
  /**
   * DI CHI HA PRESO IL POSTO: l'`fcId` dell'uomo uscito nel cambio che lo ha fatto entrare.
   *
   * Null per un titolare, e null per un subentrato di cui la fonte non lo dice o il cui uscente e'
   * fuori dal listone - ignoto, non «e' entrato al posto di nessuno».
   *
   * PUO' PUNTARE A UN ALTRO SUBENTRATO e allora si risale la catena: il 29/08/2026 Koopmeiners entra
   * al 86' per Cambiaso, entrato al 76' per Conceicao, quindi il posto del modulo e' quello di
   * Conceicao. E' anche la ragione per cui l'aritmetica dei minuti non basta a ricostruirlo - li' i
   * subentrati sono CINQUE e i titolari usciti quattro.
   */
  cameFor?: number | null;
  /**
   * DOVE HA GIOCATO sull'asse LATERALE (media dei suoi tocchi, 0-100), nello stesso verso di `slot`:
   * 0 e' la DESTRA della squadra. Misurato sulla stessa partita - terzino destro 16,4, terzino
   * sinistro 84,9, ala destra 15,9, ala sinistra 80,9.
   *
   * Serve al RIPIEGO e non alla regola: quando il cambio non e' noto, e' comunque una misura su di
   * lui e batte il suo profilo di listone, che dice il mestiere per cui lo compri.
   */
  lateral?: number | null;
}

/** Un posto del modulo: chi lo occupava, e chi e' entrato in quella zona. */
export interface LineupPlace {
  /** Null = un posto che c'era e che questo pacchetto non sa nominare. */
  man: LineupMan | null;
  /**
   * CHI E' ENTRATO IN QUELLA ZONA, e non «chi ha sostituito lui»: quale cambio sia stato fatto per
   * chi non e' nel pacchetto. Il payload delle sostituzioni esiste (`positions.fetch_extra_incidents`
   * lo scarica gia' e ne tiene solo i gol) e l'aritmetica dei minuti NON lo ricostruisce - misurato
   * l'11/09/2026, un'uscita trova un ingresso complementare unico nel **30,3%** dei casi. Quindi il
   * subentrato sta nel posto della SUA linea piu' vicino al suo lato, che e' un'affermazione su di lui
   * e non su uno scambio.
   */
  came: LineupMan[];
}

/** Una riga del campo: quanti posti chiede il modulo, e chi si e' riusciti a mettere in ognuno. */
export interface LineupRow {
  line: PitchLine;
  /** Quanti ne mette il MODULO, che e' il conteggio di club - completo anche dove un nome manca. */
  wanted: number;
  places: LineupPlace[];
}

export interface MatchLineup {
  /** Il modulo su cui l'undici e' stato disegnato - e non un altro: vedi `fromSource`. */
  shape: string | null;
  /**
   * SE IL MODULO E' QUELLO CHE LA FONTE DICHIARA, e quindi l'undici e' tagliato nelle sue linee
   * esatte - trequarti compresa. False = si e' tagliato sui conteggi delle posizioni G/D/M/F, che
   * hanno tre linee: un 4-2-3-1 si legge `4-5-1`, e chi guarda lo deve sapere.
   */
  fromSource: boolean;
  rows: LineupRow[];
  /** Chi e' ENTRATO: minuti sopra zero senza essere partito. Dal piu' giocato. */
  came: LineupMan[];
  /** Quanti posti dell'undici portano un nome, e quanti ne chiede il modulo. */
  named: number;
  wanted: number;
  /**
   * Chi non ha una riga in cui stare: un titolare senza posizione, o un subentrato la cui linea il
   * modulo non ha. Conta e non si disegna - un uomo messo «da qualche parte» sarebbe una posizione
   * inventata.
   */
  unplaced: LineupMan[];
  /**
   * Su quante righe l'ordine e' DEDOTTO dai codici invece che letto dalla distinta della fonte: e' la
   * differenza fra «Scamacca al centro perche' la distinta dice cosi'» e «al centro perche' lo
   * deduciamo». Una riga di un uomo solo non conta - non c'e' nessun ordine da sbagliare.
   */
  deduced: number;
  /** Dove il modulo e i nomi non tornano, detto invece che appianato - come `pitchOf.problems`. */
  problems: string[];
}

/**
 * CHE COSA DICE UN CODICE SULLA FASCIA. E' un VOCABOLARIO e non una misura: mette in corrispondenza i
 * dodici codici granulari (osservati) e quelli del listone, che dicono due cose diverse e vanno letti
 * insieme - i granulari portano il LATO di chi e' stato visto giocarci, quelli del listone portano la
 * LARGHEZZA («ala», «esterno», «punta centrale») anche per chi il provider non ha mai osservato.
 *
 * Quattro risposte e non due, ed e' il punto: `W` dice «di fascia, ma non quale» e `PC` dice «al
 * centro». Un modello a un solo numero non sa esprimere ne' l'una ne' l'altra, e li' l'ordine finiva
 * per essere quello dei minuti - un `pc` sull'ala e un `w` in mezzo (operatore, 12/09/2026).
 *
 * Quello che NON c'e' e' deliberato: `DM`, `MC`, `AM`, `B`, `M`, `C`, `T`, `A` non dicono niente sulla
 * fascia, e farli parlare sarebbe inventare. Chi non ha nessun codice che parli va dove resta posto.
 */
type Lane = 'right' | 'left' | 'wide' | 'centre';

const LANE: Record<string, Lane> = {
  // i dodici codici granulari, che sono OSSERVATI
  DR: 'right', MR: 'right', RW: 'right',
  DL: 'left', ML: 'left', LW: 'left',
  GK: 'centre', DC: 'centre', ST: 'centre',
  // ...e quelli del listone, che sono il mestiere per cui lo compri
  DD: 'right', DS: 'left',
  E: 'wide', W: 'wide',
  POR: 'centre', PC: 'centre',
};

/**
 * QUANTO STA MALE quell'uomo in quel punto della riga: 0 e' la fascia DESTRA della squadra e 1 la
 * sinistra, lo stesso verso di `lineup_slot` e della `x` del pannello.
 *
 * La media sui codici che PARLANO, cosi' un `DC;DR` tira verso il centro-destra invece di leggere
 * «destra» come farebbe un massimo. Zero ovunque per chi non ne ha nessuno che parli: non e' un uomo
 * che sta bene ovunque, e' un uomo di cui non si sa niente, e infatti finisce dove resta posto.
 */
export function laneCost(codes: readonly string[] | null | undefined, x: number): number {
  let sum = 0;
  let heard = 0;
  for (const code of codes ?? []) {
    const lane = LANE[code.trim().toUpperCase()];
    if (!lane) continue;
    heard += 1;
    sum += lane === 'right' ? x
      : lane === 'left' ? 1 - x
        : lane === 'wide' ? Math.min(x, 1 - x) * 2
          : Math.abs(0.5 - x) * 2;
  }
  return heard ? sum / heard : 0;
}

/** Dove cade il posto numero `at` di una riga lunga `size`: 0 la fascia destra, 1 la sinistra. */
export function placeX(at: number, size: number): number {
  return size <= 1 ? 0.5 : at / (size - 1);
}

/** I minuti che la fonte scrive per chi c'e' stato dall'inizio alla fine. Il recupero non li alza. */
const FULL_MATCH = 90;

/**
 * SE QUEL POSTO SI E' LIBERATO, cioe' se chi lo occupava ha lasciato il campo.
 *
 * E' l'unica affermazione che i minuti da soli reggono, e regge: chi ha giocato la partita intera non
 * ha ceduto la maglia a nessuno, quindi nessun subentrato puo' stare li'. Quello che i minuti NON
 * reggono e' l'inverso - quale ingresso corrisponda a quale uscita - e per quello serve il cambio
 * vero (`cameFor`).
 *
 * Un posto SENZA NOME conta come libero: e' ignoto, non «e' rimasto in campo», e leggerlo come
 * occupato vieterebbe l'unico posto disponibile su una linea che questo listone non sa nominare.
 */
function freed(place: LineupPlace): boolean {
  const man = place.man;
  if (!man) return true;
  return man.minutes == null || man.minutes < FULL_MATCH;
}

/**
 * L'undici di quella partita, disposto sul modulo che il club ha davvero schierato.
 *
 * `shape` viene dai conteggi di club e non si ricava da questi uomini: e' la meta' completa delle due,
 * ed e' lei a dire quanti posti disegnare. Dove manca del tutto (una distinta che non fa undici) si
 * disegna quello che c'e' e il chiamante lo dice - non si inventa un modulo dai nomi che si hanno, o il
 * disegno sarebbe una descrizione del nostro perimetro invece che della partita.
 */
export function lineupOf(
  shape: string | null,
  men: readonly LineupMan[],
  /** I codici di un uomo (granulari e di listone insieme), per il ripiego. Vedi `laneCost`. */
  codesOf: (fcId: number) => readonly string[] | null = () => null,
  /**
   * IL MODULO COME LA FONTE LO DICHIARA, quando c'e'. E' un parametro a parte da `shape` perche' sono
   * due affermazioni diverse: `shape` viene dai conteggi delle posizioni G/D/M/F e ha TRE linee,
   * questo ne puo' avere quattro. Dove c'e' e l'undici e' ordinato, decide lui.
   */
  declared: string | null = null,
): MatchLineup {
  const starters = men.filter((man) => man.started);
  const byFormation = lineCounts(declared);
  /**
   * SI TAGLIA SUL MODULO DELLA FONTE, e il taglio e' per INTERVALLI DI POSTO e non per fette.
   *
   * `lineup_slot` e' un indice ASSOLUTO dentro la distinta - 0 il portiere, 10 l'ultimo uomo della
   * linea piu' avanzata - quindi le linee del modulo sono intervalli: 0, poi i primi `D`, poi `M`,
   * poi `T`, poi `A`. Non serve che gli undici ci siano tutti: un nome che questo listone non quota
   * lascia il SUO posto vuoto e non sposta nessun altro, che e' la ragione per cui questa versione ha
   * sostituito quella a fette - li' un uomo mancante faceva scivolare tutta la linea e il disegno
   * tornava ai tre conteggi proprio su euro, dove i nomi mancano per costruzione.
   *
   * Serve solo che il modulo chieda UNDICI posti (altrimenti non e' la stessa distinta) e che chi c'e'
   * il suo posto ce l'abbia.
   */
  const sequential = !!byFormation
    && Object.values(byFormation).reduce((sum, one) => sum + one, 0) === 11
    && starters.length > 0
    && starters.every((man) => man.slot != null);

  const counts = sequential ? byFormation : lineCounts(shape);
  const problems: string[] = [];

  const placed = new Map<PitchLine, LineupMan[]>();
  const unplaced: LineupMan[] = [];
  const subs: LineupMan[] = [];
  /** Dove comincia ogni linea dentro la distinta: serve a mettere ogni uomo al suo posto esatto. */
  const bounds = new Map<PitchLine, [number, number]>();
  const offsets = new Map<PitchLine, number>();
  if (sequential) {
    // Nessuna posizione G/D/M/F entra nel taglio: e' proprio quella che non sa distinguere un
    // trequartista da un centrocampista, ed e' il motivo per cui i tre conteggi sbagliavano.
    let at = 0;
    for (const line of DRAW_ORDER) {
      const asks = byFormation![line] ?? 0;
      if (asks) {
        bounds.set(line, [at, at + asks]);
        offsets.set(line, at);
      }
      at += asks;
    }
    for (const man of starters) {
      const slot = man.slot as number;
      const line = DRAW_ORDER.find((one) => {
        const range = bounds.get(one);
        return range && slot >= range[0] && slot < range[1];
      });
      if (!line) {
        // Un posto fuori da ogni intervallo: la distinta e il modulo non parlano dello stesso undici.
        unplaced.push(man);
        continue;
      }
      const list = placed.get(line);
      list ? list.push(man) : placed.set(line, [man]);
    }
  } else {
    for (const man of starters) {
      const line = man.position ? LINE_OF[man.position] : null;
      if (!line) {
        unplaced.push(man);
        continue;
      }
      const list = placed.get(line);
      list ? list.push(man) : placed.set(line, [man]);
    }
  }
  for (const man of men) {
    if (!man.started && (man.minutes ?? 0) > 0) subs.push(man);
  }

  const rows: LineupRow[] = [];
  let named = 0;
  let wanted = 0;
  let deduced = 0;
  for (const line of DRAW_ORDER) {
    const drawn = [...(placed.get(line) ?? [])];
    // LA FONTE PRIMA DI TUTTO, e per la RIGA INTERA o per niente: mescolare chi ha un posto e chi non
    // ce l'ha vorrebbe dire ordinare su due scale diverse nella stessa fila. Misurato sul pacchetto del
    // 12/09/2026: nella finestra pesante TUTTI i titolari di campionato ne hanno uno (2.109/2.109 sul
    // 2026-27, 27.331/27.331 sul 2025-26), quindi il ripiego serve alle coppe e ai pacchetti vecchi.
    const sourced = drawn.length > 0 && drawn.every((man) => man.slot != null);
    if (sourced) {
      drawn.sort((left, right) => (left.slot as number) - (right.slot as number));
    } else {
      assign(drawn, codesOf);
      // Una riga di un uomo solo non e' «dedotta»: non c'e' nessun ordine da sbagliare.
      if (drawn.length > 1) deduced += 1;
    }
    // Il modulo decide quanti posti ci sono; dove non c'e' un modulo lo dicono i disegnati, e allora la
    // riga descrive quello che si e' potuto leggere e non quello che il club ha schierato.
    const asks = counts ? (counts[line] ?? 0) : drawn.length;
    if (!asks && !drawn.length) continue;
    if (counts && drawn.length > asks) {
      problems.push(`linea ${line}: il modulo dice ${asks}, i nomi trovati sono ${drawn.length}`);
    }
    const places: LineupPlace[] = [];
    for (let at = 0; at < Math.max(asks, drawn.length); at++) {
      places.push({ man: null, came: [] });
    }
    // COL MODULO DELLA FONTE OGNI UOMO VA AL SUO POSTO ESATTO (`slot` meno l'inizio della linea), e il
    // buco resta DOVE E': senza, un nome mancante in mezzo alla difesa sposterebbe a sinistra tutti
    // quelli dopo di lui e il vuoto finirebbe in fondo. Altrove i disegnati riempiono in ordine, che
    // e' tutto quello che si puo' dire.
    const start = sequential ? (offsets.get(line) ?? 0) : null;
    drawn.forEach((man, at) => {
      const where = start == null ? at : (man.slot as number) - start;
      if (where >= 0 && where < places.length) places[where].man = man;
      else if (places[at]) places[at].man = man;
    });
    rows.push({ line, wanted: asks, places });
    named += drawn.length;
    wanted += asks;
  }

  const came = [...subs].sort((left, right) => (right.minutes ?? 0) - (left.minutes ?? 0)
    || left.name.localeCompare(right.name, 'it'));

  // DOV'E' DISEGNATO OGNUNO: serve a risalire la catena dei cambi fino al posto del MODULO.
  const seatOf = new Map<number, LineupPlace>();
  for (const row of rows) {
    for (const place of row.places) {
      if (place.man) seatOf.set(place.man.fcId, place);
    }
  }
  const byId = new Map(men.map((man) => [man.fcId, man]));
  /**
   * IL POSTO CHE SI E' LIBERATO PER LUI, risalendo di cambio in cambio fino a un TITOLARE disegnato.
   *
   * Il tetto di dieci giri non e' prudenza: un `came_for` che tornasse su se' stesso - un dato
   * sporco, o un uomo entrato e rientrato - farebbe girare il disegno per sempre, e un campetto che
   * non finisce di disegnarsi e' peggio di un campetto sbagliato.
   */
  const seatFor = (man: LineupMan): LineupPlace | null => {
    let at: LineupMan | undefined = man;
    for (let step = 0; step < 10 && at; step++) {
      const before: number | null | undefined = at.cameFor;
      if (before == null) return null;
      const seat = seatOf.get(before);
      if (seat) return seat;
      at = byId.get(before);
    }
    return null;
  };

  for (const man of came) {
    // IL POSTO CHE SI E' DAVVERO LIBERATO, e non quello che il suo profilo suggerisce.
    //
    // La versione precedente sceglieva la casella solo sui CODICI del subentrato, e un profilo non sa
    // che il modulo e' cambiato: la Juventus del 29/08/2026 parte 4-4-2 e passa al 4-2-3-1, e Gonzalez
    // N. finiva sotto Kolo Muani - che ha giocato NOVANTA MINUTI, quindi il suo posto non si e' mai
    // liberato e nessuno puo' averlo occupato (operatore, 12/09/2026). Il cambio vero dice che e'
    // entrato per DAVID.
    //
    // Il fatto arriva dall'endpoint delle posizioni medie, che porta l'elenco dei cambi con chi esce e
    // chi entra. Non era ricostruibile dai minuti: un'uscita trova un ingresso complementare unico nel
    // 30,3% dei casi, e in questa partita gli entrati sono cinque contro quattro titolari usciti,
    // perche' Cambiaso e' entrato al 76' ed e' uscito lui stesso al 86'.
    const seat = seatFor(man);
    if (seat) {
      seat.came.push(man);
      continue;
    }
    // RIPIEGO, per le partite che il pacchetto non copre e per un uscente fuori dal listone. Resta la
    // sua linea, ma i posti eleggibili sono solo quelli che si sono LIBERATI - chi e' rimasto in campo
    // per tutta la gara non ha ceduto la maglia a nessuno. Se nessuno di quella linea e' uscito si
    // torna a guardarli tutti: un subentrato che sparisce sarebbe un filtro silenzioso, e questo e'
    // esattamente il caso in cui il modulo e' cambiato e non lo sappiamo.
    const row = man.position ? rows.find((one) => one.line === LINE_OF[man.position!]) : undefined;
    if (!row?.places.length) {
      unplaced.push(man);
      continue;
    }
    const vacated = row.places.some(freed);
    // Il LATO da cui e' entrato lo dice la misura dei suoi tocchi quando c'e', e i suoi codici
    // altrimenti: una media su quella partita e' un'affermazione su di lui, un codice di listone e' il
    // mestiere per cui lo compri.
    const codes = codesOf(man.fcId);
    let best = 0;
    let bestCost = Infinity;
    row.places.forEach((place, at) => {
      const x = placeX(at, row.places.length);
      const cost = (man.lateral == null ? laneCost(codes, x) : Math.abs(man.lateral / 100 - x))
        + place.came.length + (place.man ? 0 : 2) + (vacated && !freed(place) ? 4 : 0);
      if (cost < bestCost) {
        bestCost = cost;
        best = at;
      }
    });
    row.places[best].came.push(man);
  }

  // IL MODULO CHE SI MOSTRA E' QUELLO SU CUI SI E' DISEGNATO, sempre: stampare il modulo dichiarato
  // accanto a un undici tagliato sui conteggi direbbe «4-2-3-1» sopra tre linee.
  return { shape: sequential ? declared : shape, fromSource: sequential,
    rows, came, named, wanted, unplaced, deduced, problems };
}

/**
 * CHI VA DOVE, quando la distinta non porta i posti: gli uomini di una riga sui punti di quella riga.
 *
 * Un'assegnazione GOLOSA e non esatta, e la ragione e' che il ripiego quasi non scatta: nella finestra
 * pesante ogni titolare di campionato ha il suo posto dalla fonte (misurato, 2.109/2.109 e
 * 27.331/27.331), quindi qui ci finiscono le coppe e i pacchetti vecchi. Chi ha il vincolo piu' forte
 * sceglie per primo - un `Pc` e un `Ds` hanno una sola casa, un `AM` nessuna - cosi' i due che parlano
 * non si rubano il posto a vicenda per l'ordine in cui capitano.
 */
function assign(men: LineupMan[], codesOf: (fcId: number) => readonly string[] | null): void {
  const size = men.length;
  if (size < 2) return;
  const strength = (man: LineupMan): number => {
    const codes = codesOf(man.fcId);
    // Quanto quell'uomo DISTINGUE fra i punti della riga: se e' indifferente non ha niente da dire.
    const costs = men.map((_, at) => laneCost(codes, placeX(at, size)));
    return Math.max(...costs) - Math.min(...costs);
  };
  const order = [...men].sort((left, right) =>
    strength(right) - strength(left)
    || (right.minutes ?? 0) - (left.minutes ?? 0)
    || left.name.localeCompare(right.name, 'it'));
  const taken = new Array<LineupMan | null>(size).fill(null);
  for (const man of order) {
    const codes = codesOf(man.fcId);
    let best = -1;
    let bestCost = Infinity;
    for (let at = 0; at < size; at++) {
      if (taken[at]) continue;
      const cost = laneCost(codes, placeX(at, size));
      if (cost < bestCost) {
        bestCost = cost;
        best = at;
      }
    }
    taken[best] = man;
  }
  men.splice(0, size, ...(taken as LineupMan[]));
}
