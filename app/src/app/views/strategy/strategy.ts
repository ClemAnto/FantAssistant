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
import { GlobalOptions, LeagueSettings } from '../../core/global-options';
import { withRowMoved, rowGapAt } from '../../core/manual-order';
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
import { stored } from '../../core/view-state';
import { APP_VERSION } from '../../version';
import { ClubCrest } from '../../ui/club-crest/club-crest';
import { GainChip } from '../../ui/gain-chip/gain-chip';
import { PlayerFlags } from '../../ui/player-flags/player-flags';
import { RoleBadge } from '../../ui/role-badge/role-badge';
import { RoleSet } from '../../ui/role-set/role-set';

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

/** Quanti pixel prima che un click diventi un trascinamento: sotto, e' un click che ordina. */
const DRAG_THRESHOLD_PX = 5;

/** A quanti pixel dal bordo la lista comincia a scorrere da se', e di quanto per volta. */
const DRAG_EDGE_PX = 60;
const DRAG_SCROLL_STEP_PX = 24;

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
    NzPopconfirmModule,
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
  /** Il regolamento della lega e le squadre escluse: dichiarati una volta, validi in ogni vista. */
  private readonly options = inject(GlobalOptions);
  protected readonly appVersion = APP_VERSION;
  protected readonly gainLabel = GAIN_LABEL;
  protected readonly gainHint = GAIN_HINT;

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

  /** Il nome in mano, il suo blocco e il varco dove finirebbe. Null = nessun trascinamento in volo. */
  private readonly dragId = signal<number | null>(null);
  private readonly dragRole = signal<string | null>(null);
  private readonly dragGap = signal<number | null>(null);

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

  // ---------------------------------------------------------------- il gesto che riordina

  /**
   * PRESA UNA RIGA: si aspetta un movimento vero prima di chiamarlo trascinamento.
   *
   * E' il gesto della tabella (`ui/squad-table`, riscritto il 20/08/2026) su un altro asse, e ne porta
   * dietro le due cure che sono costate una serata:
   *
   *  - IL TRASCINAMENTO NATIVO DEL BROWSER VA SPENTO SUBITO, dal `pointerdown` e non dalla soglia: un
   *    `mousedown` piu' un movimento sopra del testo fa partire il drag nativo di Chromium, che si prende
   *    il puntatore e smette di mandare `pointermove` - misurato contando gli eventi che ARRIVANO,
   *    `pointerdown` 1 e `pointermove` 2 su 18. Dal di fuori si legge come «funziona a volte».
   *  - I LISTENER DEL VOLO STANNO SU `window` e non sulla riga: senza cattura del puntatore un
   *    `pointermove` ha per bersaglio quello che sta sotto il dito, quindi uscendo dalla lista la riga
   *    non lo sentirebbe piu' e il gesto morirebbe a meta'.
   *
   * Nessun click da mangiare, a differenza della tabella: qui una riga non fa niente al click, quindi
   * non c'e' una seconda azione da distinguere. E nessun `touch-action`: su un telefono il dito serve a
   * SCORRERE la lista, e il riordino e' un gesto da mouse - dichiarato, non dimenticato.
   */
  protected grabAt(event: PointerEvent, role: string): void {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    const row = target?.closest('li[data-id]') as HTMLElement | null;
    const list = row?.closest('ol') as HTMLElement | null;
    if (!row || !list) return;
    const id = Number(row.dataset['id']);
    if (!Number.isFinite(id)) return;

    const startY = event.clientY;
    let dragging = false;
    const stopNative = (native: Event): void => native.preventDefault();
    document.addEventListener('selectstart', stopNative);
    document.addEventListener('dragstart', stopNative);

    const end = (moved: boolean): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('selectstart', stopNative);
      document.removeEventListener('dragstart', stopNative);
      const gap = this.dragGap();
      this.dragId.set(null);
      this.dragRole.set(null);
      this.dragGap.set(null);
      if (dragging && moved && gap != null) this.moveRow(role, list, id, gap);
    };

    const move = (moving: PointerEvent): void => {
      if (!dragging && Math.abs(moving.clientY - startY) < DRAG_THRESHOLD_PX) return;
      if (!dragging) {
        dragging = true;
        this.dragId.set(id);
        this.dragRole.set(role);
        // E la selezione che c'era PRIMA va via: e' quella che il browser proverebbe a trascinare.
        document.getSelection()?.removeAllRanges();
      }
      const boxes = rowsOf(list).map((one) => one.getBoundingClientRect());
      this.dragGap.set(rowGapAt(boxes, moving.clientY));
      this.edgeScroll(list, moving.clientY);
    };
    const up = (): void => end(true);
    const cancel = (): void => end(false);
    const onKey = (pressed: KeyboardEvent): void => {
      if (pressed.key === 'Escape') end(false);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', onKey);
  }

  /**
   * VICINO AL BORDO LA LISTA SCORRE, e qui scorre la LISTA e non la pagina.
   *
   * E' la differenza col gesto della tabella, ed e' il layout a imporla: la pagina non scorre affatto
   * (`h-[100dvh]`), quindi senza questo la meta' bassa di un blocco da 80 nomi non sarebbe raggiungibile
   * col dito. Un passo per `pointermove`, come la': la velocita' e' quella della mano, nessun timer da
   * fermare e nessuna animazione che continua dopo il rilascio.
   */
  private edgeScroll(list: HTMLElement, y: number): void {
    const box = list.getBoundingClientRect();
    const near = y < box.top + DRAG_EDGE_PX ? -1 : y > box.bottom - DRAG_EDGE_PX ? 1 : 0;
    if (near) list.scrollBy({ top: near * DRAG_SCROLL_STEP_PX, behavior: 'instant' });
  }

  /**
   * Il segno del gesto: sbiadita la riga in mano, una barra sul varco dove finirebbe.
   *
   * La barra e' un'OMBRA INTERNA e non un bordo, per la stessa ragione della tabella: un bordo aggiunge
   * due pixel all'altezza della riga e fa saltare di un passo tutte quelle sotto, cioe' muoverebbe la
   * lista mentre la stai puntando.
   */
  protected rowMark(role: string, id: number, index: number, of: number): string {
    if (this.dragRole() !== role) return '';
    const marks: string[] = [];
    if (this.dragId() === id) marks.push('opacity-40');
    const gap = this.dragGap();
    if (gap != null) {
      if (gap === index) marks.push('shadow-[inset_0_3px_0_0_var(--color-primary)]');
      else if (gap === of && index === of - 1) {
        marks.push('shadow-[inset_0_-3px_0_0_var(--color-primary)]');
      }
    }
    return marks.join(' ');
  }

  /**
   * Scrive il suo ordine dopo un rilascio: la sequenza e' quella A SCHERMO, letta dal DOM.
   *
   * Dal DOM e non da `blocks()` perche' la lista disegnata e' la sola verita' su cosa ha in mano - la
   * stessa ragione per cui la tabella legge la posizione delle intestazioni invece di fidarsi di una
   * somma di larghezze.
   */
  private moveRow(role: string, list: HTMLElement, id: number, gap: number): void {
    const shown = rowsOf(list).map((one) => Number(one.dataset['id']));
    const moved = withRowMoved(this.priorityHere().get(role) ?? [], shown, id, gap);
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

/** Le righe dei GIOCATORI di una lista, in ordine. Il confine e' `data-id`: solo loro ne hanno uno. */
function rowsOf(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>('li[data-id]'));
}
