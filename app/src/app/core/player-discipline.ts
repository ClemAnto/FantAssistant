import { PlayerMark } from './player-status';

/**
 * Le abitudini che costano (o fanno guadagnare) fantapunti e che nessuna colonna raccontava: gialli,
 * rossi, autogol, rigori sbagliati e - dall'altra parte - rigori parati.
 *
 * Sono MISURATE, a differenza della rottura con la società, e sono una DESCRIZIONE del passato: dicono
 * quello che ha fatto, non quello che farà. Pesano già dentro l'Overall e nella colonna Bonus/Malus (i
 * punti-evento prezzano ogni termine del config), ma un numero dentro una somma non si vede - e queste,
 * al tavolo, cambiano un'offerta.
 *
 * OGNI SOGLIA È MISURATA SUL LISTONE e non scelta a occhio: sotto ognuna c'è la distribuzione dei 324
 * quotati di Serie A con almeno 30 presenze (15/08/2026). Quelle sui numeri RARI - rossi, autogol -
 * chiedono anche un MINIMO di episodi, perché una quota su un episodio solo è sfortuna e non abitudine.
 */

/** Sotto quante presenze non si giudica: una espulsione su dieci partite non è un'abitudine. */
export const CARDS_MIN_APPEARANCES = 30;

/**
 * GIALLI per presenza, da cui l'abitudine è «molto alta» (operatore: i gialli da soli non sono un
 * grosso problema, quindi la soglia sta in alto e non al nono decile).
 *
 * Misurato: mediana 0,129 · p90 0,221 · p95 0,244 · p98 0,300 · massimo 0,385. La soglia è **un giallo
 * ogni tre partite e mezzo**, fra il p95 e il p98: prende Chabot (0,385), Romero, Ramon, Pellegrini Lu.,
 * Smolcic, Goldaniga, Zaniolo, Ranieri - e lascia in pace chi ne prende uno ogni sette.
 */
export const YELLOWS_PER_MATCH = 0.28;

/**
 * ROSSI: quanti ne servono perché sia un'abitudine, e ogni quante partite.
 *
 * Un rosso vale −1 E rovina il voto della partita, quindi si segnala più presto di un giallo - ma è
 * raro: 138 quotati su 324 ne hanno almeno uno, **48 ne hanno due** e 17 tre. Con un episodio solo non
 * si distingue il falloso dallo sfortunato, quindi ne servono due; la quota (uno ogni 33 presenze) è il
 * p95 dei 138. Prende Belahyane (3 su 41), Wesley (2 su 30), Chabot (2 su 39), Kondogbia, Romero.
 */
export const REDS_MIN = 2;
export const REDS_PER_MATCH = 0.03;

/**
 * AUTOGOL: idem, ed è ancora più raro - 60 uomini su 324 ne hanno almeno uno, **12 ne hanno due**.
 *
 * Uno ogni 50 presenze con almeno due episodi: prende Thiaw (4 in 60 presenze!), Gallo (4 in 134),
 * Ismajli (3 in 135). Vale −2 a botta, quindi due in una stagione sono una giornata di fantacalcio.
 */
export const OWN_GOALS_MIN = 2;
export const OWN_GOALS_PER_MATCH = 0.02;

/** Sotto quanti rigori battuti non c'è una quota da leggere: sbagliarne uno su uno non è una tendenza. */
export const PENALTY_MIN_TAKEN = 3;

/**
 * Da quale quota di errori un rigorista è «poco affidabile dal dischetto»: DUE SU CINQUE, che è la
 * regola dell'operatore e - misurata - il nono decile dei 42 rigoristi del listone.
 *
 * La mediana degli errori è 0,20: un rigore su cinque si sbaglia, ed è bene saperlo prima di
 * indignarsi. A 0,40 restano quelli che una fantapartita te la fanno perdere: Paz N. (3 su 3),
 * Biraghi (4 su 6), Simeone (2 su 3), Krstovic (3 su 6), Politano (4 su 10).
 */
export const PENALTY_MISS_SHARE = 0.4;

/**
 * RIGORI PARATI: l'unica di queste abitudini che è una BUONA notizia, e vale +3 a botta.
 *
 * Misurato sui 27 portieri con 20+ presenze: 25 ne hanno parato almeno uno, 15 tre o più, e la quota va
 * da 0 a 0,054. Servono **tre parate** (con una sola si premia il portiere fortunato) e una ogni 30
 * presenze: prende Milinkovic-Savic (8 su 173), Meret (8 su 188), Skorupski (12 su 320), Szczesny
 * (10 su 272), Donnarumma (8 su 213).
 */
export const PENALTY_SAVED_MIN = 3;
export const PENALTY_SAVED_PER_MATCH = 1 / 30;

/**
 * IL RIGORISTA, che è quanto si può dimostrare dei «bonus sui piazzati».
 *
 * E il limite va detto prima della soglia: di punizioni e angoli in questi dati NON C'È NULLA. I gol non
 * portano il tipo (una punizione diretta è un gol come un altro) e `assists_set_piece` è **NULL su tutte
 * le 61.306 righe** di `match_ratings` - una colonna senza sorgente, non un giocatore senza assist da
 * fermo. Quindi questa icona dice «batte i rigori», che è misurato, e non «fa bonus da fermo», che non
 * lo è.
 *
 * Cinque rigori battuti e uno ogni venticinque presenze: prende Berardi (37 in 276), Dybala (30 in 297),
 * Calhanoglu (23 in 283), Orsolini, Petagna, Vlasic, Soulè - e lascia fuori chi ne ha battuti due
 * perché il rigorista era squalificato.
 */
export const PENALTY_TAKER_MIN = 5;
export const PENALTY_TAKER_PER_MATCH = 0.04;

export interface CareerEvents {
  appearances: number;
  yellows: number;
  reds: number;
  ownGoals: number;
  penScored: number;
  penMissed: number;
  penSaved: number;
}

/** Ogni abitudine che questa carriera porta, nell'ordine in cui si leggono. Vuoto è il caso normale. */
export function habitMarks(one: CareerEvents): PlayerMark[] {
  const out: PlayerMark[] = [];
  if (one.appearances >= CARDS_MIN_APPEARANCES) {
    const yellows = one.yellows / one.appearances;
    if (yellows >= YELLOWS_PER_MATCH) {
      out.push({
        flag: 'yellows',
        note: `${one.yellows} ammonizioni in ${one.appearances} presenze`
          + ` · una ogni ${(1 / yellows).toFixed(1)} partite`,
      });
    }
    if (one.reds >= REDS_MIN && one.reds / one.appearances >= REDS_PER_MATCH) {
      out.push({
        flag: 'reds',
        note: `${one.reds} espulsioni in ${one.appearances} presenze`
          + ` · una ogni ${(one.appearances / one.reds).toFixed(0)}, e un rosso è −1 più il voto rovinato`,
      });
    }
    if (one.ownGoals >= OWN_GOALS_MIN && one.ownGoals / one.appearances >= OWN_GOALS_PER_MATCH) {
      out.push({
        flag: 'own_goals',
        note: `${one.ownGoals} autogol in ${one.appearances} presenze`
          + ` · uno ogni ${(one.appearances / one.ownGoals).toFixed(0)}, e vale −2`,
      });
    }
  }

  const taken = one.penScored + one.penMissed;
  if (
    taken >= PENALTY_TAKER_MIN
    && one.appearances > 0
    && taken / one.appearances >= PENALTY_TAKER_PER_MATCH
  ) {
    out.push({
      flag: 'set_pieces',
      note: `${taken} rigori battuti in ${one.appearances} presenze (${one.penScored} segnati)`
        + ' · di punizioni e angoli i dati non dicono nulla',
    });
  }
  if (taken >= PENALTY_MIN_TAKEN && one.penMissed / taken >= PENALTY_MISS_SHARE) {
    out.push({
      flag: 'penalty_risk',
      note: `${one.penMissed} rigori sbagliati su ${taken} battuti`
        + ` (${Math.round((one.penMissed / taken) * 100)}%, la mediana del listone è 20%)`,
    });
  }

  if (
    one.penSaved >= PENALTY_SAVED_MIN
    && one.appearances > 0
    && one.penSaved / one.appearances >= PENALTY_SAVED_PER_MATCH
  ) {
    out.push({
      flag: 'penalty_saved',
      note: `${one.penSaved} rigori parati in ${one.appearances} presenze`
        + ` · uno ogni ${(one.appearances / one.penSaved).toFixed(0)}, e vale +3`,
    });
  }
  return out;
}
