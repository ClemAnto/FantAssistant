import { Injectable, inject } from '@angular/core';

import { Board, BoardHorizon, EngineSheetEntry } from './bundle';
import { MarketValues } from './market-trend';
import { PlayerRulings } from './player-rulings';
import { Platform } from './players-store';
import { Titolarita } from './titolarita';
import { SquadMan, ValuationStore } from './valuation-store';

/**
 * TUTTO QUELLO CHE SERVE A DISEGNARE IL CAMPETTO DI UN CLUB, in un posto solo.
 *
 * `ui-club-board` e' UNO per tutte le schermate che mostrano l'undici di una squadra vera - «il campetto
 * di una squadra reale deve essere sempre uguale» (operatore, 18/08/2026) - ma gli INPUT che gli si
 * passano accanto alla board erano ricostruiti da ogni chiamante: l'Overall 0-99, la quota che il motore
 * prevede, il valore di mercato e le dritte dichiarate. Tre copie dello stesso conto sono tre valutazioni
 * per un uomo, che e' il difetto che `ValuationStore` esiste per impedire, un piano piu' su.
 *
 * Quindi le quattro mappe si costruiscono QUI e la vista Squadre le legge da qui (`ClubsStore`), esattamente
 * come la card di un club aperta dalla card di un calciatore (`ui/club-card`). Niente si ricalcola: la
 * valutazione e' quella di `ValuationStore`, la curva di mercato quella di `MarketValues`, le dritte quelle
 * di `PlayerRulings` - un uomo che legge 85 nella tabella legge 85 su ogni campetto che lo disegna.
 *
 * L'UNDICI NON SI CALCOLA MAI QUI: lo disegna il TOOLKIT (`modules/boards.py`) e l'app lo legge. Questo
 * servizio sceglie soltanto QUALE board leggere - (piattaforma, club) sull'orizzonte scelto - e mette
 * accanto i numeri della rosa.
 */
export interface ClubBoardPack {
  /** La board dell'orizzonte scelto, o null: un club che il foglio non ha disegnato lo DICE. */
  board: Board | null;
  /**
   * QUALE DEI DUE ORIZZONTI e' quello disegnato, e quante partite guarda quello corto.
   *
   * Viaggia col pacchetto perche' `boardHorizon` e' un segnale GLOBALE (`ValuationStore`): la vista
   * Squadre lo puo' mettere su «ultimo periodo» e da quel momento ogni campetto dell'app disegna quella
   * lettura - la plancia compresa, che di quel pulsante non ne ha nemmeno uno. Una card che scrivesse
   * «formazione tipo» sopra l'undici delle ultime tre partite sarebbe un'intestazione che dice una cosa
   * falsa sull'oggetto qui sotto, che e' la famiglia di difetti che questo progetto paga da sempre.
   */
  horizon: BoardHorizon;
  /** Quante partite guarda la finestra corta, DICHIARATE dal toolkit. Null sulla stagione. */
  window: number | null;
  /** Vero quando NESSUN foglio di quella piattaforma porta le board: e' un'altra frase da «non questo club». */
  noBoards: boolean;
  overall: ReadonlyMap<number, number | null>;
  expectedShares: ReadonlyMap<number, number | null>;
  marketValues: ReadonlyMap<number, number | null>;
  ruled: ReadonlyMap<number, Titolarita>;
  /**
   * L'IDENTITA' DEL CLUB (`fc_club_id`), per lo STEMMA: un nome non e' una chiave.
   *
   * Si legge dalla rosa e non da una tabella a parte, perche' e' la stessa riga che gia' porta il club:
   * null dove nessuno dei suoi la dichiara, e allora si disegna il monogramma - uno stemma sbagliato
   * dice una cosa falsa, uno scudo grigio dice quello che e'.
   */
  clubId: number | null;
  /** Da quale foglio vengono board e numeri, perche' una card possa nominarlo. */
  sheet: EngineSheetEntry | null;
}

@Injectable({ providedIn: 'root' })
export class ClubBoards {
  private readonly valuation = inject(ValuationStore);
  /** La curva del mercato vero, dal lettore unico: un secondo darebbe allo stesso uomo due valori. */
  private readonly market = inject(MarketValues);
  /** Le dritte dichiarate: il campetto le applica al disegno, i numeri le hanno gia' dentro. */
  private readonly rulings = inject(PlayerRulings);

  /**
   * LA ROSA DI UN CLUB su un listone, valutata dal negozio che valuta un uomo.
   *
   * E CHI IL LISTONE DA' PER CEDUTO NON E' PIU' IN QUELLA ROSA (operatore, 07/09/2026: «perche' nel
   * Napoli c'e' ancora Lukaku?»): l'asterisco accanto al nome e' la piattaforma che dichiara che quel
   * calciatore non gioca piu' qui. La domanda di un campetto e' «chi c'e' in questa rosa», quindi lui
   * non c'e'; la tabella dei Calciatori resta un'altra domanda e la' la riga si mostra col suo marchio.
   */
  squadOf(platform: Platform, club: string | null): SquadMan[] {
    if (!club) return [];
    const men = (this.valuation.rosters().get(platform) ?? []).filter(
      (player) => player.club === club && !player.sold,
    );
    return this.valuation.valuations(platform, men);
  }

  /**
   * Il pacchetto di un club, dalla rosa che il chiamante ha gia' in mano.
   *
   * La rosa entra come ARGOMENTO e non si ricalcola qui, perche' chi disegna anche la tabella accanto la
   * possiede gia' (la vista Squadre): ricostruirla sarebbe pagare due volte lo stesso conto e - peggio -
   * aprirebbe la porta a due liste diverse sotto la stessa intestazione.
   */
  packFor(platform: Platform, club: string | null, squad: readonly SquadMan[]): ClubBoardPack {
    const view = this.valuation.boardViewFor(platform);
    const board = club ? (view?.clubs?.[club] ?? null) : null;
    const rounds = this.valuation.seasonRoundsFor(this.valuation.sheetFor(platform));
    const declared = this.rulings.all();

    const overall = new Map<number, number | null>();
    const expectedShares = new Map<number, number | null>();
    const marketValues = new Map<number, number | null>();
    const ruled = new Map<number, Titolarita>();
    for (const man of squad) {
      overall.set(man.fcId, man.rating?.overall.score ?? null);
      // La quota e' sul calendario del FOGLIO da cui vengono questi numeri: una quota il cui
      // denominatore viene da un altro foglio e' una quota di niente.
      expectedShares.set(
        man.fcId,
        man.expected == null || !rounds ? null : Math.min(1, man.expected / rounds),
      );
      marketValues.set(man.fcId, this.market.trend(man.fcId)?.value ?? null);
      const one = declared.get(man.fcId);
      if (one) ruled.set(man.fcId, one.rung);
    }

    return {
      board: board && !board.error ? board : null,
      noBoards: !this.valuation.boardsFor(platform),
      overall,
      expectedShares,
      marketValues,
      ruled,
      horizon: view?.horizon ?? 'season',
      window: view?.window ?? null,
      clubId: squad.find((man) => man.clubId != null)?.clubId ?? null,
      sheet: this.valuation.sheetFor(platform),
    };
  }
}
