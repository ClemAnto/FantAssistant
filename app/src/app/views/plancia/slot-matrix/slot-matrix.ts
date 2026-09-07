import { DecimalPipe } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { PlayerFlags } from '../../../ui/player-flags/player-flags';
import { Alternative, MIN_PLAY_SHARE, ROLES, Role, SlotView } from '../../../core/plancia';
import { BoardBlock, BoardMan } from '../../../core/plancia-store';
import { RulingDot } from '../../../ui/ruling-dot/ruling-dot';

const ROLE_TONE: Record<Role, string> = {
  P: 'bg-role-keeper',
  D: 'bg-role-defence',
  C: 'bg-role-midfield',
  A: 'bg-role-attack',
};

/** The state of a row. Four states, and the ink alone has to separate them at 17px. */
const ROW_TONE: Record<BoardMan['state'], string> = {
  asta: 'bg-success/20 text-fg font-semibold',
  // I MIEI: un grigio un po' piu' chiaro (sua richiesta, 03/09/2026). Erano nel primario, che e' il
  // colore con cui questa pagina segna quello su cui si sta DECIDENDO - e un uomo che ho gia' preso
  // non e' una decisione, e' un fatto. Il grigio li tiene visibili in cima al blocco senza chiamare
  // l'occhio dove non c'e' niente da fare.
  mio: 'bg-control/70 text-fg',
  altro: 'text-muted/60',
  urna: 'text-fg hover:bg-control',
};

/**
 * ...E COME SI LEGGE QUANDO LA LENTE E' ACCESA SU DI LUI: inchiostro pieno.
 *
 * Sua istruzione (04/09/2026): «l'ink dei nomi accesi per la squadra selezionata deve essere bianco
 * altrimenti non risalta». La ragione è che gli uomini di una rosa accesa sono, per lo stato, «di un
 * altro» - e quello stato è disegnato SMORZATO di proposito, perché chi è già stato comprato non è
 * più una decisione. Con la lente lo diventa di nuovo: sono esattamente le righe che si sta guardando,
 * e smorzare il resto al 30% non basta se quello che resta era già grigio.
 *
 * L'unico stato che cambia è `altro`, e non per economia: gli altri tre leggono già `text-fg`. Ed è una
 * MAPPA e non una classe aggiunta a quella dello stato, perché due utility sulla stessa proprietà si
 * decidono sull'ordine del CSS generato e non su quale delle due è legata (il difetto del 27/08/2026).
 *
 * `text-fg` e non un bianco letterale: il tema ha due versi, e in quello chiaro il «bianco» è nero.
 */
const LIT_TONE: Record<BoardMan['state'], string> = {
  ...ROW_TONE,
  altro: 'text-fg hover:bg-control',
};

/** The widest line has eight blocks, so eight is the grid every line is cut on. */
const COLUMNS = 8;

/**
 * THE BOARD, whole: four lines of role, one block per place in the roster, TEN NAMES IN EVERY BLOCK.
 *
 * Nothing is collapsed and nothing opens: at the fourth hour the question «who is left in this slot»
 * has to be answered by looking, not by clicking. 25 blocks x 10 men is 250 rows and they fit, because
 * a row carries exactly two things - the name and ONE number.
 *
 * That number is the MAX OFFER while he is in the urn and the PRICE PAID once somebody has him. Two
 * meanings in one column is a thing this project normally refuses; here the row says which by its own
 * ink and by the owner's colour on its left edge, and the legend says it in words - so the column is
 * readable rather than ambiguous. Dropping the price paid would cost the more useful half: what the
 * room actually paid for this slot is the only live reading of the market there is.
 *
 * EVERY BLOCK IS THE SAME WIDTH, the keepers' three included: a slot is a rank divided by the number of
 * squads, so a block is one unit of the market whatever role it belongs to, and drawing the keepers
 * wider would say they are worth more of the screen than a defender. The room left over on the short
 * lines carries the CODA and the legend instead of stretching the blocks.
 */
@Component({
  selector: 'plancia-slot-matrix',
  templateUrl: './slot-matrix.html',
  imports: [
    DecimalPipe, NzTooltipModule, PlayerFlags,
    RulingDot,
  ],
  host: { class: 'block min-h-0' },
})
export class SlotMatrix {
  readonly blocks = input.required<BoardBlock[]>();
  /**
   * QUALE DEI DUE TAGLI si sta guardando: serve all'intestazione, non alle righe.
   *
   * Un blocco chiamato `D1` che porta due insiemi diversi di dieci uomini a seconda di uno stato che la
   * griglia non dichiara e' indistinguibile da un tabellone rotto, quindi la cifra dell'intestazione e
   * la frase del suo tooltip cambiano col taglio: sul mercato il blocco E' una fascia di prezzo e la
   * mediana pagata lo descrive, sulla griglia personale non lo e' piu' e quello che lo descrive e' la
   * mediana della MIA max offerta - la coordinata su cui e' tagliato.
   */
  readonly view = input<SlotView>('market');
  readonly lotBlockId = input<string | null>(null);
  /**
   * LA ROSA ACCESA, e qui serve solo a smorzare le altre righe (sua richiesta, 04/09/2026).
   *
   * `null` è lo stato normale: nessuna lente, nessuna riga smorzata. Non è un filtro - le righe
   * restano tutte al loro posto, perché togliere delle righe cambierebbe i blocchi e i blocchi sono
   * la struttura del mercato.
   */
  readonly activeTeam = input<number | null>(null);
  readonly tail = input(0);
  /** The pair from the slot below, by man: what you would buy instead of him, at the same currency. */
  readonly pairs = input<Map<number, Alternative | null>>(new Map());
  /**
   * My own purse, drawn in the room the attack line leaves over.
   *
   * It is here and not only in the strip because at a FREE extraction it is the constraint one loses
   * track of: any role can come up at any moment, so «how much can I still spend per place I have to
   * fill» is the number that decides whether the next bid is affordable at all. The spare columns are
   * the price of drawing every block the same width; filling them with a real figure is cheaper than
   * leaving a hole and cheaper than stretching the blocks.
   */
  readonly myCredits = input(0);
  readonly myMissing = input<number[]>([]);

  protected readonly myPlaces = computed(() =>
    this.myMissing().reduce((total, left) => total + left, 0),
  );
  protected readonly perPlace = computed(() => {
    const places = this.myPlaces();
    return places > 0 ? Math.floor(this.myCredits() / places) : null;
  });

  /** Naming a lot is a two-click job and this is the first click: press a name, it goes on the table. */
  readonly pick = output<BoardMan>();

  /**
   * ...except on a KEEPER, where the click asks with whom to pair him and puts nothing on the table.
   *
   * Two gestures and not one with two effects, the operator's instruction of 03/09/2026. The reason it
   * is the keeper's own row and not a second control: a squad fields ONE keeper, so «which of the ten»
   * is the only question that row ever asks, while for a man of movement the question is the lot.
   */
  // L'evento del portiere non c'e' piu': un click emette `pick` per tutti e gli abbinamenti sono un
  // bottone della card. Un output che nessuno emette e' un contratto che mente a chi lo legge.

  /** Un click, un evento, per ogni ruolo: chi lo ascolta apre la card. */
  protected press(man: BoardMan): void {
    this.pick.emit(man);
  }

  /**
   * NESSUNA RIGA È SPENTA, da quando il click apre una CARD (04/09/2026).
   *
   * Prima lo era per chi ha un padrone e non è portiere: non si poteva nominare come lotto, e non
   * c'era altro da fare su di lui. Ma la card si chiede anche di un uomo già venduto - a che prezzo è
   * andato, quanto rendeva, chi ce l'ha - e i due gesti che dipendono dallo stato sono ora BOTTONI
   * dentro la card, che appaiono quando hanno senso. *Disabilitare una riga per un'azione che non è
   * più quella del click è una riga spenta per un motivo che non c'è più.*
   */
  protected inert(_man: BoardMan): boolean {
    return false;
  }

  protected readonly roles = ROLES;
  protected readonly roleTone = ROLE_TONE;

  protected readonly byRole = computed(() => {
    const out = new Map<Role, BoardBlock[]>();
    for (const role of ROLES) out.set(role, []);
    for (const block of this.blocks()) out.get(block.role)?.push(block);
    return out;
  });

  /** How many grid columns are left over on a line: they carry the coda and the legend. */
  protected spare(role: Role): number {
    return Math.max(0, COLUMNS - (this.byRole().get(role)?.length ?? 0));
  }

  protected blockTone(block: BoardBlock): string {
    const lot = block.id === this.lotBlockId();
    // ...E UN BLOCCO ESAURITO NON SI SMORZA MENTRE LA LENTE CI ACCENDE DENTRO QUALCUNO: l'opacita' di
    // un contenitore si MOLTIPLICA con quella delle righe, quindi le righe accese - che stanno quasi
    // sempre in blocchi finiti, essendo state comprate - leggerebbero al 50% proprio dove devono
    // risaltare («l'ink dei nomi accesi deve risaltare», 04/09/2026). Il segnale «esaurito» resta su
    // ogni altro blocco, e nessuna misura di riga se ne accorgerebbe: `getComputedStyle` di un bottone
    // legge la SUA opacita' e non quella dell'antenato.
    const faded = block.left === 0 && !this.hasLit(block);
    return [
      lot ? 'border-primary ring-1 ring-primary/40' : 'border-border',
      faded ? 'opacity-50' : '',
    ].join(' ');
  }

  /** Vero se la lente accende una riga DENTRO questo blocco: una definizione, due letture con `lit`. */
  private hasLit(block: BoardBlock): boolean {
    const at = this.activeTeam();
    return at != null && block.rows.some((row) => row.ownerId === at);
  }

  /**
   * La cifra dell'intestazione: la coordinata su cui il blocco e' TAGLIATO, e mai l'altra.
   *
   * Sul mercato e' la mediana del prezzo, che e' anche quello che rende quei dieci uomini equivalenti
   * per la stanza; sulla griglia personale il blocco non e' piu' una fascia di prezzo, quindi quella
   * mediana sarebbe un numero vero che non descrive il blocco che sta sopra.
   */
  protected headline(block: BoardBlock): number | null {
    return this.view() === 'mine' ? block.medianOffer : block.medianFvm;
  }

  protected blockTip(block: BoardBlock): string {
    const mine = this.view() === 'mine';
    if (block.left === 0) {
      // ...E LO SLOT ESAURITO ALZA UN TETTO SOLO SULLA GRIGLIA DEL MERCATO: `depthFactor` legge i
      // blocchi di mercato, che sono la popolazione su cui quel +52% e' misurato (§27.5). Sulla mia
      // griglia il blocco vuoto e' una notizia - i dieci che pagavo cosi' sono andati - e ripetere
      // qui la frase del mercato sarebbe attribuire a un taglio un effetto misurato sull'altro.
      return mine
        ? `Il tuo ${block.id} è finito: i ${block.men.length} che pagavi a questa cifra sono tutti di qualcuno.`
        : `${block.id} esaurito: nessuno più nell'urna — è ciò che alza la max offerta di chi sta sopra.`;
    }
    // CHI NON DISEGNO LO DICO QUI, sul blocco che ha una riga in meno: nove righe su dieci senza una
    // parola si leggono come un tabellone rotto, e il posto resta occupato nel rango.
    //
    // E DA OGGI QUESTA E' LA SOLA VOCE CHE LO DICE: la pastiglia «N fuori lista» in barra e' stata
    // togliuta su sua istruzione (04/09/2026), quindi la frase si porta dietro anche la SOGLIA, che
    // era nel tooltip di quella. Il posto e' migliore di prima - la domanda «perche' questo blocco ha
    // otto righe» si fa guardando il blocco - ma solo se qui c'e' tutto quello che serve a risponderla.
    const gone = block.excluded.length
      ? ` · ${block.excluded.length} fuori lista: rientrano troppo tardi perche' valgano un posto in ` +
        `rosa, giocherebbero meno del ${Math.round(MIN_PLAY_SHARE * 100)}% delle giornate che restano ` +
        `(margine di prudenza incluso) — ${block.excluded.map((man) => man.name).join(', ')}`
      : '';
    const median = Math.round(this.headline(block) ?? 0);
    // DUE FRASI PERCHE' SONO DUE OGGETTI: `D3` del mercato sono i terzi dieci difensori per prezzo,
    // `D3` mio sono i terzi dieci per quanto li pago. Il tooltip lo dice invece di lasciarlo dedurre
    // dal bottone in barra, che a quattro ore di asta nessuno guarda piu'.
    const what = mine
      ? `il tuo ${block.id}: i ${block.men.length} per cui offrirei di più dopo i precedenti · ` +
        `mia max offerta mediana ${median} cr`
      : `${block.id} del mercato: i ${block.men.length} più cari del ruolo dopo i precedenti · ` +
        `mediana pagata ${median} cr`;
    return `${block.left} ancora nell'urna · ${what}${block.mine ? ' · uno è tuo' : ''}${gone}`;
  }

  /**
   * SMORZATO PERCHÉ NON È DELLA ROSA ACCESA: 30% come lui ha chiesto, e su TUTTO il resto.
   *
   * NESSUNA ECCEZIONE, e le due che c'erano sono state togliute da un difetto che lui ha visto e io
   * avevo scritto: «quando seleziono una squadra e poi ne seleziono un'altra, i calciatori della
   * squadra precedente restano accesi» (04/09/2026). Erano «il LOTTO in asta» e «i MIEI», aggiunte
   * mie con due argomenti che restano veri - la riga per cui la pagina esiste, e il fatto che «cosa ha
   * preso lui» si chieda insieme a «e io cosa ho» - e che non valgono il prezzo: dal di fuori una
   * riga accesa che non è della rosa accesa è indistinguibile da una lente che non si è pulita, e la
   * prima rosa che uno guarda è la propria.
   *
   * *Il valore di un'eccezione si paga in confusione, e la confusione la vede solo chi guarda lo
   * schermo senza aver scritto il codice.* La regola letterale non ha questo problema.
   */
  protected dimmed(man: BoardMan): boolean {
    const at = this.activeTeam();
    return at != null && man.ownerId !== at;
  }

  /** ...e il suo complemento: la riga che la lente sta ACCENDENDO. Una definizione, due letture. */
  private lit(man: BoardMan): boolean {
    const at = this.activeTeam();
    return at != null && man.ownerId === at;
  }

  /**
   * L'INCHIOSTRO DELLA RIGA, e i due rossi dicono due fatti di taglia diversa.
   *
   * IL BARRATO E' L'INFORTUNATO DI LUNGA DATA (operatore, 04/09/2026: «lo stile barrato utilizziamolo
   * per gli infortunati di lunga data») - uno spell aperto da 45 giorni o più, cioè una stagione
   * compromessa e non una giornata. Prima era addosso a «chi oggi non gioca» e lui l'ha ritirato di
   * lì dicendo perché: «non è molto rilevante ai fini del mercato, è solo una gara saltata, mostrarlo
   * addirittura barrato mi ha tratto in inganno». *Un inchiostro si sceglie sulla taglia del fatto,
   * non sulla sua freschezza* - e quello che lo aveva tratto in inganno era esattamente uno scarto di
   * taglia, un fatto da una giornata disegnato come una cancellazione.
   *
   * IL ROSSO SENZA TAGLIO è chi ha una DATA di rientro: è comprabile, e quanto vale lo dice già il
   * numero accanto, perché `points` e `pv` portano le giornate che perde. Un uomo cancellato e uno
   * riprezzato sono due cose diverse e devono vedersi diverse.
   *
   * E «oggi non gioca» non tinge più niente: il fatto lo porta l'ICONA della riga, che ha la sua
   * ragione nel tooltip. Un fatto piccolo non prende un canale grande.
   *
   * E SOTTO LA LENTE l'inchiostro dello stato diventa quello pieno (`LIT_TONE`), ma I DUE ROSSI
   * VINCONO COMUNQUE: l'ink pieno serve alle righe che non risaltavano, e una riga rossa e barrata
   * risalta già - ridipingerla di bianco perché è accesa costerebbe l'unico canale che dice «la sua
   * stagione è compromessa». È il senso della richiesta e non un'eccezione a essa.
   */
  protected rowTone(man: BoardMan): string {
    if (man.longOut) return 'text-danger line-through decoration-danger/60 hover:bg-control';
    if (man.out) return 'text-danger/75 hover:bg-control';
    return this.lit(man) ? LIT_TONE[man.state] : ROW_TONE[man.state];
  }

  /**
   * What the hover says, and for a man in the urn it is the PAIR: the two of the slot below you would
   * buy instead of him, each at his own max offer and with the total. It is what makes a bid doubtable,
   * and it is on every row and not only on the lot because that is the count nobody holds in his head.
   */
  /**
   * L'UOMO SOTTO IL PUNTATORE, e i due che comprerei invece di lui.
   *
   * Sostituisce il tooltip di riga («è fastidioso», 03/09/2026): la coppia alternativa non si
   * RISCRIVE in un riquadro, si ACCENDE dove i due uomini stanno gia' - una riga della mappa e' il
   * posto dove quel nome vive, e un pannello che copre le righe vicine nasconde proprio il confronto
   * per cui esiste.
   *
   * Su `mouseenter` e non su `pointerenter`, e la ragione e' una misura: con i pointer events il
   * banco leggeva ZERO righe accese dopo un hover vero (`Input.dispatchMouseEvent` e' quello che
   * genera un puntatore reale qui, ed e' anche quello che il vecchio tooltip usava). Un gesto che il
   * banco non riesce a far scattare e' un gesto che non si puo' verificare, e quindi non si spedisce:
   * su un touch un hover non esiste comunque.
   */
  private readonly hovered = signal<number | null>(null);

  /** Gli id dei due uomini alternativi all'uomo in hover: un insieme, non una lista da riscorrere. */
  private readonly insteadOf = computed<Set<number>>(() => {
    const at = this.hovered();
    if (at == null) return new Set();
    const pair = this.pairs().get(at);
    return new Set((pair?.men ?? []).map((one) => one.id));
  });

  protected hover(man: BoardMan | null): void {
    this.hovered.set(man?.id ?? null);
  }

  /**
   * LA CIFRA A DESTRA, e sulla griglia personale ne ha UN significato solo.
   *
   * Sul mercato la colonna dice due cose e lo dichiara (max offerta finche' e' nell'urna, prezzo
   * PAGATO quando e' di qualcuno): due significati tenuti di proposito, perche' quello che la stanza ha
   * davvero pagato per uno slot e' la sola lettura viva del mercato che questa pagina abbia.
   *
   * Sulla griglia personale no, e l'ha trovato l'operatore guardando lo schermo (04/09/2026): «come mai
   * negli slot personali Hojlund sta prima di Martinez? L'ordine non dovrebbe essere per max-offerta?».
   * Si': quel taglio E' la colonna ordinata, quindi ogni riga che mostra un numero diverso dalla chiave
   * dell'ordine si legge come un ordinamento rotto - Martinez L. mostrava 403 (quello che un rivale ha
   * pagato) e stava sotto un 333, che dalla parte di chi guarda e' semplicemente sbagliato. Qui la
   * cifra e' SEMPRE il mio tetto, anche per un uomo che non posso piu' comprare, e chi lo ha se lo
   * legge dalla barra del proprietario o dalla griglia del mercato.
   *
   * *Una colonna puo' portare due significati solo dove non e' anche la chiave dell'ordinamento.*
   */
  protected shown(man: BoardMan): number | null {
    return this.view() === 'mine' ? (man.band?.high ?? null) : man.price;
  }

  /**
   * La tinta dell'alternativa: rosso leggerissimo, su token e mai un colore letterale.
   *
   * Il 10% e non di piu' perche' la riga porta un nome e due numeri che devono restare leggibili: la
   * tinta e' un richiamo, non qualcosa da leggere al posto del testo.
   */
  protected readonly INSTEAD_TINT = 'color-mix(in srgb, var(--color-danger) 10%, transparent)';

  /** Vero se questa riga e' uno dei due che comprerei invece dell'uomo sotto il puntatore. */
  protected instead(man: BoardMan): boolean {
    return this.insteadOf().has(man.id);
  }

  // NESSUN `title` SULLE RIGHE (sua istruzione, 04/09/2026: «da' fastidio»). Il tooltip nativo del
  // browser spuntava sotto il puntatore su una plancia di 250 righe alte diciassette pixel, cioe'
  // esattamente dove si sta leggendo, e copriva le righe vicine mentre si scorreva un reparto.
  //
  // Quello che diceva non e' perso e non e' stato riscritto altrove: il PREZZO e la banda stanno
  // sulla card, che il click apre da se' (04/09), e l'ALTERNATIVA e' l'evidenziazione all'hover -
  // gli stessi due uomini, mostrati dove vivono invece che elencati in un riquadro. Due canali per
  // una frase sono come una riga finisce per dirne due versioni.
}
