import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { EngineSheetEntry } from '../../core/bundle';
import { LEAGUE_ORDER } from '../../core/clubs-store';
import { ClubOption, GlobalOptions, LeagueSettings } from '../../core/global-options';
import { ClassicRole, competitionLabel } from '../../core/players-store';
import { ValuationStore } from '../../core/valuation-store';
import { ClubCrest } from '../club-crest/club-crest';
import { RoleBadge } from '../role-badge/role-badge';

/** Le squadre di un campionato, come si scelgono: un gruppo per campionato, nell'ordine del config. */
interface ClubGroup {
  league: string | null;
  label: string;
  clubs: ClubOption[];
}

/**
 * LE OPZIONI GLOBALI: il regolamento della lega e le squadre reali che non si comprano.
 *
 * Sta FUORI dall'outlet, come il viaggio nel tempo e per la stessa ragione: quello che dichiara vale per
 * ogni vista, quindi chi cambia pagina deve continuare a vederlo - e soprattutto a vedere che è ATTIVO.
 * Un filtro globale è invisibile per costruzione, ed è il difetto che questa app ha già deciso di non
 * avere: il bottone porta addosso quante squadre stanno fuori e quanti uomini nascondono.
 *
 * È UNA FINESTRA CON APPLICA E ANNULLA e non una serie di interruttori che scrivono subito, per un
 * motivo misurato e non estetico: escludere una squadra cambia il POOL, e le quattro letture a stelline
 * sono percentili su quel pool - si rifanno sullo strato per-partita. Un clic per squadra vorrebbe dire
 * un ricalcolo per squadra; una spunta su una copia non costa niente, e «annulla» annulla davvero.
 */
@Component({
  selector: 'ui-global-options',
  templateUrl: './global-options.html',
  imports: [
    ClubCrest,
    FormsModule,
    NzButtonModule,
    NzCheckboxModule,
    NzIconModule,
    NzInputModule,
    NzInputNumberModule,
    NzModalModule,
    NzRadioModule,
    NzSwitchModule,
    NzTabsModule,
    NzTooltipModule,
    RoleBadge,
  ],
})
export class GlobalOptionsPanel {
  private readonly options = inject(GlobalOptions);
  /**
   * Il catalogo delle squadre lo riempie chi legge il bundle, e su una pagina che non lo legge (il
   * pannello d'asta vive sulla sessione live) non ci sarebbe. Quindi il pannello CHIEDE i dati che gli
   * servono, invece di aprirsi vuoto: `load` è idempotente e le tabelle sono già in cache dove
   * qualcuno le ha lette.
   */
  private readonly valuation = inject(ValuationStore);

  protected readonly classicRoles: ClassicRole[] = ['P', 'D', 'C', 'A'];
  protected readonly crests = this.valuation.crests;

  protected readonly editing = signal(false);

  constructor() {
    /*
     * IL PANNELLO SI APRE ANCHE DA FUORI, e il servizio e' il solo canale.
     *
     * La pagina Strategia ha il suo bottone «Impostazioni lega» e chiama `GlobalOptions.open()`, che alza
     * `panelOpen`: senza questa lettura quel segnale non lo leggeva nessuno e il bottone non apriva niente
     * - due maniglie su una porta, e nessuna delle due apriva. Trovato dall'arnese e2e della pagina
     * (`hasModalHost` true con `containers` 0: la finestra c'e' nel DOM e nessun overlay nasce) e visto
     * dall'operatore lo stesso giorno, 27/08/2026.
     *
     * `close()` alla chiusura non e' pulizia ma la meta' che fa funzionare la seconda apertura: un signal
     * che resta `true` non cambia, quindi non farebbe scattare piu' niente.
     */
    effect(() => {
      // `untracked`: l'effetto deve dipendere SOLO da `panelOpen`. Senza, `openPanel()` legge la lega e
      // le esclusioni e l'effetto si iscrive anche a quelle, quindi si rieseguirebbe a ogni loro
      // cambiamento - e un effetto che riapre una finestra mentre la stai chiudendo e' una finestra che
      // non si chiude.
      if (this.options.panelOpen()) untracked(() => this.openPanel());
    });
  }

  /** La copia che si sta modificando: annullare deve poter annullare davvero. */
  protected readonly form = signal<LeagueSettings>(this.options.league());
  protected readonly draft = signal<Set<number>>(new Set());
  /** Trentasette squadre su euro non si scorrono a occhio: si cercano. */
  protected readonly search = signal('');

  /** Quello che il bottone deve dire senza aprire niente: che c'è un filtro, e quanto grande. */
  protected readonly excludedClubs = this.options.excludedClubs;
  protected readonly hidden = this.options.hidden;

  protected readonly excludedLabel = computed(() => {
    const clubs = this.excludedClubs();
    return clubs.length === 1 ? '1 squadra esclusa' : `${clubs.length} squadre escluse`;
  });

  protected readonly excludedHint = computed(() => {
    const clubs = this.excludedClubs();
    const hidden = this.hidden();
    if (!clubs.length) return '';
    return (
      `Fuori da ogni vista e da ogni conto: ${clubs.map((one) => one.name).join(', ')}. `
      + `Nasconde ${hidden.default} uomini del listone Serie A e ${hidden.euro} di EuroLeghe. `
      + 'Le colonne del motore - surplus, rimpiazzo, Fantapunti - restano quelle del foglio: le scrive '
      + 'il toolkit per una lega intera, e questa app non ha un motore per rifarle.'
    );
  });

  /** Quante squadre la finestra sta per escludere: il conto della COPIA, non di quello che è attivo. */
  protected readonly draftCount = computed(() => this.draft().size);

  /** Su quante: escludere tre squadre su venti e tre su centosei non è la stessa scelta. */
  protected readonly catalogueSize = computed(() => this.options.catalogue().length);

  /**
   * Le squadre da cui si sceglie, per campionato e nell'ordine in cui il config le elenca.
   *
   * Il campionato è quello del CLUB, dalla tabella `clubs` - mai la maggioranza dei suoi giocatori - e
   * uno di cui il bundle non lo sappia finisce in fondo sotto «campionato ignoto», non dentro un gruppo
   * per somiglianza.
   */
  protected readonly groups = computed<ClubGroup[]>(() => {
    const wanted = this.search().trim().toLowerCase();
    const byLeague = new Map<string | null, ClubOption[]>();
    for (const club of this.options.catalogue()) {
      if (wanted && !club.name.toLowerCase().includes(wanted)) continue;
      const group = byLeague.get(club.league);
      group ? group.push(club) : byLeague.set(club.league, [club]);
    }
    const rank = (league: string | null): number => {
      if (league == null) return LEAGUE_ORDER.length + 1;
      const at = LEAGUE_ORDER.indexOf(league);
      return at < 0 ? LEAGUE_ORDER.length : at;
    };
    return [...byLeague.entries()]
      .map(([league, clubs]) => ({
        league,
        label: league == null ? 'Campionato ignoto' : competitionLabel(league),
        clubs,
      }))
      .sort(
        (left, right) =>
          rank(left.league) - rank(right.league) || left.label.localeCompare(right.label, 'it'),
      );
  });

  /** Il foglio che la scelta (listone, gioco) implica: la finestra lo nomina PRIMA di applicarla. */
  protected readonly formSheet = computed<EngineSheetEntry | null>(() => {
    const { platform, game } = this.form();
    return this.valuation.sheets().find((one) => one.platform === platform && one.game === game)
      ?? null;
  });

  /** Cosa il bundle porta davvero, per dirlo quando la combinazione scelta non c'è. */
  protected readonly available = computed(() =>
    this.valuation
      .sheets()
      .map((one) => `${one.league} · ${one.game === 'mantra' ? 'Mantra' : 'Classic'}`)
      .join(' · '),
  );

  protected openPanel(): void {
    void this.valuation.load();
    this.form.set(structuredClone(this.options.league()));
    this.draft.set(new Set(this.options.excludedIds()));
    this.search.set('');
    this.editing.set(true);
  }

  protected apply(): void {
    this.options.league.set(this.form());
    this.options.excludedIds.set([...this.draft()]);
    this.editing.set(false);
    this.options.close();
  }

  protected cancel(): void {
    this.editing.set(false);
    this.options.close();
  }

  protected visible(open: boolean): void {
    if (!open) {
      this.editing.set(false);
      this.options.close();
    }
  }

  // ---------------------------------------------------------------- il regolamento

  protected patch(change: Partial<LeagueSettings>): void {
    this.form.update((one) => ({ ...one, ...change }));
  }

  /**
   * Un numero, con la guardia della casella SVUOTATA.
   *
   * `nz-input-number` manda `null` nell'istante in cui la si svuota per riscriverla, e quel null salvato
   * tornerebbe dentro ogni conto dopo un refresh (col budget nullo i crediti di ogni rivale leggono
   * `null - speso`, cioè negativo). Finché non arriva il numero nuovo vale l'ultimo buono.
   */
  protected patchNumber(key: 'budget' | 'teams' | 'rounds' | 'from' | 'to', value: number): void {
    if (!Number.isFinite(value)) return;
    this.patch({ [key]: value } as Partial<LeagueSettings>);
  }

  protected patchClassic(role: ClassicRole, value: number): void {
    if (!Number.isFinite(value)) return;
    this.form.update((one) => ({
      ...one,
      slots: { ...one.slots, classic: { ...one.slots.classic, [role]: value } },
    }));
  }

  protected patchMantra(which: 'por' | 'mov', value: number): void {
    if (!Number.isFinite(value)) return;
    this.form.update((one) => ({
      ...one,
      slots: { ...one.slots, mantra: { ...one.slots.mantra, [which]: value } },
    }));
  }

  /**
   * ALLINEA AL FOGLIO: copia squadre e slot da come il toolkit ha costruito la lista.
   *
   * Esiste perché il foglio è la sola cosa che sa contro quale zero il suo surplus è contato, ma non
   * scatta da sé: la composizione della rosa è una dichiarazione dell'operatore, e sovrascriverla in
   * silenzio sarebbe decidere al posto suo.
   */
  protected alignToSheet(): void {
    const sheet = this.formSheet();
    if (!sheet) return;
    const own = sheet.squad_slots;
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

  // ---------------------------------------------------------------- le squadre

  protected isExcluded(club: ClubOption): boolean {
    return this.draft().has(club.id);
  }

  protected toggle(club: ClubOption, excluded: boolean): void {
    this.draft.update((current) => {
      const next = new Set(current);
      excluded ? next.add(club.id) : next.delete(club.id);
      return next;
    });
  }

  /** Un campionato intero: su euro «gioco solo Serie A e Premier» è cinque clic e non trentasette. */
  protected toggleGroup(group: ClubGroup, excluded: boolean): void {
    this.draft.update((current) => {
      const next = new Set(current);
      for (const club of group.clubs) excluded ? next.add(club.id) : next.delete(club.id);
      return next;
    });
  }

  protected groupExcluded(group: ClubGroup): boolean {
    const draft = this.draft();
    return group.clubs.length > 0 && group.clubs.every((club) => draft.has(club.id));
  }

  protected clearDraft(): void {
    this.draft.set(new Set());
  }
}
