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
