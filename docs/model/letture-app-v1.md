# Le letture dell'app — Overall e le quattro colonne (v1)

**Che cosa sono e che cosa NON sono.** Cinque numeri 0-99 che l'app mostra accanto a ogni nome — Overall,
Voti, Bonus, Presenze, Costanza — e sono **REPORTING**: nessuna valutazione del motore li legge,
nessun gate li possiede, nessuna lista d'asta ci ordina sopra. Sono le domande che l'operatore fa al
tavolo — «prende voti?», «fa bonus?», «gioca?», «è costante?», «chi conviene avere?» — risposte da quello
che è stato misurato, con **ogni soglia dichiarata in un posto solo** perché nessuno le scambi per
parametri fittati. Le costanti vivono in `app/src/app/core/player-ratings.ts`; questo documento tiene le
MISURE che le hanno scelte e — soprattutto — quelle che hanno **rifiutato** delle alternative.

Il perimetro è quello di [assistente-asta-v1.md](assistente-asta-v1.md): la metrica con cui il pannello
d'asta ORDINA resta il SURPLUS ([metrica-asta-surplus-v1.md](metrica-asta-surplus-v1.md)), e questa
colonna risponde a una domanda vicina ma diversa.

---

## 1. L'Overall: che cos'è

`giornate a voto attese × (fantamedia attesa + aggiustamento di costanza − il rimpiazzo del suo ruolo)`

È un **PRODOTTO e non una media** delle altre quattro, e il perché è misurato (15/08/2026, sul bundle
vero, contro i fantapunti attesi del motore, Serie A / euro):

| forma | accordo |
|---|---|
| media delle quattro letture, pesi uguali | 0,538 / 0,653 — **peggiore delle presenze da sole** (0,776) |
| prodotto, ma con i minuti dentro | 0,831 / 0,816 |
| prodotto, giornate a voto × punti | **0,982 / 0,980** |

Tre cose che il prodotto NON fa, ognuna pagata da un caso:

- **non sconta i minuti.** Idzes e Dimarco leggevano 93 e 92 con 29 presenze attese entrambi, mentre ogni
  altra lettura dava Dimarco lontanissimo (6,66 di media voto contro 6,00). Il colpevole era la colonna
  Presenze, che moltiplica per i minuti giocati quando gioca: un esterno tolto al 70' veniva scontato di
  un quarto, mentre il gioco gli paga il fantavoto intero — e quello che fa in quei minuti è già dentro il
  suo bonus a presenza. Un fattore, contato due volte.
- **non conta da zero.** Kelly gioca 29 giornate a 6,16 e Bremer 26 a 6,77: da zero vengono 92 e 90, cioè
  pari, perché tre presenze in più comprano più di mezzo punto di qualità. Ma nessuno schiera NESSUNO in
  quello slot: si schiera il marginale del ruolo, e su di lui Bremer vale quasi il doppio.
- **il rimpiazzo è PER RUOLO** (`engine_replacement_fm`: 4,13 un portiere di Serie A contro 5,87 un
  centrocampista). Contato da zero un portiere titolare leggeva 15 su 99, perché le sue partite sono fatte
  dei gol che subisce.

## 2. La base è `FM att.`, non la carriera (16/08/2026)

Richiesta dell'operatore, e il caso che l'ha decisa è **Gila**: arriva al Milan e la sua media è quella di
un difensore della Lazio. La fantamedia attesa del foglio (`engine_fm_pred`, o `est_fm`) è una previsione
per la stagione che VIENE e sa cose che una media di carriera non può sapere; la carriera risponde a
un'altra domanda. La carriera resta come **ripiego dichiarato** per chi il foglio non porta affatto, e la
nota della cella scrive quale delle due sta parlando.

Effetti: Gila 45 → **55**, Stones 77 → 79, Svilar 98 → 96 (il motore lo dà a 5,22 contro i 5,45 di
carriera), **Dybala 65 → 49** (6,72 atteso contro 7,70 fatti).

## 3. La costanza: il centro è il RUOLO, e il peso è 2 (16/08/2026)

Chiudere a 6 è un evento diverso a seconda di dove si gioca. Mediana della quota di partite con almeno 6
di voto base, 498 quotati di Serie A:

| portieri | difensori | centrocampisti | attaccanti |
|---|---|---|---|
| 0,864 | 0,652 | 0,611 | 0,572 |

Centrare la correzione sulla mediana del LISTONE (0,636) regalava quindi **+0,11 di fantamedia a partita
a ogni portiere** per il fatto di essere un portiere, e ne toglieva agli attaccanti. È la lezione del
canale dell'età un livello più in là ([gate-motore-v1.md](gate-motore-v1.md) §7-quinvicies): *una
differenza fra due GRUPPI non è una virtù di chi la porta.*

E il peso: a 0,5 non si vedeva (Hojlund, 29 di costanza sul listone, pagava −0,03 su 1,60 di surplus a
giornata). L'accordo con il surplus del foglio dice dove sta il ginocchio — **0,628** senza costanza,
0,644 a peso 1, **0,639 a peso 2**, 0,623 a 3, 0,559 a 6 — e 2 è il valore che dimezza i portieri nei
primi dieci restando sopra il «senza».

⚠️ **Due letture dell'operatore erano l'opposto di quello che sembravano**, e vale la pena tenerle: il
58 di Martinez L. è un **80 fra gli attaccanti**, il 29 di Hojlund è un **58** — cioè esattamente la
mediana del suo ruolo. La colonna resta ordinata su tutto il listone (è la pool che l'operatore ha
chiesto) ma la nota della cella porta ora la mediana del ruolo, o il numero si rilegge male.

## 4. L'allineamento fra ruoli: z dentro il ruolo, classifica su tutti (16/08/2026)

**Il problema**, portato dall'operatore: «mettere tutti i primi portieri a 99 non ha senso, significa che
tutti sono forti uguale». Classificato grezzo sul listone, il ruolo del portiere **galleggiava** (mediana
66 contro il 40 dei centrocampisti) e insieme si **schiacciava** (i dodici migliori in dieci punti).

**La causa sta nello zero e non nella classifica**, ed è scritta nel toolkit stesso
(`features.replacement_levels`): il rimpiazzo è il rango `squadre × slot` dentro la pool dei REGOLARI di
quel ruolo, e le pool hanno taglie diverse. Per i portieri di Serie A il rango (10×3 = 30) è più lungo
della pool (~22 titolari), quindi lo zero è **l'ultimo portiere titolare**; per D/C/A è l'80° di ~150,
cioè uno di metà classifica. Misurato come distanza dall'ancora del ruolo: **P −0,90 · D −0,35 · C −0,38 ·
A −1,15**. Quattro zeri a quattro profondità diverse non sono confrontabili.

**La cura** è quella indicata dall'operatore — «normalmente è la fantamedia a creare questo confronto
cross-ruolo»: ognuno misurato sui suoi, poi tutti e quattro nella stessa classifica. Cioè uno z dentro il
ruolo, classificato su tutto il listone.

| | mediana per ruolo | primi 25 | spanna dei primi 12 portieri | accordo col surplus |
|---|---|---|---|---|
| grezzo | 66 / 49 / 40 / 60 | P7 D5 C5 A8 | 10 punti | 0,64 |
| **allineato** | **58 / 51 / 46 / 47** | P6 D7 C6 A6 | **16 punti** | 0,48 |

**Il prezzo va detto**: lo z divide per la dispersione del ruolo, quindi a parità di posto un attaccante
porta più fantapunti di un difensore (sd 0,39 contro 0,21). I fantapunti veri restano nel tooltip di ogni
cella, ed è quella la scala.

### Due strade rifiutate, perché nessuno le ri-provi

- **Lo zero «schierato»** (l'11° portiere invece del 31°, il 21° attaccante invece del 61°, dai posti che
  i moduli del regolamento classico schierano davvero: P1 D4 C4 A2 × 10 squadre). Distanzia benissimo i
  portieri — i primi dodici da 10 a **31** punti — ma **riapre un caso già chiuso dall'operatore**:
  Simeone crolla da 94 a **41** e Davis a 74 mentre Esposito F.P. resta 79, cioè rimette la riserva sopra
  i due «che hanno dimostrato di essere più affidabili». Accordo col foglio da 0,64 a **0,29**.
- **Tutti gli zeri alla stessa distanza dall'ancora del ruolo.** Tiene quel caso solo fino a 0,5 di
  distanza; già a 0,7 ribalta Bremer e Kelly. E non allinea: mediane 49 / 59 / 45 / 39.

## 4-bis. Lo zero è il rimpiazzo che ENTRA, non il marginale di rosa (16/08/2026)

**L'osservazione è dell'operatore** e parte da un caso di scuola: su tre partite, meglio un
centrocampista che fa 6,5 / 7 / non gioca o uno che fa 6,5 / 7 / 6? La risposta non è «19,5 contro 13,5»,
perché la giornata saltata non è uno zero: entra un panchinaro. Quindi tutto dipende da **quanto vale
chi entra** — e lui ha obiettato che il numero del foglio non può essere quello giusto.

**Aveva ragione, ed è misurato per due strade indipendenti.** `engine_replacement_fm` è il marginale di
ROSA (l'ottantesimo centrocampista di dieci squadre); quello che entra davvero è **il migliore dei tuoi
che ha il voto quel giorno**. Simulando la stagione 2025-26 - dieci squadre, rose a serpentina, si
schierano i migliori con il voto - e prendendo per l'altra via il rango `squadre × posti schierati`:

| ruolo | simulato | dal rango | foglio |
|---|---|---|---|
| P | 5,01 | 5,03 | 4,13 |
| D | 6,11 | 5,81 | 5,66 |
| C | 6,37 | 6,30 | 5,87 |
| A | 6,79 | 6,87 | 5,61 |

Due metodi che non si parlano, lo stesso numero. **Il foglio sottostima la panchina di mezzo punto.**

**Quello che la simulazione ha chiarito e che una stima a tavolino sbaglia.** Non è una media, è un
**massimo**: peschi il migliore dei rimanenti. E la panchina è corta - di otto centrocampisti ne hai
disponibili **5,3 in media e tutti e otto il 3% delle giornate** - quindi quel massimo si prende su ~2,3
uomini. Il valore decade col numero di buchi (6,46 con uno, 6,30 con due, **5,88 con tre**) e con tre
coincide col numero del foglio: **quello del foglio è il valore della tua panchina nel giorno peggiore**,
che capita il 2% delle volte.

**La dimensione della lega quasi non conta**, ed è controintuitivo: da 8 a 12 squadre il centrocampista
che entra passa da 6,42 a 6,28. Il vincolo che morde è la disponibilità, non la profondità del listone -
2,3 riserve restano 2,3 contro sette avversari o contro undici. Quello che cambia è la tua rosa (i tuoi
titolari da 6,83 a 6,71), non quello che ti dà la panchina. L'eccezione è il **portiere**: la pool è di
32 uomini e una lega da 12 se li prende tutti.

**Adottato nell'Overall**, e derivato dalla pool invece che incollato: il rango è `squadre × posti che il
regolamento schiera`, con le squadre dal manifest e i posti da `classic_modules.json` (media dei suoi
moduli: 1 / 4 / 4 / 2, che fanno undici). Senza quei due numeri resta il rimpiazzo del foglio, che è la
scelta conservativa.

**Due conseguenze da tenere.** La prima: le due decisioni dell'operatore reggono (Esposito F.P. 88 sotto
Simeone 92 e Davis 90; Bremer 92 sopra Kelly 71) — cosa che con lo zero schierato **non** accadeva prima
che l'Overall passasse a `FM att.`, il che dice che quel rifiuto era condizionato al resto e non
assoluto. La seconda: con lo zero più alto le distribuzioni per ruolo si sbilanciano, e la
standardizzazione a media/sd non le centrava più (mediane 29 / 61 / 48 / 62). Si usa quindi la **mediana
e il MAD** (× 1,4826, così una z resta una z): mediane 50 / 49 / 49 / 50.

E resta la cosa che il SURPLUS del foglio non fa e che va detta: lui usa ancora il marginale di rosa,
quindi **sopravvaluta di mezzo punto quello che un giocatore aggiunge**. Cambiarlo è lavoro di motore su
dieci finestre di gate, non una riga qui.

**SEGUITO (16/08/2026, sera tardi): il foglio adesso porta tutt'e due gli zeri, e `engine_surplus` non è
stato toccato.** `desc_replacement_fielded` / `desc_surplus_fielded` nascono REPORTING accanto a quelle
gated — in app la colonna **«Margine»** accanto a «Surplus» — perché sono due domande e non due risposte
alla stessa (`metrica-asta-surplus-v1.md` §21.1 e §21.3). Due cose da NON confondere leggendo questa
sezione: il numero del foglio è una **fantamedia** contata sulle stesse stagioni dello zero gated
(undici), mentre il `fieldedZero` dell'Overall è in **punti-partita** sulla pool dell'app e con la porta
inviolata dentro — stessa domanda, due scale, e unificarli sarebbe sommare due unità. Sulla singola
stagione le due strade tornano a incontrarsi (2025-26: P 5,01 · D 6,14 · C 6,36 · A 6,71 dal foglio,
contro la tabella qui sopra), che è la verifica che questa sezione prometteva.

## 4-ter. Le QUATTRO letture allineate come l'Overall — e la sola che resta fuori (16/08, pomeriggio)

**Richiesta dell'operatore**: «vorrei che l'overall e i valori voti, bonus, presenze e costanza
rispecchiassero di più la scala del SURPLUS: i loro valori devono essere confrontabili a prescindere dal
ruolo». Il surplus lo è per costruzione — sottrae il rimpiazzo DEL SUO ruolo, quindi +20 fantapunti sopra
la panchina vogliono dire la stessa cosa in porta e in attacco. Le quattro letture no, e **la §4 aveva
sistemato solo l'Overall**.

Misurato prima di decidere (mediane del punteggio per P / D / C / A, 499 quotati di Serie A):

| lettura | prima | dopo | scarto |
|---|---|---|---|
| **Bonus** | 6 / 35 / 63 / 89 | 50 / 49 / 50 / 50 | 83 → **1** |
| **Costanza** | 91 / 50 / 42 / 24 | 49 / 50 / 50 / 49 | 67 → **1** |
| **Voti** | 87 / 36 / 45 / 55 | 49 / 49 / 49 / 49 | 51 → **1** |
| Presenze | 34 / 63 / 46 / 40 | *invariata* | 29 |
| Overall | 50 / 49 / 49 / 48 | *invariato* | 2 |

Il Bonus era il caso peggiore **per costruzione**: i punti evento di un portiere sono negativi (i gol che
subisce), quindi la colonna dava 6 di mediana ai portieri — diceva il ruolo, non il merito. Il rimedio è
quello della §4 applicato un livello sotto, e ora è **una funzione sola** (`alignedRank99`, mediana e MAD
dentro il ruolo, poi classifica su tutto il listone) letta dall'Overall e dalle tre letture: le mediane
dell'Overall sono identiche prima e dopo, che è la prova che l'estrazione non ha cambiato niente.

**Le PRESENZE restano fuori, e la regola generale è questa**: si allinea una lettura la cui scala GREZZA
vuol dire cose diverse a seconda del ruolo, non una il cui numero grezzo è già lo stesso fatto per tutti.
Il 42% del calendario è il 42% per chiunque, e lo scarto 34 / 63 / 46 / 40 è una **verità sul listone** e
non un difetto del metro: la mediana dei portieri *quotati* gioca poco perché quasi tutti sono riserve.
Allinearle direbbe «questo secondo portiere gioca una quantità normale», che è vero fra i portieri e
falso in assoluto.

⚠️ **Una cosa che questa modifica NON fa, e va detta perché la richiesta si può leggere in due modi.**
«Scala del surplus» qui vuol dire *confrontabile fra ruoli*. Se volesse dire *più d'accordo con la
classifica del surplus del foglio*, la direzione è l'opposta: l'allineamento ha ABBASSATO quell'accordo
da 0,64 a 0,48 (§4), perché il surplus del foglio ha i quattro zeri a profondità diverse — che è
esattamente il difetto che l'allineamento cura.

## 4-quater. Il colore delle celle: FM/MV nel ruolo, l'FVM contro il surplus (16/08, pomeriggio)

Due richieste dello stesso giorno, e la seconda è la più interessante perché il colore NON descrive il
numero su cui sta.

**FM, MV, FM att. e MV att.** portano il colore del loro posto **dentro il ruolo** (pool: il listone, mai
le righe a schermo — la stessa tabella disegna la rosa di un club e la lista intera, e col pool delle
righe «buono» vorrebbe dire «il migliore di questi ventisei»). Verificato chiamando la funzione che
spedisce: le quote per ruolo escono identiche — portieri 12 verdi / 11 ambra, difensori 51/50,
centrocampisti 55/52, attaccanti 26/25 — che è la prova che il colore parla del giocatore e non del ruolo.
Scala: quella delle stelline (`toneOf`), quindi centro NEUTRO e rosso solo in fondo.

**L'FVM è colorato dal dVM**, non da sé stesso: «costa tanto» non è una notizia, un fuoriclasse costa. La
notizia è quanto il listone lo prezza sopra o sotto quello che il motore gli dà — verde molto sotto
(occasione), ambra molto sopra (caro), inchiostro e non riquadro. «Molto» è la banda che le stelline già
chiamano «molto sopra/sotto la media» (±0,75σ dentro il ruolo): nessuna soglia nuova inventata.

Questo ha richiesto di portare **SpM e dVM sul foglio** (`desc_spm`, `desc_dvm`, `SHEET_REVISION` 20):
vivevano solo nel pannello Tk, quindi l'app non aveva niente con cui confrontare l'FVM. Stessa coppia di
funzioni del pannello (`evaluate.market_rates` / `market_surplus`), tasso fittato sulla lista **intera**
prima di ogni restringimento. E la risposta alla domanda che l'ha generata — «l'FVM va confrontata coi
fantapunti o col surplus?» — è **col surplus**: quello che un credito compra è il margine sopra chi
giocherebbe al posto suo, mentre i fantapunti contano da zero e da zero non paga nessuno
([metrica-asta-surplus-v1.md](metrica-asta-surplus-v1.md) §14).

**E la colonna VALORE si chiama FANTAPUNTI** (operatore, stesso giorno): viveva accanto all'FVM, che è il
fanta*valore* di mercato, e un numero in fantapunti e un prezzo in crediti non possono portare lo stesso
nome. Il campo resta `value` nel codice.

## 4-quinquies. Il VIAGGIO NEL TEMPO, e che cosa non retrodata (16/08, pomeriggio)

Un box di **debug** fisso in basso a destra sposta il giorno in cui l'app crede di trovarsi. Serve a
guardare la tabella com'era a una data passata; tutto quello che è successo dopo torna a essere IGNOTO.

**Retrodatato**: lo strato per-partita (110.961 righe con `match_date`, e i voti che ci si agganciano),
gli infortuni, i ruoli granulari, le stagioni chiuse — e quindi le cinque letture, il trend delle ultime
dieci, i marchi e gli screen. Tre regole che il codice obbedisce e i test inchiodano: uno stop che
comincia dopo **non esiste**, uno che si chiude dopo era ancora **APERTO** (e allora `days_out` sparisce:
è la durata totale, che quel giorno nessuno conosceva), e una stagione **non ancora conclusa non ha un
totale** da leggere — il taglio più severo dei due, ed è il lato giusto da sbagliare.

**NON retrodatabile, e il box lo scrive sempre a schermo**: le colonne del foglio (P, FM att., MV att.,
Surplus, Fantapunti, SpM/dVM), i campetti e il listone stesso. Le scrive il toolkit per un giorno preciso
(`snapshot --date`), e rifarle nell'app vorrebbe dire rimettere il motore qui dentro. Un viaggio nel
tempo che ne retrodata metà **in silenzio** sarebbe peggio di nessun viaggio nel tempo: è la stessa
regola della lista i cui numeri descrivono un'altra lista. Per un viaggio fedele anche sul motore la
strada esiste ed è un'altra: un bundle costruito dal toolkit per quella data.

## 5. La colonna Bonus è quanto vale una sua partita OLTRE al voto

Non solo gol e assist: **tutti** i termini che il `scoring_config` prezza, con i malus **sottratti** —
cartellini, autogol, rigori sbagliati e, per un portiere, i gol subiti. Prima la colonna portava solo gol
e assist, quindi ogni portiere leggeva zero mentre fra i portieri con 20+ presenze i gol subiti vanno da
0,76 a 1,75 a partita: **un fantapunto pieno di differenza reso invisibile**.

⚠️ **Un segno non è un dettaglio.** Il config memorizza i malus come grandezze POSITIVE
(`own_goal_malus: 2.0`, non −2): sommandoli tutti, il fantavoto ricostruito tornava con quello del
toolkit su **174 righe-stagione di 1.449**; sottraendoli, su **1.383**.

**La porta inviolata (16/08/2026).** `clean_sheet_bonus_gk` è l'unico termine del config che la FONTE non
applica — misurato su 16.017 righe di portiere, `fm = mv − subiti + 3×parati − cartellini` è esatto al
100%, e sulle 4.872 partite chiuse a zero il residuo è 0,000. Resta vero per chi RICOSTRUISCE il
fantavoto del sito (`ratings._fantavoto`, `arrivals.keeper_fm_equivalent`), e **non** per questa colonna,
che chiede quanto vale una partita nella lega in cui si gioca — e quella dell'operatore la paga. Il
**Il dato è arrivato lo stesso giorno**: `season_stats.clean_sheets`, derivata dal layer per partita
(`stats.derive_clean_sheets`) su tutte e 11 le stagioni — **970 stagioni-portiere, 4.872 porte
inviolate**, che è esattamente il numero che il commento del `scoring_config` cita per le partite chiuse a
zero: una conferma indipendente arrivata da un'altra strada. Tre guardie: solo `status = 'played'` (senza,
ogni riserva prenderebbe una porta inviolata a ogni giornata, perché una riga di panchina porta zero gol
subiti come chi ha parato tutto), solo con il VOTO (un bonus si attacca a un fantavoto, e così il
numeratore sta sullo stesso dominio di `pv`), e il numero si scrive solo per chi il layer copre davvero —
gli altri restano NULL. Effetto in colonna: Svilar da −0,92 a **−0,49** a partita, Butez da −0,82 a −0,39.

Resta **un disaccordo fra le fonti, dichiarato invece che nascosto**: su 970 stagioni-portiere UNA legge
più porte inviolate che presenze (Padilla, euro 2024-25: il listone dà `pv` = 0, il layer ha una giornata
giocata e votata). Ritagliare il numeratore sul denominatore nasconderebbe la contraddizione.

**Le due colonne sono state ALLINEATE lo stesso giorno**, e il come conta più del cosa. `FM att.` è la
previsione del motore nel punteggio della FONTE, che quel termine non lo applica; la colonna Bonus usa
quello della LEGA, che lo paga. L'allineamento è una conversione di REPORTING nell'app e **non** un
cambio di punteggio nel motore — quello vorrebbe dire rifare ogni numero che il gate ha misurato — e la
regola che la rende onesta è una sola: **si applica al giocatore E al suo rimpiazzo**. Da un lato solo
regalerebbe a ogni portiere ~+0,30 di fantamedia, che è l'errore già pagato altrove.

Il tasso è quello del **CLUB** e non del portiere, perché è quello che persiste (r 0,488 contro 0,074,
§6); un club che non abbiamo misurato prende la mediana del listone, che è anche quella che prende il
rimpiazzo, così nessun lato resta scoperto. Effetto: Svilar passa da `84% × (5,22 − 4,13)` a
`84% × (5,69 − 4,42)`, e i portieri si ordinano per la porta in cui giocano invece che per nulla —
mediane per ruolo 56 / 51 / 47 / 48, i primi dodici portieri in 17 punti.

---

## 6. Le icone, e le soglie che le hanno scelte

Ogni soglia è misurata sui 324 quotati di Serie A con 30+ presenze (15/08/2026), e quelle sui numeri rari
chiedono anche un MINIMO di episodi, perché una quota su un episodio solo è sfortuna e non abitudine.
Dettaglio in `app/src/app/core/player-discipline.ts`.

| marchio | soglia | perché |
|---|---|---|
| gialli | 0,28 a presenza | mediana 0,129 · p95 0,244 · massimo 0,385 — fra p95 e p98 |
| rossi | 2 episodi e 1 ogni 33 | 138 su 324 ne hanno uno, **48** ne hanno due: con uno solo non si distingue il falloso dallo sfortunato |
| autogol | 2 episodi e 1 ogni 50 | 60 su 324 ne hanno uno, **12** ne hanno due |
| rigori sbagliati | 2 su 5 (40%) | regola dell'operatore, ed è il nono decile dei 42 rigoristi (mediana 0,20) |
| rigorista | 5 battuti, 1 ogni 25 | lascia fuori chi ne ha battuti due perché il titolare era squalificato |
| rigori parati | 3 parate, 1 ogni 30 | 25 portieri su 27 ne hanno parato almeno uno, 15 tre o più |

### La porta inviolata è della SQUADRA, non del portiere e nemmeno dell'allenatore

Il sospetto era dell'operatore («dipende più dalla squadra che dal portiere») e la misura gli dà ragione
(sette stagioni di Serie A):

- sul **portiere** la quota non persiste: r = **0,074** fra la sua quota di una stagione e quella dopo;
- sul **club** persiste: r = **0,488** fra due stagioni consecutive (102 coppie con 20+ giornate);
- due portieri nella stessa porta nella stessa stagione differiscono in media di 0,147 **e nelle due
  direzioni** — Skorupski 0,44 contro Ravaglia 0,12 al Bologna, ma Provedel 0,17 contro Mandas 0,44 alla
  Lazio: rumore, non merito.

E l'**allenatore**, che l'operatore aveva chiesto di aggiungere, non regge la misura che lo isola. Nei 30
cambi in corsa (stessa rosa, stessa stagione, due tratti da 8+ partite) lo scarto medio fra i due tratti è
**0,155**; il NULL — due metà della stessa stagione SENZA cambio, 110 casi — è **0,094**. L'eccesso è 0,06
di quota, un paio di porte inviolate in una stagione, e i tratti di un cambio sono più corti delle metà,
il che gonfia lo scarto per costruzione.

Quindi il marchio è del CLUB: soglia **0,40**, cioè due giornate su cinque, misurata e valida su tutt'e
due i listoni perché le distribuzioni quasi coincidono (Serie A mediana 0,289 e p75 0,395 su 40
stagioni-club; EuroLeghe 0,323 e 0,387 su 71). Prende un club su cinque. Il tooltip scrive di chi è il
merito.

## 7. Le preferenze dichiarate, che non sono previsioni

Tre correzioni all'Overall che l'operatore ha CHIESTO e che non sono seconde previsioni. Sono scritte come
tali perché il prossimo lettore non le prenda per misure:

- **`FRAGILITY_RISK` = 1.** Il motore già prevede meno partite a chi si rompe spesso, e le prevede bene
  (Dybala 22,8 su 38 contro i 29,6 di Yildiz; le sue ultime quattro stagioni sono 25, 27, 22, 22 — la
  media è giusta). Quello che una media non dice è che quei 22 sono la media fra una stagione a 30 e una a
  12. Applicata alla quota SICURA e misurata dalla mediana del listone, così l'uomo normale non paga.
- **`STARTER_SHARE` = 0,75, al quadrato.** «Esposito F.P. non è titolare, come fa ad avere un overall così
  alto?» La prima versione leggeva le presenze previste, e con quelle Esposito, Simeone e Davis sono lo
  stesso uomo (24, 25 e 24 su 38): il motore conta le presenze A VOTO, e un subentrato ne prende. Si vede
  invece dalle partite COMINCIATE — Esposito 15 su 36, Simeone 27, Davis 27, Yildiz 33 — che è un fatto
  misurato e non una preferenza. Chi non ha una stagione misurata non paga niente.
- **`DECLARED_RISK`.** Quello che il modello non può vedere si DICHIARA (`config/player_notes.json`):
  fuori rosa 0,1 · rottura con la società 0,35 · ha chiesto di andarsene 0,6. Niente sotto `engine/` legge
  una nota dichiarata e niente dovrebbe: un fatto dichiarato che muovesse un numero fittato renderebbe
  ogni misura la risposta dell'operatore a se stesso. Questa colonna è l'altro genere, e la carta di quel
  file lo dice.

---

## 8. Aperti

1. **`season_stats.clean_sheets`** — derivabile da `match_ratings` per tutte e 11 le stagioni, nessun
   provider di mezzo. Finché non c'è, il +1 della porta inviolata è prezzato dal lettore e vale zero.
2. ~~Storico del valore di mercato~~ — **FATTO il 16/08/2026**: modulo `market`, endpoint JSON
   `transfermarkt.it/ceapi/marketValueDevelopment/graph/{pid}` (senza muro di consenso), tabella
   `market_value_history`. Acquisiti **1.055 quotati, 22.269 punti**, dal 2005 al 2026, mediana 20 punti
   a testa, zero fallite. E la domanda per cui era stato preso ha risposta: **tutti e 1.058 hanno un
   valore alla data d'asta e 1.056 ne hanno due o più nell'ultimo anno**, cioè una tendenza leggibile —
   che è l'input che il gate segnalava rotto (canale dell'investimento: «sistemare l'input prima di
   toccare il peso»). `market_values`, un valore per stagione, resta dov'è: risponde a un'altra domanda.
   Nessuno lo legge ancora, e infatti non viaggia nel bundle: aggiungerlo all'app è una decisione a sé.
3. **Minuti per competizione e in nazionale** — le pagine ci sono e rispondono 200, ma la tabella non è
   nell'HTML: c'è un **muro di consenso** e i dati arrivano solo dopo. Il prefisso `/x/` che salva il
   modulo infortuni lì non basta (provate quattro forme). La strada seria è registrare le chiamate che la
   pagina fa dopo il consenso, non indovinare endpoint: dei quattro tentati, 4 su 6 hanno risposto 404.
4. **Coppe da Sofascore** — 403 `challenge` su tutti gli endpoint dal 16/08/2026, dopo una corsa su 93
   club. In attesa, e senza insistere.
