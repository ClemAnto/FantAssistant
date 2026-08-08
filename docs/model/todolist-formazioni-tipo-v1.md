# Todolist — formazioni tipo più veritiere (v1, 08/08/2026)

*Nata dal confronto con le fonti giornalistiche dell'08/08/2026 (20 club, 4-6 fonti ciascuno). Ogni
voce porta la sua evidenza misurata, il giudice con cui si decide, e la resa attesa. Ordinata per
resa. Meccanismo e formule: [formazioni-tipo-v1.md](formazioni-tipo-v1.md).*

**Stato del giudice** (harness `press`, foglio default, `SHEET_REVISION` 11): moduli **10 uguali +
4 sull'alternativa dichiarata + 6 divergenti**, uomini **164/220 = 75%** — da 9/5/6 e 160/220
dell'archivio di partenza. La referenza è un DATO (`press_formations`) e il confronto un comando:
questi numeri si citano da `data/reports/press_comparison.json`, mai a memoria. Il perché di quella
regola è la voce 3-ter.

**Regola che vale per tutta la lista**: la stampa è un GIUDICE, mai un input del claim — leggerla
dentro il modello renderebbe circolare proprio il confronto che la usa. E nessun criterio si
allarga perché un caso l'ha fallito (CLAUDE.md, 06/08/2026).

---

## 0. ~~Il giudice: la referenza stampa come DATO, e il confronto ripetibile~~ — **FATTA** (08/08/2026, `19351fd`)
**Perché**: le voci 3, 4 e 5 si decidono «contro la stampa», quindi la referenza deve essere un
dato datato e il confronto una misura ripetibile — viveva in tre script di scratchpad e sei
JSON copiati a mano. La spec v9.38 chiedeva esattamente questo: «i valori vanno rimisurati quando
ci sarà di nuovo una referenza esterna sulla stagione che si asta».
**Fatto**: modulo **`press`** (`python -m euroleghe_ingest press`), tre ingressi:
- `--import FILE --season YYYY-YY` → `press_formations(club, season, observed_on, source, coach,
  module, module_alternatives, xi, duels, notes, confidence)`, un fatto per-GIORNO come
  `probable_starter`; ogni import è **archiviato in `data/raw/press/`** e `rebuild` lo rigioca, così
  il DB resta ricostruibile dai raw come vuole la spec;
- senza opzioni → rigioca gli archivi (il ramo offline);
- `--sheet DIR` → estrae le board **guidando il pannello vero** e le confronta.
**Due cose che l'implementazione ha imposto, e valgono più del comando**: l'estrazione chiama
`SnapshotView.load_sheet` — estratto da `load_selected` perché **un solo loader per pannello e
harness**, che è il difetto dell'08/08 preso alla radice (una seconda copia della lista di cache
sarebbe una seconda popolazione) — e legge le funzioni REALI (`board_shape`/`eleven`/`lanes_for`),
mai le colonne che le somigliano. I club si uniscono per `club_identity`, mai per stringa.
**Numeri, e una correzione a quelli citati qui**: il confronto ARCHIVIATO dell'08/08 dà
**9 MATCH / 5 ALT / 6 DIFF, uomini 160/220** — il «10/5/5 · 159/220» che questa lista e
`formazioni-tipo-v1.md` citavano era uno stato di metà sessione le cui board non furono salvate.
Il test di riproduzione blocca i numeri dell'archivio; il foglio corrente li riproduce.
**Report**: `data/reports/press_comparison.json`.

## 1. ~~Aggregati Serie B per i club promossi~~ — **FATTA** (08/08/2026, `9d0f400`)
**Perché, misurato**: Frosinone XI disegnato con claim 0.07-0.43 → **4/11** contro la stampa;
Venezia 7/11, Monza 8/11. Il MODULO invece usciva giusto su tutte e tre (i lineups di B ci sono).
Mancava il campionato in `external_stats`: starts e minuti **mancanti, non misurati**.
**Fatto**. Prima la verifica che la via breve era peggio del vuoto: derivarli dal per-partita che
già avevamo darebbe **97 partite di Serie B su 380**, giornate 16-38, mediana 14 per giocatore
contro 31 in Serie A — un aggregato derivato direbbe «ha giocato un terzo della stagione» di un uomo
che l'ha giocata tutta, e **dimezzare un denominatore è peggio che lasciarlo vuoto**. Quindi
acquisizione (poche richieste), con tre scelte che valgono oltre la Serie B:
- **`FEEDER_TOURNAMENTS`, fuori da `TOURNAMENTS`**: un campionato d'ORIGINE non è un campionato in
  scope — nessun listone lo quota, `scoring_config` non ha regole, nessun club ci va archiviato — e
  resta un campionato vero. Un run bare non lo tocca; `--league serie_b` sì, e solo `--layer season`.
- **per un feeder il pool d'identità è quello della stagione DOPO**, che non è una scorciatoia ma è
  cosa È un feeder: nessuno in Serie B sta in un listone MENTRE ci gioca, è quotato l'estate in cui
  il club sale. Senza, restavano irrisolti 34 provider row dei tre promossi coi cognomi già nei
  nostri roster 2026-27. Frosinone **2 → 22** dei 25 quotati, Monza 3 → 17, Venezia 5 → 21.
- **`config.CHAMPIONSHIPS`** (le 5 + i feeder) dove la domanda è «è una partita di campionato?»: il
  denominatore. Senza, gli start del Frosinone si dividevano per i 24 undici parsati invece che per
  le 38 giornate di B — lo stesso difetto del 49% di Kane, sui club meno capaci di assorbirlo.

**Due difetti trovati strada facendo**, entrambi della famiglia «un'entità si unisce per chiave
canonica»: il provider dice `serie-b` e la nostra chiave è `serie_b`, e con tutte e due in tabella
lo stesso campionato era due (2121 righe normalizzate, per ID del torneo e mai per il testo, al
download E al parse perché la cache si rigioca); e **4302 righe duplicate** lasciate dal layer extra
quando scriveva sotto la source di lega — rimosse con un criterio che non può cancellare nulla di
unico (fuori dal round walk E con il gemello), e **misurato neutro sul giudizio** ricostruendo un
foglio controfattuale coi duplicati rimessi: 10/4/6 e 164/220 identici.
**Giudice (voce 0)**: moduli 9/5/6 → **10 MATCH / 4 ALT / 6 DIFF**, uomini **161 → 164/220**.
Frosinone **4/11 → 10/11** (resta un ballottaggio, El Azzouzi/Koutsoupias), Venezia 7 → 8, Monza
prende il modulo giusto. `backtest --verify` 22/22.

## 1-bis. Il SALTO DI LIVELLO di chi ha giocato altrove senza cambiare club di listone
**Perché, misurato (08/08/2026, esce dalla voce 1 e ne è il rovescio)**: col dato di Serie B in
tabella, Missori (**27 start**), Ciervo (34), Kofler (28), Braunoder (22) passano da zero a titolari
misurati e la board li schiera — ed è il DATO a essere giusto: quello che manca è scontare che 34
start in Serie B non sono 34 in Serie A. Costa 3 uomini sul confronto (Sassuolo, Cagliari, Como),
cioè l'unica parte negativa del bilancio della voce 1.
Il canale che lo direbbe **esiste già ed è adottato** — `level_gap` («chi scende di livello sale di
ruolo», 07/08/2026) — e non li raggiunge, per una ragione precisa: è applicato **solo a chi ha
CAMBIATO CLUB**, che è la popolazione su cui è stato misurato, e questi uomini il club di listone
non l'hanno cambiato. Erano in PRESTITO (Missori al Palermo col listone che lo teneva al Sassuolo:
nessuna riga in `arrivals`, che è un diff fra roster) oppure arrivano senza roster precedente
(Kofler, tipo `new`, `origin_club` e `origin_league` entrambi NULL).
**La misura del perimetro**: 48 uomini quotati 2026-27 con 10+ start di Serie B nel 2025-26; **40
sono ai tre promossi** — e per loro il livello non è cambiato per un trasferimento, è salito il club,
quindi il claim «chi parte titolare» resta giusto (Frosinone 10/11 lo dimostra) — e **8 sono a club
già in Serie A**, cioè quelli che il salto l'hanno fatto davvero. Uno solo (Missori) senza riga
d'arrivo.
**L'ipotesi da misurare, che è più grande del caso**: il livello del calcio giocato è un fatto sui
MINUTI, non sull'ARRIVO — `external_stats.club_id` → `club_levels` lo sa già per chiunque, e
`elo.personal_levels` fa esattamente quel join. Estendere `level_gap` da «chi ha cambiato club» a
«chi ha cambiato LIVELLO» è cambiare la popolazione di un canale adottato, quindi **non si fa inline
e non si fa senza sweep**: griglia pre-registrata, e il verdetto va letto sulla popolazione su cui
la regola agisce (regola §7-sexies), che qui sono 8 uomini su un foglio — un numero che da solo
dice che il giudice interno non basterà e servirà la referenza esterna.
**Giudice**: sweep pre-registrato + il confronto (voce 0) su Sassuolo/Cagliari/Como.
**Resa attesa**: piccola oggi e strutturale ogni estate; ClubElo **ha** i club di Serie B (Palermo
1569, Sampdoria 1643), quindi il dato per misurarla c'è.

## 2. ~~Transfers: risoluzione dei nomi e freschezza~~ — **FATTA** (08/08/2026, `d7ea4a3` + `a039910`)
**Perché, misurato**: Lazio **4/11** con tre titolari attesi che sono arrivi di luglio (Doekhi,
Pedraza, Taylor); Fiorentina 7/11 (Mastantuono, Valdepenas, Oulai attesi titolari); Roma: la
stampa schiera Molina e **Molina N. non ha NESSUNA riga in `transfers_history`** pur avendo
l'identità (fc_id 4998). Il refresh dell'08/08 riportava «4.422 nomi irrisolti», e ogni data è
01/07 (semantica inizio-contratto di Transfermarkt).
**Fatto, e sono TRE difetti dello stesso layer** — il primo era quello previsto, gli altri due li
ha trovati la misura:
1. **La chiave canonica c'era e il parser la buttava.** Prendeva il TESTO del link giocatore e
   scartava l'href, che porta l'id Transfermarkt — lo stesso che `player_xref` già mappa. Ora
   id-prima, nome-nel-pool come ripiego, perché **il pool per nome è cieco esattamente sugli uomini
   per cui la tabella esiste**: un arrivo di luglio non è ancora nel roster listone del club che
   compra. Irrisolti **4.422 → 2.508** (−43%); 2026-27 da 689 a 789 righe.
2. **Lo stesso affare fra due club del perimetro stava su ENTRAMBE le pagine** con grafie diverse
   (`SS Lazio`/`Lazio`, `1.FC Union Berlino`/`Union Berlino`) e la PK con le stringhe teneva due
   righe — Pedraza ne aveva due, Doekhi una sola e spaiata. Il contropartner si risolve al nome
   canonico con lo stesso `match_club` di `resolve_clubs`, e le due metà si fondono (1.160 righe
   ora hanno ENTRAMBE le leghe). Il reingest riparte da tavola pulita: la tabella deriva dalla
   cache e da nulla altro.
3. **`first_seen`**, il giorno di download del file di cache, tenuto al MINIMO tra i re-parse: è la
   data-osservazione che la voce chiedeva, dato che `date` è l'inizio contratto.

**E il collo di bottiglia vero era un'altra tabella** — trovato inseguendo Doekhi, che aveva la riga
transfer e il claim comunque vuoto. I tre pool per nome del funnel identità (`positions`) sono
costruiti dal roster DELLA STAGIONE, mentre **il perimetro del listone cambia ogni estate**: un uomo
comprato dentro il perimetro quest'anno non è in nessun pool dell'anno che ha davvero giocato, e il
suo aggregato d'ingresso non va a nessuno. Misurato: **59 uomini del listone 2026-27 con ZERO
aggregato 2025-26** mentre il loro provider id era già in `player_xref` — Doekhi (identificato nel
2023-24) e Geubbels, entrambi schierati titolari dalla stampa. Quarto pass `known`, l'evidenza più
debole e l'ultimo ripiego, che **non decide mai un'identità** (un'identità dice a quale uomo
appartiene un fatto di stagione; un fatto di stagione non dice chi è l'uomo — altrimenti un namesake
collapse si riconfermerebbe per sempre). `external_stats` **11.732 → 16.970 (+5.238)**.
**E il difetto che questo ha ESPOSTO**: la delete authoritative di `positions` cancellava identità
di ALTRI moduli — `recent_form` le paga con ricerche provider, `injuries` le legge dalle pagine rosa
— perdendone 20, 19 di uomini quotati 2026-27 che nessun pool per nome può ristabilire. Verificato
che la perdita è PREESISTENTE (il codice al commit precedente perde le stesse 19). Cura:
`player_xref.resolved_by`, stessa regola di `club_levels_xref`; le righe precedenti la colonna sono
`unknown` e nessuno le ritratta. xref **−19 → +1**.
**Giudice (voce 0)**: Lazio **4/11 → 5/11** (Doekhi entra nell'undici), Genoa un nome, uomini
**160 → 161/220**; i moduli non si muovono. `backtest --verify` 22/22.
**Cosa resta**: la coda irrisolvibile è **1.060 identità distinte**, di cui ~765 mai state in un
listone (irrisolvibili per costruzione); la leva sui 109 uomini del listone 2026-27 senza id
Transfermarkt è `injuries --layer ids`, non il matcher.

## 3. La selezione e il trequartista («Paz fuori dall'undici»)
**Perché, misurato**: Como — Paz N. ha **il claim più alto della rosa (0.753, 33 start) e non è
nell'undici disegnato**: primo codice AM → pool d'attacco; l'unico posto davanti del 4-5-1 va
alla punta per `_fronted` (gap 0.155 < 0.40, la regola funziona come scritto); non essendoci riga
di trequarti, cade tra le linee mentre un terzino a claim-prior 0.562 gioca esterno di
centrocampo. `_two_rows` (la riga a 5 che si spezza in 2+3) arriva DOPO la selezione, quando Paz
è già fuori. Stessa famiglia del «Touré a 0.00» che generò `_flanked` — la domanda del claim
posta un passo prima.
**Cosa fare**: progettare la regola alla SELEZIONE (candidate: il pool della riga a 5 considera
gli AM quando la maggioranza della riga «gioca avanti»; oppure `_fronted` che retrocede un uomo
deve lasciarlo in gara per M/T, mai fuori dall'undici). Una proposta per volta, in Pareto come
`_settle`.
**Giudice**: invarianti sulle 394 board (0 rotture) + il confronto (voce 0): Como 9→10-11, forse
Lecce 8→9-10. Attenzione alla lezione v9.16: se aggiustare un club ne rompe un altro, è il
MODELLO sbagliato, si annota e si torna indietro.
**Resa attesa**: 1-2 club oggi, ma è la classe di difetto più visibile all'operatore.

## 3-bis. ~~Co-titolarità misurata~~ — **DATO ADOTTATO, REGOLA REFUTATA** (08/08/2026, `a3ee449`)
**Come è andata, in ordine.** L'ipotesi dell'operatore è **confermata sulla coppia**: Krstovic e
Scamacca hanno 2 co-start di 15/18 sulle 35 partite in cui erano entrambi disponibili, **0.13**,
contro Lautaro Martinez e Thuram a **0.58**. Quindi «mai due Pc» è falso e «due che non coesistono
non si disegnano insieme» è misurabile, con due ancoraggi sulla stessa scala.
**Il DATO resta** (`desc_costart_low` sul foglio, `SHEET_REVISION` 11), e la lezione che è costato è
il denominatore: contata su tutte le partite, ogni coppia separata da un trasferimento legge 0.00 e
«non coesistono» si direbbe di ogni acquisto estivo — **35 coppie sembravano così e 32 semplicemente
non avevano mai condiviso una rosa** (Doekhi e Romagnoli, Kolo Muani e Conceição). Col denominatore
giusto — le partite in cui ENTRAMBI erano in rosa — restano 198 coppie e solo **3 sotto 0.25**.
**La REGOLA non resta.** Implementata come quarto override di mestiere (non può girare alla
selezione: il pool d'attacco dell'Atalanta è guidato da Zalewski e Pasalic, due centrocampisti con
codice `AM`, ed è `_fronted` a metterci le punte — una regola sulla COPPIA deve vedere la coppia), ha
fatto esattamente quello che prometteva: Scamacca fuori, Sulemana K. dentro. **Il giudice l'ha
bocciata**: uomini **164 → 162**, Atalanta **7/11 → 6/11**, e il suo verdetto modulo da ALT a DIFF.
**La stampa schiera Scamacca.** La regola non aveva modo di sapere quale metà di una rotazione
tenere — scarta il claim più basso (0.468 contro 0.490) e sull'unico caso per cui esiste è l'uomo
sbagliato. Ritirata secondo v9.16.
**Cosa servirebbe, e non è una soglia**: un segnale su QUALE dei due ruotanti comanda. Il claim non
lo è (li ordina per minuti, che in una rotazione sono quasi pari per costruzione), e il dato per
cercarlo ora c'è. Finché non esiste, la co-titolarità è una LETTURA per l'operatore — la targhetta
dice già i rivali — e non un criterio di selezione.

## 3-ter. Nota su come era scritta la 3-bis, che è la lezione della voce 0
La stesura originale citava «5 co-start su 24 a testa» per Krstovic/Scamacca e «18 su 23» per
Lautaro/Thuram. Rimisurati con l'harness: **2 su 15/18** e **15 su 26/28**, cioè 0.13 e 0.58 invece
di 0.21 e 0.78. La differenza non è un errore di allora: il layer per-partita è cambiato sotto
(4302 righe duplicate rimosse, le competizioni normalizzate) e i primi numeri furono presi a mano.
È la terza volta in una sessione che un numero citato a memoria non si riproduce — la prima fu
«10/5/5 · 159/220». Da qui la regola operativa: **una quota si cita dal report o si rimisura, mai
dal documento**, e il documento porta la forma della conclusione con la data.

## 4. `COACH_SHAPE_MIN` / `COACH_SHAPE_FULL` (20/60): la verifica ESTERNA del giudice interno
**Perché**: la rimisurazione col giudice INTERNO è già stata fatta (v9.41 §3, gate §7-quinvicies,
48 casi: la forma dell'allenatore non batte mai l'abitudine del club — 17% contro 50% sotto i 20
undici; direzione indicata: ALZARE, non abbassare; fasce con 6-17 casi, troppo poco per muovere).
Le soglie restano 20/60 con la misura accanto. Quello che il giudice interno non può dire è come
le soglie rendono contro una PREVISIONE sulla stagione che si asta — la referenza stampa (voce 0)
è quel giudice, ed è quella che v9.38 aspettava.
**Cosa fare**: stessa griglia, giudicata sui 20 moduli stampa + pazzidifanta 03/08 (già usata per
adottare `coach_shapes`, 8/17 → 9/17). Punteggio: moduli-uguali-o-alternativa. Se conferma il
giudice interno (tenere o alzare), la questione si chiude con due misure concordi.
**Giudice**: le due referenze 26/27, riportate separate; mai adottare sul bordo della griglia.
**Resa attesa**: piccola; il valore è chiudere la domanda con due giudici indipendenti.

## 5. Il modulo del RITIRO dentro `shape_odds` (i casi Napoli e Juventus)
**Perché, misurato**: le due divergenze «vere» di modulo sono repertorio-contro-annuncio:
Allegri ha 3-5-2 in 94/152 undici di carriera e la stampa dà unanime il 4-3-3 provato in ritiro;
Spalletti ha il 3-4-3 misurato alla Juve (29/46) e la stampa dà 4-2-3-1. Il repertorio risponde
«cosa fa l'uomo», non «cosa ha annunciato per QUESTA squadra». Le amichevoli sono già in
`club_match_lineups` dove catturate, e per il CLAIM sono state misurate e rifiutate con cinque
ragioni (v9.17 §6) — ma il MODULO di un'amichevole è un segnale diverso e più povero di rumore
per-giocatore: la forma schierata è una dichiarazione dell'allenatore.
**Cosa fare**: quinta fonte di `shape_odds`, pre-registrata: le forme schierate nelle amichevoli
della stagione-bersaglio sotto l'allenatore attuale, pesate dal loro (piccolo) campione. Prima di
scrivere codice: misurare QUANTE amichevoli 26/27 abbiamo per club (nel 25/26 erano 1-3, e Milan
e Napoli zero — se la copertura è ancora quella, la voce si ferma lì e lo si scrive).
**Giudice**: il confronto (voce 0); l'anno prossimo, la pre-registrazione di giugno 2027 già
aperta per la parte claim.
**Resa attesa**: Napoli, Juventus, forse Udinese (il cambio intra-allenatore è la stessa specie).
**Caso di studio misurato (08/08/2026, «Giovane sarà quasi certamente una riserva, Alisson e Neres
dovrebbero essere i titolari»)**: nel 4-3-3 della stampa i NOSTRI claim disegnano già
Politano (0.65)–Hojlund (0.76)–Neres (0.50) e Giovane (0.435) resta fuori da solo — Giovane entra
solo nel 3-5-2, dove le ali non hanno posto. L'intero caso è il MODULO, non un parametro sul
giocatore. Santos A. resta a 0.264 con 836 minuti misurati: la stampa si fida del ritiro, il dato
non ancora — se sarà titolare lo diranno le prime giornate, e nel frattempo la scelta modulo per
club (`_shape_choice`) e l'esclusione manuale (`_excluded`) sono le leve del pannello per il giorno
d'asta.

## 6. Letture, non regole (a costo quasi zero)
- **Ballottaggi quasi-pari**: Gila/Tomori, Thuram K./McKennie, Isaksen/Cancellieri sono duelli
  sotto 0.1 di claim dove la stampa sceglie l'altro lato — il pannello già disegna i rivali;
  verificare che la targhetta dica il MARGINE (un undici che mostra 0.72 vs 0.67 è
  un'informazione, uno che mostra solo il vincitore è un'affermazione).
- **Vocabolario in uscita**: Milan 3-4-3 nostro vs 3-4-2-1 stampa e Lecce 4-5-1 vs 4-2-3-1 sono
  in parte notazione (il provider conta ali e trequartisti nel centrocampo). Quando la voce 0
  esiste, il confronto può dichiarare le classi di equivalenza invece di contarle divergenze.
- **`evidence_age` davanti**: Lazio e Fiorentina divergono anche perché il foglio dice onestamente
  che le rose hanno 4-10 giorni e i transfers un mese — la data dell'evidenza è già sul foglio,
  tenerla vicina alla board quando si giudica un undici «sbagliato».

## Fatto l'08/08/2026, seconda sessione
- **Voce 0 (`19351fd`)**, **voce 2 (`d7ea4a3`, `a039910`)**, **voce 1 (`9d0f400`)** e **voce 3-bis
  (`a3ee449`, dato adottato e regola refutata)**: sopra, ciascuna coi suoi numeri. Bilancio sul
  giudice: moduli **9/5/6 → 10 MATCH / 4 ALT / 6 DIFF**, uomini **160 → 164/220**, `backtest
  --verify` sempre 22/22. `SHEET_REVISION` **11**: i fogli sotto quella revisione sono da rifare.
- **Il selettore modulo dice anche quanto VALE l'undici** (`39ec7c9`, richiesta dell'operatore).
  Accanto alla probabilità, `SUR` = il surplus MEDIO degli undici che quella forma schiera: due
  domande diverse, e la forma probabile può schierare l'undici più povero — Como 4-5-1 al 77% con
  ~17.3 contro il 4-4-2 al 3% con 18.3, che è il caso Paz visto dal pannello; Inter 3-5-2 al 95% e
  anche il più ricco (25.3). Tre scelte con la loro ragione: la MEDIA e non la somma (ogni forma
  schiera undici uomini); **un surplus mancante è IGNOTO e non zero**, quindi la media è sugli
  uomini che ne hanno uno e il conteggio viaggia con lei; `~` quando almeno uno porta la STIMA
  invece della valutazione gated — Frosinone è tutto `~`, che è la voce 1 vista dal pannello.
  `row_surplus` è UNA definizione, letta dalla cella, dal tooltip e dal selettore.

## Fatto nella prima sessione dell'08/08 (per riferimento)
- **Perimetro = listone bersaglio** (`perimeter_clubs`, SHEET_REVISION 10): le promosse erano
  ASSENTI dal foglio (74 quotati) e le retrocesse presenti (94 righe). Corretto, testato, fogli
  ricostruiti (default + euro), `backtest --verify` 22/22.
- **La fascia posseduta intera è un mestiere D/M** (`_wing_back_trade` in `_flanked`): «Malen
  dovrebbe giocare come Pc e non come centrocampista esterno» — in un modulo a difesa a tre la
  fascia del centrocampo non si contende con soli codici d'attacco. Effetto misurato: 3 board su
  20 si muovono, tutte verso la stampa sui nomi (Roma: Rensch dentro, Malen rivale del Pc;
  **Juventus 11/11** con Thuram K.; Monza recupera Pessina, il picture scivola al gemello
  3-4-1-2). Il caso Bologna/Orsolini (difesa a 4) è nel test e non si muove. 332 test verdi.
- Refresh `transfers` eseguito (nessuna riga post-01/07: v. voce 2).
- Il meccanismo consolidato in [formazioni-tipo-v1.md](formazioni-tipo-v1.md); referenza stampa
  e confronto salvati in `data/reports/press-formations-2026-08-08/`.
