/**
 * LE SETTE PAROLE DENTRO IL RUOLO: le categorie dell'operatore, come si abbreviano e come si spiegano.
 *
 * La parola la DECIDE il toolkit (`engine/categories.py`, colonna `desc_category`) e qui non si ricalcola
 * niente, per la stessa ragione della titolarità accanto: i due assi che la compongono sono una previsione
 * su una persona (quante giornate a voto) e la sua fantamedia attesa, e le due stanno dove le misure si
 * giudicano. Questo file è solo il vocabolario di lettura - la sigla, l'ordine e la frase - e sta in
 * `core/` perché più schermate mostrano la stessa parola e tre traduzioni diverse finirebbero per non
 * essere d'accordo su una.
 *
 * DENTRO IL RUOLO, sempre: 6,78 di fantamedia è il miglior difensore del listone e il 44esimo attaccante.
 * Le sbarre viaggiano con la riga (`categoryBars`) proprio perché la parola si possa controllare invece
 * di crederci.
 *
 * SOSTITUISCONO le sei del 01/09/2026 (oro, argento, bronzo, cristallo, scommessa, scarto) su sua
 * istruzione del 22/09/2026, e cambia anche la quantità che le decide: non più il tasso di bonus - che
 * fu provato per primo e non riproduceva i suoi nomi - ma la FANTAMEDIA ATTESA, che somma voto base e
 * bonus ed è quello che lui guarda.
 */

/** Le sette parole, dalla più forte alla più debole. L'INDICE è la scala. */
export const CATEGORIA_LADDER = [
  'super',
  'top',
  'semi',
  'solido',
  'riserva',
  'scommessa',
  'scarto',
] as const;

export type Categoria = (typeof CATEGORIA_LADDER)[number];

/** Come si scrivono per esteso: la parola del foglio è uno slug, questo è l'italiano. */
export const CATEGORIA_LABEL: Record<Categoria, string> = {
  super: 'Super',
  top: 'Top',
  semi: 'Semi',
  solido: 'Solido',
  riserva: 'Riserva',
  scommessa: 'Scommessa',
  scarto: 'Scarto',
};

/**
 * TRE CARATTERI, come per la titolarità, e con la stessa cura sulle coppie che si somigliano.
 *
 * `scarto` e `scommessa` dicono il CONTRARIO l'una dell'altra - «è misurato e rende poco» contro
 * «nessuno l'ha ancora misurato» - quindi le loro sigle si allontanano di tutt'e tre le lettere (`SRT`
 * e `INC`) e non di una. Stessa cura fra `super` e `semi`, che sono vicine sulla scala: `SUP` e
 * `SMT`. Il test che lo pretende è nato prima di queste sigle.
 */
export const CATEGORIA_SHORT: Record<Categoria, string> = {
  super: 'SUP',
  top: 'TOP',
  semi: 'SEM',
  solido: 'SOL',
  riserva: 'RSV',
  scommessa: 'SCM',
  scarto: 'SRT',
};

/** Cosa promette ognuna, con le parole con cui è stata dettata (22/09/2026). */
const PROMISE: Record<Categoria, string> = {
  super: 'gioca sempre ed è fuori scala nel suo ruolo',
  top: 'è fra i migliori del suo ruolo - o lo sarebbe, se giocasse di più',
  semi: 'sta in alto nel suo ruolo',
  solido: 'nel quarto alto del suo ruolo, e gioca',
  riserva: 'gioca, ed è per quello che lo compri',
  scommessa: 'nessuno l’ha ancora prezzato: potrebbe fare meglio degli scarti',
  scarto: 'non gioca abbastanza - ed è MISURATO, non ignoto',
};

/** Vero per una parola che è davvero una categoria: il foglio potrebbe portarne una che non conosciamo. */
export function isCategoria(value: unknown): value is Categoria {
  return typeof value === 'string' && (CATEGORIA_LADDER as readonly string[]).includes(value);
}

/**
 * Dove sta sulla scala, 0 = `super`. Null per una parola che il foglio non porta, mai un numero.
 *
 * È quello per cui si ORDINA: ordinare per la sigla darebbe RSV, SCM, SEM, SOL, SRT, SUP, TOP, cioè
 * l'alfabeto al posto della scala.
 */
export function categoriaRank(category: string | null | undefined): number | null {
  if (!isCategoria(category)) return null;
  return CATEGORIA_LADDER.indexOf(category);
}

/**
 * La frase intera: la parola, la promessa e i numeri che l'hanno decisa. Null se il foglio non la porta.
 *
 * `level` è la sua fantamedia attesa ri-miscelata e `bars` le quattro sbarre del suo ruolo, come
 * «6.87/6.97/7.09/7.61». Una `scommessa` non ha livello da mostrare - è la definizione - quindi la frase
 * lo dice invece di stampare un trattino accanto a quattro sbarre che non la riguardano.
 */
export function categoriaNote(
  category: string | null | undefined,
  level: number | null | undefined,
  bars: string | null | undefined,
): string | null {
  if (!isCategoria(category)) return null;
  const head = `${CATEGORIA_LABEL[category].toUpperCase()}: ${PROMISE[category]}.`;
  if (category === 'scommessa') {
    return `${head} Il motore non riesce a dargli una fantamedia attesa, quindi la parola parla`
      + ' dell’assenza di misura e non di lui.';
  }
  const mine = level == null ? null : `${level.toFixed(2)} di fantamedia attesa`;
  const four = bars?.includes('/') ? bars.split('/') : null;
  const scale = four && four.length === 4
    ? ` Le sbarre del suo ruolo: ${four[0]} solido, ${four[1]} semi, ${four[2]} top,`
      + ` ${four[3]} super.`
    : '';
  return `${head}${mine ? ` Il suo: ${mine}.` : ''}${scale}`;
}

/**
 * LA TINTA DI OGNI PAROLA, con la grammatica che questa app ha gia' (`ui/gain-chip`, 25/08/2026).
 *
 * Non e' una seconda scala di colori: e' la stessa, applicata a sette gradini invece che a cinque, e
 * le tre regole che la governano sono quelle dichiarate allora.
 *
 *  * IL ROSSO NON SI USA. Resta al pericolo e alle azioni distruttive: un calciatore scarso non e' un
 *    pericolo, e dipingerlo di rosso userebbe l'inchiostro piu' forte dello schermo per dire «non lo
 *    comprare». Sotto il centro si scende in AMBRA.
 *  * IL CENTRO NON SI DIPINGE, perche' «uno schermo dove ogni numero e' dipinto e' uno schermo che
 *    urla». `riserva` e' la parola della meta' del listone - gioca, e basta - quindi porta il
 *    fondo neutro dei controlli e non una tinta.
 *  * L'IGNOTO NON HA UN COLORE DI QUALITA'. `scommessa` non e' un giudizio, e' l'assenza di uno:
 *    nessun fondo e l'inchiostro smorzato, come `ignoto` nella scala del gain. Dargli una tinta della
 *    scala direbbe di lui una cosa che nessuno ha misurato.
 *
 * L'INCHIOSTRO dipende da quanto e' pieno il fondo, come nel chip del gain: su un token PIENO
 * l'inchiostro e' lo sfondo della pagina, che e' l'opposto per costruzione; su uno traslucido si
 * legge ancora quello normale.
 */
export const CATEGORIA_TONE: Record<Categoria, string> = {
  super: 'bg-success text-page',
  top: 'bg-success/60 text-fg',
  semi: 'bg-success/35 text-fg',
  solido: 'bg-success/18 text-fg',
  riserva: 'bg-control text-fg',
  scommessa: 'text-muted',
  scarto: 'bg-warning/50 text-fg',
};

/** La tinta di una parola, o stringa vuota se il foglio non ne porta una: chi disegna non decide. */
export function categoriaTone(category: string | null | undefined): string {
  return isCategoria(category) ? CATEGORIA_TONE[category] : '';
}

/**
 * L'ICONA DI OGNI PAROLA (operatore, 22/09/2026: «nel pallino metti un'icona adeguata»).
 *
 * Sta qui accanto alla tinta e alla sigla perche' sono lo stesso vocabolario: un marchio significa la
 * stessa cosa in ogni pagina, e due disegni della stessa categoria sarebbero due legende da imparare.
 *
 * Le icone dicono il MESTIERE e non solo il grado: `riserva` porta l'attrezzo perche' e' quello
 * che fa - riempie un posto - e non una mezza stella, che direbbe «un po' bravo» di un uomo che si
 * compra per un'altra ragione. `scommessa` porta il punto di domanda e non un grado, perche' non e'
 * un giudizio: e' l'assenza di uno.
 *
 * OGNUNA VA REGISTRATA in `nz-icons.ts`, o disegna una casella vuota e la pagina urla «<svg> tag not
 * found» - il difetto pagato il 13/09 su `user-add` e il 04/09 su `eye`. Un test lo pretende.
 */
export const CATEGORIA_ICON: Record<Categoria, { type: string; theme: 'outline' | 'fill' }> = {
  super: { type: 'trophy', theme: 'outline' },
  top: { type: 'star', theme: 'fill' },
  semi: { type: 'rise', theme: 'outline' },
  solido: { type: 'check-circle', theme: 'outline' },
  riserva: { type: 'tool', theme: 'outline' },
  scommessa: { type: 'question-circle', theme: 'outline' },
  scarto: { type: 'fall', theme: 'outline' },
};

/** L'icona di una parola, o null se il foglio non ne porta una: chi disegna non sceglie. */
export function categoriaIcon(
  category: string | null | undefined,
): { type: string; theme: 'outline' | 'fill' } | null {
  return isCategoria(category) ? CATEGORIA_ICON[category] : null;
}
