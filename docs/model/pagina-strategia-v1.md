# La pagina STRATEGIA — quanti uomini per ruolo, e chi sono (v1)
**Aggiornato: 27 agosto 2026** (nata il 26 agosto su richiesta dell'operatore; la regola del «posto più
arretrato» è del 26 sera e la sua misura del 27). Commit `70c8ed6`.
**Casa**: `app/src/app/core/strategy.ts` (+ `strategy.spec.ts`), `app/src/app/views/strategy/`,
`app/scripts/e2e-strategy.mjs`. Rotta `/strategy`, link «Strategia» dall'intestazione di Calciatori.

Documento autosufficiente: chi tocca quella pagina legga §3 (la moneta), §5 (le due forme respinte) e
§10 (gli aperti) prima di scrivere una riga.

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

## 10. Aperti (per resa attesa)

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
