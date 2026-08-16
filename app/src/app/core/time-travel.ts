import { Injectable, computed, signal } from '@angular/core';

/**
 * IL GIORNO IN CUI L'APP CREDE DI TROVARSI - un attrezzo di DEBUG, e la sua onestà è metà del valore.
 *
 * A che serve: guardare la tabella com'era a una data passata, per capire che cosa il tavolo avrebbe
 * visto quel giorno. Tutto quello che porta una data nel bundle viene tagliato lì, e quello che accade
 * dopo torna a essere IGNOTO - che in questo progetto non vuol mai dire zero.
 *
 * CHE COSA VIENE DAVVERO RETRODATATO, perché un viaggio nel tempo che ne retrodata metà è peggio di
 * nessun viaggio nel tempo (una lista i cui numeri descrivono un'altra lista è il difetto che questo
 * repo ha già pagato più volte):
 *
 *   RETRODATATO - lo strato per-partita (`external_match_stats`, 110.961 righe con `match_date`, e i
 *   voti che ci si agganciano), gli infortuni (spell datati: uno che comincia dopo non esiste, uno che
 *   finisce dopo è ancora APERTO quel giorno), i ruoli granulari (`valid_from`), le stagioni CHIUSE dopo
 *   la data, e tutto quello che l'app calcola da queste cose: le cinque letture, il trend delle ultime
 *   dieci, i marchi e gli screen.
 *
 *   NON RETRODATABILE - le colonne del FOGLIO (P, FM att., MV att., Surplus, Fantapunti, SpM/dVM) e i
 *   campetti. Le scrive il toolkit per un giorno preciso (`snapshot --date`), e ricalcolarle qui
 *   vorrebbe dire rifare il motore nell'app: una seconda risposta a una domanda che il toolkit già dà.
 *   Il listone stesso (chi è quotato, l'FVM) è l'ultima lettura e non ha storia nel bundle.
 *   Il box lo DICHIARA invece di lasciarlo scoprire.
 *
 * NON SI RICORDA fra un refresh e l'altro, ed è deliberato: una data di debug appiccicata in silenzio
 * farebbe leggere numeri di novembre come numeri di oggi il giorno che uno se ne dimentica.
 */
/**
 * Una data per cui il TOOLKIT ha costruito il motore: fogli e campetti di quel giorno.
 *
 * Con un pacchetto il viaggio è completo - surplus, Fantapunti, campetti compresi - perché quei numeri
 * li ha scritti `snapshot --date`, cioè lo stesso codice con cui il gate replica le sue finestre. Senza,
 * resta il viaggio parziale su ciò che nel bundle è datato, e il box lo dichiara.
 */
export interface TimePack {
  date: string;
  target_season: string;
  input_season: string | null;
  /** Quale finestra di mercato ha appena chiuso: «estiva» o «invernale». */
  window?: string;
  leagues: number;
  path: string;
}

@Injectable({ providedIn: 'root' })
export class TimeTravel {
  /** Il giorno vero, letto una volta: è anche il punto di ritorno. */
  readonly realToday = new Date().toISOString().slice(0, 10);

  /**
   * Le date che il bundle porta col motore già costruito. Le riempie chi legge il manifest.
   *
   * Poche e scelte: i due giorni per stagione in cui la rosa è quella vera - appena chiuso il mercato
   * estivo e appena chiuso l'invernale - sulle ultime due stagioni. Una data al giorno costerebbe una
   * corsa di `snapshot` per lega ciascuna (~75 s l'una) e non direbbe niente di più.
   */
  readonly packs = signal<TimePack[]>([]);

  /** Il pacchetto della data scelta, se c'è: allora il viaggio è completo e non parziale. */
  readonly pack = computed(() =>
    this.packs().find((one) => one.date === this.chosen()) ?? null);

  private readonly chosen = signal<string | null>(null);

  /** La data in cui l'app crede di trovarsi: quella scelta, o oggi. */
  readonly today = computed(() => this.chosen() ?? this.realToday);

  /** Se stiamo viaggiando. Quando è falso nessuna parte dell'app deve comportarsi diversamente. */
  readonly travelling = computed(() => this.chosen() != null);

  /** Chi sta ricalcolando, così il box può mostrare il loader invece di sembrare rotto. */
  readonly busy = signal(false);

  /** Una data futura non è un viaggio nel tempo: è la stessa cosa di oggi con un'etichetta sbagliata. */
  travelTo(date: string | null): void {
    if (date && date >= this.realToday) {
      this.chosen.set(null);
      return;
    }
    this.chosen.set(date);
  }

  /** Che cosa il viaggio in corso riesce a retrodatare: tutto, o solo quello che nel bundle è datato. */
  readonly fidelity = computed<'none' | 'partial' | 'full'>(() =>
    !this.travelling() ? 'none' : this.pack() ? 'full' : 'partial');

  /**
   * Se una data è dentro il tempo che l'app riconosce. Vuoto resta vuoto: «ignoto», mai «prima».
   *
   * Una riga senza data non si taglia - non sapremmo di che giorno è - e questo va detto dove capita
   * piuttosto che nascosto dentro un `false`.
   */
  knows(date: string | null | undefined): boolean {
    return !date || date <= this.today();
  }
}
