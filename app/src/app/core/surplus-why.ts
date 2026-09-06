/**
 * PERCHE' IL SURPLUS DI UN UOMO E' QUELLO, letto dal foglio e mai ricalcolato.
 *
 * Richiesta dell'operatore (05/09/2026): «non sono ancora contento del surplus assegnato ad ogni
 * calciatore, ci sono delle dinamiche che non mi convincono ... per ogni calciatore mi espliciti i
 * fattori che poi portano al valore di surplus/match». Una pagina che risponde RICALCOLANDO sarebbe la
 * cosa peggiore possibile: spiegherebbe un numero che nessuno ha, e il giorno in cui il motore cambia
 * direbbe due cose diverse dello stesso uomo. Quindi qui non si prevede niente - si LEGGE la scala che
 * il toolkit ha scritto sul foglio (`why_*`, revisione 45, `evaluate.explain_window`), si ricostruisce
 * la moltiplicazione finale e si CONTROLLA che torni.
 *
 * TRE COSE CHE QUESTO FILE FA, e vale la pena dirle prima.
 *
 *  1. IL CONTROLLO E' PARTE DELLA SPIEGAZIONE. `(FM - rimpiazzo) x Pa` deve riprodurre `engine_surplus`;
 *     dove non torna, la riga lo DICE invece di stampare una catena plausibile che finisce su un altro
 *     numero. E' la regola di casa «verifica la FUNZIONE, non la colonna che le somiglia» applicata a
 *     uno schermo: un audit che stampa il numero atteso accanto a quello vero senza confrontarli
 *     risponde «nessun problema» dopo aver guardato niente.
 *  2. DUE SURPLUS CONVIVONO SOLO SE SI CHIAMANO IN DUE MODI. Il foglio ne ha uno; l'app ne mostra un
 *     altro, riscalato dalla finestra d'infortunio e dall'assicurazione (`core/expected-play.ts`), ed e'
 *     quello con cui ordina le sue liste. Sono due domande - «cosa dice il motore» e «cosa compro
 *     sapendo quello che so oggi» - quindi due colonne e due nomi, mai una cifra sola.
 *  3. IL SURPLUS PER GIORNATA E' UNA DIVISIONE, non un'altra opinione: e' il totale diviso le giornate
 *     che restano, cioe' una costante uguale per tutti, che non puo' riordinare niente. Accanto vive il
 *     surplus PER PARTITA GIOCATA (`FM - rimpiazzo`), che e' un'altra unita' e per questo ha un altro
 *     nome - un uomo da mezza stagione rende molto per partita e poco per giornata, ed e' esattamente
 *     la dinamica che questa pagina deve rendere visibile.
 */

/** Le colonne `why_*` del foglio, come il foglio le porta. Nulle su un foglio precedente alla revisione 45. */
export interface WhyColumns {
  /** La sua fantamedia MISURATA nella stagione di input: il numero che il core regredisce. */
  fmPrev: number | null;
  /** ...e il suo voto base, che e' quello che il modello dei PORTIERI legge al posto della fantamedia. */
  mvPrev: number | null;
  /** Quante presenze a voto l'hanno prodotta: sotto quindici il core rifiuta di prevedere. */
  pvPrev: number | null;
  /** Le stesse presenze come quota del calendario di quella stagione: l'input della retta delle presenze. */
  sharePrev: number | null;
  matchdaysPrev: number | null;
  /** La costante con cui il core tira la fantamedia verso l'ancora: 0,50 su classic e 0,42 su mantra. */
  beta: number | null;
  /** Se ha cambiato squadra: un termine della retta, e vale «no» anche quando la squadra di prima e' ignota. */
  clubChange: boolean | null;
  /** I minuti dell'anno scorso come quota di quelli disponibili nel suo campionato: l'input di R3. */
  minutesShare: number | null;
  /** Le presenze a voto GIA' FATTE nella stagione bersaglio, e su quante giornate: l'input di R20. */
  pvSeen: number | null;
  roundsSeen: number | null;
  /** Le due scale, come stringhe `chiave:valore;...` - vedi `parseRungs`. */
  fmSteps: string | null;
  pvSteps: string | null;
}

/**
 * COME SI CHIAMA UNA REGOLA, in una riga.
 *
 * Il vocabolario sta qui e non nel template per la ragione di sempre - due pagine che leggessero la
 * stessa sigla scriverebbero due frasi - e le chiavi sono quelle di `evaluate.ADOPTED`. Una chiave che
 * non e' in elenco si STAMPA COM'E': una regola adottata domani deve comparire con la sua sigla, non
 * sparire da una spiegazione perche' questo file non la conosce ancora.
 */
export const RULE_LABEL: Record<string, string> = {
  R0: 'Il core',
  R0c: "Chi il motore non ha mai visto: l'ancora del ruolo",
  R3: 'I minuti, non solo le presenze',
  R3c: 'I minuti sulle giornate del calendario euro',
  R7: 'Portieri: quanto tiene il posto un portiere',
  R13: 'Il calcio giocato altrove',
  R18: "Cinque stagioni, non solo l'ultima",
  R19: 'Il salto di livello fra il club di prima e quello nuovo',
  R20K6: 'Le giornate gia’ giocate quest’anno',
  R20K10: 'Le giornate gia’ giocate quest’anno',
  R23: 'Il reparto in cui arriva',
};

/**
 * ...e COSA FA, per la legenda della pagina: una frase per regola, col meccanismo e non col verdetto.
 *
 * Sta accanto all'etichetta e non in un tooltip: i tooltip sono corti per regola dell'operatore
 * (05/09/2026), e questa e' la meta' della richiesta che dice «devi esplicitare anche come calcoli i
 * fattori» - cioe' e' il CONTENUTO della pagina, non la spiegazione di un'icona.
 */
export const RULE_NOTE: Record<string, string> = {
  R0:
    "La fantamedia dell'anno scorso tirata verso l'ancora del suo ruolo: ancora + beta × (sua FM − ancora). " +
    'Per i portieri e’ un modello a parte, che parte dal voto base e sottrae i gol che il suo club si aspetta ' +
    'di subire. Sotto 15 presenze il core non prevede affatto, e allora vale il ripiego dichiarato.',
  R0c: "Chi non ha una stagione misurata qui non riceve un numero inventato: riceve l'ancora del suo ruolo.",
  R3:
    'Le presenze dicono quante volte ha preso un voto, i minuti dicono se le partite le ha giocate o solo ' +
    'chiuse. La quota di minuti su quelli disponibili nel suo campionato entra nella retta delle presenze.',
  R3c: 'Come sopra, ma i minuti sono contati sulle sole giornate che il calendario euro seleziona.',
  R7: 'Per un portiere la memoria del posto e’ diversa da quella di un uomo di movimento, e ha la sua retta.',
  R13: 'Nessuna stagione qui, ma partite recenti altrove: quante e quanto spesso, non con che voto.',
  R18:
    "Il core legge l'ultima stagione; questa legge anche la media delle ultime cinque, tirata verso la stessa " +
    'ancora. Serve a non prendere per livello nuovo un anno storto o un anno fortunato.',
  R19:
    'Chi scende di livello sale di ruolo: conta la DIFFERENZA di forza (Elo) fra il club che lascia e quello ' +
    'che lo compra, non la forza del club nuovo da sola.',
  R20K6:
    'Le giornate gia’ giocate di questa stagione, mescolate col resto del modello: (k × osservato + K × ' +
    'previsto) / (k + K), con K = 6 su EuroLeghe. A stagione appena cominciata pesa poco, a gennaio quasi tutto.',
  R20K10:
    'Le giornate gia’ giocate di questa stagione, mescolate col resto del modello: (k × osservato + K × ' +
    'previsto) / (k + K), con K = 10 su Serie A. A stagione appena cominciata pesa poco, a gennaio quasi tutto.',
  R23:
    'Quanto vale sul mercato rispetto a chi gli contende il posto nel reparto in cui arriva. E’ l’unico prezzo ' +
    'che entra in un numero del motore, ed e’ quello di Transfermarkt: la quotazione del listone non entra mai.',
};

/** Un gradino della scala: il valore DOPO quella regola, e quanto ha spostato rispetto al precedente. */
export interface Rung {
  key: string;
  label: string;
  value: number | null;
  /** Vuoto sul primo gradino (non c'e' un «prima») e dove uno dei due valori manca. */
  delta: number | null;
  /** True quando quella regola su di lui non ha detto niente: il gradino esiste e non muove. */
  silent: boolean;
}

/**
 * `R0:6.312;R19:;R23:6.298` -> tre gradini, di cui uno muto.
 *
 * Un valore vuoto NON e' uno zero, ed e' l'informazione che il foglio manda apposta: vuol dire che
 * quella regola su quest'uomo non ha prodotto un numero (il core non lo prezza, o la regola non lo
 * tocca). Una stringa che non e' nella forma attesa da' una lista vuota invece di gradini inventati.
 */
export function parseRungs(text: string | null | undefined): Rung[] {
  if (!text) return [];
  const out: Rung[] = [];
  let previous: number | null = null;
  for (const piece of text.split(';')) {
    const at = piece.indexOf(':');
    if (at <= 0) continue;
    const key = piece.slice(0, at).trim();
    const raw = piece.slice(at + 1).trim();
    const parsed = raw === '' ? null : Number(raw);
    const value = parsed != null && Number.isFinite(parsed) ? parsed : null;
    const delta = value != null && previous != null ? value - previous : null;
    out.push({
      key,
      label: RULE_LABEL[key] ?? key,
      value,
      delta,
      // Muto = ha un valore e non lo ha cambiato. Il primo gradino non e' mai muto: e' il punto di
      // partenza, non una regola che ha taciuto.
      silent: out.length > 0 && delta != null && Math.abs(delta) < 1e-9,
    });
    if (value != null) previous = value;
  }
  return out;
}

/** Da dove viene la valutazione della riga: le tre che il foglio distingue gia'. */
export type WhyBasis = 'core' | 'estimate' | 'none';

/** Quello che serve per spiegare una riga: il foglio, il calendario, e il riprezzo dell'app. */
export interface WhyInput {
  fm: number | null;
  pv: number | null;
  replacement: number | null;
  /** Il surplus COM'E' SCRITTO sul foglio: `engine_surplus`, o `est_surplus` con lo sconto gia' dentro. */
  sheetSurplus: number | null;
  confidence: number;
  fmIsEstimate: boolean;
  pvIsEstimate: boolean;
  estBasis: string | null;
  estNote: string | null;
  anchor: number | null;
  /** Le giornate che il foglio sta prevedendo: quelle che RESTANO, non quelle della stagione. */
  matchdays: number | null;
  why: WhyColumns | null;
  /** Il fattore con cui l'app riprezza quel surplus (`core/expected-play.ts`): 1 = niente da togliere. */
  factor: number;
}

/** La spiegazione di una riga, pronta da disegnare: nessun numero nasce qui, tutti arrivano. */
export interface SurplusWhy {
  basis: WhyBasis;
  fm: number | null;
  pv: number | null;
  replacement: number | null;
  matchdays: number | null;
  confidence: number;
  /** `FM - rimpiazzo`: quanto rende una sua PARTITA GIOCATA sopra chi giocherebbe al posto suo. */
  perPlayed: number | null;
  /** Il surplus del foglio, e lo stesso diviso le giornate che restano: due unita', due nomi. */
  sheetSurplus: number | null;
  sheetPerMatch: number | null;
  /** ...e i due dell'app, dopo la finestra d'infortunio e l'assicurazione. */
  appSurplus: number | null;
  appPerMatch: number | null;
  /**
   * LA RICOSTRUZIONE, e se TORNA. `(FM - rimpiazzo) x Pa x confidenza` deve dare il surplus del foglio;
   * `agrees` false vuol dire che questa pagina sta raccontando una catena che finisce altrove, e allora
   * si stampa il disaccordo invece della catena.
   */
  rebuilt: number | null;
  agrees: boolean;
  fmRungs: Rung[];
  pvRungs: Rung[];
  why: WhyColumns | null;
  estBasis: string | null;
  estNote: string | null;
  anchor: number | null;
}

/** Quanto puo' distare la ricostruzione dal foglio prima di chiamarla un disaccordo. */
export const REBUILD_TOLERANCE = 0.15;

/**
 * IL CONTO, tutto in un posto: legge, ricostruisce, confronta.
 *
 * La tolleranza non e' zero, e la ragione e' aritmetica e non prudenza: il foglio arrotonda
 * `engine_fm_pred` a tre decimali, `engine_pv_pred` a uno e `engine_surplus` a uno, quindi rifare la
 * moltiplicazione partendo dai numeri arrotondati non puo' dare la stessa cifra. Un decimo e mezzo copre
 * l'arrotondamento su un calendario intero e non copre un errore di modello, che e' quello che la
 * colonna deve poter vedere.
 */
export function explainSurplus(input: WhyInput): SurplusWhy {
  const basis: WhyBasis =
    input.fm == null || input.pv == null
      ? 'none'
      : input.fmIsEstimate || input.pvIsEstimate
        ? 'estimate'
        : 'core';
  const perPlayed =
    input.fm == null || input.replacement == null ? null : input.fm - input.replacement;
  const rebuilt =
    perPlayed == null || input.pv == null ? null : perPlayed * input.pv * input.confidence;
  const sheetSurplus = input.sheetSurplus;
  const appSurplus = sheetSurplus == null ? null : sheetSurplus * input.factor;
  const per = (points: number | null) =>
    points == null || !input.matchdays ? null : points / input.matchdays;
  return {
    basis,
    fm: input.fm,
    pv: input.pv,
    replacement: input.replacement,
    matchdays: input.matchdays,
    confidence: input.confidence,
    perPlayed,
    sheetSurplus,
    sheetPerMatch: per(sheetSurplus),
    appSurplus,
    appPerMatch: per(appSurplus),
    rebuilt,
    // Due numeri assenti non sono d'accordo per caso: senza uno dei due non c'e' niente da confrontare,
    // e dire «torna» sarebbe la stessa bugia di uno zero al posto di un vuoto.
    agrees:
      rebuilt != null && sheetSurplus != null
        ? Math.abs(rebuilt - sheetSurplus) <= REBUILD_TOLERANCE
        : true,
    fmRungs: parseRungs(input.why?.fmSteps),
    pvRungs: parseRungs(input.why?.pvSteps),
    why: input.why,
    estBasis: input.estBasis,
    estNote: input.estNote,
    anchor: input.anchor,
  };
}

/**
 * IL CORE SCRITTO PER ESTESO dove si puo': `6,05 + 0,50 x (6,70 - 6,05) = 6,38`.
 *
 * Serve a una cosa sola e vale la pena dirla: una formula con i SUOI numeri dentro si controlla a
 * occhio, una formula generica no. Vuota per un PORTIERE - li' il core non passa dall'ancora, parte dal
 * voto base e sottrae i gol attesi del suo club, e scrivere la formula sbagliata accanto al numero
 * giusto e' peggio che non scrivere niente - e vuota per chi il core non prezza affatto.
 */
export function coreFormula(
  why: WhyColumns | null,
  anchor: number | null,
  isKeeper: boolean,
): string | null {
  if (isKeeper || !why || why.fmPrev == null || why.beta == null || anchor == null) return null;
  // IL PUNTO e non la virgola (operatore, 05/09/2026): la formula sta accanto alle celle della tabella,
  // e due separatori sullo stesso schermo sono la contraddizione che quella regola e' nata per chiudere.
  // `toFixed` scrive gia' il punto: quello che serviva era NON riscriverlo.
  const round = (value: number, digits: number) => value.toFixed(digits);
  const core = anchor + why.beta * (why.fmPrev - anchor);
  return (
    `${round(anchor, 2)} + ${round(why.beta, 2)} × (${round(why.fmPrev, 2)} − ` +
    `${round(anchor, 2)}) = ${round(core, 2)}`
  );
}

// ---------------------------------------------------------------- com'e' andata

/**
 * L'ESITO di una riga accanto a quello che il foglio prevedeva, e lo SCARTO fra i due.
 *
 * Nessuno di questi numeri e' una previsione nuova: l'esito lo misura il toolkit (`actual_*`, revisione
 * 46) sulla stessa finestra che il motore prevede, e qui si fa una sottrazione. Il segno e' sempre
 * PREVISTO - REALE, cioe' positivo vuol dire che il motore era ottimista: una sola convenzione, scritta
 * una volta, perche' due colonne con due versi sullo stesso schermo si leggono al contrario a turno.
 */
export interface Outcome {
  /** Su quante giornate l'esito e' misurato: senza, gli altri quattro numeri non si confrontano. */
  rounds: number;
  pv: number | null;
  mv: number | null;
  fm: number | null;
  /** FM x presenze: i fantapunti che ha davvero portato in quella finestra. */
  value: number | null;
  /**
   * IL SURPLUS REALIZZATO: `(FM reale - rimpiazzo) x presenze reali`, e il rimpiazzo e' quello che il
   * foglio PREVEDEVA, non quello che quella stagione ha poi realizzato.
   *
   * E' una decisione e non una comodita': cambiando anche lo zero, lo scarto col surplus previsto
   * mescolerebbe due cose - l'errore su QUEST'UOMO e lo spostamento del livello di rimpiazzo, che e' un
   * fatto sulla lega - e non si potrebbe attribuire a nessuna delle due. Muovere una variabile sola e'
   * la sola forma in cui questa colonna dice qualcosa. Lo zero realizzato e' l'altra domanda, e finche'
   * il foglio non lo porta non si stampa: inventarlo qui sarebbe una seconda risposta.
   *
   * ZERO E' UN ESITO, e qui e' l'unico posto dove lo e' davvero: chi non ha giocato ha reso esattamente
   * zero sopra il suo rimpiazzo, perche' il rimpiazzo ha giocato al posto suo. Non e' un vuoto - e' la
   * definizione del surplus applicata a un uomo che non c'era.
   */
  surplus: number | null;
  pvGap: number | null;
  fmGap: number | null;
  valueGap: number | null;
  surplusGap: number | null;
  /** I fantapunti PREVISTI, che sono il termine di paragone di `value` e non stanno da nessun'altra parte. */
  valuePred: number | null;
  /** Vero dove la sua fantamedia REALE e' fatta di abbastanza partite per giudicare (vedi `outcomeFloor`). */
  fmScorable: boolean;
  /** La soglia che glielo ha deciso: viaggia con la riga perche' il pannello la DICE, e due letture
   *  della stessa soglia - una per filtrare e una per stamparla - finiscono per non essere d'accordo. */
  fmFloor: number;
}

/**
 * LA SOGLIA sotto la quale una fantamedia reale non giudica niente, ed e' quella del gate.
 *
 * `evaluate.scoring_floor`: 15 presenze su 38 e' il 39% del calendario che si sta prevedendo, e su una
 * finestra dentro la stagione quel calendario e' il RESTO - quindi la soglia e' la stessa QUOTA e non lo
 * stesso numero, o su un esito da 14 giornate diventerebbe irraggiungibile e la guardia smetterebbe di
 * misurare invece di fallire. Qui `full` sono le giornate della stagione: quelle giudicate piu' quelle
 * gia' giocate il giorno dell'asta.
 *
 * Non e' una scelta di questa pagina: e' la stessa che decide quali uomini entrano nelle metriche
 * pubblicate dal gate, e riusarla e' quello che rende i due numeri confrontabili.
 */
export const MIN_PV_ACT = 15;

export function outcomeFloor(rounds: number, seen: number | null): number {
  const full = rounds + (seen ?? 0);
  if (!seen || !full) return MIN_PV_ACT;
  return Math.max(3, Math.round((MIN_PV_ACT * rounds) / full));
}

/** L'esito di una riga, o null dove il foglio non ne porta uno (ogni foglio costruito oggi). */
export function outcomeOf(
  actual: { rounds: number | null; pv: number | null; mv: number | null; fm: number | null;
            value: number | null } | null,
  predicted: { fm: number | null; pv: number | null; replacement?: number | null;
               surplus?: number | null },
  seen: number | null,
): Outcome | null {
  if (!actual || actual.rounds == null) return null;
  const valuePred =
    predicted.fm == null || predicted.pv == null ? null : predicted.fm * predicted.pv;
  const gap = (pred: number | null, real: number | null) =>
    pred == null || real == null ? null : pred - real;
  // Il surplus realizzato: zero VERO per chi non ha giocato (vedi `Outcome.surplus`), e vuoto solo
  // dove manca il metro (il rimpiazzo) o l'esito stesso.
  const zero = predicted.replacement ?? null;
  const surplus =
    zero == null || actual.pv == null
      ? null
      : actual.pv === 0
        ? 0
        : actual.fm == null
          ? null
          : (actual.fm - zero) * actual.pv;
  return {
    rounds: actual.rounds,
    pv: actual.pv,
    mv: actual.mv,
    fm: actual.fm,
    value: actual.value,
    pvGap: gap(predicted.pv, actual.pv),
    // Lo scarto sulla fantamedia esiste solo dove la fantamedia reale c'e': su zero partite non c'e'
    // una media, e chiamare quello scarto «il motore ha sbagliato di 6,4» sarebbe misurare un vuoto.
    fmGap: gap(predicted.fm, actual.fm),
    valueGap: gap(valuePred, actual.value),
    surplus,
    // Contro il surplus del FOGLIO, che e' la colonna che l'operatore legge - non contro una sua
    // ricostruzione: la pagina spiega un numero che non calcola, e questo vale anche per lo scarto.
    surplusGap: gap(predicted.surplus ?? null, surplus),
    valuePred,
    fmScorable: (actual.pv ?? 0) >= outcomeFloor(actual.rounds, seen),
    fmFloor: outcomeFloor(actual.rounds, seen),
  };
}

/** Quanto il pronostico si e' avvicinato, su una lista: una riga di verbale e non una valutazione. */
export interface Calibration {
  /** Righe con un esito misurato, cioe' il denominatore di tutto il resto. */
  judged: number;
  rounds: number | null;
  /** Presenze: scarto medio col segno (positivo = il motore era ottimista) ed errore medio assoluto. */
  pvBias: number | null;
  pvError: number | null;
  /** ...e le stesse due sulla fantamedia, sui soli uomini che l'esito puo' giudicare. */
  fmBias: number | null;
  fmError: number | null;
  fmJudged: number;
  fmFloor: number | null;
  /** ...e sui fantapunti, che e' il prodotto dei due e quindi l'unica lettura che li tiene insieme. */
  valueBias: number | null;
  valueError: number | null;
  valueJudged: number;
}

/**
 * L'AGGREGATO, e va detto subito che cos'e' e che cosa non e'.
 *
 * NON e' un verdetto sul motore: il gate giudica una regola su dieci finestre out-of-sample con un
 * criterio pre-registrato, questa e' una fotografia di UNA data su UNA lega, e le sue finestre pubblicate
 * il gate le ha gia' misurate. E' la risposta alla domanda «quanto ci si e' avvicinato QUI», che e'
 * un'altra cosa e serve a leggere le righe sotto.
 *
 * DUE numeri per grandezza e non uno, sempre: l'errore MEDIO ASSOLUTO dice quanto si sbaglia, lo SCARTO
 * COL SEGNO dice da che parte - e sono indipendenti, perche' un modello puo' sbagliare molto senza
 * pendere da nessuna parte. Un errore medio senza il suo segno lascia credere che il modello sia centrato.
 *
 * La fantamedia ha il suo denominatore (`fmJudged`) perche' non e' quello delle presenze: chi ha giocato
 * poco ha una media fatta di due partite, e il gate lo esclude con la stessa soglia (`outcomeFloor`).
 */
export function calibrationOf(outcomes: (Outcome | null)[]): Calibration {
  const judged = outcomes.filter((one): one is Outcome => one != null);
  const mean = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const pv = judged.map((one) => one.pvGap).filter((gap): gap is number => gap != null);
  const fm = judged
    .filter((one) => one.fmScorable)
    .map((one) => one.fmGap)
    .filter((gap): gap is number => gap != null);
  const value = judged.map((one) => one.valueGap).filter((gap): gap is number => gap != null);
  const rounds = judged[0]?.rounds ?? null;
  return {
    judged: judged.length,
    rounds,
    pvBias: mean(pv),
    pvError: mean(pv.map(Math.abs)),
    fmBias: mean(fm),
    fmError: mean(fm.map(Math.abs)),
    fmJudged: fm.length,
    fmFloor: judged[0]?.fmFloor ?? null,
    valueBias: mean(value),
    valueError: mean(value.map(Math.abs)),
    valueJudged: value.length,
  };
}
