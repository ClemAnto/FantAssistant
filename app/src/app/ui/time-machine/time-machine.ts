import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDatePickerModule } from 'ng-zorro-antd/date-picker';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { TimeTravel } from '../../core/time-travel';

/**
 * Il box di DEBUG che sposta il giorno in cui l'app crede di trovarsi.
 *
 * Sta in BASSO A DESTRA e fisso: in alto ci sono l'intestazione e i filtri, e una barra in cima
 * spingerebbe giù la tabella - che è la cosa per cui la pagina esiste (il pannello del toolkit ha già
 * pagato una lezione sull'altezza spesa in bordi invece che in contenuto). Fisso e non dentro una pagina
 * perché il viaggio vale per tutta l'app, e uno che cambia vista deve continuare a vedere che è attivo.
 *
 * L'ONESTÀ È METÀ DELLA FUNZIONE, e per questo il box scrive sempre che cosa NON è retrodatato invece di
 * lasciarlo scoprire: le colonne del foglio (P, FM att., MV att., Surplus, Fantapunti, SpM/dVM) e i
 * campetti li scrive il toolkit per un giorno preciso, e rifarli qui vorrebbe dire rimettere il motore
 * nell'app. Un viaggio nel tempo che ne retrodata metà in silenzio è peggio di nessun viaggio nel tempo.
 *
 * Quando non si viaggia il box è una pillola grigia e muta: non deve rubare spazio a una pagina che
 * l'operatore usa a un tavolo vero.
 */
@Component({
  selector: 'ui-time-machine',
  templateUrl: './time-machine.html',
  imports: [FormsModule, NzButtonModule, NzDatePickerModule, NzSpinModule, NzTooltipModule],
})
export class TimeMachine {
  private readonly travel = inject(TimeTravel);

  protected readonly travelling = this.travel.travelling;
  protected readonly busy = this.travel.busy;
  protected readonly today = this.travel.today;

  /** Il picker parla in `Date`, il resto dell'app in ISO: la conversione sta qui e in nessun altro posto. */
  protected readonly picked = computed(() =>
    this.travelling() ? new Date(`${this.today()}T00:00:00`) : null);

  /** Domani non esiste: una data futura non è un viaggio nel tempo, è oggi con un'etichetta sbagliata. */
  protected readonly future = (date: Date): boolean =>
    date.toISOString().slice(0, 10) > this.travel.realToday;

  protected travelTo(date: Date | null): void {
    this.travel.travelTo(date ? this.iso(date) : null);
  }

  protected reset(): void {
    this.travel.travelTo(null);
  }

  /** ISO LOCALE: `toISOString` passa da UTC e su una data scelta a mezzanotte torna il giorno prima. */
  private iso(date: Date): string {
    const pad = (one: number) => String(one).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  protected readonly recomputed =
    'Ricalcolati alla data: le cinque letture (Overall, Voti, Bonus, Presenze, Costanza), il trend delle '
    + 'ultime dieci, gli infortuni e tutti i marchi accanto al nome, gli screen e i ruoli granulari. Una '
    + 'partita giocata dopo quel giorno non è ancora stata giocata, uno stop che finisce dopo è ancora '
    + 'APERTO, e una stagione non ancora conclusa non ha un totale da leggere.';

  protected readonly frozen =
    'NON retrodatati: le colonne del foglio del motore (P, FM att., MV att., Surplus, Fantapunti, SpM e '
    + 'dVM), i campetti e il listone stesso (chi è quotato, l\'FVM). Li scrive il toolkit per un giorno '
    + 'preciso - `snapshot --date` - e ricalcolarli qui vorrebbe dire rifare il motore dentro l\'app. Per '
    + 'un viaggio fedele anche su quelli serve un bundle costruito per quella data.';
}
