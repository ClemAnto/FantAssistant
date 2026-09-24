import { spendableKeeping, spendableOn } from './plancia';
import { ClassicRole } from './players-store';
import { Bidder, expectedHoles, LeagueRules } from './sealed-bid';

/**
 * I DUE NUMERI DI LEGA CHE IL FOCUS LEGGE, e non uno di piu'.
 *
 * `expectedHoles` chiede un `LeagueRules` intero perche' serve la pagina delle buste, che di regole ne
 * usa una dozzina; qui ne servono due, e passare l'oggetto intero vorrebbe dire costruirlo dalle
 * impostazioni della plancia - che sono un ALTRO modello (`LeagueSettings` non ha ne' `matchdays` ne'
 * `minAvailability`). Un adattatore fra due modelli di regole e' il posto in cui un campo finisce per
 * essere riempito con un numero finto, quindi si dichiarano i due che si usano e l'oggetto si compone
 * QUI, in un punto solo, invece che a ogni chiamata.
 */
export interface FocusRules {
  /** Le giornate su cui `expected` e' espresso: la base su cui si legge una quota. */
  matchdays: number;
  /** «Pa >= 25»: la quota sotto la quale un uomo non GIOCA SEMPRE, sua cifra del 23/09/2026. */
  coverShare: number;
}

const asLeagueRules = (rules: FocusRules) => rules as unknown as LeagueRules;

/**
 * LA MODALITA' FOCUS DELLA PLANCIA: chi serve alla MIA rosa, e chi no.
 *
 * Sua richiesta del 23/09/2026, la prima della giornata: «una nuova modalita' FOCUS dove andiamo ad
 * evidenziare solo i calciatori che ci servono per raggiungere i nostri obiettivi e nascondiamo gli
 * altri». Gli obiettivi li aveva elencati - «11 titolari fra SUPERTOP, TOP e SEMITOP · 7 riserve buone
 * · rosa completa» - e ha chiesto se fossero giusti: DUE DEI TRE SONO STATI CORRETTI DALLA MISURA, e
 * quello che questo file applica e' la versione misurata, non quella dettata.
 *
 * PRIMO: UNDICI UOMINI DELLE TRE PAROLE ALTE NON ESISTONO. Sul listone Serie A 2026-27 le parole alte
 * sono 51 in tutto, cioe' 5,1 per rosa in una lega da dieci, e per ruolo P 4 · D 18 · C 19 · A 10: un
 * 4-3-3 schiera TRE attaccanti e al tavolo ce ne sono dieci di alti, uno a testa. Su 110 posti da
 * titolare dell intero tavolo ne sono coperti 51, il 46%.
 *
 * SECONDO: IL BERSAGLIO VERO E' SETTE, E NON E' DISTRIBUITO COME SEMBRA. Misurato sul banco - 3.000
 * rose, dieci stagioni vere per trenta urne, tavolo calibrato sulle 131 aste reali - chi VINCE ha 5,81
 * parole alte contro le 4,88 del tavolo, e la curva dei titoli sale fino in fondo (3 top 7% · 5 top 9%
 * · 7 top 14% · 8 top 23% · 9 top 32%, contro un caso del 10%). Ma il guadagno e' quasi tutto in DUE
 * reparti, e il k-esimo top vale (posto medio in CLASSIFICA, per 0/1/2/3+ uomini alti nel reparto):
 *
 *     D   6.04 -> 5.85 -> 5.52 -> 4.58     il terzo difensore alto vale piu' dei primi due
 *     A   6.04 -> 5.53 -> 4.91 -> 4.07     monotono e ripido, paga fino al terzo
 *     C   5.19 -> 5.46 -> 5.49 -> 5.67     PEGGIORA: il centrocampo alto non paga
 *     P   5.55 -> 5.44 -> 5.21             quasi piatto
 *
 * Da qui `TOP_TARGET`, che somma a sette. Il centrocampo ne prende UNO e non zero perche' la misura
 * dice «non paga» e non «costa»: fra 5,19 e 5,46 c'e' rumore, e un reparto a cui il focus non mostrasse
 * mai niente si leggerebbe come una lista rotta.
 *
 * TERZO, E VIENE PRIMA DI TUTTI: LA COPERTURA. Un buco costa 4,73 fantapunti A GIORNATA - il numero
 * piu' grande che questo progetto abbia misurato su una rosa, contro gli 1,7 della scelta di strategia
 * e gli 0,7 dei consigli del motore dentro uno slot - e nelle rose vere sta quasi tutto in attacco
 * (buchi mediani P 0,000 · D 0,071 · C 0,065 · A 0,229). Per questo `needOf` guarda i buchi PRIMA delle
 * parole: un undici si copre una volta sola, e finche' un reparto non c'e' comprare un fuoriclasse
 * altrove e' pagare per qualcosa che non si incassa.
 *
 * E I BUCHI LI CONTA `expectedHoles`, che e' la definizione di questa app - la convoluzione esatta
 * sulle quote, coi portieri letti come UNA porta perche' due uomini di un club non giocano mai la
 * stessa partita. Un secondo conto qui darebbe alla stessa rosa due verdetti.
 */

/**
 * L'OBIETTIVO ATTIVO DI UN REPARTO, nelle sue quattro parole (23/09/2026: «piuttosto che "scoperto"
 * indica l'obiettivo attivo di quel ruolo: TOP, TITOLARE, COPERTURA, RESTO»).
 *
 * SONO QUATTRO E NON TRE, e ognuna chiede una cosa diversa - vedi `GOAL_ASKS`, che porta le sue quattro
 * frasi. Quello che NON sono e' quattro altezze di una quantita' sola: `cover` e' una quantita' («Pa >=
 * 25»), `starter` un confronto con la mia rosa («completa il nostro 11»), `top` una parola della scala e
 * `rest` una relazione con quelli che ho gia'. Averle lette come soglie ordinate e' l'errore che questa
 * prima versione ha fatto, e stava in piedi proprio perche' due soglie si possono sempre ordinare.
 *
 * L'ORDINE E' DI SEVERITA' DECRESCENTE, ed e' anche quello in cui il click li fa girare: un TOP e' anche
 * un titolare, un titolare copre, e RESTO non chiede niente. Cosi' salire di un gradino restringe sempre
 * la lista e scenderne uno la allarga, che e' la sola cosa che un ciclo di quattro parole deve promettere.
 */
export type Goal = 'top' | 'starter' | 'cover' | 'rest';

/** I quattro in ordine, per il click che passa al successivo. Una definizione, due lettori. */
export const GOALS: readonly Goal[] = ['top', 'starter', 'cover', 'rest'];

/** Le parole a schermo, che sono le sue. */
export const GOAL_LABEL: Readonly<Record<Goal, string>> = {
  top: 'TOP',
  starter: 'TITOLARE',
  cover: 'COPERTURA',
  rest: 'RESTO',
};

/** Il successivo nel giro, che riparte da capo: un ciclo che si ferma in fondo e' un ciclo a meta'. */
export function nextGoal(goal: Goal): Goal {
  return GOALS[(GOALS.indexOf(goal) + 1) % GOALS.length];
}

/** Le parole della scala che valgono come «alta» per il bersaglio (`engine/categories.py`). */
export const TOP_WORDS: readonly string[] = ['super', 'top', 'semi'];

/**
 * Quante parole alte per ruolo, e la somma e' SETTE: il bersaglio misurato, non quello dettato.
 *
 * Difesa e attacco se le prendono quasi tutte perche' e' li' che pagano; il portiere zero, perche' il
 * suo k-esimo top vale −0,11 posti e di portieri se ne schiera uno.
 */
export const TOP_TARGET: Readonly<Record<ClassicRole, number>> = { P: 0, D: 3, C: 1, A: 3 };

/**
 * Sopra quanti buchi attesi un reparto si chiama SCOPERTO, e viene prima di tutto il resto.
 *
 * Un posto intero, che e' `HOLE_TARGET` della pagina delle buste: stessa domanda, stesso numero, non un
 * secondo che le somigli. DICHIARATO e non misurato - quanto costa un buco e' una misura (4,73 a
 * giornata), quando vale la pena spendere un credito per chiuderlo e' una preferenza.
 */
export const COVER_TARGET = 1;

/** Un uomo della mia rosa, come il focus ha bisogno di vederlo. */
export interface Owned {
  role: ClassicRole;
  /** Le presenze attese sul calendario di `rules.matchdays`, gia' scontate di cio' che va scontato. */
  expected: number | null;
  club: string;
  category: string | null;
}

/** Quanti uomini di quel ruolo la rosa porta gia' con una parola alta. */
export function topsOwned(mine: readonly Owned[], role: ClassicRole): number {
  return mine.filter(
    (man) => man.role === role && !!man.category && TOP_WORDS.includes(man.category),
  ).length;
}

/**
 * IL BISOGNO DI UN REPARTO, e `null` quando quel reparto e' a posto.
 *
 * L'ordine e' quello che le misure mettono e non quello che l'occhio metterebbe: prima il buco (4,73 a
 * giornata), poi la parola alta dove paga, e il posto da riempire per ultimo. `places` sono i posti che
 * l'undici di riferimento schiera in quel ruolo, `left` quelli che restano da comprare in rosa.
 */
export function needOf(
  mine: readonly Owned[],
  role: ClassicRole,
  places: number,
  left: number,
  rules: FocusRules,
): Goal | null {
  if (left <= 0) return null;
  // I buchi li conta la definizione dell'app: `expectedHoles` legge due campi di un `Bidder`, il ruolo
  // e le presenze attese (piu' il club, per la porta). Si passano quelli e si dichiara, invece di
  // riempire gli altri con numeri finti che nessun lettore chiede.
  const asBidders = mine.map(
    (man) => ({ role: man.role, expected: man.expected, club: man.club }) as unknown as Bidder,
  );
  const holes = expectedHoles(asBidders, role, places, asLeagueRules(rules));
  // UN BUCO SI CONFRONTA COI POSTI CHE RESTANO, e questa e' la correzione che la dinamica di un'asta a
  // ESTRAZIONE LIBERA impone (23/09/2026, misurata sul banco: su dieci finestre per dieci urne i top di
  // ogni ruolo escono UNIFORMEMENTE lungo tutta l'asta - mediana 0,46, p25 0,22, p75 0,71 - mentre gli
  // uomini da un credito arrivano tardi, mediana 0,57-0,69).
  //
  // Quello che quei numeri dicono e' che NON C'E' UN MOMENTO in cui i top finiscono: non serve una
  // regola sul tempo, serve una regola sullo STATO. E dice anche che il riempimento si trova sempre,
  // quindi un buco con otto posti ancora da comprare non e' un'emergenza - lo diventa quando i posti
  // che restano non bastano piu' a chiuderlo.
  //
  // La prima versione guardava solo `holes >= 1` e, a rosa vuota, metteva TUTTI e quattro i reparti su
  // «titolare»: cioe' proprio nel momento in cui i top escono e il budget c'e', il focus faceva
  // guardare altrove. Con l'urgenza (buchi diviso posti rimasti) a rosa vuota la difesa legge 4/8 =
  // 0,5 e l'obiettivo e' TOP, e a fine asta 1/1 = 1,0 e diventa TITOLARE.
  // UN BUCO SI CHIUDE CON LE PRESENZE, quindi l'obiettivo e' COPERTURA - «uno che giochi sempre», che
  // e' la sua definizione. Nella mia prima versione qui c'era `starter`, e le due parole erano
  // invertite: TITOLARE non e' una soglia di presenze, e' un confronto con la mia rosa.
  if (holes >= left) return 'cover';
  if (topsOwned(mine, role) < (TOP_TARGET[role] ?? 0)) return 'top';
  // ...E SE L'UNDICI NON E' COMPLETO, il posto vuoto lo completa chiunque sia meglio di chi ho:
  // «un calciatore che possa completare il nostro 11 titolare».
  if (mine.filter((one) => one.role === role).length < places) return 'starter';
  // ...e se il bersaglio delle parole alte e' pieno ma un buco resta, il titolare viene comunque prima
  // del riempimento: un posto vuoto costa 4,73 fantapunti a giornata, che e' il numero piu' grande che
  // questo progetto abbia misurato su una rosa.
  if (holes >= COVER_TARGET) return 'cover';
  // ...e quando l'undici c'e' ed e' coperto, quello che resta da comprare e' la panchina: uno che
  // COMPLEMENTI quelli che ho, non un altro uguale.
  return 'rest';
}

/**
 * QUESTA RIGA SERVE? La domanda che la modalita' risponde su ognuno dei duecentocinquanta nomi.
 *
 * Un uomo serve se chiude il bisogno del SUO ruolo, e cosa lo chiuda dipende dal bisogno: un buco lo
 * chiude chi GIOCA - non chi rende, perche' il lavoro di un riserva e' coprire e uno comprato per il
 * voto non lo fa (misurato: senza ricambio servirebbe una fantamedia di 14,32 per pareggiare uno che
 * gioca tutte le giornate, cioe' un giocatore che non esiste) - mentre il bersaglio delle parole alte
 * lo chiude solo una parola alta. L'ultimo posto lo chiude chiunque, ed e' il caso in cui il focus
 * smette di restringere: una lista vuota non e' un consiglio.
 */
export function serves(
  goal: Goal | null,
  man: { role: ClassicRole; expected: number | null; category: string | null; club?: string },
  role: ClassicRole,
  rules: FocusRules,
  mine: readonly Owned[] = [],
  places = 0,
): boolean {
  if (goal === null || man.role !== role) return false;
  if (goal === 'top') return !!man.category && TOP_WORDS.includes(man.category);
  if (goal === 'cover') {
    // «GIOCHI SEMPRE, Pa >= 25»: una quantita' e la sua cifra, tenuta come QUOTA perche' 25 su 38 e
    // 21,7 su 33 sono lo stesso fatto - la lezione di R20, che in questa app decide ogni soglia di
    // calendario.
    const share = man.expected != null && rules.matchdays ? man.expected / rules.matchdays : null;
    return share != null && share >= rules.coverShare;
  }
  if (goal === 'starter') {
    // «COMPLETA IL NOSTRO 11 TITOLARE»: non una soglia ma un CONFRONTO con la mia rosa. Entra se
    // batterebbe il peggiore dei miei che oggi occupa uno di quei posti - e se i posti non sono
    // nemmeno pieni chiunque li completa, perche' un posto vuoto lo migliora qualunque uomo.
    const ours = mine
      .filter((one) => one.role === role && one.expected != null)
      .map((one) => one.expected as number)
      .sort((a, b) => b - a);
    if (ours.length < places) return true;
    const worst = ours[places - 1];
    return man.expected != null && worst != null && man.expected > worst;
  }
  // RESTO: «uno che COMPLEMENTI quelli che abbiamo», e l'unica complementarita' che questo progetto ha
  // misurato e' il CLUB - due uomini dello stesso club condividono il calendario, quindi saltano le
  // stesse giornate, e la diversificazione vale -4,4% di dispersione (`metrica-asta-surplus-v1.md`
  // §24). Chi non ho gia' in quel reparto complementa; chi e' del club di un mio uomo dello stesso
  // ruolo no. E' la lettura piu' povera delle quattro, ed e' dichiarata: «complementare» avrebbe anche
  // una lettura sul CALENDARIO - chi gioca quando i miei riposano - che questa app misura per i
  // portieri (`keeper-pairs.ts`) e per nessun altro ruolo.
  const clubs = new Set(mine.filter((one) => one.role === role).map((one) => one.club));
  return !man.club || !clubs.has(man.club);
}

/**
 * QUANTO E' INTERESSANTE QUESTO LOTTO PER LA MIA ROSA, in una parola sola.
 *
 * Sua richiesta (24/09/2026): «quando viene selezionato un nuovo calciatore per l'asta indicami se e'
 * un calciatore interessante per la mia rosa e quanto dovrei spendere per lui per rimanere in linea
 * con gli acquisti e completare una buona rosa», con la definizione allegata - «uno che va a
 * migliorare o completare gli obiettivi del focus che non deve costare troppo».
 *
 * QUELLA FRASE E' LA FORMULA, e le sue due meta' esistono gia' misurate: «migliorare o completare gli
 * obiettivi» e' `needOf` + `serves`, cioe' la stessa coppia su cui la modalita' focus accende le 250
 * righe (un secondo criterio qui direbbe a una riga che serve e al lotto che non serve); «non deve
 * costare troppo» e' un confronto fra quello che la STANZA paga per il suo slot e quello che io posso
 * spendere. Niente di nuovo si misura qui: questa funzione COMPONE.
 *
 * IL TETTO HA DUE VINCOLI E SI DICHIARA QUALE LEGA. Uno e' di MERCATO (`band.high`, la scala misurata
 * sulle aste vere per quel (ruolo, slot), gia' scontata di infortuni, confidenza e stesso-club); l'altro
 * e' della ROSA (`spendableOn`: i miei crediti meno un credito per ogni altro posto da riempire). Il
 * numero da mostrare e' il MINIMO, perche' sfondare l'uno paga un uomo piu' di quanto rende e sfondare
 * l'altro lascia un posto vuoto, che costa 4,73 fantapunti a giornata. Dire QUALE dei due lega e' meta'
 * del consiglio: «fino a 42» per il mercato e «fino a 42» per la borsa sono la stessa cifra e due
 * situazioni diverse.
 *
 * IL TEMPISMO NON SI RICALCOLA: arriva da `adviseLot` (`worthWaiting`, `DEPTH_TIER`/`DEPTH_HANDS`,
 * +1,88% strict sul banco) e viene solo RIPETUTO qui accanto. Due risposte a «offro adesso o aspetto»
 * sullo stesso schermo sarebbero il difetto che questa app ha gia' pagato tre volte.
 */
export type Interest = 'serve' | 'caro' | 'no' | 'ignoto';

export interface LotBrief {
  /** L'obiettivo attivo del suo reparto, o `null` quando quel reparto e' a posto. */
  goal: Goal | null;
  interest: Interest;
  /** Fino a quanto spingersi, o `null` quando il foglio non lo prezza: uno zero direbbe «non vale». */
  spend: number | null;
  /**
   * IL MASSIMO ASSOLUTO: quello che posso offrire tenendo UN credito per ogni altro posto da riempire.
   *
   * E' il limite del regolamento e non un consiglio - oltre quello la rosa non si chiude - e per questo
   * e' l'unico dei due che non dipende da nessuna misura: un credito e' il minimo d'asta.
   */
  absolute: number;
  /**
   * ...E IL MASSIMO SENSATO: quello che resta tenendo da parte quello che gli ALTRI posti costeranno
   * davvero, ai prezzi che la stanza paga per i loro slot (`expectedPriceOf`, la scala misurata sulle
   * aste vere e scontata dell'assottigliamento).
   *
   * Sua richiesta (24/09/2026): «l'offerta massima conservando i giusti crediti per completare gli
   * acquisti in maniera soddisfacente». Fra i due c'e' tutta la differenza fra una rosa COMPLETA e una
   * rosa BUONA: la prima si chiude con venticinque uomini da un credito.
   */
  sensible: number;
  /** Quanto costeranno gli altri posti: la riserva che il secondo tetto mette da parte. */
  reserve: number;
  /** Chi dei due tetti lega, perche' una cifra senza il suo vincolo non e' un consiglio. */
  bound: 'mercato' | 'rosa' | null;
  /** Quello che la stanza paga di solito per il suo slot: e' il metro di «costa troppo». */
  price: number;
  /** La regola misurata sul momento, ripetuta e non ricalcolata. */
  waiting: boolean;
  reason: string;
}

export function lotBrief(input: {
  goal: Goal | null;
  serves: boolean;
  /** `band.high`, oppure `null` se il foglio non lo prezza. */
  ceiling: number | null;
  expectedPrice: number;
  credits: number;
  /** I posti che mi restano da riempire in TUTTA la rosa, non solo nel suo ruolo. */
  placesLeft: number;
  /**
   * Quanto costeranno gli ALTRI posti che mi restano, ai prezzi dei loro slot: la riserva del tetto
   * sensato. Chi la calcola e' il negozio, che e' l'unico a sapere quali slot siano - qui si comporrebbe
   * una seconda volta un prezzo che la plancia stampa gia' su ogni blocco.
   */
  restCost: number;
  waiting: boolean;
}): LotBrief {
  const roster = spendableOn(input.credits, input.placesLeft);
  const sensible = spendableKeeping(input.credits, input.restCost);
  const shared = {
    goal: input.goal,
    price: input.expectedPrice,
    waiting: input.waiting,
    absolute: roster,
    sensible,
    reserve: Math.max(0, Math.round(input.restCost)),
  };

  if (input.ceiling == null) {
    return {
      ...shared,
      interest: 'ignoto',
      spend: null,
      bound: null,
      reason: 'Il foglio non lo prezza: qui non c’è una cifra da consigliare.',
    };
  }

  const spend = Math.min(input.ceiling, roster);
  const bound = roster < input.ceiling ? ('rosa' as const) : ('mercato' as const);
  const full = input.placesLeft <= 0;

  if (!input.serves) {
    return {
      ...shared,
      interest: 'no',
      spend,
      bound,
      reason: full
        ? 'Rosa piena: non c’è più un posto per lui.'
        : input.goal === null
          ? 'Il suo reparto è a posto: non ti serve.'
          : `Non chiude l’obiettivo ${GOAL_LABEL[input.goal]} del suo reparto.`,
    };
  }

  // «NON DEVE COSTARE TROPPO»: il metro e' quello che la STANZA paga per il suo slot, non il prezzo a
  // cui e' arrivata l'asta - quello lo si vede sulla barra, e cambia mentre si guarda. Un uomo che
  // serve e che la stanza paga sopra il mio tetto e' un uomo che serve a un'altra rosa.
  if (input.expectedPrice > spend) {
    return {
      ...shared,
      interest: 'caro',
      spend,
      bound,
      reason:
        `Serve (${GOAL_LABEL[input.goal!]}), ma la stanza lo paga ~${input.expectedPrice} e tu puoi ` +
        `arrivare a ${spend}${bound === 'rosa' ? ' senza lasciare un posto vuoto' : ''}.`,
    };
  }

  return {
    ...shared,
    interest: 'serve',
    spend,
    bound,
    reason:
      `Chiude l’obiettivo ${GOAL_LABEL[input.goal!]} del suo reparto e la stanza lo paga ` +
      `~${input.expectedPrice}: fino a ${spend} ` +
      (bound === 'rosa'
        ? 'è quanto puoi spendere tenendo un credito per ogni altro posto.'
        : 'è il tetto misurato per il suo slot.'),
  };
}
