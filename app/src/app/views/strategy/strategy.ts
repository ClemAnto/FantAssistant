import { CdkDrag, CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';
import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { Bundle, EngineSheetEntry, MantraModulesFile } from '../../core/bundle';
import { ExpectedPlay } from '../../core/expected-play';
import { GlobalOptions, LeagueSettings } from '../../core/global-options';
import { withRowAt } from '../../core/manual-order';
import { PlayerRatingsStore } from '../../core/player-ratings-store';
import { GainScale, scaleOf } from '../../core/sealed-bid';
import {
  AuctionKind,
  BlockView,
  RankedMan,
  RoleBlock,
  StrategyBidder,
  StrategyGame,
  StrategySetup,
  blocksOf,
  gainOf,
} from '../../core/strategy';
import { EngineExpectation, ValuationStore, valueFromEngine } from '../../core/valuation-store';
import { stored } from '../../core/view-state';
import { APP_VERSION } from '../../version';
import { ClubCrest } from '../../ui/club-crest/club-crest';
import { GainChip } from '../../ui/gain-chip/gain-chip';
import { PlayerFlags } from '../../ui/player-flags/player-flags';
import { RoleBadge } from '../../ui/role-badge/role-badge';

/**
 * IL REGOLAMENTO NON È PIÙ DI QUESTA PAGINA: sta in `core/global-options.ts` e vale per ogni vista.
 *
 * Qui resta solo quello che è di questa pagina e di nessun'altra - COME si legge un blocco - perché è
 * una preferenza di lettura e non una regola della lega. Il resto (listone, gioco, rose, budget,
 * partecipanti, tipo d'asta) lo dichiara il pannello delle opzioni globali, che questa pagina apre e
 * non duplica: due finestre sulla stessa dichiarazione sarebbero due dichiarazioni.
 */
type Settings = LeagueSettings & { view: BlockView };

/** Dove finisce l'ordine personale dei blocchi: una preferenza sua, non un fatto del bundle. */
const PRIORITY_KEY = 'strategy.priority';

/**
 * L'ordine personale come sta sul disco, validato invece che creduto.
 *
 * Quello che c'e' scritto puo' venire da una versione precedente: un JSON illeggibile, o che non e' una
 * mappa di liste di numeri, torna vuoto. Un ordine perso e' una preferenza persa, che va bene; una
 * pagina che non si apre no.
 */
function readPriority(): Record<string, number[]> {
  try {
    const raw = localStorage.getItem(`fantassistant.${PRIORITY_KEY}`);
    const stored: unknown = raw == null ? null : JSON.parse(raw);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    const out: Record<string, number[]> = {};
    for (const [key, ids] of Object.entries(stored as Record<string, unknown>)) {
      if (!Array.isArray(ids)) continue;
      const kept = ids.filter((one): one is number => typeof one === 'number' && Number.isFinite(one));
      if (kept.length) out[key] = kept;
    }
    return out;
  } catch {
    return {};
  }
}

/** Un numero che moltiplica le presenze, riscalato: null resta null, «vuoto = ignoto». */
function scaled(value: number | null, factor: number): number | null {
  return value == null ? null : value * factor;
}

/** Come si chiama a schermo ognuna delle due valute, e cosa dice quel numero. */
const GAIN_LABEL: Record<AuctionKind, string> = {
  rilanci: 'SURPLUS',
  draft: 'VALORE',
};

/**
 * PERCHÉ IL NUMERO È A GIORNATA, e non un totale di stagione (operatore, 04/09/2026).
 *
 * È la sua regola del 03/09 - «i risultati si riportano in punti A GIORNATA, mai in totali di stagione:
 * per me è più facile capire di che grandezze parliamo» - applicata alla colonna che ordina queste
 * liste. Un totale nasconde l'ordine di grandezza, e la giornata è anche l'unità in cui la differenza
 * CONTA, perché una giornata vale ~70 punti e la scala dei gol parte da 66.
 *
 * IL DIVISORE È DEL FOGLIO (`matchdays_target`, 38 su Serie A e 31 su EuroLeghe) e non una costante:
 * `engine_pv_pred` vive sul calendario della PIATTAFORMA, e dividere il surplus di un foglio per le
 * giornate di un altro è una quota di niente. Dove il foglio non lo dichiara il numero resta il totale
 * di stagione e l'etichetta lo DICE, invece di stampare un totale sotto un'unità che non è la sua.
 */
const PER_MATCH_HINT =
  ' Il numero è A GIORNATA: il totale di stagione diviso le giornate del calendario su cui il motore lo'
  + ' esprime (il foglio le dichiara), perché un totale nasconde l\'ordine di grandezza. L\'ordine delle'
  + ' liste non cambia - dividere tutti per lo stesso numero non riordina niente - e nemmeno le fasce del'
  + ' colore, che sono percentili.';

const GAIN_HINT: Record<AuctionKind, string> = {
  rilanci:
    "In un'asta a rilanci la risorsa scarsa è il credito, cioè esattamente quello che il surplus sottrae: i fantapunti che dà IN PIÙ del giocatore che schiereresti al suo posto. È la colonna del motore (engine_surplus), letta dal foglio e mai ricalcolata qui.",
  draft:
    'In un draft non si spendono crediti ma scelte, e il surplus addebita una scarsità per-slot che il regolamento non impone: misurato sulle cinque finestre del banco (metrica-asta-surplus-v1.md §16) costa il 4% dei punti. La valuta è quindi il VALORE - fantamedia attesa × presenze attese, senza sottrarre niente - portiere compreso.',
};

/**
 * LA STRATEGIA: quanti uomini di ogni ruolo servono, e chi sono i migliori.
 *
 * La pagina non possiede aritmetica: tutto quello che disegna viene da `core/strategy.ts`, che un test
 * unitario raggiunge senza un browser. Qui stanno la dichiarazione del regolamento (che nel bundle non
 * c'è), la scelta del FOGLIO che quella dichiarazione implica, e il layout.
 *
 * IL FOGLIO È SCELTO DA (listone, gioco) e non dalla piattaforma: il bundle ne porta tre - EuroLeghe
 * mantra, Leghe classic, Leghe mantra - e il surplus di un uomo è un fatto sul GIOCO per cui lo compri,
 * perché il rimpiazzo è per slot di ruolo e i due giochi non hanno gli stessi slot. Una combinazione che
 * il bundle non porta non viene riempita con l'altra: la pagina dice che non c'è.
 */
@Component({
  selector: 'app-strategy',
  imports: [
    CdkDrag,
    CdkDropList,
    ClubCrest,
    DecimalPipe,
    FormsModule,
    GainChip,
    NzAlertModule,
    NzButtonModule,
    NzIconModule,
    NzPopconfirmModule,
    NzRadioModule,
    NzTooltipModule,
    PlayerFlags,
    RoleBadge,
    RouterLink,
  ],
  templateUrl: './strategy.html',
  host: { class: 'view-host' },
})
export class Strategy {
  protected readonly store = inject(ValuationStore);
  private readonly bundle = inject(Bundle);
  /**
   * LE LETTURE MISURATE, per la sola metà che il foglio non porta: la COSTANZA.
   *
   * Letta da chi la calcola già e mai ricalcolata qui: `steadyOf` è una definizione sola con tre
   * lettori (la colonna, il campetto, le buste), e una quarta copia darebbe a un uomo due percentuali
   * di sufficienze. Non costa niente in più a questa pagina - `ValuationStore` chiede le letture da sé
   * appena il listone è in casa - e finché non arrivano la pastiglia porta le sole presenze.
   */
  private readonly ratings = inject(PlayerRatingsStore);
  /** Il regolamento della lega e le squadre escluse: dichiarati una volta, validi in ogni vista. */
  private readonly options = inject(GlobalOptions);
  /** Il conto delle giornate che giochera' davvero: lo stesso della plancia, non una copia. */
  private readonly play = inject(ExpectedPlay);
  protected readonly appVersion = APP_VERSION;

  /** Il calendario su cui il foglio esprime le sue previsioni: il divisore di ogni numero a giornata. */
  protected readonly matchdays = computed(() => this.sheet()?.matchdays_target ?? null);

  /**
   * Il gain A GIORNATA, che è quello che le liste mostrano (vedi `PER_MATCH_HINT`).
   *
   * UNA definizione sola, letta dalla riga E dalla scala del colore: le fasce sono percentili, quindi
   * dividere solo le righe le lascerebbe tarate su un'altra unità e ogni uomo leggerebbe `scarso`.
   */
  protected perMatch(gain: number | null): number | null {
    const rounds = this.matchdays();
    return gain == null || !rounds ? gain : gain / rounds;
  }

  protected readonly gainLabel = computed(
    () => GAIN_LABEL[this.settings().auction] + (this.matchdays() ? ' a giornata' : ' a stagione'),
  );

  protected readonly gainHint = computed(
    () =>
      GAIN_HINT[this.settings().auction] +
      (this.matchdays()
        ? PER_MATCH_HINT.replace('il foglio le dichiara', `${this.matchdays()} su questo foglio`)
        : ' Il foglio non dichiara il suo calendario, quindi questo è il TOTALE di stagione: senza le'
          + ' giornate su cui il motore lo esprime, un numero a giornata sarebbe una quota di niente.'),
  );

  /**
   * IL REGOLAMENTO, letto dalle opzioni globali, più la sola preferenza che è di questa pagina.
   *
   * Letto e non copiato: se la Strategia ne tenesse una copia, cambiarlo dalle Buste chiuse lascerebbe
   * questa pagina a ordinare con un budget e delle rose che nessuno dichiara più.
   */
  /**
   * COME SI LEGGE UN BLOCCO: l'unica preferenza che resta di questa pagina.
   *
   * Non è il regolamento - non cambia chi si può comprare né quanti - è come si vuole leggere la
   * classifica di un posto, quindi segue l'operatore da una sessione all'altra e sta in `localStorage`
   * come le altre preferenze di lettura. Un valore che questa versione non capisce torna al default.
   */
  protected readonly view = stored<BlockView>('strategy.view', 'all', ['all', 'natives']);

  protected readonly settings = computed<Settings>(() => ({
    ...this.options.league(),
    view: this.view(),
  }));

  /** Il rulebook mantra: le undici forme legali e quali ruoli accetta ogni posto. Letto, mai dedotto. */
  private readonly rulebook = signal<MantraModulesFile | null>(null);
  private readonly rulebookMissing = signal(false);

  /**
   * L'ORDINE PERSONALE per blocco: `listone|gioco|ruolo` -> gli `fc_id` come li ha sistemati lui.
   *
   * La chiave NON contiene il foglio: una preferenza è un fatto sulla sua lega e sul ruolo, non sulla
   * revisione del foglio che stiamo leggendo, quindi un export nuovo la conserva. Contiene il listone e
   * il gioco perché quelli sono liste di uomini DIVERSE, e un ordine che scavalcasse da una all'altra
   * sarebbe l'ordine di una lista addosso a un'altra.
   */
  private readonly priority = signal<Record<string, number[]>>(readPriority());

  /** Solo gli ordini di questa combinazione, per ruolo: è quello che `blocksOf` chiede. */
  private readonly priorityHere = computed<Map<string, readonly number[]>>(() => {
    const { platform, game } = this.settings();
    const out = new Map<string, readonly number[]>();
    for (const [key, ids] of Object.entries(this.priority())) {
      const [where, which, role] = key.split('|');
      if (where === platform && which === game && role && ids.length) out.set(role, ids);
    }
    return out;
  });

  /** Quanti blocchi porta un ordine suo: la barra lo dice, o una preferenza salvata è invisibile. */
  protected readonly arranged = computed(() => this.priorityHere().size);


  /** Le colonne del motore del foglio scelto, per `fc_id`. Null = non ancora lette, o foglio assente. */
  private readonly engine = signal<Map<number, EngineExpectation> | null>(null);
  protected readonly reading = signal(false);

  constructor() {
    void this.store.load();
    void this.bundle.modules().then((file) => {
      this.rulebook.set(file);
      // Un bundle più vecchio non porta il regolamento: su mantra le liste non possono essere
      // dimensionate dalle forme, e la pagina lo dice invece di inventare una lunghezza.
      this.rulebookMissing.set(file == null);
    });

    // Il foglio cambia quando cambia (listone, gioco): le colonne si rileggono, e finché non arrivano la
    // pagina dice che sta leggendo - un vuoto silenzioso si legge come «nessuno è valutato».
    effect(() => {
      const sheet = this.sheet();
      if (!sheet) {
        this.engine.set(null);
        this.reading.set(false);
        return;
      }
      this.reading.set(true);
      void this.store.expectationsFor(sheet).then((columns) => {
        // Il foglio può essere già cambiato mentre si leggeva: una risposta vecchia non deve
        // sovrascrivere quella nuova.
        if (this.sheet()?.path !== sheet.path) return;
        this.engine.set(columns);
        this.reading.set(false);
      });
    });
  }

  // ---------------------------------------------------------------- il foglio e il setup

  /** Il foglio che prezza QUESTA combinazione, o null se il bundle non ce l'ha. */
  protected readonly sheet = computed<EngineSheetEntry | null>(() => {
    const { platform, game } = this.settings();
    return (
      this.store.sheets().find((one) => one.platform === platform && one.game === game) ?? null
    );
  });

  /** Cosa il bundle porta davvero, per dirlo quando la combinazione scelta non c'è. */
  protected readonly available = computed(() =>
    this.store
      .sheets()
      .map((one) => `${one.league} · ${one.game === 'mantra' ? 'Mantra' : 'Classic'}`)
      .join(' · '),
  );

  protected readonly setup = computed<StrategySetup>(() => {
    const { game, slots, budget, auction, teams, view } = this.settings();
    return { game, slots, budget, auction, teams, view };
  });

  /**
   * Come si leggono i blocchi, e lo switch sta nella BARRA e non nella finestra: cambia l'ordine di ogni
   * lista a schermo, e un'impostazione che cambia quello che si sta guardando non si mette dove per
   * vederla bisogna chiudere quello che si sta guardando.
   */
  protected readonly viewOptions: { value: BlockView; label: string; hint: string }[] = [
    {
      value: 'all',
      label: 'Tutti',
      hint: 'Ogni blocco è la classifica di chi può coprire quel posto, e chi ha un posto più arretrato porta la freccia: un C/T lo metteresti da C, quindi fra i trequartisti è un ripiego e la freccia dice dove lo useresti. Ordina il gain e non il mestiere, perché mettere davanti i soli trequartisti puri porta la somma dei gain di quel blocco da 256 a MENO 9 e fa sparire McTominay, Da Cunha e Rabiot (misurato il 27/08/2026 sul foglio Serie A mantra).',
    },
    {
      value: 'natives',
      label: 'Solo di mestiere',
      hint: 'Solo chi NON può giocare più arretrato: le opzioni vere per quel posto, se i tuoi polivalenti li usi dove rendono di più. Il prezzo è detto: sul listone di oggi i BRACCETTI restano zero (ogni braccetto quotato è anche un Dc, un Dd o un Ds), gli esterni scendono a 19 su una domanda di 23 e i trequartisti a 17.',
    },
  ];

  protected setView(view: BlockView): void {
    this.view.set(view);
  }

  /**
   * DOVE LA DICHIARAZIONE E IL FOGLIO NON VANNO D'ACCORDO, e non si corregge da sé.
   *
   * Il surplus del foglio è contato dal rimpiazzo di `squadre × slot` del foglio stesso: se la lega che
   * l'operatore dichiara ne ha altri, il GAIN resta quello del foglio - l'app non ha un motore e non può
   * ricalcolarlo - mentre le LISTE seguono la sua dichiarazione. Detto a schermo, perché «un numero deve
   * dire contro cosa è misurato»: il bottone «allinea al foglio» è lì per chi vuole che coincidano.
   */
  protected readonly mismatch = computed<string | null>(() => {
    const sheet = this.sheet();
    if (!sheet) return null;
    const { teams, game, slots } = this.settings();
    const said: string[] = [];
    if (sheet.teams != null && sheet.teams !== Math.round(teams)) {
      said.push(`${sheet.teams} squadre invece di ${Math.round(teams)}`);
    }
    const own = sheet.squad_slots;
    if (own) {
      const mine =
        game === 'classic'
          ? [slots.classic.P, slots.classic.D, slots.classic.C, slots.classic.A]
          : null;
      const sheetSlots = [own['P'] ?? 0, own['D'] ?? 0, own['C'] ?? 0, own['A'] ?? 0];
      if (mine && mine.some((one, at) => Math.round(one) !== sheetSlots[at])) {
        said.push(`rose ${sheetSlots.join('/')} invece di ${mine.map(Math.round).join('/')}`);
      }
      if (!mine) {
        // Su mantra il foglio dichiara comunque i quattro slot classic: quello che si può confrontare è
        // il totale, cioè quanti uomini una rosa tiene - il resto è un altro vocabolario.
        const total = sheetSlots.reduce((sum, one) => sum + one, 0);
        const declared = Math.round(slots.mantra.por + slots.mantra.mov);
        if (total !== declared) said.push(`rose di ${total} uomini invece di ${declared}`);
      }
    }
    return said.length ? said.join(', ') : null;
  });

  // ---------------------------------------------------------------- gli uomini

  /**
   * Ogni uomo quotato su questo listone, con i due numeri del foglio scelto addosso.
   *
   * Il PERIMETRO è quello del listone (`listone_quotes` attraverso lo store), cioè la stessa popolazione
   * che vede la tabella di consultazione: due liste diverse sotto la stessa intestazione sarebbero due
   * liste i cui numeri descrivono l'altra.
   */
  protected readonly pool = computed<StrategyBidder[]>(() => {
    const engine = this.engine();
    if (!engine) return [];
    const platform = this.settings().platform;
    const listone = this.store.rosters().get(platform) ?? [];
    // Letto perché le righe si RIFACCIANO quando le letture atterrano: arrivano dopo il resto del
    // bundle, e senza questa dipendenza la pastiglia delle sufficienze resterebbe muta per sempre su
    // una pagina già disegnata. Stessa riga, stessa ragione, di `ValuationStore.valuations`.
    const rated = this.ratings.ready();
    const matchdays = this.matchdays();
    // SOLO CHI IL LISTONE QUOTA (operatore, 04/09/2026: «Cheddira del Napoli e' ridicolo che stia nei
    // primi 60 attaccanti, non giochera' mai»). Il difetto non era la sua valutazione: e' che non e'
    // quotato affatto - zero righe in `listone_quotes` per il 2026-27, su nessuna delle due piattaforme
    // - ed era in lista perche' il FOGLIO si costruisce sulle rose vere e l'app aggiunge chi il listone
    // non ha (70 righe su 602). Un uomo che non si puo' comprare non sta in una lista di nomi da
    // comprare: e' la sua regola del 03/09 gia' viva sulla plancia, portata qui.
    return listone.filter((player) => player.quoted).map((player) => {
      const one = engine.get(player.fcId);
      const steady = rated ? this.ratings.for(platform, player.fcId)?.steady : null;
      // QUANTE NE GIOCHERA' DAVVERO, col conto unico dell'app (`core/expected-play.ts`, 04/09/2026):
      // il metro della plancia dove il motore ripiega su una costante, meno le giornate che uno stop
      // aperto gli toglie di sicuro, meno l'assicurazione dell'operatore. Il FATTORE che ne esce
      // riprezza il surplus e il valore perche' tutt'e due moltiplicano le presenze - non e' un
      // secondo motore, e' il numero del foglio con meno giornate sotto.
      const outlook = this.play.outlook(
        { id: player.fcId, club: player.club },
        { pv: one?.pv ?? null, pvIsEstimate: one?.pvIsEstimate ?? false,
          playShare: one?.titolaritaPlay ?? null },
        matchdays,
      );
      return {
        fcId: player.fcId,
        name: player.name,
        club: player.club,
        clubId: player.clubId,
        role: player.role,
        mantraCodes: player.mantraCodes,
        surplus: one?.surplus == null ? null : one.surplus * outlook.factor,
        surplusIsEstimate: one?.surplusIsEstimate ?? false,
        value: scaled(valueFromEngine(one), outlook.factor),
        outlook,
        // Il valore è un PRODOTTO: sta in piedi sul ripiego dichiarato se una delle due metà lo è.
        valueIsEstimate: (one?.fmIsEstimate ?? false) || (one?.pvIsEstimate ?? false),
        // Le quattro letture delle pastiglie: tre dal foglio, la quarta dalle sue stagioni.
        fm: one?.fm ?? null,
        pv: outlook.expected,
        minutes: one?.minutesNext ?? null,
        steady: steady?.share ?? null,
        steadyWeight: steady?.weight ?? 0,
        steadyNote: steady?.note ?? '',
      };
    });
  });

  /**
   * Le fasce del gain, tagliate UNA VOLTA sul listone intero e non sul blocco.
   *
   * Sono percentili del pool, e quale pool è metà della misura: tagliate per blocco, ogni ruolo avrebbe
   * il suo miglior uomo `ottimo` e il colore direbbe soltanto «è il primo della sua lista». Così invece
   * un verde vale la stessa cosa in tutt'e dodici le colonne.
   */
  protected readonly scale = computed<GainScale>(() =>
    scaleOf(this.pool().map((man) => this.perMatch(gainOf(man, this.setup().auction)))),
  );

  protected readonly blocks = computed<RoleBlock[]>(() =>
    blocksOf({
      pool: this.pool(),
      setup: this.setup(),
      rules: this.rulebook(),
      priority: this.priorityHere(),
    }),
  );

  /** Quanti nomi la pagina sta mostrando in tutto, e quanti il foglio non prezza affatto. */
  protected readonly counted = computed(() => {
    const blocks = this.blocks();
    return {
      shown: blocks.reduce((sum, one) => sum + one.men.length, 0),
      demand: blocks.reduce((sum, one) => sum + one.demand, 0),
      unranked: blocks.reduce((sum, one) => sum + one.unranked, 0),
    };
  });

  /**
   * QUANTE COLONNE, e non è una scelta estetica: quattro blocchi classic stanno in una riga sola, dodici
   * blocchi mantra no, quindi sei per riga li mette in due righe piene invece di lasciarne una spaiata.
   */
  protected readonly columns = computed(() => (this.settings().game === 'mantra' ? 6 : 4));

  protected readonly warning = computed<string | null>(() => {
    if (this.settings().game === 'mantra' && this.rulebookMissing()) {
      return 'Questo bundle non porta mantra_modules.json, che è il file dove stanno i ruoli del listone mantra e le forme legali: senza di lui non so né come si chiamano i blocchi né quanti uomini di ogni ruolo comprerà la stanza, quindi non ne disegno nessuno. Rifai un export del toolkit, oppure gioca a classic.';
    }
    return null;
  });

  // ---------------------------------------------------------------- le impostazioni

  /** La finestra è UNA e sta fuori dalle viste: questa pagina la apre e non ne tiene una sua. */
  protected openSettings(): void {
    this.options.open();
  }

  /** Le due domande che la barra deve poter rispondere senza aprire niente. */
  protected readonly summary = computed(() => {
    const { platform, game, slots, budget, auction, teams } = this.settings();
    const roster =
      game === 'classic'
        ? `${slots.classic.P}/${slots.classic.D}/${slots.classic.C}/${slots.classic.A}`
        : `${slots.mantra.por} + ${slots.mantra.mov}`;
    return {
      listone: platform === 'euro' ? 'EuroLeghe' : 'Serie A',
      game: game === 'mantra' ? 'Mantra' : 'Classic',
      roster,
      budget,
      auction: auction === 'draft' ? 'Draft' : 'Rilanci',
      teams: Math.round(teams),
    };
  });

  protected readonly game = computed<StrategyGame>(() => this.settings().game);

  // ---------------------------------------------------------------- le bande dello slot

  /**
   * QUANTI NOMI FA UNA BANDA: i partecipanti, e non un numero scelto per come sta a schermo.
   *
   * Una banda di `teams` nomi È uno SLOT - il rango dentro il ruolo diviso il numero di rose - che in
   * questo progetto è una legge di conservazione e non una convenzione grafica: in una lega da dieci ci
   * sono dieci «primi difensori» perché ognuno ne schiera uno, ed è la popolazione su cui il banco
   * d'asta ha misurato ogni tetto d'offerta (`simulatore-asta-rilanci-v1.md` §19.3). A classic la
   * domanda del blocco è `slot × partecipanti`, quindi le bande cadono esatte; a mantra la domanda
   * viene dalle forme e l'ultima banda può essere corta - che è un fatto sulla lista, non un difetto.
   */
  protected readonly bandSize = computed(() => Math.max(1, Math.round(this.settings().teams)));

  /** In quale banda cade la riga `at` (0-based): il numero che il DOM dichiara, così è verificabile. */
  protected bandOf(at: number): number {
    return Math.floor(at / this.bandSize());
  }

  /**
   * Il fondo di una riga: le bande si alternano, la prima tinta.
   *
   * La tinta è quella della zebra che sostituisce (`bg-control/25`, misurata a schermo su questo tema),
   * e la zebra se ne va invece di restare: due alternanze sulla stessa proprietà darebbero quattro
   * tinte, e il confine della banda - la sola cosa che questo colore deve dire - si perderebbe fra le
   * altre tre. Il segnaposto del trascinamento vince comunque, perché la sua regola porta due classi.
   */
  protected bandTone(at: number): string {
    return this.bandOf(at) % 2 === 0 ? 'bg-control/25' : '';
  }

  /**
   * Le classi che CDK mette sull'ANTEPRIMA - l'opacità 0,3 chiesta dall'operatore (27/08/2026).
   *
   * UN ARRAY, e la ragione è misurata: una stringa sola con gli spazi finisce in `classList.add()`, che su
   * un nome con spazi solleva `InvalidCharacterError` - e il gesto muore in SILENZIO, con la pagina intera
   * che si disegna bene, zero anteprime e nessun errore in console. Un array è una classe per voce, che è
   * quello che quel metodo accetta. Un campo e non un letterale nel template, perché un array scritto in
   * un binding è un oggetto nuovo a ogni giro di change detection.
   *
   * E NIENTE FONDO, che è un fatto misurato e non una scelta: sull'anteprima **nessuna classe di
   * background si applica** - né `bg-surface`, né la stessa cosa come variante sulla riga
   * (`[&.cdk-drag-preview]:bg-surface`), né un colore LETTERALE (`bg-[#141d19]`) - mentre `opacity-30`
   * dalla stessa lista si applica. La regola è nel foglio costruito, la classe è sull'elemento, il token
   * risolve, e il fondo resta `rgba(0, 0, 0, 0)`: non è spiegato, quindi non c'è CSS che finga di
   * dipingerlo. Quello che si vede è l'opacità, che è quello che era stato chiesto; il fondo era
   * un'aggiunta per la leggibilità e resta un item aperto (`pagina-strategia-v1.md` §12).
   */
  protected readonly previewClass = ['rounded-md', 'opacity-30'];

  // ---------------------------------------------------------------- il riordino

  /**
   * IL RILASCIO DI CDK, che è l'unica cosa che questa pagina deve sapere del gesto.
   *
   * Il trascinamento è di `@angular/cdk/drag-drop` per scelta dell'operatore (27/08/2026), e con lui
   * arrivano l'anteprima, il segnaposto, lo scorrimento della lista al bordo e il drag nativo del browser
   * già spento: le quattro cose che il gesto scritto in casa rifaceva a mano. Il pacchetto era già
   * installato - `ng-zorro-antd` dipende da `@angular/cdk` - quindi non è una dipendenza nuova, solo una
   * riga di `package.json` che ora la DICHIARA invece di ereditarla di nascosto.
   *
   * Quello che NON cambia è il modello: `withRowAt` riceve l'indice finale che CDK dichiara e restituisce
   * il PREFISSO (i nomi sistemati in cima, sotto continua il gain). Il DOM lo muove e lo rimette a posto
   * CDK; l'ordine vero resta il nostro signal, e la lista si ridisegna da quello.
   *
   * IL PRECEDENTE, perché ce n'è uno e va letto: CDK era stato mandato via dalla TABELLA il 18/08/2026 con
   * due accuse, e una delle due è stata poi ribaltata - i «buchi / disallineamenti» erano un `nz-tooltip`
   * che si mangiava una colonna della griglia (`letture-app-v1.md` §17), non CDK. Quello che restava di
   * misurato era il fotogramma al rilascio su una riga di `<th>` a larghezze fisse; qui le righe sono
   * `<li>` di una lista che scorre, cioè il caso per cui `cdkDropList` esiste. L'arnese e2e misura
   * esattamente quel fotogramma: zero anteprime, zero segnaposti, zero `transform` residui.
   */
  protected dropped(role: string, event: CdkDragDrop<RankedMan[]>): void {
    const shown = event.container.data.map((row) => row.man.fcId);
    const id = event.item.data as number;
    const moved = withRowAt(this.priorityHere().get(role) ?? [], shown, id, event.currentIndex);
    if (!moved) return;
    const { platform, game } = this.settings();
    this.priority.update((one) => ({ ...one, [`${platform}|${game}|${role}`]: moved }));
    this.savePriority();
  }

  /** Torna al gain per quel blocco. Revocabile a ogni sguardo, come ogni cosa dichiarata di questa app. */
  protected clearOrder(role: string): void {
    const { platform, game } = this.settings();
    this.priority.update((one) => {
      const out = { ...one };
      delete out[`${platform}|${game}|${role}`];
      return out;
    });
    this.savePriority();
  }

  /** ...e per tutti i blocchi di questa combinazione: dodici crocette sono dodici gesti. */
  protected clearAllOrders(): void {
    const { platform, game } = this.settings();
    this.priority.update((one) => {
      const out: Record<string, number[]> = {};
      for (const [key, ids] of Object.entries(one)) {
        if (!key.startsWith(`${platform}|${game}|`)) out[key] = ids;
      }
      return out;
    });
    this.savePriority();
  }

  private savePriority(): void {
    try {
      localStorage.setItem(`fantassistant.${PRIORITY_KEY}`, JSON.stringify(this.priority()));
    } catch {
      // Un browser che rifiuta la memoria disegna la pagina: dimentica l'ordine al ricaricamento.
    }
  }
}
