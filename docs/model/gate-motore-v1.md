# Gate del motore — v1 · protocollo, verdetti, ipotesi falsificate

**Chiuso: 27 luglio 2026** · Documento autosufficiente: cosa è stato provato, con che protocollo, con
che numeri, e cosa NON va riproposto.
*Glossario: B0 = motore attuale (baseline) · T1/T2 = finestre 23/24→24/25 e 24/25→25/26 · cross-fit =
parametri stimati su una finestra e applicati all'altra · campione comune = i giocatori che entrambe le
configurazioni prezzano · VALORE = FM × presenze.*

## 1. Come gira il gate

`python -m euroleghe_ingest backtest [--verify] [--gate] [--cases]` — read-only sul DB, scrive solo
`data/reports/engine_backtest.json`. Codice in `toolkit/euroleghe_ingest/engine/`
(`model` formule pure · `fitting` minimi quadrati · `features` DB→osservazioni · `evaluate` gate).

Quattro regole di misura, tutte imparate sbagliando almeno una volta:

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

## 3. Verdetti — 6 regole adottate su 15 provate

**Adottate, per piattaforma** (`platform` è già una dimensione del modello dati):
**euro → R1 + R3c + R4 + R7 + R10** · **Serie A → R3 + R7**

| Regola | euro | Serie A | Parametro (T1 / T2) |
|---|---|---|---|
| **R7** persistenza dedicata alle presenze dei portieri | ✅ | ✅ | persistenza **0.70 / 0.80** (contro 0.50 condiviso) |
| **R3c** minuti sulle **giornate del calendario euro** | ✅ | ✅¹ | minuti **0.291 / 0.352** |
| **R10** nuovo allenatore (livello + interazione) | ✅ | ❌ | −0.014/−0.031 · **+0.051/+0.067** |
| **R1** copertura nuovi entrati (FM-equivalente + minuti) | ✅ | ❌² | β_new 0.186 / 0.230 → **0.431 / 0.398** col layer completo |
| **R4** curva d'età sulla FM oltre i 30 | ✅ | ❌ | −0.006 / −0.016 per anno |
| **R3** minuti sulla stagione reale intera | ❌³ → ✅⁴ | ✅ | minuti 0.342 / 0.219 → **0.326 / 0.256** |

¹ passa anche su Serie A ma perde una posizione top-10 in T2, dove R3 la tiene: lì la mappa copre 31
delle 38 giornate e le due feature sono quasi la stessa cosa. ² i nuovi entrati in Serie A hanno un
equivalente troppo rumoroso (oltre il +30%). ³ sull'euro i due regressori sono collineari e si
scambiano peso fra finestre. ⁴ col layer per-partita completo R3 passa anche sull'euro, ma resta
**ridondante** con R3c (misurano la stessa cosa su calendari diversi) e non viene adottata due volte:
sull'euro vince la versione allineata al bersaglio.

### Risultati misurati (MAE di VALORE, campione comune, T1 / T2)

| | P | D | C | A | totale | top-10 | copertura |
|---|---|---|---|---|---|---|---|
| **euro** | −0.5% / **−5.6%** | −1.6% / −1.7% | −1.6% / −1.5% | −1.9% / −0.3% | **−1.6% / −1.7%** | 6→8 · 12→14 | **475→644 · 489→628** |
| **Serie A** | **−6.9% / −14.7%** | −5.4% / −3.1% | −3.8% / −1.5% | −2.1% / −0.4% | **−4.3% / −2.7%** | 11→13 · 14→15 | invariata |

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

## 4. Ipotesi FALSIFICATE — non riproporre senza finestre nuove

| Regola | Parametro (T1 / T2) | Perché cade |
|---|---|---|
| **R1b** sconto adattamento cross-lega | δ_cross **−0.036 / +0.156** | Segno opposto fra finestre, e δ_intra (0.09 / 0.33) è **maggiore** di δ_cross: il segnale non è l'adattamento alla nuova lega ma un generico cambio-squadra. Era il criterio di falsificazione scritto in pre-registrazione, ed è scattato. |
| **R2** propensione per-90 (xG/xA) | γ **−0.003 / −0.014** → poi **+0.028 / +0.021** | ⚠️ **verdetto corretto nel §5-bis**: col layer per-partita completo il segno diventa giusto e stabile. Non passa ancora il criterio sul MAE, ma la falsificazione originale era in parte un artefatto dell'input incompleto → **da ri-pre-registrare**, non archiviata. |
| **R5** àncora forza-club da ClubElo | λ +0.023 / +0.073 | **Terza bocciatura della famiglia** (dopo forza-club interna ed Elo additivo movimento). Il segno è giusto su entrambe le finestre — l'intuizione Kane è corretta — ma il MAE di T1 peggiora ogni volta. |
| **R6** rigoristi (forma ridotta su confidence) | λ **+0.332 / −0.222** | Segno opposto, e peggiora gli attaccanti (+1.8% / +2.7%). La forma ridotta comprime troppo (manca il tasso rigori per club e la conversione di carriera) e i rigoristi datati prima dell'asta sono 22 e 29. |
| **R8** fuori-ruolo da heatmap | avanti +0.032 / **−0.070** → poi **+0.121 / +0.041** | ⚠️ **anche qui l'instabilità era dei dati** (§5-bis): col layer completo entrambi i versi hanno segno stabile («più indietro» −0.22 / −0.327). Non passa, ma la ragione della bocciatura non è più «segno instabile». |
| **R11 / R11b** concorrenza posizionale | λ **+0.008 / +0.010** e soglia **+0.044 / +0.055** | Migliora il Pv MAE del 3% su Serie A — l'effetto singolo più grande del gate — **con il segno contrario all'ipotesi**: più arrivi nel tuo ruolo, più presenze. Col layer completo i coefficienti sono anche *stabili*. Il guadagno è reale, il meccanismo dichiarato è falso → §5-bis, ri-pre-registrata come «sottostima da rifacimento rosa». |
| **R11b** posizione affollata (soglia ≥2) | +0.012 / −0.001 | La soglia non è una coda: 620 giocatori su 1450 la superano. |
| **R12** attesa di mercato (Qt.I nel ruolo) | λ −0.003 / +0.010 | L'attesa **assoluta** del mercato non aggiunge nulla alla fantamedia precedente: è costruita sulla stessa storia. |
| **R12b** revisione dell'attesa (Qt.I anno su anno) | λ −0.040 / −0.076 | Segno stabile ma significato opposto: dice che chi è rivisto **al ribasso** rende *più* di B0, cioè approssima il ritorno alla media che B0 già fa. Fallisce su T1 e sul VALORE. |
| **R4b** curva d'età sulle presenze | −0.014 / −0.014 | Stabile e inutile: Pv MAE −0.0%, VALORE peggiore. L'effetto età sta sulla FM, non sulle presenze. |

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

- **Concorrenza posizionale pesata dalla Qt.I dei concorrenti** — un rivale da 21 crediti non è un
  rincalzo da 3. Nasce dai casi Openda/David/Vlahović (la Juventus 25/26 ha preso tre attaccanti sopra
  a Vlahović) ed è la forma che due sole finestre non possono confermare senza autoinganno. Calcolabile
  ora che `price_initial` è nel DB.
- **R8 solo nel verso «usato più indietro»**, quando il campione supera n≈10/13.
- **R9 àncora con peso di recenza** (l'àncora attaccanti si muove: euro 7.28 → 7.34 → 7.16): con due
  finestre λ è quasi non identificabile.
- **R4b età sulle presenze** e **R2 propensione**, se una terza finestra cambia il quadro.
- Regole del listone di gennaio e `attivita_mercato`: `transfers_history` ha **solo la finestra estiva**
  (una data per stagione), quindi il rischio-cessione invernale non è derivabile da quella fonte.

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
tier corretti. 117 test verdi, ruff pulito.
