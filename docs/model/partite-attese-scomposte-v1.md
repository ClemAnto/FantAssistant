# Partite attese ricostruite dai loro motivi — v1 (30/09/2026)

**Nata dalla richiesta dell'operatore** («facciamo un nuovo ragionamento partendo da zero e poi alla fine lo
confrontiamo con il vecchio»): la stagione di ogni calciatore scomposta nei motivi per cui ha preso il voto o no, e
le partite attese (Pa) ricostruite come prodotto di quei motivi, così ognuno si ritara per conto suo. È un **banco di
prova e non una regola del motore**: `engine_*` non si muove, e niente di questo entra nel gate finché non lo batte.

## 1. La scomposizione

Per ogni partita di campionato del club mentre lui c'era, uno stato solo: **infortunato · squalificato · assente per
altro · non convocato · in panchina senza entrare · subentrato · titolare**. La fonte è il payload per partita di
Transfermarkt, già in cache (`data/cache/transfermarkt_perf_<id>.json`): porta `participationState`, `isStarting`,
`playedMinutes`, l'allenatore, e **`absenceId`, il motivo dell'assenza**. Il nostro parser (`modules/performance.py`)
salva lo stato e i minuti e butta via il motivo e il titolare: la scomposizione li rilegge dalla cache.

**La squalifica ha una fonte vera**, misurata sui cartellini della partita prima su tutta la cache:

| `absenceId` | Partita prima | Significato |
|---|---|---|
| 1 | giallo nel 93% | squalifica per somma di ammonizioni |
| 2 | doppio giallo nel 94% | squalifica per doppia ammonizione |
| 3 | rosso, o già assente (più giornate) | squalifica per rosso diretto |
| 4-13 | niente cartellini | altre assenze, non disciplinari |

Dybala 2025-26, controllato a mano partita per partita: 38 della Roma = 15 da titolare + 7 subentrato + 2 panchine +
14 infortunato. Un campione di dieci profili (Svilar, Perin, Dimarco, Romagnoli, Dybala, Pulisic, Lautaro, Malen,
Bernasconi, Palestra) su due stagioni è in chat del 30/09; Romagnoli è il più squalificato della Serie A nelle due
stagioni (5 partite).

## 2. La formula (v1)

**Pa = N × D × S × europa × c**, dalla stagione prima (e da quella prima ancora per D):
- **D, disponibilità**: 1 − (infortuni + squalifiche + altre assenze) / partite, su due stagioni (la più vecchia
  pesata `w2`), tirata verso la media della popolazione con peso `kD`;
- **S, scelto se disponibile**: miscela di quota partite, quota minuti (`alpha`) e quota da titolare (`gamma`),
  tirata verso una media del CONTESTO (Serie A stesso club, Serie A cambio club, estero top 5, altro campionato,
  portiere) con peso `kS`, per la qualità `1 + q (MV − 6)`;
- **europa**: `(1 − b E_out) / (1 − b E_in)`, E = il club gioca una coppa europea (fase principale di Champions,
  Europa League o Conference: ad agosto è nota) l'anno previsto / l'anno misurato. **Canale nuovo**: in
  `copertura-eventi-motore-v1.md` era «ASSENTE, mai misurato»;
- chi non ha nessuna stagione su file prende una costante.

Taratura per coordinate su **T1 (2023-24 → 2024-25)**, giudizio su **T2 (2024-25 → 2025-26)**, contro la previsione
pre-stagione del motore costruita come il gate la costruisce (tutte le finestre stimate, quella giudicata coi
parametri della vicina), sugli stessi uomini.

## 3. Il risultato

| | Formula | Motore |
|---|---|---|
| T1 2024-25 (taratura), 389 uomini | 8,64 | 8,24 |
| **T2 2025-26 (fuori campione), 403 uomini** | **8,18** | **8,02** |

Errore medio in partite. **La formula perde del 2,1% fuori campione.**

**La misura dell'operatore** (stessa sera): Pa previste ÷ partite a voto vere, 100% esatto, 50% ne ha giocate il
doppio, 200% la metà. Su T2, fra chi ha giocato almeno una partita: **entro 80-125% del vero la formula mette il 33%
degli uomini, il motore il 37%**; rapporto mediano 89% contro 95%, cioè la formula SOTTOSTIMA un po' più del motore.
La pagina mostra un campione deterministico di 143 uomini (fino a due per ruolo × contesto × fascia di partite vere,
scelti da un hash dell'id) e il riepilogo su tutti. Tre cose, in ordine di peso:
- **chi è rimasto tutta la stagione** (339 su 403): formula 7,59, motore 7,19 (−5,5%). Il motore è migliore dove la
  stagione è stabile: la sua regressione è stimata direttamente sull'esito;
- **chi è partito o arrivato a stagione in corso** (64): formula **11,33**, motore 12,38 (**+8,5%**), e chi non ha
  nessuna stagione su file (18): 9,26 contro 11,60. La scomposizione regge meglio dove il motore non ha storia;
- **l'Europa vale poco**: 8,23 → 8,18 (+0,6%), `b` = 0,05, cioè −5% di S per chi gioca le coppe;
- **i portieri** perdono (8,72 contro 7,81): il motore ha una retta loro (R7), la formula no.

Due parametri stanno sul bordo della griglia (`kD` 160, `w2` 2): la disponibilità di una stagione dice poco, e la
regola di casa vieta di adottare un bordo. Non sono stati adottati: è la taratura di un banco.

## 4. Dove si vede

`toolkit/scripts/presence_test/build.py` (sola lettura su DB e cache) scrive `presence_test.json` nella cartella di
export più recente; `app/scripts/pull-bundle.mjs` lo copia; la pagina **/why → «Partite attese»** lo mostra (una riga per
uomo e finestra: la stagione prima nelle sette voci, D, S, Europa, MV, Pa formula, Pa motore, Pa vere, i due errori e
il guadagno). L'app non ricalcola niente: sottrae due numeri del file. Banco: `app/scripts/e2e-why-presence.mjs`.

## 5. v2 (01/10/2026): i quattro aperti, misurati

**Il parser.** `tm_appearances` porta ora `absence_id`, `injury_id`, `is_starting`, `coach_id` e
`competition_type` (migrazione additiva). La cache si rilegge tutta offline con `performance --from-cache` (3.571
file, 2.099.012 partite, 1'47"), e **`rebuild` la richiama**: prima non la richiamava nessuno, quindi una
ricostruzione lasciava vuota l'intera tabella - la terza replica mancante dopo `recent_form` e le probabili. Il
banco legge dal DB e non più dai file; la prova che è lo stesso fatto è che **riproduce v1 al millesimo** (fit T1:
8,637 / 8,243 su T1 e 8,179 / 8,016 su T2).

**Più stagioni.** Le dieci finestre del gate (Tm7 → T2), ognuna giudicata coi parametri tarati sulle altre nove.
La copertura di Transfermarkt è del 79-94% degli uomini per finestra. **La formula perde contro il motore su tutte
e dieci: −4,8% medio, peggiore −9,7%** (T2 −0,05%, cioè pari; T0 −1,0%). Nessun parametro sta sul bordo della sua
griglia (kD 40-80, w2 0,5-0,75, kS 10-20, q 0,3-0,5, b 0,1-0,15, c 0,95-1,0): la forma è identificata, e perde.

**Le medie per ruolo** (regola dell'operatore, 01/10/2026: «quando nei calcoli mancano dei dati utilizziamo sempre
le medie per ruolo in quell'ambito»). Ogni ripiego - la disponibilità verso cui si tira un campione corto, la
probabilità di essere scelto, la quota di chi non ha stagioni, la media voto di chi non ne ha - è la media del suo
ruolo nel suo contesto, con la catena ruolo×contesto → contesto → tutti sotto `CELL_MIN` = 10 uomini. Contro le
medie per solo contesto di v1: **7 finestre su 10 migliori, +0,35%** - piccolo, nella direzione giusta, adottato
perché è una dichiarazione e non per il banco.

**I portieri.** La retta loro (la forma di R7, con le stesse funzioni `fit_linear` + `linear_share`) è
**respinta: peggio del prodotto su 10 finestre su 10 (−12,9%)**. Il prodotto con le medie di ruolo, tarato su nove
finestre invece che su una, **batte R7 del motore sui portieri in 7 su 10** (+2,9%, peggiore −7,8%): la perdita
di v1 sui portieri (8,72 contro 7,81) era la taratura su una stagione sola.

**La miscela con le giornate giocate.** Sulle quattordici finestre in-season del gate (5 settembre e 5 febbraio,
2019-20 → 2025-26) il prior della formula - tarato sulle finestre pre-stagione la cui stagione bersaglio NON è
quella, o avrebbe letto l'esito - è miscelato con la funzione del motore (`model.blend_with_seen`) al K del motore
(R20K10). La miscela conta moltissimo (a febbraio 4,3 → 3,2 partite di errore) ed è comunque **peggio del motore in
10 finestre su 14, −1,7% medio**, meglio a settembre 2021 e 2025.

**Verdetto del banco: la scomposizione non batte il motore in nessuna forma misurata**, pre-stagione o a stagione
iniziata. Le due cose che regge meglio restano quelle di v1 (chi cambia club a stagione in corso, chi non ha
storia) e i portieri; la pagina le mostra riga per riga.

**La pagina** (stessa sera, richieste dell'operatore): la squadra della stagione misurata e di quella prevista (il
club della rosa del gate, poi quello con più partite nel livello per-partita, poi quello da cui lo porta un
trasferimento: 1.362 righe su 5.861 restano senza, perché nessuna fonte ci dice il club - chi non ha stagioni su
file e i campionati minori prima del 2023); l'intestazione fissa (il contenitore scorre nei due assi dentro
un'altezza sua, perché uno che scorre in orizzontale si porta via l'ancora dello sticky); il Pa della formula in
grassetto; il selettore su tutte e dieci le stagioni; e **il gradino di titolarità ricavato**, calcolato nel
toolkit con `engine/status.py` sulla S della formula e sui minuti della stagione misurata, accanto al gradino
raggiunto davvero. Il gradino ricavato non ha il cancello dell'undici tipo (una finestra passata non ha una board
disegnata) e lo dice; ed è più stretto del vero per costruzione (S è una previsione regredita: su T2 274 `panchina`
contro 158 veri, 30 `bandiera` contro 95), come ogni previsione è più stretta degli esiti.

## 5-bis. Stessa sera: i portieri per classe, le partite saltate, e solo chi conta al fantacalcio

**Contini e Christensen** (operatore): un terzo portiere a 3,2 presenze e un secondo portiere a 15,8. La prima
causa era la media verso cui si tira un portiere, quella di TUTTI i portieri (0,44), che mescola titolari e riserve:
una quota «a metà» non la tiene nessuno. Ora il contesto di un portiere è la sua CLASSE dell'anno prima (titolare
se ha preso il voto in almeno metà delle partite per cui era disponibile, riserva altrimenti; medie 0,62 e 0,22):
**+0,57% sul totale, robust (7 finestre su 10, peggiore −1,2%)**, adottata. La seconda causa, per Christensen, è
che le sue 16 presenze erano in prestito in Serie B: leggere la quota di scelta sulle sole partite del club dove
giocherà è **respinto** (−0,05%, 5 su 10, peggio sui portieri) e resta una lettura spenta (`OWN_CLUB`). Il prezzo
detto: Butez, riserva l'anno prima (19 su 40), scende da 17,0 a 14,3 contro le 38 che ha giocato.

**Le partite saltate nella stagione prevista**: infortunio, squalifica e nazionale. `absence_id` 5 e 8 cadono entro
quattro giorni da una partita della sua nazionale nell'88,8% e 87,4% dei casi, contro l'1-5% degli altri codici:
sono le convocazioni, e ora si contano a parte (nella stagione misurata restano dentro «Ass.»).

**Solo chi conta al fantacalcio** (operatore: «eliminiamo dai test i calciatori con quotazione iniziale bassa»):
fuori dalla taratura e dal giudizio chi ha Qt.I ≤ 5 della stagione prevista (`MAX_CHEAP_PRICE`); chi non ha una
Qt.I resta, perché non è economico, è ignoto. 3.241 righe su 5.861. Il quadro cambia:

| | Formula contro motore |
|---|---|
| pre-stagione, 10 finestre | 3 su 10, media −1,7%; vince le ultime tre (T0 +4,4%, T1 +0,5%, T2 +1,8%) |
| portieri | **8 su 10, +14,3%** |
| 5 settembre, 7 finestre | **7 su 7**, da +0,5% a +13,8% |
| 5 febbraio, 7 finestre | 2 su 7, da −6,2% a +0,8% |

Quindi il motore batteva la formula soprattutto sugli uomini da pochi crediti. Su chi si compra la scomposizione è
alla pari prima della stagione, meglio sulle stagioni recenti (quelle con la copertura di Transfermarkt più alta,
91-94%) e meglio a inizio stagione; a febbraio no, e nessun K della miscela lo cambia (letti 3-40: il migliore resta
sotto il motore in cinque finestre su sette), quindi il vantaggio del motore lì non sta nel peso delle giornate viste.

## 5-ter. Due momenti, e il momento che conta è settembre (01/10/2026)

**L'operatore**: «molte aste, inclusa la mia, vengono fatte dopo la fine del mercato di Serie A», quindi la formula
si giudica in due momenti e il principale è **inizio settembre**:
- **fine luglio** (31/7): le dieci finestre pre-stagione del gate con la data d'asta spostata al 31 luglio;
- **inizio settembre** (5/9): le sette finestre in-season del gate (`INSEASON_WINDOWS`, metà «set», 2019-20 → 2025-26),
  mercato chiuso e 2-3 giornate giocate. Il prior è la formula di luglio tarata sulle finestre la cui stagione
  prevista NON è quella; sopra, la miscela con le giornate viste al K del motore (R20K10) e le partite che uno stop
  ancora aperto dovrebbe costargli.

**Gli infortuni lunghi imprevedibili stanno fuori dal giudizio** (operatore, sul caso Lukaku): chi dalla data d'asta
perde per infortunio almeno un terzo delle partite (il 90° percentile della popolazione, 0,316) senza avere uno stop
aperto quel giorno è segnato in ambra e non conta né per la formula né per il motore. Chi era già fuori alla data
d'asta resta nel giudizio, perché il fatto c'era: **Lukaku è di questi**, il suo stop alla coscia comincia il 14 agosto
2025, il giorno prima della data d'asta del gate.

| | Formula contro motore |
|---|---|
| **inizio settembre, 7 finestre** | **7 su 7, +3,75%, peggiore +0,35%** (strict) |
| portieri, settembre | 7 su 7, +15,7% |
| fine luglio, 10 finestre | 6 su 10, +0,1% |
| portieri, luglio | 10 su 10, +17,8% (strict) |

**Le giornate viste: il calendario del club batte «da quando è al club».** Letture misurate a settembre contro il
motore: calendario 7 su 7 (+3,46%), calendario + stop aperto 7 su 7 (+3,75%); dal giorno in cui è al club, contando
le partite da infortunato come non giocate, 3 su 7; lo stesso togliendole, 2 su 7; solo il prior di luglio 1 su 7
(−5,2%). Una partita saltata per infortunio contata come non giocata PORTA l'infortunio, ed è per questo che
toglierla perde. Il caso Hojlund (al Napoli dal 1º settembre, prima partita il 13) è vero e resta un caso: in media
la lettura «dal suo arrivo» costa.

**Lo stop aperto** aggiunge poco (5 su 7, +0,3%, sotto la soglia del gate) ed è tenuto perché legge un fatto che l'asta
aveva. Il suo limite è detto: la data di rientro dell'archivio è l'ESITO e non la previsione del giorno, quindi la
durata attesa è la mediana di quanto restava agli stop chiusi prima della stagione, a parità di giorni già passati.
Per Lukaku, fuori da 22 giorni, quella mediana dà **2 partite** contro le 28 che ha perso: il dato che avrebbe detto
«tre-quattro mesi» (la stima di Transfermarkt del giorno, o la prosa della pagina indisponibili) non esiste per le
stagioni passate.

**La pagina**: i due momenti in un interruttore (settembre per primo), il riquadro della formula pieghevole e
ricordato, tre blocchi (stagione misurata · prevista · dati veri), e in «prevista» le giornate da giocare, i voti
sulle giornate viste e lo stop aperto. `e2e-why-presence` verifica tutto, compresa l'ambra.

## 5-quater. Il pavimento: quanto sbaglierebbe una formula perfetta (01/10/2026)

**Domanda dell'operatore**: «se avessimo una formula che calcola perfettamente ogni fattore, ci sarebbe sempre una
percentuale di indeterminazione dovuta agli imprevisti: quanto vale?». Si misura con un ORACOLO
(`toolkit/scripts/presence_test/floor.py`, sola lettura): conosce di ogni uomo la quota VERA con cui viene scelto quando
è disponibile - la sua quota realizzata, che nessuna formula può sapere - e la disponibilità solo come la distribuzione
del suo ruolo. Quello che gli resta da sbagliare è l'imprevedibile, simulato 400 volte per uomo. Popolazione: 5
settembre, quotati sopra 5, sette stagioni, 2.194 uomini, partite contate sui dati per partita di Transfermarkt.

| | errore medio (partite) | entro 80-125% del vero |
|---|---|---|
| **il pavimento**, con anche la scelta che cambia in stagione | **4,16** | **70%** |
| lo stesso, con la scelta costante | 3,79 | 78% |
| · di cui solo gli imprevisti di disponibilità (infortuni, squalifiche, nazionale) | 3,42 | |
| · di cui solo il caso partita per partita | 1,18 | |
| **il motore oggi**, stessi uomini | **7,02** | **48%** |

Per ruolo il pavimento è P 2,6 · D 3,7 · C 3,8 · A 4,1. «La scelta che cambia in stagione» (un esonero, un litigio, un
acquisto di gennaio) è misurata dal dato: le metà cronologiche della stagione di un uomo differiscono più delle sue
partite pari e dispari (varianza 0,044 contro 0,012), cioè una deriva di **0,18 di quota** fra prima e seconda metà.

**Quindi**: circa **il 60% dell'errore di oggi è imprevedibile** e il 40% (circa 3 partite a testa) è margine. Il
risultato massimo a cui tendere è ~4 partite di errore medio e ~70% degli uomini entro l'80-125% del vero, non lo zero
né il 100%. E il grosso dell'imprevedibile sono gli infortuni: da soli fanno 3,4 delle 4,2 partite.

Tre limiti, detti: la disponibilità è nota solo per ruolo (se la propensione del singolo agli infortuni si potesse
conoscere, il pavimento scenderebbe un poco - ma la formula tira la sua storia verso la media con peso 40-80 partite,
cioè la storia del singolo dice poco); uno stop già aperto alla data d'asta è trattato come imprevisto (il pavimento
scenderebbe un poco); le partite sono quelle giocate e non i voti.

## 5-quinquies. Le regole del giudizio, e dove sta il margine (01/10/2026)

**Decise dall'operatore prima di toccare la formula:**
- **L'obiettivo è il 65% degli uomini entro l'80-125% del vero** (il limite di una formula perfetta è ~70%, il motore
  è al 48%). È la misura che decide; l'errore medio in partite resta come lettura.
- **Il momento è inizio settembre**, dopo la chiusura dei mercati. Fine luglio resta come lettura.
- **EuroLeghe dopo.**
- **Le date di rientro si archiviano da oggi**: `injury_forecasts` (Transfermarkt, una riga per stop aperto e giorno
  di lettura: 344 stop, 152 con una data, dal primo replay) accanto a `availability.expected_return` (la prosa di
  fantacalcio.it, già datata ogni giorno dal 26 luglio).

**La popolazione: una quotazione base per ruolo** (decisa dall'operatore). I quotati sopra 5 non sono quello che
un'asta compra: per stagione 18-20 portieri, 83-95 difensori, 104-130 centrocampisti, 79-87 attaccanti, contro i
30/80/80/60 di una lega da dieci con rose 3/8/8/6. La base è la Qt.I dell'ULTIMO uomo che quella lega compra, come
mediana delle dodici stagioni del listone Serie A: **D ≥ 6** (5-7), **C ≥ 8** (6-9), **A ≥ 11** (6-15); **P > 5** per
scelta dell'operatore (il 30° portiere costa 1 in ogni stagione, perché i terzi portieri costano tutti 1, e contano i
titolari). Il 2026-27 ha le basi di C e A a 6: è la stagione in corso e non si giudica. `build.QTI_BASE`; R33b resta
congelata sui quotati sopra 5.

**E si giudica con tutti dentro**: gli infortuni lunghi imprevedibili restano nel giudizio e sono segnati in ambra
(`scored(everybody=True)`), perché toglierli è una selezione sull'esito (gate §7-octsexagies bis).

**Dove siamo, su questa popolazione** (5 settembre, sette stagioni):

| | entro 80-125% del vero | errore medio |
|---|---|---|
| obiettivo dell'operatore | **65%** | |
| limite di una formula perfetta | 71,5% | 4,07 |
| **la formula** | **~56%** (52-60% per stagione) | 6,68 |
| il motore | ~50% (44-54%) | 6,92 |

Sull'errore medio la formula batte il motore 6 stagioni su 7 (+2,2%, robust); sulla quota entro l'80-125% 6 su 7.

**Dove sta il margine** (`margin.py`, settembre, la popolazione dell'asta, 1.479 uomini col motore accanto): formula
6,68, motore 6,92, pavimento 4,19.

| gruppo | n | formula | motore | pavimento | margine | quota del margine |
|---|---|---|---|---|---|---|
| stesso club, titolare (S ≥ 0,6) | 1.003 | 6,42 | 6,66 | 4,30 | 2,12 | **58%** |
| cambio club dalla Serie A | 288 | 6,85 | 7,02 | 4,26 | 2,59 | 20% |
| portiere titolare | 101 | 6,40 | 7,35 | 3,22 | 3,18 | 9% |
| stesso club, riserva/rotazione | 57 | 9,03 | 8,79 | 3,89 | 5,13 | 8% |
| portiere riserva · cambio club dall'estero | 30 | | | | | 5% |

Più della metà del margine sta sui titolari rimasti nel loro club, che sono anche due terzi di quello che si compra; e
la formula sbaglia più spesso **per eccesso** (64% dell'errore sopra il vero). È da lì che si comincia.

## 5-sexies. La diagnosi dei titolari, e due modifiche PRE-REGISTRATE (01/10/2026)

**La diagnosi** (`diagnose.py`, settembre, la popolazione dell'asta): per i titolari rimasti nel club (1.002 uomini)
la formula dà D 0,876 contro 0,840 vero e **S 0,816 contro 0,871 vero** - la scelta è SOTTOstimata, e l'eccesso sulle
presenze viene tutto dalla disponibilità: chi perde meno del 10% della stagione è sottostimato di 0,67 partite, chi
perde il 10-33% sovrastimato di 2,91, chi perde oltre un terzo di 11,21 (128 uomini, errore 11,60).

**Scritte prima di misurarle**, e misurate con la regola del giudizio decisa (inizio settembre, la popolazione
dell'asta, tutti dentro, ogni finestra coi parametri delle altre):

* **M1 - le classi anche per chi non è portiere.** La media verso cui si tira S è quella del ruolo nel contesto E nella
  classe dell'anno prima (titolare se ha preso il voto in almeno metà delle partite per cui era disponibile, altrimenti
  rotazione): la stessa soglia e la stessa forma dei portieri (`KEEPER_CLASS_SHARE`), per la stessa ragione - una
  media che mescola titolari e rotazioni tira in basso i primi e in alto i secondi.
* **M2 - la formula di settembre tarata su settembre.** I parametri della griglia (kD, w2, alpha, gamma, q, kS, b, c)
  si tarano sulle finestre di settembre - sull'esito delle giornate che restano - lasciando fuori quella giudicata,
  invece di prenderli da luglio, dove l'esito è la stagione intera (agosto compreso, che ha meno infortuni).

* **M1b - la classe è il GRADINO dell'anno prima** (aggiunta il 01/10/2026 prima di misurare, dalla taratura qui sotto):
  la media verso cui si tira S è quella del ruolo e del gradino di titolarità della stagione misurata (sei parole,
  `engine/status.py` senza il cancello della board), con la catena gradino → contesto → tutti sotto `CELL_MIN`.

* **M3 - i minuti trasformano le presenze in voti** (aggiunta il 01/10/2026, prima di misurare, su richiesta
  dell'operatore per panchine e ballottaggi): la quota di scelta si moltiplica per quanto spesso un ingresso di quella
  durata prende il voto, a bande dei minuti medi dell'anno prima e relativo a chi gioca la partita intera, tarato sulle
  finestre di taratura (`minutes_votes.py`: 0,75 · 0,82 · 0,86 · 0,89 voti per presenza a 30-44' · 45-59' · 60-74' ·
  75-90'). Per tutti i ruoli di movimento; il portiere prende sempre il voto.
* **M4 - la formula si tara sulla misura che decide** (aggiunta il 01/10/2026, prima di misurare). L'operatore: «se
  TIZIO quest'anno è previsto TITOLARE, salvo imprevisti, dovrebbe fare circa 36 presenze» - ed è vero per chi il posto
  lo tiene (titolari stabili e senza imprevisti: 37,0 presenze e 36,1 voti su 38), mentre la media di chi era titolare
  l'anno prima (28,6 voti) la tira giù chi il posto l'ha perso. La griglia oggi minimizza l'errore MEDIO, che premia la
  media; la misura dell'operatore (entro l'80-125% del vero) premia il valore TIPICO. M4 tara i parametri sulla quota
  entro l'80-125% (`band_loss`) invece che sull'errore medio. Attesa: la quota sale, l'errore medio può peggiorare - ed
  è una scelta dichiarata che la misura che decide sia la prima.
* **La stabilità del gradino NON è un candidato** (operatore: «la stabilità non è pronosticabile, la formula deve
  funzionare a prescindere»): la formula si tara sul gradino dell'anno prima, che è quello che si sa (M1b).

**Criterio**, sulla misura dell'operatore: la quota entro l'80-125% del vero sale in **almeno 5 finestre su 7** e in
media, e l'errore medio non peggiora in media. M1 e M2 si misurano ciascuna da sola e poi insieme; si tiene la forma
migliore che passa. **Attese**: M1 +1/+3 punti di quota (la scelta dei titolari sale verso lo 0,87); M2 meno di un
punto (corregge un livello, e c già lo assorbe in parte).
**Contaminazione**: sono le stesse sette finestre già lette molte volte; la prova pulita resta il 2026-27.

### Quante partite gioca ogni gradino, senza imprevisti (01/10/2026)

**Domanda dell'operatore**: «senza infortuni e imprevisti, quante presenze ci aspettiamo da un titolare, da uno in
ballottaggio, da una riserva? Attenzione a non mischiare minutaggio e gradino». `rungs.py`: il gradino è quello NOTO
all'asta (la stagione prima, sui suoi due assi, senza il cancello della board), l'esito è la stagione dopo il 5
settembre contato **solo sulle partite in cui era disponibile**, quindi infortuni, squalifiche e nazionale sono fuori
per costruzione. Popolazione dell'asta, sette stagioni.

| gradino dell'anno prima (movimento) | n | presenze su 38 | **voti su 38** | voti, mediana |
|---|---|---|---|---|
| bandiera | 486 | 33,9 | **30,7** | 34,8 |
| titolarissimo | 113 | 30,9 | **27,3** | 31,7 |
| titolare | 294 | 33,0 | **29,1** | 33,6 |
| ballottaggio | 311 | 31,8 | **26,1** | 29,1 |
| panchina | 331 | 29,1 | **24,5** | 26,3 |
| riserva | 106 | 21,3 | **17,8** | 19,0 |
| *portieri bandiera* | 75 | 33,3 | *33,3* | 36,8 |

Tre letture. **Sulle PRESENZE i minuti non contano**: i primi quattro gradini, che differiscono solo per il pavimento
di minuti, stanno tutti fra 31 e 34. **Sui VOTI sì**, perché un ingresso di pochi minuti spesso resta senza voto: il
ballottaggio ha 31,8 presenze e 26,1 voti - ed è questa la ragione per cui minutaggio e gradino vanno tenuti separati:
la quota di partite dice quante volte ENTRA, i minuti dicono quante di quelle volte il voto arriva. E **la regressione
è forte**: una riserva dell'anno prima prende il voto in 17,8 partite su 38 quando è disponibile, molto più del «non
entra spesso» che la parola promette, e una bandiera in 30,7 e non in 36.

### ...e i giocatori STABILI senza imprevisti (01/10/2026)

**Richiesta dell'operatore**: per ogni gradino, uomini che hanno tenuto lo stesso gradino tre stagioni di fila e nella
terza non hanno avuto imprevisti (al massimo 2 partite saltate per infortunio, squalifica, assenza o nazionale, un solo
club, Serie A, quotati nella popolazione dell'asta), e quante partite hanno giocato davvero (`steady.py`).

| gradino | casi | presenze su 38 | voti su 38 | la tabella generale (voti) |
|---|---|---|---|---|
| bandiera | 65 | 36,9 | **36,7** | 30,7 |
| titolarissimo | 1 | 33,9 | 33,9 | 27,3 |
| titolare | 6 | 37,0 | **36,1** | 29,1 |
| ballottaggio | 15 | 35,1 | **32,9** | 26,1 |
| panchina | 13 | 27,7 | **24,0** | 24,5 |
| riserva | 1 | 18,5 | 17,5 | 17,8 |
| *portieri bandiera* | 38 | 37,1 | *37,1* | 33,3 |

Esempi: bandiera - Mancini, Locatelli, Frendrup, Vasquez (35-36 voti su 36-38 disponibili); titolare - Leão, Lautaro,
Strefezza (34-37 voti, ma 25-32 da titolare: entrano anche dalla panchina); ballottaggio - Orsolini, Pasalic,
De Ketelaere (33-36), El Shaarawy 24; panchina - Masina 25, Simeone 19 (30 presenze, 1 da titolare, 13'), Chiriches 27.

**Quindi il gradino, quando è stabile e non succede niente, mantiene la promessa**: una bandiera prende il voto in quasi
tutte le partite in cui è disponibile. La distanza dalla tabella generale (30,7) è quello che fa l'anno dopo chi il
gradino lo ha avuto UNA stagione: cambi di gradino, di club, di allenatore. Due conseguenze per la formula: la
**stabilità del gradino** negli anni è un'informazione che la formula oggi non legge (guarda una stagione e mezza,
`w2`), e il limite di chi entra dalla panchina è il VOTO e non la presenza (Simeone: 30 presenze, 19 voti). Titolarissimo,
titolare e riserva stabili per tre anni sono rari (1, 6, 1 casi): numeri da leggere, non da tarare.

### La scala perde `titolarissimo` (01/10/2026)

**L'operatore**: «titolarissimo è un gradino sopra titolare quindi non è possibile che preveda meno presenze ... anche
ballottaggio non può essere superiore a titolare o titolarissimo. Se necessario eliminiamo la voce». Era necessario: il
gradino era il residuo dei due assi (oltre l'80% ma non il 90%, col pavimento dei 75'), mentre `titolare` prendeva anche
chi gioca oltre il 90% e viene sostituito - quindi sulle presenze stava sopra. Fuso in `titolare`, la scala è in ordine
su tutte e due le misure (settembre, gradino dell'anno prima, partite in cui era disponibile):

| gradino | presenze su 38 | voti su 38 |
|---|---|---|
| bandiera | 33,9 | 30,7 |
| titolare | 32,4 | 28,6 |
| ballottaggio | 31,8 | 26,1 |
| panchina | 29,1 | 24,5 |
| riserva | 21,3 | 17,8 |

Toolkit (`engine/status.LADDER`, `SHEET_REVISION` 81) e app (`core/titolarita.ts`); una riga o una dritta vecchia che
porta la parola si legge `titolare`; la scala della STAMPA tiene la sua parola, che si traduce in `titolare`. E ogni
soglia sulla scala ora si scrive col NOME (`rungIndex`): le buste chiuse scrivevano `rank <= 2` per «titolare o meglio»,
e con una parola in meno quel numero voleva dire «ballottaggio».

## 6. Aperti

1. La qualità misurata meglio di MV; la quota di chi a gennaio cambia campionato.
2. I minuti del gradino ricavato sono quelli della stagione misurata, non una previsione (`minutes.per_appearance`
   vuole le colonne del foglio): se il gradino diventa una lettura da usare, va rifatto sui minuti previsti.
3. Se una parte della scomposizione deve entrare nel motore, la strada è il gate con una regola pre-registrata sulla
   popolazione dove regge (i portieri, e l'asta di settembre), non la formula intera.
4. I portieri: la maglia lasciata libera da chi è partito è stata **pre-registrata e passata al gate** (R32/R32b,
   gate §7-sexsexagies, 01/10/2026): da sola respinta, la variante «senza credito se arriva un portiere più caro»
   va nella direzione giusta (7 finestre su 10, +3,5%) e non passa per una finestra a −21%. Resta candidata per il
   2026-27. Aperto: il peso delle prime giornate quando il vecchio titolare è sano.
5. Febbraio: capire da dove viene il vantaggio del motore a stagione avanzata, visto che non è il K (fuori dai due
   momenti che contano, quindi in coda).
6. Settembre: la durata attesa di uno stop già aperto. Per le stagioni future esiste (la data di rientro della
   pagina indisponibili, `availability.return_date`, e Transfermarkt finché lo stop è aperto); per giudicarla serve
   archiviarla col giorno in cui la si legge.
7. **Settembre al gate - FATTO il 01/10/2026** (gate §7-septsexagies): R33, tarata su tutti i quotati, non passa
   (2 su 7, −3,0%; sui quotati sopra 5 −0,2%). Il vantaggio del banco c'è solo se la formula è tarata e usata sui
   quotati che contano, e quella forma su queste finestre è già vista: **R33b** è congelata e si giudica in avanti sul
   2026-27 (`gate_r33.py --r33b`), letture alla 10ª e alla 19ª, verdetto alla 38ª. **E la tabella del §5-ter va letta
   sapendo questo**: il 7 su 7 del banco a settembre dipende dall'aver tolto gli infortuni lunghi imprevedibili, che è
   una selezione sull'esito e favorisce la formula (prevede più del motore). Con tutti dentro, sui quotati sopra 5, è
   3 su 7 e +1,4%. L'ambra resta per leggere i casi; per giudicare, tutti dentro.
8. **EuroLeghe.** Il banco gira solo su `default`/classic: la piattaforma della sua lega mantra non è misurata.
9. **Le contaminazioni di luglio, dette e non misurate.** A luglio la formula legge il club della stagione prevista
   dalla prima partita di quella stagione (`first`), quindi conosce anche chi è stato venduto il 31 agosto; il
   motore legge il listone bersaglio, che è l'ultima lettura. Tutte e due in favore del modello: il numero di luglio
   è un tetto, non una stima.
10. **I terzi portieri.** La classe «riserva» (media 0,22) resta alta per chi l'anno prima non ha giocato mai:
    Christensen 12,9 contro 1, Contini 2,6. Una terza classe (zero presenze) è la prova da fare.
11. **Le amichevoli** non sono giudicabili: in archivio ci sono per 39 club nel 2024-25, 46 nel 2025-26 e 179 nel
    2026-27. La prima stagione su cui misurarle è l'estate 2027.
12. **La squadra della stagione misurata** manca su 1.362 righe di 5.861 (chi non ha stagioni su file e i
    campionati minori prima del 2023): solo visualizzazione, nessun numero ne dipende.
