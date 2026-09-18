/**
 * IL PROSSIMO TURNO SECONDO LE FONTI - la terza lettura della sezione Squadre.
 *
 * Richiesta dell'operatore (18/09/2026): «oltre alla formazione stagionale e ultimo periodo, una nuova
 * "prossimo turno" dove inserisci la formazione più probabile elaborando le informazioni recuperate dal
 * google sheet». Il foglio cattura quattro siti a quindici minuti da ogni calcio d'inizio e pubblica un
 * JSON; questo modulo lo legge e lo riduce a un undici per club.
 *
 * NON È UNA NOSTRA PREVISIONE, e la distinzione non è formale. In questo progetto la stampa è un
 * GIUDICE e mai un input: le nostre due board (stagione e ultimo periodo) sono disegnate dal toolkit e
 * vengono giudicate CONTRO queste fonti, e se le leggessimo dentro il claim quel confronto diventerebbe
 * circolare. Quindi questa è una TERZA cosa, la ri-pubblicazione di cosa dicono i quattro siti, che
 * nessun percorso del motore rilegge. Il payload stesso lo dichiara (`what`), e la vista lo ripete.
 *
 * PERCHÉ LEGGE LA RETE E NON IL PACCHETTO. Il bundle lo scrive `export` sul portatile dell'operatore,
 * mentre le prese avvengono col portatile magari spento - che è tutta la ragione per cui il foglio
 * esiste. Una board consegnata dal pacchetto sarebbe vecchia di un giorno proprio per le partite per cui
 * serve. Che l'origine dell'app possa davvero leggere quell'endpoint è stato MISURATO prima di scrivere
 * questa riga (`app/scripts/probe-sheet-endpoint.mjs`, 18/09/2026: 200, `type: cors`, 39.768 byte e 20
 * club sia da gh-pages sia da localhost) - una risposta `opaque` sarebbe stata un 200 illeggibile.
 *
 * L'UNDICI SI SCEGLIE PER VOTI E IL PAREGGIO RESTA VISIBILE. Gli uomini arrivano con quante fonti li
 * nominano su quante hanno letto quel club; si prendono gli undici più votati e si DICE chi è rimasto
 * fuori a pari merito. Misurato sulla presa vera del turno 5: su **18 club di 20** le quattro fonti non
 * sono tutte d'accordo, e al Monza l'undicesima maglia è un 2/4 contro 2/4 con la stessa probabilità -
 * una monetina, che una media avrebbe nascosto dentro un numero.
 */

import { DRAW_ORDER, PitchLine, lineCounts } from './club-eleven';
import { laneCost, laneKnown, placeX } from './match-lineup';
import { assign } from './mantra-legal';

/** Un uomo come il foglio lo pubblica: il conteggio, non un'opinione. */
export interface NextMan {
  /** La nostra chiave, quando la fonte la pubblica o il foglio l'ha risolta. Null = nome e basta. */
  readonly fcId: number | null;
  readonly player: string;
  /** Il ruolo del listone (P/D/C/A) quando una fonte lo porta. Null altrove: vuoto = ignoto. */
  readonly role: string | null;
  /** Quante fonti lo nominano, e quante hanno letto quel club: due numeri, non uno. */
  readonly votes: number;
  readonly of: number;
  readonly by: readonly string[];
  /** Media delle percentuali pubblicate, null quando nessuna fonte ne pubblica una. */
  readonly prob: number | null;
}

export interface NextClub {
  readonly clubKey: string;
  readonly club: string;
  readonly kickoff: Date | null;
  /** Quando è stata presa la lettura mostrata, che è quella che il foglio dice CONTARE. */
  readonly takenAt: Date | null;
  /** Quante fonti hanno letto questo club. Zero non capita: un club senza fonti non è nel payload. */
  readonly sources: number;
  /**
   * Chi è dentro SENZA contesa: più votato di chiunque resti fuori. Può essere meno di undici, ed è
   * proprio quando lo è che questa lettura dice qualcosa.
   */
  readonly certain: readonly NextMan[];
  /**
   * Gli uomini che si giocano le maglie rimaste, tutti a PARI VOTI - quelli che entrerebbero e quelli
   * che resterebbero fuori, insieme e senza che nessuno decida.
   *
   * IL PAREGGIO NON SI ROMPE, e non è timidezza: la prima versione prendeva gli undici più votati e
   * spareggiava sulla probabilità e poi sul NOME, cioè decideva l'undicesima maglia in ordine
   * alfabetico. Su una presa vera capita davvero - al Monza Cutrone e Colpani leggevano 2/4 con la
   * stessa probabilità - e una scelta alfabetica sarebbe stata invisibile e sbagliata la metà delle
   * volte. Questo repository ha già pagato quel difetto su un'asta.
   */
  readonly contested: readonly NextMan[];
  /** Quante maglie si contendono quegli uomini: 11 meno i certi. Zero quando non c'è contesa. */
  readonly contestedPlaces: number;
  /** Chi resta fuori senza nemmeno essere in contesa, dal più votato in giù. */
  readonly out: readonly NextMan[];
  /** Quanti dei CERTI sono nominati da TUTTE le fonti che hanno letto quel club. */
  readonly unanimous: number;
  /**
   * IL MODULO CHE OGNI FONTE DICHIARA, e chi lo dichiara: `{'3-4-2-1': ['fantacalcio.it', ...]}`.
   *
   * E' un FATTO PUBBLICATO e non una nostra deduzione, ed e' la ragione per cui viene prima di
   * qualunque conteggio: un 3-4-2-1 i ruoli del listone non lo sanno dire - leggono 1-3-6-1, perche' un
   * trequartista e' un `C` - quindi dedurlo dove la fonte lo scrive sarebbe inventare accanto a una
   * colonna che lo dichiara, che e' un difetto che questo repository ha gia' pagato sul modulo di un
   * club vero (12/09/2026).
   *
   * VUOTO su un payload scritto prima del 18/09/2026: allora si deduce, e il campetto lo dice.
   */
  readonly shapes: Readonly<Record<string, readonly string[]>>;
}

export interface NextRound {
  readonly round: number | null;
  readonly generatedAt: Date | null;
  readonly sources: readonly string[];
  /** Quello che il payload dichiara di essere: si mostra, non si riscrive. */
  readonly what: string;
  readonly clubs: readonly NextClub[];
}

/** Quanti uomini fa un undici. Non è una soglia: è il regolamento. */
const ELEVEN = 11;

/**
 * Da JSON a modello. PURA, perché è una riduzione e non uno stato - e perché così si prova senza rete.
 *
 * Un payload che non si capisce non diventa un turno vuoto: torna `null`, e chi chiama lo distingue da
 * «letto, e non c'è ancora nessuna presa» (che è un turno con zero club). Vuoto e ignoto sono due cose.
 */
export function parseNextRound(raw: unknown): NextRound | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!o['clubs'] || typeof o['clubs'] !== 'object') return null;
  const clubs: NextClub[] = [];
  for (const [clubKey, value] of Object.entries(o['clubs'] as Record<string, unknown>)) {
    const club = asClub(clubKey, value);
    if (club) clubs.push(club);
  }
  // In ordine di calcio d'inizio: la prima partita del turno è quella che si guarda per prima, e un
  // ordine alfabetico direbbe che il Torino viene dopo il Milan anche quando gioca tre giorni prima.
  clubs.sort((a, b) => (a.kickoff?.getTime() ?? Infinity) - (b.kickoff?.getTime() ?? Infinity)
    || a.club.localeCompare(b.club));
  return {
    round: typeof o['round'] === 'number' ? o['round'] : null,
    generatedAt: asDate(o['generated_at']),
    sources: Array.isArray(o['sources']) ? (o['sources'] as string[]).slice() : [],
    what: typeof o['what'] === 'string' ? o['what'] : '',
    clubs,
  };
}

function asClub(clubKey: string, value: unknown): NextClub | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  const men = (Array.isArray(o['men']) ? o['men'] : [])
    .map(asMan)
    .filter((m): m is NextMan => m !== null);
  // L'ordine per voti lo fa già il foglio, ma si rifà qui: chi disegna non deve dipendere dall'ordine
  // in cui il trasporto gli è arrivato, o un giorno un cambio là dentro riordina un undici quassù.
  const sorted = men.slice().sort((a, b) => b.votes - a.votes || (b.prob ?? 0) - (a.prob ?? 0)
    || a.player.localeCompare(b.player));

  // LA LINEA DI TAGLIO È SUI VOTI, e chi ci sta sopra è dentro. Chi ci sta ESATTAMENTE SOPRA la linea
  // resta un gruppo: l'ordinamento qui sopra serve a mostrarli in un ordine stabile (la probabilità
  // prima, che due fonti su quattro pubblicano, e il nome solo come ultima spiaggia), MAI a decidere
  // chi entra. Ordinare e scegliere sono due cose diverse e solo la prima può usare un metro parziale.
  const cutVotes = sorted.length > ELEVEN ? sorted[ELEVEN - 1]?.votes ?? 0 : 0;
  const certain = sorted.length <= ELEVEN ? sorted : sorted.filter((m) => m.votes > cutVotes);
  const atCut = sorted.length <= ELEVEN ? [] : sorted.filter((m) => m.votes === cutVotes);
  const places = Math.max(0, ELEVEN - certain.length);
  // Se i pari merito sono esattamente le maglie rimaste, non c'è nessuna contesa: entrano tutti.
  const settled = atCut.length > 0 && atCut.length <= places;
  const sources = typeof o['of'] === 'number' ? o['of'] : (men[0]?.of ?? 0);
  const inside = settled ? certain.concat(atCut) : certain;
  return {
    clubKey,
    club: typeof o['club'] === 'string' ? o['club'] : clubKey,
    kickoff: asDate(o['kickoff']),
    takenAt: asDate(o['taken_at']),
    sources,
    certain: inside,
    contested: settled ? [] : atCut,
    contestedPlaces: settled ? 0 : Math.max(0, ELEVEN - inside.length),
    out: sorted.filter((m) => m.votes < cutVotes),
    unanimous: inside.filter((m) => m.of > 0 && m.votes === m.of).length,
    shapes: asShapes(o['shapes']),
  };
}

function asMan(value: unknown): NextMan | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  const player = typeof o['player'] === 'string' ? o['player'].trim() : '';
  if (!player) return null;                      // un uomo senza nome non è un uomo
  const votes = Number(o['votes']);
  if (!Number.isFinite(votes) || votes <= 0) return null;
  const id = o['fc_id'];
  return {
    fcId: id === null || id === undefined || id === '' ? null : Number(id) || null,
    player,
    role: typeof o['role'] === 'string' && o['role'] ? o['role'].toUpperCase() : null,
    votes,
    of: Number(o['of']) || 0,
    by: Array.isArray(o['by']) ? (o['by'] as string[]).slice() : [],
    prob: typeof o['prob'] === 'number' ? o['prob'] : null,
  };
}

/** I moduli dichiarati, validati: una chiave che non e' un modulo e un valore che non e' una lista si buttano. */
function asShapes(value: unknown): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {};
  if (!value || typeof value !== 'object') return out;
  for (const [shape, by] of Object.entries(value as Record<string, unknown>)) {
    if (typeof shape === 'string' && shape && Array.isArray(by)) out[shape] = (by as string[]).slice();
  }
  return out;
}

/** Un istante ISO, o null. Mai `new Date(undefined)`, che è una data invalida travestita da data. */
function asDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Quanto è VECCHIA la lettura, in minuti prima del calcio d'inizio di quel club.
 *
 * È il numero che qualifica tutto il resto, e per questo sta accanto al modello e non dentro una vista:
 * una lettura presa a settantadue minuti è una previsione, una presa a dieci è quasi una copia
 * dell'undici annunciato - le ufficiali escono a mezz'ora. Null quando manca uno dei due istanti.
 */
export function leadMinutes(club: NextClub): number | null {
  if (!club.kickoff || !club.takenAt) return null;
  return Math.round((club.kickoff.getTime() - club.takenAt.getTime()) / 60000);
}

/** Minuti prima del fischio in cui escono le formazioni ufficiali. Dichiarato dall'operatore. */
export const OFFICIAL_MINUTES = 30;

/** Se la lettura mostrata è stata presa DOPO l'annuncio ufficiale: un fatto sulla lettura, non un voto. */
export function afterOfficial(club: NextClub): boolean | null {
  const lead = leadMinutes(club);
  return lead === null ? null : lead < OFFICIAL_MINUTES;
}

/**
 * Quanti uomini della nostra rosa bastano a dire «il club del payload è questo».
 *
 * Tre e non uno perché un solo nome in comune può essere un omonimo risolto male o un uomo che una
 * fonte mette nel club sbagliato; tre no. E non undici, perché il payload porta la LETTURA della
 * stampa e la nostra rosa è il listone: un club appena promosso o con mezza rosa non quotata ne
 * condivide meno di quanti ne schiera.
 */
export const CLUB_JOIN_MIN = 3;

/**
 * Quale club del payload è quello che si sta guardando - AGGANCIATO PER `fc_id` E MAI PER NOME.
 *
 * Il foglio indicizza i club su una sua tabella di alias (`CLUB_ALIASES` nel `.gs`) e questa app li chiama
 * col nome canonico del listone: due vocabolari, e un join per stringa fra i due è il difetto che questo
 * repository ha già pagato quattro volte - l'ultima ha perso Milan, Roma e Napoli dal calendario di
 * tutti, cioè i tre club più forti, in silenzio. Gli `fc_id` invece sono la chiave primaria del progetto
 * e le fonti senza la nostra chiave sono già state risolte a monte, dentro il foglio.
 *
 * UN PAREGGIO SI RIFIUTA invece di essere rotto: due club del payload che condividono lo stesso numero di
 * nostri uomini è una cosa che non può succedere con rose vere, e se succede vuol dire che l'identità ha
 * sbagliato - disegnare uno dei due sarebbe inventare quale.
 */
export function nextClubFor(round: NextRound | null, squad: Iterable<number>): NextClub | null {
  if (!round) return null;
  const ours = new Set(squad);
  if (!ours.size) return null;
  let best: NextClub | null = null;
  let hits = 0;
  let tied = false;
  for (const club of round.clubs) {
    let mine = 0;
    for (const man of [...club.certain, ...club.contested, ...club.out]) {
      if (man.fcId !== null && ours.has(man.fcId)) mine += 1;
    }
    if (mine > hits) { hits = mine; best = club; tied = false; } else if (mine === hits) tied = true;
  }
  return hits >= CLUB_JOIN_MIN && !tied ? best : null;
}

// =================================================================================================
// IL MODULO E I POSTI - moduli REALI, e la nostra assegnazione
// =================================================================================================

/**
 * DOVE UN CODICE DEL LISTONE PUO' GIOCARE, DENTRO UN MODULO VERO.
 *
 * Non sono i posti tipati del regolamento mantra, ed e' una correzione dell'operatore (18/09/2026:
 * «non pensare ai moduli mantra, devono essere moduli reali»). La legalita' mantra e' una regola del
 * GIOCO - dice quali undici puoi schierare al fantacalcio - mentre qui la domanda e' sul CALCIO: che
 * modulo gioca il Monza. Il caso che lo dimostra e' il Monza stesso: nessuno schema mantra ha cinque
 * difensori, e i suoi undici ne portano cinque di listone - perche' due sono i QUINTI, che in un 3-4-3
 * stanno a centrocampo. Letto col regolamento mantra quell'undici non esisteva; letto con le linee e'
 * un 3-4-3, che e' il modulo che il suo allenatore ha giocato **122 volte**.
 *
 * Le due righe che non sono ovvie sono regole gia' scritte in questo progetto e non invenzioni di qui:
 * `e` sta in difesa O a centrocampo (il quinto e' un terzino in una difesa a quattro e un esterno nel
 * centrocampo a cinque), e `w` sta a centrocampo O in attacco («i due attaccanti esterni possono
 * arretrare e coprire il centrocampo», `_reshape`). `t` scende a centrocampo dove il modulo non ha una
 * trequarti, che e' l'altra meta' della stessa frase.
 */
const LINES_OF: Record<string, readonly PitchLine[]> = {
  por: ['P'],
  dd: ['D'], ds: ['D'], dc: ['D'], b: ['D'],
  e: ['D', 'M'],
  m: ['M'], c: ['M'],
  w: ['M', 'A'],
  t: ['T', 'M'],
  a: ['A', 'T'],
  pc: ['A'],
};

/**
 * IL RIPIEGO PER CHI IL LISTONE NON QUOTA: il suo macro-ruolo, aperto sulle linee che quel mestiere
 * copre davvero. Un difensore di listone puo' essere un quinto, un attaccante puo' essere un'ala che
 * arretra: «non so quale» e non «sta dove dico io», e l'assegnazione ne fa quello che puo'.
 */
const OPEN_LINES: Record<string, readonly PitchLine[]> = {
  P: ['P'],
  D: ['D', 'M'],
  C: ['M', 'T'],
  A: ['A', 'T', 'M'],
};

/** Su quali linee puo' stare un uomo: dai suoi codici granulari, o dal suo macro-ruolo. */
export function linesFor(codes: readonly string[] | null | undefined, role: string | null): PitchLine[] {
  const out = new Set<PitchLine>();
  for (const code of codes ?? []) {
    for (const line of LINES_OF[code.trim().toLowerCase()] ?? []) out.add(line);
  }
  if (out.size) return [...out];
  const open = OPEN_LINES[(role ?? '').toUpperCase()];
  if (open) return [...open];
  /**
   * DI LUI NON SI SA NIENTE - le fonti lo nominano e questo listone non lo quota - e allora sta DOVE
   * RESTA POSTO, che e' la sola cosa che di lui si possa dire.
   *
   * La prima versione lo teneva fuori da ogni riga, e il prezzo era che l'INTERO campetto spariva: a
   * quel turno l'Inter non lo disegnava per DUE nomi su tredici (operatore, 18/09/2026). Rifiutare di
   * disegnare venti uomini perche' di due non si sa il ruolo e' «vuoto = ignoto» letto come «vuoto =
   * impossibile»; quello che l'ignoto impone e' di non dire dove gioca, e infatti il suo posto resta
   * SENZA ETICHETTA - la casella lo dichiara da se'.
   *
   * LA PORTA NO: li' gioca uno solo e sbagliarlo si vede da lontano, quindi un ignoto non ci finisce
   * mai - se l'undici non ha un portiere riconosciuto, il modulo non torna e la carta lo dice.
   */
  return ['D', 'M', 'T', 'A'];
}

/** Un modulo candidato per un club: il suo nome e quanto quel club lo gioca, secondo la NOSTRA misura. */
export interface ShapeOdds {
  readonly shape: string;
  /** La probabilita' che il toolkit da' a quel modulo per quel club (`boards.json`). Null = non misurata. */
  readonly odds: number | null;
}

/** Quello che si riesce a dire del modulo, e di che natura e' la risposta. */
export interface NextShape {
  readonly shapes: readonly string[];
  /** Chi lo DICHIARA, quando viene dalle fonti. Vuoto = l'ha scelto la nostra misura. */
  readonly by: readonly string[];
  /** Vero se a sceglierlo fra i possibili e' stato il repertorio del club che MISURIAMO noi. */
  readonly ours: boolean;
  /** Perche' non ce n'e' uno, o come si e' scelto. Vuota quando e' un fatto delle fonti. */
  readonly why: string;
}

export interface NextPlace {
  readonly line: PitchLine;
  /**
   * COME SI CHIAMA QUESTO POSTO - `Td`, `Dc`, `E`, `Pc` - e NON e' una nostra invenzione.
   *
   * E' il marcatore che la NOSTRA board da' a quell'uomo quando lo disegna (`BoardMan.badge`, la parola
   * del pannello), e per chi la board non disegna e' il suo codice primario di listone, che e' una
   * parola sulla posizione e non un'etichetta inventata da qui. Vuoto quando non si sa ne' l'uno ne'
   * l'altro: una casella senza scritta, mai una scritta a caso.
   */
  readonly badge: string | null;
  readonly man: NextMan | null;
  /** Se e' il posto della maglia contesa: tutti e due i nomi, e nessuno scelto. */
  readonly contested: readonly NextMan[];
  /**
   * CHI LE FONTI RIMASTE METTONO AL SUO POSTO (richiesta dell'operatore, 18/09/2026: «se e' indicato 3
   * su 4 vorrei vedere anche l'alternativa 1 su 4»).
   *
   * Sono gli uomini fuori dall'undici che possono giocare in QUESTA riga, e si mostrano solo dove chi
   * occupa il posto NON e' nominato da tutti - se e' 4 su 4 non c'e' nessuna alternativa da vedere,
   * perche' nessuna fonte ha messo li' qualcun altro. Quale delle due maglie prenderebbero non lo dice
   * nessuno: sono attaccate a tutti i posti non unanimi della riga, e appaiarle a uno solo sarebbe
   * inventare una corrispondenza che il conteggio non ha.
   */
  readonly alternatives: readonly NextMan[];
}

export interface NextRow {
  readonly line: PitchLine;
  readonly places: readonly NextPlace[];
}

export interface NextPitch {
  readonly shape: string;
  readonly by: readonly string[];
  readonly ours: boolean;
  readonly rows: readonly NextRow[];
  /** Quanti posti portano un nome: meno di undici si vede e non si nasconde. */
  readonly named: number;
  /** I contesi che nessun posto del campo puo' ospitare: si mostrano sotto, invece di sparire. */
  readonly orphans: readonly NextMan[];
}

/**
 * CHE MODULO GIOCANO QUESTI UNDICI - dichiarato dalle fonti, o scelto nel repertorio del club.
 *
 * TRE GRADINI, e ognuno e' di natura diversa.
 *  1. Quello che le FONTI dichiarano: e' un fatto pubblicato, e vince anche se qualcuno dei suoi posti
 *     resta vuoto - un modulo che il club ha annunciato non si scarta perche' non torna il nostro
 *     conto, semmai e' il conto che si vede mancare un uomo.
 *  2. Fra i moduli che quel CLUB gioca (il suo repertorio misurato: le probabilita' di `boards.json` e
 *     gli schemi del suo allenatore), quelli che questi undici riempiono, il piu' probabile. E' un
 *     nostro numero dentro una lettura della stampa, quindi la carta lo dichiara.
 *  3. Nessuno: si dice, e resta la lista.
 */
export function nextShapes(
  club: NextClub,
  linesOf: (man: NextMan) => readonly PitchLine[],
  candidates: readonly ShapeOdds[],
): NextShape {
  /*
   * UN MODULO DICHIARATO E' UN FATTO, MA DEVE ESSERE UN MODULO.
   *
   * Arriva dalla marcatura di quattro siti diversi, quindi puo' essere una stringa che non fa undici
   * posti - un `3-4-4`, un refuso, un formato nuovo. Senza questo filtro passava dritto a `nextPitch`,
   * che restituisce null, e la sezione restava MUTA: niente campetto e nessuna ragione, che e' lo stato
   * che questa pagina ha il compito di non produrre mai. Chi non fa undici semplicemente non e' una
   * dichiarazione utilizzabile, e si torna a dedurre.
   */
  const declared = Object.entries(club.shapes).filter(([name]) => elevenPlaces(name));
  if (declared.length) {
    const top = Math.max(...declared.map(([, by]) => by.length));
    const best = declared.filter(([, by]) => by.length === top);
    if (best.length === 1) return { shapes: [best[0][0]], by: best[0][1].slice(), ours: false, why: '' };
    return { shapes: best.map(([name]) => name).sort(), by: [], ours: false,
      why: `le fonti dichiarano ${best.length} moduli diversi con lo stesso peso` };
  }
  if (!candidates.length) {
    return { shapes: [], by: [], ours: false,
      why: 'il pacchetto non porta il repertorio di questo club, e le fonti non pubblicano il modulo' };
  }
  const fitted = candidates
    .filter((one) => fits(club, linesOf, one.shape))
    .sort((a, b) => (b.odds ?? 0) - (a.odds ?? 0) || a.shape.localeCompare(b.shape));
  if (!fitted.length) {
    const blind = club.certain.filter((man) => !linesOf(man).length).length;
    return { shapes: [], by: [], ours: false, why: blind
      ? `${blind} dei nominati non hanno un ruolo su questo listone, quindi non si può dire dove giocano`
      : `questi undici non stanno in nessuno dei ${candidates.length} moduli che il club gioca` };
  }
  const known = fitted.filter((one) => one.odds !== null);
  const pick = known.length ? known[0] : fitted[0];
  return {
    shapes: [pick.shape],
    by: [],
    ours: true,
    // TRE FRASI PER TRE SITUAZIONI: e' il suo modulo piu' probabile, e' l'unico suo che regge, oppure
    // NON e' fra quelli che gioca - e quest'ultima va detta, perche' e' la piu' debole delle tre e
    // stamparla come le altre la farebbe leggere come una misura su quel club.
    why: pick.odds === null
      ? 'non è fra i moduli che questo club ha giocato: è un modulo vero che questi undici riempiono'
      : (known.length > 1
        ? `${known.length} moduli del suo repertorio li contengono; questo è il più probabile`
        : 'è il modulo del suo repertorio che questi undici riempiono'),
  };
}

/**
 * GLI UNDICI AI LORO POSTI, con l'assegnazione che questo progetto usa gia' altrove.
 *
 * `assign` e' una ricerca di cammini aumentanti (Kuhn): il matching e' MASSIMO qualunque sia l'ordine,
 * quindi «quanti ne entrano» non dipende da come li si ordina, mentre CHI prende un posto conteso si' -
 * per questo i piu' votati entrano per primi. Il vocabolario su cui gira qui sono le LINEE del modulo
 * vero, non i posti tipati del regolamento mantra: la funzione e' la stessa, la domanda no.
 *
 * L'ORDINE DENTRO UNA RIGA lo decide il LATO che i codici dichiarano (`laneCost`, la stessa funzione
 * del campetto di una partita giocata), dalla destra della squadra alla sua sinistra - che e' il verso
 * misurato e gia' in uso sugli altri due campi.
 *
 * I CONTESI NON ENTRANO NEL MATCHING: il loro posto resta vuoto e ci finiscono tutti e due i nomi.
 */
export function nextPitch(
  club: NextClub,
  shape: string,
  linesOf: (man: NextMan) => readonly PitchLine[],
  codesOf: (man: NextMan) => readonly string[],
  by: readonly string[] = [],
  ours = false,
  /**
   * DOVE LA NOSTRA BOARD LO DISEGNA sull'asse laterale (0 la destra della squadra), quando lo disegna.
   *
   * E' la richiesta dell'operatore - «non possiamo sfruttare lo stesso meccanismo del claim e della
   * formazione stagionale?» - e la risposta e' che il meccanismo non va ri-eseguito: il suo RISULTATO e'
   * gia' nel pacchetto, uomo per uomo, perche' il campetto stagionale lo ha gia' risolto il toolkit con
   * la sua ungherese. Quindi per chi la board disegna il posto e' il SUO, e i codici restano il ripiego
   * per chi la board non nomina. Null = non lo disegna.
   */
  xOf: (man: NextMan) => number | null = () => null,
  /** La riga in cui la NOSTRA board lo disegna, per sapere qual e' la SUA riga. Null = non lo disegna. */
  homeOf: (man: NextMan) => PitchLine | null = () => null,
  /** Come la nostra board chiama il posto di quell'uomo (`Td`, `Dc`, `Pc`). Null = non lo disegna. */
  badgeOf: (man: NextMan) => string | null = () => null,
): NextPitch | null {
  const counts = elevenPlaces(shape);
  if (!counts) return null;
  const slots: PitchLine[] = [];
  for (const line of DRAW_ORDER) for (let i = 0; i < (counts[line] ?? 0); i += 1) slots.push(line);

  const certain = club.certain.slice().sort((a, b) => b.votes - a.votes || (b.prob ?? 0) - (a.prob ?? 0));
  /**
   * I CONTESI ENTRANO NELL'ASSEGNAZIONE, con un RAPPRESENTANTE per maglia in ballo.
   *
   * Senza, il loro posto e' semplicemente quello che avanza - e avanza dove capita: alla Roma i due
   * centrali finivano a centrocampo perche' un quinto si era preso l'ultimo posto in difesa, al Como i
   * due attaccanti finivano in mezzo al campo col posto d'attacco VUOTO (segnalati tutti e due
   * dall'operatore, 18/09/2026). Entrando nel matching il posto se lo prendono loro, e solo dopo lo si
   * svuota per scriverci tutti e due i nomi: chi gioca non lo dice nessuno, DOVE si gioca quella maglia
   * si'.
   */
  const reps = club.contested.slice(0, club.contestedPlaces);
  const men = certain.concat(reps);
  const home = (man: NextMan): PitchLine | null => homeOf(man) ?? linesOf(man)[0] ?? null;

  /**
   * PRIMA A CASA SUA, POI DOVE PUO'.
   *
   * Un matching massimo risponde a «quanti ne entrano» e non a «dove»: a parita' di cardinalita'
   * qualunque assegnazione gli va bene, e fra quelle ce ne sono di assurde - un centrale in mezzo al
   * campo e un quinto fra i tre difensori (Roma, Como e Juventus, tutte e tre segnalate dall'operatore
   * lo stesso minuto). La cardinalita' pero' non si sacrifica: un posto vuoto e' una bugia piu' grossa
   * di un uomo fuori posto. Quindi si prova prima l'assegnazione che rispetta la riga di CASA di
   * ognuno - quella in cui la nostra board lo disegna, o quella del suo codice primario - e la si tiene
   * solo se piazza tanti uomini quanti ne piazzerebbe quella libera.
   */
  const full = assign(men.map((man) => ({ roles: [...linesOf(man)], man })), slots.map((line) => [line]));
  const first = assign(
    men.map((man) => {
      const only = home(man);
      return { roles: only ? [only] : [], man };
    }),
    slots.map((line) => [line]),
  );
  let chosen = full.chosen;
  let holder = full.holder;
  if (first.chosen.length < men.length) {
    // Chi la sua riga non lo ha accolto va dove puo', sui posti che restano - senza spostare gli altri.
    // `assign` tiene in `chosen` SOLO chi ha piazzato, quindi «piazzato» e' l'appartenenza a quell'insieme
    // e non serve cercarlo anche in `holder`: quella seconda condizione era vera per costruzione e
    // costava una scansione dentro due cicli annidati.
    const placed = new Set(first.chosen.map((one) => one.man));
    const left = men.filter((man) => !placed.has(man));
    const free = slots.map((line, at) => ({ line, at })).filter((one) => first.holder[one.at] < 0);
    const more = assign(
      left.map((man) => ({ roles: [...linesOf(man)], man })),
      free.map((one) => [one.line]),
    );
    if (first.chosen.length + more.chosen.length >= full.chosen.length) {
      const merged = first.chosen.slice();
      const at = first.holder.slice();
      more.holder.forEach((who, i) => {
        if (who >= 0) at[free[i].at] = merged.push(more.chosen[who]) - 1;
      });
      chosen = merged;
      holder = at;
    }
  } else if (first.chosen.length >= full.chosen.length) {
    chosen = first.chosen;
    holder = first.holder;
  }

  /**
   * CHI OCCUPA OGNI RIGA, PRIMA DI DISPORLA - e le maglie in ballo sono occupanti come gli altri.
   *
   * L'ordine dentro la riga si decide su TUTTI e tre i tipi di casella insieme: un uomo, un gruppo di
   * contendenti, un posto che nessuno riempie. Costruire prima i titolari e appendere le contese in coda
   * - com'era - le faceva finire sempre all'estremita' sinistra, quindi una coppia di CENTRALI si
   * disegnava al posto del terzino (Fiorentina, Dragusin e Pongracic: operatore, 19/09/2026).
   */
  const here = new Map<PitchLine, NextMan[]>();
  const heldBy = new Map<PitchLine, number>();
  for (const line of DRAW_ORDER) { here.set(line, []); heldBy.set(line, 0); }
  slots.forEach((line, at) => {
    if (holder[at] < 0) return;
    const who = chosen[holder[at]].man;
    if (reps.includes(who)) heldBy.set(line, (heldBy.get(line) ?? 0) + 1);
    else (here.get(line) as NextMan[]).push(who);
  });

  /**
   * I CONTENDENTI SI DISTRIBUISCONO FRA LE MAGLIE IN BALLO, ognuno nella zona del suo mestiere: i
   * difensori nella maglia contesa in difesa, gli attaccanti in quella d'attacco (operatore,
   * 18/09/2026). La compatibilita' la dicono le LINEE dei suoi codici, cioe' i ruoli osservati, non
   * quelli di listone. Fra due caselle che gli vanno bene prende la meno affollata; se nessuna gli va
   * bene resta comunque sul campo, nella meno affollata - sparire sarebbe peggio che stare in una zona
   * che non e' sua.
   */
  const groups: { line: PitchLine; men: NextMan[] }[] = [];
  for (const line of DRAW_ORDER) {
    for (let i = 0; i < (heldBy.get(line) ?? 0); i += 1) groups.push({ line, men: [] });
  }
  for (const man of club.contested) {
    if (!groups.length) break;
    const lines = linesOf(man);
    const fit = groups.filter((one) => lines.includes(one.line));
    const where = (fit.length ? fit : groups)
      .reduce((a, b) => (b.men.length < a.men.length ? b : a));
    where.men.push(man);
  }

  const rows: NextRow[] = [];
  for (const line of DRAW_ORDER) {
    const size = counts[line] ?? 0;
    if (!size) continue;
    const mine: Occupant[] = (here.get(line) as NextMan[]).map((man) => ({ man, men: [] }));
    const ours_: Occupant[] = groups.filter((one) => one.line === line)
      .map((one) => ({ man: null, men: one.men }));
    const spare: Occupant[] = Array.from(
      { length: Math.max(0, size - mine.length - ours_.length) },
      () => ({ man: null, men: [] }),
    );
    // DALLA DESTRA DELLA SQUADRA ALLA SUA SINISTRA, sul lato che i codici dichiarano: un `dd` non
    // finisce a sinistra perche' e' arrivato prima nella graduatoria dei voti. Un posto che nessuno
    // riempie non ha preferenze e va dove gli altri non vogliono stare.
    const ordered = laneOrder(mine.concat(ours_, spare), size, (one, x) => {
      if (one.man) {
        /*
         * I CODICI VENGONO PRIMA DELLA `x` DELLA NOSTRA BOARD, ed e' l'opposto di come era scritto.
         *
         * `Pc` e' un'affermazione su QUELL'UOMO - fa la punta centrale - mentre la `x` del nostro
         * campetto e' un'affermazione su un ALTRO undici: se li' il posto largo era quello che restava,
         * trasportarlo qui disegna un centravanti sull'ala (Lazio, Noslin: operatore, 19/09/2026). La
         * board resta preziosa dove i codici TACCIONO - `C`, `M`, `T`, `B` non dicono niente sulla
         * fascia, e li' il suo punto e' l'unica cosa che parla.
         */
        const codes = codesOf(one.man);
        if (laneKnown(codes)) return laneCost(codes, x);
        const at = xOf(one.man);
        return at === null ? 0 : Math.abs(at - x);
      }
      if (!one.men.length) return 0;
      // ...e per un gruppo vale la stessa precedenza: i codici di tutti i suoi, e la board solo se tacciono.
      const spoken = one.men.flatMap((man) => [...codesOf(man)]);
      if (!laneKnown(spoken)) {
        const xs = one.men.map((man) => xOf(man)).filter((at): at is number => at !== null);
        return xs.length ? Math.abs(xs.reduce((a, b) => a + b, 0) / xs.length - x) : 0;
      }
      // Il lato di un GRUPPO e' quello dei codici di tutti i suoi: `laneCost` fa gia' la media su
      // quelli che parlano, quindi due centrali tirano al centro e due esterni verso la loro fascia.
      return laneCost(spoken, x);
    });
    rows.push({
      line,
      places: ordered.map((one, at) => ({
        line,
        // L'ETICHETTA E' DEL POSTO, quindi non si presta a una riga che non e' la sua: la parola della
        // board dice «Dc» di un uomo che la board mette in difesa, e scriverla su un posto di
        // centrocampo sarebbe un'etichetta falsa - meglio nessuna. (Roma: Lulli fra i centrocampisti.)
        badge: sided(
          one.man
            ? (homeOf(one.man) && homeOf(one.man) !== line ? null : badgeOf(one.man))
            : (one.men.length ? badgeOf(one.men[0]) : null),
          placeX(at, ordered.length),
        ),
        man: one.man,
        contested: one.men,
        alternatives: [],
      })),
    });
  }

  // UN NOME SI MOSTRA UNA VOLTA SOLA, nel posto piu' adatto a LUI (operatore, 18/09/2026: Vergara
  // compariva sotto De Bruyne e sotto Lang, perche' i suoi codici lo mettono su due righe).
  //
  // La riga la sceglie l'uomo e non noi: quella in cui la NOSTRA board lo disegna, e se non lo disegna
  // la prima che i suoi codici nominano - cioe' il suo codice primario, che e' l'ordine in cui il
  // listone li scrive. Dentro quella riga va sotto il titolare MENO votato, che e' la maglia piu'
  // contendibile; se la sua riga non ha nessun posto contendibile si guarda fra le altre che puo'
  // giocare, e se non ce n'e' nessuna non si mostra affatto - e' uno fuori dagli undici, non un
  // ballottaggio inventato.
  const open = rows.flatMap((row) => row.places)
    .filter((place): place is Writable & { man: NextMan } =>
      !!place.man && !(place.man.of > 0 && place.man.votes === place.man.of));
  for (const man of club.out) {
    const lines = linesOf(man);
    if (!lines.length) continue;
    // NON si chiama `home`: quello e' gia' il nome della funzione di sopra, e due significati sotto un
    // nome solo dentro la stessa funzione sono il posto in cui il prossimo lettore sbaglia.
    const hisLine = homeOf(man) ?? lines[0];
    const mine = open.filter((place) => place.line === hisLine);
    const where = mine.length ? mine : open.filter((place) => lines.includes(place.line));
    if (!where.length) continue;
    const best = where.reduce((a, b) => (b.man.votes < a.man.votes ? b : a));
    (best.alternatives as NextMan[]).push(man);
  }

  // NESSUNO SPARISCE DALLO SCHERMO. Se il posto rimasto vuoto e' di una linea che i contesi non possono
  // giocare, senza questa riga i due nomi non si vedrebbero da nessuna parte - e con la lista tolta
  // sarebbero spariti del tutto, che e' peggio di un posto disegnato male: chi guarda non saprebbe
  // nemmeno che c'e' una maglia in ballo.
  const shown = new Set(rows.flatMap((row) => row.places).flatMap((place) => place.contested));
  const orphans = club.contested.filter((man) => !shown.has(man));
  const empty = rows.flatMap((row) => row.places).filter((place) => !place.man && !place.contested.length);
  if (orphans.length && empty.length) {
    const at = empty[0] as { man: NextMan | null; contested: readonly NextMan[] };
    (at as { contested: readonly NextMan[] }).contested = orphans;
  }
  const named = chosen.filter((one) => !reps.includes(one.man)).length;
  return { shape, by: by.slice(), ours, rows, named, orphans: orphans.length && !empty.length
    ? orphans.slice() : [] };
}

/**
 * UN MARCATORE NON PUO' RIVENDICARE UN LATO CHE NON E' IL SUO.
 *
 * I marcatori del pannello arrivano a coppie (`Ad`/`As`, `Td`/`Ts`, `Ed`/`Es`): dicono il mestiere E la
 * fascia. Qui il posto lo decide questo disegno, non quello da cui il marcatore viene, e i due possono
 * non essere d'accordo - Noslin, che il listone chiama `a` senza fascia, e' disegnato al CENTRO del
 * tridente e si portava dietro l'`Ad` della nostra board (operatore, 19/09/2026). Dove il lato non
 * torna si toglie il lato e resta il mestiere: `Ad` diventa `A`, che e' vero comunque.
 */
function sided(badge: string | null, x: number): string | null {
  if (!badge || badge.length < 2) return badge;
  const side = badge.slice(-1).toLowerCase();
  if (side !== 'd' && side !== 's') return badge;
  const right = x < 0.4;
  const left = x > 0.6;
  if ((side === 'd' && right) || (side === 's' && left)) return badge;
  return badge.slice(0, -1);
}

/** Chi occupa un posto: un uomo, un gruppo che si contende la maglia, o nessuno. */
interface Occupant {
  man: NextMan | null;
  men: NextMan[];
}

/**
 * COME SI DISPONE UNA RIGA, dalla destra della squadra alla sua sinistra.
 *
 * Si CERCA la disposizione che costa meno, invece di ordinare per «quanto sta male all'estrema destra»:
 * quel criterio metteva un `Pc` sull'ala tutte le volte che di lui non si sapeva altro, perche' `laneCost`
 * risponde ZERO a chi non ha nessun codice che parli - e zero, in un ordinamento crescente, vuol dire
 * «primo» invece di «dove capita» (Lazio: Noslin e Pinamonti, due punte centrali, disegnati larghi).
 *
 * Le righe sono di cinque uomini al massimo, quindi le permutazioni sono al piu' 120 e il minimo si
 * trova ESATTO: nessuna euristica, nessuna priorita' da fissare fra il lato e la linea - che e' proprio
 * la scelta che il pannello del toolkit ha misurato come sbagliata in tutt'e due gli ordini.
 * A parita' di costo vince l'ordine in cui sono arrivati, che e' quello dei voti: deterministico.
 */
function laneOrder<T>(
  men: readonly T[],
  size: number,
  cost: (one: T, x: number) => number,
): T[] {
  if (men.length < 2) return men.slice();
  const xs = men.map((_, at) => placeX(at, Math.max(size, men.length)));
  let best: T[] = men.slice();
  let bestCost = Infinity;
  const walk = (left: readonly T[], acc: T[], sum: number): void => {
    if (sum >= bestCost) return;                  // nessuna coda puo' piu' migliorare
    if (!left.length) {
      bestCost = sum;
      best = acc.slice();
      return;
    }
    for (let i = 0; i < left.length; i += 1) {
      acc.push(left[i]);
      walk(left.slice(0, i).concat(left.slice(i + 1)), acc, sum + cost(left[i], xs[acc.length - 1]));
      acc.pop();
    }
  };
  walk(men, [], 0);
  return best;
}

/** Un posto mentre lo si costruisce: le alternative si attaccano dopo, quando si sa chi va dove. */
type Writable = { line: PitchLine; badge: string | null; man: NextMan | null;
  contested: readonly NextMan[]; alternatives: readonly NextMan[] };

/** Le linee di un modulo, ma solo se ne fa UNDICI: altrimenti non e' un modulo e si dice null. */
function elevenPlaces(shape: string): Record<PitchLine, number> | null {
  const counts = lineCounts(shape);
  if (!counts) return null;
  const total = DRAW_ORDER.reduce((sum, line) => sum + (counts[line] ?? 0), 0);
  return total === ELEVEN ? counts : null;
}

/** Questi undici riempiono tutte le linee di quel modulo? La contesa entra con ogni scelta possibile. */
function fits(club: NextClub, linesOf: (man: NextMan) => readonly PitchLine[], shape: string): boolean {
  const counts = elevenPlaces(shape);
  if (!counts) return false;
  const slots: string[][] = [];
  for (const line of DRAW_ORDER) {
    for (let i = 0; i < (counts[line] ?? 0); i += 1) slots.push([line]);
  }
  const fixed = club.certain.map((man) => ({ roles: [...linesOf(man)] }));
  if (!club.contestedPlaces) return assign(fixed, slots).chosen.length === slots.length;
  for (const pick of pickFrom(club.contested, club.contestedPlaces)) {
    const all = fixed.concat(pick.map((man) => ({ roles: [...linesOf(man)] })));
    if (assign(all, slots).chosen.length === slots.length) return true;
  }
  return false;
}

/** Tutti i modi di prendere `k` di questi. `k` e' al piu' due o tre, e la lista al piu' una manciata. */
function pickFrom<T>(items: readonly T[], k: number): T[][] {
  if (k <= 0) return [[]];
  if (k > items.length) return [];
  const out: T[][] = [];
  const walk = (at: number, acc: T[]): void => {
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (let i = at; i < items.length; i += 1) { acc.push(items[i]); walk(i + 1, acc); acc.pop(); }
  };
  walk(0, []);
  return out;
}
