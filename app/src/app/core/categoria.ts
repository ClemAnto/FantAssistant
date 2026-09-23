/**
 * LE DIECI PAROLE DENTRO IL RUOLO: le categorie dell'operatore, come si abbreviano e come si spiegano.
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

/** Le dieci parole, dalla più forte alla più debole. L'INDICE è la scala. */
export const CATEGORIA_LADDER = [
  'super',
  'top',
  'semi',
  'promessa',
  'solido',
  // `scommessa` E' RISALITA SOPRA `operaio` il 23/09/2026 (sera), quando la parola ha cambiato
  // significato: non piu' «nessuno l'ha prezzato» ma «partenza non eccezionale, potenziale ottimo
  // proseguimento». Il suo ordine, in tre parole: PROMESSA > SCOMMESSA > OPERAIO.
  'scommessa',
  'operaio',
  'boa',
  'scarto',
  'incognita',
] as const;

export type Categoria = (typeof CATEGORIA_LADDER)[number];

/** Come si scrivono per esteso: la parola del foglio è uno slug, questo è l'italiano. */
export const CATEGORIA_LABEL: Record<Categoria, string> = {
  // I nomi per esteso sono quelli del suo riepilogo del 23/09/2026 - SUPERTOP · TOP · SEMITOP ·
  // PROMESSE · SOLIDI · RISERVE - quindi due si allungano rispetto a ieri (`Super` e `Semi`): lo
  // slug del foglio non si tocca, la parola che si legge sì.
  super: 'Supertop',
  top: 'Top',
  semi: 'Semitop',
  promessa: 'Promessa',
  solido: 'Solido',
  operaio: 'Operaio',
  boa: 'Boa',
  scommessa: 'Scommessa',
  scarto: 'Scarto',
  incognita: 'Incognita',
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
  promessa: 'PRM',
  solido: 'SOL',
  operaio: 'OPR',
  boa: 'BOA',
  scommessa: 'SCM',
  scarto: 'SRT',
  // `incognita` e `scarto` dicono il CONTRARIO l'una dell'altra - «nessuno l'ha misurato» contro «è
  // misurato e non gioca» - ed è la coppia che prima erano `scommessa` e `scarto`: le sigle si
  // allontanano di tutt'e tre le lettere.
  incognita: 'IGN',
};

/** Cosa promette ognuna, con le parole con cui è stata dettata (22/09/2026). */
const PROMISE: Record<Categoria, string> = {
  super: 'gioca sempre ed è fuori scala nel suo ruolo',
  top: 'è fra i migliori del suo ruolo - o lo sarebbe, se giocasse di più',
  semi: 'sta in alto nel suo ruolo',
  promessa: 'ha costanza e titolarità, e nelle giornate già giocate lo sta dimostrando',
  solido: 'ha costanza e titolarità: un ottimo comprimario',
  // «RISERVA» è da schierare come riserva nella TUA rosa, non riserva nella sua squadra di serie A:
  // sua precisazione del 23/09/2026, ed è la ragione per cui `boa` gli sta subito sotto e non in fondo.
  // La stessa sera la parola è diventata `operaio` (la citazione resta com'è detta): il conteggio era
  // già stato curato dalla sbarra, e questo cura il NOME — l'icona era l'attrezzo da prima.
  operaio: 'da schierare come riserva nella tua rosa',
  boa: 'gioca quasi sempre con una media voto dignitosa: piuttosto che affondare, meglio averlo',
  scommessa: 'nessuno l’ha ancora prezzato, ma il calcio che ha alle spalle promette bene',
  // Dal 23/09/2026 `scarto` ha DUE porte - chi non gioca abbastanza e chi gioca e non vale un posto -
  // e la frase le copre tutt'e due: la vecchia («non gioca abbastanza») avrebbe mentito sui ~210 che
  // sono scesi qui da `operaio`, che il calendario lo giocano al 50-80%.
  scarto: 'è MISURATO, e non vale un posto in rosa',
  incognita: 'non c’è niente da leggere: nessuno l’ha mai visto giocare',
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
 * «6.78/6.90/7.10/7.55». Una `scommessa` non ha livello da mostrare - è la definizione - quindi la frase
 * lo dice invece di stampare un trattino accanto a quattro sbarre che non la riguardano.
 */
export function categoriaNote(
  category: string | null | undefined,
  level: number | null | undefined,
  bars: string | null | undefined,
): string | null {
  if (!isCategoria(category)) return null;
  const head = `${CATEGORIA_LABEL[category].toUpperCase()}: ${PROMISE[category]}.`;
  if (category === 'incognita') {
    return `${head} Il motore non riesce a dargli una fantamedia attesa, quindi la parola parla`
      + ' dell’assenza di misura e non di lui.';
  }
  if (category === 'scommessa') {
    return `${head} La fantamedia attesa è l’ancora del suo ruolo e non parla di lui: quello che`
      + ' promette sta nel calcio che ha giocato altrove.';
  }
  const mine = level == null ? null : `${level.toFixed(2)} di fantamedia attesa`;
  // CINQUE dal 23/09/2026 (`operaio` ha preso la sua), e si accettano anche i QUATTRO di un pacchetto
  // piu' vecchio invece di tacere: una revisione precedente porta una scala vera, solo piu' corta.
  const cut = bars?.includes('/') ? bars.split('/') : null;
  const names = cut?.length === 5
    ? ['operaio', 'solido', 'semi', 'top', 'super']
    : ['solido', 'semi', 'top', 'super'];
  const scale = cut && cut.length === names.length
    ? ' Le sbarre del suo ruolo: '
      + cut.map((bar, at) => `${bar} ${names[at]}`).join(', ') + '.'
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
 *    urla». `operaio` e' la parola della meta' del listone - gioca, e basta - quindi porta il
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
  // I QUATTRO GRADINI PIENI SONO RI-SPAZIATI, e la ragione è misurata e non estetica: infilare
  // `promessa` fra `semi` (/35) e `solido` (/18) lasciava due salti da 14 e 16 punti per canale sul
  // fondo composito, contro i 19 che la spaziatura pari produce (1.00 · .62 · .40 · .25 · .14). È la
  // lezione del 23/09 sulle bande della Strategia: «i due fondi sono diversi» è un'affermazione sul
  // CSS, «si vedono diversi» è una misura.
  super: 'bg-success text-page',
  top: 'bg-success/62 text-fg',
  semi: 'bg-success/40 text-fg',
  promessa: 'bg-success/25 text-fg',
  solido: 'bg-success/14 text-fg',
  operaio: 'bg-control text-fg',
  // SOTTO IL CENTRO SI SCENDE IN AMBRA, e i tre gradini sono misurati come quelli del verde: sul fondo
  // composito i salti sono 32 e 40 punti per canale, ben sopra i 19 che la ri-spaziatura del verde ha
  // fissato come minimo leggibile. L'ambra su `scommessa` dice dove sta sulla SCALA e non un giudizio
  // sul calciatore: quello che promette è nella parola e nella frase.
  boa: 'bg-warning/18 text-fg',
  scommessa: 'bg-warning/32 text-fg',
  scarto: 'bg-warning/50 text-fg',
  // L'IGNOTO NON HA UN COLORE DI QUALITÀ, e da oggi la parola dell'ignoto è questa: `scommessa` ha una
  // condizione e quindi è un giudizio, `incognita` è l'assenza di uno.
  incognita: 'text-muted',
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
 * Le icone dicono il MESTIERE e non solo il grado: `operaio` porta l'attrezzo perche' e' quello
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
  // `promessa` porta il FUOCO perché dice una cosa diversa dalle altre: non un grado, ma che lo sta
  // già facendo adesso. `rise` accanto direbbe due volte «sale».
  promessa: { type: 'fire', theme: 'outline' },
  solido: { type: 'check-circle', theme: 'outline' },
  operaio: { type: 'tool', theme: 'outline' },
  // Il punto di domanda passa a `incognita`, che è la parola che ora dice «non sappiamo»; `scommessa`
  // prende la lampadina, perché da oggi afferma qualcosa - c'è un indizio, e vale un secondo sguardo.
  // `boa` porta la puntina: è l'uomo che sta sempre lì. `tool` accanto direbbe due volte «riempie».
  boa: { type: 'pushpin', theme: 'outline' },
  scommessa: { type: 'bulb', theme: 'outline' },
  scarto: { type: 'fall', theme: 'outline' },
  incognita: { type: 'question-circle', theme: 'outline' },
};

/** L'icona di una parola, o null se il foglio non ne porta una: chi disegna non sceglie. */
export function categoriaIcon(
  category: string | null | undefined,
): { type: string; theme: 'outline' | 'fill' } | null {
  return isCategoria(category) ? CATEGORIA_ICON[category] : null;
}
