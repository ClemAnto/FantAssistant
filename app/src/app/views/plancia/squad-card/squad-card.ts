import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { MantraModules } from '../../../core/auction-value';
import { BottomDocks } from '../../../core/bottom-docks';
import { Bundle } from '../../../core/bundle';
import { ModuleLine } from '../../../core/mantra-legal';
import { PlanciaMan, ROLES, Role, expectedPriceOf } from '../../../core/plancia';
import {
  PITCH_MODULE,
  PitchPlace,
  SquadMan,
  UrnMan,
  classicPlaces,
  squadPitchOf,
} from '../../../core/plancia-squad';
import { PlanciaStore } from '../../../core/plancia-store';

/** Come si chiama una riga del modulo, nella lingua del campetto. */
const LINE_LABEL: Record<ModuleLine, string> = {
  P: 'porta',
  D: 'difesa',
  M: 'centrocampo',
  T: 'trequarti',
  A: 'attacco',
};

/** La pastiglia del ruolo, con gli stessi quattro colori della plancia: un vocabolario solo. */
const ROLE_TONE: Record<Role, string> = {
  P: 'bg-role-keeper',
  D: 'bg-role-defence',
  C: 'bg-role-midfield',
  A: 'bg-role-attack',
};

/**
 * LA MIA ROSA, nello spazio che la linea degli attaccanti lascia libero in basso a destra.
 *
 * Sua richiesta (23/09/2026): a destra il campetto coi migliori undici sul 4-3-3, a sinistra i
 * restanti ordinati per ruolo e poi per moneta, e in grigio chi si potrebbe ancora comprare - due nomi
 * sotto un posto vuoto, uno sotto un posto che un acquisto migliorerebbe.
 *
 * DOVE STA E PERCHE' LI': la griglia taglia ogni linea su otto colonne perche' la piu' lunga ne ha
 * otto, quindi la linea degli attaccanti (sei slot) ne lascia DUE - misurate prima di disegnare, 386 x
 * 191 px su una finestra da 1600 x 1000. E' l'unico spazio libero rimasto da quando le rose sono andate
 * in quello dei portieri, ed e' proiettata li' dalla pagina per la stessa ragione di quelle: dov'e' lo
 * spazio lo sa la griglia, cosa ci va lo sa la pagina.
 *
 * QUELLO CHE QUESTA CARD NON FA e' prevedere un calciatore: i numeri sono quelli della plancia, letti e
 * mai ricalcolati. L'aritmetica sta in `core/plancia-squad.ts`, che dichiara le due monete e perche'
 * sono due; qui c'e' solo come si legge.
 *
 * TRE COSE CHE LO SCHERMO DEVE DIRE, perche' a 191px di altezza si vede poco e si deduce molto: quanti
 * degli undici posti sono davvero miei, che i nomi grigi sono ACQUISTI POSSIBILI e non uomini in rosa,
 * e quanto quei nomi costeranno - senza l'ultimo, «fattibile» sarebbe una parola nostra invece di un
 * conto.
 */
@Component({
  selector: 'plancia-squad-card',
  templateUrl: './squad-card.html',
  imports: [DecimalPipe, NzIconModule, NzTooltipModule],
  host: { class: 'block h-full min-h-0' },
})
export class SquadCard {
  private readonly bundle = inject(Bundle);
  private readonly store = inject(PlanciaStore);
  private readonly docks = inject(BottomDocks);

  /**
   * SE LA BARRA IN BASSO A DESTRA E' APERTA, cioe' se sta passando sopra questa card.
   *
   * La card e' l'unica cosa della pagina che le ceda spazio, e solo mentre serve: la ragione per esteso
   * sta nel template, accanto alla riserva che questo accende.
   */
  protected readonly dockOpen = computed(() => !this.docks.collapsed('right')());

  /**
   * IL REGOLAMENTO CLASSIC, letto una volta: i posti dell'1-4-3-3 vengono da li' e non da qui.
   *
   * `null` finche' non e' atterrato E su un pacchetto che non lo porta: i due casi si vedono uguali per
   * mezzo secondo e poi si separano da se', e nessuno dei due autorizza a disegnare un modulo
   * trascritto a mano - sarebbe un undici di un gioco che nessuno ha letto, sotto il nome di questo.
   */
  private readonly rules = signal<MantraModules | null>(null);

  constructor() {
    void this.bundle.classicModules().then((file) => this.rules.set(file?.modules ? file : null));
  }

  protected readonly label = LINE_LABEL;
  protected readonly roleTone = ROLE_TONE;
  protected readonly module = PITCH_MODULE;

  /** I posti del modulo, dal regolamento. Vuoti quando il pacchetto non lo porta: la card lo dice. */
  private readonly places = computed(() => classicPlaces(this.rules()));

  /**
   * LA SEDIA CHE LA CARD STA MOSTRANDO: quella accesa dalla lente, altrimenti la mia.
   *
   * Sua richiesta (24/09/2026): «quando selezioni una squadra di un partecipante aggiorna il campetto
   * in basso a destra con i suoi calciatori». La lente e' gia' il gesto con cui si chiede «cosa ha
   * preso QUESTO qui» - un click su una card accende i suoi acquisti sulle 250 righe - quindi la card
   * segue lo stesso interruttore invece di averne uno suo: due modi di scegliere una rosa sarebbero
   * due rose accese insieme il giorno che uno dei due non spegne l'altro.
   *
   * Crediti e posti liberi vengono da QUI e non da due letture diverse, ed e' cio' che rende la card
   * vera anche su un rivale: `BoardTeam` li porta per ogni sedia del tavolo.
   */
  private readonly seat = computed(() => this.store.activeTeam() ?? this.mine());

  /** La MIA sedia, che resta il ripiego quando nessuna lente e' accesa. */
  private readonly mine = computed(() => this.store.teams().find((team) => team.me) ?? null);

  /** Vero quando quello che si sta guardando e' il mio, che e' l'unico caso in cui la card CONSIGLIA. */
  protected readonly ownSquad = computed(() => !!this.seat()?.me);

  /**
   * I POSTI DI ROSA ANCORA LIBERI, per ruolo, dalla striscia delle rose - che li porta gia' in ordine
   * P-D-C-A. Un suggerimento in un ruolo pieno e' un acquisto che il regolamento rifiuta.
   */
  private readonly freeSlots = computed<Record<Role, number>>(() => {
    const missing = this.seat()?.missing ?? [];
    const out = {} as Record<Role, number>;
    ROLES.forEach((role, at) => (out[role] = Math.max(0, missing[at] ?? 0)));
    return out;
  });

  /**
   * CHI E' ANCORA COMPRABILE, col prezzo del suo slot.
   *
   * Dalla PLANCIA e non dal listone, ed e' l'asimmetria giusta con la rosa: quello che possiedo e'
   * quello che possiedo (coda compresa), mentre quello che si puo' ancora comprare e' quello che il
   * tabellone OFFRE - chi la plancia lascia fuori perche' rientra troppo tardi non e' un consiglio da
   * dare, e la coda e' riempimento a un credito che non entra in un undici.
   *
   * `asta` sta con `urna` perche' il lotto sul tavolo e' ancora di nessuno: e' lo stesso conto con cui
   * il blocco dice quanti ne restano.
   */
  private readonly urn = computed<UrnMan[]>(() => {
    const teams = this.store.teamsCount();
    const out: UrnMan[] = [];
    for (const block of this.store.blocks()) {
      // Le mani ALZATE su quel ruolo col pavimento neutro di un credito: qui non c'e' una banda su cui
      // filtrarle come fa il lotto, perche' non c'e' un lotto - la domanda e' «quante rose vogliono
      // ancora un uomo di questo ruolo», e il prezzo e' quello che `adviseLot` scrive sulla sua card.
      const price = expectedPriceOf(
        block.medianFvm,
        block.index,
        this.store.handsFor(block.role),
        teams,
      );
      for (const man of block.rows) {
        if (man.state !== 'urna' && man.state !== 'asta') continue;
        out.push({ ...asSquadMan(man, null), price, slot: block.id });
      }
    }
    return out;
  });

  /**
   * Il campetto, la panchina e i grigi: una passata sola, e l'aritmetica non e' qui.
   *
   * I GRIGI SOLO SULLA MIA ROSA, ed e' una scelta da dichiarare. Un suggerimento e' un CONSIGLIO e
   * questa card lo calcola coi miei parametri: il prezzo di uno slot esce da `handsFor`, che conta le
   * mani alzate ESCLUDENDO me, e «fattibile» esce dai crediti della sedia meno un credito per ogni
   * posto che le resta. Sui crediti la risposta per un rivale sarebbe giusta; sulle mani no - andrebbe
   * escluso LUI invece di me - quindi disegnarli comunque sarebbe un consiglio calcolato sulla
   * popolazione sbagliata, che e' il difetto che questo progetto paga piu' spesso. Quello che la card
   * mostra di un rivale sono percio' FATTI su di lui: chi ha, dove giocherebbero, quanto li ha pagati.
   */
  protected readonly pitch = computed(() =>
    squadPitchOf({
      mine: this.store.squadOf(this.seat()?.id ?? null).map((man) => asSquadMan(man, man.paid)),
      urn: this.ownSquad() ? this.urn() : [],
      places: this.places(),
      freeSlots: this.freeSlots(),
      credits: this.seat()?.credits ?? 0,
    }),
  );

  /** Vero quando il pacchetto non porta il regolamento: si dichiara invece di disegnare a memoria. */
  protected readonly noRules = computed(() => !this.places().length);

  /**
   * NESSUNA SEDIA RICONOSCIUTA AL TAVOLO, che non e' «rosa piena» anche se i conti sono gli stessi.
   *
   * `followedTeamId` nasce `null` e su una sessione vera resta tale finche' l'operatore non dice quale
   * rosa e' la sua: li' `missing` e' vuoto, quindi i posti liberi sono zero e la card direbbe «rosa
   * piena: non c'e' piu' niente da comprare» su una rosa che non ha mai visto. E' «vuoto = ignoto, mai
   * zero» applicato a una SEDIA, e la differenza si dichiara invece di lasciarla dedurre da un
   * campetto di trattini.
   *
   * La condizione chiede che un tavolo CI SIA: appena caricata la pagina le rose non sono ancora
   * arrivate, e quel mezzo secondo non e' una sedia mancante.
   *
   * ...E CON LA LENTE ACCESA NON CAPITA, perche' una sedia da mostrare c'e': quella che ha appena
   * scelto. La frase riguarda il caso in cui non si sa CHI SONO IO, non il caso in cui non si sa cosa
   * guardare - e sono due cose diverse da quando la card puo' guardare un rivale.
   */
  protected readonly noSeat = computed(() => this.store.teams().length > 0 && !this.seat());

  /**
   * DI CHI E' LA ROSA CHE SI STA GUARDANDO, a parole.
   *
   * L'intestazione lo diceva gia' («la tua rosa») quando la risposta era una sola; da quando sono
   * dieci deve dire QUALE, o la card resta identica mentre sotto cambiano undici nomi - e una card che
   * non dice di chi e' e' la cosa che il suo stesso commento vieta da quando esiste.
   */
  protected readonly whose = computed(() => {
    const seat = this.seat();
    if (!seat) return 'la tua rosa';
    return seat.me ? 'la tua rosa' : seat.label;
  });

  /** Il colore della sedia mostrata, che e' il vocabolario con cui la pagina nomina una rosa. */
  protected readonly seatColour = computed(() => this.seat()?.colour ?? null);

  /** Quanti degli undici posti sono occupati: una stringa sola, o il template mette uno spazio in mezzo. */
  protected readonly filled = computed(() => `${this.pitch().placed}/${this.places().length}`);

  /**
   * CHI HA UNA CARD DA APRIRE, e non sono tutti.
   *
   * `cardMen` risolve un id sulle righe della plancia, quindi un mio uomo della CODA - o uno che
   * rientra troppo tardi per avere una riga - non ne ha una: il click su di lui non farebbe niente, e
   * un gesto che non fa niente e' indistinguibile da un gesto rotto. Quindi il cursore e il click
   * esistono solo dove la card c'e' davvero, che e' la stessa disciplina di `canAssign` sulla pagina.
   */
  private readonly openable = computed(
    () => new Set(this.store.blocks().flatMap((block) => block.rows.map((row) => row.id))),
  );

  protected opens(man: SquadMan): boolean {
    return this.openable().has(man.id);
  }

  protected open(man: SquadMan): void {
    if (this.opens(man)) this.store.openCard(man.id);
  }

  /** Un posto senza nessuno e senza nemmeno un grigio: si dichiara, o si legge come una riga rotta. */
  protected barren(place: PitchPlace): boolean {
    return !place.man && !place.hints.length;
  }

  /**
   * LA FRASE DELLA CARD, e porta i tre fatti che lo schermo non puo' dire da se'.
   *
   * Corta come le altre (sua regola del 05/09: «poche parole per indicare il significato di quella
   * sigla o quell'icona»), e la ragione per esteso sta nel codice e in `docs/model/`.
   */
  protected readonly note = computed(() => {
    if (this.noSeat()) {
      return 'Nessuna delle rose al tavolo è la tua, quindi la card non sa né chi schiereresti né cosa ti manca.';
    }
    if (!this.ownSquad()) {
      // UN RIVALE: fatti e nessun consiglio, e il perche' si dice invece di lasciare notare l'assenza
      // dei grigi - «un vincolo che agisce in silenzio e' indistinguibile da un ordinamento rotto».
      return (
        `Gli undici migliori di ${this.whose()} sul ${this.module}, scelti per valore atteso, col ` +
        'prezzo che ha pagato ognuno. Nessun suggerimento: quelli si calcolano sulle mie mani alzate ' +
        'e sul mio budget, quindi su di lui direbbero il numero di un’altra asta.'
      );
    }
    const room = this.pitch().spendable;
    return (
      `I tuoi undici migliori sul ${this.module}, scelti per valore atteso. In grigio chi potresti ` +
      'ancora comprare, col prezzo che la stanza paga per il suo slot: due sotto un posto vuoto, uno ' +
      'sotto un posto che migliorerebbe. ' +
      (room > 0
        ? `Su un uomo solo puoi arrivare a ${room} crediti tenendone uno per ogni altro posto.`
        : 'Rosa piena: non c’è più niente da comprare.')
    );
  });
}

/**
 * Da riga della plancia a uomo del campetto, ed e' qui che si scelgono le due monete.
 *
 * `coin` E' IL SURPLUS, la moneta della griglia personale dal 23/09/2026: lo stesso campo su cui
 * `viewBlocks` taglia i blocchi, quindi la panchina e gli slot personali ordinano sulla stessa cosa.
 * `points` e' il valore atteso, che e' quello che decide chi gioca - vedi `core/plancia-squad.ts`.
 *
 * `paid` SI PASSA e non si indovina: per i miei e' il prezzo del feed, per chi e' ancora nell'urna e'
 * `null` - e quel null lo dichiara il punto di chiamata invece di uscire da un campo che li' non
 * esiste, cosi' i due casi restano due frasi diverse e non una sola scritta a meta'.
 */
function asSquadMan(man: PlanciaMan, paid: number | null): SquadMan {
  return {
    id: man.id,
    name: man.name,
    role: man.role,
    points: man.points,
    coin: man.surplus,
    paid,
  };
}
