# Una rosa per TRE GIORNATE — la seconda competizione classic, e i quattro difetti che ha trovato
**Aggiornato: 3 settembre 2026, sera tardi** (§11: il piano a due cambi, misurato; e la
correzione di una riga del §8 che aveva scambiato una soglia di filtro per un risultato).
Nato da una richiesta dell'operatore: «costruiscimi una rosa
(Serie A) 3886 con un budget di 250 (il prezzo dei calciatori è la Qt.A) ottimizzata per le prossime 3
giornate (dalla 3 alla 5)». Il regolamento è arrivato in **sei messaggi successivi**, e ogni messaggio
ha spostato un numero: è la ragione per cui questo verbale tiene il regolamento in cima e le misure
sotto, e non il contrario.

Verbali vicini: [simulatore-asta-rilanci-v1.md](simulatore-asta-rilanci-v1.md) per l'asta a rilanci
(altro gioco, altri parametri), [letture-app-v1.md](letture-app-v1.md) per le colonne del foglio,
`spec-euroleghe-ingest-v9.md` «Novità v9.68» per le quattro cure al toolkit che questa sessione ha
trovato.


## §1. IL REGOLAMENTO, dichiarato — e non è la sua lega da 1000

Non si scambia con [la lega classic da 1000 crediti](../../CLAUDE.md): la forma rosa è la stessa
(3/8/8/6) e **tutto il resto è diverso**, quindi nessun parametro passa dall'una all'altra.

- **250 crediti**, e il prezzo è la **Qt.A** (quotazione attuale, rivista tutta la stagione), non la
  Qt.I. A stagione in corso è la scelta giusta: per una giornata FUTURA la Qt.A non contiene l'esito.
- **Almeno 2 U23** («nati dal 1/1/2004») e **max 3 della stessa squadra di Serie A**.
- **Mod. difesa**: servono **almeno 4 difensori schierati**, poi la media voto dei **3 migliori
  difensori + IL PORTIERE**; da `mv >= 6,00` vale +0,5 e sale di 0,5 ogni 0,25 di voto, **fino a +3**
  (che si raggiunge a 7,25). Sotto il 6 è zero.
- **Capitano**: raddoppia **solo i bonus**, non il voto base. Quindi il capitano è chi segna, non chi
  ha la fantamedia più alta.
- **NESSUN voto d'ufficio**: se un titolare non prende il voto entra il panchinaro del suo ruolo; se
  nessuno di quel ruolo è disponibile, il posto è uno **ZERO**.
- **5 sostituzioni automatiche a giornata**, per ruolo, dall'ordine di panchina dichiarato.
- **SWITCH, uno solo**: si accoppia un uomo in campo a uno in panchina e se quello in campo **NON
  PARTE TITOLARE** nella sua partita reale si scambiano da soli, **senza consumare una sostituzione**.
- **10 cambi rosa in tutto** dopo le prime giornate.

**Il regolamento della cosa vera si chiede, non si deduce.** La prima versione di questo lavoro ha
girato per un'ora con la scala del modificatore fermata a +2,5 (mia congettura su «fino a mv>=7 ->
+2,5»), il minimo di 4 difensori ignoto, le sostituzioni ignote e lo switch inesistente. Nessuna di
quelle quattro cose era deducibile dai dati, e tre su quattro hanno spostato la risposta.


## §2. LO SWITCH SCATTA SU «PARTE TITOLARE», che è l'altra quantità

La regola dello switch poggia esattamente sulla distinzione che questo progetto tiene separata
(CLAUDE.md, «TITOLARITÀ ha UNA sola accezione qui»): **titolarità** = prende il voto,
**quota da titolare** = è sulla distinta. Lo switch legge la SECONDA. Servivano quindi due curve, e
sono misurate sulla stagione in corso, fuori campione (letture editoriali prese PRIMA di ogni
giornata, giornate 1 e 2 di 2026-27, 932 osservazioni sul listone intero).

**P(prende il voto), sulla giornata SUCCESSIVA**, per `starter_prob` editoriale:

| starter_prob | 0,05 | 0,20 | 0,375 | 0,51 | 0,64 | 0,775 | 0,93 | assente |
|---|---|---|---|---|---|---|---|---|
| P(voto) | 0,013 | 0,141 | 0,374 | 0,643 | 0,713 | 0,791 | 0,952 | **0,063** |

**P(PARTE TITOLARE)**, stessa popolazione (795 osservazioni con una riga nello strato per-partita):

| starter_prob | 0,05 | 0,20 | 0,375 | 0,51 | 0,64 | 0,775 | 0,93 | assente |
|---|---|---|---|---|---|---|---|---|
| P(parte) | 0,020 | 0,156 | 0,217 | 0,357 | 0,419 | 0,695 | 0,910 | **0,028** |

E il fatto che tiene insieme le due: **P(voto | è partito) = 1,000 in OGNI bucket**. Chi parte prende
sempre il voto, quindi `P(voto | non parte) = (q − s) / (1 − s)` è esatta e non stimata — verificata
contro il conteggio diretto in tutti e sette i bucket, identica a tre decimali. Una sola curva in
meno da inventare.

**E l'editoriale batte il motore sulle giornate vicine.** Brier (più basso è meglio): sulla MD1
**0,133** contro 0,175 di `est_pv/38`; sulla MD2 0,153 contro 0,178, dove la miscela 50/50 è la
migliore delle tre (0,1505). Quindi: giornata imminente = editoriale puro, giornata dopo = metà e
metà. Oltre non è misurato — due giornate sono tutto quello che la stagione ha giocato — e la MD5
tiene il modello della MD4 dicendolo.

**Chi ENTRA invece di partire perde BONUS, non voto.** Misurato su Serie A 2022-26: il voto base è
identico (D −0,013 · C +0,009 · A −0,008), il fantavoto no (**A −0,439** · C −0,129 · D −0,050). Un
subentrato ha meno tempo per segnare, non prende un voto peggiore. Conseguenza che si legge da sé: lo
switch vale molto più in attacco che in difesa, e il modificatore non lo vede affatto.


## §3. IL MODIFICATORE DI DIFESA: il +3 esiste e non si raggiunge

L'operatore ha fatto notare, giustamente, che il modificatore legge i voti **realizzati** e non quelli
attesi: «può anche darti i 3 punti se becchi la giornata buona che i tuoi 3 migliori difensori fanno
una grande prestazione (ad esempio fanno un gol) e prendono 7.5 e il tuo portiere pure». Il
meccanismo è vero sui dati — **un difensore che segna prende 6,998 di voto base contro 5,888** (+1,11)
— e il numero è comunque piccolo, perché un gol è il **3,7%** delle presenze di un difensore (594 su
16.160).

Distribuzione simulata sui voti realizzati, con i residui EMPIRICI (non gaussiani) e la correlazione
dentro il club:

| +0 | +0,5 | +1,0 | +1,5 | +2,0 | +2,5 | **+3,0** |
|---|---|---|---|---|---|---|
| 14,56% | 30,01% | 34,48% | 16,84% | 3,70% | 0,39% | **0,02%** |

Media **0,83 punti a giornata**. E il tetto comprabile: **il miglior portiere + i tre difensori con la
MVa più alta del listone fanno media 6,264**, cioè +1,0 — e costano 68 crediti su 250. Le MVa dei
difensori si stringono fra 5,85 e 6,37, quindi oltre il primo gradino non si arriva pagando.

**E LA MIA ASPETTATIVA SULLA CODA ERA SBAGLIATA, il che è la parte utile.** Avevo sostituito la
gaussiana coi residui empirici aspettandomi una coda destra grassa: il residuo del voto base di un
**difensore è asimmetrico a SINISTRA** (skew **−0,275**), e `P(residuo >= +1,5)` legge 0,61% empirica
contro 0,60% gaussiana — identiche. Una brutta partita punisce forte un difensore, una buona si ferma
verso il 7 se non segna. (Attaccanti +0,481 e centrocampisti +0,166 la coda ce l'hanno: è una
proprietà del ruolo, non del voto.)

**La correlazione dentro il club è reale e NON aiuta il modificatore.** Misurata col null giusto:
difensore-difensore dello stesso club nella stessa partita **r = +0,359** (32.861 coppie) contro
**−0,011** fra club diversi nella stessa giornata (115.520 coppie), difensore-portiere +0,204. Quindi
il co-movimento è del CLUB e non della giornata, e concentrare la difesa in un club aumenta la
varianza del modificatore. Effetto misurato: **−0,006**, cioè niente. La ragione è che **la scala è
localmente LINEARE dove sta una difesa comprabile** (media ~6,26, in mezzo ai gradini, lontano da
entrambe le saturazioni): la varianza è neutra. È «il valore di una soglia non si può scrivere su una
riga» letto dal lato della dispersione invece che da quello del singolo uomo.


## §4. IL PORTIERE: se ne schiera UNO, e questo cambia l'aritmetica

**Esattamente un portiere di un club gioca.** Il progetto lo aveva già scritto dall'altro lato — la
pagina delle buste chiuse (`keeperCovered`) tratta la copertura del reparto come una SOMMA e non come
una convoluzione — e questa sessione ha scoperto di non leggerlo: la simulazione estraeva la
disponibilità dei portieri **indipendente**, quindi un trio dello stesso club leggeva l'8% di
probabilità di ZERO in porta dove il vero è 0,0000, e una coppia leggeva due uomini indipendenti
all'87% dove al massimo uno può presentarsi. Curato in **obiettivo E simulazione** (era il caso
peggiore: l'obiettivo scegliva coi portieri indipendenti e la verifica giudicava con quelli
esclusivi, cioè si ottimizzava una quantità e se ne misurava un'altra).

La maglia del club si estrae una volta: il primo portiere prende il suo `P(parte)` e il resto della
massa va ai vice in proporzione ai loro, così le probabilità sui portieri di un club **sommano a 1**.
Verificato: somma 1,0000, sovrapposizione massima 0,00000.

**E la struttura migliore è quella dell'operatore, non la mia.** Io ero arrivato al trio di UN club
(copertura 1,0000 per costruzione); lui ha proposto **tre PRIMI portieri di tre club diversi**:

| portieri | costo | punti/giornata | copertura |
|---|---|---|---|
| **Butez (Como) + Tornqvist (Monza) + Corvi (Parma)** | **18** | **73,53** | 0,9953 |
| Maignan + Tornqvist + Corvi | 18 | 73,51 | 0,9953 |
| Butez + Sanchez Ro. + Vigorito (trio Como) | 24 | 73,49 | 1,0000 |
| Tornqvist + Corvi + Palmisani | 8 | 73,26 | 0,9953 |

Il trio di un club **paga due vice che non giocano MAI** (Sanchez Ro. 8 crediti a 0,01 di probabilità)
per una copertura perfetta che il caso chiede una volta su duecento; tre titolari costano 6 crediti in
meno e giocano tutti. La differenza in punti è quasi nulla perché i 6 crediti liberati vanno sul
movimento e valgono più o meno quello che vale la copertura perfetta — ma la struttura è più semplice
e regge meglio.

**E LA SUA PROPOSTA HA TROVATO UN DIFETTO DEL MOTORE: la distinta si dichiara OGNI GIORNATA.** Il mio
motore ordinava la lista una volta sola sulla prima giornata e la teneva per tutte tre, mentre una
distinta si consegna ogni settimana e davanti si mette chi ha la partita migliore. Penalizzava poco
quasi tutte le rose e **molto la sua**: tre club hanno tre calendari, tre portieri di un club ne hanno
uno. Corretto, e la prova che ora funziona è che **la stessa terna in ordine invertito legge 0,00 di
differenza** — l'ordine lo ricalcola il motore, non lo prende da chi glielo passa. Si vede
nell'undici: alla MD3 gioca **Corvi** (Parma-Monza, +78 di margine) e non Butez (Como a Genova, +75),
perché il Parma è più sopra la propria media di quanto il Como sia sopra la sua.

**Un portiere, in generale, non si paga.** La FMa dei portieri sta tutta fra **4,91 e 5,24**, e
Stankovic F. a 6 crediti ha la **MVa più alta del listone (6,25)**, sopra Carnesecchi a 17 (6,24).
Pagare il portiere top vale 0,16 di FMa, cioè ~0,15 punti a giornata. Il calendario invece per lui
conta il doppio di ogni altro ruolo (+0,175 di fantavoto per 100 Elo contro +0,076 di un difensore) e
il voto base non si muove (−0,014): per un portiere **tutto il guadagno di una partita facile sono
gol non presi**.


## §5. LO SWITCH VALE POCO, E PER UNA RAGIONE PRECISA

Con **una sola** coppia, la migliore su una rosa data vale **+0,743 fantapunti sulle tre giornate**
(differenza appaiata, errore standard 0,004, t 184) — e la classifica di tutte le coppie possibili è
piatta: il secondo vale +0,616, il terzo +0,548. Con sei coppie ammesse il totale sarebbe +0,9, e la
sesta è **negativa**.

**Vale poco perché ci sono 5 sostituzioni a giornata**: la rosa ne consuma 1,7-2,3, quindi la
copertura c'era già e lo switch arriva su un problema risolto. Non è un meccanismo debole: è un
meccanismo che, in questo regolamento, non trova lavoro. Con sostituzioni scarse varrebbe molto di
più — e lo si vede dal fatto che il tetto di 5 rifiuta una sostituzione solo nel **7,42%** delle
stagioni simulate, cioè l'obiettivo esatto (che le assume libere) è quello giusto.

**La forma della coppia che paga**: in campo l'uomo col **calendario** migliore, in panchina quello
con la **qualità** più alta. Nella rosa consegnata è Elphege (Parma in casa col Monza, +78) accoppiato
a Boga (FMa 7,00, Juventus): Elphege batte Boga *solo* grazie al calendario (6,924 contro 6,848 dopo
il termine), e se non parte lo switch restituisce Boga. I due meccanismi si compongono.


## §6. QUANTO LARGA DEVE ESSERE LA ROSA — la sua struttura, misurata

Sua osservazione: «3-8-8-6 è una rosa molto larga per 3 partite, penserei di prendere 2-5-4-4
calciatori di buon valore ed il resto tutte scartine da 1 credito per ottimizzare l'11 titolare».
L'ottimizzatore aveva già la libertà di farlo e non lo faceva, quindi uno dei due sbagliava.

| struttura | punti/giornata | uomini > 1 cr | crediti sull'11 | buchi |
|---|---|---|---|---|
| libera (nessun vincolo) | **73,54** | 22 | 206 | 0,363 |
| **la sua: 2-5-4-4 + 10 scartine** | **73,33** | 15 | 221 | 0,472 |
| 20 liberi dove pagano | 73,18 | 19 | 219 | 0,448 |
| 15 liberi dove pagano | 73,20 | 15 | 221 | 0,604 |
| 17 liberi dove pagano | 73,12 | 15 | 231 | 0,554 |
| 13 liberi | 72,86 | 13 | 232 | 0,646 |
| 11 liberi | 72,80 | 11 | 234 | 0,823 |

Due letture, e la seconda è a suo favore. **La direzione è giusta e costa 0,21 a giornata**: la
tabella dice perché, i buchi vanno da 0,363 a 0,472 e in questa lega un buco è uno ZERO. Ma **la sua
allocazione PER RUOLO batte i 15 slot liberi messi dove l'ottimizzatore preferisce** (73,33 contro
73,20): imporre un ricambio buono in ogni reparto è meglio che lasciar decidere. E la curva sotto i 15
è monotona: stringere continua a costare, perché i crediti spostati sull'undici valgono ~0,02 a
giornata l'uno mentre la copertura persa vale di più.

L'ottimizzatore libero, per conto suo, mette **206 crediti su 250 nei primi undici** — cioè l'82%:
«dai priorità agli 11» è già quello che fa, e spingere oltre scambia copertura per qualità in perdita.

**E la prima corsa di questa misura ha dichiarato la sua struttura INFATTIBILE, che era falso.** Il
mio filtro di affidabilità (`est_confidence >= 0,75`) lasciava **3 centrocampisti** a ≤1 credito dove
la struttura ne chiede 4, e la costruzione si fermava a 24/25. Gli uomini da un credito *sono* per
definizione quelli che il motore non sa prezzare: **il filtro appartiene agli UNDICI, non alle
scartine** — un corpo non ha bisogno di una valutazione per fare da corpo, e il confronto deve offrire
gli stessi corpi a ogni struttura o non è un confronto. Seconda infeasibilità falsa della sessione
(l'altra: un seed che non trova una rosa non è una prova che non esista).


## §7. LE COSTANTI DELL'AMBIENTE, misurate qui

- **Un credito vale ~0,02 punti a giornata.** La stessa ricerca a 190 crediti invece di 250 legge
  **−1,3 a giornata**: il budget morde poco, quindi tenerne da parte per i 10 cambi costa quasi nulla.
- **Il minimo di 4 difensori è GRATIS**, e questo era misurato prima di sapere che la regola lo
  imponeva: il 4-3-3 legge 219,9 contro i 219,4 del 3-4-3 a modificatore libero, e se il modificatore
  pretende quattro difensori il 3-4-3 lo perde e crolla a 217,8. **Una sola risposta sotto entrambe le
  letture**, quindi l'ambiguità si è chiusa con una misura invece che con una seconda domanda.
- **Le stime comprano quasi nulla**: la rosa costruita col solo calcio misurato legge 219,3 contro i
  220,4 di quella aperta alle stime, cioè **+1,1 fantapunti sulle tre giornate**. Il filtro di
  affidabilità è quindi quasi gratis — e va tenuto, perché `estimates` ha già misurato che ordinare
  per le stime costa il 12,4% su 10 finestre di 10.
- **E per una promossa l'ancora è la MEDIA DI LEGA**, che è un difetto da conoscere: Frosinone, Monza
  e Venezia leggono tutte esattamente **6,83** per un A e **5,97** per un D, perché non hanno storia
  in Serie A e il ripiego è l'ancora di ruolo. Così un attaccante del Frosinone legge meglio di uno
  del Milan (6,52). È la ragione per cui gli `anchor` restano fuori dagli undici.


## §8. LA ROSA CONSEGNATA, e quella dell'operatore

Rosa costruita: **4-3-3, 250/250, 73,53 fantapunti a giornata** (banda 5-95%: 208-230), U23 3, max 3
per club, 15 club, buchi 0,338 su 33 posti-giornata, sostituzioni 2,3 delle 5.
Portieri Butez 15 + Tornqvist 1 + Corvi 2 (la sua terna). Capitano Malen (1,41 di bonus a presenza,
+1,22 a giornata). Switch Elphege ↔ Boga.

**La rosa che l'operatore aveva già costruito** (Butez/Corvi/Tornqvist · Bremer, Cabal, De Winter,
Dimarco, Marin R., Mazzocchi, Solet, Tiago Gabriel · Baturina, Belahyane, Cissè A., Ekkelenkamp,
Fadera, Gorter, Mora, Mout · Bayo V., Berardi, Kean, Lucca, Malen, N'Dri) legge **71,09 a giornata**,
cioè **−2,44** in confronto appaiato (errore standard 0,02). È legale, 250/250 esatti, U23 4, max 3
per club, un solo indisponibile (Cabal, 1 credito), e i prezzi combaciano su tutti e 25.

**Il divario è COPERTURA, e sta in attacco**: buchi 0,742 contro 0,338, di cui **0,448 in attacco**.
Dopo Malen (parte 0,87) nessuno dei suoi cinque attaccanti parte più del 40% — Berardi 19 crediti a
0,38 e **Kean 24 crediti a 0,38, letto `riserva`** — quindi tre posti da riempire con sei uomini tutti
fra 0,24 e 0,40.

**E 0,19 dei 2,44 sono cecità mia, non un difetto suo**: 29 crediti della sua rosa sono su uomini
`anchor` (Mora 20 · Cissè A. 5 · Marin R. 2 · Mout 1 · Tornqvist 1) che il motore non sa prezzare e
che io tengo fuori dagli undici. Ammettendoli al loro valore la sua rosa passa da 71,08 a **71,28**.
Su Mora, 20 crediti, il mio numero non è un giudizio: è un'assenza di dati. Il resto (2,26) è reale.
~~**Nessuno scambio a budget invariato guadagna più di 0,15 a giornata** — cercato su tutti i 25 contro
l'intero serbatoio~~ — **FALSA, e il numero era una SOGLIA DI FILTRO letta nell'unità sbagliata**: 0,15
era il `diff.mean() <= 0.15` con cui `cura.py` scartava le righe da stampare, in fantapunti sulle TRE
giornate (cioè 0,05 a giornata), e il log che quella stessa riga aveva prodotto stampava in cima
**Kean → Simeone +0,591 a giornata**. Il massimo vero di uno scambio singolo è **+0,58 a giornata**
(§11). La conclusione che ne seguiva resta giusta — serve spostare crediti dai ballottaggi d'attacco
alle presenze, cioè due dei suoi dieci cambi — ma per l'aritmetica del §11 e non per questa.


## §9. IL METODO, e i suoi errori

**L'obiettivo è ESATTO dove può esserlo e simulato dove non può.** I punti dell'undici schierato sono
un cammino di Poisson-binomiale per ruolo; il modificatore, che è una **soglia su una media di voti
realizzati**, è enumerato sui 256 pattern di disponibilità degli otto difensori contro i quattro esiti
del portiere; lo switch e il tetto di 5 sostituzioni, che non sono lineari negli uomini, sono simulati
con la dispersione **misurata** del voto base (sd P 0,556 · D 0,583 · C 0,556 · A 0,680, residui
ricampionati dai veri) e la correlazione **misurata** dentro il club.

**Ogni confronto è APPAIATO**: stesse estrazioni, stessa rosa di movimento, si muove una cosa sola.
Senza questo, differenze di 0,3-1,2 fantapunti su 220 non sono distinguibili dal rumore della ricerca
locale — e infatti fra due avvii della stessa ricerca ci sono ±0,1 a giornata, che è la ragione per
cui i numeri qui sopra si citano a due decimali e non a tre.

Cinque errori miei, tutti trovati misurando e tutti della stessa famiglia — **un modello che non
poteva vedere la cosa che gli si chiedeva**:

1. **Una lettura VUOTA che scavalca una piena** (già a verbale il 20/08 per `load_reference`): al
   03/09 il DB portava i probabili di 10 club su 20 e ho letto «la pagina esce squadra per squadra».
   Falso — vedi la spec, era `fc_site` a cancellarla. Ma la difesa scritta intanto resta giusta: la
   lettura si prende **per club al suo giorno più fresco**, e l'assenza è prova solo su un club che
   quel giorno è stato pubblicato.
2. **Lo stato di un interruttore che viaggia fra due valutazioni**: la colonna «gioca» dello stampato
   veniva calcolata con l'ordine di schieramento lasciato dall'ultima iterazione di un ciclo, quindi
   descriveva un undici diverso da quello per cui la rosa era stata costruita (Cabal leggeva 0,01
   stando secondo fra i difensori). «Verifica la FUNZIONE, non la colonna che le somiglia», ennesima.
3. **Una classificazione a catena `if/elif` in ordine arbitrario**: la prima etichetta si è mangiata i
   casi delle altre e ho riferito «22 assenti perché senza calcio misurato» quando la controprova
   diceva che 182 su 205 uomini in quella condizione erano invece presenti.
4. **Una potatura corretta per un VALORE e sbagliata per una STRUTTURA**: `prune` scarta chi è dominato
   dentro (ruolo, club) su prezzo e valore, e il **terzo portiere di un club è dominato dal secondo** —
   giusto se compri un valore, sbagliato se compri la maglia chiusa. Ha escluso **dieci club su venti**
   dal confronto dei trii, incluso il vincitore (il Como), e ha prodotto una raccomandazione sbagliata
   (Bologna) che l'operatore ha smascherato con una domanda: «se prima mi indichi Butez come miglior
   portiere perché dopo mi suggerisci Bologna?».
5. **Due infeasibilità dichiarate e false** (§6, e un seed che piazzava i movimento prima dei portieri
   di un club e poi non li faceva stare): un costruttore che non trova una soluzione non è una prova
   che non ci sia.


## §10. COSA RESTA APERTO

- ~~**Il piano a due cambi**~~ **misurato il 03/09/2026, sera tardi: §11.**
- **Mora e gli altri `anchor`**: se l'operatore sa che giocano, il motore non lo sa e non lo saprà
  finché non giocano. Il canale che li vedrebbe è l'acquisizione, non una formula — è la stessa
  conclusione del §"la retta non ha un termine di LIVELLO" della spec.
- **La pagina della sua lega** (`leghe.fantacalcio.it/.../view/rosters/...`) non è leggibile: è un'app
  Angular che serve solo il guscio e risponde 404 su tutto il dominio, JS compresi. Il login funziona
  (fra i cookie c'è `comp_<lega>_FCLeague2026`), è la rotta che non risponde da server. La via giusta,
  se un giorno serve, è quella che la todolist prescrive già per Transfermarkt: pilotare un browser
  autenticato e **registrare le chiamate che la pagina fa**, invece di indovinare endpoint.
- **Gomes (Venezia, 1 credito)**: l'unico uomo su cui la pagina probabili di oggi e la rosa live del
  provider litigano sul club e la seconda vince. La cura («dove le fonti litigano vince la più fresca
  che sappia nominare il club») vale **un uomo da un credito**, quindi è misurata e non implementata.


## §11. IL PIANO A DUE CAMBI, misurato — e il secondo cambio è quello che il primo rende possibile

**03/09/2026, sera tardi**, dall'unico punto aperto del §10. Cercato su tutte le coppie ammissibili:
25 uomini che escono × 413 del serbatoio prezzabile, vincolati a 250/250 crediti sulla SOMMA (lui non
ha crediti liberi), U23 ≥ 2 e max 3 per club. Lo schermo è l'obiettivo ESATTO del §9 — separabile per
blocchi, quindi il guadagno di due mosse in reparti diversi è quasi la somma — e la verifica è la
simulazione completa, appaiata sulle stesse 300.000 estrazioni, con modulo, capitano e switch
ri-scelti come farebbe una rosa vera. Le due misure concordano a due centesimi (+1,425 esatto contro
+1,403 simulato sulla coppia migliore), che è la prova che lo schermo era lecito.

**UN CAMBIO SOLO NON PUÒ SPOSTARE CREDITI FRA REPARTI, ed è tutto lì.** A budget invariato una mossa
sola deve costare non più di chi esce, quindi il meglio che fa è **+0,58 a giornata** (Kean 24 →
Simeone 14). La coppia arriva a **+1,13** perché la prima mossa ne LIBERA dieci: Bayo V. costa 1 e
Adams A. ne costa 11, quindi il secondo cambio da solo **non era comprabile**. Il secondo cambio vale
quanto il primo (+0,55 contro +0,58) ed esiste solo grazie a lui.

**Le tre righe che contano** (a giornata, appaiate, la sua rosa parte da 71,09 con 0,739 buchi):

| fuori | dentro | crediti | a giornata | buchi |
|---|---|---|---|---|
| Mora 20 · Kean 24 | Perrone 10 · Martinez L. 33 | 249 | **+1,403** ± 0,003 | 0,510 |
| Mora 20 · Kean 24 | Paz N. 29 · Simeone 14 | 249 | +1,347 ± 0,007 | 0,507 |
| **Bayo V. 1 · Kean 24** | **Adams A. 11 · Simeone 14** | **250** | **+1,130** ± 0,006 | **0,428** |

Due cambi recuperano **1,40 dei 2,44** che separavano la sua rosa da quella costruita: il 57%, con due
dei suoi dieci cambi. E **Kean esce in ogni piano buono** — 24 crediti per un uomo che parte titolare
il 38% delle volte è il singolo punto più caro della rosa.

**LA RIGA DA CONSIGLIARE È LA TERZA, e la ragione è che le prime due vendono un uomo che non vediamo.**
Mora è `anchor`: 20 crediti su cui il motore non ha un numero suo, quindi lo demota in fondo all'ordine
e non lo schiera mai. Un piano che dice «vendi Mora» sta in parte dicendo «vendi l'uomo che non vedo»,
che non è un consiglio. Misurato muovendo UNA cosa sola — la stessa ricerca con la demozione degli
`anchor` accesa e spenta:

- la sua rosa legge **70,73** a giornata con gli anchor demoti e **71,08** credendoli: la nostra cecità
  su cinque uomini (Mora 20 · Cissè A. 5 · Marin R. 2 · Mout 1 · Tornqvist 1) vale **0,35 a giornata**
  sull'obiettivo esatto — lo stesso segno dei +0,20 che il §8 aveva misurato con la simulazione;
- la coppia migliore passa da +1,425 a **+1,288** credendo Mora, quindi il 90% del suo guadagno NON
  dipende dalla cecità: anche prendendo Mora per buono, quel piano paga;
- la terza riga legge **+1,119 in tutt'e due le letture**, per costruzione: non tocca un anchor.

Quindi le due risposte sono entrambe vere e vanno dette insieme: se si fida della nostra lettura, il
piano migliore è Mora → Perrone e Kean → Martinez L.; se vuole un piano che non dipenda da quello che
non sappiamo, è **Bayo V. → Adams A. e Kean → Simeone**, che vale un po' meno e **dimezza i buchi**
(0,739 → 0,428, e l'attacco da 0,448 a 0,14). Dopo quel cambio l'attacco schiera Malen, Simeone e Adams
A., tutti e tre allo 0,87 di quota da titolare, che è il tipo di reparto che il §"un riserva che compri
per il voto non può fare il lavoro per cui l'hai comprato" descrive dall'altro lato.

**Tre cose sul METODO, e la prima è un errore mio del pomeriggio.**
- **Una SOGLIA DI FILTRO non è un RISULTATO, e nemmeno nella stessa unità.** Il §8 diceva «nessuno
  scambio guadagna più di 0,15 a giornata» copiando il `<= 0.15` con cui lo script scartava le righe da
  stampare — un totale su tre giornate, cioè 0,05 a giornata — mentre il log stesso stampava +0,591 in
  cima. Due errori in una riga: il filtro preso per il massimo e le tre giornate prese per una. Si è
  visto **rieseguendo la funzione invece di citare il log**, che è la regola di casa applicata a sé
  stessi; e la conclusione che ne dipendeva («serve spostare crediti») per fortuna era giusta lo stesso.
- **Niente `prune` in questa ricerca**, per la lezione del §9.4: la potatura scarta chi è dominato dentro
  (ruolo, club) su prezzo e valore, e per un portiere la maglia chiusa non è un valore. Il serbatoio è
  tutto il listone prezzabile, 413 uomini.
- **Il vincolo di affidabilità resta quello del §6**: entra chi il motore sa prezzare (`est_confidence`
  ≥ 0,75) oppure chi costa da scartina, perché un corpo non ha bisogno di una valutazione per essere un
  corpo.

**Un limite che il banco non può togliere**: la ricerca assume che l'uomo che entra sia LIBERO. Chi è
già in un'altra rosa della sua lega non è comprabile, e quel dato non è in nessuna tabella qui — la
pagina della sua lega non è leggibile (§10). Se Martinez L., Simeone o Adams A. sono presi, la tabella
sopra si rilegge dalla riga successiva.
