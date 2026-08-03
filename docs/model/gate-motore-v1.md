# Gate del motore — v1 · protocollo, verdetti, ipotesi falsificate

**Chiuso: 27 luglio 2026** · Documento autosufficiente: cosa è stato provato, con che protocollo, con
che numeri, e cosa NON va riproposto.
*Glossario: B0 = motore attuale (baseline) · finestre **Tm7…T2**, dieci su Serie A (dal 15/16→16/17) e
cinque su euro · T1/T2 = 23/24→24/25 e 24/25→25/26, le due su cui il gate è stato scritto · cross-fit =
parametri stimati su una finestra e applicati all'altra · campione comune = i giocatori che entrambe le
configurazioni prezzano · VALORE = FM × presenze.*

## 1. Come gira il gate

`python -m euroleghe_ingest backtest [--verify] [--gate] [--auction] [--cases]` — read-only sul DB, scrive solo
`data/reports/engine_backtest.json`. Codice in `toolkit/euroleghe_ingest/engine/`
(`model` formule pure · `fitting` minimi quadrati · `features` DB→osservazioni · `evaluate` gate).

Sei regole di misura, tutte imparate sbagliando almeno una volta (le ultime due il 27/07,
rileggendo il codice del gate stesso):

1. **Parametri cross-fitted**: ogni coefficiente è stimato sulla finestra che NON lo giudica.
2. **Confronto sul campione comune.** Una regola che prezza giocatori prima esclusi (copertura) non va
   misurata su una popolazione più grande e più difficile: il MAE peggiorerebbe per composizione, non
   per qualità. Ciò che aggiunge si riporta a parte, senza baseline da battere.
3. **Criterio distinto per tipo.** *Accuratezza*: deve migliorare la metrica bersaglio su **entrambe**
   le finestre senza peggiorare FM né VALORE. *Copertura*: non può migliorare quella metrica per
   costruzione → si giudica su copertura in aumento, non-danno, ed errore dei nuovi prezzati entro il
   +30% del baseline.
4. **Un'ipotesi = una famiglia di parametri = un verdetto.** Le regole composite vanno spezzate
   (R1/R1b, R4/R4b): unire «copri i nuovi» con «scontagli l'adattamento» nasconde quale metà funziona.
5. **Le regole di copertura devono battere la risposta banale** *(irrigidito il 27/07 dopo la code
   review)*. Il criterio 3 da solo si soddisfa **prevedendo una costante**, ed è esattamente ciò che
   àncora di ruolo + quota media della popolazione danno gratis. Ora i giocatori che una regola
   *aggiunge* ricevono anche una previsione naive, e la regola deve batterla. Ha cambiato i verdetti:
   R1 e R13-euro non la battono e sono uscite dal set adottato (§3).
6. **Le regole di accuratezza si giudicano sui giocatori che SPOSTANO**, con una soglia relativa di
   **0.5%** *(idem)*. L'aggregato diluiva le regole di sottopopolazione e lusingava il rumore: R4
   passava da −0.3% diluito a −3.8%/−1.1% sugli over-30 che tocca, e R14 «guadagnava» lo 0.04% con un
   coefficiente di segno sbagliato. Le due metriche si riportano entrambe: il campione spostato dice
   se la regola funziona, l'aggregato resta il guardrail di non-danno.

**Domini diversi per i due moduli**: il core FM vale per Pv_prec ≥ 15 (dominio su cui è stato fittato
il beta), le presenze bastano di una riga di stagione precedente. Valutarli sullo stesso dominio
faceva sparire il segmento fringe (n=0 invece di 255), cioè proprio quello per cui il modulo presenze
è stato adottato. Un giocatore può avere presenze previste e nessuna FM.

## 2. Fiducia nell'harness: 15 numeri pubblicati su 18

| Controllo | Pubblicato | Ricostruito |
|---|---|---|
| Àncore Classic euro (P/D/C/A × 3 stagioni) | 12 celle | **12/12** |
| Àncore Mantra euro (frazionarie) | 33 celle | **33/33** ('b' escluso, n=5, prende da 'dc') |
| Beta Mantra T1 / T2 | 0.382 / 0.448 | 0.397 / 0.446 |
| **Coefficienti presenze T1** | 0.47 / 0.16 / 0.03 | **0.483 / 0.154 / 0.032** |
| **Coefficienti presenze T2** | 0.53 / 0.13 / 0.06 | **0.532 / 0.125 / 0.060** |
| Portieri M2e T1 / T2 | 0.242 / 0.268 | 0.241 / 0.268 |
| Portieri naive T1 / T2 | 0.323 / 0.336 | 0.323 / 0.336 |
| Bias titolari T2 (modello / naive) | −0.2 / +5.3 | +0.09 / +5.47 |

La media dei due fit per finestra riproduce i 0.26/0.50/0.14/0.04 del motore: **è la formula, non una
statistica riassuntiva che combacia per caso.**

### I 3 numeri che non tornano — RISPOSTA (era il blocco n.1 del 27/07)

Tutti e tre sul modulo presenze in T1: `pv_gain_vs_naive_T1` (atteso −0.016, ottenuto +0.018),
`pv_gain_crossfit_T1` (+0.013), `pv_bias_naive_starters_T1` (5.2 → 4.17).

**Non è il codice.** I coefficienti rifittati per finestra coincidono col pubblicato entro 0.015, e la
tabella dei bias di T2 torna su tutti i segmenti (titolari modello +0.09 vs −0.2, naive +5.47 vs +5.3;
rotazione −0.83 vs −0.9; fringe +0.5 vs +0.4). **Non è la definizione dei segmenti**: il bias naive dei
titolari è monotono nella soglia (T1: 4.17 su 30 giornate → 5.73 su 38; T2: 5.05 → 6.02) e nessuna
soglia riproduce entrambi i numeri pubblicati. Resta la **composizione del campione**: 764/774
giocatori con una riga di stagione precedente contro i 750/754 pubblicati, su un effetto da −1.6%.

**Conclusione da tenere**: del modulo presenze è confermata la **correzione del bias** (grande: ~5
giornate fantasma sui titolari), **non** il guadagno di MAE su T1, che con coefficienti cross-fitted
diventa +1.3%. Nessuna regola nuova va promossa su quel decimale.

## 3. Verdetti — 5 regole adottate su 17 provate

**Adottate, per piattaforma** (`platform` è già una dimensione del modello dati):
**euro → R0c + R3c** · **Serie A → R3 + R7 + R13**
*(la storia è in §3-ter, §3-quater e §3-quinquies: R4 esce con la terza finestra, R7 esce dall'euro ed è
**confermata 7/7 su Serie A** col coefficiente messo in comune, R10 esce da entrambe appena i suoi input
vengono ricalcolati sulle stagioni vecchie.)*

⚠️ **Aggiornato la sera del 27/07 con due stagioni in più** (§3-ter): con una terza finestra euro
(T0 = 22/23→23/24) e una quarta su Serie A (Tm1 = 21/22→22/23), **R4 esce** (contraddetta su T0,
coefficiente che varia di 4.5× fra le finestre) e **R7 resta con una riserva scritta** — non passa il
criterio «migliora su ogni finestra», e il perché è misurabile: la sua premessa è falsa su una finestra
su quattro. Le tabelle qui sotto restano quelle a due finestre; §3-ter ha i numeri a tre e quattro.

⚠️ **Cambiato il 27/07 con i criteri 5 e 6**: R1 (copertura nuovi entrati) e R13 sull'euro **non
battono la risposta banale** e sono uscite; al loro posto entra **R0c**, che è la risposta banale
dichiarata come tale. Non è una resa: R1 dava una previsione dall'aria informata (FM-equivalente
estera, minuti) con MAE 0.391 sui giocatori che aggiunge contro **0.373 della sola àncora di ruolo** su
T1. Pagare la complessità di uno strato arrivi per un numero peggiore dell'àncora è il tipo di
autoinganno che il gate esiste per fermare. R13 resta adottata su **Serie A**, dove batte la risposta
banale su entrambe le finestre (è lì che i giocatori senza storico vengono dall'estero e le ultime
partite dicono davvero qualcosa).

| Regola | euro | Serie A | Parametro (T1 / T2) |
|---|---|---|---|
| **R7** persistenza dedicata alle presenze dei portieri | ⚠️³ᵗ | ⚠️³ᵗ | persistenza **0.698 / 0.803** euro · 0.656 / 0.651 Serie A (contro 0.50 condiviso) |
| **R3c** minuti sulle **giornate del calendario euro** | ✅ | ✅¹ | minuti **0.235 / 0.249** (quota_prec 0.252 / 0.253) |
| **R10** nuovo allenatore (livello + interazione) | ✅ | ❌ | livello −0.127 / −0.078 · interazione **+0.199 / +0.127** |
| **R1** copertura nuovi entrati (FM-equivalente + minuti) | ❌⁵ | ❌² | β_new 0.186 / 0.230 → **0.431 / 0.398** col layer completo |
| **R4** curva d'età sulla FM oltre i 30 | ❌³ᵗ | ❌ | **−0.004 / −0.011 / −0.018** per anno (T0/T1/T2) |
| **R3** minuti sulla stagione reale intera | ❌³ → ✅⁴ | ✅ | Serie A: minuti **0.146 / 0.384**, quota_prec 0.229 / **−0.024** ⁷ |
| **R13** presenze dalle ultime partite in un campionato non coperto | ❌⁵ | ✅ | intensità **0.359 / 0.231** · disponibilità **+0.041 / +0.191** |
| **R0c** copri i non prezzati con àncora di ruolo + quota media (modello nullo esplicito) | ✅ | ❌⁶ | nessun parametro fittato: quota media **0.498 / 0.497** |

⚠️ **I coefficienti sono cambiati rispetto al primo giro** (27/07, dopo la code review) per due ragioni
legittime, non per una ritaratura: (a) l'input dei minuti è cambiato — `features._external` preferiva il
layer per-partita anche quando aveva meno partite dell'aggregato stagionale, dimezzando i minuti dove la
passata di completamento non era arrivata; (b) le regole **residue** (R10, R4b, R14) sono ora fittate
contro la quota che la configurazione produce davvero, non contro B0. R10 in particolare passa da
+0.051/+0.067 a +0.199/+0.127 di interazione: stessa direzione, magnitudo tripla, perché prima
condivideva la varianza con R3c senza saperlo.

⁷ **Nota di identificabilità su R3 (Serie A)**: quota_prec e minuti sono collineari e si scambiano peso
fra le finestre (0.229/0.146 su T1, −0.024/0.384 su T2) mentre la **somma** resta stabile (0.375 /
0.360). La regola passa il gate — il MAE fuori campione migliora su entrambe le finestre — ma il
*singolo* coefficiente non è interpretabile: non si può concludere «i minuti pesano 0.38». Vale la stessa
cautela già registrata per l'euro nel primo giro.

¹ passa anche su Serie A ma perde una posizione top-10 in T2, dove R3 la tiene: lì la mappa copre 31
delle 38 giornate e le due feature sono quasi la stessa cosa. ² i nuovi entrati in Serie A hanno un
equivalente troppo rumoroso (oltre il +30%). ³ sull'euro i due regressori sono collineari e si
scambiano peso fra finestre. ⁴ col layer per-partita completo R3 passa anche sull'euro, ma resta
**ridondante** con R3c (misurano la stessa cosa su calendari diversi) e non viene adottata due volte:
sull'euro vince la versione allineata al bersaglio. ⁵ non battono la risposta banale (criterio 5):
R1 0.391 contro 0.373 dell'àncora su T1, R13-euro peggio su entrambe. ⁶ su Serie A il core è così
accurato (FM MAE **0.281**) che una stima di qualità-àncora (0.369) sfora il limite del +30% di un
punto: la copertura resta al 42-47% e **8 dei 40 posti nelle top 10 reali sono inarrivabili** (§3-bis).
³ᵗ verdetto rivisto in §3-ter con le finestre T0 e Tm1: R4 fuori, R7 dentro con riserva.

### Risultati misurati (MAE di VALORE, campione comune, T1 / T2)

| | P | D | C | A | totale | top-10 | copertura |
|---|---|---|---|---|---|---|---|
| **euro** | −0.3% / **−7.3%** | −1.6% / −2.0% | −2.0% / −1.0% | −1.9% / −0.0% | **−1.7% / −1.5%** | 6→8 · 12→**15** | **31% → 100%** |
| **Serie A** | **−6.9% / −14.7%** | −5.1% / −3.1% | −3.3% / −1.7% | −3.0% / −0.2% | **−4.2% / −2.8%** | 11→13 · 14→15 | 42→46% · 42→47% |

Sull'euro la copertura passa da **31% a 100% del listone** (1095 e 1045 giocatori): ogni nome ha un
prezzo, e i 208/182 che prima non ne avevano ricevono una stima di qualità-àncora (FM MAE 0.386 / 0.409
contro 0.362 / 0.364 del core, dentro il limite del +30%). È R0c a farlo, cioè il modello nullo: la
copertura vale, gli stimatori sofisticati che la promettevano no.

Presenze Serie A: 8.38 → 8.02 e 8.41 → 7.92 giornate di MAE. Portieri euro: 7.24 → 5.99 e 6.02 → 5.01
(**−17%**), l'effetto singolo più grande di tutto il gate.

### Cosa insegnano i coefficienti adottati

- **R7**: le presenze dei portieri sono molto più persistenti (0.70-0.80) di quanto il modello condiviso
  assumesse (0.50). Prima di R7 il modulo presenze **perdeva contro il naive** sui portieri (6.02 vs
  3.97 su euro, 9.57 vs 7.16 su Serie A): era la regressione più netta del baseline.
- **R3c**: la stessa ipotesi («i minuti dicono chi è titolare vero») cade o passa secondo che la feature
  sia misurata sul calendario del **bersaglio** o su quello reale. Sull'euro il bersaglio è un
  sottoinsieme di 27-31 giornate su 34-38: i minuti giocati nelle giornate che il gioco ignora non
  predicono nulla, e il coefficiente lo dice (0.34/0.22 instabile contro 0.291/0.352 stabile).
  **Prima di bocciare un'ipotesi, chiedersi se la feature è allineata al bersaglio.**
- **R10**: l'interazione è **positiva**, cioè sui top club un nuovo allenatore *rafforza* la gerarchia
  dell'anno prima — i titolari giocano più, i margini meno. Su Serie A i coefficienti si invertono
  (+0.13 livello, −0.12 interazione): il nuovo allenatore di un club piccolo rimescola, quello di un top
  club si appoggia all'undici collaudato. Coerente dentro ogni piattaforma su entrambe le finestre.
- **R1** non tocca nessun giocatore già prezzato (per costruzione): vale +4 punti di copertura e i
  nuovi prezzati hanno MAE 0.40 contro 0.35-0.37 di chi c'era già.

## 3-bis. Simulazione dell'asta 25/26 (27 luglio 2026) — 15/40 nomi, ma **80% del VALORE**

`python -m euroleghe_ingest backtest --auction --window T2` — set adottato, parametri stimati su **T1**,
niente della stagione prevista entra nella previsione. Stampa per ruolo le due liste affiancate con
Qt.I, FM/Pv/VALORE previsti, ciò che il giocatore ha reso davvero e il rango di ciascuna lista
nell'ordinamento dell'altra.

| | P | D | C | A | totale |
|---|---|---|---|---|---|
| **euro** — nomi (B0 → adottato) | 5→**6**/10 | 2→**3**/10 | 2→2/10 | 3→**4**/10 | 12→**15**/40 |
| **euro** — VALORE catturato | 82→**88%** | 67→**70%** | 77→**81%** | 80→**82%** | 76→**80%** |
| **Serie A** — nomi | 6→**7**/10 | 3→3/10 | 3→3/10 | 2→2/10 | 14→**15**/40 |
| **Serie A** — VALORE catturato | 79→**87%** | 77→77% | 70→**87%** | 77→**74%** | 76→**81%** |

**Il VALORE catturato è la metrica d'asta che mancava.** «15/40» tratta ogni errore allo stesso modo;
questa chiede quanto avrebbe reso comprare i dieci del motore invece dei dieci perfetti, e la risposta
è **80% (euro) e 81% (Serie A)** — un motore che sbaglia i nomi e prende quasi tutti i punti, perché i
suoi errori sono fra giocatori comparabili. Da mettere accanto alla precisione in ogni report futuro,
non al suo posto: sono due domande diverse (chi comprare / quanto costa sbagliare).

**Unica regressione**: attaccanti Serie A 77% → 74%. Il set adottato non peggiora il MAE del ruolo
(−0.2%) né la precisione (2/10), ma riordina il vertice in modo che i dieci scelti rendono 86 punti in
meno. Con 4 dei 10 attaccanti reali senza previsione, il ranking gioca su un insieme mutilato: è la
copertura, non l'ordinamento.

**I 25 errori non sono la stessa cosa** — e la differenza fra le due piattaforme dice dove intervenire:

| Tipo di errore | euro | Serie A | Che problema è |
|---|---|---|---|
| **vicino** (previsto 11°-50°) | 11 | 14 | rumore di ordinamento fra giocatori comparabili: costa poco |
| **cambio di regime** (previsto oltre il 50°) | **14** | 3 | il giocatore era un altro rispetto all'anno prima |
| **mai prezzato** | **0** | **8** | buco di copertura: irraggiungibile per costruzione |

- **euro: 0 mai prezzati** (era il 19% dei posti) grazie a R0c, e il residuo è tutto **cambio di
  regime**: 6 dei 10 centrocampisti reali erano previsti oltre il rango 50 (Diomande 171°,
  Baumgartner 135°, Fornals 172°, Moleiro 173°). Sono esplosioni da un anno all'altro, non errori di
  taratura: il motore non ha nessun input che le anticipi.
- **Serie A: 8 mai prezzati**, di cui **4 attaccanti su 10** (Douvikas, Bonazzoli, Højlund,
  Pellegrino M.) → quel ruolo è **tappato a 6/10** qualunque cosa faccia l'ordinamento. È il caso in
  cui R0c servirebbe e non passa il gate: la prossima mossa sulla copertura Serie A è uno stimatore che
  batta l'àncora, non l'adozione di quello che non la batte.
- I portieri sono il ruolo che funziona (6/10 e 7/10, 87-88% del VALORE): presenze molto persistenti +
  R7. I difensori sono il peggiore su entrambe (3/10, 70-77%): l'àncora li schiaccia su ~6.1 e il
  vertice si decide sui bonus, che il motore non modella (Dimarco 7.50 reale previsto 6.52).

## 3-ter. Due stagioni in più (27 luglio 2026) — e due regole adottate che non sopravvivono

Il prerequisito «stagioni precedenti al 23/24» era registrato come *da verificare*. **Verificato: l'API
c'è.** La pagina pubblica dei voti risolve un `championshipId` per 2022-23 (euro **105**, Serie A **17**),
2021-22 (**104** / **16**) e anche 2020-21 (**103** / **15**); l'endpoint Excel autenticato restituisce
cartelle vere e il layout è **identico** a quello attuale (stessa riga d'intestazione, stesse 14
colonne). I dataset Drive partono dal 23/24: queste due stagioni esistono nel DB **dalla sola API**.

**Un limite trovato al primo controllo, non dedotto: EuroLeghe 2021-22 non ha voti.** L'id si risolve,
le 30 giornate si scaricano, il listone è vero (1081 giocatori con entrambe le quotazioni) — e ogni
cella `Voto` è la stringa `'-'` con tutte le statistiche a zero. Quindi:

| | finestre utilizzabili | ingest |
|---|---|---|
| **euro** | T0 · T1 · T2 (**+1**) | 22/23: 16.755 righe, 15.340 voti, 29 giornate |
| **Serie A** | Tm1 · T0 · T1 · T2 (**+2**) | 22/23 e 21/22: 38 giornate, ~11.500 voti ciascuna |

`_window_is_usable` scarta una finestra quando meno di 50 giocatori hanno una fantamedia precedente, e
**lo dice a voce**: una finestra scartata in silenzio è indistinguibile da una finestra superata.

### La simulazione d'asta su ogni finestra (nomi · VALORE catturato)

Set adottati dopo questo giro: **euro R0c+R3c+R7+R10** · **Serie A R3+R7+R13**.

| | Tm1 | T0 | T1 | T2 |
|---|---|---|---|---|
| **euro** B0 → adottato | — (senza voti) | 9→**7**/40 · 81%→**78%** | 6→**8**/40 · 73%→**74%** | 12→**15**/40 · 76%→**81%** |
| **Serie A** B0 → adottato | 12→**13**/40 · 81%→**84%** | 14→14/40 · 80%→80% | 11→**13**/40 · 74%→**71%** | 14→**15**/40 · 76%→**81%** |

**Su euro T0 il set adottato peggiora**: −2 nomi e −3 punti di VALORE catturato, pur riducendo il MAE di
VALORE dello 0.2%. Vale la pena sapere *quale* regola lo fa, e una sola passata lo dice — su T0, una
regola alla volta:

| configurazione | nomi | per ruolo | VALORE catturato |
|---|---|---|---|
| baseline | 9/40 | P2 D2 C1 A4 | 6478 (81%) |
| +R0c | 9/40 | P2 D2 C1 A4 | 6478 (81%) |
| +R7 | 9/40 | P2 D2 C1 A4 | 6489 (81%) |
| +R4 | 9/40 | P2 D2 C1 A4 | 6478 (81%) |
| **+R10** | **8/40** | P**3** D2 C**0** A**3** | **6235 (78%)** |
| set adottato | 7/40 | P2 D2 C0 A3 | 6226 (78%) |

È **R10** — cioè la regola che il gate conferma meglio di tutte (Pv MAE −5.2% / −3.5% / −4.9% su tutte
e tre le finestre). Non è un paradosso e non è un errore: R10 sposta il vertice della classifica, e sul
top-10 fa **+3 su T1** (D 1→2, C 2→4), **+1 su T2** e **−1 su T0**. Netto +3 su tre finestre: è il
maggior contributore alle top-10 di tutto il set. Su T0 costa un nome.

La lezione da tenere è più generale delle tre regole in ballo: **la metrica bersaglio del gate e la
metrica d'asta non sono la stessa cosa, e su una finestra singola possono divergere.** Su Serie A T1
succede lo stesso in senso opposto (+2 nomi, −3 punti di VALORE, attaccanti 74%→66%). Le due vanno
riportate insieme sempre — mai una al posto dell'altra.

### Il gate su tutte le finestre: **R7 e R4 non passano più**

| Regola | misurata su | esito | numeri sul sottoinsieme spostato |
|---|---|---|---|
| **R10** nuovo allenatore | T0 · T1 · T2 | ✅ **rafforzata** | **−5.2% / −3.5% / −4.9%** (158/234/260 giocatori) |
| **R0c** copertura col modello nullo | T0 · T1 · T2 | ✅ | copertura 30%→100%, aggiunti a MAE 0.475/0.386/0.409 |
| **R3c** minuti sul calendario euro | T1 · T2 | ✅ (cieca su T0) | invariata |
| **R3 / R13 / R14** (Serie A) | T1 · T2 | ✅ (cieche su Tm1, T0) | invariate |
| **R7** persistenza portieri | T0 · T1 · T2 · (Tm1) | ❌ | euro **−0.4%** / −17.3% / −16.8% · Serie A **+1.2%** / −13.6% / −12.5% / −20.4% |
| **R4** curva d'età | T0 · T1 · T2 | ❌ | **+0.9%** / −3.5% / −1.1% · coefficiente −0.004 / −0.011 / −0.018 |

**R7 era l'effetto singolo più grande di tutto il gate** e la finestra più vecchia non lo conferma. Il
perché è misurabile, non congetturale: la *premessa* di R7 è «il modello condiviso delle presenze perde
contro la persistenza pura sui portieri», e questa è vera su tre finestre e **falsa sulla quarta**.

| Serie A, presenze portieri | naive (ripeti l'anno prima) | baseline | con R7 | margine del baseline |
|---|---|---|---|---|
| **Tm1** 21/22→22/23 | **9.45** | **9.07** | 9.18 | **−0.38 (il baseline è già meglio)** |
| T0 22/23→23/24 | 5.39 | 7.30 | 6.30 | +1.91 |
| T1 23/24→24/25 | 7.61 | 9.29 | 8.12 | +1.68 |
| T2 24/25→25/26 | 7.16 | 9.57 | 7.62 | +2.41 |

Dove non c'è niente da correggere, spingere verso la persistenza fa danno — poco (+1.2%). E la premessa
**non è valutabile il giorno dell'asta**: dipende da quanto saranno persistenti le presenze dei portieri
*nella stagione che devi ancora prevedere*. Quindi R7 non può essere resa condizionale senza
look-ahead: è una scommessa con **3 successi su 4**, vincita −12%…−20% e perdita +1.2%.

**Raccomandazione, distinta dal verdetto meccanico del gate**:
- **R7 resta**, con questo a verbale. Il criterio «migliora su OGNI finestra» è un AND che con quattro
  finestre diventa severissimo e **non pesa le magnitudo**: boccia una scommessa che rende 15 volte
  quanto costa. Il limite è del criterio, e va scritto qui piuttosto che aggirato caso per caso.
- **R4 esce dall'euro.** Guadagno piccolo (−1% … −3.5%), coefficiente che varia di 4.5× fra le finestre
  in modo monotono nel tempo (−0.004 → −0.018: l'effetto età è più forte nelle stagioni recenti, o le
  àncore mono-stagione delle finestre vecchie lo assorbono), e ora contraddetto. Non è una curva d'età,
  è un parametro che segue la finestra su cui lo stimi.
- **R14 passa su Serie A** (−3.0% / −2.6%) ma con il segno che **contraddice la sua stessa ipotesi**:
  chi è stato fuori rende *più* di quanto B0 preveda. Stesso caso di R11 — segnale vero, meccanismo
  dichiarato falso → **non adottata**, ri-pre-registrata come «B0 sovra-penalizza il rientro».

### Tre difetti del gate che solo più finestre potevano rivelare

1. **«Non misurabile» non è «bocciata».** `external_stats`, `arrivals`, `club_elo` e `new_coach`
   partono dal 23/24: sulle finestre vecchie le regole che li leggono non muovono nessuno. Senza la
   distinzione il gate avrebbe ritirato R3c e R10 per la colpa di precedere i propri input.
2. **I criteri di copertura si valutavano anche sulle finestre cieche.** `coverage_up` chiedeva
   copertura in aumento su *tutte* le righe: dove `recent_form` non ha dati R13 non aggiunge nessuno,
   quindi ogni regola di copertura falliva automaticamente appena esisteva una finestra che non poteva
   vederla. Ora i criteri di copertura, come quelli di accuratezza, guardano solo le finestre che
   misurano.
3. **La misurabilità dipende dal tipo di regola.** Una regola di accuratezza è testata dove *sposta*
   una previsione, una di copertura dove ne *aggiunge* una. Usare il sottoinsieme spostato per entrambe
   etichettava ogni regola di copertura come non misurabile in ogni finestra — non muovere chi è già
   prezzato è precisamente il suo compito.

**Il cross-fit generalizzato**: `features.cross_fit_source` prende la finestra cronologicamente
adiacente, preferendo la più recente. T1 e T2 continuano ad accoppiarsi fra loro, quindi aggiungere
finestre **non riscrive in silenzio i numeri pubblicati**, e una finestra vecchia e poco strumentata
viene valutata con parametri stimati su dati migliori. `verify_baseline` è ancorata a
`PUBLISHED_WINDOWS = (T1, T2)`.

**Ancora disponibile**: 2020-21 (id 103 / 15) e presumibilmente più indietro sulla Serie A. Ogni
stagione in più costa ~40 minuti di scaricamento educato e rende il gate più severo — è la leva più
economica che il progetto abbia per distinguere una regola vera da un parametro adattato.

## 3-quater. Tutto l'archivio (27 luglio 2026) — **7 finestre su Serie A, 4 su euro**, e R7 diventa un risultato

Sondato fino in fondo, una giornata scaricata per stagione: i voti Serie A ci sono **almeno fino al
2015-16** (id 11 per il 16/17, 10 per il 15/16), con 258-281 giocatori votati ogni volta. E **EuroLeghe
2020-21 ha i voti** (499 su 545): il 21/22 è un **buco di una stagione**, non il bordo dell'archivio.

Ingerite 18/19, 19/20, 20/21 su Serie A e 19/20, 20/21 su euro (~173 download educati).

| | finestre utilizzabili | perché |
|---|---|---|
| **Serie A** | **Tm4 · Tm3 · Tm2 · Tm1 · T0 · T1 · T2** (7) | voti in ogni stagione dal 18/19 |
| **euro** | **Tm3 · T0 · T1 · T2** (4) | il buco del 21/22 uccide Tm2 (bersaglio vuoto) e Tm1 (ingresso vuoto) |

Una finestra ha bisogno di voti **su entrambi i lati**, e il guard controllava solo l'ingresso: Tm2/euro
passava il controllo e contribuiva righe valutate su **zero** giocatori a ogni regola del gate. Ora
controlla ingresso *e* bersaglio, e dice quale dei due manca.

**Tm3 e Tm4 attraversano il COVID** (19/20 sospeso a marzo e finito d'estate — per questo l'asta di Tm3
è datata 15 settembre 2020, non agosto — e 20/21 a porte chiuse). Sono finestre legittime e sono calcio
insolito: una regola che tiene anche lì è meglio testata; una che cade *solo* lì merita la domanda posta
a voce, non una bocciatura silenziosa.

### R7 non era una scommessa: era uno stimatore sbagliato

Con sette finestre la persistenza delle presenze dei portieri esce **0.505 · 0.759 · 0.533 · 0.798 ·
0.656 · 0.651 · 0.705** — sempre sopra lo **0.50** che il modello condiviso assume. Il *meccanismo* è
confermato su tutte e sette. Eppure la regola cadeva su tre. La causa era il modo di stimarla: ogni
finestra veniva valutata col coefficiente della **singola finestra adiacente**, e su Tm3 quel vicino
aveva fittato 0.533, cioè quasi il valore condiviso — la regola non faceva nulla e perdeva lo 0.9%.
**Trenta portieri a stagione non bastano a stimare un coefficiente di persistenza; cinque finestre di
trenta sì.**

`POOLED_PARAMS` mette in comune i coefficienti delle **altre** finestre (leave-one-out: il dato della
finestra valutata non entra mai nel proprio parametro). Effetto su Serie A:

| | vicino | **messo in comune** |
|---|---|---|
| finestre vinte | 4/7 | **7/7** |
| guadagno medio | +8.4% | **+9.8%** |
| peggior finestra | **−3.3%** | **+1.6%** |

Per finestra: **−11.3% · −11.3% · −2.3% · −1.6% · −12.9% · −11.2% · −18.3%** di MAE sulle presenze dei
portieri, e la top-10 dei portieri **non peggiora mai** (+1 su quattro finestre). È il risultato più
solido che il gate abbia prodotto, ed è **R7 su Serie A: adottata senza riserve.**

**Su euro R7 esce.** Lo stesso coefficiente messo in comune vince 3 finestre su 4 ma solo dell'1.9-3.3%
(il coefficiente alto del vicino valeva 17% su T1/T2 e niente prima), sfora il non-danno su T1, e sulla
metrica d'asta è un pareggio: −1 nome su Tm3 e T0, +1 su T1 e T2. Due piattaforme, due verdetti — è
esattamente a questo che serve `platform` come dimensione del modello.

⚠️ **Il pooling è applicato SOLO alle regole elencate in `POOLED_PARAMS`** (oggi: R7). Passare tutte le
regole a parametri messi in comune riscriverebbe in silenzio ogni numero pubblicato. Le altre meritano
lo stesso test, una alla volta, sui propri meriti — ed è la prima cosa da provare per ogni regola il cui
coefficiente è **stabile di segno e instabile di magnitudo**.

### Set adottati finali e la simulazione d'asta su ogni finestra

**euro → R0c + R3c + R10** · **Serie A → R3 + R7 + R13**

| Serie A (7 finestre) | Tm4 | Tm3 | Tm2 | Tm1 | T0 | T1 | T2 |
|---|---|---|---|---|---|---|---|
| nomi B0 → adottato | 14→14 | 15→15 | 11→**12** | 12→**13** | 14→14 | 11→**13** | 14→**15** |
| VALORE catturato | 77→**78%** | 81→81% | 79→**81%** | 81→**84%** | 80→80% | 74→**71%** | 76→**81%** |
| MAE di VALORE | −0.6% | −0.8% | −0.2% | −1.0% | −1.0% | −4.1% | −2.4% |

**Il set Serie A migliora il MAE di VALORE su tutte e sette le finestre** e la top-10 non peggiora mai
(91→96 nomi in totale). Il VALORE catturato sale su 6 su 7; l'eccezione è T1 (74%→71%), dove il set
guadagna 2 nomi e ne compra di meno redditizi.

| euro (4 finestre) | Tm3 | T0 | T1 | T2 |
|---|---|---|---|---|
| nomi B0 → adottato | 7→7 | 9→**8** | 6→**7** | 12→**14** |
| VALORE catturato | 77→77% | 81→**78%** | 73→**74%** | 76→**79%** |
| MAE di VALORE | −0.0% | −0.5% | −1.9% | −1.2% |

Sull'euro il MAE di VALORE migliora su tutte e quattro le finestre e la copertura va **dal 30-34% al
100%**, ma la metrica d'asta è piatta sulle due finestre vecchie (7→7, 9→8) e positiva sulle due recenti
(6→7, 12→14). Onestamente: **il set euro è dimostrato sulle finestre su cui è stato costruito e neutro
su quelle che non lo hanno visto nascere.** La differenza con Serie A ha una causa nota — su euro tre
delle quattro regole (R3c, R10, e prima R13/R1) leggono input che partono dal 23/24, quindi sulle
finestre vecchie il set è in pratica solo R0c.

**Il prossimo passo più economico** resta lo stesso: 2017-18 e più indietro sulla Serie A (~7 minuti di
scaricamento per stagione, una finestra ciascuna), e **19/20 e 18/19 su euro** per dare al lato euro
finestre vecchie con più di R0c dentro. Ma il vero collo di bottiglia dell'euro non è il numero di
finestre: sono gli **input** (`external_stats`, `arrivals`, `club_elo`, `new_coach`) che partono dal
23/24 e rendono cieche le finestre vecchie sulle regole che contano.

## 3-quinquies. Audit dei dati (27 luglio 2026) — due input erano solo **non ricalcolati**, e R10 cade

Domanda: servono altri dati o basta quello che c'è? Risposta in tre parti.

### (a) Lo strato voti è completo, e non serve rete

15 coppie stagione-piattaforma dal 18/19 al 25/26: **218.672** righe `match_ratings`, **2.28 M**
`match_rating_bonuses`, `season_stats` derivate per ognuna, listone completo (ruoli Classic e Mantra,
`Qt.A`/`Qt.I`/`FVM` e le tre corrispondenti Mantra). `validate`: **5195 giocatori
Mv-consistenti e FM-consistenti, 0 FM-off**. L'unico buco è **EuroLeghe 21/22, vuoto alla sorgente**.

Verificato anche un sospetto: il modello portieri M2e **non usa `club_elo`** —
`features.goalkeeper_club_rates` legge solo `season_stats.goals_conceded` — quindi le due sole date di
Elo *non* degradano il baseline dei portieri sulle finestre vecchie. Il commento in `elo.py` che parla
di un mix 50/50 con l'Elo descrive un'altra implementazione, non quella dell'harness.

### (b) Due input non mancavano: non erano stati ricalcolati — e R10 cade

`flags.new_coach` esisteva solo dal 23/24 e `arrivals` solo dal 24/25. **Nessuno dei due richiede una
richiesta di rete**: `derive_new_coach` legge `coaches` (2273 righe, storia fino al 1886) e `arrivals` è
un diff fra listoni consecutivi, che ora abbiamo dal 18/19. Ricalcolati offline:

| | prima | dopo |
|---|---|---|
| `flags.new_coach` | 3 stagioni, 1907 flag | **8 stagioni, 2917 flag** |
| `arrivals` | 2 stagioni, 1390 righe | **7 stagioni, 5157 righe** |

E con il test finalmente eseguibile, **R10 cade**. Era la regola che sembrava la più forte del motore
(−5.2% / −3.5% / −4.9% di MAE presenze su tre finestre); su tutte le finestre vince **3 su 4** sull'euro
(media +1.7%, peggior finestra **−6.7%**) e **4 su 7** su Serie A (media +2.7%, peggiore −6.3%). Sulla
metrica d'asta lo stesso quadro: **+1 nome su T1 e T2, −3 punti di VALORE catturato su Tm3 e T0**.
Aiuta sulle finestre su cui è stata inventata e danneggia quelle su cui non lo è stata.

**È la terza volta in un giorno che il gate trova lo stesso schema** (R4, poi R7 su euro, ora R10), e la
causa non è la sfortuna: T1 e T2 sono le finestre di *generazione* delle ipotesi, e finché erano le sole
strumentate ogni regola veniva giudicata sui dati che l'avevano suggerita.

**Set adottati ora: `euro → R0c + R3c` · `Serie A → R3 + R7 + R13`.**
Sull'euro restano in piedi solo la copertura col modello nullo e la regola dei minuti — e R3c è
misurabile su **due** finestre sole, perché i minuti partono dal 23/24. Detto senza attenuanti:
**sull'euro il motore ha oggi due miglioramenti dimostrati, uno dei quali è il modello nullo.**
Su Serie A il set tiene su **tutte e 7** le finestre (media +8.9%, peggior finestra +1.5%).

### (c) Cosa comprerebbe una passata di scraping

| Cosa manca | Perché conta | Costo | Priorità |
|---|---|---|---|
| **`external_stats` + layer per-partita per 19/20-22/23** | R3c è l'unica regola euro non banale rimasta e è **cieca prima del 23/24**; con essa anche R2, R8, R11, R13 tornano testabili sulle vecchie finestre | SofaScore: ~1300 richieste/stagione per gli aggregati, ore per il layer per-partita | **1 - è LA passata che serve** |
| euro **2018-19** voti | darebbe all'euro una quinta finestra (Tm4) | ~30 download, ~5 minuti | 2 - banale |
| Serie A **17/18, 16/17, 15/16** | tre finestre in più (10 in totale) | ~114 download, ~20 minuti | 2 - banale |
| `club_elo` alle date d'asta vecchie | **solo** R5, famiglia già bocciata tre volte. Non serve ai portieri | 5 richieste all'API ClubElo (oggi il modulo legge un CSV seed) | 4 - basso valore |
| **`injuries`** | metà dei buchi nelle top-10 dei difensori | nessuna fonte agganciata (piano: Transfermarkt) | 3 - serve una decisione, non una passata |
| storia di `probable_starter`/`availability` | la forma pre-registrata di R7 | **impossibile a posteriori** (esiste solo lo snapshot 2026-07): va accumulata da adesso | 3 - avviare un job settimanale |
| voti EuroLeghe 21/22 | chiuderebbe il buco euro | **impossibile**: i file della sorgente sono vuoti | - |

**La risposta breve**: per lo strato voti no, non serve altro scraping. Per il *gate*, sì, e una sola
passata conta: **SofaScore sulle stagioni 19/20-22/23**, perché senza i minuti storici le finestre
vecchie sono cieche esattamente sulle regole che il motore usa — ed è per questo che R4, R7-euro e R10
sono sopravvissute così a lungo.

## 3-sexies. La passata eseguita (27 luglio 2026) — **10 finestre Serie A, 5 euro**

Fatta la passata che l'audit indicava, nell'ordine costo/beneficio che indicava.

| Passata | Costo reale | Cosa ha dato |
|---|---|---|
| voti euro **18/19** | ~27 download | euro guadagna **Tm4**: 566 righe stagionali, 564 con FM |
| voti Serie A **17/18, 16/17, 15/16** | ~114 download | Serie A passa a **10 finestre** (Tm7…T2) |
| **layer stagionale SofaScore 19/20-22/23** | ~6 richieste per lega-stagione, **20 minuti in tutto** | `external_stats` da 3 a **7 stagioni** (1161-1372 righe l'una): è ciò che serviva a R3 |
| layer per-partita 19/20-22/23 | ore, in corso in background | serve solo a R3c (minuti sul calendario euro) e alle misure di inattività |
| `arrivals`, `new_coach`, `matchday_map` | offline | 11 e 11 stagioni, `matchday_map` anche sul 18/19 |

**Il layer stagionale costava venti minuti, non ore.** Era la voce marcata «priorità 1» e la stima di
«~1300 richieste/stagione» era sbagliata di due ordini di grandezza: `download_season_stats` è paginata,
sei richieste per lega-stagione. La lezione pratica: **misurare il costo di una passata prima di
rimandarla** — questa è stata rinviata per una stima a occhio.

### Esito su 10 finestre (Serie A)

| Regola | finestre | esito | numeri |
|---|---|---|---|
| **ADOPTED** R3+R7+R13 | 10/10 | ✅ **tiene su tutte** | media **+7.4%**, peggior finestra **+2.5%**, top-10 mai peggiore |
| **R7** portieri (coeff. in comune) | 10 | ✅ robusta, ✗ stretta | **nessuna finestra va contro**: −6.7 −7.1 −3.4 −10.7 −10.4 −0.0 −1.0 −14.5 −11.3 −18.1% · media +8.3% |
| **R3** minuti | 6 (cieca su Tm7-Tm4) | ✅ **6/6** | media **+3.7%**, peggiore +0.8% — era misurata su 2 finestre, ora su 6 |
| R10 nuovo allenatore | 10 | ❌ | 7/10, media +1.4%, peggiore **−6.3%** |
| R4 età | 10 | ❌ **decisa** | **1/10**, media −5.0%, peggiore **−19.6%** |
| R11 / R11b concorrenza | 10 | ❌ | 0/10 entrambe |
| R12 / R12b mercato | 10 | ❌ | 4/10 e 5/10, media ≈ 0 |
| R1b sconto adattamento | 10 | ❌ | 3/10, peggiore −14.2% |

**R7 va guardata bene**: con dieci finestre e il coefficiente messo in comune, **nessuna finestra va
contro la regola**. Il criterio stretto la boccia solo perché una finestra (Tm2) guadagna +0.1%, sotto la
soglia dello 0.5% — non per un segno sbagliato. È il caso in cui i due verdetti si separano e la lettura
corretta è quella robusta: la persistenza dedicata ai portieri è un effetto **stabilito**, non una
scommessa. Su Serie A resta adottata.

**R4 e R10 sono ora bocciate senza margine di dubbio** (1/10 e 7/10 con una finestra a −6.3%): due
regole che a due finestre sembravano fra le migliori del motore.

### Esito su 5 finestre (euro: Tm4, Tm3, T0, T1, T2)

Adottate: **R0c + R3c**, e R3c è ancora cieca su Tm4/Tm3/T0 perché i minuti sul **calendario euro**
richiedono il layer per-partita (in corso). Tutto il resto cade: R7 3/5 con una finestra a −6.0%,
R10 4/5 con una a −5.4%, R3 2/4, R12/R12b/R11/R11b 0-1 su 5.

### Il layer per-partita è arrivato — 734 round, 109.126 righe

Completato: 734 round in cache su 4 stagioni × 5 leghe (la Ligue 1 2019-20 si è fermata al **28°** turno,
il COVID, e il totale reale è 734 non 744), **109.126** righe `external_match_stats`. Poi, offline:
`matchday_map` per lega sulle stagioni vecchie (19/20 da 27 a **104** righe, 20/21 a **134**, 22/23 a
**129**), voto sintetico ricalibrato (out-of-sample MAE **0.369** contro 0.466 del baseline-media su
15.184 partite) e FM-equivalente estera su **1482** arrivi invece di 267.

**Cosa ha reso misurabile, e cosa dicono i verdetti finali:**

| | euro (5 finestre) | Serie A (10 finestre) |
|---|---|---|
| **ADOPTED** | **R0c + R3c** · tiene **4/4**, media **+2.4%**, peggiore +1.0% | **R3 + R7 + R13** · tiene **10/10**, media **+4.3%**, peggiore +1.2% |
| **R3c** minuti sul calendario euro | ✅ **4/4** (era misurabile su 2), media +1.5% | ✅ **4/4**, media +4.3% |
| **R3** minuti stagione reale | robusta 4/5, **nessuna finestra contro** (peggiore +0.2%) | robusta **9/10**, nessuna contro (peggiore +0.2%), media +3.0% |
| **R7** portieri | ❌ 3/5, peggiore **−6.0%** | robusta **9/10**, nessuna contro (peggiore +0.1%), media +8.3% |
| R8 fuori-ruolo | ❌ 2/4, peggiore −20.3% | ❌ **1/6**, peggiore −19.2% — ora misurabile e **bocciata senza dubbio** |
| R14 inattività | ❌ 0/4 | ❌ 4/6 ma sfora il non-danno |
| R4 / R4b età | ❌ 3/5 e 1/5 | ❌ **1/10** e 1/10 (peggiore **−56.6%**) |
| R10 nuovo allenatore | ❌ 4/5, peggiore −6.5% | ❌ 4/10, media +0.3% |
| R11 / R11b / R12 / R12b / R1b | ❌ | ❌ 0/10, 0/10, 4/10, 5/10, 3/10 |

**Tre regole stanno nella categoria «robusta sì, stretta no»** — R3 su entrambe le piattaforme e R7 su
Serie A — e vale leggere il dettaglio: **nessuna finestra va contro di loro**. Il criterio stretto le
boccia solo perché una finestra guadagna +0.1% / +0.2%, sotto la soglia dello 0.5%. È esattamente il caso
per cui i due verdetti sono stati separati, e la lettura corretta è la robusta.

### Simulazione d'asta, tutte le finestre (nomi B0 → adottato · VALORE catturato)

| Serie A | Tm7 | Tm6 | Tm5 | Tm4 | Tm3 | Tm2 | Tm1 | T0 | T1 | T2 |
|---|---|---|---|---|---|---|---|---|---|---|
| nomi | 16→16 | 15→15 | 14→**17** | 14→**15** | 15→15 | 11→**13** | 12→**14** | 14→**16** | 11→**13** | 14→**15** |
| VALORE | 77→76% | 78→**82%** | 78→**84%** | 77→**84%** | 81→**83%** | 79→**81%** | 81→**83%** | 80→**83%** | 74→**71%** | 76→**81%** |

**136 → 149 nomi su 400**, e il VALORE catturato migliora su 8 finestre su 10 (le eccezioni: T1 74→71% e
Tm7 77→76%).

| euro | Tm4 | Tm3 | T0 | T1 | T2 |
|---|---|---|---|---|---|
| nomi | 9→9 | 7→**8** | 8→8 | 6→6 | 12→**13** |
| VALORE | 78→78% | 77→**79%** | 80→79% | 73→73% | 76→**78%** |

Sull'euro il guadagno resta piccolo e onesto: **42 → 44 nomi su 200**, VALORE su tre finestre su cinque.
La differenza con Serie A ha una causa che i dati ora mostrano: sull'euro il set adottato è **R0c + R3c**,
cioè copertura più una regola, mentre su Serie A sono tre regole di cui una (R7) vale da sola +8.3% medio.

## 4. Ipotesi FALSIFICATE — non riproporre senza finestre nuove

| Regola | Parametro (T1 / T2) | Perché cade |
|---|---|---|
| **R1b** sconto adattamento cross-lega | δ_cross **−0.036 / +0.156** | Segno opposto fra finestre, e δ_intra (0.09 / 0.33) è **maggiore** di δ_cross: il segnale non è l'adattamento alla nuova lega ma un generico cambio-squadra. Era il criterio di falsificazione scritto in pre-registrazione, ed è scattato. |
| **R2** propensione per-90 (xG/xA) | γ **−0.003 / −0.014** → poi **+0.028 / +0.021** | ⚠️ **verdetto corretto nel §5-bis**: col layer per-partita completo il segno diventa giusto e stabile — ma ⚠️ **solo su Serie A** (+0.033 / +0.010); sull'euro oggi è +0.016 / −0.002, quindi ancora un cambio di segno (§5-octies). Non passa ancora il criterio sul MAE, ma la falsificazione originale era in parte un artefatto dell'input incompleto → **da ri-pre-registrare**, non archiviata. |
| **R5** àncora forza-club da ClubElo | λ +0.023 / +0.073 | **Terza bocciatura della famiglia** (dopo forza-club interna ed Elo additivo movimento). Il segno è giusto su entrambe le finestre — l'intuizione Kane è corretta — ma il MAE di T1 peggiora ogni volta. |
| **R6** rigoristi (forma ridotta su confidence) | λ **+0.332 / −0.222** (⚠️ **euro**; su Serie A è −0.331 / −0.122, cioè segno **stabile e negativo** — §5-octies) | Segno opposto *sull'euro*, e peggiora gli attaccanti (+1.8% / +2.7%). La forma ridotta comprime troppo (manca il tasso rigori per club e la conversione di carriera) e i rigoristi datati prima dell'asta sono 22 e 29. |
| **R8** fuori-ruolo da heatmap | avanti +0.032 / **−0.070** → poi **+0.121 / +0.041** | ⚠️ **anche qui l'instabilità era dei dati** (§5-bis): col layer completo entrambi i versi hanno segno stabile («più indietro» −0.22 / −0.327). Non passa, ma la ragione della bocciatura non è più «segno instabile». |
| **R11 / R11b** concorrenza posizionale | ⚠️ **verdetto corretto il 28/07, vedi §5-septies**: λ **−0.010 / −0.010** e soglia **−0.072 / −0.066** contro la baseline giusta (i +0.008/+0.010 registrati qui erano fittati contro B0, prima del fit a due passate) | Migliora il Pv MAE del 3% su Serie A — l'effetto singolo più grande del gate. Il segno **conferma** l'ipotesi: più arrivi nel tuo ruolo, **meno** presenze. Coefficiente stabile su **10 finestre su 10** (dispersione 0.17). Cade sull'errore, non sul meccanismo. La ri-pre-registrazione come «sottostima da rifacimento rosa» nasceva dal segno sbagliato → **decaduta**. |
| **R11b** posizione affollata (soglia ≥2) | +0.012 / −0.001 | La soglia non è una coda: 620 giocatori su 1450 la superano. |
| **R12** attesa di mercato (Qt.I nel ruolo) | λ −0.003 / +0.010 | L'attesa **assoluta** del mercato non aggiunge nulla alla fantamedia precedente: è costruita sulla stessa storia. |
| **R12b** revisione dell'attesa (Qt.I anno su anno) | λ −0.040 / −0.076 | Segno stabile ma significato opposto: dice che chi è rivisto **al ribasso** rende *più* di B0, cioè approssima il ritorno alla media che B0 già fa. Fallisce su T1 e sul VALORE. |
| **R4b** curva d'età sulle presenze | −0.014 / −0.014 | Stabile e inutile: Pv MAE −0.0%, VALORE peggiore. L'effetto età sta sulla FM, non sulle presenze. |
| **R14 / R14b** inattività: costo di uno stop di 45+ giorni su presenze / fantamedia | share **+0.011 / +0.001** · FM **+0.044 / −0.044** | Il segnale c'è nei dati **grezzi** — oltre 90 giorni di stop dentro la stagione significa ~13 presenze l'anno dopo contro ~18 della banda normale — ma **non è incrementale**: `share_prec` lo assorbe già. Chi è stato fuori ha una quota bassa, il baseline gli predice già poche presenze, e al rientro ne fa *più* di quel minimo. Il residuo non ha segno stabile. Vedi §5-quater. |
| **R1** copertura nuovi entrati, *sull'euro* | β_new 0.431 / 0.398 | **Non batte la risposta banale** (criterio 5): FM MAE 0.391 sui giocatori che aggiunge contro 0.373 della sola àncora di ruolo su T1. Lo strato arrivi + FM-equivalente estera produce un numero peggiore di una costante per ruolo. Resta il *meccanismo* di copertura, non lo stimatore: al suo posto R0c. |
| **R13** presenze dalle ultime partite, *sull'euro* | share 0.40+0.09·m | Idem, su entrambe le finestre. Su **Serie A** invece la batte e resta adottata: i senza-storico di Serie A vengono dall'estero e le ultime dieci partite dicono qualcosa; sull'euro sono in gran parte giovani di club del perimetro, dove l'àncora di ruolo è già la miglior stima. |
| **R13b** fantamedia dal rating confrontato fra campionati | λ **−0.454 / +0.05** | Fallisce su Serie A (+40% di errore sugli aggiunti, oltre il limite) e il segno si inverte. Vedi §5-ter: **quanto** gioca si trasferisce, **quanto bene** no. |
| **R17** attacco affollato: quota reclamata dai compagni sopra la capienza schierata, caricata a chi il mercato ordina sotto (28/07/2026, prima corsa su 6+4 finestre) | λ **stabile e negativo ovunque**: Serie A −0.055…−0.097 (disp. 0.24, 6/6), euro −0.047…−0.067 (disp. 0.15, 4/4) | **Il coefficiente più pulito mai bocciato.** Sui giocatori mossi il MAE peggiora su 9 combinazioni finestra×piattaforma su 10 (Serie A robust 1/6, media −7.3%, peggiore −14.9%; euro 1/4, −0.9% — l'unica a favore è T1, bruciata; le finestre PULITE sono le più nette contro). Il meccanismo esiste in-sample e **non si trasferisce fra stagioni** — quinta formulazione dell'affollamento respinta sull'errore (R11, R11b, R16, R16b, R17), e i caricati di T1/T2 avevano reso 1.04× il previsto già nel diagnostico pre-corsa. Autopsia completa e cosa resta (annotazione «Pair» nel pannello, 23/23 coppie top-15 rette): [attacco-affollato-r17-v1.md](attacco-affollato-r17-v1.md) §9-10. **Famiglia esaurita con gli input correnti**: si riapre solo con un input nuovo (es. lo storico settimanale di `probable_starter` che accumula da luglio 2026), non con una sesta misura degli stessi aggregati. |

⚠️ **Da non confondere con questa tabella**: le quattro credenze misurate il 29/07 (riposo, «vincere aiuta
a vincere», l'undici che si conferma, la sferzata del nuovo allenatore) **non sono giri di gate** e non
stanno qui. Sono misure descrittive per-giornata, in §5-duodecies e in
[turnover-atteso-v1.md](turnover-atteso-v1.md). Due di esse falsificano la credenza **sul rendimento**
(fantavoto a segno rovesciato dopo una vittoria, verificato contro il suo null rimescolato; e il gol che
**non** si raggruppa nel tempo in Serie A) senza che nessuna regola sia stata provata: una credenza
smentita descrittivamente non è un'ipotesi bocciata dal gate, e va citata per quello che è.

## 5. Difetti dei dati trovati dal gate (due corretti, tre aperti)

1. ✅ **FM-equivalente dei portieri: +1.117 / +1.076 / +1.064 sistematico, 0% entro 0.3.** Non ha il
   termine gol subiti (il layer per-partita ha i gol *fatti* e non il risultato), quindi per un portiere
   manca tutto il lato negativo. 45 righe di `arrivals` lo portavano: ora NULL, con test. *L'affermazione
   «FM-equivalente a +0.035 dalla FM euro reale» vale per i giocatori di movimento del perimetro, non
   per i portieri e non fuori perimetro.*
2. ✅ **Il prezzo era di fine stagione.** L'ingest salvava solo `Qt.A` (quotazione **attuale**) e l'Excel
   è scaricato dopo la stagione: per una stagione già giocata quel campo sa già com'è andata (Openda
   25/26: Qt.I 20 → Qt.A 3). `Qt.I` era nello stesso file: ora in `rosters.price_initial`, e
   `arrivals._price_percentiles` lo usa (**i tier T1/T2/T3 erano assegnati da prezzi di fine stagione**;
   T1 51 → 76). Disponibili e non ancora salvati: `Qt.A M`, `Qt.I M`, `FVM`.
3. ✅ **RISOLTO il 27/07 — Bias di selezione nel layer per-partita** (dettaglio e numeri nel §5-bis).
   Era scaricato seguendo le partite dei club del
   perimetro: i 9 club Serie A del perimetro hanno tutte le 38 giornate, **gli altri 11 esattamente 18**
   — verificate una per una, sono le partite contro il perimetro, andata e ritorno. Quindi un giocatore
   fuori perimetro è misurato **solo contro le squadre più forti**. Isolato dal voto sintetico (FM reale
   sulle giornate coperte meno FM reale sulle 38): **A −0.224 · P −0.164 · C −0.076 · D −0.053**, casi
   peggiori Douvikas −1.17, Audero −0.78. Vale per tutte e 5 le leghe e distorce **al ribasso**
   l'FM-equivalente, cioè l'input di R1.
4. ⚠️ **`assists_set_piece` è NULL su tutte le ~18k righe di voti di ogni stagione**: la sorgente non ha
   mai splittato gli assist → **il modello piazzati della nota v2 non è misurabile**, non è che fallisce
   il gate. E i rigoristi designati fra i difensori sono **7**: la metà rigori non è fittabile.
5. ⚠️ **`probable_starter` e `availability` esistono solo con data 2026-07** (snapshot corrente): usabili
   come input *live* per l'asta 26/27, **inutilizzabili nel gate retrospettivo**. Servono snapshot
   settimanali accumulati.
6. ⚠️ **Il ruolo reale granulare (`player_roles`) è il TERZO fatto di questa classe** (28/07): i dodici
   codici del provider (`GK` · `DL DC DR` · `DM` · `ML MC MR` · `AM` · `LW RW` · `ST`) sono serviti solo
   per **adesso** — `?seasonId=` risponde **200 e lo IGNORA**, restituendo i codici di oggi per una
   stagione di tre anni fa (verificato: Dimarco torna `['ML']` sia per 25/26 sia per 23/24). Quindi è
   input *live* e **non gatabile sul passato**, come `probable_starter` e `flags.contract_until`.
   **Storici e utilizzabili nel gate**, invece, e vanno usati al suo posto quando serve una posizione su
   una finestra passata: `positions.derived_role` (G/D/M/F per stagione, dal layer per-partita, 100% di
   copertura) e `positions.avg_x/avg_y` (heatmap di stagione). Nessuna regola legge oggi `player_roles`:
   la colonna nel foglio è `desc_*`, descrittiva, e tradurre i codici in un ruolo Mantra
   (`desc_mantra_real`) è **anch'essa** descrittiva — se un giorno uno di questi numeri deve diventare un
   coefficiente, serve una pre-registrazione come per qualsiasi altra candidata.

## 5-bis. Layer per-partita COMPLETATO (27 luglio 2026) — e due verdetti da correggere

Il difetto 3 è chiuso. `positions --layer complete` (merge incrementale: si rilegge la cache di ogni
giornata, il listing dice quali partite finite mancano, si scaricano solo quelle) ha portato il layer
a **5.254 partite su 5.256 = 100%** (le 2 mancanti non sono marcate `finished` dal provider), da 3.314.
`external_match_stats` passa a **110.597 righe**. ~1.940 partite aggiunte in ~2h10 di rete.

**Il bias di selezione è sparito per costruzione**: `synth --validate` riporta **0 club con layer
incompleto** in tutte e tre le stagioni, contro 12/12/11 prima. Effetto sull'FM-equivalente misurato
contro la fantamedia Serie A reale:

| Stagione · ruolo | MAE prima → dopo | entro 0.3 dal reale, prima → dopo |
|---|---|---|
| 23/24 D · C · A | 0.135→**0.106** · 0.166→**0.111** · 0.227→**0.125** | 91→95% · 85→**98%** · 76→**93%** |
| 24/25 D · C · A | 0.177→**0.108** · 0.172→**0.115** · 0.207→**0.136** | 80→**98%** · 86→97% · 74→**91%** |
| 25/26 D · C · A | 0.159→**0.127** · 0.140→**0.105** · 0.249→**0.133** | 84→93% · 89→95% · 67→**94%** |

Gli attaccanti quasi dimezzano il MAE e passano dal 67% al 94% entro 0.3. Il bias medio si avvicina a
zero quasi in ogni cella (25/26 A: −0.143 → −0.049).

**Effetti sul motore.** Le feature di input ora si aggregano dal layer per-partita e non dagli
aggregati stagionali, che risolvono l'identità sul listone *di quella stagione* e quindi mancavano
proprio i nuovi entrati (Ezzalzouli: 33 partite e 1995 minuti nel 24/25 nel layer per-partita, nessuna
riga negli aggregati). Conseguenze:
- **copertura euro dal 31.2%/33.7% al 42.3%/43.2%** del listone: i giocatori prezzati in più passano da
  24/22 a **122/94** per finestra, con VALORE MAE 51.1/48.6 contro il 46.3/42.4 del baseline stesso;
- **β_new più che raddoppia: 0.186/0.230 → 0.431/0.398.** L'FM-equivalente non è più una misura
  rumorosa e distorta al ribasso, quindi il motore può appoggiarsi ad essa il doppio;
- Ezzalzouli passa da «FM senza presenze, fuori classifica» a VALORE 110 (reale 204);
- set adottati **invariati**, numeri sul campione comune invariati (−1.6%/−1.7%).

**Due verdetti del §4 vanno corretti: erano in parte artefatti dell'input incompleto.**
- **R2 (propensione per-90)**: γ passa da −0.003/−0.014 (segno sbagliato) a **+0.028/+0.021 — segno
  giusto e stabile**. Non passa ancora il criterio sul MAE, ma «γ ≈ 0 di segno sbagliato» non è più
  una descrizione onesta: l'ipotesi va ri-pre-registrata, non archiviata come falsificata.
- **R8 (fuori-ruolo)**: il verso «più avanti» passa da +0.032/**−0.070** a **+0.121/+0.041** (segno ora
  stabile) e «più indietro» resta coerente (−0.22/−0.327). L'instabilità di segno era dei dati.

**Un effetto vero con l'etichetta sbagliata.** Su Serie A R11/R11b danno l'effetto singolo più grande
di tutto il gate (**Pv −3.1%/−2.8%**, VALORE −2.9%/−1.6%, top-10 non peggiore) con coefficienti ora
**stabili**: `competition_lam` +0.008/+0.010 e `crowded_lam` +0.044/+0.055. Sono positivi: club che
comprano 2+ giocatori in un ruolo hanno giocatori che giocano **più** di quanto il baseline preveda. Non
è concorrenza. La lettura plausibile è che il baseline, costruito sulla quota di presenze dell'anno
prima, **sottostima chi cambia contesto** (neopromosse, rose rifatte). Non adottata: rinominare
l'ipotesi dopo aver visto il segno è post-hoc. **Pre-registrata** come «sottostima da rifacimento
rosa», con una misura di churn vera, per la finestra 26/27.

## 5-ter. Giocatori prezzati senza storico: `recent_form` e R13 (27 luglio 2026)

Ogni agosto il listone prezza giocatori di cui non abbiamo **niente**: arrivano da un campionato che
non scarichiamo (Eredivisie, Championship, Liga Portugal, Serie B, Süper Lig, Pro League, Brasile) o da
un club fuori perimetro. Misurati sui due listoni: **63 nel 25/26 e 64 nel 24/25** con quotazione
d'asta **sopra la mediana del loro ruolo** e zero righe sia in `season_stats` sia nel layer
per-partita — Gyökeres, Cancelo, Tillman, Giménez, O'Riley, João Neves, Neres, più gli uomini delle
neopromosse. Il motore li prezzava sulla sola àncora di ruolo.

Il modulo **`recent_form`** prende le loro ultime N partite di club con rating, minuti, gol e assist,
**datate**. Stato: **123 giocatori su ~127 (97%), 1.196 partite** — 65 giocatori e 617 partite
utilizzabili nella finestra T1, 123 e 1.196 in T2 (T1 chiede di paginare due anni indietro, quindi è
strutturalmente più magra). Competizioni più frequenti: serie-b · eredivisie · pro-league ·
championship · liga-portugal · süper lig · laliga-2 · brasileirão.

I **4 irrisolti** e il perché, che dice dove sono i limiti veri: Grønbæk (la ricerca del provider non
trova la forma senza diacritici: non è il confronto a fallire, è il suo indice) · Jeong (senza anno di
nascita e con follower 1655 contro 673 resta legittimamente ambiguo) · James J. e Marin M. (il
giocatore giusto non è fra i primi 5 per follower, quindi il sondaggio sull'anno di nascita non lo
raggiunge).

Quattro decisioni di progetto, ognuna un punto dove si sbagliava facilmente:
- **sopra la mediana, non «almeno»**: per i portieri la mediana è **1 credito**, quindi «almeno media»
  avrebbe pescato tutti i terzi portieri (56 contro 8);
- **`source='sofascore_recent'`, non `'sofascore'`**: `synth` fitta e applica la sua retta solo alla
  fonte calibrata, quindi un 7.0 di Serie B non diventa mai un voto base di Serie A;
- **partite datate + filtro sulla data d'asta nel motore**: l'endpoint del provider è ancorato a
  *oggi*, quindi per una finestra passata si pagina indietro finché le partite precedono quell'asta.
  È il filtro che rende gli stessi dati legali in un backtest;
- **identità a scala che rifiuta invece di indovinare**: tier1 club confermato · tier2 anno di nascita
  (una richiesta per candidato, spesa solo su un pareggio) · tier3 nessun altro vicino nei follower,
  etichettato. Confronti **folded** con `matching.fold`/`split_initial`: senza quelli quattro Vázquez
  restavano irrisolti (l'accento) e «James J.» diventava il cognome «J», che matcha ogni nome con una j.

**R13 spezzata in due, e la divisione è il risultato.** Dalle ultime partite in un campionato che non
copriamo, **quanto** gioca si trasferisce e **quanto bene** gioca no:
- **R13 (presenze dai minuti al vecchio club, àncora di ruolo per il rendimento): ✅ passa su tutte e
  tre le piattaforme.** Adottata.
- **R13b (fantamedia dal rating confrontato con gli altri nuovi): ❌** fallisce su Serie A e λ si
  inverte (−0.454 / +0.05, e col campione pieno −0.026 / +0.054: sempre di segno instabile e ora anche
  di magnitudo nulla). Un rating confrontato fra competizioni diverse non è un livello. Il campione più
  grande ha **confermato** la bocciatura invece di ribaltarla.

**Effetto complessivo dei set adottati** (campione comune invariato: euro −1.6%/−1.7% di VALORE,
Serie A −4.2%/−2.8%; top-10 6→8/9 e 12→14 · 11→13 e 14→15):

| | copertura prima | dopo |
|---|---|---|
| euro T1 / T2 | 31.2% / 33.7% | **46.3% / 49.1%** |
| Serie A T1 / T2 | 42.4% / 41.8% | 46.1% / 47.8% |

Sull'euro sono **164 e 141 giocatori** che il baseline non prezzava affatto, ora con un VALORE (errore
48.9/48.5 contro il 46.3/42.4 del baseline sui suoi: più difficili, come è giusto, ma dentro il limite).
Sulle presenze dei soli aggiunti da R13, in T1 il MAE è **6.82 contro il 7.25 del baseline sui suoi**:
i nuovi entrati sono previsti meglio della media di chi era già prezzato.

**Limite noto**: un nome privato dei diacritici può restituire **zero** candidati dalla ricerca
(«Gronbaek» contro «Grønbæk»): lì non è il confronto a fallire ma l'indice del provider. La strada
robusta è risolvere attraverso la **rosa del club** invece che per nome, e richiede gli id squadra
SofaScore in `club_xref`, che oggi contiene solo quelli di Transfermarkt.

## 5-quater. Inattività e rientri da infortunio (27 luglio 2026) — segnale reale, non incrementale

`injuries` è vuota e nessuna fonte la riempie, ma il layer per-partita **datato** dice già quando un
giocatore non è sceso in campo: un buco di 90+ giorni dentro una stagione è uno stop, qualunque ne sia
la causa. Calcolato in `features._inactivity` su entrambe le fonti (le 5 leghe e `recent_form`), sempre
prima della data d'asta, con tre misure: intervallo massimo senza giocare, giorni dall'ultima partita,
minuti nelle ultime 3 presenze.

**Una correzione fa la differenza fra segnale e rumore**: gli intervalli che contengono il **1° luglio**
vanno scartati. Misurando a cavallo della pausa estiva, 520 giocatori finivano nella banda «oltre 90
giorni» e la relazione con le presenze dell'anno dopo **si invertiva**. Misurato dentro la stagione è
monotono su entrambe le finestre:

| Intervallo massimo | presenze T1 dopo (prima) | presenze T2 dopo (prima) |
|---|---|---|
| 0-20 giorni | 17.6 (11.2) | 18.3 (15.0) |
| 21-45 giorni | 18.3 (17.0) | 17.6 (17.8) |
| 46-90 giorni | 16.2 (12.8) | 15.6 (14.0) |
| **oltre 90** | **13.5** (8.7) | **12.6** (8.9) |

Le misure trovano i nomi giusti: Perin 265 giorni, J. Timber 281, Musso 267, Cragno 246, Milner 267.

**Ma R14 e R14b non passano il gate**, ed è il gate a fare il suo lavoro: share **+0.011 / +0.001** e
FM **+0.044 / −0.044**, segno instabile e magnitudo quasi nulla. Il motivo è che il segnale **non è
incrementale**: `share_prec` assorbe già l'assenza — chi è stato fuori tre mesi ha una quota bassa, il
baseline gli predice già poche presenze, e al rientro ne fa *più* di quel minimo (ritorno alla media).
Il residuo non contiene più informazione. Stessa lezione di R12b: un segnale vero nei dati grezzi può
essere già interamente dentro il baseline.

**Resta utile come descrizione**, non come regola: le tre misure sono sull'`Observation` e nel report
di inventario, quindi un `PlayerCard` può dire «reduce da 265 giorni di stop» anche se il motore non
sposta il numero. E se un giorno `injuries` porterà la **causa** (muscolare, crociato) e la data di
**rientro** previsto, quella è informazione che il baseline non può avere — l'ipotesi va ri-provata
allora, non ora.

## 5-quinquies. Sei candidate del 28 luglio 2026 — **zero adottate**, e non tutti i no sono uguali

Passata nata dai rilievi dell'utente sul pannello Auction. Nessuna entra nel motore. La cosa che è
entrata in produzione quel giorno non è una regola ma la metrica d'asta: `metrica-asta-surplus-v1.md`.

**Lezione di metodo, due volte nello stesso giorno**: leggere il **coefficiente** invece del solo verdetto
ha cambiato la conclusione. Prima sul segno di R16b, poi su R15. Va fatto per primo, non per ultimo.

| Regola | Coefficiente | Verdetto |
|---|---|---|
| **R15** persistenza della disponibilità nelle presenze attese | euro **+0.074 … +0.096** su 5 finestre · Serie A cambia segno 4 volte | **QUASI**, il più vicino di tutto il set. Serie A 8/10 finestre, −1.4% … −6.8% di Pv MAE sugli spostati, media +2.6%, e i due fallimenti sono +0.1% e +0.4% (le due più vecchie). Euro migliora **tutte e cinque** ma fuori da Tm4 (−6.4%) sta fra 0.2% e 0.8%, quindi Tm3 sfora il pavimento dello 0.5%. Costa nomi su tre finestre. Su euro il coefficiente è **notevolmente stabile**: là il quasi-fallimento è l'ampiezza, non l'instabilità — un caso diverso da R4, e il gate oggi non sa distinguerli. |
| **R16** affollamento: budget gol del club × la **sua** quota | segno che salta (Serie A +0.152, −0.047, −0.076, +0.142, …) | **BOCCIATA**, 3/10, media −1.2%, peggiore −14.9%. Rumore, e in retrospettiva non poteva funzionare: la sua quota dei gol dell'anno prima **è già dentro la sua fm_prec**, quindi il regressore ripete ciò che il baseline ha già. |
| **R16b** affollamento: il budget che rivendicano i **compagni** | **+0.033 … +0.165, 9 finestre su 10 positive** (la decima −0.006), euro 4/5 | **BOCCIATA, e il segno è l'opposto dell'ipotesi.** L'affollamento predice **negativo**. Quindi non misura affollamento: misura **forza offensiva del club**, col segno della marea che alza tutte le barche. Le due sono intrecciate per costruzione — una squadra i cui attaccanti hanno prodotto molto è insieme un attacco forte e un attacco affollato — e la metà «forte» domina. Escluse prima due spiegazioni alternative allo split di finestre: gol e assist ci sono in **tutte le 11 stagioni**, e il club di destinazione è noto per il **100%** di ogni listone. |
| **R13c** fantamedia dai gol+assist per 90 **misurati** | — | **BOCCIATA per muro di campione, non per ipotesi sbagliata.** Direzione confermata: dove differisce da R13b vince la produzione (Serie A T2 0.387 contro 0.407, euro T2 0.320 contro 0.324) — «i gol sono lo stesso evento in ogni campionato, il rating di un provider no», che è ciò che aveva ucciso R13b. Contro la risposta banale vince una finestra e pareggia l'altra: Serie A T1 **0.248 contro 0.325 (−24%)**, T2 0.387 contro 0.387. |
| **R5b** forza offensiva del club dagli **xA** | — | **NON ADOTTATA, verdetto pre-registrato prima della corsa.** Serie A **passa formalmente** 3/3 (−1.8% / −2.8% / −0.7%, media +1.8%, nessun danno collaterale); euro **non passa** 1/3, con T1 2.8% peggiore. Ma xG/xA partono dal 2022-23 → misurabile solo su T0/T1/T2, **le stesse tre finestre su cui funzionava R16b e quelle da cui l'ipotesi è stata letta**: era scritto in anticipo che un passaggio non conferma nulla e solo un fallimento è informativo. Verdetto **sospeso** su Serie A, negativo su euro. Sarebbe la **quarta** corsa alla famiglia forza-club (R5 è la terza — vedi §4). |

### Il muro di R13c, misurato: non è quello che avevamo appena riparato

Imbuto per finestra — coorte → bonus misurati → ≥450 minuti → `Pv_reale ≥ 15` (valutabili):

| finestra | coorte | misurati | ≥450 min | **valutabili** |
|---|---|---|---|---|
| euro/T1 | 57 | 57 | 51 | **19** |
| euro/T2 | 66 | 65 | 54 | **14** |
| Serie A/T1 | 24 | 24 | 23 | **16** |
| Serie A/T2 | 35 | 35 | 34 | **21** |

L'arricchimento dei bonus ha funzionato (copertura della feature ~totale) e il pavimento dei minuti costa
poco. Il crollo è al **dominio di scoring**: circa un quarto di questi giocatori arriva a 15 presenze,
perché un nuovo arrivo prezzato e senza storico in gran parte **resta** marginale. Da 14 a 21 osservazioni
non portano un coefficiente per pulite che siano → servono **più finestre, non più scraping**. E
**esplicitamente non** un dominio di scoring allargato per far passare la regola: sarebbe scegliere il
test dopo aver visto la risposta.

### Un proxy da non riusare: la correlazione a livello di club è CONTRO-informativa

Per scegliere la misura di forza offensiva ho correlato la misura di input (per presenza) coi gol della
stagione successiva per presenza, a livello di club:

| | goals | goals+assists | xG | **xA** | xG+xA |
|---|---|---|---|---|---|
| euro (pooled) | 0.59 | 0.60 | 0.50 | **0.66** | 0.60 |
| Serie A (pooled) | 0.34 | 0.35 | 0.27 | 0.28 | 0.28 |

Su euro xA è la migliore delle tre e su Serie A niente predice bene né stabilmente (gol 0.55 / 0.63 /
**0.11**). Poi la regola **fallisce su euro e passa su Serie A**: ordinamento esattamente opposto. Quindi
una correlazione club↔gol-del-club **non predice quale misura aiuta la fantamedia di un GIOCATORE**. Non è
solo debole, è contro-informativa: sceglierci un regressore avrebbe fatto sbagliare in entrambi i versi.

### Difetti di dati chiusi nella stessa passata

- **`recent_form`, uno zero fabbricato**: `SUM(COALESCE(goals,0))` trasformava «bonus mai scaricati» in
  «non ha segnato». Lauriente arrivava al motore con **0 gol e 0 assist in 715 minuti**; era capocannoniere
  in Serie B. Riguardava **111 dei 123** giocatori della popolazione. Un'osservazione **fabbricata** è
  peggio di una mancante, perché un fit ci impara sopra volentieri. Ora i totali sono `None` se nessuna
  riga li porta e `recent_bonus_matches` dice quanto è misurato. *Stulic* passa da «0 gol» a **7 gol e 1
  assist in 802 minuti**: senza la correzione avremmo imparato che Gyökeres (1.42 per 90) e Stulic (0.90)
  sono lo stesso giocatore.
- **Il resume si auto-assolveva**: contava le *partite*, non i bonus, quindi chi era stato salvato da una
  corsa `--no-bonuses` risultava coperto per sempre.
- **L'identità veniva buttata via**: `resolve()` non scriveva `player_xref`, e l'unica traccia era il CSV
  di copertura, che ogni corsa **sovrascrive** → 17 giocatori irrecuperabili senza ri-risolverli.
  Arricchite **1195/1196** partite, **122/123** giocatori completi (l'unico buco è una partita per cui il
  provider non serve statistiche), `player_xref` da 3005 a 3021 id.
- **`fit_params` aveva una guardia incompleta**: il blocco dei residui non elencava R16/R16b. Nel gate non
  morde (fitta sempre tutto il set), ma fittare un **sottoinsieme** produceva silenziosamente nessun
  coefficiente e una regola che «non fa niente». È così che me ne sono accorto.
- **`Konè I.` (Sassuolo) arrivava al pannello come `Kon<?><?> I.`**: i CSV esportati da Drive hanno gli
  accenti **già distrutti** alla fonte (58 nomi), e `rosters` sovrascriveva `canonical_name` senza
  condizioni, così il listone pulito non poteva mai vincere. Una regola per tutti gli scrittori: un nome
  danneggiato non scalza mai uno intatto, uno intatto ripara sempre un danneggiato. 8 nomi riparati.

## 5-sexies. Stabilità del coefficiente (pre-registrata 28/07/2026) — **classifica, non giudica**

Il gate giudica una regola dall'**errore**. Non sa esprimere una distinzione che le sei candidate del 28/07
hanno reso inevitabile: il coefficiente di R15 è lo stesso numero su tutte e cinque le finestre euro
(+0.074…+0.096) e manca il pavimento d'ampiezza, mentre quello di R16 cambia segno e l'errore migliora per
caso. Entrambe risultano «non passa» e non sono la stessa situazione.

**Misura**, per ogni regola con un coefficiente singolo identificabile: `segno coerente` su tutte le
finestre che la misurano · `dispersione` = sd/|media| · **stabile** = segno coerente e dispersione < 0.5.
La soglia è 0.5 perché è dove |media| = 2·sd, il senso più grezzo in cui un coefficiente si distingue da
zero fra finestre. **Non** è stata scelta guardando cosa serve a una regola — e non avrebbe potuto esserlo
onestamente, perché i coefficienti di R15 erano già stati visti quando è stata scritta. Per questo:

> ⚠️ **Non cambia nessun verdetto.** Pavimento e non-danno restano intatti. Serve a distinguere «da
> riprendere quando arriva una finestra nuova» da «chiuso». Ammettere una regola per stabilità è una
> decisione diversa: se un effetto reale ma minuscolo si merita un parametro nel motore è un giudizio di
> prodotto, non statistico, e il pavimento dello 0.5% è la risposta che il progetto già si è dato.

### ⚠️ Limite trovato alla prima corsa: la dispersione ha DUE cause

1. **non c'è effetto** — il fit rincorre rumore (R16: −0.101, +0.146, +0.098, +0.019, −0.006);
2. **il regressore è COLLINEARE** con uno già nel modello, quindi il fit si scambia peso fra i due di
   finestra in finestra mentre la previsione resta buona.

La seconda non è un difetto, e la prima corsa l'ha dimostrato: **R3 è ADOTTATA su Serie A ed esce
instabile** (dispersione 0.88, da +0.060 a +0.460 con Tm3 a −0.075), perché il suo regressore sui minuti e
`share_prec` misurano entrambi quanto ha giocato — e R3 vince **10 finestre su 10** sull'errore. Quindi un
coefficiente instabile **non è motivo per dubitare di una regola che funziona**: vuol dire che il
coefficiente non è *interpretabile*. La classifica è affidabile per le regole a λ singolo, e va letta come
«può essere collinearità» per quelle che rifanno la regressione delle quote (R3, R3c, R15).

### Esito, applicato a tutte le candidate

**Stabili ma respinte** — quindi «effetto coerente che non riduce l'errore», da riprendere con finestre nuove:

| | euro | Serie A |
|---|---|---|
| **R10** nuovo allenatore | 0.41, 5/5 positive | **0.33, 10/10 positive** |
| **R11 / R11b** concorrenza posizionale | 0.48 / 0.47 | **0.17 / 0.17**, sempre negative |
| **R13c** produzione misurata | **0.03** (la più stabile del set) | 4.23 |
| **R15** persistenza | **0.11** | 2.21 |
| **R13b** rating fra campionati | 0.33 | 1.86 |

R10 e R11/R11b sono il caso più netto: coefficiente **coerente su tutte e dieci** le finestre Serie A e
respinte sull'errore. Per R11 la stabilità ha portato a rileggere il coefficiente, e quella rilettura ha
trovato che il «segno contrario all'ipotesi» registrato nel documento era un artefatto della baseline:
vedi **§5-septies**. Il segno corretto **conferma** l'ipotesi.

**Instabili**: R2 · R4 (7.89 su Serie A) · R4b · R5 · R6 · R12 · R12b · R14 · R14b · R16 · R16b. Per queste
la bocciatura ha ora due motivi indipendenti, non uno.

**R5b** è coerente col suo verdetto in entrambi i versi: stabile su Serie A (0.28) dove passa formalmente,
instabile su euro (0.50, esattamente sulla soglia) dove fallisce.

## 5-septies. Un coefficiente senza la sua baseline non è un fatto (28 luglio 2026)

Trovato provando a riformulare R11 «con l'etichetta giusta»: il documento registrava λ **+0.008 / +0.010**
e ne ricavava «più arrivi nel tuo ruolo, **più** presenze, quindi il meccanismo dichiarato è falso». La
misura di oggi dà **−0.0104 / −0.0100**. Stessa magnitudine, segno opposto.

**Causa, provata al decimale.** Il fit **a due passate** (commit `c1a645b`) ha cambiato la baseline contro
cui si misurano i residui: prima era B0, ora è la quota che producono le regole share-replacing attive
(R3/R3c/R7/R13/R0c). Rifittando R11 contro B0 oggi si ottiene **+0.0080 / +0.0096** — cioè esattamente i
numeri del documento. Contro la baseline corretta: −0.0104 / −0.0100.

Non riguarda solo R11. **R10 si inverte del tutto**: livello +0.129 → **−0.134**, interazione −0.136 →
**+0.179**. Ogni coefficiente citato dal blocco dei residui (R10, R11, R11b, R4b, R14, R14b) è
**dipendente dalla baseline**, e i valori registrati prima del fit a due passate sono vecchi.

**Conseguenze:**
1. **R11 conferma la propria ipotesi.** Segno negativo, stabile su 10 finestre su 10 (dispersione 0.17) e
   su 5 su 5 in euro. Cade sull'errore, non sul meccanismo — che è una situazione diversa e più sana.
2. La ri-pre-registrazione come «sottostima da rifacimento rosa» **decade**: nasceva dal segno sbagliato.
3. Il tentativo di «riformulare R11 per quello che misura davvero» **non serve più**: misurava già quello
   che diceva di misurare.

**Presidio messo, non un promemoria**: `fit_params` scrive ora la baseline in `notes["residual_baseline"]`
su ogni fit, quindi il report del gate porta con sé la provenienza e una citazione vecchia è
*rilevabile* invece di dover essere ricordata. Regola: **un coefficiente citato senza dire contro quale
baseline è stato fittato non è un fatto.**

Nota di metodo: è la terza volta in due giorni che leggere il coefficiente cambia una conclusione (il segno
di R16b, la stabilità di R15, questa). E questa è la più istruttiva, perché l'errore non era in una misura
nuova: era in un numero che stava nel documento da un giorno e mezzo, con un'interpretazione sopra.

## 5-octies. Audit di tutti i coefficienti citati (28 luglio 2026) — **5 su 12 si riproducono**

Dopo R11 e R10 la domanda era quanti altri numeri del documento fossero vecchi. Metodo: per ogni
coefficiente citato, provare a riprodurlo con **ogni** combinazione plausibile di piattaforma (euro /
Serie A) e baseline dei residui (due passate / contro B0), tolleranza 0.006. Se una combinazione lo
riproduce, si scopre anche *quale configurazione* l'ha prodotto — cosa che il documento in gran parte non
dice. Se nessuna lo riproduce, il numero è vecchio.

| citato | valore nel doc (T1/T2) | riprodotto da |
|---|---|---|
| **R5** | +0.023 / +0.073 | euro ✅ |
| **R4b** | −0.014 / −0.014 | euro ✅ |
| **R14** | +0.011 / +0.001 | euro ✅ |
| **R11** | +0.008 / +0.010 | **solo Serie A contro B0** → pre-due-passate (§5-septies) |
| **R11b** | +0.012 / −0.001 | **solo euro contro B0** → pre-due-passate |
| R2 | −0.003 / −0.014 · poi +0.028 / +0.021 | nessuna · oggi euro +0.016/−0.002, Serie A +0.033/+0.010 |
| R6 | +0.332 / −0.222 | nessuna · oggi euro +0.372/−0.186, Serie A −0.331/−0.122 |
| R12 | −0.003 / +0.010 | nessuna · oggi euro +0.008/+0.016 |
| R12b | −0.040 / −0.076 | nessuna (T2 combacia, T1 no) · oggi euro −0.029/−0.075 |
| R13b | −0.454 / +0.05 | nessuna · oggi euro −0.063/−0.100 — **un ordine di grandezza** di differenza |
| R14b | +0.044 / −0.044 | nessuna · oggi euro +0.056/−0.074 |

### Come leggerlo: la deriva NON è un errore, la mancanza di provenienza sì

I coefficienti **devono** cambiare quando i dati migliorano, e il 27/07 sono cambiati molto (layer
per-partita completato, `arrivals` ricalcolati, Qt.I corretto al posto di Qt.A, gerarchia rigoristi da 22-29
a 1463 righe). Un numero che deriva non è sbagliato: è vecchio. Il difetto è che il documento li presentava
come **fatti fissi senza provenienza** — né piattaforma, né baseline, né data — e senza quella un numero non
è verificabile.

**Cosa l'audit ha cambiato davvero**, oltre ai numeri:
1. **Due interpretazioni si scoprono dipendenti dalla piattaforma**, e il documento non diceva quale.
   R2 «il segno ora è giusto e stabile» vale **su Serie A**, non su euro (dove ancora si inverte). R6
   «segno opposto» vale **su euro**, non su Serie A (dove è stabile e negativo). Due conclusioni scritte al
   singolare su una dimensione che il progetto tratta come di primo livello.
2. **Il ragionamento di R1b regge**: δ_cross −0.057/+0.134 mantiene i segni opposti e δ_intra
   (0.060/0.300) resta **più grande** di |δ_cross|, che era il criterio di falsificazione scritto in
   pre-registrazione. Numeri derivati, conclusione intatta.
3. **R13b perde un ordine di grandezza** (−0.454 → −0.063): la sua bocciatura regge (su Serie A il segno si
   inverte ancora) ma il numero non è citabile.

### Convenzione adottata

> **Un coefficiente citato senza piattaforma, baseline dei residui e data non è un fatto.** Il report del
> gate porta ora tutti e tre: `platform` nel risultato, `notes["residual_baseline"]` in ogni fit,
> `generated_at` nel report. Chi cita un λ in un documento copia anche quelli, oppure scrive «vedi il
> report» e non il numero.

## 5-nonies. FAMIGLIA FORZA-CLUB: CHIUSA (decisione del 28 luglio 2026)

Decisione dell'utente, presa ad alta voce come richiedeva. R5 e R5b restano in `CANDIDATES` perché il gate
deve poterle ri-valutare, **non** perché siano proposte vive. **Una quinta misura di «questo club è forte,
quindi alza la sua fantamedia» non è un'ipotesi nuova.**

### I quattro tentativi

| | misura | esito |
|---|---|---|
| 1 | forza-club interna statica (residui FM retrospettivi) | respinta — «la cura non può essere retrospettiva» (`ancore-lega-forzaclub-fase3_1.md`) |
| 2 | Elo additivo per il movimento | respinta (`clubelo-gate.md`) |
| 3 | **R5** Elo del club alla data d'asta | respinta, λ +0.023 / +0.073 — segno giusto su entrambe, T1 peggiora sempre |
| 4 | **R5b** forza offensiva dagli xA | non adottata: passa 3/3 su Serie A, fallisce su euro, e solo sulle tre finestre da cui l'ipotesi è stata letta |

**Il segno è stato giusto tutte e quattro le volte.** L'intuizione Kane è corretta e non è questo il punto
in discussione.

### Perché cadono, ed è la stessa ragione di altre due famiglie

**Il regressore non è incrementale.** La fm_prec di Kane, 9.34, **contiene già il Bayern**: un termine
forza-club aggiunto sopra ricalcola ciò che il baseline porta già. È identico a R14 (uno stop è già dentro
`share_prec`) e a R16 (la sua quota dei gol del club è già dentro la sua fantamedia). **Un'ipotesi il cui
input è derivabile dalla storia del giocatore stesso va attesa come fallimentare, qualunque sia il
meccanismo dichiarato.** Vale come predittore per le ipotesi future, non solo come autopsia.

### Il costo che accettiamo, misurato

Kane su T2: fm_prec **9.34** → àncora 7.47 → previsto **8.25** → **reale 10.60**. Errore **+2.35**, il più
grande che il motore fa su un singolo giocatore, e resta senza spiegazione per questa via.

Ma la **direzione** del residuo dice che la via era sbagliata: il motore l'ha regredito **in giù** (9.34 →
8.25) e lui è andato **in su**. Il problema non è un termine club che manca, è che **beta comprime troppo**
un giocatore il cui livello è genuinamente quello. Quello è un meccanismo **diverso** — beta non costante — e
sta già fra le pre-registrazioni («beta attacco alto / difesa bassa»). La chiusura di questa famiglia non
chiude il caso Kane: lo sposta sull'unica via che non ricalcola la sua stessa storia.

### Cosa la riaprirebbe legittimamente

Una misura di club **ortogonale alla storia del giocatore**: prospettica, e non derivabile dai risultati che
hanno prodotto la sua fantamedia. Qualità dei colpi di mercato confermati · resa offensiva storica di un
allenatore nuovo · quote di mercato pre-stagione. **Un'altra misura retrospettiva della forza passata del
club non è un'ipotesi nuova, è la quinta corsa a questa.**

## 5-decies. R15 e R3d: due modi di NON entrare, e un buco nei criteri (28 luglio 2026)

L'utente aveva autorizzato l'adozione di R15 su euro. **Non è stata adottata, e nemmeno R3d che l'ha
sostituita.** Entrambe le volte la ragione è che avevo misurato una quantità *adiacente* alla decisione
invece della decisione — due errori miei, non due scoperte.

### R15: la riga del gate era da sola contro B0

R15 e R3c occupano lo **stesso ramo** share-replacing e R3c viene valutata prima. Dentro il set adottato,
R15 scatta per **7 giocatori su 657 su T2** — R3c ne copre 650. La configurazione `R0c+R3c+R15` non guadagna
niente sulle finestre recenti e **costa un nome su T0**. I numeri che avevo citato (−0.7% su T2) erano di
R15 **da sola contro B0**: il gate valuta una candidata alla volta, non sopra il set adottato.

> **Regola**: la riga di gate di una candidata non è il suo valore dentro un set. Il set va valutato come set.

### R3d: passa il gate di accuratezza e **peggiora le liste d'asta**

Costruita come la via che il segnale meriterebbe: una regressione sola con **entrambi** i regressori
(minuti sulle giornate euro *e* pattern di presenze), così i due segnali si sommano invece di darsi il turno.
Il segnale c'era davvero — la persistenza porta informazione che il residuo di R0 ancora contiene, ρ da
**+0.077 a +0.097 su tutte e cinque** le finestre euro, con `share_prec` che non cede peso (+0.02..+0.03,
sempre nello stesso verso) e i due regressori **negativamente** correlati (−0.13..−0.34): la persistenza
*suddivide* le classi di `share_prec` (titolare stabile / regolare di rotazione / titolare fermato / margini).

E **passa**: pv MAE da −1.3% a −3.2% sui giocatori che muove, su tutte e quattro le finestre misurabili,
coefficiente stabile (dispersione 0.31), FM e VALORE non peggiori.

Ma sul **deliverable d'asta** (12 ruoli Mantra) i nomi in comune fanno **157 → 151** su cinque finestre, con
**T2 che da solo perde quattro** (36 → 32), e il VALORE catturato scende su tre finestre su cinque.

### Il buco nei criteri, che R3d è la prima a esporre

`passes` per una regola di **accuratezza** è «bersaglio migliorato su ogni finestra che la misura **e** MAE su
FM/VALORE non peggiori». Il non-danno sui **top-10 è vincolante solo per le regole di COPERTURA**. Quindi una
regola può **passare il gate di accuratezza e degradare la lista che il prodotto consuma davvero**.

Registrato, non corretto in silenzio: estendere il vincolo top-10 alle regole di accuratezza
**ri-esaminerebbe regole già adottate** (R3, R7, R3c), quindi è una decisione da prendere per sé e non come
effetto collaterale di questa. È la voce che resta aperta con la leva più alta.

### Cosa resta vero

Il **meccanismo** di R15/R3d è confermato e non era ovvio: la persistenza non serve perché «la costanza si
ripete» — quello è falso, non si trasferisce fra stagioni (§ sul prerequisito in
`metrica-asta-surplus-v1.md`) — serve perché **legge meglio la stagione di input**. A pari Pv distingue il
titolare interrotto dal giocatore di rotazione. Il nome «persistenza» descrive un meccanismo che non è il suo:
il nome giusto è **lettura del pattern di presenze**.

## 5-undecies. Il non-danno diventa elastico (decisione del 28 luglio 2026)

La guardia tollerava **zero**: un nome perso su una finestra sola la faceva fallire. Troppo rigido — un
peggioramento piccolo può essere la direzione giusta che dà frutti con una modifica successiva. Ora:

- si legge sull'**aggregato** delle finestre che misurano, non per finestra (i conteggi per finestra sono
  26-36 nomi, quindi una percentuale là fallirebbe su un nome solo: 36 → 35 è −2.8%);
- la soglia è **2%**, deliberatamente **lo stesso `MAX_WINDOW_LOSS`** che il verdetto robusto già tollera sul
  lato errore, non un numero nuovo inventato per l'occasione;
- ed è ora **vincolante anche per le regole di accuratezza**, non solo per quelle di copertura — che era il
  buco esposto da R3d (§5-decies).

**Nessuna regola adottata viene disarcionata**: euro `R0c+R3c` porta i nomi 121 → 127 (+5.0%), Serie A
`R3+R7+R13` 136 → 149 (+9.6%). La guardia morde su R1 (−3.3%), R5 (−2.9%), R13c (−4.3%), tutte già respinte
per altro.

### Difetto trovato costruendola: il gate misurava i top-10 sui ruoli sbagliati

`evaluate_window` costruisce `by_role` su **`CLASSIC_ROLES` sempre**, anche con `game='mantra'`. Quindi i
conteggi top-10 del gate per mantra erano sui 4 ruoli Classic, mentre il deliverable (`auction_view`) usa i
12 Mantra. La guardia ora legge **`auction_view`**, cioè le stesse liste che il pannello mostra. Le colonne
`top_before`/`top_after` restano come erano per non riscrivere i numeri pubblicati, ma **non decidono più**.

### Resta aperto, ed è la causa comune di due errori di adozione

Il gate valuta ogni candidata **da sola contro B0**. R3d da sola migliora il deliverable (+3.3%) e **sopra
R3c lo peggiora** (157 → 151): entrambe vere, misurano cose diverse. Finché il gate non riporta anche
l'effetto **marginale sopra il set adottato**, ogni proposta di adozione richiede una verifica di
configurazione a mano — che è precisamente il passo che era mancato.

## 5-duodecies. Quattro credenze misurate (29 luglio 2026) — un solo canale, e non è il voto

**Non è un giro di gate**: nessun verdetto cambia, nessuna regola entra. Sono misure **descrittive** su
`platform='default'` (Serie A), 7 stagioni 2019-20→2025-26, **106.977 partite-giocatore**, esiti demeaned
dentro (giocatore, stagione) con la giocatore-stagione come unità d'inferenza. Rapporto completo e limiti:
[turnover-atteso-v1.md](turnover-atteso-v1.md).

Le quattro domande dell'utente sono le credenze standard: riposo corto, «vincere aiuta a vincere»,
l'undici che si conferma dopo una vittoria, la sferzata del nuovo allenatore. **Tutte e quattro hanno un
effetto reale, e in tutte e quattro l'effetto è su CHI GIOCA:**

| credenza | sul rendimento (fantavoto) | sulle scelte (titolarità / undici) |
|---|---|---|
| riposo ≤3 giorni dopo aver giocato ≥60' | **−0,014** (t −0,5); mv −0,001; segno instabile fra stagioni, 2 celle su 7 significative | **P(titolare) −9,8pp** (t −13,3) · **P(voto) −4,4pp** (t −7,8) · **negativo 7 stagioni su 7** |
| dopo una vittoria vs dopo una sconfitta | **−0,046** (t −3,8), −0,032 corretto per l'avversario: segno **ROVESCIATO** rispetto alla credenza, negativo in 5 stagioni su 7 | **+5,0pp / −4,1pp** per chi era titolare, **specchiato** sui panchinari (−4,8 / +4,5); XI confermato **78,2% vs 71,0%**; **7 su 7** |
| mano calda del singolo (⚠️ vedi il punto 4) | eccesso sul null rimescolato **+0,0124** su `default` (+3,4 sd) e **+0,0100** su `euro`: **positiva e minuscola**. Il grezzo (−0,029) è quasi tutto distorsione | un punto di fantavoto in t−1 = **+2,35pp** di titolarità in t |
| raggruppamento nel tempo (permutazione, 300 rimescolamenti) | **gol: zero** su Serie A (1.260 giocatore-stagione, tutte e 4 le statistiche a t≤1,6); **quartile alto di fantavoto: raggruppato** su entrambe le piattaforme (t +2,7…+6,5) ma di taglia irrisoria — +0,014 su un tasso base di 0,408 | — |
| nuovo allenatore (31 cambi in corsa) | rimbalzo grezzo +0,481 ppm, controlli appaiati +0,253 → **netto +0,227 (SE 0,118, t 1,9)**: **53% è ritorno alla media** | conferma **64,4%** dell'undici contro **75,1%** delle settimane normali (t −3,5) = **1,2 maglie** |

Tre cose che questa passata lascia al gate, e valgono più dei singoli numeri:

1. **Il canale è quantificato, non solo argomentato.** In fantapunti attesi per partita, un turno
   infrasettimanale costa **−0,32 dalle presenze e −0,05 dal voto (88% / 12%, ~7×)**. E la cornice:
   **Var(ln pv) è il 90,5% di Var(ln fantapunti totali)** su `default`, 89,9% su `euro`, contro ~2% di
   Var(ln fm) — la stagione **sono** le presenze. Il che spiega a posteriori perché tutto ciò che è entrato
   nel motore (R3, R3c, R7, R13) è una regola di presenze o minuti, e perché R10 cadeva **come regola**
   pur avendo un fenomeno vero dietro: la parte solida era la ridistribuzione dei posti.
2. **Il risultato di una partita di Serie A è derivabile OFFLINE** (difetto di dati chiuso senza rete):
   `goals` è al netto di rigori **e** autogol — `goals + own_goals + pen_scored` pareggia i gol subiti dai
   portieri su **386 giornate su 418** — quindi gol fatti = `SUM(goals)+SUM(pen_scored)`, gol subiti dalle
   righe `role='P'`. Con lo screening severo (bilancio **e** vittorie == sconfitte) restano **278/418
   (66,5%)**, 5.560 club-giornata. Le altre 4 leghe richiedono una richiesta per giornata.
3. **Una sola famiglia, non quattro regole**, e serve un **gate per-giornata che non esiste**: il gate
   attuale giudica un bersaglio stagionale all'asta, quindi niente di questo è adottabile così. Nota il
   confine: «vincere aiuta a vincere» come regressore **d'asta** *è* la famiglia forza-club, CHIUSA in
   §5-nonies sullo stesso difetto (input derivabile dalla fantamedia del giocatore).
4. ⚠️ **Una correzione trovata dentro la stessa passata, e vale come regola di metodo.** La prima stesura
   citava «mano calda `corr(fv t−1, fv t)` = −0,035» come prova di ritorno alla media: era la
   **distorsione di campione finito** di una correlazione ritardata su serie demeaned (−1/(n−1) ≈ −0,044
   con 24 partite), misurata rimescolando le sequenze — null −0,0413, osservato −0,0289. Col null giusto il
   segno **si ribalta**: eccesso +0,0124 (+3,4 sd). **Un'autocorrelazione ritardata dentro un gruppo
   demeaned va confrontata con la sequenza rimescolata, non con zero** — e lo stesso vale per ogni
   statistica «l'evento si ripete?» (bias di Miller–Sanjurjo). Il risultato «dopo una vittoria il fantavoto
   è peggiore» è stato passato allo stesso test e **regge**: null −0,002 contro osservato −0,048, contrasto
   W−L −0,074 contro −0,002 (t −3,4) — lì si condiziona sul risultato **della squadra**, non sul voto suo.

⚠️ Limiti dichiarati: **nessuna partita di coppa o europea nel DB**, quindi il riposo è misurato sul solo
calendario di campionato — il bucket ≤4 giorni è pulito, quello 5+ è contaminato per le squadre europee, e
il bias **sottostima**; l'undici misurato ha **10,3 titolari nominati su 11** (imbuto dell'identità), quindi
il churn è un **limite inferiore**; 31 soli eventi allenatore; **una sola piattaforma**.

## 6. Validazione del voto sintetico (Serie A, dove esistono entrambi i set reali)

**Per partita** (n=10.657): sintetico vs Mv euro (suo bersaglio) MAE **0.365** · vs Mv `default` **0.379**
· **i due voti REALI fra loro 0.208**. Quel 0.208 è il **pavimento**: nessun voto sintetico calibrato su
una piattaforma può avvicinarsi all'altra più di così. Il sintetico sta a 1.8× il pavimento.

**Per stagione** (FM-equivalente vs fantamedia Serie A reale, Pv≥15): giocatori di movimento bias
−0.14 … +0.01 e MAE 0.14-0.25, con **84-91% dei difensori e 85-89% dei centrocampisti entro 0.3** dalla
loro fantamedia vera (attaccanti 67-76%, code più larghe perché dipendono dai bonus).

**Dose-risposta**: MAE 0.063 sotto il 10% di partite sintetiche → 0.148-0.174 fra 10% e 35% → **0.289
sopra il 60%**, e sopra il 60% ci sono quasi solo giocatori fuori perimetro, cioè quelli con le 18
partite difficili (difetto 3). **Il voto sintetico non va ricalibrato: va sistemato da dove prendiamo
le partite.**

## 7. Pre-registrazioni (giugno 2027, finestra 26/27)

- **R17 — attacco affollato** (28/07/2026): la quota reclamata dai compagni SOPRA la capienza di
  attaccanti che il club schiera davvero (K per club dalle XI della stagione di input, su TUTTE le
  righe dei lineup), caricata solo a chi il mercato (Qt.I) ordina sotto quella capienza. Pre-registrata
  in [attacco-affollato-r17-v1.md](attacco-affollato-r17-v1.md) PRIMA di ogni corsa; misurabile già ora
  su 6 finestre Serie A e 4 euro, di cui Tm3/Tm2/Tm1/T0 (Serie A) e Tm3/T0 (euro) tenute PULITE dal
  diagnostico (esiti letti solo su T1/T2). Non sostituisce la voce qui sotto: misura un'altra cosa.
- **Concorrenza posizionale pesata dalla Qt.I dei concorrenti** — un rivale da 21 crediti non è un
  rincalzo da 3. Nasce dai casi Openda/David/Vlahović (la Juventus 25/26 ha preso tre attaccanti sopra
  a Vlahović) ed è la forma che due sole finestre non possono confermare senza autoinganno. Calcolabile
  ora che `price_initial` è nel DB.
- **Famiglia TURNOVER ATTESO dell'undici** (misurata descrittivamente il 29/07/2026,
  [turnover-atteso-v1.md](turnover-atteso-v1.md), §5-duodecies): **una** famiglia con tre input (risultato
  precedente, giorni di riposo, impegni infrasettimanali), bersaglio `P(voto)` e minuti attesi — **mai la
  fantamedia** — e identificazione **within-club**. Non pre-registrabile finché non esiste un **gate
  per-giornata**: il gate attuale giudica un bersaglio stagionale all'asta. Prerequisito di dati: le
  partite di coppa/europee, senza cui la congestione vera non è misurata.
- **R8 solo nel verso «usato più indietro»**, quando il campione supera n≈10/13.
- **R9 àncora con peso di recenza** (l'àncora attaccanti si muove: euro 7.28 → 7.34 → 7.16): con due
  finestre λ è quasi non identificabile.
- **R4b età sulle presenze** e **R2 propensione**, se una terza finestra cambia il quadro.
- Regole del listone di gennaio e `attivita_mercato`: `transfers_history` ha **solo la finestra estiva**
  (una data per stagione), quindi il rischio-cessione invernale non è derivabile da quella fonte.

## 7-bis. Parametri PROVVISORI che il gate deve spazzare (aggiornato 29/07/2026 — **lo sweep è stato eseguito: §7-ter**)

Non sono regole candidate: sono **costanti che esistono perché un modulo aveva bisogno di un numero per
girare**. Sono scelte di MODELLO, quindi valgono la stessa regola di qualunque candidata — nessun gate,
nessun motore — e finché il gate non parla vanno citate come provvisorie e mai come stabilite. Questa è la
lista, con dove vivono e **come è finita**; i numeri di ciascun verdetto stanno in §7-ter.

| parametro | valore oggi | dove | esito dello sweep |
|---|---|---|---|
| decay della gerarchia rigoristi | **0.75** | `modules/fc_site.py` | **CONFERMATO**, dopo che lo sweep ha scoperto che ogni rigore di Serie A era contato due volte |
| quarantena dopo un rigore sbagliato | 0.70 | `modules/fc_site.py` | aperto (rumore: la scelta fuori campione perde) |
| soglie dei tier d'arrivo + età U22 | T1 0.80 / T3 0.40 / 15 partite / U22 | `modules/arrivals.py` | non separabili da questo criterio; `t3_price` è platform-dependent |
| `LOAN_DISCOUNT` | **0.60** | `engine/presence.py` | **aperto e platform-dependent** (euro tira a 0.2, default a 0.8) |
| `ARRIVAL_DISCOUNT` | **0.80** | `engine/presence.py` | **CONFERMATO** (curva ripida: a 0.0 l'errore cresce del 30%) |
| `INJURY_WEIGHTS` | 1.0/0.6/0.35 | `modules/snapshot.py` | forma confermata (le degeneri perdono), inclinazione aperta |
| `AVAILABILITY_FLOOR` | 0.40 | `engine/presence.py` | aperto: l'intera griglia vale 0.6%, sotto il pavimento del gate |
| `STANDING_WEIGHTS` | ~~0.65/0.35~~ **(0, 1)** | `engine/presence.py` | **ADOTTATO**: solo i minuti, strict e robust su tutti e dieci i fold |
| forma di `contested` | assenze **misurate** (v9.11) contro previste (fino alla v9.10) | `engine/presence.py` | **CONFERMATA** la forma nuova, su ogni fold di entrambe le piattaforme |

Due note metodologiche che valgono per tutti e cinque:
- **la forma è confermata, il valore no**: per `INJURY_WEIGHTS` le alternative già calcolate sono
  (1.0, 0.75, 0.5) = 44/33/22% e (1.0, 0.45, 0.2) = 61/27/12% contro il 51/31/18% attuale;
- ~~prima di ritarare `AVAILABILITY_FLOOR` va verificato che Transfermarkt non conti due volte una
  ricaduta~~ **CHIUSA il 29/07/2026 (v9.11)**, e non con una rilettura della fonte ma cambiando l'unità: le
  assenze si **contano** in giornate di campionato del suo club, per data, dentro l'**unione** degli spell
  (`snapshot.rounds_missed`), e un'unione non può contare una giornata due volte qualunque cosa elenchi la
  fonte. L'eccesso della fonte, misurato, **non è duplicazione**: 6489 partite TM contro 4485 giornate
  contate (69%) e, sui club il cui elenco parsato coincide col campionato (gli italiani), 1465 contro 1079 =
  **74% ≈ 38/50**, cioè le coppe e l'Europa che non parsiamo. Rrahmani non è più al pavimento (76%): al
  pavimento lo teneva un denominatore sbagliato — `availability` divideva per le **presenze del giocatore
  stesso**, che si accorciano proprio quando è infortunato — e con le unità giuste i giocatori appiattiti
  sul pavimento passano da **201 su 907 a 9**.

Una TERZA nota, aggiunta il 29/07/2026, che vale come pre-registrazione: la **forma** con cui la storia
infortuni entra in `presence` è cambiata, e il cambio è una scelta di modello che questo sweep deve
giudicare. `contested` (il denominatore del tasso di titolarità) usava la previsione a tre stagioni, la
stessa che `availability` moltiplica: sottrarre e rimoltiplicare la stessa stima **si annulla** quasi
esattamente, quindi lo sweep di `INJURY_WEIGHTS`/`AVAILABILITY_FLOOR` sulla forma vecchia avrebbe spazzato
un parametro che non muove quasi nulla. Ora sono due quantità: assenze **misurate** nella stagione del
campione per il tasso, **previsione** per lo sconto. Le due forme sono entrambe sul tavolo e il gate scelga.

I due sconti sono nati il 29/07/2026 con una differenza **misurata** e non presunta (`desc_at_club_before`,
la storia delle rose): nessuna fonte nostra marca un prestito, quindi la separazione prestito/acquisto non
dipende da un campo mancante. Dettaglio: spec «Novità v9.9».

## 7-ter. LO SWEEP ESEGUITO (29/07/2026) — `python -m euroleghe_ingest sweep`

Il §7-bis era una lista di debiti; questo è il referto. Il comando esiste, è **read-only sul DB** e scrive
`data/reports/sweep_presence.json`; le formule spazzate vivono in **`engine/presence.py`**, estratte dalla
vista Tk perché *un parametro che nessun harness può raggiungere è un parametro che nessuno può spazzare*.

### Il protocollo, che è quello del gate delle regole
- **Gli input sono ricostruiti al giorno d'asta di una finestra già giocata**: gli stessi strati che
  `snapshot` scrive, da stagioni ≤ input e spell datati ≤ data d'asta. Niente qui può vedere la stagione che
  sta prevedendo.
- **Due bersagli, perché i parametri non toccano lo stesso**: le PRESENZE (`pv` sul calendario della
  piattaforma, ciò che una rosa incassa) contro `voto_share`, e le TITOLARITÀ (le giornate del suo
  campionato in cui è partito, dal layer per-partita) contro `presence`. `standing_weights` esiste solo nel
  secondo: spazzarlo sul primo avrebbe stampato una riga piatta e si sarebbe letto «non conta», che è
  un'affermazione sul codice e non sul parametro. Le titolarità reali non stanno nei voti: la colonna
  `started` di `match_ratings` è NULL in ogni stagione, quindi il bersaglio viene da SofaScore.
- **Griglie PRE-REGISTRATE**, un parametro alla volta, **cross-fit leave-one-out** (il valore è scelto sulle
  ALTRE finestre e giudicato su quella tenuta fuori) e i **due verdetti** del gate, strict e robust,
  riportati affiancati. Finestre: solo quelle con input dal **2019-20**, perché prima non esiste il layer
  minuti/titolarità da cui questi input si costruiscono — euro 4, default 6.
- **«Confermato» e «niente trovato» non sono la stessa frase** e il referto le separa: `confirmed` = la
  scelta fuori campione È il valore che sta nel codice, su ogni fold. E poiché per un valore già adottato il
  guadagno è 0 per costruzione, ogni riga porta anche il **margine sul secondo classificato**.

### I verdetti
| parametro | esito | numeri |
|---|---|---|
| `standing_weights` | **ADOTTATO → (0, 1)**, cioè solo i MINUTI | strict **e** robust su **tutti e dieci** i fold (euro 4 + default 6), scelta unanime, guadagno medio **+1.55%** su euro e **+1.32%** su default, fold peggiore **+0.70%**. Curva monotona su tutta la griglia. Non è più provvisorio |
| forma di `contested` | **CONFERMATA** «misurate» (la v9.11) | scelta unanime su 10 fold; margine sul secondo **+1.06%** euro, **+1.24%** default |
| `ARRIVAL_DISCOUNT` | **CONFERMATO 0.80** | unanime su default (margine +0.57%), su euro pareggia con 0.7 (0.22465 vs 0.22470). Curva ripida: a 0.0 l'errore cresce del **30%**, quindi il parametro conta e il valore è giusto |
| decay dei rigoristi | **CONFERMATO 0.75** — dopo aver corretto un bug della fonte, vedi sotto | minimo della curva (0.48784), scelta 0.75 su 5 fold e 0.70 su 2 |
| `LOAN_DISCOUNT` | **APERTO, e PLATFORM-DEPENDENT** | euro tira a 0.2, default a 0.8, con curva piatta in mezzo (euro 0.2235-0.2287 su tutto l'intervallo). 0.60 sta nel mezzo e resta provvisorio |
| `INJURY_WEIGHTS` | **forma confermata, inclinazione aperta** | le due degeneri sono le peggiori su entrambe le piattaforme (solo-ultima-stagione è il valore peggiore in assoluto), quindi le tre stagioni servono; fra 1/0.6/0.35, 1/0.75/0.5 e 1/0.45/0.2 ci sono **0.3%**, e le due piattaforme preferiscono l'una l'opposto dell'altra |
| `AVAILABILITY_FLOOR` | **APERTO** | monotono verso 0.6, ma l'intera griglia (0.0→0.6) vale **0.6%**: sotto il pavimento del gate. Il pavimento riguarda una manciata di cronici, non il foglio |
| quarantena del rigore sbagliato | **APERTO** | 0.5 è marginalmente meglio in pooled (0.48565 vs 0.48784) ma il guadagno fuori campione è **negativo** (−0.65%): rumore |
| soglie dei tier + U22 | **NON SEPARABILI da questo criterio** | `t1_price`, `full_history`, `u22_age` si muovono nella quarta cifra; `full_history` = 15 è il migliore in pooled su entrambe. `t3_price` passa **robust su euro** (0.2, +2.43%) e su default punta nella **direzione opposta** (0.6): quantità platform-dependent, quindi non adottata — riportare il solo passaggio euro sarebbe esattamente l'errore che questo documento si è già fatto una volta |

⚠️ **Limite dichiarato del criterio sui tier**: un tier non prevede nulla da solo, instrada un arrivo verso
un percorso di stima, e la regola che lo consuma (R13c) è ferma per campione. Qui si misura il proxy onesto:
prevedere la fantamedia realizzata dell'arrivo con la **media del suo tier**, con le medie fittate sulle
ALTRE stagioni. Una soglia che taglia dove l'esito cambia davvero vince; una che taglia una popolazione
omogenea non può.

### Il bug che lo sweep ha trovato, e che ha CONFERMATO il valore che sembrava smentito
Alla prima passata `decay` prendeva **0.5** su tutti e sette i fold con guadagno medio +4.25%. Sembrava una
smentita di 0.75, ed era un artefatto: **`fc_site.penalty_events` restituiva ogni rigore di Serie A DUE
volte** — una dalle righe `platform='euro'` e una da quelle `default`, lo stesso calcio sotto due
numerazioni di giornata che traducono alla stessa data. Misurato: **387 tuple (stagione, club, data,
rigorista) su 1675 comparivano più di una volta**, 2089 eventi contro 1745 reali. Con il peso del k-esimo
rigore che decade come `DECAY**k`, una serie raddoppiata applica il decay **due volte per rigore reale**: la
memoria era **metà** per la Serie A che per un club estero, e 0.75 su serie doppia si comporta come 0.56.
E infatti √0.5 = 0.707 ≈ 0.75. Deduplicato per calcio (con il massimo fra le due piattaforme, così una
doppietta nella stessa partita resta doppia), il minimo della curva torna esattamente su **0.75**.
Due cose da tenere: la gerarchia dei rigoristi in `penalty_hierarchy` era distorta per tutti i club
italiani e ora è riscritta (1745 rigori, 312 club-stagione, 3562 righe datate); e uno sweep che *sembra*
smentire una costante può essere il modo in cui un difetto dei dati si fa vedere.

### Cosa questo sweep NON dice
Il foglio non batte il motore sulle presenze: `voto_share` fa MAE 0.2247 su euro contro **0.2163** del
modello presenze gatato (`model.expected_share`) su T2, e vince solo sulle finestre default più vecchie
(Tm3: 0.1941 contro 0.2085). È coerente con quello che la spec dice delle colonne `desc_*` — sono un aiuto
alla lettura, non una previsione adottata — e va detto invece di lasciarlo intendere al contrario.

## 7-quater. L'ipotesi INVESTIMENTO (pre-registrata ed ESEGUITA il 29/07/2026)

Ipotesi dell'utente, nelle sue parole: una società che ha speso su un giocatore **vuole vederlo giocare**
per valorizzare la spesa, e i campioni di richiamo (Modrić, De Bruyne) portano tifosi e blasone, quindi
l'allenatore è incentivato a schierarli e a **perdonare loro qualche brutta partita** — a scapito dei
giovani del vivaio.

### Come è stata resa misurabile (e la misura che ha deciso la forma)
Due canali, **mai fusi**, perché prendono giocatori diversi:
- **`fee_share`** = il suo cartellino come quota di tutto quello che quel club ha speso in quella finestra
  (Isak 145 M su 336 M del Liverpool = 0.43; chi era già lì legge 0). È «relativo alle casse» fin dove i
  dati arrivano: abbiamo quanto un club **ha speso**, mai quanto incassa.
- **`stature`** = il suo percentile di **Qt.I dentro il ruolo**, cioè quanto il mercato lo ritiene
  importante. Esiste perché la misura lo ha imposto: **Modrić e De Bruyne sono arrivati a parametro zero**,
  quindi un indice fatto col solo cartellino dice «nessun investimento» esattamente sui due nomi da cui
  l'ipotesi nasce, mentre il loro Qt.I sta al **77°** e al **94°** percentile dei centrocampisti. Centrato
  in [−1, +1], perché la tesi ha due lati: il big perdonato **e** il giovane che paga.
- **Gli INGAGGI non esistono**: nessuna fonte in whitelist li porta. Sono la misura migliore
  dell'impegno di una società e la loro assenza è un limite di questo test, non un dettaglio.

Due forme pre-registrate: **`standing`** (il lift si somma alla standing di tutti) e **`arrival`** (chiude
parte di ciò che lo sconto d'arrivo aveva tolto — la versione più affilata della tesi: un uomo la cui
stagione è già tutta qui non si può alzare, perché i suoi minuti lo hanno già detto). Bersaglio: le
**titolarità** (le giornate del suo campionato in cui è partito), perché la tesi parla di SELEZIONE.

### Verdetto: NON ADOTTATA, e i pesi restano a zero
| griglia | euro | default |
|---|---|---|
| `fee_weight` sulla standing | monotona **in peggio**: 0.20441 (off) → 0.20643 a 0.30 | 0.21297 → 0.21465 |
| `stature_weight` sulla standing | 0 è il minimo, **entrambe** le direzioni peggiorano: +0.30 costa **12.9%** (0.2013 → 0.22718), −0.10 costa 0.9% | 0.20296 → 0.22229 a +0.30 |
| composita, forma `arrival` | quarta cifra: `arrival:0/0.1` = 0.20134 contro **0.2013** spento | 0.20296 contro 0.20296 (pari) |

Scelta fuori campione: **spento** su ogni fold informativo per i due pesi singoli; sulla composita i tre
fold più recenti scelgono `arrival` con stature 0.1-0.2 (T2 su euro; T0/T1/T2 su default) e i più vecchi
spento — ma il guadagno medio fuori campione è **negativo** (−0.03% euro, −0.07% default). Sotto il
pavimento del gate in ogni caso.

### Cosa questo significa, e cosa no
Non dice che il meccanismo non esista: dice che **è già assorbito dai minuti**. Un club che ha speso fa
giocare l'uomo, e i minuti della stagione passata lo registrano — ed è lo stesso sweep che ha appena
adottato `standing_weights = (0, 1)`, cioè «i minuti sono il miglior predittore di chi parte titolare».
L'investimento non aggiunge nulla **sopra** i minuti. L'unico posto dove ha ancora un segno del verso
previsto è dove i minuti non possono vederlo — un arrivo appena comprato — e lì vale un decimo di quello
che la tesi immagina.
Tre cose da tenere per il futuro: (1) il test è **predittivo, non causale** — non separa «gioca perché lo
hanno pagato» da «lo hanno pagato perché è bravo», e nessun dato che abbiamo lo separa; (2) la tesi del
«perdono per una brutta partita» è per GIORNATA, e il gate per-giornata **non esiste** (§5-duodecies); (3)
il cartellino esiste solo dal 2023 e **non c'è per l'estate 2026** (`transfers` va rilanciato), quindi la
finestra 26/27 è la prima conferma indipendente disponibile.

### Il seguito già pre-registrato: lo stesso test col VALORE DI MERCATO
Il canale `stature` è stato misurato col percentile di **Qt.I**, che è il mercato del *fantacalcio*: prezza
l'utilità fantacalcistica, non il blasone. Il proxy giusto è il **valore di mercato Transfermarkt** — il
mercato del calcio — e sta **già nella cache** (561 pagine rosa, 51 club × 11 stagioni, il valore nell'HTML
come `marktwertverlauf/spieler/<id>">35,00 mln €`), quindi il re-test è **offline**. Abilita anche la
normalizzazione che l'ipotesi chiedeva davvero: il suo valore come **quota del valore della rosa**, cioè
«quanto di questa squadra è lui», disponibile per tutti e non solo per chi è costato un cartellino — e su
**11 stagioni** contro le 3 dei cartellini, quindi nessun fold resta cieco. Griglia e forme: le stesse di
sopra, senza ritoccarle. Gli **ingaggi restano indisponibili**: verificato sulle pagine che scarichiamo,
zero occorrenze di Gehalt/salary/stipendio; le fonti che li stimano sono fuori whitelist.

## 5-terdecies. La punta torre e la punta di movimento (3 agosto 2026) — misurata, NON adottata

Ipotesi dell'utente, con la sua stessa formulazione: «dovresti capire se l'allenatore predilige una punta
centrale agile di movimento (L. Martinez, Boga) o una punta centrale classica forte fisicamente (Hojlund,
Vlahovic) — nella maggior parte dei casi si opta per la punta alta e forte fisicamente che possa fare da
torre o da boa». Descrittiva, nessun giro di gate: quello che segue è una **misura** e una **decisione di
non usarla**.

### Il dato c'era già, e non costa una richiesta
La pagina rosa del provider — la stessa che porta i dodici codici e il piede, una richiesta per club —
porta anche **`height`, `weight`, `dateOfBirth` e `proposedMarketValue`**. Quindi: due colonne nuove in
`player_roles` (migrazione `height`/`weight`), riempite **offline** dalla cache già scaricata, e due colonne
`desc_height`/`desc_weight` nel foglio. Copertura sull'osservazione del 03/08/2026: **953 altezze su 953
righe**, **343 pesi** (il peso alla fonte è più raro). Hojlund 191, Vlahovic 190, Yildiz 187, David 180,
Openda 177, Boga 172, Conceicao 166 — la distinzione dell'utente si vede a occhio, ed è quello che il codice
`ST` non dice: torre e uomo di movimento sono la stessa lettera.
⚠️ Nella stessa pagina c'è anche `proposedMarketValue`, cioè **il proxy che §7-quater aspettava** per
ri-testare l'investimento del club: arriva per giocatore, non solo per chi è costato un cartellino. Nota per
il prossimo giro, non fatto qui.

### La misura: l'allenatore schiera la punta più alta?
Bersaglio: **chi gioca**. Su ogni (club, stagione) dello strato per-partita in cui **due** punte (codice
primario `ST`) hanno almeno **5 partite da titolare** ciascuna, la più usata delle due è la **più alta**:

| | |
|---|---|
| coppie club-stagione | **92** (più 2 pari) |
| la più usata è la più alta | **44 → 48%** |
| per stagione | 19/20 60% · 20/21 **14%** · 21/22 57% · 22/23 50% · 23/24 69% · 24/25 52% · 25/26 **37%** |

**Una monetina**, e instabile fra stagioni nell'ordine di 14%-69%. Anche la media di altezza dice poco: le
punte stanno a **184.6 cm** contro **183.3** di tutti gli altri (n 109 / 775).

### Verdetto e ragione
**Non entra in nessuna scelta**: né nel prezzo di una casella (`_slot_price`), né come spareggio fra due
punte, né in una colonna `engine_*`. Vive nel tooltip della targhetta e nella lista degli alternativi
(`SnapshotView.build`), dove serve a **chi legge** — che è il posto giusto per un fatto vero e non
predittivo.
E la ragione per cui la misura non chiude l'ipotesi, che va detta: quello di cui l'utente parla è **come
gioca** una squadra (cross, duelli aerei, palle lunghe), non **chi schiera**; il canale «chi gioca» è il solo
che i nostri dati vedono, e là il segnale non c'è. I duelli aerei e i cross **non sono** nello strato
per-partita (`external_match_stats` ha tiri, occasioni, key passes, tocchi), quindi l'ipotesi nella sua forma
vera **non è testabile oggi** — ed è dichiarata così invece di essere approssimata con l'altezza del
titolare.

## 8. Casi di regressione (in `model.REGRESSION_CASES`, stampati da `backtest --cases`)

Lewandowski (età/minuti) · Wirtz (cambio lega) · Torres F. (propensione per-90) · Ezzalzouli (nuovo nel
perimetro) · Bremer (infortunio) · Baumgartner (cambio di regime) · Dimarco (bonus, non persistenza) ·
Kane (ambiente club dominante: **8.28 previsto, 10.60 reale**, l'errore singolo più grande) · **Openda,
David, Vlahović** (attesa alta, resa bassa: VALORE previsto 189/200/151 contro 68/145/108 reali; per
Openda l'errore è quasi tutto presenze, 25.8 previste contro 12).

Una regola che migliora il MAE aggregato senza muovere i casi che l'hanno motivata va guardata con
sospetto.

## 9. Contaminazione dichiarata

Le regole R1-R4 e R7-R12 sono state **generate guardando gli esiti del 25/26**: T2 è finestra di
generazione dell'ipotesi, non di conferma indipendente. Il cross-fit protegge dall'overfitting dei
*parametri*, non dalla selezione delle *ipotesi*. La conferma pulita è la finestra 26/27.

## 10. Commit

`d572644` gate delle candidate (3 su 7) · `3a212b0` R3c passa, R6/R8 no · `9b3b3f9` fix FM-equivalente
portieri · `c733096` R10 passa, R5 ri-bocciata, R11 falsificata · `2087519` quotazione d'asta (Qt.I) e
tier corretti · `c1a645b` code review: i due criteri irrigiditi (copertura batte il banale,
accuratezza sui giocatori spostati) + cache di `recent_form`, migrazione additiva dello schema, fit a
due passate · `1c8a0ec` una sola standardizzazione, previsioni calcolate una volta ·
`86e937e` `backtest --auction` e il VALORE catturato · `12841ea` due finestre indietro + cross-fit
generalizzato · `2d9da9e` una finestra senza voti non e' una finestra · `b211dc3` R4 cade, R7 con riserva ·
`1dc8231` finestre fino al 18/19 + verdetto robusto · `32c4e7a` tutto l'archivio: 7 finestre Serie A e
R7 era uno stimatore sbagliato · `072542d` tab Auction · `cb23192` il Mantra si gioca anche in Serie A ·
`bf2f68b` audit dei dati: due input erano solo non ricalcolati, R10 cade · `e50080a` la passata eseguita:
10 finestre Serie A, 5 euro · `a7f0cfd` layer per-partita arrivato · `eecf11f` sigla squadra + spinner ·
`2d2a5c7` tooltip sulle intestazioni · `d0d48ff` filtri bloccati durante il calcolo ·
`34aacd6` **metrica SURPLUS** (+ livello di rimpiazzo dai tetti misurati, beccabilità, soglia) ·
`7e8baab` R15 quasi / R16-R16b bocciate / lo zero fabbricato di `recent_form` ·
`060ad02` `--bonuses-only` · `34afd86` journal SQLite fuori dal tracking ·
`a20c84d` l'identità risolta si salva · `890531c` R13c · `4da22c7` il segno di R16b è forza-club ·
`748ac30` R5b: passa su Serie A e **non** viene adottata · `4fce6d1` consolidamento della KB ·
`ec21450` stabilità del coefficiente · `c0ff3d0` un coefficiente senza baseline non è un fatto ·
`fe3269f` audit dei coefficienti citati · `7d785c7` pre-registrazione beccabilità per-giocatore ·
`ae6b533` beccabilità per-giocatore archiviata sul prerequisito · `b65d532` **famiglia forza-club chiusa** ·
`e63174c` R15 e R3d restano fuori, e il buco nei criteri · `2f80247` **non-danno elastico**.
**158 test verdi, ruff pulito.** Toolkit a **v0.2.0**.

⚠️ **La passata del 29/07 (§5-duodecies, [turnover-atteso-v1.md](turnover-atteso-v1.md)) è entrata in
`b950afe`**, un commit il cui messaggio parla di GUI e snapshot: i doc ci sono, il messaggio non li nomina.
Chi cerca «quattro credenze misurate» nella storia dei commit non la trova per titolo — cercarla per file.
