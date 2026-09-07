/**
 * LA TITOLARITÀ IN UNA PAROLA: le sei parole dell'operatore, come si abbreviano e come si spiegano.
 *
 * Il gradino lo DECIDE il toolkit (`engine/status.py`, colonna `desc_titolarita`) e qui non si ricalcola
 * niente: legge l'undici tipo disegnato, quindi è una previsione su una persona e sta dove le previsioni
 * si misurano. Questo file è solo il vocabolario di lettura - la sigla, l'ordine e la frase - e sta in
 * `core/` perché tre schermate diverse mostreranno la stessa parola e tre traduzioni diverse finirebbero
 * per non essere d'accordo su una.
 *
 * «TITOLARITÀ» QUI VUOL DIRE PRENDERE IL VOTO, non partire dall'inizio (definizione dell'operatore,
 * 20/08/2026): l'asse della scala è la quota di giornate a voto, e `titolare` significa «gioca quasi ogni
 * partita, e per quasi tutta». Chi PARTE titolare è un'altra domanda e si chiama «quota da titolare».
 *
 * DAL 07/09/2026 LA PAROLA PUÒ ANCHE ESSERE DICHIARATA dall'operatore, che è l'unica cosa in grado di
 * scavalcare il gradino del foglio: le sue dritte stanno in `core/player-rulings.ts` con la misura che
 * dice quante giornate ogni parola comporta. Il vocabolario resta questo e uno solo - la dichiarazione
 * sceglie fra QUESTE sei parole, quindi una riga dichiarata e una misurata si leggono nella stessa
 * scala e si possono confrontare.
 */

/** Le sei parole, dalla più forte alla più debole. L'INDICE è la scala. */
export const TITOLARITA_LADDER = [
  'bandiera',
  'titolarissimo',
  'titolare',
  'ballottaggio',
  'panchina',
  'riserva',
] as const;

export type Titolarita = (typeof TITOLARITA_LADDER)[number];

/**
 * TRE CARATTERI, che è quello che l'operatore ha chiesto di vedere in tabella (20/08/2026).
 *
 * Non sono i primi tre di ogni parola, e la ragione è una sola: `bandiera` e `ballottaggio` darebbero
 * `BAN` e `BAL`, che differiscono per l'ULTIMO carattere e sono il gradino 1 e il gradino 4 - le due
 * parole più lontane della scala sarebbero le due sigle più simili. `BLT` costa una lettera di
 * leggibilità e la spende dove serve. Le altre quattro sono la troncatura naturale, e `TIS` prende le
 * lettere che distinguono titolar-ISS-imo da titolare: quelli sì sono gradini vicini, e confonderli
 * costa poco.
 *
 * La parola intera e i due numeri che l'hanno decisa stanno nel tooltip: la sigla è un promemoria, non
 * la spiegazione.
 */
export const TITOLARITA_SHORT: Record<Titolarita, string> = {
  bandiera: 'BAN',
  titolarissimo: 'TIS',
  titolare: 'TIT',
  ballottaggio: 'BLT',
  panchina: 'PAN',
  riserva: 'RIS',
};

/** Vero per una parola che è davvero un gradino: il foglio potrebbe portarne una che non conosciamo. */
export function isTitolarita(value: unknown): value is Titolarita {
  return typeof value === 'string' && (TITOLARITA_LADDER as readonly string[]).includes(value);
}

/**
 * Dove sta sulla scala, 0 = `bandiera`. Null per uno stato ignoto, mai un numero.
 *
 * È quello per cui si ORDINA: ordinare per la sigla darebbe BAL, BAN, PAN, RIS, TIS, TIT, cioè
 * l'alfabeto al posto della scala.
 */
export function titolaritaRank(status: string | null | undefined): number | null {
  return isTitolarita(status) ? TITOLARITA_LADDER.indexOf(status) : null;
}

/**
 * La frase del tooltip: la parola, la promessa che porta, e i due numeri da cui esce.
 *
 * I numeri ci sono perché un gradino si ribalta su un minuto - misurato: fra due fogli costruiti a
 * mezz'ora di distanza 40 righe su 1023 cambiano parola e 38 lo fanno sull'asse dei minuti, con la quota
 * identica al decimale (Mbappè 77' → 75', da `bandiera` a `titolare`). Chi vede solo l'etichetta non può
 * accorgersi che un uomo è al bordo; chi vede 74' sì.
 */
export function titolaritaNote(
  status: string | null | undefined,
  /** Quota delle giornate PER CUI È DISPONIBILE in cui il foglio gli prevede un voto (`desc_titolarita_play`). */
  play: number | null,
  /** Minuti che ci si aspetta stia in campo in una partita che gioca (`desc_minutes_next`). */
  minutes: number | null,
  /**
   * IL GIORNO IN CUI L'OPERATORE L'HA DICHIARATA, quando questa parola è una sua DRITTA e non del
   * modello (`core/player-rulings.ts`).
   *
   * Cambia l'ultima frase e non il resto: la promessa del gradino è la stessa (è la scala a decidere
   * cosa promette la parola), quello che cambia è CHI l'ha detto - e una riga che porta una
   * dichiarazione dicendo «deciso dal toolkit» sarebbe una frase falsa accanto a un numero vero.
   */
  declaredOn?: string | null,
): string | null {
  if (!isTitolarita(status)) return null;
  const promise: Record<Titolarita, string> = {
    bandiera: 'gioca ogni partita (>90%) e almeno 75 minuti',
    titolarissimo: 'gioca quasi ogni partita (>80%) e almeno 75 minuti',
    titolare: 'gioca quasi ogni partita (>80%) e almeno 65 minuti',
    ballottaggio: 'gioca quasi ogni partita, ma i minuti non sono garantiti',
    panchina: 'spesso entra in campo, senza certezze',
    riserva: 'non entra spesso, e non è detto vada nemmeno in panchina',
  };
  const bits = [`${status.toUpperCase()}: ${promise[status]}`];
  if (play != null) bits.push(`voto nel ${Math.round(play * 100)}% delle partite per cui è disponibile`);
  if (minutes != null) bits.push(`${Math.round(minutes)}' quando gioca`);
  bits.push(
    declaredOn
      ? `dritta tua del ${declaredOn}: hai dichiarato tu questo gradino, e i numeri della riga lo `
        + 'seguono - il foglio dice un’altra cosa o non dice niente'
      : 'deciso dal toolkit sull’undici tipo disegnato: chi la board non schiera non può essere '
        + 'titolare, chi schiera non scende sotto ballottaggio',
  );
  return bits.join(' · ');
}
