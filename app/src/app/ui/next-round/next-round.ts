import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import {
  NextClub, NextMan, NextPitch, NextShape, OFFICIAL_MINUTES, afterOfficial, leadMinutes,
} from '../../core/next-round';
import { RoleBadge } from '../role-badge/role-badge';

/** Un uomo come questa carta lo disegna: quello che il foglio pubblica piu' quello che sappiamo noi. */
interface Drawn {
  readonly man: NextMan;
  /** Il ruolo del LISTONE quando l'uomo e' uno che compriamo, quello della fonte altrimenti, mai niente. */
  readonly role: string | null;
  /** Se e' uno della rosa che stiamo guardando: solo per lui la card ha qualcosa da aprire. */
  readonly known: boolean;
  /** Nominato da TUTTE le fonti che hanno letto quel club. */
  readonly unanimous: boolean;
  /** La percentuale gia' scritta, o null: due fonti su quattro la pubblicano, e non decide niente. */
  readonly pct: string | null;
}

/**
 * IL PROSSIMO TURNO SECONDO LE FONTI - il terzo campetto della sezione Squadre, e non e' un campetto.
 *
 * E' UNA LISTA E NON UN DISEGNO, per una ragione e non per pigrizia: mettere undici uomini sulle righe di
 * un modulo e' un'ASSEGNAZIONE, e in questo progetto l'assegnazione di un club vero la fa il toolkit
 * (`gui._matching`, un'ungherese sui codici granulari) perche' e' una previsione su una persona e vive
 * dove le previsioni si misurano. Qui i codici granulari non ci sono - le fonti pubblicano un nome, al
 * piu' un ruolo del listone - quindi disegnarli su un campo vorrebbe dire inventare un secondo
 * posizionatore, piu' povero, accanto a quello che la pagina mostra due bottoni piu' in la'. La lista
 * dice esattamente quello che le fonti dicono: chi nominano, in quanti, e dove non sono d'accordo.
 *
 * E QUELLO CHE DICE NON E' UNA NOSTRA PREVISIONE. La stampa qui e' il GIUDICE delle nostre board e mai un
 * input: se la leggessimo dentro il claim, il confronto che le giudica diventerebbe circolare. Quindi
 * questa e' una TERZA cosa, la ri-pubblicazione di cosa hanno scritto quattro siti, e la frase che lo
 * dichiara viaggia nel payload (`what`) invece di essere riscritta qui - una seconda copia sarebbe una
 * seconda affermazione su cosa questa sezione e'.
 */
@Component({
  selector: 'ui-next-round',
  templateUrl: './next-round.html',
  imports: [NgTemplateOutlet, NzTooltipModule, RoleBadge],
})
export class NextRoundBoard {
  readonly club = input.required<NextClub>();
  /** Il ruolo del listone per `fc_id`, da chi la rosa ce l'ha in mano: qui non si deduce niente. */
  readonly roles = input<ReadonlyMap<number, string>>(new Map());
  /** Chi di questi uomini e' nella rosa che la pagina sta guardando. */
  readonly known = input<ReadonlySet<number>>(new Set());
  /** Quello che il payload dichiara di essere: si mostra, non si riscrive. */
  readonly what = input('');

  /**
   * IL MODULO DEDOTTO DAGLI UNDICI, coi suoi posti - o niente, e allora la carta dice PERCHE'.
   *
   * Non e' un'alternativa alla lista: il campetto disegna gli undici e la lista continua a portare i
   * NUMERI (quante fonti nominano chi), che su un campo non ci stanno. Un campetto senza il conteggio
   * accanto direbbe «questi undici» con la stessa faccia con cui lo dice la nostra board, mentre qui
   * quattro redazioni possono essere in disaccordo su meta' di loro.
   */
  readonly shape = input<NextShape | null>(null);
  readonly pitch = input<NextPitch | null>(null);

  /** Un click su un nome che conosciamo apre la SUA card - la stessa del campetto e della tabella. */
  readonly pick = output<number>();

  protected readonly certain = computed(() => this.draw(this.club().certain));
  protected readonly contested = computed(() => this.draw(this.club().contested));
  protected readonly out = computed(() => this.draw(this.club().out));

  /** Quanti minuti prima del fischio e' stata presa la lettura mostrata. Null = manca un istante. */
  protected readonly lead = computed(() => leadMinutes(this.club()));
  protected readonly official = computed(() => afterOfficial(this.club()));
  protected readonly officialMinutes = OFFICIAL_MINUTES;

  /** Il fischio, in ora LOCALE: le date di questo progetto sono in UTC e solo lo schermo le converte. */
  protected readonly kickoff = computed(() => {
    const when = this.club().kickoff;
    return when ? WHEN.format(when) : null;
  });

  protected readonly leadHint = computed(() => {
    const lead = this.lead();
    if (lead === null) return 'Il foglio non porta uno dei due istanti, quindi non si puo' + "' dire.";
    return `La lettura che conta e' stata presa ${lead} minuti prima del fischio. Le formazioni ufficiali`
      + ` escono a ${OFFICIAL_MINUTES}': sopra quella soglia e' una PREVISIONE delle fonti, sotto e' in`
      + " parte una copia dell'undici gia' annunciato - e vale come lettura lo stesso, per decisione"
      + " dell'operatore (18/09/2026), ma non e' la stessa cosa e la riga lo dice.";
  });

  /**
   * COSA DICE LA CONTESA, e la frase cambia col numero perche' «una maglia per due uomini» e «due maglie
   * per tre» sono due situazioni diverse e un plurale sbagliato le fa leggere uguali.
   */
  protected readonly contestHint = computed(() => {
    const places = this.club().contestedPlaces;
    const men = this.club().contested.length;
    if (!men) return '';
    return `${places === 1 ? 'Una maglia' : places + ' maglie'} per ${men} uomini, tutti nominati dalle`
      + ' stesse fonti: il pareggio si mostra e non si rompe. Spareggiarlo sulla probabilita'
      + "' - che due fonti su quattro pubblicano - farebbe decidere una maglia a un metro parziale.";
  });

  /**
   * QUELLO CHE SI SA DI OGNI UOMO, indicizzato SULL'UOMO e non sul suo nome.
   *
   * Il campetto e la lista portano gli STESSI oggetti - escono tutti da `parseNextRound` - quindi
   * l'aggancio e' l'identita' e non la stringa. Un join per nome dentro casa nostra sarebbe la regola
   * piu' vecchia di questo repository rotta nel posto piu' sciocco: qui non costa niente evitarlo, e il
   * giorno in cui due tesserati di un club si chiamassero uguale non ci sarebbe niente da scoprire.
   */
  private readonly about = computed(() => {
    const out = new Map<NextMan, Drawn>();
    for (const one of [...this.certain(), ...this.contested(), ...this.out()]) out.set(one.man, one);
    return out;
  });

  /** Le righe da disegnare, dalla porta all'attacco: e' l'ordine che `nextPitch` scrive gia'. */
  protected readonly rows = computed(() => this.pitch()?.rows ?? []);

  protected readonly shapeName = computed(() => this.pitch()?.shape ?? null);

  /**
   * Chi DICHIARA questo modulo, quando viene dalle fonti - e la frase cambia, perche' «lo dicono loro»
   * e «l'abbiamo deciso noi contando chi puo' stare dove» sono due affermazioni di natura diversa e una
   * carta che le stampasse uguali farebbe passare una deduzione nostra per un fatto pubblicato.
   */
  protected readonly shapeSaid = computed(() => {
    const drawn = this.pitch();
    const by = drawn?.by ?? [];
    if (by.length) {
      return `dichiarato da ${by.length === this.club().sources ? 'tutte le fonti' : by.join(', ')}`;
    }
    // «Lo dicono loro», «l'abbiamo dedotto» e «l'abbiamo SCELTO fra i possibili» sono tre affermazioni
    // di natura diversa, e la terza e' quella che va detta piu' forte: li' dentro c'e' un numero nostro.
    return drawn?.ours
      ? 'scelto fra i moduli possibili con quello che la NOSTRA board disegna per questo club'
      : 'dedotto da noi: le fonti di questa presa non pubblicano il modulo';
  });

  protected choose(one: Drawn): void {
    if (one.known && one.man.fcId !== null) this.pick.emit(one.man.fcId);
  }

  /** Quello che si sa di chi occupa un posto. Null = il posto c'e' e nessuno lo riempie. */
  protected at(man: NextMan | null | undefined): Drawn | null {
    return man ? this.about().get(man) ?? null : null;
  }

  private draw(men: readonly NextMan[]): Drawn[] {
    const roles = this.roles();
    const known = this.known();
    return men.map((man) => ({
      man,
      // Il ruolo NOSTRO per primo: e' il listone, cioe' il vocabolario con cui si compra, e le fonti
      // non lo pubblicano tutte. Vuoto = ignoto: una casella vuota, mai una lettera inventata.
      role: (man.fcId !== null ? roles.get(man.fcId) : null) ?? man.role,
      known: man.fcId !== null && known.has(man.fcId),
      unanimous: man.of > 0 && man.votes === man.of,
      pct: man.prob === null ? null : `${Math.round(man.prob * 100)}%`,
    }));
  }
}

/** Il fischio si legge come lo si legge su un biglietto: giorno della settimana, data, ora. */
const WHEN = new Intl.DateTimeFormat('it-IT', {
  weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});
