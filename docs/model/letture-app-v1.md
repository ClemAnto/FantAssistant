# Le letture dell'app — Overall e le quattro colonne (v1)

> ⚠️ **REVISIONE DEL 17/08/2026 SERA — leggere prima [§9](#9-la-revisione-del-1708-sera-la-formula-dettata-dalloperatore).**
> In una sera l'operatore ha riscritto queste colonne: l'**Overall** è `Presenze × (Voti + Bonus)`, senza
> nessun rimpiazzo sottratto; **Voti, Bonus e Presenze** sono i tre numeri del FOGLIO (MVa, FMa, P)
> classificati su **tutti i calciatori** e non dentro il ruolo; la **Costanza** non è più una colonna ma un
> simbolo di varianza accanto ai Voti; le colonne si **trascinano** e l'ordine si ricorda. Quindi §1-§7
> descrivono lo stato del 16/08 e restano per le MISURE che contengono - comprese quelle che spiegano cosa
> si è perso: le decisioni in vigore sono quelle di §9.

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

> **Superata il 17/08/2026**: la formula in vigore è quella di §9 e non contiene l'aggiustamento di costanza.


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

> **Superata il 17/08/2026**: la costanza non entra più nell'Overall e non è più una colonna. Le mediane
> per ruolo qui sotto restano la ragione per cui il simbolo che l'ha sostituita è bandito DENTRO il ruolo (§9).


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

> **Ritirato il 17/08/2026** su richiesta dell'operatore: ogni lettura è classificata su tutti i calciatori.
> Le misure qui sotto restano vere e sono la ragione per cui la conseguenza va detta invece che scoperta (§9).


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

> **Non è più lo zero dell'Overall dal 17/08/2026** (lo è il rimpiazzo del ruolo MANTRA, §9). Resta lo zero
> della colonna «Lead» del foglio, che è la domanda per cui è stato misurato.


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

> **Superata il 17/08/2026**: la colonna Bonus classifica la FMa del foglio (§9.5). Quello che c'è scritto
> qui resta la ragione per cui i punti evento di un portiere sono negativi, che vale ancora nel tooltip.


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

> Le icone NON sono state toccate dalla revisione del 17/08: sono l'unico posto dove fragilità, infortunio
> e nota dichiarata continuano a parlare, dopo che le tre letture hanno smesso di scontarle (§9.5).


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

## 7-bis. La COPPA CONTINENTALE accanto al nome: un marchio, e due colonne che compaiono solo se servono (17 agosto 2026)

Non è una lettura 0-99 e non entra in nessuna: è un **marchio** (globo ambra, `intl_cup`, filtrabile fra le
icone) più la penalità nel tooltip delle presenze attese, e due colonne al netto che compaiono soltanto
quando in lista c'è qualcuno esposto. Sta scritto qui perché le regole sono le stesse delle cinque letture:

* **il marchio viene dal FOGLIO e l'app non lo ricalcola.** Chi va a un torneo è una previsione su una
  persona, quindi si misura dove le misure si giudicano. Se l'app se lo derivasse da nazionalità e finestre
  prima o poi segnerebbe un uomo che il foglio non segna — una nazionale non qualificata, un'eccezione
  dichiarata, un calendario che non copre quella lega — ed è il difetto «una lista mostrata i cui numeri
  descrivono un'altra lista»;
* **il marchio NON porta il numero delle giornate.** `PlayerStatus` è uno per giocatore e la stessa Coppa
  d'Asia vale 4 giornate in Serie A e 3,3 su euro: il numero sta nella colonna, che sa su quale calendario
  contarlo. Un numero senza il suo calendario non dice di cosa è misura;
* **«nazionale» e «convocabile» sono due frasi diverse** e la differenza è misurata (0,35 contro 0,20 in
  una finestra di Coppa d'Africa), quindi il tooltip le tiene separate invece di dire «potrebbe partire»;
* **la soglia non c'è**: non è un marchio con una soglia di display come i due infortuni, è un fatto di
  calendario. Quello che è dichiarato — e va detto — è la mappa paese/confederazione e le eccezioni
  (`config/international_cups.json`), perché la nazionale per cui un uomo gioca non è osservabile da
  niente in questo repo: Dahoud legge Syria ed è sceso in campo per la Germania.

---

## 7-ter. MERCATO: il prezzo dell'altro tavolo, e una tendenza che non è una graduatoria (17 agosto 2026, sera)

Colonna nuova accanto all'FVM, **reporting e nient'altro**: il valore di mercato Transfermarkt alla data,
più una freccia sulla tendenza a dodici mesi. Nasce dal residuo del 16/08 («usare la curva del valore») e
l'altra metà di quella voce è chiusa in senso negativo — il canale dell'investimento con l'input riparato è
stato **respinto dal gate** (§7-untricies) — quindi qui la curva si **legge** e non prevede niente: nessuna
valutazione, nessuna classifica, nessuna delle cinque letture 0-99 la tocca.

**Perché sta accanto all'FVM.** Sono due giudizi sulla stessa persona da due tavoli diversi: l'FVM è il
prezzo che il **listone chiede**, il valore di mercato è quello che il **mercato vero** gli ha dato, con la
data di ogni variazione. La differenza fra i due è l'unica cosa che un'asta può usare, e nessuno dei due è
un nostro numero.

**La freccia è una DIREZIONE e mai una graduatoria, e questo è misurato.** Una variazione in percentuale
dipende dalla base. Sui **1.092** quotati 2026-27 che hanno un anno di curva alle spalle (17/08/2026):

| quartile del valore di un anno prima | mediana della variazione a 12 mesi | nono decile |
|---|---|---|
| sotto 3,5 M | **+50%** | **+1.614%** |
| 3,5 – 12 M | +0% | +191% |
| 12 – 28 M | +0% | +100% |
| sopra 28 M | **−9%** | +43% |

Ordinare per tendenza metterebbe in cima i ragazzi che passano da 200 mila a 3 milioni: vero, e non è la
domanda di un'asta — è la stessa lezione dei portieri (§4), *un numero deve dire di quale pool è un fatto*.
Quindi la cella porta il **valore in euro** (che rende visibile la base), la colonna si ordina **per
valore**, e la percentuale con le sue due date sta nel tooltip.

**Le costanti, dichiarate come le due soglie degli infortuni** (`core/market-trend.ts`): finestra **12
mesi** — una stagione, quindi confronta un uomo con sé stesso in un momento comparabile del calendario e
contiene più di un'ondata della fonte (mediana 3 punti in dodici mesi) — e banda **±15%**, che sui 1.092
produce **38,6% in salita · 24,1% ferma · 37,7% in discesa**. Sono scelte di VISUALIZZAZIONE: non entrano in
nessuna valutazione e nessun gate le possiede.

**Tre regole che la colonna eredita dal resto dell'app.**

* **«Ignoto» non è «ferma».** Senza un punto a dodici mesi la tendenza non si scrive: il valore c'è, la
  freccia no. Sono **26 quotati su 1.175** — chi è appena entrato nel giro della fonte — e altri **57** non
  hanno curva affatto, cioè non hanno identità Transfermarkt. Una freccia «→» su di loro sarebbe una notizia
  inventata dal silenzio.
* **Due date e nessuna delle due si presume.** La fonte muove i valori a ondate: l'ultimo punto ha in
  mediana **77 giorni** (massimo 95). Non è vecchio, è l'ultimo che esiste, e oltre il mese il tooltip dice
  da quanto. La curva si ritaglia poi al giorno del **viaggio nel tempo**, quindi la colonna torna indietro
  con tutto il resto di ciò che nel bundle è datato.
* **Il colore va nel verso del MERCATO, non del nostro interesse.** Verde sale, ambra scende — e sta sulla
  **freccia** e non sulla cifra, perché colora la notizia («il mercato si è mosso») e non un consiglio: un
  valore che scende è spesso un uomo che costa poco.

Verificato chiamando la funzione e non guardando lo schermo: Carnesecchi 30 M **↑** (+20% su 25 M del
17/06/2025), Maignan 20 M **↓** (−20%), Svilar 35 M **↑** (+40%), Christensen O. 1,4 M **→** (−7%, dentro la
banda). Il dato viaggia nel bundle con uno scope nuovo — datato, tagliato un anno prima della finestra
`heavy` e col punto portato avanti, così nessuno perde il suo livello: spec «Novità v9.40».

---

---

## 9. La revisione del 17/08 sera: la formula dettata dall'operatore

Quattro decisioni sue, dettate una dopo l'altra, e per ognuna quello che ho MISURATO dopo averla applicata.
Sono decisioni di PRODOTTO su colonne di reporting: nessun gate le possiede, `engine_*` non si muove di un
decimale e `backtest --verify` resta 22/22.

### 9.1 L'Overall è `Presenze × (Voti + Bonus)` — e il rimpiazzo mantra è durato un'ora

**La formula in vigore, ultima parola della serata**: «facciamo che overall è semplicemente presenze ×
(voti+bonus)». Nessuno zero sottratto, quindi la colonna dice **quanti fantapunti porta in tutto** e non
quanti ne porta in più di qualcuno — quella domanda ce l'hanno già il Surplus e il Lead, ognuno col suo zero.
Il numero grezzo è nel tooltip, la colonna mostra il posto 0-99 su tutto il listone.

Conseguenza da dire, perché non la scopra nessuno al tavolo: senza rimpiazzo, la **porta inviolata** del
portiere resta su UN SOLO lato del conto (la sua). Prima entrava su tutt'e due proprio per non regalarla; ora
non c'è un altro lato, quindi il numero è «quanto vale una sua partita nella TUA lega» e la porta inviolata
ne fa parte per definizione.

E la colonna coincide quasi con **Fantapunti** (`fantamedia attesa × presenze attese`): è la stessa
grandezza, una come numero e una come posto 0-99, e le sole differenze sono la porta inviolata dei portieri
e il ripiego di CARRIERA per chi il foglio non prezza. Va saputo: due colonne che dicono la stessa cosa sono
una scelta, non una scoperta.

### 9.1-bis Il rimpiazzo del RUOLO MANTRA: provato, misurato, superato in un'ora (e la misura resta)

Parole sue: «Overall deve essere uguale a Presenze × (Voti+Bonus−Rimpiazzo) dove il Rimpiazzo è calcolato
sull'intera lega su ruoli mantra». Tre conseguenze, tutte volute:

1. **via l'aggiustamento di costanza** (§3): la formula non lo contiene, quindi `CONSISTENCY_TILT` è stato
   cancellato e non messo a zero — un parametro che nessuno legge è un parametro che il prossimo lettore
   crede attivo;
2. **lo zero non è più il rimpiazzo che si SCHIERA** (§4-bis) ma `engine_replacement_fm` letto sul foglio
   **mantra** della stessa piattaforma, cioè il marginale della pool del suo slot. Non lo ricalcola l'app:
   i posti per CODICE mantra li conosce il regolamento, non questa tabella. Su Serie A il pannello lavora
   sul foglio classico (è quello che porta i campetti) e il numero arriva dal foglio mantra della stessa
   lega — copertura misurata: **498 quotati su 498**;
3. **niente più z dentro il ruolo** (§9.2): sottraendo a ognuno il marginale della SUA pool il numero è già
   comparabile, e standardizzarlo di nuovo dividerebbe una seconda volta per la dispersione del ruolo.

**I dodici zeri, misurati sul foglio mantra di Serie A 2026-27:** `por` 4,13 · `dd` 5,67 · `ds` 5,73 ·
`e` 5,66 · `dc` 5,85 · `c` 5,79 · `w` 6,30 · `t` 6,60 · `a` 6,85 · `pc` **7,01**. Contro i quattro
classici: P 4,13 · D 5,66 · C 5,87 · A 5,61.

⚠️ **E qui c'è la conseguenza che va detta, perché è grossa e va nella direzione opposta a quella di ieri.**
Ricalcolando la formula sul foglio (498 quotati di Serie A, `pv/38 × (fm − zero)`), le mediane del
percentile per ruolo e i primi venticinque:

| zero usato | mediane P / D / C / A | primi 25 |
|---|---|---|
| rimpiazzo mantra (**in vigore**) | **77 / 46 / 56 / 11** | **P14 · C9 · D1 · A1** |
| rimpiazzo classico del foglio | 59 / 32 / 37 / 86 | A18 · P6 · D1 |
| allineato per ruolo (16/08, ritirato) | 58 / 51 / 46 / 47 | P6 · D7 · C6 · A6 |

Il meccanismo è quello di §4 con dodici pool invece di quattro: la pool dei `pc` è **corta e alta** (il
marginale è 7,01, cioè un centravanti vero), quindi quasi ogni attaccante sta sotto il proprio rimpiazzo;
la pool dei `por` è lunga e bassa (il trentesimo portiere di dieci squadre è un terzo portiere, 4,13),
quindi ogni titolare la sovrasta. Otto nomi su venticinque restano gli stessi; i primi otto ora sono
Svilar, Carnesecchi, Dimarco, Maignan, Butez, Falcone, Caprile, Calhanoglu. **È la formula che è stata
chiesta e produce l'effetto che il 16/08 era stato chiamato difetto** («mettere tutti i primi portieri a 99
non ha senso»): sta scritto qui perché la decisione sia in chiaro, non perché sia stata disattesa.

Le due strade note che lo curerebbero erano quelle già misurate e già rifiutate una volta: i posti
**schierati** per slot mantra (il decimo portiere invece del trentesimo) oppure zeri alla stessa distanza
dall'ancora del ruolo (§4, «Due strade rifiutate»). **Non è stata presa nessuna delle due**: messa la misura
davanti all'operatore, ha scelto di togliere lo zero e basta (§9.1). La misura resta scritta qui perché è la
prova che tre zeri diversi danno tre classifiche diverse, e nessuno dei tre è «il» giusto — dipende dalla
domanda, che è la lezione di §4-bis.

### 9.2 Voti, Bonus e Presenze si classificano su TUTTI i calciatori

Parole sue: «il valore di VOTI, BONUS e PRESENZE deve essere calcolato in relazione a tutti i calciatori e
non al suo ruolo». `alignedRank99` è stata **cancellata** (nessun chiamante) e le tre letture usano
`rank99` sul listone. La conseguenza è esattamente quella che quella funzione evitava, ed è misurata al
16/08: mediane per ruolo del punteggio, 499 quotati di Serie A — **BONUS 6 / 35 / 63 / 89** (i punti evento
di un portiere sono negativi per costruzione: contengono i gol subiti), **VOTI 87 / 36 / 45 / 55**. Quindi
in Bonus i portieri stanno in fondo e in Voti in cima, **per il ruolo prima che per il merito**. Il ruolo
però è scritto sulla riga, e il confronto fra ruoli lo fa l'Overall: è la ragione per cui la richiesta tiene.

### 9.3 La Costanza esce dalle colonne e diventa un simbolo di VARIANZA accanto ai Voti

Parole sue: «Costanza eliminiamola come colonna e trasformiamo il valore in un simbolo vicino al voto che
deve indicare la varianza: grande, media (nessun simbolo), piccola». Il simbolo dice quello che dichiara:
la **deviazione standard dei voti** che ha davvero preso — non la quota di partite chiuse col 6, che era la
Costanza e che viaggia nel tooltip insieme alla sd e alle due soglie.

**Le bande sono DENTRO IL RUOLO, e la ragione è misurata** (17/08/2026, 359 quotati di Serie A con almeno
dieci voti su due stagioni di calendario Serie A): sd mediana **P 0,569 · D 0,598 · C 0,579 · A 0,715**. Un
attaccante balla di più per mestiere — segna o non segna — quindi bande comuni avrebbero marcato «varianza
grande» su mezzo reparto d'attacco, cioè avrebbero detto il RUOLO e non l'uomo (la lezione del canale
dell'età, ancora). Prende un simbolo il **quinto** più stabile (`≡`) e il quinto più ballerino (`↕`) del suo
ruolo, il 60% in mezzo niente; le soglie si prendono dalla POOL su cui la tabella lavora — il listone, non
le righe a schermo — e un ruolo con meno di venti uomini misurati non si bandisce affatto. Scelta di
visualizzazione dichiarata in `player-ratings.ts`, come le due soglie degli infortuni.

### 9.5 Voti, Bonus e Presenze SONO le colonne del foglio: MVa, FMa, P

Parole sue: «Il valore Voti (0-99) deve essere calcolato su MVa · Il valore Bonus (0-99) su FMa · il valore
Presenze (0-99) su P». Quindi le tre letture non sono più tre misure di CARRIERA pesate e ancorate: sono i
tre numeri che il motore prevede, classificati sul listone. Che cosa cambia il senso di ognuna:

* **VOTI** era la media voto di carriera (pesata sulle presenze, troncata da cinque stagioni in su); ora è la
  media voto **attesa** (`est_mv`);
* **BONUS** era quanto valgono i suoi eventi a presenza (gol e assist MENO cartellini, autogol e i gol
  subiti dal portiere); ora classifica la **fantamedia attesa**, che contiene il voto. Va detto: il tasso di
  bonus vero sarebbe `FMa − MVa`, e questa colonna non è quello — è per questo che somiglia a Voti;
* **PRESENZE** era la quota di calendario prevista **corretta** dai minuti che gioca quando gioca, scontata
  della fragilità e della nota dichiarata; ora è la quota **nuda**.

**Che cosa è stato cancellato con loro**, perché nessuno lo ricostruisca credendo che manchi: il blend con
l'ANCORA del ruolo tirata verso il livello del club (era «ogni calciatore deve avere il suo numero» applicato
alle letture), i minuti quando gioca, lo sconto di FRAGILITÀ sull'eccesso rispetto alla mediana del listone,
la concavità sul POSTO da titolare, la penale della NOTA DICHIARATA. Le misure che li avevano scelti restano
in §5-§7. Quello che NON si è perso è l'informazione: infortunio lungo, rientro recente, fragilità e fuori
rosa sono i **marchi** accanto al nome, che le dicono in parole invece che in un numero. La carriera resta,
ma solo come RIPIEGO dell'Overall per chi il foglio non valuta affatto, e la nota della cella lo dichiara.

### 9.7 Niente paginazione: le righe arrivano scorrendo (lazy load)

Richiesta sua: «nella vista calciatori riusciamo a togliere la paginazione e a mettere un lazyload?». Le due
tabelle della vista — Ultime partite e Valutazioni — mostrano le prime **60** righe e ne aggiungono 60 quando
lo scorrimento arriva a 500px dal fondo (`core/lazy-rows.ts`, costanti dichiarate lì). La paginazione è via
per davvero: `nzFrontPagination` resta **false** e non è un pager nascosto — col pager soltanto nascosto la
tabella mostrava i primi dieci di una rosa di 26 mentre il conteggio diceva 26, che è il difetto già pagato.

Due cose che sono requisiti e non rifiniture. **Il conteggio non mente**: sotto la tabella c'è sempre «X di Y
a schermo — scorri per gli altri», e quando finiscono «Y calciatori, tutti a schermo». E **la finestra si
riazzera quando la lista cambia**: filtrare per ruolo restando al quattrocentesimo rigo mostrerebbe righe
nuove sotto una posizione vecchia.

Perché non lo scroll virtuale di ng-zorro: vuole un'altezza di riga FISSA, mentre qui una riga cresce con i
badge dei ruoli e con le icone — e una misura sbagliata là non «sposta un po'», salta righe.

**Verificato funzionalmente** (uno screenshot mostra righe, non mostra che ne arrivano altre): guidando Chrome
via CDP, la tabella parte con 60 righe e **zero** elementi di paginazione, e ogni scorrimento al fondo ne
aggiunge 60 — 60 → 240 → 300 → 360 → 420 su 499 — con la frase che segue il conteggio a ogni passo.

### 9.8 Una sola barra di scorrimento, e le intestazioni restano in alto

Richieste sue, la sera stessa: «non ci deve essere il doppio scroll» e «le etichette delle colonne sticky
top». Sono la stessa cosa vista da due lati, e la trappola è di CSS.

Com'era: `nzScroll` dava alla tabella un suo scorrimento verticale (`calc(100vh - 22rem)`) DENTRO una pagina
che scorreva a sua volta — due barre, e col lazy load due barre che crescono. Il primo tentativo ha tolto solo
l'asse Y e messo `position: sticky` sulle `th`: **misurato, non funzionava** — dopo 1200px di pagina la testa
era a **−952px**. La ragione è la specifica: un `overflow-x: auto` porta con sé l'asse Y (un `overflow-y:
visible` accanto viene calcolato `auto`), quindi quel contenitore restava l'ancora dello sticky e se ne andava
con la pagina.

Com'è: la tabella **non sta in nessun contenitore che scorre** (`overflow: visible` su `.ant-table-content` e
`.ant-table-body`, e la larghezza delle colonne accese diventa un `min-width`), quindi scorre la PAGINA nei due
assi — una barra per asse — e lo sticky si ancora al viewport, dove funziona. Verificato misurando: **nessuno
scroller verticale interno** su 16.335 elementi esaminati, e la prima `th` a **0px** dopo 1200px di
scorrimento (era −952). Il prezzo, detto: con molte colonne accese la pagina scorre anche di lato, e in quel
caso R e Nome scorrono via con le altre — appuntarle è un lavoro a sé (`nzLeft`), non è stato fatto.

### 9.9 Il trascinamento: l'«effetto strano al rilascio», misurato e curato

Segnalato da lui e riprodotto in e2e con CDP, che è il solo modo di vedere un'animazione: al rilascio, per
qualche frame, **quattro intestazioni restavano traslate di 64px** (`matrix(1,0,0,1,64,0)`) mentre l'ordine
era già cambiato. Il meccanismo: mentre trascini, CDK sposta i vicini con un `transform` inline e al rilascio
li ripulisce **un tick dopo**, quando Angular ha già ridisegnato la riga nell'ordine nuovo riusando gli stessi
nodi — quindi si vedono celle nuove con lo spostamento della posizione vecchia. Cura: azzerare i `transform`
nello stesso frame in cui l'ordine cambia, dentro `dropColumn`.

Due cose provate e scartate, con la misura accanto. Mettere l'anteprima DENTRO la riga
(`cdkDragPreviewContainer="parent"`) la fa disegnare bene mentre viaggia, ma al rilascio CDK la fa **rientrare
volando** (in e2e: un transform di 439x248 con l'ordine già cambiato) — cioè peggiora esattamente il momento
da curare. Un'anteprima nostra (`*cdkDragPreview`) non si applicava affatto, perché quel template vale solo
DENTRO l'elemento trascinato. Quello che ship: anteprima fuori dalla riga (il default), vestita dal CSS e
**senza transizione**, così al rilascio sparisce dov'è invece di tornare indietro.

Misurato dopo la cura, e sono le tre cose che il difetto lasciava a schermo: al rilascio **0 transform
residui, 0 anteprime, 0 placeholder**, ordine già quello nuovo, 19 intestazioni e 19 celle. E col caso che lui
ha segnalato subito dopo — «le colonne si possono anche selezionare e deselezionare» — con MVa e FVM spente:
17 intestazioni e 17 celle prima e dopo, zero residui, e le due chiavi spente **ancora nell'ordine salvato**,
così riaccendendole tornano dove erano. La regola dell'ordine è ora una funzione pura (`orderColumns`) con
quattro test, perché «una colonna nuova non deve nascere in coda» e «una chiave che questa vista non offre non
deve spostare le altre» sono due cose che si rompono in silenzio.

### 9.6 Le colonne si trascinano, e l'ordine si ricorda

Richiesta sua: drag&drop, «l'ordine deve essere memorizzato in localStorage». La riga di intestazione è una
drop list orizzontale (CDK), ogni intestazione opzionale è trascinabile, e l'ordine finisce in
`fantassistant.squad.order` insieme alle colonne spente — quindi vale in tutt'e due le tabelle (listone e
rosa) e sopravvive al refresh, come la scelta di quali colonne vedere.

Due cose per chi ci mette mano:

* **R e Nome non si trascinano**: sono l'identità della riga. Conseguenza visibile, e va detta perché cambia
  il colpo d'occhio: «Mantra» prima stava FRA R e Nome, ora è la prima colonna trascinabile dopo il nome.
* **Il template è diventato un ciclo** su `visible()` con uno `@switch` per chiave, per l'intestazione e per
  la cella: era l'unico modo di far seguire alle celle l'ordine delle teste. Se si aggiunge una colonna
  bisogna aggiungerne il `@case` in tutt'e due i posti, e il test conta che le due file abbiano lo stesso
  numero di elementi.

**Verificato funzionalmente e non a occhio** (uno screenshot non mostra un trascinamento): guidando Chrome
via CDP, «Surplus» trascinato sopra «Mantra» cambia l'ordine a schermo, la chiave in `localStorage` viene
riscritta con l'ordine completo, e le celle della prima riga restano **19 come le intestazioni**. Il primo
tentativo NON funzionava - `cdkDrag` era su un `<ng-container>`, che non ha elemento e quindi non ha nulla
da trascinare - ed è il genere di difetto che uno screenshot dichiara sano.

### 9.4 I nomi delle colonne, e le due che sono state tolte

`FM att.` → **FMa**, `MV att.` → **MVa**, `Margine` → **Lead** (sue, 17/08/2026): il filtro usa le stesse
parole della tabella, o l'elenco dei filtri e l'intestazione finiscono per chiamare due cose con un nome
solo. E le due colonne al netto della coppa — `Surplus −C` e `Margine −C`, nate la mattina — **sono state
tolte la sera stessa**: il fatto resta dove è misurato (il foglio porta `desc_surplus_cup` e
`desc_surplus_fielded_cup`, il globo accanto al nome dice chi parte e il tooltip delle presenze attese dice
quante giornate costa), quindi non si è perso niente e la tabella ha due colonne in meno.

---

## 10. OVERALL e VALORE sono la stessa formula, e sono due domande (17 agosto 2026, notte)

Misurato leggendo le formule invece dei risultati. L'Overall della tabella Giocatori è `quota di calendario
× FMa`; il **Valore** del pannello asta è `FMa × Pv × confidenza`, scalato a 0-99. Tolto il calendario —
una costante — sono lo stesso numero, con **due differenze** che nessuno dei due schermi diceva:

* **la penale della STIMA**: l'asta moltiplica per `est_confidence`, la tabella no. Non è un dettaglio di
  coda: sul foglio classic di Serie A **294 righe su 589 sono stimate**, confidenza mediana **0,50** — metà
  del listone. **Doekhi è 167° in Overall e 390° in Valore**, stesso giorno e stessa app; Ghedjemis 111°
  contro 369°. Su euro tocca 22 righe su 1.009, quindi il difetto è quasi invisibile proprio dove
  l'operatore guarda di più (ρ 0,993 su euro contro **0,950** su Serie A);
* **la PORTA INVIOLATA**: l'Overall converte al punteggio della TUA lega e la aggiunge ai 68-107 portieri
  (`clean_sheet_bonus_gk` = 1,0 × il tasso del club, ~+0,3 di fantamedia); il Valore resta nel punteggio
  della fonte, che quel termine non lo applica. Quindi un portiere ha due «quanto vale una sua partita».

**Decisione dell'operatore: restano due domande e si DICHIARANO** — «quanto vale» contro «quanto conviene
comprarlo a questo tavolo», e la seconda ha ragione di scontare l'indeterminazione perché è quella che
decide un rilancio. Quindi nessun numero si muove e le due colonne si nominano a vicenda: il pannello sotto
la tabella Giocatori porta le due differenze coi numeri qui sopra, e il tooltip della colonna Valore dice lo
specchio. Cambiare invece una delle due aritmetiche sarebbe stato allineare due risposte a una domanda che
non è una sola — l'errore opposto e altrettanto caro.

**Un difetto di sole etichette, corretto lo stesso giorno**: la colonna **Bonus porta la FANTAMEDIA** (voto
compreso, come il suo stesso dettaglio dice), mentre la formula stampata sotto la tabella — «presenze ×
(voti+bonus)» — invita a sommare Voti e Bonus, cioè a contare il voto due volte. Il codice non lo fa mai; la
frase ora dice che «voti+bonus» è **un numero solo**.

## 13. Un vecchio PV non è una previsione di presenze (19 agosto 2026)

Domanda dell'operatore: **«come fa Arthur Melo ad avere 99 di overall?»** Il conto della sua riga era
giusto e il numero dentro no.

    Overall = quota calendario × FM attesa = (32/38) × 6,342 = 5,34  →  4° su 600 → rank99 = 99

La FM è quella di un centrocampista qualunque (davanti a lui Malen 5,69, Yildiz 5,55, Lautaro 5,36): a
portarlo lassù erano le **presenze**, 32 giornate su 38, la quota più alta di tutta la cima del listone.
Quelle 32 sono l'ultima stagione misurata di un uomo che in Serie A non gioca dal 2024 — Fiorentina
2023-24, 32 voti — consegnata **grezza** dal gradino `older` di `engine/estimate.py`.

**Il difetto non era nell'app.** Quel gradino REGREDISCE la fantamedia verso l'ancora dal 06/08/2026
(`OLDER_BETA` = 0,40, e il commento dice perché: una fantamedia vecchia usata cruda è la baseline naive che
il core batte, ed è distorta in ALTO proprio per gli uomini che quel gradino serve) e consegnava le presenze
intatte, **senza nemmeno convertirle fra i due calendari**. Lo stesso difetto, sull'altra metà della coppia,
rimasto in piedi tre mesi perché nessuna colonna lo mostrava: l'Overall è un PRODOTTO, quindi è la prima
lettura che una presenza sbagliata sposta di 480 posizioni.

### La cura scelta, e le due che sono state scartate

Erano tre, e la più onesta è la sola che tocca il numero invece del suo effetto:

1. **scontare l'Overall con `est_confidence`** (0,75 qui) come già fanno Fantapunti e Lead. Curerebbe UNA
   colonna e lascerebbe in piedi la frase falsa nelle altre — la lettura Presenze diceva **98** e il
   tooltip «l'84% del calendario a voto» — e sarebbe un **doppio conteggio**: l'incertezza di una riga
   stimata è già a schermo, nel peso delle stelline (`weight` 0,5 per una stima). È la regola che questo
   progetto ha già pagato: *quando lo stesso sintomo va rattoppato in due punti diversi, il difetto sta
   nella quantità che entrambi leggono*.
2. **lasciare tutto e spiegarlo nel tooltip.** Una nota non cura una graduatoria: al tavolo si legge la
   colonna, non la nota.
3. **regredire il PV come già si regredisce la FM** — adottata, con un coefficiente MISURATO e non scelto.

### La misura (`est.OLDER_SHARE` / `OLDER_PV_BETA`)

Popolazione = gli uomini il cui vecchio pv **parte davvero**: niente di misurato a t−1 su nessuna delle due
piattaforme *e* nessun minuto di lega all'estero (per quelli risponde prima `presences_from_abroad`).
Bersaglio = la quota del calendario che ha poi realmente ottenuto, **leave-one-season-out**, con un quotato
che non gioca contato per **lo zero che è** (il foglio prevede per tutti i quotati: punteggiare solo i
sopravvissuti sarebbe un'altra domanda).

| | default (n=221, 8 stagioni) | euro (n=48, 3 stagioni) |
|---|---|---|
| il suo vecchio pv, grezzo (in vigore) | MAE 0,3749 | MAE 0,3510 |
| …solo convertito fra i calendari | 0,3756 | 0,3064 (+12,7%) |
| l'ancora della popolazione, da sola | 0,2704 | 0,3482 |
| **ancora + b(sua quota − ancora)** | **0,2689 (+28,3%)** | **0,2993 (+14,7%)** |

**Le due piattaforme non dicono la stessa cosa, e il meccanismo spiega perché.** Su default la quota vecchia
mediana è 0,632 e l'esito 0,289: la sua vecchia stagione non porta quasi nulla, b\* = **0,10**, interno alla
griglia, positivo su **8 stagioni su 8** (+13,9% … +36,7%) e scelto dal cross-fit su 6 pieghe di 8. E
l'ancora su cui atterra, **0,29**, è al decimale la costante `unmeasured` che già esisteva: *un quotato di
Serie A che l'anno prima non ha giocato da nessuna parte è, PER LE PRESENZE, un uomo che nessuno ha mai
misurato*. Su euro no (0,61 contro il suo 0,19), perché lì «niente misurato a t−1» vuol dire più spesso
«ha giocato in un campionato che non copriamo» che «non ha giocato»: le cinque leghe sono il perimetro,
non il mondo.

**Il valore euro è fragile e si adotta dicendolo**: 3 stagioni, 48 righe, ottimi propri 0,90 / 0,00 / 0,55 —
la DIREZIONE è identificata (ogni punto della griglia batte il pv grezzo, da +3,7% a +16,1%), il valore no.
0,55 è il minimo della curva sull'altra convenzione (+20,3%) e sta nella conca piatta di questa. Esce senza
discutere alla prima stagione che dica altro. Sul foglio euro di oggi le righe `older` sono **0**, quindi
oggi quella costante non muove niente.

**Una asimmetria va detta**: a differenza della regressione sulla fantamedia, questa può solo ABBASSARE, e
per costruzione — il gradino si accende solo per chi aveva ≥ 15 voti nella stagione vecchia, cioè una quota
già sopra l'ancora. Non è un taglio arbitrario: è che quegli uomini, misurati, poi giocano 0,29 di stagione.

### Che cosa si muove

46 righe su 600 del foglio Serie A (46 anche sul mantra, 0 su euro), tutte in giù. Arthur Melo:

| | prima | dopo |
|---|---|---|
| Pv attese | 32,0 | **13,1** |
| Overall | **99** (4° su 600) | **18** (489°) |
| Presenze | 98 | 17 |
| Fantapunti | 152 | 62 |
| Lead | 11,5 | 4,7 |
| FM / MV / Voti / Bonus | 6,34 / 6,11 / 78 / 59 | invariati |

`engine_*` non si muove di un decimale — è un ripiego, e `evaluate` non importa `estimate`: `backtest
--verify` resta **22/22**. `SHEET_REVISION` 28 → **29**, quindi ogni cartella precedente va rifatta, i
quattro pacchetti del viaggio nel tempo compresi (rifatti).

E la riga lo dice: `est_note` ora scrive anche cosa è successo alle presenze — «his 32 votes are 84% of that
calendar and read as 13.1 of 38 here» — perché una nota che spiega metà di una coppia invita a fidarsi
dell'altra metà cruda.

## 8. Aperti

**Sulla scala della titolarità (20/08/2026), tre decisioni che sono sue e non misure** — §16:
- i **95 uomini su 605** (Serie A; 166 su 1023 su euro) senza una partita misurata leggono **vuoto** e non
  `riserva`. La sua definizione del gradino 6 («non si sa nemmeno se andrà in panchina») direbbe il
  contrario; la ragione per non farlo è che quella frase descrive un uomo ai margini di una rosa e non un
  buco nei dati. È una riga di codice in tutt'e due i sensi.
- **`titolarissimo` è un gradino residuo** (sopra l'80% ma non sopra il 90%, con la sbarra dei minuti
  alta): 0,7-1,0 uomini per club e la promessa mantenuta 3 volte su 4. Se lo vuole più largo, la sbarra da
  muovere è quella dei minuti e non quella della quota.
- il **pavimento dei minuti è in minuti assoluti**, quindi premia i ruoli che restano in campo:
  `bandiera` tiene 11 portieri, 33 difensori, 13 centrocampisti e 4 attaccanti. Un pavimento misurato
  DENTRO il ruolo è la cura, e va misurata prima di essere adottata.
- e **«ballottaggio» ha due sensi nello stesso file**: sul campetto è una RELAZIONE (si giocano quel
  posto), sulla scala è un GRADINO (gioca quasi ogni partita). Promuovere ogni rivale nominato al gradino
  4 è stato misurato e non conviene (rendono 0,551 di quota contro lo 0,80 promesso), quindi resta la
  parola con due sensi - stessa famiglia del termine chiarito lo stesso giorno.


1. ~~**`season_stats.clean_sheets`**~~ — **FATTO il 16/08/2026**: 970 stagioni-portiere e **4.872** porte
   inviolate, con tre guardie e il disaccordo fra le fonti dichiarato invece che ritagliato (§6-bis). La
   voce restava aperta qui per svista, ed era già segnata come chiusa nella todolist: due elenchi che
   dicono due cose sullo stesso lavoro sono la ragione per cui questa correzione vale una riga.
2. ~~Storico del valore di mercato~~ — **FATTO il 16/08/2026**: modulo `market`, endpoint JSON
   `transfermarkt.it/ceapi/marketValueDevelopment/graph/{pid}` (senza muro di consenso), tabella
   `market_value_history`. Acquisiti **1.055 quotati, 22.269 punti**, dal 2005 al 2026, mediana 20 punti
   a testa, zero fallite. E la domanda per cui era stato preso ha risposta: **tutti e 1.058 hanno un
   valore alla data d'asta e 1.056 ne hanno due o più nell'ultimo anno**, cioè una tendenza leggibile —
   che è l'input che il gate segnalava rotto (canale dell'investimento: «sistemare l'input prima di
   toccare il peso»). `market_values`, un valore per stagione, resta dov'è: risponde a un'altra domanda.
   **E il 17/08/2026 la curva è arrivata all'app** (§7-ter): in DB sono **3.323 curve e 85.061 punti** —
   cresciute con l'acquisizione allargata che ha tolto il filtro di sopravvivenza per l'harness
   (§7-untricies) — di cui **26.314 viaggiano** nel bundle, tagliati un anno prima della finestra `heavy`.
   Come CANALE invece è chiusa in senso negativo, e quella misura sta nel gate.
3. ~~**Minuti per competizione e in nazionale**~~ — **ROTTA TROVATA il 17/08/2026**, e la storia scritta
   qui («muro di consenso, i dati arrivano solo dopo») era falsa: registrando le chiamate della pagina in
   un browser headless si vede che la tabella non sta in quella pagina affatto - la serve un HOST diverso,
   `tmapi.transfermarkt.technology`, in JSON e **senza nessun muro**. Non c'era niente da aggirare, c'era
   qualcosa da guardare. Dettagli nella root `CLAUDE.md` («Una fonte che nasconde la sua tabella») e nella
   todolist; quello che manca è l'acquisizione, non la strada.
4. **Coppe da Sofascore** — 403 `challenge` su tutti gli endpoint dal 16/08/2026, dopo una corsa su 93
   club. In attesa, e senza insistere.
5. **I timepack sono fermi a `SHEET_REVISION` 29** (verificato il 20/08/2026: tutt'e dodici i fogli delle
   quattro date). Non è un difetto nato con la MVa prevista — erano già vecchi di due revisioni quando il
   bundle stava a 31 — ma adesso ne sono tre indietro, e la macchina del tempo mostra la MVa **derivata**
   su quelle date mentre le colonne di oggi mostrano quella prevista: due numeri con lo stesso nome nella
   stessa app. Si cura con `timepack --all --refresh`, che scrive il DB (quindi va fatto dalla sessione che
   lo possiede) e che il 19/08 è morto su un lock — la cura è in `db.database.retry_on_lock`.

---

## 11. LE DEFINIZIONI DELL'OPERATORE, dettate il 18 agosto 2026 — e il difetto che ne è uscito

Non sono una misura: sono **decisioni sue**, scritte qui perché d'ora in poi il codice le deve rispettare
alla lettera e perché due delle tre hanno spostato dei numeri.

* **Overall** = «giudizio assoluto sul rendimento», 0-99, e la formula è
  `partite a voto previste × (Media Voto attesa + Bonus attesi)`.
* **Lead** (era «Valore» nel pannello d'asta) = «punti in più che porterebbe alla tua squadra rispetto a un
  suo rimpiazzo», cioè **Overall − valore del rimpiazzo**, col rimpiazzo tarato su una lega da dieci.

### 11.1 La colonna «Bonus» portava la fantamedia, e adesso porta i bonus

Fino al 17/08 la lettura BONUS era `est_fm`, cioè la fantamedia col **voto dentro**: sommarla a «Voti»
contava il voto due volte, e la frase sotto la tabella doveva avvertire di non farlo. Un avvertimento è la
confessione che due colonne non si possono leggere insieme. Dal 18/08 la colonna è **`est_fm − est_mv`**, il
tasso di bonus a presenza che il foglio si aspetta - lo stesso numero che il foglio scrive nella propria nota
(`est_note`: «−0,82 di bonus a presenza») - così **MVa + Bonus è esattamente il fattore dell'Overall**. Per un
portiere è NEGATIVA per costruzione, e va letta così: i gol che subisce sono la parte grossa di quel conto.

### 11.2 «Lead» si è spostato di colonna, e ogni domanda ha un nome solo

Il 17/08 «Lead» era il nome della colonna che conta dal rimpiazzo che ENTRA (era «Margine»). Con la
definizione del 18/08 il nome appartiene alla colonna dell'asta, che conta dal **marginale di ROSA** - lo
stesso zero del `engine_surplus` del foglio, scelta sua fra i due - quindi:

| colonna | dove | zero | confidenza della stima | unità |
|---|---|---|---|---|
| **Surplus** | tabella Giocatori | marginale di rosa (`engine_replacement_fm`) | no | fantapunti |
| **Margine** | tabella Giocatori | il rimpiazzo che entra (`desc_replacement_fielded`) | no | fantapunti |
| **Lead** | pannello asta | marginale di rosa | **sì** | fantapunti |
| **+/10g** | pannello asta | il migliore fra i LIBERI, e si muove a ogni scelta | sì | fantapunti / 10 giornate |

Due cose decise con la definizione. Il Lead è in **fantapunti e non su 0-99**: un lead negativo (peggio del
rimpiazzo) è una notizia, e una scala 0-99 lo schiaccerebbe a zero cancellando proprio quella. E **la
confidenza della stima resta**, per sua scelta esplicita: chi decide un rilancio sconta quello che non sa -
quindi Lead ≠ Overall − rimpiazzo per le 294 righe stimate su 589 del foglio Serie A, e le due intestazioni
lo dicono a vicenda invece di lasciarlo scoprire al tavolo (§10).

### 11.3 IL DIFETTO CHE LA SUA DOMANDA HA TROVATO: «come è possibile che Audero abbia una MVa di 6,61?»

Non è una previsione del suo voto: è un **residuo**. La MVa non si stima, si DERIVA (`estimate.mv_from`,
«un numero e una derivazione», §7 del foglio) come `FM attesa − il suo malus storico a presenza`. Misurato:

| | partite | MV | FM | bonus/presenza |
|---|---|---|---|---|
| Audero 2025-26 (**Cremonese**) | 34 | 6,07 | 4,78 | −1,29 (50 gol presi) |
| Audero 2024-25 (Como) | 8 | 5,81 | 3,56 | −2,25 |
| blend a presenze, quello che il foglio usa | 42 | | | **−1,46** |
| Butez 2025-26 (Como) | 38 | 6,08 | 5,38 | −0,70 |

La FM attesa dei due portieri del **Como** è la stessa (5,147 e 5,151): il motore dice che valgono uguale per
partita. Ma il malus che sottrae ad Audero è quello preso alla **Cremonese**, quindi 5,147 + 1,461 = **6,608**
e il residuo assorbe il cambio di squadra - una MV che non ha mai fatto (6,07 · 5,81 · 6,34 · 6,17 nelle
ultime quattro stagioni). Butez non lo mostra solo perché le sue due metà vengono dallo stesso club.

**Non è cosmetico**: la lettura VOTI legge `est_mv`, quindi Audero esce **99/99 fra i portieri** e Butez 46 -
un ordinamento deciso da un artefatto. È tutto in `est_*` (reporting: nessun `engine_*` si muove), e la cura
non è una scelta ma una misura, **APERTA**: il malus deve appartenere al club per cui la FM è prevista - o si
tira verso il tasso di ruolo quando l'uomo ha cambiato squadra, o si ricava dai gol che il motore già predice
al club nuovo (per i portieri lo fa). È la stessa famiglia di «una trasformazione appartiene alla popolazione
su cui è stata fittata», vista sull'altro lato: qui le due metà della sottrazione appartengono a due club.

## 12. L'OVERALL A COLORI, e perché le bande sono quantili (19 agosto 2026)

Richiesta dell'operatore sul campetto: «colora l'overall evidenziando i valori buoni da quelli meno buoni».
Le bande stanno in **un posto solo** (`core/player-ratings.ts`, `OVERALL_BANDS`) e sono **quantili del
listone**, non giudizi: l'Overall è un `rank99`, quindi 90 vuol dire «il 10% migliore» e 50 è la mediana per
costruzione — cambiando listone cambia chi ci finisce dentro, e questo va detto o il prossimo lettore legge
una soglia di bravura.

| banda | colore | che cos'è |
|---|---|---|
| ≥ 90 | `--color-vote-top` | il decimo migliore del listone |
| 75-89 | `--color-vote-high` | |
| 60-74 | `--color-vote-good` | |
| 40-59 | `--color-vote-mid` | la fascia che contiene la mediana |
| 20-39 | `--color-vote-low` | |
| < 20 | `--color-vote-poor` | l'ultimo quinto |
| ignoto | `--color-border` | **un numero che non c'è non è un numero basso** |

Due scelte dichiarate. I colori sono quelli che l'app già usa per dire «quanto è buono questo numero» (le
barre di `player-trend`) e non una seconda tavolozza: un secondo vocabolario per la stessa domanda finisce
per dire due cose, e il rosso qui non è un pericolo ma l'ultimo quinto del listone. E l'ignoto ha un colore
suo — il grigio del bordo — perché dipingerlo come un numero basso sarebbe la stessa bugia di leggere una
cella vuota come uno zero.

È **visualizzazione**: nessuna valutazione la legge, nessun gate la possiede.

---

## 14. Fπ, e la SCALA che l'operatore ha dettato in cinque passaggi (19 agosto 2026)

Le misure che fanno il numero stanno nel gate ([gate-motore-v1.md](gate-motore-v1.md)
**§7-septiestricies**): qui c'è che cosa la colonna DICE, come si legge, e le alternative rifiutate.

### 14.1 Che cos'è, e perché sta accanto a Overall invece che al posto suo

Overall è `presenze × (MVa + bonus)`: un **totale, senza zero**, sui numeri che il foglio già porta. Fπ
risponde a un'altra domanda — «quanto renderà **in più del rimpiazzo**, su queste giornate» — e per farlo
tocca gli **ingredienti**, mai la formula dell'altra: la prima cosa che l'operatore ha chiesto è che
Overall resti «un termine matematico sempre semplice». Tre differenze, e sono tutto:

| | Overall | Fπ |
|---|---|---|
| valore di una partita | `est_fm` (ancora di ruolo dove non c'è misura) | il calcio giocato **altrove**, regredito (`pi_fm`) |
| zero | nessuno | il rimpiazzo di rosa, come Lead |
| calendario | nessuno | la deviazione della **finestra scelta** dal girone intero |

**Le due colonne stanno affiancate proprio per poter dissentire**: dove Fπ si stacca da Overall c'è una
notizia che Overall non può vedere, e dove si stacca dal FVM c'è un prezzo che il campo non giustifica.
La cella dice **da quale calcio** viene il valore (`pi_basis`) e **su quante partite** (`pi_matches`),
perché dieci non sono una stagione.

**Lo storico sintetico è arrivato alla lettera.** «Dobbiamo sempre avere uno storico di almeno 10 partite
sintetiche verosimili»: sotto le dieci non si rifiuta, si **padda con l'ancora** — chi ne ha otto ne ha
otto sue e due dell'ancora — che è il suo stesso rimedio del 05/08/2026 scritto come aritmetica. A zero
partite Fπ **è** l'ancora, senza un ramo in più.

### 14.2 La scala: tre punti fissi, e la ragione di ognuno

Dettata dall'operatore e precisata **cinque volte**, il che è il modo in cui è arrivata giusta:

1. «un calciatore con una media uguale alla media della scala abbia un Fπ di **50** circa»
2. «media **di lista**» → «non la media di lista ma la media di un **titolare**»
3. → «la media di lista sui **primi 250** calciatori», «primi nel senso **migliori**»
4. «migliori nel senso con la FMa migliore» → «anzi prendiamo i primi 250 **per overall**»
5. «non deve essere una retta ma una **curva**», con le bande: 0 = terzo portiere o chi non giocherà
   mai · <10 inutile · <30 scarso · <50 riserva

**Perché i primi 250 e non tutti**: la media del listone intero è 121 fantapunti e comprende trecento
uomini che nessuno compra, quindi «medio» finiva per voler dire «più che discreto» — Pongracic, un
difensore da 5,83 che gioca 28 partite, leggeva **73**. Sui primi 250 la media è 158 e lui legge **56**,
che è il numero che l'operatore aveva in testa (aveva detto 60, e Kelly 70 contro i 66 che escono). E 250
non è tondo per caso: è `squadre × slot` della sua lega classic (10 × 25), cioè gli uomini che a quel
tavolo vengono davvero comprati. Resta una **costante dichiarata**, non derivata.

**Chi sceglie i 250 è Overall, chi li media è Fπ**, e non è pedanteria: un'ancora definita dalla colonna
che sta scalando **si sposta da sola** a ogni ritocco di quella colonna. Un test lo protegge.

**Perché due tratti e non una retta.** Con i due soli punti alti (50 e 99) la retta prolungata all'ingiù
tocca lo zero a **102 fantapunti**, e **183 uomini su 600 leggevano 0 tutti insieme**. L'operatore l'ha
visto su un nome — «uno come Stones con 6.4×16 non può avere Fpi=0» — e aveva ragione: Stones fa 103
fantapunti ed è il **417° di 600**, non l'ultimo.

**Perché una curva e non due rette.** Con il tratto basso dritto le tre bande che aveva dichiarato non
esistevano tutte: gli «inutili» erano **zero uomini**, cioè una banda scritta e mai usata. La curvatura è
scelta perché le tre esistano (600 uomini, foglio mantra Serie A):

| γ | <10 inutile | 10-30 scarso | 30-50 riserva | 50+ titolare |
|---|---|---|---|---|
| 1,0 (retta) | **0** | 152 | 322 | 126 |
| **1,6 (spedita)** | 11 | 245 | 221 | 123 |
| 2,0 | 80 | 214 | 185 | 121 |

Sopra l'ancora **non cambia niente** — Malen 99, Yildiz 94, Kelly 66, Pongracic 55 — perché la curva
agisce solo dove il modello prezza tutti con le stesse costanti di ripiego.

**Il prezzo, dichiarato**: le due pendenze sono diverse, quindi attraverso l'ancora il doppio dei
fantapunti **non** è il doppio del punteggio. È presentazione, non misura. L'argomento che la regge:
sotto l'ancora ci sono **108 uomini ammassati fra 95 e 115 fantapunti** perché il modello li prezza con
una costante, quindi comprimere lì non butta via informazione — non ce n'è. Dove ce n'è, sopra, la
proporzionalità è intatta.

### 14.3 Le due alternative di scala, misurate e non discusse

Sul foglio mantra di Serie A (518 uomini):

| scala | valori distinti | gruppo più affollato | uomini a 99 | media | dispersione |
|---|---|---|---|---|---|
| percentile (`rank99`, come Overall) | 98/99 | 23 | **4** | 49,4 | 28,7 |
| lineare sul massimo | 73/99 | 42 | 1 | 56,2 | 17,6 |
| **ancorata (questa)** | 84/99 | 37 | 1 | 50,0 | 20,1 |

Il percentile è **più** frazionato, e va detto perché la richiesta nasceva da lì («meno calciatori che
convergono tutti allo stesso punteggio»): quello che fa male non è la dispersione, è la **cima** —
quattro uomini leggono 99 e Yildiz, che gioca 30 partite a 7,00, legge lo stesso numero del migliore del
listone. Qui ne legge 94 e a 99 c'è un uomo solo.

**E una cosa che l'ancora non può fare, scritta perché è stata chiesta**: «Pongracic dovrebbe leggere
60». Pongracic produce 164 fantapunti contro i 121 di media del listone, cioè il **36% sopra la media**;
su qualunque scala in cui la media legge 50 lui atterra nei 70 (qui 55 perché l'ancora è più alta). Per
portarlo a 60 il pavimento dovrebbe salire a 89 fantapunti e la media leggerebbe 26. Non è una taratura
da trovare: **il totale di un mediocre che gioca sempre è davvero grosso**, ed è la colonna Lead che
risponde all'altra domanda.

### 14.4 Dove vive la scala, e la copia che aveva già divorziato

La scala sta in **`app/src/app/core/projection.ts`** e non nel toolkit, per la stessa ragione per cui i
campetti stanno nel toolkit: dipende dalla **pool**, e la pool si conosce nell'app. Il VALORE di una
partita invece è una previsione su una persona e viaggia nel foglio (`pi_fm`).

⚠️ **`engine/projection.py` ne tiene la definizione di riferimento, e per un'ora del 19/08 le due non
concordavano** — Python a due rette con pavimento 1, TypeScript in curva con pavimento 0 — perché la
richiesta della curva è arrivata dopo la copia. Trovato in chiusura di sessione, curato allineando il
riferimento e con **un test che legge le costanti dal sorgente TypeScript** invece di ricopiarle: è
l'unico modo perché se ne accorga chi ne cambia una sola. È la stessa regola che tiene un solo
`player-status` per tutte le liste — due definizioni finiscono per dare due numeri allo stesso uomo.

### 14.5 Il grafico, e perché è un istogramma

In **Grafici**, «Distribuzione di Fπ»: dieci decili, colorati per banda. Un istogramma e non una seconda
torta di proposito — la torta dice come si **divide** il listone, l'istogramma che **forma** ha, ed è la
forma che giudica una scala: un ammasso a un'estremità in una torta non si vede. Il conteggio degli
uomini **senza** Fπ è scritto accanto e non lasciato fuori dal totale, che è «vuoto = ignoto» applicato a
un grafico.

### 14.6 Il grafico non si vedeva, e la causa non era il disegno (20 agosto 2026)

«Il grafico della distribuzione dei Fpi non si vede» — e non si vedeva **mai**, da quando è stato scritto.
La `computed` che costruiva le barre contava anche gli uomini senza Fπ e **scriveva** il conto in un signal
(`piMissing.set(...)`) prima di restituire: Angular lo vieta (`throwInvalidWriteToSignalError`), quindi
`piBars()` sollevava un'eccezione a ogni lettura del template e la sezione non veniva disegnata. Verificato
lanciando la primitiva di Angular su una `computed` finta, non dedotto dal codice.

**Perché nessuna delle verifiche di allora poteva vederlo**, che è la parte che vale:

  * `ng build` **compila i template e non li esegue**, quindi una `computed` che esplode alla prima
    lettura passa il build senza una riga di avviso. Il commit dichiarava «build di produzione verde» ed
    era vero.
  * `ng build` **non compila nemmeno gli spec** (`tsconfig.app.json` esclude `src/**/*.spec.ts`), e
    `projection.spec.ts` portava un errore di tipo (`at(103)` è `number | null`): l'esecutore dei test si
    rifiutava di **costruire** la suite, cioè tutti e 27 i file cadevano insieme senza stampare un
    conteggio. La suite dell'app non girava da `d7d0fbf`, quindi le «314 prove» della consolidazione del
    19/08 sera non possono venire da una corsa su quel commit. Oggi sono **317** e girano.
  * il conto viveva **dentro il componente**, dove nessun test lo raggiungeva.

Curato spostando il conto dove si può giudicare — `piHistogram(scores)` in `core/projection.ts`, con tre
prove (il 99 nell'ultima decina, i null contati a parte, la pool vuota) — e leggendo lo STESSO `computed`
due volte, barre e mancanti, senza scritture. Come effetto collaterale è sparito un secondo difetto che
nessuno aveva notato: l'intestazione leggeva `piMissing()` **prima** che le barre lo scrivessero, quindi
«senza Fπ» era comunque il numero del disegno precedente.

**Due difetti di contorno dello stesso commit, entrambi invisibili a un test.** La sezione portava
`class="card"`, **una classe che in questo progetto non esiste** (nessun `.card` negli stili, nessun
`@utility`): il riquadro non c'era e il grafico galleggiava sulla pagina. È la regola già scritta in
`app/CLAUDE.md` — «no custom styling classes» — e adesso la sezione porta le stesse utility della sorella
(`rounded-card border border-border bg-surface p-4`), misurate uguali in browser: bordo 1px, fondo
`rgb(20,20,28)`. E il tooltip di Fπ era lungo **280 caratteri** contro un `TOOLTIP_MAX` di 140: la scala
dichiarata è passata in `RATING_DETAIL.pi`, dov'è il suo posto, e l'hint sta in 133.

**La convenzione delle decine, scritta perché una barra ne contiene due bande.** Ogni decina prende il nome
della banda che la occupa (`piBand(low + 1)`), e il punteggio esatto di confine sta nella banda di sotto —
un numero su dieci, rumore — ma non è solo rumore in `PI_BANDS`, dove le soglie sono `score > above` e il **50, che è l'ancora, legge «riserva»** mentre la dichiarazione stampata sotto il grafico dice «50+ titolare»: latente, perché l'unico chiamante che spedisce passa `low + 1` e non tocca mai un confine, e per questo è una voce di todolist e non una correzione fatta di corsa in chiusura. L'eccezione è la PRIMA barra: 0 «non gioca» e 1-9 «inutile» sono due frasi
diverse e la seconda non è un dettaglio di confine, quindi il tooltip dice **«non gioca o inutile»**.
Chiamarla solo «non gioca» era falso per chi ci sta dentro.

**Collaudo**: 317 prove su 27 file, `ng build` verde, e il browser vero sul `dist` — 10 barre, etichette
0…90, la più alta 185px, «603 calciatori · 3 senza Fπ», **zero errori di console**. Una figura si collauda
aprendola: nessuno degli altri due controlli poteva.

## 15. La MVa era la metà DERIVATA della coppia, ed era la metà sbagliata (20 agosto 2026)

Due domande dell'operatore sul foglio classic, la stessa domanda: **«come è possibile che Malen ha solo
5,67 come MVa? come è possibile che McTominay ha solo 5,72?»** Nessuno dei due numeri era un errore di
aritmetica, ed entrambi erano falsi.

`est_mv` non veniva stimata: veniva **derivata**, `est_mv = est_fm − il suo tasso di bonus grezzo`. E i due
addendi non stavano sulla stessa scala. `est_fm` per una riga `core` è `engine_fm_pred`, cioè un numero già
**regredito verso l'ancora**; il tasso era il suo storico crudo al 100% (`BONUS_FULL_VOTES` = 15, quindi da
quindici voti in su il peso era 1 e l'ancora del ruolo non lo toccava). Tutta la regressione della
fantamedia finiva sul voto base.

| | stagione misurata | FM | MV misurata | tasso | FM prevista | MVa vecchia |
|---|---|---|---|---|---|---|
| Malen | 2025-26 default, 18 voti | 9,00 | **6,75** | +2,25 | 7,92 | **5,67** |
| McTominay | 24-25 e 25-26, 67 voti | 7,17 | **6,30** | +0,99 | 6,71 | **5,72** |

Malen 1,08 **sotto il voto base più basso di tutta la sua carriera** (6,19-6,75). È esattamente il difetto
che il commento accanto già descriveva per tutti gli ALTRI gradini — «deriving it there too would dump the
whole regression onto the base vote, which is how Kolo Muani first came out at 5.29 against the 6.06 he
actually averaged» — commesso dall'unico gradino che derivava.

**Quanto era largo.** Righe `core` con almeno 15 voti misurati, MVa contro la sua MV misurata pesata sulle
presenze: 70 su 284 (classic) e 93 su 692 (euro) stavano **sotto il loro peggior voto base di sempre**, e
l'errore non era rumore — era proporzionale al bonus, r = **−0,44** su classic e −0,29 su euro:

| tasso di bonus | <0,3 | 0,3-0,8 | 0,8-1,5 | >1,5 |
|---|---|---|---|---|
| errore medio, classic | +0,05 | −0,07 | **−0,42** | **−0,69** |
| errore medio, euro | +0,12 | +0,05 | −0,08 | **−0,51** |

E la prova che non serviva nessun esito per chiamarlo difetto: **lo stesso uomo aveva due MVa diverse a
seconda del foglio**, quando il voto base è precisamente la cosa che le due piattaforme condividono —
Gimenez 5,83 su classic contro 7,08 su euro, 46 uomini di 269 oltre 0,40 di scarto. Malen su euro leggeva
6,39 solo perché lì il tasso era mediato su quattro stagioni e si era abbassato per caso.

### 15.1 Perché era troppo: b = 1 è il punto peggiore della sua stessa griglia

Prevedere il tasso di una stagione da quello precedente, 2092 coppie Serie A e 1708 euro con ≥ 15 voti in
entrambe, `tasso = ancora_ruolo + b(suo − ancora)`, MAE sul tasso dell'anno dopo:

| b | 0,00 | 0,45 | 1,00 (il codice) |
|---|---|---|---|
| MAE | 0,2449 | **0,2163** | **0,2470** |

Prendere il suo tasso intero perde perfino contro **ignorarlo del tutto**. E la giustificazione scritta nel
file — «r = +0,842, far above anything else this project carries season to season» — si riproduce alla
decimale ed è una correlazione **POOLED**: dentro il ruolo è **+0,488** (P +0,51 · D +0,40 · C +0,51 ·
A +0,49), e quasi tutto il resto è la separazione fra un portiere a −1,29 e un attaccante a +0,74. Stessa
lezione del canale età: una differenza fra due GRUPPI non è una virtù di chi la porta.

### 15.2 La richiesta dell'operatore era una misura: «chi segna ha sempre o quasi un voto buono»

Aggiunta da lui insieme al via: **«dobbiamo assolutamente fare in modo che FMa e MVa siano coerenti: un
attaccante con una FMa alta è impossibile che abbia una MVa così bassa»**. È vera e grande — dentro il
ruolo, `r(MV, tasso di bonus)` è **+0,787** per gli attaccanti di Serie A (+0,79 su euro, C +0,63, D +0,50,
P +0,28). Sottrarre il tasso da una FM fissa impone su quella relazione una pendenza di **−1**, ed è per
questo che la colonna crollava esattamente per chi fa più bonus.

**Le due strade sono la stessa trasformazione**, e questo è il motivo per cui non si perde niente a
scambiarle: con la stessa b su entrambe le metà, `FM_pred − (tasso_ruolo + b(tasso − tasso_ruolo))` **è**
`ancora_mv + b(MV − ancora_mv)`. Cambia solo quale metà assorbe la regressione verso l'ancora. E il numero
che serviva era **già in quel file**: il blocco sostituito diceva «anchor + b(his − anchor) 0,148 a
b = 0,45» e poi lo rifiutava per paura di un secondo numero libero di contraddire il primo. Derivare il
TASSO invece della MV toglie quella paura del tutto: resta un numero e una derivazione, e `fm − mv` resta
il tasso di bonus che la riga si aspetta.

### 15.3 I tre parametri, tutti fuori campione

- **`MV_BETA` = 0,45 (default) · 0,40 (euro)** — quanto del suo voto base misurato sopravvive come
  previsione. Leave-one-season-out sulle coppie sopra, cross-fit **unanime**: 0,45 su tutte e dieci le
  finestre Serie A, 0,40 su tutte e cinque le euro (MAE 0,1478 / 0,1491 contro 0,1656 / 0,1618 per la sola
  ancora del ruolo). **Riscontro che nessuno ha fittato per questo**: il motore GATED prevede già il voto
  base di un portiere come `GK_MV_ANCHOR + GK_MV_BETA × (mv_prev − ancora)` con `model.GK_MV_BETA = 0,40`,
  la stessa forma e lo stesso valore, arrivati dall'altro lato.
- **`MV_FROM_FM` = 0,55, su entrambe le piattaforme** — dove non ha nessun voto base misurato (166 righe
  `core` di 998 su euro, 11 di 295 su Serie A, più ogni gradino `anchor`) la frase dell'operatore è l'unica
  cosa che resta, e si legge sulla FM che la riga porta già. Auto-consistente, perché il tasso è `FM − MV`:
  `MV = (ancora_mv + g(FM − tasso_ruolo)) / (1 + g)`. Ottimo INTERNO, fold 0,50-0,65, MAE 0,1534 contro
  0,1656 per la sola ancora (g = 0) e **0,1847 per `FM − tasso_ruolo`**, che è quello che il codice faceva
  qui per tutti. La sua pendenza effettiva sulla FM, `g/(1+g)` = 0,355, cade sulla +0,385 / +0,350
  trasversale misurata a parte: è la stessa relazione e non una seconda.
- **`CLUB_MV_SHARE` = P 0,17 · D 0,59 · C 0,44 · A 0,33** — quanto del livello di un CLUB è voto base.
  `club_anchor` muove l'ancora della FANTAMEDIA verso la media del club per quel ruolo, e il codice
  prendeva l'ancora della MV come «quella meno il tasso del ruolo», che regala al voto base tutto il
  vantaggio del club. Misurato dentro stagione su 469 / 451 / 453 / 360 club-stagioni, il vantaggio è voto
  base solo in parte, e la parte è **ordinata come dice il calcio**: una difesa solida sono porte inviolate
  e voti, un attacco forte sono bonus. Serie A 25/26 in una riga — fra il club migliore e il peggiore lo
  scarto è 1,33 di FM per gli attaccanti contro 0,56 di MV, 0,75 contro 0,42 per i difensori.
- **E un canale rifiutato, perché lo zero va detto**: il suo TASSO in più al suo voto base non aggiunge
  niente. Griglia congiunta su (b, d) in `MV = ancora + b(sua MV − ancora) + d(suo tasso − tasso_ruolo)`:
  **d = 0 su dieci fold di dieci** su default, su euro 0,05-0,10 per 0,0013 di MAE, sotto qualsiasi soglia
  di questo progetto. La relazione di popolazione è reale ed è **già dentro il suo voto base**; contarla
  due volte è l'errore del canale età. `MV_OWN_RATE_WEIGHT` = 0 sta nel codice con quella misura accanto, e
  un test lo asserisce.

### 15.4 Il verdetto sui fogli veri

`SHEET_REVISION` **32**. Rigenerati i tre fogli e confrontati riga per riga con quelli del 19/08, contro la
MV misurata di ciascuno:

| | classic prima | classic dopo | euro prima | euro dopo |
|---|---|---|---|---|
| errore assoluto medio | 0,171 | **0,085** | 0,189 | **0,100** |
| r(errore, tasso di bonus) | −0,437 | **+0,069** | −0,291 | **+0,007** |
| scaglione tasso > 1,5 | −0,688 | **−0,104** | −0,512 | **+0,000** |
| sotto il suo peggior MV di sempre | 70 | **46** | 93 | **59** |

E la coerenza che l'operatore ha chiesto, come pendenza di MVa su FMa dentro il ruolo, col riferimento
misurato sulla popolazione accanto:

| | P | D | C | A |
|---|---|---|---|---|
| foglio, prima | +0,31 | +0,40 | +0,28 | **+0,13** |
| foglio, dopo | +0,43 | +0,59 | +0,47 | **+0,37** |
| popolazione (default) | +0,18 | +0,54 | +0,38 | +0,31 |

Le pendenze nuove sono un filo più ripide di quelle vere, e la ragione è la stessa che rende onesta la
colonna: la FMa del foglio è una previsione regredita, quindi ha meno dispersione della FM misurata, e la
stessa covarianza su una varianza minore dà una pendenza maggiore. Va detto anche l'altro lato: la MVa
adesso è **meno dispersa** del vero (attaccanti sd 0,139 contro 0,248 nella popolazione), che è quello che
fa una regressione verso la media e che è giusto per una previsione — una colonna che riproducesse la
dispersione dell'esito sarebbe sovrasicura.

Sui due nomi da cui è partito tutto: **Malen 5,67 → 6,51** (misurata 6,75) e **McTominay 5,72 → 6,20**
(misurate 6,30 e 6,54), col bonus che resta +1,41 e +0,50 — grande per chi lo fa grande. E la prova che non
dipende dall'esito: lo stesso uomo sui due fogli, **|scarto| medio 0,223 → 0,107, oltre 0,40 da 46 a 6 su
269**.

`engine_*` non si muove di un decimale — `evaluate.py` non importa `estimate.py`, quindi `engine_fm_pred` e
`engine_pv_pred` sono identici su tutte le righe di tutt'e due i fogli e `backtest --verify` non è
interessato. Come per il caso di Arthur Melo (§13), **il difetto non era nell'app**: la formula
`Overall = P × (MVa + Bonus)` e la colonna `Bonus = FMa − MVa` erano e restano giuste, e ripartivano male
un totale corretto fra i due addendi che l'operatore legge.

## 16. LA TITOLARITÀ IN UNA PAROLA: sei gradini dettati, due assi, e la board come cancello (20 agosto 2026)

**Richiesta dell'operatore**, alla lettera: «vorrei che quando si genera lo snapshot, per ogni calciatore
venga deciso se è 1) bandiera => giocherà ogni partita (>90%) almeno 75' · 2) titolarissimo => giocherà
quasi ogni partita (>80%) almeno 75' · 3) titolare => giocherà quasi ogni partita (>80%) almeno 65' ·
4) ballottaggio => giocherà quasi ogni partita (>80%) · 5) panchina => spesso entrerà in campo ma senza
certezze · 6) riserva => non entrerà spesso / non si sa nemmeno se andrà in panchina», con un vincolo:
**«questo stato deve essere coerente con la formazione tipo (che adesso mi sembra buona)»**.

E, poche ore dopo, la definizione del termine che regge tutto — riportata qui perché è la ragione per cui
l'asse è quello che è: **«nel linguaggio comune "titolarità" è il fattore che indica se un calciatore parte
dall'inizio in campo, nel nostro progetto invece dobbiamo usarlo per indicare che un calciatore gioca
abbastanza da prendere il voto (anche se non parte dal principio in campo)»**. La scala qui sotto era già
costruita così — l'asse è la quota di giornate **a voto** e non la quota da titolare — e la definizione la
conferma invece di correggerla. Il vocabolario e la bonifica dei posti che usavano la parola nell'altro
senso stanno in CLAUDE.md.

### 16.1 Due assi e non uno, che è come le sei righe sono scritte

Ogni riga porta una PERCENTUALE di partite e un pavimento di MINUTI, e la quarta lascia cadere i minuti.
Sono quindi due domande indipendenti, e tutt'e due hanno già una risposta in casa: la quota di partite è
`presence.appearance_share` e i minuti sono `minutes.per_appearance`, il numero del chip della card
(adottato +7,5%/+7,6% il 19/08). Questo modulo non inventa un terzo numero: dice soltanto dove i due che
esistono mettono un uomo.

La lettura alternativa — «>90% delle partite in cui gioca almeno 75 minuti», cioè UNA probabilità
congiunta — è stata costruita e misurata per prima, ed è **inservibile**: la q75 prevista arriva al
massimo a 0,86, quindi `bandiera` è vuota per costruzione, e `titolare` (q65 > 0,80) è vuota anch'essa
perché q65 e q75 distano il 6% su un difensore, quindi chi supera l'una supera l'altra. Sul foglio Serie A
retrodatato al 15/08/2025 quella scala dava **10 / 0 / 0 / 184** sui primi quattro gradini. Scartata coi
suoi numeri, non per gusto.

### 16.2 La quota è CONDIZIONATA, ed è quello che la rende coerente con la board

`appearance_share` è «delle partite per cui è **disponibile**», cioè `voto_share` senza lo sconto
infortuni. Non è un ammorbidimento: è la stessa scelta che fa `claim` essere `standing` e non `presence` —
l'undici tipo è «la squadra che schiera quando sono tutti disponibili», e uno stato che deve tornare con
quel disegno non può portare dentro uno sconto che il disegno rifiuta apposta. Con `voto_share` grezza, chi
gioca ogni volta che sta bene ma si è rotto a marzo leggerebbe `panchina` mentre la board continua a
disegnarlo: due risposte a una domanda. Quello che ha saltato è un fatto sul suo corpo e l'app lo disegna
già come marchio suo (`core/player-status.ts`).

Misurato: **lo shrinkage di quella quota non serve**. Tirarla verso la media del foglio con la stessa
regola che `standing` già obbedisce (prior di 3, 5, 10, 20 giornate) è peggio su tre finestre su quattro —
scarto medio fra promessa e resa 0,076 senza contro 0,078 / 0,079 / 0,088 / 0,109. Il motivo è la lettura
condizionata stessa: l'uomo che uno shrinkage proteggerebbe è quello col campione corto perché era
infortunato, e quelle giornate il denominatore le ha già tolte.

### 16.3 La board è un CANCELLO, e non è un ornamento

Chi l'undici tipo non schiera non può essere `titolare`; chi schiera non scende sotto `ballottaggio`.
È la richiesta dell'operatore letta alla lettera — e, misurato, **è anche il classificatore migliore**:
a parità di claim, gli uomini che la board disegna hanno reso una q75 di **0,512 contro 0,328** di quelli
che non disegna (banda 0,6-0,7; 0,362 contro 0,242 nella banda 0,5-0,6). Il fit sa che modulo gioca il club
e chi altro vuole quella maglia; una quota di stagione no.

Senza cancello, sul foglio 2025 l'operatore avrebbe visto per primi **19 uomini `titolarissimo` che la
board non schiera** e **83 disegnati chiamati `panchina` o `riserva`**.

### 16.4 Che cosa ha reso ogni gradino, su quattro finestre

Fogli pre-stagione retrodatati (`snapshot --season S --date S-08-15`, lo stato di un'asta d'agosto), due
piattaforme × due stagioni. Esito = quello che quegli uomini hanno poi fatto: la quota delle partite del
club in cui erano in campo **fra quelle per cui erano disponibili** (una giornata dentro uno spell
d'infortunio datato esce dal denominatore, la stessa sottrazione che `contested` fa in entrata) e i minuti
medi in una partita giocata.

| gradino | promessa | Serie A 25-26 | Serie A 24-25 | euro 25-26 | euro 24-25 |
|---|---|---|---|---|---|
| bandiera | >0,90 / 75' | **0,864 / 76'** | **0,925 / 79'** | **0,901 / 80'** | **0,896 / 78'** |
| titolarissimo | >0,80 / 75' | 0,700 / 62' | 0,774 / 76' | 0,802 / 71' | 0,867 / 77' |
| titolare | >0,80 / 65' | **0,846 / 67'** | **0,892 / 68'** | **0,881 / 67'** | **0,898 / 68'** |
| ballottaggio | >0,80 | 0,678 / 57' | 0,717 / 60' | 0,789 / 62' | 0,791 / 61' |
| panchina | >0,50 | 0,610 / 49' | 0,645 / 52' | 0,662 / 55' | 0,683 / 56' |
| riserva | — | 0,343 / 47' | 0,386 / 47' | 0,433 / 49' | 0,430 / 50' |
| uomini per club (1/2/3) | | 3,0 / 0,7 / 2,2 | 2,2 / 0,8 / 1,8 | 2,6 / 1,0 / 2,9 | 2,4 / 1,0 / 2,9 |

`bandiera` e `titolare` mantengono la promessa su 4 finestre su 4, e il pavimento di minuti della prima è
superato di quattro punti. `panchina` e `riserva` sono ordinate e ben distanti. **`titolarissimo` è il
gradino debole** e va detto: è il RESIDUO fra gli altri due (sopra l'80% ma non sopra il 90%, con la
sbarra dei minuti alta), quindi è piccolo — 0,7-1,0 uomini per club — e su una finestra di quattro rende
0,700 contro il suo 0,80. `ballottaggio` resta sotto la sua promessa su Serie A perché il cancello ci mette
dentro **tutti** i disegnati che non arrivano a nessuna sbarra: è il punto del cancello, ed è il suo prezzo.

Senza cancello gli stessi due gradini rendono 0,832 / 0,871 / 0,878 / 0,884 e 0,797 / 0,894 / 0,862 /
0,865: **il cancello migliora sei di quegli otto numeri e non ne peggiora nessuno**.

### 16.5 Lo squilibrio fra ruoli è nella definizione, ed è riportato e non curato

Un pavimento in minuti assoluti non è neutro fra i ruoli: una partita da titolare dura 84,5' per un
difensore e 78,5' per un attaccante (`minutes.START_MINUTES`, misurato su 247.825 presenze), quindi
`bandiera` sulla finestra 2025 tiene **11 portieri, 33 difensori, 13 centrocampisti e 4 attaccanti**. È la
sbarra dell'operatore che fa quello che dice, e la regola di questo progetto è che *una differenza fra due
GRUPPI non è un merito di chi la porta* — quindi sta scritto qui perché sia lui a decidere, non sostituito
di nascosto da un pavimento per ruolo. La cura, se la vorrà, è un pavimento misurato dentro il ruolo, e va
misurata prima di essere adottata come tutto il resto.

### 16.6 Dove vive e perché lì

Tre colonne del foglio — `desc_titolarita`, `desc_titolarita_play`, `desc_minutes_next` — scritte **dallo
stesso passaggio che disegna le board**, perché il gradino legge l'undici disegnato: uno stato calcolato
altrove potrebbe descrivere un undici diverso da quello esportato, che è la ragione per cui `boards.json`
sta già dentro la cartella del foglio. Su una macchina **senza display** le tre colonne sono **vuote**:
senza il disegno «è nell'undici?» è ignoto, e un gradino inventato lì sarebbe peggio di una cella vuota.
La stessa mappa viaggia anche dentro `boards.json` (`titolarita`, per `fc_id`) e la parola è scritta su ogni
uomo disegnato e su ogni suo rivale, così una card è autosufficiente — **una risposta per giocatore, non una
per posto**: il rivale è giudicato sull'undici DISEGNATO e non sul modulo che si sta guardando, altrimenti
la sua etichetta cambierebbe premendo un bottone.

Nessuna colonna `engine_*` si muove (`backtest --verify` resta **22/22**) e nessun gate possiede queste
soglie: `PLAY_OFTEN` = 0,50 è l'unico numero che l'operatore non ha dettato ed è **dichiarato** («spesso» è
più spesso che no), con la resa misurata accanto — sceglierlo per far fare bella figura alla sua classe
sarebbe fitting.

Come leggerlo su un club vero, Napoli sul foglio del 20/08/2026: **bandiera** McTominay (1,00 · 78'),
Di Lorenzo (0,96 · 85'), Rrahmani (0,96 · 82'), Hojlund (0,94 · 76'), Buongiorno (0,94 · 75') ·
**titolare** Lobotka (1,00 · 75'), Politano (1,00 · 66') · **ballottaggio** De Bruyne (1,00 · 64'),
Spinazzola (0,97 · 64'), Zambo Anguissa (0,82 · 67'), Milinkovic-Savic (0,75 · 90') · **panchina** Gilmour,
Olivera, Beukema, Lukaku · **riserva** Meret (0,42 · 89'). I due portieri raccontano da soli che cosa
misura la colonna: chi para novanta minuti quando gioca, e quanto spesso gioca.

### 16.7 In tabella: tre caratteri, e il vuoto che non è un gradino (20 agosto 2026, sera)

**Richiesta dell'operatore**: «nella tabella dei calciatori mostrami una colonna con questo valore
(mostrami solo 3 caratteri)». Colonna **`Tit.`**, larga 46px, fra «Ruolo reale» e «P» — la P è la stessa
domanda in partite e la parola in lettere, e una parola letta a mezza tabella dal suo numero è una parola
che nessuno confronta. Sigle: **BAN · TIS · TIT · BLT · PAN · RIS**.

`ballottaggio` non è `BAL` e la ragione è una sola: `BAN`/`BAL` differiscono per l'**ultimo** carattere e
sono il gradino 1 e il gradino 4, cioè le due parole più lontane della scala avrebbero avuto le due sigle
più simili. `BLT` costa una lettera di leggibilità e la spende dove serve; `TIS`/`TIT` sono gradini
vicini e confonderli costa poco. Si ORDINA per il rango e non per la sigla (in ordine alfabetico verrebbe
BAL, BAN, PAN, RIS, TIS, TIT, cioè nessun ordine), e la scala si legge dal **peso** e non dal colore — i
due gradini alti in grassetto, i due bassi smorzati — perché in quest'app il colore porta un significato
(«rosso = pericolo») e sei tinte su una scala ordinale direbbero «allarme» dove c'è una riserva.

**E la verifica in browser ha trovato un difetto, che era mio.** `e2e-table.mjs` disegna la tabella vera e
ne misura le colonne; la colonna era allineata, ma leggendo le righe è saltato fuori **Terracciano F.,
`riserva`** — la cosa più forte che questa scala sappia dire di un uomo — con **nessuna partita misurata**
e il motore che gliene prevede **29 su 38**. `presence.Inputs` tiene le presenze come float, quindi una
colonna assente e uno zero misurato arrivano tutt'e due come 0.0 e la quota legge 0,000: «vuoto = ignoto,
mai zero», incontrato per l'ennesima volta e commesso da chi aveva appena riscritto la regola. La
distinzione sopravvive solo nella RIGA, quindi il guardiano sta lì (`SnapshotView.play_share`, quattro
colonne: se nessuna delle quattro porta calcio giocato, la quota è **None** e il gradino non si scrive).

Quanto pesa: **95 righe su 605** (Serie A) e **166 su 1023** (euro) passano da `riserva` a vuoto. Sono
uomini di cui non esiste una partita: quasi tutti sono nelle rose osservate e fuori dal listone. La
tentazione era leggerli come `riserva` citando la definizione stessa dell'operatore — «non si sa nemmeno
se andrà in panchina» — e la ragione per non farlo è che quella frase descrive un uomo ai margini di una
rosa, non un buco nei dati: è il fondo di una scala di calcio, non un secchio per l'ignoto. Se lui
preferisce il contrario è una riga di codice, ed è una decisione sua e non una misura.

Tre uomini restano dove i due modelli non sono d'accordo, e vanno letti così: **Malen** (`riserva`, quota
0,44 misurata su 18 presenze, la board della Roma non lo schiera) contro un motore che gli dà 28,3
giornate; **Di Gregorio** (`panchina`, quota 0,789 — sotto la sbarra dello 0,80 per un centesimo) che la
board della Juventus disegna come **rivale** di Vicario. Su quest'ultimo la parola «ballottaggio» ha due
sensi nello stesso file: sul campetto è una RELAZIONE (si gioca quel posto) e sulla scala è un GRADINO
(gioca quasi ogni partita). Promuovere ogni rivale al gradino 4 è stato misurato e **non si fa**: i
rivali nominati hanno reso 0,551 di quota contro lo 0,80 che quel gradino promette. Resta la parola con
due sensi, che è la stessa famiglia del termine chiarito oggi e va decisa in chiaro.

### Correzione del 20/08/2026 (sera): due denominatori sbagliati sotto la stessa scala

I gradini di sopra restano quelli misurati; quello che è cambiato è **cosa entra nella quota**, e la scala
ha reso i due difetti visibili perché `riserva` è la cosa più forte che sappia dire. Numeri, criteri e
misura respinta: [gate-motore-v1.md](gate-motore-v1.md) §7-unquadragies. In breve, foglio Serie A, revisione
35 → 36:

- **chi cambia campionato a gennaio** aveva il numeratore di un campionato e il denominatore di un altro
  (Malen: 18 giornate su 18 giocate, lette 18/38 = 0,444). Ora ogni campionato porta le giornate in cui
  c'era: 18 righe interessate, **9 salgono di gradino**, `riserva` 156 → 144 e `panchina` 103 → 111. Malen
  `play` 0,444 → 0,888 e la board lo disegna, quindi `titolarissimo`; Raspadori `ballottaggio`.
- **chi ha solo una finestra misurata altrove** leggeva uno ZERO che nessuno ha misurato, perché la guardia
  contava come «calcio sul tavolo» una finestra che `appearance_share` non sa leggere: 7 righe, ora vuote.
- e il prezzo, che va detto: la board è un'assegnazione, quindi chi entra fa uscire qualcuno — **Scamacca e
  Castro S. scendono a `panchina`, Ngom a `riserva`, con la loro quota invariata**. Il giudice esterno
  sull'aggregato non si muove (165/220 uomini prima e dopo); per club si compensano Roma 10/11 → **11/11** e
  Lecce 8/11 → 7/11.
- **respinto**: leggere solo il regime nuovo di chi ha conquistato il posto a stagione in corso (795 uomini,
  6 stagioni: da solo è il 39% peggiore come predittore, la miscela vale 4 gradini su 123). Il residuo di
  quel caso — Santos A., che era in rosa da luglio e ha debuttato alla 24ª — è nella BOARD e non nella
  quota, e la stampa lo schiera.

## 16-bis. LA SCALA CONTRO LA PRIMA GIORNATA: la prima prova dal vivo (24 agosto 2026)

La scala era stata misurata su quattro finestre di pre-stagione retrodatate. Il 22-24/08 si è giocata la
prima giornata vera, e il foglio del 20/08 — scritto prima, mai riscritto — è un pronostico congelato su
605 righe. Venti board sono venti estrazioni; **un foglio è seicento righe**, ed è lì che una giornata
sola porta abbastanza prove. Gira con lo stesso comando delle board
(`press --sheet DIR --against round --round 1`, funzione `judge_ladder`), e non ri-deriva niente: il
gradino viene dal CSV di prima, l'esito dalle tabelle di dopo.

**Due esiti, mai uno.** Il VOTO (`match_ratings.status = 'played'`) è quello che il gradino promette —
è la definizione della parola qui — e c'è solo dove il calendario della piattaforma ha segnato quella
giornata: su `euro` ad agosto non c'è, e il giudice lo dice invece di sostituirlo con un surrogato.
CHI COMINCIA è lo `started` del provider e c'è per tutti e cinque i campionati.

Serie A, 496 uomini di 18 club, sui **408 che il foglio non dava indisponibili**:

| gradino | n | VOTO | lift sul base | parte titolare |
|---|---|---|---|---|
| bandiera | 50 | **84,0%** | 1,84x | 80,0% |
| titolarissimo | 12 | 66,7% | 1,46x | 50,0% |
| titolare | 30 | 66,7% | 1,46x | 63,3% |
| ballottaggio | 80 | 56,2% | 1,23x | 46,2% |
| panchina | 73 | 34,2% | 0,75x | 24,7% |
| riserva | 122 | 32,0% | 0,70x | 25,4% |
| BASE (il foglio) | 408 | 45,6% | — | 38,5% |

**Monotona**, con `titolarissimo` che PAREGGIA `titolare` invece di superarlo — che è esattamente il
gradino già dichiarato debole (il residuo fra gli altri due, 3 finestre su 4). Su tutti e 496, cioè
tenendo dentro infortunati e squalificati, `titolarissimo` scende a 58,8% e va SOTTO `titolare` (66,0%):
l'inversione è degli indisponibili, non del gradino, e con n = 12 non è comunque una prova.
I 42 uomini **senza gradino** — «vuoto = ignoto, mai zero» — prendono il voto il **16,7%** delle volte:
la guardia mette in fondo chi non abbiamo visto giocare, che è dove sta.

### E la CALIBRAZIONE dice un'altra cosa dalla graduatoria

`desc_titolarita_play` letto come probabilità della singola giornata, sui 367 disponibili che lo portano:

| banda prevista | n | previsto | VOTO realizzato |
|---|---|---|---|
| 0,0-0,2 | 52 | 7,8% | 17,3% |
| 0,2-0,4 | 42 | 31,8% | 33,3% |
| 0,4-0,6 | 61 | 50,2% | 50,8% |
| 0,6-0,8 | 76 | 72,2% | **39,5%** |
| 0,8-1,0 | 136 | 92,3% | 69,9% |

Brier del modello **0,2592** contro **0,2498** della costante: separa bene (dal 17% al 70%) e **è
sovra-sicuro in alto**, e la banda 0,6-0,8 è addirittura sotto quella 0,4-0,6. Due cose vanno dette
insieme o il numero mente. La prima è che la quota è CONDIZIONATA alla forma («delle partite per cui è
in condizione») e una giornata sola non lo è: qui è stata ristretta ai disponibili secondo il foglio
stesso, che è la correzione che si poteva fare e non l'unica che servirebbe. La seconda è che è **una
giornata**, la prima, con la preparazione addosso e il mercato aperto — la regola di casa vale anche
contro di noi. Quello che resta da guardare alla seconda e alla terza è la banda 0,6-0,8: un'inversione
in mezzo alla scala non è rumore che si spiega da sé.

## 17. IL GESTO E IL FILTRO DELLA TABELLA: quattro difetti che stavano fra il DOM e lo schermo (20 agosto 2026, sera)

Due richieste dell'operatore nella stessa sessione — «l'ordinamento delle colonne sulla tabella tramite
D&D funziona malissimo, riscrivilo da capo in maniera pulita» e «dammi anche la possibilità di filtrare i
risultati per colonna in maniera adeguata» — e la parte che vale oltre questa tabella non è nessuna delle
due funzioni: è che **quattro difetti su sei erano invisibili a ogni misura del DOM**. Il markup c'era, i
conteggi tornavano, e lo schermo diceva un'altra cosa. Tutti trovati guidando un browser vero
(`app/scripts/e2e-table.mjs`), e ognuno ha lasciato la sua asserzione lì dentro.

### 17.1 Il gesto, riscritto — e i cinque modi in cui non funzionava

Il gesto era già NOSTRO dal 18/08 (CDK era stato mandato via perché muoveva il DOM che Angular possiede e
perché il drop tornava con l'indice di partenza; il pacchetto non è più nemmeno una dipendenza).
**CORREZIONE DEL 27/08/2026**: ~~il pacchetto non è più nemmeno una dipendenza~~ - lo è di nuovo, dichiarata
in `package.json`, perché il riordino delle liste della pagina Strategia usa `cdkDropList` (§19.1). Due cose
di questo paragrafo restano vere e una no: CDK sposta davvero il DOM di Angular e su questa TABELLA il drop
tornava con l'indice di partenza; ma l'accusa dei «buchi / disallineamenti», che è quella che l'operatore
aveva visto, **non era sua** - era il `nz-tooltip` qui sotto, e per due giorni è stata attribuita a lui.
Sulla tabella il gesto resta nostro (nessuno ha misurato che cambiarlo convenga); sulle LISTE è di CDK, e
il fotogramma al rilascio è stato misurato lì: zero anteprime, zero segnaposti, zero transform residui. Quello
che «funzionava malissimo» era il resto:

1. **Si lasciava su una COLONNA, e fra due celle non c'è nessuna colonna.** `columnAt` tornava `null`
   oltre l'ultima intestazione, sopra le due fisse e in ogni fessura fra due bordi, e un rilascio con
   `null` non spostava niente: **portare una colonna in testa o in coda — che è quello che si fa — non
   faceva assolutamente nulla.** Ora il gesto ragiona per **VARCHI** (`app/src/app/ui/squad-table/
   column-drag.ts`): ce n'è uno più delle colonne, esistono sempre, e il taglio è sulle **mezzerie** e non
   sui bordi. `withColumnMoved` traduce il varco visibile in una posizione della lista INTERA ancorandosi
   alla vicina di DESTRA, così le colonne spente non si spostano di un posto.
2. **Il segno non diceva DOVE.** Un contorno intorno alla colonna «di destinazione» non distingue «prima
   di lei» da «dopo di lei», che sono due risultati diversi. Ora una barra sul varco, come ombra INTERNA e
   non come bordo: un bordo su una tabella a larghezze fisse ruba due pixel al contenuto e sposterebbe le
   cifre di tutte le celle sotto, cioè disegnerebbe il disallineamento che il gesto deve curare.
3. **Si selezionava il testo** durante il trascinamento — il sintomo che si legge come «si è rotto
   qualcosa».
4. **Il click da mangiare poteva restare appeso.** Il listener era `{once: true}` sulla riga: se dopo il
   rilascio non arrivava un click (rilascio fuori, gesto annullato) restava lì e si mangiava il PRIMO
   click legittimo dopo, cioè un ordinamento che non parte molto più tardi e senza una causa visibile.
5. **Non si poteva annullare**: `Escape` non faceva niente e `pointercancel` nemmeno.

Le funzioni pure hanno il loro test (25 casi fra `column-drag.spec.ts` e `column-filter.spec.ts`), e ogni
caso è uno dei modi in cui non funzionava — non un caso limite inventato.

### 17.2 I quattro difetti che il DOM non poteva vedere

**Un nodo che non è una `<th>` dentro la riga di intestazione si mangia una colonna della griglia, e
questa è la causa vera dei «buchi / disallineamenti».** Per due giorni erano stati attribuiti a CDK.
`nz-tooltip` costruisce il suo componente con la `ViewContainerRef` dell'elemento su cui sta e poi ne
STACCA l'elemento dal DOM, perché il tooltip vero vive in un overlay; Angular però continua a contare quel
nodo fra quelli della vista, quindi quando un `@for` con `track` RIORDINA e sposta la vista, **lo
reinserisce**. Col tooltip sulla `<th>`, il nodo reinserito era un `<nz-tooltip>` figlio diretto del
`<tr>`: il browser gli dà una casella, la riga finisce su **23 colonne contro le 22 del colgroup**, e ogni
intestazione dopo quella spostata sta **84px** a destra dei propri dati — con l'ultima schiacciata a
larghezza **ZERO** (misurato: «Squadra» a 1219px e «Overall» a 1433 invece di 1349). Il colgroup era
giusto, il corpo era giusto, i conteggi erano 22 e 22. Cura: il tooltip su uno `<span>` dentro la cella.

**E un rettangolo dentro la sua cella può essere coperto da un altro elemento.** Messo l'imbuto del filtro
su ogni colonna, **16 intestazioni su 22** lo avevano tagliato fuori dalla propria cella (fino a 32px oltre
il bordo su «Margine», larga 68) — le colonne sono larghe quanto le cifre che portano e allargarle tutte di
22px costerebbe quasi 500px di scorrimento. Tirato fuori dal flusso e appoggiato al bordo destro,
`document.elementFromPoint` sulle sue coordinate rispondeva **`nz-table-sorters`**:
`.ant-table-column-sorters::after` di antd è un `inset: 0` che copre la cella intera. Due difetti diversi
con lo stesso sintomo — un filtro che c'è e non si clicca — e **nessuno dei due visibile a
`element.click()`**, che passa sopra la CSS. Un controllo si verifica con un puntatore vero, alle
coordinate che il browser dichiara, dopo un hover vero.

**...e il PIXEL può essere giusto mentre il markup è sbagliato, per tredici giorni** (3 settembre 2026,
segnalato dall'operatore che leggeva l'avviso nel terminale). `ng build` stampava a ogni corsa un
**NG8011**: `nz-th-addon` ha uno slot suo per l'imbuto (`<ng-content select="nz-filter-trigger">`, dentro
`extraTemplate`), e Angular ci proietta il contenuto di un `@if` **solo se quel blocco ha UN nodo radice**
— l'imbuto e il suo `nz-dropdown-menu` erano due, quindi il blocco intero finiva nello slot di **default**,
cioè dentro il titolo, e l'imbuto non è mai arrivato dove antd lo mette.

**Non si vedeva, e la ragione è che la nostra cura di agosto lo compensava per intero**:
`nz-table-filter` avvolge tutt'e due gli slot in `.ant-table-filter-column`, che è esattamente il
selettore su cui la nostra CSS tira l'imbuto fuori dal flusso e lo appoggia al bordo destro della cella.
Quindi tutte le misure di agosto — 24 imbuti su 24, zero tagliati, `elementFromPoint` sull'icona,
pannello che si apre — erano **vere**, e restano vere: quello che era sbagliato non era il pixel, era il
posto nel DOM. La cura è un `@if` con un nodo radice solo (l'imbuto) e il menu fuori dal blocco con
l'`@if` **dentro** di lui: un `#ref` dichiarato in un blocco non si vede da un blocco fratello, e il menu
non può uscire dalla `<th>` perché un nodo che non è una `<th>` dentro il `<tr>` si mangia una colonna
della griglia — cioè il difetto qui sopra.

Due cose da tenere. **Un avviso del compilatore che nessuna misura conferma non è un falso allarme: è una
misura che non stiamo facendo** — qui l'arnese guardava dove l'imbuto *appare* e nessuno guardava in quale
slot *è*. Ora lo guarda (`funnels().inTitle`). E **un asserto nuovo si prova rimettendo il difetto**: con
il markup vecchio la corsa nomina tutte e 24 le colonne, quindi l'asserto è vivo e non passa a vuoto — la
stessa disciplina che lo stesso giorno ha smascherato un audit che stampava un numero atteso senza
confrontarlo.

**Il primo trascinamento di una pagina funzionava e tutti quelli dopo non facevano niente.** Un `mousedown`
seguito da un movimento sopra del testo fa partire il trascinamento NATIVO di Chromium, che si prende il
puntatore e smette di mandare `pointermove` (manda `drag`). Nessuna misura di geometria, di ordine o di DOM
può vederlo: dal di fuori si legge come «il riordino funziona a volte», che è il difetto più difficile da
inseguire. **Si è visto contando gli eventi che ARRIVAVANO invece di quelli spediti**: `pointerdown` 1,
`pointermove` **2 su 18**. Cura: `selectstart` e `dragstart` spenti dal `pointerdown` (non dalla soglia —
il drag nativo parte prima che noi abbiamo deciso che è un trascinamento) e la selezione rimasta in giro
azzerata, che è proprio quella che rende «trascinabile» il testo sotto il dito.

**E metà delle destinazioni non era raggiungibile**: la tabella chiede ~1900px contro i 1600 di una
finestra, quindi un varco fuori dal viewport non si può scegliere perché il dito non ci arriva. Ora la
pagina scorre da sé entro 60px dal bordo, un passo per `pointermove` — la velocità è quella della mano,
nessun timer da fermare.

**Un errore di misura, e non dell'app.** Il primo tentativo di verificare il varco in coda ha risposto
«non esiste» mentre stava trascinando una colonna FUORI dallo schermo. **Un passo che misura due incognite
insieme attribuisce il difetto a quella sbagliata**: il varco in testa e in coda è una proprietà
dell'ARITMETICA e si misura su una tabella che sta nella finestra (spegnendo le colonne che non c'entrano),
mentre «le colonne fuori schermo sono raggiungibili?» è un'altra domanda e ha il suo passo.

### 17.3 Il filtro per colonna, e le due regole di casa che ripete

`column-filter.ts`, puro e testato, con l'imbuto su **tutte e 22** le colonne — comprese le due fisse, che
è la ragione per cui l'intestazione è diventata **UNA `<th>` ripetuta** invece di diciannove celle quasi
identiche in uno `@switch`: larghezza, allineamento, verso dell'ordinamento e tipo di filtro stanno ora
accanto alla chiave in `SquadColumn`, e il filtro andava aggiunto una volta e non diciannove.

**Non è `nzFilterFn`**, per la ragione già misurata il 18/08 sull'ordinamento: quello filtra `nzData`, cioè
le sessanta righe già caricate, e «FMa ≥ 6,50» avrebbe risposto su un campione riempiendosi poi scorrendo —
una lista mostrata i cui numeri descrivono un'altra lista. Si filtra la lista INTERA, prima di ordinarla e
prima di ritagliarla: misurato **610 → 109**, e il conteggio sotto la tabella lo DICE.

**Tre domande e non una**, perché le colonne portano tre cose: una PAROLA da cercare (il nome, senza accenti
né maiuscole), un ELENCO da spuntare (ruolo, squadra, codici mantra, ruolo reale, gradino di titolarità —
con il conteggio di quanti uomini portano ogni voce, contato su TUTTE le righe perché sulle righe già
filtrate ballerebbe a ogni spunta, e con la sua ricerca oltre la dozzina di voci) e un INTERVALLO di numeri
(tutte le altre, con gli estremi VERI della colonna scritti dentro le caselle vuote — «FMa» va da 4,15 a
7,92, e senza vederlo il primo tentativo è sempre sbagliato).

**E il vuoto è una risposta, non un caso limite.** Metà di questa tabella porta celle vuote per
costruzione, e qui vuoto vuol dire IGNOTO e mai zero: un ignoto **non è «sotto il minimo»** perché non ha
un numero da confrontare, quindi un estremo lo esclude per costruzione, e «solo gli ignoti» è una scelta
DICHIARATA (`blanks`: non conta / con numero / solo ignoti) perché «chi non ha una stagione misurata in
questo listone» è una delle domande vere di un'asta — sono 395 dei 610 quotati sulla MV.

**I filtri si ricordano** come le colonne spente e l'ordinamento (è una preferenza sulla TABELLA, quindi
vale in tutt'e due le viste), e la contro-obiezione è vera e la cura è dichiarata: un filtro salvato è
invisibile, e questo progetto paga da sempre il difetto delle liste che non dicono cosa sono. Per questo
ogni filtro attivo porta la sua **etichetta SOPRA la tabella**, fuori da ogni pannello che si chiude, con
la sua crocetta e con quanti uomini sta nascondendo su quanti; e un filtro su una colonna che una vista
non OFFRE non si applica — nella rosa di un club «Squadra» non c'è, e un filtro per squadra rimasto acceso
la svuoterebbe senza un imbuto da cui togliersolo (misurato: rosa del Napoli, filtro club ignorato, filtro
FMa applicato, 10 di 34).

**Un pannello per colonna e non uno condiviso.** Il contenuto è scritto una volta (`#panelBody`) e ogni
colonna lo istanzia col suo `key` via `ngTemplateOutlet`, ma l'OVERLAY è suo: condividendo un
`nz-dropdown-menu`, passare da un imbuto all'altro **senza chiudere il primo** — cioè quello che fa una
mano — lasciava lo schermo senza pannello, e la pagina urlava `TypeError: Cannot read properties of null
(reading 'classList')`. Il click apre l'overlay SUBITO, dentro il gestore di ng-zorro, quindi per un
istante due `NzDropdownDirective` attaccano lo stesso `TemplateRef` a due overlay e il secondo trova i nodi
del primo già spostati. **Nessun segnale può arrivare in tempo**: la cura è avere due template, che è anche
come lo fa il filtro di ng-zorro. Trovato solo perché l'arnese ha cominciato a raccogliere quello che la
PAGINA urla: un'eccezione ora fa fallire la corsa anche con ogni misura verde.

### 17.4 Che cosa misura la suite, e su quali numeri

`node app/scripts/e2e-table.mjs [--hunt N]` — 19 passi, **nessun problema**, browser vero perché in jsdom
non esistono né il colgroup, né lo scorrimento che carica le righe, né il gesto:

| che cosa | come si vede se si rompe |
| --- | --- |
| allineamento testa/corpo, prima e dopo | scarto in pixel per colonna, più i figli del `<tr>` che non sono `<th>` |
| ordinamento su TUTTA la lista | cima contro massimo del listone dopo aver caricato ogni riga |
| varco in coda / in testa | la colonna ci finisce o no, su una tabella che sta nella finestra |
| Escape a metà volo | «era in mano» + ordine invariato |
| trascinare per l'imbuto | l'ordine non deve muoversi, e nessuna colonna deve risultare in mano |
| eventi che arrivano al gesto | `pointermove` ≥ 10 su 18: sotto, il browser ha preso il puntatore |
| scorrimento sul bordo | `scrollX` 0 → 207 (massimo 195) |
| il click di coda | la chiave d'ordinamento sul disco non deve cambiare |
| imbuti | 22 su 22 presenti, **zero** tagliati, spenti a opacità 0, l'acceso a 1, raggiunto con un mouse vero |
| intervallo | estremi suggeriti veri, tre-vie sugli ignoti, 610 → 109, il conteggio lo dice |
| elenco | «Napoli» spuntato → 34 righe, e in colonna resta SOLO «Napoli» |
| «solo ignoti» | 610 → 215, e ogni cella della colonna è un trattino |
| persistenza | ordine, ordinamento e filtri dopo un refresh, con l'etichetta e l'imbuto accesi |
| l'altra vista | rosa di un club: nessuna colonna «Squadra», filtro club ignorato, filtro FMa applicato |
| ordini SEMINATI (`--hunt`) | un buco che compare qui è della TABELLA, uno che compare solo dopo un gesto è del gesto |
| quello che la pagina urla | qualunque eccezione o errore di console fa fallire la corsa |

**Verificato**: `ng build` verde, `ng test` **351 su 351** in 30 file, la suite e2e senza problemi con tre
ordini seminati, e le tre schermate (`dist/e2e-filtro-numeri.png`, `e2e-filtro-elenco.png`, `e2e-table.png`)
per la parte che un numero non giudica. Nessun `engine_*` toccato: è tutta interazione dell'app.

## 18. I minuti esteri hanno una SECONDA fonte, e solo dentro i sei campionati (25/08/2026)

Dalla domanda dell'operatore su un nome: «Varela del Monza si è dimostrato essere un ottimo calciatore, come
mai non abbiamo nessun suo valore nel db?». Riguarda le stesse colonne del §13 — `est_pv` e quindi
`est_surplus`, `Lead`, `Margine` e Fπ, che sono tutti un prodotto in cui le presenze entrano.

**Il difetto.** `est.presences_from_abroad` (§13 e spec v9.56) converte i minuti di campionato di chi non ha
una stagione qui, e li legge da `external_stats`, che tiene **sei** competizioni: le cinque più il serbatoio.
Chi ha giocato altrove cade quindi sulla costante `unmeasured` — 0,282 × 38 = **10,7 giornate** per un
attaccante — che è la quota di un uomo di cui *non esiste misura da nessuna parte*. Varela ne aveva una: 34
partite di Primeira Liga, 1522 minuti, 6 gol, 238 righe in `tm_appearances`.

**Le due popolazioni su quel gradino, e danno risposte opposte** (leave-one-season-out, criterio
pre-registrato, numeri in `gate-motore-v1.md` §7-duoquadragies):

| popolazione | n | costante | retta | guadagno | vince | esito |
|---|---|---|---|---|---|---|
| buco su un campionato in perimetro | 455 | 0,2886 | **0,2712** | **+6,0%** | 7/9 | **adottata** |
| calcio fuori perimetro | 411 | 0,2448 | 0,2617 | **−6,9%** | 3/10 | **rifiutata** |

**Cosa cambia in app.** Nove righe del foglio Serie A, tutte in fondo alla cascata: Milla `est_pv` da 12,6 a
**24,5** giornate, Schmid 12,6 → 24,8, Cissé A. 13,2 → 19,0, Alhassane 11,7 → 19,0, Correia T. 11,7 → 17,8,
Comert 11,7 → 17,6, Kevin Carlos 10,7 → 16,4, Akpoguma 11,7 → 13,1. Su EuroLeghe **nessuna**, perché quei
nomi li prezza il core. La **fantamedia non si muove**: resta l'àncora, che è quello che il gate preferì a R1
su cinque finestre di sei — quello che un uomo ha fatto altrove predice **quanto gioca**, non **quanto vale**
a voto, e sono due domande già separate.

E la riga dice quale fonte ha contato i minuti (`est_note`: «…counted on transfermarkt's per-match layer
because the season aggregate has no row for him»), per la ragione di sempre: una riga che non sa dire da dove
viene il suo numero non è controllabile contro quella accanto.

**Tre cose per chi legge queste colonne.** Il ripiego non è un canale nuovo ma un **secondo lettore dello
stesso fatto** — stessa quantità, stesso denominatore, stessa retta, zero parametri — e che lo sia è misurato
su 10.580 coppie (differenza mediana **+0,0000**, correlazione **+0,9957**), non supposto. Letto invece come
regola previsionale il braccio adottato **fallirebbe** il terzo comma del criterio (peggiore stagione −2,6%
contro il −2% richiesto), e questo è detto e non nascosto. E **Varela resta a 10,7**: non è una svista
rimasta aperta, è un rifiuto misurato, perché quella retta non ha un termine di livello e legge mezza
stagione di Primeira Liga come mezza di Premier League.


---

## 19. La pagina STRATEGIA: la stessa valutazione, un'altra domanda (26-27 agosto 2026)

Il resoconto per intero sta in **`pagina-strategia-v1.md`**; qui restano le tre cose che riguardano le
LETTURE, cioè il mestiere di questo documento.

1. **Il GAIN non è una colonna nuova, è una delle due che ci sono già, scelta dal TIPO D'ASTA**: il
   `surplus` del foglio con i rilanci, il VALORE (`fm × pv`) in un draft. Misurato, non scelto
   (`metrica-asta-surplus-v1.md` §15-16). Il valore è un totale senza zero — la lezione del §9 di questo
   documento — e lì non fa danno perché il confronto è **sempre dentro un ruolo**: fra due uomini dello
   stesso blocco lo zero che manca è lo stesso.
2. **Le fasce di colore sono le stesse delle buste chiuse**, e non una seconda tavolozza: `ui-gain` coi
   percentili del listone intero, tagliati una volta (`sealed-bid.scaleOf`, estratta per questo). Un verde
   deve voler dire la stessa cosa sulle due pagine, o il colore diventa una frase sulla lista invece che
   sull'uomo.
3. **Il marchio `↓C`** dice che quell'uomo ha un posto più arretrato, quindi in quel blocco è un ripiego.
   È la regola dell'operatore resa LEGGIBILE invece che applicata: applicarla come filtro o come ordine è
   stato misurato e respinto (§25 di `metrica-asta-surplus-v1.md`, con i numeri) — il blocco dei
   trequartisti passerebbe da 256 a **−9** di gain.

E una lezione di questa cartella incontrata di nuovo: **un'impostazione che cambia quello che stai
guardando non si mette dove per vederla devi chiudere quello che stai guardando.** Lo switch delle due
letture sta nella barra sempre a schermo, non nella finestra delle impostazioni; e su classic **non c'è**,
perché là un uomo ha un ruolo solo e non muoverebbe una riga.

### 19.1 L'ordine personale delle liste (27 agosto 2026)

Quarta cosa che riguarda le letture, e nasce da una richiesta: «nei vari blocchi le liste devono essere
riordinabili in modo che posso impostare il mio personale ordine di priorità». Il dettaglio sta in
`pagina-strategia-v1.md` §10; qui la regola che vale per qualunque lista di questa app.

**Una PREFERENZA sopra una MISURA si dichiara, e il modello è un PREFISSO.** Si salva la sequenza dei nomi
che l'operatore ha sistemato, e sotto continua l'ordine misurato: così un nome NUOVO compare in cima alla
parte misurata invece che in fondo alla lista. Salvare la lista intera - la scelta più semplice - metterebbe
un arrivo che il foglio prezza 40 sotto ottanta difensori, cioè invisibile: la stessa famiglia di «vuoto =
ignoto», applicata all'ordine.

**E il confine fra le due metà si DICE**: il numero di posizione dei suoi nomi è in grassetto chiaro, il
blocco porta la crocetta che torna alla misura (e compare solo se c'è un ordine da annullare), la barra
conta i blocchi sistemati. Una lista mezza preferenza e mezza misura che non dichiara dove passa il confine
è la solita lista i cui numeri descrivono un'altra lista.

Il GESTO è **di CDK** (`cdkDropList`), per scelta dell'operatore della sera del 27/08/2026 - e la scelta
riapre una porta che questo documento aveva chiuso: vedi la correzione in fondo a §17.1. Il precedente
contro CDK era per metà sbagliato (i «buchi» erano il `nz-tooltip`, non lui) e per metà su un'altra
struttura (una riga di `<th>` a larghezze fisse contro una lista di `<li>` che scorre), quindi si è
misurato il fotogramma che l'aveva fatto cacciare: a metà volo 1 anteprima e 1 segnaposto, al rilascio
**0 anteprime, 0 segnaposti, 0 `transform` residui**. Il resto tiene: `pointerdown` 1 · `pointermove` 9 su
9 · `pointerup` 1, il nome ancora primo dopo un ricaricamento, la crocetta che rimette la misura.

## 20. LE SEI PAROLE DENTRO IL RUOLO: due assi asimmetrici, e sette nomi come specifica (1 settembre 2026)

**Richiesta dell'operatore**: «dobbiamo fare in modo che ad ogni calciatore venga associata una categoria
(valori da intendere all'interno del suo ruolo)» — oro (gioca sempre e porta tanti bonus: Malen, Dimarco,
Paz), argento (gioca sempre, pochi bonus), bronzo (gioca sempre: Lobotka, Cristante), cristallo (gioca poco
ma quando gioca porta bonus: Dybala, Berardi), scommessa (potrebbe fare bene rispetto agli scarti).

Non ha dato una soglia: ha dato **sette nomi**, e quelli sono la specifica. `engine/categories.py`,
`desc_category` + i due numeri che la decidono (revisione **38** del foglio), `core/categoria.ts` per il
vocabolario e la colonna «Cat.» accanto a «Tit.». REPORTING: nessun gate possiede queste sbarre e
`engine_*` non si muove per una ragione strutturale - nessuna regola legge `bonus_seasons`, e
`evaluate` non vede una colonna `desc_*`. Il `backtest --verify` che lo dice a voce alta è **dovuto e
non ancora fatto**: il 01/09/2026 l'acquisizione teneva il lock di scrittura (il DB è
`journal_mode=delete`, quindi una lettura lunga lo blocca), e un controllo che rompe la corsa che sta
controllando è peggio di un controllo fatto un'ora dopo.

### 20.1 I due assi non sono la stessa specie di numero, ed è tutto il contenuto

- **«gioca sempre» è una PREVISIONE**: `engine_pv_pred / giornate` (con ripiego su `est_pv`), cioè la
  titolarità nell'unico senso di questo progetto. Deve essere la previsione: **Malen ha 18 presenze di Serie
  A**, tutte da gennaio, quindi con le presenze MISURATE (0,47) leggerebbe `cristallo` e il suo primo
  esempio di `oro` cadrebbe.
- **«porta bonus» è un TRATTO MISURATO**: `fm - mv` per stagione, le cinque più recenti che qualcuno ha
  misurato, media troncata da cinque in su. Deve essere il misurato: col tasso **previsto** Dybala legge
  **+0,48**, sotto la mediana degli attaccanti, perché il motore regredisce un tasso che scende (1,72 →
  0,91 → 0,45) — e il suo esempio di `cristallo` cadrebbe. Il suo storico dice **+1,19**.

Le due direzioni sbagliate sono in un test, non in un commento: `test_scambiare_i_due_assi_fa_cadere_i_suoi_stessi_esempi`.

### 20.2 Le sbarre sono ASSOLUTE per ruolo, e p60/p80 è la coppia che riproduce i sette nomi

Sua decisione fra tre alternative: percentili ricalcolati sul foglio, tre fasce uguali, **soglie assolute
per ruolo**. Misurate una volta come p60/p80 del tasso bonus per stagione degli uomini che ogni listone
quotava in quel ruolo, cinque stagioni (2021-22 … 2025-26), una riga per (uomo, stagione) con **pv ≥ 15** —
un tasso su tre partite è rumore, e una sbarra misurata sul rumore è una sbarra sul rumore. La stessa
definizione dà il TRATTO e la SBARRA, quindi stanno su un metro solo.

| | P / por | D | C | A | dc | m | c | t | w | a | pc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| porta bonus (p60) | −1,10 | 0,10 | 0,33 | 0,87 | 0,05 | 0,16 | 0,22 | 0,50 | 0,55 | 0,75 | 1,00 |
| tanti bonus (p80) | −0,93 | 0,22 | 0,57 | 1,25 | 0,17 | 0,32 | 0,40 | 0,71 | 0,77 | 1,06 | 1,39 |

**Perché p60/p80 e non altro, coi numeri**: p90 manda **Malen (1,33 contro 1,54) e Paz N. (0,74 contro
0,77) in argento**, cioè contraddice due dei tre esempi di `oro`; p70/p80 riproduce i sette ma lascia
`argento` largo dieci percentili — **12 uomini su un foglio di 609** — che è una fascia che nessuno legge.
Le sbarre sono stabili nel tempo (p90 di A su sei stagioni: 1,62 · 1,37 · 1,42 · 1,27 · 1,24 · 1,17), ed è
questo che rende onesto scriverle una volta.

**Il portiere ha le sbarre NEGATIVE** (−1,10 / −0,93) perché per lui `fm - mv` è dominato dai gol presi:
«porta bonus» lì vuol dire «prende pochi gol e tiene la porta inviolata», che è esattamente quello per cui
lo compri. Leggerlo dentro il ruolo è ciò che fa sopravvivere la parola al segno.

### 20.3 La sesta parola è sua, e serve perché ogni riga deve averne una

`scommessa` = **chi nessuno ha ancora misurato** (sua scelta fra tre letture: chi si gioca il posto e chi il
mercato quota più di noi sono state scartate — la seconda contro la regola di casa che la quotazione va
ultima). Ma allora chi è misurato, gioca poco e non porta bonus non è né una scommessa né una delle prime
quattro: è lo **scarto**, che è la parola con cui lui stesso definisce la scommessa («potrebbe fare bene
rispetto agli SCARTI»). Sono DUE gradini e non uno: il primo dice che non c'è misura, il secondo che la
misura c'è ed è bassa, e ordinarli insieme perderebbe la differenza che li separa. Consegna, con **zero
righe senza parola** su tutt'e tre i fogli:

| foglio | oro | argento | bronzo | cristallo | scommessa | scarto | righe |
|---|---|---|---|---|---|---|---|
| Serie A classic | 13 | 25 | 57 | 86 | 218 | 210 | 609 |
| Serie A mantra | 18 | 24 | 53 | 88 | 218 | 208 | 609 |
| EuroLeghe mantra | 54 | 42 | 40 | 254 | 335 | 301 | 1026 |

### 20.4 Due cose vere che sembrano difetti, e restano dette

- **Un uomo può leggere diverso su due fogli.** Malen è `oro` su Serie A classic e `argento` sui due mantra,
  perché `pc` è una classe più strettae più forte di `A` (p80 1,39 contro 1,25): è un top-20% fra gli
  attaccanti e non fra i centravanti, che è una frase vera e utile. Lobotka è `bronzo` su Serie A e `scarto`
  su EuroLeghe, perché i due calendari sono due (0,63 di 31 giornate contro 0,72 di 38). Una categoria è un
  fatto su (foglio, ruolo), come il surplus accanto.
- **Il colore è stato RIFIUTATO** anche se le parole sono colori: la regola dell'app è che il colore porta un
  significato e i dati vanno neutri, quindi la scala si legge dal peso come per la titolarità. Si aggiunge
  solo se lo chiede lui.
- **Le sigle sono ORO · ARG · BRO · CRI · SCM · SRT**, e le ultime due non sono la troncatura naturale per la
  stessa ragione per cui `ballottaggio` è `BLT`: `SCO`/`SCA` differirebbero per l'ultima lettera, e sono le
  due parole che dicono il contrario l'una dell'altra. La guardia era scritta prima delle sigle e ha
  **bocciato la prima coppia scelta** (`SCM`/`SCT`, distanza 1), che è esattamente il lavoro di un test.

### 20.5 Il campo nuovo, e la trappola che ha evitato

`features.Observation.bonus_seasons`: la coppia **allineata** per stagione. `fm_seasons` e `mv_seasons` non
lo sono — la seconda scarta le stagioni senza media voto e la prima le tiene — quindi accoppiarle a zip
sposerebbe una fantamedia con la media voto di un'altra stagione. Oggi non sbaglia un accoppiamento su
**7453 righe** con `pv ≥ 15`: che è esattamente la ragione per cui nessuno se ne accorgerebbe quando
comincia.

## 21. LA COSTANZA: una quantità che c'era già e veniva buttata via (1 settembre 2026)

**Richiesta dell'operatore**, nata dentro il lavoro sull'asta a rilanci: «aggiungiamo per tutti i
calciatori un valore *costanza* che indica la quota di partite con voto base ≥ 6». Colonna «Cost.»
(`squad-table`, 58px, filtro a intervallo), quota nuda, dopo «MVa». REPORTING: non entra in nessuna
valutazione e non muove nessun ordinamento, quindi nessun gate la possiede.

**Non c'era niente da misurare, c'era da LEGGERE.** `player-ratings.ts` calcolava già
`blend('consistency')` con `PASS_MARK = 6` e la teneva solo come **coda del tooltip della varianza** —
cioè il numero esisteva, era pesato per stagione e veniva scartato. È la stessa famiglia degli stemmi:
«il dato c'era, nessuno l'ha chiesto». Estratta in `steadyOf(votes)` accanto a `spreadOf`, con
`Steadiness` (`share`, `weight`, `note`) su `PlayerRating` — e il **peso** era la seconda cosa calcolata
e buttata via, che è quella che permette alla cella di dire in grigio «questo numero poggia su poco».

**E LA DISUGUAGLIANZA È LA MISURA, non un dettaglio di trascrizione.** Il 6,0 secco è il voto **modale**
del fantacalcio: il **36,1% di 59.094 voti** di Serie A su cinque stagioni. Quindi «almeno 6» dà **0,658**
e «più di 6» dà **0,297** — scambiare le due non sposterebbe un decimale, sposterebbe la colonna di
**36 punti**. Il regolamento del R-Factor dice «almeno 6» e la colonna dice quello.

**Le tre forme e quella scelta dall'operatore.** Non un riquadro colorato (il colore porta un significato
e questi dati vanno neutri), non la distanza dalla mediana del suo ruolo in cella: la **quota nuda**, col
metro del RUOLO nel tooltip, dove c'è la mediana del suo. La ragione è quella del §9 vista da vicino: le
mediane per ruolo sono P 0,87 · D 0,66 · C 0,66 · A 0,61, quindi un numero crudo confrontato fra ruoli
**premia i portieri per essere portieri** — e dirlo nel tooltip costa una riga, standardizzarlo in cella
costerebbe la leggibilità del numero che ha chiesto.

**Perché nella tabella e non in una valutazione**: misurata come moneta d'asta, la costanza **non può
pagare** — un uomo muove l'R-Factor di **+1,5 punti a stagione** e il modificatore è governato dai buchi
(r = −0,821), e sul codice attuale il termine è addirittura **inerte**, perché il tetto di reparto morde
prima che possa riordinare un'offerta. I numeri sono in
[simulatore-asta-rilanci-v1.md](simulatore-asta-rilanci-v1.md) §8 — dove sta anche il perché il «+2,4»
scritto qui il 01/09 non si riproduce (rilievo 2 della review del 02/09, §13). Quindi la colonna serve a
chi guarda, non a chi calcola: è esattamente la distinzione fra le colonne `desc_*` e `engine_*`,
applicata a una lettura dell'app.


## 22. «OGGI NON GIOCA»: il canale veloce, e la freschezza detta a schermo (3 settembre 2026)

**Due richieste dell'operatore nella stessa sessione, e la seconda esiste per una conseguenza della
prima.** «È assolutamente necessario avere aggiornamenti sugli infortuni in tempo reale ... dobbiamo
recepire anche la notizia di corridoio per alzare almeno un alert»; e poi «ho bisogno di sapere sempre
nell'interfaccia se i dati sono aggiornati ad oggi in maniera evidente».

### 22.1 Il dato c'era, e mancava una riga in una allowlist

Misurato prima di costruire, come impone la regola di casa dopo che una volta ha risparmiato uno scraper
intero. La tabella `availability` — che il modulo `fc_site` riempie dalla pagina *indisponibili* di
fantacalcio.it, ogni giorno, per **tutti e cinque i campionati** — era già nel DB, già nel contratto di
export e già scritta in `data/export/<season>/json/`. Non era nella allowlist `TABLES` di
`app/scripts/pull-bundle.mjs`, quindi l'app non l'aveva mai vista. **Terza istanza** dello stesso difetto
(i campetti il 10/08, la cartella aggiunta all'export e non al pull, e la regola scritta allora vale
identica per una tabella).

**Quanto vale, il giorno in cui è stato collegato**: 114 uomini del listone 2026-27 dati indisponibili —
43 Serie A · 33 Premier · 19 Bundesliga · 13 Liga · 6 Ligue 1 — e **70 di quei 114 non avevano un
infortunio aperto su Transfermarkt**, che è la fonte UFFICIALE che l'app già leggeva. Il 61%
dell'informazione «è indisponibile adesso» esisteva solo lì. McTominay era uno dei 70: `availability` lo
dava `injured` il 03/09, l'ufficiale era fermo a febbraio.

### 22.2 Una TERZA domanda, con la sua soglia

`PlayerStatus.unavailableNow()` non riusa nessuna delle due soglie che esistevano, e la ragione è la
regola che questo progetto paga da sempre: **una soglia presa in prestito da un'altra domanda è un
difetto**. `LONG_INJURY_DAYS` = 45 decide se DISEGNARE un'icona; `sealed-bid.LONG_OUT_DAYS` = 30 decide
se un uomo merita una BUSTA per l'intera tornata; questa decide se schierarlo o comprarlo **per sabato**,
e su quell'orizzonte non conta quanto durerà: conta che oggi è fuori. Due prove, la stampa (veloce) e
l'infortunio ufficiale aperto (lento), e chi porta la prima e non la seconda *è* il caso da cui è nata.

**Una lettura più vecchia di `UNAVAILABLE_FRESH_DAYS` = 3 SPEGNE il marchio invece di mentire**, perché
«non abbiamo guardato» non è «è rientrato». È la stessa distinzione che lo stesso giorno ha fatto
aggiungere `injuries.observed_on` al toolkit — la tabella non sapeva dire se un finestra vuota fosse
un'assenza di infortuni o un'assenza di sguardo, e la risposta viveva nei timestamp di 4.662 file di
cache, cioè fuori dal database.

**E la rilettura è stata fatta, il 03/09 sera tardi**: la camminata ripresa con `--stale-days 1` ha
chiuso **1891 giocatori su 1891** senza un rifiuto, e ora `injuries` legge **35.995 righe tutte con
`observed_on` = 2026-09-03** — «pagine lette fra il 2026-09-03 e il 2026-09-03», che è la frase che
stamattina non si poteva dire. Quanto ha portato, detto per intero perché è piccolo: **9 assenze
cominciate dal 1º settembre, 4 dal 2** — cioè esattamente quello che una pagina letta l'1 non poteva
contenere — e sul listone Serie A **17 uomini con un infortunio aperto, 3 dei quali cominciato dal 1º**.
Il buco era reale e stretto: il valore della cura non è il conteggio di oggi, è che da oggi la tabella
sa dire quando è stata guardata.

### 22.3 VINCOLO e non peso, su tre superfici decisionali

Richiesta successiva: «segnalati nettamente nell'interfaccia e in qualsiasi gerarchia/ordinamento fatto
per prendere decisioni nell'immediato». Applicato come CONSTRAINT e mai come peso — la stessa forma che
la pagina delle buste dà alle tre regole dichiarate dall'operatore — **perché non sappiamo per quanto
starà fuori e quindi non possiamo riprezzarlo**: possiamo solo non proporlo per primo.

| superficie | cosa fa |
|---|---|
| plancia | prima chiave dell'ordine dentro lo slot · verdetto **`fermo`**, quinto stato prima di ogni prezzo · riga barrata in rosso · conto in barra |
| pannello draft | `ranked` ordina per `sinksNow` prima che per valore |
| buste chiuse | `buyable` lo rifiuta, accanto a fuori-rosa e infortunio lungo |

Resta ovunque nella lista col suo prezzo: toglierlo nasconderebbe un fatto, e l'operatore può saperne più
del pacchetto. Il tooltip apre con la ragione — «OGGI NON GIOCA. È in fondo al suo slot per questo, non
perché valga meno» — perché **un vincolo che agisce in silenzio è indistinguibile da un ordinamento
rotto**, e per la stessa ragione la barra della plancia dichiara quanti nomi ha fatto scendere.

**Una tensione dichiarata e non risolta**: la plancia è un'asta, e un'asta iniziale compra per la
STAGIONE. Far scendere un top perché è fuori questa settimana è giusto per «compro per sabato» e
discutibile per «compro per maggio», e la voce di corridoio non dice per quanto — quindi non distingue
mesi da sette giorni. Scelto il comportamento che l'operatore ha chiesto; la variante «scende solo se
l'assenza è lunga o senza data di rientro» è una riga e usa una soglia che esiste già.

### 22.4 La freschezza è a schermo perché la conseguenza è invisibile

`ui/data-freshness`, dentro la barra fissa delle opzioni globali: su ogni pagina, senza aprire niente.
**Due date, due domande, e nessuna si assume** — quando è stato SCRITTO il pacchetto
(`manifest.generated_at`, da lì vengono fantamedia, presenze e surplus) e quando abbiamo GUARDATO la
fonte veloce (l'ultima lettura degli indisponibili, da lì vengono gli allarmi). La seconda cambia ogni
giorno, la prima a ogni export.

**Il colore dice la CONSEGUENZA e non l'età.** Oltre i tre giorni la pastiglia diventa rossa e la scritta
è «allarmi spenti», non «vecchi di cinque giorni»: oltre quella soglia i marchi non compaiono più, e uno
schermo senza allarmi si legge come «non c'è nessuno fuori». Quando è tutto di oggi la pastiglia è
NEUTRA, perché «va bene» non è una notizia. Verificata con un puntatore vero su tre pagine: presente,
dentro la finestra, e `elementFromPoint` al suo centro risponde con sé stessa.

**AGGIORNAMENTO 04/09/2026 — dove una DATA DI RIENTRO esiste, il vincolo lascia il posto a un numero.**
Questa sezione dice «quando non si sa per quanto, si vincola invece di riprezzare», e la condizione di
quella frase e' la parte che conta: dal 04/09 la plancia legge `injuries.end_date` — la data di rientro
STIMATA che Transfermarkt pubblica per uno spell aperto, gia' nel bundle e fino a ieri stampata solo nel
tooltip — conta le giornate del club che cadono prima di quella data, e riduce presenze attese e massima
offerta di quella quota. Il vincolo resta identico per chi una data non ce l'ha, e i due non convivono
mai sulla stessa riga. Anche la deduplica dei due marchi («la stampa lo da' indisponibile» accanto a
«infortunio lungo in corso») e' di quel giorno. Misure, tabella dei casi veri e i limiti dichiarati:
`assistente-asta-v1.md` §36.

## 23. L'ASSICURAZIONE: una formula sola per tutta l'app (4 settembre 2026)

Richiesta dell'operatore, e la sua immagine è la specifica: «se cammino sul ciglio di un burrone sono
quasi sicuro che non cadrò ... ma io voglio evitare anche questo evento raro e cammino distante dal
ciglio 1 metro. Piuttosto che cambiare il toolkit meglio prevedere un "di più" come **assicurazione
implementata solo nell'app**, che comunque deve essere una **formula centralizzata** da usare in ogni
pagina e sezione». `core/expected-play.ts`, letta dalla plancia e dalla strategia.

**TRE PASSI, TRE DOMANDE DIVERSE, e la separazione è metà del valore.**

1. **La BASE.** Il Pa del foglio — ma dove il motore non prezza il suo calcio (`est_basis` ≠ `core`) la
   stima scende sulla costante di ruolo, e lì la board ne sa di più: è **il metro della PLANCIA** («Kolo
   M. e Woltemade sono valutati in maniera molto più realistica sulla PLANCIA ... adottiamo il metro
   della PLANCIA allora»), scritto come `desc_titolarita_play × giornate che restano`. Kolo Muani il
   03/09 leggeva `est_pv` 19,6 su 38 mentre la Juventus lo disegnava titolare con 81 minuti.
2. **La FINESTRA APERTA**, che è un fatto: le giornate del suo club prima del rientro dichiarato
   (`injury-window.ts`). Yildiz ne salta **10 delle 36** che restano.
3. **L'ASSICURAZIONE**, che è il «di più». Misurata sul bundle del 04/09/2026, 533 quotati di Serie A
   senza asterisco su tre stagioni: per stagione-uomo si perdono in **mediana 1** giornata, in **media
   4,93**, al **p75 7**, al p90 15, al p95 22; e sui 330 uomini con almeno due stagioni di storia la
   media delle loro medie è **8,4** contro una media dei loro **massimi di 13,7**. **La stagione brutta
   costa 1,63 volte quella media**, e quel rapporto è il metro dal ciglio: chi ha storia si assicura il
   proprio scarto (peggiore − media), chi non ne ha abbastanza il p75 del listone meno la media = **2,1
   giornate**.

**SI SOTTRAE LO SCARTO E NON IL TOTALE**, perché il Pa del motore contiene già lo sconto della stagione
MEDIA: togliere tutte le giornate perse conterebbe due volte quelle che il motore ha già scontato. E c'è
un tetto dichiarato (`INSURANCE_CAP_SHARE` 0,35 del calendario), per la stessa ragione di
`presence.availability_floor`: una storia brutta è uno sconto, non una sentenza.

**IL FATTORE RIPREZZA IL SURPLUS senza che l'app diventi un motore.** Surplus e valore moltiplicano
entrambi le presenze, quindi scalarli per `expected/base` è la stessa sottrazione detta in fantapunti -
è il numero del foglio con meno giornate sotto, non una seconda previsione. Questo è ciò che soddisfa
«gli infortuni devono pesare di più sul surplus» senza toccare una colonna gated.

**E CHI IL LISTONE NON QUOTA ESCE DALLE LISTE** («Cheddira del Napoli è ridicolo che stia nei primi 60
attaccanti»). Il difetto non era la sua valutazione: **non è quotato affatto** - zero righe in
`listone_quotes` 2026-27 su nessuna delle due piattaforme - ed era in lista perché il foglio si
costruisce sulle ROSE VERE e `buildRosters` aggiunge chi il listone non ha (**70 righe su 602**). La
regola del 03/09 già viva sulla plancia, portata sulla strategia: `PlayerRow.quoted`.

**E DUE CORREZIONI DELL'OPERATORE IL GIORNO DOPO, tutt'e due su nomi** — la prova che una formula si
giudica sui casi e non sulla sua descrizione.

- **«Come mai Malen ha solo 14 Pa?»** L'assicurazione gli leggeva un'**operazione al ginocchio del
  2019-20** (242 giorni = 35,7 giornate), che gli faceva scattare il TETTO sette anni dopo: 26,7 attese
  → 14,1. `seasonLosses` guardava la CARRIERA, mentre tutto il resto del progetto che legge gli
  infortuni usa una finestra recente (`fragilityOf` tre anni, `injury_weights` (1,0 · 0,6 · 0,35) su tre
  stagioni). *La carriera contiene un uomo diverso.* Con la finestra: 4,4 · 1,5 · 0 → 2,4 giornate.
- **«Perché DIAO solo 11 Pa?»** Qui il numero è **vero e resta**: nel 2025-26 ha perso 20,4 giornate in
  tre stop (piede, bicipite femorale due volte) e 9,1 l'anno prima, quindi la sua stagione peggiore sta
  10,6 giornate sopra la sua tipica. Ma la domanda ha trovato un secondo difetto della finestra: la
  **stagione IN CORSO** entrava con il suo zero, e una stagione lunga due giornate non è un'annata sana —
  regalava a chiunque un anno perfetto, abbassando la media e gonfiando lo scarto **proprio su chi sta
  male da sempre** (Kean 6,1 giornate di assicurazione contro 2,1, perché le sue tre stagioni vere sono
  14,3 · 10,3 · 14,8: stare male è la sua normalità, e il motore l'ha già scontata). Ora la finestra sono
  le tre stagioni **COMPLETE**: quello che succede adesso non è un rischio da assicurare, è un fatto, e
  lo toglie già la finestra dello stop aperto — contarlo qui sarebbe sottrarlo due volte.

**E un errore di unità nel FATTORE, trovato da una sua domanda** («perché in strategia Kolo Muani è #27 e
sulla plancia #4?»): il fattore che riprezza il surplus divideva per `base`, che per un uomo con la stima
è il **metro della plancia** (25,9), mentre il suo `est_surplus` è costruito sulle **18,6 presenze del
foglio** — quindi gli faceva SCENDERE il surplus dopo avergli ALZATO le presenze (19,7 → 16,0 invece di
22,3). Corretto: si divide per la `pv` del foglio, e lui passa da #27 a #16. *Il denominatore di un
fattore è la quantità su cui il numero che stai scalando è costruito, non quella che hai in mano.*
Quello che resta del divario è una scelta e non un difetto: la plancia ordina per **max offerta** (la
scala di mercato: FVM 165 = sesto attaccante, quindi primo slot) e la strategia per **surplus**, dove la
sua fantamedia è quasi tutta l'ancora del ruolo (6,85 contro 7,11 di Hojlund e 7,92 di Malen). I primi
tre nomi coincidono; divergono quelli che il mercato paga più di quanto il motore li valuti.

**Un difetto scoperto dalla misura, non dal codice**: con l'assicurazione due centrocampisti sono scesi
sotto `MIN_PLAY_SHARE` e la barra della plancia ha letto «C 2/80» su un tavolo AZZERATO. `progress`
ricavava gli assegnati come `capienza − rimasti`, quindi contava come acquisto un uomo che nel blocco non
era mai entrato. Adesso li **conta**: `capienza − rimasti` e «quanti ne sono stati comprati» sono due
domande diverse, e solo la seconda è quella che la barra fa.

## 24. LE ULTIME PARTITE NELLA CARD: cinque colonne, e le righe che NON si disegnano (5 settembre 2026)

Richiesta dell'operatore, per la card di un calciatore: «le ultime 5 partite della sua squadra. Per ogni
partita: 1) incontro (stemmi delle due squadre con nomi abbreviati e risultato) 2) un'icona che mi indica
se era infortunato | non disponibile | panchina per tutta la partita | minuti giocati (freccetta verde se
è subentrato, rossa se è uscito) 3) voto fantacalcio (o voto sintetico) 4) lista di bonus 5) fantavoto
finale. Compatto ma leggibile.»

**Non è stato costruito niente di nuovo, ed è il punto.** Le celle sono quelle che `PlayersStore` già
costruisce per la tabella di consultazione (`MatchCell`), che di sé scrive: «`MatchQuery` esiste perché
una seconda implementazione di "le ultime partite" sarebbe una seconda risposta a una domanda che questo
store risponde già». Il metodo nuovo è `recent(fcId, platform, want)`, che ATTRAVERSA LE STAGIONI —
`matchTable` risponde su una stagione sola, e alla seconda giornata «le ultime cinque» sono due di
quest'anno e tre dell'anno scorso.

### 24.1 L'unica cosa che mancava davvero: la distinta

`match_ratings.started` e `minutes` sono **NULL su tutte le 62.594 righe** del bundle (l'Excel dei voti
non porta né i minuti né la distinta), quindi le due frecce vengono dal livello per-partita
(`external_match_stats.started`), che è la sola fonte che le abbia. `MatchCell.started` è la colonna
nuova, letta dove le altre.

**E una delle due frecce non è osservabile per tutti.** I minuti sono i SUOI e non l'ora del campo: un
titolare uscito al 63' legge 63, ma un subentrato entrato al 63' legge 27 — e quel 27 non dice affatto
che sia uscito, dice che è entrato tardi. Senza il MINUTO D'INGRESSO, che il per-partita non porta, «un
subentrato è poi uscito?» non ha risposta e la freccia rossa resta spenta. La prima versione la accendeva
(`minutes < 90` per tutti) ed è stata **smentita da un test scritto male apposta**: `on` e `off`
contemporaneamente su un uomo entrato al 60'.

### 24.2 LE RIGHE CHE NON SI DISEGNANO, e le sue tre domande

L'operatore ha portato tre casi, e sono lo stesso caso: «perché Santos o Hojlund mostrano le partite
dello scorso anno mentre Lucca o Neres no?», «perché Kolo Muani o Beto non vedo lo storico?».

Misurato sul bundle, righe di Serie A nei voti:

| | 2025-26 | 
|---|---|
| Hojlund | 33, fino alla 38ª |
| Santos A. | 14, fino alla 38ª |
| Lucca | 16, **ultima la 19ª** (poi 6 di Premier) |
| Neres | 16, **ultima la 18ª** |
| Kolo Muani | **zero** (32 di Premier) |
| Beto | **zero su due stagioni** (38 + 37 di Premier) |

La card cammina le giornate del CAMPIONATO del foglio, e per quei nomi le giornate mancanti finivano in
lista come assenze senza un incontro: tre `??? – ???` in colonna, che si leggono come una card rotta.

**La cura è una regola sullo STATO, non una soglia.** `not_in_league` e `absent` vogliono dire che di lui,
quel giorno, questo campionato non ha nessuna traccia — né una pagella né una distinta — quindi non si sa
nemmeno contro chi giocasse il suo club, né che il suo club fosse quello. Non sono sue partite e non si
disegnano. `bench` e `injured` restano: **una distinta e uno stop datato sono prove su di lui**, e sono
esattamente quello che l'operatore ha chiesto di vedere. Dove non resta niente la card lo DICE («nessuna
sua giornata in questo campionato: le partite giocate altrove non hanno un voto qui») invece di sembrare
guasta.

Resta il caso di chi ha una giornata `injured` senza incontro: lì la riga stampa la GIORNATA e la data
(«33ª · 19/04/2025») al posto dei due nomi. «Vuoto = ignoto», applicato a un tabellino.

**Un difetto trovato per strada, e valeva due righe su cinque.** `seasons()` aggiungeva la stagione
bersaglio FUORI dal `Set` costruito sulle chiavi: se qualcuno ha già giocato una giornata — cioè sempre,
da settembre in poi — quella stagione compariva DUE VOLTE, e chi cammina la lista leggeva le stesse
partite due volte. Sulla card si vedeva a occhio (`Cag 0-1 Int` ripetuta); nel selettore della stagione
della tabella era un doppione silenzioso.

### 24.3 Lo stemma dell'avversario: un join per NOME, e solo per uno stemma

Di un avversario questo progetto tiene il nome del provider e niente che lo identifichi, quindi finora
ogni avversario si disegnava col monogramma. Il nome si normalizza dai due lati con la stessa lista di
parole vuote che `nameWords` usa già per abbreviare (`AC Milan` → `milan`, `SSC Napoli` → `napoli`):
**è l'alias di casa, non una lista nuova**.

Misurato prima di tenerlo, perché un join per nome è il difetto che questo repository paga da sempre: sui
106 club del bundle le chiavi normalizzate sono **106** (zero collisioni), e sulle ultime due stagioni
risolve il **95,2%** delle righe di Serie A (22 avversari su 23) e molto meno altrove — Premier 59,5%,
Liga 34,9%, Ligue 1 21,7%, **Bundesliga 10,9%**, dove il provider scrive `1. FC Köln` e il listone
`Colonia`. Per questo la risposta è `null` e non un ripiego: chi non si risolve resta col MONOGRAMMA, che
è esattamente quello che aveva prima. **Un fatto che decide un numero non passerebbe mai di lì.**

E il monogramma su questa riga è stato sostituito da uno SCUDO grigio su richiesta dell'operatore: lì il
nome del club è già scritto accanto, quindi un monogramma colorato lo dice due volte e per giunta
somiglia a uno stemma vero. È un input di `ui-crest` (`fallback="shield"`) e non un cambio globale: dove
il monogramma è l'unica cosa che nomina il club — il campetto, le tabelle — resta.

### 24.4 I MARCHI DEI BONUS: uno solo, per tutte le pagine

Il vocabolario l'ha dettato l'operatore: pallone per il gol (verde fatto, rosso autogol), scarpetta per
l'assist, bersaglio per il rigore (verde segnato, rosso sbagliato), rettangolino giallo per
l'ammonizione e rosso per l'espulsione, una x in un cerchietto per il gol subito, un check per il rigore
parato. E la condizione: «assicurati che le icone abbiano lo stesso significato in ogni pagina della
piattaforma».

Quindi `ui/bonus-mark` è **un componente**, letto dalla riga compatta E dal pannello grande
(`ui/match-detail`), e sceglie il marchio su un `kind` dichiarato (`core/match-bonuses.BonusKind`) e mai
sull'etichetta: due pagine che leggessero il testo finirebbero per dipingere due cose diverse il giorno
in cui una delle due frasi cambia parola. Il conto dei bonus se n'è andato dal pannello a
`core/match-bonuses.bonusesOf` per la stessa ragione — due conti sugli stessi eventi darebbero a una
partita due fantavoti.

Il pallone e la scarpetta sono SVG scritti in casa: il set di antd non li ha, e un'emoji come icona
questo progetto non la usa.

### 24.5 Il verde sopra il sei, e il chevron sulla linea

«Nelle ultime partite mostrami i fantavoti > 6 in verde», poi «anche i voti». Il sei non è una soglia
scelta: è la sufficienza del gioco (`PASS_MARK`), la stessa da cui la plancia conta. I sette restano più
marcati, così la colonna distingue ancora «bene» da «benissimo».

**Una definizione, tre lettori** (`vocabulary.voteInk`): la cella della tabella di consultazione, il voto
della riga e il fantavoto della riga. Due fasce diverse sullo stesso voto sono come lo stesso uomo
finisce con due pagelle — e il prezzo è dichiarato: **anche le celle della tabella Calciatori ora sono
verdi sopra il 6** invece che `primary` sopra il 7.

Il chevron apre l'elenco «fino all'header», carica **due stagioni** e lascia la card **delle stesse
dimensioni** con una barra di scorrimento. Quindi non è una card che cresce: è lo spazio di sopra che
viene prestato all'elenco (i due numeri grandi, il prezzo e le statistiche si chiudono). «Stesse
dimensioni» è una misura e si misura: l'altezza si legge dal rettangolo che il browser dichiara **nel
momento del click** e si pianta lì — un'altezza fissa scelta a mano sarebbe troppa per un portiere senza
note e troppo poca per un infortunato con due avvisi in cima. Verificato: **288×420 → 288×420**, partite
5 → 40, `scrollHeight > clientHeight`.

Il bottone sta **al centro della linea**, a cavallo del bordo e fuori dal flusso: è la maniglia di quel
confine, e il fondo della card sotto interrompe la riga dietro di lui — il taglio è quello che lo fa
leggere come una maniglia e non come un'icona appoggiata lì.

**E due difetti dell'ARNESE, che valgono quanto quelli del codice.** Il passo cercava il contenitore
delle partite come «il primo div che contiene una partita» e prendeva il riquadro INTORNO all'elenco, che
non scorre: accusava di non scorrere una lista che scorre. E chiedeva che sotto il chevron ci fosse un
`button`, mentre al centro di un'icona c'è un `<svg>` — che è SUO. *Un passo che misura l'elemento
sbagliato accusa il codice del proprio difetto*, e la forma giusta è chiedere al bottone
(`button.contains(under)`), non al nome del tag.


## 25. TUTTO IL CALCIO CHE HA GIOCATO: la card che smette di guardare un campionato solo (5 settembre 2026)

Sette richieste dell'operatore in fila sulla stessa card, tutte nate da una: «il toolkit genera dei voti
sintetici dove non ci sono valutazioni normali, vorrei che questi voti siano utilizzati anche dall'app per
ricostruire lo storico del calciatore anche quando ha giocato fuori dalla serie A. Nelle "ultime partite"
dobbiamo sempre mostrare cosa ha fatto, non mi basta vedere la data della partita.» Con l'esempio: «mi
aspetto che per Kolo Muani una cosa del genere con le partite di maggio 2026 dove giocava per il tottenham
e non per la juve.»

### 25.1 I dati c'erano; a non guardarli era la lista

**Il bundle porta già le 32 partite di Premier League di Kolo Muani col Tottenham**, con avversario, campo,
minuti, rating e data. `PlayersStore.recent` camminava solo le giornate del campionato della piattaforma,
quindi la card diceva «nessuna sua giornata in questo campionato» a proposito di un uomo che quella
stagione l'aveva giocata intera. `seasonMatches` fonde ora **tre sorgenti** — i voti, le assenze (con la
loro ragione) e le altre competizioni — **in ordine di DATA e non di giornata**, perché mescolando i
campionati la giornata non è più un asse: la 38ª di Premier e la 3ª di Serie A stanno in due calendari.

**E un campionato straniero non è una coppa.** `buildOtherMatches` lo archiviava come `cup` e lo diceva di
sé («another country's league is not a cup»); nessuno lo leggeva, quindi il travestimento era gratis. Ha
smesso di esserlo il giorno in cui la card ha cominciato a disegnare quelle righe: `synth` calibra la retta
su **esattamente quei cinque campionati** e su nessun altro, quindi «questo numero è sulla scala del
fantacalcio?» si risponde lì. Da qui `MatchKind = 'league' | 'other_league' | 'cup' | 'friendly'`.

**Il difetto che ne è uscito è nel VOCABOLARIO**: `voteText` e `voteClass` decidevano guardando `kind` e non
il voto, quindi su una riga che vale `~5,9` (la nostra scala) stampavano `*6,7` (quella del provider). Erano
la stessa domanda finché solo il suo campionato poteva portare un voto; da quando il layer per-partita porta
il sintetico anche degli altri quattro sono due, e leggere la seconda al posto della prima è un errore di
scala. Ora l'ordine è: il voto se c'è, `s.v.` nel suo campionato, il rating marcato `*` altrimenti.

### 25.2 Lo stemma della squadra di QUELLA partita, e un indice largo la metà

«Quando un calciatore giocava per un'altra squadra mostri lo stesso lo stemma della squadra corrente.» Vero,
e **più largo dell'esempio**: la riga riceveva l'id del club di OGGI, quindi non solo le partite del
Tottenham portavano lo stemma della Juventus — lo stesso capitava dentro la Serie A a chiunque avesse
cambiato squadra, su tutte le giornate della stagione passata.

Cercando la cura è saltato fuori che **l'indice degli stemmi era costruito sulle ROSE** (i club con almeno
un quotato: **47 chiavi**) mentre il commento accanto citava la misura fatta **sui 106 club del bundle**
(«le chiavi normalizzate sono 106, zero collisioni»). Commento e codice descrivevano due indici diversi:
«verifica la FUNZIONE, non la colonna che le somiglia», applicato a se stesso. Allargato alla tabella intera:

| | prima (47 chiavi) | dopo (106) |
|---|---|---|
| club di una riga di CAMPIONATO (`match_ratings.team`) | 90,1% | **100%** |
| club del layer per-partita (`external_match_stats.club`) | 48,4% | **61,3%** |

Nessuna riga in più nel bundle: la tabella era già in casa. **Nessun ripiego sul club di oggi**, perché uno
stemma sbagliato dice una cosa falsa mentre uno scudo grigio dice quello che è. Il 39% che resta è un
problema di ALIAS (il provider scrive `Tottenham Hotspur`, il listone `Tottenham`; `Hellas Verona` contro
`Verona`; `FC Barcelona` contro `Barcellona`) e la lista degli alias vive nel toolkit
(`matching.CLUB_ALIASES`): rifare quel join in un browser è il join che una volta ha perso Milan, Roma e
Napoli. **Resta aperto**, ed è un lavoro di toolkit — e nemmeno `club_key` basta da solo (63,9%): servirebbe
l'identità del club dal provider, cioè `club_xref`.

### 25.3 Una riga che si può dipingere: `display: contents` contro `grid-cols-subgrid`

«Evidenziare la riga in maniera molto leggera» quando giocava altrove. L'ospite di `ui-match-line` era
`display: contents` — nessun box, le cinque celle figlie DIRETTE della griglia della card, che è quello che
tiene allineate le colonne da una partita all'altra. Il prezzo è che **una riga così non esiste come
elemento**: non si può evidenziare, e dipingere le cinque celle una per una lascerebbe scoperti i 6px di
`gap-x`, cioè una riga a strisce, che si legge come un guasto.

`grid-cols-subgrid` risolve entrambe le cose: l'ospite è una casella che occupa tutte le colonne e le sue
celle continuano ad allinearsi alle piste della card. **Ed è misurato invece che sperato**: il banco legge
la `x` di ogni cella riga per riga — 5 colonne su 50 righe, **0 disallineate**.

**L'attenuazione delle coppe e delle amichevoli (0,5 di opacità) sta sulle CELLE e non sull'ospite**, perché
`opacity` si moltiplica lungo l'albero: sull'ospite spegnerebbe a metà anche il suo sfondo, cioè
l'evidenziazione «altrove» che può cadere sulla stessa riga (una coppa giocata con la squadra di prima è
tutt'e due le cose). Un campionato STRANIERO resta pieno, e la distinzione è sostanziale: quello è calcio
che il fantacalcio saprebbe votare — infatti porta il sintetico — mentre una coppa non è una competizione
calibrata e tutto quello che ha è il rating del provider.

### 25.4 I divisori, e il caso che la richiesta non copriva

«Metti un divisore (simile a quello con l'anno della stagione) per indicare il cambio di squadra.» Fatto in
`cardRows`, che decide DUE annunci e non uno — chi si trasferisce lo fa quasi sempre fra due stagioni,
quindi i due divisori cadono sulla stessa riga e si stampano tutt'e due. Due regole ci sono volute: il club
si confronta sulla **chiave normalizzata** (i voti scrivono `Milan`, il layer per-partita `AC Milan`), e una
riga **senza squadra non è un cambio di squadra** (un infortunio non porta nessun club, e leggerlo come un
trasferimento stamperebbe due divisori attorno a ogni giornata saltata).

**Il caso scoperto:** per Beto **tutte** le 46 righe sono dell'Everton mentre il foglio lo dà alla
Fiorentina, quindi di «cambio» dentro l'elenco non ce n'è nessuno e la card evidenziava quarantasei righe
senza mai dire di quale squadra fossero. Cura: `cardRows` parte dal club di OGGI invece che da «niente»,
così la prima riga si annuncia da sé se già non è la sua squadra attuale.

### 25.5 I mezzi punti, e un fantavoto che si può sommare

«Mostra i voti sintetici arrotondati sempre a 0,5 e calcola e mostra il relativo fantavoto sintetico
aggiungendo i punteggi dei bonus al voto sintetico.» La richiesta ha un numero dietro, misurato prima di
implementarla: **57.925 voti veri su 57.925** stanno sulla griglia dei mezzi punti, e altrettanti fantavoti.
Un sintetico che legge `5,88` scrive quindi una cifra che il fantacalcio non pubblica mai. Il prezzo è
dichiarato: arrotondare sposta il numero di **0,129 in media** (0,25 al massimo) contro i **0,37** di errore
per partita che la retta di `synth` ha di suo — un terzo del rumore che c'è già. L'arrotondamento sta nello
STORE e non nella vista, perché il fantavoto si somma a quel numero e la riga deve tornare.

`syntheticFantavoto` vale **solo dove il voto è sintetico** (dove la fonte pubblica un fantavoto, quello è
il fantavoto) e usa la stessa `bonusesOf` che disegna i marchi, quindi la somma e i simboli accanto non
possono contraddirsi. Cosa si può sommare, misurato: i gol **100%**, gli assist **99,25%**, i cartellini per
niente — quindi il numero è **ottimista di ~0,06** e lo dice.

**E il bonus porta inviolata NON si somma, perché la fonte non lo somma**: su 1.222 portieri a porta
inviolata il fantavoto pubblicato è `voto + bonus` senza premio in **1.218** casi (e i 2.613 che subiscono
tornano 2.586 volte). È un modificatore di lega, non un termine della riga.

### 25.6 I gol subiti di un portiere: la premessa giusta e il caso raro sbagliato

«Per le partite sintetiche dei portieri, segna i gol subiti (li prendi pari pari ai gol segnati nella
partita dall'avversario) ... la rarità di un tale evento è così rara che possiamo tranquillamente ignorare
questi casi», riferito al portiere uscito prima del gol.

**Quel caso è davvero raro; quello che non lo è è un altro.** I gol dell'avversario si contano dalle righe
di quella partita che abbiamo in casa, e le righe esistono solo per chi sappiamo identificare: fuori dalla
Serie A il marcatore avversario spesso non è nel perimetro. Numeri in spec «Novità v9.73» — 95,1% di
ricostruzioni esatte sulla Serie A, **72,5%** all'estero, errore medio **−0,325 gol**, cioè il fantavoto di
un portiere sintetico è ottimista di circa un terzo di punto.

Implementato come chiesto, con il limite scritto accanto e la causa curata nel toolkit (`download_round`
scartava il risultato che il payload porta). La condizione nel codice è sul **DATO e non sul ruolo**: un
portiere di cui non si sono potuti contare i gol subiti non prende nessun fantavoto sintetico, perché
sommare il resto gli darebbe fantavoto uguale al voto — una promessa che nessuna sua partita mantiene.

### 25.7 Lo spazio ai bonus: stringere non bastava

«Stringi un po' stemmi squadre e risultati e lasciamo un po' più di spazio alle icone dei bonus.» Stretti
(`ui-crest size="xs"`, 16px, e le colonne interne da 9,75 a 7,7rem) — e non è servito a niente, perché la
cella dell'incontro era **`1fr`** e i bonus **`auto`**: lo spazio liberato restava dentro l'incontro. Il
difetto era nella griglia della card, non nelle sue colonne interne. Invertite (`auto auto auto 1fr auto`),
la colonna dei bonus passa da 12 a **38-42px** e nessun nome viene tagliato.

### 25.8 Il riepilogo di stagione, e la stagione che si carica

«Quando scrollo al termine della stagione scorsa, mostra un tasto per caricare anche la stagione
precedente» → il tasto sta IN FONDO all'elenco (che è esattamente «quando scrollo al termine») e **nomina la
stagione che caricherebbe**, presa da `seasonsWith` — lo stesso elenco su cui `recent` decide dove fermarsi.
Chiedere al bundle «qual è la stagione prima» avrebbe offerto un tasto che carica zero righe per chiunque
abbia saltato un anno: qui una stagione esiste solo se ha prodotto qualcosa. Quando non ce n'è più il tasto
sparisce, invece di restare spento.

«Sotto la riga della stagione, aggiungi incolonnate correttamente minuti medi a partita | mv | gol fatti e
assist fatti | fm a partita» → `seasonTotals`, e le quattro quantità cadono **esattamente sulle quattro
colonne che una riga di partita ha già**, quindi il riepilogo non è una tabella nuova: è la stessa griglia
letta per stagione. Tre decisioni:

- **La popolazione è il CAMPIONATO** (suo o di un altro paese), non tutto quello che l'elenco disegna:
  coppe e amichevoli sono le righe attenuate perché non entrano nel fantavoto e non hanno un voto, e mettere
  i loro gol accanto a una media di voti che li ignora darebbe quattro numeri che non parlano degli stessi
  novanta minuti.
- **Ogni media ha il SUO denominatore**: i minuti si dividono per le partite di cui si conoscono i minuti,
  il voto per quelle che hanno un voto, il fantavoto per quelle che hanno un fantavoto.
- **In prima colonna il conto delle partite**, perché il riepilogo descrive la stagione INTERA (letta dallo
  store) mentre le righe sopra possono essere cinque: senza il denominatore, tre righe e una media di
  diciotto partite si leggerebbero come la stessa cosa.

Limite dichiarato: il riepilogo sta **solo sotto un divisore**, quindi la stagione in corso non ce l'ha —
è la lettura letterale della richiesta, e i suoi numeri stanno comunque in cima alla card.

### 25.9 Il banco, e i cinque modi in cui ha sbagliato lui

`app/scripts/e2e-player-card.mjs` guida la plancia vera, apre una card e verifica **contro il bundle**:
partite di un altro campionato riconosciute, voto e minuti attesi, scala dichiarata (`~` / `*`), stemma del
club di quella partita, incolonnamento, opacità delle coppe, griglia dei mezzi punti, fantavoto risommato
dagli eventi, divisori, riepilogo ricalcolato, larghezza della barra, tasto della stagione. L'uomo si
sceglie DAI DATI (quello con più partite fuori dal suo campionato) e non da una lista scritta a mano.

Cinque difetti erano **suoi**, e sono la parte che vale:
- **`display: contents` inganna chi legge la griglia**: i figli sono i COMPONENTI e non le celle, quindi
  leggerne cinque alla volta impacchettava cinque partite in una riga sola.
- **Un indice costruito su meno di quello che lo schermo disegna sbaglia ad attribuire**: «Tot 1-2 Ast» di
  FA Cup finiva sulla partita di PREMIER fra gli stessi due club, e il banco accusava la pagina di stampare
  numeri sbagliati mentre stampava quelli giusti di un'altra partita.
- **L'uomo identificato col PRIMO nome che è sottostringa della riga**: «Sanchez Ro.» prendeva l'id di un
  altro Sanchez, e il riepilogo «non tornava». Si prende il più LUNGO.
- **La griglia dei mezzi punti pretesa anche dal rating del provider**, che sta su un'altra scala.
- **Il riepilogo letto come un divisore di stagione**, che avvelenava l'attribuzione di ogni riga sotto.

E due che valgono come regola: i due club di una riga si leggono **separati** e non da una stringa unita (in
mezzo c'è il risultato, quindi `Bou-Eve` non compare mai nel testo), e il file di uno stemma si legge per
`ui-crest` e non per posizione delle `<img>` — un club senza stemma non ne disegna nessuna, e quello di
destra scivolerebbe a sinistra.

### 25.10 Lo stato: cosa è verde e cosa resta aperto

Verificato in un WORKTREE su HEAD più i soli file miei (l'albero condiviso non compilava per la metà
dell'altra sessione, `valuation-store.riser*`): build pulito, **728 test app**, **674 toolkit**, e i dieci
banchi e2e verdi. Corsa toolkit fatta: `synth` → `export` → `data:pull`.

Aperti, con il loro numero:
- **Gli alias dei club** per lo stemma del layer per-partita: 61,3% risolto, e la cura è `club_xref` nel
  toolkit (§25.2).
- **I cartellini** non esistono in `external_match_stats` (0 su 352.754): il fantavoto sintetico è
  ottimista di ~0,06 finché non vengono acquisiti.
- **Il risultato delle partite di campionato** si riempirà giornata per giornata man mano che i turni
  vengono riscaricati (la cache non lo porta): fino ad allora i gol subiti di un portiere estero sono
  ricostruiti al 72,5%.
- **Il riepilogo della stagione in corso** non c'è, per lettura letterale della richiesta.

## 26. UNA PROMESSA SI RICONOSCE DALLA MAGLIA, NON DAL PREZZO: quattro letture su un'icona (5 settembre 2026)

Nata da tre domande dell'operatore in fila — «l'anno scorso Palestra era già considerato un top?», poi
«riesci a trovare qualche metrica che lo distingueva cercando anche nelle stagioni precedenti?», poi
«non riusciamo a pronosticare quali calciatori con basso FVM possono avere un exploit come Palestra?» —
e finita in un marchio che **esisteva già** e aveva due buchi.

### 26.1 Il caso: nessuno lo considerava un top, e nemmeno noi

Qt.I **3** sul listone Serie A 2025-26 = **145° difensore su 232**; Qt.A rivista a 16 e FVM finale 75, che
è il **2° difensore del campionato** dietro Dimarco. Esito: 37 presenze su 38, FM 6,43, **238 fantapunti,
4° difensore**. Il foglio retrodatato al 05/09/2025 (`SHEET_REVISION` 37) dice che il motore non lo
prezzava affatto — `engine_unpriced_reason` «only 7 votes of 15» — e il ripiego dava `est_pv` **16,5 su
38** (135° su 231) col gradino **`riserva`** e `desc_expected_minutes` 300 per tutta la stagione.

Quanto è raro: nella fascia ≤3 crediti (88 difensori) la mediana di stagione è **33,8 fp** e lui è il
primo degli 88, cioè **+5,4 punti a giornata** sopra il compagno di fascia tipico. Ma non è un unicum —
nei primi 19 ci sono Tiago Gabriel (Qt.I 1), Terracciano F. (2), Canestrelli (3), Veiga D. (1) — e lo
Spearman fra Qt.I e fantapunti sui difensori è **+0,492**: il prezzo di agosto spiega meno di un quarto
dell'ordine finale.

**Due avvertenze sulla riga retrodatata**, perché sono contaminazioni dichiarate: `fvm_reporting_only` 75
è l'ultima lettura (post-stagione), e `desc_transfer_fee` 57M è l'Atalanta→**Chelsea del luglio 2026** —
i fogli retrodatati derivano trasferimenti e arrivi *oggi*, quindi conoscono un mercato che allora non
era chiuso.

### 26.2 I segnali pre-asta esistono e sono TROPPO DEBOLI per averlo segnalato

Screen su **6 stagioni**, difensori di Serie A con Qt.I ≤5 e <15 voti l'anno prima = **636 uomini**, 26
esplosi (primi 30 del ruolo) e 97 titolari (≥25 presenze). Quintile alto contro base:

| segnale disponibile prima dell'asta | copertura | lift «esplode» | lift «titolare» |
|---|---|---|---|
| rating Sofascore nel campione sottile | 39% | 1,67× | 1,13× |
| valore di mercato assoluto | 82% | 1,44× | 1,33× |
| valore di mercato ×N in 24 mesi | 67% | 1,39× | 1,24× |
| xA nel campione sottile | 18% | 1,27× | 1,51× |
| posizione media misurata `avg_x` | **8%** | 2,67× | 1,23× |
| **essere giovane** | 65% | **0,25×** | 0,54× |

Il 2,67× dell'`avg_x` è **2 casi su 9**: copertura 8%, nessuna potenza, non è un risultato. E l'età va
nella direzione opposta all'intuizione, che è la stessa cosa che il gate aveva già misurato rifiutando
quel canale. Palestra dentro la sua fascia era 4°/65 per moltiplicatore di valore (×17,5: 200k nel luglio
2023 → 3,5M nel giugno 2025) e 3°/42 per `avg_x` — ma **lo screen che unisce i due non funziona**:
«≤21 anni e valore ≥5×» dà 30 uomini in sei stagioni e **1 esploso su 30 contro una base del 4,9%**.

**E la prova esterna concorda**: la stampa lo aveva nominato (FantaMaster 26/08/2025 «scommessa
low-cost», 3 stelle, 1-5 crediti; Goal.com fra 5 «possibili sorprese»; FantaCalcioPedia «solidità
dell'investimento 40%»), mai come un top — e nei «7 difensori low cost da prendere» del 03/09/2025 **non
c'è**, citato solo come «non metterà a rischio la titolarità di Zappa». Quei sette hanno reso 104-184 fp,
lui 238. Il meccanismo che la stampa aveva in mano era vero e non era su di lui: **«prende il posto di
Zortea»**, e Zortea al Cagliari 2024-25 è Qt.I 7 → 35 presenze e 231,5 fp, l'anno prima a Frosinone Qt.I 3
→ Qt.A 16. Era una previsione su un POSTO.

### 26.3 Il segnale forte non è pre-asta: sono le giornate già giocate

Stessa popolazione, allargata a tutti i ruoli (2.124 quotati con Qt.I ≤5 su 6 stagioni):

| titolare nelle prime 2 giornate | n | esplode | titolare | mediana |
|---|---|---|---|---|
| 0 su 2 | 1668 | 0,7% (0,19×) | 7,5% | — |
| 1 su 2 | 207 | 7,7% (2,19×) | 33,3% | 108,0 fp |
| **2 su 2** | 249 | **19,3% (5,46×)** | **53,4% (3,47×)** | **148,5 fp** |

Positivo **6 stagioni su 6**, e **non è l'effetto delle promosse** (promossi 19,8% contro 19,0% di chi era
già in A) — che era la prima cosa da escludere. La curva è monotona in `k` (1 → 4,13×, 2 → 5,46×, 3 →
6,65×, 4 → 8,03×, 5 → 8,88×), quindi il marchio si rafforza da sé e non serve una soglia nuova ogni
settimana. **Metà del lift è «gioca», che è ovvio e invisibile su 600 righe**: dentro la popolazione dello
screen esistente — che pretende già 90 minuti nelle prime due — il segnale vale 1,16×, e va detto.

### 26.4 Il marchio esisteva, e i suoi due buchi

`starter_signs` «Dato per riserva, gioca da titolare» (14/08/2026, 76,8% contro 42,3%; portiere 81,9%
contro 22,3%). Non ne è stato aggiunto uno nuovo: `promise` = «Possibile promessa» è già preso da un
altro screen (xG+xA, 1,89×), che è un fatto diverso.

- **Taceva prima della 4ª giornata** (`RISER_FROM` = 4): zero righe su 602 sul foglio del 05/09, per
  costruzione — il posto peggiore in cui un buco possa nascondersi, e la finestra in cui si compra.
- **Si disegnava solo in `/auction`**: lo registrava il pannello d'asta e non `ValuationStore`, quindi in
  plancia e in Strategia non è mai comparso. Terza istanza della cartella aggiunta all'export e non a
  `pull-bundle`: il dato c'era, non lo leggeva nessuno.

### 26.5 Quattro letture su un'icona sola, e la cascata è il «consolidare o ripensarci»

L'istruzione dell'operatore che ha deciso la taratura: «se lo scopo è individuare calciatori come Palestra
allora dobbiamo tarare i limiti in modo che Palestra sarebbe rientrato l'anno scorso». **Non è allargare
un criterio perché una regola ci è caduta**: quella regola riguarda l'ADOZIONE di una regola, e qui è la
POPOLAZIONE bersaglio a essere ridichiarata — il che impone di rimisurare, non di allentare.

| `desc_riser_watch` | quando | cosa legge | n/stag | precisione | base | lift |
|---|---|---|---|---|---|---|
| `preseason` | agosto | 2 delle ultime 3 giornate scorse **+ valore raddoppiato** | 41 | 48,8% | 29,8% | **1,64×** (6/6) |
| `rising` | dalla 2ª | ha cominciato l'**ultima** con 60′+ **+ valore raddoppiato** | +11 | 59,3% | 33,4% | **1,78×** |
| `early` | 2-3 giornate | la regola piena su finestra corta | — | — | — | 1,86-2,09× |
| `yes` | 4+ giornate | 80% di titolarità, 65′ di media | 86 | 72,2% | 31,9% | **2,26×** |

**Perché Palestra sfuggiva a tutte**, contato invece che dedotto: non convocato alla 1ª, titolare alla 2ª
(83′), **panchina alla 3ª** (35′), titolare da lì in poi. La media della finestra legge 41,5′ a due
giornate e 59,6′ a cinque, sotto il pavimento di 65 in tutti e due i casi — la regola piena lo raggiunge
solo alla **6ª**. È il «lento» che il commento dello screen dichiarava già come suo buco noto (Douvikas),
incontrato una seconda volta.

**IL PAVIMENTO DELLA FASCIA È STATO TOLTO, E NON ERA UNA CONCESSIONE.** Il bordo basso (30° percentile,
«sotto è un riempitivo le cui quattro buone partite sono una coppa») era DICHIARATO e mai passato al
setaccio. Al setaccio costa precisione zero e **compra lift**, perché sotto il 30° diventare titolare è
più raro e la stessa precisione sta contro una base più bassa: 30 → 392 segnalati, 73,0%, base 37,9%,
**1,93×** · 20 → 409, 73,1%, 36,2%, 2,02× · **0 → 428, 72,2%, 31,9%, 2,26×**. Monotono su tutto lo sweep,
quindi è una tendenza e non una cella, e non allaga niente: **+7 uomini a stagione**.

**LA CONTROPROVA CHE TIENE IN PIEDI IL TERMINE DI MERCATO**: da solo il valore raddoppiato vale **1,22×**.
Il lavoro lo fa «come ha finito» / «ha cominciato l'ultima», e i due non contano lo stesso fatto. Il
filtro non è pescato lì per lì — era stato misurato lo stesso giorno, indipendentemente, a 1,85× dentro
la cella «una titolarità su due» — e due letture che non avevano ragione di concordare concordano.

**Il prezzo dell'istruzione è detto**: la cella stretta della pre-stagione (4 delle ultime 5 + rivalutato)
legge **1,86× su 30 uomini** e NON raggiunge Palestra; quella adottata 1,64× su 41. E la stabilità per
stagione del `rising` è 4 su 5 a due giornate (una a **0,87×** su 10 uomini) e 5 su 5 a tre, su campioni
di 6-19: la stagione negativa è 3 successi su 10 e sta dentro il rumore di un campione così.

**IL MARCHIO LAMPEGGIA, ed è una scelta**: `rising` parla dell'ULTIMA giornata, quindi un uomo messo in
panchina la settimana dopo lo perde e lo riprende quando ricomincia — che è quello che la frase dice. La
variante che non lampeggia («una delle ultime due») lo prende a ogni finestra e diluisce la lettura a
1,42-1,54×, cioè paga un quinto del lift per evitare un'icona che dice la verità.

### 26.6 Verificato chiamando la funzione, sull'agosto vero

Non sulla colonna che le somiglia. `starter_signs` con la finestra del **15/08/2025** accende **56 uomini
su 663 quotati (8,4%)** e Palestra è dentro. Segnati contro la stagione vera: **39,3% ha poi iniziato metà
campionato contro il 26,2% della fascia — 1,50×**, con in cima Da Cunha 248,5 · Esposito Se. 248,5 ·
Pellegrino M. 238,5 · **Palestra 238,0** · Castro S. 235 · Adopo 222,5 · Atta 222 · Frendrup 218 ·
Delprato 216 · Idzes 208,5.

### 26.7 Le AMICHEVOLI: misurata la copertura prima di costruire, e la risposta è «non ancora»

Richiesta dell'operatore: «anche se hanno meno validità, teniamo conto anche delle partite amichevoli
prestagionali». `club-friendly-games` copre **20 club di Serie A su 20 solo per il 2026-27**; per le due
stagioni precedenti sono **2 e 4**, perché quel livello è stato acquisito quest'estate. Quindi **nessuno
screen che le legga è verificabile su una stagione passata**, e un marchio senza verdetto dietro è la cosa
che qui non si spedisce. Viaggiano nella FRASE (`desc_preseason_starts` / `desc_preseason_matches`, già
sul foglio): «in pre-campionato ha cominciato 3 amichevoli su 6 in archivio — un'informazione in più, non
una prova». **La misura è pre-registrata per l'estate 2027**, quando esisterà una seconda stagione
coperta. Nota tecnica: le righe delle amichevoli portano `started` ma quasi mai i `minutes`, quindi una
regola sui minuti lì non funzionerebbe.

E un errore di misura mio, corretto: il primo conteggio di copertura univa i club **per nome** e leggeva
2 su 20 — il difetto che questo repository ha già pagato quattro volte («un'entità si unisce per chiave
canonica, mai per la stringa che una fonte usa per chiamarla»); con `club_index` sono i numeri qui sopra.

### 26.8 Quello che resta, e i debiti

- **Codice**: `desc_riser_watch` ∈ {`preseason`, `rising`, `early`, `yes`} — quattro parole per quattro
  letture, e un bundle più vecchio porta un «yes» nudo che vuol dire la lettura PIENA (degradarlo sarebbe
  l'errore opposto). Un lettore solo (`ValuationStore` invece di `AuctionAdvice`), `PlayerStatus.risers`,
  e il marchio ora si disegna ovunque `ui-flags` sia disegnato ed è filtrabile in tabella.
- **Nessuna colonna e nessun numero a schermo**: l'operatore ha chiesto «solo un'icona vicino al
  calciatore», e la frase sta nel tooltip.
- **Debito**: la metà toolkit (`RISER_*`, il quarto regime, `SHEET_REVISION`) resta **non committata**
  perché `snapshot.py` porta anche il lavoro in corso dell'altra sessione — tre hunk su diciotto sono
  misti, e nel frattempo `SHEET_REVISION` è passata a 45 per mano loro. Va in fondo con il loro commit.
  La voce di spec («Novità v9.73») è dovuta e non scritta per la stessa ragione:
  `spec-euroleghe-ingest-v9.md` è aperto da loro.
- **Aperto**: il marchio non compare finché non girano `snapshot` + `export` — il DB è dell'altra
  sessione.
