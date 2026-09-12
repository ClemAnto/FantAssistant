import { Component, computed, inject, input, output } from '@angular/core';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { BonusRow, MatchSpell, bonusesOf, spellFrom } from '../../core/match-bonuses';
import { LineupMan, MatchLineup } from '../../core/match-lineup';
import { PitchLine } from '../../core/club-eleven';
import { Bundle, ScoringConfig } from '../../core/bundle';
import { MatchCell } from '../../core/players-store';
import { BonusMark } from '../bonus-mark/bonus-mark';
import { RoleSet } from '../role-set/role-set';
import { SpellMark } from '../spell-mark/spell-mark';
import { voteClass, voteText } from '../matches-table/vocabulary';
import { signal } from '@angular/core';

/** Come si chiama ogni riga, nella lingua del campo. Lo stesso vocabolario di `ui/club-board`. */
const LINE_LABEL: Record<PitchLine, string> = {
  A: 'attacco',
  T: 'trequarti',
  M: 'centrocampo',
  D: 'difesa',
  P: 'porta',
};

/** Niente in mano: il default onesto per un chiamante che non ha una tabella accanto. */
const NO_CELLS: ReadonlyMap<number, MatchCell> = new Map();
const NO_ROLES: ReadonlyMap<number, readonly string[]> = new Map();

/**
 * IL CAMPETTO DI UNA PARTITA GIA' GIOCATA: chi e' sceso in campo quel giorno.
 *
 * NON e' `ui/club-board` con altri dati, ed e' la ragione per cui e' un componente suo: quello disegna
 * un POSTO con i suoi ballottaggi, una quota da titolare e i minuti previsti - tutte risposte a «chi
 * giochera'» - mentre qui ogni domanda ha gia' una risposta osservata e nessuna di quelle voci esiste.
 * Riempire la carta di quel pannello con i fatti di una partita vorrebbe dire mostrare l'arredamento di
 * una domanda sotto un'altra.
 *
 * Quello che i due CONDIVIDONO e' il vocabolario del disegno - l'ordine delle righe dalla porta
 * all'attacco, cosa significa la stringa di un modulo - e sta in `core/club-eleven.ts`, letto da
 * tutt'e due: due letture di `4-3-3` finirebbero per disegnare due difese diverse.
 *
 * I NUMERI DELLA RIGA SONO LE CELLE DELLA TABELLA ACCANTO e non una seconda lettura: il voto, il
 * fantavoto e i bonus di quell'uomo in quella partita sono gli stessi che la colonna cliccata mostra
 * due dita piu' in la'. Chi il pacchetto non ha nella tabella - un uomo che questo listone non quota -
 * porta il nome e i minuti e nient'altro, che e' quello che di lui si sa.
 */
@Component({
  selector: 'ui-match-lineup',
  templateUrl: './match-lineup.html',
  imports: [BonusMark, NzTooltipModule, RoleSet, SpellMark],
  host: { class: 'block' },
})
export class MatchLineupBoard {
  private readonly bundle = inject(Bundle);

  readonly lineup = input.required<MatchLineup | null>();
  /** La cella di ogni uomo per QUESTA partita, dalla tabella che sta accanto. Vuota = non la mostra. */
  readonly cells = input<ReadonlyMap<number, MatchCell>>(NO_CELLS);
  /** I ruoli di listone da stampare accanto al nome. Vuoto per chi il listone non quota: ignoto. */
  readonly roles = input<ReadonlyMap<number, readonly string[]>>(NO_ROLES);
  /** Chi e' stato cliccato: la pagina apre la sua card, come fa gia' col campetto dell'undici tipo. */
  readonly pick = output<number>();

  protected readonly label = LINE_LABEL;
  protected readonly voteText = voteText;
  protected readonly voteClass = voteClass;

  /**
   * Il config dei punteggi, letto qui come fa la tabella: quanto vale un gol e' un fatto del
   * CAMPIONATO e non della vista che disegna. `Bundle` lo tiene in cache, quindi non costa niente.
   */
  protected readonly scoring = signal<ScoringConfig | null>(null);

  constructor() {
    void this.bundle.scoring().then((one) => this.scoring.set(one)).catch(() => undefined);
  }

  /** Quanti posti dell'undici questo pacchetto non sa nominare - zero compreso, che si dice tacendo. */
  protected readonly unnamed = computed(() => {
    const drawn = this.lineup();
    return drawn ? Math.max(0, drawn.wanted - drawn.named) : 0;
  });

  /**
   * SU QUANTE RIGHE L'ORDINE E' DEDOTTO invece che letto dalla distinta della fonte.
   *
   * Zero su ogni partita di campionato della finestra pesante (misurato: tutti i titolari ne hanno il
   * posto), e allora la riga tace. Sopra zero e' un fatto che chi guarda deve sapere: un posto dedotto
   * dai ruoli di OGGI e uno letto dalla distinta di QUEL giorno sono due cose diverse.
   */
  protected readonly deduced = computed(() => this.lineup()?.deduced ?? 0);

  protected rolesOf(man: LineupMan): readonly string[] {
    return this.roles().get(man.fcId) ?? [];
  }

  /** I bonus di quella partita, dal lettore UNICO: la cella non puo' portare due elenchi di eventi. */
  protected marksOf(man: LineupMan): BonusRow[] {
    const cell = this.cells().get(man.fcId);
    return cell ? bonusesOf(cell, this.scoring()) : [];
  }

  protected cellOf(man: LineupMan): MatchCell | null {
    return this.cells().get(man.fcId) ?? null;
  }

  /** I minuti di quella partita. `—` e' ignoto e non zero: la riga di un titolare li porta sempre. */
  protected minutesOf(man: LineupMan): string {
    return man.minutes == null ? '—' : `${man.minutes}′`;
  }

  /**
   * ENTRATO O USCITO, dalla definizione UNICA (`spellFrom`): la stessa che decide i due triangolini
   * nelle celle della tabella e nella riga compatta della card.
   *
   * «Nella formazione devi segnare con un triangolino anche chi esce» (operatore, 12/09/2026) - e il
   * marchio e' `ui/spell`, non due `svg` scritti qui: un'icona significa la stessa cosa in ogni pagina.
   * Chi e' uscito lo dice il fatto che sia partito titolare e non sia arrivato a 90; chi e' entrato,
   * l'opposto. Il minuto d'INGRESSO non e' in questi dati, quindi di un subentrato non si puo' dire se
   * sia poi uscito, e la seconda freccia resta spenta - «vuoto = ignoto».
   */
  protected spellOf(man: LineupMan): MatchSpell {
    return spellFrom(man.started, man.minutes);
  }

  protected onPick(man: LineupMan): void {
    this.pick.emit(man.fcId);
  }
}
