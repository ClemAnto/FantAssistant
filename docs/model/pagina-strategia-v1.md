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

**COME SONO VESTITI I DUE PEZZI, dettato dall'operatore la sera del 27/08** («l'item draggato deve avere un
bg e l'item di anteprima deve avere opacity 0.3»): il SEGNAPOSTO - la riga che stai muovendo, che resta
nella lista come il buco dove finirà - ha un fondo pieno (`bg-primary/25`), e l'ANTEPRIMA che vola sotto il
dito è un fantasma a **opacità 0,3**. È coerente: con l'anteprima trasparente la cosa solida deve essere il
posto.

Tre cose imparate mettendole, e sono tutte misurate perché una resa non si guarda:

1. **Un fondo scritto in `@layer components` non dipinge**, perché la riga porta `odd:bg-control/25` che è
   una UTILITY, e le utility stanno in un layer DOPO: l'ordine dei layer batte la specificità, quindi la
   regola leggeva `rgba(0, 0, 0, 0)` col build verde. Le due vestizioni sono quindi varianti sulla riga
   (`[&.cdk-drag-placeholder]:bg-primary/25`), dove competono nello stesso layer e vincono per specificità.
2. **`cdkDragPreviewClass` vuole un ARRAY.** Con una stringa sola («bg-surface rounded-md opacity-30») CDK
   la passa a `classList.add()`, che su un nome con spazi solleva `InvalidCharacterError`: il gesto muore
   **in silenzio** - pagina intera disegnata bene, zero anteprime, niente in console - e l'arnese lo ha
   visto solo perché conta le anteprime a metà volo.
3. **L'anteprima non accetta un fondo da nessuna classe.** Né `bg-surface`, né la variante
   `[&.cdk-drag-preview]:bg-surface`, né un colore **letterale** (`bg-[#141d19]`): la regola è nel foglio
   costruito, la classe è sull'elemento, il token risolve, e il computato resta `rgba(0, 0, 0, 0)` -
   mentre `opacity-30` dalla stessa lista si applica. **Non è spiegato**, e per questo non c'è CSS che
   finga di dipingerlo: il fondo dell'anteprima era un'aggiunta per la leggibilità, non la richiesta, e
   sta fra gli aperti (§12).

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

## 13. LE TRE PASTIGLIE su ogni riga (4 settembre 2026)

Richiesta dell'operatore: «per ogni calciatore mi devi mostrare 1) fantapunti medi a partita sopra il 6
2) partite giocate attese 3) partite attese con voto >= 6 ... formattato in 3 pill tipo `[+1.5] [24:20]
[75']`», più «il terzo pill sono i minuti medi a partita». Quattro numeri in tre riquadri: il secondo ne
porta due, perché il secondo è un sottoinsieme del primo.

**Nessuno dei quattro è nuovo, e nessuno ordina niente.** Tre vengono dal foglio (`engine_fm_pred` /
`est_fm`, `engine_pv_pred` / `est_pv`, `desc_minutes_next`) e il quarto è la COSTANZA che la tabella di
consultazione già misura (`player-ratings.steadyOf`, la quota di partite chiuse con almeno la
sufficienza). L'aritmetica sta in `core/strategy.readingsOf` e non nel template, come tutto il resto di
questa pagina; il 6 è `plancia.EDGE_BASE`, letto da dove sta — è la stessa colonna che la plancia
mostra, e un secondo `6` scritto qui sarebbe la stessa colonna con due basi il giorno che una cambia.

**La seconda pastiglia mescola due nature, e lo DICE.** `24` è una previsione del motore, `:20` è quella
previsione moltiplicata per una MISURA delle sue stagioni: «quante ne chiuderebbe bene se tenesse il
passo che ha tenuto finora». Il chip dei minuti del 18/08/2026 fu curato dichiarando quale delle due cose
fosse; qui la terza strada non c'è — nessuno ha misurato una PREVISIONE della quota di sufficienze, e
inventarne una sarebbe una regola senza gate — quindi restano due numeri accanto e il tooltip dice quale
è quale. Dove la quota è quasi tutta l'ancora del ruolo (`weight` sotto `MOSTLY_ANCHOR` = 0,5) la metà
sbiadisce, che è il `~` applicato a mezzo numero.

**I minuti mancano su 244 righe di 602** del foglio Serie A (645 di 999 su euro li hanno): la colonna la
scrive lo stesso passo che disegna gli undici, quindi manca dove manca il disegno — è esattamente la
popolazione di `desc_titolarita` (602 righe su 602 d'accordo). Lì la pastiglia porta un trattino e non
uno zero.

**IL COSTO È LA LARGHEZZA, ed è misurato invece che sperato.** Tre riquadri in linea chiedono ~104px.
Su classic le liste sono larghe 386px e tutto sta in riga: **250 righe su 250 in linea, 0 nomi tagliati,
il più stretto 94px**. Su mantra i blocchi sono dodici e la lista scende a ~254px: la prima versione
mangiava il nome per intero e buttava il gain fuori dal blocco. La cura è una CONTAINER QUERY sulla
lista (`@container`, soglia 23rem) e non una media query sulla finestra — quanto è larga una lista
dipende da quanti blocchi ci sono, non da quanto è larga la finestra, quindi una soglia sullo schermo
risponderebbe alla domanda sbagliata. Sotto le 23rem le pastiglie vanno a capo, dopo il gain
(`order-last`), che resta in riga perché è il numero che ORDINA: se andasse a capo lui si spezzerebbe la
colonna del colore, che è quella che si scorre. Prezzo dichiarato: su mantra la riga passa da 24 a 38px,
cioè da ~11 a ~8 nomi visibili per blocco.

**E il riquadro è un INCAVO, non una tinta.** `bg-control` era la scelta ovvia ed è stata misurata a
schermo: su questo tema `control` (#1c1c26) e `surface` (#14141c) distano otto punti per canale, e su una
riga dispari (`bg-control/25`) la pastiglia spariva — un riquadro che non si vede è un riquadro che non
c'è. Quindi fondo `page` e bordo `border`. Nessun colore: il colore di una riga è del GAIN, e una seconda
scala accanto a quella vera farebbe chiedere «quale dei due verdi conta?».

**Verificato nel browser** (`scripts/e2e-strategy.mjs`, tre passi nuovi). Il confronto non è con lo
schermo ma col FOGLIO, letto in Node dal file `.json.gz` che l'arnese sta servendo: confrontare la
pastiglia con un numero ricavato dalla pastiglia è l'asserzione circolare del 04/09. 250 righe, ogni
numero d'accordo col file, più due invarianti falsificabili (le partite buone non possono essere più di
quelle giocate, le giocate non più delle giornate del calendario). Il tooltip si verifica APRENDOLO con
un puntatore vero — con `[nzTooltipTitle]` nel DOM non c'è nessun attributo da leggere — e il passo
mantra misura la riga stretta a parte, perché **un passo che guarda solo la vista larga direbbe «nessun
problema» dopo aver guardato metà pagina**.

Quel passo mantra ha anche misurato il costo di una modifica di qualcun altro, ed è il caso in cui vale
la pena rimisurare invece di citare: nella prima versione leggeva **16 nomi tagliati**, tutti con le
pastiglie già a capo — cioè non attribuibili a loro, e l'attribuzione era misurata e non dedotta. Nella
corsa di chiusura sono **zero**, e il nome più stretto passa da 18 a 81px, perché la sessione parallela
ha tolto i badge dei ruoli dalla riga (`ui-roles`) mentre lavorava alle bande dello slot. Su classic la
stessa cosa porta il nome più stretto da 94 a 116px. *Il costo di un layout è una fotografia che scade:
si rimisura, non si cita.*

## 14. LA RIGA, DENSIFICATA: bande dello slot, un tooltip solo, il gain a giornata (4 settembre 2026)

Cinque richieste dell'operatore in fila sulla stessa riga di lista, e vale la pena leggerle insieme
perche' tirano tutte dalla stessa parte: **quello che si cerca scorrendo un blocco e' un NOME, e tutto
il resto e' spazio tolto a lui.**

**1. LO SFONDO RAGGRUPPA OGNI `n` NOMI, con `n` = i partecipanti** («raggruppa ogni n calciatori con uno
sfondo leggermente piu' chiaro dove n e' il numero di partecipanti alla lega»). Non e' una decorazione:
una banda di `teams` nomi **e' uno SLOT**, cioe' il rango dentro il ruolo diviso il numero di rose, che
in questo progetto e' una legge di conservazione e non una convenzione — in una lega da dieci ci sono
dieci «primi difensori» perche' ognuno ne schiera uno, ed e' la popolazione su cui il banco d'asta ha
misurato ogni tetto d'offerta (`simulatore-asta-rilanci-v1.md` §19.3). A classic la domanda di un blocco
e' `slot x partecipanti`, quindi le bande cadono esatte (30 = 3 bande, 80 = 8); a mantra la domanda viene
dalle forme e l'ultima banda puo' essere corta, che e' un fatto sulla lista e non un difetto.
**Sostituisce la zebra invece di aggiungersi**: due alternanze sulla stessa proprieta' darebbero quattro
tinte, e il confine della banda — la sola cosa che quel colore deve dire — si perderebbe fra le altre
tre. Misurato a schermo: **21 confini su 250 righe** (2+7+7+5), il fondo cambia SOLO al confine e mai
dentro una banda, e la riga dichiara la sua banda in `data-band` cosi' l'aritmetica e il colore si
verificano separatamente.

**2. VIA IL BADGE DEL RUOLO** («visto che gia' sono raggruppati per ruolo»). A classic ripeteva
l'intestazione del blocco riga per riga; a mantra pero' diceva qualcosa in piu' — in quali ALTRI blocchi
l'uomo compare — e **quella meta' non e' stata buttata, e' finita nel tooltip della riga** quando i
codici sono piu' d'uno. Prezzo e guadagno misurati: il nome piu' stretto passa da 94 a **120px** su
classic e legge **85px** su mantra, zero nomi tagliati su 250 e su 255.

**3. IL RIENTRO A SINISTRA** («un po' di padding a sinistra che potrebbe essere tolto soprattutto nelle
risoluzioni con larghezza piu' bassa»): 6px -> **4px**, e ZERO sotto le 23rem di lista, cioe' la stessa
soglia di container query che gia' decide dove vanno le pastiglie. A destra resta, perche' li' finiscono
il gain e le pastiglie e un numero attaccato al bordo si legge peggio.

**4. IL GAIN E' A GIORNATA** («al posto del surplus mostra il surplus medio a partita»), che e' la sua
regola del 03/09 — «i risultati si riportano in punti A GIORNATA, mai in totali di stagione» — applicata
alla colonna che ORDINA queste liste. Tre cose non ovvie:
- **il divisore e' del FOGLIO** (`matchdays_target`: 38 su Serie A, 31 su euro) e non una costante, perche'
  `engine_pv_pred` vive sul calendario della piattaforma e dividere il surplus di un foglio per le
  giornate di un altro sarebbe una quota di niente;
- **una definizione sola** (`perMatch`), letta dalla riga E dalla scala del colore: le fasce sono
  percentili, quindi dividere solo le righe le lascerebbe tarate sui totali di stagione e **ogni uomo
  leggerebbe `scarso`**. L'ordine non cambia — dividere tutti per lo stesso numero non riordina niente —
  e nemmeno le fasce, che sono ranghi;
- **due cifre invece di una**, perche' la scala e' un'altra: i gain ora stanno fra 0 e ~1,7 (P 0,96 -> 0,20 ·
  A 1,71 -> 0,31) e con una cifra sola meta' listone leggerebbe «0,1». Dove un foglio non dichiarasse il suo
  calendario resta il TOTALE e l'etichetta della barra lo dice («GAIN = SURPLUS a stagione»), invece di
  stampare un totale sotto un'unita' che non e' la sua.

**5. UN TOOLTIP SOLO PER RIGA** («limita i tooltip nei calciatori al minimo essenziale») **e il riquadro
verde piu' piccolo**. Erano QUATTRO su una riga alta 17px — il `title` nativo, la freccia, la fila delle
pastiglie e il tilde — e **tre dei quattro dicevano la stessa frase su ogni riga: erano una LEGENDA e non
un fatto su quell'uomo**. La legenda e' salita nell'intestazione del blocco, che e' un hover solo per
lista; sulla riga resta il per-uomo (nome intero, club, codici, i due marchi), sul NOME perche' e'
l'elemento piu' largo ed e' quello che si sta leggendo quando serve saperne di piu'. Misurato: **al piu'
1 tooltip suo per riga e 0 `title` nativi**, con la lunghezza della frase sotto i 200 caratteri come
asserzione (la vecchia frase delle pastiglie era un paragrafo di ~700). Restano fuori dal conto, e sono
dichiarati invece che nascosti, i marchi di `ui-flags` (fino a 3, esistono solo dove c'e' un marchio da
spiegare) e il `title` dello stemma, che porta il nome del club — cioe' la sola cosa che un'immagine da
16px non dice. Il riquadro del gain ha una taglia `sm` (h-4, testo 10px): **il componente e' uno solo** e
la sua regola del 25/08 non si tocca — forma, colore e fasce restano identici in ogni pagina — cambia la
DENSITA', e il default e' quello di prima, quindi le buste chiuse non si muovono di un pixel.

**E il banco ha trovato un difetto suo, che vale piu' delle cinque modifiche.** Chiedendo la frase di
Kalulu leggeva quella di **Neres**: il passo precedente chiude una finestra modale con un click, e quando
la modale sparisce il puntatore resta fermo sulla riga che sta sotto quel punto, che apre il SUO tooltip
da sola; il polling successivo trovava un pannello gia' aperto prima che il nostro (0,4s di ritardo)
nascesse. *Un tooltip letto senza essersi assicurati che il precedente sia chiuso e' il tooltip di
un'altra riga, e non lo dice.* Cura: `hoverTip` — vai via, ASPETTA che non ce ne sia nessuno aperto, poi
bussa — piu' l'asserzione che la frase cominci col nome che avevamo chiesto. Ed e' anche il caso in cui
**«nessun problema» era stampato accanto alla prova del contrario**: il difetto stava nella riga `said`
del passo, non fra i suoi `problems`, che e' la ragione per cui questo banco stampa sempre quello che ha
letto e non solo il verdetto.

## 15. LE PASTIGLIE SI SCELGONO, LA RIGA SI APRE, LA LISTA SI CERCA (5 settembre 2026)

Cinque richieste dell'operatore in una sessione, tutte sulla stessa pagina, e la prima cambia il gesto:
«se draggo un calciatore ordino, se invece clicco solo si apre la card con il dettaglio del calciatore
(la stessa della plancia)».

### 15.1 Un click e un trascinamento sulla stessa riga

Sono due gesti sullo stesso elemento e li distingue una cosa sola: la soglia di CDK
(`dragStartThreshold`, 5px). Sotto quella nessun `cdkDragStarted` arriva e il click è un click. CDK però
**non spegne** il `click` che il browser manda dopo un rilascio, quindi senza una guardia ogni riordino
aprirebbe anche la card della riga rilasciata.

La guardia si alza su `cdkDragStarted` e si abbassa su un TIMEOUT, non dentro il click: se un
trascinamento finisce e nessun click segue, un flag che aspetta il click si mangerebbe quello dopo — «un
guard che ferma metà di un gesto lo rende metà rotto», la lezione della lente della plancia (04/09).
Misurato dal banco, che prova **tutt'e due i gesti separatamente**: un click apre una card e una sola,
un trascinamento riordina e lascia **zero** card aperte.

### 15.2 La card è LA STESSA della plancia, e per questo è dovuta uscire di lì

`views/plancia/man-card/` → **`ui/player-card/`**, con `core/player-card.ts` a portare il modello
(`CardMan`) e la pila (`CardStack`, dove nasce una card e chi sta davanti). Due card sarebbero due
letture degli stessi `engine_*`, cioè due valutazioni per un uomo — il difetto che questo repository ha
già pagato.

Quello che NON si poteva riusare è il modo in cui i numeri arrivano: **la plancia prezza sempre
`default|classic`, la Strategia il foglio della combinazione dichiarata** (euro|mantra compreso). Una
card che andasse a prendersi i numeri da sé direbbe di un uomo il surplus di un altro gioco. Quindi la
card RICEVE un `CardMan` già letto da chi la apre, e ogni pagina lo costruisce dal proprio foglio.

Due conseguenze dichiarate. La **metà d'asta** (max offerta, prezzo pagato, padrone, «è il lotto in
asta», «abbinamenti») esiste solo dove esiste un TAVOLO: sulla Strategia è `market: null` e i bottoni li
PROIETTA la pagina, perché sono gesti suoi. E lo `stack` è uno per pagina (`new CardStack()` due volte):
le card della plancia non devono seguirti sulla Strategia, ma la regola del POSTO è una sola, o due
pagine disporrebbero le stesse card in due modi.

### 15.3 Sette pastiglie al posto della scritta

«Elimina questa scritta [`GAIN = SURPLUS a giornata · 250 nomi su 250 · 60 senza numero`], al suo posto
metti questa serie di pill selezionabili: Bpm · Pa · Pas · mp · MV · FM · FVM. Le prime tre sono già
attive di default.»

L'elenco sta in `core/strategy.READINGS` — nomi, ordine, formato e larghezza — perché è vocabolario di
questa pagina e un test lo raggiunge senza un browser. La scelta vive in `localStorage`
(`strategy.readings`) come le altre preferenze di LETTURA, e `storedJson` e non `storedList`: **nessuna
pastiglia accesa è una scelta legittima**, quindi una lista vuota sul disco deve restare vuota invece di
ripartire dai default.

Due decisioni di vocabolario, e vanno dette perché muovono dei numeri.

- **`Bpm` è `FM − MV`, non `FM − 6`.** «Bonus a partita medio» è il nome che l'operatore ha dato alla
  colonna «Bonus» il 18/08/2026 («i bonus da soli, FMa − MVa, così la formula dell'Overall si legge sulla
  riga»), e `est_mv` è sul foglio per **602 righe su 602** (996 su 996 su euro), quindi la sottrazione si
  può fare per tutti. Il «sopra il 6» resta l'altra domanda e vive sulla plancia con quel nome
  (`EDGE_BASE`): due quantità, due nomi, mai una cifra sola. Su Malen sono 1,41 contro 1,92.
- **`MV` e `FM` sono le REALI di questa stagione**, su sua istruzione esplicita («devono essere quelli
  reali della stagione corrente»), lette da `season_stats` della stagione BERSAGLIO — che il bundle
  porta (370 righe su `default`, 574 su `euro`). Sono una MISURA accanto a quattro previsioni, e a
  settembre sono fatte su una o due giornate: il tooltip del nome lo dice («MV/FM su 2ª»), e chi non ha
  ancora giocato non ha una media — vuoto, non zero.

Le pastiglie non ordinano niente: la lista resta sul GAIN e loro lo SPIEGANO. I due fatti che la scritta
portava — quale valuta ordina, quanti uomini il foglio non prezza — stanno in un `?` in coda alla fila:
sono fatti e vanno detti, ma non meritano una riga di testo in barra.

### 15.4 La lente: cercare un nome come lo si sente

«Un'icona lente di ingrandimento nell'header di ogni lista; se ci clicco compare come subheader una
searchbox per filtrare i calciatori di quella lista per nome o per squadra ... case insensitive, i match
anche all'interno e non solo all'inizio, deve essere intelligente (lettere accentate, i al posto della j
o delle y, c al posto delle k o k invece che ck o ch).»

`core/loose-search.ts`, e il trucco è **una chiave sola applicata ai due lati**: non è una distanza fra
stringhe, non è un punteggio, non ha soglie da tarare. Le regole, e l'ordine conta: accenti via
(NFD + segni combinanti) e legamenti sciolti (`ß`→`ss`, `ø`→`o`); `ck` e `ch` → `c` PRIMA che `k` → `c`,
o `ck` finirebbe `cc`; `j`/`y` → `i`, `w` → `v`, `x` → `s`; la `h` rimasta sparisce (in italiano non si
sente, ed è quella che fa scrivere «Ojlund»); le doppie diventano singole; il resto diventa spazio.
`Hojlund` → `oilund`, `Kean` → `cean`, `Lukaku` → `lucacu`, `Zaccagni` → `zacagni`.

Quello che NON fa: non toglie le vocali, non accorcia, non fa metafone. Ogni regola in più aumenta i
falsi positivi, e **in una lista di duecentocinquanta nomi un falso positivo costa più di un nome da
riscrivere**.

Tre cose che il filtro NON deve rompere, e sono le tre che il banco misura. Il **numero accanto al nome
resta il posto vero** (`RankedMan.at`, assegnato prima del filtro): rinumerare da uno le tre righe
trovate direbbe che il quarantesimo difensore è il primo — e per la stessa ragione la banda dello slot
si legge da lì. Il **trascinamento è sospeso** mentre un blocco è filtrato, perché `withRowAt` costruisce
il prefisso dai nomi COME SONO A SCHERMO e su una lista filtrata scriverebbe un ordine che parla di una
lista che non esiste. E **chiudere la lente cancella il testo**: un filtro attivo dentro un pannello
chiuso è invisibile, che è il difetto che i filtri della tabella hanno già pagato (20/08).

Misurato dal banco su una storpiatura che DICHIARA lui («ygnan» da «Maignan»): 20 righe → 1, il posto
resta 1, nessuna riga trascinabile, e richiudendo tornano 20.

### 15.5 I tooltip sono CORTI, e questa è una regola

«Ricordati che i tooltip devono essere SEMPRE brevi e sintetici: poche parole per indicare il significato
di quella sigla o quell'icona ... quando voglio spiegazioni più dettagliate, te lo indico io.»

Tagliati tutti quelli di questa pagina. Il caso peggiore era il contatore di un blocco: un paragrafo di
~700 caratteri che spiegava la domanda della stanza, le tre pastiglie, l'assicurazione, le bande e
l'ordine personale — cioè una LEGENDA su un bersaglio che si incontra scorrendo. Adesso dice «In lista 80
su 80 che ne comprerà la stanza · 12 senza numero», e il PERCHÉ sta qui e nei commenti, dove si legge una
volta invece che cento.

*Il corollario per chi scrive: la ragione di una scelta non è documentazione da mettere a schermo. Va nel
codice accanto alla riga che la applica, e in questi file.*

## 16. QUATTRO PASTIGLIE NUOVE: quello che ha fatto, e quello che ha prodotto (5 settembre 2026)

«Aggiungi qui xG e xA», sulla fila delle letture dove stanno già MV e FM; e poco dopo «aggiungi anche
un pill Gol e uno Assist», con la correzione che le rende utili: **«GOL → Gol per partita, ASSIST →
Assist per partita»**. Undici pastiglie in tutto (`READINGS`), le prime tre accese all'apertura —
quattordici dal 06/09, quando sono arrivate le due coppie `G:A` e lo SWING (§17).

**LE QUATTRO STANNO NELLA STESSA UNITÀ, ed è la sua correzione a metterle lì.** `G 0,50` accanto a
`xG 0,45` è una frase — segna quanto produce — mentre `G 1` accanto a `xG 0,45` sono due cifre che non
si confrontano: un conteggio e una media, cioè la famiglia di errori più cara di questo progetto.
Rigori e assist da fermo dentro, come nel riepilogo della card e per la stessa ragione: «quanti gol ha
fatto» è una domanda sul calcio e non sul punteggio.

**OGNUNA COL SUO DENOMINATORE**, che non è quello del vicino: un gol si sa di ogni giornata giocata, un
xG solo di quelle in cui la fonte ha una riga sua. Due medie vicine con due denominatori è giusto, e il
tooltip di ognuna dice qual è.

**IL PREZZO LO PAGA CHI LE ACCENDE.** xG, xA, gol e assist non stanno in nessun aggregato che questa
pagina legge da sé (`season_stats` non li ha): li porta `PlayersStore`, che è 2,1 MB di layer
per-partita. Sono spente all'apertura, lo store si chiede al primo click, e l'elenco di quali letture
lo vogliono sta in `SEASON_READINGS` accanto a `READINGS` — una condizione ripetuta in due punti della
vista è una condizione che uno dei due dimentica, e allora una pastiglia si accende su una casella
vuota.

**E VENGONO DALLA STESSA FUNZIONE DELLA CARD** (`seasonTotals`), per una misura e non per eleganza:
l'aggregato di stagione dello stesso provider costava 310 KB invece di 2,1 MB e **faceva leggere due
xG diversi al 19,7% degli uomini** fra la pastiglia e la card aperta accanto. Numeri e diagnosi:
`letture-app-v1.md` §29.4.

**E il banco ha trovato una contraddizione più larga di questa pagina**, confrontando le due
schermate: la Strategia stampava i decimali col PUNTO (`0.45`) e la card con la VIRGOLA (`0,45`).
Portata all'operatore invece che sistemata di nascosto — la cura tocca ogni numero dell'app — e la sua
regola è **il punto, sempre**: le parole restano italiane, la cifra no. Dettaglio e guardia in
`CLAUDE.md`, «Il divisore dei decimali di questa app è il PUNTO».

---

## 17. LE DUE COPPIE `G:A`: la stessa lettura in un'altra unità, e l'anno viene dal pacchetto (6 settembre 2026)

«Aggiungi anche il pill **(G:A 25/26)** … quando si attiva mostri un pill con **(GOL:ASSIST)** per ogni
calciatore», e poi «metti anche **(G:A 26/27)** dove mostri (GOL:ASSIST) di questa stagione»; con la
precisazione arrivata subito dopo: **«nei gol ci devono essere i gol normali e i rigori trasformati»**.
Quattordici pastiglie in tutto (`READINGS`), le prime tre ancora accese all'apertura.

**NON SONO `G` E `A` CON UN ALTRO NOME, e la differenza è la domanda.** Quelle sono MEDIE per partita
giocata — «che giocatore è» — queste sono CONTEGGI — «quanto ha portato». A settembre, su due giornate,
chi ha segnato una volta legge `0.50` sull'una e `1:0` sull'altra, e nessuna delle due sostituisce
l'altra. Convivono senza potersi contraddire perché **escono dalla stessa chiamata a `seasonTotals`**:
`gaNow` è il NUMERATORE di `G`, non una seconda somma degli stessi voti. È la regola del 05/09 sugli xG
(«due fonti per un fatto solo non convivono su uno schermo») applicata prima di poterla violare.

**I RIGORI TRASFORMATI SONO GOL** e gli assist da fermo sono assist, come nel riepilogo della card e per
la stessa ragione: la riga di una partita li tiene separati perché valgono punti diversi, ma «quanti gol
ha fatto» è una domanda sul calcio e non sul punteggio. Quanto pesa, misurato sul pacchetto: Vlasic
2025-26 legge **8** invece di 3, Nkunku 7 invece di 2, Orsolini 10 invece di 6.

**UNA COPPIA COMPRENDE OGNI CAMPIONATO CHE HA GIOCATO**, non solo il nostro (`isChampionship` conta
`league` e `other_league`, coppe e amichevoli fuori): **Malen 2025-26 legge `18:3`**, che è 14+2 di Serie
A più 4+1 di Premier — ed è l'unica risposta utile a «quanti gol ha fatto l'anno scorso» per un uomo che
la stagione l'ha giocata in due paesi. Stessa convenzione di `G`, `A` e della card.

**L'ANNO LO DICHIARA IL PACCHETTO, non un'aritmetica.** `targetSeason` e `inputSeason` vengono dal
manifest (`target_season`, `input_season`) e seguono il viaggio nel tempo, quindi dentro la macchina del
tempo la coppia «scorsa» è quella che quel giorno era scorsa. Un anno calcolato come «bersaglio meno uno»
sarebbe giusto oggi e sbagliato là, ed è la famiglia della colonna «Bonus» che portava un nome e un
numero diversi (18/08/2026). `ReadingSpec.dated` dice che la sigla nomina la sua stagione, `readingShort`
la compone: `G:A` esiste due volte, e senza l'anno sarebbero due pastiglie con un nome solo.

**E NON SI PUÒ ORDINARE PER UNA COPPIA**, che è una rinuncia dichiarata e non una dimenticanza. Dietro
`G:A` la somma sarebbe un numero plausibile — i bonus portati — e ordinare per quella lascerebbe a
schermo due cifre di cui nessuna scende: «una colonna che spiega un ordinamento deve ESSERE
quell'ordinamento» (operatore, 03/09/2026). Chi vuole ordinare per i gol ha `G`, che è un numero solo.
`SORTABLE_READINGS` è derivato da `READINGS` e non riscritto, così una pastiglia non può esistere ed
essere ordinabile per sbaglio (o il contrario).

**IL PREZZO È ZERO**, e questo è l'unico punto in cui questa richiesta era più economica di quanto
sembrasse: la seconda stagione non è un secondo caricamento, perché `PlayersStore` porta tutte le
`heavy_seasons` del pacchetto in un colpo. Quello che cambia è un secondo giro sulla mappa che è già in
casa. `SEASON_READINGS` e `PREV_SEASON_READINGS` sono ora DERIVATI da `ReadingSpec.season`: con due
elenchi da tenere allineati a mano la prossima pastiglia si accenderebbe su una casella vuota, che è
esattamente il difetto che il commento del 05/09 dichiarava di voler evitare.

**Verificato dove si verifica.** Il banco accende le sei pastiglie di stagione insieme e confronta le due
coppie **coi VOTI del pacchetto** — ri-derivati nell'arnese da `match_ratings` PIÙ `external_match_stats`,
con la stessa regola di esclusione del proprio campionato — invece che con la pastiglia accanto, che
sarebbe l'asserzione circolare: **461 coppie su 500 disegnate, zero scarti**. La prima passata leggeva 54
righe «`0:0` sullo schermo e niente nel bundle» e **il torto era dell'arnese**, che guardava metà della
domanda (i soli voti): un banco che legge una popolazione più stretta di quella della pagina accusa la
pagina del proprio difetto. Costo di layout misurato con nove pastiglie accese, che è il carico massimo
che il banco prova: **0 nomi tagliati, 0 riquadri fuori riga**.

---

## 12. Aperti (per resa attesa)

> **02/09/2026 — il banco d'asta ha misurato quale REPARTO paga, e la pagina non lo dice.** Questa pagina
> ordina ogni blocco per GAIN, che è una proprietà del calciatore; su dieci finestre per venti urne la
> strategia che vince questa lega è una proprietà del REPARTO — **i quattro difensori migliori sono
> l'investimento** (si paga fino a 97 · 63 · 32 · 25 dove il mercato paga 54 · 35 · 18 · 14), il portiere
> e il primo centrocampista al prezzo di tutti, e **il top d'attacco si lascia andare** (il profilo che lo
> inseguiva è ultimo su tutt'e due i meccanismi). Le quote di reparto che ne escono sono 9,8 · 25,4 · 23,9
> · 40,9 contro un mercato che spende 9,1 · 16,3 · 27,2 · 47,4. Numeri e ricetta:
> `simulatore-asta-rilanci-v1.md` §19.


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
9. **L'anteprima del trascinamento non accetta un fondo** (§10, punto 3): opacità sì, background no, con
   qualunque classe e anche con un colore letterale. Da capire guardando gli stili che CDK inietta a
   runtime - `document.styleSheets` va interrogato durante il volo, che è la sola finestra in cui
   l'anteprima esiste. Costo stimato: mezz'ora; resa: leggibilità del fantasma, niente di funzionale.
10. **Il D-Factor non è misurato.** Se la lega lo accende, un modulo con un posto ibrido in mezzo (`M/C`,
   `E/W`) fa schierare SEI uomini di ruolo difensivo fra cui scegliere i cinque migliori, e quel vantaggio
   nessuno lo ha quantificato.
