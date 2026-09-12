import { MantraModules, demandFromShapes, slotShares } from './auction-value';
import { PlayOutlook } from './expected-play';
import { orderedBy } from './manual-order';
import { GOOD_MATCH, LONG_SHIFT, MatchFrequencies, POOR_MATCH, THIN_SAMPLE } from './match-frequency';
// IL SEI e la soglia della SUFFICIENZA sono due domande diverse sullo stesso numero, e ognuna vive dove
// e' stata decisa: `EDGE_BASE` e' la media di riferimento di un voto (quanto un uomo RENDE sopra di
// essa), `PASS_MARK` e' la soglia che il regolamento paga (`steadyOf` conta le partite chiuse almeno
// li'). Lette da dove stanno, mai ritrascritte: due copie di un 6 finirebbero per non essere d'accordo
// il giorno in cui una delle due domande cambia risposta.
import { EDGE_BASE } from './plancia';
import { MOSTLY_ANCHOR } from './player-ratings';
import { ClassicRole } from './players-store';
import { titolaritaRank } from './titolarita';

/**
 * LA STRATEGIA D'ASTA: quanti uomini di ogni ruolo la stanza comprerà, e quali sono i migliori.
 *
 * Questa pagina non prevede nessun calciatore. Come le buste chiuse, tutto quello che sta qui è una
 * DEDUZIONE dal regolamento della lega e dai moduli schierabili - la valutazione è quella del foglio,
 * letta e mai ricalcolata - e la sola cosa che decide è quanti nomi vale la pena avere sotto gli occhi
 * per ogni ruolo. È lo stesso confine che tiene la board di un club vero nel toolkit e l'undici di una
 * fanta-rosa nell'app: là c'è un allenatore da prevedere, qui c'è un regolamento da leggere.
 *
 * Due decisioni di modello, entrambe dichiarate perché nessun gate le possiede:
 *
 *  - QUALE NUMERO ORDINA LA LISTA (il «gain») dipende dal TIPO D'ASTA, e non è una preferenza: è
 *    misurato (`docs/model/metrica-asta-surplus-v1.md` §15-§16, cinque finestre di euro/mantra). In
 *    un'asta a RILANCI la risorsa scarsa è il credito, cioè esattamente quello che il surplus sottrae,
 *    e il surplus è la valuta giusta; in un DRAFT non si spendono crediti ma PICK, e il surplus addebita
 *    una scarsità per-slot che il regolamento non impone (-4,0% contro il tavolo, -15,7% su una
 *    finestra), quindi la valuta è il VALORE - fantapunti lordi, portiere compreso.
 *  - QUANTI NOMI PER BLOCCO: la domanda della stanza intera per quel ruolo (vedi `demandOf`).
 *
 * Un limite da dire e non da nascondere: la misura del draft è stata fatta su MANTRA. Su classic il
 * banco dei draft ha misurato la RAZIONE per ruolo (§17) e non la valuta, quindi «draft + classic»
 * estende una conclusione fuori dalla popolazione su cui è stata presa. È scritto qui perché il giorno
 * che qualcuno la misura, questo è il posto da correggere.
 */

/** Come si compra: a crediti con i rilanci, o a turno di scelta. Cambia la valuta, non la valutazione. */
export type AuctionKind = 'rilanci' | 'draft';

/** Quale dei due giochi si gioca: cambia il vocabolario dei ruoli e la forma della rosa. */
export type StrategyGame = 'classic' | 'mantra';

/**
 * LA COMPOSIZIONE DELLA ROSA, nei termini in cui il gioco la dichiara - e sono due giochi diversi.
 *
 * Classic conta per macro-ruolo (3 portieri, 8 difensori, 8 centrocampisti, 6 attaccanti) perché è per
 * macro-ruolo che il regolamento vincola una formazione. Mantra no: i posti sono TIPATI e molti
 * accettano una scelta di ruoli, quindi la rosa non ha quote per ruolo - ha un numero di portieri e un
 * numero di uomini di movimento, e quanti difensori servano lo dicono i moduli.
 */
export interface RosterShape {
  classic: Record<ClassicRole, number>;
  mantra: { por: number; mov: number };
}

/** Il regolamento della lega come lo dichiara l'operatore: niente di questo sta nel bundle. */
export interface StrategySetup {
  game: StrategyGame;
  slots: RosterShape;
  /** I crediti di partenza. Non entra in nessun numero di questa pagina, e la barra lo dice. */
  budget: number;
  auction: AuctionKind;
  teams: number;
  /**
   * Come si legge un blocco. Inerte su classic - là un uomo ha un ruolo solo, quindi non esiste un
   * «posto più arretrato dei suoi» - e la pagina nasconde lo switch invece di offrire una scelta che non
   * cambia niente. Vedi `BlockView` e `blocksOf`.
   */
  view: BlockView;
}

/** I quattro ruoli del listone classic, nell'ordine in cui un listone si legge. */
export const CLASSIC_BLOCKS: ClassicRole[] = ['P', 'D', 'C', 'A'];

/**
 * I dodici ruoli del listone mantra, letti dal REGOLAMENTO e non trascritti qui.
 *
 * `mantra_modules.json` porta il suo elenco `roles` nell'ordine in cui il gioco li scrive; quando un
 * bundle più vecchio non lo porta, si ricavano dai posti stessi (l'unione di `slot_roles`), che è la
 * sola altra risposta che non sia una lista scritta a mano - e una lista scritta a mano è esattamente
 * quello che questo progetto non fa con i due rulebook.
 */
export function mantraBlocks(rules: MantraModules | null): string[] {
  if (!rules) return [];
  const declared = rules.roles ?? [];
  if (declared.length) return [...declared];
  const seen: string[] = [];
  for (const roles of Object.values(rules.slot_roles ?? {})) {
    for (const role of roles) if (!seen.includes(role)) seen.push(role);
  }
  return seen;
}

/** I blocchi di questo setup, nell'ordine in cui vanno disegnati. */
export function blockRolesOf(setup: StrategySetup, rules: MantraModules | null): string[] {
  return setup.game === 'classic' ? [...CLASSIC_BLOCKS] : mantraBlocks(rules);
}

/**
 * COME SI CHIAMA UN BLOCCO. Plurale, perché l'intestazione parla di una lista e non di un uomo: il
 * singolare lo porta già il badge del ruolo (`ui-role`), che è la stessa parola vista da vicino.
 */
export const BLOCK_LABEL: Record<string, string> = {
  P: 'Portieri',
  D: 'Difensori',
  C: 'Centrocampisti',
  A: 'Attaccanti',
  Por: 'Portieri',
  Dd: 'Difensori destri',
  Dc: 'Difensori centrali',
  Ds: 'Difensori sinistri',
  B: 'Braccetti',
  E: 'Esterni',
  M: 'Mediani',
  W: 'Ali',
  T: 'Trequartisti',
  Pc: 'Punte centrali',
};

/**
 * ...e le due parole che il vocabolario dei due giochi scrive uguali e intende diverse.
 *
 * `C` è un centrocampista in classic e un CENTRALE in mantra, e sono due mestieri: chiamarli con la
 * stessa parola su una pagina che li disegna in blocchi diversi sarebbe la stessa etichetta su due
 * liste diverse, che è il difetto che questo progetto paga più spesso. `A` è l'altro caso: in classic
 * è l'attaccante, in mantra è l'attaccante ESTERNO, che accanto a `Pc` va detto.
 */
const MANTRA_LABEL: Record<string, string> = { C: 'Centrali', A: 'Attaccanti esterni' };

export function blockLabel(role: string, game: StrategyGame): string {
  if (game === 'mantra' && MANTRA_LABEL[role]) return MANTRA_LABEL[role];
  return BLOCK_LABEL[role] ?? role;
}

/**
 * QUANTI GOL E QUANTI ASSIST, contati: la coppia che le pastiglie `G:A` stampano `12:5`.
 *
 * Una coppia e non due numeri sciolti perche' e' UNA lettura - «quanto ha portato» - e tenerli insieme
 * e' cio' che impedisce a una riga di avere i gol di una stagione e gli assist di un'altra. I due
 * termini escono sempre dalla stessa somma degli stessi voti.
 *
 * I GOL COMPRENDONO I RIGORI TRASFORMATI e gli assist quelli da fermo (operatore, 06/09/2026): la riga
 * di una partita li tiene separati perche' valgono punti diversi, ma «quanti gol ha fatto» e' una
 * domanda sul calcio e non sul punteggio.
 */
export interface GoalsAssists {
  goals: number;
  assists: number;
}

/** Il minimo che una riga deve portare perché questo modulo possa ragionarci: il foglio la soddisfa. */
export interface StrategyBidder {
  fcId: number;
  name: string;
  club: string;
  clubId: number | null;
  /** Il ruolo di listone classic: è quello che decide il blocco quando si gioca a classic. */
  role: ClassicRole;
  /** ...e i ruoli mantra dello stesso listone: `['Dc', 'Ds']`. Un uomo sta in ogni blocco che nomina. */
  mantraCodes: string[];
  /** `engine_surplus` o il suo ripiego dichiarato `est_surplus`. Letto, mai ricalcolato. */
  surplus: number | null;
  surplusIsEstimate: boolean;
  /** ...e il VALORE, l'altra metà dello stesso conto: `fm × pv`, senza sottrarre niente. */
  value: number | null;
  valueIsEstimate: boolean;
  /**
   * LO SWING: i gol di classifica che fa segnare (`core/swing.ts`).
   *
   * È il terzo modo di leggere gli stessi due numeri del motore, e la differenza sta nell'UNITÀ: il
   * surplus e il valore sono fantapunti, questa sono GOL — e la lega paga gol, con una scala che
   * tronca a 66 e quindi non è proporzionale ai punti. Sta in piedi sul surplus, quindi eredita la
   * sua stima: `surplusIsEstimate` vale per tutt'e due.
   *
   * OPZIONALE, e non per pigrizia: chi costruisce la riga puo' non avere ancora la COSTANZA, che non
   * sta sul foglio e la misura `PlayerRatings` sui voti veri. Un lettore che non la passa lascia il
   * campo assente e la pastiglia non si stampa - «vuoto = ignoto» - invece di ricevere un numero
   * costruito su una costanza che nessuno ha letto.
   */
  swing?: number | null;
  /**
   * LA TITOLARITA' IN UNA PAROLA, gia' RISOLTA: la dritta dichiarata se c'e', altrimenti il gradino
   * del foglio (richiesta dell'operatore, 07/09/2026).
   *
   * Risolta da chi costruisce la riga e non qui, perche' `readingsOf` e' pura e non deve poter leggere
   * una dichiarazione: una pastiglia che leggesse `desc_titolarita` da sola direbbe la parola del
   * modello accanto a una card che mostra la tua, sullo stesso uomo e nella stessa schermata.
   */
  titolarita?: string | null;
  /**
   * IL CONTO DELLE GIORNATE che gioca davvero (`core/expected-play.ts`), con ogni pezzo separato.
   *
   * Era già calcolato e già usato - `pv`, `surplus` e `value` qui sopra sono tutti riscalati dal suo
   * `factor` - e non era DICHIARATO: la riga lo portava e il tipo non lo diceva. Dichiararlo serve
   * anche alla card, che deve poter spiegare PERCHÉ le presenze sono ridotte, e la finestra dello stop
   * aperto è dentro qui - non in una seconda chiamata accanto.
   */
  outlook: PlayOutlook;
  /*
   * LE QUATTRO LETTURE DELLE PASTIGLIE, e nessuna di loro ordina niente (vedi `ManReadings`).
   *
   * Stanno qui e non nella vista perché la pagina non possiede aritmetica: quello che il template fa è
   * scriverle. Sono i due numeri del motore già letti dal foglio (`fm`, `pv`), un terzo che il foglio
   * dichiara solo per una riga su due (`minutes`) e una MISURA che viene dalle sue stagioni
   * (`steady*`) - quattro cose di tre nature diverse, che è esattamente la ragione per cui
   * `readingsOf` le tiene separate invece di schiacciarle in una cifra.
   */
  /** La fantamedia che il motore si aspetta di lui, PER PARTITA GIOCATA (`engine_fm_pred`/`est_fm`). */
  fm: number | null;
  /**
   * ...e la META' DI QUEL NUMERO CHE E' IL VOTO (`est_mv`): la fantamedia meno i bonus.
   *
   * Le due sono una COPPIA DERIVATA e il foglio ne predice una - la MV - lasciando cadere l'altra
   * (spec «Novita' v9.59»): il tasso di bonus e' `fm - mv`, quindi «bonus a partita medio» e' una
   * sottrazione fra due colonne del foglio e non una quinta previsione.
   */
  mv: number | null;
  /** Le partite in cui si aspetta un VOTO, sul calendario del foglio (`engine_pv_pred`/`est_pv`). */
  pv: number | null;
  /**
   * I minuti che si aspetta quando gioca (`desc_minutes_next`), che è una PREVISIONE e non la media
   * della stagione scorsa (`engine/minutes.py`, +7,6% su due finestre retrodatate).
   *
   * Vuoto su 244 righe di 602 del foglio Serie A - la colonna la scrive lo stesso passo che disegna gli
   * undici, quindi manca dove manca il disegno - e allora la pastiglia non si stampa: «vuoto = ignoto».
   */
  minutes: number | null;
  /** La quota di partite che chiude con almeno la sufficienza, MISURATA sui voti che ha preso davvero. */
  steady: number | null;
  /** ...e quanta parte di quella quota è sua: 0 = solo l'ancora del suo ruolo al suo club. */
  steadyWeight: number;
  /** La frase che quella quota scrive di sé: il campione, la finestra, la mediana del suo ruolo. */
  steadyNote: string;
  /**
   * IL SUO CALCIO, UNA STAGIONE PER VOCE - piu' `WHOLE_CAREER`, che le tiene tutte insieme.
   *
   * Prima del 12/09/2026 erano dieci campi sciolti con la stagione cablata nel nome (`seasonMv`,
   * `gaPrev`, `frequencies`...): la lettura e la sua stagione erano la stessa cosa, e per vedere la
   * media voto di due stagioni bisognava dichiarare due letture. Ora la stagione e' una CHIAVE, e la
   * riga ne porta quante ne servono.
   *
   * CHI COSTRUISCE LA RIGA RIEMPIE SOLO LE STAGIONI CHIESTE, perche' meta' di questi numeri costa un
   * caricamento da 2,1 MB: `mv` e `fm` vengono dall'aggregato di stagione (gia' in casa, undici
   * stagioni), tutto il resto dal livello per-partita. Una stagione assente si legge come «non lo
   * sappiamo», che e' quello che e'.
   *
   * OPZIONALE come lo SWING, e per la stessa ragione: un lettore che non lo passa lascia il campo
   * assente e le pastiglie stagionali non si stampano.
   */
  seasons?: ReadonlyMap<string, SeasonFootball>;
  /**
   * IL FANTAVALORE DI MERCATO del suo listone, nella valuta del gioco dichiarato.
   *
   * E' un PREZZO, non una nostra opinione, e questa pagina lo MOSTRA senza farlo entrare in niente («la
   * quotazione la usiamo quando non abbiamo altre risorse oggettive»). Vuoto = quel listone non lo
   * quota, che non e' zero.
   */
  fvm: number | null;
  /**
   * QUELLO CHE UNA STANZA VERA HA PAGATO per lui, nella valuta della lega DICHIARATA.
   *
   * Letto da `AuctionPricesStore` e mai ricalcolato: e' un fatto sul MERCATO e non su di lui, quindi
   * non entra nel gain, non riordina niente e nessuna valutazione lo moltiplica. Vuoto = nessuna asta
   * vera l'ha messo all'incanto abbastanza volte, che non e' «costa zero».
   */
  paid?: number | null;
  /** In quante delle aste di riferimento qualcuno l'ha preso, su quante: 15/15 = lo prendi ora. */
  paidSold?: number | null;
  paidSoldOf?: number | null;
}

/**
 * LE TRE PASTIGLIE di una riga (richiesta dell'operatore, 04/09/2026): quanto rende una sua partita,
 * quante ne gioca - e di quelle quante le chiude bene - e quanto ci resta dentro.
 *
 * NON ORDINANO NIENTE, ed è una decisione: la lista è ordinata dal GAIN, e la stessa disciplina che la
 * plancia applica alla sua colonna vale qui - «due numeri, due domande, mai una cifra sola». Quello che
 * queste tre fanno è SPIEGARE il gain, non contraddirlo: `edge` dice quanto vale una sua partita,
 * `played` quante ne gioca, e il gain è (quasi) il loro prodotto meno il rimpiazzo.
 *
 * LA SECONDA PASTIGLIA MESCOLA DUE NATURE, e va detto qui invece di scoprirlo al tavolo. `played` è una
 * PREVISIONE del motore, la quota di sufficienze è una MISURA delle sue stagioni: il loro prodotto è
 * quindi «quante partite chiuderebbe bene SE tenesse il passo che ha tenuto finora». Questo progetto ha
 * già pagato una volta un numero che mescolava una misura e una previsione senza dirlo (il chip dei
 * minuti, 18/08/2026), e la cura fu dichiarare quale delle due cose fosse. Qui non c'è la terza strada
 * che là c'era - nessuno ha misurato una PREVISIONE della quota di sufficienze, e inventarne una
 * sarebbe una regola senza gate - quindi le due metà restano due numeri accanto (`24:20`) e il tooltip
 * dice quale è quale.
 */
/**
 * TUTTO IL CALCIO IN ARCHIVIO, come stagione: non e' una stagione, ed e' per questo che ha un nome suo.
 *
 * E' la finestra delle quattro frequenze (`match-frequency.ts`), misurata e non scelta: sulla stagione
 * in corso ognuno ha al massimo tre partite, e una quota su tre partite non e' una quota. Vive nello
 * stesso posto dove vivono le stagioni vere perche' risponde alla stessa domanda - «di quale calcio
 * stiamo parlando» - e tenerla altrove vorrebbe dire due modi di dirlo.
 */
export const WHOLE_CAREER = 'tutte';

/**
 * UNA LETTURA E LA STAGIONE SU CUI SI LEGGE (operatore, 12/09/2026: «per ogni pill vorrei poter
 * selezionare la stagione di afferenza»).
 *
 * La stagione e' una DIMENSIONE della lettura e non una sua variante: `mv` e' sempre la media voto, e
 * `mv@2025-26` dice su quale calcio. Prima della sua richiesta la stagione era CABLATA in ogni
 * pastiglia - `G:A 25/26` e `G:A 26/27` erano due chiavi diverse per lo stesso numero - e dichiararla
 * una volta sola e' quello che permette di averne due accanto senza dichiararne due.
 *
 * `season` e' `null` per le letture che vengono dal FOGLIO: sono la previsione per la stagione che si
 * sta comprando, e offrire una stagione a `Pa` significherebbe promettere «le partite attese del
 * 2024-25», che non esiste - una previsione di una stagione finita non e' una previsione.
 */
export interface ReadingRef {
  key: ReadingKey;
  season: string | null;
}

/** Come una lettura si scrive in una preferenza salvata e in una chiave d'ordinamento: `mv@2025-26`. */
export function refText(ref: ReadingRef): string {
  return ref.season ? `${ref.key}@${ref.season}` : ref.key;
}

/**
 * ...e come si rilegge. `null` per quello che questa versione non capisce piu'.
 *
 * LE DUE COPPIE `G:A` SI MIGRANO invece di essere buttate: erano `gaPrev` e `gaNow`, cioe' la stessa
 * lettura con la stagione scritta dentro la chiave, e chi le aveva accese ieri deve ritrovarle accese
 * oggi. Le due stagioni le passa chi chiama, perche' sono un fatto del pacchetto e non di questo file.
 */
export function readRef(text: unknown, seasons: { target: string; input: string }): ReadingRef | null {
  if (typeof text !== 'string' || !text) return null;
  if (text === 'gaPrev') return { key: 'ga', season: seasons.input };
  if (text === 'gaNow') return { key: 'ga', season: seasons.target };
  const [key, season] = text.split('@');
  const spec = READINGS.find((one) => one.key === key);
  if (!spec) return null;
  if (!spec.seasonal) return { key: spec.key, season: null };
  return { key: spec.key, season: season || defaultSeasonOf(spec, seasons) };
}

/** La stagione su cui una lettura si legge quando nessuno ha scelto: quella che la sua spec dichiara. */
export function defaultSeasonOf(spec: ReadingSpec, seasons: { target: string; input: string }): string {
  if (spec.season === 'career') return WHOLE_CAREER;
  if (spec.season === 'input') return seasons.input;
  return seasons.target;
}

/** Due riferimenti sono lo stesso: una lettura puo' essere accesa su piu' stagioni, non due volte sulla stessa. */
export function sameRef(one: ReadingRef, other: ReadingRef): boolean {
  return one.key === other.key && one.season === other.season;
}

/**
 * IL CALCIO DI UNA STAGIONE, come la riga lo legge - e le fonti NON sono la stessa.
 *
 * `mv` e `fm` vengono dall'AGGREGATO di stagione (`season_stats`), che il pacchetto porta per undici
 * stagioni e che e' gia' in casa: chiedere la media voto di un'altra stagione non costa un caricamento.
 * Tutto il resto viene dal LIVELLO PER-PARTITA, che e' 2,1 MB e si chiede solo quando serve - ed e'
 * anche la ragione per cui le due meta' hanno denominatori diversi, cosa che questa pagina dichiara da
 * quando le pastiglie esistono.
 *
 * Vuoto e non zero dappertutto: chi non ha giocato quella stagione non ha una media, non ha una media
 * di zero.
 */
export interface SeasonFootball {
  /** Le giornate con un voto di quella stagione (`season_stats.pv`): il campione di `mv` e `fm`. */
  played: number | null;
  mv: number | null;
  fm: number | null;
  /** I gol per partita GIOCATA, rigori compresi (dal livello per-partita). */
  goals: number | null;
  assists: number | null;
  xg: number | null;
  xa: number | null;
  /** ...e gli stessi gol e assist CONTATI: la stessa lettura in un'altra unita'. */
  ga: GoalsAssists | null;
  /** Le quattro frequenze di quella finestra (`match-frequency.ts`). */
  frequencies: MatchFrequencies | null;
}

export interface ManReadings {
  /**
   * IL BONUS A PARTITA MEDIO: `fantamedia attesa − media voto attesa`, cioe' quanto dei suoi punti NON
   * viene dal voto.
   *
   * E' la definizione che l'operatore ha dettato il 18/08/2026 per la colonna «Bonus» («i bonus da
   * soli, `FMa − MVa`, così la formula dell'Overall si legge sulla riga») e da oggi e' anche il nome
   * della pastiglia. NON e' `fm − 6`, che e' un'altra domanda - quanto rende una sua partita rispetto
   * alla sufficienza - e vive sulla plancia con quel nome (`EDGE_BASE`): due quantita', due nomi, mai
   * una cifra sola.
   */
  bonus: number | null;
  /** `fantamedia attesa − 6`, per PARTITA GIOCATA. Null quando il foglio non lo prezza affatto. */
  edge: number | null;
  /** Le partite con un voto che il motore si aspetta, sul calendario di questo foglio. */
  played: number | null;
  /** ...e quante di quelle chiuse con almeno la sufficienza: `played × costanza`. */
  passed: number | null;
  /** Se quella quota è SUA o l'ancora del suo ruolo: sotto `MOSTLY_ANCHOR` è spannometrica. */
  passedIsHis: boolean;
  /** I minuti attesi quando gioca. Vuoto dove il foglio non li dichiara, mai zero. */
  minutes: number | null;
  /**
   * IL SUO CALCIO, UNA STAGIONE PER VOCE - piu' `WHOLE_CAREER`, che e' tutto insieme.
   *
   * Una MAPPA e non dieci campi sciolti, da quando la stagione si sceglie (operatore, 12/09/2026): con
   * i campi sciolti «la media voto» e «di quale stagione» erano la stessa cosa, e per averne due
   * accanto bisognava dichiarare due letture. Qui la lettura e' una e la stagione e' una chiave.
   *
   * DENTRO C'E' SOLO QUELLO CHE E' STATO CHIESTO: chi costruisce la riga riempie le stagioni che le
   * pastiglie accese e il filtro nominano, perche' meta' di questi numeri costa un caricamento da 2,1
   * MB. Una stagione assente e una stagione senza calcio si leggono uguale - entrambe «non lo sappiamo»
   * - ed e' giusto cosi': la pagina non chiede quello che non mostra.
   */
  seasons: ReadonlyMap<string, SeasonFootball>;
  /** Il fantavalore del listone: un PREZZO, e l'unico numero di questa riga che non e' nostro. */
  fvm: number | null;
  /**
   * IL PREZZO PAGATO DA UNA STANZA VERA, nella valuta della lega dichiarata.
   *
   * L'altro prezzo della riga, e i due dicono cose diverse: il FVM e' quanto l'autore del listone
   * pensa che valga, questo e' quanto dieci manager hanno tirato fuori. Divergono in modo MISURATO e
   * sistematico - sopra gli 80 di FVM un attaccante costa 1,09 volte il suo FVM, un centrocampista
   * 0,79 - quindi tenerli come due pastiglie e non come una e' la stessa disciplina dei due zeri
   * («Lead» e «Margine»): due domande, due nomi, mai una cifra sola.
   */
  paid: number | null;
  /** Su quante aste di riferimento e' stato comprato, e su quante: la meta' che un prezzo non porta. */
  paidSold: number | null;
  paidSoldOf: number | null;
  /** Lo SWING: i gol di classifica che fa segnare, nell'unita' con cui la lega assegna i punti. */
  swing: number | null;
  /**
   * LA TITOLARITA' IN UNA PAROLA (richiesta dell'operatore, 07/09/2026: «nella pagina strategia,
   * aggiungi anche la possibilita' di vedere la titolarita' dei calciatori»).
   *
   * E' l'unica lettura che porta una PAROLA e non un numero, e per questo la sua `ReadingSpec` ha
   * `word`: le altre si stampano con `DecimalPipe`. Ordina per la SCALA (`titolaritaRank`) e non per la
   * sigla, che darebbe l'alfabeto - BAL, BAN, PAN... - al posto dei gradini.
   *
   * Il valore lo risolve chi costruisce la riga, perche' la DRITTA dichiarata batte il foglio: una
   * pastiglia che leggesse `desc_titolarita` direbbe la parola del modello accanto a una card che
   * mostra la tua.
   */
  titolarita: string | null;
}

/**
 * LE UNDICI LETTURE CHE UNA RIGA PUO' MOSTRARE, e quali sono accese all'inizio.
 *
 * Richiesta dell'operatore (05/09/2026): al posto della scritta in barra, una fila di pastiglie
 * cliccabili che accendono e spengono ognuno di questi numeri sulla riga. L'ELENCO sta qui e non nella
 * vista perche' l'ordine e i nomi sono un fatto sul vocabolario di questa pagina - e perche' un test lo
 * raggiunge senza un browser.
 *
 * NESSUNA DI LORO ORDINA NIENTE, ed e' la stessa decisione di sempre: la lista e' ordinata dal GAIN, e
 * quello che queste fanno e' SPIEGARLO. Accendere una colonna non cambia una graduatoria.
 *
 * E I SUGGERIMENTI SONO CORTI, poche parole per dire cosa vuol dire quella sigla: e' la regola
 * dell'operatore del 05/09/2026 («i tooltip devono essere SEMPRE brevi e sintetici ... quando voglio
 * spiegazioni piu' dettagliate te lo indico io»). Il PERCHE' di un numero sta nei commenti del codice e
 * nei documenti, che e' dove si legge una volta invece che cento.
 */
export type ReadingKey =
  | 'bonus' | 'played' | 'passed' | 'minutes' | 'mv' | 'fm' | 'goals' | 'assists' | 'xg' | 'xa'
  // UNA SOLA `G:A` dal 12/09/2026: erano `gaPrev` e `gaNow`, cioe' la stessa lettura con la stagione
  // scritta dentro la chiave. Da quando la stagione si sceglie, due chiavi per un numero sarebbero due
  // vocabolari per la stessa cosa - e chi le aveva accese le ritrova, perche' `readRef` le migra.
  | 'ga' | 'fvm' | 'swing' | 'titolarita' | 'paid'
  // LE QUATTRO FREQUENZE (operatore, 12/09/2026). Stanno in fondo all'elenco e non accanto a `passed`,
  // che e' la lettura piu' simile, per una ragione che si vede a schermo: sono le uniche che non
  // parlano della stagione in corso, e una fila di pastiglie si legge da sinistra come si legge una
  // frase - prima quello che il motore si aspetta, poi quello che ha fatto quest'anno, poi la sua
  // abitudine.
  | 'longPlay' | 'goodMatch' | 'bonusMatch' | 'poorMatch';

export interface ReadingSpec {
  key: ReadingKey;
  /** La sigla sulla pastiglia, che e' quella che l'operatore ha dettato. */
  short: string;
  label: string;
  hint: string;
  /** Le cifre con cui si stampa, in vocabolario `DecimalPipe`: un voto ne vuole due, una presenza zero. */
  format: string;
  /** Se il segno si stampa anche quando e' positivo: vale per le differenze e per nient'altro. */
  signed?: boolean;
  /**
   * LA PASTIGLIA PORTA UNA PAROLA e non una cifra (oggi solo la titolarita').
   *
   * Dichiarato qui e non dedotto dalla chiave: chi disegna deve sapere di NON passare per
   * `DecimalPipe` - e un `format` letto su una stringa stampa `NaN`, che e' il modo in cui una colonna
   * nuova finisce a schermo sbagliata invece che vuota.
   */
  word?: true;
  /** Cosa segue il numero, quando l'unita' non e' ovvia. */
  suffix?: string;
  /** Quanto e' larga la sua pastiglia: le pastiglie sono INCOLONNATE, quindi la larghezza e' fissa e
   *  non dipende dal numero - una fila di riquadri uguali si scorre a colpo d'occhio. */
  width: string;
  /**
   * SU CHE CALCIO SI LEGGE QUANDO NESSUNO HA SCELTO, o niente se il numero sta gia' nel foglio.
   *
   * `target` e' la stagione che si sta comprando, `input` quella che il manifest dichiara come input
   * (`input_season`): due stagioni LETTE dal pacchetto, mai un anno meno uno. `career` e' TUTTE quelle
   * che il pacchetto porta, che e' la sola finestra in cui una frequenza sia una frequenza (vedi
   * `match-frequency.ts`).
   *
   * Da oggi e' il DEFAULT e non il vincolo: `seasonal` dice che si puo' cambiare.
   */
  season?: 'target' | 'input' | 'career';
  /**
   * LA STAGIONE SI PUO' SCEGLIERE (operatore, 12/09/2026), e non tutte le letture possono.
   *
   * Quelle del FOGLIO non possono, e non e' una dimenticanza: `Pa` e' quello che il motore si aspetta
   * per la stagione che si sta comprando, e «le partite attese del 2024-25» non esiste - una previsione
   * di una stagione finita non e' una previsione, e' un esito, che ha un altro nome e un'altra colonna.
   * Le letture stagionali sono quelle che descrivono CALCIO GIOCATO.
   */
  seasonal?: true;
  /**
   * ...e puo' essere letta anche su TUTTO il calcio in archivio (`WHOLE_CAREER`), non solo su una
   * stagione: vale per le quattro frequenze, che su tre partite non sarebbero una quota.
   */
  whole?: true;
  /**
   * IL NUMERO VIENE DAL LIVELLO PER-PARTITA, cioe' costa un caricamento da 2,1 MB.
   *
   * E' la sola dichiarazione da cui si deriva cosa caricare (`wantsPlayedFootball`, `seasonsNeeded`):
   * `mv` e `fm` vengono dall'aggregato di stagione, che e' gia' in casa per undici stagioni, quindi
   * chiedere la media voto di un'altra stagione e' gratis - e il resto no. Due elenchi della stessa
   * cosa sono come una pastiglia finisce per accendersi su una casella vuota per sempre.
   */
  heavy?: true;
  /**
   * LA PASTIGLIA PORTA UNA COPPIA e non un numero: si stampa `12:5` e non si puo' ordinare.
   *
   * L'ordinamento e' escluso apposta, e non per pigrizia. Dietro `G:A` la somma sarebbe un numero
   * plausibile (i bonus portati), e ordinare per quella lascerebbe a schermo due cifre di cui nessuna
   * scende: e' esattamente «una colonna che spiega un ordinamento deve ESSERE quell'ordinamento»
   * (operatore, 03/09/2026), che questa pagina paga gia' in un punto. Chi vuole ordinare per i gol ha
   * `G`, che e' un numero solo e sale e scende da se'.
   */
  pair?: true;
  /**
   * LA SIGLA NOMINA LA SUA STAGIONE, perche' `G:A` esiste due volte.
   *
   * L'anno NON e' scritto qui: lo compone chi disegna, dalla stagione che il pacchetto dichiara
   * (`readingShort`). Cablarlo vorrebbe dire che il giorno in cui il bundle passa al 2027-28 la
   * pastiglia direbbe 26/27 sopra i numeri del 27/28 - un nome che non corrisponde al suo numero, che
   * e' peggio di una colonna mancante.
   */
  dated?: true;
}

export const READINGS: ReadingSpec[] = [
  {
    key: 'bonus',
    short: 'Bpm',
    label: 'Bonus a partita medio',
    hint: 'Fantamedia attesa meno media voto attesa, per partita.',
    format: '1.1-1',
    signed: true,
    width: 'min-w-9',
  },
  {
    key: 'played',
    short: 'Pa',
    label: 'Partite attese',
    hint: 'Giornate in cui il motore lo aspetta col voto.',
    format: '1.0-0',
    width: 'min-w-7',
  },
  {
    key: 'passed',
    short: 'Pas',
    label: 'Partite attese sufficienti',
    hint: 'Di quelle, quante le chiude almeno in 6.',
    format: '1.0-0',
    width: 'min-w-7',
  },
  {
    key: 'minutes',
    short: 'mp',
    label: 'Minuti medi a partita',
    hint: 'Minuti attesi quando gioca.',
    format: '1.0-0',
    suffix: '′',
    width: 'min-w-8',
  },
  {
    key: 'mv',
    short: 'MV',
    label: 'Media voto',
    hint: 'Media voto MISURATA della stagione scelta.',
    season: 'target',
    seasonal: true,
    format: '1.2-2',
    width: 'min-w-10',
  },
  {
    key: 'fm',
    short: 'FM',
    label: 'Fantamedia',
    hint: 'Fantamedia MISURATA della stagione scelta.',
    season: 'target',
    seasonal: true,
    format: '1.2-2',
    width: 'min-w-10',
  },
  {
    key: 'goals',
    short: 'G',
    label: 'Gol per partita',
    hint: 'Gol per partita giocata. Rigori compresi.',
    season: 'target',
    seasonal: true,
    heavy: true,
    format: '1.2-2',
    width: 'min-w-10',
  },
  {
    key: 'assists',
    short: 'A',
    label: 'Assist per partita',
    hint: 'Assist per partita giocata. Quelli da fermo compresi.',
    season: 'target',
    seasonal: true,
    heavy: true,
    format: '1.2-2',
    width: 'min-w-10',
  },
  {
    key: 'xg',
    short: 'xG',
    label: 'Gol attesi a partita',
    hint: 'Gol ATTESI per partita.',
    season: 'target',
    seasonal: true,
    heavy: true,
    format: '1.2-2',
    width: 'min-w-10',
  },
  {
    key: 'xa',
    short: 'xA',
    label: 'Assist attesi a partita',
    hint: 'Assist ATTESI per partita.',
    season: 'target',
    seasonal: true,
    heavy: true,
    format: '1.2-2',
    width: 'min-w-10',
  },
  // LA COPPIA CONTATA (operatore, 06/09/2026). Sta dopo le quattro medie perche' e' la stessa lettura
  // in un'altra unita', e porta l'ANNO perche' la stessa lettura puo' essere accesa su due stagioni -
  // l'anno lo compone `readingShort` dalla stagione del riferimento, mai da un'aritmetica.
  //
  // UNA E NON DUE dal 12/09/2026: `gaPrev`/`gaNow` erano questa stessa riga dichiarata due volte, con
  // la stagione cablata nella chiave. Da quando la stagione si sceglie, la seconda dichiarazione
  // sarebbe un secondo vocabolario per lo stesso numero.
  {
    key: 'ga',
    short: 'G:A',
    label: 'Gol e assist',
    hint: 'Gol e assist CONTATI della stagione scelta. Rigori e assist da fermo compresi.',
    // Un conteggio non ha decimali. Il formato resta dichiarato perche' e' chi disegna a usarlo, e una
    // coppia senza formato sarebbe l'unica riga di questo elenco a non dire come si stampa.
    format: '1.0-0',
    season: 'target',
    seasonal: true,
    heavy: true,
    pair: true,
    dated: true,
    width: 'min-w-12',
  },
  {
    key: 'fvm',
    short: 'FVM',
    label: 'Fantavalore di mercato',
    hint: 'Il prezzo del listone, nella valuta del gioco.',
    format: '1.0-0',
    width: 'min-w-9',
  },
  {
    key: 'paid',
    short: 'Prz',
    label: 'Prezzo pagato davvero',
    hint: 'Quanto e costato in aste vere del mese, nella valuta della tua lega.',
    format: '1.0-0',
    width: 'min-w-9',
  },
  {
    key: 'titolarita',
    // TRE CARATTERI come tutte le altre, e non `Tit.` con il punto della colonna della tabella: la
    // fila delle pastiglie deve restare compatta, e un test asserisce che l'unica sigla piu' lunga di
    // tre e' SWING - una seconda eccezione non entra in silenzio per un punto.
    short: 'Tit',
    label: 'Titolarita',
    hint: 'Quanto gioca, in una parola: BAN, TIS, TIT, BLT, PAN, RIS.',
    // Una parola non si formatta: il campo resta perche' la `ReadingSpec` e' una sola, e `word` dice
    // a chi disegna di non passare da `DecimalPipe`.
    format: '1.0-0',
    word: true,
    width: 'min-w-8',
  },
  {
    key: 'swing',
    // La sigla E' la parola intera: il termine a schermo e' SWING e non si abbrevia (operatore,
    // 06/09/2026). E' la piu' lunga della fila - le altre stanno in due o tre caratteri - e il prezzo
    // e' una pastiglia piu' larga, che e' meno caro di un'abbreviazione che nessuno ha dichiarato.
    short: 'SWING',
    label: 'SWING',
    hint: 'Punti a giornata sopra il 6 (portieri: sopra il 5).',
    // Due decimali su sua richiesta (07/09/2026): nella scala a giornata i valori vivono sotto il 2,
    // e a un decimale mezza lista leggeva uguale.
    format: '1.2-2',
    width: 'min-w-10',
  },
  // LE QUATTRO FREQUENZE (operatore, 12/09/2026). Si stampano in PERCENTUALE e non in quota: e' la
  // forma in cui una frequenza si legge, ed e' anche quella in cui si scrive un filtro («> 70» invece
  // di «> 0.7»). La conversione avviene in un punto solo, `readingValue`, cosi' il numero che il filtro
  // confronta e' lo stesso che la riga stampa.
  {
    key: 'longPlay',
    short: '85′',
    label: `Partite oltre l'${LONG_SHIFT}'`,
    hint: `Quota di partite giocate finite oltre l'${LONG_SHIFT}'.`,
    season: 'career',
    seasonal: true,
    whole: true,
    heavy: true,
    format: '1.0-0',
    suffix: '%',
    width: 'min-w-9',
  },
  {
    key: 'goodMatch',
    short: 'Fv+',
    label: `Partite da ${GOOD_MATCH}+`,
    hint: `Quota di partite con fantavoto almeno ${GOOD_MATCH}.`,
    season: 'career',
    seasonal: true,
    whole: true,
    heavy: true,
    format: '1.0-0',
    suffix: '%',
    width: 'min-w-9',
  },
  {
    key: 'bonusMatch',
    short: 'Bon',
    label: 'Partite con bonus',
    hint: 'Quota di partite con almeno un bonus: gol, assist, rigore parato.',
    season: 'career',
    seasonal: true,
    whole: true,
    heavy: true,
    format: '1.0-0',
    suffix: '%',
    width: 'min-w-9',
  },
  {
    key: 'poorMatch',
    short: 'Fv-',
    label: `Partite sotto il ${POOR_MATCH}`,
    hint: `Quota di partite con fantavoto sotto ${POOR_MATCH}.`,
    season: 'career',
    seasonal: true,
    whole: true,
    heavy: true,
    format: '1.0-0',
    suffix: '%',
    width: 'min-w-9',
  },
];

/** Quelle accese quando nessuno ha ancora scelto: le prime tre (operatore, 05/09/2026). */
export const DEFAULT_READINGS: ReadingKey[] = ['bonus', 'played', 'passed'];

/**
 * LE LETTURE CHE VOGLIONO IL LIVELLO PER-PARTITA, cioe' quelle che costano un caricamento da 2,1 MB.
 *
 * Gol, assist, attesi, la coppia contata e le quattro frequenze non stanno in nessun aggregato che
 * questa pagina legge da se': li porta `PlayersStore`. La media voto e la fantamedia SI' (`season_stats`,
 * undici stagioni gia' in casa), ed e' la ragione per cui chiedere la MV di un'altra stagione e' gratis
 * mentre chiedere i suoi xG non lo e'.
 *
 * DERIVATO da `ReadingSpec.heavy` e non riscritto: con due elenchi da tenere allineati la prossima
 * pastiglia si accenderebbe su una casella vuota per sempre.
 */
export const HEAVY_READINGS: ReadingKey[] = READINGS
  .filter((one) => one.heavy)
  .map((one) => one.key);

/** ...e quelle su cui la stagione si puo' scegliere. */
export const SEASONAL_READINGS: ReadingKey[] = READINGS
  .filter((one) => one.seasonal)
  .map((one) => one.key);

/**
 * SE SERVE IL LIVELLO PER-PARTITA, e quindi se lo store va chiesto.
 *
 * Si guarda cosa e' ACCESO e cosa il FILTRO interroga, non l'elenco delle letture: una pastiglia spenta
 * non costa niente, e una condizione su una lettura spenta costa eccome - senza, il filtro taglierebbe
 * la lista leggendo una colonna che nessuno ha caricato, cioe' svuoterebbe ogni blocco in silenzio.
 */
export function wantsPlayedFootball(refs: readonly ReadingRef[]): boolean {
  const heavy = new Set<ReadingKey>(HEAVY_READINGS);
  return refs.some((one) => heavy.has(one.key));
}

/**
 * QUALI STAGIONI DI CALCIO GIOCATO VANNO RICOSTRUITE: solo quelle che qualcuno guarda.
 *
 * `WHOLE_CAREER` e' una voce come le altre e vuol dire «tutte insieme», che e' una finestra e non una
 * stagione. Le stagioni delle letture NON pesanti non compaiono: la loro media voto e' gia' in casa.
 *
 * Ordinate come arrivano, senza doppioni: chi costruisce la riga cammina questa lista e paga una volta
 * per stagione, non una per pastiglia.
 */
export function seasonsNeeded(refs: readonly ReadingRef[]): string[] {
  const heavy = new Set<ReadingKey>(HEAVY_READINGS);
  const out: string[] = [];
  for (const ref of refs) {
    if (!ref.season || !heavy.has(ref.key)) continue;
    if (!out.includes(ref.season)) out.push(ref.season);
  }
  return out;
}

/**
 * LE STAGIONI CHE UNA LETTURA PUO' PRENDERE, dalle stagioni che il pacchetto porta.
 *
 * Le stesse tre per tutte le letture stagionali, piu' «tutte» dove la spec lo dichiara. Offrirne di
 * piu' alla media voto - l'aggregato ne porta undici - darebbe un menu' da imparare due volte, e una
 * pastiglia che offre il 2018-19 accanto a una che non puo' si legge come un guasto. Il giorno in cui
 * servisse, il dato per la MV c'e' gia': e' scritto qui perche' e' il posto da leggere.
 */
export function seasonsFor(spec: ReadingSpec, seasons: readonly string[]): string[] {
  if (!spec.seasonal) return [];
  return spec.whole ? [WHOLE_CAREER, ...seasons] : [...seasons];
}

/**
 * IL NUMERO DI UNA PASTIGLIA, dalla lettura e dalla STAGIONE che il riferimento nomina.
 *
 * Una funzione e non venti rami nel template: quale numero sta dietro una sigla e' vocabolario di
 * questa pagina, e un test lo raggiunge senza un browser. Null resta null - «vuoto = ignoto, mai zero»
 * - e la pastiglia allora stampa un trattino invece di uno zero che nessuno ha misurato.
 */
export function readingValue(ref: ReadingRef, readings: ManReadings): number | null {
  const football = ref.season ? readings.seasons.get(ref.season) : undefined;
  switch (ref.key) {
    // LA TITOLARITA' ORDINA PER LA SCALA, e il segno e' meno perche' la lista scende: `bandiera` e'
    // il gradino 0 e deve stare in cima. Ordinare per la sigla darebbe BAL, BAN, PAN, RIS, TIS, TIT,
    // cioe' l'alfabeto al posto dei gradini (`core/titolarita.ts` lo scrive di se').
    case 'titolarita': {
      const rank = titolaritaRank(readings.titolarita);
      return rank == null ? null : -rank;
    }
    case 'bonus':
      return readings.bonus;
    case 'played':
      return readings.played;
    case 'passed':
      return readings.passed;
    case 'minutes':
      return readings.minutes;
    case 'mv':
      return football?.mv ?? null;
    case 'fm':
      return football?.fm ?? null;
    case 'goals':
      return football?.goals ?? null;
    case 'assists':
      return football?.assists ?? null;
    case 'xg':
      return football?.xg ?? null;
    case 'xa':
      return football?.xa ?? null;
    // LA COPPIA NON HA UN NUMERO, e restituirne uno sarebbe inventare quale delle due cifre conta:
    // la somma ordinerebbe una pastiglia che stampa `12:5`, cioe' due cifre di cui nessuna scende.
    // Chi disegna passa da `readingPair`; chi ordina non la ha in elenco (`ReadingSpec.pair`).
    case 'ga':
      return null;
    case 'fvm':
      return readings.fvm;
    case 'paid':
      return readings.paid;
    case 'swing':
      return readings.swing;
    // LE QUATTRO FREQUENZE, dalla quota alla PERCENTUALE in un punto solo: la misura sta in 0-1 perche'
    // e' una quota, quello che si legge sta in 0-100 perche' e' una frequenza - e chi filtra confronta
    // quello che si legge. Due conversioni in due posti sarebbero due unita' per un numero.
    case 'longPlay':
      return percent(football?.frequencies?.long);
    case 'goodMatch':
      return percent(football?.frequencies?.good);
    case 'bonusMatch':
      return percent(football?.frequencies?.bonus);
    case 'poorMatch':
      return percent(football?.frequencies?.poor);
  }
}

function percent(share: number | null | undefined): number | null {
  return share == null ? null : share * 100;
}

/**
 * SU QUANTE PARTITE POGGIA UNA DELLE QUATTRO FREQUENZE, o `null` per ogni altra lettura.
 *
 * I denominatori sono TRE e non uno, ed e' un fatto sulle fonti e non una sottigliezza: i minuti li
 * porta il livello per-partita, il fantavoto i voti, i bonus la riga dei voti. Una giornata puo' avere
 * gli uni e non l'altro, quindi ogni quota dichiara il suo.
 */
export function frequencySample(ref: ReadingRef, readings: ManReadings): number | null {
  const counted = ref.season ? readings.seasons.get(ref.season)?.frequencies : null;
  if (!counted) return null;
  if (ref.key === 'longPlay') return counted.timed;
  if (ref.key === 'goodMatch' || ref.key === 'poorMatch') return counted.rated;
  if (ref.key === 'bonusMatch') return counted.played;
  return null;
}

/** LA COPPIA DI UNA PASTIGLIA, o `null` sia per chi non ne ha una sia per chi non l'ha giocata. */
export function readingPair(ref: ReadingRef, readings: ManReadings): GoalsAssists | null {
  if (ref.key !== 'ga' || !ref.season) return null;
  return readings.seasons.get(ref.season)?.ga ?? null;
}

/**
 * SE LA PASTIGLIA HA QUALCOSA DA STAMPARE, coppie comprese.
 *
 * Un lettore solo, perche' «la cella e' vuota» decide sia il testo sia il bordo che la disegna: due
 * condizioni scritte in due posti sono come un riquadro finisce per essere pieno e sbiadito.
 */
export function readingHas(ref: ReadingRef, readings: ManReadings): boolean {
  return readingValue(ref, readings) != null || readingPair(ref, readings) != null;
}

/**
 * SU QUANTE GIORNATE POGGIA LA MEDIA VOTO di una stagione: il campione che la riga dichiara.
 *
 * Dall'aggregato di stagione e non dal livello per-partita, che e' la stessa fonte da cui `mv` e `fm`
 * vengono: un campione letto da una parte e una media dall'altra sarebbero due numeri che parlano di
 * due popolazioni.
 */
export function seasonSample(season: string | null, readings: ManReadings): number | null {
  return season ? (readings.seasons.get(season)?.played ?? null) : null;
}

/**
 * LA STAGIONE COME SI SCRIVE SU UNA PASTIGLIA: `2025-26` -> `25/26`.
 *
 * Un TAGLIO della stringa che il pacchetto dichiara, mai un anno calcolato: la barra e' stretta e
 * quattro cifre sono due di troppo, ma quale stagione sia resta un fatto del manifest. Una stringa che
 * non ha quella forma torna com'e' - un'etichetta strana e' meglio di un'etichetta inventata.
 */
export function shortSeason(season: string): string {
  const parts = /^(\d{2})(\d{2})-(\d{2})$/.exec(season);
  return parts ? `${parts[2]}/${parts[3]}` : season;
}

/**
 * LA SIGLA COME SI LEGGE SULLA PASTIGLIA, con la stagione del RIFERIMENTO quando ne ha una.
 *
 * `dated` dice che la sigla nomina la sua stagione, e dal 12/09/2026 ogni lettura stagionale la nomina:
 * la stessa lettura puo' essere accesa su due stagioni, e due riquadri con lo stesso nome sarebbero due
 * numeri indistinguibili. `tutte` si scrive per esteso perche' non e' un anno.
 */
export function readingShort(spec: ReadingSpec, ref: ReadingRef): string {
  if (!ref.season || !spec.seasonal) return spec.short;
  return `${spec.short} ${ref.season === WHOLE_CAREER ? WHOLE_CAREER : shortSeason(ref.season)}`;
}

/**
 * SE QUEL NUMERO E' SPANNOMETRICO, cioe' se va SBIADITO.
 *
 * Vale per le partite sufficienti - una previsione moltiplicata per una quota MISURATA sulle sue
 * stagioni, e dove quella quota e' quasi tutta l'ancora del ruolo non e' sua - e per le quattro
 * FREQUENZE, dove la stessa domanda ha una risposta aritmetica: una quota e' grossolana quando una
 * partita in piu' la sposta di oltre dieci punti, cioe' sotto le `THIN_SAMPLE` partite.
 *
 * SBIADITE E NON NASCOSTE: la quota di un uomo con tre partite e' vera, e toglierla direbbe «non lo
 * sappiamo» di una cosa che sappiamo male. Un numero spannometrico che si legge come misurato e' la
 * cosa peggiore che una lista possa fare - e' la ragione del `~` sulle stime, applicata qui.
 */
export function readingIsRough(ref: ReadingRef, readings: ManReadings): boolean {
  if (ref.key === 'passed') return !readings.passedIsHis;
  const sample = frequencySample(ref, readings);
  return sample != null && sample < THIN_SAMPLE;
}

/** Le letture di un uomo. Pura: legge la riga e non tocca né il foglio né lo store. */
export function readingsOf(man: StrategyBidder): ManReadings {
  return {
    // Vuoto e non zero se una delle due metà manca: una sottrazione con un termine ignoto è ignota.
    bonus: man.fm == null || man.mv == null ? null : man.fm - man.mv,
    edge: man.fm == null ? null : man.fm - EDGE_BASE,
    played: man.pv,
    passed: man.pv == null || man.steady == null ? null : man.pv * man.steady,
    passedIsHis: man.steadyWeight >= MOSTLY_ANCHOR,
    minutes: man.minutes,
    // IL SUO CALCIO, UNA STAGIONE PER VOCE, gia' letto da chi ha in mano gli store: questa funzione e'
    // pura e riceve solo l'uomo, mentre meta' di quei numeri vive nel livello per-partita. Letto e non
    // ricalcolato, come lo SWING e per la stessa ragione - due punti che lo calcolano darebbero allo
    // stesso nome due numeri.
    seasons: man.seasons ?? new Map(),
    fvm: man.fvm,
    // IL PREZZO CHE UNA STANZA VERA HA PAGATO, gia' nella valuta della lega dichiarata: e' l'unico
    // numero della riga che non sia un'opinione su di lui, quindi non si ricalcola qui - chi
    // costruisce la riga lo legge dalla tabella e lo scala, e questa funzione lo passa e basta.
    paid: man.paid ?? null,
    paidSold: man.paidSold ?? null,
    paidSoldOf: man.paidSoldOf ?? null,
    // La parola gia' risolta da chi ha costruito la riga: la dritta dichiarata batte il foglio, e
    // questa funzione non ha modo di leggere una dichiarazione (e' pura, e non deve averlo).
    titolarita: man.titolarita ?? null,
    // LETTA E NON RICALCOLATA, come il gain: lo SWING nasce dove nasce la riga, perche' ha bisogno
    // del calendario del foglio e questa funzione riceve solo l'uomo. Due punti che la calcolano
    // darebbero allo stesso nome due numeri, ed e' il difetto che questo progetto paga da sempre.
    swing: man.swing ?? null,
  };
}

/**
 * IL GAIN: il numero con cui si ordina, e dipende dal tipo d'asta.
 *
 * Vuoto e non zero per chi il foglio non prezza e nemmeno stima: una cella vuota è un'affermazione, e
 * metterlo in fondo alla lista sarebbe un giudizio che nessuno ha dato.
 *
 * NESSUN PAVIMENTO sulla disponibilità, a differenza delle buste chiuse: là si scrive un numero alla
 * cieca e un uomo che ha giocato una partita non è un uomo che avresti potuto schierare, qui la lista è
 * un ORDINAMENTO e le presenze attese stanno già dentro tutt'e due le valute (`surplus` e `value` sono
 * entrambi moltiplicati per `pv`). Un parametro in meno che nessuno ha misurato.
 */
export function gainOf(man: StrategyBidder, auction: AuctionKind): number | null {
  return auction === 'draft' ? man.value : man.surplus;
}

/** ...e se quel gain sta in piedi sul ripiego dichiarato invece che sulla previsione del motore. */
export function gainIsEstimate(man: StrategyBidder, auction: AuctionKind): boolean {
  return auction === 'draft' ? man.valueIsEstimate : man.surplusIsEstimate;
}

/**
 * QUANTI UOMINI DI QUEL RUOLO COMPRERÀ LA STANZA, che è la lunghezza giusta per una lista.
 *
 * La regola dell'operatore (26/08/2026): «il numero di calciatori per ogni blocco deve essere
 * sufficiente ad avere sempre un'alternativa considerando la distribuzione di quel ruolo per ogni
 * partecipante». Su classic è un conto e basta - otto difensori per otto partecipanti fanno 64 - e la
 * garanzia è esatta: anche se ogni rivale riempie il reparto prima di te, la lista contiene ancora la
 * tua parte.
 *
 * Su MANTRA quel conto non esiste, perché la rosa non ha quote per ruolo: ha 2 portieri e 23 uomini di
 * movimento, e quanti difensori centrali servano lo dicono i MODULI. Si riusa quindi la sola risposta
 * che questo progetto ha già misurato e dichiarato - `slotShares` + `demandFromShapes`, dove ogni posto
 * di ogni modulo vale un'unità di domanda divisa fra i ruoli che possono occuparlo, e le undici forme
 * pesano uguale perché nessuno ha misurato quali un tavolo giocherà. Su dieci squadre da 23 uomini di
 * movimento dà 51 `Dc`, 27 `M`, 24 `A`, 5 `B`: la forma della domanda, non un numero scelto.
 *
 * UN PAVIMENTO, ed è dichiarato: almeno un uomo per partecipante. Su mantra un ruolo può avere una
 * domanda più corta della stanza (`B` = 5 su 10 squadre) e allora la lista non offrirebbe
 * un'alternativa a tutti - e la domanda per ruolo SOTTOSTIMA il prosciugamento, perché i ruoli si
 * sovrappongono: un `Dc;B` comprato come `Dc` è un braccetto in meno per tutti gli altri.
 */
export function demandOf(setup: StrategySetup, rules: MantraModules | null): Map<string, number> {
  const out = new Map<string, number>();
  const teams = Math.max(1, Math.round(setup.teams));
  if (setup.game === 'classic') {
    for (const role of CLASSIC_BLOCKS) {
      out.set(role, Math.max(1, Math.round(setup.slots.classic[role] ?? 0)) * teams);
    }
    return out;
  }
  // Il portiere è fuori dalle linee dei moduli (il rulebook ne dichiara uno per schema), quindi la sua
  // domanda è il conto della rosa e non una quota delle forme: tanti portieri quanti la lega ne tiene.
  const keepers = Math.max(1, Math.round(setup.slots.mantra.por)) * teams;
  const shapes = demandFromShapes(
    slotShares(rules ?? { slot_roles: {}, modules: {} }),
    teams,
    Math.max(1, Math.round(setup.slots.mantra.mov)),
  );
  for (const role of mantraBlocks(rules)) {
    // `Por` non compare fra le quote delle forme, ed è giusto così: qui gli si dà il suo conto.
    if (role.toLowerCase() === 'por') out.set(role, keepers);
    else out.set(role, Math.max(teams, shapes.get(role.toLowerCase()) ?? 0));
  }
  return out;
}

/**
 * LA LINEA PIÙ ARRETRATA in cui il regolamento mette ogni ruolo, letta dai moduli e non decisa qui.
 *
 * Serve alla regola dell'operatore (26/08/2026): «conviene sempre schierare un calciatore nella posizione
 * del modulo più difensiva rispetto ai suoi ruoli ... un C/T conviene prenderlo per metterlo come C in
 * modo da lasciare la posizione T a un calciatore più offensivo». Per applicarla bisogna sapere quale dei
 * suoi ruoli è «più difensivo», e quella è una domanda sul RULEBOOK: si contano le linee dei posti che
 * accettano quel ruolo e si tiene la più arretrata.
 *
 * MISURATO sul file e non trascritto: `Dd Dc Ds B` stanno solo nella linea D (1), `E M C W` arrivano
 * fino alla linea M (2), `T A` alla trequarti (3), `Pc` solo in attacco (4). Si tiene il MINIMO e non la
 * media, e la ragione è che la media separerebbe cose che il regolamento tiene insieme: le medie sono
 * M 2,00 · C 2,06 · E 2,07, cioè tre mestieri diversi alla stessa profondità (un esterno è una fascia,
 * un mediano è il centro), e decidere fra loro su sette centesimi sarebbe inventare un ordine. Dentro la
 * stessa linea decide l'ordine dichiarato dal regolamento (`roles`), che è il solo che ci sia.
 *
 * Il portiere non sta nelle linee - il rulebook ne dichiara un posto fuori - quindi vale 0: più
 * arretrato di tutti, che è anche l'unica cosa vera che si possa dire di lui.
 */
export function roleDepth(rules: MantraModules | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!rules) return out;
  const LINES: Record<string, number> = { D: 1, M: 2, T: 3, A: 4 };
  for (const shape of Object.values(rules.modules ?? {})) {
    for (const [line, places] of Object.entries(shape)) {
      const at = LINES[line];
      if (!at) continue;
      for (const place of places) {
        for (const role of rules.slot_roles?.[place] ?? []) {
          const key = role.toLowerCase();
          out.set(key, Math.min(out.get(key) ?? at, at));
        }
      }
    }
  }
  for (const role of mantraBlocks(rules)) {
    // Chi non compare in nessuna linea è il portiere, e la sua profondità è «prima di tutto».
    if (!out.has(role.toLowerCase())) out.set(role.toLowerCase(), 0);
  }
  return out;
}

/**
 * IL POSTO PIÙ ARRETRATO che uno dei suoi ruoli gli apre: la linea più indietro, e a pari linea l'ordine
 * del regolamento.
 *
 * `c;t` -> `C`, `t;a` -> `T`, `w;a` -> `W`, `dc;b` -> `Dc`, `ds;e` -> `Ds`. Null per chi non porta nessun
 * ruolo leggibile: vuoto è ignoto, e un uomo senza ruoli non viene messo d'ufficio in fondo alla difesa.
 */
export function deepestRole(codes: readonly string[], rules: MantraModules | null): string | null {
  return pickDeepest(
    codes,
    roleDepth(rules),
    mantraBlocks(rules).map((role) => role.toLowerCase()),
  );
}

/**
 * COME SI LEGGE UN BLOCCO: tutti quelli che possono coprire il posto, o solo quelli di mestiere.
 *
 * Sono due domande e non due gusti. `all` risponde a «chi è il migliore che può coprire questo posto» -
 * e chi lo coprirebbe scendendo da un posto più arretrato è MARCATO, che è la richiesta dell'operatore
 * resa leggibile senza toccare la classifica. `natives` risponde a «chi sono le opzioni vere per questo
 * posto», cioè solo chi non può giocare più indietro.
 *
 * PERCHÉ LA REGOLA MARCA E NON ORDINA, misurato il 27/08/2026 sul foglio Serie A mantra (609 righe, gain
 * = surplus). Mettere davanti i nativi e tagliare alla domanda porta la somma dei gain del blocco dei
 * TREQUARTISTI da 256 a **−9** (−103%) e quello degli ATTACCANTI ESTERNI da 116 a **−94**: i diciassette
 * trequartisti puri del listone sono così debolii che il blocco finisce sotto la panchina, e spariscono
 * McTominay (27,8), Da Cunha (22,2), Rabiot (21,1), Dimarco (37,0 fra le ali). Una lista i cui primi nomi
 * valgono meno del rimpiazzo non è una lista da cui comprare. Le ali perdono il 39%, gli esterni il 32%.
 *
 * E LA FORMA LETTERALE - tenere solo il posto più arretrato di ogni uomo - lascia il blocco dei BRACCETTI
 * a **zero** nomi su tutt'e due i listoni (ogni braccetto quotato è anche un `Dc`, un `Dd` o un `Ds`),
 * gli ESTERNI a 19 su una domanda di 23 e i TREQUARTISTI a 17: quello è il prezzo della lettura
 * `natives`, che resta a un clic perché la domanda è vera, ed è detto invece che scoperto al tavolo.
 *
 * Il principio dell'operatore resta giusto dove è un'ASSEGNAZIONE e non un filtro - «un C/T conviene
 * metterlo da C per lasciare la T a un T/A» - e lì l'app lo applica già in modo esatto: l'undici migliore
 * lo disegna il matching di `mantra-legal.ts`, che se possiedi un T puro sposta il C/T da solo. Una lista
 * per ruolo non può decidere un vincolo congiunto: è la stessa lezione del §16 di
 * `metrica-asta-surplus-v1.md`, «una quota per ruolo non può esprimere quello che il rulebook raziona».
 */
export type BlockView = 'all' | 'natives';

/**
 * SU COSA SI ORDINA UN BLOCCO — il gain, o una qualunque delle letture (operatore, 06/09/2026).
 *
 * Fino a oggi la risposta era una sola e stava scritta come un invariante: «l'ordine è SEMPRE il gain,
 * in tutt'e due le letture». Quella frase nasceva da una MISURA sul filtro `natives` (riordinare per
 * mestiere porta la somma dei gain di un blocco da 256 a −9) e non da una regola sull'ordinamento in
 * sé: quello che era vietato era un ordine che NESSUNO ha scelto e che la lista non dichiara. Un
 * selettore è l'opposto — è una scelta esplicita, visibile, e reversibile a ogni sguardo, che è la
 * stessa forma con cui il filtro delle stime convive col suo costo misurato.
 *
 * Due conseguenze che il chiamante deve conoscere. Il TAGLIO alla domanda viene dopo, quindi ordinare
 * per una lettura cambia anche CHI resta in lista - è il senso della scelta, non un effetto
 * collaterale. E chi non ha quel numero va in fondo e non in mezzo: un ignoto non è uno zero, e
 * ordinando per xG i primi sono quelli che un xG ce l'hanno.
 */
/**
 * SU COSA SI ORDINA: il gain, oppure una LETTURA CON LA SUA STAGIONE (`mv@2025-26`).
 *
 * Una stringa e non un oggetto, perche' e' anche quello che finisce in `localStorage` e in una guardia
 * di validita': `refText` la scrive e `readRef` la rilegge, e una chiave che questa versione non capisce
 * piu' torna al gain invece di ordinare per una colonna che nessuno disegna.
 */
export type SortKey = string;

/** Il gain non è una lettura e quindi non è in `READINGS`: la sua etichetta la scrive chi lo mostra. */
export const GAIN_SORT = 'gain';
export const DEFAULT_SORT: SortKey = GAIN_SORT;

/**
 * LE LETTURE SU CUI SI PUO' ORDINARE: tutte tranne le COPPIE.
 *
 * Una coppia stampa `12:5` e non ha un numero (`readingValue` risponde `null`): metterla in elenco
 * darebbe una voce che non ordina niente, e darle una somma dietro le quinte disegnerebbe due cifre di
 * cui nessuna scende - «una colonna che spiega un ordinamento deve ESSERE quell'ordinamento». Chi vuole
 * ordinare per i gol ha `G`, che e' un numero solo.
 *
 * Derivato da `READINGS` e non riscritto: due elenchi della stessa cosa sono come una pastiglia finisce
 * per esistere e non essere ordinabile (o il contrario, che e' peggio).
 */
export const SORTABLE_READINGS: ReadingKey[] = READINGS
  .filter((one) => !one.pair)
  .map((one) => one.key);

/** Un uomo in classifica: la sua riga, il numero che lo ordina, e su cosa sta in piedi quel numero. */
export interface RankedMan {
  man: StrategyBidder;
  gain: number;
  estimated: boolean;
  /**
   * IL SUO POSTO PIÙ ARRETRATO, e se questo blocco NON è quello.
   *
   * `fromBehind` vuol dire «lo metteresti più indietro»: in questo blocco è un ripiego, non un acquisto
   * fatto per questo posto. Vuoto su classic, dove un uomo ha un ruolo solo e la domanda non esiste.
   */
  deepest: string | null;
  fromBehind: boolean;
  /**
   * I ruoli da disegnare accanto al nome: il vocabolario del GIOCO che si sta giocando.
   *
   * Calcolato qui e non nel template per due ragioni, e la seconda è un difetto vero: un uomo si legge
   * col vocabolario con cui lo si compra (`Dc Ds` a mantra, `D` a classic), e un array costruito dentro
   * un binding è un oggetto nuovo a ogni giro di change detection - che in sviluppo è esattamente
   * l'errore «expression has changed after it was checked».
   */
  shown: string[];
  /**
   * LE TRE PASTIGLIE, calcolate una volta per riga e non dentro un binding.
   *
   * Stessa ragione di `shown` qui sopra, e per un oggetto è più severa che per un array: un letterale
   * scritto in un template è un oggetto NUOVO a ogni giro di change detection, quindi ogni `@if` che
   * lo legge lo rivede cambiato. Qui l'oggetto vive quanto la riga.
   */
  readings: ManReadings;
  /**
   * IL SUO POSTO NELLA LISTA, 0-based, assegnato PRIMA di qualunque filtro.
   *
   * Serve perche' la ricerca per nome nasconde delle righe (05/09/2026) e il numero accanto al nome
   * deve restare il posto VERO: rinumerare da uno le tre righe trovate direbbe che il quarantesimo
   * difensore e' il primo. Vale anche per la banda dello slot, che e' quel numero diviso i
   * partecipanti - una banda ricalcolata su una lista filtrata disegnerebbe slot che non esistono.
   */
  at: number;
}

/** Un blocco: un ruolo, quanti nomi la stanza ne comprerà, e i migliori che ci stanno. */
export interface RoleBlock {
  role: string;
  label: string;
  /** Quanti uomini di questo ruolo la stanza comprerà: la lunghezza che la lista vorrebbe avere. */
  demand: number;
  men: RankedMan[];
  /** Quanti uomini di questo ruolo il listone porta in tutto - così «51 su 108» si può dire. */
  pool: number;
  /**
   * ...e quanti di quelli il foglio non prezza affatto.
   *
   * Non sono in classifica perché non hanno un numero, e un numero che non c'è non si ordina: sarebbero
   * in fondo per costruzione, cioè un giudizio che nessuno ha dato. Contati e detti, non nascosti.
   */
  unranked: number;
  /**
   * QUANTI DEI NOMI IN LISTA sono di questo posto per mestiere - cioè non possono giocare più arretrati.
   *
   * È il numero che rende leggibile la regola dell'operatore, e sul listone dice cose forti: dei primi
   * 16 trequartisti della Serie A **15** possono giocare da centrale, e 12 di loro sono anche nei primi
   * 26 del blocco `C`. Senza questo conteggio quel blocco sembra una lista di trequartisti e invece è
   * quasi la stessa lista di prima.
   */
  natives: number;
  /** ...e quanti di mestiere ne esistono in tutto fra quelli che il foglio prezza. */
  nativePool: number;
  /**
   * QUANTI DEI NOMI IN LISTA vengono dall'ordine personale dell'operatore, e non dal gain.
   *
   * Sono i primi `pinned`, per costruzione (`manual-order.orderedBy`): sotto quel numero la lista è
   * ancora la misura. Il blocco lo DICE, perché una lista mezza preferenza e mezza misura che non
   * dichiara dove passa il confine è una lista i cui numeri descrivono un'altra lista.
   */
  pinned: number;
  /**
   * QUANTI NOMI IL FILTRO HA TOLTO da questo ruolo (operatore, 12/09/2026).
   *
   * Contato e detto, come tutto quello che questa pagina nasconde: un blocco corto senza una ragione a
   * schermo si legge come un blocco rotto, ed e' la stessa regola per cui i filtri della tabella
   * portano la loro etichetta SOPRA la tabella. Zero quando nessun filtro e' in vigore.
   */
  dropped: number;
}

/**
 * I blocchi pieni: per ogni ruolo gli uomini che lo portano, e in che ordine leggerli.
 *
 * SU MANTRA UN UOMO STA IN PIÙ BLOCCHI, e non è una duplicazione: `Dc;B` è un difensore centrale
 * comprabile come braccetto, e le due liste rispondono a due domande («chi mi copre il centro della
 * difesa» e «chi mi copre il braccetto»). È anche il motivo per cui l'unione dei blocchi è più lunga
 * della rosa che la stanza comprerà - che è esattamente la proprietà «sempre un'alternativa».
 *
 * LA REGOLA DEL PIÙ DIFENSIVO ORDINA, NON FILTRA, e la differenza è misurata sul listone di oggi.
 * Tenere solo il posto più arretrato di ogni uomo - la forma letterale della richiesta - lascia il blocco
 * dei BRACCETTI a **zero** uomini su tutt'e due i listoni (ogni braccetto quotato è anche un `Dc`, un
 * `Dd` o un `Ds`), gli ESTERNI a 15 su 94 contro una domanda di 23 e i TREQUARTISTI a 14 su 61 contro
 * 16: tre blocchi di dodici non riescono più a riempire la propria lista, e il blocco che dovrebbe dire
 * «chi mi copre il braccetto» non risponde più. Quindi chi può giocare più arretrato resta in lista, in
 * fondo e marcato: il primo gruppo è quello che l'operatore ha chiesto, il secondo è la prova che non è
 * stata nascosta.
 *
 * IL CONFRONTO È SEMPRE DENTRO UN RUOLO, e questo è ciò che rende sicura la valuta del draft: il valore
 * non sottrae nessuno zero, quindi su una lista unica premierebbe chi gioca sempre e i portieri
 * prima di tutti (la lezione dell'Overall, 16/08/2026). Fra due uomini dello stesso ruolo quel difetto
 * non esiste, perché lo zero che manca è lo stesso per tutt'e due.
 */
export function blocksOf(input: {
  pool: readonly StrategyBidder[];
  setup: StrategySetup;
  rules: MantraModules | null;
  /**
   * L'ORDINE PERSONALE per ruolo, quando c'è (`manual-order.ts`).
   *
   * Si applica PRIMA del taglio alla domanda, e non è un dettaglio: un nome che l'operatore ha sistemato
   * deve essere visibile, e applicandolo dopo un uomo pinato oltre l'ottantesimo posto sarebbe stato
   * tagliato via proprio dalla lista in cui l'ha messo.
   */
  priority?: ReadonlyMap<string, readonly number[]>;
  /** Su cosa ordinare: il gain quando nessuno ha scelto. Vedi `SortKey`. */
  sort?: SortKey;
  /**
   * LE DUE STAGIONI CHE IL PACCHETTO DICHIARA, per rileggere la chiave d'ordinamento.
   *
   * Servono perche' una chiave e' `mv@2025-26` e una lettura senza stagione scritta cade sul suo
   * default, che e' `target` o `input` - due nomi che solo il manifest sa tradurre in un anno. Lette e
   * mai calcolate come «bersaglio meno uno», che sarebbe giusto oggi e sbagliato dentro la macchina
   * del tempo.
   */
  seasons?: { target: string; input: string };
  /**
   * IL FILTRO COMPOSTO, gia' come PREDICATO e non come condizioni (operatore, 12/09/2026).
   *
   * Un predicato e non le clausole, e non e' pigrizia: il gain si stampa PER GIORNATA mentre qui e' un
   * totale di stagione, quindi in che unita' si confronta lo sa chi disegna la riga e non questo
   * modulo (`strategy-filter.passesFilter` lo dice dal suo lato). Cosi' `blocksOf` non importa il
   * vocabolario dei filtri e i due file non si citano a vicenda.
   *
   * SI APPLICA PRIMA DEL TAGLIO ALLA DOMANDA, come l'ordine personale e per una ragione vicina: un
   * filtro serve a trovare i nomi che rispondono, e applicandolo dopo risponderebbe solo su quelli che
   * la stanza comprera' comunque - cioe' su una lista in cui si stava gia' guardando. Quello che NON
   * cambia e' la LUNGHEZZA: la lista resta lunga quanto la domanda della stanza, e il numero accanto a
   * ogni nome resta il suo posto VERO, assegnato prima del filtro.
   */
  keep?: (row: RankedMan) => boolean;
}): RoleBlock[] {
  const { pool, setup, rules, priority, keep } = input;
  const seasons = input.seasons ?? { target: '', input: '' };
  const sort = input.sort ?? DEFAULT_SORT;
  const demand = demandOf(setup, rules);
  const mantra = setup.game === 'mantra';
  // Una volta per tutto il foglio e non una per uomo: `deepestRole` rileggerebbe i moduli 600 volte.
  const depth = roleDepth(rules);
  const order = mantraBlocks(rules).map((role) => role.toLowerCase());
  const deepest = new Map<number, string | null>();
  const deepestOf = (man: StrategyBidder): string | null => {
    if (!mantra) return null;
    let known = deepest.get(man.fcId);
    if (known === undefined) {
      known = pickDeepest(man.mantraCodes, depth, order);
      deepest.set(man.fcId, known);
    }
    return known;
  };
  return blockRolesOf(setup, rules).map((role) => {
    const key = role.toLowerCase();
    const mine = pool.filter((man) =>
      mantra
        ? man.mantraCodes.some((code) => code.toLowerCase() === key)
        : man.role.toLowerCase() === key,
    );
    const ranked: RankedMan[] = [];
    for (const man of mine) {
      const gain = gainOf(man, setup.auction);
      if (gain == null) continue;
      const deep = deepestOf(man);
      ranked.push({
        man,
        gain,
        // Assegnato dopo il taglio, quando la lista e' quella vera: qui e' solo un segnaposto.
        at: 0,
        estimated: gainIsEstimate(man, setup.auction),
        shown: mantra ? man.mantraCodes : [man.role],
        readings: readingsOf(man),
        deepest: deep,
        // Vuoto = ignoto anche qui: di un uomo di cui non si sa il posto più arretrato non si dice che
        // «arriva da dietro», che sarebbe una frase sul suo mestiere presa dal nulla.
        fromBehind: !!deep && deep.toLowerCase() !== key,
      });
    }
    // A parità il nome, così due liste dello stesso foglio non si scambiano due righe fra un disegno
    // e l'altro: un ordine che cambia da solo si legge come un numero che è cambiato. La CHIAVE la
    // sceglie chi guarda (`SortKey`) e il gain è il default; chi quel numero non ce l'ha va in fondo,
    // perché un ignoto non è uno zero.
    // La chiave e' il gain o una lettura CON la sua stagione: una stringa che questa versione non
    // capisce piu' ordina per gain invece di mettere tutti a pari merito, che si leggerebbe come una
    // lista non ordinata.
    const sortRef = sort === GAIN_SORT ? null : readRef(sort, seasons);
    const keyOf = (one: RankedMan): number =>
      (sortRef ? readingValue(sortRef, one.readings) : one.gain) ?? Number.NEGATIVE_INFINITY;
    ranked.sort((left, right) => keyOf(right) - keyOf(left) || left.man.name.localeCompare(right.man.name));
    const size = demand.get(role) ?? 0;
    const native = setup.view === 'natives' ? ranked.filter((one) => !one.fromBehind) : ranked;
    const chosen = orderedBy(native, (one) => one.man.fcId, priority?.get(role) ?? []);
    // IL POSTO PRIMA DEL FILTRO, che e' quello che `RankedMan.at` promette di se': se un filtro
    // rinumerasse le righe rimaste, il quarantesimo difensore si leggerebbe come il primo.
    const placed = chosen.men.map((one, at) => ({ ...one, at }));
    const kept = keep ? placed.filter(keep) : placed;
    const men = kept.slice(0, size);
    // I NOMI SISTEMATI A MANO CHE IL FILTRO HA LASCIATO PASSARE: sono ancora un prefisso, perche' un
    // filtro conserva l'ordine. Contarli invece di riusare `chosen.pinned` e' la differenza fra «i
    // primi tre vengono dalla tua lista» e la stessa frase detta su una lista da cui due sono usciti.
    const stillPinned = men.filter((one) => one.at < chosen.pinned).length;
    return {
      role,
      label: blockLabel(role, setup.game),
      demand: size,
      men,
      pool: mine.length,
      unranked: mine.length - ranked.length,
      natives: men.filter((one) => !one.fromBehind).length,
      pinned: Math.min(stillPinned, men.length),
      dropped: placed.length - kept.length,
      // Quanti di mestiere ne esistono in tutto, che è il numero che dice quanto costa la lettura
      // `natives`: sul listone vero i braccetti sono ZERO, e un blocco vuoto deve poter dire perché.
      nativePool: ranked.filter((one) => !one.fromBehind).length,
    };
  });
}

/** Il posto più arretrato, con la profondità e l'ordine già letti: `deepestRole` è la sua versione a mano. */
function pickDeepest(
  codes: readonly string[],
  depth: Map<string, number>,
  order: readonly string[],
): string | null {
  let best: string | null = null;
  let bestKey: [number, number] | null = null;
  for (const code of codes) {
    const key = code.toLowerCase();
    if (!depth.has(key)) continue;
    const at = order.indexOf(key);
    const mark: [number, number] = [depth.get(key) ?? 9, at < 0 ? 99 : at];
    if (!bestKey || mark[0] < bestKey[0] || (mark[0] === bestKey[0] && mark[1] < bestKey[1])) {
      best = code;
      bestKey = mark;
    }
  }
  return best;
}
