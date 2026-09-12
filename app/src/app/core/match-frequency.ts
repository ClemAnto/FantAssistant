import { ScoringConfig } from './bundle';
import { bonusesOf } from './match-bonuses';
import { MatchCell, isChampionship } from './players-store';

/**
 * QUANTO SPESSO GLI SUCCEDE UNA COSA, sulle partite che ha davvero giocato.
 *
 * Richiesta dell'operatore (12/09/2026): quattro frequenze accanto alle altre letture della Strategia -
 * quante partite finisce oltre l'85', quante chiude con un fantavoto almeno buono, quante ne porta a
 * casa con un bonus, e quante sotto la sufficienza. Sono tutte e quattro la STESSA domanda con quattro
 * predicati, quindi escono da una lettura sola: due passate sulle stesse partite darebbero a un uomo due
 * denominatori, ed e' il difetto che questo progetto paga da sempre.
 *
 * LA FINESTRA E' TUTTO IL SUO CALCIO IN ARCHIVIO, e questa non e' una preferenza: e' l'unica finestra in
 * cui una frequenza sia una frequenza. Misurato sul pacchetto del 12/09/2026 (532 quotati di Serie A non
 * ceduti): sulla stagione BERSAGLIO ognuno di loro ha al massimo TRE partite - la mediana e' 3 e
 * **tutti e 388** stanno sotto le cinque - quindi la quota potrebbe valere solo 0, 1/3, 2/3 o 1, che non
 * e' una misura ma un lancio di dado. Sulle tre stagioni che il bundle porta la mediana e' 32 partite e
 * 465 uomini su 532 ne hanno almeno una. E' anche la popolazione su cui la COSTANZA e' gia' costruita
 * (`player-ratings.matchHistories`), quindi non e' una finestra nuova: e' quella di casa.
 *
 * IL DENOMINATORE E' «QUANDO GIOCA» e non «quante giornate ha il calendario», come per ogni altra
 * lettura per partita di questa pagina (i gol, gli assist, gli attesi, i minuti attesi). Quante ne gioca
 * e' un'altra domanda e ha gia' la sua pastiglia (`Pa`): tenerle separate e' quello che permette di
 * moltiplicarle, e schiacciarle in una cifra sola renderebbe indistinguibile chi gioca poco e bene da
 * chi gioca tanto e male.
 *
 * ...E OGNUNA COL SUO, che qui non e' un dettaglio: i minuti li porta il livello per-partita e il
 * fantavoto i voti, quindi una giornata puo' avere gli uni e non l'altro. `played` e `rated` sono due
 * numeri diversi e la riga li dichiara tutt'e due.
 */

/**
 * OLTRE QUANTI MINUTI LA PARTITA E' FINITA CON LUI IN CAMPO: 85 (operatore, 12/09/2026).
 *
 * E' un numero SUO e non uno preso in prestito, che e' la ragione per cui ha un nome tutto suo: questo
 * repository ne porta gia' tre vicini e nessuno dei tre risponde a questa domanda - `FULL_MATCH` (90)
 * dice «e' stato sostituito?», `OWN_MATCH` (75) dice «e' stata una sua partita?» e
 * `status.MOST_OF_THE_MATCH` (65) e' il pavimento del terzo gradino della scala. Quattro numeri per
 * quattro affermazioni, e nessuno dei quattro si deriva dagli altri.
 */
export const LONG_SHIFT = 85;

/** Il fantavoto da cui in su la sua giornata e' andata BENE (operatore: «almeno 6.5»). */
export const GOOD_MATCH = 6.5;

/**
 * ...e quello sotto il quale e' andata male: sei (operatore: «fantavoto < 6»).
 *
 * STESSO NUMERO DI `PASS_MARK` E ALTRA DOMANDA, e va detto qui o le due letture sembreranno
 * contraddirsi su una riga sola. La Costanza (`Pas`) conta i VOTI BASE almeno sufficienti, perche' e'
 * quello che i due modificatori pagano; questa conta i FANTAVOTI sotto la sufficienza, cioe' quello che
 * la rosa incassa. Un difensore che prende 6 e si fa ammonire ha un voto sufficiente e un fantavoto da
 * 5,5: entra nella Costanza e anche qui, e tutt'e due le righe sono vere.
 */
export const POOR_MATCH = 6;

/**
 * SOTTO QUANTE PARTITE UNA QUOTA E' SPANNOMETRICA: dieci, e il dieci e' DERIVATO e non scelto.
 *
 * Il criterio e' aritmetico: una quota e' grossolana quando una partita in piu' la sposta di oltre dieci
 * punti, cioe' quando `1/n > 0,10`. Non si nasconde e non si arrotonda - si SBIADISCE, esattamente come
 * le partite sufficienti quando la costanza dietro e' quasi tutta l'ancora del ruolo (`readingIsRough`).
 * Un numero spannometrico che si legge come misurato e' la cosa peggiore che una lista possa fare.
 */
export const THIN_SAMPLE = 10;

/** Le quattro quote, con i due denominatori su cui poggiano. */
export interface MatchFrequencies {
  /** Su quante partite giocate: il denominatore di `bonus`, e di `long` dove i minuti si sanno. */
  played: number;
  /** ...e su quante di quelle si sanno i MINUTI: `long` e' contata li' sopra. */
  timed: number;
  /** ...e su quante c'e' un FANTAVOTO: `good` e `poor` sono contate li' sopra. */
  rated: number;
  /** La quota di partite finite oltre `LONG_SHIFT` minuti. */
  long: number | null;
  /** ...quelle chiuse con almeno `GOOD_MATCH` di fantavoto. */
  good: number | null;
  /** ...quelle in cui ha portato almeno un bonus. */
  bonus: number | null;
  /** ...e quelle chiuse sotto `POOR_MATCH`. */
  poor: number | null;
  /** Se almeno un voto dietro queste quote e' SINTETICO: un campionato estero non pubblica pagelle. */
  synthetic: boolean;
}

/**
 * LE QUATTRO QUOTE di una lista di partite. Pura: legge le celle e non tocca ne' lo store ne' il foglio.
 *
 * LA POPOLAZIONE E' IL CAMPIONATO, suo o di un altro paese, ed e' la stessa di `seasonTotals`: coppe e
 * amichevoli restano fuori perche' non hanno un fantavoto e non entrano in nessun punteggio: contarle
 * darebbe quattro quote che non parlano degli stessi novanta minuti.
 *
 * UN BONUS E' UN BONUS DOVE E' GIA' DEFINITO (`match-bonuses.bonusesOf`), che e' anche l'unico posto in
 * cui e' definito: gol, rigore segnato, assist - anche da fermo - e il rigore parato di chi era in
 * porta. Il file di punteggio serve solo a dare un VALORE agli eventi, non a dire quali sono buoni,
 * quindi una lega senza `scoring_config` legge le stesse quote.
 */
export function matchFrequencies(
  cells: readonly MatchCell[],
  scoring: ScoringConfig | null,
): MatchFrequencies | null {
  const played = cells.filter(
    (one) => isChampionship(one.kind) && (one.state === 'played' || one.state === 'no_vote'),
  );
  if (!played.length) return null;

  // Una partita di cui non si sanno i minuti non dice ne' si ne' no: esce dal conto invece di contare
  // come «non ha finito la partita», che sarebbe inventare un fatto da un buco della fonte.
  const timed = played.filter((one) => one.minutes != null);
  const rated = played.filter((one) => one.fantavoto != null);
  const share = (hits: number, over: readonly unknown[]) => (over.length ? hits / over.length : null);

  return {
    played: played.length,
    timed: timed.length,
    rated: rated.length,
    long: share(timed.filter((one) => (one.minutes as number) > LONG_SHIFT).length, timed),
    good: share(rated.filter((one) => (one.fantavoto as number) >= GOOD_MATCH).length, rated),
    bonus: share(
      played.filter((one) => bonusesOf(one, scoring).some((row) => row.good)).length,
      played,
    ),
    poor: share(rated.filter((one) => (one.fantavoto as number) < POOR_MATCH).length, rated),
    synthetic: rated.some((one) => one.voteSynthetic),
  };
}
