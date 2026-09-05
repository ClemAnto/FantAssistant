import { Component, computed, input } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { ScoringConfig } from '../../core/bundle';
import { BonusRow, PLAYED_THE_MATCH, bonusesOf, spellOf } from '../../core/match-bonuses';
import { MatchCell, abbreviate, isChampionship } from '../../core/players-store';
import { BonusMark } from '../bonus-mark/bonus-mark';
import { ClubCrest } from '../club-crest/club-crest';
import {
  KIND_ICON,
  STATE_ICON,
  STATE_LABEL,
  voteClass,
  voteInk,
  voteText,
} from '../matches-table/vocabulary';

/**
 * UNA PARTITA IN UNA RIGA: l'incontro, com'e' andata la sua, il voto, i bonus e il fantavoto.
 *
 * Richiesta dell'operatore (05/09/2026), per la card di un calciatore: «le ultime 5 partite della sua
 * squadra ... visualizza queste informazioni in modo compatto ma leggibile». Cinque colonne fisse e
 * INCOLONNATE - non una frase che si adatta - perche' cinque righe uguali si leggono a colpo d'occhio
 * mentre cinque righe di larghezza diversa fanno leggere la forma invece del numero. E' la ragione di
 * `ui-gain` e delle tre pastiglie della Strategia, applicata qui.
 *
 * NON RICALCOLA NIENTE E NON LEGGE NIENTE DAL BUNDLE. La cella e' quella che `PlayersStore` costruisce
 * per la tabella di consultazione (`MatchCell`), i bonus vengono dal lettore unico
 * (`core/match-bonuses.ts`, che il pannello grande legge dallo stesso posto) e il voto si formatta col
 * VOCABOLARIO della tabella - `~` per il sintetico, `*` per il rating del provider, che e' un'altra
 * scala. Tre pagine sullo stesso fatto con tre letture darebbero a una partita tre pagelle.
 *
 * QUELLO CHE UNA RIGA NON PUO' DIRE lo dice il tooltip e mai un numero inventato: senza i minuti non
 * si disegna nessuna freccia, senza il file dei punteggi un bonus resta un EVENTO e non porta punti.
 *
 * E DAL 05/09/2026 UNA RIGA PUO' ESSERE DI UN'ALTRA COMPETIZIONE, perche' l'elenco che la contiene
 * mostra tutto il calcio giocato e non solo il campionato per cui lo stai comprando: percio' il voto
 * puo' essere il SINTETICO CALIBRATO di un altro campionato (`~`, la stessa scala) invece che il
 * rating del provider (`*`, un'altra), e la prima colonna porta il marchio di quale competizione e'.
 */
@Component({
  selector: 'ui-match-line',
  templateUrl: './match-line.html',
  imports: [BonusMark, ClubCrest, NzIconModule, NzTooltipModule],
  /**
   * UNA RIGA CHE SI PUO' DIPINGERE, e resta incolonnata: `grid-cols-subgrid`.
   *
   * L'ospite era `display: contents` - nessun box, le cinque celle figlie DIRETTE della griglia della
   * card, che e' quello che tiene allineate le colonne da una partita all'altra. Il prezzo e' che una
   * riga cosi' non esiste come elemento: non si puo' evidenziare. Dipingere le cinque celle una per una
   * lascerebbe scoperti i 6px di `gap-x` fra l'una e l'altra, cioe' una riga a strisce, che si legge
   * come un guasto e non come un'evidenziazione.
   *
   * Col subgrid l'ospite E' un elemento (una casella che occupa tutte le colonne) e le sue celle
   * continuano ad allinearsi alle piste della card: si dipinge, e l'incolonnamento non cambia - il che
   * si MISURA (`e2e-player-card.mjs` confronta la x di ogni cella riga per riga) invece di sperarci.
   * Il `gap-x` e' ridichiarato perche' un subgrid non eredita quello del genitore.
   */
  host: {
    class: 'col-span-full grid grid-cols-subgrid items-center gap-x-1.5 rounded-sm',
    '[class.bg-control]': 'elsewhere()',
    '[class.faded]': 'unofficial()',
  },
  /**
   * L'ATTENUAZIONE STA SULLE CELLE E NON SULL'OSPITE (operatore, 05/09/2026: «le partite che non sono
   * ufficiali di campionato, mostrale con 0.5 di opacita'»).
   *
   * `opacity` si MOLTIPLICA lungo l'albero - questo progetto lo ha gia' pagato sulla plancia - quindi
   * metterla sull'ospite spegnerebbe a meta' anche il suo SFONDO, cioe' l'evidenziazione «giocava
   * altrove» che puo' cadere sulla stessa riga (una coppa giocata con la squadra di prima e' tutt'e
   * due le cose). Sui figli, lo sfondo resta pieno e a sbiadire e' solo quello che si legge.
   */
  styles: `:host(.faded) > * { opacity: 0.5; }`,
})
export class MatchLine {
  readonly cell = input.required<MatchCell>();
  /** Il club DI QUESTA RIGA, per lo stemma: il NOME non e' una chiave, l'id si'. */
  readonly clubId = input<number | null>(null);
  /** ...e quello dell'avversario, che la pagina risolve o lascia vuoto (allora resta il monogramma). */
  readonly opponentId = input<number | null>(null);
  /**
   * QUEL GIORNO GIOCAVA PER UN'ALTRA SQUADRA (richiesta dell'operatore, 05/09/2026: «evidenziare la
   * riga in maniera molto leggera»).
   *
   * Lo decide la CARD e non questa riga, perche' e' un confronto con il club di OGGI - un fatto
   * sull'uomo, che una riga di partita non porta. Qui arriva gia' deciso, come `clubId`.
   */
  readonly elsewhere = input(false);

  /**
   * NON E' UNA PARTITA UFFICIALE DI CAMPIONATO: una coppa o un'amichevole.
   *
   * Un campionato STRANIERO resta pieno, ed e' una distinzione e non una svista: quello e' calcio di
   * campionato che il fantacalcio saprebbe votare - infatti porta il sintetico calibrato - mentre una
   * coppa non e' una competizione calibrata e tutto quello che ha e' il rating del provider. Quindi
   * l'attenuazione dice «questa non entra nel fantavoto», che e' la stessa cosa che dice il numero
   * senza colore accanto.
   */
  protected readonly unofficial = computed(() => !isChampionship(this.cell().kind));
  readonly crests = input<Record<string, string>>({});
  readonly scoring = input<ScoringConfig | null>(null);

  /** In casa a sinistra, sempre, cosi' il risultato si legge come e' scritto. */
  private readonly away = computed(() => this.cell().home === false);

  protected readonly left = computed(() =>
    this.away() ? this.cell().opponent : this.cell().team,
  );
  protected readonly right = computed(() =>
    this.away() ? this.cell().team : this.cell().opponent,
  );
  protected readonly leftId = computed(() => (this.away() ? this.opponentId() : this.clubId()));
  protected readonly rightId = computed(() => (this.away() ? this.clubId() : this.opponentId()));

  protected readonly leftShort = computed(() => abbreviate(this.left()));
  protected readonly rightShort = computed(() => abbreviate(this.right()));

  /**
   * SI PUO' NOMINARE QUESTA PARTITA? Non sempre, e allora la riga lo dice invece di stampare `???`.
   *
   * Una giornata in cui l'uomo non ha ne' una riga nei voti ne' una in distinta non porta nessun club:
   * per sapere CONTRO CHI giocava bisognerebbe sapere DOVE stava, che e' esattamente il fatto che
   * manca. Succede per intere mezze stagioni - misurato sul bundle: Lucca e Neres non hanno una riga
   * di Serie A dopo la 19ª e la 18ª del 2025-26, mentre Hojlund e Santos arrivano alla 38ª - e con tre
   * `??? - ???` in colonna la card sembrava rotta. Al loro posto va la giornata, che e' quello che si
   * sa: «vuoto = ignoto», applicato a un tabellino.
   */
  protected readonly named = computed(() => !!this.cell().team || !!this.cell().opponent);

  /**
   * QUELLO CHE SI SA di una riga che non si puo' nominare, e non e' la data.
   *
   * Richiesta dell'operatore (05/09/2026): «dobbiamo sempre mostrare cosa ha fatto, non mi basta vedere
   * la data della partita». Una riga senza club e' quasi sempre un INFORTUNIO - la giornata c'e', la
   * pagella no, e lo stop datato dice perche' - quindi la parola dello stato e' l'informazione, mentre
   * la data e la giornata restano nel tooltip dove erano gia'. `STATE_LABEL` e non una frase nostra: il
   * vocabolario e' uno, e la tabella di consultazione dice le stesse parole sulla stessa cella.
   */
  protected readonly reason = computed(() =>
    this.onPitch() ? this.when() : `${STATE_LABEL[this.cell().state]} · ${this.when()}`,
  );

  /**
   * IL MARCHIO DELLA COMPETIZIONE, e vuoto per il campionato per cui lo stai comprando.
   *
   * Disegnarlo su ogni riga vorrebbe dire ripetere «Serie A» venti volte per segnalare le tre righe che
   * Serie A non sono: e' la stessa scelta che la tabella di consultazione fa gia' (`kind !== 'league'`),
   * e la ragione e' che quello che va visto e' l'ECCEZIONE.
   */
  protected readonly kindIcon = computed(() =>
    this.cell().kind === 'league' ? null : (KIND_ICON[this.cell().kind] ?? null),
  );

  /**
   * IL RISULTATO, e vuoto invece di `0-0` quando non c'e'.
   *
   * Lo deriva `PlayersStore` dentro i voti - i gol della squadra piu' i suoi rigori, i subiti dal suo
   * portiere - e una riga di panchina non ne ha uno, perche' arrivarci vorrebbe dire unire il nome del
   * club del provider alla grafia dei voti. «Vuoto = ignoto», applicato a un tabellino.
   */
  protected readonly score = computed(() => {
    const cell = this.cell();
    const home = this.away() ? cell.goalsAgainst : cell.goalsFor;
    const guest = this.away() ? cell.goalsFor : cell.goalsAgainst;
    return home == null || guest == null ? null : `${home}-${guest}`;
  });

  /**
   * COM'E' ANDATA LA SUA: i minuti quando c'era, l'icona dello stato quando non c'era.
   *
   * Le due frecce sono DUE FATTI e non un'etichetta a scelta multipla, e uno dei due si puo' osservare
   * solo per chi era in distinta: i minuti sono i SUOI e non l'ora del campo, quindi «un subentrato e'
   * poi uscito?» non ha risposta qui e la freccia resta spenta (vedi `spellOf`). Verde in su per chi
   * entra e rossa in giu' per chi esce sono le parole dell'operatore, e sono anche l'uso del colore
   * che questa app concede: un verso, non un giudizio.
   */
  protected readonly spell = computed(() => spellOf(this.cell()));

  /**
   * L'INCHIOSTRO DEI MINUTI: grigio sotto i 75' (richiesta dell'operatore, 05/09/2026).
   *
   * DUE PREDICATI CHE ARRIVANO ALLO STESSO GRIGIO, e il verso in cui vanno letti va detto: i minuti
   * IGNOTI erano già grigi, e ora lo sono anche quelli sotto la soglia. Non è una collisione perché
   * quello che li distingue è il GLIFO - «?'» contro «62'» - e il grigio dice l'unica cosa vera di
   * tutti e due, che quella non è una partita giocata per intero. Un terzo grigio per separarli
   * sarebbe inventare una scala su una riga alta dieci pixel.
   */
  protected readonly shortSpell = computed(() => {
    const minutes = this.spell().minutes;
    return minutes == null || minutes < PLAYED_THE_MATCH;
  });

  /** Ha una riga nei voti: allora la colonna porta i minuti, non un'icona di assenza. */
  protected readonly onPitch = computed(() =>
    ['played', 'no_vote'].includes(this.cell().state),
  );

  protected readonly stateIcon = computed(() => STATE_ICON[this.cell().state] || 'minus-circle');
  protected readonly stateLabel = computed(() => STATE_LABEL[this.cell().state]);

  protected readonly bonuses = computed<BonusRow[]>(() =>
    bonusesOf(this.cell(), this.scoring()),
  );

  protected readonly vote = computed(() => voteText(this.cell()));
  protected readonly voteInk = computed(() => voteClass(this.cell()));

  protected readonly fantavoto = computed(() => {
    const cell = this.cell();
    if (cell.fantavoto == null) return null;
    // Lo stesso `~` del voto: e' calcolato da noi (voto sintetico + bonus) e non pubblicato dalla
    // fonte. Un marchio sul voto e nessuno sul fantavoto direbbe che uno dei due e' misurato.
    return (cell.voteSynthetic ? '~' : '') + cell.fantavoto.toFixed(1).replace('.', ',');
  });

  /**
   * L'INCHIOSTRO DEL FANTAVOTO: le STESSE fasce del voto (operatore, 05/09/2026 - verde sopra il sei).
   *
   * Dal vocabolario e non da una seconda scala: il fantavoto e' il voto piu' i bonus, quindi le due
   * colonne della riga rispondono alla stessa domanda e devono usare lo stesso metro - due tinte
   * diverse sullo stesso sei si leggerebbero come due giudizi.
   */
  protected readonly fantavotoInk = computed(() => voteInk(this.cell().fantavoto));

  /** Quando e' stata giocata e di che giornata e': la riga da sola non lo direbbe. */
  protected readonly when = computed(() => {
    const cell = this.cell();
    const day = cell.date ? cell.date.split('-').reverse().join('/') : null;
    const round = cell.matchday == null ? cell.competitionLabel : `${cell.matchday}ª`;
    return [round, day].filter(Boolean).join(' · ');
  });

  /**
   * LA FRASE DELLA RIGA: l'incontro per esteso e quando. Poche parole.
   *
   * Regola dell'operatore (05/09/2026): «i tooltip devono essere SEMPRE brevi e sintetici». Quello che
   * la riga gia' disegna - i minuti, i bonus, il voto - non si ripete qui: un tooltip che rilegge la
   * riga ad alta voce e' un pannello che si apre per niente. Quello che aggiunge e' il nome INTERO dei
   * due club, che la colonna abbrevia a tre lettere, e la giornata.
   */
  protected readonly hint = computed(() => {
    const score = this.score();
    const fixture = `${this.left() ?? '?'} - ${this.right() ?? '?'}${score ? ' ' + score : ''}`;
    return `${fixture} · ${this.when()}`;
  });
}
