/**
 * LE SEI PAROLE DENTRO IL RUOLO: le categorie dell'operatore, come si abbreviano e come si spiegano.
 *
 * La parola la DECIDE il toolkit (`engine/categories.py`, colonna `desc_category`) e qui non si ricalcola
 * niente, per la stessa ragione della titolarità accanto: i due assi che la compongono sono una previsione
 * su una persona (quante giornate a voto) e una misura sul suo passato (quanto bonus a presenza), e le due
 * stanno dove le misure si giudicano. Questo file è solo il vocabolario di lettura - la sigla, l'ordine e
 * la frase - e sta in `core/` perché più schermate mostreranno la stessa parola e tre traduzioni diverse
 * finirebbero per non essere d'accordo su una.
 *
 * DENTRO IL RUOLO, sempre: «porta bonus» per un centrale non è la stessa quantità che per un centravanti
 * (le sbarre misurate sono 0,10 e 1,00 di bonus a presenza), e un portiere le ha NEGATIVE perché per lui
 * `fm - mv` è dominato dai gol presi. Le sbarre viaggiano con la riga (`categoryBars`) proprio perché la
 * parola si possa controllare invece di crederci.
 */

/** Le sei parole, dalla più forte alla più debole. L'INDICE è la scala. */
export const CATEGORIA_LADDER = [
  'oro',
  'argento',
  'bronzo',
  'cristallo',
  'scommessa',
  'scarto',
] as const;

export type Categoria = (typeof CATEGORIA_LADDER)[number];

/**
 * TRE CARATTERI, come per la titolarità, e con la stessa cura su una coppia.
 *
 * `scommessa` e `scarto` troncate darebbero `SCO` e `SCA`: due sigle che differiscono per l'ultima lettera
 * per due parole che dicono il CONTRARIO l'una dell'altra - «nessuno l'ha ancora misurato» contro «è
 * misurato e porta poco». È lo stesso inciampo di `BAN`/`BAL` un file più in là, e le due sigle si
 * allontanano di DUE caratteri invece di uno: `SCM` (s-c-m) e `SRT` (s-r-t), lo scheletro consonantico di
 * ognuna. Il test che lo pretende è nato prima di queste due sigle e ha bocciato la prima coppia scelta.
 */
export const CATEGORIA_SHORT: Record<Categoria, string> = {
  oro: 'ORO',
  argento: 'ARG',
  bronzo: 'BRO',
  cristallo: 'CRI',
  scommessa: 'SCM',
  scarto: 'SRT',
};

/** Cosa promette ognuna, con le parole con cui è stata dettata (01/09/2026). */
const PROMISE: Record<Categoria, string> = {
  oro: 'gioca sempre e porta tanti bonus per il suo ruolo',
  argento: 'gioca sempre e porta bonus, ma non fra i tanti del suo ruolo',
  bronzo: 'gioca sempre, e i bonus non sono la ragione per cui lo compri',
  cristallo: 'gioca poco, ma quando gioca porta bonus',
  scommessa: 'nessuno l’ha ancora misurato: potrebbe fare meglio degli scarti',
  scarto: 'gioca poco e porta poco - ed è MISURATO, non ignoto',
};

/** Vero per una parola che è davvero una categoria: il foglio potrebbe portarne una che non conosciamo. */
export function isCategoria(value: unknown): value is Categoria {
  return typeof value === 'string' && (CATEGORIA_LADDER as readonly string[]).includes(value);
}

/**
 * Dove sta sulla scala, 0 = `oro`. Null per una parola che il foglio non porta, mai un numero.
 *
 * È quello per cui si ORDINA: ordinare per la sigla darebbe ARG, BRO, CRI, ORO, SCM, SCT, cioè l'alfabeto
 * al posto della scala.
 */
export function categoriaRank(category: string | null | undefined): number | null {
  if (!isCategoria(category)) return null;
  return CATEGORIA_LADDER.indexOf(category);
}

/**
 * La frase intera: la parola, la promessa e i due numeri che l'hanno decisa. Null se il foglio non la porta.
 *
 * `bonus` è il suo tasso misurato a presenza e `bars` le due sbarre del suo ruolo, come «0.87/1.25». Una
 * `scommessa` non ha tasso da mostrare - è la definizione - quindi la frase lo dice invece di stampare un
 * trattino accanto a due sbarre che non lo riguardano.
 */
export function categoriaNote(
  category: string | null | undefined,
  bonus: number | null | undefined,
  bars: string | null | undefined,
): string | null {
  if (!isCategoria(category)) return null;
  const head = `${category.toUpperCase()}: ${PROMISE[category]}.`;
  if (category === 'scommessa') {
    return `${head} Non ha nemmeno una stagione con 15 voti su cui misurare il bonus, quindi la parola`
      + ' parla dell’assenza di misura e non di lui.';
  }
  const mine = bonus == null ? null : `${bonus > 0 ? '+' : ''}${bonus.toFixed(2)} di bonus a presenza`;
  const pair = bars?.includes('/') ? bars.split('/') : null;
  const scale = pair
    ? ` Le sbarre del suo ruolo: ${pair[0]} per «porta bonus», ${pair[1]} per «tanti bonus».`
    : '';
  return `${head}${mine ? ` Misurato: ${mine} sulle sue ultime stagioni.` : ''}${scale}`;
}
