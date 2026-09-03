# Simulatore d'asta a rilanci — `bench/auction` (v1, 1 settembre 2026;
# numeri rimisurati il 2 settembre 2026 dopo la review, §13;
# **l'asta a ESTRAZIONE RANDOM, stesso giorno, §14**)

**Il QUINTO banco.** `backtest` giudica le REGOLE, `sweep` le COSTANTI, `zeros` lo ZERO, `bench/draft` le
POLITICHE DI DRAFT — questo giudica le **STRATEGIE D'ASTA**: quanto offrire, per chi, in quale reparto,
contro un tavolo di partecipanti che giocano ognuno a modo suo. E dal 01/09/2026 (sera) porta anche un
**CAMPIONATO A CALENDARIO** (`league.py`), che è una domanda diversa e non un abbellimento: la media
stagionale dice chi fa più punti, una classifica dice chi *vince*.

```
python -m bench.auction.bench --engine                 # A CHIAMATA: si parte dai piu' cari
python -m bench.auction.bench --engine --random 20     # A ESTRAZIONE: 20 urne per finestra
python -m bench.auction.bench --engine 3 --random 20   # tre sedie al motore, che e' il NULL
python -m bench.auction.league --random 20 --json out.json   # il campionato, tutto
```

**Due meccanismi, una sola regola di prezzo** (02/09/2026, §14). Quello che questa pagina chiama *a
chiamata* e' l'asta in cui i nomi piu' cari vanno per primi; *a estrazione* e' quella in cui il
calciatore lo pesca la macchina — che e' l'asta che l'operatore giochera'. Tutti i numeri pubblicati
sulla prima **non si muovono di un decimale**, ed e' verificato invece che sperato.

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
rilancio *è*, e con quello solo l'uomo più caro del listone esce a una quota del budget che il meccanismo
produce invece di assumere. *Il «48-75%, media 60%» scritto qui il 01/09 è stato RITIRATO il 02/09 (§14.6)
perché non si riproduceva, e la sera stessa sostituito dalla misura sulle aste vere: **42,8% a chiamata e
44,1% a estrazione**, 18-73% (§15.10).*

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
| **MOTORE** | **2665,5** | **45,7** | **2574** | **1,90** | 12,4 | 14,4 | 15,2 | 988 | **6/10** |
| P1b senza piano, novizio | 2543,4 | 113,0 | 2180 | 5,30 | 44,4 | 3,5 | 4,0 | 1000 | 1/20 |
| P1a senza piano, esperto | 2542,9 | 106,3 | 2268 | 5,25 | 17,4 | 11,2 | 14,6 | 980 | 0/20 |
| P3 equilibrato | 2513,1 | 123,3 | 2206 | 6,20 | 30,3 | 8,7 | 9,9 | 981 | 3/30 |
| P2 difesa | 2481,4 | 63,4 | 2350 | 7,70 | 28,3 | 7,0 | 12,2 | 977 | 0/10 |
| P4 top d'attacco | 2432,9 | 122,7 | 2036 | 8,35 | 43,8 | 3,9 | 5,8 | 965 | 0/20 |

**+122 punti sul miglior profilo umano, e la dispersione più bassa del tavolo** (45,7 contro 63-123): la
stagione peggiore del motore, 2574, batte la *media* di ogni altro profilo.

> **Le due tabelle di questo documento non sono sullo stesso calendario**, e va detto prima che qualcuno
> legga il campionato come un peggioramento: il banco conta **38** giornate e il campionato **36** (4 × 9),
> quindi 2665,5 e 2536,3 sono **70,14 e 70,45 fantapunti a giornata**. Tutta la differenza sono le due
> giornate che un calendario a quattro gironi non raggiunge. (Rilievo 4 della review del 02/09/2026.)

### 5.1 Il NULL: quanto di quel margine è il motore e quanto è il piano

La stessa strategia — stessa scala di copertura, stessi tetti — che legge la disponibilità dal **rango di
prezzo** invece che da `pv_pred`:

| | punti | pos. | buchi | vinte |
|---|---|---|---|---|
| col motore | 2712,9 | 1,50 | 5,1 | 7/10 |
| cieca (solo piano) | 2690,6 | 1,80 | 8,3 | 7/10 |

> **QUESTI QUATTRO NUMERI SONO SUPERATI E NON CITABILI.** Sono stati presi sulla configurazione del
> 01/09 mattina — prima del sorteggio sul pareggio d'offerta e prima della correzione del pavimento del
> portafoglio — e il braccio cieco era una variante usa-e-getta che nel codice non c'è. Il confronto vale
> e **va rifatto** prima di essere ricitato: è il secondo item aperto del §12. Quello che segue è la
> lettura che diede allora, tenuta per la forma dell'argomento e non per le cifre.

**Il motore valeva +22,3 punti, 6 finestre su 10** — e il numero era onesto sulla propria fragilità: lo
0,8% su una maggioranza stretta non passerebbe il criterio robusto di questo progetto. Contro un tavolo
**più forte** (una versione precedente in cui il novizio era di fatto un offerente disciplinato) lo stesso
confronto leggeva +57,7 su 7 di 10. La lettura era: **il piano è ciò che batte un tavolo debole, la
previsione è ciò che serve contro uno buono.**

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
| P1a esperto | 828 | 980 |
| P3 equilibrato | 840 | 981 |
| P4 top attacco | **495** | 965 |
| MOTORE | 888 | **988** |

E il braccio motore era **l'unico esente**, perché il suo ramo esce prima di quella regola. *Una regola
che vale per tutti tranne quello che stai giudicando non è una regola.*

**E la prima correzione non bastava: il tetto di reparto si mangiava il pavimento** (rilievo 1 della review
del 02/09/2026). `role_cap` limitava anche il pavimento, quindi il braccio motore teneva ancora 67 crediti
mentre il tavolo ne teneva 0-20 — e gli umani non hanno *nessun* tetto per reparto. Un tetto è un arnese di
RAZIONAMENTO, e razionare un portafoglio che non si può più spendere su altro non è prudenza, è spreco.
Misurato togliendo il taglio: **2658,8 → 2665,5 punti**, spesa 933 → 988, buchi 13,8 → 12,4, posizione
1,90 → 1,70; in campionato 61,4 → 62,1 e posizione 2,10 → **1,70**. La direzione conta: il difetto
**penalizzava il braccio giudicato**, quindi ogni margine pubblicato prima era conservativo.

### 7.2 P4 spende «qualcosina in più a centrocampo»

Scala `C` da 0,6 a **0,9** sui primi tre: «il minimo necessario per completare i titolari» deve comprare
tre centrocampisti che giocano davvero, e a 0,6 del prezzo non li comprava.

### 7.3 La DIVERSIFICAZIONE è adottata

Regola dell'operatore: «nel fanta è molto importante differenziare, comprare 5 calciatori di una singola
squadra reale significa rischiare il tracollo se quella squadra ha un anno storto … puntare su più squadre
minimizza questo pericolo (come giocare in borsa su più titoli)». `CLUB_FREE` = 2, `CLUB_PENALTY` = 0,45.

Attribuita muovendo **una variabile per volta**, che è l'unico modo di accreditare un cambiamento:

| braccio motore | punti | sd | pos. | R-Fact. | buchi |
|---|---|---|---|---|---|
| solo copertura | 2669,6 | 47,8 | 1,80 | 14,1 | 12,4 |
| + costanza | 2669,6 | 47,8 | 1,80 | 14,1 | 12,4 |
| **+ diversificazione** | 2665,5 | **45,7** | 1,90 | 14,4 | 12,4 |
| tutt'e due | 2665,5 | 45,7 | 1,90 | 14,4 | 12,4 |

*(Rimisurata il 02/09/2026 sul codice attuale: la versione del 01/09 precede la correzione del pavimento
del portafoglio e i suoi numeri sono superati. Si vede anche, in questa tabella, il rilievo 2 della review:
la riga della costanza è IDENTICA a quella sopra.)*

Costa **4,1 punti** (dentro il rumore) e taglia la deviazione standard del **4,4%** — non del 9% pubblicato
il 01/09, che era misurato sulla configurazione superata. È esattamente quello
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

- **un uomo può spostare l'R-Factor di +1,5 punti a stagione** (dalla mediana del suo ruolo al p90, gli
  altri dieci alle loro mediane, calcolato esatto sulla **Poisson-binomiale** dell'undici), +6,3 per
  quattro difensori, **+18,8 per un undici in cui stanno al p90 tutti e undici** — che è una rosa che
  nessuno può comprare, perché comprarla costa la copertura. E +10,8 nel caso impossibile di un uomo che
  passa da mai-sufficiente a sempre. Contro un `cover_value` che arriva a 180 per un titolare in un
  reparto vuoto, **niente di tutto questo riordina una singola offerta**.
  > **Il «+2,4» pubblicato il 01/09 NON si riproduce** (rilievo 2 della review del 02/09/2026): la stessa
  > costruzione dà **+1,5**, mentre il compagno estremo, +10,8, si riproduce *esatto* — ed è quello che
  > localizza l'errore nel quantile e non nel meccanismo. La conclusione non cambia, si rafforza. Le
  > mediane e i p90 su cui è calcolato, dalle dieci finestre: P 0,863/0,922 · D 0,640/0,778 ·
  > C 0,665/0,783 · A 0,610/0,754, con l'undici di popolazione a 14,1 punti di R-Factor a stagione;
- **e il modificatore è governato dai BUCHI, non dalla costanza.** Su 110 rose l'R-Factor incassato
  correla **−0,821** coi buchi: il quartile con meno buchi ne incassa 13,6 punti, quello con più 2,1.
  Una sola riserva d'ufficio azzera il bonus dell'intera giornata, quindi finché una rosa non è coperta la
  sua costanza **non viene letta affatto** — ed è per questo che il 6,5 del braccio era un sintomo dei suoi
  12 buchi e non di chi aveva comprato.

**E sul codice attuale è INERTE**, che è un'affermazione più forte dei «−8,2 punti» del 01/09 (quella cifra
precede la correzione del pavimento del portafoglio ed è superata): a peso 0, 1 e 5 il braccio legge
**2665,5 identico**. Il termine *arriva* all'offerta — 1,8 punti su un difensore vero — e non cambia
niente, perché **`role_cap` morde prima**. Comincia a mordere solo a 20 (+2,2 punti, R-Factor 14,4 → 15,2),
cioè lo **0,08%**: un ordine di grandezza sotto il pavimento dello 0,5% di questo progetto. E a 100 crolla
(−25,7 punti, buchi 12,4 → 13,7), perché lì compra costanza invece di copertura, che è il distruttore del
modificatore stesso. Resta nel codice, a zero, con i numeri accanto: **quello che la farebbe pagare è una
rosa senza buchi, e su questo banco nessuna strategia ci arriva.**

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
| **MOTORE** | 1 | **62,1** | **1,70** | **5/10** | 2536,3 | 48,2 | 33,2 | **8,0** | 8,4 |
| P1b novizio | 2 | 48,6 | 5,35 | 2/20 | 2413,8 | 33,6 | 32,0 | 15,8 | 43,6 |
| P1a esperto | 1 | 47,6 | 5,50 | 0/10 | 2424,6 | 32,5 | 34,2 | 14,0 | 17,6 |
| P2 difesa | 1 | 46,6 | 5,50 | 0/10 | 2425,3 | 33,1 | 33,1 | 14,8 | 20,3 |
| P3 equilibrato | 3 | 45,9 | 6,03 | 1/30 | 2414,2 | 30,5 | 33,6 | 15,5 | 21,3 |
| P4 top attacco | 2 | 43,9 | 6,75 | 2/20 | 2371,3 | 26,9 | 30,6 | 17,8 | 28,1 |

### 9.2 E il calendario ha tirato fuori una quantità che la media stagionale non poteva vedere

**In 4 stagioni su 10 il campione NON è chi ha fatto più fantapunti** — Tm3, T0, T1 e T2. Non è rumore: è
la troncatura a 66.

Su 100 righe (10 squadre × 10 stagioni):

| relazione | r |
|---|---|
| punti in classifica ↔ fantapunti totali | **+0,833** |
| punti in classifica ↔ **giornate sotto i 66** | **−0,825** |
| giornate sotto i 66 ↔ buchi | +0,701 |
| punti in classifica ↔ buchi | −0,553 |

Cioè: accanto a «quanto segni» c'è una **seconda quantità che decide quasi uguale**, e non l'avevamo
misurata perché il banco non giocava le partite. Il motore ha 8,0 giornate buttate contro le 14-18 di
tutti gli altri, e la catena è leggibile: meno buchi → meno giornate sotto la soglia → più partite vinte a
parità di talento. **La copertura paga due volte, e nessuna delle due strade passa per chi compri in
cima.**

Un numero da non leggere male: punti in classifica ↔ crediti spesi legge **−0,177**, ma è **confuso dal
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

> **RISCRITTI nel §20 la notte del 02/09/2026**, dopo che i dati veri hanno fatto o superato metà
> di questa lista: `CAUTIOUS_CAP_SHARE` è stato riancorato e trovato inerte, `URGENCY` chiesto ai
> dati, `ABUNDANCE` è passato al solo braccio motore, e il NULL rifatto ha cambiato di segno.

1. **Lo SWEEP delle quattro manopole dichiarate dentro il braccio vincente**, che è la ragione per cui
   questo banco esiste: `URGENCY` (1,8), `CAUTIOUS_CAP_SHARE` (0,15), `ABUNDANCE` (1,0), `CLUB_PENALTY`
   (0,45). Nessuna è stata chiesta ai dati. Regola di casa: **niente al bordo della griglia**, e il
   cross-fit leave-one-out come fa `sweep`.
2. **Rifare il NULL** (§5.1) sulla configurazione attuale, e questa volta con un braccio cieco **nel
   codice** invece di una variante usa-e-getta: quel +22,3 precede tre cambiamenti e i suoi numeri sono
   stati ritirati come non citabili.
2-bis. **Togliere l'ambiguità di `auction_level`**, che è il residuo del rilievo 8 della review: quella
   funzione collassa un codice mantra e un ruolo di listone in **una stringa sola**, quindi nessuna
   funzione che legga solo quella stringa può distinguere `a` (ala) da `A` (attaccante). Oggi l'unica
   cosa che le separa è il CASO delle lettere, e un test lo punta; la cura vera è far viaggiare il
   VOCABOLARIO accanto allo slot, che è un cambio alla forma del foglio e non a un lookup.
3. **Il mercato di riparazione**, che è la sola cosa che cambierebbe l'ordine dei profili: chi lascia buchi
   oggi è punito per intero, e la lega gli darebbe tre finestre per curarli.
4. **Il profilo TIFOSO**, ora che il club di ogni uomo viaggia nell'estrattore: serve solo la tabella di
   rivalità dichiarata. Due cose da misurare, una volta accesa: quanto costa il premio su un club, e se
   rinunciare a interi ruoli costa più del premio.
5. **La seconda quantità del §9.2 come CANALE**: le giornate sotto i 66 sono governate dai buchi, quindi
   oggi la copertura le cura già indirettamente. Vale la pena chiedersi se esista una forma che le cura
   *direttamente* — ma prima di costruirla, la regola di casa: **chiedersi cosa può cambiare il suo
   output**, perché se la risposta è «gli stessi acquisti della copertura» non è un canale nuovo.

---

## 13. La review del 2 settembre 2026: otto rilievi, tre misurati

Chiesta dall'operatore («fai una review del codice») sulle 3.700 righe dei due commit del 01/09, e chiusa
sempre su sua richiesta («fixa tutto»). Vale registrarla perché **cinque degli otto rilievi sono in codice
o documentazione MIEI, appena spediti**, e tre sono stati trovati misurando e non rileggendo.

| # | dove | cosa | esito |
|---|---|---|---|
| 1 | `bench.py` | il pavimento «non tenere crediti» **tagliato dal tetto di reparto**: l'asimmetria dichiarata curata non lo era | **+6,7 punti**, spesa 933 → 988, posizione 1,90 → 1,70 |
| 2 | doc §8 + 5 file | il **«+2,4»** non si riproduce | corretto a **+1,5**; il compagno +10,8 si riproduce esatto |
| 3 | `player-ratings.ts` | il commento spedito diceva «27 punti … più del surplus di un attaccante top» | corretto: **18,8** e per un undici **non comprabile**, marginale +1,5 |
| 4 | doc §5 / §9.1 | due tabelle di fantapunti su **calendari diversi** (38 e 36 giornate) affiancate senza dirlo | nota aggiunta: 70,14 contro 70,45 **a giornata** |
| 5 | `bench.py` | `Team` accettava un `budget` che `role_cap` e `season` **ignoravano** | chiuso, latente e mai esercitato |
| 6 | `extract.py` | una riga di **144 caratteri** con 17 spazi in mezzo, impronta di una patch mangiata dal heredoc | riformattata |
| 7 | `squad-table` | l'optional chaining deciso in **due modi** per un campo obbligatorio | **RILIEVO SBAGLIATO**: la «cura» non compila, vedi sotto |
| 8 | `categories.py` | `bars_for` regge **solo sul caso delle lettere**, e il docstring dichiarava l'impossibile | tabella classic case-insensitive, docstring corretto, **collisione puntata da un test** |

**Tre cose che questa review insegna più dei rilievi.**

**Il difetto più grosso penalizzava il braccio che stavo giudicando.** Il rilievo 1 rendeva il motore più
povero di 55 crediti, quindi ogni margine pubblicato prima era **conservativo e non lusinghiero**. È il
verso opposto di quello che si teme, e va detto proprio per questo: la direzione di un errore fa parte
dell'errore.

**Il «+2,4» è la regola di casa applicata a me stesso.** «Un coefficiente citato senza la sua provenienza
non è un fatto»: qui la provenienza c'era (la costruzione era scritta), e proprio per questo si è potuto
rifare il conto e trovarlo sbagliato. Il compagno che si riproduce *esatto* è quello che ha localizzato
l'errore nel quantile invece che nel meccanismo — **quando due numeri escono dalla stessa funzione e uno
solo si riproduce, il colpevole è l'ingresso**.

**E la costanza è passata da «costa 8,2» a INERTE**, che è un risultato migliore e non lo stesso detto
meglio: a peso 0, 1 e 5 il braccio legge la stessa cifra alla prima decimale, perché il tetto di reparto
morde prima. Trovato col test che distingue «effetto piccolo» da «canale spento» — **dare al peso un
valore assurdo** (20, poi 100) e guardare se qualcosa si muove. Un canale che non si muove nemmeno a
venti volte il suo peso non è un canale debole: è un canale che non arriva.

**E un rilievo su otto era SBAGLIATO, bocciato dal compilatore.** Il 7 leggeva come un'incoerenza il
fatto che il template scriva `man.rating?.steady?.share` e il TypeScript `man.rating?.steady.share` su un
campo che l'interfaccia dichiara obbligatorio. Togliendo la seconda guardia: `TS2532: Object is possibly
undefined`. **Il `?.` di un template Angular non è il `?.` di TypeScript**: cortocircuita solo l'accesso
immediato, non il resto della catena. Non erano due opinioni su un campo, erano **due linguaggi**, e la
ragione è adesso scritta accanto al codice così che il prossimo non la "semplifichi" un'altra volta.
La lezione generale: **una differenza fra un file e il suo template non è per forza una decisione non
presa** — prima di uniformare due dialetti, chiedersi se sono la stessa lingua.

E una del mio arnese di verifica, perché è la stessa famiglia: il primo controllo del valore marginale
sostituiva **il portiere** col p90 di un attaccante (che è più basso) e leggeva −1,0. Verificare la
funzione, non la cella che le assomiglia — settima istanza, questa volta dentro una review.


---

## 14. L'asta a ESTRAZIONE RANDOM (2 settembre 2026)

Richiesta dell'operatore: «l'asta che dovrò affrontare sarà ad **estrazione RANDOM** del calciatore che
andrà in asta». Non è un cambio d'ordine con qualche conseguenza: è un gioco diverso, e la prima cosa da
misurare non è chi vince ma **cosa fa il meccanismo**, a strategie ferme.

Una domanda è stata fatta prima di scrivere una riga, perché le due risposte portavano a due lavori
diversi: estrazione libera su tutto il listone, o a blocchi di ruolo (prima i portieri, poi i difensori)?
La risposta è **libera**, e tutto quello che segue è misurato su quella.

### 14.1 Cosa fa l'urna, prima di ogni strategia

Stessa lega, stesso listone, stesse regole, stessi profili: cambia solo chi decide quale nome sale sul
banco. Dieci finestre, venti estrazioni ciascuna.

| | a chiamata | a estrazione |
|---|---|---|
| dei 50 migliori per valore del motore, quanti restano **INVENDUTI** | 0,1 | **14,3** |
| il lotto più caro dell'asta, in quota di un budget | 31,2% (26-35%) | 18,4% (**11-48%**) |
| quanto è andato via il migliore del listone | 31,2% | 10,8% (**0-35%**) |
| crediti che il tavolo riesce a spendere, su 1000 | 978 | **709** |
| buchi in una stagione, per partecipante | 25,4 | **50,0** |
| pagato / Qt.I, primo decimo dei lotti … ultimo decimo | 1,13 … 4,78 | **1,30 … 5,03** |

**L'estrazione SPRECA la cima del listone.** Quattordici dei cinquanta migliori non li compra nessuno:
escono quando le rose sono già piene. E quanto costa il migliore smette di essere una sua proprietà —
estratto presto vale un terzo di un budget, estratto tardi resta invenduto. Tutto quello che una
strategia può fare sta a valle di questo.

**Un partecipante, una finestra, venti urne: sd 170 fantapunti**, contro sd 199 fra le dieci stagioni
stesse. **Il sorteggio conta quasi quanto la stagione**, ed è per questo che `--random` prende un numero
di ESTRAZIONI: una sola misura la fortuna di quell'ordine e nient'altro.

### 14.2 Il braccio che vinceva a chiamata finisce QUINTO SU SEI

2665,5 → **2276,1** punti, posizione media 1,90 → 7,75, buchi 12,4 → **69,0**. Il meccanismo non è
sottile: `cover_value` è grande finché un reparto è vuoto, quindi il braccio lo paga al **primo** uomo di
quel ruolo che esce, e niente gli dice che dietro ce ne sono altri trenta. Ha comprato difensori attesi in
15-24 giornate dove a chiamata ne comprava da 23-29.

Due regole lo curano, e sono la stessa domanda che questo progetto si fa dappertutto: **qual è lo zero di
questo numero?**

- **LO ZERO DI UN'OFFERTA È CHI VERREBBE COMPRATO AL POSTO SUO** (`ALT_WEIGHT` = 0,75). Il surplus
  sottrae già chi **giocherebbe** al posto suo — il marginale di rosa della lega. All'urna serve l'altra
  sottrazione, e *quale* uomo sia è **contato e non scelto**: se `k` partecipanti hanno ancora un posto
  libero in quel ruolo, i migliori `k` rimasti se li dividono uno a testa, quindi l'alternativa è il
  `k`-esimo (`Urn.nth`, `ALT_RANK` = 1). Sweep su griglia pre-registrata 0 … 1, venti estrazioni per
  ognuna delle dieci finestre: **2276,1 → 2568,0 (+12,8%), 10 finestre su 10 in miglioramento, la
  peggiore +6,7%**, buchi 69,0 → 22,5, posizione 7,75 → 2,90. L'ottimo è **interno** (0,70 legge 2563,5,
  0,80 legge 2560,0, 1,00 ricade a 2477,8). È 0,75 e non l'1,0 che scriverebbe la teoria perché
  l'alternativa è **ottimista**: dà per scontato che quel posto lo vinca tu, e contro dieci rivali spesso
  non è vero.
- **«SPENDILI O LI PERDI» NON VUOL DIRE COMPRARE CHIUNQUE** (`FLOOR_ON_BETTER`). Il pavimento di spesa
  esiste perché nessuno finisca con i crediti in tasca; all'urna sparava sul **primo** lotto, perché
  l'uomo sul banco non è più il più caro rimasto. A estrazione **un posto in rosa è scarso quanto un
  credito** — la lezione del banco draft incontrata a metà strada — quindi quel pavimento non spendeva un
  credito, sprecava un POSTO, e il credito restava in tasca lo stesso. Vale 2486,8 → 2565,8, buchi 33,4 →
  22,9, posizione 4,34 → 2,79.

**Tutte e due sono spente a chiamata, e non da un flag che qualcuno deve ricordarsi**: lì `Urn.random` è
falso, `alternative` risponde 0 e il cancello che la legge non può scattare. **Misurato prima di
restringerle così**: sulle dieci finestre a chiamata il termine vale +0,3% (sotto il pavimento dello 0,5%
di questo progetto) con una finestra a −5,6%, cioè **fallisce il criterio robusto lì** e lo passa
largamente qui. Una manopola appartiene al meccanismo su cui è stata misurata, come appartiene a una
piattaforma.

### 14.3 Lo sweep, e le due cose misurate e lasciate a zero

| `ALT_WEIGHT` | punti | sd | posizione | buchi | spesi | stagioni vinte |
|---|---|---|---|---|---|---|
| 0,00 (il braccio di prima) | 2276,1 | 184,8 | 7,75 | 69,0 | 898 | 2/200 |
| 0,50 | 2505,9 | 118,5 | 4,15 | 29,8 | 842 | 30/200 |
| 0,60 | 2551,0 | 95,2 | 3,18 | 22,0 | 774 | 56/200 |
| 0,70 | 2563,5 | 105,5 | 2,93 | 21,4 | 636 | 60/200 |
| **0,75** | **2568,0** | 112,2 | **2,90** | 22,5 | 560 | **66/200** |
| 0,80 | 2560,0 | 118,4 | 3,13 | 25,2 | 500 | 62/200 |
| 0,90 | 2522,7 | 141,5 | 3,82 | 32,7 | 377 | 52/200 |
| 1,00 | 2477,8 | 155,4 | 4,67 | 40,3 | 318 | 30/200 |

**`ALT_RANK` resta a 1 anche se 2 misura un filo meglio** (2572,8 a `ALT_WEIGHT` 0,75). Le due manopole
sono **un effetto solo** — quanta parte del valore d'opzione si sottrae — e tutta la superficie fra loro è
piatta dentro lo 0,5%. Due numeri fittati per una quantità sola è il modo in cui un banco comincia a
fittare sé stesso: sopravvive quello il cui compagno è **contato** (`k` = chi ha ancora bisogno di quel
ruolo) e non tarato.

**`LIVE_RATE` è misurata e spenta.** Rileggere il tasso a metà asta — la stessa legge di conservazione di
`engine_rate`, applicata a quello che è rimasto nell'urna — vale **+0,4%** (2486,8 → 2497,5), sotto il
pavimento, e la spesa che doveva correggere si muove da 739 a 748. Stessa forma di `STEADY_WEIGHT`: non è
un canale debole, è **un canale che non arriva**. Quello che ha davvero smesso di farlo tesoreggiare è il
cancello sul pavimento, e per la ragione **opposta** a quella che questo termine assume — non spendeva
troppo poco, spendeva sugli uomini sbagliati.

### 14.4 Il risultato, e il null

| profilo | sedie | punti | sd | posizione | buchi | spesi | stagioni vinte |
|---|---|---|---|---|---|---|---|
| **MOTORE** | 1 | **2568,0** | 112,2 | **2,90** | **22,5** | 560 | **66/200** |
| P4 top d'attacco | 2 | 2427,8 | 163,5 | 5,45 | 46,6 | 733 | 30/400 |
| P3 equilibrato | 3 | 2420,0 | 171,7 | 5,53 | 47,5 | 742 | 62/600 |
| P1b senza piano, novizio | 2 | 2408,9 | 184,5 | 5,57 | 51,4 | 899 | 34/400 |
| P2 difesa | 1 | 2258,4 | 235,6 | 7,64 | 73,5 | 705 | 4/200 |
| P1a senza piano, esperto | 2 | 2206,3 | 226,1 | 8,41 | 80,8 | 689 | 4/400 |

**L'esperto crolla, ed è un risultato e non un difetto.** `EXPERT_EYE` mescola il suo tetto verso quello
che il surplus del motore dice del calciatore — il sostituto verificabile di «sa valutare al momento
l'asta». A chiamata vale 13 punti; a estrazione lo porta da metà classifica all'**ultimo posto**, sotto il
novizio che legge solo la quotazione. **Leggere un valore senza il valore d'opzione è peggio che non
leggerne nessuno**, perché il surplus da solo dice «costa poco per quello che dà» di un uomo dietro al
quale ce ne sono dieci migliori in fila.

**IL NULL: tre sedie al motore su tredici partecipanti.** Una strategia che vince solo perché gli altri
sprecano non è una strategia. Il margine si stringe e regge: **2506,2 contro 2414,8** del miglior umano
(a estrazione), 2548,9 contro 2471,3 (a chiamata), con la spesa dei bracci che risale da 560 a 734 — la
concorrenza sugli stessi uomini è esattamente ciò che rimette su i prezzi. Lascia però **0,73 posti a
testa non riempiti**, che è il prezzo della pazienza quando in tre la praticano insieme.

### 14.5 Il campionato, sorteggiato

| profilo | sedie | punti classifica | posizione | titoli | fantapunti | giornate <66 | buchi |
|---|---|---|---|---|---|---|---|
| **MOTORE** | 1 | **61,0** | **3,03** | **70/200** | 2429,8 | **14,8** | 20,7 |
| P3 equilibrato | 3 | 47,8 | 5,10 | 57/600 | 2291,4 | 20,9 | 45,2 |
| P4 top d'attacco | 2 | 46,5 | 5,40 | 35/400 | 2274,9 | 21,6 | 48,2 |
| P1b senza piano, novizio | 2 | 45,1 | 5,74 | 27/400 | 2254,3 | 22,3 | 52,4 |
| P2 difesa | 1 | 42,3 | 6,12 | 10/200 | 2219,6 | 23,5 | 56,0 |
| P1a senza piano, esperto | 1 | 31,3 | 8,26 | 1/200 | 2021,3 | 29,8 | 86,7 |

**35% di titoli contro il 10% che darebbe una monetina**, e contro il **50%** del meccanismo a chiamata:
la differenza non è la strategia, è l'urna. Il `--json` porta adesso tutte e due le letture e nessuna può
nascondere l'altra — `windows` è il dettaglio completo di **un** ordine per finestra, `all` è ogni
estrazione nella forma compatta che serve all'aggregato. La pagina pubblicata lo dice a schermo: il
dettaglio è una delle venti, non la media.

### 14.6 Un numero pubblicato che è stato RITIRATO

Il README diceva «il migliore del listone esce fra il 48% e il 75% del budget, media 60% — il numero che
l'operatore riporta dall'esperienza». **Non si riproduce.** Rimisurato sul codice attuale, dieci finestre,
col braccio motore al tavolo e senza: **31,2% (26-35%), identico nei due casi.** Era stato preso su
quattro stagioni e sulla configurazione del 01/09 mattina — prima del sorteggio sui pareggi e prima della
cura sul pavimento del portafoglio, che sono esattamente le due cose che muovono quanto costa un lotto
conteso.

Resta scritto invece che cancellato, perché era stato **citato all'operatore come accordo con la sua
esperienza**, e un accordo che non si riproduce vale meno del disaccordo che lo sostituisce. E se al suo
tavolo il numero vero è davvero il 60%, quello che dice non è che il meccanismo sbaglia: dice che **la
scarsità di questo banco è troppo bassa**, cioè che l'urna qui è corta (§14.7).

### 14.7 Limiti che questo meccanismo AGGIUNGE

- **L'urna qui è più corta di quella vera.** Il file di estrazione porta 359-430 nomi per 275 posti (1,4
  per posto); un listone completo ne porta molti di più, quindi al tavolo vero gli scarti sono più
  numerosi e i buoni più diluiti. La scarsità qui è **maggiore**, e con essa i prezzi — ed è la prima cosa
  da sospettare di qualunque numero di questa pagina che sembri troppo stretto.
- **Il mercato di riparazione non c'è**, che era già vero e adesso costa di più: i buchi raddoppiano, e
  chi ne lascia è punito per intero da un banco che non gli dà tre finestre per curarli.
- **Il tavolo non conosce il valore d'opzione.** Nessuno dei cinque profili applica la regola che applica
  il braccio, quindi il margine è misurato contro avversari che non ce l'hanno. Il null a tre sedie è
  quello che risponde, e risponde solo per il braccio contro sé stesso.

### 14.8 Cosa servirebbe per rendere MISURATO quello che qui è dichiarato

L'operatore ha offerto **dati veri di aste, random e non**. La cosa che quei dati deciderebbero, e che
oggi è dichiarata, è la **curva pagato/Qt.I in funzione di QUANDO un nome esce**: qui la produce il
modello (1,30 → 5,03 per decimo), e con un archivio di aggiudicazioni **in ordine cronologico** la si
misura. Il prompt di raccolta è stato consegnato lo stesso giorno; le tre cose che servono e senza le
quali una fonte non serve sono l'**ordine** delle aggiudicazioni, la **Qt.I di quel listone** (non la
Qt.A, che è rivista in corsa) e i **crediti pagati**. Con quella curva diventano misurabili anche
`ABUNDANCE` e il pavimento, che oggi sono i due numeri che decidono quanto un tavolo spende.

## 15. I DATI VERI (2 settembre 2026): 147 aste, e quattro anomalie che diventano misure

L'operatore ha portato l'archivio che il §14.8 chiedeva — `docs/real-data/`, letto dal database di
produzione il **02/09/2026**: **147 aste** sul listone ufficiale (19/08 → 01/09/2026, stagione 2026-27,
tutte classic Serie A a crediti), di cui **131 con la sua stessa rosa 3/8/8/6** e **20 identiche alla
sua** (10 squadre, 1000 crediti). Sono **29.421 aggiudicazioni** su 1.177 rose. Le tre cose che il
documento diceva servire — l'**ordine** delle aggiudicazioni, la **Qt.I di quel listone** e i **crediti
pagati** — ci sono tutte e tre.

Con quell'archivio il banco cambia natura: quello che era **dichiarato** (quanto paga un tavolo) diventa
**misurato**, e i cinque profili restano dichiarati ma il loro *livello* no. È la stessa distinzione che
il progetto fa fra la stampa e la board: **i dati veri sono un GIUDICE**, e dove entrano come input lo
dicono.

### 15.1 Le quattro anomalie dell'operatore, con il loro null

Le sue parole del 02/09, e accanto il numero vero:

| la sua obiezione | il banco (prima) | **il vero** | il banco (dopo) |
|---|---|---|---|
| «non è realistico che L.Martinez non venga preso» | 14,3 dei 50 migliori invenduti | **1,75** | **1,3** |
| «P2 … almeno 3 [top di difesa] devono essere suoi» | 2 di 8 a chiamata, 0-1 a estrazione | ≥3 top di ruolo: 4% delle rose | **3,8** |
| «P4 deve puntare sul TOP in attacco … lo attende» | il top preso in 1 finestra su 2 | il più caro = 42,8-44,1% di un budget | **50% / 43,5%** |
| «costi distribuiti in maniera troppo equilibrata» | gini 0,07-0,17 su 4 profili di 10, **zero** uomini sotto i 5 crediti | gini **0,65-0,68**, **8-9,5** uomini di 25 a ≤5 crediti | gini 0,59-0,62, 4,3-6,9 uomini |

Aveva ragione su tutte e quattro, e la quarta era la più grossa: quattro partecipanti su dieci
chiudevano l'asta con **nessun** uomo sotto i 5 crediti e 23-25 uomini nella fascia 21-60. Una rosa vera
ne ha 8-9 a due-cinque crediti e mette il **28-31% del proprio budget su un uomo solo**.

### 15.2 La causa era UNA per tutte e quattro: la scala era indicizzata sulla cosa sbagliata

`PROFILES` è una scala di disponibilità a pagare: «per l'n-esimo uomo di un reparto, il multiplo della
Qt.I a cui arrivo». Il gradino era scelto da **quanti uomini di quel reparto la rosa possedeva già** — e
quello è lo stesso numero del *tier* **solo se i lotti sono chiamati dal più caro**, perché lì il primo
difensore che incontri È il migliore rimasto. A estrazione è un numero diverso, e la ricetta si leggeva
«pago 1,5 volte la richiesta per il primo difensore che mi capita»: P2 incontrava il **90esimo difensore
del listone** e gli pagava il premio da titolare, poi non aveva più niente per Dimarco.

Il gradino ora è indicizzato su `max(tier, posseduti)`, dove il **tier** è il rango dentro il ruolo
diviso il numero di squadre — una legge di conservazione e non una scelta: in una lega da dieci ci sono
dieci primi difensori, perché ognuno ne schiera uno. Le due metà servono tutt'e due: la prima è quello
che la scala voleva dire da sempre, la seconda è quello che impedisce a un profilo di comprare otto
primi difensori al prezzo del primo.

### 15.3 La SCALA DI MERCATO, misurata (e non è piatta da nessuna parte)

Mediana di `pagato / richiesta` dentro il tier, 131 aste, normalizzata sul montepremi di ogni asta
perché un'asta da 16 squadre non deve pesare più di una da 6:

| | tier 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| **P** | 1,25 | 0,34 | 0,50 | | | | | |
| **D** | 0,87 | 0,69 | 0,50 | 0,43 | 0,23 | 0,24 | 0,18 | 0,19 |
| **C** | 1,18 | 0,83 | 0,62 | 0,50 | 0,25 | 0,25 | 0,16 | 0,21 |
| **A** | **2,38** | 1,34 | 0,92 | 0,30 | 0,18 | 0,18 |

Un tavolo vero paga **2,38 volte** la richiesta per un attaccante di prima fascia e **0,16-0,25** dalla
quinta in giù. È esattamente la frase dell'operatore — «offrire poco (1-5 crediti) per i pezzi comuni e
aumentare il rilancio solo per i pezzi veramente pregiati» — e quello che ha sostituito era un **1,0
piatto su ogni gradino** per i due profili senza piano, sbagliato dalle due parti insieme.

Regala anche la spartizione fra i reparti, che nessuno ha più bisogno di dichiarare: **P 9,1% · D 16,3% ·
C 27,2% · A 47,4%**. Quasi metà dei soldi va a sei uomini su venticinque. (Mediana per rosa 9/16/27/48,
p10 4/8/17/32, p90 14/25/38/62.) Da confrontare con `role_shares` del braccio motore, che dal surplus
ricava D 32,4% e A 33,8%: non è un errore — è una valutazione che dissente dal mercato — ma è la ragione
per cui il braccio non compra mai un top d'attacco.

**La MEDIANA e non il rapporto delle somme, e la scelta non è cosmetica.** Il rapporto delle somme
(`Σpagato / Σrichiesta` dentro il tier) vale 1,03-1,06 volte la mediana in cima a un reparto e
**1,4-1,7 volte** in coda, perché una manciata di riempimenti viene comprata in chiusura con quello che
resta in tasca. Quell'inflazione è **vera** e questo banco la produce da sé (`scale` sale quando una rosa
finisce i posti): metterla anche nella scala la conterebbe due volte, e misurato la conta — il rapporto
delle somme dà **2,7** uomini sotto i 5 crediti contro **4,3** della mediana, su un vero di 8,0. **Una
scala è il tetto di un acquisto ORDINARIO.** Quello che la mediana lascia per strada è la conservazione:
sommata sui tier recupera solo il **79%** del montepremi, quindi un piano prezzato su di lei parte con
una scala di **1,21** e il meccanismo mette il resto. Che è la divisione del lavoro giusta, ed è
verificata: i crediti che restano in tasca vengono **2,8%** di un budget a chiamata contro un vero di
**2,8%**.

**Un limite dentro la prima fascia, detto invece di spalmato.** Un tier è larga `TEAMS` uomini perché
quella è la legge di conservazione, e dentro la prima fascia dell'ATTACCO la scala vera continua a
scendere: rango per rango legge 2,81 · 3,36 · 2,15 · 2,60 · 3,01 · 2,23 e poi 1,79 · 1,23 · 1,89 · 1,90.
I sei attaccanti più cari costano più dei quattro dietro di loro, e questo banco li prezza tutti e dieci
uguale.

### 15.4 «Nessuno resta con i crediti in tasca» non è un pavimento: è una NORMALIZZAZIONE

Il pavimento era «quello che il portafoglio si può permettere per posto rimasto», rivendicato da ogni
uomo sul banco. Con 1000 crediti e 25 posti dice **«40 a testa»** del miglior attaccante del listone e
del 200esimo difensore, e **era la prima causa dei costi troppo equilibrati**. Al suo posto (`Team.scale`)
la ricetta è normalizzata su quello che resta da spendere: il piano ancora da eseguire è la scala sui
posti ancora da riempire, prezzata a quanto chiede ogni tier, e il numeratore è il portafoglio. Chi ha
risparmiato rialza da sé, chi ha strapagato si raziona — **nella forma del proprio piano**, che è la metà
che un pavimento piatto non sapeva fare.

**E la variante «niente scala a chi non ha un piano» è stata scritta e RESPINTA dalla misura**, benché
l'argomento fosse di casa (una scala decrescente è un piano di razionamento, dare un piano a chi non ne
ha uno è il difetto del 01/09): P1a chiude con il **49% a chiamata e il 71% a estrazione** in tasca, e il
residuo aggregato passa da 2,8% (= il vero) a 6,0% e 22,9%. La ragione è che la scala di mercato è
quello che il mercato **paga**, quindi chi offre esattamente quella vince solo la metà dei suoi uomini e
non riesce a spendere il portafoglio. **Qui la scala non è un piano: è la legge che trasforma un prezzo
in un tetto.**

### 15.5 Il posto tenuto per un campione: CONTATO, non dichiarato

«Su 10 persone qualcuno dovrebbe conservare un posto in rosa aspettando proprio il campione, rinunciando
completamente a rilanciare su altri — il rischio vale per un top di ruolo», e in generale «conservare
almeno uno o due posti per qualche occasione alla fine». Nessuno rifiutava L. Martinez per mancanza di
soldi: le rose erano **piene** quando veniva estratto, perché 77 attaccanti entrano in 60 posti.

La regola non ha una costante (`Team.keeps`): se `hands` partecipanti vogliono ancora quel ruolo, gli
uomini migliori rimasti nell'urna vanno uno per testa, quindi la quota di questa rosa è il loro numero
diviso le mani alzate — e finché quella quota copre tutti i posti che le restano lì, lasciar passare
questo non costa niente. È il conto che `Team.alternative` fa per un CREDITO, fatto per un POSTO: la
lezione del banco draft, «a estrazione un posto è scarso come un credito».

**Le due forme DICHIARATE che sono venute prima erano peggiori e restano a verbale**: tenere l'ultimo
posto di un reparto finché è in arrivo un uomo di **prima** fascia lascia 7,73 dei 50 migliori invenduti
(quelli rifiutati sono i secondi e terzi dei reparti affollati), ed estenderlo alla **seconda** fascia
porta a 10,67. Una soglia sposta il problema di un gradino invece di risolverlo. **Zero posti restano
vuoti**, che è il rischio che la regola si prende.

### 15.6 IL DIFETTO STRUTTURALE: a un'asta a estrazione vera L'URNA SI RIMESCOLA

È la cosa più grossa che questi dati abbiano trovato, e non era nella lista dell'operatore. Nelle **cinque
aste il cui ordine di estrazione è ricostruibile**, ognuno dei 518 nomi quotati viene estratto **da 5 a 9
volte**, e **Martinez L., Malen, Dimarco, Paz N. e Thuram compaiono fra le estrazioni su cui nessuno ha
offerto** e vengono venduti dopo. Un'asta a estrazione **non è un giro sul listone**: continua a estrarre
finché le rose non sono piene.

Il banco modellava un giro solo, e quel giro solo produceva da sé tre dei numeri pubblicati:

- «**14,3 dei 50 migliori restano invenduti**» — artefatto. Col rimescolo sono **1,3**, contro **1,75**
  vero.
- «**il miglior giocatore va dallo 0% (mai aggiudicato) al 35% del budget a seconda di QUANDO esce**» —
  artefatto, e la parte «mai aggiudicato» sparisce (0 volte su 60).
- «un nome rifiutato non ha un sostituto garantito dietro» — la frase su cui poggia `ALT_WEIGHT`. Un nome
  rifiutato **torna**, quindi quel parametro va rimisurato sul meccanismo che esiste (§15.8).

Il rimescolo è **il regolamento della piattaforma**, non una strategia: non ha parametri, e un'asta a
chiamata resta un giro solo perché lì è il manager a scegliere chi mettere all'asta e nessuno chiama un
uomo che nessuno vuole.

### 15.7 Quello che ancora NON torna, con il suo numero

Un uomo solo, in 36 urne vere: **Malen costa il 42,2% di un budget se aggiudicato nel primo 40% dell'asta
e il 42,5% dopo**, `r(quando, prezzo) = −0,147`. Martinez L. 37,7% e −0,207, Ramos G. 32,6% e −0,086. Il
prezzo di un campione **non dipende da quando esce**. Sul banco, dopo tutte le correzioni di oggi, lo
stesso uomo costa il **38,1%** se estratto nel primo quarto e l'**1,3%** nell'ultimo, `r = −0,904`.

La diagnosi è nei residui per decimo, non nel prezzo: i nostri partecipanti spendono nei decimi 3-7 e
arrivano all'ultimo quarto col portafoglio vuoto, mentre un tavolo vero ce li ha ancora.

> **CHIUSO la sera del 02/09 (§16), e la cura proposta qui era SBAGLIATA.** «Tenere da parte i soldi del
> miglior uomo ancora nell'urna» è stata scritta e misurata: lascia il **22,3%** dei crediti in tasca e
> non muove il campione di un decimale (r −0,913 → −0,925), perché il vincolo era il POSTO e non il
> credito. Quello che era rotto è l'**ORDINE** — un'asta vera si gioca a reparti, P→D→C→A — più l'indice
> della scala, che prezzava il campione come un quinto attaccante. Dentro la sua fase il banco ora legge
> 47,0 · 42,0 · 42,0 · 40,5 contro un vero di 43,1 · 45,4 · 37,6 · 34,7.

**E una lezione sull'indice che ha quasi fatto sbagliare la diagnosi.** La curva `indice_prezzo` per
decimo dell'asta (che `sintesi-posizione.csv` porta già calcolata) legge, a estrazione, 0,95 · 0,54 ·
0,55 · 0,51 · 0,66 · 0,85 · 0,78 · 1,00 · **1,69** · 1,11: sembra un mercato che risparmia all'inizio e
si azzuffa in chiusura. **Non è pulita dalla composizione**: l'indice divide per la Qt.I, ma il rapporto
pagato/richiesta **cresce col calciatore** (2,38 per un attaccante di prima fascia, 0,19 per un difensore
di ottava), e nel nono decimo gli aggiudicati hanno una Qt.I media **1,42 volte** quella dell'asta. Il
picco è in buona parte *chi* viene aggiudicato lì, non *quanto* si paga. Il test che decide è quello per
uomo, sopra — ed è per quello che ne è valsa la pena: la prima cura scritta su quella curva (un pavimento
d'urgenza quando l'urna non basta più ai posti aperti) è stata **misurata e respinta**, perché non produce
il picco (nono decimo 0,26 contro 0,45) e costa 2,8 → 1,7 punti di residuo.

### 15.8 Il braccio MOTORE contro un tavolo realistico: il margine era il loro spreco

Il verdetto pubblicato — «vince a chiamata di +122 punti, e a estrazione con `ALT_WEIGHT` = 0,75 di
+12,8%» — era misurato contro un tavolo che pagava 40 crediti a testa per chiunque, non teneva mai un
posto e lasciava invenduti i campioni. Contro il tavolo calibrato sulle 131 aste vere:

| | prima | ora |
|---|---|---|
| a chiamata | 2665,5 punti, posto medio 1,70 | **2604,2**, posto **4,40**, 0 titoli su 10 |
| il tavolo, a chiamata | ~2414-2477 | **2539,5** |
| a estrazione | ~2568, posto 2,90 | **2087,3**, posto **10,67 su 11**, 99,1 buchi, 674 crediti spesi su 1000 |
| il tavolo, a estrazione | ~2414 | **2536,5** |

Il tavolo ha guadagnato ~120 punti diventando realistico, e il braccio ne ha persi 480. **La frase che
questo progetto aveva già scritto — «una strategia che vince solo perché il tavolo butta i suoi soldi non
è una strategia» — era vera, e i dati veri l'hanno misurata dall'altro lato.**

E non è la taratura di `ALT_WEIGHT`: rimisurata su tutta la griglia 0…1, a chiamata è **inerte** (identica
a ogni punto, che conferma che niente di pubblicato lì dipende da lei) e a estrazione **ogni punto della
griglia è ultimo** (il migliore è 0,5 con 2293,4, l'adottato 0,75 con 2087,3). Due sonde per capire
perché: **senza il tetto di reparto** il braccio crolla anche a chiamata (2459,1, posto 9,00 — quel tetto
è essenziale), e con i **tetti alzati di una volta e mezzo** guadagna a chiamata (2624,4, posto 3,50) e
non recupera a estrazione (2160,9). 
Rimisurata anche **col rimescolo attivo** (§15.6), perché la giustificazione di `ALT_WEIGHT` era proprio
«un nome rifiutato non ha un sostituto garantito»: la griglia legge gli stessi numeri a un punto decimale
(0,00 → 2265,7 · 0,50 → 2292,9 · 0,75 → 2105,4 · 1,00 → 1942,5, posto 10,0-10,9 su ogni punto). Quindi il
crollo del braccio non è nemmeno un effetto del meccanismo nuovo: è il tavolo.

La diagnosi è di LIVELLO e non di forma: `engine_rate` tara i suoi
tetti perché i 25 uomini che vuole costino esattamente un budget, mentre un tavolo vero mette il 47% del
montepremi in attacco e il 2,38 della richiesta sul primo attaccante. Il braccio perde ogni uomo
contendibile e compra quello che nessuno vuole.

### 15.9 I cinque profili esistono davvero? Sì, e ne mancavano due

k-means sulle quote di reparto più la concentrazione, **1.177 rose vere**, k=5:

| quota | P | D | C | A | top1 | a ≤2 crediti | chi è |
|---|---|---|---|---|---|---|---|
| 25,7% | 9% | 16% | 30% | 44% | 25% | 37% | equilibrato, con la coda a un credito |
| 23,6% | 8% | 14% | 23% | 55% | 34% | 27% | **P4** |
| 23,2% | 9% | 18% | 28% | 45% | 22% | 15% | **P3** |
| 14,0% | 8% | 11% | 19% | **63%** | **46%** | 42% | *un campione e la manovalanza* |
| 13,5% | 12% | **24%** | **38%** | 26% | 18% | 23% | *rinuncia al top d'attacco* (parente di **P2**) |

Tre dei cinque gruppi sono i suoi. I due che mancavano sono dichiarati e **seduti fuori** dal tavolo
dichiarato, perché chi siede al suo tavolo è una sua decisione e non una misura:

- **P5 «rinuncia al top d'attacco»** (13,5%): spende il 62% fra difesa e centrocampo contro il 43,5% del
  mercato, e il suo acquisto più caro è il 18% del budget contro il 26% della mediana. È lo specchio di
  P4 e non è un P3 con un'altra faccia.
- **P6 «un campione e la manovalanza»** (14%): il 63% del budget in attacco, il **46% su un uomo solo** e
  il 42% della rosa a due crediti o meno. È P4 portato al limite, e paga il prezzo sul resto della rosa.

Due cose che la stessa tabella dice sui profili esistenti: **possedere 3+ top di ruolo in un reparto è
raro** (P 1% · D 4% · C 3% · A 1% delle rose), quindi P2 come lo vuole l'operatore è una strategia vera e
**rara** — e il banco gliene fa prendere 3,8, cioè un po' più del suo stesso obiettivo; e la mediana è
**un** top di ruolo per reparto, p90 due.

### 15.10 La soglia mentale dei 500: CONFERMATA dalla misura

«La soglia mentale dei 500 difficilmente si supera» era dichiarata. Su 29.421 acquisti veri: il p99,9 di
un singolo acquisto è il **52,1%** di un budget, il massimo il **73,0%**, e sopra la metà del budget ci
sono **39 acquisti (0,13%)**, cioè **0,30 per asta**. «Difficilmente» misurato vale un acquisto ogni tre
aste. Il p50 è l'**1,6%** (16 crediti su 1000) e il p90 il **9,9%**.

E il numero che il §13 aveva **ritirato** ora ha una risposta: il più caro di ogni asta costa il **42,8%**
di un budget a chiamata (mediana, 18-73%) e il **44,1%** a estrazione (36-73%). Il ricordo dell'operatore
(«48-75%, media 60%») era più vicino al vero del 31,2% che il banco misurava; il ritiro era giusto e la
sostituzione è questa. Il banco ora legge 50,0% a chiamata e 43,5-45,3% a estrazione.

### 15.11 I più pagati: gli stessi nomi, e l'urna concentra

Sui 20+ tavoli come il suo, i 25 uomini più pagati sono **16 attaccanti · 6 centrocampisti · 2 portieri ·
1 difensore** a chiamata e 15/7/2/1 a estrazione — praticamente gli stessi nomi nei due meccanismi.
**Malen** (Qt.I 34) è l'uomo più caro dell'asta in **74 aste su 86** a chiamata e in **25 su 36** a
estrazione, al 42,5-43,5% di un budget; poi Martinez L. (37,2-38,2%), Ramos G. (30,5-32,4%), Hojlund
(26,2-30,2%), Thuram, Kolo Muani, Kean.

**Il meccanismo non cambia chi, cambia quanto si concentra.** I sette più cari costano **di più** a
estrazione (da +1,0 a +4,0 punti di budget; solo Thuram fa −1,8), mentre l'uomo mediano costa **meno**
(1,0% → 0,6%) e solo **72 uomini su 292** sono più cari a estrazione. Lo stesso si legge nella scala:
l'attacco di prima fascia va da 2,31 a **2,50** e la difesa dalla quinta all'ottava fascia da 0,25-0,26 a
**0,14-0,17**. A estrazione i soldi si ammassano sui pochi nomi che contano.

### 15.12 Cosa questi dati NON possono dire

- **Non c'è l'esito sportivo.** Sono aste, non stagioni: quale strategia *paga* resta una domanda del
  banco, e i dati veri tarano l'ambiente, non il verdetto.
- **`modalita` è il setup di lega, e l'ordine si può cambiare in corsa.** 17 delle 131 aste sono finite su
  un ordine diverso (11 alfabetico, 4 per-valore), e **13 di quelle sono fra le 36 «random»**. Le **20
  aste identiche alla sua** non hanno **nessun** cambio d'ordine, quindi i numeri di concentrazione e del
  più caro sono puliti; la scala di mercato, misurata su tutte e 131, no.
- **L'ordine di estrazione esiste solo per cinque aste**, ricostruito dal seme e verificato: il database
  registra gli acquisti, non le estrazioni. Il rimescolo (§15.6) è misurato lì, e il numero di giri
  (5-9 passate) viene da quelle cinque.
- **I ruoli non sono nel file leggero**: sono stati riattaccati per **identità** dal nostro `rosters`
  (`fc_id` è la chiave primaria di questo progetto), 574 dei 587 quotati, 98%.
- **11 aste hanno i residui non verificati** (l'host ha corretto i budget a mano) e sono escluse dalla
  misura della tasca, non stimate.

## 16. Allineare il banco alla realtà (2 settembre 2026, sera): l'ORDINE era il difetto

Il §15 aveva lasciato tre scarti misurati e una diagnosi che si è rivelata sbagliata. Chiuderli ha
richiesto **una correzione al meccanismo** e due all'indicizzazione, e ha bocciato tre cure scritte prima
di essere misurate. Lo strumento che ha trovato tutto è uno solo: **la curva della spesa cumulata**, che
il §15 non aveva guardato.

### 16.1 Lo strumento: quanto del montepremi è già uscito, decimo per decimo

Non l'indice per decimo (che il §15.7 aveva già dichiarato sporco di composizione), ma i **crediti**:

| | 1° | 2° | 3° | 4° | 5° | 6° | 7° | 8° | 9° | 10° |
|---|---|---|---|---|---|---|---|---|---|---|
| **vero, a chiamata** | 9,0 | 18,6 | 24,8 | 27,8 | 40,5 | 50,4 | 54,3 | 77,0 | 95,5 | 100 |
| **banco, ordine libero** | **46,1** | 65,6 | 78,3 | 85,9 | 90,8 | 94,4 | 96,7 | 98,3 | 99,4 | 100 |
| **vero, a estrazione** | 8,8 | 13,7 | 18,6 | 23,9 | 30,9 | 40,7 | 50,4 | 61,9 | 87,2 | 100 |
| **banco, ordine libero** | 9,3 | 21,2 | 35,2 | 48,1 | 60,2 | 71,5 | 83,0 | 92,1 | 98,4 | 100 |

Un tavolo vero tiene in tasca **il 70% dei crediti** fino a metà asta e ne spende il 38% negli ultimi due
decimi; il banco ne aveva speso il 60% a metà. E a chiamata era fuori scala di **cinque volte** nel primo
decimo. Nessuna cura di comportamento può spostare una curva così: è la forma dell'ordine.

### 16.2 IL DIFETTO: un'asta si gioca A REPARTI, e questo banco la giocava tutta insieme

Posizione media dell'aggiudicazione dentro l'asta, per ruolo, sulle **20 aste identiche alla sua**:

| | P | D | C | A | a reparti? |
|---|---|---|---|---|---|
| 16 aste su 20 | **0,06** | **0,28** | **0,60** | **0,88** | sì, e sempre P→D→C→A |
| le altre 4 | ~0,5 | ~0,5 | ~0,5 | ~0,5 | no, ordine libero |

**Quei quattro numeri sono identici a due decimali su sedici sessioni separate**, che è la firma di un
ordine imposto dalla piattaforma e non di un'abitudine di qualcuno — e sono esattamente dove il
REGOLAMENTO mette i confini: 3 portieri su 25 posti, poi 8 difensori, poi 8 centrocampisti, poi 6
attaccanti. Dentro un reparto l'ordine è casuale (la deviazione standard della posizione dentro un ruolo
è 0,06-0,13 contro 0,29 di un'estrazione sparsa su tutta l'asta). In aggregato: 81 aste a chiamata su 86
e 32 a estrazione su 36.

Adottato (`bench.PHASES`, `in_phases`, e le due funzioni d'ordine che le leggono). **Cosa spiega, tutto
insieme e senza aggiungere un comportamento**: la curva della spesa (che è la spartizione fra reparti — P
9,1 · D 16,3 · C 27,2 · A 47,4 — accumulata in quest'ordine e nient'altro); il fatto che gli uomini cari
siano aggiudicati tardi (sono ATTACCANTI); e che il prezzo di un campione non dipenda da quando esce,
perché ovunque esca è dentro la fase d'attacco, quando ogni rivale ha ancora tutti e sei i suoi posti e i
soldi che ha tenuto per loro. L'ordine libero resta raggiungibile (`--free`) perché 4 aste su 20 lo
giocano, ed è quello su cui sono misurati i numeri dell'invenduto del §15.

Dopo l'adozione la curva a chiamata legge **8,3 · 19,9 · 24,1 · 25,6 · 40,0 · 48,1 · 50,5 · 78,3 · 98,1
· 100** contro il vero **9,0 · 18,6 · 24,8 · 27,8 · 40,5 · 50,4 · 54,3 · 77,0 · 95,5 · 100**. È la
verifica più stretta che questo banco abbia mai superato, e non è una taratura: le fasi non hanno
parametri.

### 16.3 «Il campione prezzato come un quinto attaccante»: l'indice contava gli uomini sbagliati

Con le fasi, il campione cade sempre nella fase d'attacco, quindi la sua prova va letta **dentro la sua
fase** — che è anche come è misurata quella vera (Malen finisce nel blocco attaccanti 34 volte su 36).

| dentro il blocco d'attacco | 1° quarto | 2° | 3° | 4° |
|---|---|---|---|---|
| **vero** (Malen, 36 urne) | 43,1% | 45,4% | 37,6% | 34,7% |
| **vero** (Martinez L.) | 36,8% | 41,0% | 35,0% | 27,8% |
| banco, prima | 47,8% | 31,0% | 12,3% | **1,6%** |
| **banco, ora** | 47,0% | 42,0% | 42,0% | **40,5%** |

La causa l'ha trovata una **fotografia del tavolo nel momento in cui il campione esce**: nove mani con un
posto in attacco, crediti [12, 12, 50, 68, 106, 145, 177, 369, 513] — e le tre offerte più alte
**184, 150, 150**. Chi aveva 513 crediti offriva 184, cioè `2,38 × richiesta × scala` con una scala di
0,54; e i due 150 erano il tetto cauto di P3. Ma il numero che contava era un altro: `Team.step`
indicizzava la scala su **quanti uomini di quel reparto la rosa possiede**, quindi una rosa con quattro
attaccanti prezzava il miglior giocatore del gioco come il suo **quinto** — 0,18 volte la richiesta
invece di 2,38.

Corretto: l'indice conta gli uomini che possiede **almeno bravi come lui** (`ahead`), non quanti ne
possiede. La guardia per cui la metà «posseduti» esisteva regge intatta — chi compra un primo difensore
scende comunque di gradino per il successivo — e i quattro bersagli si muovono tutti nella direzione
giusta: uomini a ≤5 crediti **7,0 → 8,0** (vero 9,5), crediti in tasca **10,2% → 6,2%** (vero 6,1%),
primo quarto del campione **47,8% → 43,9%** (vero 43,1%).

### 16.4 Un OBIETTIVO è un NOME, non una fascia

Restava la pendenza dentro la fase. `PLAN` diceva «un attaccante di prima fascia», e letta così la riserva
si liberava **nel momento in cui P4 comprava il decimo migliore dei dieci**: dopo di che nessuno teneva
più soldi né posto per il campione, e chi lo trovava tardi lo pagava un credito.

Le parole dell'operatore dicono un'altra cosa: «deve puntare sul TOP in attacco
(L.Martinez/Thuram/ecc...) e **fa di tutto per prenderlo**». Un obiettivo è uno dei `count` uomini più
cari del ruolo, quindi il RANGO e non la fascia (`set_tiers` scrive `man["rank"]`, `Urn.rank_left` dice se
è ancora da estrarre). Con il rango, la riserva di P4 vale finché quel nome non è uscito, e il posto lo
segue: **un piano tiene il suo posto oltre ai suoi crediti**, e solo un piano lo fa.

Quella metà è la sola cosa di questa sera che sia dichiarata invece che contata, e la ragione è misurata:
data a **tutti** (ognuno tiene un posto per la migliore occasione ancora nell'urna) strozza l'asta —
**8,4 posti su 250 restano vuoti** e 18 dei 50 migliori invenduti, perché tutti e dieci aspettano lo
stesso uomo. Data ai due profili la cui strategia dichiarata È quell'uomo, costa al massimo tre posti su
tutto il tavolo. È la frase dell'operatore letta alla lettera: «su 10 persone **qualcuno** dovrebbe
conservare un posto in rosa aspettando proprio il campione».

### 16.5 Tre cure scritte e RESPINTE dalla misura

Restano a verbale perché ognuna sembrava ovvia:

- **Il conto sui crediti da solo** («quello che pagherei per la migliore occasione ancora nell'urna non è
  spendibile altrove»): i crediti in tasca passano da 5,3% a **22,3%** e il campione non si muove
  (r −0,913 → −0,925). Tengono i soldi e non hanno più il posto dove spenderli — il vincolo era il posto,
  non il credito.
- **Il conto sui crediti E sul posto, per tutti**: 8,4 posti vuoti per asta, 18 dei 50 migliori
  invenduti, tasca 23,3%. Dieci partecipanti che aspettano lo stesso uomo non sono dieci strategie, sono
  un'asta bloccata.
- **Un pavimento d'urgenza** («quando l'urna non basta più ai posti aperti, il posto vale la quota
  spendibile»): non produce il picco che doveva produrre (nono decimo 0,26 contro 0,45) e costa 2,8 → 1,7
  punti di residuo. Era scritta sulla curva sporca di composizione, cioè sull'indizio sbagliato.

### 16.6 Il tetto cauto: dal decimo percentile al p25, e adesso è inerte

`CAUTIOUS_CAP_SHARE` era **0,15** e nessuno l'aveva misurato. Nel dato vero l'acquisto più caro di una
rosa è il **14,8% del budget al p10, il 18,4% al p25 e il 25,0% alla mediana**, e solo il **10,4%** delle
1.177 rose lo tiene sotto il 15%: quel numero metteva P3 al decimo percentile della cautela, e con tre
sedie su dieci decideva il secondo prezzo dell'uomo più caro dell'asta. Ora è **0,18**, il p25 — «sta nel
quarto più cauto di un tavolo vero», che è quello che la frase dice — e a chiamata è anche il valore che
avvicina di più i crediti in tasca al vero (3,4% a 0,15, 2,5% a 0,18, 1,4% a 0,22, contro 2,8%).

**E adesso è quasi inerte**: su tutta la griglia 0,15 … 0,50 i quattro bersagli si muovono di meno di un
punto. Quello che sembrava un tetto vincolante era il sintomo dell'indice del §16.3. **Una manopola che
morde solo mentre un'altra cosa è rotta è una manopola da rimisurare dopo aver aggiustato quella, non
prima.**

### 16.7 Dove sta il banco adesso, contro i sette bersagli

| | a chiamata | vero | a estrazione | vero |
|---|---|---|---|---|
| curva della spesa | 8,3 … 98,1 | 9,0 … 95,5 | 6,5 … 83,8 | 8,8 … 87,2 |
| il lotto più caro | 50,0% | 42,8% | **43,5%** | 44,1% |
| uomini a ≤5 crediti | 5,6 | 8,0 | **8,1** | 9,5 |
| gini della spesa | 0,61 | 0,65 | **0,65** | 0,68 |
| crediti in tasca | 3,4% | 2,8% | **7,4%** | 6,1% |
| dei 50 migliori, invenduti | 0,0 | 0,0 | 1,4 | 1,75¹ |
| posti non riempiti | 0,00 | — | 0,00 | — |

¹ misurato sulle quattro aste vere a ordine libero; il nostro ordine libero legge 1,05.

Quello che resta fuori bersaglio è **la coda a chiamata** (5,6 uomini a cinque crediti contro 8,0, e il
lotto più caro al 50,0% contro 42,8%), e la ragione è strutturale e va detta: a un'asta a chiamata vera è
il MANAGER a scegliere quale nome mettere all'asta dentro il reparto in corso, mentre questo banco chiama
il più caro per primo. Il nostro campione è quindi sempre il primo attaccante chiamato, quando tutti hanno
ancora tutti i crediti d'attacco — e va a 50% invece di 42%. Sull'estrazione, dove l'ordine è esogeno da
tutt'e due le parti, cinque bersagli su sette sono dentro un punto e mezzo.

### 16.8 Le classifiche che ne escono, e una strategia che cambia verdetto

Con le fasi il campionato cambia di nuovo, e in un modo che ha senso: **P4 crolla a chiamata** (2365,4
fantapunti, ultimo, **68 buchi**) perché la sua ricetta risparmia «in maniera netta negli altri reparti»
e quei reparti ora si giocano **prima** — arriva alla fase d'attacco con i soldi e con una rosa che non
copre. A estrazione resta a metà tavolo. Il braccio motore recupera qualcosa a chiamata (2604,2 → **2628,3**,
posto 4,40 → **3,00**) e a estrazione resta **ultimo di undici** (2212,9 contro 2584,8 di P2): la
diagnosi del §15.8 non cambia di una virgola.

### 16.9 Due lezioni sull'arnese, e una vale oltre questo banco

**Una manopola girata dove nessuno la legge dà righe identiche, e quelle righe sono l'indizio.** Il primo
sweep del tetto cauto ha stampato gli stessi numeri a ogni valore da 0,15 a 0,50: `bench` importa la
costante per nome (`from .profiles import CAUTIOUS_CAP_SHARE`), quindi modificare
`profiles.CAUTIOUS_CAP_SHARE` non muove niente. È la stessa famiglia del `desc_level_gap` che non
esisteva, vista dal lato di un esperimento invece di un audit — e come là, **la prima cosa da sospettare
di un risultato piatto è lo strumento**.

**E la fotografia batte il ragionamento.** Tre cure sono state scritte e respinte ragionando su curve
aggregate; la causa vera l'ha trovata stampare, per un lotto solo, chi aveva ancora un posto, quanti
crediti aveva e quanto offriva. Il progetto lo aveva già scritto per il pannello Tk («fotografa la SUA
finestra prima di rispiegare il codice»): vale identico per un meccanismo.

## 17. Far vincere il braccio MOTORE all'urna (2 settembre 2026, notte)

Domanda dell'operatore: «dobbiamo fare in modo che la strategia dell'engine riesca a creare una rosa
equilibrata, solida e vincente, quali accorgimenti possiamo adottare?». Il braccio all'urna era **ultimo
di undici** (2212,9 contro 2584,8 del miglior umano, 79,8 buchi, 656 crediti spesi su 1000). Adesso è
**primo** (2609,0 · posto 3,82 · 22,4 buchi · 987 spesi · 28 titoli su 100), e il campionato dice la
stessa cosa (54,7 punti in classifica, 45 titoli su 200, e i **meno buchi del tavolo**).

Sette famiglie di correzione sono state misurate. **Una sola conta**, e non è quella che sembrava.

### 17.1 La fotografia, di nuovo, e prima del ragionamento

Ruolo per ruolo, sui lotti che il braccio PERDE, quanto era il suo tetto rispetto al prezzo:

| | P | D | C | A |
|---|---|---|---|---|
| tetto / prezzo sui lotti persi, a estrazione | 0,47 | **0,30** | **0,16** | 0,20 |
| pagato / richiesta su quelli che prende | 0,66 | **0,15** | **0,10** | 0,31 |
| gli stessi due numeri a chiamata | 0,69 · 0,95 | 0,85 · 0,82 | 0,79 · 0,72 | 0,63 · 1,32 |

Non perde di un soffio: **offre un quinto**. E quello che prende lo paga un decimo della richiesta, cioè
compra solo gli scarti — l'acquisto mediano del braccio costa **1 credito** contro i 15 del tavolo, e il
**30,7%** dei suoi uomini è previsto sotto le 19 giornate contro il 17,9%. A chiamata lo stesso codice
offre 0,63-0,85 e spende 987.

### 17.2 Il difetto è di SCALA, e il conto dei buchi lo diceva già

79,8 buchi contro 20,6 del miglior umano, a `HOLE_COST` = 4,73 sono **266 dei ~370 punti** che gli
mancavano. Ma i buchi sono il sintomo: la causa è che il braccio prezza un uomo in **fantapunti**
(`engine_worth` = surplus + copertura) e converte con un tasso globale, mentre il mercato lo prezza come
**multiplo della sua richiesta**, fascia per fascia — ed è quella scala che conserva i crediti. *Un
offerente i cui tetti non vivono sulla stessa scala dei prezzi non può vincere un lotto contendibile a
nessun livello*: alzali e strapaga il primo uomo di ogni fase, abbassali e non compra niente.

Le componenti di una singola offerta, fotografate (T2, prima urna):

| | richiesta | surplus | copertura | alternativa | tetto reparto | offre | venduto a |
|---|---|---|---|---|---|---|---|
| Bastoni | 56 | 16,6 | 130,1 | 133,0 | 45 | **45** | 84 |
| Vecino | 21 | 7,9 | 92,5 | 148,2 | 63 | **1** | 1 |
| Thuram | 102 | 44,5 | 129,6 | 142,6 | 112 | **145** | 253 |
| Martinez L. | 119 | 43,3 | 130,4 | 155,6 | 161 | **214** | 402 |

### 17.3 Sei famiglie misurate e respinte, con i loro numeri

Restano a verbale perché ognuna aveva un argomento, e due lo avevano buono:

- **`ALT_WEIGHT`** (il valore d'opzione). Rimisurato sulla griglia 0…1 con le fasi: l'ottimo si sposta da
  0,75 a **0,5** e vale **+5,2%** (2224 → 2340). È il migliore dei sei e non basta. La ragione per cui
  si sposta è la stessa lezione delle fasi: dentro un reparto «arriva qualcuno di meglio» è quasi sempre
  vero, quindi aspettare non informa più.
- **L'alternativa sottratta solo sul SURPLUS**, non sulla copertura. L'argomento è forte — `cover_value`
  è il valore di *non lasciare un posto vuoto*, non una proprietà dell'uomo, quindi le due coperture si
  annullano e il braccio finisce per prezzare tutti al margine — e vale **+3,5%**, meno del semplice
  `ALT_WEIGHT` 0,5. Diagnosi giusta, cura insufficiente.
- **I buchi attesi ESATTI** (Poisson-binomiale sulle quote, come `expected_r_factor`) al posto di
  `min(quota, deficit)`: **−0,3%** all'urna, +0,0% a chiamata (e i buchi a chiamata 10,8 → 8,6). Una
  formulazione più pulita senza guadagno misurabile.
- **Il tetto di reparto**: `URGENCY` 3 e 5 (+0,0% e −0,6%), pesato sul valore invece che spalmato sui
  posti (−0,5%), niente tetto (−0,6% all'urna e **−9,9% a chiamata**, dove resta essenziale).
- **Il tasso ricalibrato sulla quantità che l'offerta usa davvero** (`engine_worth` invece del solo
  surplus — una vera incoerenza: la legge di conservazione è letta su una quantità e l'offerta ne usa
  un'altra, tre volte più grande): **−10,4%**. I tetti diventano minuscoli.
- **Le quote di reparto del mercato** al posto delle nostre: −0,1% all'urna, **+1,0% a chiamata**.

### 17.4 Quello che ADOTTIAMO: la scala del mercato, inclinata sulla difesa

`profiles.engine_ladder()`. Il braccio, a estrazione, offre come un umano competente — `passo(fascia) ×
richiesta × scala` — dove la scala di partenza è quella **misurata sulle 131 aste vere** e il passo è
inclinato:

- **`ENGINE_BACK` = 1,9** su portieri e difensori;
- **`ENGINE_TOP` = 2,2** sulle prime quattro fasce di ogni ruolo;
- e tutto **rinormalizzato** perché il piano costi un budget: *un tilt che non conserva non è una
  strategia, è un portafoglio più grande.*

Effettivamente: ~1,7 volte il mercato sulle prime quattro fasce della DIFESA, ~0,9 sulla cima di C e A,
e 0,4-0,8 sulle code. **È la strategia di P2, trovata dalla ricerca invece che copiata** — e il
regolamento dice perché paga: i due modificatori di questa lega si pagano in **voti BASE** (il mod.dif
sulla media dei tre difensori migliori, l'R-Factor su tutti gli undici) e i voti base sono quello che
consegna una linea difensiva.

> **I PORTIERI sono usciti dal tilt il §19.1**, e non per eleganza: la griglia li cercava insieme alla
> difesa e non li ha mai chiesti a parte. Chiesti, la loro metà vale **niente** (+0,1%, 4 finestre su
> 10) e spende 100 crediti in porta invece di 58, mentre tiltare i **soli** portieri è −1,6%.

| | prima | ora |
|---|---|---|
| fantapunti, 10 finestre × 10 urne | 2212,9 | **2609,0** |
| posto medio su undici | 10,27 | **3,82** |
| buchi in una stagione | 79,8 | **22,4** |
| crediti spesi su 1000 | 656 | **987** |
| R-Factor · mod. difesa | 1,8 · 2,4 | **10,9 · 12,6** |
| titoli | 0 su 100 | **28 su 100** |
| scarto dal miglior umano | −371,8 | **+54,5** |

> **RIMISURATO nel §18 a DIECI partecipanti e venti urne, e tre di questi numeri si spostano.** Il
> guadagno dell'adozione (un confronto APPAIATO) migliora: **+20,2%**, 10 finestre di 10, peggiore
> **+12,6%**. Lo scarto dal miglior umano scende da +54,5 a **+21,3** e il null a tre bracci da «+6,9,
> resta primo» a **−2,8, un pareggio** — erano confronti NON appaiati su dieci urne, cioè rumore. E il
> tavolo giocava a undici partecipanti dove tutto è calibrato per dieci.

Verdetto nel vocabolario del gate: **STRICT**, 10 finestre di 10 migliorano, la peggiore **+10,1%**.
L'ottimo è **interno** sulla griglia allargata (back 1,3…2,3 × top 1,3…3,5: i vicini leggono 2584,6 ·
2584,9 · 2604,0 · 2569,9 contro 2609,0), ma il plateau è **piatto entro l'1%** — quindi la *direzione* è
il risultato e i due decimali non lo sono.

### 17.5 Tre cose che vanno dette perché sono la metà scomoda

**Il nostro ORDINAMENTO non aggiunge niente.** La stessa scala letta sul rango di **PREZZO** invece che
su quello del motore dà **+12,4% contro +12,3%**: identico. Quello che il braccio guadagna qui non è
un'opinione migliore sui calciatori — è offrire su una scala che può vincere un lotto. Il vantaggio
informativo sul listone, speso così, vale **zero**, e `metrica-asta-surplus-v1.md` §18 lo aveva già
misurato largo un numero solo (le presenze).

> **ANNOTATO dal §21 la notte stessa: il vantaggio valeva zero perché non veniva LETTO.** Contando le
> chiamate, all'urna il braccio non invoca una sola funzione del motore — la scala prezza `richiesta ×
> passo(fascia)` e la fascia la definisce il PREZZO. Quindi questo confronto misurava due volte lo stesso
> offerente di mercato. Speso DENTRO la fascia, sulle presenze, lo stesso vantaggio vale **+1,02% robust**
> e sopravvive a tre bracci. La frase che resta vera di questo paragrafo è la seconda: *quello che il
> braccio guadagnava qui non era un'opinione migliore sui calciatori, era offrire su una scala che può
> vincere un lotto* — e il §21 aggiunge l'opinione accanto, non al suo posto.

**E le nostre quote di reparto sono ridondanti col tilt.** Sulla scala non inclinata valgono +1,1%
(il surplus dice P 14,5 · D 20,1 · C 28,2 · A 37,2 contro il mercato 9,1 · 16,3 · 27,2 · 47,4, cioè
pende dalla stessa parte); sulla scala inclinata costano **−1,2%** e migliorano 2 finestre su 10. Il tilt
le assorbe, quindi il parametro è stato **togliuto** invece di restare non letto.

**E il margine NON sopravvive alla propria concorrenza**, che è più forte di come lo avevo scritto
prima («resta primo per 6,9 punti»): rimisurato a dieci partecipanti e venti urne, con **tre** sedie al
braccio il margine sul miglior umano è **−2,8**, cioè un pareggio (80 titoli su 600, il 13,3% contro il
10% del caso). La maggior parte del vantaggio a una sedia È esclusività. Il meccanismo è misurato: i
portieri di prima fascia passano da 0,62 a **0,85** della richiesta quando tre bracci li vogliono
insieme, e ogni braccio ne prende 8,7 invece di 9,9. Vedi §18.2.

### 17.6 E a CHIAMATA non si tocca niente

La stessa scala a chiamata **perde**: 2575,7 contro 2628,3, 3 finestre su 10, peggiore −7,8%. Quindi è
accesa **dal meccanismo** (`Urn.random`) e non da un flag che qualcuno deve ricordarsi, esattamente come
`ALT_WEIGHT` è spento lì. *Un parametro appartiene al meccanismo su cui è stato misurato*, e a chiamata
il braccio in fantapunti resta il migliore del tavolo (posto 3,00, 10,8 buchi).

### 17.7 Un difetto trovato per la seconda volta nello stesso modo

La prima corsa col codice adottato leggeva **identica** a quella di prima: `one_auction` aggiunge il
braccio motore **dopo** il ciclo che consegna `asks` a tutti, quindi il braccio non li aveva e il dispatch
non scattava. È la seconda volta in una sera che una tabella identica a se stessa denuncia una manopola
girata dove nessuno la legge (la prima era `profiles.CAUTIOUS_CAP_SHARE`, §16.9). **Righe identiche non
sono un risultato: sono un guasto dello strumento**, e vanno sospettate prima della conclusione.

## 18. DIECI contro DIECI, e tre numeri del §17 ritirati (2 settembre 2026, notte tarda)

Due osservazioni dell'operatore, entrambe giuste, ed entrambe hanno spostato numeri pubblicati poche ore
prima. Vale la pena leggerle nell'ordine in cui sono arrivate, perché la seconda è nata dalla prima.

### 18.1 «I dati reali parlano di aste a 8 o a 10 partecipanti … nelle nostre simulazioni invece abbiamo 11 o 13?»

Sì, e era un difetto. `bench.py` metteva il braccio motore come **undicesimo** partecipante al tavolo
dichiarato di dieci, e il null a tre bracci ne faceva **tredici** — mentre tutto quello contro cui il
banco è calibrato dice DIECI: `rules.TEAMS` = 10, `to_credits` conserva dieci budget sui 250 uomini che
dieci rose comprano, una FASCIA è un rango diviso dieci, e il livello di sostituzione dietro ogni surplus
è il 10 × posti-esimo uomo. Undici partecipanti portano il **10% di soldi e posti in più** di quello che
la calibrazione assume; tredici il **30%**. (`league.py` non ha mai avuto il difetto: le sue dieci lettere
comprendono il braccio.)

Curato con `bench.seated`: **il braccio prende una sedia, non se la aggiunge**. Chi cede il posto è
dichiarato e deterministico — il profilo che in quel momento ha più sedie, a pari merito il primo
dichiarato — così l'opposizione resta il più possibile la miscela dell'operatore: con tre bracci il suo
2 · 2 · 1 · 3 · 2 diventa 1 · 1 · 1 · 2 · 2, e ogni profilo che ha descritto è ancora al tavolo.

**E la scala di mercato è stata rimisurata sulle 60 aste vere a DIECI squadre** (di cui le 20 identiche
alla sua lega), invece che su tutte e 131. Costo del cambio: quasi nullo — la normalizzazione sul
montepremi stava facendo il suo lavoro — e il movimento più grosso è la terza fascia del centrocampo
(0,62 → 0,74). La popolazione adesso è quella giusta, e **quella è la ragione, non la dimensione del
cambiamento**.

### 18.2 I tre numeri del §17 che vanno ritirati

Rimisurati a **dieci** partecipanti e **venti** urne per finestra (200 stagioni per il braccio, 600 per
il null), il verdetto dell'adozione **migliora** e i due numeri di contorno **crollano**:

| | §17 (11 partecipanti, 10 urne) | **ora (10 partecipanti, 20 urne)** |
|---|---|---|
| il guadagno della scala di mercato | +17,9% · 10/10 · peggiore +10,1% | **+20,2% · 10/10 · peggiore +12,6%** |
| il braccio, prima | 2212,9 · posto 10,27 · 79,8 buchi · 656 spesi | 2161,9 · posto 9,68 · 87,9 · 590 |
| il braccio, ora | 2609,0 · posto 3,82 · 22,4 buchi · 987 spesi | **2599,6 · posto 4,29 · 22,5 · 989** |
| scarto dal miglior umano | +54,5 | **+21,3** |
| il null a tre bracci | +6,9, «resta primo» | **−2,8, un pareggio** |

**Cosa regge e perché.** Il guadagno dell'adozione è un confronto **appaiato** — lo stesso braccio, sulle
stesse urne, con e senza la scala — quindi il campione più grande lo *conferma* e lo rafforza. Lo scarto
dal miglior umano e il null sono confronti **non appaiati** (una media contro il massimo su cinque
profili), quindi erano rumore: il +54,5 era la coda di un campione da 10 urne, e a 20 urne legge +21,3.

**E il null va detto come sta.** A tre bracci il braccio non «resta primo per 6,9 punti»: legge **−2,8**
contro il miglior umano, cioè un pareggio, con 80 titoli su 600 (13,3%) contro il 10% del caso. La frase
giusta è che **il vantaggio non sopravvive in modo misurabile alla propria concorrenza**: la maggior
parte del margine era esclusività. Il meccanismo è misurato e non è un'ipotesi — i portieri delle prime
quattro fasce, che sono il bersaglio del tilt, passano da **0,62 a 0,85 della richiesta** e i difensori da
0,96 a 1,05 quando tre bracci li vogliono insieme, e ogni braccio ne porta a casa 8,7 invece di 9,9.

Quello che il null **non** dice è che l'adozione sia sbagliata: a una sedia sola — che è il tavolo
dell'operatore — il braccio è primo con 38 titoli su 200 contro il 10% del caso, e il confronto appaiato
è strict su tutte e dieci le finestre.

### 18.3 «≤5 crediti è una soglia ASSOLUTA … magari rivedi questo valore»

Giusto, e la misura ha dato una risposta migliore della correzione che stavo per fare. Su 600 rose vere a
dieci squadre, quanti dei 25 uomini costano meno di X:

| soglia | budget 500 (360 rose) | budget 1000 (200 rose) | stabile? |
|---|---|---|---|
| ≤ 5 crediti | 10,7 | 8,5 | **no** — è la soglia che il §16 usava |
| **a 1 credito** | **6,1** | **5,7** | **sì** |
| ≤ 0,2% del budget | 6,1 | 6,5 | quasi |
| ≤ 0,5% | 7,4 | 8,5 | no |
| **≤ 1,0% del budget** | **10,7** | **11,0** | **sì** |

Quindi il bersaglio non è più «≤5 crediti» ma **due conti liberi dal budget**: gli uomini presi al
**minimo** (un credito) e quelli sotto l'**1% del budget**. Il fatto grosso che ne esce: **il 24% di
tutti gli acquisti veri costa un credito o meno**, e la distribuzione del prezzo di un acquisto in quota
del budget legge p10 0,20% · p25 0,30% · p50 1,60% · p75 4,80% · p90 10,00%.

**E il bersaglio nuovo scopre un difetto che quello vecchio nascondeva.**

| | a chiamata: banco / vero | a estrazione: banco / vero |
|---|---|---|
| uomini a **un credito** | **1,8 / 5,7** | **2,5 / 6,7** |
| uomini sotto l'**1% del budget** | 9,9 / 10,5 | 10,7 / 11,7 |
| il più caro, quota della spesa | 24,0% / 27% | 26,2% / 30% |
| i primi tre | 50,1% / 51% | 51,9% / 55% |
| gini della spesa | 0,60 / 0,63 | 0,60 / 0,67 |
| crediti in tasca | 3,3% / 1,7% | 3,1% / 4,7% |

La **coda** del nostro mercato è giusta (9,9 contro 10,5), il **fondo** no: i nostri tavoli pagano 2-5
crediti dove un tavolo vero paga UNO. La causa è che ogni nostro partecipante ha un tetto positivo per
ogni uomo (il gradino di coda, 0,17-0,21 della richiesta), quindi con dieci offerenti il secondo prezzo
non arriva quasi mai a uno; a un tavolo vero nove manager su dieci **non offrono affatto** sul fondo del
listone, e quel nome va al minimo. È il **24% del mercato** che ha una forma diversa dalla nostra.

Detto con la sua conseguenza, che è piccola: sono ~3,9 uomini per rosa pagati ~4 crediti invece di 1,
cioè **12 crediti su 1000**. Non muove un verdetto; è un difetto di calibrazione della *forma* del
mercato, non della strategia, e sta a verbale perché una soglia scelta bene lo ha reso visibile e una
scelta male lo nascondeva.

## 19. Le simulazioni rifatte, e la strada da prendere (2 settembre 2026, chiusura)

Rieseguito tutto sul setup corretto — **dieci partecipanti**, le fasi per reparto, la scala di mercato
misurata sulle 60 aste vere a dieci squadre, il braccio che prende una sedia invece di aggiungersene una
— e con una correzione in più trovata strada facendo.

### 19.1 Il tilt sui PORTIERI non era guadagnato

La griglia del §17 cercava `ENGINE_BACK` su portieri e difesa **insieme** e non li ha mai chiesti a
parte. Chiesto:

| tilt su | punti | posto | buchi | crediti in porta | scarto dal miglior umano |
|---|---|---|---|---|---|
| portieri + difesa | 2605,4 | 4,06 | 22,7 | **100** | +22,7 |
| **solo difesa** | **2608,3** | 4,16 | 20,8 | **58** | +27,8 |
| solo portieri | 2563,3 | 5,37 | 28,9 | 137 | −32,1 |
| nessuno dei due | 2579,0 | 5,17 | 27,5 | 67 | +5,7 |

La metà portieri vale **niente** (+0,1%, 4 finestre su 10) e costa 42 crediti di portafoglio spesi in
porta; tilterei i soli portieri è **−1,6%**. Quindi i portieri escono dal tilt, e la ragione è la regola
di casa applicata al caso in cui morde: **a pari merito sopravvive la forma che non porta un'istruzione
non misurata**, e questa ne portava una visibile — «offri 136 crediti per un portiere di prima fascia»,
dove il mercato ne paga 81.

### 19.2 La classifica finale, dieci partecipanti

**Fantapunti in una stagione**, dieci finestre × venti urne (200 stagioni per riga a estrazione):

| a estrazione | punti | sd | posto | buchi | speso | R | dif | titoli |
|---|---|---|---|---|---|---|---|---|
| **braccio motore** | **2605,5** | 107 | **4,17** | 22,1 | 991 | 10,8 | 12,9 | **42/200** |
| P2 difesa | 2585,5 | 116 | 4,64 | 23,5 | 987 | 10,4 | 13,8 | 38/200 |
| P1b senza piano, inesperto | 2569,3 | 111 | 5,03 | 26,5 | 990 | 9,1 | 10,8 | 41/400 |
| P1a senza piano, esperto | 2547,0 | 92 | 5,80 | 21,0 | 984 | 8,9 | 11,1 | 26/400 |
| P3 equilibrato | 2541,5 | 105 | 5,92 | 28,8 | 977 | 8,2 | 9,9 | 37/400 |
| P4 top d'attacco | 2523,8 | 113 | 6,34 | 32,0 | 911 | 7,1 | 8,1 | 16/400 |

A chiamata: braccio **2647,4** (posto 3,70 · 10,5 buchi · 4 titoli su 10), poi P2 2598,8 · P3 2595,7 ·
P1b 2592,9 · P1a 2589,1, e **P4 ultimo a 2473,0 con 43,4 buchi**. Il campionato a estrazione dice la
stessa cosa: braccio 54,6 punti e **49 titoli su 200** (24,5% contro il 10% del caso), P2 52,3, P4 45,3.

**Tre letture, e la terza è la più utile all'operatore.** Il braccio è primo su tutt'e due i meccanismi.
Il miglior umano è **P2, la difesa**, su tutt'e due. E **P4 — inseguire il top d'attacco — è ultimo su
tutt'e due**, che è l'archetipo più diffuso nei dati veri (il 37% delle rose): il mercato strapaga quel
nome, e chi lo compra paga il conto in copertura (32,0 buchi contro i 22,1 del braccio).

### 19.3 La ricetta in CREDITI, per la sua lega

La ricetta adottata è un multiplo della richiesta, e la richiesta è la Qt.I riscalata sul montepremi.
Con la mediana per fascia misurata sulle **20 aste vere identiche alla sua** (10 squadre, 1000 crediti)
diventa un listino:

| reparto | fascia | richiesta | **offri fino a** | il mercato paga | chi ci sta (nomi veri) |
|---|---|---|---|---|---|
| portieri | 1ª | 62 | 77 | 81 | Svilar, Martinez Jo., Carnesecchi |
| | 2ª-3ª | 28 · 4 | 10 · 2 | 11 · 2 | Mandas, Falcone · Corvi, Motta |
| **difensori** | **1ª** | 60 | **97** | 54 | Dimarco, Molina N., Wesley |
| | **2ª** | 48 | **63** | 35 | Kalulu, Solet, Stones |
| | **3ª** | 33 | **32** | 18 | Ramon, Vasquez, Cambiaso |
| | **4ª** | 32 | **25** | 14 | Dragusin, Valeri, Bartesaghi |
| | 5ª-8ª | 28 → 12 | 2-5 | 2-6 | Comuzzo, Bellanova, De Winter |
| centrocampisti | 1ª | 95 | 107 | 112 | Paz N., McTominay, Calhanoglu |
| | 2ª-4ª | 58 → 40 | 48 · 34 · 19 | 50 · 36 · 20 | McKennie, Atta, Conceicao |
| | 5ª-8ª | 32 → 16 | 1-4 | 3-8 | Cristante, Frattesi, Lobotka |
| attaccanti | 1ª | 107 | **234** | 247 | Martinez L., Malen, Thuram |
| | 2ª | 65 | 83 | 87 | Davis K., Berardi, Krstovic |
| | 3ª | 52 | 42 | 45 | Castro S., Santos A., Pinamonti |
| | 4ª-6ª | 37 → 16 | 1-9 | 3-9 | Bowie, Bonny, Kvernadze |

**Detta in una riga: i quattro difensori migliori sono l'investimento, tutto il resto è al prezzo del
mercato o sotto.** Le quote di reparto che ne escono sono P 9,8% · **D 25,4%** · C 23,9% · A 40,9%
contro il mercato 9,1 · 16,3 · 27,2 · 47,4 — quindi la difesa vale nove punti di budget in più e
l'attacco sei in meno, e il portiere resta al prezzo di tutti.

E le tre istruzioni negative, che contano quanto quelle positive: **il portiere non si strapaga**, il
**primo centrocampista si paga il prezzo di tutti** (107 contro 112 — se qualcuno rilancia lo si lascia),
e il **top d'attacco si lascia andare** (234 contro 247: lo si perde circa metà delle volte, ed è il
piano). Dalla quinta fascia in giù si offre **1-5 crediti**, e sono ~13 uomini su 25.

### 19.4 Cosa questa strada NON promette

- **Il margine è piccolo.** +20 fantapunti sul miglior umano in una stagione da 36 giornate sono
  **+0,55 a giornata**, con una deviazione standard fra stagioni di 107. Vince il 21% delle volte contro
  il 10% del caso: è un vantaggio, non una certezza.
- **Non sopravvive alla propria concorrenza** (§18.2): con tre sedie che giocano così lo scarto è −2,8.
  Se al tavolo si mettono in due a comprare la difesa, i difensori di prima fascia passano da 0,62 a
  0,85 della richiesta e il vantaggio se ne va con loro.
- **Il fondo del mercato, qui, è più caro del vero** (§18.3): il banco prende 2,5 uomini a un credito
  dove un tavolo vero ne prende 6,7. Quindi al tavolo vero i riempimenti costeranno **meno** di quanto
  questa ricetta preveda — l'errore è nella direzione che aiuta.
- **I crediti assoluti sono la mediana delle sue venti aste**, non il suo listone: la fascia dice quanto
  pagare, il nome della fascia lo decide la Qt.I del listone dell'anno.

## 20. Prossimi passi, riscritti dopo i dati veri (2 settembre 2026, chiusura)

Il §12 è del pomeriggio e va letto sapendo che metà della sua lista è stata fatta o superata. Questa la
sostituisce.

> **ANNOTATO la notte stessa dal §21, e non riscritto.** La cosa più grossa che è venuta dopo **non era
> in questa lista**, perché la diagnosi che l'ha aperta non era ancora stata fatta: all'urna il braccio
> non leggeva un solo numero del motore, e metterci dentro le presenze *dentro la fascia* vale +1,02%
> robust su 800 stagioni e **sopravvive a tre bracci al tavolo** (+30,0, t 7,4), che è quello che il
> vantaggio della scala non faceva. Il §21.8 aggiunge un rifiuto misurato (il posto tenuto per «chi
> gioca», +0,25% e `t` 1,7) e il §21.3 una lettura che vale per gli item qui sotto: **la lista degli
> aperti si ordina per resa attesa, ma la resa più grossa può stare in una diagnosi invece che in un
> item** — quindi vale la pena chiedere, di ogni pezzo adottato, *quali numeri legge davvero*.
>
> **ANNOTATO di nuovo dal §22, e di nuovo non riscritto.** Il §22 chiude per misura la famiglia
> «leggere i rivali» (quattro forme, tutte respinte, la migliore a -2,7% **con l'informazione
> perfetta**), quindi nessun item qui sotto va in quella direzione. Apre invece due cose che non
> c'erano: la **DIREZIONE dei tempi** — il braccio compra troppo presto all'urna, fra +2,8% e +5,0% sul
> banco, non adottato perché l'archivio non ha mai visto quei prezzi (§22.5) — e la domanda nuova da
> fare al dato vero, *cosa costa un uomo quando un solo compratore ha ancora quel ruolo aperto*, che è
> l'unico numero che deciderebbe la prima. Il punto 2 qui sotto (il FONDO del mercato) è della stessa
> famiglia e sale di priorità: entrambi sono difetti di come il tavolo simulato si comporta quando
> quasi nessuno vuole più un lotto.

### 20.1 Fatti, e dove sono

- **`CAUTIOUS_CAP_SHARE`** (era il punto 1 del §12): riancorato da 0,15 (il **p10** della cautela reale) a
  0,18 (il p25), e trovato **quasi inerte** — §16.6. Quello che sembrava un tetto vincolante era il
  sintomo dell'indice della scala.
- **`URGENCY`**: chiesto ai dati (3,0 e 5,0 → +0,0% e −0,6%) dentro la ricerca sul braccio, §17.3.
- **`ABUNDANCE`**: non è più una manopola del tavolo, è del **solo braccio motore** — gli umani passano
  per `Team.scale`, §16.4.
- **Il NULL** (punto 2): rifatto a tre sedie **su dieci** e con l'ordine giusto, e il verdetto è cambiato
  di segno — **−2,8, un pareggio** invece del «+22,3» ritirato, §18.2. Resta aperta la metà procedurale:
  un braccio **cieco nel codice** invece di una variante usa-e-getta.

### 20.2 Aperti, in ordine di resa attesa

1. **Il mercato di riparazione**, che resta la sola cosa che potrebbe cambiare l'ordine dei profili: chi
   lascia buchi è punito per intero, e la lega gli darebbe tre finestre per curarli. Adesso vale più di
   ieri, perché la ricetta adottata vince **sulla copertura** (22,1 buchi contro i 32,0 di P4) e un
   mercato di riparazione è esattamente ciò che sconta quel vantaggio. **E dal §21 vale più ancora**: il
   braccio ora ne lascia 18,8, quindi la quota del suo margine che un mercato di riparazione
   sconterebbe è cresciuta — è l'item che può ridurre questa adozione, non ingrandirla, e per questo va
   fatto invece che rinviato.
1-bis. **`pv_pred` ha un secondo consumatore** (§21.10). Il collo di bottiglia che il banco draft ha
   misurato su quindici istanze di finestra ora non decide solo *chi* mettere in lista: decide *quanto*
   offrire dentro una fascia. Un miglioramento della previsione delle presenze si moltiplica in due
   posti, e un peggioramento pure — questo termine la amplifica per costruzione.
2. **Il FONDO del mercato** (§18.3): il banco prende 2,5 uomini a un credito dove un tavolo vero ne
   prende 6,7, perché ogni nostro partecipante ha un tetto positivo per ogni uomo mentre a un tavolo vero
   nove manager su dieci **non offrono affatto** sul fondo del listone. Costa 12 crediti su 1000 e non
   muove un verdetto, ma è il **24% del mercato** con una forma diversa dalla nostra. La cura ovvia — una
   soglia sotto la quale non si offre — è una costante dichiarata in più: prima di aggiungerla, chiedersi
   cosa può cambiare il suo output.
   > **FATTO il 02/09/2026 (notte tarda), §23, e la causa scritta qui sopra è SBAGLIATA**: le offerte da
   > un credito su un uomo valutato meno di mezzo sono l'1% del totale, e i lotti più economici del banco
   > hanno già una mano sola. La causa vera è il SINCRONO — i dieci partecipanti condividono una vista
   > sola dell'urna e smettono di rifiutare insieme. Cinque cure misurate e respinte, la sola che
   > funziona (il secondo indice sul numero di rose che vogliono ancora il ruolo) costa il riordino dei
   > profili a chiamata e l'adozione del §21 all'urna. Quello che il punto ha PRODOTTO è la risposta alla
   > domanda dell'operatore su quanto offrire, §23.1-23.2.
3. **L'asta A CHIAMATA vera è una SCELTA**, non un ordine (§16.7): lì è il manager a scegliere quale nome
   mettere all'asta dentro il reparto in corso, e questo banco chiama il più caro per primo. È la ragione
   strutturale dei due bersagli fuori misura a chiamata (il lotto più caro al 24,0% contro il 27%, e il
   fondo). Modellare la scelta è un pezzo di comportamento nuovo: si misura sul dato vero, che ha 37 aste
   a chiamata a dieci squadre.
4. **P5 e P6 sono scritti e seduti fuori** (§15.9): «rinuncia al top d'attacco» (13,5% delle rose vere) e
   «un campione e la manovalanza» (14%). Chi siede al tavolo è una decisione dell'operatore; il giorno che
   li vuole, la misura da fare è se il verdetto sui sei profili tiene con loro dentro.
5. **`auction_level`** (il 2-bis del §12, intatto): collassa un codice mantra e un ruolo di listone in una
   stringa sola, e oggi le separa solo il CASO delle lettere. La cura è far viaggiare il vocabolario
   accanto allo slot — un cambio alla forma del foglio, non un lookup.
6. **Il profilo TIFOSO** (il 4 del §12, intatto): serve la tabella di rivalità dichiarata.
7. **`CLUB_PENALTY`** (0,45) è l'unica delle quattro manopole del §12 che nessuno ha ancora chiesto ai
   dati — e questo banco **non può** vederne il beneficio, perché la sua deviazione standard è fra
   stagioni e il rischio che quella regola toglie è dentro una stagione (`metrica-asta-surplus-v1.md`
   §24 lo misura dall'altro lato).

### 20.3 Cosa NON rifare, e perché

- **Il valore d'opzione al di là di `ALT_WEIGHT` 0,5**: sei famiglie misurate, la migliore +5,2%, e il
  difetto vero era di scala (§17.3). Non è una manopola da girare ancora. **E dal §21.1 c'è una ragione
  in più che vale per tutta quella famiglia**: all'urna `Team.alternative` non viene chiamata nemmeno una
  volta, quindi girare `ALT_WEIGHT` là non muove niente per costruzione — la sua griglia «piatta» del
  §17.3 era già lo strumento che lo diceva.
- **La forma a RANGO della deviazione dentro la fascia** (§21.5): +23,8 contro i +32,9 della magnitudine,
  robust contro strict a 40 urne. La direzione è la stessa, la forma no.
- **Un peso della deviazione PER REPARTO** (§21.7): le parti non fanno il tutto (9,7 + 10,7 = 20,4 contro
  32,9) e nessuna metà arriva al pavimento con un `t` sopra 2, perché quello che il termine compra sono i
  modificatori, che sono una proprietà dell'undici. Un peso globale.
- **`Team.keeps` contato su «chi gioca» invece che sulla fascia di prezzo** (§21.8): +0,25%, `t` 1,71.
  Sotto il pavimento; segnato come candidato se il pavimento verrà mai rimisurato.
- **Il tilt sui portieri**: +0,1% su 4 finestre di 10, e tiltare i soli portieri è −1,6% (§19.1).
- **Il nostro ORDINAMENTO come sostituto del rango di prezzo**: +12,4% contro +12,3%, cioè zero (§17.5).
  Se un giorno il vantaggio informativo deve pagare, la forma non è questa.
- **Tutta la famiglia «leggere i rivali», in quattro forme e con l'informazione PERFETTA** (§22): il
  prezzo ombra di un credito (-7,6% con i prezzi dell'oracolo), rilanciare per prendere il lotto (-2,7%
  nella variante migliore, monotono nel quanto), `keeps` sul valore per credito (-25%), `hands` contate
  sui crediti dei rivali (+0,22% nella forma senza parametri, e il suo NULL la batte). La ragione è del
  meccanismo: a secondo prezzo il tetto è quasi gratis e il bilancio è già impegnato.
- **Le tre cure di comportamento sul campione** (§16.5): il conto sui crediti da solo, quello su crediti
  e posto per tutti, il pavimento d'urgenza. Tutte e tre misurate e respinte con i loro numeri.

## 21. Il vantaggio informativo paga, e paga DENTRO la fascia (2 settembre 2026, notte tarda)

Richiesta dell'operatore: «dobbiamo migliorare l'engine che ti consiglia le offerte per un'asta random».
Il §20.2 elencava sette aperture e nessuna era questa, perché la diagnosi che l'ha aperta non era nella
lista: **all'urna il braccio motore non leggeva un solo numero del motore.**

### 21.1 La diagnosi: quanto motore c'è in un'offerta all'urna? Zero

Contato invece che dedotto dal codice, strumentando le funzioni e girando le dieci finestre due volte:

| quante volte il braccio la chiama | a chiamata | **a estrazione** |
|---|---|---|
| `engine_worth` (surplus + copertura) | 1436 | **0** |
| `cover_value` · `coverage_need` | 1436 · 1436 | **0 · 0** |
| `Team.alternative` (il valore d'opzione) | 1436 | **0** |
| `Team.role_cap` (il tetto di reparto) | 1436 | **0** |
| `Team.step` (la scala di mercato) | 0 | 5746 |

È una conseguenza corretta e non dichiarata dell'adozione del §17.4: all'urna il braccio prende in
prestito `profiles.engine_ladder()` e passa dal ramo umano, e quel ramo prezza `richiesta × passo(fascia)
× scala`. La **fascia la definisce il PREZZO** (`set_tiers` ordina per Qt.I). Quindi il braccio che vince
all'urna era un offerente di mercato inclinato sulla difesa, e la sua opinione sui calciatori non entrava
da nessuna parte — che è esattamente quello che il §17.5 aveva misurato dall'altro lato («la stessa scala
letta sul rango di prezzo dà +12,4% contro +12,3%, identico») e che diceva anche cosa fare: *«se un giorno
il vantaggio informativo deve pagare, la forma non è questa»*.

### 21.2 Dove una scala lascia spazio: una fascia è larga DIECI uomini

Una fascia è larga `TEAMS` uomini perché quella è la legge di conservazione, quindi il listino prezza
dieci uomini uguali — un limite che `profiles.MARKET` dichiara già del mercato VERO (dentro la prima
fascia dell'attacco la scala reale continua a scendere: 2,81 · 3,36 · 2,15 · 2,60 · 3,01 · 2,23 poi
1,79 · 1,23 · 1,89 · 1,90). Misurato sulle dieci finestre, dentro una fascia (ruolo, fascia):

| | il PREZZO varia di | le PRESENZE ATTESE variano di |
|---|---|---|
| difensori, 4ª fascia | **0,08** della propria mediana | **0,33 del calendario** (0,42 → 0,76) |
| centrocampisti, 3ª | 0,12 | 0,32 (0,50 → 0,81) |
| attaccanti, 1ª | 0,48 | 0,31 (0,58 → 0,89) |
| portieri, 2ª | 1,35 | **0,69** (0,15 → 0,84) |

La fascia dei difensori è il caso più pulito: **dodici giornate di differenza allo stesso prezzo.**
Quello è lo spazio, ed è dove il mercato non vede e noi sì. (I portieri sono larghi su tutt'e due gli
assi, e il §21.7 dice perché contano comunque.)

### 21.3 E la quantità non è una scelta

`metrica-asta-surplus-v1.md` §18 ha misurato il nostro vantaggio incrementale sulla quotazione ed è
**largo un numero solo**: Spearman parziale contro l'esito, controllando per la Qt.I, `pv_pred` vale
+0,198 (euro) e **+0,243** (Serie A), la fantamedia +0,046 e −0,032, il **surplus +0,006 e −0,077**.
Quindi la deviazione dentro la fascia si spende sulle **presenze** e su nient'altro — e il regolamento
dice perché paga proprio qui: una sola riserva d'ufficio annulla tutt'e due i modificatori, per cui
`HOLE_COST` è 4,73 e le presenze sono quello che una rosa sta davvero comprando.

`bench.INSIGHT` e `bench.set_insight`: il passo della scala viene moltiplicato per `1 + INSIGHT × u`,
dove `u` è la distanza dalla media della sua fascia divisa per l'uomo più lontano della stessa fascia.
**Conserva per costruzione** — la media di `u` su una fascia piena è esattamente 0, quindi il piano che
`Team.scale` prezza costa ancora un budget e non serve la rinormalizzazione che serviva al tilt del
§17.4. E un uomo che il motore non prezza sta al **centro** della sua fascia e non in fondo: «vuoto =
ignoto, mai zero» applicato a un'opinione, perché «non abbiamo una previsione su di lui» e «prevediamo
che non giochi» sono due frasi diverse e solo la seconda può abbassare un'offerta.

### 21.4 Il verdetto — e l'ETICHETTA ritirata dal campione più grande

Criterio pre-registrato prima della corsa, confronto **appaiato** (lo stesso braccio, sulle stesse urne,
con e senza il termine), dieci partecipanti, il braccio su una delle dieci sedie:

| | 40 urne (400 stagioni) | **80 urne (800 stagioni)** |
|---|---|---|
| guadagno appaiato | +32,9 ± 6,3 (t 5,2) | **+26,4 ± 4,5 (t 5,9)** |
| in percentuale | +1,26% | **+1,02%** |
| finestre che migliorano | 10 su 10 | **9 su 10** |
| la peggiore | +0,33% | **−0,42%** |
| verdetto | **STRICT** | **robust** |
| buchi in una stagione | 23,5 → 18,5 | 22,9 → **18,8** |
| posto medio | 4,27 → 3,50 | 4,20 → **3,52** |
| titoli | 81 → 122 su 400 | 175 → **257 su 800** |

**Il guadagno sopravvive al raddoppio del campione e si affila; l'etichetta no.** «Tutte le finestre
migliorano» è un conteggio su dieci, e una di quelle dieci era una monetina: a 80 urne passa a −0,42%.
Quindi l'adozione sta in piedi sull'effetto (t = 5,9) e si pubblica come **robust** — è la disciplina del
§18.2 applicata a questa adozione invece che a quelle di ieri. *Un guadagno confermato da un campione più
grande e un'etichetta smentita da quello stesso campione sono due cose diverse, e solo la prima è una
prova.*

L'ottimo è **interno** e il plateau è piatto entro lo 0,05% (0,70 legge +26,1, 0,80 +26,4, 0,90 +25,9):
la **direzione** è il risultato, il secondo decimale no. E il canale **arriva**: a un valore assurdo
(3,00) legge **−0,15%** con la peggiore finestra a −2,90% e i buchi di nuovo a 22,5 — cioè ha anche un
tetto, perché la deviazione smette di pagare quando scavalca il mercato quanto basta a perdere il lotto.

**A CHIAMATA non si muove di un decimale** (2647,4 punti, posto 3,70, 10,5 buchi, identici al §19.2),
perché lì il braccio non arriva nemmeno a `Team.step`: lo accende il MECCANISMO e non un flag, come la
scala che devia. E lì le presenze le legge già, dentro `cover_value`.

### 21.5 La forma: RANGO contro MAGNITUDINE, scelta dalla misura

Sono state scritte e misurate tutt'e due, e la perdente resta a verbale.

| forma | ottimo | guadagno appaiato | finestre | peggiore | buchi |
|---|---|---|---|---|---|
| **magnitudine** (distanza dalla media della fascia) | **0,80** | **+32,9 (t 5,2)** | 10/10 | +0,33% | **18,5** |
| rango (lineare nell'ordine dentro la fascia) | 0,50 | +23,8 (t 3,6) | 9/10 | −0,39% | 20,2 |

Il rango era la forma in cui il vantaggio è stato **misurato** (uno Spearman parziale è sui ranghi) e per
questo è stata scritta per prima; la magnitudine vince perché dice quello che il rango butta via — dentro
una fascia lo scarto di presenze attese vale un **terzo di calendario**, cioè dodici giornate, e un rango
non distingue quella fascia da una in cui giocano tutti uguale. (Le due colonne di questa tabella sono a 40
urne, dove sono state confrontate.)

### 21.6 E QUESTO margine sopravvive alla propria concorrenza

Il §18.2 aveva dovuto ritirare il vantaggio del braccio sul miglior umano perché la maggior parte era
**esclusività** (−2,8 con tre bracci al tavolo). Rimisurato con **tre** bracci, lo stesso confronto
appaiato legge **+30,0 ± 4,0 (t 7,4), 9 finestre su 10, peggiore −0,48%**, buchi 26,5 → 20,8.

Il meccanismo dice perché: questo termine **non alza un'offerta, sposta gli stessi soldi dentro una
fascia** — conserva per costruzione — quindi tre partecipanti che leggono la stessa previsione guadagnano
tutti e tre. **È la prima cosa che questo banco trova che paghi per la nostra OPINIONE invece che per il
modo in cui offriamo.**

### 21.7 Il termine NON è scomponibile per reparto, e i portieri sono il contro-esempio del §19.1

Chiesti a parte come il §19.1 impone (la griglia che cercò i portieri insieme alla difesa non li chiese
mai da soli), 40 urne:

| deviazione accesa su | guadagno appaiato | finestre | buchi |
|---|---|---|---|
| **tutti e quattro** | **+32,9 (t 5,2)** | 10/10 | **18,5** |
| D · C · A (portieri esclusi) | +25,5 (t 4,2) | 9/10 | 20,4 |
| solo P · D | +9,7 (t 1,6) | 8/10 | 20,3 |
| solo C · A | +10,7 (t 1,9) | 5/10 | 23,0 |
| solo P | +8,7 (t 1,5) | 7/10 | 21,1 |

**Le parti non fanno il tutto**: 9,7 + 10,7 = 20,4 contro 32,9, e nessuna metà da sola arriva al
pavimento dello 0,5% con un `t` sopra 2. La ragione è la stessa dell'R-Factor — *il valore di una soglia
non si può scrivere su una riga*: quello che il termine compra sono i due modificatori, che sono una
proprietà dell'**undici** e non di un reparto, quindi sistemare un dipartimento e lasciarne tre rotti non
incassa niente. Un peso globale, quattro ruoli, nessun parametro per reparto.

**E i portieri sono il contro-esempio esatto del §19.1.** Là la metà portieri del tilt valeva **niente**
(+0,1%, 4 finestre su 10) e diceva «offri 136 crediti per un portiere di prima fascia dove il mercato ne
paga 81»; qui la metà portieri vale **+7,4 punti** dei +32,9. Non è una contraddizione, sono due domande
diverse sullo stesso ruolo: quella era una frase sul **livello** della fascia, questa è una frase su
**quale dei dieci** gioca — e per un portiere, che se ne schiera uno, è la sola domanda che conta. Nel
dato: prima fascia di T2, Svilar (pv 0,90) e Butez (pv 0,57) chiedono 53 e 35 crediti, cioè il prezzo non
li distingue, e il termine offre **107 contro 10**.

### 21.8 Una cura vicina, misurata e RESPINTA: il posto tenuto per «chi gioca»

`Team.keeps` conta «quanti uomini migliori sono ancora nell'urna» sulla **fascia di prezzo**. Adesso che
il braccio ha un'opinione su chi gioca, «migliore» potrebbe voler dire «quelli che noi rateremmo più su»
— un cambio di DEFINIZIONE senza parametri nuovi, che è il tipo che questo progetto preferisce.

Misurato (40 urne, sul braccio soltanto, gli umani restano sulla fascia di prezzo perché non hanno un
motore con cui leggerla): **+6,6 ± 3,8 (t 1,71), +0,25%, 9 finestre su 10, peggiore −0,41%**, buchi 18,5
→ 17,0 e titoli 122 → 133 su 400. **Sotto il pavimento dello 0,5% e con `t` sotto 2: non entra.** La
direzione è giusta e la si segna, perché è un candidato pulito se un giorno il pavimento verrà rimisurato;
oggi sarebbe adottare un numero che il campione non distingue da zero.

### 21.9 Cosa cambia sul listino della sua lega (§19.3)

Il §19.3 dà un multiplo per fascia; questo lo apre in tre, dentro la fascia. Finestra T2, `scala` 1,187:

| reparto, fascia | il passo piatto | chi gioca più della fascia | il mediano | chi gioca meno |
|---|---|---|---|---|
| **P 1ª** | ×1,48 | Svilar (pv 0,90) → **107** | Di Gregorio (0,81) → 89 | Butez (0,57) → **10** |
| **D 1ª** | ×1,91 | Angelino (0,78) → **174** | Cambiaso (0,70) → 96 | Wesley (0,62) → **19** |
| **D 2ª** | ×1,56 | Rrahmani (0,78) → **87** | Hien (0,69) → 63 | Bremer (0,48) → **14** |
| **C 1ª** | ×1,33 | McTominay (0,76) → **187** | Calhanoglu (0,69) → 100 | Gudmundsson A. (0,60) → **22** |
| **A 1ª** | ×2,59 | Lukaku (0,76) → **368** | Thuram (0,72) → 303 | Gimenez (0,50) → **45** |
| **A 2ª** | ×1,52 | Krstovic (0,73) → **156** | Lang (0,61) → 105 | Scamacca (0,38) → **20** |

Detto in una riga per il tavolo: **la fascia dice quanto vale il posto, le presenze attese dicono quale
dei dieci uomini di quella fascia lo occupa** — e la seconda metà vale l'1% di una stagione, che è più di
tutto quello che il nostro giudizio sui calciatori avesse pagato finora a un'asta a rilanci.

### 21.10 Limiti, detti e non spalmati

- **È +1% di una stagione**, cioè +0,73 fantapunti a giornata su 36, con una deviazione standard fra
  stagioni di ~105: 32% di titoli su 800 stagioni contro il 22% di prima e il 10% del caso. È un
  vantaggio, non una certezza.
- **Lo scarto dal miglior umano NON è la misura di questa adozione** e va letto col §18.2 in mano: a 20
  urne legge +41,5 punti contro i +20,0 di prima, ma è una **media contro un massimo su cinque profili**,
  cioè non appaiata. Quello che si pubblica è il confronto appaiato.
- **Vive dentro `pv_pred`.** Se la previsione delle presenze migliora, questo canale migliora con lei; se
  peggiora, questo la amplifica per costruzione. Il collo di bottiglia è lo stesso che il banco draft ha
  misurato su quindici istanze di finestra (`todolist-draft-v1.md`), e adesso ha un secondo consumatore.
- **La fascia resta definita dal PREZZO**, e apposta: sostituirla col nostro ordinamento è stato misurato
  e vale zero (§17.5, +12,4% contro +12,3%). Questo termine non tocca il confine, devia dentro.
- **`engine_*`, i fogli, il bundle e le revisioni non si muovono di un decimale**: qui non si prevede
  nessun calciatore, si legge una previsione che esisteva già.

## 22. «Individuare le strategie degli avversari può aiutarci?» — chiesto a un ORACOLO, e la risposta è no

**02/09/2026 (notte tarda), su due domande dell'operatore: «cosa possiamo migliorare? come rendere i
consigli capaci di farci ottenere i calciatori migliori a fine asta?» e «individuare le strategie degli
avversari può aiutarci a prevedere le loro mosse e a ottimizzare le nostre?».** Criterio pre-registrato
prima di scrivere una riga (confronto appaiato, dieci partecipanti, il braccio su una delle dieci sedie,
strict/robust col pavimento dello 0,5%, schermatura a 20 urne e verdetto a 80, ottimo interno, valore
assurdo, null a tre bracci). Quattro famiglie misurate, **tutte e quattro respinte**, e la più
interessante è respinta da un giudice che i criteri interni non contengono.

**LA REGOLA CHE DECIDE, ed è del meccanismo e non dei rivali: in un'asta a SECONDO PREZZO, sapere cosa
serve per vincere il lotto che hai davanti vale ZERO.** Se il tuo tetto è sopra il prezzo vinci e paghi
il secondo prezzo comunque; se è sotto perdi comunque. L'informazione sui rivali può pagare solo
attraverso il BILANCIO — quello che spendi qui non lo spendi là — e quel bilancio è già impegnato per
costruzione (`Team.scale` normalizza il piano su quello che resta). Da qui in poi ogni misura è un modo
diverso di scoprire la stessa cosa.

### 22.1 Il prezzo ombra di un credito: la cornice giusta, e perde anche con i prezzi PERFETTI

Il candidato «da manuale», e nasce dalla diagnosi del §21.1: il braccio prezza in fantapunti e il mercato
in multipli della richiesta, e la cura del §17.4 (prendere in prestito la scala del mercato) gli ha
tolto l'opinione. La terza strada è convertire la sua opinione in crediti al tasso che lo STATO
DELL'ASTA implica, riletto a ogni lotto:

    lambda   = i fantapunti che un credito compra al margine, bisecato finché la miglior rosa ancora
               comprabile costa esattamente quello che resta in borsa
    tetto    = prezzo(m0) + (worth(uomo) - worth(m0)) / lambda      [i crediti sono scarsi]
             = prezzo(m0) + (borsa - costo del piano)               [non lo sono]

dove `m0` è l'uomo che quel piano userebbe per ULTIMO in quel ruolo, cioè quello che l'uomo sul banco
sostituisce. Nessun parametro: sussume il tasso (`engine_rate`, preso una volta all'inizio),
l'alternativa (`Team.alternative`, la stessa sottrazione fatta su un uomo invece che sul piano) e il
tetto di reparto (`role_cap`, una quota fissa del budget dove questo è il valore marginale vero di un
posto).

| prezzi che alimentano il piano | guadagno appaiato | buchi | spesa |
|---|---|---|---|
| scala di mercato (`profiles.MARKET`) | **-6,86%** (t -6,21) | 15,1 → 38,6 | 977 → 917 |
| **ORACOLO** (quello che il lotto prenderà davvero) | **-7,56%** (t -7,52), 0 finestre su 10 | 15,1 → 41,4 | 977 → 945 |

**Con l'informazione perfetta sul prezzo di ogni lotto la cornice perde il 7,6%: quindi il difetto è la
CORNICE, non la previsione.** Il piano assume di VINCERE gli uomini che mette in lista, e un piano fatto
dei migliori `slots` uomini rimasti è il piano che hanno tutti e dieci: il braccio rifiutava chiunque
altro aspettando uomini su cui aveva una probabilità su dieci. La correzione contata di casa — se `hands`
mani sono alzate, i migliori vanno uno per testa, quindi fra due miei acquisti la stanza ne prende
`hands - 1` — porta la prima versione da -7,65% a -6,86% e non la salva.

Tre difetti pagati per arrivarci, e tutti e tre sono regole di casa incontrate da un lato nuovo.
- **Un rapporto valore/credito ordina la spazzatura per prima quando il vincolo sono i POSTI.** Il primo
  oracolo massimizzava il valore per credito e ha chiuso l'asta **spendendo 25 crediti su 1000** con 36
  buchi: 25 uomini da un credito. Il problema è uno zaino con quote, quindi si risolve come uno zaino —
  sul prezzo ombra. Lo stesso difetto è tornato la stessa sera dentro `keeps` (§22.3).
- **Una conservazione si legge PER RUOLO**, che è quello che `to_credits` scrive di se stesso («the pool
  used for the sum is the ROSTERED one»): un tavolo non compra i 250 uomini più cari, compra 3 portieri,
  8 difensori, 8 centrocampisti e 6 attaccanti **a testa**. Sommata sui 250 più cari la scala
  sovrastimava l'urna, il piano risultava più economico della borsa, il prezzo ombra leggeva **zero** e
  il braccio offriva 241 crediti per il **sedicesimo portiere del listone**.
- **Un tetto non è una rosa**: senza il pavimento `ABUNDANCE` il braccio finiva con due posti VUOTI. Il
  candidato sostituisce il tetto, non la macchina che gli sta intorno.

### 22.2 Rilanciare quando vedi salire il prezzo: monotono e negativo

La forma che a un tavolo vero non ha bisogno di nessun modello — a un'asta a rilanci il prezzo SALE
davanti a te, e decidere se andare avanti è quello che «rilanciare» significa. Il banco ha offerte
sigillate, quindi l'oracolo qui sta al posto di una mano che continua ad alzare, non di una sfera di
cristallo.

| fin dove va sopra il proprio tetto | guadagno | buchi |
|---|---|---|
| ×1,5 | -3,67% | 16,5 → 28,4 |
| ×2 | -4,93% | 16,5 → 33,2 |
| ×3 | -4,93% | 16,5 → 31,3 |
| qualunque cifra | -4,92% | 16,5 → 31,4 |
| ×2, solo dove il motore lo rate sopra la sua fascia | **-2,74%** | 16,5 → 23,3 |
| qualunque cifra, solo lì | -3,06% | 16,5 → 25,7 |

**È il §17.4 dall'altro lato: un rilancio che nessuno paga con un taglio altrove non è una strategia, è
un portafoglio più grande — e la borsa non cresce.** La spesa sale (984 → 995-999) e i buchi raddoppiano:
vincere un lotto che stavi perdendo costa i lotti che stavi vincendo. Da notare la direzione del
dettaglio: restringere il rilancio ai soli uomini che rateremmo sopra la loro fascia è la variante MENO
peggiore, cioè la discriminazione del §21 è giusta e l'ESCALATION è sbagliata.

### 22.3 Riallocare invece di rilanciare: `keeps` sul «buon affare»

L'unica forma che CONSERVA per costruzione — non cambia un tetto, cambia QUALE lotto di una fascia si
prende. `Team.keeps` rifiuta un uomo finché ne restano abbastanza di migliori perché questa rosa se ne
aspetti uno; «migliore» lì è una FASCIA DI PREZZO, e leggerlo come «più valore per credito a quello che
costerà» è un cambio di definizione senza parametri nuovi.

**Respinto e non di poco: -25,21% con i prezzi dell'oracolo, -34,45% con la scala di mercato** (153-213
crediti spesi su 1000, 113-154 buchi). La causa è il difetto del §22.1 una seconda volta: il rapporto
valore/credito mette in testa gli uomini da un credito, quindi «esiste un affare migliore ancora
nell'urna» è vero per quasi tutti e il braccio rifiuta tutti.

### 22.4 `hands` contate sui SOLDI dei rivali — e IL NULL BATTE IL CANALE

`Urn.needing` è «quanti partecipanti hanno ancora un posto aperto in questo ruolo», ed è il numero per
cui `keeps` divide. Un rivale con dodici crediti ha un posto aperto e **non può** contendere un difensore
da sessanta: contarlo è contare una mano che non è alzata. Definizione e non parametro, e osservabile a
un tavolo vero (ogni aggiudicazione è pubblica, quindi la borsa di tutti è nota a tutti). Solo sul
braccio: i cinque profili umani sono DICHIARATI e migliorare la loro pazienza cambierebbe l'ambiente
invece della strategia sotto esame.

| lettura | guadagno | verdetto |
|---|---|---|
| può pagare 0,5 × la richiesta | +1,00% | robust |
| può pagare 1,0 × | +1,18% | robust |
| può pagare 2,0 × | +2,04% | strict |
| può pagare 4,0 × | +2,25% | robust |
| può pagare 10,0 × | +3,15% | strict |
| **può pagare quanto COSTERÀ** (`profiles.MARKET`, nessun parametro) | **+0,22%** (t 1,02) | **NO** |
| **NULL — `hands` × 0,25, senza leggere un soldo di nessuno** | **+4,17%** | strict |
| **NULL — `hands` × 0,1** | **+4,78%** | strict |

**Il null batte il canale, e la forma senza parametri vale zero: quindi non è informazione sui rivali,
è PAZIENZA.** La lettura sui crediti era solo un modo indiretto di abbassare `hands`, e più la
abbassavi meglio andava — l'ottimo era al bordo della griglia, che è la condizione per cui questo
progetto **non** adotta un numero. È «un numero ha bisogno del suo null» applicato a un canale che
altrimenti sarebbe entrato a +2%.

### 22.5 La pazienza, quello che misura e perché NON viene adottata

Al limite (`hands` = 1, cioè la divisione per le mani semplicemente non c'è) è il risultato più grosso
che questo banco abbia mai letto, e passa ogni criterio interno:

| | 20 urne | **80 urne (800 stagioni)** |
|---|---|---|
| `hands` × 0,6 | +2,68% | **+2,83% (t 19,30)**, 10/10, peggiore +1,48% |
| `hands` × 0,4 | +3,65% | **+3,82% (t 26,01)**, 10/10, peggiore +2,45% |
| `hands` × 0,25 | +4,57% | — |
| `hands` × 0,1 | **+4,99% (t 16,85)**, 10/10, peggiore +3,30% | — |
| buchi · posto medio · posti vuoti (a ×0,1) | 19,2 → 6,0 · 3,52 → 1,24 · 0,00 | idem |

- **Tre bracci al tavolo: +2,76% strict** — sopravvive alla propria concorrenza, che è quello che il
  vantaggio della scala non faceva (§18.2).
- **Valore assurdo** (mai comprare finché resta un uomo di fascia non peggiore, qualunque sia il numero
  di posti): **+4,13%**, cioè meno del limite. Il canale ha un tetto, quindi è un effetto e non una fuga.
- **A chiamata è INERTE** al decimale (2647,4 punti e 10,5 buchi identici): `keeps` è spento là per
  costruzione, perché l'uomo sul banco è il più caro rimasto.
- **Il meccanismo, fotografato**: il braccio compra più tardi (posizione mediana del lotto 1,10 → 1,52)
  e paga **0,78 → 0,30 della richiesta**, comprando uomini MIGLIORI (pv mediana 27,3 → 28,2, fascia
  mediana 2 → 1). Non raccoglie scarti: raccoglie uomini di prima fascia a un credito.

**E qui entra il giudice esterno, che i criteri interni non contengono.** Le 10 aste vere a estrazione
della sua lega (di 147; 2.495 aggiudicazioni) dicono cosa paga un tavolo dentro una fase:

| pagato/richiesta per quarto della fase | 1º | 2º | 3º | 4º |
|---|---|---|---|---|
| P | 2,47 | 2,00 | 1,47 | 1,00 |
| D | 1,77 | 1,67 | 1,24 | 0,90 |
| C | 2,44 | 1,85 | 2,00 | 1,00 |
| A | 2,82 | 3,40 | 3,15 | 0,25 |

Il calo dalla prima alla seconda metà è del **53%**, ma **dentro le prime due fasce è del 14%** (4,08 →
3,51) — cioè quasi tutto il calo è COMPOSIZIONE, che è il difetto isolato dal §15.7 («un indice che
divide per la richiesta non è pulito dalla composizione»). E il confronto per fascia, riportando la
scala del banco in unità d'archivio (× `to_credits` = 3,46), dice che il braccio paziente compra a
prezzi che al tavolo vero non esistono:

| | reale, tutta la fase | reale, seconda metà | braccio base | braccio paziente | paziente/reale tardi |
|---|---|---|---|---|---|
| D 2ª fascia | 2,12 | 1,67 | 3,54 | 0,11 | **0,07** |
| C 3ª fascia | 1,80 | 1,00 | 2,07 | 0,09 | **0,09** |
| A 1ª fascia | 8,83 | 8,00 | 3,14 | 1,24 | **0,16** |
| A 2ª fascia | 4,55 | 5,07 | 3,23 | 0,70 | **0,14** |

Il braccio BASE invece è in scala col vero (P 1ª 5,20 contro 4,53 · D 1ª 5,56 contro 3,07 · C 1ª 5,14
contro 4,55 · A 1ª 3,14 contro 8,83, cioè paga troppo poco i top d'attacco e troppo la difesa, che è il
tilt adottato). **Quindi non si adotta**: il guadagno è comprato a un settimo o a un quindicesimo del
prezzo reale per gli uomini che decidono, e quel prezzo esiste solo perché nove rose devono riempire le
loro quote mentre una non compra niente. L'archivio **non può smentirlo** — nessun manager vero si
astiene da una fase, quindi quel prezzo non è mai stato osservato — e non può confermarlo. È uno
sfruttamento del tavolo, non una valutazione migliore, e la decisione su una cosa che l'operatore
dovrebbe giocare davvero è sua.

**Quello che resta stabilito e vale la pena tenere è la DIREZIONE**: il braccio è troppo impaziente
all'urna, e la divisione per le mani alzate dentro `keeps` è la ragione. Perché diventi adottabile serve
un numero che l'archivio non ha: quanto costa un uomo di fascia `k` tardi nella sua fase **quando un solo
compratore ha ancora quel ruolo aperto**.

### 22.6 Dove il difetto NON era, e la correzione al meccanismo che ne è uscita (adottata, gratis)

Due sospetti sono stati misurati e scagionati, e vale la pena averli scritti perché sono i due posti in
cui un ragionamento aggregato avrebbe messo la colpa.

- **I soldi del tavolo non partono troppo presto.** La curva della spesa DENTRO ogni fase — di quello che
  una fase incassa, quanto è già uscito a ogni quarto — riproduce il vero: P 30/60/86% contro 33/65/85% ·
  D 31/55/80 contro 31/54/77 · C 26/52/81 contro 28/51/72 · A 28/65/92 contro 36/65/88. Il §16.1 aveva
  verificato la curva sull'asta INTERA; questa è il bersaglio più fino e regge.
- **Ma il ri-offerta era di una fase sbagliata.** `bench.auction` teneva UNA coda: gli invenduti di tutte
  e quattro le fasi tornavano dopo l'intera prima passata, quindi chi lasciava andare un reparto lo
  ritrovava quando ogni altra rosa era piena. L'archivio dice che le aggiudicazioni di un ruolo sono
  **contigue** (30 portieri, poi 80 difensori, poi 80 centrocampisti, poi 60 attaccanti — è così che in
  questa sessione si è potuto leggere il ruolo dalla posizione dell'aggiudicazione, e la stessa cosa che
  il §16.2 aveva misurato come 0,06 · 0,28 · 0,60 · 0,88). **Corretto e adottato**, e misurato prima: sul
  tavolo dichiarato **0 differenze su 1.000 stagioni-partecipante**, e **0 aggiudicazioni avvengono dopo
  la prima passata**, cioè il ri-offerta che questa cura riguarda è un angolo in cui il tavolo dichiarato
  non entra mai. La pazienza sopravvive alla correzione (+4,67%), quindi la scappatoia non era il confine
  di fase: è dentro la fase, e sta in chi ha ancora un posto.

### 22.7 Cosa cambia per l'operatore, in tre righe

1. **Prevedere le mosse degli avversari non paga a questo meccanismo**, e non per mancanza di un modello:
   misurato con l'informazione PERFETTA vale -7,6% (prezzo ombra), -2,7/-4,9% (rilanciare per prendere il
   lotto) e -25% (riallocare sul buon affare). Il secondo prezzo rende quasi gratis il tetto e il bilancio
   è già impegnato: l'unica cosa che l'informazione può spostare è DOVE spendi, e la scala del mercato più
   la deviazione dentro la fascia (§17, §21) già lo dicono.
2. **La leva vera trovata stasera non è informativa, è di TEMPI**: il braccio compra troppo presto. Vale
   fra +2,8% e +5,0% sul banco, sopravvive a tre bracci ed è inerte a chiamata — e non entra perché i
   prezzi che raccoglie l'archivio non li ha mai visti.
3. **Quello che l'archivio può ancora dire lo dice su una domanda nuova**: cosa costa un uomo quando un
   solo compratore ha ancora quel ruolo aperto. È l'unico numero che deciderebbe il punto 2, e nelle 147
   aste non c'è perché nessuno si è mai astenuto da una fase.

## 23. «Conviene spendere appena esce, o aspettare la coda?» — chiesto ai 147 dati veri

**02/09/2026 (notte tarda), su indicazione dell'operatore.** Aperto come il punto 2 del §20.2 (il FONDO
del mercato) e riorientato dalla sua stessa domanda, che ne è la forma decidibile: «lo studio dei casi
reali deve aiutare il motore a suggerire quanto offrire: conviene spendere di più appena un top del suo
ruolo esce (perché tanto quelli a seguire costeranno di più) oppure conviene lasciar perdere perché gli
acquisti in coda avverranno a prezzi bassi?». Con la premessa che ha dato e che vale come requisito:
**l'utilità del suggerimento è nel sopperire alla poca lucidità al passare del tempo**, quindi «per ogni
ruolo cosa ti serve e quali calciatori buoni per te devono ancora uscire» è già il risultato — e come si
vedrà, quel conto e il prezzo sono lo **stesso oggetto**: quante rose vogliono ancora quel ruolo è il
numero che decide il secondo prezzo.

### 23.1 La risposta: il saldo esiste solo dove l'uomo è SOSTITUIBILE

Misurato sulle 10 aste vere a estrazione della sua lega (2.495 aggiudicazioni), dentro la fascia — così
la composizione non inquina, che è il difetto isolato dal §15.7 — e contro **quante delle dieci rose
hanno ancora un posto in quel ruolo** quando il lotto viene aggiudicato:

| | tavolo aperto (9-10 rose) | si assottiglia (6-8) | si chiude (1-5) |
|---|---|---|---|
| **prime due fasce** (gli uomini che giocano) | ×1,00 (n=552) | ×0,91 (n=139) | **×0,80** (n=48) |
| terza e quarta (la profondità utile) | ×1,00 (n=463) | **×0,50** (n=95) | ×0,50 (n=83) |
| dalla quinta giù (il riempimento) | ×1,00 (n=570) | **×0,36** (n=165) | **×0,21** (n=172) |

E la stessa cosa letta come «che probabilità ho di prenderlo a UN credito»: prime due fasce **2-5%
sempre** (e **zero su 552** per la prima fascia di ogni ruolo), terza-quarta dal 17% al 92%, dalla
quinta giù dal 29% al 72%.

**Quindi la risposta è sì per i primi due gradini e no per tutto il resto, ed è una soglia e non una
curva.** Un uomo delle prime due fasce non arriva mai in saldo: aspettare vale al massimo il 20% e
rischia di non prenderlo affatto. Dal terzo gradino in giù aspettare **dimezza** il prezzo e dal quinto
lo taglia di cinque volte. La ragione è la sostituibilità: le prime due fasce sono venti uomini per dieci
posti da titolare e tutti li vogliono, mentre dal terzo gradino gli uomini sono più dei posti e la domanda
della stanza evapora man mano che le rose si riempiono.

**Lo stesso segno sui due meccanismi**, che è la cosa che ne fa una misura e non un artefatto
dell'ordine: a chiamata ×1,00 · 0,69 · 0,69 per le prime due fasce, ×1,00 · 0,40 · 0,40 per la
terza-quarta, ×1,00 · 0,26 · 0,15 per il riempimento.

### 23.2 Quanto paga un tavolo vero, in crediti, sulla sua lega

Mediana del pagato su budget 1000, dieci squadre, 3/8/8/6, asta a estrazione. Fra parentesi la quota di
quelle aggiudicazioni andata a un credito.

| ruolo · fascia | Qt.I | tavolo aperto | si assottiglia | si chiude |
|---|---|---|---|---|
| **P 1ª** | 16 | **60** (0%) | 78 (0%) | 91 (0%) |
| P 2ª | 9 | 8 (21%) | 8 (19%) | 26 (20%) |
| **D 1ª** | 16 | **52** (0%) | 35 (0%) | 41 (0%) |
| D 2ª | 12 | 30 (3%) | 31 (0%) | 14 (14%) |
| D 3ª | 9 | 20 (5%) | 11 (0%) | 13 (24%) |
| D 4ª | 8 | 11 (21%) | 8 (29%) | 6 (25%) |
| D 5ª-8ª | 6-7 | 4-7 (16-37%) | 1-3 (33-80%) | **1-2 (33-91%)** |
| **C 1ª** | 23 | **112** (0%) | 80 (0%) | 111 (0%) |
| C 2ª | 14 | 43 (0%) | 50 (12%) | 51 (0%) |
| C 3ª | 12 | 32 (4%) | 34 (17%) | 12 (0%) |
| C 4ª | 10 | 20 (11%) | **1** (58%) | 1 (60%) |
| C 5ª-8ª | 6-9 | 2-20 (17-48%) | 1-23 (25-60%) | **1 (55-100%)** |
| **A 1ª** | 26 | **270** (0%) | 113 (0%) | 208 (0%) |
| A 2ª | 16 | 76 (3%) | 74 (15%) | 26 (0%) |
| A 3ª | 13 | 53 (15%) | 62 (18%) | 13 (20%) |
| A 4ª-6ª | 7-10 | 6-32 (14-36%) | **1** (61-67%) | **1** (59-67%) |

Tre cose da leggere in quella tabella. **Il top d'attacco è il 27% del budget e non scende mai** (270
crediti, zero aggiudicazioni a un credito su 71). **La quarta fascia è il confine**: a centrocampo e in
attacco passa da 20 crediti a UNO appena il tavolo si assottiglia. E **la prima fascia dei portieri sale**
(60 → 78 → 91): chi arriva tardi senza portiere paga, perché di portieri se ne schiera uno.

### 23.3 La cosa che sembrava più forte, e che il test appaiato ha ridimensionato

La sua ipotesi letterale — «conviene spendere di più appena un top esce perché quelli a seguire costeranno
di più» — sembrava confermata alla grande dalla prima lettura: il k-esimo attaccante di prima fascia
aggiudicato legge 5,71 · 9,85 · 8,90 · 10,34 · 10,60 volte la Qt.I, cioè **il primo estratto costa la
metà dei quattro successivi**. Rimisurata **appaiando dentro l'asta** (il primo contro la mediana degli
altri della sua stessa (ruolo, fascia), così quello che rende un'asta più cara di un'altra si annulla):
160 crediti contro 255, ma **il primo è il più economico in 6 aste su 10**. Su un segno test è una
monetina, e su dodici celle provate una a 9/10 (i centrocampisti di seconda fascia) è quello che produce
il provare dodici celle.

**E il meccanismo a chiamata è il contro-esempio che spiega perché la lettura all'urna è quella
leggibile**: là il segno si inverte in quasi ogni cella (difensori di terza fascia 0 su 7, centrocampisti
di terza 0 su 7, attaccanti di terza 0 su 7 — il primo è sempre il più caro), perché a chiamata il primo
uomo di una fascia **È** il più caro. All'urna l'ordine dentro la fase è il sorteggio della piattaforma,
quindi «è uscito adesso» è esogeno e il confronto è pulito. *Un effetto misurato dove l'ordine è scelto
non è lo stesso effetto misurato dove l'ordine è sorteggiato.*

### 23.4 Il FONDO del mercato: la causa scritta nel §18.3 è SBAGLIATA, e quella vera è il sincrono

Il punto 2 del §20.2 diceva: «ogni nostro partecipante ha un tetto positivo per ogni uomo, quindi con
dieci offerenti il secondo prezzo non arriva quasi mai a uno». **Misurato, è falso**: le offerte da
esattamente un credito su un uomo che la ricetta valutava meno di mezzo credito sono **27 su 3.568**
(1%), e i lotti più economici del banco hanno **già una sola mano alzata** — un lotto con un offerente
solo costa un credito per la regola del prezzo, quindi il banco non ha bisogno che qualcuno smetta di
offrire. Ha bisogno di più lotti con una mano sola: ne fa 24 per asta e il vero ne fa ~57.

E la struttura, all'urna, è quasi giusta: il banco compra il **16,3%** dei suoi uomini da fuori il
serbatoio (i migliori `posti × squadre` di ogni ruolo, la stessa legge di conservazione di
`to_credits`) contro un vero del **20,4%**, e lascia **40,6** uomini del serbatoio invenduti contro
~50. Quello che sbaglia è il **prezzo** di quegli uomini: mediana **3 crediti** con il 29% al minimo,
contro un vero di **1** con il 59,5% al minimo.

**La causa vera è il SINCRONO.** I dieci partecipanti del banco condividono una sola vista dell'urna
(`tier_left` e `hands` sono fatti sull'urna, non su di loro) e differiscono solo per quanti posti hanno
ancora liberi, quindi passano da «rifiuto» a «offro» quasi tutti insieme: un uomo fuori serbatoio trova
sempre due o tre mani. Dieci manager veri hanno dieci liste diverse e finiscono la propria in dieci
momenti diversi.

### 23.5 Cinque cure misurate e respinte, e ognuna dice perché

- **Il pavimento di un credito** (la causa dichiarata dal §18.3): 1% delle offerte. Non è quello.
- **La DISPERSIONE in coda** (dare a tutti i profili uno sbandamento sui riempimenti, dove l'operatore
  non ha dichiarato nessun comportamento): respinta **dall'aritmetica e non dal calcio**. Un lotto si
  chiude al SECONDO prezzo, e il secondo massimo di dieci estrazioni disperse è più ALTO del secondo
  massimo di dieci valutazioni identiche: più rumore alza il fondo, non lo abbassa. Misurato: 10,0% →
  11,2% di aggiudicazioni al minimo a uno sbandamento assurdo, con la mediana che sale (1,4 → 1,9) e la
  concentrazione che scende.
- **UNA STANZA PAZIENTE** (la definizione del §22 data a tutti e non al solo braccio): 10,0% → **8,0%**,
  cioè peggio, e a chiamata comincia a lasciare posti vuoti (1,64 su 25), che è lo strangolamento già
  misurato dal §16.5. Rifiutare presto non fa arrivare il lotto a un credito: lo fa tornare più tardi,
  quando chi lo vuole lo vuole tutto insieme.
- **LA LISTA scritta esplicitamente** («non offro su un uomo che il serbatoio non contiene, finché ce ne
  sono abbastanza dentro per i miei posti»): **effetto ZERO, verificato per differenza** — 250
  aggiudicazioni identiche, uomo per uomo e credito per credito. Perché `Team.keeps` la implementa già,
  e più severamente: rifiuta finché restano abbastanza uomini di fascia non peggiore. *Prima di
  aggiungere una regola, si controlla se il file ne ha già una che la contiene.*
- **IL SECONDO INDICE**, ed è l'unica che funziona: la scala di mercato è indicizzata sulla sola fascia,
  e l'archivio dice che il prezzo dipende anche da quante rose vogliono ancora il ruolo (§23.1). Aggiunto
  come secondo indice misurato, **a chiamata sistema quasi tutti i bersagli** — aggiudicazioni al minimo
  6,5% → **19,1%** contro un vero di 19,4%, gini 0,61 → **0,65** contro 0,65, primi tre 49,8 → **52,9**
  contro 52,3, uomini al minimo 1,63 → **4,77** contro 4,84 — e **all'urna è quasi inerte** (10,0% →
  11,1% contro 26,5%), perché là i riempimenti escono mentre il tavolo è ancora aperto.
  **RESPINTO per quello che costa**, e la misura è netta: a chiamata **riordina i profili dichiarati**
  (P3 dal terzo al secondo posto, +32,1 punti), all'urna costa al braccio **−1,27%** (t −2,47, 3 finestre
  su 10), e porta l'adozione del §21 da +1,49% a **−0,35%**. Comprare il fondo di un meccanismo che
  l'operatore non gioca al prezzo di un canale previsionale adottato non è un affare.

**E quel −0,35% è una fragilità che va scritta anche se l'indice non entra**: il margine di `INSIGHT`
dipende dal fatto che la coda sia CARA. Il termine sposta soldi dentro una fascia verso chi gioca; se il
riempimento costa un credito, quei soldi non comprano più niente che gli altri non abbiano. Non ritira
l'adozione — l'ambiente non è cambiato, l'indice è respinto — ma dice a quale condizione vale, e la
condizione è un fatto sull'ambiente che oggi sappiamo essere calibrato male al fondo.

### 23.6 Cosa resta aperto, e cosa NON rifare

- **Aperto, con la sua diagnosi in mano**: la disomogeneità della stanza. Serve che i dieci partecipanti
  escano dal rifiuto in dieci momenti diversi, e la sola cosa che lo produce è una LISTA per
  partecipante — cioè un fatto nuovo sul tavolo, con la sua lunghezza da misurare. Il bersaglio è
  quantificato (26,5% delle aggiudicazioni a un credito all'urna, 19,4% a chiamata; 20,4% degli uomini
  fuori serbatoio; mediana 1 credito) e il costo dell'errore è quello che il §18.3 aveva già stimato,
  ~12 crediti su 1000.
- **Aperto e più grosso, per il meccanismo a chiamata**: il §20.2 punto 3 lo diceva già e questa sessione
  lo conferma dal lato dei numeri — il banco compra l'1,6% fuori serbatoio dove il vero compra il 19,6%,
  e lascia 4 uomini del serbatoio invenduti dove il vero ne lascia ~50. Non è il fondo: è che a chiamata
  **il manager SCEGLIE quale nome mettere all'asta** e il banco chiama il più caro.
- **Non rifare**: le cinque cure del §23.5, ognuna con il suo numero. E non rifare il test letterale
  sulla sua ipotesi (§23.3) su dieci aste: la cella dell'attacco di prima fascia ha n=10 e il segno è
  6/10, quindi quello che serve non è un'altra misura ma più aste.

## 24. Il meccanismo che fa pagare i nostri consigli: il TEMPISMO compra i posti, il motore li riempie

**02/09/2026 (notte), su richiesta dell'operatore: «prima di passare all'interfaccia troviamo un
meccanismo giusto per avere un vantaggio dai consigli del motore».** Criterio pre-registrato prima di
scrivere una riga (appaiato, dieci partecipanti, il braccio su una delle dieci sedie, schermatura a 20
urne e verdetto a 80, ottimo interno, null a tre bracci, inerzia a chiamata) e **una guardia in più
che questo banco si è guadagnata il pomeriggio stesso: i prezzi che la strategia finisce per pagare
devono essere prezzi che l'ARCHIVIO ha visto davvero** — è quello che ha respinto la pazienza del §22.

**ADOTTATO: `bench.DEPTH_TIER` = 2 e `bench.DEPTH_HANDS` = 9.** Il braccio lascia passare un uomo
dalla TERZA FASCIA in giù finché nove o dieci rose hanno ancora un posto in quel ruolo, e solo finché
restano abbastanza uomini di fascia non peggiore per sé e per i rivali che ne vogliono ancora uno.
**+1,88% STRICT su 800 stagioni appaiate** (+49,4 ± 4,3, t 11,6, 10 finestre su 10, peggiore +0,57%),
buchi 18,9 → 13,3, posto medio 3,53 → 2,49, spesa 988 → 980. Sul tavolo dichiarato il braccio chiude a
**2690,6 punti con 101 titoli su 200** contro i 2581,9 e 27 titoli del miglior umano.

### 24.1 Il meccanismo non è «la profondità a meno»: è 1,6 titolari in più

Fotografato, ed è la cosa che rende questa adozione diversa da un risparmio:

| | braccio attuale | con il tempismo |
|---|---|---|
| uomini delle prime due fasce | 10,5 a rosa | **12,1** |
| uomini dalla terza in giù | 14,5 | 12,9 |
| pagati per la profondità (mediana) | 3 crediti | **1** |
| presenze attese di quella profondità | pv 23,7 | 23,2 |
| quando compra la profondità (posizione del lotto) | 1,36 | 1,10 |

La coda costa un terzo e **le presenze attese di quella coda non cambiano** (23,7 → 23,2): non compra
peggio, compra lo stesso a meno. E i crediti che non mette lì comprano **1,6 uomini in più delle prime
due fasce**, cioè dove il §23 ha misurato che il prezzo non scende mai.

### 24.2 Perché è una risposta alla SUA domanda: il tempismo e il motore si COMPONGONO

Va detto per primo perché è la metà scomoda: **questa regola non legge un solo numero del motore.**
Legge la fascia di prezzo e il conto delle mani alzate, quindi è un vantaggio preso alla STRUTTURA
dell'asta e non ai nostri consigli — un manager potrebbe applicarla a mano, e §24.5 è la frase per
farlo. Quello che la rende la risposta alla domanda dell'operatore è la **composizione**, misurata
apposta: `INSIGHT` (§21, la deviazione dentro la fascia sulle presenze attese — il solo numero su cui il
nostro giudizio batte la quotazione) vale

| | dentro il braccio di ieri | dentro quello che aspetta |
|---|---|---|
| guadagno appaiato di `INSIGHT` | +29,9 fantapunti (+1,15%) | **+37,0 (+1,39%)** |
| t | 3,08 | **5,37** |
| finestre · peggiore | 8/10 · −0,52% | **9/10 · −0,18%** |

**Il tempismo compra i POSTI in cima al mercato e il motore decide QUALI uomini li occupano**, e il
nostro giudizio vale un quarto in più dentro quella rosa. Sono complementari e non sostituti — che è
esattamente il contrario di quello che erano le nostre quote di reparto contro il tilt della scala
(§17.4: +1,1% sulla scala piatta, −1,2% su quella inclinata). E la composizione regge anche con **tre
bracci** al tavolo (`INSIGHT` +0,56% robust, t 3,86), dove il tempismo da solo legge +1,54% strict.

### 24.3 Le due cure vicine, misurate e respinte — e la seconda è un fatto sul banco

- **Prezzare la coda a quello che costerà, senza aspettare.** La forma meglio fondata sulla carta: il
  braccio non passa nessun lotto e semplicemente rifiuta di pagare il prezzo da tavolo aperto per un
  uomo che il mercato scenderà, offrendo `passo × fattore misurato(fascia, mani)`. **Vale ZERO**: +0,02%
  a peso 1, −0,09% a 0,5, −0,24% a 2. Quindi il meccanismo **non è il prezzo, è il momento**: a secondo
  prezzo abbassare un tetto su un lotto che avresti vinto comunque non cambia niente, e sui lotti
  contesi lo perdi e ricompri un uomo simile allo stesso prezzo.
- **La COPERTURA all'urna** (il braccio non ha nessun termine di copertura a estrazione: §21.1 contava
  zero chiamate a `coverage_need` lì). Applicata come moltiplicatore per reparto sulla scala:
  **−0,00%, t 0,00**, 6 finestre su 10, buchi 19,2 → 18,0. Terza istanza della ridondanza col tilt che
  il §17.4 aveva già misurato dai due lati. E la prima versione ha insegnato un fatto sul banco che vale
  oltre questo candidato: **un moltiplicatore UNIFORME sulla scala è inerte per costruzione** — legge
  identico al decimale, `se` = 0 — perché `Team.scale` normalizza il piano sulla borsa e lo cancella
  esattamente. È il §17.4 letto dall'altro lato: *quello che una scala non può vedere è un cambiamento
  che conserva.*

### 24.4 L'ottimo del banco NON è quello che adottiamo, e questa è una decisione

`DEPTH_TIER` ha un **ottimo interno** e cade sulla banda che l'archivio aveva misurato da sé — 0 e 1
leggono +1,69% (la guardia rende il gradino più alto irrifiutabile per aritmetica), **2 legge +2,06%**,
3 +1,84%, 4 +1,47%, 5 +1,38%. Due misure che non avevano ragione di concordare, che concordano.

`DEPTH_HANDS` **no**: sul banco migliora in modo monotono fino in fondo — 10 → +0,94%, **9 → +2,06%**,
8 → +2,72%, 7 → +3,18%, 6 → +3,36%, 5 → +3,58%, 3 → **+3,85%**, 1 → +3,69%. Cioè l'ottimo del banco è
«aspetta finché quel ruolo non lo vuole quasi più nessuno», che è la pazienza del §22 con un'altra
faccia — e il §22 è stato respinto perché **i prezzi che raccoglieva non esistono a un tavolo vero**.
Quindi la soglia adottata è la **banda dell'archivio** (9-10 rose, dove il vero paga il prezzo pieno) e
non il picco del banco, e i ~2 punti percentuali di differenza si lasciano sul tavolo per scelta.

**Verificato invece di assunto, ed è la guardia che decide**: alla banda dell'archivio il braccio paga
**0,90 · 1,24** del prezzo vero tardivo per le prime due fasce dei portieri e **0,99 · 1,23** per il
centrocampo (la difesa sta a 1,9, che è il tilt adottato del §17.4), cioè **gli uomini che decidono una
stagione li compra a prezzi reali**. Quello che resta fuori misura è la terza e quarta fascia, dove
l'archivio dice ×0,50 tardi (8-13 crediti) e il banco glieli lascia a uno: è il difetto d'ambiente che
il §23.4 ha localizzato (il SINCRONO), quindi una parte di questo margine è ancora esclusività e va
detto — con tre bracci scende da +1,88% a +1,54% e non crolla.

### 24.5 La regola per il tavolo, in una frase

**Non pagare il prezzo da tavolo aperto per un uomo dalla terza fascia in giù: costerà la metà quando
le rose cominciano a riempirsi, e un quinto alla fine. Quei crediti si spendono sulle prime due fasce,
dove il prezzo non scende mai — e dentro quelle fasce si prende l'uomo che il motore dà per più
presente.** Le due metà sono misurate su cose diverse e per questo si sommano: la prima sulle 10 aste
vere della sua lega (§23.1), la seconda sul vantaggio incrementale del motore sulla quotazione
(`metrica-asta-surplus-v1.md` §18) e sul banco (§21).

## 25. «I consigli del motore favoriscono veramente chi li usa?» — chiesto SENZA il tavolo

**02/09/2026 (notte), domanda dell'operatore: «riusciamo a fare delle simulazioni ed avere dei dati
verosimili per capire se i consigli del motore favoriscono veramente chi li usa?».** La domanda è la
più difficile che si possa fare a questo banco, perché **ogni numero pubblicato qui è condizionato al
tavolo simulato** — e il §23.4 ha appena misurato due ragioni per non fidarsi di quel tavolo al fondo del
mercato. Quindi la risposta è un giudice NUOVO che il tavolo non lo usa affatto:
`python -m bench.auction.advice`.

**Quello che lo rende possibile è una legge di conservazione che questo banco ha già dentro.** Una rosa
è di 25 uomini e un listone contiene esattamente **25 FASCE** da dieci (una fascia è un rango diviso il
numero di squadre), quindi *una rosa è un uomo per fascia* — e la sola decisione che i consigli cambiano
è **quale dei dieci uomini** di una fascia prendere. Quella decisione si può giudicare su quello che
quegli uomini hanno **davvero fatto**: `fm_act`, `pv_act` e `actual` viaggiano in ogni finestra, e
`fm_pred`/`pv_pred` sono cross-fit su una finestra adiacente come fa il gate.

### 25.1 I consigli sono GIUSTI, e dentro una fascia la quotazione non dice niente

Dieci stagioni vere, 230 decisioni (stagione, ruolo, fascia), nessun tavolo da nessuna parte. Reso in
fantapunti realizzati, contro quello che rende una scelta a caso dentro la fascia:

| chi scegli dentro la fascia | reso per scelta | stagioni |
|---|---|---|
| **il più caro, cioè la quotazione** | **−1,0 ± 3,7** (t −0,27) | 5/10 |
| **il motore: chi gioca più giornate** | **+18,1 ± 3,4** (t 5,34) | **10/10** |
| il valore (fm × pv) | +15,4 ± 3,5 (t 4,36) | 9/10 |
| il surplus | +3,4 ± 3,6 (t 0,96) | 6/10 |

E appaiato contro la scelta del mercato sulla stessa fascia: **+19,9 ± 5,2 fantapunti per scelta**
(t 3,84, 9 stagioni su 10, 37 scelte identiche su 211).

**Il fatto grosso è la prima riga: dentro una fascia di prezzo la quotazione vale meno di un tiro di
dado.** Non è una critica al listone — è la conseguenza della legge di conservazione: la fascia è larga
dieci uomini *perché* il mercato li prezza uguali, quindi l'informazione che li distingue non può essere
nel prezzo. E la nostra c'è, ed è quella che `metrica-asta-surplus-v1.md` §18 aveva già isolato: le
PRESENZE. Il surplus, misurato qui dal lato dell'esito, conferma di non aggiungere niente (t 0,96),
che è la stessa cosa che quel §18 diceva dal lato della correlazione parziale.

### 25.2 Ma a livello di ROSA vale +26 a stagione, non 25 × 19,9

Due rose, le stesse 25 fasce, **gli stessi prezzi** (l'ask medio della fascia per il multiplo misurato
del mercato, quindi le due rose costano identiche: 849 crediti), entrambe a giocare la stagione vera:

| scelta da | fantapunti | buchi | R-Factor | mod. difesa |
|---|---|---|---|---|
| la quotazione | 2653,7 | 18,2 | 11,4 | 13,9 |
| **il motore (presenze)** | **2680,1** | **8,5** | 13,9 | 17,9 |
| il valore (fm × pv) | 2655,8 | 11,8 | 12,9 | 16,8 |

Appaiato: **+26,4 ± 39,6 a stagione (+0,99%)**, 5 stagioni su 10. **I buchi si dimezzano** e salgono
tutti e due i modificatori.

**E la curva satura, che è il fatto che spiega la differenza fra i due numeri.** Scambiando `k` delle 25
fasce, con le fasce estratte A SORTE (200 sottoinsiemi per taglia, perché scambiarle in ordine misura
l'ordine): +4,4 · +11,8 · +13,7 · +19,4 · +22,2 · +22,7 · **+26,4** a 2 · 5 · 8 · 11 · 15 · 20 · 25
fasce, con i buchi 18,2 → 16,5 → 14,1 → 12,7 → 11,0 → 9,6 → 9,0 → 8,5. Cioè la fascia marginale vale
**+2,36 fantapunti sulle prime cinque e +0,74 sulle ultime cinque**.

**Perché +19,9 su un uomo diventa +1 su una rosa: una rosa ne SCHIERA UNDICI.** Le presenze in più di un
uomo si vedono solo se altrimenti lasciavano un posto vuoto, e un undici si può coprire una volta sola —
quindi quello che i consigli comprano è la COPERTURA e non il punteggio grezzo. È «il valore di una
soglia non si può scrivere su una riga» (l'R-Factor) incontrato da un lato nuovo. Detto per intero: la
rosa scelta dal motore segna *meno* per apparizione della rosa scelta dal listone, e vince perché non
manca; i due effetti quasi si annullano sul punteggio e non si annullano sui modificatori.

**UN ACCORDO CHE HO SCRITTO E POI RITIRATO**, perché è esattamente il tipo di numero che questo progetto
rimisura invece di citare. Il conteggio dell'esecuzione dice che `INSIGHT` porta in rosa **+2,35** dei
nostri uomini preferiti a stagione, e 2,35 × 19,9 = +47 contro i +37 che il banco misura: sembrava una
riconciliazione fra due misure indipendenti. **Non lo è**: la curva di saturazione dice che uno scambio
al livello della rosa vale +1, non +19,9, quindi l'accordo era una coincidenza fra un numero per UOMO e
un numero per ROSA. Quello che resta vero è la diagnosi che ci sta sotto: il termine adottato non è solo
uno scambio dentro la fascia, cambia anche da quali fasce il braccio compra e quanto paga.

### 25.3 Cosa questi dati possono dire e cosa no

- **Possono dire che i consigli sono giusti**, e lo dicono con forza: t 5,3 contro il caso e t 3,8
  contro la quotazione, 10 e 9 stagioni su 10, su esiti veri e senza nessun tavolo.
- **Non possono certificare quanto valgono in punti**: +26,4 con un errore standard di 39,6 (t 0,67) —
  dieci stagioni vere non distinguono l'1% di una stagione da zero, perché la deviazione standard di una
  stagione è di ~100 fantapunti. **Ed è per questo che il banco esiste**: rigioca quelle stesse dieci
  stagioni su centinaia di urne e legge lo stesso ~+1% con t 5,9 (§21). *Il banco non aggiunge calcio,
  aggiunge POTENZA — e il prezzo è un tavolo dichiarato.*
- **Non possono ordinare le nostre colonne fra loro**: al livello della rosa il surplus legge +36,0
  (t 1,10) contro i +26,4 delle presenze (t 0,67), cioè la stessa cosa dentro il rumore, mentre per
  scelta le presenze vincono chiaramente e il surplus no. Dieci stagioni di rose separano «il motore
  batte la quotazione» da niente, e nient'altro di più fine.
- **E non dicono niente su quanto se ne riesce a ESEGUIRE al tavolo**: quello dipende dai rivali, ed è
  la parte che solo il banco può stimare — 2,35 dei 25 acquisti a stagione, il **9%**. È anche il motivo
  per cui un'interfaccia serve: il collo di bottiglia non è la previsione, è quanto un'asta contesa ne
  lascia passare.

## 26. «Paga la fantamedia dove hai copertura, le presenze dove quel posto lo regge lui da solo»

**02/09/2026 (notte), la regola pratica dell'operatore, messa alla prova invece che lasciata come
frase — e la misura ne conferma una metà e boccia l'altra.** Nasce da una sua domanda («è meglio un
calciatore che gioca sempre o uno che salta qualche partita ma con un'ottima fantamedia?») e la risposta
a QUELLA domanda è netta e dipende da una cosa sola: se in quel ruolo hai un ricambio.

### 26.1 Per UN uomo: il ricambio decide tutto

Quanta fantamedia serve per pareggiare uno che gioca tutte le 38 giornate a 6,30, se ne salta un po'
(con `desc_replacement_fielded` = 6,37 a centrocampo, misurato in `metrica-asta-surplus-v1.md` §21, e
`HOLE_COST` = 4,73 quando riserva non c'è):

| giornate giocate | con un ricambio | senza ricambio |
|---|---|---|
| 34 | 6,29 | 7,60 |
| 30 | 6,28 | 9,24 |
| 22 | **6,25** | **14,32** |

**Con un ricambio la fantamedia che serve non sale quasi**, perché il riserva vale quanto lui; senza
ricambio serve un giocatore che non esiste. Sul dato vero (seconda fascia dei centrocampisti, 2025-26):
Zambo Anguissa 6,81 di fantamedia in 18 giornate rende **123** punti suoi, che diventano **250** se hai
un ricambio e **28** se non l'hai; Barella 6,72 in 34 giornate rende 228, cioè 254 e 210. **Con la
panchina piena sono equivalenti; senza, uno dei due è un disastro.**

### 26.2 Per una ROSA la regola si rovescia, ed è la parte che la misura corregge

Tradotta in un piano d'acquisto — nei posti che servono a coprire l'undici si comprano le presenze, nei
posti di scorta si compra il voto — e confrontata con le alternative a budget uguale sulle dieci
stagioni vere:

| piano | punti | buchi | R-Factor | appaiato |
|---|---|---|---|---|
| **presenze su tutti i 25 posti** | **2686** | **5,1** | **20,1** | — |
| valore (fm × presenze) | 2683 | 6,5 | 16,9 | −3,8 ± 13,5 |
| **la regola: presenze fino a coprire, poi fantamedia** | 2680 | 7,4 | 16,9 | **−6,4 ± 12,7** (5/10) |
| il contrario: fantamedia prima, presenze in panchina | 2658 | 10,5 | 14,8 | −27,9 ± 16,2 (3/10) |
| fantamedia su tutti i 25 | 2601 | 24,6 | 10,7 | −85,2 ± 46,1 (4/10) |

**La DIREZIONE della regola è giusta**: il suo contrario costa 28 punti e la versione estrema (comprare
chi segna) ne costa 85 con 24,6 buchi. **Il raffinamento invece vale zero**: comprare presenze su tutti
e venticinque i posti è indistinguibile dalla regola (−6,4 ± 12,7, cinque stagioni su dieci).

**E la ragione è che la regola contiene una contraddizione**: «dove hai copertura» presuppone che un
posto di scorta non serva a coprire, ma **il lavoro di un riserva È coprire**. Se lo scegli per il voto
invece che per le presenze, non può fare il lavoro per cui l'hai comprato — e il §26.1 dice che quel
voto lo incasserai poche volte, perché per definizione gioca poco. La panchina è più corta di quanto
sembri: di otto centrocampisti in rosa ne sono disponibili **5,3** in una giornata media (misurato in
`metrica-asta-surplus-v1.md` §21), quindi un posto in cui «la copertura c'è già» non esiste.

### 26.3 La versione che sopravvive

**Per un uomo**: una fantamedia alta compensa le partite saldate solo se in quel ruolo hai un altro che
gioca; e questo si può leggere al tavolo, perché è la copertura attesa del reparto (`covered_places`).
**Per la rosa**: le presenze su tutti i posti, e la fantamedia solo come spareggio fra uomini con le
stesse presenze attese — che è esattamente quello che il motore fa dentro una fascia (§25) e vale
l'1%. Il portiere è il caso limite in cui le due cose coincidono: ne schieri uno, quindi non esiste
copertura e conta solo chi gioca — ed è dove il motore vale il doppio che altrove (§21.7).

## 27. Il TETTO di un'offerta: per RUOLO, per SLOT e per STATO DELL'URNA

**03/09/2026, dalle domande dell'operatore al tavolo: «un TOP d'attacco o due del secondo slot?», «la
regola vale anche per centrocampisti, difensori e portieri?», «se lo slot 2 è esaurito il tetto sale?».
Tutti i numeri sono PER GIORNATA su sua richiesta** («per me è più facile capire di che grandezze
parliamo»), e la conversione è quella: un totale di stagione diviso 38.

**IL PRIMO SLOT NON È UNA FASCIA PIATTA, e da lì viene tutto il resto.** Misurato il rapporto fra il
prezzo del più caro e del decimo dentro ogni slot: dal secondo slot in giù è **1,0-1,3** (dieci uomini
quotati uguale, e allora solo il motore li separa), nel primo è **1,7-2,5** (il più caro costa il doppio
del decimo). È la ragione per cui la scelta del motore dentro il primo slot **perde** contro il più caro
(per scelta: D −16,4 · C −12,1 · A −6,3 fantapunti sul totale dell'uomo) e vince largo dal secondo in
giù (+37,6 · +45,4 · +50,2). Non è che il mercato sia meglio informato in cima — misurato, là sbagliamo
di MENO (errore 5-6 giornate contro 7-8): è che là il prezzo sta ancora dicendo qualcosa.
Conseguenza per la plancia: dentro uno slot si ordina per **valore atteso** (fantamedia × presenze) e
non per presenze pure, così il criterio si adatta da sé — dove il prezzo è piatto domina la presenza,
dove è una scala tiene conto anche del voto.

### 27.1 Un top d'attacco contro due del secondo slot

Quattro piani, stesso budget e stessa rosa, dieci stagioni vere, punti **a giornata**:

| piano | pt/giornata | buchi | R-Factor | mod. dif. | speso in attacco |
|---|---|---|---|---|---|
| **due del secondo slot**, nessuno del primo | **70,9** | **5,0** | **19,1** | **22,6** | 325 |
| nessun attaccante di 1° o 2° slot | 70,8 | 6,7 | 18,1 | 21,7 | 190 |
| libero | 70,6 | 6,5 | 16,9 | 21,2 | 283 |
| **un TOP** (uno dei 3 più cari) + il resto | **70,1** | 8,1 | 15,8 | 20,0 | **460** |

Appaiato: la coppia vale **+0,8 punti a giornata**, 8 stagioni su 10. Il meccanismo è nelle colonne di
destra — il top spende 135 crediti in più in attacco e li paga in buchi e nei due modificatori, che
questa lega paga in **voti base di tutti e undici** e non in gol.
**E il conto è generoso col top**: nel modello costa 271 crediti, mentre nelle aste vere l'acquisto più
caro di una rosa è il **43% del budget** (~430). Gli ho fatto uno sconto del 40% e perde comunque.

### 27.2 Il tasso di cambio, e perché il tetto è una QUOTA e non una cifra

**Un credito speso sul resto della rosa vale 0,0055 punti a giornata** (5-6 punti a giornata per 1000
crediti, misurato variando il budget). Senza quel numero nessun tetto si può scrivere; con quello, il
tetto di un uomo è *(il suo vantaggio a giornata sull'alternativa) ÷ 0,0055*.

E il tetto **scala col budget**, verificato a 500 · 1000 · 2000: il segno gira fra il **17,5% e il 19%**
in tutti e tre i casi, cioè a 88 · 190 · 380 crediti. Tre numeri diversi, **una sola soglia** — che è la
lezione del §18.3 («una soglia assoluta non si confronta fra budget diversi») applicata a un tetto.

### 27.3 Per RUOLO, e la difesa fa l'opposto di quello che l'intuizione dice

Uno del primo slot contro due del secondo, dieci stagioni:

| ruolo | il mercato chiede | il tetto | verdetto |
|---|---|---|---|
| **portieri** | 60 (6%) | **~130 (13%)** | il tetto è il doppio: **si compra** |
| **difensori** | 48 (5%) | **nessun prezzo** | negativo a ogni quota, già −0,10 a 30 crediti e −0,48 a 50 |
| **centrocampisti** | 90 (9%) | ~65 (6,5%) | il mercato chiede un po' troppo |
| **attaccanti** | 255 (25%) | ~180 (18%) | il mercato **sfonda** |

**Il meccanismo è il regolamento e non i dati: quanti ne SCHIERI.** Del portiere ne schieri uno, quindi
la sostituzione due-per-uno non esiste e non esiste copertura — là conta solo che ci sia, ed è anche il
ruolo dove il motore vale il doppio (§21.7). Dei difensori ne schieri quattro e il modificatore premia
la media dei **tre migliori**: la difesa vuole quantità di voti decenti, non un fenomeno, e la
sostituzione due-per-uno funziona meglio che altrove.
**Questo corregge una frase detta a voce nella stessa sessione**: «difesa TOP è la strategia migliore»
resta vero (18% di titoli contro il 10% del caso) ma NON vuol dire comprare il difensore più caro —
vuol dire mettere più soldi nel reparto, spalmati. È esattamente quello che il tilt adottato fa: paga
sopra mercato le **prime quattro fasce** della difesa, non il singolo top.

### 27.4 Slot per slot: il tetto non scende, il prezzo sì

Uno dello slot k contro due dello slot k+1, in attacco:

| slot | il mercato chiede | il tetto |
|---|---|---|
| 1° | 255 (25%) | ~170 (17%) |
| 2° | 104 (10%) | ~130 (13%) |
| 3° | 50 (5%) | ~145 (15%) |

**Il tetto resta piantato fra il 13% e il 17% mentre il prezzo crolla 255 → 104 → 50.** Quindi il
mercato sfonda **in un posto solo**, il primo slot; dal secondo in giù chiede molto meno di quanto quegli
uomini valgono, e non serve un tetto — serve prenderli. Letto al rovescio è la frase che questa sessione
ha trovato in cinque forme diverse: **il mercato sovrapprezza il primo slot e sottoprezza tutto il
resto.**

### 27.5 E se lo slot 2 è ESAURITO il tetto sale — ma non subito

La domanda dell'operatore su un'asta in stato avanzato. Uno del primo slot contro i sei migliori
attaccanti rimasti, al variare di quanta profondità è ancora viva:

| stato dell'urna | pareggio | in crediti |
|---|---|---|
| slot 2 disponibile (inizio d'asta) | 21% | 208 |
| **slot 2 esaurito** | 22% | 224 |
| **slot 2 e 3 esauriti** | **32%** | **323** |

**Esaurire il solo slot 2 quasi non muove niente** (21% → 22%), perché l'alternativa non è «due del
secondo slot» ma «due dei migliori che restano», e il terzo slot è un sostituto quasi buono. **Il salto
arriva a due slot vuoti: +44% di tetto**, e là il primo slot vince **10 stagioni su 10 a 50 crediti e 9
su 10 a 150** — la lettura più netta della sessione. In pratica: *finché sotto di lui c'è profondità un
top vale 210; quando la profondità è finita ne vale 320* — e chi aspetta troppo lo paga il 50% in più
non perché il mercato impazzisca, ma perché ha ragione.
Con l'ordine a reparti l'attacco si gioca per ultimo, quindi il caso da 32% capita quando un top viene
estratto **tardi dentro la fase d'attacco** — che è esattamente la situazione in cui l'istinto direbbe
di risparmiare.

### 27.6 I tre nomi di oggi, e i limiti

Sul foglio del 01/09, con la max offerta ancorata al 18% per l'uomo mediano dello slot e scalata sui
punti a giornata di ciascuno: **Malen ~190 · Lautaro ~175 · Hojlund ~150**, contro un mercato che chiede
**271 · 279 · 223**. Tutti e tre fuori soglia, e pagarli a mercato costa fra 0,4 e 0,7 punti a giornata.
Hojlund è il caso interessante: 6,17 punti a giornata contro i 6,23 di Malen (33 giornate attese, le più
alte del listone) con un FVM di 257 contro 414 — la stessa resa a un prezzo più basso.
E la coppia da prendere invece: **Krstovic ~84 + Esposito F.P. ~75 = ~159**, cioè meno di quanto uno solo
dei tre chiede.

**Tre limiti, e il secondo è un fatto sul database.**
- **Le soglie hanno 3-8 stagioni concordi su 10.** La direzione è netta (il segno gira sempre fra il 13%
  e il 19%, su tre slot e tre ruoli indipendenti, e la differenza cresce col prezzo fino a −1,2 punti a
  giornata al 30%) ma il punto esatto no. Quello che si può dire secco: **sopra il 20% del budget si
  sbaglia in qualunque slot, sotto il 10% non si sbaglia mai.**
- **L'FVM non esiste prima del 2022-23** (zero uomini su sei finestre di dieci; dove esiste copre 49-57
  attaccanti su 80). Quindi ogni misura fatta sul rango di FVM vive su **quattro** stagioni, non su
  dieci — ed è per questo che i tetti pubblicati qui sono misurati sul rango di **Qt.I**, mentre la
  plancia taglia per FVM. La discrepanza è dichiarata, non risolta.
- **Un tetto misurato contro «esattamente due del secondo slot» (18%) e uno misurato contro «i sei
  migliori rimasti» (21%) sono due numeri diversi e nessuno dei due è sbagliato**: la seconda
  alternativa è più flessibile perché l'ottimizzatore può spendere altrove. La banda vera per l'inizio
  d'asta è **18-21%**.
