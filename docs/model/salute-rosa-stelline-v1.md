# La SALUTE di una rosa in cinque stelline — v1 (4 settembre 2026)

**Richiesta dell'operatore, la sera del 04/09/2026, dopo la sintesi dei requisiti di una rosa
vincente:** «vorrei esprimere questi principi in 4/5 parametri con delle stelline calcolabili a
partire dai calciatori acquistati in un determinato istante», con una lista d'esempio di **sette**
voci — Diversificazione, Presenze, Bonus, Costanza, Difesa, Centrocampo, Attacco — e un «poi vedi
tu».

Questo documento è il **disegno misurato** di quella pastiglia: quante stelline esistono davvero,
dove ognuna prende la sua scala, quali due voci della sua lista escono e con quale numero. Il codice
non è ancora scritto (voce 1 degli aperti, §7); quello che è già in repository è la misura che lo
tara, `app/scripts/measure-squad-health.mjs`, riproducibile in due secondi.

---

## 1. Il fatto grosso: i suoi sette parametri sono QUATTRO

Prima di disegnare sette stelline si misura quante ne esistono, perché **due letture dello stesso
numero finiscono per dare a una rosa due verdetti** — il difetto che questo progetto ha già pagato
sui campetti, sulle soglie prese in prestito e sui due lettori di `engine_fm_pred`. La popolazione è
l'archivio: le **1.176 rose vere** delle 131 aste di `docs/real-data/` giocate con la sua stessa rosa
3/8/8/6, con il join sul foglio Serie A al **98,4%** (28.955 aggiudicazioni su 29.438).

| coppia di candidati | r | conseguenza |
|---|---:|---|
| **Presenze ~ Bonus** (valore dell'undici, fm × pv) | **+0,963** | **una stellina sola.** Dentro uno slot la fantamedia è quasi piatta, quindi «bonus» è «presenze» riscritto con un'altra unità |
| **Difesa ~ Attacco** (quote di budget) | **−0,649** | **una stellina sola**, un asse con due versi: *dove sono i soldi* |
| Copertura ~ Presenze | −0,624 | **due** stelline: «qualcuno si presenta» e «si presenta il mio undici» sono due domande |
| Spartizione ~ buchi · presenze · valore · club | ≤ 0,12 | asse **indipendente**: porta informazione che nessun'altra stellina contiene |
| Diversificazione ~ tutto il resto | ≤ 0,12 | asse indipendente, peso piccolo |

Quindi la pastiglia ha **quattro assi di STATO** (copertura, presenze, spartizione,
diversificazione) e una quinta stellina che non è uno stato ma un **comportamento** (a che prezzo
sta comprando). È esattamente il numero che aveva chiesto, ottenuto togliendo e non aggiungendo.

## 2. Le cinque stelline, con i tagli

**Una stellina è una classe QUINTILE delle rose vere**: 3★ è la rosa mediana di un'asta vera, 5★ è
il quintile migliore. Questo è il *null* della pastiglia — «4 stelle» vuol dire «meglio del 60-80%
dei tavoli che si sono davvero seduti», che è la sola cosa che un numero del genere può dire. È la
regola di casa applicata due volte: *un numero senza il suo null non è interpretabile*, e *una scala
si tara sulla distribuzione e non sul massimo* (la lezione della griglia dei portieri, 03/09).

| | cosa misura | 5★ | 4★ | 3★ | 2★ | 1★ |
|---|---|---|---|---|---|---|
| **1. Copertura** | buchi attesi sull'undici di riferimento | ≤0,29 | ≤0,36 | ≤0,45 | ≤0,56 | >0,56 |
| **2. Presenze** | quota di giornate in cui l'undici c'è (Σp/11) | ≥0,753 | ≥0,738 | ≥0,724 | ≥0,706 | <0,706 |
| **3. Spartizione** | scarto dalle quote adottate P 9,8 · **D 25,4** · C 23,9 · A 40,9 | ≤0,097 | ≤0,132 | ≤0,166 | ≤0,211 | >0,211 |
| **4. Prezzi pagati** | mediana di pagato / banda per (ruolo, slot) | \<0,80 | \<0,95 | \<1,10 | \<1,30 | ≥1,30 |
| **5. Diversificazione** | max uomini dello stesso club | ≤2 | 3 | 4 | 5 | ≥6 |

**I PESI NON VENGONO DA QUI, e la distinzione è la stessa del §15 del banco d'asta: l'archivio è un
giudice dell'AMBIENTE, mai della resa.** Quelle 147 aste sono datate 19-20/08/2026, cioè comprano
per una stagione che non è stata giocata: quello che l'archivio può dire è come è fatto un tavolo
vero, e nient'altro. La resa è del banco (`bench/auction`), che rigioca dieci stagioni vere su
centinaia di urne:

| stellina | quanto vale muoverla | da dove viene il numero |
|---|---|---|
| **1. Copertura** | **−4,73 fp per buco**; da 2★ a 5★ sono **+1,3 fp/gg** | `HOLE_COST`, pendenza su 110 rose, r = −0,798 |
| **4. Prezzi pagati** | **+1,3 fp/gg** | `DEPTH_TIER`/`DEPTH_HANDS`, +1,88% STRICT su 800 stagioni |
| **2. Presenze** | **+0,7 fp/gg** | §25: +26,4 fp a stagione, t 5,3 su dieci stagioni vere |
| **3. Spartizione** | **+0,55 fp/gg** | il tilt sulla difesa, +20,2% appaiato, peggiore finestra +12,6% |
| **5. Diversificazione** | **0 punti**, −4,4% di dispersione | `CLUB_FREE` 2 / `CLUB_PENALTY` 0,45 |

Il totale **non è la media delle stelline** — mescolerebbe pesi che vanno da 0 a 1,3 fp/gg — ma la
somma pesata in **punti a giornata** rispetto alla rosa mediana vera: da 3★ piatte a 5★ su tutto
sono circa **+3,9 fp/gg**. *La colonna che spiega un ordinamento deve ESSERE quell'ordinamento*
(regola dell'operatore, 03/09), quindi il totale è nell'unità in cui si decide e le stelline sono
la sua lettura a colpo d'occhio.

## 3. Due cose che la misura ha deciso contro la forma della richiesta

**La quota difesa adottata è oltre il p90 delle rose vere.** Mediana vera **15,4%**, p80 21,2%, p90
24,3%, contro il **25,4%** che il tilt adotta. Quindi 5★ di Spartizione significa spendere in difesa
come il decile più alto di un tavolo vero — ed è la strategia, non un caso: i due modificatori di
questa lega si pagano in **voti base** e i voti base li consegna una linea difensiva. La stellina è
scritta come **scarto** dal bersaglio e non come quota, perché uno scarto ha uno zero naturale
mentre una stellina sulla quota vorrebbe un taglio superiore che nessuno ha misurato.

**I buchi stanno quasi tutti in ATTACCO, e sui portieri la stellina sarebbe una costante.** Per
reparto le rose vere leggono:

| reparto | p20 | mediana | p80 |
|---|---:|---:|---:|
| **P** | 0,000 | **0,000** | 0,000 |
| D | 0,036 | 0,071 | 0,119 |
| C | 0,033 | 0,065 | 0,125 |
| **A** | 0,143 | **0,229** | 0,360 |

Tre portieri per un posto coprono la porta in ogni rosa vera, mentre in attacco tre posti su sei
uomini con le presenze più basse del listone lasciano un quarto di posto vuoto. Per questo la
Copertura è **una** stellina con il dettaglio per reparto nel tooltip e non quattro: su tre reparti
su quattro la stellina non separerebbe niente — la stessa saturazione, dal capo opposto, che il
03/09 ha imposto una colonna continua accanto al conteggio delle partite facili.

## 4. Cosa esce dalla sua lista, con il numero

- **Costanza — non è una stellina, è un EFFETTO della prima.** Un uomo sposta l'R-Factor di **+1,5
  fp a stagione** (Poisson-binomiale esatta sull'undici, mediana → p90 del suo ruolo), e il
  modificatore è governato dai buchi: su 110 rose l'R-Factor incassato correla **−0,821** coi buchi,
  13,6 punti il quartile con meno buchi contro **2,1** quello con più. Sul codice del banco il
  termine è **inerte a peso 0, 1 e 5**. Una stellina che non si può muovere se non muovendone
  un'altra dice al lettore che ha un problema dove non ha una leva.
- **Centrocampo e Attacco come stelline separate — assorbite dalla terza** (r −0,649 con la difesa).
  E il regolamento dice perché non c'è niente da premiare lì: il primo centrocampista si paga il
  prezzo di tutti (107 contro 112) e il top d'attacco si lascia andare (234 contro 247). L'unica
  quota che è una leva è la difesa; le altre tre sono il suo complemento.
- **Al loro posto DUE NUMERI e non stelline**, perché sono conseguenze e si calcolano esatti:
  **R-Factor atteso** e **mod. difesa atteso** sulla rosa corrente. Così la costanza si vede senza
  fingere che sia una manopola.

## 5. Le due convenzioni che rendono la pastiglia leggibile a metà asta

1. **Si segna la rosa PROIETTATA, non quella che c'è.** A cinque uomini su venticinque ogni stellina
   vera leggerebbe 1★, che è «vuoto = ignoto» rotto: **un posto ancora da comprare non è un buco.**
   I posti liberi si riempiono col miglior uomo che il budget residuo consente alla banda misurata
   dello slot — lo stesso conto che `alternative` fa già per un credito e che il §22.6 fa per un
   posto. Così la stellina dice «**come finisci se continui così**» ed è stabile dal primo acquisto.
   Accanto ci va **quanti uomini sono già suoi**, o il lettore non sa quanta parte della stellina è
   sua e quanta è della proiezione — *un vincolo che agisce in silenzio è indistinguibile da un
   ordinamento rotto*, applicato a una previsione.
2. **Una definizione, due lettori.** `expectedHoles` e `keeperCovered` esistono già in
   `app/src/app/core/sealed-bid.ts` con la convoluzione esatta e l'esclusività dei portieri: vanno
   **estratti** in `core/squad-health.ts` e letti da tutt'e due le pagine, come è stato fatto per
   `engine-sheet.ts` quando tre viste sono finite sugli stessi `engine_*`. Due copie darebbero a una
   rosa due verdetti, e il primo posto in cui si nota è un tavolo.

## 6. L'arnese, e il difetto che ha trovato in se stesso

`app/scripts/measure-squad-health.mjs`, sola lettura, riproduce tutti i numeri di questo documento
(`--all` le 131 aste, `--his` le 20 identiche alla sua: i tagli si muovono di un centesimo, quindi
la popolazione più larga è quella che si usa).

**La prima passata ha letto NaN su ogni percentile**, e la causa è la famiglia più cara di questo
progetto: `sheet.matchdays` non è un numero, è un **oggetto** (`platform_target`, `platform_input` e
una nota), quindi `pv / matchdays` divideva per un oggetto. Non ha prodotto un numero sbagliato ma
un NaN, cioè si è fermato — ed è la sola ragione per cui non è finito in un verbale. *Prima di
credere a un valore, si stampa la FORMA di quello che si sta leggendo*, che è la variante meccanica
della regola del 03/09 sugli zeri sospetti.

## 7. Aperti, in ordine di leva

1. **Scrivere il codice**: `core/squad-health.ts` (le cinque misure, i tagli come costanti con la
   loro provenienza accanto, i due numeri derivati), la pastiglia in `views/plancia/` e il banco e2e
   che verifica i tagli **contro l'archivio** invece di fidarsi. Nessuna delle cinque misure ha
   bisogno di una previsione nuova: leggono il foglio e le impostazioni di lega.
2. **La quinta stellina ha i tagli DICHIARATI e non misurati.** «Pagato / banda» usa la scala del
   §19.3, che è misurata; i quattro tagli (0,80 · 0,95 · 1,10 · 1,30) sono scelti a occhio e vanno
   sostituiti con i quintili dello stesso rapporto sulle rose vere — che l'arnese può calcolare, e
   non lo fa ancora perché la banda per (ruolo, slot) vive nel codice dell'app e non in questo
   script. *Una soglia scelta a occhio va segnata come tale finché non è misurata.*
3. **La proiezione dei posti vuoti non è ancora misurata come previsione.** «Il miglior uomo che il
   budget residuo consente» è la forma giusta, ma quanto sia accurata a un quarto d'asta lo dicono
   solo le cinque aste vere di cui si conosce l'ordine: si può misurare, ed è la stessa popolazione
   con cui il §15.5 ha scoperto che l'urna si rimescola.
4. **Le stelline non sono state misurate come CONSIGLIO.** Sanno descrivere una rosa; che guardarle
   faccia comprare meglio è un'altra affermazione, e il modo di misurarla esiste già
   (`bench.auction.advice`, che giudica senza il tavolo).
