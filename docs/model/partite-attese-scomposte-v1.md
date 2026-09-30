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

## 6. Aperti

1. La qualità misurata meglio di MV; la quota di chi a gennaio cambia campionato.
2. I minuti del gradino ricavato sono quelli della stagione misurata, non una previsione (`minutes.per_appearance`
   vuole le colonne del foglio): se il gradino diventa una lettura da usare, va rifatto sui minuti previsti.
3. Se una parte della scomposizione deve entrare nel motore, la strada è il gate con una regola pre-registrata sulla
   popolazione dove regge (i portieri, e l'asta di settembre), non la formula intera.
4. I portieri: la maglia lasciata libera da chi è partito (misurata sul caso Butez, 18 casi: 0,13 → 0,43) e il peso
   delle prime giornate quando il vecchio titolare è sano - da pre-registrare.
5. Febbraio: capire da dove viene il vantaggio del motore a stagione avanzata, visto che non è il K.
