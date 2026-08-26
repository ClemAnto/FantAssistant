import { MantraModules, demandFromShapes, slotShares } from './auction-value';
import { ClassicRole } from './players-store';

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
}): RoleBlock[] {
  const { pool, setup, rules } = input;
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
        estimated: gainIsEstimate(man, setup.auction),
        shown: mantra ? man.mantraCodes : [man.role],
        deepest: deep,
        // Vuoto = ignoto anche qui: di un uomo di cui non si sa il posto più arretrato non si dice che
        // «arriva da dietro», che sarebbe una frase sul suo mestiere presa dal nulla.
        fromBehind: !!deep && deep.toLowerCase() !== key,
      });
    }
    // A parità di gain il nome, così due liste dello stesso foglio non si scambiano due righe fra un
    // disegno e l'altro: un ordine che cambia da solo si legge come un numero che è cambiato. L'ordine
    // è SEMPRE il gain, in tutt'e due le letture: vedi `BlockView` per la misura che lo ha deciso.
    ranked.sort((left, right) => right.gain - left.gain || left.man.name.localeCompare(right.man.name));
    const size = demand.get(role) ?? 0;
    const chosen = setup.view === 'natives' ? ranked.filter((one) => !one.fromBehind) : ranked;
    const men = chosen.slice(0, size);
    return {
      role,
      label: blockLabel(role, setup.game),
      demand: size,
      men,
      pool: mine.length,
      unranked: mine.length - ranked.length,
      natives: men.filter((one) => !one.fromBehind).length,
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
