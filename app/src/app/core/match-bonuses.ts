/**
 * I BONUS DI UNA PARTITA, in una definizione sola.
 *
 * Esisteva gia' dentro `ui/match-detail`, che e' il pannello grande di una cella; da oggi la stessa
 * lista la legge anche la RIGA COMPATTA della card di un calciatore («lista di bonus», richiesta
 * dell'operatore del 05/09/2026). Due conti sugli stessi eventi finirebbero per dare a una partita due
 * fantavoti - il difetto che questo progetto paga da sempre - quindi il conto sta qui, puro, e i due
 * componenti lo leggono.
 *
 * IL PUNTEGGIO E' DEL CAMPIONATO in cui la partita e' stata giocata (`scoring_config.json`, per
 * campionato e non per lega): il file esiste proprio perche' un campionato puo' segnare diversamente, e
 * senza di lui l'evento resta un FATTO e il suo valore no - `points` e' `null`, mai zero.
 */

import { ScoringConfig, ScoringTerms } from './bundle';
import type { MatchCell } from './players-store';

/**
 * CHE COSA E' SUCCESSO, come VOCABOLARIO e non come etichetta.
 *
 * Il marchio che una pagina disegna si sceglie su questo e mai sulla stringa: l'operatore ha chiesto
 * (05/09/2026) che «le icone abbiano lo stesso significato in ogni pagina della piattaforma», e due
 * pagine che scegliessero l'icona guardando il testo finirebbero per dipingere due cose diverse la
 * settimana in cui una delle due etichette cambia parola.
 */
export type BonusKind =
  | 'goal'
  | 'own-goal'
  | 'assist'
  | 'pen-scored'
  | 'pen-missed'
  | 'yellow'
  | 'red'
  | 'conceded'
  | 'pen-saved';

export interface BonusRow {
  kind: BonusKind;
  /** Come si chiama per esteso: e' quello che legge un pannello. */
  label: string;
  /** ...e in due caratteri, per chi non puo' disegnare un'icona (e per un arnese che legge il testo). */
  short: string;
  count: number;
  /** Null quando nessun file di punteggio era in casa: l'evento resta un fatto, il suo valore no. */
  points: number | null;
  /** Se e' una cosa buona: decide l'inchiostro, e non lo decide il SEGNO dei punti (che senza il file
   *  non c'e'). Un gol subito e' un fatto neutro per un difensore e un malus per il portiere. */
  good: boolean;
}

/** I termini del campionato di QUESTA partita, col default sotto. */
export function termsOf(cell: MatchCell, config: ScoringConfig | null): ScoringTerms | null {
  if (!config) return null;
  return { ...config.default, ...(config.leagues[cell.competition] ?? {}) };
}

/**
 * Gli eventi di una partita che valgono qualcosa, in ordine di lettura.
 *
 * I GOL SUBITI E I RIGORI PARATI SOLO A CHI HA GIOCATO DA PORTIERE, e il ruolo e' quello della RIGA di
 * quella partita e non quello di listone: un uomo di movimento in porta non esiste, ma un portiere
 * schierato altrove si', e il malus dei gol subiti si applica a chi era in porta.
 */
export function bonusesOf(cell: MatchCell, config: ScoringConfig | null): BonusRow[] {
  const terms = termsOf(cell, config);
  const rows: BonusRow[] = [];
  const add = (
    kind: BonusKind,
    label: string,
    short: string,
    count: number,
    value: number | undefined,
    sign: 1 | -1,
  ) => {
    if (!count) return;
    rows.push({
      kind,
      label,
      short,
      count,
      points: terms && value != null ? sign * count * value : null,
      good: sign > 0,
    });
  };

  add('goal', 'Gol', 'G', cell.goals, terms?.goal_bonus, 1);
  add('pen-scored', 'Rigori segnati', 'R+', cell.penScored, terms?.penalty_scored_bonus, 1);
  add('assist', 'Assist', 'A', cell.assists, terms?.assist_bonus, 1);
  add('assist', 'Assist da fermo', 'Af', cell.assistsSetPiece, terms?.assist_set_piece_bonus, 1);
  add('pen-missed', 'Rigori sbagliati', 'R-', cell.penMissed, terms?.penalty_missed_malus, -1);
  add('own-goal', 'Autogol', 'Aut', cell.ownGoals, terms?.own_goal_malus, -1);
  add('yellow', 'Ammonizioni', 'Amm', cell.yellows, terms?.yellow_card_malus, -1);
  add('red', 'Espulsioni', 'Esp', cell.reds, terms?.red_card_malus, -1);

  if (cell.role === 'P') {
    add('pen-saved', 'Rigori parati', 'Rp', cell.penSaved, terms?.penalty_saved_bonus_gk, 1);
    add('conceded', 'Gol subiti', 'Gs', cell.goalsConceded ?? 0, terms?.goal_conceded_malus_gk, -1);
  }
  return rows;
}

/**
 * COM'E' ANDATA LA SUA PARTITA: e' SUBENTRATO, e' USCITO, tutt'e due o nessuna delle due.
 *
 * Le due frecce che l'operatore ha chiesto (verde in su per chi entra, rossa in giu' per chi esce) sono
 * DUE FATTI INDIPENDENTI, e per questo sono due booleani e non un'etichetta a scelta multipla.
 *
 * E UNO DEI DUE SI PUO' OSSERVARE SOLO PER CHI E' PARTITO TITOLARE, il che e' il motivo per cui questa
 * funzione esiste invece di un `minutes < 90` scritto nel template. I minuti sono i SUOI e non l'ora
 * del campo: un titolare uscito al 63' legge 63, ma anche un subentrato entrato al 63' legge 27, e in
 * quel caso 27 non dice affatto che sia uscito - dice che e' entrato tardi. Senza il MINUTO D'INGRESSO,
 * che il livello per-partita non porta, «un subentrato e' poi uscito?» e' una domanda a cui questa
 * riga non puo' rispondere, e allora non risponde: «vuoto = ignoto, mai zero» applicato a una freccia.
 *
 * Il confine dei 90' non e' una convenzione scelta: e' quello che il provider scrive per chi finisce la
 * partita, recupero compreso, quindi 90 e' «c'era alla fine» e 89 no.
 */
export interface MatchSpell {
  minutes: number | null;
  /** E' entrato a partita in corso. */
  on: boolean;
  /** E' stato sostituito - e lo si sa solo di chi era in distinta dal principio (vedi sopra). */
  off: boolean;
}

export const FULL_MATCH = 90;

/**
 * QUANTO DEVE STARE IN CAMPO PERCHE' LA PARTITA SIA SUA: 75 minuti (operatore, 05/09/2026).
 *
 * Serve all'INCHIOSTRO della riga: sotto questa soglia i minuti sono in grigio, cosi' scorrendo le
 * ultime partite si vede a colpo d'occhio dove ha giocato e dove e' entrato o uscito presto.
 *
 * NON E' IL 90 QUI SOPRA, e i due non vanno confusi perche' rispondono a due domande diverse: quello
 * dice «e' stato sostituito?» (chi parte titolare e non arriva in fondo), questo dice «e' stata una sua
 * partita?». E non e' nemmeno `status.MOST_OF_THE_MATCH`, che vale 65 ed e' il pavimento del terzo
 * gradino della scala. TRE numeri per tre affermazioni, e nessuno dei tre e' derivabile dagli altri.
 *
 * Il 75 e' `engine/status.py:FULL_MATCH`, cioe' il pavimento che l'operatore aveva gia' dichiarato per
 * `bandiera` e `titolarissimo`: la stessa frase sul calcio, quindi lo stesso numero e non uno nuovo.
 */
export const PLAYED_THE_MATCH = 75;

export function spellOf(cell: MatchCell): MatchSpell {
  return spellFrom(cell.started, cell.minutes);
}

/**
 * LO STESSO FATTO, dai due campi che lo decidono: una definizione, DUE lettori.
 *
 * Esiste perche' il campetto di una partita gia' giocata disegna gli stessi triangolini su righe che
 * non sono celle di una tabella (`core/match-lineup.ts`, 12/09/2026): un uomo che il listone non quota
 * non ha una cella, e ricopiare qui la condizione «titolare con meno di 90 minuti» sarebbe una seconda
 * definizione di «e' stato sostituito» - cioe' due schermate che un giorno dicono due cose sullo stesso
 * cambio.
 */
export function spellFrom(started: boolean | null, minutes: number | null): MatchSpell {
  // Senza i minuti o senza la distinta non si dice niente: una freccia inventata su una riga di
  // fantacalcio e' una frase sul calciatore che nessuno ha osservato.
  if (minutes == null || started == null) return { minutes, on: false, off: false };
  return {
    minutes,
    on: !started && minutes > 0,
    off: started && minutes > 0 && minutes < FULL_MATCH,
  };
}


/**
 * IL PASSO DEL VOTO: mezzo punto, e non e' una scelta di presentazione - e' l'alfabeto della fonte.
 *
 * MISURATO sul bundle del 05/09/2026: **57.925 voti su 57.925** e **57.925 fantavoti su 57.925** stanno
 * sulla griglia dei mezzi punti, senza una sola eccezione. Un sintetico che legge `5,88` scrive quindi
 * una cifra che il fantacalcio non pubblica mai, e la falsa precisione si vede proprio dove serve
 * confrontarlo con un voto vero.
 *
 * Il prezzo e' dichiarato: arrotondare sposta il numero di **0,129 in media** (0,25 al massimo), contro
 * i **0,37** di errore per partita che la retta di `synth` ha di suo - un terzo del rumore che c'e' gia'.
 */
export const VOTE_STEP = 0.5;

export function roundVote(value: number): number {
  return Math.round(value / VOTE_STEP) * VOTE_STEP;
}

/**
 * IL FANTAVOTO DI UNA PARTITA CHE NON LO PUBBLICA: il voto piu' i bonus, sommati con i punteggi del
 * campionato in cui e' stata giocata (richiesta dell'operatore, 05/09/2026).
 *
 * Vale solo dove il voto e' SINTETICO: dove la fonte pubblica un fantavoto, quello e' il fantavoto, e
 * un secondo conto darebbe a una partita due numeri. Ed e' la stessa `bonusesOf` che disegna i marchi
 * della riga, quindi la somma e i simboli accanto non possono contraddirsi.
 *
 * COSA SI PUO' SOMMARE E COSA NO, misurato e non supposto (bundle del 05/09/2026, 24.393 partite di
 * Serie A confrontate riga per riga coi voti veri):
 * - i GOL del layer per-partita concordano al **100%** leggendo NULL come zero, e delle 1.745 partite in
 *   cui ha segnato davvero **nessuna** legge NULL: la colonna e' completa dove conta;
 * - gli ASSIST concordano al **99,25%** (133 di troppo, 49 di meno su 24.393);
 * - i CARTELLINI non ci sono affatto - `yellows` e `reds` sono NULL su tutte le 352.754 righe, nessuno
 *   li scrive - e nei voti veri un'ammonizione cade nell'**11,2%** delle partite. Quindi questo numero
 *   e' OTTIMISTA di circa **0,06** in media, ed e' detto invece che nascosto.
 *
 * IL PORTIERE SI PUO' SOMMARE, e i suoi GOL SUBITI arrivano dai gol che l'avversario ha segnato in
 * quella partita (operatore, 05/09/2026: «li prendi pari pari ai gol segnati nella partita
 * dall'avversario ... la rarita' di un tale evento e' cosi' rara che possiamo tranquillamente
 * ignorare questi casi», sui portieri usciti prima del gol).
 *
 * IL CASO RARO CHE LUI CITA E' DAVVERO RARO; QUELLO CHE NON LO E' E' UN ALTRO, e va detto. Il conto
 * dei gol dell'avversario si ricostruisce dalle righe di quella partita che abbiamo in casa, e le
 * righe ci sono solo per i giocatori che sappiamo identificare: sui campionati esteri - cioe' dove
 * questo numero serve - la ricostruzione e' esatta il **72,5%** delle volte (Premier 82,6%, Ligue 1
 * 60,6%) e sbaglia quasi sempre PER DIFETTO, **−0,325 gol in media**, perche' il marcatore avversario
 * spesso non e' nel nostro perimetro. Quindi il fantavoto di un portiere sintetico e' ottimista di
 * circa un terzo di punto, e lo sara' finche' il punteggio non arriva dalla fonte: `download_round`
 * lo scarta da sempre pur avendolo nel payload (curato nel toolkit lo stesso giorno), quindi le
 * giornate scaricate da qui in avanti porteranno il risultato vero e la ricostruzione servira' solo
 * per l'archivio.
 *
 * Sulla Serie A la stessa ricostruzione e' esatta al **95,1%**, che e' la misura di quanto il difetto
 * sia una questione di PERIMETRO e non di metodo.
 *
 * E IL BONUS PORTA INVIOLATA NON SI SOMMA, perche' la fonte non lo somma: sui 1.222 portieri a porta
 * inviolata, il fantavoto pubblicato e' `voto + bonus` senza nessun premio in **1.218** casi (e i
 * 2.613 che subiscono tornano 2.586 volte). E' un modificatore di lega e non un termine della riga.
 */
export function syntheticFantavoto(cell: MatchCell, config: ScoringConfig | null): number | null {
  if (cell.vote == null || !cell.voteSynthetic) return null;
  // IL PORTIERE SI SOMMA SOLO SE SI SANNO I GOL SUBITI, che sono il termine che decide il suo
  // fantavoto: senza, la somma gli darebbe fantavoto uguale al voto - una promessa che nessuna sua
  // partita mantiene. La condizione e' sul DATO e non sul ruolo, perche' e' il dato che manca.
  if (cell.role === 'P' && cell.goalsConceded == null) return null;
  const rows = bonusesOf(cell, config);
  // Senza il file dei punteggi un bonus resta un EVENTO e non porta punti: allora non c'e' una somma
  // da fare, e inventarne una con dei valori di comodo sarebbe peggio di non mostrarla.
  if (rows.some((one) => one.points == null)) return null;
  const total = rows.reduce((sum, one) => sum + (one.points ?? 0), 0);
  return Math.round((cell.vote + total) * 100) / 100;
}
