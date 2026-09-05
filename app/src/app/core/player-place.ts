/**
 * Chi ha GUADAGNATO il posto e chi l'ha PERSO, letto dal foglio e detto in italiano.
 *
 * Il fatto è misurato dal toolkit (`snapshot.place_changes`, colonne `desc_place_*`) e qui non si
 * ricalcola niente: il giorno in cui i minuti di un uomo cambiano stabilmente, e cosa succedeva sulla
 * sua linea quel giorno. Quello che l'app aggiunge è la FRASE - il foglio è un CSV inglese, il tavolo è
 * italiano, e un fatto con due formulazioni resta un fatto solo finché la formulazione è l'unica cosa
 * che cambia.
 *
 * LA PARTE CHE LO RENDE ONESTO È IL CONTROLLO SUL REPARTO, ed è la ragione per cui esiste la colonna
 * `cause`: un uomo che gioca perché il titolare davanti a lui è rotto **non ha vinto il posto**, e torna
 * indietro quando l'altro rientra. Il confronto è fra DATE e non fra stagioni, perché la sola
 * co-occorrenza risponde al contrario su un caso che l'operatore conosce: il primo 90' di Bartesaghi è
 * la giornata del 3-5 ottobre e la caviglia di Estupiñán è del 12 - l'infortunio ha consolidato il
 * posto, non l'ha causato.
 *
 * SOLO REPORTING. La forma predittiva di questa idea è stata misurata il 14/08/2026 («promozione nei
 * minuti», controllando prezzo e minuti già visti): media +0,049 su 8 istanze, 6 su 8 positive, cioè
 * debole e non stabile. Mostrarlo è utile, ordinarci sopra una valutazione no - e infatti niente lo
 * legge se non l'icona.
 */

import { PlayerMark } from './player-status';

/** Perché il posto è cambiato di mano. Sei risposte, e due sono l'una il contrario dell'altra. */
export type PlaceCause =
  /** È entrato mentre chi teneva il posto era GIÀ fuori: il posto può tornare indietro. */
  | 'front_injured'
  /** Ha preso il posto PRIMA, e l'infortunio dell'altro è arrivato dopo: l'ha consolidato. */
  | 'won_then_injury'
  /** Nessuno della sua linea era fuori quel giorno. */
  | 'won_it'
  /** L'ha perso perché era fuori lui. */
  | 'own_injury'
  /** Era DISPONIBILE e non schierato: è la mezza domanda che cambia un'offerta. */
  | 'benched'
  /** Non era fra i convocati, e nessuno spell lo spiega. */
  | 'out_of_squad';

/**
 * IL SECONDO FATTO SULLA MAGLIA, e ha una forma diversa dal primo: venduto come titolare, ruotato di
 * fatto. Non c'è nessun gradino da trovare — Lewandowski 2025-26 gioca ogni settimana (14, 12, 22, 90,
 * 25, 90, 90, 16, 90...) e semplicemente non è il titolare — quindi il changepoint sopra non vede
 * niente mentre al tavolo si perdono punti ogni domenica.
 *
 * MISURATO chiamando la funzione che spedisce, su quattro stagioni e le cinque leghe: 3.711 letture,
 * 471 segnalate (12,7%), **precisione 90,4% contro una base del 59,5%** — 1,52x. Nove su dieci di
 * quelli segnalati chiudono il resto della stagione sotto i 60 minuti a partita del club; il decimo
 * diventa titolare davvero, ed è per questo che è un marchio e non un numero.
 *
 * Legge la stagione CHE SI STA GIOCANDO ed è muto finché non ce n'è una: cinque giornate dietro e otto
 * ancora davanti. Su un foglio pre-stagione la colonna è vuota per costruzione.
 */
export interface RotationWatch {
  /** Media minuti sulla finestra letta, e quante partite ne ha iniziate. */
  minutes: number | null;
  starts: number | null;
  /** Quante giornate ci sono dentro: sotto le quattro la frase è più debole, e lo dice. */
  window: number | null;
  /** `watch` dalla quarta giornata (forte quanto la quinta), `early` dalla seconda. */
  strength: 'watch' | 'early' | null;
  from: string | null;
  to: string | null;
}

/**
 * IL TERZO FATTO SULLA MAGLIA, ed è lo specchio del secondo: dato per riserva, gioca da titolare.
 * Ferran Torres 2025-26 (64° percentile del ruolo, 73 minuti e 5 partite da titolare sulle prime 5) e Castro
 * 2024-25 (46°, 76 minuti e 4 su 5) sono i casi da cui nasce.
 *
 * MISURATO su quattro stagioni: chi si legge così parte titolare in almeno metà delle partite che
 * restano nel **76,8%** dei casi contro il 42,3% della sua fascia (1,82x). Per un PORTIERE è la
 * lettura più forte dello screen — 81,9% contro una base del 22,3% (3,68x) — e vuol dire «è il numero
 * uno», non «sta crescendo».
 *
 * È una pretesa più DEBOLE di quella dell'altro marchio: perdere il posto è più prevedibile che
 * conquistarlo (90,4% contro 76,8%).
 */
export interface StarterSigns {
  minutes: number | null;
  starts: number | null;
  window: number | null;
  keeper: boolean;
  /**
   * ...e la QUARTA, che parla PRIMA che si giochi una giornata: come ha finito la stagione scorsa.
   *
   * Le altre tre leggono la stagione che si sta giocando, quindi ad agosto tacciono tutte - e agosto
   * e' quando si compra. Misurata su sei stagioni: 48,8% contro una base del 29,8% (1,64x) su 41
   * uomini a stagione, 6 su 6. E' la piu' DEBOLE delle quattro e la piu' precoce, e la cascata la
   * sostituisce da se' appena ci sono giornate vere - che e' il «consolidare o ripensarci» richiesto.
   *
   * LE AMICHEVOLI NON LA FANNO SCATTARE, per una ragione di copertura e non di merito: sono in
   * archivio per 20 club su 20 solo da questa stagione (2 e 4 nelle due precedenti), quindi nessuno
   * screen che le legga puo' essere verificato all'indietro. Viaggiano nella FRASE, dove informano
   * senza decidere.
   */
  preseason: boolean;
  /** Quante amichevoli ha cominciato su quante ne abbiamo in archivio: reporting, mai un grilletto. */
  friendlyStarts?: number | null;
  friendlyMatches?: number | null;
  /**
   * ...e la TERZA lettura: ha appena preso una maglia, e il mercato se n'e' accorto.
   *
   * Nasce dall'istruzione dell'operatore del 05/09/2026 - «se lo scopo e' individuare calciatori come
   * Palestra allora dobbiamo tarare i limiti in modo che Palestra sarebbe rientrato l'anno scorso» - e
   * quello che ha ridichiarato e' la POPOLAZIONE, non un criterio allargato perche' una regola ci era
   * caduta: uno screen si rimisura sulla popolazione nuova, e questo l'ha fatto. Vale 1,78x contro il
   * 2,26x della lettura piena, su 11 uomini a stagione.
   *
   * Guarda l'ULTIMA giornata e non la media della finestra, perche' la media e' proprio la statistica
   * che nasconde chi ha appena cominciato a giocare: Palestra 2025-26 legge 41,5 minuti di media su
   * due giornate, e la regola piena lo raggiunge solo alla sesta.
   */
  rising: boolean;
  /**
   * La finestra CORTA, due o tre giornate, dove il marchio prima taceva del tutto.
   *
   * `RISER_FROM` = 4 lasciava senza nessuna segnalazione le giornate 1-3, cioè la finestra in cui si
   * fa l'asta iniziale e il primo mercato di riparazione: il buco è stato trovato cercando perché la
   * colonna fosse vuota su tutte e 602 le righe del foglio del 05/09/2026, e la risposta era «per
   * costruzione», che è il posto peggiore in cui un buco possa nascondersi. La famiglia rotazione
   * aveva già chiuso lo stesso buco col suo `early`; questo è lo specchio.
   */
  early: boolean;
}

export interface PlaceChange {
  change: 'gained' | 'lost';
  /** Il giorno in cui il posto cambia di mano, e la giornata reale di quel giorno. */
  on: string;
  matchday: number | null;
  /** «6 -> 73»: minuti per partita prima e dopo. */
  minutes: string | null;
  cause: PlaceCause | null;
  /** Chi mancava davanti a lui, o cosa dicono le partite che ha saltato. */
  who: string | null;
}

const SENTENCE: Record<PlaceCause, string> = {
  front_injured: 'è entrato mentre {who} era già fuori: il posto può tornare indietro al rientro',
  won_then_injury: 'ha preso il posto PRIMA, e {who} si è fatto male dopo: l’infortunio l’ha '
    + 'consolidato, non l’ha causato',
  won_it: 'nessuno della sua linea era fuori quel giorno',
  own_injury: 'era fuori lui ({who})',
  benched: 'era DISPONIBILE e non schierato ({who})',
  out_of_squad: 'non era fra i convocati ({who})',
};

/** Le squalifiche non sono controllabili per una stagione passata, e va detto invece che sottinteso. */
const UNCHECKED: ReadonlySet<PlaceCause> = new Set<PlaceCause>(['won_it', 'benched', 'out_of_squad']);

const day = (iso: string): string => iso.split('-').reverse().join('/');

/** Il fatto in una riga, con quello che NON è stato controllato. Null se il foglio non dice niente. */
export function placeMark(place: PlaceChange | null | undefined): PlayerMark | null {
  if (!place?.change || !place.on) return null;
  const what = place.change === 'gained' ? 'Ha guadagnato il posto' : 'Ha perso il posto';
  const when = `dal ${day(place.on)}${place.matchday ? ` (giornata ${place.matchday})` : ''}`;
  const how = place.minutes ? `, ${place.minutes} minuti a partita` : '';
  const why = place.cause ? ` — ${SENTENCE[place.cause].replace('{who}', place.who ?? '')}` : '';
  const caveat =
    place.cause && UNCHECKED.has(place.cause)
      ? '. Le squalifiche non sono controllate: nessuna fonte datata le copre per una stagione passata'
      : '';
  return {
    flag: place.change === 'gained' ? 'place_gained' : 'place_lost',
    note: `${what} ${when}${how}${why}${caveat}.`,
  };
}

/**
 * «Preso per titolare, ruotato di fatto»: il marchio, con la misura che lo giustifica addosso.
 *
 * DUE MARCHI E NON UNO ANTICIPATO, ed è una richiesta dell'operatore risolta misurando: «anche prima
 * della quinta giornata segnala i top che mostrano segnali di incertezza». Alla QUARTA la lettura vale
 * quanto alla quinta (96,3% contro 94,9%), quindi il marchio pieno scatta lì; a due e tre giornate vale
 * l'81% contro una base del 58%, che è una ragione per guardare e non la stessa frase — dopo due
 * giornate del 2025-26 avrebbe segnalato Donnarumma al Manchester City con 0 minuti, e lui ha poi
 * chiuso a 85 di media. Sei dei suoi diciassette nomi sono diventati titolari.
 */
export function rotationMark(watch: RotationWatch | null | undefined): PlayerMark | null {
  if (!watch || watch.minutes == null) return null;
  const starts = watch.starts ?? 0;
  const rounds = watch.window ?? 5;
  const when = watch.from && watch.to ? ` (${day(watch.from)}–${day(watch.to)})` : '';
  const played = `sulle ultime ${rounds} di campionato del suo club ha una media di ` +
    `${watch.minutes.toFixed(0)} minuti con ${starts} ${starts === 1 ? 'partita' : 'partite'} da ` +
    `titolare${when}`;
  if (watch.strength === 'early') {
    return {
      flag: 'rotation_early',
      note:
        `Quotato fra i primi del suo ruolo, ma ${played} — segnali di incertezza, su una finestra ` +
        `CORTA. Misurato: a due o tre giornate questa lettura è giusta circa l'81% delle volte contro ` +
        `una base del 58% (1.40x), dove alla quarta è giusta al 96%. Vuol dire «guardalo», non «non è ` +
        `il titolare»: dopo due giornate del 2025-26 avrebbe segnalato anche Donnarumma, che ha poi ` +
        `chiuso a 85 minuti di media.`,
    };
  }
  return {
    flag: 'rotation_risk',
    note:
      `Quotato fra i primi del suo ruolo, ma ${played} — non è il titolare e non ha minutaggio. ` +
      `Misurato su 4 stagioni: il 90.4% di chi si legge così chiude il resto della stagione sotto i 60 ` +
      `minuti a partita, contro il 59.5% di chi non lo fa (1.52x). Uno su dieci diventa titolare ` +
      `davvero.`,
  };
}

/**
 * Le due parole che il foglio scrive in `desc_riser_watch`, lette in un posto solo.
 *
 * `early` e' la finestra corta e `yes` quella piena - le stesse due parole della colonna di rotazione,
 * cosi' chi conosce l'una conosce l'altra. Un bundle scritto prima della revisione 43 porta un «yes»
 * nudo, e quello vuol dire la lettura PIENA: leggerlo come `early` degraderebbe in silenzio una frase
 * che era forte, che e' l'errore opposto e piu' insidioso di quello che il regime nuovo cura.
 */
export function starterSignsFromSheet(
  watch: string | null,
  fields: Omit<StarterSigns, 'early' | 'rising' | 'preseason'>,
): StarterSigns | null {
  if (!watch) return null;
  return {
    ...fields,
    early: watch === 'early',
    rising: watch === 'rising',
    preseason: watch === 'preseason',
  };
}

/** «Dato per riserva, gioca da titolare»: lo specchio, con la sua misura (più debole) addosso. */
export function starterSignsMark(signs: StarterSigns | null | undefined): PlayerMark | null {
  if (!signs || signs.minutes == null) return null;
  const rounds = signs.window ?? 5;
  // LA PRE-STAGIONE VIENE PER PRIMA perche' e' l'unica che parla quando le altre non hanno dati: se
  // il foglio la dichiara, giornate vere non ce ne sono e nessuna delle altre tre puo' essere vera.
  if (signs.preseason) {
    const friendly =
      signs.friendlyMatches
        ? ` In pre-campionato ha cominciato ${signs.friendlyStarts ?? 0} amichevoli su `
          + `${signs.friendlyMatches} in archivio — un'informazione in piu', non una prova: le `
          + `amichevoli sono coperte solo da questa stagione, quindi nessuno screen che le legga e' `
          + `verificabile all'indietro.`
        : '';
    return {
      flag: 'starter_signs',
      note:
        `Non si e' ancora giocata una giornata. Quotato basso nel suo ruolo, ha COMINCIATO ` +
        `${signs.starts ?? 0} delle ultime ${rounds} giornate della stagione scorsa e il suo valore ` +
        `di mercato e' almeno raddoppiato in 24 mesi. Misurato su 6 stagioni: il 48.8% di questi parte ` +
        `titolare in almeno meta' della stagione che si sta comprando, contro il 29.8% della sua ` +
        `fascia (1.64x), su 41 uomini a stagione e 6 stagioni su 6. E' la piu' DEBOLE delle quattro ` +
        `letture e la piu' precoce: si consolida o cade appena si gioca.${friendly}`,
    };
  }
  // LA TERZA LETTURA VIENE PRIMA DELLE ALTRE DUE perche' e' un'altra DOMANDA e non una versione piu'
  // permissiva della stessa: non «gioca da titolare» ma «ha appena preso una maglia, e il mercato se
  // n'e' accorto». Dice l'ultima giornata invece della media, che e' la statistica che nasconderebbe
  // esattamente l'uomo per cui questa lettura esiste.
  if (signs.rising) {
    return {
      flag: 'starter_signs',
      note:
        `Quotato basso nel suo ruolo, ma ha COMINCIATO l'ultima giornata del suo club e il suo valore ` +
        `di mercato e' almeno raddoppiato in 24 mesi. Misurato su 5 stagioni del listone Serie A, come ` +
        `RESIDUO di chi la lettura piena non prende gia': il 59.3% di questi parte titolare in almeno ` +
        `meta' delle partite che restano, contro il 33.4% della sua fascia (1.78x), su 11 uomini a ` +
        `stagione. E' il caso che la regola piena lascia indietro - chi la maglia l'ha presa da poco.`,
    };
  }
  // LA FINESTRA CORTA PORTA I NUMERI DELLA FINESTRA CORTA, che è tutta la differenza fra le due frasi:
  // niente è più permissivo (stessa fascia, stessi minuti, stessa quota - a due giornate vuol dire che
  // le ha cominciate TUTT'E DUE), ma quello che la lettura vale lì è 1,49x contro 1,63x, quindi dice
  // «guardalo» e non «è il titolare». Una frase debole che cita la precisione di quella forte è la
  // stessa famiglia del marchio di rotazione anticipato, che avrebbe segnalato Donnarumma a 0 minuti.
  if (signs.early) {
    return {
      flag: 'starter_signs',
      note:
        `Quotato da riserva nel suo ruolo, ma le ${rounds} giornate giocate finora le ha cominciate ` +
        `${signs.starts ?? 0} da titolare, con una media di ${signs.minutes.toFixed(0)} minuti — su ` +
        `una finestra CORTA. Misurato su 4 stagioni del listone Serie A: dopo DUE giornate il 76.5% ` +
        `di chi si legge così parte titolare in almeno metà delle partite che restano, contro il ` +
        `51.3% della sua fascia (1.49x), dove alla quarta è 1.63x. Vuol dire «guardalo», non «è il ` +
        `titolare».`,
    };
  }
  const evidence = signs.keeper
    ? "Misurato su 4 stagioni: per un PORTIERE è la lettura più forte di questo screen — l'81.9% di "
      + 'chi si legge così parte titolare in almeno metà delle partite che restano, contro il 22.3% '
      + 'della fascia riserve (3.68x). Vuol dire «è il numero uno», non «sta crescendo».'
    : 'Misurato su 4 stagioni: il 76.8% di chi si legge così parte titolare in almeno metà delle '
      + 'partite che restano, contro il 42.3% della sua fascia (1.82x). È una pretesa più debole '
      + "dell'altro marchio: perdere il posto è più prevedibile che conquistarlo.";
  return {
    flag: 'starter_signs',
    note:
      `Quotato da riserva nel suo ruolo, ma sulle ultime ${rounds} di campionato del suo club ne ha ` +
      `iniziate ${signs.starts ?? 0} con una media di ${signs.minutes.toFixed(0)} minuti. ${evidence}`,
  };
}
