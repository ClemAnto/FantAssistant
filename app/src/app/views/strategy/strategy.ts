import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { Bundle, EngineSheetEntry, MantraModulesFile } from '../../core/bundle';
import { ClassicRole, Platform } from '../../core/players-store';
import { GainScale, scaleOf } from '../../core/sealed-bid';
import {
  AuctionKind,
  BlockView,
  RoleBlock,
  StrategyBidder,
  StrategyGame,
  StrategySetup,
  blocksOf,
  gainOf,
} from '../../core/strategy';
import { EngineExpectation, ValuationStore, valueFromEngine } from '../../core/valuation-store';
import { APP_VERSION } from '../../version';
import { ClubCrest } from '../../ui/club-crest/club-crest';
import { GainChip } from '../../ui/gain-chip/gain-chip';
import { PlayerFlags } from '../../ui/player-flags/player-flags';
import { RoleBadge } from '../../ui/role-badge/role-badge';
import { RoleSet } from '../../ui/role-set/role-set';

const KEY = 'strategy.setup';

/** Il regolamento della lega più il listone su cui si gioca: quello che l'operatore dichiara. */
interface Settings extends StrategySetup {
  platform: Platform;
}

/**
 * I valori di partenza, e sono quelli del regolamento CLASSIC standard (3/8/8/6, mille crediti, dieci
 * squadre) - cioè la lega dell'operatore. Non sono un default neutro e dirlo è il punto: appena il foglio
 * scelto dichiara altri numeri, la pagina lo SEGNALA invece di riallineare da sola, perché la
 * composizione della rosa è una sua dichiarazione e non un dato del bundle.
 */
const DEFAULTS: Settings = {
  platform: 'default',
  game: 'classic',
  slots: { classic: { P: 3, D: 8, C: 8, A: 6 }, mantra: { por: 2, mov: 23 } },
  budget: 1000,
  auction: 'rilanci',
  teams: 10,
  // LA REGOLA DELL'OPERATORE MARCA E NON FILTRA, e la ragione è misurata (vedi `BlockView`): ogni
  // blocco resta la classifica di chi può coprire quel posto, e chi lo coprirebbe scendendo da un posto
  // più arretrato porta il suo marchio. «Solo di mestiere» resta a un clic.
  view: 'all',
};

function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(`fantassistant.${KEY}`);
    if (raw == null) return DEFAULTS;
    const stored = JSON.parse(raw) as Partial<Settings>;
    // Fuso campo per campo e non con uno spread: una versione più vecchia di questa pagina può aver
    // salvato un oggetto senza `slots.mantra`, e uno spread lo lascerebbe undefined dentro il conto.
    return {
      platform: stored.platform === 'euro' ? 'euro' : 'default',
      game: stored.game === 'mantra' ? 'mantra' : 'classic',
      slots: {
        classic: { ...DEFAULTS.slots.classic, ...(stored.slots?.classic ?? {}) },
        mantra: { ...DEFAULTS.slots.mantra, ...(stored.slots?.mantra ?? {}) },
      },
      budget: Number.isFinite(stored.budget) ? (stored.budget as number) : DEFAULTS.budget,
      auction: stored.auction === 'draft' ? 'draft' : 'rilanci',
      teams: Number.isFinite(stored.teams) ? (stored.teams as number) : DEFAULTS.teams,
      view: stored.view === 'natives' ? 'natives' : 'all',
    };
  } catch {
    return DEFAULTS;
  }
}

/** Come si chiama a schermo ognuna delle due valute, e cosa dice quel numero. */
const GAIN_LABEL: Record<AuctionKind, string> = {
  rilanci: 'SURPLUS',
  draft: 'VALORE',
};

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
    ClubCrest,
    FormsModule,
    GainChip,
    NzAlertModule,
    NzButtonModule,
    NzIconModule,
    NzInputNumberModule,
    NzModalModule,
    NzRadioModule,
    NzTooltipModule,
    PlayerFlags,
    RoleBadge,
    RoleSet,
    RouterLink,
  ],
  templateUrl: './strategy.html',
  host: { class: 'view-host' },
})
export class Strategy {
  protected readonly store = inject(ValuationStore);
  private readonly bundle = inject(Bundle);
  protected readonly appVersion = APP_VERSION;
  protected readonly gainLabel = GAIN_LABEL;
  protected readonly gainHint = GAIN_HINT;
  protected readonly classicRoles: ClassicRole[] = ['P', 'D', 'C', 'A'];

  protected readonly settings = signal<Settings>(readSettings());

  /** La copia che si sta modificando nella finestra: annullare deve poter annullare davvero. */
  protected readonly form = signal<Settings>(readSettings());
  protected readonly editing = signal(false);

  /** Il rulebook mantra: le undici forme legali e quali ruoli accetta ogni posto. Letto, mai dedotto. */
  private readonly rulebook = signal<MantraModulesFile | null>(null);
  private readonly rulebookMissing = signal(false);

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
    this.settings.update((one) => ({ ...one, view }));
    this.save(this.settings());
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
    const listone = this.store.rosters().get(this.settings().platform) ?? [];
    return listone.map((player) => {
      const one = engine.get(player.fcId);
      return {
        fcId: player.fcId,
        name: player.name,
        club: player.club,
        clubId: player.clubId,
        role: player.role,
        mantraCodes: player.mantraCodes,
        surplus: one?.surplus ?? null,
        surplusIsEstimate: one?.surplusIsEstimate ?? false,
        value: valueFromEngine(one),
        // Il valore è un PRODOTTO: sta in piedi sul ripiego dichiarato se una delle due metà lo è.
        valueIsEstimate: (one?.fmIsEstimate ?? false) || (one?.pvIsEstimate ?? false),
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
    scaleOf(this.pool().map((man) => gainOf(man, this.setup().auction))),
  );

  protected readonly blocks = computed<RoleBlock[]>(() =>
    blocksOf({ pool: this.pool(), setup: this.setup(), rules: this.rulebook() }),
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

  protected openSettings(): void {
    this.form.set(structuredClone(this.settings()));
    this.editing.set(true);
  }

  protected patch(change: Partial<Settings>): void {
    this.form.update((one) => ({ ...one, ...change }));
  }

  protected patchClassic(role: ClassicRole, value: number): void {
    this.form.update((one) => ({
      ...one,
      slots: { ...one.slots, classic: { ...one.slots.classic, [role]: value } },
    }));
  }

  protected patchMantra(which: 'por' | 'mov', value: number): void {
    this.form.update((one) => ({
      ...one,
      slots: { ...one.slots, mantra: { ...one.slots.mantra, [which]: value } },
    }));
  }

  /** Il foglio che la finestra sta scegliendo mentre la si compila: la sua riga lo nomina. */
  protected readonly formSheet = computed<EngineSheetEntry | null>(() => {
    const { platform, game } = this.form();
    return (
      this.store.sheets().find((one) => one.platform === platform && one.game === game) ?? null
    );
  });

  /**
   * ALLINEA AL FOGLIO: copia squadre e slot da come il toolkit ha costruito la lista.
   *
   * Esiste perché il foglio è la sola cosa che sa contro quale zero il suo surplus è contato, ma non
   * scatta da sé: la composizione della rosa è una dichiarazione dell'operatore, e sovrascriverla in
   * silenzio sarebbe decidere al posto suo.
   */
  protected alignToSheet(): void {
    const sheet = this.formSheet();
    const own = sheet?.squad_slots;
    if (!sheet) return;
    this.form.update((one) => ({
      ...one,
      teams: sheet.teams ?? one.teams,
      slots: own
        ? {
            classic: {
              P: own['P'] ?? one.slots.classic.P,
              D: own['D'] ?? one.slots.classic.D,
              C: own['C'] ?? one.slots.classic.C,
              A: own['A'] ?? one.slots.classic.A,
            },
            // Su mantra il foglio parla ancora per macro-ruolo, quindi i portieri sono i suoi `P` e gli
            // uomini di movimento la somma degli altri tre: è la traduzione, non una seconda regola.
            mantra: {
              por: own['P'] ?? one.slots.mantra.por,
              mov: (own['D'] ?? 0) + (own['C'] ?? 0) + (own['A'] ?? 0) || one.slots.mantra.mov,
            },
          }
        : one.slots,
    }));
  }

  protected applySettings(): void {
    const next = this.form();
    this.settings.set(next);
    this.editing.set(false);
    this.save(next);
  }

  private save(what: Settings): void {
    try {
      localStorage.setItem(`fantassistant.${KEY}`, JSON.stringify(what));
    } catch {
      // Un browser che rifiuta la memoria disegna la pagina lo stesso: la dimentica al ricaricamento.
    }
  }

  protected cancelSettings(): void {
    this.editing.set(false);
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
}
