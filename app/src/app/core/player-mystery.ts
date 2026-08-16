import { PlayerMark } from './player-status';

/**
 * IL MISTERO: un uomo che non è infortunato, che a rigor di logica dovrebbe giocare, e che non gioca.
 *
 * L'operatore lo ha chiesto così (15/08/2026, «anche Angelino o Openda per esempio»), ed è una domanda
 * che il resto di questo progetto non fa: il motore prevede le presenze e la tabella spiega una casella
 * vuota (panchina, infortunio, non in quel campionato), ma nessuno mette insieme le tre cose che rendono
 * un caso strano - era DISPONIBILE, il suo listone lo prezza fra i primi del ruolo, e i minuti non ci sono.
 *
 * È una DESCRIZIONE e non una previsione, e la differenza va detta: i due marchi di rotazione del
 * pannello d'asta portano addosso la loro precisione misurata (90,4% contro una base del 59,5%) perché
 * sono misurati sulle prime giornate della stagione in corso. Questo guarda la CODA di una stagione
 * finita, dove nessuno ha misurato niente, quindi non promette nulla sul futuro: dice che quei minuti
 * non ci sono e che l'infortunio non li spiega. Il perché - mercato, gerarchia, rottura - lo sa
 * l'operatore, e se lo sa lo DICHIARA (`config/player_notes.json`).
 */

/** Quante giornate guarda: le stesse ultime dieci che la tabella delle partite disegna. */
export const MYSTERY_WINDOW = 10;

/** Sotto quanti minuti in quella finestra un uomo «non gioca»: nove minuti a giornata. */
export const MYSTERY_MINUTES = 90;

/** ...e quante di quelle giornate può aver saltato per infortunio prima che l'infortunio SIA la spiegazione. */
export const MYSTERY_INJURED_SHARE = 0.3;

/**
 * Da quale percentile del suo ruolo un uomo «dovrebbe giocare», e la misura è la sua QUALITÀ.
 *
 * Non il prezzo, ed è una correzione fatta sul caso stesso che ha chiesto la regola: Angelino è quotato
 * 3 fra i difensori, cioè al 36° percentile - il listone ha già rinunciato a lui - mentre il suo VOTO
 * misurato sta al 91°. Un criterio sul prezzo non lo avrebbe mai segnato, e lui è il mistero. Vale anche
 * la regola di casa: «la quotazione è un giudizio, e la usiamo quando non abbiamo risorse oggettive»,
 * e qui una risorsa oggettiva c'è.
 *
 * Metà listone è la soglia: sotto, un uomo che non gioca non è un mistero, è una riserva.
 */
export const MYSTERY_QUALITY_PERCENTILE = 50;

/**
 * ...e quanto il MOTORE deve aspettarselo in campo perché la sua assenza sia strana.
 *
 * La terza condizione, aggiunta dopo aver visto la lista: senza di essa il marchio prendeva Contini, il
 * terzo portiere del Napoli - dieci righe da panchinaro, zero minuti, e una media voto alta perché quando
 * gioca fa il suo. Ma una riserva che non gioca non è un mistero, è una gerarchia. Il motore gli prevede
 * il 23% del calendario, e con questa soglia esce; Angelino, che il motore vede in campo per più di metà
 * stagione, resta.
 */
export const MYSTERY_EXPECTED_SHARE = 0.4;

export interface MysteryInput {
  /** Minuti giocati nelle giornate della finestra, e in quante di quelle ha una riga. */
  minutes: number;
  rounds: number;
  /** In quante di quelle giornate era dentro uno spell di infortunio. */
  injured: number;
  /** Il suo posto nel VOTO dentro il listone, 0-99. Null = non abbiamo di che misurarlo. */
  qualityPercentile: number | null;
  /** La quota di calendario che il MOTORE gli prevede, prima di ogni preferenza. Null = non lo prevede. */
  expectedShare: number | null;
  /** La stagione a cui si riferisce, per la frase. */
  season: string;
}

/**
 * Il marchio, o null. Serve almeno mezza finestra di righe: con due giornate su dieci non si sa se non
 * giocava o se non c'era, e «vuoto = ignoto» vale anche qui.
 */
export function mysteryOf(one: MysteryInput): PlayerMark | null {
  if (one.rounds < MYSTERY_WINDOW / 2) return null;
  if (one.minutes > MYSTERY_MINUTES) return null;
  if (one.injured > one.rounds * MYSTERY_INJURED_SHARE) return null;
  if (one.qualityPercentile == null || one.qualityPercentile < MYSTERY_QUALITY_PERCENTILE) return null;
  if (one.expectedShare == null || one.expectedShare < MYSTERY_EXPECTED_SHARE) return null;
  return {
    flag: 'mystery',
    note:
      `${one.minutes} minuti nelle ultime ${one.rounds} giornate di ${one.season}`
      + (one.injured ? `, e in ${one.injured} era infortunato` : ', senza essere infortunato')
      + ` · come voti sta nel ${one.qualityPercentile}° percentile del listone`,
  };
}
