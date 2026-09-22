/**
 * OGNI NUMERO IN GIORNATE SI LEGGE SU UNA STAGIONE PIENA, e qui c'e' il fattore che ce lo porta.
 *
 * Regola dell'operatore, 22/09/2026: «tutti i valori che leggiamo sulle pagine devono essere
 * rapportati all'intera stagione. Quindi se il mercato impostato dura 3 giorni dovrai cmq mostrarmi i
 * dati su base 38 (sia partite attese che surplus quindi)». Nasce da una domanda su un numero che
 * sembrava basso - i dieci attaccanti piu' cari leggevano 20-26 partite attese contro le 30-36 che
 * ricordava - e meta' di quello scarto era il DENOMINATORE: il foglio prevede le giornate che
 * RESTANO (33 il 22/09/2026), non la stagione.
 *
 * NON E' UNA PREVISIONE E NON RICALCOLA NIENTE: e' una moltiplicazione per una costante, uguale per
 * tutti, quindi nessun ordinamento e nessun rapporto si muove - cambia la scala su cui si legge, che
 * e' esattamente quello che e' stato chiesto. Per la stessa ragione non passa da nessun gate.
 *
 * LA BASE E' LA STAGIONE DELLA PIATTAFORMA E NON IL NUMERO 38: su euro una stagione piena ne ha 31
 * (`platform_input` sul foglio), quindi scrivere 38 la' inventerebbe sette giornate che quella
 * piattaforma non gioca. Il foglio dichiara tutt'e due i calendari accanto alle proprie righe.
 *
 * COSA SI RIPORTA E COSA NO. Si riporta quello che e' ESTENSIVO nelle giornate, cioe' quello che
 * raddoppia se raddoppiano le partite: le partite attese, le partite attese sufficienti, il surplus,
 * il valore, il margine, e le giornate perse per una finestra d'infortunio. NON si riporta niente di
 * INTENSIVO - fantamedia, media voto, bonus a partita, minuti a partita, quote, lo SWING (che e' gia'
 * per giornata) - ne' i PREZZI (FVM, Qt.I, quanto e' stato pagato, SpM), che non sono in giornate.
 * E soprattutto non si riportano le MISURE: i gol, gli assist, gli xG e le partite gia' giocate sono
 * quello che e' successo, e proiettarli su una stagione intera vorrebbe dire trasformare un fatto in
 * una previsione - che e' la distinzione che questo progetto tiene su ogni card.
 *
 * DOVE NON SI APPLICA, e va detto: `/why` e' la pagina che SPIEGA il foglio, quindi mostra le colonne
 * come il foglio le scrive - riportarle la' vorrebbe dire far leggere una catena che non riproduce
 * piu' il numero che sta verificando.
 */

/** Il fattore che porta un numero dal calendario del foglio alla stagione piena. */
export function seasonScale(target: number | null | undefined, full: number | null | undefined): number {
  // Vuoto = ignoto, mai zero: senza uno dei due calendari non si inventa una scala, si lascia il
  // numero come sta - una pagina che moltiplicasse per un fattore indovinato direbbe una cosa che
  // nessuno ha misurato, e nessuno se ne accorgerebbe perche' il numero resta plausibile.
  if (!target || !full || target <= 0 || full <= 0) return 1;
  return full / target;
}

/** ...e la moltiplicazione, che tiene il vuoto vuoto. */
export function onSeasonBase(value: number | null | undefined, scale: number): number | null {
  return value == null ? null : value * scale;
}

/** La scala di un foglio del bundle, dai due calendari che il foglio stesso dichiara. */
export function sheetSeasonScale(
  matchdays: { platform_target?: number | null; platform_input?: number | null } | null | undefined,
): number {
  return seasonScale(matchdays?.platform_target, matchdays?.platform_input);
}

/**
 * LE GIORNATE SU CUI I NUMERI RIPORTATI SONO ESPRESSI: la stagione piena del foglio.
 *
 * E' il denominatore di ogni quota (`pv / giornate`) e il `matchdays` che `expectedPlay` riceve.
 * Va letto dal FOGLIO, che dichiara i suoi due calendari accanto alle righe; il `matchdays_target`
 * del manifest resta come ripiego per un bundle vecchio, e allora la scala e' 1 e i due numeri sono
 * lo stesso - cioe' il comportamento di prima, senza nessun fattore indovinato.
 */
export function seasonRoundsOf(
  matchdays: { platform_target?: number | null; platform_input?: number | null } | null | undefined,
  fallback: number | null | undefined,
): number | null {
  return matchdays?.platform_input ?? fallback ?? null;
}
