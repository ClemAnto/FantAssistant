# La pagina STRATEGIA — quanti uomini per ruolo, e chi sono (v1)
**Aggiornato: 27 agosto 2026, sera** (nata il 26 agosto su richiesta dell'operatore; la regola del «posto
più arretrato» è del 26 sera e la sua misura del 27; l'ORDINE PERSONALE delle liste e la valutazione dei
moduli sono del 27). Commit `70c8ed6` e quello di chiusura del 27.
**Casa**: `app/src/app/core/strategy.ts` (+ `strategy.spec.ts`), `app/src/app/views/strategy/`,
`app/scripts/e2e-strategy.mjs`. Rotta `/strategy`, link «Strategia» dall'intestazione di Calciatori.

Documento autosufficiente: chi tocca quella pagina legga §3 (la moneta), §5 (le due forme respinte) e
§12 (gli aperti) prima di scrivere una riga.

---

## 1. Cos'è, e cosa NON è

La richiesta dell'operatore (26/08/2026): «una pagina dove impostare la *strategia* per l'asta ... a
partire da queste informazioni la pagina deve essere suddivisa in blocchi dove ogni blocco corrisponde a
un ruolo ... nel blocco deve esserci una lista di calciatori per quel ruolo ordinata per GAIN (il gain è
il valore di riferimento relativo al tipo di asta che ci fa capire quale acquisto è meglio fare in quel
momento) ... il numero di calciatori per ogni blocco deve essere sufficiente ad avere sempre
un'alternativa considerando la distribuzione di quel ruolo per ogni partecipante».

**Niente qui prevede un calciatore.** È lo stesso confine che tiene la board di un club vero nel toolkit
e l'undici di una fanta-rosa nell'app: la valutazione è quella del FOGLIO (`engine_surplus` o il suo
ripiego dichiarato `est_surplus`; `engine_fm_pred × engine_pv_pred` per il valore), letta e mai
ricalcolata. Quello che si deduce qui riguarda **posti, partecipanti e regolamento**.

Il FOGLIO è scelto da **(listone, gioco)** e non dalla piattaforma: il bundle ne porta tre — EuroLeghe /
mantra, Leghe / classic, Leghe Mantra / mantra — e il surplus di un uomo è un fatto sul GIOCO per cui lo
compri, perché il rimpiazzo è per slot di ruolo e i due giochi non hanno gli stessi slot. Per aprirlo a un
foglio NOMINATO, `ValuationStore` espone `sheets` e `expectationsFor(sheet)`: il lettore delle colonne del
motore era già uno solo e resta uno solo (`readSheet`), si è solo smesso di poterlo chiamare solo «il
primo foglio di quella piattaforma».

## 2. Le impostazioni della lega (dichiarate, non nel bundle)

**NOTA DEL 27/08/2026, sera: il regolamento non è più di questa pagina.** Un'altra sessione ha spostato le
sei dichiarazioni in un servizio unico (`core/global-options.ts` + `ui/global-options/`, pannello fisso in
basso a sinistra) perché valgono per ogni vista e le Buste chiuse ne tenevano una seconda copia - due
dichiarazioni della stessa lega prima o poi si contraddicono. La pagina le LEGGE (`options.league()`) e
tiene di suo solo quello che è di una vista sola: come si legge un blocco (§5.4) e l'ordine personale
(§10). Il paragrafo qui sotto descrive la forma originale, che è ancora quella dei campi; il bottone
«Impostazioni lega» in intestazione apre quel pannello (§12.1).

Bottone «Impostazioni lega», salvate in `localStorage` (`fantassistant.strategy.setup`):

| campo | valori | note |
|---|---|---|
| listone | Serie A (`default`) · EuroLeghe (`euro`) | decide, col gioco, quale foglio prezza le liste |
| gioco | Classic · Mantra | cambia il vocabolario dei ruoli **e** la forma della rosa |
| rose | classic P/D/C/A · mantra Por + Movimento | due vocabolari, §4 |
| budget | crediti di partenza | **non entra in nessun numero**, e la barra lo dice (§7) |
| tipo d'asta | Rilanci · Draft | cambia la MONETA, §3 |
| partecipanti | n | è metà della lunghezza di ogni lista, §4 |

Due cose che la finestra fa e che non sono cosmetiche: **nomina il foglio** che quella combinazione
implica (lega, revisione, squadre, rose) prima che si applichi, e offre **«allinea squadre e rose al
foglio»** — che non scatta da sé, perché la composizione della rosa è una dichiarazione dell'operatore e
sovrascriverla in silenzio sarebbe decidere al posto suo.

## 3. IL GAIN dipende dal TIPO D'ASTA, e non è una preferenza

Misurato, non scelto (`metrica-asta-surplus-v1.md` §15-§16, cinque finestre di euro/mantra, 10/08/2026):

- **rilanci → SURPLUS.** La risorsa scarsa è il credito, cioè esattamente quello che il surplus sottrae:
  i fantapunti sopra l'uomo che schiereresti al suo posto.
- **draft → VALORE** (`fm × pv`, niente sottratto). Là non si spendono crediti ma PICK, e il surplus
  addebita una scarsità per-slot che il rulebook mantra non impone: **−4,0%** contro il tavolo, −15,7% su
  una finestra. La valuta adottata è il valore, portiere compreso (l'ibrido letterale è −4,88%).

Il valore è un totale **senza zero**, quindi su una lista unica premierebbe chi gioca sempre e i portieri
prima di tutti (la lezione dell'Overall, 16/08/2026, `letture-app-v1.md` §9). Qui non fa danno **perché il
confronto è sempre dentro un ruolo**: fra due uomini dello stesso blocco lo zero che manca è lo stesso.

Il gain è **vuoto e non zero** per chi il foglio non prezza e nemmeno stima (9 uomini su 250 nomi
disegnati sul foglio Serie A classic): non è in classifica, è contato e detto. Le fasce di colore sono
quelle di `ui-gain` — percentili del listone intero, tagliati una volta da `sealed-bid.scaleOf` (estratta
per questo), così un verde vuol dire la stessa cosa sulle due pagine.

**Nessun pavimento sulla disponibilità**, a differenza delle buste chiuse: là si scrive un numero alla
cieca, qui la lista è un ORDINAMENTO e le presenze attese stanno già dentro tutt'e due le monete.

**Limite dichiarato**: la misura del draft è su MANTRA. Su classic il banco ha misurato la RAZIONE per
ruolo (§17) e non la valuta, quindi «draft + classic» estende una conclusione fuori dalla popolazione su
cui è stata presa. È scritto perché il giorno che qualcuno la misura, questo è il posto da correggere.

## 4. Quanti nomi per blocco

**Classic è un conto**: `slot × partecipanti`. L'esempio dell'operatore — 8 difensori per 8 partecipanti
fanno 64 — e la garanzia è esatta: anche se ogni rivale riempie il reparto prima di te, la lista contiene
ancora la tua parte. Con dieci squadre e rose 3/8/8/6: **P 30 · D 80 · C 80 · A 60**, 250 nomi.

**Mantra no**, perché la rosa non ha quote per ruolo: ha 2 portieri e 23 uomini di movimento, e quanti
difensori centrali servano lo dicono i MODULI. Si riusa la sola risposta che il progetto ha già dichiarato
e misurato, `slotShares` + `demandFromShapes` (`metrica-asta-surplus-v1.md` §15.4): ogni posto di ogni
modulo vale un'unità di domanda divisa fra i ruoli che possono occuparlo, le undici forme pesano uguale
perché nessuno ha misurato quali un tavolo giocherà. Su dieci squadre da 23 uomini di movimento:

| Por | Dd | Dc | Ds | B | E | M | C | W | T | A | Pc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 20 | 13 | **51** | 13 | 10\* | 23 | 27 | 26 | 17 | 16 | 24 | 15 |

255 nomi in tutto. \* **pavimento dichiarato: almeno un uomo per partecipante.** La quota di `B` sarebbe
5, e una lista più corta della stanza non offre un'alternativa a tutti; inoltre la domanda per ruolo
SOTTOSTIMA il prosciugamento, perché i ruoli si sovrappongono — un `Dc;B` comprato come `Dc` è un
braccetto in meno per tutti gli altri.

Il portiere sta **fuori dalle linee** dei moduli (il rulebook ne dichiara un posto per schema), quindi la
sua domanda è il conto della rosa e non una quota delle forme.

Senza `mantra_modules.json` (bundle vecchio) **non esistono blocchi mantra**: il vocabolario dei ruoli è
del regolamento, quindi la pagina lo dice e non ne disegna nessuno.

## 5. «Il posto più arretrato»: la regola dell'operatore, giusta nel problema e respinta in due forme

La richiesta (26/08/2026, sera): «secondo me conviene sempre schierare un calciatore nella posizione del
modulo più difensiva rispetto ai suoi ruoli. Ad esempio un C/T conviene prenderlo per metterlo come C in
modo da lasciare la posizione T a un calciatore più offensivo (ad esempio un T/A) ... che ne pensi se nei
blocchi consideriamo solo la posizione più difensiva dei ruoli del calciatore?».

### 5.1 Il problema che descrive è REALE e si misura

Metà del listone porta più di un ruolo (**267 su 541** quotati su default, 492 su 966 su euro), e i
blocchi offensivi si ripetono. Sul foglio Serie A mantra, fra i primi N per gain di ogni blocco:

| blocco | primi | quanti hanno un ruolo più arretrato | nomi in comune col blocco di dietro |
|---|---|---|---|
| T (trequartisti) | 16 | **15 (94%)** | 12 coi primi 26 di C |
| A (attaccanti esterni) | 24 | 19 (79%) | 9 coi primi 17 di W |
| E (esterni) | 23 | 18 (78%) | 10 coi primi 13 di Ds (su euro: **13 su 13**) |
| B (braccetti) | 10 | 10 (100%) | 0 (sono tutti in Dc/Dd/Ds) |

Quindi «il blocco dei trequartisti è quasi la stessa lista dei centrali» è vero, ed è quello che la
pagina deve far vedere.

### 5.2 Forma letterale (tenere solo il posto più arretrato): RESPINTA

Popolazione: il foglio Serie A mantra (609 righe) e il listone euro. Conta quanti uomini restano nel
blocco filando ogni uomo sotto il suo solo posto più arretrato:

| blocco | domanda | uomini che lo coprono | di mestiere | esito |
|---|---|---|---|---|
| B | 10 | 12 | **0** | il blocco resta VUOTO su tutt'e due i listoni |
| E | 23 | 101 | 19 | sotto la domanda |
| T | 16 | 66 | 17 | al limite (14 sui soli quotati) |
| A | 24 | 65 | 29 | appena sopra |
| Dc | 51 | 117 | 100 | ok |

Tre blocchi di dodici non riempiono più la propria lista, e quello che deve rispondere a «chi mi copre il
braccetto» non risponde: ogni braccetto quotato è anche un `Dc`, un `Dd` o un `Ds`.

### 5.3 Forma «nativi prima, taglio alla domanda»: RESPINTA, e peggio della prima

Stessa popolazione, gain = surplus, somma dei gain dei nomi che il blocco mostra:

| blocco | per gain | nativi prima | differenza | chi sparisce |
|---|---|---|---|---|
| T | 256 | **−9** | **−103%** | McTominay 27,8 · Da Cunha 22,2 · Rabiot 21,1 · Atta 20,7 |
| A | 116 | **−94** | −182% | Santos A. 17,6 · Boga 14,5 · Paz N. 10,3 |
| W | 173 | 106 | −39% | Dimarco **37,0** · Saelemaekers 21,5 |
| E | 308 | 208 | −32% | Norton-Cuffy 12,5 · Valle 12,4 · Celik 11,8 |
| C | 434 | 402 | −8% | — |
| Dc | 318 | 262 | −18% | — |
| Por · Dd · B · M · Pc | — | — | 0% | (un ruolo solo, o nessun nativo) |

**Una lista i cui primi nomi valgono meno della panchina non è una lista da cui comprare.** I diciassette
trequartisti puri del listone sono deboli, quindi il blocco finisce sotto il rimpiazzo.

### 5.4 Quello che è stato ADOTTATO: la regola MARCA, e a un clic FILTRA

- **Default («Tutti»)**: il gain ordina sempre, e chi ha un posto più arretrato porta il suo marchio
  `↓C` accanto al gain, col tooltip «lo metteresti da C». Marchi sulla pagina vera (foglio Serie A
  mantra, misurati dall'arnese): t **15/16** · a 21/24 · e 18/23 · b **10/10** · dc 13/51 · c 7/26 ·
  w 4/17 · ds 3/13 · m 1/27 · por 0/20 · dd 0/13 · pc 0/15.
- **«Solo di mestiere»**: la versione letterale, che tiene solo chi non può giocare più arretrato. 241
  nomi su 255, i braccetti a zero **con la spiegazione scritta nel blocco vuoto**, i trequartisti che
  aprono a 10,3 invece di 27,8 e gli attaccanti esterni da 4,9 a −4,3. Ha una proprietà che l'altra non
  ha: **ogni uomo è contato una volta sola**, quindi la somma dei blocchi è un piano di rosa.
- Lo switch sta nella BARRA e non nella finestra (cambia quello che si sta guardando) e **su classic non
  c'è**: là un uomo ha un ruolo solo e la scelta non muoverebbe una riga.

E la ragione di fondo, che vale oltre questa pagina: **dove quel principio decide davvero è
un'ASSEGNAZIONE, e lì l'app lo applica già in modo esatto** — il matching di `mantra-legal.ts` sposta il
C/T su C da solo appena possiedi un T. Una lista per ruolo non può esprimere un vincolo congiunto: è la
stessa lezione del §16 di `metrica-asta-surplus-v1.md` («una quota per ruolo non può esprimere quello che
il rulebook raziona»), incontrata dal lato del display.

## 6. «Più difensivo» è MISURATO sul rulebook, non deciso a mano

Si contano le linee dei posti che accettano ogni ruolo e si tiene la più arretrata (`roleDepth`):

| ruolo | posti | linee | linea minima | media |
|---|---|---|---|---|
| Por | fuori dalle linee | — | 0 (per convenzione: più indietro di tutti) | — |
| Dd · Ds | 6 · 6 | 1 | 1 | 1,00 |
| Dc | 27 | 1 | 1 | 1,00 |
| B | 5 | 1 | 1 | 1,00 |
| M | 17 | 2 | 2 | 2,00 |
| C | 17 | 2-3 | 2 | 2,06 |
| E | 15 | 2-3 | 2 | 2,07 |
| W | 15 | 2-4 | 2 | 2,80 |
| T | 11 | 3-4 | 3 | 3,09 |
| A | 23 | 3-4 | 3 | 3,83 |
| Pc | 15 | 4 | 4 | 4,00 |

A pari linea decide l'ordine **dichiarato** in `mantra_modules.json` (`roles`). Dà `c;t` → C, `t;a` → T,
`w;a` → W, `dc;b` → Dc, `ds;e` → Ds, `e;w` → E.

**Si tiene il MINIMO e non la media, e la ragione è un limite dichiarato**: le medie mettono M a 2,00, C a
2,06 ed E a 2,07, cioè tre mestieri diversi alla stessa profondità (un esterno è una fascia, un mediano è
il centro), e decidere fra loro su sette centesimi sarebbe inventare un ordine. Dentro il centrocampo
E/M/C/W la parola «più difensivo» **non separa niente**, e l'ordine che si usa lì è quello del
regolamento e non una misura.

## 7. Tre cose che la pagina DICE invece di riempire in silenzio

1. **Una combinazione che il bundle non porta non viene riempita con l'altra.** Oggi euro/classic non ha
   foglio: la pagina lo dichiara e nomina i tre che ci sono, invece di mostrare i numeri di un altro gioco
   sotto l'etichetta sbagliata.
2. **Se squadre e rose dichiarate non coincidono col foglio**, il GAIN resta quello del foglio — l'app non
   ha un motore e non lo ricalcola: il surplus è contato dal rimpiazzo di QUELLE squadre e di QUEGLI slot —
   mentre la LUNGHEZZA delle liste segue la dichiarazione. Detto in un avviso, col rimedio a un clic (il
   foglio euro dichiara 12 squadre, quello mantra rose di 23 uomini).
3. **Il budget non entra in nessun numero** di questa pagina, e il tooltip lo dice: le liste sono un
   ordinamento, non un piano di spesa.

## 8. Il layout, e le misure che lo dicono

**La pagina non scorre, le liste sì.** 64 difensori non stanno in una finestra, quindi la scelta è fra una
pagina lunga — dove per confrontare il primo attaccante col primo portiere si perde di vista l'altro — e
colonne ferme che scorrono per sé. Misurato: **907px di pagina in 907px di finestra**, 3 liste su 4 che
scorrono a classic, 11 su 12 a mantra. 4 colonne a classic, 6×2 a mantra (dodici blocchi in una riga sola
non stanno, e sei per riga non ne lascia una spaiata).

Riga: stemma piccolo, i ruoli del gioco che si sta giocando, il nome, le icone di stato (`ui-flags`), il
marchio `↓` dove serve e il gain colorato. Un `~` dove il numero sta sul ripiego dichiarato.

**L'ultima lista si scosta dal box del viaggio nel tempo** (`fixed` in basso a destra, fuori dall'outlet):
su una pagina che scorre gli galleggia sopra la fine del contenuto, qui coprirebbe per sempre due righe.
Misurato dopo la cura: ultima riga a 828px, box a 853px.

## 9. L'arnese, e i suoi due difetti

`scripts/e2e-strategy.mjs`, zero dipendenze come gli altri due: serve `dist/`, lancia Edge/Chrome
headless, parla CDP. Misura il layout, le quattro cose di ogni riga (250 righe esaminate), i contatori
contro le righe disegnate, il gain monotono, la barra, il bottone **con un puntatore vero alle coordinate
che il browser dichiara**, i dodici blocchi mantra, i marchi, le due letture, la combinazione senza
foglio, il listone euro, la coda non coperta dal box, e fallisce su qualunque eccezione della pagina.

Due difetti **dell'arnese** trovati per strada, entrambi della famiglia «misura la cosa sbagliata»:

- **una porta di debug fissa** gli faceva attaccare la sessione al browser della corsa PRECEDENTE
  (Chromium fa figli, `kill()` non li prende tutti): una corsa ha letto dodici blocchi mantra dove la
  pagina appena aperta ne disegna quattro. Cura: porta libera per corsa, `Page.navigate` sulla nostra
  URL, `taskkill /T`, e le impostazioni azzerate prima di misurare le lunghezze attese.
- **confrontava il ruolo come lo DISEGNA la CSS** (maiuscolo) invece del codice, e inventava un difetto
  che la pagina non aveva.

## 10. L'ORDINE PERSONALE delle liste (27 agosto 2026)

Richiesta: «nei vari blocchi le liste devono essere riordinabili in modo che posso impostare il mio
personale ordine di priorità». Si trascina una riga dentro il suo blocco; il resto sta in
`core/manual-order.ts` (logica) e in `views/strategy/` (il gesto).

**IL MODELLO È UN PREFISSO**, e la scelta è quella che degrada meglio quando la lista sotto cambia: si
salva la sequenza dei nomi che lui ha SISTEMATO, gli altri restano sotto nell'ordine del gain. Le due
alternative sono scritte perché sono peggiori e non vanno riprovate:

- **salvare la lista intera** a ogni trascinamento è più semplice e mette un uomo NUOVO in fondo: un
  arrivo che il foglio prezza 40 finirebbe sotto ottanta difensori, cioè invisibile. Col prefisso compare
  in cima alla parte a gain, appena sotto i suoi;
- **salvare le mosse** («questo tre posti su») non sopravvive a una lista che cambia lunghezza, che è
  quello che succede a ogni cambio di impostazioni.

Tre cose che il modello impone e che si vedono a schermo, perché una lista mezza preferenza e mezza
misura deve dire dove passa il confine: il numero di posizione dei suoi è in **grassetto chiaro**, il
blocco porta una **✕** che torna al gain (e compare solo se c'è un ordine da annullare), e la barra dice
«*N* nel tuo ordine» con l'azzeramento globale sotto conferma. `RoleBlock.pinned` è il numero, e
`blocksOf` lo calcola.

**Si applica PRIMA del taglio alla domanda**: un nome sistemato all'ottantesimo posto deve restare
visibile, e applicandolo dopo sarebbe tagliato via proprio dalla lista in cui l'hai messo.

**La chiave è `listone|gioco|ruolo` e non contiene il foglio**: una preferenza è un fatto sulla sua lega e
sul ruolo, non sulla revisione che stiamo leggendo, quindi un export nuovo la conserva; il listone e il
gioco ci sono perché quelle sono liste di uomini DIVERSE, e un ordine che scavalcasse da una all'altra
sarebbe l'ordine di una lista addosso a un'altra.

**IL GESTO È DI CDK** (`cdkDropList` / `cdkDrag`), scelta dell'operatore del 27/08/2026, e con lui
arrivano l'anteprima, il segnaposto, lo scorrimento della lista al bordo e il drag nativo del browser già
spento: le quattro cose che il gesto scritto in casa rifaceva a mano (~120 righe, tolte). Il pacchetto era
**già installato** - `ng-zorro-antd` dipende da `@angular/cdk` 22.1.1 - quindi non è una dipendenza nuova:
è una riga di `package.json` che ora la DICHIARA invece di ereditarla di nascosto.

**IL PRECEDENTE, e la metà che è stata ribaltata.** CDK era stato mandato via dalla TABELLA il 18/08/2026
con due accuse: che muovesse il DOM di Angular e che il drop tornasse con l'indice di partenza. Ma i
«buchi / disallineamenti» che l'operatore aveva visto **non erano suoi**: erano un `nz-tooltip` che si
mangiava una colonna della griglia (§17 di `letture-app-v1.md`, trovato il 20/08). Quello che restava di
misurato era il fotogramma al rilascio su una riga di `<th>` a larghezze fisse - e qui le righe sono `<li>`
di una lista che scorre, cioè il caso per cui `cdkDropList` esiste.

**Quindi si è misurato invece di discutere**, e il metro è proprio quel fotogramma. A metà volo: **1
anteprima, 1 segnaposto, 3 righe traslate** (`translate3d(0px, 24px, 0px)`: i vicini che fanno posto). Al
rilascio: **0 anteprime, 0 segnaposti, 0 `transform` residui** - cioè il difetto che costò la cacciata non
si presenta. Il resto tiene come prima: `pointerdown` 1 · `pointermove` 9 su 9 · `pointerup` 1, il nome
ancora primo dopo un ricaricamento, la crocetta che rimette il gain.

Quello che NON è cambiato è il modello: `withRowAt` riceve l'INDICE FINALE che CDK dichiara
(`cdkDropListDropped`) e restituisce il prefisso. Il DOM lo muove e lo rimette a posto CDK; l'ordine vero
resta un `signal` nostro, e la lista si ridisegna da quello. E `column-drag.ts` è tornato accanto alla
tabella: ci era andato in `core/` solo perché le liste usavano `gapAt` sull'asse verticale, e venuto meno
il motivo resta co-locato con la sua vista, come vuole `app/CLAUDE.md`.

**Verificato con un puntatore vero**, che per un gesto è l'unica verifica che vale (i numeri sono qui
sopra), più `orderedBy` / `withRowAt` a test unitario - compreso il caso che il modello esiste per
risolvere: un nome preso dalla parte a gain e portato in cima **non butta fuori dall'ordine** chi era già
sistemato sotto di lui.

## 11. I MODULI MANTRA: quanto vale scegliere lo schema (27 agosto 2026)

Domanda dell'operatore: «valuta tutti i moduli mantra e dimmi se sono tutti equilibrati o alcuni
permettono di schierare più giocatori offensivi», e poi: «col 4-2-3-1 c'è più probabilità di schierare
calciatori che portano bonus, oppure moduli con 2 Pc sono più convenienti?». Misurato sul rulebook e sui
due fogli mantra; i numeri per intero stanno in `metrica-asta-surplus-v1.md` §26.

**EQUILIBRATI, E PER COSTRUZIONE.** Tutti e undici gli schemi schierano **5 posti difensivi e 5 offensivi**
sulla partizione che il file stesso dichiara. Non è un caso ed è il rulebook a dirlo: rifiuta i
modificatori classici perché «*l'incompatibilità fra il sistema Mantra e i modificatori classici è
concettuale e non tecnica: gli schemi sono già bilanciati*». Nessuno schema scambia un difensore per un
attaccante.

**NON EQUILIBRATI su chi fa BONUS** (T, W, A, Pc), da 3 a 5 posti: 4-1-4-1 **5** (il nome più difensivo di
tutti, e i suoi quattro posti di trequarti sono `C/T · T · E/W · W`), 4-2-3-1 · 3-4-2-1 · 3-5-1-1 ·
4-4-1-1 **4**, gli altri sei **3**. E il PAVIMENTO conta come il tetto: il 4-2-3-1 ha quattro posti che
solo un uomo da bonus può occupare, quindi non offre una probabilità, **pretende** quattro nomi.

**IL TETTO IN PUNTI È QUASI LO STESSO**: lo scarto fra il primo e l'ultimo modulo, sull'undici migliore
che il listone concede, è **1,15% su euro e 1,42% su Serie A** - e il vincitore cambia con la lettura
(fantamedia o valore di stagione), col listone e col budget. È rumore.

**QUELLO CHE CAMBIA È IL PREZZO, e di molto**: il surplus che 100 crediti di FVM comprano scende
monotonamente da `Por` 44 e `B` 38 fino a **`Pc` 8,5 e `A` 7,8** su euro (Serie A: `T` 24 contro `Pc`
3,1). Quindi due posti da `Pc` sono il modo più CARO di riempire i cinque offensivi, non il più
conveniente: paghi la fantamedia ASSOLUTA e vinci con quella MARGINALE, e il rimpiazzo di un `Pc` (7,19)
è mezzo punto più alto di quello di un `W` (6,38).

**MA LA RISPOSTA SI RIBALTA COL TIPO D'ASTA**, ed è la stessa distinzione della moneta (§3): in assoluto
il `Pc` dà il surplus più alto di tutti i ruoli (22,1 su euro), quindi **a rilanci** conviene comprare il
bonus sulla trequarti mentre **in un draft** - dove spendi scelte e non crediti - il posto da `Pc` è il
migliore che ci sia.

**La conseguenza pratica, che è quella da tenere: il modulo non si scegli prima dell'asta.** Tutti
schierano cinque offensivi e la differenza vale l'1%; si comprano i nomi per surplus assicurandosi di
poter coprire due posti da T/W e uno o due da Pc - il vincolo vero, perché 3-4-3 e 4-3-3 schierano tre
attaccanti ma **una sola punta centrale** - e la forma segue la rosa, che è quello che `bestEleven` fa già.

## 12.1 Il bottone che non apriva (27 agosto 2026, sera)

**IL BOTTONE ORA APRE, e le due cose che l'hanno tenuto chiuso valgono più della cura** (27/08/2026,
sera). L'operatore lo ha visto («nella pagina strategia non funziona il tasto impostazioni di lega») e
l'arnese e2e lo aveva già segnato. **Erano DUE segnali per una porta**: il bottone chiama
`GlobalOptions.open()`, che alza `panelOpen`, e quel segnale non lo leggeva nessuno - il pannello apriva
col suo `editing` locale. Curato dove il difetto stava, nel pannello: un `effect` che legge `panelOpen`
(in `untracked`, così dipende solo da lui) e `close()` alla chiusura, perché un signal che resta `true`
non cambia e non farebbe scattare la seconda apertura. Il file è di un'altra sessione, quindi la cura è
in albero e **non nel mio commit**: sarà nel loro.

E la seconda, che è una regola sull'arnese: dopo la cura il passo diceva ««Annulla» non richiude la
finestra», e non era vero. **Il click su «Annulla» arrivava ZERO volte** pur essendo il puntatore sulle
coordinate che il browser aveva appena dichiarato, `elementFromPoint` compreso: il modale entra con la
sua animazione e per ~200ms i suoi bottoni si SPOSTANO, quindi il click atterrava dove il bottone non era
più. È la lezione dei filtri della tabella vista dal lato del tempo - un controllo si verifica alle
coordinate che il browser dichiara *nel momento in cui si clicca* - e la cura è `clickSteady`: due letture
uguali di fila, poi si clicca. Trovata contando i click che ARRIVANO, che è la sola misura che l'avrebbe
mostrata.

## 12. Aperti (per resa attesa)

1. **La pagina non sa cosa hai già in rosa.** I blocchi sono il mercato intero; il passo naturale è
   sottrarre chi è già stato comprato e marcare i buchi del reparto — cioè agganciarsi a `expectedHoles`
   e a `fanta-eleven`, che quelle domande le sanno già rispondere. È l'item più grosso.
2. **«Solo di mestiere» non è mai stata misurata come POLITICA.** È una lettura dichiarata: se comprare
   dai nativi produca rose migliori è una domanda per il banco dei draft (`toolkit/bench/draft/`), ed è
   pre-registrabile — la resa da battere è la politica adottata oggi.
3. **Il budget non fa niente.** Farlo entrare vuol dire dividere una spesa fra reparti, che richiede il
   prezzo ombra di un credito (`assistente-asta-v1.md` §4.2): è un item, non una riga.
4. **La domanda mantra è il segnaposto delle forme** (§15.4): il punto fisso — assumere una
   distribuzione di moduli, simulare il draft, ri-derivarla — resta da fare, e questa pagina è il primo
   posto dove si vedrebbe.
5. **La profondità dentro il centrocampo** (E/M/C/W) non è separata dal rulebook: se un giorno decide
   qualcosa, va misurata invece di ereditata dall'ordine dichiarato.
6. **La moneta del draft su CLASSIC** non è mai stata misurata (§3): oggi si estende quella di mantra.
7. ~~Il bottone «Impostazioni lega» non apre niente~~ — **CHIUSO la sera del 27/08**, vedi §12.1: erano
   due segnali per una porta, e la cura sta nel pannello (che ora legge `panelOpen`). Resta aperto solo
   questo: la cura è in un file di un'altra sessione e quindi **non è in un mio commit**.
8. **I moduli si possono PESARE** invece che contarli uguali (§12 e §15.4 della metrica): se l'operatore
   dichiara i due o tre schemi che il suo tavolo gioca davvero, la domanda per ruolo si sposta di molto -
   `T` da 10 a 34, `W` da 10 a 34, `E` da 10 a 46, `Pc` da 12 a 23 su dieci squadre.
9. **Il D-Factor non è misurato.** Se la lega lo accende, un modulo con un posto ibrido in mezzo (`M/C`,
   `E/W`) fa schierare SEI uomini di ruolo difensivo fra cui scegliere i cinque migliori, e quel vantaggio
   nessuno lo ha quantificato.
