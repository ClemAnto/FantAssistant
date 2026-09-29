import { Injectable, WritableSignal, computed, effect, inject, signal, untracked } from '@angular/core';

import { AuctionFeed, DEMO_CODE, MarketType } from './auction-feed';

// SOLO TIPI dai due moduli qui sotto, ed è deliberato: `players-store` inietta questo servizio, quindi
// un import di valore chiuderebbe un ciclo a runtime. Un `import type` non viene emesso affatto.
import type { ClassicRole, Platform } from './players-store';
import type { AuctionKind, RosterShape, StrategyGame } from './strategy';
import { storedJson, storedList } from './view-state';

/**
 * LE OPZIONI GLOBALI: il regolamento della lega, e le squadre reali che non si comprano.
 *
 * Due dichiarazioni in un servizio solo, perché sono la stessa cosa dal punto di vista di chi le fa:
 * valgono per OGNI vista, non appartengono a nessuna, e nel bundle non ci sono - nessuna delle due è
 * misurata, sono l'operatore che dice com'è fatta la sua lega.
 *
 * FINCHÉ STAVANO DENTRO LE PAGINE OGNUNA NE TENEVA UNA COPIA: la Strategia dichiarava budget, squadre e
 * rose in `strategy.setup`, le Buste chiuse budget, tornate e modificatore di difesa in
 * `sealedBid.rules`, e due dichiarazioni della stessa lega prima o poi si contraddicono - il difetto che
 * questo progetto ha già pagato ogni volta che una quantità ha avuto due definizioni. Qui ce n'è una, e
 * le pagine la LEGGONO: dove una pagina offriva già il suo controllo lo tiene, ma scrive questo signal e
 * non una copia sua.
 *
 * Quello che NON entra qui è quello che è di una vista sola: come si legge un blocco della Strategia,
 * i crediti che le Buste tengono da parte per la tornata dopo. Sono preferenze di lettura e scelte di
 * quel momento, non il regolamento.
 */

/** Il regolamento della lega come lo dichiara l'operatore: niente di questo sta nel bundle. */
export interface LeagueSettings {
  /** Su quale listone si gioca - e quindi quale foglio prezza le liste. */
  platform: Platform;
  game: StrategyGame;
  /** Come si compra: cambia la valuta con cui si ordina, non la valutazione. */
  auction: AuctionKind;
  slots: RosterShape;
  budget: number;
  teams: number;
  /**
   * Se un ruolo pieno è un ruolo su cui non si può più offrire.
   *
   * È il fatto più sfruttabile che il regolamento dia su un rivale, perché non è un'ipotesi: una squadra
   * con otto difensori è FUORI dal mercato dei difensori. Dichiarato e mai dedotto - le leghe sono
   * diverse, e leggerlo male cancellerebbe in silenzio dei rivali da un mercato.
   */
  roleLock: boolean;
  /**
   * La lega paga il MODIFICATORE DI DIFESA? Un input, con le parole dell'operatore (25/08/2026).
   *
   * Decide la FORMA di riferimento (il bonus vuole quattro difensori in campo) e non tocca nessuna
   * valutazione: quanto valga il modificatore non è misurato da nessuna parte in questo progetto.
   */
  defenceModifier: boolean;
  /**
   * La lega paga l'R-FACTOR? Un input come il modificatore di difesa, con la stessa natura: un
   * regolamento dichiarato, mai dedotto (operatore, 07/09/2026).
   *
   * Decide se lo SWING conta la costanza — il suo `k = 2/11` è indicizzato sulla scala dell'R-Factor
   * (due punti spalmati sull'undici che li produce), quindi dove il modificatore non esiste il termine
   * non esiste. Non tocca nessun'altra valutazione.
   */
  rFactor: boolean;
  /**
   * La lega paga il +1 A PORTA INVIOLATA al portiere? Stessa natura dei due qui sopra: un regolamento
   * dichiarato (operatore, 07/09/2026). Il bonus NON è nel fantavoto pubblicato (misurato: 1.218
   * portieri su 1.222 a porta inviolata leggono `voto + bonus` senza premio), quindi dove la lega lo
   * paga lo SWING dei portieri lo aggiunge — al differenziale sul calendario, `swing.cleanSheets`.
   */
  cleanSheet: boolean;
  /** Quante tornate dura il mercato a buste chiuse. */
  rounds: number;
  /**
   * IL TETTO DI FVM DEI PRIMI TURNI DEL DRAFT (operatore, 28/09/2026: «non sarà possibile scegliere un
   * calciatore con FVM >= 213 prima del sesto turno»). Un regolamento dichiarato come gli altri: il tavolo
   * non lo pubblica in nessun campo che questo progetto abbia letto, quindi non lo si adotta dalla
   * sessione e non lo si indovina. Vale SOLO in un draft, per noi e per ogni rivale (`auction-plan.PickCap`),
   * e il turno è il numero di scelta della SQUADRA, non il giro del tavolo.
   */
  draftCap: { on: boolean; fvm: number; frozenTurns: number };
  /**
   * LE PORTE al posto dei portieri (operatore, 28/09/2026: «"porte" dovrebbe essere nelle opzioni di lega
   * globali»). Una porta è un CLUB: la prende il primo che chiama un suo portiere qualsiasi, e vale il mix dei
   * suoi portieri pesato sulle partite che giocheranno (`auction-value.portaValuation`). È un regolamento
   * della LEGA e non di una sessione, quindi sta qui e vale per ogni pagina; il tavolo non lo pubblica.
   */
  porte: boolean;
  /**
   * La prima e l'ultima giornata che la COMPETIZIONE copre davvero.
   *
   * Dichiarata e non dedotta: un mercato che si tiene dopo la prima giornata compra per 37 giornate su
   * 38, e leggerlo da «quali giornate sono già giocate» sarebbe indovinare un regolamento. Chi la usa la
   * taglia sul calendario del proprio foglio, perché il numero di giornate è del foglio e non di qui.
   */
  from: number;
  to: number;
}

/**
 * I valori di partenza, e sono il regolamento CLASSIC della lega dell'operatore (3/8/8/6, mille crediti,
 * dieci squadre, modificatore di difesa attivo) - non un default neutro, e dirlo è il punto: dove un
 * foglio del bundle dichiara altri numeri le viste lo SEGNALANO invece di riallinearsi da sole.
 */
export const DEFAULT_LEAGUE: LeagueSettings = {
  platform: 'default',
  game: 'classic',
  auction: 'rilanci',
  slots: { classic: { P: 3, D: 8, C: 8, A: 6 }, mantra: { por: 2, mov: 23 } },
  budget: 1000,
  teams: 10,
  roleLock: true,
  defenceModifier: true,
  rFactor: true,
  cleanSheet: true,
  rounds: 9,
  // La SUA regola, e per questo acceso: dove un draft non la prevede si spegne nelle opzioni, e il
  // pannello dice sempre se è attiva.
  draftCap: { on: true, fvm: 213, frozenTurns: 5 },
  porte: false,
  from: 2,
  to: 38,
};

/** Una squadra reale che si può escludere, con quanti uomini quotati porta su ognuno dei due listoni. */
export interface ClubOption {
  /** `fc_club_id`: la chiave canonica del club. Il NOME non è una chiave, qui come in tutto il progetto. */
  id: number;
  name: string;
  /** Il campionato del CLUB, dalla tabella `clubs` - mai la maggioranza dei suoi giocatori. */
  league: string | null;
  men: Record<Platform, number>;
}

const CLASSIC_ROLES: ClassicRole[] = ['P', 'D', 'C', 'A'];

/** How the excluded-clubs sync names itself among the table's changes. */
const EXCLUDED_LINE = 'Squadre escluse dal tavolo:';

const clubKey = (name: string) => name.normalize('NFC').trim().toLowerCase();

/**
 * THE CLUBS A LIVE TABLE LEAVES OUT: the clubs of this platform's catalogue that have NO man in the session's
 * listone. `null` unless EVERY club the session names is found in the catalogue: a session club spelled
 * another way («AC Milan» against «Milan») would otherwise leave its catalogue twin unmatched, and that twin
 * would be EXCLUDED while its men are on the table (the review of 29/09/2026 - a partial join does not fail
 * quietly, it hides a club). The test is on the SESSION's clubs and not on the catalogue's: a host may well
 * leave out more than half of a listone, and that is exactly the case to follow.
 */
export function excludedFromTable(
  catalogue: readonly ClubOption[],
  platform: Platform,
  sessionClubs: readonly (string | null | undefined)[],
): number[] | null {
  const named = new Set(sessionClubs.filter((club): club is string => !!club).map(clubKey));
  const candidates = catalogue.filter((club) => club.men[platform] > 0);
  if (!candidates.length || !named.size) return null;
  const known = new Set(candidates.map((club) => clubKey(club.name)));
  const found = [...named].filter((club) => known.has(club)).length;
  if (found < named.size) return null;
  return candidates.filter((club) => !named.has(clubKey(club.name))).map((club) => club.id);
}

/** The session clubs `excludedFromTable` cannot find in the catalogue: why it answered null, in names. */
export function unmatchedClubs(
  catalogue: readonly ClubOption[],
  platform: Platform,
  sessionClubs: readonly (string | null | undefined)[],
): string[] {
  const known = new Set(catalogue.filter((club) => club.men[platform] > 0).map((club) => clubKey(club.name)));
  const named = [...new Set(sessionClubs.filter((club): club is string => !!club))];
  return named.filter((club) => !known.has(clubKey(club))).sort((a, b) => a.localeCompare(b, 'it'));
}

@Injectable({ providedIn: 'root' })
export class GlobalOptions {
  /** Il regolamento dichiarato, uno solo per tutta l'app, che sopravvive al refresh. */
  readonly league = storedJson<LeagueSettings>('options.league', readLeague);

  /**
   * Le squadre che si possono escludere, riempite da chi legge il bundle.
   *
   * Come `TimeTravel.packs`: il servizio non conosce il bundle e il pannello non conosce nessuno dei
   * due. Finché è vuoto l'esclusione funziona lo stesso - è tenuta per `fc_club_id`, che non ha bisogno
   * di questo elenco - e quello che manca è solo il modo di SCEGLIERE, che è del pannello.
   */
  readonly catalogue = signal<ClubOption[]>([]);

  /**
   * Gli `fc_club_id` esclusi. Una lista di numeri sul disco, validata: quello che c'è scritto può
   * venire da una versione precedente dell'app, e una preferenza persa va bene, una pagina che non si
   * apre no (vedi `storedList`).
   */
  readonly excludedIds = storedList<number>('options.excludedClubs', isClubId);

  readonly excluded = computed(() => new Set(this.excludedIds()));

  /**
   * Se il pannello è aperto.
   *
   * Sta QUI e non dentro il componente perché non è il componente a decidere quando si apre: le pagine
   * che offrivano il loro «Impostazioni lega» lo aprono, e ora c'è un posto solo dove quella finestra
   * esiste. Un secondo pannello dentro una vista sarebbe una seconda finestra sulla stessa
   * dichiarazione, cioè esattamente la cosa che questo servizio esiste per non avere.
   */
  readonly panelOpen = signal(false);

  /**
   * COSA IL TAVOLO HA CAMBIATO quando ci si e' collegati, in parole. `null` quando non ha cambiato
   * niente - il caso normale a casa sua, dove la lega dichiarata e la sessione dicono le stesse cose.
   */
  readonly adopted = signal<{ code: string; changes: string[] } | null>(null);

  private readonly feed = inject(AuctionFeed);

  constructor() {
    // LA MIGRAZIONE PRIMA DI TUTTO: legge le due dichiarazioni vecchie solo dove qui non c'e' ancora
    // niente, quindi deve girare prima che il tavolo possa scriverci sopra.
    migrateLegacy(this.league);

    /**
     * IL REGOLAMENTO SEGUE IL TAVOLO A CUI TI COLLEGHI (sua richiesta, 24/09/2026: «quando ci si
     * collega ad una astalive si devono aggiornare anche i settaggi di asta e di lega in maniera
     * coerente»).
     *
     * CHIAVE SUL TAVOLO e non sul contenuto, come il nome in asta: si adotta UNA VOLTA per sessione,
     * al momento in cui ci si siede - che e' quando quelle impostazioni sono decise. Cosi' il pannello
     * resta editabile mentre l'asta va, invece di riscrivergli sotto le dita quello che digita a ogni
     * evento dello stream. Il prezzo e' dichiarato: un host che cambia il budget a meta' asta non lo
     * segue, e non e' un caso che qualcuno abbia mai visto.
     *
     * SI ASPETTA CHE LO STATO SIA ARRIVATO: `connect` scrive il codice PRIMA di aprire lo stream,
     * quindi al primo giro le impostazioni non ci sono ancora e adottare li' vorrebbe dire adottare il
     * vuoto. L'effetto dipende anche dal budget e dalle squadre proprio per ripassare quando arrivano.
     */
    // LE PORTE SONO DELLA LEGA, e il feed le segue: il feed non può leggere questo servizio (lo inietta
    // lui, sarebbe un ciclo), quindi la regola gli arriva da qui, in una direzione sola.
    effect(() => {
      const { porte, game, slots } = this.league();
      untracked(() => {
        this.feed.keeperMode.set(porte ? 'goals' : 'players');
        // ...e QUANTE porte: il campo dei portieri della rosa dichiarata, nel vocabolario del gioco.
        this.feed.porteSlots.set(porte ? (game === 'mantra' ? slots.mantra.por : slots.classic.P) : null);
      });
    });

    let adoptedFor: string | null = null;
    effect(() => {
      const code = this.feed.code();
      const budget = this.feed.budget();
      const teams = this.feed.teams().length;
      untracked(() => {
        if (!code || code === DEMO_CODE) {
          // Uscire da un tavolo azzera la memoria: rientrarci dopo deve poter ri-adottare.
          adoptedFor = null;
          this.adopted.set(null);
          return;
        }
        if (code === adoptedFor || !budget || !teams) return;
        adoptedFor = code;
        const { league, changes } = adoptTable(this.league(), this.tableLeague());
        if (changes.length) this.league.set(league);
        // The excluded-clubs line may have landed first (the listone can arrive before the budget): kept.
        const kept = this.adopted()?.code === code ? this.adopted()!.changes.filter((c) => c.startsWith(EXCLUDED_LINE)) : [];
        const all = [...changes, ...kept];
        this.adopted.set(all.length ? { code, changes: all } : null);
      });
    });

    /**
     * LE SQUADRE ESCLUSE SEGUONO IL TAVOLO (sua richiesta, 29/09/2026: «quando ti colleghi ad un'asta-live
     * sincronizza automaticamente le squadre escluse»). Un club e' fuori dal tavolo per due strade, e
     * `feed.listoneClubs` le legge tutt'e due: l'host lo DISATTIVA (`settings.inactiveTeams`, letto su un
     * draft vivo il 29/09/2026 - i suoi calciatori restano nel listone, e il feed li toglie da ogni pool) o
     * lo TOGLIE dal listone. Quindi escluso = un club del catalogo di quella piattaforma che fra i club
     * ATTIVI della sessione non ha nessun calciatore; incluso tutto il resto.
     *
     * Una volta per tavolo, come il regolamento, e aspettando che listone e catalogo siano arrivati tutti e
     * due. E una GUARDIA contro il join rotto: se anche un solo club della sessione non si trova nel
     * catalogo, le esclusioni non si toccano (`excludedFromTable`).
     */
    let excludedFor: string | null = null;
    effect(() => {
      const code = this.feed.code();
      const platform = this.feed.platform();
      const clubs = this.feed.listoneClubs();
      const catalogue = this.catalogue();
      untracked(() => {
        if (!code || code === DEMO_CODE) {
          excludedFor = null;
          return;
        }
        if (code === excludedFor || !platform || !clubs.length || !catalogue.length) return;
        const synced = excludedFromTable(catalogue, platform, clubs);
        if (!synced) {
          // LA GUARDIA NON TACE (30/09/2026): un join rotto lascia le esclusioni come stavano, e senza una riga
          // si leggerebbe come «il tavolo non esclude nessuno». La riga nomina i club che non si riconoscono.
          const unknown = unmatchedClubs(catalogue, platform, clubs);
          if (!unknown.length) return;
          excludedFor = code;
          const line = `${EXCLUDED_LINE} non sincronizzate, ${unknown.length} club del tavolo non riconosciuti (${unknown
            .slice(0, 4)
            .join(', ')}${unknown.length > 4 ? ', …' : ''})`;
          const current = this.adopted();
          this.adopted.set({ code, changes: [...(current?.code === code ? current.changes : []), line] });
          return;
        }
        excludedFor = code;
        const before = this.excluded();
        const same = synced.length === before.size && synced.every((id) => before.has(id));
        if (same) return;
        this.excludedIds.set(synced);
        const line = synced.length
          ? `${EXCLUDED_LINE} ${synced.length} (${catalogue
              .filter((club) => synced.includes(club.id))
              .map((club) => club.name)
              .sort((a, b) => a.localeCompare(b, 'it'))
              .slice(0, 6)
              .join(', ')}${synced.length > 6 ? ', …' : ''})`
          : `${EXCLUDED_LINE} nessuna`;
        const current = this.adopted();
        this.adopted.set({ code, changes: [...(current?.code === code ? current.changes : []), line] });
      });
    });
  }

  /** Le sei cose che una sessione sa della lega, tradotte nel vocabolario di questo servizio. */
  private tableLeague(): TableLeague {
    const roles = this.feed.league()['roles'] ?? {};
    const slot = (zone: string): number | null => {
      const value = roles[zone];
      const declared = Array.isArray(value) ? value[0] : value;
      return Number(declared) > 0 ? Number(declared) : null;
    };
    const classic = { P: slot('gk'), D: slot('def'), C: slot('mid'), A: slot('atk') };
    const mantra = { por: slot('gk'), mov: slot('mov') };
    const market = this.feed.market();
    return {
      platform: this.feed.platform(),
      game: this.feed.isMantra() ? 'mantra' : 'classic',
      auction: market === MarketType.Draft ? 'draft' : market === MarketType.Bids ? 'rilanci' : null,
      budget: this.feed.budget() || null,
      teams: this.feed.teams().length || null,
      slots: {
        ...(CLASSIC_ROLES.every((role) => classic[role] != null)
          ? { classic: classic as Record<ClassicRole, number> }
          : {}),
        ...(mantra.por != null && mantra.mov != null
          ? { mantra: { por: mantra.por, mov: mantra.mov } }
          : {}),
      },
    };
  }

  open(): void {
    this.panelOpen.set(true);
  }

  close(): void {
    this.panelOpen.set(false);
  }

  /** Le squadre escluse che il catalogo sa nominare, per poterle DIRE a schermo e non solo contare. */
  readonly excludedClubs = computed<ClubOption[]>(() => {
    const out = this.excluded();
    return this.catalogue()
      .filter((club) => out.has(club.id))
      .sort((left, right) => left.name.localeCompare(right.name, 'it'));
  });

  /**
   * Quanti uomini quotati l'esclusione nasconde, per listone.
   *
   * Un filtro globale è invisibile per costruzione, e questa app ha già una regola su questo: un filtro
   * attivo porta la sua etichetta a schermo, con quanti uomini sta nascondendo. Qui il numero lo dà il
   * servizio, così ovunque lo si dica lo si dice allo stesso modo.
   */
  readonly hidden = computed<Record<Platform, number>>(() => {
    const out: Record<Platform, number> = { default: 0, euro: 0 };
    for (const club of this.excludedClubs()) {
      out.default += club.men.default;
      out.euro += club.men.euro;
    }
    return out;
  });

  /**
   * Se un uomo di questo club resta in lista.
   *
   * SENZA CLUB NON SI ESCLUDE NESSUNO: «vuoto = ignoto, mai zero» - non sapere di che squadra è uno non
   * è una prova che sia di una squadra esclusa. Misurato sul bundle del 27/08/2026 prima di scriverlo:
   * 0 righe di rosa della stagione bersaglio senza `fc_club_id`, e 0 nomi di club dei tre fogli assenti
   * dalla tabella `clubs` - quindi oggi il ramo non scatta mai, ed è una guardia e non un ripiego.
   */
  keeps(clubId: number | null | undefined): boolean {
    return clubId == null || !this.excluded().has(clubId);
  }

  /** Lo stesso, su una lista: torna la lista STESSA quando non c'è niente da escludere. */
  keep<T extends { clubId: number | null }>(rows: T[]): T[] {
    const out = this.excluded();
    if (!out.size) return rows;
    return rows.filter((row) => row.clubId == null || !out.has(row.clubId));
  }

  /** Una parte del regolamento, lasciando stare il resto. */
  patch(change: Partial<LeagueSettings>): void {
    this.league.update((current) => ({ ...current, ...change }));
  }

  /**
   * La composizione della rosa nel vocabolario del gioco scelto.
   *
   * Un numero che non è un numero non entra: `nz-input-number` manda `null` nell'istante in cui la
   * casella viene SVUOTATA, e quel null salvato tornerebbe dopo un refresh dentro ogni conto.
   */
  patchClassic(role: ClassicRole, men: number): void {
    if (!Number.isFinite(men)) return;
    this.league.update((current) => ({
      ...current,
      slots: { ...current.slots, classic: { ...current.slots.classic, [role]: men } },
    }));
  }

  patchMantra(key: 'por' | 'mov', men: number): void {
    if (!Number.isFinite(men)) return;
    this.league.update((current) => ({
      ...current,
      slots: { ...current.slots, mantra: { ...current.slots.mantra, [key]: men } },
    }));
  }

  /** Un numero del regolamento, con la stessa guardia della casella svuotata. */
  patchNumber(key: 'budget' | 'teams' | 'rounds' | 'from' | 'to', value: number): void {
    if (!Number.isFinite(value)) return;
    this.patch({ [key]: value } as Partial<LeagueSettings>);
  }

  /** Esclude o riammette una squadra. */
  setExcluded(clubId: number, excluded: boolean): void {
    this.excludedIds.update((ids) => {
      const kept = ids.filter((one) => one !== clubId);
      return excluded ? [...kept, clubId] : kept;
    });
  }

  clearExcluded(): void {
    this.excludedIds.set([]);
  }
}

/**
 * QUELLO CHE LE DUE PAGINE AVEVANO GIÀ DICHIARATO, portato qui una volta sola.
 *
 * Prima di questo servizio il regolamento stava in due posti - `strategy.setup` e `sealedBid.rules` -
 * e non leggerli vorrebbe dire che chi aveva dichiarato la sua lega se la ritrova ai valori di partenza
 * senza che nessuno glielo dica: un azzeramento silenzioso, che è la cosa che questo progetto ha già
 * pagato altrove. Si legge solo quando qui non c'è ancora niente, quindi non può sovrascrivere una
 * dichiarazione fatta con il pannello nuovo.
 *
 * DOVE I DUE SI SOVRAPPONGONO (il budget) VINCE LA STRATEGIA, perché è la pagina che dichiara la lega
 * per intero - listone, gioco, rose, partecipanti - mentre le Buste ne dichiaravano una fetta; e i campi
 * che solo le Buste avevano (tornate, ruolo pieno, modificatore, finestra) vengono da lì, perché nessun
 * altro li aveva.
 */
function migrateLegacy(league: WritableSignal<LeagueSettings>): void {
  const raw = (key: string): Record<string, unknown> | null => {
    try {
      const text = localStorage.getItem(`fantassistant.${key}`);
      const parsed: unknown = text == null ? null : JSON.parse(text);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  try {
    if (localStorage.getItem('fantassistant.options.league') != null) return;
  } catch {
    return;                                   // niente memoria: non c'è niente da migrare
  }
  const strategy = raw('strategy.setup');
  const sealed = raw('sealedBid.rules');
  if (!strategy && !sealed) return;
  league.set(readLeague({ ...(sealed ?? {}), ...(strategy ?? {}) }));
}

/**
 * QUELLO CHE UN TAVOLO SA DELLA LEGA. Sei campi e non tredici, e la differenza e' la natura del fatto.
 *
 * fanta-asta-live pubblica il budget, quanti partecipanti, quale gioco, le rose, quale listone e con
 * che meccanismo si compra: sono le impostazioni della SESSIONE, e chi si collega le eredita. Non sa
 * niente del modificatore di difesa, dell'R-Factor, del +1 a porta inviolata, del blocco di un ruolo
 * pieno, di quante tornate dura un mercato a buste ne' delle giornate coperte: quelle restano
 * DICHIARATE, perche' sono il regolamento della sua lega e non della sessione.
 */
export interface TableLeague {
  platform: Platform | null;
  game: StrategyGame | null;
  auction: AuctionKind | null;
  budget: number | null;
  teams: number | null;
  slots: Partial<RosterShape> | null;
}

/**
 * Il regolamento dichiarato con sopra quello che il tavolo DICE, e l'elenco di cosa e' cambiato.
 *
 * Restituisce le PAROLE e non solo i numeri perche' un'adozione silenziosa e' peggio di nessuna
 * adozione: cambiare il listone sotto la Strategia significa cambiare il foglio che la prezza, e uno
 * schermo che si riordina senza dire perche' si legge come un guasto. La regola di casa - «un vincolo
 * che agisce in silenzio e' indistinguibile da un ordinamento rotto» - applicata a una dichiarazione.
 *
 * E si adotta solo cio' che il tavolo sa DAVVERO: un campo che la sessione non porta arriva `null` e
 * lascia stare il valore dichiarato, invece di riportarlo al default. «Vuoto = ignoto, mai zero».
 */
export function adoptTable(
  current: LeagueSettings,
  table: TableLeague,
): { league: LeagueSettings; changes: string[] } {
  const league: LeagueSettings = { ...current, slots: { ...current.slots } };
  const changes: string[] = [];
  const say = (what: string) => changes.push(what);

  if (table.platform && table.platform !== league.platform) {
    league.platform = table.platform;
    say(`listone ${table.platform === 'euro' ? 'EuroLeghe' : 'Serie A'}`);
  }
  if (table.game && table.game !== league.game) {
    league.game = table.game;
    say(table.game);
  }
  if (table.auction && table.auction !== league.auction) {
    league.auction = table.auction;
    say(table.auction === 'draft' ? 'draft' : 'rilanci');
  }
  if (table.budget && table.budget !== league.budget) {
    league.budget = table.budget;
    say(`${table.budget} crediti`);
  }
  if (table.teams && table.teams !== league.teams) {
    league.teams = table.teams;
    say(`${table.teams} squadre`);
  }

  const classic = table.slots?.classic;
  if (classic && CLASSIC_ROLES.some((role) => classic[role] !== league.slots.classic[role])) {
    league.slots = { ...league.slots, classic: { ...classic } };
    say(`rose ${CLASSIC_ROLES.map((role) => classic[role]).join('-')}`);
  }
  const mantra = table.slots?.mantra;
  if (mantra && (mantra.por !== league.slots.mantra.por || mantra.mov !== league.slots.mantra.mov)) {
    league.slots = { ...league.slots, mantra: { ...mantra } };
    say(`rose ${mantra.por}+${mantra.mov}`);
  }

  return { league, changes };
}

function isClubId(one: unknown): one is number {
  return typeof one === 'number' && Number.isFinite(one);
}

/**
 * Quello che c'è sul disco sopra i valori di partenza, campo per campo e mai con uno spread.
 *
 * Una versione precedente può aver salvato un oggetto senza `slots.mantra`, e uno spread lo lascerebbe
 * `undefined` dentro un conto; un numero svuotato arriva `null` e va lasciato fuori, o il budget torna
 * nullo dopo un refresh e ogni tetto crolla a zero.
 */
function readLeague(raw: unknown): LeagueSettings {
  const stored = (raw ?? {}) as Partial<LeagueSettings>;
  const slots = stored.slots ?? DEFAULT_LEAGUE.slots;
  const classic = { ...DEFAULT_LEAGUE.slots.classic };
  for (const role of CLASSIC_ROLES) {
    const men = slots.classic?.[role];
    if (typeof men === 'number' && Number.isFinite(men)) classic[role] = men;
  }
  return {
    platform: stored.platform === 'euro' ? 'euro' : 'default',
    game: stored.game === 'mantra' ? 'mantra' : 'classic',
    auction: stored.auction === 'draft' ? 'draft' : 'rilanci',
    slots: {
      classic,
      mantra: {
        por: number(slots.mantra?.por, DEFAULT_LEAGUE.slots.mantra.por),
        mov: number(slots.mantra?.mov, DEFAULT_LEAGUE.slots.mantra.mov),
      },
    },
    budget: number(stored.budget, DEFAULT_LEAGUE.budget),
    teams: number(stored.teams, DEFAULT_LEAGUE.teams),
    roleLock: typeof stored.roleLock === 'boolean' ? stored.roleLock : DEFAULT_LEAGUE.roleLock,
    defenceModifier:
      typeof stored.defenceModifier === 'boolean'
        ? stored.defenceModifier
        : DEFAULT_LEAGUE.defenceModifier,
    rFactor: typeof stored.rFactor === 'boolean' ? stored.rFactor : DEFAULT_LEAGUE.rFactor,
    cleanSheet:
      typeof stored.cleanSheet === 'boolean' ? stored.cleanSheet : DEFAULT_LEAGUE.cleanSheet,
    rounds: number(stored.rounds, DEFAULT_LEAGUE.rounds),
    porte: typeof stored.porte === 'boolean' ? stored.porte : legacyPorte(),
    draftCap: {
      on: typeof stored.draftCap?.on === 'boolean' ? stored.draftCap.on : DEFAULT_LEAGUE.draftCap.on,
      fvm: number(stored.draftCap?.fvm, DEFAULT_LEAGUE.draftCap.fvm),
      // Il primo salvataggio (28/09/2026, stesso giorno) scriveva il turno da cui SI SBLOCCA: si legge ancora,
      // o chi l'aveva impostato a mano tornerebbe al valore di partenza senza che nessuno glielo dica.
      frozenTurns: number(
        stored.draftCap?.frozenTurns,
        typeof (stored.draftCap as { fromTurn?: unknown } | undefined)?.fromTurn === 'number'
          ? (stored.draftCap as unknown as { fromTurn: number }).fromTurn - 1
          : DEFAULT_LEAGUE.draftCap.frozenTurns,
      ),
    },
    from: number(stored.from, DEFAULT_LEAGUE.from),
    to: number(stored.to, DEFAULT_LEAGUE.to),
  };
}

/**
 * Dove la regola delle porte stava PRIMA di essere una regola di lega: dentro la sessione d'asta salvata
 * (`fantassistant.auction`, campo `keeperMode`). Si legge solo quando la lega non la dichiara ancora, o chi
 * l'aveva accesa se la ritroverebbe spenta senza che nessuno glielo dica.
 */
function legacyPorte(): boolean {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem('fantassistant.auction') ?? 'null');
    return !!saved && typeof saved === 'object' && (saved as { keeperMode?: unknown }).keeperMode === 'goals';
  } catch {
    return DEFAULT_LEAGUE.porte;
  }
}

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
