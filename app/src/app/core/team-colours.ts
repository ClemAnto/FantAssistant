/**
 * LA PALETTE DELLE ROSE: un colore per partecipante, calcolato e non scelto a occhio.
 *
 * Sua richiesta (22/09/2026): «utilizziamo una palette di colori per le squadre in modo che siano ben
 * distinguibili gli uni dagli altri». Il risultato più importante della misura è che quella frase, per
 * dieci squadre, NON È OTTENIBILE COL SOLO COLORE - e va detto qui invece di lasciarlo scoprire.
 *
 * COME SONO COSTRUITI. Sedici tinte equispaziate in OKLCH, la cromaticità massima che il gamut sRGB
 * regge a quella (L, h) meno un margine, e la luminanza che gira su TRE livelli (0.62 · 0.70 · 0.78) -
 * così due tinte vicine che il gamut schiaccia alla stessa cromaticità restano separate dalla chiarezza.
 * L'ORDINE è un max-min greedy sulla distanza OKLab: i primi `k` slot sono i `k` meglio separati che
 * quell'insieme contenga, quindi una lega da otto o da dieci non paga le tinte che servono a una da
 * sedici. Nessun esadecimale è stato digitato: lo script che li produce sta nel verbale.
 *
 * LA BANDA DI CHIAREZZA È PIÙ ALTA di quella che il metodo di riferimento prescrive per uno sfondo
 * scuro (0.48-0.67), ed è una sostituzione DICHIARATA e non una svista. Due ragioni misurate: la
 * pastiglia porta inchiostro quasi nero (`text-page`, e i due temi di questa app sono tutt'e due
 * scuri), quindi un chip scuro non si legge - così com'è, l'inchiostro sta fra 5.0:1 e 10.6:1; e le
 * nostre superfici sono molto più scure di quella del riferimento (#0a0a0f contro #1a1a19), quindi la
 * soglia dei 3:1 non è ciò che vincola. Tenuta DENTRO quella banda, ogni variante provata fa cadere la
 * cromaticità sotto il pavimento (Cmin 0.076-0.097 contro 0.109): una squadra leggerebbe GRIGIA, che è
 * il difetto che la lista scritta a mano aveva già.
 *
 * QUELLO CHE LA PALETTE NON PUÒ FARE, misurato e non argomentato (`validate_palette.js`, tutte le
 * coppie, superficie #14141c):
 *   - la coppia peggiore a DIECI squadre legge ΔE 13.0 a vista normale, sotto il pavimento di 15;
 *   - sotto deuteranopia legge 0.8, cioè due rose hanno lo stesso colore per chi non distingue il
 *     rosso dal verde. Non è una taratura sbagliata: con dieci tinte sul cerchio una collisione del
 *     genere è garantita, e il metodo di riferimento lo dichiara (la sua palette di otto ne valida
 *     TRE a tutte le coppie).
 * Quindi il colore qui è un canale di SUPPORTO e l'identità la porta la SIGLA, che sta su ogni
 * pastiglia. Dove la sigla non c'è - la barretta del proprietario su una riga della plancia - il
 * colore dice «questa riga è di qualcuno» e «è dello stesso di quell'altra», e a «di CHI» risponde la
 * lente. *Una palette si sceglie per quello che può fare, e si dichiara per quello che non può.*
 *
 * QUANTO VALE, contro la lista scritta a mano che c'era prima (stessa misura, stesse dieci sedie):
 * coppia peggiore a vista normale 11.0 → 13.0; una tinta sotto il pavimento di cromaticità (il grigio
 * del Kraken, che non faceva lavoro di identità) → zero; due tinte sotto i 3:1 sulla superficie (2.59
 * e 2.84, cioè due barrette del proprietario quasi invisibili) → zero. Le due cose che si potevano
 * aggiustare sono aggiustate; quella che non si può è rimasta dov'era.
 *
 * INDIPENDENTE DAL TEMA, di proposito: un colore qui è l'IDENTITÀ di una rosa, e una rosa non cambia
 * squadra quando si cambia tema. Per questo sono esadecimali e non token - e possono esserlo perché
 * tutt'e due i temi di questa app sono scuri, quindi un solo insieme li serve entrambi. Verificato su
 * tutte e tre le superfici (`#14141c` · `#141d19` · `#1c1c26`): 16 slot su 16 passano cromaticità e
 * contrasto su ognuna.
 */
export const TEAM_COLOURS: readonly string[] = [
  '#4dd680',
  '#a564d1',
  '#d75928',
  '#fb91bc',
  '#229b82',
  '#e3af2b',
  '#31caf1',
  '#208ed2',
  '#b3acfa',
  '#8e8b1d',
  '#da72cc',
  '#7ab22c',
  '#de8623',
  '#729bf8',
  '#29b3b7',
  '#d9515f',
];

/**
 * Il colore dello slot `rank`, e oltre il sedicesimo si RICICLA invece di inventarne uno.
 *
 * Il metodo vieta di generare una tinta nuova per il nono nome e prescrive di raggrupparlo sotto
 * «altro»: qui non si può, perché un partecipante è un'identità e la barretta della sua riga deve
 * dire qualcosa. Il ciclo è dichiarato e non nascosto: oltre le sedici rose due squadre condividono un
 * colore, e la sigla resta l'unica cosa che le separa - che è già vero, misurato, a dieci.
 */
export function teamColour(rank: number): string {
  const at = ((rank % TEAM_COLOURS.length) + TEAM_COLOURS.length) % TEAM_COLOURS.length;
  return TEAM_COLOURS[at];
}
