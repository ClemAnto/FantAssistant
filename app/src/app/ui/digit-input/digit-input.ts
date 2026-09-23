import { Component, computed, input, model } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

/**
 * UNA CIFRA PER COLONNA, con le freccette sopra e sotto, e un tastino che azzera.
 *
 * Sua richiesta (23/09/2026): «miglioriamo il controller per inserire la cifra: metti tre cifre separate
 * con freccette sopra e sotto per modificare migliaia, decine e unita' singolarmente, inoltre metti un
 * tastino per resettare». Nasce sulla riga del LOTTO, che e' l'unica cosa che si tocca durante un'asta:
 * li' il prezzo sale a gradini (25 -> 30 -> 35) e una casella di testo obbliga a selezionare, cancellare
 * e riscrivere un numero mentre il tavolo rilancia.
 *
 * QUANTE COLONNE LO DECIDE IL TETTO e non una costante: `String(max).length`. Su una lega da 1000 crediti
 * sono QUATTRO e non tre, ed e' la sola forma che non mente - tre colonne si fermerebbero a 999, cioe'
 * un tetto scelto da noi su un budget che ne dichiara un altro. Su una lega da 500 ne bastano tre, che e'
 * il numero della sua frase: la frase e' vera per una taglia di lega e questa regola lo e' per tutte.
 *
 * LA FRECCETTA MUOVE IL SUO POSTO E BASTA, e il riporto e' aritmetica e non una sorpresa: +10 su 95 fa
 * 105, quindi le centinaia cambiano perche' e' cosi' che funziona un numero. Quello che NON si fa e'
 * avvolgere la cifra su se stessa (95 -> 05): sarebbe un controllo che cambia il numero in un modo che
 * nessuno si aspetta, e su un rilancio si tradurrebbe in un'offerta sbagliata di novanta crediti.
 *
 * E UNA FRECCETTA CHE NON PUO' FARE NIENTE E' SPENTA invece di non fare niente: portare il totale sopra
 * il tetto o sotto zero e' l'unico modo in cui un passo puo' fallire, e un bottone che si preme senza
 * effetto e' indistinguibile da un bottone rotto.
 *
 * SI PUO' ANCHE SCRIVERE, ed e' la meta' che la richiesta non nomina e che toglierla avrebbe fatto
 * rimpiangere: per arrivare a 137 da zero servirebbero undici click. Ogni cifra e' un campo da un
 * carattere e quello che si batte SOSTITUISCE quel posto; il fuoco NON avanza da se', perche' un numero
 * si legge allineato a destra e delle caselle per posto non lo sono - battere «45» partendo da sinistra
 * scriverebbe 4500. Il tabulatore passa alla colonna dopo quando e' quello che si vuole.
 */
@Component({
  selector: 'ui-digit-input',
  templateUrl: './digit-input.html',
  imports: [NzIconModule, NzTooltipModule],
  host: { class: 'inline-flex' },
})
export class DigitInput {
  readonly value = model(0);
  /** Il massimo che il numero puo' raggiungere: decide il tetto E quante colonne si disegnano. */
  readonly max = input(999);
  /** Cosa il controllo sta contando, per le frasi dei bottoni: «il prezzo», «l'offerta». */
  readonly what = input('il valore');

  /**
   * I posti, dal piu' pesante al piu' leggero: 1000, 100, 10, 1 su una lega da mille.
   *
   * Almeno uno, perche' `repeat(0)` non e' un controllo: un tetto a zero e' una lega senza crediti, e
   * li' si disegna comunque una colonna che vale sempre zero invece di una riga vuota.
   */
  protected readonly places = computed(() => {
    const digits = Math.max(1, String(Math.max(0, Math.trunc(this.max()))).length);
    return Array.from({ length: digits }, (_, at) => 10 ** (digits - 1 - at));
  });

  /** La cifra che sta in quel posto, del valore di adesso. */
  protected digit(place: number): number {
    return Math.floor(this.clamped() / place) % 10;
  }

  /** Il valore, sempre dentro i suoi estremi: e' l'unica lettura, cosi' le cifre e il totale concordano. */
  private readonly clamped = computed(() => this.fit(this.value()));

  protected step(place: number, by: 1 | -1): void {
    this.value.set(this.fit(this.clamped() + place * by));
  }

  /** Vero quando quella freccetta porterebbe fuori dai due estremi: il bottone si spegne e lo dice. */
  protected blocked(place: number, by: 1 | -1): boolean {
    const next = this.clamped() + place * by;
    return next < 0 || next > this.top();
  }

  /**
   * IL TASTINO CHE AZZERA (sua richiesta). Zero e non «il valore di prima»: un'asta ricomincia da zero a
   * ogni lotto, e un annulla che riporta a una cifra vecchia rimetterebbe in campo il prezzo del nome
   * precedente - che e' esattamente il numero da cui ci si vuole liberare.
   */
  protected reset(): void {
    this.value.set(0);
  }

  /**
   * Una cifra battuta SOSTITUISCE il suo posto, e una che non ci sta viene RIFIUTATA.
   *
   * Si legge l'ultimo carattere e non il campo intero: il campo tiene sempre una cifra sola, quindi
   * quello che il browser ci mette dentro dopo una battuta e' «vecchia + nuova» finche' non lo si
   * riscrive. Un carattere che non e' una cifra non muove niente e la casella torna a mostrare il posto.
   *
   * IL RIFIUTO INVECE DELLA LIMATURA, ed e' un difetto che il banco ha trovato subito: con la limatura,
   * battere `4` sulle migliaia di un tetto da 1000 dava 4000 e quindi **1000**, cioe' il controllo
   * rispondeva col massimo a una cifra che non aveva chiesto nessuno - e su un rilancio quella e'
   * un'offerta da mille crediti. Rifiutare e' anche cio' che fanno gia' le freccette, che a quel punto
   * sono spente: un controllo solo, due gesti, una regola.
   *
   * E NESSUN AVANZAMENTO AUTOMATICO del fuoco, che era l'altra meta' dello stesso difetto. Con quattro
   * colonne uno batte «45» aspettandosi 45, mentre il fuoco che avanza da sinistra scrive 4500: un
   * numero si legge ALLINEATO A DESTRA e delle caselle per posto non lo sono. Il tabulatore passa alla
   * colonna dopo quando e' quello che si vuole, e lo si e' chiesto.
   */
  protected typed(place: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const last = input.value.slice(-1);
    const digit = Number(last);
    if (last && Number.isInteger(digit)) {
      const next = this.clamped() + (digit - this.digit(place)) * place;
      if (next >= 0 && next <= this.top()) this.value.set(next);
    }
    // La casella rimostra SEMPRE la cifra del posto: senza, un valore rifiutato resterebbe scritto li' e
    // il controllo direbbe una cosa mentre il totale ne dice un'altra.
    input.value = String(this.digit(place));
  }

  /** Le frecce della tastiera fanno quello che fanno le freccette: un gesto, due strade. */
  protected key(place: number, event: KeyboardEvent): void {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (!this.blocked(place, event.key === 'ArrowUp' ? 1 : -1)) {
        this.step(place, event.key === 'ArrowUp' ? 1 : -1);
      }
    }
  }

  /** Il tetto vero: il massimo dichiarato, mai negativo. */
  private top(): number {
    return Math.max(0, Math.trunc(this.max()));
  }

  private fit(value: number): number {
    return Math.min(this.top(), Math.max(0, Math.round(value || 0)));
  }

  /** Il nome del passo, per la frase del bottone: «+10», «-100». */
  protected label(place: number, by: 1 | -1): string {
    return `${by > 0 ? '+' : '−'}${place} su ${this.what()}`;
  }
}
