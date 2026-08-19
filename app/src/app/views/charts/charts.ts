import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { bandsOf } from '../../core/overall-bands';
import { PlayerRatingsStore } from '../../core/player-ratings-store';
import { CLASSIC_ROLES, ClassicRole, Platform } from '../../core/players-store';
import { ValuationStore } from '../../core/valuation-store';
import { bindQuery } from '../../core/view-state';
import { piBand, piHistogram } from '../../core/projection';
import { Bar, BarChart } from '../../ui/bar-chart/bar-chart';
import { PieChart, PieSlice } from '../../ui/pie-chart/pie-chart';
import { APP_VERSION } from '../../version';

const ROLE_LABEL: Record<ClassicRole, string> = {
  P: 'Portieri',
  D: 'Difensori',
  C: 'Centrocampisti',
  A: 'Attaccanti',
};

/**
 * I GRAFICI: come è fatto un listone, invece di chi c'è dentro.
 *
 * Le altre tre pagine sono LISTE di uomini; questa è l'insieme. Per ora una torta sola - quanti
 * calciatori stanno sopra 90, 75, 50, 25 di Overall - e la pagina è costruita perché la seconda costi
 * il conto e non il disegno (`ui-pie` non sa niente di calcio).
 *
 * I NUMERI SONO QUELLI DELLE ALTRE PAGINE e non un secondo conto: `ValuationStore.valuations` è la
 * definizione unica che leggono sia la tabella dei Calciatori sia quella delle Squadre, quindi un uomo
 * non può leggersi in un modo qui e in un altro là - che è il difetto che questo progetto paga da
 * sempre. La POOL invece è la scelta di questa pagina: l'Overall è un percentile DENTRO il listone
 * intero (`rank99`), quindi il rango di un uomo non cambia mai col filtro - cambia solo chi viene
 * contato, che è esattamente la domanda («quanti ne ha il Napoli sopra 90»).
 */
@Component({
  selector: 'app-charts',
  templateUrl: './charts.html',
  imports: [
    FormsModule,
    NzAlertModule,
    NzButtonModule,
    NzIconModule,
    NzRadioModule,
    NzSelectModule,
    NzSpinModule,
    NzTooltipModule,
    BarChart,
    PieChart,
    RouterLink,
  ],
  host: { class: 'view-host' },
})
export class Charts {
  protected readonly store = inject(ValuationStore);
  /** Solo per sapere SE le letture ci sono: i numeri arrivano tutti da `store.valuations`. */
  private readonly ratings = inject(PlayerRatingsStore);
  protected readonly appVersion = APP_VERSION;
  protected readonly roles = CLASSIC_ROLES;
  protected readonly roleLabel = ROLE_LABEL;

  protected readonly platform = signal<Platform>('default');
  protected readonly role = signal<ClassicRole | null>(null);
  protected readonly club = signal<string | null>(null);

  /**
   * Le squadre del listone scelto, dal roster e non da `PlayersStore`.
   *
   * L'altro store porterebbe dentro il layer per partita, che è il pezzo più pesante del bundle, per
   * ricavare una lista di nomi che il perimetro ha già.
   */
  protected readonly clubs = computed(() =>
    [...new Set((this.store.rosters().get(this.platform()) ?? []).map((one) => one.club))]
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right)),
  );

  /** I quotati che i filtri tengono, valutati con la stessa funzione delle altre due viste. */
  protected readonly pool = computed(() => {
    const role = this.role();
    const club = this.club();
    const players = (this.store.rosters().get(this.platform()) ?? []).filter(
      (one) => (!role || one.role === role) && (!club || one.club === club),
    );
    return this.store.valuations(this.platform(), players);
  });

  protected readonly bands = computed(() => bandsOf(this.pool().map((one) => one.rating?.overall.score ?? null)));

  protected readonly slices = computed<PieSlice[]>(() =>
    this.bands().map((band) => ({
      label: band.label,
      value: band.count,
      fill: band.fill,
      hint: band.above == null ? 'Senza Overall: il motore non gli prevede presenze' : `Overall ${band.label}`,
    })),
  );

  /**
   * LA DISTRIBUZIONE DI Fπ, a decine, e non una seconda torta.
   *
   * Sono due domande diverse e vanno disegnate diversamente: la torta dice «come si divide il listone»,
   * l'istogramma dice «che FORMA ha», ed è la seconda che giudica una scala. Un ammasso a un'estremità è
   * una scala che non sta dicendo niente, e in una torta non si vede.
   *
   * IL CONTO STA IN `core/projection` e qui ci sono solo i colori. Prima era una `computed` che contava
   * e SCRIVEVA il signal dei mancanti: Angular vieta di scrivere un signal dentro una `computed`, quindi
   * `piBars()` sollevava un'eccezione ogni volta che il template la leggeva e il grafico non si vedeva
   * affatto. Due letture dello STESSO conto, e nessuna scrittura.
   */
  private readonly piCounts = computed(() =>
    piHistogram(this.pool().map((one) => one.rating?.pi.score)),
  );

  /**
   * Le bande sotto le barre sono le parole dell'operatore (`PI_BANDS`), non un'invenzione della vista:
   * 0 non gioca, sotto 10 inutile, sotto 30 scarso, sotto 50 riserva, poi titolare.
   */
  protected readonly piBars = computed<Bar[]>(() =>
    this.piCounts().buckets.map((count, at) => {
      const low = at * 10;
      return {
        label: `${low}`,
        value: count,
        // Il colore segue la BANDA e non la posizione: due decine che vogliono dire la stessa cosa
        // devono avere lo stesso colore, o la figura racconta una gradazione che non esiste.
        fill: at >= 5 ? 'var(--color-success)'
          : at >= 3 ? 'var(--color-primary)'
            : at >= 1 ? 'var(--color-warning)' : 'var(--color-danger)',
        // La decina prende il nome della banda che la occupa, tranne la PRIMA: 0 «non gioca» e 1-9
        // «inutile» sono due frasi diverse, e chiamarla solo «non gioca» sarebbe falso per chi ci sta.
        hint: `Fπ ${low}-${low + 9} · ${at === 0 ? 'non gioca o inutile' : piBand(low + 1) ?? ''}`,
      };
    }),
  );

  /** Quanti restano senza Fπ: una figura che non lo dice sta contando una pool che non è quella. */
  protected readonly piMissing = computed(() => this.piCounts().missing);

  /** Quanti sono e quanti di loro un Overall non ce l'hanno: ogni figura dice su quanti è calcolata. */
  protected readonly counted = computed(() => this.pool().length);
  protected readonly unrated = computed(
    () => this.bands().find((band) => band.key === 'none')?.count ?? 0,
  );

  /**
   * Le letture atterrano DOPO il resto del bundle (`ratings.ensure` parte quando lo store è già
   * `ready`), quindi finché non ci sono la torta sarebbe tutta «senza Overall»: una risposta sbagliata
   * che sembra una risposta. Si aspetta, e si dice che si sta aspettando.
   *
   * Lo si CHIEDE allo store invece di dedurlo dalle righe: «nessuno ha un Overall» e «gli Overall non
   * sono ancora calcolati» si assomigliano su una pool piccola, e un filtro che tenesse solo uomini che
   * il motore non prezza resterebbe a girare per sempre su un dato che è già arrivato.
   */
  protected readonly rated = this.ratings.ready;

  constructor() {
    void this.store.load();

    /*
     * I filtri nell'indirizzo, con gli stessi nomi della vista Calciatori: un link che si condivide
     * riapre la stessa torta, e due pagine non chiamano `?ruolo=` in due modi diversi.
     */
    bindQuery(
      [
        {
          param: 'listone',
          read: () => (this.platform() === 'default' ? null : this.platform()),
          apply: (raw) => {
            const platform: Platform = raw === 'euro' ? 'euro' : 'default';
            if (platform !== this.platform()) this.choosePlatform(platform);
          },
        },
        {
          param: 'ruolo',
          read: () => this.role(),
          apply: (raw) =>
            this.role.set(CLASSIC_ROLES.includes(raw as ClassicRole) ? (raw as ClassicRole) : null),
        },
        {
          param: 'squadra',
          read: () => this.club(),
          apply: (raw) => this.club.set(raw && this.clubs().includes(raw) ? raw : null),
        },
      ],
      computed(() => this.store.status() === 'ready'),
    );
  }

  /** L'altro listone porta con sé la squadra: le due liste si somigliano poco e nessun nome è comune. */
  protected choosePlatform(platform: Platform): void {
    this.platform.set(platform);
    this.club.set(null);
  }
}
