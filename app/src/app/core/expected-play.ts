/**
 * QUANTE GIORNATE GIOCHERA' DAVVERO, con l'assicurazione dentro: una formula sola per tutta l'app.
 *
 * Richiesta dell'operatore (04/09/2026): «il "di piu'" che chiedo sugli infortuni va misurato in ottica
 * pessimistica, dobbiamo evitare le situazioni disastrose che magari capitano piu' di rado ma che
 * comunque ti "inguaiano" la stagione. Se cammino sul ciglio di un burrone sono quasi sicuro che non
 * cadro' ... ma io voglio evitare anche questo evento raro e cammino distante dal ciglio 1 metro.
 * Piuttosto che cambiare il toolkit meglio prevedere un "di piu'" come assicurazione implementata solo
 * nell'app (che comunque deve essere una formula centralizzata da usare in ogni pagina e sezione).»
 *
 * QUELLO CHE QUESTO FILE NON FA: prevedere un calciatore. Le presenze attese le calcola il toolkit e
 * viaggiano sul foglio (`engine_pv_pred`, o `est_pv` dove il motore non prezza); qui si SOTTRAE, e si
 * sottrae solo roba che e' gia' nel bundle - una finestra d'infortunio aperta, che e' un fatto, e la
 * storia dei suoi stop, che e' una misura. Niente di quello che c'e' qui inventa una previsione, e per
 * questo non passa dal gate: e' una scelta di RISCHIO dell'operatore, dichiarata e revocabile in due
 * costanti.
 *
 * TRE PASSI, e ognuno risponde a una domanda diversa.
 *
 *  0. LA DRITTA, che viene prima di tutto perche' e' una DICHIARAZIONE e non una previsione (dal
 *     07/09/2026, `core/player-rulings.ts`): dove l'operatore ha dichiarato un gradino di titolarita',
 *     la base sono le giornate che quel gradino comporta - «io ho delle conoscenze che i dati non
 *     hanno». Precedenza massima, come `board_rulings.json` sul modulo di un club, e revocabile con un
 *     click. E' anche IDEMPOTENTE: dove la dritta ha gia' riscritto il Pa a monte (`ValuationStore`),
 *     questo passo ricalcola lo stesso numero, perche' fissa una base ASSOLUTA invece di moltiplicare -
 *     due applicazioni della stessa dichiarazione non si sommano.
 *
 *  1. LA BASE. Il Pa del foglio - ma dove il motore NON prezza il suo calcio (`est_basis` diverso da
 *     `core`, cioe' un arrivo dall'estero o una stagione troppo corta) la stima scende su una costante
 *     di ruolo, e li' la board ne sa di piu': Kolo Muani il 03/09/2026 leggeva `est_pv` 19,6 su 38
 *     mentre l'undici tipo della Juventus lo disegnava titolare con 81 minuti. E' il metro della
 *     PLANCIA («Kolo M. e Woltemade sono valutati in maniera molto piu' realistica sulla PLANCIA ...
 *     adottiamo il metro della PLANCIA allora»), scritto nella valuta di questa pagina: la quota di
 *     partite che il pannello gli da' (`desc_titolarita_play`) per le giornate che restano.
 *
 *  2. LA FINESTRA APERTA. Le giornate del suo club che cadono prima del rientro (`injury-window.ts`,
 *     04/09/2026). E' un FATTO - la fonte pubblica la data - e va tolto per intero: Yildiz salta 10
 *     delle 36 giornate che restano, quindi non puo' giocarne 26.
 *
 *  3. L'ASSICURAZIONE, che e' il «di piu'». Il Pa del motore contiene gia' uno sconto per gli infortuni,
 *     ma e' lo sconto della stagione MEDIA; questo aggiunge la differenza fra la sua stagione media e la
 *     sua stagione PEGGIORE, che e' esattamente «cammino un metro piu' in la'». Misurato sul bundle del
 *     04/09/2026, 533 quotati di Serie A senza asterisco, tre stagioni di archivio: per stagione-uomo si
 *     perdono in mediana **1** giornata, in media **4,93**, al p75 **7**, al p90 **15**, al p95 **22**;
 *     e sui 330 uomini con almeno due stagioni di storia la MEDIA delle loro medie e' **8,4** contro una
 *     media dei loro MASSIMI di **13,7**. La stagione brutta costa 1,63 volte quella media, e quel
 *     rapporto e' il metro di distanza dal ciglio.
 *
 * PERCHE' SI SOTTRAE LA DIFFERENZA E NON IL TOTALE: sottrarre tutte le giornate perse conterebbe due
 * volte quelle che il motore ha gia' scontato. La quantita' che manca al numero del foglio e' solo lo
 * SCARTO fra l'anno tipico e l'anno brutto.
 */

import { Injectable, computed, inject, signal } from '@angular/core';

import { Bundle } from './bundle';
import { OutWindow, outWindow } from './injury-window';
import { CalendarBook, CalendarFile, calendarBookFrom } from './keeper-pairs';
import { PlayerRulings } from './player-rulings';
import { FRAGILITY_YEARS, PlayerStatus, Spell } from './player-status';
import type { Platform } from './players-store';

/**
 * LO SCARTO fra la stagione peggiore e quella tipica, per chi non ha abbastanza storia: 2,1 giornate.
 *
 * Misurato e non scelto: sui 533 quotati di Serie A senza asterisco il p75 delle giornate perse in una
 * stagione-uomo e' 7 contro una media di 4,93. Il p75 e non la mediana perche' la domanda e' «quanto puo'
 * andare storto», e non il p90 (15) perche' quello e' il disastro e non l'anno brutto: chi non ha storia
 * non e' un uomo fragile, e trattarlo come tale sarebbe inventare un fatto su di lui.
 *
 * SI APPLICA ANCHE A CHI NON HA NESSUNO STOP IN ARCHIVIO, ed e' una scelta dichiarata contro la regola
 * di casa «vuoto = ignoto, mai zero»: qui l'ignoto non e' zero, e' il rischio medio del listone. E' la
 * frase dell'operatore letta alla lettera - il metro dal ciglio lo si tiene anche dove nessuno e' mai
 * caduto - e si spegne mettendo questa costante a zero.
 */
export const INSURANCE_DEFAULT_ROUNDS = 2.1;

/**
 * Quante stagioni di storia servono perche' sia LA SUA e non quella del listone.
 *
 * Due, perche' con una sola «la peggiore» e «la media» sono lo stesso numero e l'assicurazione sarebbe
 * zero per costruzione proprio su chi ha avuto un anno brutto.
 */
export const INSURANCE_MIN_SEASONS = 2;

/**
 * Il tetto: nessuno perde piu' di questa quota del calendario per assicurazione.
 *
 * Dichiarato, e la ragione e' la stessa di `presence.availability_floor` nel toolkit: una storia brutta
 * e' uno sconto, non una sentenza che non giochera'. Senza tetto un uomo con due stagioni distrutte
 * uscirebbe da ogni lista, e la lista smetterebbe di essere una lista.
 */
export const INSURANCE_CAP_SHARE = 0.35;

/** Da quale mese comincia una stagione, per attribuire uno stop all'annata giusta. */
const SEASON_START_MONTH = 7;

/** Quanto dura una giornata di campionato in giorni: misurato sul calendario vero, non convenuto. */
export function roundDaysOf(firstMatch: string | null, lastMatch: string | null, rounds: number): number {
  if (!firstMatch || !lastMatch || rounds <= 0) return 7.5;
  const span = (Date.parse(lastMatch) - Date.parse(firstMatch)) / 86_400_000;
  return span > 0 ? span / rounds : 7.5;
}

/** La stagione a cui appartiene una data: `2026-08-24` -> `2026-27`. */
function seasonOf(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const start = month >= SEASON_START_MONTH ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Le giornate perse in ognuna delle sue ULTIME stagioni, dalla storia degli stop.
 *
 * LA FINESTRA E' TRE ANNI, la stessa di `fragilityOf` e degli `injury_weights` del toolkit (1,0 · 0,6 ·
 * 0,35 su tre stagioni), e non e' un dettaglio: senza di lei si legge la CARRIERA, e la carriera contiene
 * un uomo diverso. Trovato dall'operatore il 05/09/2026 su una domanda di tre parole - «come mai Malen ha
 * solo 14 Pa?» - e la risposta era un'operazione al ginocchio del **2019-20**, 242 giorni cioe' 35,7
 * giornate, che gli faceva scattare il TETTO dell'assicurazione (12,6 giornate su 26,7 attese) sette anni
 * dopo. Nelle sue ultime tre stagioni ha perso 4,4 · 1,5 · 0.
 *
 * E UNA STAGIONE SENZA STOP VALE ZERO E NON MANCA. Contare solo le annate in cui si e' fatto male alza la
 * media - il denominatore diventa «le sue stagioni brutte» - e schiaccia proprio lo SCARTO che
 * l'assicurazione deve misurare. Dentro la finestra ogni stagione c'e', con il suo zero quando e' sana.
 *
 * In GIORNATE e non in giorni, perche' e' l'unita' in cui si prezza («l'unita' e' la partita»): due mesi
 * di novembre non valgono due mesi di giugno, e il fattore viene dal calendario vero. Uno stop e'
 * attribuito alla stagione in cui e' COMINCIATO: spezzarlo fra due annate darebbe due mezze stagioni
 * brutte al posto di una brutta, che e' l'opposto di quello che l'assicurazione deve vedere.
 */
export function seasonLosses(
  spells: readonly Spell[],
  roundDays: number,
  today: string,
  years: number = FRAGILITY_YEARS,
): Map<string, number> {
  const out = new Map<string, number>();
  // Le stagioni della finestra, tutte, cosi' un'annata sana entra come lo ZERO che e' - e sono le
  // COMPLETE: quella in corso e' lunga due giornate, quindi il suo zero non e' una stagione sana, e
  // contarlo regala a chiunque un'annata perfetta che abbassa la media e gonfia lo scarto proprio su chi
  // sta male da anni (Kean: 6,1 giornate di assicurazione contro 2,1, perche' le sue tre stagioni vere
  // sono 14,3 - 10,3 - 14,8, cioe' stare male E' la sua normalita' e il motore l'ha gia' scontata).
  // Quello che sta succedendo ADESSO non e' un rischio da assicurare: e' un fatto, e lo toglie gia' la
  // finestra dello stop aperto.
  const first = Number(seasonOf(today).slice(0, 4)) - 1;
  for (let back = 0; back < years; back += 1) {
    const start = first - back;
    out.set(`${start}-${String((start + 1) % 100).padStart(2, '0')}`, 0);
  }
  for (const spell of spells) {
    if (!spell.from) continue;
    const season = seasonOf(spell.from);
    if (!out.has(season)) continue;
    const end = spell.to && spell.to < today ? spell.to : today;
    const days = spell.days ?? Math.max(0, (Date.parse(end) - Date.parse(spell.from)) / 86_400_000);
    if (!(days > 0)) continue;
    out.set(season, (out.get(season) ?? 0) + days / roundDays);
  }
  return out;
}

/** Lo scarto fra la sua stagione peggiore e la sua media: il «di piu'» che si assicura. */
export function insuranceRounds(losses: ReadonlyMap<string, number>): number {
  const seasons = [...losses.values()];
  if (seasons.length < INSURANCE_MIN_SEASONS) return INSURANCE_DEFAULT_ROUNDS;
  const mean = seasons.reduce((sum, one) => sum + one, 0) / seasons.length;
  const worst = Math.max(...seasons);
  return Math.max(worst - mean, INSURANCE_DEFAULT_ROUNDS);
}

/** Quello che serve per prezzare un uomo: il foglio, la board, la finestra aperta e la sua storia. */
export interface PlayInput {
  /** Le giornate che il foglio sta prevedendo (`matchdays_target`): quelle che RESTANO. */
  matchdays: number | null;
  /** Il Pa del foglio, motore o stima. */
  pv: number | null;
  /** True quando quel Pa e' un ripiego e non il calcio che ha giocato (`est_basis` != core). */
  pvIsEstimate: boolean;
  /** La quota di partite che il pannello gli da' (`desc_titolarita_play`), senza sconto infortuni. */
  playShare: number | null;
  /**
   * LA QUOTA CHE LA DRITTA DELL'OPERATORE DICHIARA, o null se non ne ha dichiarata nessuna - e null
   * anche quando la sua dritta CONFERMA il foglio, perche' allora non c'e' niente da riscrivere
   * (`player-rulings.ruledShare`).
   */
  ruled: number | null;
  /** La finestra dello stop APERTO, quando c'e' una data di rientro (`injury-window.ts`). */
  out: OutWindow | null;
  /** La sua storia di stop, per l'assicurazione. */
  losses: ReadonlyMap<string, number>;
}

/** Il conto, con ogni pezzo separato: una riga puo' spiegare il proprio numero invece di subirlo. */
export interface PlayOutlook {
  /** Le giornate che restano. */
  matchdays: number | null;
  /** Il punto di partenza, dopo l'eventuale metro della plancia. */
  base: number | null;
  /** Chi ha parlato: il motore, il ripiego del foglio, la board, o l'OPERATORE con una dritta. */
  basis: 'core' | 'sheet' | 'board' | 'ruled';
  /** Giornate certe perse per lo stop aperto. */
  out: number;
  /**
   * ...e la FINESTRA da cui quel numero viene, cosi' chi disegna non deve ricostruirla.
   *
   * La plancia la calcolava per conto suo accanto a questa chiamata - due invocazioni della stessa
   * funzione pura sugli stessi ingressi, cioe' due strade per un fatto solo - e la Strategia non ce
   * l'aveva affatto, quindi la sua card non poteva dire PERCHE' le presenze fossero ridotte. Esce da
   * qui perche' e' qui che viene letta.
   */
  window: OutWindow | null;
  /** ...e quelle tolte per assicurazione. */
  insurance: number;
  /** Quello che resta: mai sotto zero. */
  expected: number | null;
  /**
   * Il fattore con cui si riprezza un numero DEL FOGLIO che moltiplica le presenze: `expected / pv`.
   *
   * IL DENOMINATORE E' LA `pv` DEL FOGLIO e non `base`, ed e' un errore di unita' che questo file ha
   * gia' commesso una volta (04/09/2026, trovato il giorno dopo su Kolo Muani): il surplus del foglio
   * e' `(fm - rimpiazzo) x est_pv`, quindi va scalato contro EST_PV. Dove `base` e' il metro della
   * plancia - un numero piu' alto, costruito sulla board - dividere per lui faceva SCENDERE il surplus
   * di un uomo di cui avevamo appena alzato le presenze: 19,7 diventavano 16,0 invece di 22,3.
   *
   * 1 = niente da riprezzare (nessuna pv sul foglio, o niente da togliere).
   */
  factor: number;
}

/**
 * IL CONTO, in un posto solo (vedi l'intestazione del file per le tre domande e i numeri misurati).
 *
 * Puro apposta: nessun servizio, nessun signal, nessuna data letta dall'orologio. Chi lo chiama porta il
 * bundle che ha gia' in mano, e un test lo raggiunge senza un browser.
 */
export function expectedPlay(input: PlayInput): PlayOutlook {
  const matchdays = input.matchdays ?? null;
  let base = input.pv;
  let basis: PlayOutlook['basis'] = input.pvIsEstimate ? 'sheet' : 'core';
  // IL METRO DELLA PLANCIA, solo dove il foglio ripiega: la board sa che gioca, la costante di ruolo no.
  if (input.pvIsEstimate && matchdays && input.playShare != null) {
    base = input.playShare * matchdays;
    basis = 'board';
  }
  // ...E LA DRITTA SOPRA TUTT'E DUE, perche' e' una dichiarazione: sostituisce la base invece di
  // scontarla, quindi applicarla due volte (qui e a monte) da' lo stesso numero. Senza `matchdays` una
  // quota non e' un numero di giornate, e allora la dichiarazione non prezza - resta la parola.
  if (input.ruled != null && matchdays) {
    base = input.ruled * matchdays;
    basis = 'ruled';
  }
  if (base == null) {
    return {
      matchdays, base: null, basis, out: 0, insurance: 0, expected: null, factor: 1,
      window: input.out,
    };
  }
  const out = Math.min(input.out?.lost ?? 0, base);
  const cap = matchdays ? matchdays * INSURANCE_CAP_SHARE : base * INSURANCE_CAP_SHARE;
  const insurance = Math.min(insuranceRounds(input.losses), cap, Math.max(base - out, 0));
  const expected = Math.max(base - out - insurance, 0);
  return {
    matchdays,
    base,
    basis,
    out,
    window: input.out,
    insurance,
    expected,
    // ...e il fattore contro la `pv` DEL FOGLIO, che e' quella su cui il suo surplus e' costruito.
    factor: input.pv && input.pv > 0 ? expected / input.pv : 1,
  };
}


/**
 * LA FORMULA UNICA, con le sue fonti attaccate: quello che ogni pagina chiama.
 *
 * L'aritmetica sta nella funzione pura qui sopra e questa classe non ne aggiunge: mette insieme il
 * foglio (che porta il chiamante), il calendario del bundle e la storia degli stop, che sono le tre cose
 * che vivono in tre servizi diversi. Una copia di questo conto in ogni vista sarebbe la stessa lista con
 * due valutazioni per lo stesso uomo, che e' il difetto che questo progetto paga da sempre.
 */
@Injectable({ providedIn: 'root' })
export class ExpectedPlay {
  private readonly status = inject(PlayerStatus);
  private readonly bundle = inject(Bundle);
  /** Le dritte dichiarate: la base che scavalca il foglio, e la misura di quanto vale una parola. */
  private readonly rulings = inject(PlayerRulings);
  private readonly file = signal<CalendarFile | null>(null);

  /** Il calendario del bundle, letto una volta sola: `Bundle.calendar()` tiene la sua promessa in cache. */
  readonly book = computed<CalendarBook | null>(() => calendarBookFrom(this.file()));

  constructor() {
    void this.bundle.calendar().then((one) => this.file.set(one));
  }

  /**
   * Quanto dura una giornata, MISURATA sul calendario vero invece che convenuta.
   *
   * Serve a convertire in giornate i giorni di uno stop passato: la storia degli infortuni e' in giorni,
   * il prezzo e' in giornate, e senza il fattore le due unita' finirebbero nella stessa sottrazione. Si
   * legge sul campionato piu' LUNGO che il bundle porta - una stagione e' una stagione, e prendere il
   * primo che capita farebbe dipendere una costante dall'ordine delle chiavi di un JSON.
   */
  private readonly roundDays = computed(() => {
    const file = this.file();
    let best: { first: string; last: string; rounds: number } | null = null;
    for (const league of Object.values(file?.leagues ?? {})) {
      const at = league.columns?.indexOf('date') ?? -1;
      if (at < 0 || !league.matches?.length) continue;
      const dates = league.matches.map((row) => String(row[at] ?? '')).filter(Boolean).sort();
      if (!dates.length) continue;
      if (!best || league.rounds > best.rounds) {
        best = { first: dates[0], last: dates[dates.length - 1], rounds: league.rounds };
      }
    }
    return roundDaysOf(best?.first ?? null, best?.last ?? null, best?.rounds ?? 0);
  });

  /**
   * Il conto per un uomo, sul foglio che lo sta prezzando.
   *
   * `sheet` sono i numeri che la pagina ha gia' in mano (il lettore unico delle colonne del motore), e
   * non si rileggono qui: due lettori dello stesso foglio danno a un uomo due valutazioni.
   */
  outlook(
    /**
     * `platform` perche' la conversione «una parola -> quante giornate» e' misurata sulla POPOLAZIONE
     * di un foglio, e i fogli sono due: una quota presa dall'altro listone sarebbe la mediana di un
     * altro gruppo di uomini.
     */
    man: { id: number; club: string; platform: Platform },
    sheet: {
      pv: number | null;
      pvIsEstimate: boolean;
      playShare: number | null;
      /** Il gradino che il FOGLIO gli da': serve a capire se una dritta conferma o corregge. */
      titolarita?: string | null;
    },
    matchdays: number | null,
  ): PlayOutlook {
    const injury = this.status.openInjury(man.id);
    const window = outWindow({
      calendar: this.book()?.forClub(man.club) ?? null,
      club: man.club,
      today: this.status.today(),
      until: injury?.until ?? null,
      seasonOver: injury?.seasonOver,
      source: injury?.source,
    });
    return expectedPlay({
      matchdays,
      pv: sheet.pv,
      pvIsEstimate: sheet.pvIsEstimate,
      playShare: sheet.playShare,
      // LA DRITTA DELL'OPERATORE, letta qui e non dal chiamante: e' la stessa ragione per cui il conto
      // vive in un posto solo - quattro pagine che se la andassero a prendere darebbero a un uomo
      // quattro presenze attese. Null quando non ne ha dichiarata nessuna o quando la sua conferma il
      // foglio.
      // ...la QUOTA della dritta: i MINUTI sono l'altro asse della stessa parola e non entrano qui -
      // le presenze non si moltiplicano per i minuti, e chi li mostra li legge da `EngineExpectation`.
      ruled: this.rulings.shareFor(man.platform, man.id, sheet.titolarita ?? null)?.play ?? null,
      out: window,
      losses: seasonLosses(this.status.spellsOf(man.id), this.roundDays(), this.status.today()),
    });
  }
}
