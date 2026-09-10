import { Component, computed, inject, signal } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { Bundle } from '../../core/bundle';
import { UNAVAILABLE_FRESH_DAYS, PlayerStatus } from '../../core/player-status';
import { TimeTravel } from '../../core/time-travel';
import { itDate } from '../../core/tooltip';

/**
 * SONO AGGIORNATI I DATI? — sempre a schermo, su ogni pagina.
 *
 * L'operatore l'ha chiesto il 03/09/2026 («ho bisogno di sapere sempre nell'interfaccia se i dati sono
 * aggiornati ad oggi in maniera evidente») il giorno stesso in cui una domanda sua - «come mai non
 * abbiamo nessun infortunio di serie a che risale a oggi o ieri?» - è costata cinque interrogazioni al
 * database e un elenco di file per scoprire che la risposta era «non abbiamo più guardato». Quel fatto
 * viveva fuori dallo schermo; adesso è la prima cosa che si vede.
 *
 * DUE DATE, E SONO DUE DOMANDE DIVERSE, quindi si mostrano tutt'e due e nessuna si assume:
 *   * quando è stato SCRITTO il pacchetto (`manifest.generated_at`) - da lì vengono i numeri del motore;
 *   * quando abbiamo GUARDATO la fonte veloce (l'ultima lettura degli indisponibili) - da lì vengono gli
 *     allarmi, ed è la data che cambia ogni giorno mentre l'altra cambia a ogni export.
 *
 * IL COLORE DICE LA CONSEGUENZA E NON L'ETÀ. Rosso quando la lettura veloce ha passato
 * `UNAVAILABLE_FRESH_DAYS`, perché oltre quella soglia i marchi non compaiono più: uno schermo senza
 * allarmi si legge come «non c'è nessuno fuori», che è la bugia più cara che questa app possa dire. È
 * l'unico altro posto in cui questa app usa il rosso fuori dai marchi, e per la stessa ragione.
 */
@Component({
  selector: 'ui-data-freshness',
  templateUrl: './data-freshness.html',
  imports: [NzIconModule, NzTooltipModule],
  host: { class: 'contents' },
})
export class DataFreshness {
  private readonly status = inject(PlayerStatus);
  /** Il giorno contro cui si legge: l'orologio, o la data scelta se si sta viaggiando nel tempo. */
  private readonly travel = inject(TimeTravel);
  private readonly bundle = inject(Bundle);

  /**
   * L'AGGIORNAMENTO NOTTURNO E' SPENTO? (`config/nightly.json`, dichiarato dall'operatore).
   *
   * Serve a distinguere DUE CAUSE dello stesso schermo: dati di tre giorni fa con l'interruttore
   * acceso sono un guasto da guardare, con l'interruttore spento sono una sua decisione. Senza questa
   * riga la pastiglia dice «vecchi» in tutt'e due i casi e l'operatore va a cercare un guasto che ha
   * causato lui.
   *
   * ASSENTE VUOL DIRE ACCESO, come lo leggono il runner e il pannello: un pacchetto che non porta il
   * file (o una macchina che non ha mai dichiarato niente) non e' un aggiornamento spento.
   */
  private readonly nightlyOff = signal(false);
  private readonly nightlyOn = signal<string | null>(null);

  constructor() {
    void this.bundle.nightly().then((declared) => {
      this.nightlyOff.set(declared?.enabled === false);
      this.nightlyOn.set(declared?.decided_on ?? null);
    });
  }

  protected readonly bundleOn = computed(() => this.status.readAt()?.slice(0, 10) ?? null);
  protected readonly pressOn = this.status.pressReadOn;
  protected readonly stale = this.status.pressStale;

  /** Quanti giorni ha il pacchetto. Null finché il manifest non è arrivato. */
  protected readonly bundleAge = computed(() => {
    const on = this.bundleOn();
    return on ? days(on, this.travel.today()) : null;
  });

  /** «oggi», «ieri», «3 giorni fa»: la forma in cui un uomo legge un'età, non una data ISO. */
  protected readonly label = computed(() => {
    const age = this.status.pressAge();
    if (age == null) return 'mai letti';
    return ageWord(age);
  });

  protected readonly tone = computed(() =>
    this.stale()
      ? 'bg-danger/20 text-danger'
      : this.fresh()
        ? 'text-muted'
        : 'bg-warning/20 text-warning',
  );

  /** Tutto di oggi: nessun colore, perché «va bene» non è una notizia. */
  protected readonly fresh = computed(
    () => this.status.pressAge() === 0 && (this.bundleAge() ?? 99) === 0,
  );

  /** Spento per dichiarazione, e da quando: due letture separate perche' sono due frasi. */
  protected readonly off = computed(() => this.nightlyOff());
  protected readonly offSince = computed(() => this.nightlyOn());

  protected readonly icon = computed(() =>
    this.stale() ? 'alert' : this.fresh() ? 'check-circle' : 'clock-circle',
  );

  protected readonly hint = computed(() => {
    const bundle = this.bundleOn();
    const press = this.pressOn();
    const lines = [
      bundle
        ? `Pacchetto del motore scritto il ${itDate(bundle)} (${ageWord(this.bundleAge() ?? 0)}): da qui vengono fantamedia, presenze e surplus.`
        : 'Pacchetto del motore: non ancora caricato.',
      press
        ? `Indisponibili letti il ${itDate(press)} (${this.label()}): da qui vengono gli allarmi «oggi non gioca».`
        : 'Indisponibili: questo pacchetto non porta la tabella, quindi nessun allarme può comparire.',
    ];
    // L'INTERRUTTORE PRIMA DELLA SCADENZA, perche' se e' spento e' la CAUSA di quello che c'e' sopra:
    // una riga che spiega e non un'altra cosa da sapere. Quando e' acceso non si dice niente - «va
    // bene» non e' una notizia, che e' la regola su cui e' costruita tutta questa pastiglia.
    if (this.off()) {
      lines.push(
        `Aggiornamento notturno SPENTO${this.offSince() ? ` dal ${itDate(this.offSince()!)}` : ''}: ` +
          `nessuno rilegge le fonti alle 03:00, quindi da qui in poi queste date invecchiano di un ` +
          `giorno al giorno. Si riaccende dal pannello del toolkit.`,
      );
    }
    if (this.stale()) {
      lines.push(
        `LETTURA SCADUTA: oltre ${UNAVAILABLE_FRESH_DAYS} giorni i marchi si spengono da soli, quindi ` +
          `«nessuno segnalato» qui vuol dire «non abbiamo guardato» e non «stanno tutti bene». ` +
          `Rilancia l'aggiornamento del toolkit.`,
      );
    }
    return lines.join('\n');
  });
}

/** Giorni interi fra due date ISO. */
function days(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function ageWord(age: number): string {
  if (age <= 0) return 'oggi';
  if (age === 1) return 'ieri';
  return `${age} giorni fa`;
}
