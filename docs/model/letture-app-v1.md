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
