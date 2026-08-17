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

> **Chiuso il 07/08/2026, e il ritardo è la lezione.** Il difetto era *diagnosticato* qui da undici giorni
> e il codice continuava a dichiarare il contrario: il docstring di `elo.py` elencava i portieri fra gli
> usi **validati** dell'Elo, e con loro il coefficiente club-a-club degli arrivi (task 3.2), che
> `arrivals.py` non ha mai implementato. Due affermazioni false in testa al modulo che le smentisce.
> Corretti `elo.py`, `model.py` (il nome M2e resta, con scritto perché), il tooltip della GUI, la
> `TableSpec` dell'export, il test, la spec, i due README, `stato-progetto-continuita`, la todolist,
> `clubelo-gate.md` e §21.5 di `assistente-asta-v1.md`. La regola generale: **una verifica che smentisce
> un commento non è finita finché il commento non lo dice** — scriverlo solo nel gate lascia in giro la
> versione sbagliata proprio dove la leggerà chi tocca il modulo.

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
| `club_elo` alle date d'asta vecchie | **solo** R5, famiglia già bocciata tre volte. Non serve ai portieri ⚠️ *valutazione del 27/07: il 06/08 nasce **R19**, che legge questa tabella ed è adottata su `default` — la priorità 4 non vale più* | 5 richieste all'API ClubElo (oggi il modulo legge un CSV seed) | 4 - basso valore |
| **`injuries`** | metà dei buchi nelle top-10 dei difensori | nessuna fonte agganciata (piano: Transfermarkt) | 3 - serve una decisione, non una passata |
| storia di `probable_starter`/`availability` | la forma pre-registrata di R7 | **impossibile a posteriori** (esiste solo lo snapshot 2026-07) | — **nessun job**, decisione dell'operatore 05/08/2026: si legge subito prima della sessione, e quella forma di R7 resta non testabile |
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
- **La PRE-SEASON del nuovo allenatore come segnale sulla titolarità** (4/08/2026 — misurata, esposta come
  lettura, **non adottata**). Il dato è nel foglio da oggi (`desc_preseason_starts` / `..._matches`) e sul
  caso che l'utente ha portato sembra decisivo: le due amichevoli di Sarri all'Atalanta le hanno iniziate
  **Gaetano, Samardzic, Scamacca e Raspadori** — i quattro che la previsione pubblicata schiera e che il
  nostro claim lascia fuori — mentre **De Roon, Ederson e Krstovic**, che il board schiera, non ne hanno
  iniziata **nessuna**. Perché non entra, e sono cinque ragioni **misurate**: (1) le amichevoli per-giocatore
  esistono per **una sola** pre-season (1696 righe su 26/27 contro 37 su 25/26), quindi **nessuna finestra
  può giudicarne un'altra** — la regola d'oro di questo progetto; (2) il campione è **1-3 partite** e **due
  dei sette** club di Serie A col coach nuovo non ne hanno nessuna (Milan e Napoli); (3) minuti e rating
  mancano in **1399 righe su 1716**, quindi c'è solo il flag «titolare»; (4) gli avversari sono l'**U23 del
  club stesso** e una squadra di Serie C, dove un undici iniziale non è un'affermazione competitiva; (5) la
  sola fonte esterna che concorda **non è indipendente**, perché ha letto le stesse amichevoli.
  **Pre-registrazione**: a giugno 2027 l'esito di questa stagione esiste, e per la prima volta il segnale
  della pre-season diventa testabile **fuori campione** — bersaglio `P(titolare)` e minuti, mai la
  fantamedia, identificazione within-club, e il confronto è con `standing` (i minuti della stagione prima),
  che è il predittore che lo sweep ha già adottato. Se passa, il posto dove entra è `engine.presence`.
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

## 7-quinquies. L'INVESTIMENTO, terzo canale: il VALORE DI MERCATO (4 agosto 2026) — misurato, NON adottato

Il seguito che §7-quater aveva pre-registrato, e il motivo per cui esisteva: il proxy era il **cartellino**, e
`transfers_history.fee` è NULL per un trasferimento gratuito — quindi diceva «nessun investimento» esattamente
su **Modric e De Bruyne**, i due nomi da cui l'ipotesi dell'utente nasce. Il valore di mercato non ha quel
buco.

### Il dato: storico, datato, e già in cache
Sta nella pagina rosa di Transfermarkt che **già scarichiamo e già parsiamo** (`injuries.parse_squad`, una
colonna in più letta per nome dall'intestazione: «Valore di mercato»), quindi **zero richieste nuove**.
La cosa che lo rende usabile è la **data**: la pagina di una stagione passata porta il valore **di quella
stagione**, non quello di oggi — verificato su undici stagioni di un club, dove lo stesso giocatore legge
225 / 175 / 150 / 100 / 200 mila. Quindi è un fatto di STAGIONE e sta in una tabella nuova,
`market_values(fc_id, season, source, value)`: una finestra legge il valore della stagione **di input** per
prevedere quella **bersaglio**, e leggere quello della bersaglio sarebbe leggere l'esito.
Ingerito offline: **9388 valori, 3180 giocatori, 11 stagioni** (2015-16 → 2025-26; 1248 su 23/24, 1133 su
24/25, 1074 su 25/26, cioè il 75-80% del listone). Nel contratto d'export come tabella `season`.

### La forma misurata
`value_share` = il suo valore **come quota del valore della rosa in cui sta**, entrambi sulla stagione di
input. È lo stesso argomento di `fee_share` — quanto di questo club è lui — con un proxy che esiste anche per
chi è arrivato gratis. **A una sola coda**, come il cartellino: essere una piccola parte di una rosa ricca non
è una prova *contro* un giocatore. Un titolare è per costruzione un undicesimo della sua rosa, quindi la scala
di lavoro è ~0.09.

### Verdetto: NON ADOTTATO, `value_weight` resta 0.0
Sweep pre-registrato del 4/08/2026 (`data/reports/sweep_presence.json`, `generated_at`
2026-08-04T14:43:56+00:00, bersaglio `starts`, griglia 0 → 0.5, leave-one-out cross-fit):

| piattaforma | migliore in pool | scelte per fold | guadagno medio | fold peggiore | strict | robust |
|---|---|---|---|---|---|---|
| **euro** (4 finestre) | **0.0** | 0.0 · 0.0 · 0.0 · 0.05 | −0.02% | −0.07% | no | no |
| **default** (6 finestre) | **0.15** | 0.2 · 0.15 · 0.1 · 0.2 · 0.15 · 0.15 | **+0.08%** | **−0.25%** | no | no |

Va letto per quello che è, e sono due cose diverse a seconda della piattaforma — che è esattamente il tipo di
affermazione che questo progetto vuole non sia data al singolare:
- su **euro** il canale è **piatto**: il migliore in pool è zero, e la curva sale monotona da lì. Niente.
- su **Serie A** c'è un **verso, e unanime**: tutti e sei i fold scelgono un peso **non nullo** (0.10-0.20), la
  curva in pool è una U pulita (0.20296 a zero → **0.20271** a 0.15 → 0.20357 a 0.5) e il fold migliore
  guadagna **+0.49%**. Ma la **taglia** non c'è: guadagno medio **+0.08%**, un ordine di grandezza sotto il
  pavimento dello 0.5%, con due fold negativi (−0.25%, −0.15%).

**Questo è un risultato diverso da quello del cartellino, e la differenza è informativa**: il cartellino
usciva `best pooled 0.0` su entrambe le piattaforme, cioè nemmeno un verso; il valore di mercato ha il verso
e non la taglia. Il proxy migliore ha comprato **il segno**, non l'adozione — ed è la conferma più netta che
si potesse avere della lettura di §7-quater: **il meccanismo è già assorbito dai minuti** (lo stesso sweep
riconferma `standing_weights = (0, 1)`, «chi gioca l'anno prossimo lo dicono i MINUTI»). Un club spende su chi
poi fa giocare, e i minuti dell'anno prima lo hanno già scritto.

**Da non riproporre** nella stessa forma. Cosa la riaprirebbe, dichiarato: gli **ingaggi** (nessuna fonte in
whitelist li porta, ed è la misura migliore dell'impegno di un club), oppure una **variazione** del valore
dentro la stagione — che è un'altra domanda («il mercato ha cambiato idea su di lui»), non questa, e richiede
la serie per data invece di una per stagione.

## 7-sexies. La QUOTAZIONE come ultima risorsa (4 agosto 2026) — decisione dell'utente, misurata

Regola dell'utente, e la sua formulazione: «**utilizziamo la quotazione quando non abbiamo altre risorse
oggettive**, perché non sono affidabili: sono semplicemente il giudizio soggettivo di chi quota».

> ⚠️ **PROVENIENZA, aggiunta il 07/08/2026.** Ogni cifra di questa sezione è stata misurata quando il
> percentile di prezzo si calcolava su un pool che **mescolava i due listoni** — una quotazione EuroLeghe e
> una Serie A nella stessa distribuzione, e le due non sono proporzionali (attaccanti fino a 49 contro 28, i
> difensori al contrario). Dalla v9.33 il pool è quello della piattaforma, e **82 arrivi su 330 del 2026-27
> stanno in una fascia diversa** fra le due: un ri-run darebbe numeri diversi. La CONCLUSIONE non dipende dal
> pool («la strada per far rendere la regola è allargare ciò che è misurato, non tornare alla quotazione»,
> confermata due volte su coperture diverse), le cifre sì. Chi le cita, le citi con questa nota.

### Dove la quotazione entrava ancora, verificato nel codice
Poco, e va detto prima di cambiare qualcosa: **il motore adottato non la legge**. R12 (Qt.I nel ruolo) e R12b
(la revisione anno su anno) sono **falsificate** — 4/10 e 5/10, λ≈0, «l'attesa assoluta del mercato non
aggiunge nulla alla fantamedia precedente: è costruita sulla stessa storia» — e non stanno nei set adottati;
R17 pure. Il **livello di rimpiazzo** (e quindi il SURPLUS) legge la **fantamedia** del rostered marginale più
gli slot della lega: nessun prezzo. `stature` è a peso zero. `arrival_tier` arriva fino a
`features.Observation` ma **nessuna regola lo legge**: lo legge la GUI.
Restava **un** punto vivo: quale percentile **instrada un arrivo** ai tier T1/T2/T3, cioè il ramo che prezza
chi non ha storia misurata.

### Cosa è cambiato
Il driver dei tier diventa **il calcio giocato**: la **FM-equivalente** nella lega da cui arriva
(`foreign_fm_equivalent`, convertita con lo scoring di questa lega), come percentile **dentro il ruolo** —
stessa costruzione del percentile di prezzo che sostituisce, perché un 6.2 è un'affermazione diversa per un
difensore e per un attaccante. La quotazione decide **solo dove quella non esiste**, che è esattamente quando
è l'unica affermazione disponibile su di lui. `TIER_DRIVER = "measured_first"`, e `"price"` resta
raggiungibile perché è ciò che rende questa una decisione e non una preferenza.

### Verdetto: dipende dalla COPERTURA, non dalla scelta
Sweep sui tier, bersaglio «la media del tier separa gli esiti», medie fittate sulle **altre** stagioni:

| piattaforma | migliore in pool | scelte dei fold | esito |
|---|---|---|---|
| **euro** (7 stagioni, 2963 arrivi) | **measured_first** | **7 su 7** measured_first | **CONFIRMED**, margine sul secondo **+0.70%** |
| **default** (10 stagioni, 2842 arrivi) | price | 10 su 10 price | guadagno medio **+0.41%**, peggiore −0.30% → **sotto il pavimento dello 0.5%**, non ribalta |

E la ragione della spaccatura è **misurata, non ipotizzata**: la risorsa oggettiva copre quote diverse.

| stagione | arrivi con FM-equivalente, **euro** | **default** |
|---|---|---|
| 2023-24 | 25% | 14% |
| 2024-25 | **29%** | 18% |
| 2025-26 | 26% | 20% |

Su euro la misura raggiunge quasi il **doppio** dei giocatori e vince all'unanimità; su Serie A ne tocca **1
su 6**, e per gli altri 5 su 6 le due varianti sono **identiche** (entrambe ripiegano sulla quotazione).
Quindi il verdetto «price» su default riguarda un sottoinsieme di ~50 giocatori per stagione, sta sotto il
pavimento che il progetto usa per adottare un cambiamento, e non ribalta il default spedito.

### Il FANTAVALORE come secondo posto, e il difetto dell'harness che ha fatto emergere (4/08, seconda passata)
Osservazione dell'utente: «l'FVM varia ogni settimana o quando ci sono eventi particolari — infortuni,
trasferimenti — utilizziamolo al posto della quotazione quando più opportuno». Due conseguenze, entrambe
applicate.

**È uno stato VOLATILE tenuto come campo statico**, che è contro la regola del progetto (rigoristi, probabili,
infortuni sono serie datate). Stava in `rosters.fvm`, **sovrascritto a ogni scarico del listone**: ogni lettura
di «dov'è adesso» veniva buttata e sostituita dalla successiva. Ora c'è `fvm_history(fc_id, season,
observed_on, fvm, fvm_mantra)`, scritta a ogni ingest del listone. **Non è ricostruibile**: la fonte serve UN
valore archiviato per stagione passata (verificato: si muove di stagione in stagione, Acerbi 17 → 50 → 10), non
le sue settimane — quindi la serie **accumula da oggi**, come i tre fatti-istantanea. E prima del **2022-23**
l'FVM è **0, non NULL**: la «copertura 1395 su 1395» era illusoria, e uno zero non è un fantavalore (escluso,
non messo in fondo alla classifica).

**Come secondo posto nell'ordine dei tier** (calcio giocato → fantavalore → quotazione) il margine su euro
sale da **+0.70% a +0.89%**. Ma la prima corsa dava anche un `robust PASS` alla quotazione su `default`
(+0.51%), e quel verdetto era **un artefatto dell'harness**: lo sweep giudicava i tier su **tutti** gli arrivi
con un esito, mentre un tier instrada soltanto chi **il core non può prezzare** (`predict_fm` esce prima se
esiste una fantamedia su ≥ `MIN_PV_PREV` voti). Corretto — lo sweep ora scora la popolazione che il tier
instrada davvero (2573 euro / 2180 default invece di 2963 / 2842) — e il quadro torna coerente:

| piattaforma | popolazione | migliore in pool | esito |
|---|---|---|---|
| **euro** | 2573 | **measured_first** | **CONFIRMED**, margine **+0.89%**, 7 fold su 7 |
| **default** | 2180 | price | media **+0.42%** → **sotto il pavimento**, robust **no** |

La lezione di metodo vale più del numero: **un parametro va giudicato sulla popolazione su cui agisce.** Il
`robust PASS` della quotazione veniva da uomini il cui tier in produzione non viene mai consultato — quelli
che si spostano dentro il campionato e che il core prezza dalla loro fantamedia. Effetto collaterale
dichiarato: con la popolazione ristretta `t1_price` su euro diventa **non misurabile su nessun fold** (il tier
T1 chiede storia piena *e* percentile alto, raro fra chi il core non prezza), e il report lo dice invece di
tacerlo.

⚠️ **Il collo di bottiglia è la copertura della risorsa oggettiva, non la scelta fra le due.** La strada per
far pagare la regola anche su Serie A è **allargare il misurato** — la Serie B e i campionati che non
copriamo, da cui arriva la maggior parte degli acquisti di Serie A — non tornare alla quotazione. Ed è la
regola dell'utente che funziona come previsto: là la quotazione resta perché **non c'è altro**.
Nota di coerenza: il **ruolo del listone** è anch'esso il giudizio di chi quota, ed è già stato ridotto dove
si poteva (i dodici codici misurati dicono *dove gioca*); ma per *come lo compri* è il gioco stesso a
punteggiare per ruolo, quindi non è riducibile. Come non lo è il **prezzo richiesto** al tavolo: l'asta si
gioca su quello, e vederlo accanto al valore predetto serve a misurare di quanto il mercato sbaglia.

⚠️ **RIMISURATA il 5/08/2026 sera** (`sweep_presence.json`, `generated_at` 2026-08-05T15:38:52+00:00). La
corsa del 4/08 aveva girato su un `mv_synth` **fermo** (il difetto di §7-octies): gli arrivi con FM-equivalente
sono poi passati da 707 a **2128** (2045 + i portieri di §7-decies), quindi la copertura citata sopra era un
**pavimento**. Rifatta sulla popolazione nuova, la decisione **non cambia e il verso è quello che la copertura
prometteva**:

| piattaforma | arrivi instradati | migliore in pool | esito |
|---|---|---|---|
| **euro** | 2573 · 7 stagioni | **measured_first** | **CONFIRMED**, margine **+1.00%** (era +0.89%), 7 fold su 7 |
| **default** | 2180 · 10 stagioni | price | media **+0.32%** (era +0.42%) → **sotto il pavimento**, robust **no**, margine sul secondo **−0.31%** |

Cioè: **più calcio misurato, meno vantaggio alla quotazione** — su Serie A il suo guadagno è scivolato da
+0.42% a +0.32%, sempre sotto il pavimento di 0.5%, e su euro il margine del misurato è cresciuto. È la prima
verifica quantitativa della frase «il collo di bottiglia è la copertura»: la copertura è triplicata e il
divario si è mosso nella direzione prevista, senza che nessuno ritoccasse un parametro.

**Trovato nella stessa corsa, e va scritto perché è un PASS che non si adotta**: `t3_price` su euro prende un
`robust PASS` a **0.20** (media +1.09%, peggior fold −1.05%) — ma 0.20 è il **bordo** della griglia
(0.20…0.60), il margine sul secondo è **negativo** (−0.76%), e su `default` il migliore è **0.60**, cioè il
bordo **opposto**. Due piattaforme che scelgono i due estremi della stessa griglia è come si presenta un
parametro senza segnale, non un parametro da adottare: resta **0.40**, con la stessa regola di §7-septies (un
optimum sul bordo non si adotta al valore del bordo).

## 7-septies. L'INVESTIMENTO in forma CONDIZIONALE (pre-registrata il 5 agosto 2026, non ancora eseguita)

Ipotesi dell'utente, nata su un caso con nome e cognome: «Ratkov è un attaccante su cui la società ha
investito molto, l'ha pagato tanto l'anno scorso. Ma il suo vecchio allenatore (Sarri) ha dichiarato che non
lo avrebbe schierato — questo ha determinato un basso surplus. L'allenatore è cambiato, quindi è molto
probabile che gli dia una nuova chance, anche perché in quel ruolo non ci sono concorrenti.»

### Perché è una TERZA forma e non la riproposizione di §7-quinquies
§7-quater e §7-quinquies hanno misurato l'investimento come **effetto principale**: un lift sommato alla
standing di tutti (`standing`) e un lift che chiude parte dello sconto d'arrivo (`arrival`). Verdetto: niente
su euro, e su Serie A **il verso senza la taglia** (tutti e sei i fold scelgono un peso non nullo, guadagno
medio +0.08% contro un pavimento di 0.5%). La lettura scritta allora è la chiave di questa: «il meccanismo è
**già assorbito dai minuti**». §7-quinquies chiude con «da non riproporre nella stessa forma» e dichiara cosa
la riaprirebbe: gli ingaggi, o una variazione infra-stagionale del valore. **Questa non è nessuna delle due**,
ed è una forma che non è stata misurata: il lift **solo dove i minuti non sono informativi**. Se i minuti
assorbono l'investimento, allora dove i minuti non ci sono l'investimento è l'unica cosa che resta.

### La forma, dichiarata prima della corsa
`investment_shape = "unplayed"`: il lift chiude parte del divario fra quanto ha giocato e una stagione piena,

    standing = misurato + lift × (1 − misurato)

quindi su un titolare non può agire **per costruzione** (a `misurato` = 1 il termine è nullo), ed è massimo
su chi non ha giocato. È la stessa algebra della forma `arrival`, applicata al divario dei MINUTI invece che
a quello della squadra di provenienza.

### DUE BRACCI, mai sommati, con la copertura dichiarata
| braccio | proxy | griglia | fold giudicabili |
|---|---|---|---|
| **A** | `value_share` = valore Transfermarkt / valore della rosa, stagione di input | 0 → 0.5, quella di §7-quinquies **non ritoccata** | 4 euro + 6 default |
| **B** | `fee_share` = cartellino / quanto quel club ha speso in quella finestra | 0 → 0.30, quella di §7-quater **non ritoccata** | **2 su default** (`transfers_history.fee` esiste dal 2023) |

Bersaglio: **`starts`** (le giornate del suo campionato in cui è partito titolare la stagione dopo), perché
la tesi parla di SELEZIONE. Cross-fit leave-one-out, strict e robust affiancati, pavimento 0.5%.

### Quello che è già misurato e va scritto ADESSO, non dopo
Ho guardato i dati prima di scrivere questa sezione, quindi la pre-registrazione serve a impedire che la
forma venga ritagliata su ciò che ho visto. I numeri già in mano:
- la popolazione «investimento alto + pochi minuti, **stesso club**, su 10 finestre»: **7 uomini** con il
  cambio allenatore (guadagno medio **+0.229** di titolarità) contro **27** senza (**+0.292**). Il cambio
  allenatore **non separa** i vincenti dai perdenti, e sui cartellini si vede in faccia: Castro 5%→71%,
  Cajuste 29%→66%, Natan 29%→61% *con* allenatore nuovo, ma anche Cabal 16%→5%, Salah-Eddine 5%→0%,
  Martinez Jo. 13%→13% *con* allenatore nuovo, e Douvikas 16%→66%, Engelhardt 29%→76% *senza*;
- quindi la condizione «allenatore cambiato» **NON entra nella forma**: sarebbe stata la mia tentazione dopo
  aver visto i +0.229, ed è la ragione per cui questa riga è qui. R10 (allenatore nuovo) è già falsificata
  come effetto principale su dieci finestre;
- la condizione «nessun concorrente nel ruolo» **non entra** nemmeno: restringe la popolazione da 34 uomini a
  una manciata, e sotto quella taglia nessun pavimento è raggiungibile. Resta una LETTURA per il tabellone;
- la popolazione che resta (investimento alto + minuti bassi, con o senza allenatore nuovo) è di **34 uomini**
  con mediana **+0.26** di una stagione di titolarità, che è la taglia che questa forma va a cercare.

### I criteri di falsificazione, dichiarati
1. **segno che cambia fra i fold** → non adottata (è il criterio che ha ucciso R1b, e ha funzionato);
2. **guadagno medio sotto il pavimento** dello 0.5% → non adottata, peso a **0.0**, come `fee_weight`,
   `stature_weight` e `value_weight` oggi;
3. giudizio **sulla popolazione su cui il termine agisce** (gli uomini il cui lift è diverso da zero) e non
   su tutti: è la lezione di §7-sexies, dove il tier prendeva un PASS grazie a uomini che non tocca mai;
4. **il braccio B non conferma nulla anche se passa.** Due finestre sono la prova più debole che questo gate
   accetti, ed è lo scenario che ha ucciso R4, R10 e R8 (vive su due, morte su dieci): un PASS su B è
   «sospeso», esattamente come il PASS formale di R5b su Serie A, che **non** è stato adottato;
5. e se A passa su una piattaforma sola, il verdetto si scrive **al plurale** (è la regola di §«citare un
   numero fittato»: una conclusione dipendente dalla piattaforma non si dice al singolare).

### Cosa succede in ogni caso — decisione dell'utente, presa il 5/08/2026
Se muore, **nessun `engine_*` si muove** e il fatto resta sul tabellone come lettura che non decide niente,
nello stesso trattamento del corpo (§5-terdecies) e della pre-season (`snapshot.preseason_starts`): per
Ratkov sono il cartellino (13.0M€ dal Salisburgo, 1/07/2025) contro il valore di mercato (9.0M€), le 2
presenze da titolare del 25/26, l'allenatore nuovo dal 23/06/2026 e il fatto che nel listone 26/27 è
**l'unico 'pc'** della Lazio (Dia e Noslin sono 'a'). Nessuno di questi numeri entra in una previsione
finché il gate non lo dice.

### ESEGUITA il 5 agosto 2026 — verdetti (`data/reports/sweep_presence.json`, `generated_at` 2026-08-04T22:24:38+00:00)

| braccio | piattaforma | migliore in pool | guadagno medio | fold peggiore | strict | robust |
|---|---|---|---|---|---|---|
| **A** valore/rosa | **default** (6 fold) | `unplayed` a **0.5** | **+0.79%** | −0.09% | no | **PASS** |
| **A** valore/rosa | euro (4 fold) | `unplayed` a 0.5 | +0.38% | +0.06% | no | no |
| **B** cartellino | default (3 fold) | **spento** | −0.03% | −0.09% | no | no |
| **B** cartellino | euro (3 fold) | **spento** | +0.00% | +0.00% | no | no |
| **NULL** costante | default (6 fold) | 0.05 | +0.37% | −0.26% | no | no |
| **NULL** costante | euro (4 fold) | 0.03 | +0.30% | −0.17% | no | no |

**Il braccio B è morto** e la sua copertura è nel report invece che in una nota a piè di pagina: i fold
`Tm3/Tm2/Tm1` sono marcati `folds_without_the_feature` su default, cioè il cartellino non esiste lì. Su euro
il migliore in pool è lo SPENTO con `CONFIRMED`. Come pre-registrato, questo braccio non poteva confermare
nulla e ha fatto l'unica cosa informativa che poteva fare: cadere.

**Il braccio A passa robust su Serie A e non su euro** — e va detto al plurale, come la pre-registrazione
imponeva: 5 fold su 6 positivi (+1.46% e +1.25% i migliori, T0 a −0.09% l'unico negativo), guadagno medio
+0.79% sopra il pavimento. Su euro il segno è lo stesso ma la taglia è metà del pavimento.

### Il NULL è la parte che conta, e cambia la lettura
La forma `unplayed` chiude parte del divario fra quanto un uomo ha giocato e una stagione piena — e **un uomo
che ha giocato poco tende a giocare più l'anno dopo chiunque sia**: è ritorno alla media, non investimento.
Quindi il braccio A è stato misurato **contro un lift della stessa forma senza investimento dentro**
(`shrink_weight`, una costante), che è l'unico modo di sapere che cosa ha passato il gate:
- su **Serie A** il valore batte il proprio null di **+0.42 punti percentuali** (+0.79% contro +0.37%), e il
  null **da solo non supera il pavimento**. Quindi lì c'è del segnale che la costante non spiega;
- su **euro** i due sono quasi identici (+0.38% contro +0.30%): quel poco che c'è **è** ritorno alla media,
  che è la stessa conclusione di §7-quinquies («il canale è piatto su euro») con lo strumento giusto.

### NON ADOTTATA, e il motivo non è il verdetto
`value_weight` resta **0.0** e la forma resta `standing`, nonostante il PASS robust su Serie A, per una
ragione che è nel report e non in un'opinione: **ogni fold sceglie il bordo della griglia** (0.5 su 0.5, la
curva è monotona fin lì). Un termine il cui optimum sta *fuori* dalla griglia misurata non si adotta al
valore del bordo — sarebbe scegliere un peso che i dati non hanno mai valutato. E la griglia non si allarga
adesso: ritoccarla dopo aver visto la curva è l'altro modo di fittare, ed è esattamente ciò che la
pre-registrazione vietava.

**Follow-up pre-registrato qui, da eseguire come corsa separata**: (1) griglia estesa oltre 0.5 sul solo
braccio A, dichiarata prima; (2) il canale valore misurato **al netto del null** (la costante accesa al suo
migliore, e il peso del valore sweepato sopra), così quello che si misura è il contributo marginale e non la
somma; (3) e la conferma indipendente resta la finestra **26/27**, l'unica che non ha partecipato a niente.

### Le due griglie del follow-up, scritte il 5 agosto 2026 (sera) PRIMA della corsa
`sweep.GRIDS`, due famiglie nuove e un `BASELINES` che dichiara contro cosa si misura una famiglia:
- **`investment_unplayed_value_wide`** = lo stesso braccio A verso l'alto: **0.50 · 0.75 · 1.00 · 1.50 · 2.00 ·
  3.00**, più lo SPENTO come primo punto. Il tetto ha la stessa ragione del tetto 0.30 del cartellino: un
  titolare vale circa **0.09** del valore della sua rosa, quindi peso 3.0 aggiunge 0.27 di stagione, e oltre
  quello il termine deciderebbe l'undici da solo, che non è la tesi di nessuno. Il braccio cartellino **non**
  si estende: è morto.
- **`investment_unplayed_marginal`** = il canale valore **al netto del suo null**: `shrink_weight` tenuta a
  **0.05** (il miglior null pooled della prima corsa su `default`; euro sceglieva 0.03, che sta dentro un
  passo) e `value_weight` spazzato sopra su **0 · 0.10 · 0.20 · 0.50 · 1.00 · 2.00**. I guadagni di questa
  famiglia si misurano **contro il punto SOLO-NULL** e non contro lo spento, per fold: sottrarre le medie
  pooled di due famiglie darebbe un altro numero, perché i fold non pesano uguale.

**Criteri di falsificazione, dichiarati adesso**:
1. il braccio esteso entra solo se il migliore pooled è **DENTRO** la griglia (non 3.00), con robust PASS e
   margine sul secondo **positivo**. Se il migliore è di nuovo il **bordo**, il canale in questa forma è
   dichiarato non misurabile e la famiglia **si chiude**: due griglie di fila che scelgono il proprio estremo
   sono una curva monotona, cioè un termine che assorbe qualcosa che non è l'investimento;
2. il marginale entra solo se il guadagno **sul null** supera il pavimento **0.5%** sulla maggioranza dei fold
   senza fold peggiore di **−2%**. Se sta sotto il pavimento, la lettura è che ciò che passava era il **null**,
   e va scritta così.

### ESEGUITO il 5 agosto 2026 sera — la FAMIGLIA SI CHIUDE: erano due metà, e nessuna arriva al pavimento
`sweep_presence.json`, `generated_at` 2026-08-05T15:56:25+00:00.

**(1) La griglia estesa risolve l'obiezione del bordo**: l'optimum ora è **DENTRO** il misurato e la curva
gira, su entrambe le piattaforme.

| piattaforma | migliore pooled | la curva pooled | media | peggior fold | robust |
|---|---|---|---|---|---|
| euro (4 fold) | **0.50** | 0.20053 → 0.20059 (0.75) → 0.20091 (1.0) → 0.20498 (3.0) | +0.34% | +0.06% | no |
| **default** (6 fold) | **0.75** | 0.20136 (0.5) → **0.20126** → 0.2015 (1.0) → 0.20617 (3.0) | +0.56% | −0.34% | **PASS** |

Cioè il termine non era monotono fino al bordo: era monotono fino a **0.5-0.75**, e oltre peggiora — a 3.0
costa più che essere spento. La prima corsa non poteva saperlo perché la griglia finiva dove la curva gira.

**(2) E il marginale dice che quel PASS non è l'investimento.** Con il null accesa al suo migliore (0.05) e il
peso del valore spazzato sopra, misurato **per fold contro il punto solo-null**:

| piattaforma | migliore | guadagno marginale sul null | peggior fold | verdetto |
|---|---|---|---|---|
| euro | 0.20 | **+0.045%** | −0.06% | sotto il pavimento (0.5%) |
| default | 0.50 | **+0.41%** | −0.46% | sotto il pavimento |

E i conti tornano, che è la parte che rende la lettura solida invece che comoda: su `default` il **null da
solo** vale +0.37%, il **valore sopra il null** +0.41%, e la loro somma (+0.78%) è esattamente il +0.79% che la
forma grezza aveva ottenuto in robust PASS. **Il PASS era la somma di due effetti entrambi sotto il pavimento**,
e il pavimento esiste per rifiutare esattamente questo. Su euro la stessa decomposizione dà +0.30% di null e
+0.045% di valore: là il canale non c'è affatto.

**NON ADOTTATA e FAMIGLIA CHIUSA sul lato investimento**: `value_weight` resta **0.0**, `shrink_weight` resta
**0.0**. Il criterio 2, che la pre-registrazione chiamava «la parte che conta», non è soddisfatto su nessuna
delle due piattaforme. Quello che resta vero e già scritto altrove: **il meccanismo è assorbito dai minuti**
(§7-quater, §7-quinquies), e quel poco che si vede sopra i minuti è **ritorno alla media**, non «la società ha
investito su di lui».

⚠️ **Un errore mio nella pre-registrazione, e va detto invece che aggirato**: fra i criteri avevo scritto
«margine sul secondo positivo». Quel numero, nel report, è definito come quanto il valore **in uso** batte il
miglior rivale — e per una famiglia il cui valore in uso è **spento**, un margine positivo significherebbe «il
termine non fa niente», cioè la condizione era impossibile da soddisfare per costruzione e non misurava ciò che
volevo. La decisione è stata presa sulle due condizioni che portano informazione (optimum interno, e il
marginale sopra il pavimento): la prima è soddisfatta, la seconda no. Lezione, che vale oltre questa corsa:
**un criterio si scrive prima, ma va anche verificato che sia esprimibile con le metriche che il report
produce** — altrimenti è una frase, non un criterio.

**Cosa lo riaprirebbe, dichiarato**: non un'altra griglia (due corse hanno ormai coperto 0.005 → 3.0). Servirebbe
un proxy dell'investimento che **non sia già nei minuti** — gli **ingaggi**, che nessuna fonte in whitelist
pubblica (verificato: zero occorrenze di Gehalt/salary/stipendio) — oppure la **variazione** del valore dentro la
stagione, che è un'altra domanda e richiede una serie per data. La finestra **26/27** resta l'unica conferma
indipendente possibile, e arriva a giugno 2027.
Nel frattempo, sul tabellone, la lettura per l'asta di agosto (§7-septies, decisione dell'utente).

Nota su ciò che le AMICHEVOLI dicono di questo caso, misurata il 5/08/2026 e riportata qui perché è la
tentazione più vicina: sotto Gattuso, **Ratkov ha giocato 1 delle 2 amichevoli** — e così **Dia (1 su 2)** e
**Noslin (1 su 2)**. Il segnale esiste e **non discrimina**: dice «è nella rotazione», non «è il titolare».
Vale per la pre-season tutto quello che `snapshot.preseason_starts` ha già scritto, e la prima misura fuori
campione possibile resta giugno 2027.

## 7-octies. Il GIOVANE SENZA STORICO: R1 ri-misurata con copertura tripla (5 agosto 2026)

Richiesta dell'utente, sul caso che l'ha generata: «Alajbegovic è un giovane talento che i quotidiani danno
titolare nella Juve. Ho bisogno che calciatori come questi, che non hanno uno storico in Serie A, abbiano
comunque una valutazione attendibile, e non rimanere in attesa che giochi.»

### Tre difetti trovati prima di misurare, e sono di manutenzione
1. **La conversione seguiva il TAG e non la calibrazione.** `synth` fitta la sua retta sull'overlap - le
   cinque leghe che il calendario euro copre - e la applicava a ogni riga `source='sofascore'`: quindi 3756
   righe di **Serie B**, 570 di Championship e 458 di Coppa Italia ricevevano un voto sintetico da una retta
   che non le ha mai viste, mentre le 10 partite di **Bundesliga** recuperate da `recent_form` restavano
   escluse dal tag. Ora l'idoneità è della COMPETIZIONE (`synth.calibrated_competitions`, letta dai dati e
   non elencata a mano): 241.913 partite convertite su 250.678, e le altre restano NULL come il docstring
   del modulo diceva da sempre.
2. **`mv_synth` era fermo.** Nessuno aveva rilanciato `synth` dopo gli ultimi `positions`, quindi l'FM-
   equivalente degli arrivi girava su un input pieno per un terzo: **707 arrivi** con equivalente prima,
   **2045** dopo (T1 da 72 a 271). Il layer arrivi stava lavorando su due terzi di niente.
3. **La catena che lo ha fatto invecchiare è chiusa**: `recent_form` → `synth` → `arrivals` e `ratings` →
   `arrivals` (un listone nuovo è un perimetro nuovo, quindi cambia chi è un arrivo).

### R1 ri-misurata: NON PASSA, e ora su sei finestre
`backtest --gate --platform default`, con l'FM-equivalente triplicato. La copertura sale su ogni finestra
misurabile (T2 0.418 → 0.490, T1 0.424 → 0.502, +33 e +31 giocatori prezzati), e sui giocatori che AGGIUNGE:

| finestra | R1 | àncora di ruolo | verso |
|---|---|---|---|
| Tm3 | 0.337 | **0.333** | peggio |
| Tm2 | 0.336 | **0.320** | peggio |
| Tm1 | **0.370** | 0.419 | meglio |
| T0 | 0.342 | **0.337** | peggio |
| T1 | 0.377 | **0.374** | peggio |
| T2 | 0.486 | **0.432** | peggio |

Verdetto: `coverage up: True · what it adds is not noise: False · beats the trivial answer: False`. È la
stessa conclusione del 27/07 (allora su due finestre e con un terzo dei dati): **la fantamedia di un nuovo
entrato non si predice dal suo FM-equivalente estero meglio di quanto la predica l'àncora di ruolo**. Il
coefficiente era raddoppiato col layer completo (0.186 → 0.431) e non è bastato: la taglia del segnale non
sta nel coefficiente, sta nell'errore sui giocatori che tocca.

### Dove il criterio dell'utente È soddisfatto, e da una regola già adottata
La domanda «quanto vale» si divide in due, e il gate risponde in modo opposto alle due metà:
- **fantamedia**: nessun candidato batte l'àncora. R13c (produzione misurata per 90) vince su una finestra
  (**0.248 contro 0.325** su 9 giocatori) e pareggia sull'altra - il muro di campione già dichiarato;
- **presenze**: **R13 è adottata su Serie A** e prezza esattamente questa popolazione dai suoi minuti
  recenti. Alajbegovic passa da nessuna riga a `engine_fm_pred` **6.245** (l'àncora, dichiarata come tale),
  `engine_pv_pred` **20.2** e `engine_surplus` **4.1** - e la differenza non è una regola nuova, è che le sue
  dieci partite ADESSO esistono nel DB.

### E sul tabellone: `window_standing`, pre-registrato qui
Il pannello leggeva `standing` da una STAGIONE e per lui trovava zero - non basso, assente - mentre il motore
gli prevedeva 20 presenze. Due risposte alla stessa domanda, e quella a schermo la più sbagliata. Ora la
finestra ha il suo denominatore: 693 minuti su 10 partite = 77% del calcio che gli era disponibile, per lo
sconto d'arrivo 0.80 = **0.616**, che concorre per una maglia e non finge una stagione giocata qui.
**Spento nel motore** (`presence.DEFAULTS.window_standing = 0.0`: ogni numero gatato è calcolato così) e
**acceso nel pannello**, dichiarato come scelta di visualizzazione in compagnia di `FORM_WEIGHT` e
`RECENT_PRIOR`. Pre-registrazione per farlo diventare un input del modello: stessa griglia dello sweep delle
presenze, bersaglio `starts`, giudizio **sulla popolazione che tocca** (gli uomini con finestra e senza
stagione), criterio di falsificazione = non batte lo zero attuale su una maggioranza di fold.

## 7-nonies. UNA RETTA PER LE COMPETIZIONI NON CALIBRATE (pre-registrata il 5 agosto 2026)

Richiesta dell'utente, nata dal caso di Daffara: dieci partite di **Serie B** con rating 7.05 e 900 minuti
che **non diventano un voto**, perché la retta di `synth` è fittata sulla sovrapposizione (rating del provider
+ voto reale) e quella sovrapposizione, per la Serie B, è **zero righe**: il gioco non copre la Serie B, quindi
nessuno ha mai pubblicato un voto per quelle partite. La sua fantamedia resta l'àncora dei portieri e il suo
surplus 17.0 viene dalle presenze, non da come para.

### DUE BRACCI, e uno solo dei due è identificato
La misura fatta prima di scrivere questa sezione (5/08/2026) dice dove ciascuna strada è percorribile,
contando gli uomini con almeno 5 partite là e 5 voti reali qui:

| braccio | identificazione | uomini |
|---|---|---|
| **A — dentro la stagione** | stesso giocatore, **stessa stagione**: stessa età, stessa squadra, stesso momento di carriera. Cambia solo la competizione. | Champions **98**, Europa League 44, FA Cup 24, Coppa Italia 17, Conference 14 |
| **B — fra stagioni** | stesso giocatore, stagioni diverse: fra le due è anche cresciuto, ha cambiato squadra e ruolo | Serie B **18**, Eredivisie 15, Pro League 10, Liga Portugal 9, Championship 6 |

Il braccio A è quello ben identificato e **non risolve Daffara**: la Serie B dentro la stagione ha 5 uomini,
troppo pochi. Il braccio B risolve Daffara e porta due distorsioni che non si possono togliere e che quindi
vanno scritte: nel campione entrano **solo i giocatori che qualcuno ha comprato** (sopravvivenza: i riusciti,
quindi lo scostamento stimato è inclinato verso «i voti di quella lega si traducono bene»), e fra le due
stagioni il giocatore **è cambiato** (età, squadra, ruolo), quindi parte di ciò che misuriamo non è la lega.
Con 18 uomini nessuna delle due è testabile: il braccio B è una stima con un'assunzione dichiarata, non una
calibrazione come quella delle cinque leghe.

### La forma, fissata prima
La retta delle cinque leghe **non si ri-fitta**: resta `a_ruolo + b_ruolo × rating` come è. Il solo parametro
nuovo è uno **scostamento per competizione**,

    δ_L = media, sugli uomini eleggibili, di ( suo Mv reale medio QUI − ( a_ruolo + b_ruolo × suo rating medio LÀ ) )

un parametro per competizione e non per ruolo, perché con 18 uomini quattro parametri sono un fit su niente.
Applicato come `mv_synth = a_ruolo + b_ruolo × rating + δ_L` alle sole righe di L, e **solo** dove δ_L è stato
stimato su almeno `MIN_MEN` uomini; le altre competizioni restano NULL come oggi.

### Validazione e criteri di falsificazione, dichiarati
Leave-one-out **sugli uomini**: per ciascuno, δ_L stimato sugli altri e usato per predire il suo Mv qui. Si
riportano tre errori sulla stessa popolazione — con lo scostamento, con la retta **nuda** (quello che
succederebbe applicandola senza correzione) e con l'**àncora di ruolo** (la risposta banale) — e lo
scostamento entra solo se batte **entrambi** sulla maggioranza degli uomini. Se non batte la retta nuda, la
competizione resta non convertita: significherebbe che lo scostamento sta misurando rumore.
Dichiarato in anticipo anche questo: un braccio B che passa **non conferma il meccanismo**, conferma che su
quei 18 uomini lo scostamento ha ridotto l'errore — e la differenza fra le due cose è la sopravvivenza.

### ESEGUITA il 5 agosto 2026 — MISURATA, NON APPLICATA (`APPLY_OFFSETS = False`)

`data/reports/mv_synth_calibration.json`, campo `offsets_measured`. Leave-one-out sugli uomini, contro i due
nulli pre-registrati:

| competizione | uomini | braccio | δ | LOO con δ | retta nuda | àncora | criterio |
|---|---|---|---|---|---|---|---|
| **Champions League** | 98 | dentro la stagione | **+0.123** | 0.2103 | 0.2420 | 0.1938 | **passa** |
| Europa League | 44 | dentro la stagione | +0.026 | 0.2256 | 0.2193 | 0.1480 | no |
| **Serie B** | 25 | fra stagioni | **−0.181** | **0.1631** | 0.2039 | 0.1786 | no |
| FA Cup | 24 | dentro la stagione | −0.084 | 0.2663 | 0.2493 | 0.2234 | no |
| Coppa Italia | 17 | dentro la stagione | +0.087 | 0.2452 | 0.2552 | 0.1090 | no |
| Eredivisie | 15 | fra stagioni | −0.304 | 0.2409 | 0.3229 | 0.1603 | no |
| Conference | 14 | dentro la stagione | +0.033 | 0.1796 | 0.1729 | 0.0764 | no |
| Championship | 11 | fra stagioni | −0.212 | 0.3535 | 0.3844 | 0.1504 | no |
| Pro League 9 · Liga Portugal 8 · Süper Lig 5 · LaLiga2 4 | — | — | — | — | — | — | sotto il minimo di uomini |

**Lo scostamento della Serie B esiste e ha il verso giusto**: δ = **−0.181**, cioè un rating di Serie B vale
circa un quinto di voto in meno di quanto la retta delle cinque leghe dice — ed è la prima volta che
«un 7.0 in Serie B non è un 7.0 in Serie A» è un numero invece di una frase. Con lo scostamento l'errore
leave-one-out scende da 0.2039 a **0.1631**, un 20% in meno: la correzione non è rumore.

**E non basta comunque**, perché il secondo null è quello che conta: **0.1631 contro 0.1786 dell'àncora di
ruolo** per MAE, e sulla maggioranza degli uomini l'àncora vince. Sapere il suo rating in Serie B, corretto,
predice la sua fantamedia in Serie A **peggio** che dire «la media degli uomini come lui». È il terzo muro
identico in un giorno: R1 su sei finestre (§7-octies), R13c sul campione, e ora questo. Il meccanismo che
regge non è «convertiamo il suo voto»: è **quante partite giocherà** (R13, adottata).

⚠️ **Champions passa il criterio pre-registrato e non viene accesa, e i due numeri vanno letti insieme**:
vince sulla maggioranza dei suoi 98 uomini (che è il criterio che ho scritto prima di misurare, e va
onorato) e ha una MAE media **peggiore dell'àncora** (0.2103 contro 0.1938) — quindi vince spesso di poco e
perde raramente di molto, che è esattamente ciò che «quello che aggiunge non è rumore» esiste per fermare.
Nessuno dei due verdetti nasconde l'altro, e la decisione di accendere `APPLY_OFFSETS` resta all'operatore,
con una seconda ragione da mettere sul tavolo: convertire le coppe farebbe entrare partite di coppa
nell'FM-equivalente, che «una quota di stagione è una quota del CAMPIONATO» dice di tenere fuori.

Cosa lo riaprirebbe, dichiarato: più uomini (il braccio dentro-la-stagione cresce da sé ogni anno che
parsiamo), oppure un criterio più severo scritto prima — «batte l'àncora anche in MEDIA» — che oggi
nessuna competizione supererebbe.

### Cosa resta fuori comunque
I **portieri**: anche con un voto convertito, l'FM-equivalente li esclude perché somma gol e assist e non
sottrae mai i gol presi (misurato: +1.06 / +1.08 / +1.12 sopra la fantamedia reale). Quindi Daffara ottiene
un voto base convertito e **non** un FM-equivalente: per lui serve un equivalente calcolato col punteggio dei
portieri, che è un lavoro in `arrivals` e non qui. Va detto adesso perché è il caso che ha generato la
richiesta. → **§7-decies**.

## 7-tervicies. L'ELO PERSONALE, e l'Elo di TUTTE le squadre (misurato il 7 agosto 2026, non adottato)

Idea dell'operatore: **«calcola per ogni calciatore il suo ELO così: ELO squadra × minutaggio, per ogni
squadra nelle ultime 5 stagioni»**, per poi confrontare un acquisto coi compagni di reparto. Misurata due
volte, perché la prima aveva l'Elo del solo perimetro e la seconda — su sua richiesta — di **tutte** le
squadre.

### Il difetto del primo giro, trovato da un numero che non poteva essere vero
Ramos usciva a **1.472**, ultimo fra gli attaccanti del Milan, per uno che ha giocato PSG e Benfica. Causa:
il matcher dei nomi. Togliendo il rumore societario, **«Paris FC» si riduceva al solo token `paris`**, che è
sottoinsieme di «Paris Saint-Germain», e l'appaiamento risultava pure UNIVOCO — quindi tutte le stagioni al
PSG hanno preso l'Elo di una squadra di Ligue 2 (1.405-1.538 invece di 1.970). Due guardie lo chiudono: **un
nome ridotto a un token generico non può coprirne uno di tre** (uccide Paris FC, lascia «Milan» = «AC Milan»
e «Bayern» = «FC Bayern München»), e **le iniziali sono un nome** (`sg` vale «saint germain»). Più una
**validazione su club che sappiamo forti**: 14 su 14 plausibili dopo la correzione, 2 sospetti prima.
La lezione, che è la stessa di §5-quaterdecies un livello più giù: *un appaiamento ambiguo è peggio di uno
mancante*, perché assegna a un uomo la forza della squadra sbagliata invece di lasciarlo vuoto — e l'unica
difesa è **guardare un numero che si sa già**.

### L'Elo di tutte le squadre c'era già, e non era acquisizione
I CSV in cache portano **631 club per anno**; in `club_elo` ne sono finiti **97**, perché `store_snapshot`
tiene solo chi si risolve a un `fc_club_id` — cioè chi è stato in un listone. Leggendo i CSV e prendendo il
club dal **layer per-partita** (non dal listone) entrano Benfica, Ajax, Porto: **92.5% delle righe
per-partita** coperte, contro il 76.7% di partenza.

### Le due varianti dicono cose diverse, e solo una serve
`somma(Elo × minuti)` misura *quanto* calcio d'alto livello ha giocato — quindi rilegge il volume, ed è la
trappola che aveva già affossato l'indice a una stagione (r +0.769 coi minuti stessi). `media pesata` misura
*a che livello* ha giocato. Sul residuo, a parità di minuti: **somma +0.114, media +0.204**.

### Esito
| | r sul residuo |
|---|---:|
| rango per ELO personale, perimetro solo | +0.177 |
| rango per ELO personale, **tutte le squadre** | **+0.204** |

E allargare la copertura non l'ha solo rafforzato: l'ha reso **uniforme**. Per fascia di minuti precedenti:
+0.223 / +0.218 / +0.215 / +0.131 — mentre il salto crolla a +0.067 sui titolari fissi.

**Sul campione comune (660 acquisti dove entrambi si calcolano) i due canali sono pari e METÀ
indipendenti**, il che ribalta la conclusione del primo giro:

| | da solo | tolto l'altro |
|---|---:|---:|
| salto di livello | +0.149 | **+0.074** |
| rango ELO personale | +0.152 | **+0.081** |

correlazione fra i due **+0.621**. Nel primo giro il salto teneva +0.135 e il rango +0.051: con la copertura
piena si equivalgono, e il rango è il più forte nelle fasce alte di minuti — dove il salto non dice niente.
⚠️ I livelli assoluti dei due giri **non sono confrontabili**: il campione comune è un'altra popolazione
(660 contro 1400), perché richiede entrambi i segnali. Confrontabili sono i rapporti.

### Su Ramos, che è il caso che ha generato tutto
Con l'Elo di tutte le squadre è **primo fra gli attaccanti del Milan: 1.884**, sopra Leão 1.820, Gimenez
1.809, Nkunku 1.805. Il segnale dice quello che l'operatore cercava — «lo hanno preso da titolare» — e lo
dice **senza leggere una quotazione**.

### LA VERIFICA SU 20 ACQUISTI VERI LO FALSIFICA — e con essa il metodo che lo aveva promosso

Richiesta dell'operatore: provarlo su venti acquisti veri di Serie A. Sugli acquisti **2025-26**, dove
l'esito si conosce, il canale usato come classificatore dà questo:

| gruppo | n | età media | minuti PRIMA | **minuti DOPO** |
|---|---:|---:|---:|---:|
| dati TITOLARI (rango ≥ 75%) | 33 | 27.8 | 33% | **39%** |
| dati RIEMPI-ROSA (rango < 25%) | 39 | 24.9 | 56% | **38%** |

**Un punto percentuale.** Non discrimina niente. E i casi singoli dicono perché: fra i «titolari» ci sono
**De Bruyne 34%, Belotti 7%, Cuadrado 15%, Morata 27%, Tsimikas 19%**; fra i «riempi-rosa» **Ellertsson 81%,
Marcandalli 76%, Colombo 69%**. Il canale ha trovato *i veterani scesi da grandi club a fine carriera*, non
i titolari.

Misurato invece di intuito: **r(rango, età) = +0.340**, **r(rango, minuti dell'anno dopo) = +0.067** — mentre
il predittore che il modello già usa, i minuti dell'anno prima, fa **+0.322**. Il canale legge l'anagrafe, e
il segnale che dovrebbe aggiungere vale un quinto di quello che c'è già.

### E il difetto di METODO, che è la parte da portarsi via
Il +0.204 non era falso, era **mal costruito**: correlare col RESIDUO di `standing` — un modello il cui input
principale sono i minuti — usando un segnale che correla coi minuti **riproduce la regressione verso la media
del modello stesso**. Il gruppo ad alto Elo aveva giocato **33%** e ha fatto 39% (residuo positivo); quello a
basso Elo aveva giocato **56%** e ha fatto 38% (residuo negativo). La correlazione col residuo è reale ed è
un artefatto. È la stessa trappola del primo tentativo (`minuti × Elo`, r +0.769 coi minuti) tornata
travestita, e le quattro fasce di minuti non bastavano a toglierla.
**La regola che ne esce: un segnale si giudica contro l'ESITO, controllando per ciò che già si sa — non
contro il residuo di un modello che quel «già si sa» lo contiene.** Il residuo va bene per capire dove il
modello sbaglia, non per scegliere chi lo corregge.

**Il SALTO (§7-duovicies) non è toccato da questa critica**, e va detto perché la simmetria conta: lì la
r sul residuo è servita solo a *proporre* il canale, e il verdetto viene dallo **sweep**, che misura la MAE
out-of-sample sull'obiettivo vero, con cross-fit. È esattamente la differenza fra i due, e questa verifica la
rende visibile. L'ELO personale allo sweep non c'è mai arrivato — e alla luce di questa tabella non c'è
motivo di portarcelo.

### CORREZIONE del 7 agosto (sera) — la verifica di sopra era uno strumento troppo debole

L'operatore ha giudicato le classificazioni sui suoi acquisti e le ha trovate buone salvo una: **«Atta è
l'unico errore grossolano, reduce da una grandissima stagione e sarà titolare sicuro»**. Rimisurato come si
deve — **correlazione parziale col minutaggio dell'anno DOPO, controllando per quello dell'anno prima**, su
**601 acquisti di Serie A** invece di 113 di una stagione sola — il canale vale **+0.218**, non il +0.067 che
avevo riportato. Il quartile-split su una fetta annuale con minuti grezzi era un test rumoroso, e la
falsificazione della sezione precedente **va letta con questo davanti**: il difetto di metodo (giudicare
contro il residuo) resta vero e importante, la conclusione «non discrimina niente» era troppo forte.

### Quattro correzioni provate all'indice, quattro fallite — scritte perché nessuno le riprovi
| tentativo | esito (Serie A) |
|---|---|
| termine di RENDIMENTO (rating z per ruolo) | **peggiora**: +0.189 contro +0.218 |
| shrinkage verso un prior fisso (1700) | peggiora: +0.173 contro +0.202 |
| shrinkage verso l'Elo del club che compra | piatta: +0.205 → +0.208, rumore |
| togliere la tendenza per ETÀ | piatta/peggio: +0.191 → +0.183 (la retta è +2.01 Elo per anno, cioè niente) |

### E il miglioramento c'è, ma NON è nell'indice: è nella regola che lo legge
Atta ha giocato il **75%** dei minuti — il modello lo sa già, il suo `claim` è 0.59, il più alto del gruppo
che l'indice bocciava. L'indice serve dove i minuti NON dicono niente; leggerlo da solo è chiedergli di
rispondere anche dove la risposta c'è già. Misurato:

| segnale (Serie A, 644 acquisti) | r col minutaggio dell'anno dopo |
|---|---:|
| minuti dell'anno prima, da soli | +0.286 |
| rango ELO, da solo | +0.109 |
| **0.75 × minuti + 0.25 × rango** | **+0.346** |

**Massimo INTERNO** (+0.329 a 0.15 · **+0.346** a 0.25 · +0.339 a 0.35 · +0.283 a 0.50) — la condizione che
questo progetto pretende. Come classificatore: il rango da solo separa 40% contro 34% (sei punti), la regola
combinata **42% contro 27%** (quindici).
E sistema esattamente i casi che erano sbagliati in entrambe le direzioni: **Atta risale al 10° posto su 48**,
mentre **Valdepenas** (2% di minuti al Real) scende da 100% a 0.27, **Stones** da 100% a 0.39, **Adzic**,
**Venturino** e **Rugani** da 100% a ~0.29. Ramos resta alto (0.55) e Camarda resta ultimo.

Il canale, quindi, **non è un classificatore ma un secondo termine**, ed è la stessa forma di ogni altro
segnale adottato qui: un peso piccolo sopra ciò che i minuti già dicono. In quella forma va allo sweep —
non in quella con cui l'avevo bocciato.

### ESITO DELLO SWEEP (7 agosto 2026, notte) — **il canale è falsificato**, e l'ELO personale resta

Portato allo sweep nella forma che la misura aveva indicato (una MISCELA, `level_rank_weight`), con
l'attribuzione del club fatta **per id** come l'operatore ha preteso:

| piattaforma | ottimo pooled | guadagno medio | peggior fold | pieghe che scelgono 0 | verdetto |
|---|---:|---:|---:|---:|---|
| `euro` (4 fold) | **0.0** | +0.00% | +0.00% | **4 su 4** | CONFIRMED (l'incumbent) |
| `default` (6 fold) | **0.0** | **−0.30%** | −1.10% | 4 su 6 | non passa |

Il cross-fit sceglie **zero**, su euro all'unanimità. `level_rank_weight` resta **0.0**.

**Una corsa precedente dava +0.41% su `default` con ottimo 0.10, e NON si può dire che sia stato il fix
degli id a togliere il segnale**: fra le due corse sono cambiate DUE cose — l'attribuzione (per nome,
dimostrabilmente sbagliata: Paris FC) e la GRANA (per-partita contro per-stagione, cioè cinque leghe e una
riga per competizione). Con due variabili mosse insieme il confronto non attribuisce niente a nessuna delle
due, e dirlo è meno comodo che raccontare che gli id hanno smascherato un artefatto.

**Controprova che la corsa è sana**: `level_gap_weight` non legge l'ELO personale e infatti non si muove di
un decimale fra le due corse — +0.77% robust PASS su `default`, +0.35% su euro. Se fosse cambiato anche lui,
il problema sarebbe stato nell'armonica e non nel canale.

**E l'ELO personale RESTA**, per decisione dell'operatore presa prima del verdetto e indipendente da esso
(«ci potrebbe servire in altri casi comunque»): `external_stats.club_id`, `club_levels_xref`,
`elo.personal_levels`, 2.796 giocatori, 99% dei minuti coperti, 464-535 giocatori rangabili per finestra —
quindi il canale non è stato bocciato per fame di dati. Quello che è falsificato è **usarlo per predire le
presenze**, non averlo.

### Cosa servirebbe prima di poterlo riprendere, dichiarato
1. **Il layer per-partita comincia nel 2019-20**, quindi sulle finestre vecchie la memoria di 5 stagioni è
   più corta e il canale è più debole per costruzione: va misurato nello sweep, dove le pieghe lo vedono.
2. **Otto alias scritti a mano** restano nel matcher (Leverkusen, Brighton, Bilbao, Rennes, Wolves,
   Gladbach, Alaves, Köln). È il rimedio che questo progetto preferisce evitare: se il canale entra, quelli
   vanno in `ELO_ALIASES` con la loro misura accanto, non in uno script.
3. **Non è ancora un braccio dello sweep**: è misurato in-sample, come il salto lo era prima di §7-duovicies.

### RIPRESA — il rango ristretto agli ACQUISTI (pre-registrata il 7 agosto 2026 a tarda notte, PRIMA di eseguirla)

Richiesta dell'operatore: **usare l'ELO personale per giudicare i nuovi acquisti**, così che Ramos, Kolo
Muani e Atta rientrino negli undici titolari. Il canale era stato falsificato poche ore prima, quindi questa
corsa **è una modifica fatta dopo un fallimento** e va dichiarata come tale: la regola di questo progetto è
che *un criterio non si allarga perché una regola l'ha mancato*. Non è quello che accade qui — il criterio,
la griglia e il pavimento restano identici — ma il braccio era **sbagliato**, e lo era per una ragione che il
codice accanto già scriveva.

**Il difetto**: `sweep.build_inputs` calcolava `level_rank` per **ogni** osservazione, chi ha cambiato squadra
e chi no, mentre §7-tervicies l'aveva misurato su **601-644 ACQUISTI**. I due canali gemelli hanno la
restrizione da sempre — `level_z` e `level_gap_z` sono entrambi condizionati a `obs.club_change`, con la
ragione scritta nel codice: «for a man who stayed the term would quietly become *his own club is strong*, a
claim nobody has scored». Per il rango è ancora più netto: per chi non si è mosso «il reparto in cui ENTRA» è
il reparto in cui era già, e la domanda «lo hanno comprato davanti a chi c'era?» non ha senso. È la stessa
famiglia di §7-novies e di `estimate.other_platform`: **una trasformazione appartiene alla popolazione su cui
è stata misurata**.

**La diluizione, misurata prima della corsa** (parziale con la quota di partenze della stagione DOPO,
controllando per la quota di minuti che lo `standing` legge — l'esito, non il residuo):

| popolazione | n | r(rango, esito) | r(minuti, esito) | **parziale r(rango, esito \| minuti)** |
|---|---:|---:|---:|---:|
| `default`, chi CAMBIA | 709 | +0.069 | +0.267 | **+0.169** |
| `default`, chi RESTA | 1683 | +0.042 | +0.568 | **+0.039** |
| `euro`, chi CAMBIA | 783 | +0.009 | +0.287 | **+0.113** |
| `euro`, chi RESTA | 2600 | +0.026 | +0.532 | **+0.025** |

**Tre giocatori su quattro della popolazione swippata non si erano mossi**, e su di loro il canale vale +0.03,
cioè rumore. La corsa che l'ha bocciato mescolava le due cose.

**Cosa è pre-registrato**, e niente di più:
1. **la griglia non si tocca**: `(0.0, 0.10, 0.18, 0.25, 0.32, 0.45)`, 0.0 incumbent, massimo interno atteso
   a 0.25 come la misura indicava;
2. **una sola modifica al braccio**: `level_rank` solo dove `obs.club_change`, esattamente come i due gemelli;
3. **`level_gap_weight` è il CONTROLLO**: non legge l'ELO personale, quindi se si muove da +0.77% / +0.35%
   la corsa non è confrontabile con la precedente e il verdetto è nullo;
4. **dichiarato in anticipo**: il canale agisce ora su ~25% della popolazione scorata, quindi il guadagno
   sulla finestra intera è diluito di quattro volte. Il pavimento dello 0.5% si applica **invariato** — è lo
   stesso che `level_gap_weight` ha superato agendo sulla stessa popolazione, quindi il confronto è alla pari;
5. **cosa un PASS non autorizzerebbe**: applicarlo a chi è rimasto. La restrizione è parte della regola.

### ESITO — **falsificato anche ristretto**, e la diluizione non era la ragione

Due corse, perché fra loro è cambiata **una** cosa sola e quindi l'attribuzione si può fare (a differenza
del caso raccontato sopra): la seconda ha il fix del CALENDARIO D'ORIGINE (difetto B, qui sotto), che agisce
proprio sugli acquisti, cioè sulla popolazione del rango.

| corsa | piattaforma | ottimo pooled | guadagno medio | peggior fold | pieghe che scelgono 0.10 |
|---|---|---:|---:|---:|---:|
| rango ristretto | `default` (6) | 0.0 | −0.03% | −0.13% | 3 su 6 |
| rango ristretto | `euro` (4) | 0.0 | −0.12% | −0.48% | 1 su 4 |
| **+ calendario corretto** | `default` (6) | **0.10** | **+0.03%** | −0.13% | **6 su 6** |
| **+ calendario corretto** | `euro` (4) | 0.0 | −0.13% | −0.50% | 1 su 4 |

**Non passa in nessuna delle due.** La seconda è quella da citare (è lo stato del codice) ed è anche la più
istruttiva: con l'attribuzione del calendario corretta il cross-fit sceglie 0.10 **all'unanimità su Serie A**
e il guadagno è **+0.03%**, un sedicesimo del pavimento — «la pieghetta lo preferisce» e «vale la pena
adottarlo» sono due frasi diverse, e questa è la dimostrazione. Su euro va nella direzione opposta
(−0.13%, peggior fold −0.50%). La curva pooled di `default` è piatta fra 0.0 e 0.10 e poi sale monotona
(0.18 → 0.19624, 0.25 → 0.19775, 0.45 → 0.20562): **nessun minimo interno**, l'ottimo è al bordo.
**Controllo passato**: `level_gap_weight` non si muove — ottimo 0.06 su entrambe le piattaforme, CONFIRMED,
margine sul secondo +0.09% / +0.03% — quindi la corsa è sana e il verdetto è del canale.

E la verifica che il fix non sposta nient'altro, fatta come si deve (**terza corsa**, allo stesso codice di
HEAD, perché fra il report delle 20:29 e questo erano cambiate DUE cose: il mio fix e `level_gap_weight` =
0.06 entrato in `DEFAULTS`, che è la base su cui OGNI altro parametro viene swippato): dei 56
parametro-blocchi, **12 cambiano qualche dettaglio e nessun parametro ADOTTATO cambia verdetto** — e i
cambiamenti sono in maggioranza conferme dell'incumbent a zero (`investment`, `fee_weight`,
`investment_unplayed_value_wide`: `confirmed` da False a True). Un fatto che invece appartiene all'adozione
del salto e non a questo fix, e va scritto perché nessuno lo scopra dopo: con 0.06 in `DEFAULTS` l'ottimo
pooled di tre parametri adottati si sposta (`standing_prior_rounds` 10 → 6, `standing_weights` 0/1 →
0.35/0.65, `level_weight` 0.06 → 0.04) e **in tutti e tre il guadagno out-of-sample dello spostamento è
negativo o sotto un decimo del pavimento** (−0.10%, −0.08%, +0.06%), quindi non si tocca niente. Un ottimo
pooled che deriva non è un parametro da cambiare: è un parametro da guardare al giro dopo.

Quindi la restrizione era **giusta e insufficiente**: il +0.169 di correlazione parziale sugli acquisti è
reale e non si traduce in MAE out-of-sample. La spiegazione più semplice è che quel poco che aggiunge lo
stanno già dicendo due cose adottate — lo **shrinkage** (`standing_prior_rounds` = 10) toglie fiducia
proprio ai campioni corti su cui il rango parlerebbe, e il **salto** (`level_gap_weight`) legge lo stesso
Elo da un'altra parte. `level_rank_weight` resta **0.0** e l'ELO personale resta un dato senza un uso.

### E LA VERIFICA SUL PRODOTTO, che è quella che l'operatore aveva chiesto
La richiesta era «che Ramos, Kolo Muani e Atta rientrino negli 11». Misurata sul foglio 2026-27 di Serie A,
ridisegnando tutte e venti le formazioni tipo:

| arm | Ramos | Kolo Muani | Atta | undici cambiati |
|---|---|---|---|---:|
| incumbent | fuori (claim 0.501) | fuori (0.414) | fuori (0.576) | — |
| rango 0.10 | **DENTRO** (0.571) | fuori (0.426) | fuori (**0.511**) | 4 di 20 |
| rango 0.25 | **DENTRO** (0.674) | fuori (0.443) | fuori (**0.413**) | 5 di 20 |

**Il canale porta dentro solo Ramos, e su Atta va nella direzione opposta**: il suo ELO personale è 1.635,
il PIÙ BASSO fra i centrocampisti della Fiorentina (viene dall'Udinese), quindi la miscela gli TOGLIE
claim — 0.576 → 0.511 → 0.413. È lo stesso uomo che l'operatore aveva indicato come «l'unico errore
grossolano» del canale, e sul prodotto il canale lo peggiora invece di correggerlo. Kolo Muani non si muove
in nessun arm: rango 0.5, mediano fra gli attaccanti della Juventus.

### PERCHÉ ERANO FUORI, che non è il livello — due difetti, e li porta dentro senza l'ELO
Cercando la causa invece del rimedio, i due uomini che il canale non risolveva erano tenuti fuori da altro:

**A. IL CAMPIONE DI DIECI PARTITE ERA IL SOLO ESENTE DALLO SHRINKAGE.** `presence.standing` esce col
`return` nel ramo della finestra, PRIMA dello shrinkage che §7-quaterdecies ha adottato (euro strict E
robust) proprio perché «uno standing costruito su poche giornate non tiene». Risultato: **Oulai** — zero
minuti in archivio, dieci partite in Turchia — legge **0.609** e si prende la terza maglia di centrocampo
della Fiorentina davanti ad **Atta**, che di minuti misurati ne ha **2563** e legge 0.576. Il ramo più corto
che il pannello calcola era l'unico non ridotto. Curato applicando il parametro già adottato **sul campione
della finestra** (dieci partite, non le 38 giornate del suo nuovo club): serve una definizione sola, quindi
`presence.sample_rounds`, letta anche da chi sceglie la FASCIA del prior (`_band_prior`) — altrimenti un uomo con dieci
partite viene archiviato fra i titolari di stagione e tirato verso il prior più alto che c'è.

**B. UNA STAGIONE GIOCATA ALL'ESTERO ERA UNA QUOTA DEL CALENDARIO SBAGLIATO.** I 1320 minuti di Gonçalo
Ramos sono di **Ligue 1, 34 giornate**, e venivano divisi per le **38** del Milan: 0.386 di stagione dove ne
aveva giocata **0.431**, il 12% di se stesso regalato. È «una quota di stagione è una quota del CAMPIONATO»
(v9.11) rotta per esattamente gli uomini per cui era stata scritta, e lo teneva fuori dagli undici per
**0.013** di claim. Curato con `desc_arrival_origin_rounds` (dal layer per-partita, per stagione, quindi non
è una costante che un campionato che cambia taglia romperebbe) letto da `SnapshotView.season_calendar` e
dallo sweep con la stessa regola. Solo per chi ha giocato TUTTA la stagione misurata altrove: chi si muove a
gennaio ha minuti su due calendari e nessun denominatore è giusto per lui.

Misurati sul prodotto, e la tabella è il motivo per cui il rango non entra:

| arm | Ramos | Kolo Muani | Atta | undici cambiati |
|---|---|---|---|---:|
| **A + B** | **DENTRO** (0.530) | fuori (0.414) | **DENTRO** (0.576) | 6 di 20 |
| A + B + rango 0.10 | DENTRO (0.596) | fuori (0.426) | **fuori** (0.511) | 8 di 20 |

Due uomini su tre, senza leggere un Elo personale — e **il rango sopra i due fix ributta fuori Atta**. Il
canale è dominato: non aggiunge nessuno che i due difetti non portino già dentro, e costa l'uomo che era il
caso più netto. **Kolo Muani resta fuori** e la ragione è misurata: i suoi 1670 minuti sono del Tottenham e
la Juve lo aveva già avuto, quindi paga il `loan_discount` = 0.60 mentre David gioca 1795 minuti a Torino
senza sconto. Con `loan_discount` = 0.8 — che è dove lo sweep tira su `default`, ma è un parametro
dichiarato APERTO e piatto fra 0.2 e 0.8 — il suo claim va a 0.506 e resta comunque fuori dai tre davanti.
È una decisione su un parametro, non un difetto, e non è stata presa.

### LA CONTROPROVA CHIESTA DALL'OPERATORE (8 agosto 2026) — il segnale c'è, e non ribalta lo sweep

Richiesta: «vedi nelle stagioni passate i nuovi arrivi, calcolando l'ELO personale per tutta la squadra, e
vedi quali hanno poi giocato più degli altri compagni di reparto». Disegnata come il progetto pretende:
l'esito è **la sua percentile per MINUTI fra i compagni di reparto del club in cui arriva**, l'anno DOPO il
trasferimento — non il residuo di un modello che i minuti li contiene già — il segnale è la sua percentile
per ELO personale nello stesso reparto (calcolato su calcio giocato **prima** della stagione bersaglio), e il
controllo sono i suoi minuti dell'anno prima. 4.083 arrivi con un reparto di almeno tre uomini, 2020-21 →
2025-26.

| segnale | n | r | **parziale (a parità dei suoi minuti)** |
|---|---:|---:|---:|
| rango per ELO personale nel reparto | 1781 | +0.112 | **+0.147** |
| **salto di Elo** (origine − destinazione) | 1271 | +0.162 | **+0.271** |
| sul campione comune: rango | 1271 | +0.119 | +0.203 |

Per ruolo il rango vale **portieri +0.337**, attaccanti +0.166, centrocampo +0.121, difesa +0.110. **Ma per
stagione decade**: +0.195 / +0.180 / +0.282 sulle prime tre, poi **+0.083 / +0.065 / +0.080** sulle ultime
tre — e la memoria dell'ELO personale è *più corta* nelle stagioni vecchie (il layer per-partita comincia nel
2019-20), quindi dove funziona meglio sta probabilmente facendo da proxy al **livello del club di
provenienza**, che è `level_weight` e che è già adottato.

**Cosa conclude e cosa no.** Il segnale sull'ESITO esiste, ed è il SALTO ad averne di più — coerente con
§7-duovicies, che il salto lo ha adottato. Non ribalta lo sweep: quello misura l'errore fuori campione della
previsione su TUTTI, e le due affermazioni sono compatibili — un canale può correlare con l'esito e non
migliorare la previsione, perché ciò che aggiunge lo stanno già dicendo i minuti e il salto. `level_rank_weight`
resta **0.0**.

## 7-quinvicies. Le soglie del REPERTORIO ALLENATORE, rimisurate contro cio' che e' stato schierato (8 agosto 2026)

`COACH_SHAPE_MIN`/`COACH_SHAPE_FULL` = 20/60 erano state tarate su repertori a cui il join per nome toglieva
il 26% degli undici (spec «Novita' v9.38»), quindi i numeri citavano una popolazione che non esiste piu'.
Rimisurate con un giudice INTERNO, che non ha bisogno di una fonte esterna: per ogni club il cui allenatore
e' **arrivato in estate**, si prende la forma modale del CLUB nella stagione precedente e la forma modale
dell'ALLENATORE su tutti i suoi undici precedenti, e si segnano entrambe contro la forma che il club ha
davvero schierato di piu' quella stagione. 95 arrivi estivi con una stagione da giudicare, 48 con un
repertorio.

| campione dei suoi undici | n | forma del CLUB | forma SUA |
|---|---:|---:|---:|
| 10-19 | 6 | **50%** | 17% |
| 20-39 | 8 | **38%** | 25% |
| 40-79 | 17 | **53%** | 47% |
| 80+ | 14 | 57% | 57% |
| **totale** | 48 | **50%** | 42% |

**La forma dell'allenatore non batte MAI l'abitudine del club**, e lo raggiunge solo a 80 undici. Il che non
contraddice il modello - `shape_odds` non la usa da sola, la mette al posto della quota di LEGA e la pesa col
suo campione - ma dice due cose: la ragione della soglia regge (sotto i 20 undici la sua forma e' peggio del
club di 25 punti), e **nessuno deve abbassarla**. Alzarla a 40 sarebbe la direzione che i dati indicano, e le
fasce hanno 6-17 casi: **troppo poco per muovere un parametro**, e dirlo e' meglio che ritoccarlo. Restano
20/60, con questa misura accanto invece dei numeri vecchi.
Cosa la chiuderebbe davvero: segnare la forma BLENDED che il board disegna, non la modale nuda, il che vuole
i fogli storici ricostruiti.

## 7-duovicies. CHI SCENDE DI LIVELLO SALE DI RUOLO — il SALTO di Elo (pre-registrata il 7 agosto 2026, PRIMA di eseguirla)

Domanda dell'operatore, ed è quella giusta: **«cosa differenzia un giocatore acquistato per riempire la rosa
da uno preso per giocare titolare?»** — dopo aver bocciato il candidato ovvio con un argomento che regge:
**il Qt.I non è un valore oggettivo, ingloba già l'opinione dell'autore sulla sua titolarità**, quindi usarlo
per predire la titolarità è in parte circolare. Serve un valore assoluto, da confrontare coi compagni di
reparto. **La quotazione è tenuta fuori da questa pre-registrazione per decisione dell'operatore**, e i numeri
che la riguardano stanno qui sotto solo perché sono stati misurati nello stesso giro e nasconderli sarebbe
peggio che dichiararli.

### La misura che ha prodotto l'ipotesi (in-sample, dichiarata come tale)
Il difetto di partenza è **la regressione verso la media, non abbastanza forte**, e non è un problema degli
acquisti: con `presence.standing` vero, il bias per fascia di minuti dell'anno prima è monotono per tutti —
chi RESTA va da **+0.098** (fascia 0-20%) a **−0.037** (80-100%), chi CAMBIA da **+0.179** a **−0.064**.
L'ampiezza è quasi **doppia per chi cambia club** (0.243 contro 0.135): cambiare squadra rende i minuti
passati meno informativi, ed è lì che serve un secondo segnale.

Il secondo segnale, cercato **a parità di minuti** perché il primo tentativo era stato divorato dal
confondente (l'indice `minuti × Elo` correla +0.769 coi minuti stessi: non è informazione nuova, è la
regressione riscritta):

| segnale | r col residuo | natura |
|---|---:|---|
| **salto di livello** — Elo(club di provenienza) − Elo(club che lo compra) | **+0.220** | oggettivo |
| livello assoluto — Elo del club di provenienza | +0.117 | oggettivo |
| *(percentile Qt.I nel reparto — misurato e messo da parte)* | *+0.227* | *opinione* |

n = 1487 acquisti con entrambi gli Elo, medie pesate su quattro fasce di minuti.

**Il segno è la risposta alla domanda**: salto POSITIVO — viene da un club più forte di quello che lo compra —
significa che il modello lo **sottostima**. *Chi scende di livello sale di ruolo*: era dietro a gente migliore
e adesso non lo è più. E il caso simmetrico, più frequente, è il titolare fisso che SALE di livello e viene
sovrastimato — giocava tutto in un club piccolo e nel club grande siede in panchina. **Il salto batte il
livello assoluto di due volte** (+0.220 contro +0.117): non conta il prestigio di dove veniva, conta la
differenza con dove va — ed è anche il motivo per cui non è R5 sotto mentite spoglie, che leggeva l'Elo di
DESTINAZIONE da solo ed è stata bocciata quattro volte.

### Forma, popolazione, griglia
- **Forma**: `standing += ω × z(elo_prev − elo_dest)`, sopra la catena attuale. Con **ω = 0 è l'incumbent**,
  quindi dentro lo spazio.
- **Popolazione**: chi ha **cambiato club** e ha **entrambi** gli Elo. È la stessa di `level_lift`, e per la
  stessa ragione: per chi resta il salto è zero per costruzione.
- **Griglia**: ω ∈ {0, 0.02, 0.04, 0.06, 0.09, 0.12}, cross-fit leave-one-out, **vincitore interno**.
- **E `level_weight` va spazzato INSIEME**, non tenuto fermo: i due termini condividono `elo_prev`, quindi il
  rischio è contarlo due volte. Se ω vince e `level_weight` scende verso 0, **il salto SOSTITUISCE il
  livello** ed è il risultato più pulito; se restano entrambi positivi, misurano cose diverse e lo si dice.
  Questo è l'unico modo di rimettere in discussione un parametro già adottato senza toglierlo di soppiatto.

### Attesa scritta prima, e il criterio che la uccide
- Guadagno sulla MAE delle presenze fra **0.8% e 2.5%**, ottimo interno fra **0.06 e 0.12**, positivo su
  entrambe le piattaforme. La forchetta è ancorata: `level_weight` = 0.06 valeva +0.93% su Serie A con un r
  parziale di +0.137, e qui il parziale è **1.6 volte** quello.
- **Falsificata se** il cross-fit sceglie ω = 0 sulla maggioranza delle pieghe di una piattaforma, o se la
  media resta sotto il pavimento dello 0.5%. E se vince al **bordo** (0.12) la griglia va riaperta in un
  follow-up pre-registrato, non allargata dopo aver visto la curva.

### Tre cose dichiarate prima, perché non diventino scoperte comode
1. **Ho guardato i dati prima di scegliere la forma.** Le tabelle qui sopra sono in-sample su tutte le
   finestre, con un predittore semplificato (38 giornate fisse, prior unico a 0.33, niente infortuni): la
   FORMA è quello che si porta via, le grandezze no. Lo sweep deve rifarle cross-fit.
2. **Sul foglio VIVO il segnale è azzoppato e non è colpa del modello**: ClubElo è morto, quindi l'Elo di
   destinazione della finestra 2026-27 è quello del **2025-08-15** — una stagione e un mercato fa — o al più
   il 2026-01-14 del mirror. Il gate non ne soffre (usa date storiche, tutte in cache); il tabellone sì. Se
   la regola passa, **il ripiego ClubElo va lanciato prima di crederci sul foglio di oggi.**
3. **Muove il PANNELLO e non il motore**: `presence.py` non è importato da `evaluate`, quindi
   `backtest --verify` resta 22/22. Farla arrivare a `engine_pv_pred` è una regola separata con un gate suo,
   esattamente come è stato per R19.

### ESITO (eseguito il 7 agosto 2026) — **robust PASS su `default`**, sotto il pavimento su `euro`

| piattaforma | ottimo pooled | guadagno medio | peggior fold | strict | robust |
|---|---:|---:|---:|---|---|
| `default` (Serie A, 6 fold) | **0.06** | **+0.77%** | **+0.13%** | no | **PASS** |
| `euro` (4 fold) | **0.06** | +0.35% | −0.07% | no | no (sotto lo 0.5%) |

**Nessun fold peggiora su `default`** — il peggiore è +0.13%, cioè il canale non fa mai danno — e il
cross-fit sceglie **0.06 su tutte e sei le pieghe**, unanime. Su `euro` è positivo in media e il peggior
fold vale −0.07%: non è contro, è piccolo. **L'ottimo è INTERNO** (griglia fino a 0.12) e, cosa che non
era scontata, **è lo stesso 0.06 su entrambe le piattaforme** — quindi un valore unico non è un compromesso
fra due ottimi diversi, è l'ottimo di tutti e due.

**La previsione pre-registrata era giusta sulla forma e ottimista sulla grandezza**, e va detto: avevo
scritto «fra 0.8% e 2.5%, ottimo interno fra 0.06 e 0.12, positivo su entrambe le piattaforme». Reale:
ottimo **0.06** (dentro), positivo su entrambe (giusto), ma **+0.77%**, cioè appena SOTTO la forchetta che
avevo dichiarato. Avevo scalato il guadagno sul rapporto fra i due r parziali (1.6×) e il rapporto non si
trasferisce così.

**E la domanda che il disegno esisteva per rispondere ha una risposta netta: il salto NON assorbe il
livello.** Spazzati insieme, `level_weight` resta al suo **0.06 su euro** e sceglie **0.08 su default** —
non scende a zero. I due termini leggono cose diverse: *da che livello viene* e *quanto scende arrivando
qui*. Se avessi collassato i due in un parametro solo — che era l'alternativa comoda — questo non si
sarebbe potuto vedere.

**Cosa muove**: solo il pannello. `evaluate` non importa `presence`, quindi `engine_*` non cambia e
`backtest --verify` resta 22/22. E il prerequisito dichiarato prima resta in piedi: sul foglio VIVO l'Elo di
destinazione è quello del 2025-08-15, perché ClubElo è morto — **il ripiego va lanciato prima di credere a
questo canale sul foglio di oggi**.

### E come `level_weight` prima di lui, NON salva il caso da cui è nato

Simulato a 0.06 sul foglio del 07/08. Ramos scende di **183 punti Elo** (PSG 1970 → Milan 1787), z **+1.25**,
e il suo claim va **0.444 → 0.519**: supera Gimenez (0.514) e resta dietro a Pulisic 0.548, Leão 0.615 e
Rabiot 0.761. In un 3-4-2-1 i posti avanzati sono tre. **Ramos non entra nell'undici.** È esattamente ciò che
era già successo il 06/08 col canale livello («Ramos guadagna +0.118 di standing... quello che NON fa è
salvare il caso da cui è nato»), e va scritto due volte perché la tentazione di misurare un canale sul caso
che lo ha suggerito è quello che il gate esiste per impedire.

Su tutta la Serie A l'effetto è **chirurgico: 2 club su 20, 3 uomini** — coerente con un +0.77%. L'unico
cambio sul Milan è in difesa ed è **una monetina**: Gila arriva dalla Lazio (1770.6, salto **−17**, z −0.21),
perde **0.012** e scende a 0.660 contro i 0.662 di Tomori. **Due millesimi.** Non è il modello che afferma
qualcosa: è il ballottaggio su cui anche le fonti pubbliche si dividono (DAZN e FantaMaster dicono Gabbia,
Lottomatica dice Tomori, e il foglio euro dice Tomori pure lui). Un cambio deciso da due millesimi va letto
come rumore, e sapere QUALI cambi sono di quel tipo è metà del valore di una simulazione.

E la conclusione utile per l'auction: **per mettere Ramos titolare servirebbe un segnale che dica «lo hanno
comprato per fare il centravanti»**, e i due che lo direbbero sono quello escluso dall'operatore (il Qt.I) e
quello falsificato (la fee). Il salto dice un'altra cosa — «scende di livello» — che è vera, misurata, e vale
+0.075.

### ADOTTATO il 7 agosto 2026 a **0.06**, sul verdetto ROBUST

Decisione dell'operatore, presa in chiaro come il protocollo prevede. È la **seconda adozione senza
`passes`** dopo R19, e va detto in cosa è meno delicata di quella: R19 su euro era **contro** (0 finestre su
5, media −1.1%), questo su euro è **positivo** (media +0.35%, peggior fold −0.07%) e semplicemente sotto il
pavimento; e l'ottimo 0.06 è **lo stesso sulle due piattaforme**, quindi il valore unico non è un compromesso
fra due ottimi diversi. Su Serie A **nessuna finestra peggiora** — il peggior fold è **+0.13%** — e tutte e
sei le pieghe scelgono 0.06.

**`engine_*` non si muove**: `evaluate` non importa `presence`, e `backtest --verify` resta **22/22 su 22
controlli, zero fallimenti** (verificato dopo il cambio, non prima).

**Effetto misurato sui fogli**, A/B a parità di giorno e di codice:

| foglio | righe che si muovono | di cui arrivi | in su | in giù |
|---|---:|---:|---:|---:|
| Serie A (classic) | **107 su 649** | 47 | 33 (media +0.043) | 74 (media −0.018) |
| EuroLeghe (mantra) | **77 su 1031** | 64 | 42 (media +0.042) | 35 (media −0.045) |

E il meccanismo si legge sui nomi, **in entrambe le direzioni**, che è la prova che non è una sforbiciata:
**Esposito Se.** 0.773 → 0.908 (dall'Inter, 1933, al Cagliari: scende di livello e gioca di più),
**Coppola D.** +0.096 e **Romano** +0.091 per la stessa ragione; contro **Cheddira** 0.163 → 0.046 (verso il
Napoli), **Floriani Mussolini** −0.105 (dalla Cremonese alla Lazio) e **Nwaneri** −0.097 (verso l'Arsenal) —
chi sale di livello scende di ruolo.

⚠️ **Un prerequisito operativo che l'adozione non risolve**: sul foglio VIVO l'Elo di destinazione è quello
del **2025-08-15**, perché ClubElo è morto. Il canale è calibrato su date storiche tutte in cache, quindi il
verdetto è sano; ma i numeri che il pannello mostra oggi poggiano su una forza dei club vecchia di una
stagione e un mercato. **Il ripiego va lanciato prima di credere a questa colonna sul foglio di oggi.**

⚠️ **E da tenere d'occhio, dichiarato adesso**: un'adozione sul solo robust è più fragile di una sullo
strict. Se il prossimo sweep la trova peggiorata, esce senza discutere.

### E una direzione dei documenti che questa misura FALSIFICA
`CLAUDE.md` proponeva che il segnale che avrebbe visto Ramos e Kolo Muani fosse **il FEE**. Misurato oggi
sulla popolazione, **non separa**: nella fascia di minuti di Ramos, fee mediana 6.5 M → residuo +0.074, fee
mediana 30 M → +0.058, con esito reale 0.385 contro 0.402. Diciassette millesimi di quota per quattro volte
il prezzo — e la fee esiste solo su **98 casi di 766**. La riga «fix the input before tuning the weight»
resta giusta; l'input che indicava no.

## 7-unvicies. LA QUOTA DI PARTENZE DI CHI HA CAMBIATO CAMPIONATO (pre-registrata il 7 agosto 2026, PRIMA di eseguirla)

Nata da un confronto, non da un'intuizione: l'undici tipo del Milan calcolato dal foglio del 07/08 contro
quello che quattro fonti indipendenti pubblicavano lo stesso giorno. **Dieci uomini su undici coincidono**;
l'unico assente è **Gonçalo Ramos**, comprato per 74 M per fare il centravanti titolare. E il motivo non è che
manchi il dato: la sua `desc_start_share` è **0.433**, che è la sua quota di partenze **al PSG**, dove ruotava.
`eleven()` ordina per quel numero grezzo, e 0.433 perde contro Leão 0.793 e Gimenez 0.688.

**L'ipotesi**: per chi ha cambiato CAMPIONATO, la quota di partenze della stagione precedente misura *un altro
mestiere in un'altra squadra*, quindi è un predittore peggiore della sua quota futura di quanto lo sia per chi
è rimasto — e ristringerla verso l'àncora del suo ruolo migliora la previsione. La forma è la stessa che
`estimate.regress` ha già adottato per la fantamedia, e per la stessa ragione: **deve tirare da entrambe le
parti**, perché il caso simmetrico esiste ed è più frequente di quello che ha generato la domanda — il
titolare fisso di un club piccolo che arriva in un club grande porta una quota ALTA e non giocherà.

### Cosa ho guardato prima di scrivere, e cosa no
Ho visto **le righe di un solo club**: Ramos 0.433 con `engine_unpriced_reason = "no season on this platform"`
ed `est_surplus` 5.0 sull'àncora, Leão 0.793, Gimenez 0.688, Nkunku 0.469, più l'undici disegnato. **Non** ho
guardato nessuna distribuzione storica, nessuna correlazione, nessuna finestra. La pre-registrazione serve a
impedire che la forma della regola venga scelta dopo aver visto quanto rende.

### Forma, popolazione, griglia
- **Forma**: `share_ref = (1 − ω) × share_prev + ω × ancora(ruolo)`, dove l'àncora è la quota media di
  partenze dei giocatori dello stesso `role_classic` nella stagione di destinazione. Con **ω = 0 questa è
  esattamente la catena attuale**, quindi l'incumbent è dentro lo spazio.
- **Popolazione**: **solo chi ha cambiato campionato** (`desc_arrival = transfer_cross_league`). Chi resta
  nella stessa lega tiene il suo denominatore e gran parte del contesto; è una pre-registrazione diversa e non
  si mescola. Questo è anche il punto su cui §7-sexies è già inciampato una volta: **un parametro va giudicato
  sulla popolazione su cui agisce**, e scorare su tutti diluirebbe fino a un +0.00% che non è un PASS.
- **Griglia**: ω ∈ {0.0, 0.15, 0.30, 0.45, 0.60, 0.75}, cross-fit leave-one-out, **e il vincitore deve essere
  INTERNO** — se vince 0.75 la griglia va riaperta in un follow-up pre-registrato e non allargata dopo aver
  visto la curva.
- **Armonica**: `sweep`, non `backtest`. La quantità è una quota di partenze, non la MAE del motore, ed è la
  stessa forma delle pieghe che lo sweep già giudica.

### Il denominatore, da verificare PRIMA di lanciare
Una quota di stagione è una quota del CAMPIONATO, e qui i due campionati sono **diversi per costruzione**: la
Ligue 1 di Ramos ha un calendario suo. Se `desc_start_share` a t−1 non è già normalizzata sulle giornate della
lega di ALLORA, la misura confronta due unità e il risultato è aria. Va controllato prima, e se è rotto si
sistema quello — non si interpreta il numero.

### Attesa scritta prima, e il criterio che la uccide
- Guadagno sulla MAE della quota di partenze, **sulla sola popolazione cross-lega**, fra **0.5% e 2%**, con
  l'ottimo cross-fit fra **0.30 e 0.45**. Positivo su **entrambe** le piattaforme: il meccanismo — il numero
  descrive un altro mestiere — non dipende dal calendario, quindi qui non mi aspetto la divergenza
  euro/default che R19 e R18 hanno mostrato. Se invece diverge, il meccanismo che ho scritto non è quello
  vero e va detto.
- **Falsificata se** il cross-fit sceglie ω = 0.0 sulla maggioranza delle pieghe di una piattaforma, oppure se
  il guadagno medio resta sotto il pavimento dello 0.5%. In quel caso la conclusione è che **Ramos è un caso
  singolo che il tabellone sbaglia per un'altra ragione** — magari nessuna: può darsi che fosse davvero una
  riserva e che non sia titolare — e il caso Ramos **non può essere usato per aggirare il verdetto**. È
  precisamente l'errore commesso una volta il 06/08 con R18 e i criteri, e non si ripete.

### Cosa muove e cosa no
Muove **il TABELLONE e basta**: `eleven()` sta in `gui.py`, `evaluate.py` non lo importa, quindi `engine_*`
non cambia di un decimale e `backtest --verify` resta **22/22**. Nota che `presence.standing` **non** è
coinvolto: lo sweep del 29/07 ha già misurato `standing_weights` = (0, 1), cioè che chi parte l'anno dopo è
predetto dai MINUTI e non dal tasso di partenze — quindi il modello delle presenze questo numero non lo legge
già oggi, e l'unico consumatore della quota grezza è il disegno dell'undici.

### La guardia sul deliverable, e il suo limite dichiarato
Il gate vincola il prodotto (§7-novodecies), ma qui il prodotto è un tabellone, non una lista d'asta: la
guardia è il **giudice esterno** di §5-quaterdecies — gli undici tipo pubblicati da SOS Fanta, 193 uomini
confrontabili su 20 club, dove il tabellone oggi prende **83% degli uomini e 16/20 conteggi di linea**.
Criterio: **nessuno dei due numeri può scendere**. Il limite, detto ora: quel giudice è **una finestra sola e
della stagione corrente**, quindi può confermare e non può dimostrare — e per il caso che ha generato la
domanda è per costruzione muto, perché a inizio agosto un undici tipo pubblicato è una previsione quanto il
nostro.

### Un secondo effetto, dichiarato ora perché non diventi una scoperta comoda
Se ω > 0 entra, il modulo di default resta comunque quello del PREDECESSORE: `formation_typical` del Milan è
**3-5-2 al 92% di 38 undici**, con la sua stessa colonna che dice «0 of 38 XIs under this coach», mentre
`coach_shapes` porta i **45 undici in 3-4-3 di Amorim**. Sono due difetti indipendenti sullo stesso tabellone
e vanno misurati separati: se si toccano insieme non si saprà quale dei due ha pagato.

### ESITO (7 agosto 2026) — **FALSIFICATA AL CONTROLLO PRE-REGISTRATO, prima dello sweep**

Il controllo sul denominatore era il primo passo scritto, ed è servito esattamente a quello per cui era
scritto: **la premessa della regola è falsa**. `eleven()` non ordina per `desc_start_share`. Ordina per
`claim` → `standing` (`gui.py`, la chiave è `(-claim, -titolarita[1])`), e `standing` costruisce i suoi
input da `desc_season_starts`, `desc_season_matches`, `desc_minutes_full_season` e **`club_matches`, cioè le
giornate di campionato del club** — il denominatore corretto, quello che la correzione del 29/07 ha già
messo a posto. Sopra c'è lo sweep del 29/07 che ha misurato `standing_weights` = **(0, 1)**: il tasso di
partenze pesa **zero**, contano i minuti. La quota che volevo ristringere non entra in nessuna decisione.

**Da dove viene l'errore, e vale più della regola**: l'ho letto nel docstring di `eleven()`, che diceva
«ranked by the season's start share», e in quello di `titolarita()`, «The only criterion for who plays».
Nessuna delle due frasi era vera. È **la terza volta in un giorno** che un commento dichiara un uso che il
codice non fa — le prime due sono i portieri e l'Elo (§3-quinquies (a)) — e la prima in cui il commento
sbagliato ha prodotto un'ipotesi di gate invece di una semplice affermazione sbagliata in un documento.
Corretti entrambi.

**Misurato invece di dedotto, e in due modi:**

1. **A/B sul tabellone vero.** Ricalcolato l'undici di **55 club** sui due fogli, stesso giorno e stesso
   codice, sostituendo il denominatore con le giornate di campionato: **0 uomini cambiano**, su nessun club.
   Non «pochi»: zero. È la prova diretta che la colonna non tocca il disegno.
2. **Perché Ramos è fuori davvero**: `claim` **0.444**, contro Leão 0.615, Pulisic 0.548, Gimenez 0.513 —
   quarto fra gli attaccanti, sopra Nkunku 0.413. I suoi 1320 minuti sono **tutti `minutes_elsewhere`**
   (PSG), quindi ci passa sopra lo sconto d'arrivo, e il canale livello lo sta già alzando: `level_z`
   **2.178**, il più alto della rosa. Non è una colonna rotta: è il modello che fa quello per cui è stato
   misurato. **Può darsi che la risposta giusta sia che non è titolare** — era scritto nella
   pre-registrazione come esito possibile, e resta in piedi.

### Quello che il controllo ha trovato per davvero: una colonna che nessuno legge, con il denominatore sbagliato

`snapshot.titolarita` calcola `share = starts / matches`, dove `matches` sono **le sue presenze** e non le
giornate del campionato. Contro la regola che il progetto ha già scritto per sé («una quota di stagione è una
quota del CAMPIONATO»), e con effetti vistosi sul numero: scarto medio **+0.216** sul foglio Serie A (mediana
+0.154, massimo +0.974), e **51 uomini su 516 leggono 1.000** pur non avendo giocato il 90% del campionato —
Sportiello **1 partenza su 1 presenza = 1.000** contro lo 0.026 vero, e con lui una fila di portieri di
riserva. Sull'euro: 72 su 851.

Solo che **nessuno la consuma**. `View.titolarita(...)[0]` non è chiamato in nessun punto del codice di
produzione (di quella tupla si usa solo `[1]`, che sono le partenze, come spareggio); il pannello mostra
`voto_share`, che viene da `presence`; e **lo sweep passa `starts`, `appearances` e `league_matches` come
campi separati** e la `share` non la guarda. Resta una colonna del foglio esportato, che un umano che apre
`players.csv` legge — e legge sbagliato. I test, per inciso, la costruiscono come `starts / 38`: la semantica
voluta era quella del campionato, e l'implementazione è andata da un'altra parte.

**Decisione**: non è stata toccata in questa passata. Muove un valore che il foglio PORTA, quindi vuole un
`SHEET_REVISION` e una rigenerazione, e non muove un decimale di nulla che venga calcolato — quindi è una
scelta dell'operatore fra correggere il denominatore e togliere la colonna, non un'urgenza.

**Costo della falsificazione: un pomeriggio e zero corse di sweep.** È il caso migliore per cui il controllo
pre-registrato esiste, e va detto anche quando fa fare la figura di chi aveva torto: la griglia, le pieghe e
il giudice esterno erano già scritti, e se il controllo fosse stato messo DOPO sarebbero stati spesi.

## 7-vicies. LA QUALITÀ DI CARRIERA IN SELEZIONE (6 agosto 2026) — falsificata, ma non rumore

L'ultimo candidato rimasto dalla misura di §7-terdecies, e quello che avrebbe toccato Kolo Muani: la
fantamedia media delle stagioni PRECEDENTI a quella di input predice la titolarità dell'anno dopo, oltre ai
minuti già giocati. Distinta dal canale qualità falsificato in §7-duodecies, che leggeva la stagione di input:
questa legge quello che lo standing non ha mai visto.

**Applicata ai SOLI ATTACCANTI**, che è la popolazione su cui è stata misurata: r parziale **+0.135** (n=264,
+0.034 di titolarità per sd) contro +0.010 su tutti, +0.020 sui centrocampisti e **−0.054** sui difensori. Un
peso globale descriverebbe quattro cose diverse con un numero solo.

**ESITO**:

| | vincitore | scelta dei fold | media | peggiore |
|---|---|---|---:|---:|
| euro | **0.02** | 4 su 4 scelgono 0.02 o 0.034 | **+0.04%** | −0.14% |
| default | **0.0** | 6 su 6 scelgono zero | +0.00% | — |

**Non è rumore e non basta**, ed è una distinzione che vale la pena tenere: su euro tutti e quattro i fold
scelgono un valore positivo e la curva ha un minimo interno (0.19474 a zero, 0.19459 a 0.02, poi risale) —
il segno è consistente. Ma +0.04% è dieci volte sotto la soglia dello 0.5%, e su Serie A lo zero è confermato
da tutti e sei i fold. L'aritmetica lo spiegava già: 0.034 di standing per deviazione standard, su circa il
15% della popolazione, non muove un aggregato.

`career_weight` resta **0.0**. E la conclusione sul caso che ha aperto la giornata va detta per intero: per
Kolo Muani non esiste, nei nostri dati, un canale che lo porti dove l'operatore lo vede. Il livello lo alza di
poco (il Tottenham vale quanto il Milan), la carriera non passa, e il resto è già dentro.

## 7-novodecies. IL GATE VINCOLA ANCHE IL SURPLUS CATTURATO (6 agosto 2026)

Chiude il buco più vecchio di questo documento, quello che R3d aveva esposto: «una regola può passare il gate
di accuratezza e peggiorare il deliverable che il prodotto consuma davvero» — 157 → 151 nomi in comune, e il
surplus catturato in calo su tre finestre di cinque. Era stato **registrato invece che risolto**, con una
ragione onesta: allargare `passes` avrebbe potuto sfrattare regole già adottate.

Il gate guardava già i NOMI (`top10_not_harmed`, aggregato, tolleranza 2%). Non guardava quanto quelle liste
**valgono**, che `auction_view` calcola già come `captured_value`. Ora c'è `captured_not_harmed`, stessa
forma e stessa tolleranza: nessun numero nuovo, la stessa domanda posta al valore invece che al conteggio.

**LA PAURA ERA INFONDATA, ed è la parte che valeva la pena misurare**: **0 verdetti su 120 cambiano**. Tutte
le regole adottate continuano a passare — R3, R7, R13 su default, R0c, R3c e R18 su euro. L'unica riga
negativa è R19, che però non passava nemmeno prima ed è adottata sul solo verdetto robust, cosa già scritta
dove vive.

Quindi il costo dell'aver aspettato è stato zero e il beneficio è permanente: da oggi una regola che
impoverisce le liste non entra, e non serve che qualcuno se ne accorga leggendo un report.

## 7-octodecies. R18-GK — la carriera per i PORTIERI (pre-registrata il 6 agosto 2026, prima di eseguirla)

Chiude un buco che ho creato io: R18 esclude i portieri per costruzione, perché sono predetti da M2e
(`predict_fm_goalkeeper`) e non dalla forma àncora+beta — e i portieri erano lo strato che in-sample rendeva
di più. Escluderli è stato corretto come implementazione e sbagliato come conclusione: lo «+0.0% su P» che il
gate stampa non è un risultato, è un filtro.

- **Forma**: M2e prevede l'abilità come `GK_MV_ANCHOR + GK_MV_BETA × (mv_prev − àncora)`, quindi il termine di
  carriera è lo stesso, sulla MEDIA VOTO: `àncora + b1 × (mv_prev − àncora) + b2 × (mv_5y − àncora)`, con
  `mv_5y` la media di al più cinque stagioni fino a quella di input. Il resto di M2e — il tasso di gol subiti
  del club di destinazione, i rigori parati — non si tocca. b2 = 0 è l'incumbent.
- **Popolazione**: portieri con almeno due stagioni misurate.
- **Misurato prima**, n=163: solo `mv_prev` MAE **0.1037** (beta 0.20, la forma attuale) · solo la media 5 anni
  **0.1018** (beta 0.35) · entrambi **0.1017** con b1 **0.05** e b2 **0.30**, cioè **+2.0%**, e il peso va
  quasi tutto sulla storia.
- **Attesa scritta prima, ed è pessimista**: n=163 su tutte le stagioni significa **15-25 portieri per
  finestra**, quindi mi aspetto un verdetto RUMOROSO — segno giusto sulla maggioranza delle finestre, ampiezza
  ballerina, e strict quasi certamente mancato. Se passasse robust su una piattaforma sarebbe già più di
  quanto il campione promette; se il segno oscilla, il campione ha vinto e si scrive così.

### ESITO (6 agosto 2026) — il campione ha vinto, ed era l'esito previsto

Portieri, per finestra su euro: **−0.8% · +1.7% · −6.6% · −3.3% · +4.1%**. Il segno oscilla e l'ampiezza è
enorme in entrambi i versi. Aggiungerli rende R18 **leggermente PEGGIORE**, non migliore:

| | portieri esclusi | con R18-GK |
|---|---|---|
| euro/classic | 5/5, **+3.6%** | 5/5, +3.4% |
| euro/mantra | 5/5, +2.2% | 5/5, +2.2% |
| default/classic | 8/9, +2.0% | 8/9, +1.9% |
| default/mantra | **6/9**, +1.2% | **5/9**, +1.1% |

Il +2.0% in-sample su n=163 non sopravvive a 15-27 portieri per finestra. **Il ramo resta nel codice**: R18
non è adottata e quindi è inerte, e con i portieri dentro la regola è COMPLETA — il suo verdetto è onesto
invece che parziale, che era il difetto da chiudere. Lo «+0.0% su P» che il gate stampava non era un
risultato, era un filtro; adesso è un numero.

## 7-septdecies. R19 — IL LIVELLO DENTRO LE PRESENZE (pre-registrata il 6 agosto 2026, PRIMA di eseguirla)

Richiesta dell'operatore: «l'esperienza dovrebbe aumentare anche il SURPLUS». Non è alzare un peso: il canale
`level_weight` vive in `presence.py`, che è il modello del PANNELLO, mentre il surplus si costruisce su
`engine_pv_pred`, che viene da `model.expected_share` nel motore. `evaluate.py` non importa `presence`. Quindi
farla arrivare al surplus vuol dire una regola del motore sul lato presenze, con la sua lambda e il suo gate.

- **Forma**: `share += λ × z(Elo del club di provenienza)`, come aggiustamento sopra la share che le regole
  già adottate producono — quindi λ misura ciò che il livello AGGIUNGE, non una seconda copia dei minuti.
  Nessuna intercetta: con λ = 0 questa è esattamente la catena attuale, e l'incumbent è dentro lo spazio.
- **Popolazione**: solo chi ha **cambiato club** (`_level_z_scores`). Per chi resta, Elo di provenienza e di
  destinazione sono lo stesso numero e il termine diventerebbe R5 sotto un altro nome.
- **Attesa scritta prima**: guadagno sulla MAE delle presenze **fra 0.3% e 1% su default**, **nullo o
  negativo su euro**. E la ragione del pessimismo, dichiarata: lo stesso segnale è già stato misurato
  out-of-sample dallo sweep contro le titolarità realizzate (§7-terdecies, robust su Serie A) — ma su un
  ALTRO stimatore, `presence.standing`. Trasferire una misura da uno stimatore all'altro è esattamente ciò
  che è fallito oggi col canale qualità (§7-duodecies: r parziale +0.100 dentro la stagione, falsificato fra
  stagioni). Se passa, il segnale è robusto alla scelta dello stimatore; se non passa, non è una sorpresa.
- **Sovrapposizione da tenere d'occhio**: R5 legge l'Elo del club di DESTINAZIONE, e le due correlano. Se R19
  passa, va guardato cosa succede a R5 nello stesso giro, perché una delle due potrebbe essere l'altra.
- **E il verdetto va letto sotto i criteri nuovi** (§7-sexdecies), il che è a suo favore: la
  ri-pre-registrazione è successiva alla modifica dei criteri, quindi qui non c'è la contaminazione che
  R18 si porta dietro.

### ESITO (eseguito il 6 agosto 2026) — robust su Serie A, **non passa**, non si adotta

| piattaforma | vince | guadagno medio | peggiore | robust | strict | esito |
|---|---:|---:|---:|---|---|---|
| euro (entrambi i giochi) | **0/5** | **−1.1%** | −2.9% | no | no | non passa |
| default (entrambi) | 6/10 | **+1.7%** | −1.5% | **SÌ** | no (T1 +1.5%) | non passa |

**La previsione pre-registrata era giusta**, e per la prima volta in questa sessione: avevo scritto «fra 0.3%
e 1% su default, nullo o negativo su euro». Reale: **+1.7%** su default (sopra la mia forchetta) e **−1.1%**
su euro. Direzione corretta su entrambe le piattaforme.

**E il trasferimento fra stimatori è RIUSCITO**, che era il rischio dichiarato. Lo stesso segnale è ora
misurato due volte, out-of-sample, su due stimatori diversi — `presence.standing` con lo sweep
(§7-terdecies) e `model.expected_share` col gate — e dà **lo stesso quadro**: robust su Serie A, negativo su
euro. È l'opposto di quel che è successo al canale qualità (§7-duodecies), e rende il segnale molto più
credibile della singola misura che l'aveva suggerito.

### ADOTTATA su `default`, il 6 agosto 2026 — e la prima sul solo verdetto ROBUST

Rilettura chiesta dall'operatore: «se ha effetti positivi per la Serie A e nulli per l'euro, perché non
adottarla?». La premessa su euro è **falsa e va corretta** — lì non è nulla, è contro: 0 finestre su 5, media
−1.1%, e su mantra i nomi d'asta scendono 152 → 145, fuori dalla tolleranza. Il resto del ragionamento invece
regge, e meglio di come il primo esito l'aveva presentato:

- **l'adozione è già per piattaforma**: `ADOPTED` è un dizionario, R7 e R13 stanno solo su `default`, R3c solo
  su `euro`. Prenderla dove aiuta non è una forzatura, è la forma che il progetto usa;
- **il conteggio «6/10» era fuorviante**, ed è colpa di come l'avevo riportato: quelle sono le finestre che
  superano la SOGLIA. Le finestre che **migliorano** sono **9 su 10** — solo T1 va contro, di 1.5%, dentro la
  tolleranza del 2%;
- **e su default migliora anche il deliverable**: nomi d'asta 136 → 142 (+4.4%) su classic, 432 → 438 su
  mantra. Non solo la MAE delle presenze: le liste.

`passes` resta False perché pretende il miglioramento su OGNI finestra — la forma che questo documento già
chiama in causa («lo strict AND rifiuta regole che vincono nove volte e pareggiano una»). **Il criterio non è
stato cambiato per farla entrare**: quell'errore è stato commesso una volta oggi con R18 (§7-sexdecies) e non
si ripete. La strada usata è l'altra, ed è prevista: i due verdetti stanno affiancati e la decisione si prende
in chiaro. Il robust tiene, e la decisione è **sì su default, no su euro**.

**Effetto misurato sul foglio**, A/B a parità di giorno e di codice: **39 righe su 645**, di cui **29 arrivi**,
e in entrambe le direzioni — Esposito Se. 26.8 → 28.3 presenze (surplus 33.8 → 35.7), Audero 25.0 → 23.3
(25.5 → 23.8). Chi viene da un club forte sale, chi viene da uno debole scende.

**Da tenere d'occhio**, dichiarato ora e non dopo: è la prima regola adottata senza `passes`. Se il prossimo
giro di gate la trova peggiorata, va tolta senza discutere — un'adozione sul robust è più fragile di una sul
passa, e chi la difende deve saperlo.

**La sovrapposizione con R5 non c'è**: aggiungere R19 non muove **nessuno** dei 116 verdetti, e R5 (Elo del
club di DESTINAZIONE) resta bocciata su tutte e quattro le combinazioni prima e dopo. Le due leggono davvero
due cose diverse - dove giocava e dove va - ed è la stessa conclusione a cui era arrivato §7-terdecies
misurando la competizione contro il club.

## 7-sexdecies. I CRITERI DEL GATE, ricalibrati — e una contaminazione da dichiarare (6 agosto 2026)

Richiesta dell'operatore dopo aver chiesto una visione d'insieme: «sistema come dici tu». Due criteri
cambiati, e va detto subito che **uno dei due è nato guardando una regola bocciata**, il che è il difetto
metodologico che questo documento chiama l'altro modo di fittare. È dichiarato sotto, non sepolto.

### A. Lo strict: la soglia sulla MEDIA, non su ogni finestra

Era «migliora su OGNI finestra di almeno `MIN_RELATIVE_GAIN`». È un requisito di **ampiezza su ogni singolo
campione**, non di consistenza: `standing_prior_rounds` ha vinto tutti e sei i fold di Serie A e ha mancato
lo strict perché il più debole dava +0.36% invece di +0.50%. Ora: migliora **ovunque** (nessuna finestra
peggiora) **e** la media supera la soglia, che è dove una domanda di ampiezza appartiene.

**Prova indipendente che la vecchia forma era scalibrata**: la modifica riporta a PASSES **R3, R7 e R3c**,
che sono regole **già adottate e in produzione**. Un gate che boccia ciò che il motore usa non sta essendo
severo, sta misurando male. Questo si vede senza guardare nessuna regola nuova.

### B. FM e VALUE: aggregati, alla tolleranza che avevano già

`fm_not_worse` e `value_not_worse` erano letti **per finestra** a 1.001, mentre il guardrail d'asta è
**aggregato** al 2% dal 28/07. Due unità diverse per la stessa domanda, e non per una decisione: per due date.
Corretta l'**unità**, lasciata l'ampiezza a 0.1% (`NO_HARM_ALLOWANCE`).

Il 2% è stato provato e **rimesso indietro**: misurato, spostava **una** bandiera su 116 verdetti, quindi non
comprava nulla di reale e in cambio rendeva queste due guardie venti volte più deboli su una regola futura
che le stressi davvero. Un allentamento senza beneficio dimostrato non è una correzione, è una licenza.

### ⚠️ LA CONTAMINAZIONE, e cosa ne consegue per R18

Il punto B è nato da R18: FM migliore su tutte e cinque le finestre di euro/classic, caduta su **+0.24% di
VALUE su una sola**. Ho giudicato sbagliato il criterio e l'ho cambiato — e con i criteri nuovi **R18 passa
da 1/4 a 2/4 combinazioni**, e la combinazione che si gira è esattamente quella. La sequenza è: vedo la
bocciatura, cambio la regola, la bocciatura sparisce.

**Conseguenza: il verdetto di R18 non è utilizzabile per adottarla.** I criteri restano (sono giusti per
ragioni che non dipendono da lei, vedi A), il suo verdetto no. Se R18 va giudicata, va **ri-pre-registrata**
sotto i criteri nuovi, con l'aspettativa riscritta prima, e sapendo che questa contaminazione è agli atti.

### Portata complessiva, misurata e non stimata

**14 verdetti su 116 cambiano, tutti nella direzione NO → PASSES**, nessuno in quella opposta: nessuna regola
adottata viene sfrattata. Le nuove promosse sono R3, R7, R3c (già adottate), R14, R15 e **R3d** — quest'ultima
è quella che §sopra documenta come «passa l'accuratezza e peggiora le liste d'asta». **Passare non è essere
adottati**: `ADOPTED` resta scritto a mano e non è stato toccato. Ma un criterio che, cambiato, ammette soltanto
e non esclude mai, va guardato per quello che è: sul netto, un allentamento.

## 7-quindecies. IL NUOVO ACQUISTO GIOCA DI PIÙ? (6 agosto 2026) — falsificata, con un pezzo dentro

Ipotesi dell'operatore: «un calciatore acquistato quest'anno ha più possibilità di giocare titolare o
giocare più minuti; se è così dobbiamo dare un bonus ai nuovi acquisti sul claim».

**Misurata su 2324 (giocatore, stagione)**, residuo della titolarità dell'anno dopo al netto della quota di
minuti precedente (NON scontata, altrimenti si misurerebbe il discount invece dell'ipotesi):

| | n | residuo | err. std |
|---|---:|---:|---:|
| è RIMASTO | 1619 | **+0.0204** | 0.0059 |
| è stato ACQUISTATO | 705 | **−0.0468** | 0.0114 |

Sei punti e mezzo di divario con errori standard di mezzo punto: cinque sigma, e vale per ogni ruolo
(P −0.117, D −0.029, C −0.048, A −0.050). **Un nuovo acquisto gioca MENO** di quanto i suoi minuti facciano
prevedere, non di più: `ARRIVAL_DISCOUNT` a 0.80 non è solo confermato, è prudente. Nessun bonus.

**Il pezzo dentro, e il suo esito.** Separando i due tipi di arrivo: intra-campionato **−0.0570** (n=543),
cross-campionato **−0.0128** (n=162, entro mezzo sigma da zero). Il modello aveva **un solo** discount per
entrambi, quindi lo sdoppiamento è stato pre-registrato come coppia `(intra, cross)` — coppia e non due
parametri, perché con i due valori uguali sono la stessa funzione. Griglia: `(0.8,0.8)` incumbent · `(0.8,0.7)`
il passo contrario · `(0.8,0.9)` `(0.8,1.0)` `(0.7,0.9)` `(0.7,1.0)` `(0.9,1.0)`.

**ESITO: non adottato.** Tutti e dieci i fold scelgono **`0.8/0.7`** — cioè il cross andrebbe scontato di
PIÙ, l'opposto della misura che ha motivato la griglia. Guadagni +0.25% (euro, peggior fold −0.20%) e +0.23%
(default, peggior fold +0.06%): **sotto la soglia dello 0.5%**, quindi né strict né robust. E 0.7 è il
**bordo** della griglia: allargarla dopo aver visto la curva è l'altro modo di fittare.

**Ipotesi sul rovesciamento, dichiarata come ipotesi**: il canale LIVELLO è stato adottato un'ora prima
(§7-terdecies), e un arrivo cross-league da un club forte riceve già +0.06 per deviazione standard di Elo. Lo
spazio per un discount più mite è stato consumato lì. Due leve che si sovrappongono, e la seconda è arrivata
dopo la misura che la motivava — che è una lezione sull'ORDINE in cui si misurano i canali, non su questo
canale: una misura fatta a modello fermo non descrive più il modello dopo che un altro canale è entrato.

## 7-quaterdecies. I DUE PEZZI CHE MANCANO ALLO STANDING (pre-registrati il 6 agosto 2026)

Richiesta dell'operatore: «per esperienza Ramos dovrebbe avere un claim del 55% almeno, e Gimenez 45%;
troviamo i pezzi che mancano». **Il bersaglio non è raggiungibile alzando il canale livello**, e va detto in
aritmetica prima di cercare altro: con `level_weight` 0.06 Ramos passa da 31% a **43%**, e per portarlo a 55%
servirebbe 0.122 — il tetto della griglia, oltre il punto in cui la curva dello sweep **risale** (0.12 è
peggio di 0.08 su entrambe le piattaforme). Gimenez non ha cambiato club, quindi quel canale **non lo tocca a
nessun peso**. Servono pezzi diversi, e sono due.

### A. Lo standing non sa su QUANTA stagione è stato misurato — MISURATO, da pre-registrare

Un'alta quota di minuti costruita su mezza stagione non si mantiene come la stessa quota costruita su una
stagione intera. Su 2195 (giocatore, stagione), errore = titolarità reale dell'anno dopo meno lo standing:

| giornate dietro lo standing | n | standing | titolarità reale | errore |
|---|---:|---:|---:|---:|
| 3-10 | 66 | 0.134 | 0.207 | **+0.073** |
| 11-19 | 226 | 0.363 | 0.411 | +0.048 |
| 20-28 | 315 | 0.484 | 0.463 | −0.021 |
| 29-34 | 705 | 0.598 | 0.571 | −0.027 |
| 35+ | 883 | 0.583 | 0.574 | −0.008 |

E isolando i casi come quello che ha sollevato la domanda — standing **> 0.55**: su 3-19 giornate l'errore è
**−0.190** (n=63), su 20+ è −0.092 (n=1075). L'ottimismo raddoppia. La tabella completa mostra la stessa cosa
dai due lati: campione corto e standing basso **sotto**stima (+0.073), campione corto e standing alto
**sovra**stima. È regressione verso la media, e lo standing non ne tiene conto.

#### Seguito (6 agosto 2026): il prior va CONDIZIONATO alle giornate, e non migliora la previsione

Il rovescio dello shrinkage era visibile sul campetto: Milik, **8 giornate** misurate, usciva al **26%** di
claim. La causa non è la forza dello shrinkage ma il bersaglio: tirava verso la media di TUTTI (0.53), mentre
un uomo misurato su 3-10 giornate gioca davvero **0.207** della stagione dopo. Non è un membro medio della
popolazione, è un uomo di margine, e le giornate lo dicono già.

Il prior è ora **per banda di giornate**, calcolato dal chiamante sulla sua popolazione (bande della tabella
sopra). Sul foglio euro escono 0.149 / 0.408 / 0.465 / 0.483 / 0.391. Effetto: **Milik 26% → 10%**,
Chukwueze 10% → 9%.

**E non migliora la metrica dello sweep**, che va detto: curva pooled praticamente identica (euro 0.19474
contro 0.19454 col prior unico, default invariato), K resta a 10 su entrambe le piattaforme. Quindi è un
cambio motivato dalla LETTURA e non dalla previsione, e costa 0.10% su euro. Registrato come tale: chi lo
cita non lo chiami un miglioramento del modello.

**Forma proposta**: `standing_shrunk = m × r/(r+K) + prior × K/(r+K)`, con `r` = le giornate misurate, `K` il
parametro sweepabile e `prior` la media di popolazione del ruolo, passata come input (né la vista né lo sweep
possono inventarsela dentro `presence.py`, che è dependency-free). `K = 0` è l'incumbent ed è dentro lo spazio.
**Non implementato**: richiede un input nuovo in `Inputs` e la media di popolazione calcolata da entrambi i
chiamanti; è la stessa ragione per cui R18 è ferma — non si scrive di fretta. Effetto atteso sul caso: Gimenez
≈ 49% (16 giornate), Ramos invariato a 43% (30 giornate), divario da 28 punti a 6.

### B. L'esperienza dovrebbe alzare anche il SURPLUS — e oggi non può, per costruzione

Richiesta dell'operatore, e la risposta è architetturale prima che statistica: il canale livello vive in
`presence.py`, che è il modello delle presenze del **pannello**; il surplus si costruisce su
`engine_pv_pred`, che viene da `model.expected_share` nel motore **gated**. `evaluate.py` non importa
`presence`. Quindi far entrare l'esperienza nel surplus **non è alzare un peso**: è una regola nuova sul lato
presenze del motore, con la sua lambda, e la giudica `backtest --gate` e non lo sweep.

**Pre-registrata come R19**: `share_pred` corretta da `λ × z(Elo del club dove ha giocato)`, solo per chi ha
cambiato club, λ fittata su una finestra che non la giudica. L'evidenza a favore c'è già ed è out-of-sample —
lo sweep di §7-terdecies ha misurato lo stesso segnale contro le titolarità realizzate, robust PASS su Serie A
— ma è stato misurato su un ALTRO stimatore, e questo è precisamente il tipo di trasferimento che stasera è
già fallito una volta (§7-duodecies). Attesa dichiarata: guadagno sulla MAE delle presenze fra 0.3% e 1% su
default, nullo o negativo su euro.

## 7-terdecies. IL LIVELLO DEL CALCIO GIOCATO, e cosa NON ne fa parte (esplorazione del 6 agosto 2026)

Nata da un'osservazione dell'operatore su due acquisti che nessun undici tipo schiera: «Kolo Muani come
G. Ramos sono stati acquistati per essere prime scelte ... hanno esperienze internazionali di caratura
superiore a Gimenez». Quattro misure, **nessuna adottata**: sono candidate, e la pre-registrazione viene dopo.

**1. La forza del club dove ha giocato i minuti — IL CANDIDATO PIÙ FORTE.** Su 700 trasferimenti, l'Elo del
club di provenienza predice la quota di titolarità nel club nuovo *a parità di minuti giocati*: r parziale
**+0.150** (attaccanti **+0.312**). Al netto **anche** della fantamedia — cioè escludendo che sia qualità
travestita da livello — resta **+0.137** (attaccanti **+0.235**), +0.040 di titolarità per +1 sd di Elo
(1 sd = 127 punti). La premessa dell'operatore ha il suo numero: Elo medio Premier **1807**, Serie A **1610**.
Corollario che ridimensiona il caso di partenza: il Tottenham (1774) vale quanto il Milan (1787), quindi il
canale premia Ramos (PSG 1970, +1.44 sd) e **non dice nulla su Kolo Muani** (−0.10 sd).

**2. La qualità di CARRIERA** (le stagioni precedenti a quella di input): piatta sul totale — r +0.010 sul
miglior FM, +0.030 sulla media — e reale **solo sugli attaccanti**, r **+0.135**, +0.034 di titolarità per sd.
Sui difensori è negativa (−0.054). È la seconda gamba del caso Kolo Muani (4 stagioni top-5, miglior FM 7.93,
contro le 2 di Gimenez, miglior FM 6.77) ed è l'unica che lo tocca.

**3. La FM su CINQUE ANNI come qualità base** (richiesta dell'operatore), misurata sul mestiere del core —
prevedere la fantamedia della stagione seguente, n=3470:

| predittore | MAE |
|---|---:|
| FM di t−1 grezza (il naive) | 0.3921 |
| àncora di ruolo | 0.3981 |
| media 5 anni, grezza | 0.3668 |
| àncora + 0.50×(t−1 − àncora) — **la forma del core oggi** | 0.3458 |
| àncora + 0.60×(media 5 anni − àncora) | 0.3434 |
| **àncora + 0.25×(t−1) + 0.35×(media 5 anni)** | **0.3401** |

**−1.6%** sulla forma attuale, concentrato dove la storia è di 2-3 stagioni (+3.5% con due) e sui ruoli
arretrati (P +2.8%, D +1.5%, C +0.1%, A +0.4%). Fit **in-sample**: il gate rifitta su una finestra e giudica
sull'altra, quindi il guadagno atteso è minore. Questo candidato tocca `fm_pred`, quindi è materia di
`backtest --gate` e non di `sweep`.

**4. L'ESPERIENZA DA PANCHINA — falsificata prima di scriverla.** «L'esperienza si accumula anche solo
partecipando come panchinaro, in maniera ridotta». È misurabile, perché il payload porta l'intera lista dei
convocati (20-23 per squadra a partita): 58.161 titolari, 23.275 subentrati, **35.896 panchinari inutilizzati**
in Serie A, e il non convocato è l'assenza di riga — «vuoto = ignoto». Costruito l'indice
`(minuti/90 + w × panchine) × Elo`, la correlazione parziale è **massima esattamente a w = 0** e scende in
modo monotòno: +0.132 · +0.120 (w 0.1) · +0.098 (0.2) · +0.053 (0.5) · +0.026 (1.0). Il termine panchina
isolato vale **−0.005** (D +0.049, C −0.008, A −0.021). Sedersi in panchina in un club forte non dice nulla su
quanto giocherai dopo, e mescolarlo **peggiora** il segnale dei minuti.

### PRE-REGISTRAZIONE (6 agosto 2026, scritta PRIMA di eseguire) — il canale LIVELLO

Decisione dell'operatore: «adottiamo entrambi: esperienza pesata sull'Elo e FM su 5 anni nel core». Con
l'avvertenza dichiarata: le misure sopra sono **in-sample**, la regola d'oro è il gate fuori campione, e
stasera un candidato a r parziale +0.100 è già stato falsificato (§7-duodecies). Quindi si implementano e si
mandano a giudizio; restano accesi solo se passano.

- **Dove vive**: `presence.level_lift`, canale dello standing con `Params.level_weight` (default **0.0**),
  input `Inputs.level_z` = Elo del club dove ha giocato i minuti, standardizzato.
- **Su chi agisce**: SOLO chi ha cambiato club (`Observation.club_change`). È la popolazione su cui il
  coefficiente è stato misurato; per chi resta il termine diventerebbe «il suo club è forte», che è un'altra
  affermazione e nessuno l'ha misurata.
- **Griglia pre-registrata**, centrata sul valore misurato (+0.040), tetto a tre volte, un passo negativo:

```
level_weight ∈ (−0.02, 0.0, 0.02, 0.04, 0.06, 0.08, 0.12)     bersaglio: starts
```

- **Previsione scritta prima**: passa robust su almeno una piattaforma con guadagno fra 0.3% e 1%, e il
  vincitore cade fra 0.02 e 0.06. Se vince un estremo **non si adotta**.
- **Rischio noto**, lo stesso di §7-duodecies: la misura è su un ORIZZONTE (trasferimento → stagione
  seguente) che coincide col compito dello sweep, il che la rende più solida del canale qualità — ma resta
  una correlazione parziale su 456-700 casi, non un verdetto.

#### ESITO (eseguito il 6 agosto 2026) — **ADOTTATO a 0.06**

| piattaforma | finestre | strict | robust | vincitore pooled | guadagno medio | peggiore |
|---|---:|---|---|---|---:|---:|
| euro | 4 | no | no (sotto la soglia) | **0.06** | **+0.46%** | **+0.05%** |
| default | 6 | no | **PASS** | **0.08** | **+0.93%** | −1.12% |

Su Serie A passa robust e il cross-fit sceglie 0.08 in **5 fold su 6**. Su euro il guadagno è positivo su
**tutte e quattro** le finestre — peggiore +0.05% — e manca il robust solo perché la media, +0.46%, sta 4
centesimi sotto la soglia dello 0.5%. Nessuna delle due è strict (su default T1 costa −1.12%, dentro la
tolleranza del −2%).

**E per la prima volta oggi la condizione che mancava è soddisfatta: il minimo è INTERNO su entrambe le
curve pooled.** euro: 0.20120 (a 0) → 0.20023 (0.06) → 0.20026 (0.08) → 0.20071 (0.12). default: 0.20296 →
0.20084 (0.08) → 0.20102 (0.12). La curva risale, quindi non stiamo adottando il bordo della griglia.

**Valore adottato 0.06, uno solo.** È l'ottimo di euro e cattura il 90% del guadagno di Serie A (0.20106
contro 0.20084 al suo 0.08). La previsione pre-registrata era «robust su almeno una piattaforma, guadagno fra
0.3% e 1%, vincitore fra 0.02 e 0.06»: giusta, col vincitore di Serie A un gradino più in alto.

**Portata dell'adozione, da non gonfiare**: `presence.py` è il modello delle presenze del PANNELLO —
`evaluate.py` non lo importa, e `engine_pv_pred` continua a venire da `model.expected_share`. Quindi questo
cambia **chi il campetto disegna** e le presenze mostrate, e **non tocca un decimale di `engine_*`**:
`backtest --verify` resta 22/22 per costruzione. Effetto sul caso che ha aperto tutto: Ramos (PSG, +1.97 sd)
riceve **+0.118** di standing, Kolo Muani (Tottenham, +0.43 sd) **+0.026**, Gimenez zero perché non ha
cambiato club. Il divario Ramos-Gimenez era 0.277: se ne chiude poco meno della metà, e quello di Kolo Muani
quasi nulla — il suo caso resta appeso alla qualità di carriera, che è misurata (+0.135 sugli attaccanti) e
NON adottata.

### PRE-REGISTRAZIONE (6 agosto 2026) — **R18: la FM su cinque anni come qualità base**

Il secondo dei due che l'operatore ha chiesto di adottare. Tocca `fm_pred`, quindi **non** è materia di
`sweep`: è una regola del motore e la giudica `backtest --gate`, con le beta fittate su una finestra che non
la giudica, come ogni altra.

- **Forma**: `fm_pred = àncora + b1 × (fm_prev − àncora) + b2 × (fm_5y − àncora)`, dove `fm_5y` è la media
  delle fantamedie delle ultime cinque stagioni con ≥15 voti, qualunque piattaforma, **escluse** quelle
  successive alla stagione di input (nessun look-ahead). Il caso b2 = 0 è esattamente il predittore di oggi,
  quindi l'incumbent è dentro lo spazio dei parametri.
- **Popolazione**: chi ha almeno una stagione oltre a quella di input. Con una sola stagione `fm_5y` = `fm_prev`
  e la regola è l'identità — ed è anche l'unico strato dove, in-sample, la media PERDE (−1.0%): va escluso
  dichiarandolo, non scoperto dopo.
- **Attesa scritta prima**, dai numeri in-sample sopra: guadagno di MAE **fra 0.5% e 1.5%** sulla forma
  attuale, concentrato sui ruoli arretrati (P +2.8%, D +1.5%) e su chi ha 2-3 stagioni di storia (+3.5% con
  due). Sugli attaccanti l'attesa è **quasi nulla** (+0.4%) — che è ironico, visto che la richiesta nasce da
  due attaccanti: quello che risolve Kolo Muani è il canale LIVELLO e la qualità di carriera in selezione,
  non questo.
- **Se non passa non entra**, e la MAE complessiva non deve peggiorare su nessuna finestra: è la regola d'oro.
- **Implementata ed ESEGUITA il 6 agosto 2026.** Il fit di due coefficienti non era il problema che temevo:
  `share` di R3 è già una tupla e `fit_linear` regge più regressori, quindi la macchina c'era.

#### ADOTTATA su `euro` il 6 agosto 2026 — e la contaminazione non morde, per un motivo verificabile

**euro/mantra passava GIA' coi criteri vecchi e senza i portieri**, cioè prima di entrambe le cose che ho
toccato guardando R18 (§7-sexdecies i criteri, §7-octodecies i portieri). Quel PASSA non dipende da nulla che
io abbia cambiato dopo averla vista cadere, ed è il gioco su cui l'operatore gioca. euro/classic passa solo
coi criteri nuovi: concordante, quindi vale come conferma e non come prova. Su `default` non passa in nessuna
versione — 8/9 finestre ma una a −5.6% — e resta fuori di là. Adozione per piattaforma, come sempre.

Effetto sul foglio EuroLeghe: **420 righe su 979**, e nella direzione che un termine di carriera deve dare —
Kane 8.758 → **9.215** (surplus 232.6 → 244.8), Haaland 7.968 → 8.445, Mbappé 7.998 → 8.593, mentre chi ha
avuto una stagione sola scende (Dallinga 6.956 → 6.672, Bonny 7.229 → 6.955).

#### Ri-verificata l'8 agosto 2026, perché avevo detto il contrario

Rispondendo a «come mai G. Ramos ha un SURPLUS così basso?» ho scritto che **il core legge una sola
stagione**: vero su `default`, **falso su euro**, dove R18 è adottata. La verifica è quella di sempre —
chiamare la funzione invece di leggere la colonna che le somiglia:

- i coefficienti fittati per finestra sono `history_lam` = (b1 su `fm_prev`, b2 su `fm_5y`): Tm4
  (−0.01, 0.48) · Tm3 (0.44, 0.32) · T0 (0.33, 0.48) · T1 (0.12, 0.52) · T2 (0.24, 0.44). Su quattro
  finestre di cinque **la media pluriennale pesa PIÙ dell'ultima stagione**;
- sul foglio euro 2026-27 la regola muove **407 righe su 1834** (Mbappé +0.60, Haaland +0.48, Kane +0.46;
  in basso Dallinga −0.28, Bonny −0.27);
- **Ramos**: `fm_prev` 6.23, media delle sue **tre** stagioni (7.52 · 7.50 · 6.23) = **7.083**, àncora `pc`
  7.424 → 7.424 + 0.24×(6.23−7.424) + 0.44×(7.083−7.424) = **6.993**, cioè **+0.070** contro il core solo.
  Le tre stagioni sono già lette; resta basso perché la sua media triennale è **sotto** l'àncora dei
  centravanti euro, e il livello di rimpiazzo dei `pc` è 7.19.

⚠️ E una trappola dell'harness, la stessa di sempre: chiamare `snapshot.engine_predictions(..., fits={})`
fa ripiegare i parametri su `R0-core`, dove `history_lam` è **None** perché la finestra LIVE non ha esito su
cui fittare — e R18 muove **0 righe su 531**. Non è la regola che non funziona, è il percorso che non è
quello del pannello (che i fit glieli passa). Misurare una regola adottata richiede i fit veri.

#### Cosa NON è mai stato misurato, e sarebbe la richiesta «leggi le ultime 3 stagioni»
La FINESTRA (cinque stagioni) e i PESI (uguali) sono scritti a mano in `features.load` e non li ha mai
giudicati nessuno. Una griglia pre-registrabile: `n ∈ {2,3,4,5}` × `decadimento ∈ {1.0, 0.75, 0.5}`, giudizio
col gate su entrambe le piattaforme, incumbent = (5, 1.0). Da dichiarare prima: **un decadimento ABBASSA
Ramos** — con pesi 1/0.5/0.25 la sua media passa da 7.083 a **6.78**, perché dà più peso alla stagione
brutta — e va nella direzione OPPOSTA a ciò che i fit dicono (b2 > b1 su 4 finestre di 5).

#### ESITO del primo giro — passava su UNA combinazione su quattro

| combinazione | robust | vince | guadagno medio | peggiore | esito |
|---|---|---|---:|---:|---|
| euro / classic | no | **5/5** | **+3.6%** | +1.9% | **NON PASSA**: il VALUE peggiora su T2 (42.4 → 42.5) |
| euro / mantra | **sì** | 5/5 | +2.2% | +0.7% | **passa** l'accuratezza, ma il top-10 peggiora |
| default / classic | no | 8/9 | +2.0% | **−5.6%** | non passa |
| default / mantra | no | 6/9 | +1.2% | −5.3% | non passa |

Su euro la FM migliora su **tutte** le finestre in entrambi i giochi, e sui giocatori che la regola MUOVE il
guadagno arriva a −5.1% (T0) e −5.0% (T1). Su Serie A c'è una finestra a −5.6% e il quadro non tiene. Dove
l'accuratezza passa cede il top-10, che è ciò che un'asta legge davvero: la regola d'oro dice che nulla deve
peggiorare, e qui qualcosa peggiora in tre casi su quattro.

**La previsione pre-registrata era sbagliata in due modi**, e vale la pena registrarli entrambi. Avevo scritto
«+0.5-1.5%, concentrato su P e D»: il guadagno su euro è **il doppio** dell'estremo alto, e la distribuzione
per ruolo è rovesciata — **A** e **C** guadagnano (fino a −7.8% su C in T0 e −7.5% su A in T1), **D** poco,
**P esattamente zero**. E lo zero sui portieri non è un risultato: è una **mia scelta di implementazione**.
I portieri sono predetti da M2e (`predict_fm_goalkeeper`), non dalla forma àncora+beta, quindi li ho esclusi
per costruzione — cioè ho tolto proprio lo strato che in-sample rendeva di più (+2.8%). Un termine di storia
per i portieri esiste come domanda aperta e ha bisogno della SUA forma, non di questa.

**`backtest --verify` resta 22/22**: R18 non è in `ADOPTED`, quindi nessun numero pubblicato si muove.

### L'ESPERIENZA RIFLESSA (misurata il 6 agosto 2026) — non aggiunge, e non si adotta

Raffinamento dell'operatore: «l'esperienza va valutata considerando sia l'Elo della squadra dove si è giocato
(diretta) sia il campionato dove si è partecipato (riflessa, appresa dagli avversari)» — e poi, correggendo la
prima operazionalizzazione: «non bisogna valutare i singoli avversari, è l'Elo della competizione che già
riflette la caratura delle squadre che si incontrano». La correzione ha **migliorato la misura**: l'Elo della
competizione (media dei club di quel campionato in quell'anno) non ha il buco di risoluzione né il rumore di
calendario, e da solo vale più della media degli avversari (+0.104 contro +0.078).

**La versione buona, Elo della COMPETIZIONE** (699 trasferimenti, nessun buco: il campionato è un attributo del
club). Elo medio pluriennale: La Liga 1770 · Premier 1758 · Bundesliga 1700 · Ligue 1 1658 · Serie A 1609.

| candidato | r parziale |
|---|---:|
| Elo del CLUB (adottato), al netto dei minuti | **+0.153** |
| Elo della COMPETIZIONE, al netto dei minuti | +0.104 |
| COMPETIZIONE, al netto dei minuti **e del club** | **+0.027** |
| CLUB, al netto dei minuti **e della competizione** | **+0.116** |

Correlano +0.550. La competizione collassa a +0.027 e il club tiene — ma il club **perde un quarto** del suo
segnale (0.153 → 0.116) quando si toglie la competizione, che è l'argomento dell'operatore letto al contrario:
la caratura del campionato è **già dentro** l'Elo del club, e un secondo termine la duplicherebbe invece di
aggiungerla. Per ruolo la competizione dà D +0.032, C −0.015, A +0.053; il club tiene D +0.118, C +0.073,
A **+0.247**. Un canale solo, quello adottato.

**La prima operazionalizzazione, tenuta come nota di metodo**: l'Elo medio degli avversari effettivamente
affrontati, per-partita da `external_match_stats.opponent`.

Trappola evitata per prima, perché è quella che questo documento già registra: gli avversari sono agganciati
con `club_index` e non col nome — una misura ad hoc precedente aveva perso Milan, Roma e Napoli così. Tasso
di risoluzione **77.0%** (250.630 su 325.418), che è il limite dichiarato di questa misura.

Le due quantità sono davvero distinte (correlano **+0.424**), ma su 693 trasferimenti:

| candidato | r parziale |
|---|---:|
| Elo del proprio club, al netto dei minuti | **+0.155** |
| Elo degli avversari, al netto dei minuti | +0.078 |
| Elo degli avversari, al netto dei minuti **e del proprio Elo** | **+0.015** |
| Elo del proprio club, al netto dei minuti **e degli avversari** | **+0.135** |

Messe insieme, la diretta sopravvive quasi intatta e la riflessa collassa a zero. Per ruolo i segni non
tengono (D +0.070, C **−0.104**, A +0.088): rumore. Il livello degli avversari è in gran parte già contenuto
nella forza del club per cui giochi, quindi il canale resta **uno solo**, quello adottato.

**Cosa NON abbiamo, e non è una formula ma un'acquisizione**: le coppe europee sono troppo sottili per pesarle
(Champions **2007 righe su 2 stagioni**, Europa League 990) e delle **nazionali non c'è nulla** — zero righe,
nessuna competizione per nazioni nel database. Un indice di esperienza che le comprenda va prima *scaricato*.

## 7-duodecies. LA VISIBILITÀ GUADAGNATA COL RENDIMENTO (pre-registrata il 6 agosto 2026, PRIMA di eseguirla)

**Ipotesi dell'operatore, testuale**: «un giocatore con SURPLUS maggiore, nell'arco dell'anno, acquisirà più
visibilità agli occhi dell'allenatore e quindi minutaggio ... dobbiamo convertire quindi il SURPLUS in un
bonus sul claim».

**Cosa si sweepa, e perché NON il surplus.** Il surplus è `(FM − rimpiazzo) × Pv_pred`, e `Pv_pred` nasce dallo
`standing`, cioè dal claim stesso: sommarlo al claim rimetterebbe le presenze dentro le presenze. La parte non
circolare è la **qualità**, quindi il canale legge la **fantamedia relativa al ruolo**, in deviazioni standard
(`presence.Inputs.fm_z`), e la somma allo standing con peso `quality_weight`. È **centrato** come il canale
`stature`: chi ha reso sopra la media sale, chi ha reso sotto scende — «un'ipotesi che ammette solo il segno
che si aspetta non è sotto esame».

**La misura fatta PRIMA di scrivere la griglia** (06/08/2026, sulle nostre stagioni di Serie A): 1758
(giocatore, stagione), andata contro ritorno, stesso club nelle due metà, ≥5 voti all'andata, al netto dei
minuti già giocati.

| | n | r(minuti andata→ritorno) | r parziale con la FM | effetto |
|---|---:|---:|---:|---|
| tutti | 1758 | +0.612 | **+0.100** | **+1.5** min/giornata per +1 sd |
| A | 364 | +0.652 | **+0.196** | **+2.9** |
| C | 675 | +0.600 | +0.082 | +1.3 |
| D | 604 | +0.438 | +0.086 | +1.3 |
| P | 115 | +0.177 | +0.129 | +1.5 |

Il meccanismo **esiste** — non è la monetina del centravanti alto (§5-terdecies) — ed è **piccolo**: 1.5 minuti
su 90 valgono 0.017 di standing, mentre un ballottaggio vero si gioca su divari dieci volte tanto.

**GRIGLIA PRE-REGISTRATA** (`sweep.GRIDS["quality_weight"]`), centrata sul valore misurato sopra, con 0.05 =
tre volte quel valore come tetto e **un solo passo negativo**; 0 è nella griglia ed è l'incumbent:

```
quality_weight ∈ (−0.01, 0.0, 0.01, 0.017, 0.025, 0.035, 0.05)
```

**Prima previsione, scritta prima di eseguire**: che il canale passi *robust* su una piattaforma e non
*strict*, con un guadagno sotto la soglia dello 0.5% — perché sposta 0.017 di standing su una quantità la cui
deviazione tipica è dieci volte maggiore. Se invece vincesse un estremo della griglia, **non si adotta**: la
regola «un parametro non si adotta al bordo della griglia» è già costata una volta (§7-septies), e allargarla
dopo aver visto la curva è l'altro modo di fittare.

**Nota di applicabilità**: la misura è INFRA-stagionale (andata → ritorno) mentre lo sweep giudica il canale
FRA stagioni (input → target). Sono due affermazioni diverse e la seconda è più debole: fra una stagione e
l'altra cambiano allenatore, rosa e ruolo. È esattamente ciò che lo sweep deve dire.

### ESITO (eseguito il 6 agosto 2026, `data/reports/sweep_presence.json`) — **FALSIFICATA**

| piattaforma | finestre | strict | robust | vincitore pooled | guadagno medio | peggiore |
|---|---:|---|---|---|---:|---:|
| euro | 4 | **no** | **no** | **0.0** (l'incumbent) | 0.00% | 0.00% |
| default | 6 | **no** | **no** | **−0.01** | **−0.096%** | −0.291% |

**Nessuna finestra sceglie un peso positivo.** Su euro tutti e quattro i fold cross-fittano a 0.0 e lo zero
esce **confermato** con un margine di 0.00094 sul secondo (confermare non è «non ho trovato niente»). Su
default quattro fold su sei scelgono il passo **negativo** e due lo zero. La curva pooled sale in modo
monotòno col peso su entrambe le piattaforme — euro 0.2012 → 0.2054, default 0.20296 → 0.20732 da 0 a 0.05 —
cioè il bonus di qualità **peggiora** la previsione delle titolarità, e peggiora tanto più quanto è grande.

**La previsione pre-registrata era sbagliata**, e nella direzione prudente: avevo scritto «robust su una
piattaforma, sotto la soglia dello 0.5%», e invece non passa da nessuna parte. Vale la pena tenerlo scritto:
un effetto INFRA-stagionale reale (r parziale +0.100) **non si trasferisce** fra stagioni, che è precisamente
il rischio che la nota di applicabilità aveva dichiarato prima di eseguire. Fra giugno e agosto cambiano
allenatore, modulo e concorrenti: quello che l'allenatore ha imparato guardandolo non sopravvive all'estate.

**Non si adotta nulla, in nessuna delle due direzioni.** Il vincitore su default è −0.01, che è il **bordo**
della griglia: la regola «un parametro non si adotta al bordo» vale anche quando il segno è quello che non ci
aspettavamo, e allargare la griglia adesso sarebbe fittare dopo aver visto la curva. Se qualcuno vuole
inseguire la reversione fra stagioni, è una pre-registrazione nuova.

`quality_weight` resta **0.0** nel codice: il canale rimane, spento e raggiungibile dall'harness, come ogni
ipotesi falsificata di questo progetto (R4, R10, R8).

## 7-undecies. LA STIMA DI RIPIEGO MESSA ALLA PROVA (pre-registrata il 5 agosto 2026, sera)

La cascata di `engine/estimate.py` esiste per una regola di prodotto («ogni calciatore DEVE avere il suo
SURPLUS»), non ha passato nessun gate e **non può passarne uno come una regola**: non predice meglio, dà un
numero dove non ce n'era. Ma da stasera **ordina la lista d'asta**, e quello sì è misurabile sul passato: su
una finestra conclusa si sa chi ha reso.

### La domanda, e perché è sul DELIVERABLE e non sulla fantamedia
Sulla fantamedia la risposta è già nota e negativa: R1 e R13c hanno provato a prezzare chi non ha storico e
hanno perso contro l'àncora (§7-octies). Qui la domanda è un'altra: **la lista top-10 per ruolo migliora o
peggiora** quando gli stimati concorrono? È la stessa metrica con cui è stata giudicata la pressione di
reparto (`metrica-asta-surplus-v1.md` §11): il **VALORE catturato** dai dieci nomi predetti contro quello dei
dieci migliori realmente, più i nomi in comune.

### Il protocollo, fissato prima
Per ogni finestra usabile e per entrambe le piattaforme, la stessa vista **due volte** — `auction_view` senza
stime e con stime — e si riportano, per ruolo e in aggregato: `captured` (SURPLUS e VALORE), `hits`, quanti
stimati entrano nella top-10 e **come hanno reso** (il loro surplus reale, che per una finestra passata
esiste). Le stime sono costruite dallo stesso layer che usa il pannello, con i parametri della finestra: la
cascata non vede il futuro perché legge solo stagioni ≤ input e l'aggregato dell'altra piattaforma della
STESSA stagione di input.

### I criteri, dichiarati adesso
1. **Non-danno, che è la condizione vera**: gli stimati restano nella classifica solo se il VALORE catturato
   **non peggiora** sulla maggioranza delle finestre e **nessuna** finestra perde più del **2%** — lo stesso
   `MAX_WINDOW_LOSS` del verdetto robusto. Se peggiora, la conclusione è che stanno **scalzando** uomini
   migliori e la lista torna a ordinare solo i prezzati, con le stime come colonna di riferimento.
2. **Guadagno, se c'è**: si riporta di quanto migliora, senza pavimento, perché qui non si adotta un
   coefficiente — si decide se mostrare o nascondere righe che esistono comunque.
3. **La scala delle penalità è giudicata dallo stesso numero**: se la confidenza fosse tarata male, gli
   stimati entrerebbero troppo (danno) o mai (inutile), e il conteggio di quanti entrano lo dice.
⚠️ Dichiarato anche il limite: una finestra passata ha il listone completo, quindi la popolazione «il core non
lo prezza» è **più piccola** che in agosto (283 su 629 sul foglio di oggi). La misura è quindi un **pavimento**
di quanto la cosa conta all'asta vera, non la sua taglia.

### ESEGUITA il 5 agosto 2026 — le stime NON entrano in classifica (`data/reports/estimates_check.json`)

`python -m euroleghe_ingest estimates` (comando nuovo, read-only). La stessa vista due volte su ogni finestra:

| finestra | stimabili | SURPLUS catturato senza → con | Δ | stimati nella top-10 | nomi in comune |
|---|---|---|---|---|---|
| Tm7 | 390 | 1312 → 1298 | **−1.02%** | 4 | 17 → 17 |
| Tm6 | 382 | 1141 → 1115 | −2.32% | 3 | 19 → 18 |
| Tm5 | 437 | 788 → 756 | −4.07% | 6 | 12 → 11 |
| Tm4 | 516 | 1054 → 775 | **−26.48%** | 20 | 17 → 12 |
| Tm3 | 478 | 1142 → 1004 | −12.11% | 10 | 20 → 18 |
| Tm2 | 520 | 917 → 639 | **−30.34%** | 16 | 14 → 9 |
| Tm1 | 456 | 663 → 563 | −15.03% | 9 | 15 → 13 |
| T0 | 394 | 910 → 789 | −13.37% | 12 | 19 → 14 |
| T1 | 367 | 646 → 581 | −10.07% | 14 | 14 → 12 |
| T2 | 354 | 755 → 685 | −9.25% | 11 | 16 → 14 |

**Peggiora su 10 finestre su 10**, media **−12.40%**, peggiore **−30.34%**, e i nomi in comune scendono con
esso. Il criterio 1, scritto prima, era «non peggiora sulla maggioranza e nessuna finestra sotto −2%»: **non
soddisfatto in nessuna delle due metà**. Verdetto: **gli stimati escono dalla classifica**.

Su **euro** la stessa corsa dà **0 stimabili su ogni finestra** e quindi un +0.00% che **non è un PASS**: là R0c
è adottata e il core prezza tutti, quindi non c'era niente da misurare. Vale come promemoria: una finestra senza
popolazione non conferma niente, e il report lo dice invece di stampare una spunta.

### Cosa resta, e perché non è una marcia indietro
La regola dell'operatore («ogni calciatore DEVE avere il suo SURPLUS») è soddisfatta dove serve: **ogni riga ha
un numero** (foglio e tabella rosa, marcato `~`), e la lista d'asta **offre** gli stimati come lista propria,
sotto i dieci misurati. Quello che la misura ha rifiutato non è l'esistenza del numero: è che un numero
ricostruito **scalzi** un uomo che qualcuno ha misurato. E i casi lo mostrano uno per uno — Douglas Luiz
previsto +28.6 → **−3.2 reale**, Walker +13.6 → −0.4, De Silvestri +13.8 → +0.9, Rugani +13.3 → **non ha mai
giocato**; e non tutti sbagliati, perché McTominay +16.0 → **+50.2** e De Gea +35.0 → +32.6. Media negativa,
varianza enorme: esattamente ciò che una lista d'asta non vuole nelle prime dieci.

### DECISIONE DELL'OPERATORE, presa col numero davanti (5 agosto 2026)
«Stimati e misurati vanno insieme ma aggiungiamo la possibilità di **filtrare** gli uni e gli altri.» La misura
sopra resta quella che è e non viene nascosta: mettere gli stimati nella stessa classifica **costa** — 10
finestre su 10, media −12.40%. L'operatore ha scelto di vederli insieme sapendolo, e il filtro è ciò che rende
la scelta **reversibile a ogni sguardo** invece che a ogni build: `auction_view(..., include=)` con
`all` | `measured` | `estimated`, tre liste costruite nella stessa passata (è aritmetica su dati già
preparati, quindi il filtro è istantaneo). Due vincoli restano non negoziabili e sono nel codice: **ogni cifra
del blocco è calcolata dalla lista che il filtro produce** (è la lezione qui sotto), e il **gate non passa mai**
`estimates`, quindi nessun numero pubblicato si muove — `backtest --verify` 22/22.

### Lezione di metodo, e ha morso subito
La prima implementazione univa gli stimati alle righe **mostrate** e lasciava `captured`/`hits` sulla lista
gatata: lo schermo metteva un uomo stimato al 4° posto e le statistiche si comportavano come se non ci fosse,
producendo **+0.00% su dieci finestre su dieci**. Una lista mostrata le cui metriche descrivono un'altra lista è
peggio di nessuna metrica, perché *sembra* misurata. Ora la lista scelta è una e ogni numero del blocco viene da
lei.

## 7-decies. L'FM-EQUIVALENTE DEI PORTIERI (pre-registrata il 5 agosto 2026)

Seguito dichiarato di §7-nonies. Due misure fatte **prima** di scrivere questa sezione, perché decidono la
forma e lo scopo:

1. **Il fantavoto di un portiere è un'identità, non una stima.** Su **16.017** righe di `match_ratings` con
   entrambi i voti, su **entrambe** le piattaforme, `fantavoto = mv − gol_presi + 3·rigori_parati −
   0.5·gialli − rossi − 2·autogol + 3·gol + assist` ha residuo **0.000 nel 100% dei casi**. E il **bonus
   imbattibilità NON esiste**: residuo 0.000 anche sulle **4.872** partite chiuse a zero, mentre
   `config/scoring_config.json` dichiara `clean_sheet_bonus_gk: 1.0` (che `ratings._fantavoto` già
   esclude, con la sua nota di riconciliazione). Conseguenza per la forma: **serve un numero solo**, i gol
   presi — e non serve stimare i clean sheet, che era il pezzo che sembrava mancare.
2. **Dove quel numero esiste, e dove no.** I payload di statistica stagionale **già in cache** (5 leghe × 11
   stagioni) portano `goalsConceded` e `saves`: sono chiesti dal primo giorno (`positions.STAT_FIELDS`) e
   **buttati al parse**, perché `external_stats` non ha le colonne. Non esistono invece **per partita**: la
   cache delle giornate e quella di `recent_form` sono **distillate** e lo score è stato scartato, quindi i
   gol presi di una singola partita non sono ricostruibili offline. E non esistono **fuori dalle 5 leghe**:
   la Serie B non ha aggregato di stagione. ⚠️ **Quindi Daffara NON è coperto da questa sezione**: quello
   che gli manca sono i gol presi, non il voto, e riaverli è una richiesta di rete (lo score che oggi
   scartiamo), non un parse.

### La popolazione su cui agisce, dichiarata prima del verdetto
Perché «un parametro va giudicato sulla popolazione su cui agisce» (§7-sexies) e qui quella popolazione è
piccola: portieri in arrivo per stagione **17 / 60 / 85 / 69** (26/27 · 25/26 · 24/25 · 23/24), di cui con un
aggregato in una delle 5 leghe nella stagione di input **1 / 15 / 19 / 9**, e di questi una parte ha già una
fantamedia qui, quindi **il core li prezza e il tier non viene consultato** (1 / 8 / 12 / 5). Il residuo che
l'equivalente instrada davvero è dell'ordine di **4-7 uomini per stagione**. Un PASS qui non è un guadagno
grande: è un NULL in meno su pochi uomini, e va riportato così.

### La forma, fissata prima
    fm_gk_equiv = media(voto base sulle sue partite) − malus × (gol_presi / presenze) + 3 × (rigori_parati / presenze)
Il voto base è lo stesso degli altri (Mv euro reale dove il calendario euro copriva quella giornata,
altrimenti il `mv_synth` calibrato); i **gol presi e le presenze vengono dall'aggregato di CAMPIONATO**, cioè
numeratore e denominatore sulla stessa competizione («una quota di stagione è una quota del campionato»). I
rigori parati fuori dalle nostre leghe non sono nella fonte: il termine resta 0 dove manca, e la sua omissione
spinge l'equivalente verso il **basso** (≈0.005-0.02 di fantavoto), che è la direzione prudente.

### Validazione e criteri di falsificazione, dichiarati
Popolazione di prova: i portieri-stagione per cui l'equivalente è calcolabile **e** esiste una fantamedia
reale della stessa stagione — la stessa prova che ha bocciato la formula dei movimenti. Si riportano **bias**,
**MAE** e **quota entro 0.3**, contro due nulli: la formula dei movimenti (che oggi per un portiere è NULL, e
misurata dava +1.06/+1.08/+1.12 con **0%** entro 0.3) e l'**àncora di ruolo** (la risposta banale: la
fantamedia media dei portieri di quella stagione).
Entra al posto del NULL **solo se**: |bias| ≤ **0.20** su ogni stagione misurata · **MAE migliore
dell'àncora** sulla maggioranza delle stagioni · quota entro 0.3 ≥ **40%**. Altrimenti i portieri restano
NULL e il motivo viene scritto qui.

### ESEGUITA il 5 agosto 2026 — PASSA su entrambe le piattaforme, e di larga misura

`platform='euro'`, **201 portieri-stagione** misurabili:

| stagione | n | bias | MAE | entro 0.3 | formula movimenti: bias | MAE | entro 0.3 | àncora MAE |
|---|---|---|---|---|---|---|---|---|
| 2019-20 | 27 | −0.179 | 0.191 | **89%** | +0.950 | 0.950 | 0% | 0.214 |
| 2020-21 | 34 | −0.041 | 0.104 | **100%** | +1.085 | 1.085 | 0% | 0.235 |
| 2022-23 | 33 | −0.000 | 0.105 | **97%** | +1.101 | 1.101 | 0% | 0.294 |
| 2023-24 | 36 | −0.013 | 0.084 | **100%** | +1.216 | 1.216 | 0% | 0.319 |
| 2024-25 | 35 | −0.061 | 0.100 | **97%** | +1.099 | 1.099 | 0% | 0.280 |
| 2025-26 | 36 | −0.057 | 0.095 | **100%** | +1.090 | 1.090 | 0% | 0.336 |

`platform='default'` (51 portieri-stagione, 8-9 per stagione): bias da **−0.018 a −0.121**, MAE **0.106-0.166**
contro l'àncora **0.278-0.346**, quota entro 0.3 **88-100%**. Tutti e tre i criteri soddisfatti su tutte le
stagioni di entrambe le piattaforme: |bias| ≤ 0.20 sempre, MAE migliore dell'àncora **6/6** su euro e **6/6**
su default, quota ≥ 40% sempre. **ADOTTATO**: `arrivals.keeper_fm_equivalent`, e i portieri non sono più
esclusi dall'FM-equivalente.

Tre letture che valgono più del PASS:
- **il bias è sempre NEGATIVO**, come la pre-registrazione prevedeva: manca il +3 dei rigori parati, che la
  fonte non pubblica. È la direzione prudente e la sua taglia (0.00-0.18) è coerente con 0-2 rigori parati in
  una stagione;
- **la formula dei movimenti riprodotta sugli stessi uomini dà +0.82…+1.22 con 0% entro 0.3**, cioè conferma
  su sei stagioni (e su una popolazione tripla) la misura che aveva escluso i portieri. Escluderli era giusto;
  quello che mancava era un numero, non un modello;
- **il guadagno vero è piccolo**, e va detto perché la sezione stessa lo ha dichiarato prima: gli arrivi che
  guadagnano un equivalente sono **1 / 15 / 19 / 8** (26/27 · 25/26 · 24/25 · 23/24) su 6550 righe di
  `arrivals`, il totale con equivalente passa da **2045 a 2128**, e di quei portieri una parte ha già una
  fantamedia qui, quindi il tier non li instrada. Donnarumma 5.162, Milinkovic-Savic V. 5.132, Hradecky 4.638:
  la scala è quella giusta, e la sostanza è che dove prima c'era un buco ora c'è calcio misurato.

⚠️ **Daffara resta NULL, e servono DUE cose, non una** — corretto il 5/08 sera, perché la prima stesura di
questa sezione ne dichiarava una sola e sarebbe stata una promessa falsa:
1. **i gol presi**, che esistono solo come aggregato di stagione delle 5 leghe (la Serie B non ne ha uno) e per
   partita non esistono più, perché la cache delle giornate e quella per giocatore sono **distillate** e lo
   score è stato scartato al momento di scriverle. Conservarlo quando lo si riceve è un campo che passa già
   dalle nostre mani, e non è retroattivo;
2. **un voto base convertibile**, che per la Serie B **il gate ha rifiutato** (§7-nonies: δ = −0.181, reale e
   battuto dall'àncora di ruolo, quindi `APPLY_OFFSETS = False`).
Quindi anche con lo score, un portiere di Serie B resta senza equivalente: la prima cosa da sola non basta, e
dirlo è il punto. Dove le due si incontrano è nelle **coppe** (Champions ha 98 uomini e uno scostamento che
passa il criterio) e nelle 5 leghe, dove però l'aggregato di stagione già copre il caso. Conclusione onesta:
i portieri fuori perimetro restano NULL **per due decisioni misurate**, non per un pezzo di codice mancante.

**Numeri pubblicati invariati**: `backtest --verify` **22/22** dopo l'adozione.

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

## 5-quaterdecies. Posizione EFFETTIVA contro posizione IN POTENZA (4 agosto 2026) — quattro misure piatte

Ipotesi dell'utente, e la formulazione è sua: «l'heatmap è un dato effettivo che certifica in che parte del
campo gioca il calciatore; le posizioni indicate da Sofascore sono indicative, perché magari in passato ha
ricoperto quel ruolo o perché in potenza può ricoprirlo. Due elementi che si completano, da considerare
entrambi con **pesi diversi**». Modello corretto, e questa sezione è la misura di quei pesi. Non è una regola
del motore (nessun `engine_*` cambia): decide **come il pannello dispone l'undici**, quindi il gate delle
finestre non c'entra e il giudice è un **riferimento esterno**.

### Il giudice, e perché non è «uomini in comune»
Le 20 formazioni tipo pubblicate della **stessa finestra dei dati** (SOS Fanta, metà 25/26). Due metriche:
- **linee** — per ogni uomo presente sia nel nostro undici tipo sia in quello pubblicato, la fonte lo disegna
  nella **stessa linea**? (193 giudicati). È la domanda affilata: punta o ala, mediana o trequarti;
- **fasce** — nelle liste pubblicate una linea corre dalla **destra alla sinistra** della squadra (verificato
  su Dumfries…Dimarco e Zortea…Miranda), quindi per ogni linea da quattro in su il primo nome è la fascia
  destra e l'ultimo la sinistra: **52 uomini di cui il lato è dichiarato da altri**.
Più l'invariante che non deve mai rompersi: 0 codici di fascia spaiati, 0 righe sbilenche, 0 righe oltre il
massimo, su tutti i **394 board**.

### Il segnale è VALIDO, ed è già estratto
Compito di previsione sui 52 uomini, una risposta per fonte, con la copertura perché chi risponde meno spesso
non è migliore per aver ragione quando risponde:

| fonte | corrette | copertura |
|---|---|---|
| la fascia del **primo codice** | 46/49 = **93.9%** | 49/52 |
| il **centroide** (`desc_side_measured`) | 46/47 = **97.9%** | 47/52 |
| la **banda dominante** del cloud | 45/46 = 97.8% | 46/52 |

Quindi: **la misura batte il codice** nel nominare una fascia, e il **cloud non batte il centroide**. Che è
esattamente quello che `lateral` fa da sempre — legge la misura **per prima** e tiene il codice solo come
guardia contro una contraddizione — su cui poggiano la targhetta e `across_bucket`. La heatmap è nel
tabellone, ed è nel punto in cui ha informazione che i dodici codici non possono esprimere: un centrale di
nome che ha passato l'anno sulla sinistra di una difesa a tre.

### I quattro tentativi di usarla altrove, tutti piatti o negativi
1. **riordinare i codici** con la misura (l'ordine è portante: il primo codice è il mestiere). Tre bracci:
   ordine del provider **172/193 = 89.1%**; misura che ordina *tutti* i codici 174/194 (+2, −1 a Pisa);
   misura che *declassa* solo una fascia smentita **172/193 (+0)**. Il +2 del braccio ampio non è separabile
   da un artefatto documentato: promuove il codice **centrale** di un'ala usata su **entrambe** le fasce
   (Pulisic `RW;LW;AM;ST` → `AM;ST;LW;RW`), lo smearing del baricentro di cui `lateral` avverte già, ed è
   tutto sulla Juventus mentre rompe Pisa. Due club su venti.
2. **pesare misura e codice per asse** (`HEATMAP_SIDE`, `HEATMAP_DEPTH`), ciascun codice **tirato** verso il
   punto misurato invece di sostituito. Griglia pre-registrata, 12 punti:

   | fascia | prof. | linee | | fascia | prof. | linee |
   |---|---|---|---|---|---|---|
   | 0.00 | 0.00 | **172/193 = 89.1%** | | 0.00 | 0.25 | 169 (−3) |
   | 0.25–0.75 | 0.00 | 172 (**+0**) | | 0.25–0.50 | 0.25 | 168 (−4) |
   | 1.00 | 0.00 | 170 (−2) | | 1.00 | 1.00 | **159 (−13)** |

   **Zero su entrambi gli assi**, per due ragioni diverse da tenere separate. La **profondità** non certifica
   ciò che le si chiede: mediana `avg_x` 10 per un portiere, 34 per un centrale, 47 per un terzino, 51 per un
   mediano — e poi **61 ala destra, 62 PUNTA CENTRALE, 63 ala sinistra**. I tocchi si accumulano dove uno
   *riceve* il pallone, quindi lassù punta e ala sono indistinguibili mentre terzino e centrale distano 13; il
   fit lineare su `LANE_DEPTH` lascia **0.33 di residuo, una linea intera**. Non è un segnale debole, è il
   segnale sbagliato. La **fascia** è piatta da 0 a 0.75 perché per gli uomini che vincono la maglia i codici
   dicono già quello che dice la heatmap.
3. **derivare la fascia dalle bande** (il peso come *concentrazione* del cloud, la statistica che separa
   l'ala bimodale dal centrale): 172/193 a 0.25 e 0.50, 173/194 a 0.75, 170 a 1.00. Sul disegno: riordina **2
   uomini su 246**, **0 forme cambiate** su 162 board, e **2 targhette su 1782** — e quelle due sono un
   peggioramento (Dybala e Soulé leggevano `As`/`Ad` invece di `T`/`T`).
4. **aggiungere a `sides_of` la fascia che la heatmap ha VISTO** (soglie 0.34/0.50/0.70/0.85): **piatto a ogni
   soglia**, 26/38 fasce e 172/193 linee. E qui c'è la spiegazione di tutta la famiglia: **quello che il
   codice PRIMARIO perde, la LISTA dei codici ce l'ha già**. Zé Pedro legge `DC;DR` con il 75% dei tocchi
   nella banda destra — la R **è** nei suoi codici, solo non per prima.

### Verdetto
**Pesi a zero su entrambi gli assi**, e la pipeline che le bande richiederebbero — migrazione di `positions`,
colonna d'ingest, colonna nel foglio — **non è giustificata dal disegno**. Nessun invariante si rompe a
nessun peso (0 rotture su 394 board a ogni punto della griglia): il disegno è **robusto al parametro**, e
quell'insensibilità è una proprietà da tenere, non una lacuna — nasce dal fatto che la regola 4a legge la
**linea** di un codice e non la sua fascia, e che `_paired` sistema il vocabolario a valle.
Le bracce restano raggiungibili (`HEATMAP_SIDE`, `HEATMAP_DEPTH`, `HEATMAP_FIRST` con i suoi tre valori) e i
numeri stanno nei commenti accanto a loro: un parametro che nessun harness raggiunge è un parametro che
nessuno può ri-misurare. Da rifare quando cambia il **dato**, non quando torna il dubbio.
E una cosa che questa misura **non** dice: che le bande siano inutili. Dicono che non spostano il **modulo**.
La domanda per cui erano nate — «copre davvero l'altra fascia?», cioè i ballottaggi e la riga dei rivali — ha
una metrica diversa e più debole (le fonti pubblicano i ballottaggi a singhiozzo) e non è stata aperta.

## 7-sexvicies. IL COEFFICIENTE DI CAMPIONATO SUI VOTI EURO (misurato l'8 agosto 2026, PRIMA di decidere)

**Domanda dell'operatore**: «per tutti i calciatori che non hanno giocato l'anno scorso per la Serie A, va
bene considerare i voti di EuroLeghe al netto di un coefficiente per il campionato diverso?»

**Metà della proposta è già in produzione, e l'altra metà è esattamente quello che a R1 manca.**
`arrivals.foreign_fm_equivalent` usa già il **voto euro REALE** dove esiste (`COALESCE(match_ratings.mv,
mv_synth)` su `platform='euro'`), convertito con lo scoring della lega d'arrivo: non è un voto sintetico, è
il voto di fantacalcio.it per le cinque leghe. Quello che non ha mai avuto è il **coefficiente**. E R1 così
com'è **è stata rifiutata due volte** (§3 il 27/07 su due finestre, §7-octies il 5/08 su sei con copertura
tripla): batte l'àncora di ruolo solo su 1 finestra di 6.

### Il coefficiente misurato: esiste per UNA lega su quattro

Popolazione: chi ha una stagione **euro** a t−1 (Pv ≥ 15) e una stagione **default/Serie A** a t (Pv ≥ 15).
Il null non è zero, è lo stesso salto per chi in Serie A c'era già — 547 casi, **−0.020**: la differenza fra
le due piattaforme, di suo, non sposta la fantamedia.

| origine | n | Δ(FM) medio | se | t contro il null |
|---|---|---|---|---|
| premier_league | 21 | **+0.619** | 0.170 | **+3.8** |
| ligue_1 | 23 | −0.157 | 0.122 | −1.1 |
| bundesliga | 13 | −0.084 | 0.182 | −0.3 |
| la_liga | 9 | −0.063 | 0.130 | −0.3 |

17 dei 21 casi Premier migliorano (Lukaku +2.27, Malen +2.10, Hojlund +1.20, McTominay +1.09); le altre tre
leghe sono indistinguibili dallo zero. **Conseguenza per il caso che ha generato la domanda**: G. Ramos
arriva dalla Ligue 1, quindi il coefficiente lo abbasserebbe di 0.16 invece di alzarlo. La sua fantamedia
bassa non è il campionato: è che il core legge **solo l'ultima stagione** e la sua è 6.23 (26 presenze, 5 gol
al PSG), mentre le due precedenti — 7.52 e 7.50 — non le legge nessuno.

### È la LEGA o il gradino di livello? Nessuna delle due, pulita

Sui 65 casi cross-lega con Elo su entrambi i club: r = **+0.279** fra gradino Elo e Δ(FM), pendenza **+0.19
di fantamedia ogni 100 punti**, e le bande sono monotone fino a +150 (−0.33 · +0.07 · +0.57). Ma la Liga ha
il gradino MEDIO più grande della Premier (+79 contro +55) e Δ(FM) −0.06: il gradino non spiega la Premier.
Con 65 casi in tutto, il segnale è al limite di ciò che il dato può portare.

### Perché non si adotta guardando questi numeri

- **Un offset per competizione può essere vero e non valere lo stesso**: già misurato una volta
  (§7-nonies), lo scarto di Serie B −0.181 taglia del 20% l'errore contro la retta nuda e **perde contro
  l'àncora di ruolo**, quindi `synth.APPLY_OFFSETS = False`. Essere reale non è battere la risposta banale.
- **Selezione**: Pv ≥ 15 su entrambi i lati esclude chi è arrivato e non ha giocato, cioè i flop. Il null
  ne assorbe una parte, non tutta.

### Pre-registrazione, se si decide di provarlo
Regola **R1c**: per chi non ha stagione sulla piattaforma bersaglio, `FM = FM euro(t−1) + coefficiente(lega
d'origine)`, coefficiente fittato **leave-one-window-out** e applicato solo dove il suo intervallo esclude lo
zero. Giudizio **sulla popolazione che tocca** (criterio 5, come ogni regola di copertura): batte l'àncora di
ruolo sul MAE della fantamedia, maggioranza delle finestre misurabili e media sopra lo 0.5%. Falsificazione
attesa, dichiarata prima: non la batte, perché la taglia del segnale sta sull'errore dei giocatori che tocca
e non sul coefficiente — è già successo con il coefficiente raddoppiato (0.186 → 0.431).

## 7-quinvicies. LA BOARD CONTRO L'ESITO, e i quattro candidati che ne sono nati (8 agosto 2026)

Un **secondo giudice** per le formazioni tipo, e il più severo dei due: non la previsione di terzi ma
**quello che i club hanno fatto**. `snapshot --season 2025-26 --date 2025-08-15` costruisce il foglio
come sarebbe stato al giorno d'asta, `press --sheet ... --against outcome` lo confronta con la forma
modale della stagione e i suoi undici uomini più schierati (`press.outcome_reference`).

**Il risultato, con il suo null** — perché 134 uomini su 220 non significano nulla finché «gli stessi
dell'anno prima» non è sulla stessa pagina (la regola del «right null» di §5-duodecies):

| | moduli | uomini |
|---|---|---|
| **BOARD** | 13 MATCH / 1 ALT / 6 DIFF | **137/220 (62%)** |
| NULL (gli undici più schierati dell'anno prima) | 9 / 2 / 6 | 104/220 (47%) |

La board batte la baseline su entrambi gli assi, e su tre club (i promossi) il null è muto per
costruzione mentre la board porta 20 uomini.

**Tre regole di misura che questa verifica ha imposto**, tutte imparate sbagliando:
1. **Quale delle due stringhe di forma si confronta lo decide la REFERENZA, non la preferenza.** La
   stampa scrive moduli a quattro numeri → si giudica sul `picture` dopo `_reshape`. L'esito è contato
   su `club_match_lineups`, che tiene TRE linee e non può dire 4-2-3-1: giudicato sul picture legge
   disaccordo ogni volta che la trasformazione ha spezzato una riga. Quell'artefatto valeva **5 club su
   20**, la differenza fra 7 MATCH e 12.
2. **Il 61-62% ha un tetto che non è il modello**: infortuni, mercato di gennaio, esoneri. Il Verona fa
   **2/11**. La referenza stampa di mid-season faceva 83% ma era informata di mezzo campionato.
3. **Il foglio retrodatato ha una contaminazione A FAVORE**: transfers e arrivi sono derivati oggi,
   quindi la board conosce tutto il mercato estivo 2025, che a metà agosto non era chiuso. Il 62% è un
   **limite superiore**. (I ruoli granulari, non backfillabili, sono usati e dichiarati dal foglio
   stesso; le probabili sono vuote e il `typical` non le legge.)

**QUATTRO CANDIDATI, TUTTI MISURATI E TUTTI RIFIUTATI.** Vale la pena elencarli perché tre sembravano
ovvi:

- **La CO-TITOLARITÀ** («due che non coesistono non si disegnano insieme»). L'ipotesi dell'operatore è
  vera SULLA COPPIA — Krstovic e Scamacca 2 co-start di 15/18 sulle 35 partite in cui erano entrambi
  disponibili, **0.13**, contro Lautaro Martinez e Thuram a **0.58** — e falsa come regola sul RUOLO.
  Il denominatore È la misura: contata su tutte le partite, ogni coppia separata da un trasferimento
  legge 0.00 (35 coppie sembravano così, 32 non avevano mai condiviso una rosa). Implementata come
  quarto override di mestiere, ha fatto quel che prometteva e **il giudice l'ha bocciata**: uomini
  164 → 162, Atalanta 7/11 → 6/11. **La stampa schiera Scamacca**, cioè l'uomo che la regola toglieva:
  scarta il claim più basso e sull'unico caso per cui esiste sbaglia metà. Il dato resta
  (`desc_costart_low`); serve un segnale su QUALE dei due ruotanti comanda, e il claim non lo è.
- **Il modulo del RITIRO** come quinta fonte di `shape_odds`. Copertura verificata prima di scrivere
  codice (1-3 undici completi per tutti i 20 club, dove il 2025-26 aveva Milan e Napoli a zero), poi
  griglia **pre-registrata** 0/0.15/0.30/0.45/0.60: moduli 11/11/11/11/11 e uomini 166/166/165/163/163.
  Ottimo **al bordo** e curva discendente. `PRESEASON_WEIGHT` = 0, come `HEATMAP_*`.
- **Il SURPLUS come discrimine di modulo** (proposta dell'operatore). Per il Napoli il 4-3-3 della
  stampa è il modulo col SUR più **basso** (18.2 contro 18.9). Scegliendo la forma per SUR su tutti e
  20 i club: **4 MATCH / 3 ALT / 13 DIFF** contro 11/5/4. Il SUR risponde a «quale modulo mi CONVIENE»,
  le odds a «quale SCEGLIERÀ l'allenatore»: due domande, e il selettore le mostra affiancate.
- **Il declino d'ETÀ oltre i 30**, e questo è il più istruttivo. Su 500 coppie (giocatore, stagione) con
  15+ start di Serie A in ingresso, su due stagioni, la quota di presenze mantenuta è **66% / 72% /
  77% / 51%** per fasce ≤23 / 24-26 / 27-29 / ≥30 — una U rovesciata, quindi una SOGLIA e non una
  tendenza (r lineare −0.139, parziale −0.122). Implementato come canale raggiungibile da entrambi gli
  harness e **rifiutato da entrambi**: `sweep` dà euro +0.23% con ottimo 30/0.09 AL BORDO e default
  +0.04% (nessuno raggiunge il floor 0.5%), il giudice-esito peggiora a ogni punto (134 → 132 uomini,
  13 → 12 moduli). **Il meccanismo**: i 30+ portano già meno minuti misurati (1299 contro 1574 dei
  27-29), quindi lo standing li sconta prima e il termine addebita due volte la stessa evidenza.
  ⚠️ **NON era R4**: R4 predice il FANTAVOTO, questa predice CHI GIOCA — le due domande che il progetto
  tiene separate — e la distinzione regge, ma la risposta è comunque no.

**La regola generale che ne esce, e vale più dei quattro verdetti**: *una differenza fra due gruppi non
è un canale finché non si è verificato che il modello non la stia già leggendo.* La tabella per fasce
d'età non controllava per i minuti; il modello sì.

**E due candidati rifiutati senza scrivere codice**: scontare il claim per la disponibilità (il claim è
«la squadra con tutti sani» per scelta di design — misurato, 132/220 contro 134 e un modulo in meno, la
scelta regge anche contro il giudice più severo), e allargare l'acquisizione (86 su 86 degli uomini
mancati erano GIÀ sul foglio: il perimetro non è il problema, l'ordinamento sì).

**Un canale che invece NON è misurabile e si chiude per questo**: il salto di livello di chi ha giocato
altrove **senza cambiare club di listone** (prestiti, promozioni). Popolazione contata: **3, 3, 7, 5**
uomini nelle quattro stagioni bersaglio su 1175-1558 quotati, lo 0.2-0.5%. Nessun MAE su mille
giocatori si muove per cinque uomini: non è una voce da fare, è una voce che nessun harness può
giudicare, e per la regola d'oro non è adottabile.

---

## 7-septvicies. LA STORIA PLURIENNALE SU SERIE A: R18b e R18c pre-registrate e RESPINTE, e perché il +1,9% di R18 era rumore (10 agosto 2026)

**Domanda dell'operatore**, e ha ragione lui sul fatto: «non mi faccio capace che tra un calciatore che
nelle ultime 5 stagioni ne sbaglia una e uno che nelle ultime 5 stagioni gioca l'ultima bene non ci sia
differenza» — e sul foglio Serie A (`default`) differenza non c'è, perché il core legge solo `fm_prev`.
R18 («una carriera non è una stagione»: ultima stagione E media quinquennale, entrambe ritirate verso
l'ancora di ruolo) è adottata su `euro` e **non** su `default`.

### (a) Il fatto è vero e misurato, prima di qualunque regola

Su `default`, stagioni con pv ≥ 15: chi ha quattro annate buone e sbaglia l'ultima **recupera +0,33** di
fantamedia la stagione dopo (n = 38); chi ha quattro annate mediocri e azzecca l'ultima **restituisce
−0,51** (n = 26). La stagione dopo sta **in mezzo** fra l'ultima e la base: vale 0,3-0,5 di fantamedia,
cioè 9-15 fantapunti. L'intuizione dell'operatore è corretta; il problema è come leggerla.

### (b) R18 su `default`: 8/9 finestre, media +1,9%, e Tm5 a −4,6%

Ricorsa del gate a dieci finestre (log della corsa del 10/08/2026): su `default/classic` R18 vince **8
finestre su 9** con media **+1,9%**, e la peggiore è **−4,6%** — è Tm5 (2017-18 → 2018-19). Robust non
tiene per la soglia della finestra peggiore (−2%), strict nemmeno. Su `default/mantra`: 5/9, +1,1%,
peggiore −4,6%. Su `euro` R18 resta adottata, **e le cinque finestre misurabili là escludono proprio
Tm5** — l'unico fallimento noto della regola non è osservabile dove la regola è in produzione. Va detto
così, invece di leggerlo come conferma.

### (c) La diagnosi: la SOMMA delle due lambda è stabile, la RIPARTIZIONE non è identificata

Letto dai parametri fittati della corsa stessa, finestra per finestra (`history_lam` = coppia
ultima-stagione / media-quinquennale):

- **somma**: media **0,662**, minimo 0,369, massimo 0,826 — sd/media **21%**. Stabile.
- **rapporto media5 / ultima**: da **0,13** a **41,38**. Non identificato in alcun senso utile.

Cioè: i dati sanno *quanto* pesare la storia in totale, e **non sanno come dividerla** fra «l'anno scorso»
e «i cinque anni». Il +1,9% era in buona parte il fit che comprava quella libertà — una finestra alla
volta, con un parametro che cambia di due ordini di grandezza fra finestre adiacenti.

### (d) Le due forme pre-registrate, e il loro esito

Scritte PRIMA di misurarle, per togliere al fit quella libertà:

- **R18b** — la storia scontata per recenza, con decadimento **dichiarato** d ∈ {0,50, 0,70, 0,85}
  (`model.HISTORY_DECAYS`, `weighted_history`): una lambda sola su una media pesata, invece di due.
- **R18c** — lo split **dichiarato** w ∈ {0,50, 0,65} fra ultima e media (`model.HISTORY_SPLITS`).

Verdetti (target VALUE MAE, `default/classic`; fra parentesi `default/mantra`):

| candidato | finestre vinte | media | peggiore |
|---|---|---|---|
| R18b50 | 4/9 (4/9) | +0,3% (+0,4%) | −0,8% (−0,5%) |
| R18b70 | 5/9 (5/9) | +0,3% (+0,4%) | −0,8% (−0,5%) |
| R18b85 | 5/9 (5/9) | +0,3% (+0,4%) | −0,8% (−0,5%) |
| R18c50 | 3/9 (4/9) | +0,3% (+0,4%) | −0,8% (−0,5%) |
| R18c65 | 3/9 (4/9) | +0,3% (+0,4%) | −0,9% (−0,6%) |

**Tutte respinte**: nessuna arriva al pavimento dello 0,5% sulla media, e nessuna vince la maggioranza in
modo convincente. Il dato interessante è che il guadagno **crolla da +1,9% a +0,3/0,4% appena lo split è
dichiarato invece che fittato**, che è esattamente ciò che la diagnosi (c) prevedeva: quel +1,9% non era
la storia pluriennale, era la libertà di ripartirla.

### (e) Le forme di SINTESI, misurate per non riprovarle

Su chi ha cinque stagioni piene più la sesta (n = 263 `default`, 121 `euro`), MAE grezzo nel predire la
sesta:

| sintesi | MAE |
|---|---|
| ultima stagione | 0,3802 |
| media 5 | 0,3437 |
| **media troncata** (via la migliore e la peggiore) | **0,3425** |
| mediana | 0,3436 |

Test appaiato trim contro media5: **−0,0012 ± 0,0077**, indistinguibile da zero. Il **trim non aggiunge
niente** come predittore — e il trim è la regola generale dell'operatore («quando calcoliamo una media per
valutare qualcosa, scartiamo il più alto e il più basso, se i campioni sono almeno 5»), che resta valida
come **robustezza dichiarata** per le statistiche descrittive e NON come miglioramento misurato: dove
tocca una previsione, serve il gate. Prima applicazione descrittiva: il margine di calendario di
`fixtures.easy_matches`.

Il salto vero è passare dall'ultima stagione a **qualunque** sintesi pluriennale (0,3802 → ~0,343). E un
dettaglio che spiega la coda di R18: **l'ultima stagione è il predittore più spesso più VICINO (37%) pur
avendo il MAE peggiore** — quindi pesare troppo il passato sbaglia di poco su molti e di molto su pochi,
che è il profilo che fa cadere una finestra intera.

### (f) Cosa resta aperto, e cosa NON va riproposto

- **Aperta**: mostrare `FM 5a` e il numero di stagioni sulla riga d'asta — evidenza al decisore, zero
  gate, nessun riordino. Proposta il 10/08 e **rinviata dall'operatore** («per il momento non fare
  niente»): [todolist-draft-v1.md](todolist-draft-v1.md) item 2.4.
- **Non riproporre** senza rileggere questa sezione: R18 su `default` in qualunque forma a due lambda
  libere, R18b, R18c, e il trim come predittore. Il codice dei candidati resta in `evaluate.py`
  (`R18B_DECAYS`, `R18C_WEIGHTS`, `history_lam_b/_c`) perché una forma respinta si documenta col suo
  strumento, non cancellandolo.
- `ADOPTED` non cambia, `backtest --verify` resta 22/22.

## 7-octovicies. IL COLLO DI BOTTIGLIA È `pv_pred`, MISURATO SU CINQUE FINESTRE — e la pre-registrazione del Qt.I sul lato PRESENZE (10 agosto 2026, sera)

Chiude gli item **2.1 e 2.2** di [todolist-draft-v1.md](todolist-draft-v1.md). Il primo era una conclusione
su **T2 sola** e adesso è una conclusione; il secondo è una pre-registrazione e non una misura, ed è scritta
qui prima di toccare una riga del motore.

### (a) Quale metà della previsione porta la graduatoria — cinque finestre, due letture

Banco: `toolkit/bench/draft/signal.py` sulle cinque finestre euro/mantra del gate, bersaglio = i fantapunti
VERI della stagione (`fm_act × pv_act`), lettura su RANGHI (Spearman) perché la domanda è su come si ordina
una lista d'asta, con Pearson accanto.

| segnale | Tm4 | Tm3 | T0 | T1 | T2 | media | batte l'altra metà |
|---|---|---|---|---|---|---|---|
| **`pv_pred`** | +0,383 | +0,413 | +0,469 | +0,489 | +0,539 | **+0,459** | **5/5** |
| `fm_pred` | +0,246 | +0,243 | +0,248 | +0,276 | +0,280 | +0,259 | 0/5 |
| `value` = fm × pv | +0,426 | +0,453 | +0,529 | +0,522 | +0,567 | +0,499 | — |
| Qt.I | +0,467 | +0,545 | +0,639 | +0,616 | +0,602 | **+0,574** | — |
| `fm_prev` | +0,313 | +0,338 | +0,375 | +0,457 | +0,465 | +0,390 | — |

In Pearson lo stesso ordine e le stesse distanze (`pv_pred` +0,465, `fm_pred` +0,303, valore +0,514, Qt.I
+0,545): **il divario non è un fatto sulle code, è il segnale.** Due controlli che rendono la tabella
citabile: i due numeri che la todolist riportava da T2 (+0,545 e +0,313) sono esattamente la colonna T2 di
Pearson, e Qt.I +0,545 / valore +0,514 riproducono il §15.6 punto 2 di
[metrica-asta-surplus-v1.md](metrica-asta-surplus-v1.md), che era stato misurato da un'altra strada.

La decomposizione della varianza, misurata qui per la terza volta e da un terzo angolo: `Var(ln pv)` è
l'**86,8%-90,6%** di `Var(ln fantapunti)` su tutte e cinque le finestre (`Var(ln fm)` sta fra 0,012 e 0,019
contro 0,45-0,76). Non è un'altra prova della stessa cosa: è la stessa conclusione raggiunta da correlazione
e da varianza, e quando due strade indipendenti danno la stessa risposta la conclusione è più solida di
entrambe.

**Conseguenza sull'ORDINE del lavoro, che è tutto quello che questo item chiede:** un punto guadagnato su
`pv_pred` vale più di tre su `fm_pred`, quindi una regola candidata che tocca le presenze merita il gate
prima di una che tocca la fantamedia, a parità di plausibilità. Non è un criterio nuovo e non cambia nessun
verdetto: cambia la coda.

### (b) PRE-REGISTRAZIONE: il Qt.I come segnale di TITOLARITÀ, e solo lì

Scritta **prima** dell'implementazione, come vuole il protocollo. Il fatto che la motiva è nella tabella
sopra: il Qt.I ci batte nel classificare su tutte e cinque le finestre (+0,574 contro +0,499 del nostro
valore, 5/5 sui ranghi) e la metà dove siamo deboli è quella delle presenze.

**Ipotesi.** Il Qt.I incorpora l'opinione del suo autore sulla TITOLARITÀ del giocatore, che è informazione
sul lato `pv` e non sul lato `fm`. R12 e R12b sono falsificate **sul lato FANTAMEDIA** («il mercato non
aggiunge nulla alla fantamedia precedente: è costruito sulla stessa storia», 4/10 e 5/10, λ≈0): il lato
presenze non è mai stato misurato, quindi non è un'idea già respinta ed è la sola faccia del prezzo che resti
in piedi.

**Forma.** Un termine sul solo `pv_pred`, sul percentile del Qt.I DENTRO IL RUOLO E DENTRO IL LISTONE (il
pool di un percentile è parte della misura: le due piattaforme non sono proporzionali), come shrinkage verso
la titolarità che il prezzo implica. Peso su griglia pre-registrata {0, 0,03, 0,06, 0,10, 0,15}, un parametro
solo, cross-fit leave-one-out come ogni altra costante.

**Criteri, e sono quelli che esistono già.** Strict e robust affiancati, pavimento 0,5% sulla media, nessuna
finestra sotto −2%; MAE complessiva mai peggiore; **e il giudizio anche sul DELIVERABLE** (`captured_value` e
i nomi catturati), perché il gate vincola la consegna e non solo l'errore. Un optimum al bordo della griglia
non si adotta.

**Tre cose dichiarate prima, perché dopo non valgono.**
1. La regola dell'operatore («la quotazione quando non abbiamo altre risorse oggettive») è una **precedenza,
   non un divieto**: se passa, il termine va DOPO le risorse misurate e non al posto loro — e la prima cosa da
   provare a spostare resta la COPERTURA della risorsa misurata, direzione che ha già due conferme (§7-sexies).
2. C'è un rischio di circolarità **specifico e diverso** da quello di R12: il Qt.I è scritto da chi guarda le
   stesse formazioni tipo che il nostro `standing` legge. Se il termine passa, va misurato quanto del suo
   guadagno sopravvive a controllare per i minuti già in mano — la lezione di `level_gap` (§7-duovicies): un
   segnale si giudica contro l'ESITO controllando per quello che è già noto, mai contro il residuo di un
   modello che quella conoscenza contiene.
3. Se passa, passa **per piattaforma**: `default` e `euro` hanno listoni diversi e su 249 italiani quotati in
   entrambi i Qt.I discordano su 202.

**Stato: pre-registrata, NON misurata.** Nessuna riga di codice del motore è stata scritta per questa.

## 7-novemvicies. «CHI CAMBIA SQUADRA VA RIMODULATO SUL REPARTO NUOVO»: il PASSO non regge, il LIVELLO non è del trasferimento (16 agosto 2026)

**L'ipotesi dell'operatore**, dal caso Gila: arriva al Milan dalla Lazio, e la sua fantamedia è quella di
un difensore della Lazio; siccome il reparto del Milan è parso più solido, i suoi difensori ne hanno
beneficiato e ne beneficeranno. Misurata **prima** di scrivere una riga, come chiede la regola d'oro.

**Disegno.** 284 uomini con due stagioni consecutive misurate su `default` e club diverso. Per ognuno il
livello del reparto che LASCIA e di quello che lo PRENDE — la fantamedia media dei suoi pari ruolo in quel
club, quell'anno, **lui escluso** — e il passo fra i due. Il segnale si giudica contro l'ESITO (la
fantamedia dell'anno dopo) **controllando per la sua fantamedia precedente**, che è la lezione di
`level_gap` (§7-duovicies).

**Verdetto: il passo non vale niente.** r parziale **−0,010** su 284. Per ruolo: D +0,113 (n=113),
C −0,092 (n=134), A −0,021 (n=37). E il controllo che chiude la questione: il quinto che SALE di più
(passo medio +0,58) l'anno dopo **perde 0,121** di fantamedia, il quinto che scende ne guadagna 0,015 —
direzione opposta all'ipotesi, quasi certamente ritorno alla media.

**Quello che invece esiste, e non è del trasferimento.** Il LIVELLO del reparto in cui uno gioca correla
+0,270 con la sua fantamedia dell'anno dopo a parità di quella precedente — ma per chi **non** cambia
squadra vale **+0,255**. Cioè è un fatto generale sul club, uguale per tutti, e non un effetto
dell'arrivo. Prima di trasformarlo in un canale va misurato contro il RESIDUO del motore e non contro la
fantamedia grezza: `engine_fm_pred` contiene già canali di club, e il +0,27 potrebbe essere per intero
roba che il motore sa già.

**Che cosa è stato fatto invece, e senza toccare il motore**: l'Overall dell'app si basa ora su `FM att.`
(`letture-app-v1.md` §2), che è il modo di ereditare tutto quello che il motore sa di club e trasferimenti
senza inventare un canale nuovo. Su Gila vale +10 punti di Overall — e va detto che il motore stesso lo
alza solo di 0,07 di fantamedia, cioè neanche lui rimodula.

## 7-tricies. IL RIENTRO DA UN LUNGO INFORTUNIO: la FANTAMEDIA non cala, e le PRESENZE sono pre-registrate (16 agosto 2026)

**Il caso che ha aperto la domanda** (operatore): Berisha M., mai più di 15 presenze in carriera (6, 15,
13), **quattro stop muscolari di cui due da 101 giorni consecutivi**, rientrato 46 giorni prima dell'asta
— e il motore gliene prevede **21,2**, sei più del suo massimo assoluto. Sul metro di popolazione: chi ha
il 25-35% degli ultimi tre anni fuori (lui è al 28%) l'anno dopo gioca in **mediana 15** partite e solo il
**28%** ne supera 21.

Prima di chiamarlo difetto è stato misurato quanto sia generale: **35 quotati su 321 (10%) hanno una
previsione sopra il loro massimo in carriera**, con uno sforo medio di +4,7 — e i primi della lista sono
ragazzi con un massimo di 1-5 partite a cui il motore ne prevede 17-18, il che è GIUSTO. I giorni di
infortunio di chi sfora tanto (133) sono quasi identici a quelli di tutti gli altri (117), quindi
prevedere sopra il massimo non è di per sé un difetto del canale infortuni. Quello che distingue Berisha è
la **combinazione**: sfora di 6 ed è a 316 giorni fuori in tre anni.

### La FANTAMEDIA: misurata e RIFIUTATA

L'operatore ha chiesto anche l'altra metà — «di quanto peggiora la FM di chi torna, vedi Chiesa o Insigne
o De Bruyne». Disegno: per ogni stop CHIUSO di 60+ giorni, la media del fantavoto nelle **8 partite prima**
contro le **8 dopo il rientro**, con le date dal layer per partita e il fantavoto da `match_ratings`.

| | |
|---|---|
| 310 rientri da 60+ giorni | FM prima **6,142** → dopo **6,099** = **−0,043** |
| il NULL (stesse persone, due finestre adiacenti SENZA infortunio in mezzo, 6.761 coppie) | **−0,010** |
| **eccesso attribuibile al rientro** | **−0,034** |

Mediana esattamente **0,000**, e peggiora nel **49%** dei casi: una monetina. **Il rientro non tocca la
fantamedia**, e nessun canale deve farlo.

I tre nomi citati esistono davvero — Chiesa **−0,44** dopo 270 giorni, De Bruyne **−1,25** dopo 129 — e
sono la coda, non la regola: memorabili proprio perché estremi. Stessa famiglia dell'attaccante alto
(48%, §5-terdecies): una credenza calcistica vera su tre casi e falsa sulla popolazione.

### Le PRESENZE: canale pre-registrato, spento

`presence.return_recency_days` / `return_recency_weight`, coppia (finestra, peso) perché col peso a zero
la finestra non è identificabile — stesso argomento di `arrival_split` e `age_decline`. L'effetto decade
linearmente dal giorno del rientro al bordo della finestra, si somma agli infortuni invece di sostituirli
(sono due fatti diversi: quanto si è fatto male, e da quanto è tornato) e resta sopra
`availability_floor`. Il dato è `desc_injury_days_since_return`: la fine dello stop chiuso più recente che
gli sia costato **almeno una giornata** — la condizione serve a non chiamare «rientro» un'influenza di tre
giorni.

Griglia: `(90, 0)` incumbente, poi finestre 60/90/120 giorni per pesi 0,05 / 0,10 / 0,20 di stagione (due,
quattro, otto giornate). A senso unico verso l'alto sul peso, e non è un modo di non testarla: il
contrario — «chi è appena rientrato gioca di più» — non lo propone nessuno, e il rifiuto lo esprime lo 0,
che è nella griglia ed è l'incumbente. Giudicata sulle **presenze**, non sugli starts: la domanda è quante
ne gioca, non chi il tecnico sceglie.

### Il verdetto dello sweep (16/08/2026): NON ADOTTATA, per due ragioni indipendenti

| | euro/classic (4 finestre) | default/classic (6 finestre) |
|---|---|---|
| migliore pooled | `120/0.1` | `120/0.05` |
| cross-fit | **unanime**, 4 fold su 4 | **spaccato**: 3 fold su 6 scelgono lo 0, cioè SPENTO |
| guadagno medio | **+0,56%** | **−0,16%** |
| finestra peggiore | −0,08% | −0,93% |
| strict / robust | no / **sì** | no / no |

**Uno**: fallisce su `default`, che è la piattaforma del caso che l'ha generata — Berisha gioca in Serie A.
Mezza griglia dei fold sceglie l'incumbente, cioè il canale spento, e il guadagno medio è negativo. Un
canale nato da un caso e rifiutato proprio sulla piattaforma di quel caso non si adotta perché passa
altrove.

**Due**: dove passa (euro, robust), il punto vincente è **al bordo della griglia** sulla dimensione della
finestra — 120 giorni di 60/90/120 — e la regola di casa è che *un parametro non si adotta al bordo della
sua griglia*. È la stessa ragione per cui il canale dell'investimento condizionale rimase a zero pur
passando robust su Serie A. Il peso invece è interno (0,1 fra 0,05 e 0,2), quindi il difetto è di una
dimensione sola.

**Follow-up pre-registrato**, e va fatto prima e non dopo aver visto la curva: griglia allargata sulle
finestre (150, 180, 240 giorni) su euro. Se l'ottimo resta al bordo anche lì, la lettura non è «serve una
finestra più lunga» ma «questo canale sta misurando qualcos'altro» — probabilmente il fatto che uno stop
recente e lungo è anche un indicatore di quanti giorni ha già perso, che `injury_weights` legge di suo.

### Il follow-up ESEGUITO (16 agosto 2026, sera): l'ottimo scappa al bordo un'altra volta

Griglia allargata esattamente come dichiarato sopra — finestre 150, 180, 240 giorni, stessi tre pesi — più
`(120, 0.20)`, che mancava dalla griglia originale ed era un buco e non una scelta.

| | euro (4 finestre) | Serie A (6 finestre) |
|---|---|---|
| migliore pooled | **240/0,2** — di nuovo il BORDO | **240/0,05** — di nuovo il bordo |
| cross-fit | 240 su 4 fold di 4 | 240 su 6 fold di 6 |
| guadagno medio | **+1,06%** (era +0,56%) | +0,08% |
| finestra peggiore | −1,25% | −1,08% |
| strict / robust | no / **sì** | no / no |

**E la lettura è quella scritta PRIMA della corsa, non una trovata dopo**: l'errore pooled scende in modo
**monotono** con la finestra (0,22712 a canale spento → 0,22388 a 240 giorni) e l'ottimo corre al bordo
ovunque lo si sposti. Una finestra di 240 giorni non dice più «è rientrato da poco»: dice «ha avuto uno
stop lungo negli ultimi otto mesi», che è un'altra cosa e che `injury_weights` legge già di suo.

**Misurato invece che raccontato**, sui 509 uomini del foglio Serie A con un rientro datato — mediana delle
giornate perse (pesate, tre stagioni):

| rientro entro 120 giorni | fra 120 e 240 | oltre 240 |
|---|---|---|
| **12,9** (n=127) | 9,2 (n=155) | **1,9** (n=227) |

Chi la finestra lunga accende è chi ha la storia infortuni pesante, e il canale sta comprando quella. È la
stessa famiglia della lezione dell'ETÀ (§7-quinvicies): *un canale che passa perché ripesca un'informazione
che il modello ha già non è un canale nuovo, è la stessa evidenza contata due volte.*

**Stato: pre-registrata, misurata due volte, SPENTA per sempre.** Il codice e la griglia allargata restano
- il canale è a peso zero e non muove un decimale (`backtest --verify` invariato) - ma la voce esce dalle
cose da fare: non c'è una terza griglia da provare, perché il difetto non è la taglia della finestra.
Controllo di attribuzione: **0 altri parametri su 60 si muovono** fra le due corse.

### E che cosa resta del caso Berisha

Il 21,2 del motore non scende: nessun canale misurato lo fa scendere, e sostituirlo con un numero a mano
sarebbe la cosa che questo progetto rifiuta da sempre. Quello che c'è, ed è già in mano all'operatore, è
il resto del foglio: l'app lo porta all'**8% del calendario** nell'Overall — per il posto da titolare e
per la fragilità, che sono due preferenze DICHIARATE e non due previsioni — e gli mette accanto i due
marchi «rientrato da poco» e «si infortuna spesso». Il numero grezzo del motore resta ottimista e visibile;
il giudizio accanto dice perché non fidarsene.

## 7-untricies. IL CANALE DELL'INVESTIMENTO CON L'INPUT RIPARATO: misurato, e ancora sotto il pavimento (16 agosto 2026)

**Perché questa corsa esiste.** §7-quater chiudeva con «sistemare l'input prima di toccare il peso»: il
canale legge il VALORE DI MERCATO, e quel valore era una fotografia per stagione — per Gonçalo Ramos non
esisteva affatto, e Kolo Muani leggeva 20M contro i 18M di Gimenez in un'estate in cui uno dei due era
costato 41,2M. L'input è stato riparato (spec «Novità v9.54»): la CURVA, letta **al giorno dell'asta**.

### Prima della misura: il perimetro era un filtro di sopravvivenza, e andava allargato

La curva era stata scaricata per i **quotati di oggi**. Per il foglio di oggi è il perimetro giusto; per
l'harness è il difetto, perché «quotato nel 2026» vuol dire «ha ancora una carriera». Copertura dei quotati
della stagione bersaglio, prima → dopo l'acquisizione allargata (`market --all-seasons`, 2.200 curve,
61.894 punti, zero fallite):

| | Tm7 | Tm4 | T0 | T1 | T2 | oggi |
|---|---|---|---|---|---|---|
| curva ≤ data d'asta (Serie A) | 7% → **77%** | 14% → 85% | 37% → 91% | 48% → 93% | 60% → 90% | 97% |
| `market_values` (stagione di input) | 48% | 57% | 52% | 58% | 60% | 76% |

Prima la copertura SALIVA con la recenza della finestra, che è la forma di un filtro di sopravvivenza ed è
correlata con l'esito che il canale predice; dopo è piatta al 77-97% e batte `market_values` ovunque. Far
girare lo sweep sulla prima sarebbe stato dargli ragione da solo.

### Il verdetto: NON ADOTTATO su nessuna piattaforma

Griglie **non ritoccate** (quelle di §7-quater e §7-septies), bersaglio `starts`, cross-fit leave-one-out.

| | euro (4 finestre) | Serie A (6 finestre) |
|---|---|---|
| `value_weight` (effetto principale) — ottimo pooled | 0,2 *(interno)* | **0,3** *(interno)* |
| cross-fit | 0,1 / 0,2 / 0,2 / 0,3 | **0,3 su 5 fold di 6** |
| guadagno medio | +0,04% | **+0,26%** |
| finestra peggiore | −0,19% | **+0,02%** *(tutte positive)* |
| `investment_unplayed_value_wide` (forma condizionale) | media **−0,12%** | media **−0,30%** |
| `investment_unplayed_marginal` (al netto del suo null) | −0,03% | −0,01% |

**Sotto il pavimento dello 0,5%, quindi resta a zero.** Ed è la volta che ci è andato più vicino: su Serie A
la curva pooled ha un minimo **interno** (0,19682 a peso 0 → 0,19629 a 0,3 → 0,19651 a 0,5), il cross-fit è
quasi unanime e **ogni fold guadagna**. Mancano due decimi e mezzo di punto percentuale.

**La forma CONDIZIONALE è peggio di prima, ed è un'informazione.** Prima leggeva 0,0% (il canale non si
accendeva mai: senza valore non c'è lift); adesso che l'input c'è, accenderla **costa** — media −0,12% su
euro e −0,30% su Serie A. Quindi «il lift solo dove i minuti non sono informativi» non è la forma giusta di
questa idea: dove i minuti non ci sono, il valore di mercato non li sostituisce.

### Che cosa questa corsa chiude, e la disciplina che la rende leggibile

**L'attribuzione è a una variabile sola e verificata**: 60 parametri confrontati col report di otto ore
prima (stesso codice, stessa griglia, stesse finestre), **8 cambiati e sono tutti e otto la famiglia del
valore**. Nessun parametro adottato si muove — la stessa verifica che il gate fece quando `passes` fu
allargato («0 verdetti di 120 cambiano»).

**Si chiude la voce «sistemare l'input prima di toccare il peso»**: l'input è sistemato, il peso è stato
misurato sulla griglia pre-registrata, e la risposta è no. Il canale resta a zero e la sua riga esce dalle
cose da fare: quello che lo riaprirebbe non è un'altra misura di questo genere ma un dato che non abbiamo
— gli INGAGGI, che è la stessa condizione che §7-quinquies aveva già dichiarato.

**Una cosa che NON è stata rimisurata e va detta**: il FEE (§7-quater braccio B) esiste solo dal 2023 e
quella corsa non lo tocca. Restava tre finestre allora e ne resta tre adesso.

## 7-duotricies. `engine_pv_pred` DEVE LEGGERE LE GIORNATE GIOCATE (pre-registrata il 16 agosto 2026, PRIMA di eseguirla)

**Da dove viene.** È l'item 4.5 di [todolist-draft-v1.md](todolist-draft-v1.md), e il numero che lo ha
generato è il più grande di tutta la campagna sul draft (§18 di
[metrica-asta-surplus-v1.md](metrica-asta-surplus-v1.md)): con l'asta giocata a stagione iniziata, le
**presenze OSSERVATE** valgono **+0,443** di Spearman parziale sopra il prezzo a due giornate e **+0,536**
a sei. È anche l'unico segnale grosso che è **pubblico** - lo vedono tutti al tavolo - e proprio per
questo non averlo è un buco e non una scelta: oggi `engine_pv_pred` è costruito sulla stagione
PRECEDENTE, quindi un pannello aperto alla terza giornata ignora tre giornate che chiunque può contare.

### La forma, dichiarata prima della corsa

Una MEDIA PESATA fra quello che ha fatto finora e quello che il modello direbbe senza guardarlo, con il
peso dell'osservato che cresce con le giornate viste:

    share = (k x osservato + K x prior) / (k + K)

dove `k` sono le giornate del suo campionato già giocate alla data d'asta, `osservato` la sua quota di
presenze in quelle, e `prior` la quota che il core prevede oggi (`model.expected_share`). `K` è il solo
parametro nuovo - **in giornate**: quante ne servono perché l'osservato pesi quanto il prior.

Tre proprietà, e la prima è quella che rende la cosa sicura:

1. **A `k` = 0 è ESATTAMENTE il modello di oggi**, per costruzione. Tutte le finestre del gate hanno la
   data d'asta al 15 agosto, quindi nessun numero pubblicato si muove e `backtest --verify` resta 22/22.
   Il canale esiste solo dove esiste la domanda.
2. **Non è una sostituzione ma una convergenza**: a tre giornate un uomo che le ha giocate tutte non
   diventa un titolare da 38, e a ventitré lo diventa. È la stessa forma di `standing_prior_rounds`
   (§7-quaterdecies), che è il pezzo di questo modello che ha vinto il verdetto più netto di sempre.
3. **Il rifiuto lo esprime `K` grande**: con `K` = ∞ il canale è spento. Quindi la griglia è a senso
   unico verso il basso e lo zero dell'ipotesi sta in fondo, non fuori.

**Griglia pre-registrata**: `K` ∈ {∞ (spento), 40, 25, 15, 10, 6, 3}. Estremi ragionati e non tondi a
caso: `K` = 3 vuol dire che tre giornate viste pesano quanto tutta la stagione scorsa - il massimo che
qualcuno stia proponendo - e `K` = 40 che ne servono più di una stagione intera, cioè quasi spento.

### LA TRAPPOLA, e va dichiarata adesso perché è quella che renderebbe il risultato un'illusione

Con la data d'asta DENTRO la stagione, l'esito `pv_act` (le presenze di tutta la stagione bersaglio)
**contiene le k giornate che il modello ha appena letto**. Un canale che si limitasse a ricopiare
l'osservato sembrerebbe bravissimo per la parte di stagione che è già successa: non è previsione, è
lettura. Quindi:

> **il bersaglio di una finestra in-season sono le presenze DOPO la data d'asta**, cioè le giornate
> `k+1..N`, contate dal layer per-partita per data. Non il totale di stagione.

È la stessa disciplina di «vuoto = ignoto» applicata al tempo: quello che è già successo non si prevede.
Chi non ha nessuna giornata dopo la data (un infortunato di lungo corso, uno partito a gennaio) resta
nella popolazione con esito 0, perché zero presenze future è un esito e non un dato mancante.

### Le finestre: nuove, e per forza

Le dieci del gate sono tutte pre-stagione, quindi su di loro il canale è inerte e **non giudicabile**.
Ne servono di IN-SEASON, e le date sono le stesse due che il viaggio nel tempo dell'app ha già scelto per
la stessa ragione (la rosa è quella vera): **il 5 settembre** (k ≈ 2-4 giornate) e **il 5 febbraio**
(k ≈ 20-24). Il layer per-partita le sostiene dal 2019-20, quindi ci sono **sette stagioni** e quattordici
finestre per piattaforma - anche se euro ne perde due, come sempre, per il 2021-22 vuoto alla fonte.

Che le due date siano poche e scelte è deliberato: k = 3 e k = 23 sono i due regimi diversi che la
domanda ha (l'asta tardiva di settembre e quella di riparazione), e una finestra per giornata direbbe
soprattutto quanto è liscia l'interpolazione fra i due.

### I criteri, che sono quelli di sempre

Strict e robust affiancati, pavimento 0,5% sulla media, nessuna finestra sotto −2%, cross-fit
leave-one-out, e **un parametro non si adotta al bordo della sua griglia** - regola che ha appena spento
il canale del rientro due volte (§7-tricies). Bersaglio: le **presenze dopo la data**, in MAE.

### Che cosa mi aspetto, scritto adesso per non poterlo aggiustare dopo

Che passi a febbraio e sia dubbio a settembre. A ventitré giornate l'osservato è mezza stagione di
evidenza fresca e il prior è vecchio di un anno; a tre giornate `k`/(k+K) è piccolo per ogni `K`
sensato, quindi il canale può muovere poco - e quel poco è esattamente dove un'asta tardiva si gioca.
Se invece passasse a settembre con `K` piccolo, la lettura da controllare prima di adottare è che non
stia leggendo **chi è in campo adesso** (una probabile formazione mascherata da presenze), che è un fatto
di un'altra natura e ha un suo gate.

### La stima di FATTIBILITÀ (16 agosto 2026, sera) — e non è il verdetto

Costruire l'harness costa, quindi prima di costruirlo ho replicato **la formula pre-registrata** fuori
dal motore, per decidere se ne vale la pena. Va letta per quello che è: usa `model.expected_share`
importata (la funzione vera), REIMPLEMENTA il giro che le prepara gli input e il conteggio per data, e
non ha né cross-fit né criteri. È un ordine di grandezza, non un verdetto — quello lo darà `backtest`
sulle finestre in-season.

Sette stagioni di Serie A (2019-20 → 2025-26), MAE sulla quota di presenze **dopo il taglio**:

| taglio | guadagno a K=40 | K=15 | K=6 | **K=3** |
|---|---|---|---|---|
| settembre (k = 2-5) | +2,8/+6,4% | +6,5/+12,7% | +10,8/+19,1% | **+11,2/+19,6%** |
| febbraio (k = 19-23) | +15,9/+20,0% | +22,8/+30,3% | +25,3/+35,6% | **+25,6/+36,8%** |
| media sulle 13 finestre | +11,9% | +19,0% | +23,6% | **+24,8%** |

**Un ordine di grandezza sopra qualunque canale mai adottato** (il record è `standing_prior_rounds` a
+2,8%), il che è insieme la promessa e il motivo per diffidare. Concorda da un'altra direzione con
§18, che sulle presenze OSSERVATE misurava +0,443 di Spearman parziale sopra il prezzo: due metodi
diversi che dicono «è la leva grossa».

**E la prima lettura era gonfiata del 40%, per un difetto di POPOLAZIONE che vale la pena scrivere.**
Misurata su chiunque avesse una stagione precedente, la resa a K=3 era **+42%**; sul LISTONE della
stagione bersaglio — che è la popolazione del motore — è +24,8%. La differenza sono gli uomini che in
Serie A non ci sono più: le giornate osservate li smascherano subito, ma non è una previsione, è gente
che non compri. Terza volta che il pool decide metà del numero.

**Due cose che questa stima dice e che vanno tenute per la corsa vera.** L'ottimo è al **BORDO** della
griglia (K=3, il più piccolo), quindi anche il gate ci finirebbe contro la regola del bordo: il
follow-up da pre-registrare è verso il basso (K = 2, 1,5, 1), sapendo che a K→0 il modello diventa «solo
quello che ha fatto finora», che a due giornate è un pessimo stimatore. E **la mia attesa scritta prima
era giusta a metà**: febbraio vale molto più di settembre (+30% contro +11%), ma settembre non è
trascurabile come avevo previsto.

### ESEGUITA (16 agosto 2026, sera tardi): passa su tutta la griglia, e la regola del bordo sceglie da sola

Harness costruito (finestre in-season, esito «presenze dopo la data», `pv_seen` come input), regola
dichiarata un punto di griglia alla volta come R18b/R18c - così «quale K» è un verdetto e non un fit.
Serie A, tre stagioni per regime (2023-24, 2024-25, 2025-26), cross-fit fra finestre dello stesso regime.

| K | febbraio: media (peggiore) | tutte le guardie | settembre: media (peggiore) | tutte le guardie |
|---|---|---|---|---|
| 40 | +18,4% (+17,3%) | **sì** | +3,8% (+3,3%) | no (top10) |
| 25 | +22,9% (+21,9%) | no (top10) | +5,5% (+4,8%) | no (top10) |
| 15 | +26,6% (+26,3%) | no (top10) | +8,1% (+6,9%) | **sì** |
| **10** | **+28,3% (+27,3%)** | **sì** | **+10,4% (+8,7%)** | **sì** |
| 6 | +29,2% (+26,9%) | no (top10) | +13,2% (+10,7%) | **sì** |
| 3 | +29,2% (+25,5%) | no (top10) | +14,9% (+10,9%) | no (top10) |

**Tutti e sei i punti passano l'accuratezza, 3/3 finestre, su entrambi i regimi** — e sono guadagni di
un ordine di grandezza sopra qualunque cosa questo gate abbia mai adottato. La fantamedia non si muove di
un decimale (la regola tocca solo le presenze), il VALORE migliora, e i nomi in lista salgono del 22-34%.

**K = 10 è il candidato all'adozione, e non l'ho scelto io: lo scelgono le due regole di casa.** È
INTERNO alla griglia (la regola del bordo, che ha appena spento il canale del rientro due volte) ed è
l'unico punto che supera **tutte e quattro** le guardie in **tutti e due** i regimi — compresa quella sui
nomi catturati, che il gate ha aggiunto nel 06/08 proprio perché «il gate vincola il DELIVERABLE e non
solo l'errore». Il massimo per MAE è a K=3, ma là la lista peggiora: più precisione sui numeri, meno
nomi giusti in cima.

**Una perdita trovata e curata prima di scrivere il verdetto, e vale la pena raccontarla.** Le giornate
si classificano per data dell'ULTIMA partita, quindi una giornata rinviata a metà finiva tutta
nell'esito - portandoci dentro le sue partite già giocate il giorno dell'asta, cioè risultato noto
contato come previsione. Adesso la giornata **a cavallo esce da tutt'e due i lati** (`matchdays_
straddling`): il modello non la vede perché non era finita, l'esito non la conta perché era cominciata.
Costo: una giornata su quindici. Effetto sul risultato: K=3 scende da +35,4% a +29,2%, e la curva si
APPIATTISCE in fondo (K=6 e K=3 pari), il che toglie anche il problema del bordo che la stima di
fattibilità aveva previsto. Una perdita piccola nella direzione che favorisce la regola è la peggiore in
cui sbagliare, ed è per questo che si cura prima di pubblicare il numero e non dopo.

**E l'attesa scritta prima della corsa era giusta a metà, come nella stima**: febbraio vale tre volte
settembre (+28% contro +10%), ma settembre non è trascurabile - a due o tre giornate viste il canale vale
già dieci volte il pavimento.

### euro, dopo aver curato l'harness: il verdetto c'è, e non è quello che sembrava

**Il buco era una SOGLIA tarata su una popolazione e applicata a un'altra**, cioè il difetto che questo
progetto conosce meglio. `MIN_PV_ACT` = 15 dice «sotto quindici presenze una fantamedia non giudica il
modello», ed è il **39% di una stagione da 38**. Su una finestra in-season il calendario previsto è il
RESTO — quattordici o quindici giornate — quindi quella soglia non è severa, è **irraggiungibile**: su
euro a febbraio ne restano 14 e nessuno la supera, così la guardia sulla fantamedia **smetteva di
misurare** invece di fallire, e il gate contava «non verificata» come «peggiorata». Curata: la soglia è
la stessa QUOTA del calendario previsto (`scoring_floor`), quindi 15 su una pre-stagione — dove i dieci
numeri pubblicati non si muovono di un'unità, verificato 22/22 — e 6 o 7 su una in-season.

Rifatta la corsa, la guardia misura e il quadro completo è questo:

| K | Serie A febbraio | Serie A settembre | euro febbraio |
|---|---|---|---|
| 40 | **passa** | no (top10) | **passa** |
| 25 | no (top10) | no (top10) | **passa** |
| 15 | no (top10) | **passa** | **passa** |
| 10 | **passa** | **passa** | no (top10) |
| 6 | no (top10) | **passa** | **passa** |
| 3 | no (top10) | no (top10) | no (VALUE) |

**L'accuratezza è unanime — 3/3 finestre su ogni punto e ogni regime, da +3,8% a +29,2% — e NESSUN K
supera tutte le guardie in tutti e tre i regimi.** Quella che morde è sempre la stessa: i **nomi in cima**,
che è un conteggio su dieci e si muove di un'unità alla volta. Va detto così invece di scegliere il K che
passa dove guardo: il candidato di prima (K = 10) resta il migliore su Serie A e su euro perde una
posizione in una finestra su tre.

**Quindi l'adozione è una DECISIONE e non un automatismo**, e va presa in chiaro come quella di R19 — che
fu la prima adottata sul solo verdetto robust. Le due strade oneste erano: **K = 10 dappertutto**,
dichiarando che la guardia sui nomi cede su una finestra euro di tre; oppure **un K per piattaforma**,
che è quello che il gate fa già altrove (R19 su `default` e non su euro).

### ADOTTATA (16 agosto 2026): K = 10 su Serie A, K = 6 su euro

Decisione dell'operatore, presa con la tabella davanti, ed è la seconda strada: **l'evidenza è per
piattaforma, quindi lo è l'adozione**. Su euro il 6 supera tutte e quattro le guardie (3/3 finestre,
+24,7% di MAE sulle presenze) mentre il 10 perde una posizione in cima su una finestra di tre; su Serie A
è esattamente l'opposto, e il 10 passa i due regimi. Nessun numero è stato scelto perché passava dove si
guardava: ognuno passa dove è adottato.

`ADOPTED` porta ora `R20K10` su `default` e `R20K6` su `euro`. **Non muove un decimale di niente che
esista oggi**: la regola è inerte a zero giornate viste, quindi i dieci numeri pubblicati (`--verify`
22/22) e i fogli d'agosto restano identici. Si muovono i **pacchetti del viaggio nel tempo**, che sono
in-season per definizione, e per quello `SHEET_REVISION` sale a **21** anche se i fogli pre-stagione non
cambiano: una revisione che descrivesse due comportamenti sarebbe una cartella che non sa dire quale dei
due la riguarda.

**E il PANNELLO? La premessa era sbagliata, verificato chiamando il codice invece di dedurlo.** Avevo
scritto che lo standing del pannello «non legge le giornate giocate»: falso. Su un foglio in-season
`snapshot.measured_season` sposta TUTTI gli strati descrittivi sulla stagione in corso fino alla data
d'asta (soglia `TO_DATE_MIN_ROUNDS` = 5 giornate), quindi `desc_season_starts` e `desc_season_matches`
sono già quelle di adesso — sul pacchetto del 5 febbraio la mediana è **15 partite misurate** su 24
massime, e il pannello ci calcola sopra il suo standing.

**Il difetto vero è un altro, ed è più piccolo e più preciso**: a stagione iniziata il pannello
**butta via la stagione precedente** e restringe il campione corto verso la MEDIA DI POPOLAZIONE
(`standing_prior_rounds` = 10), invece che verso il prior di QUELL'UOMO. Su quindici partite viste il
peso è 60% osservato e 40% popolazione — e quel 40% dovrebbe essere la sua stagione scorsa, non la
media di tutti. È esattamente la differenza fra la forma del pannello e quella di R20, che il prior
personale ce l'ha.

**Costo di giudicarlo, e correggo la mia stima**: non è una riga di griglia. Lo sweep gira sulle
finestre PRE-STAGIONE, dove il campione corrente non esiste e il cambio è inerte — quindi per misurarlo
servono finestre in-season anche là, cioè lo stesso lavoro fatto per `backtest`. Voce aperta con la sua
taglia dichiarata, non fatta di fretta.

### La corsa euro precedente, e perché è stata riportata come non-verdetto

Corsa fatta (I23feb, I24feb, I25feb, euro/classic): l'accuratezza si muove come su Serie A —
**3/3 finestre su tutti e sei i punti**, da +14,5% (K=40) a +24,7% (K=3), K=10 a **+23,7%** con la
peggiore a +20,3%. Eppure il gate stampa **DOES NOT PASS**, e la ragione va letta prima di crederci:

- **`FM None -> None`** su tutte e tre le finestre, quindi la guardia «FM non peggiora» non può essere
  verificata e viene contata come fallita. Il dato per-partita c'è (16.403 righe euro 2025-26 giocate,
  tutte con fantavoto), quindi **è un buco dell'harness e non un fatto sulla regola**: da diagnosticare
  prima di rifare la corsa. Nessuna adozione può poggiare su una guardia che non ha potuto misurare.
- **top10 9 → 8 su I23feb**, mentre le altre due salgono (3→5, 11→13). Quello è un fatto e conta.

**Quindi su euro la regola NON ha un verdetto**, e va detto così invece di riportare il +23,7% come se
lo fosse: un numero di accuratezza senza le sue guardie non è un verdetto, è metà di uno.

⚠️ **Le due righe qui sopra sono state SUPERATE nel giro di ore**, e restano perché fanno vedere in che
ordine si è capito: la corsa euro è stata rifatta (il buco `FM None` era `MIN_PV_ACT`, cioè l'attrezzo -
vedi «una soglia di scoring è una QUOTA»), il verdetto euro esiste, e la regola è **ADOTTATA con un K per
piattaforma** nel blocco più sopra. La «scorciatoia sul pannello» è stata poi MISURATA e respinta:
**§7-tretricies**.

## 7-tretricies. IL PRIOR PERSONALE DEL PANNELLO a stagione iniziata: misurato su dodici fogli e RESPINTO (16 agosto 2026, sera tardi)

**L'ipotesi è la mia**, scritta due paragrafi sopra: a stagione iniziata il pannello restringe il campione
corto verso la MEDIA DI POPOLAZIONE (`standing_prior_rounds` = 10) invece che verso il prior di
quell'uomo, quindi su quindici giornate viste il 40% del suo standing è la media di tutti. Sembra
ovviamente sbagliato — ed è il tipo di ipotesi che questo progetto misura prima di scrivere una riga di
motore, perché la lezione del canale ETÀ è che una differenza fra due gruppi non è un canale finché non
si è verificato che il modello non la stia già leggendo.

**Disegno, e muove UNA variabile.** Sulla VISTA vera (`SnapshotView`, la stessa che disegna la board),
su **tutti e dodici** i fogli retrodatati che esistono — tre leghe × le quattro date dei pacchetti del
viaggio nel tempo, cioè settembre e febbraio di due stagioni — si sostituisce **solo**
`Inputs.standing_prior`: la media di popolazione della sua banda diventa il **suo** standing della
stagione precedente. Tutto il resto (eleven, fit, `_reshape`, odds del modulo) gira col codice che
spedisce. Il prior personale è approssimato con i minuti della stagione precedente sul calendario del
SUO campionato, che è la stessa aritmetica dello standing (`standing_weights` = (0, 1)) senza i lift, e
la sua copertura è dichiarata: **58-60%** sui fogli Serie A, **19-20%** su euro (dove chi non ce l'ha
tiene il prior di banda, cioè non si muove).

**Giudice**: `actual_next_started`, che il foglio porta già — chi ha davvero iniziato la prima partita
del club DOPO quel giorno. 3.322 posti disegnati in tutto.

| foglio | claim mossi | mediana \|Δ\| | moduli cambiati | uomini cambiati | oggi | prior personale |
|---|---|---|---|---|---|---|
| 4 fogli di SETTEMBRE | 183-352 | 0,17-0,21 | **0** | 31-66 di 220-396 | 135 · 135 · 278 · 144 | 133 · 133 · 276 · 140 |
| 4 fogli di FEBBRAIO | 177-349 | 0,08 | **0** | 8-15 | 134 · 134 · 266 · 143 | 134 · 134 · 266 · 139 |
| **totale (12 fogli)** | ~3.400 | — | **0 su 322 club** | **385 su 3.322** | **2.164/3.322** | **2.142/3.322** |

**Verdetto: NON adottata.** Non pareggia su nessun foglio in cui muove qualcosa: **peggiore o uguale
dodici volte su dodici**, −22 uomini in totale. E non è un caso di «troppo piccolo per vedersi»: muove
metà dei claim del foglio, con una mediana di 0,08 a febbraio e di 0,19 a settembre, e sposta 385 posti
di board.

**Il meccanismo, misurato invece che raccontato**: il prior personale correla **+0,523** con lo standing
GREZZO di quest'anno (417 uomini del foglio del 5 febbraio). Cioè metà di quello che porta è già dentro i
minuti che il pannello sta guardando, e l'altra metà è vecchia di una stagione — la stessa forma del
rifiuto del canale ETÀ (§7-quinvicies): il modello lo legge già, e il termine gli fa pagare due volte la
stessa evidenza. Il prior personale ha anche mediana **0,406** contro lo 0,351 della popolazione, quindi
in media alza tutti — e alzare tutti non cambia un ordine.

**Perché i MODULI non si muovono mai, ed è un fatto sul meccanismo e non sul rumore**: dentro un club, a
stagione iniziata, gli uomini hanno quasi tutti lo stesso campione (23 giornate su 23 al 5 febbraio),
quindi la restrizione è una mappa AFFINE con lo stesso peso per tutti e l'ordine non può cambiare. A
muoversi sono solo i confronti fra campioni di taglia diversa — un arrivo di gennaio contro un titolare —
ed è lì che i 385 uomini cambiano, con l'esito che dice che cambiano in peggio.

**Cosa questo NON chiude**: la forma di R20 sul lato motore resta adottata e non è in discussione (là il
prior è la stagione precedente *pesata sulle giornate*, non un rimpiazzo del prior di popolazione), e
resta non misurato il caso in cui il prior personale sia costruito con l'aritmetica completa del
pannello (lift e `at_club_weight` compresi) invece che coi soli minuti. Se qualcuno lo riprende, il
prerequisito è quello — non un peso diverso su questa stessa forma, che qui è stata misurata dodici volte
e non ha mai vinto.

**Limite del giudice, dichiarato**: una partita per club è un campione stretto, e il giudice forte
(`press --against outcome`, l'undici più schierato della stagione finita) avrebbe più potere. Non è stato
usato perché la direzione è unanime su dodici fogli e due stagioni: per ribaltare un 12-0 non basta un
giudice più fine, serve un'altra ipotesi.

La misura è nel repo — `toolkit/bench/panel/prior_personale.py`, sola lettura, una corsa e una tabella —
perché una misura che nessuno può rifare è un'opinione, e perché il prerequisito per riaprire la voce
(il prior costruito con l'aritmetica completa del pannello) si prova cambiando dieci righe di quel file.

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
