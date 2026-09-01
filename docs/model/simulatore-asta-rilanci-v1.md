# Simulatore d'asta a rilanci — `bench/auction` (v1, 1 settembre 2026)

**Il QUINTO banco.** `backtest` giudica le REGOLE, `sweep` le COSTANTI, `zeros` lo ZERO, `bench/draft` le
POLITICHE DI DRAFT — questo giudica le **STRATEGIE D'ASTA**: quanto offrire, per chi, in quale reparto,
contro un tavolo di partecipanti che giocano ognuno a modo suo. E dal 01/09/2026 (sera) porta anche un
**CAMPIONATO A CALENDARIO** (`league.py`), che è una domanda diversa e non un abbellimento: la media
stagionale dice chi fa più punti, una classifica dice chi *vince*.

```
python -m bench.auction.bench --engine          # il tavolo dichiarato + un braccio che legge il motore
python -m bench.auction.league --json out.json  # il tavolo A...L dell'operatore, 36 giornate, tutto
```

Serve `bench/draft/leghe-classic.json`, rigenerato con `python extract.py leghe-classic.json "Leghe"` da
`bench/draft/` (~2 minuti, sola lettura sul DB). **Non è in git**: porta nomi, prezzi e voti di contenuto
a pagamento. Se un'altra sessione tiene il lock di scrittura, `retry-extract.ps1` aspetta con attesa
crescente — stessa ragione di `db.database.retry_on_lock`, dall'altro lato.

---

## 1. Cosa legge dal motore, e perché vive qui e non in uno scratchpad

Per finestra: la **Qt.I** (l'unica quotazione che non conosce l'esito), il `fm_pred`/`pv_pred` del motore
coi parametri **tarati su una finestra adiacente** esattamente come fa il gate, e il fantavoto **e il voto
base** realmente presi in ogni giornata. Quindi l'undici di ogni giornata è schierato con la previsione
che un manager ha davvero in mano ad agosto, e l'esito è quello che quegli uomini hanno fatto per
davvero. **Niente qui riprevede un calciatore.**

Le dieci finestre sono quelle del gate (Tm7 … T2, Serie A / classic).

## 2. Cosa è DICHIARATO, detto perché nessuno lo legga come un risultato

| cosa | dove | perché non è misurabile qui |
|---|---|---|
| i cinque profili | `profiles.py` | è la traduzione delle frasi dell'operatore in disponibilità a pagare |
| il regolamento della lega | `rules.py` | è un regolamento pubblicato: modificatori, riserva d'ufficio, slot |
| la soglia mentale dei 500 crediti | `profiles.py` | «difficilmente si supera» è un fatto sulle persone al tavolo |
| la scala dei gol e i punti | `rules.py` | 66 → 1 gol, poi uno ogni 6; 3 punti a vittoria |
| il calendario | `league.py` | 2 andata + 2 ritorno, richiesta dell'operatore |
| `CAUTIOUS_CAP_SHARE`, `SCATTER`, `URGENCY`, `ABUNDANCE`, `CLUB_PENALTY` | vedi §9 | nessuno ha misurato quanto è prudente o quanto sbanda un offerente vero |

### 2.1 Il regolamento (dettato dall'operatore, trascrizione verificata)

Rose **3-8-8-6**, undici **1-4-3-3**, budget 1000, 10 partecipanti, 3 sostituzioni di solo pari ruolo.
- **R-Factor** sul voto BASE: +2 se tutti e undici prendono almeno 6, mezzo punto in meno per ognuno
  sotto, mai sotto zero — quindi è **finito a quattro insufficienti**.
- **Modificatore di difesa**: si applica schierando almeno 4 difensori, sulla media dei **migliori tre**.
  Sotto il 6 paga nulla; 6,00-6,50 → +0,5; 6,50-7,00 → +1; oltre il 7 → +2. La tabella della lega è
  scritta in sei righe ma ha **tre gradini effettivi**.
- In classic i due modificatori **si sommano** (in mantra il mod.dif. non esiste e il D-Factor è un'altra
  regola).
- **Riserva d'ufficio**: 4 per i calciatori di movimento, 3 per i portieri; dalla seconda in poi vale
  **zero**, e **una sola riserva d'ufficio azzera entrambi i modificatori** per l'intera giornata.

Quest'ultima clausola è la ragione per cui la copertura vale più di qualunque singolo acquisto, ed è
**misurata e non asserita**: su 110 rose simulate la correlazione dei punti finali coi buchi è **−0,79**,
coi crediti spesi **+0,13**.

### 2.2 I cinque profili

| | frase dell'operatore | come è tradotta |
|---|---|---|
| **P1a** senza piano, esperto | «sa valutare al momento l'asta ed il valore dei calciatori astati» | scala PIATTA + `EXPERT_EYE` 0,6 (corregge il prezzo col surplus del motore), sbandamento 0,15 |
| **P1b** senza piano, novizio | «un po' si fida ciecamente della QI e un po' fa errori grossolani» | scala PIATTA, nessun occhio, sbandamento **0,8** |
| **P2** difesa | «punta molto su portiere e difesa per massimizzare il mod.dif. ma non è uno sprovveduto» | scala alta su P e D, colpi low-cost altrove |
| **P3** equilibrato | «rispetta i budget di reparto ed evita i rilanci più pericolosi» | scala uniforme + tetto per uomo del 15% del budget |
| **P4** top d'attacco | «vuole il top, risparmia in maniera netta e prende il minimo necessario» | 2,2 sul primo attaccante, minimo altrove |

**Il quinto profilo — il TIFOSO — è dichiarato e spento** su istruzione dell'operatore
(`SUPPORTER_PROFILE`): paga oltre il ragionevole i calciatori di una squadra reale e rinuncia alle aste
dei nemici. Accenderlo richiede il club di ogni uomo (ora c'è) più una **tabella di rivalità dichiarata**:
«Napoli ↔ Juve» è un fatto sulle persone, non sul calcio che misuriamo.

---

## 3. Due cose che il MECCANISMO produce invece di assumere

**Il prezzo del top d'attacco.** L'aggiudicazione è al **secondo prezzo più uno**, che è quello che un
rilancio *è*. Con quello solo, l'uomo più caro del listone esce al **48-75% del budget (media 60%)** — il
numero che l'operatore riporta dall'esperienza, e la ragione per fidarsi del resto.

**Il costo di un buco.** `HOLE_COST` = **4,73** fantapunti: la pendenza dei punti sui buchi su 110 rose
simulate (r = −0,798). E l'aritmetica del regolamento dice la stessa cosa, che è ciò che ne fa un numero e
non un fit: il fantavoto perso è circa 6, la riserva d'ufficio ne ridà 4 quando è la **prima** della
giornata e 0 dalla seconda, più i ~0,6 di modificatori azzerati. Quindi un buco costa fra 2,6 e 6 a
seconda che sia solo, e la media misurata cade dentro quell'intervallo.

### 3.1 La conversione della quotazione è una LEGGE DI CONSERVAZIONE

`to_credits` non è un coefficiente da scegliere: quello che un tavolo paga è la somma dei budget, quindi
gli uomini che **rosterizza davvero** — i `teams × slots` più cari di ogni ruolo — devono sommare a
`teams × budget`. Senza, la Qt.I è una scala sua (1-40 per un attaccante contro i 500 dei crediti), ogni
tetto esce minuscolo e **tutto il tavolo chiude l'asta con tre quarti dei soldi in tasca** — che è
esattamente cosa fece la prima corsa di questo banco. Il pool è quello ROSTERIZZATO e mai tutti i quotati:
spalmare gli stessi soldi su ~400 uomini invece dei 250 comprati è lo stesso difetto misurato sull'FVM
dalla conversione SpM, e leggerebbe ogni prezzo come il 40% più economico.

---

## 4. Cosa è servito al braccio MOTORE per vincere, e quanto vale ogni metà

La prima versione di `--engine` offriva in proporzione al **surplus** e finì **ultima di undici**,
spendendo 284 crediti su 1000. Mancavano due cose, entrambe misurate e non scelte.

**L'altra metà del valore di un uomo.** Il surplus risponde a «quanto meglio dell'uomo che giocherebbe al
suo posto», che presuppone che qualcuno giochi. In questa lega può non giocare nessuno. Quindi il valore
ha **due termini che si SOMMANO, mai si moltiplicano**: `surplus + cover_value`, dove il secondo è
`buchi evitati × HOLE_COST`, **limitato dal deficit del ruolo** (a posti coperti, un uomo in più non copre
niente — è questo che impedisce al termine di comprare un quinto attaccante).

**Un tetto per reparto, dinamico.** Quello che resta della quota di budget di quel reparto sui posti ancora
da riempire, moltiplicato per `URGENCY` finché il reparto non copre i propri posti. Una quota piatta del
15% era sbagliata **in due direzioni insieme**: 150 crediti sono un tetto che nessun portiere raggiunge e
uno che stringe su un attaccante. Le quote di reparto sono **derivate dal pool** (`role_shares`), non
dichiarate.

**Il tasso motore è calibrato, non scelto.** `engine_rate`: gli uomini che questo offerente vuole — i
migliori `slots[role]` per surplus in ogni ruolo — devono sommare in surplus a tutto il budget. La prima
versione usava il prezzo ombra del credito (0,139 fantapunti per credito) **diviso dieci senza una ragione
dicibile**, e sbagliava tutt'e due le metà: un prezzo ombra è il valore dell'**ultimo** credito speso, non
la media a cui si compra una rosa intera (990 crediti per 606 punti di surplus sono 1,63 crediti a punto),
e il divisore era una pezza.

---

## 5. I risultati sul tavolo DICHIARATO (10 finestre)

Tavolo: 2 P1a, 2 P1b, 1 P2, 3 P3, 2 P4, più il braccio motore.

| braccio | punti | sd | peggio | pos. | buchi | R-Fact. | mod.dif. | spesi | vinte |
|---|---|---|---|---|---|---|---|---|---|
| **MOTORE** | **2658,8** | **42,6** | **2578** | **1,90** | 13,8 | 13,8 | 14,2 | 933 | **6/10** |
| P1a senza piano, esperto | 2542,9 | 106,3 | 2268 | 5,25 | 17,4 | 11,2 | 14,6 | 980 | 0/20 |
| P1b senza piano, novizio | 2542,1 | 113,6 | 2180 | 5,35 | 44,6 | 3,5 | 3,9 | 1000 | 1/20 |
| P3 equilibrato | 2518,4 | 117,9 | 2206 | 6,27 | 28,7 | 9,1 | 10,1 | 986 | 3/30 |
| P2 difesa | 2482,8 | 63,7 | 2350 | 7,70 | 28,1 | 7,0 | 12,4 | 981 | 0/10 |
| P4 top d'attacco | 2439,5 | 116,6 | 2081 | 8,20 | 42,6 | 4,0 | 6,0 | 965 | 0/20 |

**+116 punti sul miglior profilo umano, e la dispersione più bassa del tavolo** (42,6 contro 64-118): la
stagione peggiore del motore, 2578, batte la *media* di ogni altro profilo.

### 5.1 Il NULL: quanto di quel margine è il motore e quanto è il piano

La stessa strategia — stessa scala di copertura, stessi tetti — che legge la disponibilità dal **rango di
prezzo** invece che da `pv_pred`:

| | punti | pos. | buchi | vinte |
|---|---|---|---|---|
| col motore | 2712,9 | 1,50 | 5,1 | 7/10 |
| cieca (solo piano) | 2690,6 | 1,80 | 8,3 | 7/10 |

**Il motore vale +22,3 punti, 6 finestre su 10** — e il numero è onesto sulla propria fragilità: lo 0,8%
su una maggioranza stretta non passerebbe il criterio robusto di questo progetto. Contro un tavolo **più
forte** (una versione precedente in cui il novizio era di fatto un offerente disciplinato) lo stesso
confronto leggeva +57,7 su 7 di 10. Quindi la lettura è: **il piano è ciò che batte un tavolo debole, la
previsione è ciò che serve contro uno buono.** *(Misurato sulla configurazione del 01/09 mattina, prima
della diversificazione e della correzione del pareggio d'offerta: va rifatto prima di essere ricitato.)*

---

## 6. Il difetto che l'operatore ha trovato dal RISULTATO, e che era doppio

Disse: «su 10 aste non è normale che il senza piano novizio batta l'esperto 2-0 … il novizio dovrebbe
avere dei buchi nella rosa che gli pregiudicano la stagione». Entrambe le metà della causa erano mie.

1. **Il tasso non arrivava a chi legge il motore.** `engine_rate` era assegnato al solo braccio motore,
   quindi l'esperto confrontava un surplus in FANTAPUNTI con un prezzo in CREDITI: la scala era sfasata
   del tasso stesso, e sottovalutava ogni uomo caro sopravvalutando ogni uomo economico. Vale 13 punti.
2. **Avevo dato una scala DECRESCENTE a profili che non hanno un piano**, e una scala decrescente *è* un
   piano di razionamento. Con la scala piatta — che è cosa «senza piano» vuol dire — i crediti finiscono
   sui primi nomi che passano (l'asta chiama i più cari per primi) e i reparti si chiudono con quello che
   resta. I buchi del novizio sono passati da 32,7 a **43,8** e ha perso 84 punti.

Quello che resta dopo la correzione è a sua volta un risultato: novizio ed esperto **pari**. L'esperto
costruisce una rosa strutturalmente molto migliore (17,9 buchi contro 43,8, 25 punti di modificatori
contro 6,8) e non la converte, perché il suo occhio lo porta a **RISPARMIARE** crediti che nessun piano
gli dice dove spendere. **Il giudizio senza un piano non paga niente.**

---

## 7. Le tre correzioni del 01/09/2026 (sera), su indicazione dell'operatore

### 7.1 «È anomalo restare con crediti non spesi»

Aveva ragione: «avrebbero rilanciato sicuramente per qualche attaccante più forte alla fine piuttosto che
restare con crediti non spesi». La regola precedente («se il portafoglio copre il prezzo di listino, paga
il listino») scattava troppo tardi. Ora il **pavimento** di ogni tetto è quello che il portafoglio può
permettersi **per slot residuo**: con 400 crediti e 3 slot, 133 a testa non è generosità, è aritmetica.

| | prima | ora |
|---|---|---|
| P1a esperto | 828 | 984 |
| P3 equilibrato | 840 | 981 |
| P4 top attacco | **495** | 973 |
| MOTORE | 888 | 924 |

E il braccio motore era **l'unico esente**, perché il suo ramo esce prima di quella regola. *Una regola
che vale per tutti tranne quello che stai giudicando non è una regola.*

### 7.2 P4 spende «qualcosina in più a centrocampo»

Scala `C` da 0,6 a **0,9** sui primi tre: «il minimo necessario per completare i titolari» deve comprare
tre centrocampisti che giocano davvero, e a 0,6 del prezzo non li comprava.

### 7.3 La DIVERSIFICAZIONE è adottata

Regola dell'operatore: «nel fanta è molto importante differenziare, comprare 5 calciatori di una singola
squadra reale significa rischiare il tracollo se quella squadra ha un anno storto … puntare su più squadre
minimizza questo pericolo (come giocare in borsa su più titoli)». `CLUB_FREE` = 2, `CLUB_PENALTY` = 0,45.

Attribuita muovendo **una variabile per volta**, che è l'unico modo di accreditare un cambiamento:

| braccio motore | punti | sd | pos. | R-Fact. |
|---|---|---|---|---|
| solo copertura | 2650,0 | 61,6 | 2,30 | 12,6 |
| + costanza | 2641,8 | 73,0 | 2,70 | 12,4 |
| **+ diversificazione** | 2648,4 | **56,0** | 2,50 | 12,6 |
| tutt'e due | 2640,2 | 68,2 | 2,90 | 12,4 |

Costa **1,6 punti** (dentro il rumore) e taglia la deviazione standard del **9%**. È esattamente quello
che `metrica-asta-surplus-v1.md` §24 aveva già misurato sulla stessa domanda dall'altro lato: due uomini
di un club non costano niente sulla MEDIA e aggiungono il 3,9% alla deviazione standard SETTIMANALE.
**E questo banco non vede il beneficio che compra**: la sua sd è misurata *fra stagioni*, mentre il
rischio che la diversificazione toglie è quello *settimanale dentro* una stagione. Quindi la lettura
onesta è: il costo è misurato qui a ~0, il beneficio è misurato nel §24, e le due misure concordano nella
direzione.

Una tensione che va detta e non nascosta: l'R-Factor è **troncato a zero**, e un payoff troncato vale di
più sotto varianza maggiore — la stessa misura del 01/09 leggeva +7 punti a stagione per un undici
correlato di qualità di popolazione. Quindi questa regola rinuncia a qualcosa di piccolo sul modificatore
per comprare stabilità. **Se il baratto convenga è una preferenza, ed è dell'operatore.**

---

## 8. La COSTANZA: chiesta, misurata e messa a ZERO (`STEADY_WEIGHT` = 0)

L'operatore l'ha chiesta avendo letto il **sintomo giusto** — il braccio incassava 6,5 punti di R-Factor a
stagione contro i 20,5 di un rivale che comprava difensori affidabili — e né il surplus né le presenze
contengono il voto BASE. La diagnosi era sana. La cura no, e la ragione è **aritmetica**, non di
implementazione:

- **un uomo può spostare l'R-Factor di +2,4 punti a stagione** (dalla mediana del suo ruolo al p90, gli
  altri dieci alle loro mediane, calcolato esatto sulla **Poisson-binomiale** dell'undici) e di +10,8 nel
  caso impossibile di passare da mai-sufficiente a sempre. Contro un `cover_value` che arriva a 180 per un
  titolare in un reparto vuoto, **non riordina una singola offerta**;
- **e il modificatore è governato dai BUCHI, non dalla costanza.** Su 110 rose l'R-Factor incassato
  correla **−0,821** coi buchi: il quartile con meno buchi ne incassa 13,6 punti, quello con più 2,1.
  Una sola riserva d'ufficio azzera il bonus dell'intera giornata, quindi finché una rosa non è coperta la
  sua costanza **non viene letta affatto** — ed è per questo che il 6,5 del braccio era un sintomo dei suoi
  12 buchi e non di chi aveva comprato.

Accesa a 1,0 costa **8,2 punti** a stagione e muove l'R-Factor incassato di **−0,2**: perturba le offerte
senza comprare la cosa da cui prende il nome. Resta nel codice, a zero, con i numeri accanto, così nessuno
la ririprova: **quello che la farebbe pagare è una rosa senza buchi, e su questo banco nessuna strategia ci
arriva.**

### 8.1 Il valore di una soglia non si scrive su una riga

L'R-Factor è una SOGLIA (finito a quattro insufficienti), quindi non si può attribuire uomo per uomo: il
quinto giocatore affidabile in una rosa che ne ha già quattro inaffidabili non vale niente, e il quarto
vale mezzo punto. Da qui `expected_r_factor`, una **Poisson-binomiale calcolata esatta**, e il fatto che
il valore della costanza va calcolato sull'**UNDICI** e mai su una riga.

### 8.2 La colonna «Costanza» nell'app è nata da qui

Richiesta dell'operatore, 01/09/2026: «aggiungiamo per tutti i calciatori un valore *costanza* che indica
la quota di partite con voto base ≥ 6». Due cose valgono oltre la colonna.

**La quantità esisteva già e veniva buttata via**: `player-ratings.ts` calcolava `blend('consistency')` con
`PASS_MARK = 6` e la teneva solo come coda del tooltip della varianza. Quindi non c'era da misurare
niente, c'era da **leggere** — la stessa famiglia di «il dato c'era, nessuno l'ha chiesto».

**E la disuguaglianza È la misura**: il 6,0 secco è il voto modale del fantacalcio, il **36,1% di 59.094
voti** di Serie A su cinque stagioni. Quindi «almeno 6» dà 0,658 e «più di 6» dà **0,297**: scambiare le due
non sposterebbe un decimale, sposterebbe la colonna di 36 punti. Il regolamento dice «almeno 6» e la
colonna dice quello.

> **STATO: il codice esiste e NON è committato.** `player-ratings.ts` e i tre file di `squad-table/` sono
> stati editati **anche da un'altra sessione** (la colonna «Categoria», `letture-app-v1.md` §20), quindi
> per la regola di casa — «mai committare il file di un'altra sessione, e mai la propria metà che non
> compila senza la loro» — la metà app di questo lavoro resta fuori dal commit del 01/09. La sua scheda in
> `letture-app-v1.md` va scritta da chi committa quel file.

---

## 9. Il CAMPIONATO a calendario (`league.py`), e cosa ha tirato fuori

Richiesta dell'operatore, 01/09/2026 (sera): il suo tavolo per lettera — **A** motore, **B** e **C** top
d'attacco, **D**, **E**, **L** equilibrati, **F** esperto senza piano, **G** e **H** novizi, **I** difesa —
poi «una competizione a calendario con 2 andata e 2 ritorno».

**Il calendario è aritmetica, quindi è verificato e non creduto**: metodo del cerchio, 9 giornate per
girone, 45 accoppiamenti ognuno una volta, **4 incontri per coppia**, 18 partite in casa a testa, nessuno
due volte nella stessa giornata — 36 giornate, giocate sulle giornate reali 1…36. *Il campo non paga nulla
in questa lega*, quindi casa e trasferta sono solo leggibilità: quello che separa il secondo girone dal
primo non è il campo, sono le **giornate**.

**La scala dei gol** (dichiarata, standard di una lega classic italiana): 66 fantapunti sono un gol e ogni
6 sopra è un altro (66 → 1, 72 → 2, 78 → 3), sotto i 66 nulla. Due proprietà della scala, dette prima di
qualunque numero perché non sono di nessuna strategia: è una **scalinata**, quindi 65,9 e 60,0 sono lo
stesso risultato; e **tronca in basso**, quindi i punti che una giornata lascia sotto i 66 sono persi in un
modo che la media stagionale non può vedere.

### 9.1 Il verdetto

| profilo | posti | punti | pos. | titoli | fantapunti | GF | GS | giornate <66 | buchi |
|---|---|---|---|---|---|---|---|---|---|
| **MOTORE** | 1 | **61,4** | **2,10** | **5/10** | 2529,5 | 46,7 | 33,1 | **8,6** | 10,4 |
| P1b novizio | 2 | 47,9 | 5,65 | 2/20 | 2413,0 | 33,5 | 33,1 | 15,5 | 43,5 |
| P1a esperto | 1 | 46,9 | 5,90 | 1/10 | 2424,6 | 32,5 | 35,5 | 14,0 | 17,6 |
| P3 equilibrato | 3 | 46,3 | 5,70 | 1/30 | 2416,1 | 31,3 | 33,5 | 15,2 | 20,5 |
| P2 difesa | 1 | 45,6 | 6,10 | 0/10 | 2423,7 | 32,9 | 33,8 | 14,8 | 20,6 |
| P4 top attacco | 2 | 45,5 | 6,25 | 1/20 | 2380,7 | 28,3 | 30,4 | 16,9 | 25,4 |

### 9.2 E il calendario ha tirato fuori una quantità che la media stagionale non poteva vedere

**In 4 stagioni su 10 il campione NON è chi ha fatto più fantapunti.** In T2 il titolo va a C (P4, 2478)
mentre I (P2) ne fa 2527 e arriva terzo; in Tm2 il titolo va a F mentre il motore fa 34 fantapunti in più;
in T1 succede il contrario. Non è rumore: è la troncatura a 66.

Su 100 righe (10 squadre × 10 stagioni):

| relazione | r |
|---|---|
| punti in classifica ↔ fantapunti totali | **+0,815** |
| punti in classifica ↔ **giornate sotto i 66** | **−0,802** |
| giornate sotto i 66 ↔ buchi | +0,661 |
| punti in classifica ↔ buchi | −0,532 |

Cioè: accanto a «quanto segni» c'è una **seconda quantità che decide quasi uguale**, e non l'avevamo
misurata perché il banco non giocava le partite. Il motore ha 8,6 giornate buttate contro le 14-17 di
tutti gli altri, e la catena è leggibile: meno buchi → meno giornate sotto la soglia → più partite vinte a
parità di talento. **La copertura paga due volte, e nessuna delle due strade passa per chi compri in
cima.**

Un numero da non leggere male: punti in classifica ↔ crediti spesi legge **−0,418**, ma è **confuso dal
profilo** — il motore spende meno di tutti *e* vince, quindi è una differenza fra gruppi e non una virtù
del risparmiare. Stessa regola dell'età: una differenza fra due gruppi non è un merito di chi la porta.

### 9.3 Un difetto latente che la richiesta dell'operatore ha fatto emergere

Chiamare i partecipanti A…L espone una cosa che coi nomi dei profili era invisibile: **il pareggio
d'offerta si rompeva in ordine ALFABETICO**, quindi la lettera A avrebbe vinto ogni ex aequo dell'asta. A
un tavolo vero un pareggio va a chi ha urlato prima, cioè a nessuno in particolare: ora lo rompe un
**sorteggio riproducibile per (partecipante, uomo)**, lo stesso che usa lo sbandamento. Misurato sul tavolo
dichiarato **prima** di cambiarlo: 2657,1 → 2658,8 punti, posizione 2,10 → 1,90, **ordine dei sei profili
invariato** (quello che si muove è la dispersione, 51,9 → 42,6, perché ora un pareggio lo decide l'uomo e
non sempre lo stesso partecipante). Era **latente**, ed è esattamente quando conviene curare un difetto.

### 9.4 Una definizione, due lettori

`bench.matchday` è stata **estratta** da `season` perché il campionato ha bisogno della stessa quantità
per GIORNATA invece che per stagione. Due definizioni di «quanto ha fatto questa rosa alla dodicesima»
avrebbero finito per dare due totali a una rosa, e il primo posto in cui qualcuno se ne accorge è una
**classifica**. Verificato: il refactor non muove un decimale della tabella pubblicata.

---

## 10. La verifica dell'ARTIFACT, e tre lezioni sull'arnese

La pagina pubblicata (privata su claude.ai, «Dieci stagioni all'asta») è stata **misurata in un browser
vero** prima di pubblicarla, con lo stesso argomento di `app/scripts/e2e-table.mjs`: una pagina i cui
numeri li disegna JavaScript può essere completa nel sorgente e vuota sullo schermo.

Due difetti erano **dell'arnese**, e sono la specie generale:
- **un passo misurava DUE incognite**: un selettore prendeva insieme la classifica e i dodici colpi più
  cari, leggeva 22 righe invece di 10 e dava la colpa alla pagina;
- **Chrome headless parte in tema SCURO**, quindi confrontava lo scuro con sé stesso e dichiarava rotto un
  tema che funzionava. Ora entrambi gli stati sono chiesti esplicitamente.

E uno strumento sbagliato: `document.fonts.check()` rispondeva `false` per due caratteri su tre. Non è
quella la domanda — quello che decide se un carattere **dipinge** è la **larghezza** della stessa stringa
nel carattere e nel suo fallback (Archivo Narrow è il 18% più stretta di Helvetica, ed è la condensata che
fa il suo lavoro).

Le **fotografie** hanno poi trovato due difetti veri che nessun conteggio vedeva: nelle rose la colonna dei
fantapunti era **tagliata via** dalla card (`overflow:hidden` più una tabella auto-layout più larga — la
stessa famiglia dei «276px di colonne non strette, ASSENTI» della tabella dell'app, curata con
`table-layout: fixed` e un colgroup), e la classifica sforava il contenitore.

---

## 11. Limiti, detti e non spalmati

- **Non c'è il mercato di riparazione.** In questa lega esiste e cura i buchi, quindi ogni numero è la rosa
  *come è stata comprata ad agosto*. Tre tentativi di modellarlo sono falliti nello stesso punto — l'ordine
  con cui si schiera una rosa dopo una finestra — e la cura è la stessa chiamata al motore che questo banco
  già fa, **a una data successiva** (`features.prepare(date=...)`, cioè R20). Finché non c'è, la finestra è
  **ASSENTE e non approssimata**, e chi lascia molti buchi è giudicato più severamente che a un tavolo vero.
- **Il secondo prezzo rende GRATIS lo sbandamento** dove nessuno rilancia, quindi il novizio è trattato
  meglio che a un tavolo vero, dove un rilancio impulsivo si paga. Quello che lo curerebbe è uno
  sbandamento **correlato** fra partecipanti — gli errori veri condividono una causa, il nome di moda — e
  nessuno l'ha misurato.
- **Quale fra P1a, P2 e P3 sia il migliore non è decidibile qui.** Cambiando solo il prior (FVM invece di
  Qt.I) si riordinano. Due sole affermazioni sono sopravvissute a ogni versione, a ogni prezzo e a ogni
  composizione del tavolo: **puntare al top d'attacco perde**, e **la copertura decide una stagione**.
- Le ultime **due giornate** della stagione vera non entrano nel campionato: 36 sono 4 × 9, e allungare a
  38 vorrebbe dire un quinto girone parziale che nessuno gioca.

---

## 12. Prossimi passi, in ordine di resa attesa

1. **Lo SWEEP delle quattro manopole dichiarate dentro il braccio vincente**, che è la ragione per cui
   questo banco esiste: `URGENCY` (1,8), `CAUTIOUS_CAP_SHARE` (0,15), `ABUNDANCE` (1,0), `CLUB_PENALTY`
   (0,45). Nessuna è stata chiesta ai dati. Regola di casa: **niente al bordo della griglia**, e il
   cross-fit leave-one-out come fa `sweep`.
2. **Rifare il NULL** (§5.1) sulla configurazione attuale: quel +22,3 precede la diversificazione e la
   correzione del pareggio d'offerta, quindi va rimisurato prima di essere ricitato.
3. **Il mercato di riparazione**, che è la sola cosa che cambierebbe l'ordine dei profili: chi lascia buchi
   oggi è punito per intero, e la lega gli darebbe tre finestre per curarli.
4. **Il profilo TIFOSO**, ora che il club di ogni uomo viaggia nell'estrattore: serve solo la tabella di
   rivalità dichiarata. Due cose da misurare, una volta accesa: quanto costa il premio su un club, e se
   rinunciare a interi ruoli costa più del premio.
5. **La seconda quantità del §9.2 come CANALE**: le giornate sotto i 66 sono governate dai buchi, quindi
   oggi la copertura le cura già indirettamente. Vale la pena chiedersi se esista una forma che le cura
   *direttamente* — ma prima di costruirla, la regola di casa: **chiedersi cosa può cambiare il suo
   output**, perché se la risposta è «gli stessi acquisti della copertura» non è un canale nuovo.
