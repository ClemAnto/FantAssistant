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

### L'esito di M1-M4 (01/10/2026, `m_eval.py`)

5 settembre, sette stagioni, la popolazione dell'asta, tutti dentro, ogni stagione coi parametri tarati sulle altre.

| variante | quota entro 80-125% | stagioni meglio della base | errore medio |
|---|---|---|---|
| base | 56,0% | - | 6,796 |
| M1 classe titolare/rotazione | 56,4% | 4 su 7 | 6,802 |
| **M1b classe = gradino** | **56,9%** | **5 su 7** | 6,806 |
| M2 tarata su settembre | 54,6% | 2 su 7 | 6,870 |
| M3 minuti → voti | 56,7% | 4 su 7 | 6,800 |
| M4 tarata sulla quota | 57,2% | 3 su 7 | 6,988 |
| M1b + M4 | 57,5% | 3 su 7 | 6,959 |
| M1b + M3 + M4 | 56,9% | 5 su 7 | 7,079 |
| *motore* | *50,0%* | | *6,949* |

**Nessuna passa per intero.** M1b soddisfa la quota (5 su 7, +0,9 punti) e manca la clausola sull'errore medio di un
centesimo (6,806 contro 6,796): la decisione è dell'operatore. M2 peggiora; le combinazioni non sommano.

**E la lettura che conta è la taglia**: ogni variante muove la quota di un punto al massimo, contro i 9 che mancano al
65%. Il margine non sta in COME si tara, sta in COSA la formula sa: legge la stagione passata dell'uomo e niente della
sua squadra. Il candidato più forte già misurato nel progetto è l'undici tipo (a parità di claim, chi la board disegna
realizza 0,51 di quota da titolare contro 0,33), che però per le stagioni passate esiste solo dove c'è un foglio datato.

**M1b + M4 ADOTTATE per settembre** (decisione dell'operatore, 01/10/2026, col criterio NON soddisfatto e detto: «vedo
dei miglioramenti importanti a scapito di piccole perdite»). `build.SEPTEMBER_CLASS` = gradino dell'anno prima,
`SEPTEMBER_OBJECTIVE` = la quota entro l'80-125%. Il banco rigenerato riproduce la misura: **57,5% entro l'80-125%**
(56,0 · 63,4 · 56,3 · 56,9 · 58,8 · 57,4 · 53,8), il motore 50,0%; sull'errore medio il prezzo detto - la formula batte
il motore 3 stagioni su 7 invece di 6. Fine luglio resta com'era.

### PRE-REGISTRAZIONE (01/10/2026) - M5: quello che la BOARD sa al 5 settembre

Scritta prima di misurare. I pacchetti del viaggio nel tempo sono datati 5 settembre 2024 e 5 settembre 2025, cioè le
finestre di settembre 2024-25 e 2025-26, e il loro `boards/leghe.json` dice per ogni quotato Serie A se l'undici tipo
lo mette in campo (`in_eleven`) e il gradino del foglio a quella data (`status`, che usa la board e le giornate giocate).

* **M5a - la board corregge la scelta**: la quota di scelta della formula (dopo la miscela) si moltiplica per il
  rapporto vero/previsto dei disegnati e dei non disegnati, misurato sull'ALTRA delle due stagioni.
* **M5b - il gradino previsto quest'anno dà le presenze** (l'operatore: «se TIZIO quest'anno è previsto TITOLARE, salvo
  imprevisti, fa circa 36 presenze»): la quota di scelta è la MEDIANA vera della quota di chi il foglio metteva su quel
  gradino, misurata sull'altra stagione; disponibilità, stop aperto e giornate da giocare restano quelli della formula.

**Criterio**: la quota entro l'80-125% sale in tutte e due le stagioni rispetto alla formula adottata (M1b + M4), e
l'errore medio non peggiora in media. **Evidenza debole e detta**: due stagioni sole, e i pacchetti sono stati costruiti
col codice di oggi, tarato anche su quelle stagioni; un sì qui è un segno, e la prova è il 2026-27.

**L'esito di M5a e M5b** (`m5_board.py`): nessuna passa. M5a abbassa l'errore medio del 12-18% (7,54 → 6,60 · 7,19 → 5,87)
e fa SCENDERE la quota in tutte e due le stagioni (57,4 → 50,5 · 53,8 → 52,0), perché il suo fattore (la mediana
vero/previsto) è tarato sull'errore e abbassa anche il caso tipico; M5b sale nel 2024-25 (60,0) e scende nel 2025-26 (50,7).
**La diagnosi trova un terzo segnale**: chi la board del 5 settembre NON CONOSCE PIÙ (quotato dal listone, assente dal
foglio di quel giorno: ceduto o fuori rosa) - 16 e 19 uomini, formula 22,2 e 24,8 presenze, vere 5,8 e 5,9.

**PRE-REGISTRAZIONE (01/10/2026, stesso giorno, e nata da quei numeri - quindi evidenza ancora più debole):**
* **M5c** - chi la board non conosce più: la sua Pa × il rapporto mediano vero/previsto del suo gruppo nell'altra
  stagione; gli altri invariati.
* **M5d** - M5a con i fattori scelti per massimizzare la quota entro l'80-125% sull'altra stagione (griglia 0,5-1,2).
Stesso criterio di M5.

**L'esito di M5c e M5d**: M5c (chi la board non conosce più) tiene la quota (57,4 → 57,9 · 53,8 → 53,8) e abbassa
l'errore medio del 12-16% (7,54 → 6,62 · 7,19 → 6,01); alla lettera non passa (pari nel 2025-26). M5d peggiora la quota
nel 2024-25 (54,2). **Letta per quello che è, M5c corregge la POPOLAZIONE e non la formula**: quegli uomini stanno nel
banco perché il listone di una stagione passata è l'ultima lettura e porta i ceduti dell'ultimo giorno; a un'asta del
5 settembre il foglio li ha già tolti. ~~Decisione dell'operatore in sospeso.~~
**RITIRATA lo stesso giorno, guardando i nomi** (la regola «prima di credere a un numero si guardano i casi»): il gruppo
che la board «non conosce più» è fatto di **Guendouzi e Castellanos (Lazio, ceduti a gennaio 2026), Kvaratskhelia e
Dorgu (ceduti a gennaio 2025)**, più arrivi estivi assenti per altre ragioni (Lucca, Dzeko). Il 5 settembre c'erano tutti.
Mancano dal pacchetto perché il pacchetto è stato costruito DOPO e toglie i ceduti leggendo `listone_quotes.sold`, che è
l'ULTIMA lettura del listone di quella stagione: chi è venduto a gennaio risulta già ceduto a settembre. Quindi M5c
leggeva in gran parte il FUTURO, e il suo −12-16% di errore è una contaminazione. **Respinta.** È anche un difetto dei
pacchetti del viaggio nel tempo in sé, scritto negli aperti; e M5a/M5b, costruiti sugli stessi pacchetti, vanno letti con
la stessa riserva. La board che mette in campo sposta poco la
misura che decide: i disegnati sono già previsti bene (27,4 → 26,1 · 27,8 → 26,3).

## 5-septies. Dove sbagliamo sui titolari rimasti (01/10/2026, `starters.py`)

Sola lettura, sulla formula ADOTTATA a settembre (M1b + M4; §5-quinquies misurava quella di prima). Riproduce la misura
pubblicata: quota 57,5% contro 50,0%, errore 6,959 contro 6,949.

**Prima una scoperta sulla POPOLAZIONE.** 58 uomini del banco su 1.537 (42 dei 1.002 «titolari rimasti») il 5 settembre
**giocavano già fuori dalla Serie A**: l'ultima partita di campionato prima dell'asta è altrove e nessuna di Serie A
segue entro 30 giorni. Sono le partenze d'estate (Lukaku 2021-22, Scamacca e Theate 2022-23, Ndoye e Thauvin 2025-26)
e gli arrivi di gennaio (Gimenez, Taylor K., Obrador). Il banco li tiene perché il listone di una stagione passata è
l'ultima lettura - la stessa trappola del §5-sexies (M5c), ma qui la prova è datata PRIMA dell'asta. Formula 19,8
partite, motore 16,4, vere **2,6** (46 su 58 a zero). La quota non li vede, perché **un uomo a zero voti è escluso dal
conteggio** (`ratio` → None: 81 righe su 1.537); l'errore medio sì. Senza di loro:

| | quota (zeri esclusi) | quota (zeri contati come fuori) | errore formula / motore |
|---|---|---|---|
| tutti | 57,5% / 50,0% | 54,5% / 47,3% | 6,959 / 6,949 |
| senza chi era fuori | 58,0% / 50,0% | 56,6% / 48,8% | **6,533 / 6,666** |

I 30 giorni tengono chi è arrivato all'ultimo giorno di mercato e non aveva ancora giocato (Messias 2021, Okaka 2019):
per decidere leggono il calendario DOPO l'asta, ed è l'unica fuga accettata, per mancanza di una rosa datata.

**Poi i titolari rimasti, senza i fuori** (960 uomini, 940 con almeno un voto; quota 63,8%). Un oracolo che corregge un
fattore alla volta col valore vero:

| cosa sa l'oracolo | quota |
|---|---|
| niente (la formula) | 63,8% |
| la disponibilità vera | 74,9% |
| **la scelta vera** (voti per partita in cui era disponibile) | **84,1%** |
| tutte e due | 98,0% |

**La leva è la scelta, non la disponibilità** (+20 punti contro +11), ed è anche la parte che il pavimento del §5-quater
considera conoscibile. Dove cadono i 340 fuori banda:

| esito | uomini | quota | fuori banda | direzione | D prevista/vera | S prevista/vera |
|---|---|---|---|---|---|---|
| infortuni, tiene il posto | 40% | 66% | 37% | 110 sopra, 17 sotto | 0,87 / 0,76 | 0,89 / 0,89 |
| sano, tiene il posto | 39% | 80% | 21% | 21 sopra, **52 sotto** | 0,88 / 0,96 | 0,89 / 0,89 |
| infortuni, perde il posto | 13% | 18% | 29% | 97 sopra | 0,85 / 0,70 | 0,79 / 0,50 |
| sano, perde il posto | 8% | 45% | 12% | 39 sopra | 0,88 / 0,96 | 0,80 / 0,55 |

(«perde il posto» = gioca meno dell'80% delle partite in cui è disponibile.) Tre letture.
- **Il 37% sono stagioni di infortuni** di chi il posto lo tiene: sovrastimate, e sono il pavimento.
- **Il 41% sono i titolari che perdono il posto** (un quinto del gruppo): sovrastimati di 1,3-1,8 volte. È il margine.
- **Il 21% sono titolari sani che il posto lo tengono, e qui la formula SOTTOSTIMA**: 52 uomini previsti a 23,8 partite
  che ne fanno 32,6. Sono giocatori in crescita che l'anno prima entravano molto dalla panchina, quindi con gradino
  `panchina` o `ballottaggio` (Lautaro 2019-20, Bastoni, Bremer, Vlahovic e Barrow 2020-21, Raspadori 2021-22): M1b li
  tira verso la media del loro gradino, e il gradino `panchina` dentro questo gruppo ha la quota peggiore (47-53%).

**Cosa si sapeva il 5 settembre** (regressione del residuo della scelta sulla previsione e sui fatti del giorno, 623
titolari con tutti i dati, segni per stagione):
- **la media voto dell'anno prima**: +0,13 di scelta per punto di MV, positiva in 6 stagioni su 6 (t 2,7). La
  formula adottata ha `q` = 0 in tutte e sette le pieghe: la taratura sulla quota l'ha spenta sulla popolazione intera,
  e sui titolari serve;
- **l'età dai 32 anni**: −0,06, negativa 6 su 6 (t −2,7);
- **le partenze da titolare nelle giornate viste**: +0,12 fra «mai» e «sempre», 5 su 6 (t 4,2). La miscela legge i
  VOTI visti, non le partenze;
- **la previsione stessa**: pendenza −0,45 (5 su 6), cioè la scelta dei titolari è troppo sicura di sé.
- **Il cambio di allenatore in estate NON regge**: letto sul suo allenatore più frequente sembrava fortissimo (perde il
  posto 34% contro 18%), ma quella lettura scatta anche per un cambio a metà della stagione misurata; letto per club
  (l'ultimo allenatore dell'anno prima contro quello del giorno) è 27% contro 19%, e con il resto fermo scompare
  (t −1,0). Nemmeno «la scelta sotto l'allenatore attuale» per chi è arrivato a stagione in corso aggiunge niente (79
  casi). Quota di Qt.I nel club-ruolo, minuti e quota da titolare dell'anno prima: nessun segno stabile.

**Una nota sulla taratura adottata**: con la quota come obiettivo la griglia spegne `alpha`, `gamma` e `q` in tutte le
pieghe e porta `kD` a 320-640 (640 sul bordo in due) e `w2` a 2 (bordo) in due: la disponibilità diventa la media del
ruolo. Non è un difetto da curare qui, ma va detto: sono parametri al bordo.

**PRE-REGISTRAZIONE (01/10/2026)**, nata da questi numeri e quindi sulle stesse sette finestre (evidenza debole; la prova
è il 2026-27). Stesso criterio del §5-sexies: la quota entro l'80-125% sale in almeno 5 finestre su 7 e in media, e
l'errore medio non peggiora in media; ognuna da sola e poi insieme.
* **P0 - la popolazione**: fuori dal banco chi il giorno dell'asta giocava fuori dalla Serie A (sopra). Non è una
  modifica della formula e non si giudica col criterio: cambia la popolazione su cui il 65% è misurato, quindi è una
  decisione dell'operatore. Come lo è **contare gli zeri come fuori banda** (oggi un uomo previsto a 20 che fa 0 non
  conta), anche sulla popolazione pulita.
* **M6a - la qualità nella scelta dei titolari**: `q` tarato a parte per chi ha S ≥ 0,6.
* **M6b - le partenze viste**: per la miscela di settembre la quota vista è la media fra voti visti e partenze da
  titolare viste (dal livello per-partita di Transfermarkt), con lo stesso K.
* **M6c - l'età**: dai 32 anni la scelta si moltiplica per un fattore tarato sulle altre finestre (griglia 0,85-1,0).
* **M6d - i gradini bassi fra i titolari**: per chi ha S ≥ 0,6 il gradino dell'anno prima è `titolare` quando è
  `panchina` o `ballottaggio` (la media verso cui tirarli è quella dei titolari, non quella di chi entra dalla panchina).
Attese: M6a e M6b +1/+2 punti di quota ciascuna sui titolari, meno di uno sulla popolazione; M6c sotto il punto; M6d
recupera parte dei 52 sottostimati e costa sui gradini bassi che il posto lo perdono davvero - ed è la più
debole: a parità di previsione la regressione non vede il gradino `panchina` (+0,02, t 0,7).

## 5-octies. Le due decisioni, e perché a settembre non riconosciamo un crociato (01/10/2026)

**Decise dall'operatore** («sì a tutti e 2»), e applicate al banco di settembre (`build.py`):
- **P0 - fuori chi il giorno dell'asta non era in Serie A** (`abroad_on_day`): conta il campionato della sua prima
  partita di campionato dopo l'asta se cade entro 30 giorni (era già partito: Ronaldo 2021, Icardi 2019, Gonzalez N.
  2025, che la regola del §5-septies lasciava dentro perché avevano giocato la prima giornata qui), altrimenti quello
  dell'ultima prima. Chi non ha partite su file resta. Solo settembre: a fine luglio Lukaku 2021 era ancora comprabile,
  e il rischio di una partenza è suo.
- **Chi fa zero conta** (`in_band`): dentro la banda solo se la previsione è sotto mezza partita. Vale per la misura e
  per la taratura (M4 tara sulla misura che decide, quindi la segue).

**La domanda dell'operatore**: «se uno sta fuori tutto l'anno, a settembre dopo 2, 3 o 5 partite abbiamo una stima alta
e non abbiamo capito che non giocherà mai - un crociato rotto o un fuori rosa dovrebbe essere riconoscibile». Fra chi
la formula prevedeva ad almeno metà stagione e ha giocato al massimo un quarto (103 uomini su 1.537), la causa:

| causa | uomini | formula | vere |
|---|---|---|---|
| infortunio arrivato DOPO l'asta | 29 | 26,1 | 6,0 |
| ceduto all'estero a gennaio | 24 | 26,5 | 5,6 |
| **già infortunato il giorno dell'asta** | **20** | 21,3 | 3,5 |
| in panchina | 15 | 25,9 | 6,1 |
| partito all'ultimo giorno di mercato (ora fuori con P0) | 11 | 23,9 | 0,3 |
| fuori rosa / non convocato | 1 | | |

Il fuori rosa è quasi inesistente; il crociato è il caso dei 20. **La formula lo sa che è infortunato, e non sa quanto
dura**: le partite che uno stop aperto deve ancora costare vengono dalla mediana di quanto restava a TUTTI gli stop
chiusi, a parità di giorni passati, cioè due settimane. Pavoletti 2019-20, crociato da 10 giorni: previste 2 partite
saltate, saltate 35. Chiellini 2019-20, crociato da 6 giorni: 1 contro 29. Abraham 2023-24, crociato da 92 giorni: 7
contro 26. **E il tipo di infortunio è nell'archivio** (`injuries.detail`, scritto quando lo stop si apre): la mediana
di uno stop chiuso è 13 giorni per «Problema fisico», 24 per «Infortunio alla coscia» e **207 per «Rottura del
legamento crociato»** (313 casi), 94 per «Operazione al ginocchio».

**PRE-REGISTRAZIONE (01/10/2026), M6e - la durata dello stop per tipo**: le partite che uno stop aperto deve ancora
costare vengono dalla tabella del suo `detail`, poi del suo `kind`, poi di tutti (`residual_by_type`), con lo stesso
pavimento di 20 stop per gradino e sugli stop chiusi prima del 1º luglio della stagione prevista. Criterio del §5-sexies
sulla misura nuova (P0 + zeri contati): la quota sale in almeno 5 finestre su 7 e in media, l'errore medio non
peggiora in media. **Attesa**: piccola sul totale (gli stop aperti il 5 settembre sono pochi per stagione), +0,5/+1
punto di quota e −1/−2% di errore; grande sui casi della tabella. **Limite detto**: il testo del `detail` è quello
dell'ultima lettura dell'archivio, quindi una diagnosi corretta dopo l'asta è letta come se fosse nota prima.

**La base nuova** (P0 + zeri contati, taratura rifatta sulla misura nuova; `m6e.py`; nel file della pagina P0 toglie
131 righe di settembre, comprese quelle senza la previsione del motore): quota **56,9%** contro il 49,2% del
motore, errore 6,44 contro 6,58. È il numero da cui si parte adesso verso il 65%.

**L'esito di M6e: non passa il criterio.** Errore medio 6,438 → **6,375 (−1,0%)**, meglio in 5 stagioni su 7; quota
56,87% → 56,96%, meglio solo in **3 su 7**. Sui 137 uomini che il giorno dell'asta avevano uno stop aperto l'effetto è
quello atteso: errore 7,65 → 6,98 (−9%), scarto +3,3 → +2,4, quota 42,3% → 43,1%. La quota si muove poco per
costruzione: un crociato previsto a 10 invece che a 20, se poi ne fa 0 o 3, resta fuori banda in tutt'e due i casi.
Esempi: Cambiaghi 2024-25 da 2 a 26 partite saltate previste, Chiellini 2019-20 da 1 a 24, Pavoletti da 2 a 23,
Scamacca 2024-25 da 3 a 24, Bakker 2025-26 da 4 a 23. E i casi che sbaglia nell'altro verso: Gollini 2020-21 da 1 a 19
partite saltate, ne ha giocate 25; Djimsiti 2022-23 e Belotti 2021-22 da 2 a 9-10, ne hanno giocate 20.
La decisione è dell'operatore, come per M1b: il criterio non è soddisfatto (quota 3 su 7), l'errore migliora.
Lo scarto che resta (+2,4) dice che anche chi rientra gioca meno di quanto la formula gli dà: le ricadute e il posto
perso durante l'assenza, che il rodaggio (§36 di `assistente-asta-v1.md`, 1,3%) non spiega.

### L'esito di M6a-M6d (01/10/2026, `m6.py`)

Sulla base del §5-octies (P0 + zeri contati), stesse sette stagioni, ognuna coi parametri tarati sulle altre.

| variante | quota entro 80-125% | stagioni meglio | errore medio | stagioni meglio |
|---|---|---|---|---|
| base | 56,87% | - | 6,438 | - |
| M6a qualità dei titolari | 56,74% | 0 su 7 | 6,436 | 3 su 7 |
| M6b partenze viste | 56,84% | 2 su 7 | **6,358** | 5 su 7 |
| M6c età dai 32 | 56,71% | 0 su 7 | 6,464 | 0 su 7 |
| M6d gradini bassi → titolare | 56,34% | 3 su 7 | 6,426 | 5 su 7 |
| M6a+b+c+d | 56,37% | 3 su 7 | **6,342** | 6 su 7 |
| *M6e durata per tipo (lettura)* | *56,96%* | *3 su 7* | *6,375* | *5 su 7* |
| *motore* | *49,19%* | | *6,577* | |

**Nessuna passa.** Le partenze viste (M6b) sono la migliore sull'errore (−1,2%, 5 su 7) e lasciano ferma la quota.
**La taratura sulla quota non raccoglie i segnali della diagnosi**: per M6a sceglie `q_top` = 0 in sei pieghe su sette,
e il `q` comune scende a −0,2, che è il BORDO della griglia; per M6c `age_f` resta a 1,0 in quattro su sette. Quello che
la regressione del §5-septies vede sulla scelta (+0,13 per punto di MV, 6 stagioni su 6) è vero sulla media e non sposta
nessuno dentro la banda.

**Quindi la lettura è sulla MISURA e non sui segnali**: da M1 a M6 ogni modifica sposta l'errore medio dell'1-2% e la
quota di meno di un punto, contro gli 8 che mancano al 65%. La banda premia il caso tipico e l'esito di un titolare è a
due gobbe (tiene il posto e gioca l'89% delle partite in cui è disponibile, o lo perde e ne gioca il 50%): una
previsione a metà strada sta fuori banda per tutt'e due, e un segnale debole sposta la previsione di poco dentro la
stessa metà. I segnali conosciuti il 5 settembre non separano le due gobbe abbastanza da cambiare di che lato cade un
uomo. Aperti nuovi: la griglia tarata sulla quota tocca il bordo (`q` −0,2, `kD` 640, `w2` 2) e la sua discesa per
coordinate su una perdita a gradini è da verificare prima di credere a un «non serve».

## 5-nonies. I cinque casi che dovevamo prevedere, e il buco dei dati (01/10/2026)

**L'operatore**: «i casi Svilar, Terracciano, Lucca, Bellanova, Lukaku potevano e dovevano essere previsti ... e poi
dobbiamo evitare buchi di dati».

**Il buco dei dati ha una causa sola.** Gli id Transfermarkt dei CLUB vengono dalla pagina del campionato, che elenca
le squadre di QUESTA stagione: un club retrocesso non ha mai avuto un id, quindi le sue rose delle stagioni passate non
sono state lette, i suoi quotati non hanno un'identità Transfermarkt e nessuna partita su file. Per stagione mancavano
48-98 quotati su ~670 (2025-26: Pisa 23, Verona 16, Cremonese 11; 2022-23: Spezia 22, Cremonese 22, Salernitana 18,
Sampdoria 15), e Verona, che è quasi sempre in Serie A, mancava in ogni stagione. Gyasi e Vandeputte sono di questi.
L'id c'era già nei dati: le partite degli uomini che conosciamo portano l'id del club, quindi il club della nostra
rosa è il club Transfermarkt per cui i suoi quotati hanno giocato (`transfers.derive_past_clubs`, voto ≥ 85% su almeno
300 partite, mai sopra una mappatura della pagina del campionato, mai un id già di un altro club): **15 club**
(Verona 276, Sampdoria 1038, Empoli 749, Cremonese 2239, Salernitana 380, Spezia 3522, Pisa 4172, Brescia 19...).
Da qui le rose di quelle stagioni e le partite dei loro uomini si scaricano coi comandi che esistono già.

**PRE-REGISTRAZIONE (01/10/2026), M7 - i cinque casi.** Stesso criterio del §5-sexies, sulla base del §5-octies, ognuna
da sola e poi insieme. Sono nate da cinque nomi scelti guardando gli errori, quindi l'evidenza è la più debole possibile:
conta la popolazione, non i cinque.
* **M7a - Svilar (e Butez, Caprile)**: il peso delle giornate già giocate (K della miscela) ha un valore suo per i
  portieri, tarato sulle altre stagioni (griglia 1, 2, 3, 5, 10, 20). Un portiere che il 5 settembre ha giocato tutte
  le partite tiene il posto il 77% delle volte (misurato il 07/09).
* **M7b - Bellanova (e Zortea)**: lo stesso per chi ha cambiato club: la quota del club vecchio dice poco, le giornate
  al club nuovo dicono di più.
* **M7c - Terracciano**: la scelta si legge sulle partite della stagione misurata al club dove giocherà, quando ne ha
  almeno 10 lì e la stagione è divisa (OWN_CLUB, respinta a luglio sull'errore medio: qui si rimisura a settembre sulla
  quota).
* **M7d - Lucca**: se nel suo club il giorno dell'asta c'è un compagno ARRIVATO quest'estate con almeno un ruolo mantra in
  comune e una Qt.I più alta della sua, la sua quota di scelta si moltiplica per un fattore tarato sulle altre stagioni
  (griglia 0,6-1,0). Il club e l'arrivo si leggono dalle partite di Transfermarkt (prima partita dopo l'asta entro 30
  giorni), non dal listone, che è l'ultima lettura.
* **Lukaku** (e la regola dell'operatore: «quando un infortunio è fresco e non si ha la data di rientro è comunque di
  solito definibile come leggero o pesante; inseriamo questa informazione appena l'infortunio è noto») non è un
  candidato del banco: per il 2025-26 l'archivio non ha né la data di rientro del giorno né la prosa, e il tipo
  («Infortunio alla coscia», mediana 24 giorni) lo chiama leggero. È un'acquisizione da fare in avanti.

### L'esito di M7a-M7d (01/10/2026, `m7.py`)

| variante | quota | stagioni meglio | errore | stagioni meglio | parametro scelto |
|---|---|---|---|---|---|
| base | 56,87% | - | 6,438 | - | |
| M7a K dei portieri | 56,96% | 1 su 7 | 6,443 | 3 su 7 | K = 20 in 7 pieghe (bordo) |
| M7b K di chi cambia club | 57,31% | 4 su 7 | 6,434 | 4 su 7 | K = 20 in 7 pieghe (bordo) |
| M7c scelta al club nuovo | 57,27% | 4 su 7 | 6,488 | 3 su 7 | |
| M7d concorrente arrivato | 56,59% | 0 su 7 | 6,443 | 0 su 7 | fattore 1,0 in 6 pieghe |

**Nessuna passa.** Le due K scelgono il BORDO opposto a quello atteso: sul totale dei portieri e di chi cambia club le
giornate viste vanno pesate MENO, non di più. M7d segna 308 uomini, troppi: «un compagno arrivato più caro nel ruolo» è
un fatto comune e quasi sempre innocuo (Lucca sì, da 31,0 a 23,5).

**Terracciano: la causa data all'operatore era SBAGLIATA** e va corretta qui. Non ha diviso la stagione fra due club:
fu titolare della Fiorentina tutto il 2023-24 (33 partite) e nelle prime 3 del 2024-25, poi arrivò De Gea, e i due
avevano la STESSA Qt.I (11), quindi M7d («più caro») non lo vede. È il caso del concorrente, non di OWN_CLUB.

**La cella che regge è più stretta di M7a**: il portiere di classe «riserva» che il 5 settembre ha giocato TUTTE le
giornate viste. 11 casi in sette stagioni, la formula ne mette **0** nella banda: prevede 0,48 delle giornate che
restano e ne giocano 0,69 (Vicario 2021-22 11,8 contro 36, Svilar 2024-25 17,7 contro 35, Butez 2025-26 18,9 contro 36,
Dragowski, Meret, Milinkovic-Savic V.; e 3 su 11 lo perdono: Sepe, Gollini, Israel). Il 07/09/2026 la stessa domanda, su
cinque campionati, aveva già detto che un portiere che gioca le prime due a 85'+ tiene 0,770 delle giornate che restano.

**PRE-REGISTRAZIONE (01/10/2026), M7e - la maglia cambiata**: un portiere di classe «riserva» che il giorno dell'asta ha
preso il voto in tutte le giornate viste (almeno due) si legge di classe «titolare» (la sua quota di scelta tirata verso
la media dei titolari). Criterio del §5-sexies. Attesa: +0,4/+0,6 punti di quota; è una regola rara, quindi il «5
stagioni su 7» può cadere per le stagioni dove la cella è vuota, e se cade per quello va detto.

**L'esito di M7e: INERTE** (quota 56,87% identica, 0 stagioni su 7; errore 6,438 → 6,436). La ragione è nel peso:
la quota di scelta si tira verso la media della classe con `kS` = 5-10 partite, e un portiere che l'anno prima era
riserva ne porta 30-40, quindi cambiargli la classe sposta la previsione di poco.

**PRE-REGISTRAZIONE (01/10/2026), M7f** - nata dall'esito di M7e: per lo stesso portiere (classe «riserva», voto in
tutte le giornate viste, almeno due) la quota di scelta È la media dei portieri titolari, invece di essere tirata verso
di essa. Criterio e attesa di M7e.

**L'esito di M7f: non passa alla lettera, e va letto per cella.** Quota 56,87% → **57,20%** (meglio in 3 stagioni su 7,
pari nelle altre), errore 6,438 → 6,410 (3 su 7). Le stagioni in cui la cella non è vuota sono cinque, e sui 9 portieri
che il motore prezza la banda passa da **0 a 5**: Dragowski 2019-20 da 18,0 a 27,0 (vere 29), Berisha da 18,7 a 27,0
(24), Milinkovic-Savic V. 2021-22 da 12,8 a 27,7 (25), Meret 2022-23 da 17,4 a 27,3 (29), Dragowski 2022-23 da 18,6 a 27,1
(29); Vicario 2021-22 (28,2 contro 36) e Svilar 2024-25 (27,3 contro 35) restano appena sotto la banda; Gollini 2024-25
(26,3 contro 4) e Israel 2025-26 (27,1 contro 7) peggiorano. Il criterio dei «5 stagioni su 7» non è raggiungibile da una
regola che tocca cinque stagioni, e lo si dice invece di cambiarlo: la decisione è dell'operatore.
**M7f ADOTTATA per settembre** (decisione dell'operatore, 01/10/2026: «ok per m7f»), col criterio non soddisfatto e
detto: `build.SEPTEMBER_SHIRT_CHANGED`.

## 5-decies. Leggero o pesante, appena l'infortunio è noto (01/10/2026)

**Regola dell'operatore**: «quando un infortunio è fresco e non si ha ancora la data di rientro è comunque di solito
definibile come leggero o pesante: inseriamo questa informazione appena l'infortunio è noto». La prosa della pagina
indisponibili lo dice quasi sempre a parole sue, e lo leggiamo come leggiamo già la data
(`fc_site.parse_severity`, colonna `availability.severity`, 17 test sulle frasi vere del 01/10): PESANTE per
legamento, tendine, menisco o osso rotto, frattura, operazione, «lungo stop», «mesi», alto o medio grado, stagione
finita; LEGGERO per basso grado, fastidio, risentimento, affaticamento, contusione, noie fisiche; la negazione spegne
la parola («non sarà necessario un intervento chirurgico»), la «rottura della fibra muscolare» non è pesante, e una
prosa che non dice niente («da valutare») resta IGNOTA.

**Verificato sui fatti**: sugli stop letti dal 26/07/2026 e già chiusi in archivio, dalla prima lettura alla fine dello
stop sono restati in mediana **12 giorni** coi leggeri (n 41, oltre un mese il 15%), **55** coi pesanti (n 32, oltre un
mese il 69%) e **21** con la prosa muta (n 83, oltre un mese il 33%). Il pesante è un PAVIMENTO, perché gli stop ancora
aperti - i più lunghi - non sono nella mediana.

**Nell'app** (`core/injury-window.ts`, `player-status.openInjury`): dove nessuna fonte dà una data ma la prosa dà la
gravità, il rientro si stima con quei giorni (`SEVERITY_DAYS`) contati dalla PRIMA lettura della serie (`since`), senza
il margine `RETURN_SLIP`, e la nota lo dice. Prima di oggi un infortunio senza data era solo un vincolo («fuori oggi»)
e non costava presenze attese né offerta. Il banco non lo può giudicare: la prosa esiste dal 26/07/2026, quindi la prima
stagione su cui misurarlo è il 2026-27.

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
13. **I pacchetti del viaggio nel tempo sanno chi sarà ceduto a gennaio**: il foglio datato toglie i ceduti con
    `listone_quotes.sold`, che è l'ultima lettura del listone e non una serie datata (Kvaratskhelia fuori dal foglio del
    5/09/2024, Guendouzi e Castellanos da quello del 5/09/2025). Per un foglio datato l'asterisco va letto alla data, o
    va detto che non si può: oggi l'archivio non lo permette.
12. **La squadra della stagione misurata** manca su 1.362 righe di 5.861 (chi non ha stagioni su file e i
    campionati minori prima del 2023): solo visualizzazione, nessun numero ne dipende.
