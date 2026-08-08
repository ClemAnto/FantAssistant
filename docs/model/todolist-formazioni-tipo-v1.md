# Todolist — formazioni tipo più veritiere (v1, 08/08/2026)

*Nata dal confronto con le fonti giornalistiche dell'08/08/2026 (20 club, 4-6 fonti ciascuno). Ogni
voce porta la sua evidenza misurata, il giudice con cui si decide, e la resa attesa. Ordinata per
resa. Meccanismo e formule: [formazioni-tipo-v1.md](formazioni-tipo-v1.md).*

**Stato del giudice** (harness `press`, foglio default, `SHEET_REVISION` 13): moduli **11 uguali +
5 sull'alternativa dichiarata + 4 divergenti**, uomini **166/220 = 75%** — da 9/5/6 e 160/220
dell'archivio di partenza. La referenza è un DATO (`press_formations`) e il confronto un comando:
questi numeri si citano da `data/reports/press_comparison.json`, mai a memoria. Il perché di quella
regola è la voce 3-ter.

**Le voci, una riga ciascuna**: 0 fatta · 0-bis fatta (il secondo giudice) · 1 fatta · 1-bis chiusa
(chiusa: non misurabile, 3-7 uomini per stagione) · 2 fatta · 3 fatta · 3-bis dato sì regola no ·
4 chiusa da due giudici concordi · 5 misurata e non adottata · 5-bis (proposta dell'operatore) misurata
e rifiutata · 6 fatta (tre letture) · 7 misurata e refutata da due giudici · 7-bis: due candidati
rifiutati prima di scrivere codice.
**LA LISTA È CHIUSA**: cinque voci con un'adozione, sei con un rifiuto misurato (o con la
constatazione che nessun harness può giudicarle). Ed è il risultato che vale: una regola che non entra
perché il giudice l'ha bocciata costa un pomeriggio, una che entra senza giudice costa un'asta.
L'ultimo punto aperto — la copertura del livello — è stato chiuso lo stesso giorno: 67 → **74** dei 158
arrivi, con la guardia che rifiuta il club in cui un promosso è ancora (voce 1-bis in fondo). Quello
che resta è la manutenzione: rimisurare i due giudici quando arriva una referenza nuova, e le voci
future nascono da lì.

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

**VERIFICATA FUORI CAMPIONE** (voce 0-bis, giudice-esito sul 2025-26): con la Serie B 2024-25
scaricata, i moduli passano da 12 a **13** e il Pisa da 4 a 7 uomini, netto sugli uomini −1 (rumore).
Molto più tiepido del Frosinone 4→10, e la ragione è misurata: **il valore di un campionato d'origine
scala con quanto la rosa promossa è NUOVA al campionato d'arrivo**. Quota di rosa quotata con 5+ start
di Serie A in carriera: Cremonese 2025-26 **79%**, Pisa 63%, Sassuolo 54% contro Frosinone 2026-27
**16%**, Monza 48%, Venezia 46%. Dove il claim aveva già una storia di Serie A da leggere la Serie B
aggiunge poco; dove non l'aveva vale sei uomini su undici. Conseguenza per l'anno prossimo: la resa di
questa acquisizione **dipende da chi sale**, e si stima con quella quota prima di rifarla.

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

## 1-bis. ~~Il SALTO DI LIVELLO di chi ha giocato altrove senza cambiare club~~ — **NON MISURABILE** (08/08/2026)
**L'ipotesi**: il livello del calcio giocato è un fatto sui MINUTI e non sull'ARRIVO, quindi
`level_gap` — adottato il 07/08/2026 e applicato solo a chi ha CAMBIATO CLUB — non raggiunge chi ha
cambiato campionato restando nello stesso club di listone (un prestito, o una promozione). Il caso che
la generò: Missori, 27 start in Serie B col listone che lo teneva al Sassuolo.
**Chiusa senza scrivere il canale, perché la POPOLAZIONE non lo consente.** Contati gli uomini con
minuti misurati in un campionato diverso da quello del loro club di listone e senza cambio di club:

| stagione bersaglio | quotati | popolazione del canale |
|---|---|---|
| 2023-24 | 1558 | **3** |
| 2024-25 | 1524 | **3** |
| 2025-26 | 1453 | **7** |
| 2026-27 | 1175 | **5** |

Fra lo **0.2% e lo 0.5%** dei quotati. Nessun MAE su mille giocatori si muove per cinque uomini, e il
giudice-esito (20 board × 11 uomini) ne toccherebbe uno o due: **non è una voce da fare, è una voce che
nessun harness può giudicare**, e per la regola d'oro (nessuna regola entra senza gate) non è
adottabile. Resta scritta perché il caso è reale e perché se un giorno il perimetro cambia — più
prestiti nel listone, o i cinque campionati esteri con le loro seconde divisioni — la popolazione
cresce e la domanda torna misurabile.

**E UNA CORREZIONE A QUESTA STESSA LISTA, che è la parte che vale.** La voce 7-bis diceva: «40 dei
mancati e 42 degli sbagliati sono ARRIVI, quindi metà degli errori sta sulla popolazione su cui la
1-bis agirebbe — il che la sposta in cima». **Falso.** Quegli 82 sono arrivi VERI, con cambio di club,
cioè la popolazione che `level_gap` **già copre**: chiamando la funzione vera, **55 degli 81** portano
un `level_gap_z`. La 1-bis riguarda i soli prestiti-senza-cambio-club, che sono cinque.
L'errore è stato commesso misurando `desc_level_gap`, **una colonna che non esiste**: `level_gap_z` è
CALCOLATO dal pannello da `desc_level_elo` meno l'Elo del club, e `row.get()` su un nome inesistente
restituisce None per tutti — da cui il «100% cieco» che sembrava un difetto grave su un canale
adottato il giorno prima. È esattamente la regola che questo progetto ha già pagato due volte e che è
scritta in CLAUDE.md — **si verifica la FUNZIONE, non la colonna che le somiglia** — violata da chi
l'aveva appena riscritta. Il modo di non ripeterlo non è ricordarsela: è chiamare la funzione.

**Quello che resta davvero aperto sugli arrivi**, e questa volta misurato con la funzione: la COPERTURA
del livello. `level_gap_z` esiste per **67 dei 158 arrivi** del foglio 2026-27 (42%), e il limite è
`desc_level_elo`, che vuole l'Elo di entrambi i club. Alzare quella copertura è un lavoro sui DATI con
una popolazione vera (91 arrivi), non un canale nuovo — e va misurato prima di essere fatto.

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

## 3. ~~La selezione e il trequartista («Paz fuori dall'undici»)~~ — **FATTA** (08/08/2026, `8f0cb6b`)
**Perché, misurato**: Como — Paz N. ha **il claim più alto della rosa (0.760, 33 start) e non era
nell'undici disegnato**: il suo unico codice è `AM`, la nostra griglia chiama trequartista quel
codice e `line_key` manda ogni trequartista in ATTACCO, quindi perdeva l'unico posto davanti del
4-5-1 per `_fronted` (gap 0.156 < 0.40, la regola funziona come scritta) e **non aveva nessun'altra
linea per cui essere considerato**, mentre un'ala da 0.49 giocava.
**Cosa era davvero**: non un difetto della regola d'attacco ma del BUCKETING, cioè di chi contende
cosa. E la cura non inventa una regola: usa un dato che avevamo già e che quel bucketing
contraddiceva — `desc_real_role_line`, la linea in cui il PROVIDER l'ha visto giocare, che è
un'osservazione distinta dai codici. Il provider archivia **20 dei 27 `AM`** di questo foglio sotto
M e il listone ne chiama C **22 su 27**; Paz legge `line=M`, `role_classic=C`. Entrambe le fonti
dicono centrocampista, e solo la nostra derivazione diceva attaccante.
Allarga la sola CANDIDATURA: `bucket` resta la corsia primaria e dove viene DISEGNATO resta la
risposta del fit — infatti Paz esce **trequartista centrale del 4-2-3-1**, dove la stampa lo mette.
Tocca 28 righe su 638, tutte uomini di raccordo (ali e trequartisti visti a centrocampo).
**Giudice**: moduli 10/4/6 → **11 MATCH / 5 ALT / 4 DIFF**, uomini **164 → 166/220**. Como
DIFF → MATCH, Bologna DIFF → ALT e recupera Orsolini. **Nessun club peggiora**, e le 394 board
invarianti reggono.

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

## 4. ~~`COACH_SHAPE_MIN` / `COACH_SHAPE_FULL` (20/60)~~ — **CHIUSA, due giudici concordi** (08/08/2026)
**Perché**: i valori furono tarati sui campioni ROTTI dal join per nome (v9.38), quindi citavano
numeri che nessuno aveva rimisurato. Il giudice INTERNO (gate §7-quinvicies, 48 casi) diceva
«ALZARE, non abbassare», ma su fasce di 6-17 casi — troppo poco per muovere qualcosa.
**Fatto**: la referenza stampa risponde alla domanda che il giudice interno non può porre — come
rendono le soglie contro una PREVISIONE sulla stagione che si asta — su griglia **pre-registrata**,
MIN ∈ (10, 15, 20, 30, 40) × span ∈ (20, 40, 60):

| | span 20 | span 40 | span 60 |
|---|---|---|---|
| **MIN 10** | 11/4/5 · 166 | 11/5/4 · 166 | 11/5/4 · 165 |
| **MIN 15** | 11/5/4 · 166 | 11/5/4 · 166 | 11/5/4 · 165 |
| **MIN 20** | 11/5/4 · 166 | **11/5/4 · 166** (attuale) | 11/5/4 · 165 |
| **MIN 30** | 11/5/4 · 166 | 11/5/4 · 165 | 11/5/4 · 165 |
| **MIN 40** | 11/5/4 · 165 | 11/5/4 · 165 | 10/5/5 · 165 |

**Il verdetto è PIATTO**: ogni cella da 10/50 a 40/80 dà lo stesso 11/5/4, e solo gli estremi si
muovono (10/30 trasforma un ALT in DIFF, 40/100 perde un MATCH). 20/60 sta in mezzo al plateau.
**Conclusione**: due giudici indipendenti e nessuno dei due chiede di spostarle — la questione si
**chiude** invece di restare aperta, che è esattamente quello che la voce chiedeva. Quello che la
riaprirebbe è una referenza più grande, non una griglia più fine.

## 5. ~~Il modulo del RITIRO dentro `shape_odds`~~ — **MISURATO E NON ADOTTATO** (08/08/2026, `1489f58`)
**La voce chiedeva di misurare la COPERTURA prima di scrivere codice, e questa volta c'è**: il
2026-27 ha **1-3 undici completi per tutti e 20 i club** di Serie A (297 su 200 club), dove il
2025-26 aveva Milan e Napoli a zero. Quindi la voce non si è fermata lì.
**Il DATO resta**: `friendly_shapes` / `friendly_XIs` su `clubs.csv` — le forme schierate nella
stagione BERSAGLIO, che prima di una giornata di campionato sono il ritiro: l'unico calcio giocato
dalla squadra che scenderà in campo, e l'unica fonte che può dire cosa l'allenatore ha ANNUNCIATO
per questa rosa invece di cosa ha fatto altrove. Letto come distribuzione e non come moda (con due
undici una moda è una monetina).
**La REGOLA no.** Quinta fonte di `shape_odds`, pesata dal proprio campione, griglia
**pre-registrata prima di guardare qualsiasi verdetto** (0, 0.15, 0.30, 0.45, 0.60):

| peso | 0.00 | 0.15 | 0.30 | 0.45 | 0.60 |
|---|---|---|---|---|---|
| moduli | 11/5/4 | 11/5/4 | 11/5/4 | 11/3/6 | 11/2/7 |
| uomini | **166** | 166 | 165 | 163 | 163 |

**L'ottimo è al BORDO e la curva scende**: i moduli esatti non migliorano a nessun peso — nemmeno
sui due casi da cui la voce nasceva, Juventus e Napoli — e le alternative si sfaldano.
`PRESEASON_WEIGHT` resta **0**, come `HEATMAP_SIDE`/`HEATMAP_DEPTH`. La ragione vale più del
parametro: una forma da ritiro è scelta contro avversari che non sono del campionato e con uomini
non ancora tutti tesserati, quindi dice di settembre meno di quanto ne dica il repertorio.

## 5-bis. Il SURPLUS come discrimine di modulo — **PROPOSTA DELL'OPERATORE, MISURATA E RIFIUTATA**
**La proposta (08/08/2026)**: «per il Napoli puoi utilizzare il surplus medio del modulo come
discrimine». Il numero c'era già — è il `SUR` che il selettore mostra accanto alla probabilità.
**Misurato, va nella direzione opposta**: per il Napoli il 4-3-3 della stampa è il modulo col SUR
più **basso** (18.2 contro 18.9 del 3-4-3). Scegliendo la forma per SUR su tutti e 20 i club:
**4 MATCH / 3 ALT / 13 DIFF**, contro gli 11/5/4 delle odds. Indovina il solo Milan fra i quattro
divergenti.
**Perché, ed è la ragione per cui i due numeri stanno affiancati nel selettore**: il SUR risponde a
«quale modulo mi CONVIENE» — schiera più uomini di valore, e in Serie A gli attaccanti ne hanno di
più — mentre le odds rispondono a «quale modulo SCEGLIERÀ l'allenatore». Sono due domande, e
mischiarle è la stessa famiglia di difetto del claim contro la valutazione.

## 0-bis. Il SECONDO giudice: l'ESITO, e il null che rende leggibile ogni numero — **FATTO** (`c9e0e7c`)
**Richiesta dell'operatore**: provare i criteri attuali sulla stagione passata e verificare quanto
erano corretti. `snapshot --season 2025-26 --date 2025-08-15` poi
`press --sheet ... --against outcome`: forma modale della stagione e undici uomini più schierati.
**Risultato**: board **13 MATCH / 1 ALT / 6 DIFF, 134/220 uomini (61%)** contro un null
(«gli stessi dell'anno prima») di **9/2/6 e 104/220 (47%)** — +4 moduli e +30 uomini, e su tre club
il null è muto per costruzione mentre la board porta 20 uomini.
**Il difetto che ha esposto nel giudice stesso**: quale delle nostre due stringhe di forma si confronta
lo decide la REFERENZA, non la preferenza. L'esito ha tre linee e non può dire 4-2-3-1: giudicato sul
picture leggeva disaccordo ogni volta che `_reshape` spezzava una riga — 5 club su 20, la differenza
fra 7 MATCH e 12. Il primo giro l'aveva sbagliato.
**Il tetto**: il 61% non è il modello ma la stagione (infortuni, gennaio, esoneri) — Verona **2/11**
perché ha cambiato quasi tutto. E il foglio retrodatato ha una contaminazione a FAVORE (transfers e
arrivi derivati oggi conoscono tutto il mercato estivo 2025), quindi 61% è un limite superiore.
Dettagli e contaminazioni: [formazioni-tipo-v1.md](formazioni-tipo-v1.md) §5-ter.

## 7. ~~Il crollo di titolarità dopo i 30~~ — **MISURATA E REFUTATA DA DUE GIUDICI** (08/08/2026)
**Da dove veniva**: l'analisi dei 172 errori del confronto storico. Due cose che quell'analisi ha
stabilito e che restano vere: **il perimetro non è il problema** (86 su 86 dei mancati erano già sul
foglio) e **65 degli 86 errori sono uomini con 10+ presenze l'anno prima**, quindi il difetto è
nell'ORDINAMENTO fra uomini che hanno tutti una storia.
**L'evidenza che la motivava**, su 500 coppie (giocatore, stagione) con 15+ start di Serie A in
ingresso, due stagioni: quota di presenze mantenuta **66% / 72% / 77% / 51%** per fasce ≤23, 24-26,
27-29, ≥30. Una U rovesciata, quindi una SOGLIA e non una tendenza — e la correlazione lineare è
debole (r −0.139, parziale −0.122) esattamente per questo.
**Implementata** come canale raggiungibile da entrambi gli harness (`presence.age_lift`,
`Inputs.age`, `desc_age` sul foglio, la griglia in `sweep.GRIDS`), perché un parametro che nessun
harness raggiunge è un parametro che nessuno può misurare.
**Rifiutata da entrambi i giudici, lo stesso giorno:**

| giudice | verdetto |
|---|---|
| `sweep` (errore sulla quota di presenze realizzata) | euro **+0.23%** (ottimo 30/0.09, **al bordo**), default **+0.04%** (31/0.06). Nessuno raggiunge il floor 0.5%; strict no, robust no |
| esito (board 15/08/2025 contro il 2025-26) | **peggiora a ogni punto**: uomini 134 → 132, moduli 13 → 12 |

**E il MECCANISMO, che spiega perché la tabella per fasce era ingannevole**: i 30+ portano **già meno
minuti misurati** — 1299 contro 1574 dei 27-29 in Serie A 2024-25 — quindi lo standing li sconta
*prima* che qualunque termine d'età intervenga, e il termine addebita due volte la stessa evidenza. La
tabella per fasce non controlla per i minuti; il modello sì. **Una differenza fra due gruppi non è un
canale finché non si verifica che il modello non la stia già leggendo.**
**Cosa resta**: il parametro a 0 e raggiungibile (come `HEATMAP_SIDE` e `PRESEASON_WEIGHT`), la
colonna `desc_age` sul foglio (`SHEET_REVISION` 12) perché la prossima ipotesi sull'età non debba
ripagarla, e la nota che **non era R4**: R4 predice il fantavoto, questa predice chi gioca — la
distinzione regge, ed è la risposta che ha comunque richiesto di essere misurata.
**Un difetto latente trovato dalla misura**: lo sweep è morto su una divisione per zero in
`absences_per_season`, presente da quando la griglia degli infortuni fu scritta — col punto
`(1.0, 0, 0)` e un uomo senza infortuni nell'ultima stagione ma con infortuni nelle precedenti, tutti
i pesi contati sono 0. Non è «non si infortuna», è «questa pesatura non ha nulla da dire su lui»:
ora cade sul ramo della storia non ripartita, «vuoto = ignoto». Era latente e l'ha esposto la crescita
del layer misurato di questa sessione.

## 7-bis. Due cose misurate e RIFIUTATE nella stessa analisi (per non riprovarle)
- **Scontare il claim per la disponibilità**: il claim è «la squadra con tutti sani» per scelta di
  design, e si potrebbe pensare che contro l'ESITO — che invece contiene gli infortuni — convenga
  moltiplicarlo per `availability`. Misurato: **132/220 uomini contro 134 e un modulo in meno**. La
  scelta di design regge anche contro il giudice più severo, e lo sconto resta dove già sta
  (`engine_pv_pred`).
- **Allargare l'acquisizione**: escluso dai dati, non per opinione. Tutti gli 86 mancati erano sul
  foglio, quindi il perimetro non lascia fuori nessuno di loro.
- **Nota sugli ARRIVI, ~~che rafforza la voce 1-bis~~ — CORRETTA**: 40 degli 86 mancati e 42 degli 86
  sbagliati sono arrivi, quindi metà degli errori sta sulla popolazione più incerta. Ma la conclusione
  che ne era stata tratta («questo sposta la 1-bis in cima») era **falsa**: quelli sono arrivi VERI, con
  cambio di club, cioè la popolazione che `level_gap` già copre — 55 degli 81 portano un
  `level_gap_z`. La 1-bis riguarda i prestiti senza cambio club, che sono cinque. Come si è arrivati
  allo sbaglio, e perché è la lezione più utile della giornata, sta nella voce 1-bis.

## 6. ~~Letture, non regole~~ — **FATTE** (08/08/2026)
- **(a) Ballottaggi quasi-pari: la targhetta dice il MARGINE.** Era già così e va solo verificato:
  `plate_lines` mette UN RIVALE PER RIGA con la sua percentuale, perché «un ranking ha bisogno della
  percentuale di ciascuno accanto, che due nomi sulla stessa riga non possono portare». La targhetta
  del Milan legge **`Tomori 67% | vs Gila 66%`** — il margine di un punto è visibile, e i duelli che la
  voce nominava (Gila/Tomori, Thuram K./Koopmeiners) sono leggibili come duelli e non come verdetti.
  Bloccato da un test, perché una cosa vera per caso è una cosa che si può perdere.
- **(b) Il vocabolario è QUANTIFICATO, non tollerato.** Il report `press` porta ora lo stesso confronto
  sull'altra rappresentazione: sul foglio 2026-27 il verdetto è **11/5/4 sul picture** e **9/3/8 sul
  board**, cioè quanti club stanno sulla differenza di vocabolario invece di lasciarla come aneddoto.
  **Non** una tolleranza e **non** un secondo verdetto: quello resta la rappresentazione che la
  referenza può esprimere (`compare(on=...)`, la regola stabilita col giudice-esito). Dichiarare
  equivalenti 4-5-1 e 4-2-3-1 sarebbe stato allargare un criterio perché dei casi lo fallivano, ed è
  proibito; misurare quanto vale quella differenza è un'altra cosa.
- **(c) `evidence_age` accanto alla board.** Era nel manifest e nessuno la leggeva; ora sta nell'HOVER
  della card del club — non in una riga nuova, perché il pannello spende la sua altezza sulla board e
  non sul proprio arredo (lezione dell'08/08). Solo le DATE: `evidence_age` porta anche conteggi (789
  trasferimenti nella finestra) e un conteggio stampato dove il lettore si aspetta un giorno è un
  numero che dice la cosa sbagliata. Due difetti miei nel farlo, entrambi corretti e utili da
  ricordare: la variabile del ciclo si chiamava `source` e **ombreggiava** quella del modulo (la prima
  riga dell'hover leggeva «(transfers_latest, provider lines)» — stessa famiglia dell'attributo
  `_declared` che ombreggiava il suo metodo), e il filtro sulle date è nato dal vedere `789` accanto a
  quattro giorni.

## 7. ~~Il crollo di titolarità dopo i 30~~ — **MISURATA E REFUTATA DA DUE GIUDICI** (08/08/2026)
**Da dove veniva**: l'analisi dei 172 errori del confronto storico. Due cose che quell'analisi ha
stabilito e che restano vere: **il perimetro non è il problema** (86 su 86 dei mancati erano già sul
foglio) e **65 degli 86 errori sono uomini con 10+ presenze l'anno prima**, quindi il difetto è
nell'ORDINAMENTO fra uomini che hanno tutti una storia.
**L'evidenza che la motivava**, su 500 coppie (giocatore, stagione) con 15+ start di Serie A in
ingresso, due stagioni: quota di presenze mantenuta **66% / 72% / 77% / 51%** per fasce ≤23, 24-26,
27-29, ≥30. Una U rovesciata, quindi una SOGLIA e non una tendenza — e la correlazione lineare è
debole (r −0.139, parziale −0.122) esattamente per questo.
**Implementata** come canale raggiungibile da entrambi gli harness (`presence.age_lift`,
`Inputs.age`, `desc_age` sul foglio, la griglia in `sweep.GRIDS`), perché un parametro che nessun
harness raggiunge è un parametro che nessuno può misurare.
**Rifiutata da entrambi i giudici, lo stesso giorno:**

| giudice | verdetto |
|---|---|
| `sweep` (errore sulla quota di presenze realizzata) | euro **+0.23%** (ottimo 30/0.09, **al bordo**), default **+0.04%** (31/0.06). Nessuno raggiunge il floor 0.5%; strict no, robust no |
| esito (board 15/08/2025 contro il 2025-26) | **peggiora a ogni punto**: uomini 134 → 132, moduli 13 → 12 |

**E il MECCANISMO, che spiega perché la tabella per fasce era ingannevole**: i 30+ portano **già meno
minuti misurati** — 1299 contro 1574 dei 27-29 in Serie A 2024-25 — quindi lo standing li sconta
*prima* che qualunque termine d'età intervenga, e il termine addebita due volte la stessa evidenza. La
tabella per fasce non controlla per i minuti; il modello sì. **Una differenza fra due gruppi non è un
canale finché non si verifica che il modello non la stia già leggendo.**
**Cosa resta**: il parametro a 0 e raggiungibile (come `HEATMAP_SIDE` e `PRESEASON_WEIGHT`), la
colonna `desc_age` sul foglio (`SHEET_REVISION` 12) perché la prossima ipotesi sull'età non debba
ripagarla, e la nota che **non era R4**: R4 predice il fantavoto, questa predice chi gioca — la
distinzione regge, ed è la risposta che ha comunque richiesto di essere misurata.
**Un difetto latente trovato dalla misura**: lo sweep è morto su una divisione per zero in
`absences_per_season`, presente da quando la griglia degli infortuni fu scritta — col punto
`(1.0, 0, 0)` e un uomo senza infortuni nell'ultima stagione ma con infortuni nelle precedenti, tutti
i pesi contati sono 0. Non è «non si infortuna», è «questa pesatura non ha nulla da dire su lui»:
ora cade sul ramo della storia non ripartita, «vuoto = ignoto». Era latente e l'ha esposto la crescita
del layer misurato di questa sessione.

## 7-bis. Due cose misurate e RIFIUTATE nella stessa analisi (per non riprovarle)
- **Scontare il claim per la disponibilità**: il claim è «la squadra con tutti sani» per scelta di
  design, e si potrebbe pensare che contro l'ESITO — che invece contiene gli infortuni — convenga
  moltiplicarlo per `availability`. Misurato: **132/220 uomini contro 134 e un modulo in meno**. La
  scelta di design regge anche contro il giudice più severo, e lo sconto resta dove già sta
  (`engine_pv_pred`).
- **Allargare l'acquisizione**: escluso dai dati, non per opinione. Tutti gli 86 mancati erano sul
  foglio, quindi il perimetro non lascia fuori nessuno di loro.
- **Nota sugli ARRIVI, ~~che rafforza la voce 1-bis~~ — CORRETTA**: 40 degli 86 mancati e 42 degli 86
  sbagliati sono arrivi, quindi metà degli errori sta sulla popolazione più incerta. Ma la conclusione
  che ne era stata tratta («questo sposta la 1-bis in cima») era **falsa**: quelli sono arrivi VERI, con
  cambio di club, cioè la popolazione che `level_gap` già copre — 55 degli 81 portano un
  `level_gap_z`. La 1-bis riguarda i prestiti senza cambio club, che sono cinque. Come si è arrivati
  allo sbaglio, e perché è la lezione più utile della giornata, sta nella voce 1-bis.

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
- **Voci 0 (`19351fd`), 2 (`d7ea4a3`, `a039910`), 1 (`9d0f400`), 3-bis (`a3ee449`), 3 (`8f0cb6b`),
  5 e 5-bis (`1489f58`), 4**: sopra, ciascuna coi suoi numeri. Bilancio sul giudice: moduli
  **9 MATCH / 5 ALT / 6 DIFF → 11 / 5 / 4**, uomini **160 → 166/220**, `backtest --verify` sempre
  22/22. `SHEET_REVISION` **11**: i fogli sotto quella revisione sono da rifare.
- **Il selettore modulo porta anche il SUR** (`39ec7c9`), il surplus medio dei suoi undici: seconda
  domanda accanto alla probabilità, e la 5-bis spiega perché non è la stessa.
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
