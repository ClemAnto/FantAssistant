import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { TimeTravel } from '../../core/time-travel';

const MONTH: Record<string, string> = {
  '01': 'gennaio', '02': 'febbraio', '03': 'marzo', '04': 'aprile', '05': 'maggio', '06': 'giugno',
  '07': 'luglio', '08': 'agosto', '09': 'settembre', '10': 'ottobre', '11': 'novembre', '12': 'dicembre',
};

/**
 * Il box di DEBUG che sposta il giorno in cui l'app crede di trovarsi.
 *
 * Sta in BASSO A DESTRA e fisso: in alto ci sono l'intestazione e i filtri, e una barra in cima
 * spingerebbe giù la tabella - che è la cosa per cui la pagina esiste. Fisso e non dentro una pagina
 * perché il viaggio vale per tutta l'app, e chi cambia vista deve continuare a vedere che è attivo.
 *
 * LE DATE SONO POCHE E SCELTE (decisione dell'operatore, 16/08/2026), e non un calendario libero: per
 * ognuna il toolkit ha costruito il MOTORE di quel giorno - fogli, surplus, Fantapunti, campetti - con
 * `snapshot --date`, cioè lo stesso codice con cui il gate replica le sue finestre. Sono i due giorni per
 * stagione in cui la rosa è quella vera: appena chiuso il mercato estivo e appena chiuso l'invernale,
 * sulle ultime due stagioni. Una data qualunque costerebbe una corsa del toolkit per lega e mostrerebbe
 * il motore di oggi sotto una data di ieri, che è la cosa che questo box esiste per non fare.
 *
 * Resta comunque scritto che cosa NESSUNO può retrodatare - le probabili, il ruolo granulare, la scadenza
 * di contratto - perché sono istantanee che al tempo non tornano, e un pacchetto che tacesse si farebbe
 * leggere come una fotografia perfetta.
 */
@Component({
  selector: 'ui-time-machine',
  templateUrl: './time-machine.html',
  imports: [FormsModule, NzButtonModule, NzSelectModule, NzSpinModule, NzTooltipModule],
})
export class TimeMachine {
  private readonly travel = inject(TimeTravel);

  protected readonly travelling = this.travel.travelling;
  protected readonly busy = this.travel.busy;
  protected readonly today = this.travel.today;
  protected readonly fidelity = this.travel.fidelity;

  /** Le date offerte, con la frase che dice PERCHÉ è quella: «dopo il mercato estivo». */
  protected readonly options = computed(() =>
    this.travel.packs().map((pack) => ({
      value: pack.date,
      label: `${MONTH[pack.date.slice(5, 7)]} ${pack.date.slice(0, 4)}`
        + (pack.window ? ` · dopo il mercato ${pack.window === 'estiva' ? 'estivo' : 'invernale'}` : ''),
      season: pack.target_season,
    })));

  protected readonly chosen = computed(() => (this.travelling() ? this.today() : null));

  /** La stagione che si sta guardando: cambia col pacchetto, e cambiare stagione cambia il LISTONE. */
  protected readonly season = computed(() => this.travel.pack()?.target_season ?? null);

  protected travelTo(date: string | null): void {
    this.travel.travelTo(date);
  }

  protected readonly recomputed =
    'Ricalcolati alla data: le cinque letture, il trend delle ultime dieci, gli infortuni e i marchi '
    + 'accanto al nome, gli screen, i ruoli granulari - e con il pacchetto anche il MOTORE: P, FM att., '
    + 'MV att., Surplus, Fantapunti, SpM/dVM e i campetti, costruiti dal toolkit a quel giorno.';

  protected readonly frozen =
    'Nemmeno il toolkit può retrodatare tre cose, perché sono istantanee che nessuno ha registrato allora: '
    + 'le PROBABILI FORMAZIONI di quel giorno, il RUOLO GRANULARE (il provider ignora la stagione richiesta '
    + 'e serve i codici di oggi) e la SCADENZA DI CONTRATTO, che sta solo sulla pagina rosa di oggi. E una '
    + 'contaminazione a favore del modello, dichiarata dal gate: trasferimenti, arrivi e rose sono derivati '
    + 'oggi, quindi la board conosce un mercato che quel giorno non era ancora chiuso.';

  protected readonly partial =
    'Per questa data il bundle non porta il motore di allora: sono retrodatate le letture, il trend e i '
    + 'marchi, mentre le colonne del foglio e i campetti restano quelli di oggi. Si costruisce con '
    + '`python -m euroleghe_ingest timepack`.';
}
