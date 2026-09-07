import { Injectable, WritableSignal, computed, signal } from '@angular/core';

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

  constructor() {
    migrateLegacy(this.league);
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
    from: number(stored.from, DEFAULT_LEAGUE.from),
    to: number(stored.to, DEFAULT_LEAGUE.to),
  };
}

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
