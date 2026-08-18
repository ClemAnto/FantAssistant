import { DecimalPipe } from '@angular/common';
import { Component, computed, input, linkedSignal } from '@angular/core';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { Board, BoardMan } from '../../core/bundle';
import {
  OnTable,
  PITCH_CLAIM_FLOOR,
  PitchLine,
  PitchMan,
  disagreementHint,
  pitchOf,
  shapesOf,
} from '../../core/club-eleven';
import { stored } from '../../core/view-state';
import { PlayerFlags } from '../player-flags/player-flags';
import { RoleBadge } from '../role-badge/role-badge';

/** What each drawn line is called, in the language of the pitch. */
const LINE_LABEL: Record<PitchLine, string> = {
  A: 'attacco',
  T: 'trequarti',
  M: 'centrocampo',
  D: 'difesa',
  P: 'porta',
};

/** Nothing known: the honest default for a caller that has no sheet and no table in hand. */
const NOTHING: ReadonlyMap<number, number | null> = new Map();
const NO_TABLE: ReadonlyMap<number, OnTable> = new Map();

/**
 * IL CAMPETTO DI UNA SQUADRA VERA - uno, per tutte le schermate che lo mostrano.
 *
 * «Il campetto di una squadra reale deve essere sempre uguale sia nella schermata dell'asta che in quello
 * delle squadre» (operatore, 18/08/2026): fino a ieri erano DUE componenti con due template che si
 * assomigliavano, e due copie di una carta finiscono sempre per dire due cose - è lo stesso motivo per cui
 * l'undici lo disegna il toolkit e non l'app. Quindi qui c'è il disegno, e le due viste passano soltanto
 * quello che sanno loro: la vista Squadre niente, il pannello d'asta chi è già stato preso.
 *
 * Cosa mostra un ITEM, che è un POSTO del modulo e non un uomo (sua richiesta dello stesso giorno): il
 * ruolo reale del posto, piccolo, e sotto i calciatori in ballottaggio per quel posto - il titolare per
 * primo - ognuno col suo ruolo di listone, le sue icone, il suo Overall 0-99 e i minuti che ci si aspetta
 * da lui in una partita del club. Un uomo compare in UN posto solo (`oneItemEach`) e un rivale sotto
 * `PITCH_CLAIM_FLOOR` non compare affatto: le due regole stanno in `core/club-eleven.ts` con le misure
 * che le hanno scelte, perché sono scelte di visualizzazione e nessun gate le possiede.
 */
@Component({
  selector: 'ui-club-board',
  templateUrl: './club-board.html',
  imports: [DecimalPipe, NzEmptyModule, NzTooltipModule, PlayerFlags, RoleBadge],
  host: { class: 'block' },
})
export class ClubBoard {
  readonly board = input.required<Board | null>();
  /** True quando NESSUN foglio della piattaforma porta le board: è una frase diversa da «non questo club». */
  readonly noBoards = input(false);
  /**
   * L'OVERALL 0-99 per `fc_id`, che è il numero accanto a ogni nome.
   *
   * È un INPUT e non una lettura di questo componente per la stessa ragione per cui la board lo è: quale
   * listone e quale foglio quel numero descriva lo sa solo il chiamante, e un 0-99 preso da un'altra pool
   * sarebbe un rango di un'altra domanda.
   */
  readonly overall = input<ReadonlyMap<number, number | null>>(NOTHING);
  /** La quota di calendario che il MOTORE gli prevede, per il marchio del disaccordo. */
  readonly expectedShares = input<ReadonlyMap<number, number | null>>(NOTHING);
  /** Quello che solo un tavolo sa: chi è già stato preso, cosa chiede, se è in questo listone. */
  readonly table = input<ReadonlyMap<number, OnTable>>(NO_TABLE);

  protected readonly label = LINE_LABEL;

  /**
   * QUALE MODULO è disegnato: quello scelto dal pannello, o un altro fra quelli che il toolkit manda.
   *
   * `linkedSignal` perché la scelta appartiene al CLUB che si sta guardando: cambiando squadra torna al
   * modulo del modello, invece di restare su una forma che apparteneva a un'altra board.
   */
  protected readonly shape = linkedSignal<Board | null, string | null>({
    source: () => this.board(),
    computation: () => null,
  });

  /**
   * RUOLI DI LISTONE O RUOLI CLASSIC accanto ai nomi (interruttore in fondo al campetto, richiesta
   * dell'operatore del 18/08/2026). Ricordato come le altre preferenze di lettura: è come si legge, non
   * cosa si guarda, quindi vale in tutt'e due le schermate e sopravvive a un refresh.
   */
  protected readonly roleKind = stored<'mantra' | 'classic'>(
    'board.roles', 'mantra', ['mantra', 'classic'],
  );

  /** I moduli fra cui si può passare, il disegnato compreso: uno solo = niente tastini. */
  protected readonly shapes = computed(() => shapesOf(this.board()));

  protected readonly pitch = computed(() => {
    const known = this.table();
    const shares = this.expectedShares();
    const worth = this.overall();
    const resolve = (man: BoardMan): OnTable => {
      const id = man.fc_id;
      const live = id == null ? undefined : known.get(id);
      return {
        taken: live?.taken ?? false,
        price: live?.price ?? null,
        // Fuori da un tavolo nessuno è «non nel listone»: la vista Squadre descrive, non compra.
        onTable: live?.onTable ?? true,
        value99: live?.value99 ?? null,
        overall: id == null ? null : (worth.get(id) ?? null),
        expectedShare: id == null ? null : (shares.get(id) ?? null),
      };
    };
    return pitchOf(this.board(), resolve, this.shape());
  });

  /** Quanti degli undici disegnati sono già stati presi: zero fuori da un tavolo. */
  protected readonly taken = computed(() => this.pitch()?.taken ?? 0);

  protected choose(shape: string): void {
    this.shape.set(shape === (this.board()?.board_shape ?? null) ? null : shape);
  }

  protected shows(shape: string): boolean {
    const chosen = this.shape();
    return chosen == null ? shape === (this.board()?.board_shape ?? this.pitch()?.module) : chosen === shape;
  }

  /** I candidati di un posto: il titolare e i suoi ballottaggi, che sono già filtrati e deduplicati. */
  protected candidates(man: PitchMan): PitchMan[] {
    return [man, ...man.duels];
  }

  /** I ruoli da stampare accanto al nome, secondo l'interruttore. Vuoto = il listone non lo dice. */
  protected rolesOf(man: PitchMan): string[] {
    if (this.roleKind() === 'classic') return man.classic ? [man.classic] : [];
    return man.mantra;
  }

  /**
   * IL RUOLO REALE DEL POSTO, che è la prima riga di un item.
   *
   * È il marcatore che il pannello ha dato al TITOLARE di quel posto (`Td`, `Dc`, `Pc`), cioè il mestiere
   * che quel posto chiede - non il ruolo di un uomo: i ballottaggi stanno sotto proprio perché si giocano
   * quello stesso posto.
   */
  protected place(man: PitchMan): string | null {
    return man.badge;
  }

  /** Il marchio del disaccordo fra board e motore, che viaggia col nome dovunque sia disegnato. */
  protected disputed(man: PitchMan): string | null {
    return disagreementHint(man);
  }

  /** Un uomo in una frase: cosa è, quanto gioca, e - se c'è un tavolo - quanto costa. */
  protected hint(man: PitchMan): string {
    const bits = [man.name];
    if (man.taken) bits.push('già preso');
    if (!man.onTable) bits.push('non è nel listone di questa sessione');
    if (man.claim != null) bits.push(`titolarità ${man.claim}`);
    if (man.expectedMinutes != null) {
      bits.push(`${man.expectedMinutes}′ attesi per partita del club`
        + (man.perMatch != null ? ` (${man.perMatch}′ quando gioca)` : ''));
    } else if (man.perMatch != null) {
      bits.push(`${man.perMatch}′ medi quando gioca`);
    }
    if (man.minutes != null) {
      bits.push(man.matches ? `${man.minutes}′ in ${man.matches} partite giocate` : `${man.minutes}′`);
    }
    // L'altro denominatore, nominato: questo divide per le partite DEL CLUB nelle ultime dieci, quindi le
    // assenze sono dentro e per lo stesso uomo è un numero più piccolo. Due medie con un'etichetta sola
    // sarebbero una trappola.
    if (man.minutesPerClubMatch != null) {
      bits.push(`${man.minutesPerClubMatch}′ per partita del club nelle ultime dieci`);
    }
    if (man.codes.length) bits.push(`ruolo reale ${man.codes.join(', ')}`);
    if (man.mantra.length) bits.push(`listone ${man.mantra.join('/')}`);
    if (man.overall != null) bits.push(`overall ${man.overall}/99`);
    if (man.price != null) bits.push(`FVM ${man.price}`);
    const said = disagreementHint(man);
    if (said) bits.push(said);
    return bits.join(' · ');
  }

  /**
   * Quanti ballottaggi il campetto non mostra, in una frase - o vuota se non ne ha nascosto nessuno.
   *
   * Un filtro silenzioso è un filtro che inganna: è la stessa regola del conteggio delle righe che arrivano
   * scorrendo, e le due ragioni si dicono separate perché sono due fatti diversi.
   */
  protected readonly hidden = computed(() => {
    const counted = this.pitch()?.hiddenDuels;
    if (!counted || (!counted.floor && !counted.duplicate)) return '';
    const bits: string[] = [];
    if (counted.floor) {
      bits.push(`${counted.floor} sotto il ${Math.round(PITCH_CLAIM_FLOOR * 100)}% di titolarità`);
    }
    if (counted.duplicate) bits.push(`${counted.duplicate} già mostrati su un altro posto`);
    return `Ballottaggi non disegnati: ${bits.join(' · ')}.`;
  });
}
