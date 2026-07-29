# Metrica d'asta — SURPLUS v1 (28 luglio 2026)

**Cos'è**: la valuta con cui il pannello Auction ordina i giocatori. Non è una regola di previsione e
**non passa dal gate pre-registrato**, perché il gate protegge il MAE su FM e su VALORE e nessuno dei due
si muove quando cambi il criterio di ordinamento. È un cambio di **funzione obiettivo**, ed è la cosa
che il 28 luglio è entrata in produzione — l'unica: le sei regole candidate provate lo stesso giorno sono
tutte cadute (vedi `gate-motore-v1.md` §11).

## 1. Il problema: VALORE = FM × Pv è quasi solo presenze

Misurato sulle predizioni, per ruolo:

| | coefficiente di variazione | ρ di rango con VALORE |
|---|---|---|
| FM prevista | **0.012 – 0.032** | 0.19 – 0.44 |
| Pv previste | **0.24 – 0.44** | **0.92 – 1.00** |

Dieci volte più dispersione sull'asse presenze. Ordinare per FM × Pv, con questi numeri, è ordinare per
presenze con una carezza di fantamedia sopra. Le conseguenze si vedono a occhio nudo nelle liste:

- **Politano** 9° fra le ali euro/mantra con una FM prevista di **6.58 contro un'àncora di ruolo di 6.65**
  — sotto la media del suo ruolo — solo perché aveva fatto 32 presenze su 31 giornate. VALORE previsto
  160.4 contro 165.6 reali: la *stima* era esatta al 3%, era la **domanda** a essere sbagliata.
- **Dimarco**, miglior difensore della stagione con 30 punti di margine sul secondo, **fuori dai primi 10**.
- **De Roon** prende l'ultimo posto fra i `c` a **Rice** per l'1.9% di VALORE, vinto interamente su mezza
  presenza (24.64 contro 24.07). Reale: Rice 204.6 e 4°, De Roon 160.4 e 43°.
- E sul lato **reale** della lista, Colombo (FM 6.35 × 37) e Lauriente (6.77 × 37) entrano fra i primi 10
  attaccanti: non è un bug, quei fantavoti li hanno accumulati davvero.

## 2. La formula, e perché non ha coefficienti fittati

**VALORE = FM × Pv è la somma dei fantavoti di stagione.** È la valuta giusta solo se l'alternativa a
schierare un giocatore fosse schierare nessuno. Ma si schierano 11 su 25: chi non gioca viene sostituito
da un panchinaro che rende circa il livello del ruolo. Quindi:

> **SURPLUS = (FM − rimpiazzo) × Pv × beccabilità**, con una soglia minima di schierabilità.

Il **livello di rimpiazzo** è la fantamedia del giocatore marginale messo in rosa in quel ruolo. Non serve
nessun coefficiente fittato: serve sapere quanti giocatori di ogni ruolo una lega mette in rosa, che è
**configurazione di lega**, non un parametro di modello. Sta in `config/league_config.json`.

Da **v9.10** quel file dichiara le leghe giocate una per una (`my_leagues`: nome → platform, game, teams,
squad_slots), perché il rimpiazzo è **lo zero del surplus** e cambia con la profondità di rosa: due leghe
sullo stesso platform+game ordinano diversamente gli stessi giocatori. Conseguenza da tenere presente
citando un numero: **un surplus senza la sua lega non è confrontabile con quello di un'altra lega**, ed è
per questo che `manifest.json` porta il blocco `league` e `snapshot` accetta `--league`. Da non confondere
con le `leagues` di `scoring_config.json`, che sono i **campionati** (serie_a, premier_league, …).

## 3. La profondità di rosa viene dai tetti di schieramento, misurati

Default: **8 squadre, rosa 3P/8D/8C/6A** (lo standard fantacalcio.it, 25 giocatori). Per il Classic
basta. Per il Mantra i ruoli di un gruppo **non sono interscambiabili** — nessuno schema schiera 3 `pc`
o 4 `dc` — e la forma dentro il gruppo viene dai **tetti di schieramento**.

Quei tetti non sono stati trascritti dalla tabella ufficiale dei moduli: sono **misurati** su **2903
undici titolari completi** di Serie A ricostruiti da `external_match_stats`, incrociati coi ruoli Mantra
del listone. Letti al 90° percentile — un titolare multi-ruolo conta in ogni ruolo con cui è listato,
quindi la colonna `max` sovrastima (dice 5 `dc`) e il p90 è il segnale pulito:

| por | dc | dd | ds | b | e | m | c | w | t | a | pc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **3** | 2 | 2 | 1 | 3 | 2 | 3 | 2 | 2 | 2 | **2** |

`dc` = 3 e `pc` = 2 sono **esattamente** i limiti che i moduli consentono: la misura ha superato un
controllo indipendente contro le regole del gioco. Un terzo fattore misurato (listature per giocatore,
≈1.5 in media) converte i *giocatori* della regola di lega nelle *listature* del pool.

Profondità risultante su euro, 8 squadre: `por` 24 · `dc` 32 · `dd`/`ds` 21 · `b` 11 · `e`/`m`/`c` 29 ·
`w`/`t`/`pc` 13 · `a` 20. **Controllo di sanità che la macchina doveva passare**: `por`, l'unico ruolo che
non si sovrappone a nessun altro, torna esattamente a 8 × 3.

**Scartata su misura, da non riprovare**: dividere le caselle del gruppo in proporzione alla dimensione
dei **pool fratelli**. Sistema `dc` ma spinge i pool piccoli `pc` e `t` a rango 8, cioè **+0.72 e +0.76
sopra le loro àncore** — peggio dello split equo che sostituiva. La dimensione del pool non può sapere
che una casella difensiva è molto più probabilmente un centrale che un braccetto; solo il tetto lo sa.

### Due cose che NON sono difetti
- Il rimpiazzo **sopra l'àncora** di ruolo è atteso: l'àncora è la media del perimetro, il rimpiazzo è il
  marginale *messo in rosa*, e una lega a 8 squadre che pesca da 39 `pc` utilizzabili mette in rosa punte
  sopra la media.
- Due ruoli **esauriscono il pool** — `b` (11 di profondità, 8 braccetti con Pv ≥ 20) e i portieri di
  Serie A (24 su 18) — quindi il loro livello è «il peggiore dei titolari». È la risposta onesta quando la
  lega non può davvero andare così in fondo.

## 4. La beccabilità: la formazione si fa PRIMA di sapere

Un giocatore che gioca una partita e fa tripletta probabilmente ti fa vincere quella partita — ma
schierarlo *proprio* quella volta è un altro problema. Quindi non incassi le sue presenze: incassi quelle
**che riuscivi a vedere arrivare**. È misurabile, e misurato sul layer datato per giornata:

| disponibilità | persistenza | quota di presenze beccate | `(Pv/giornate)^0.5` |
|---|---|---|---|
| 0-20% | 0.30-0.34 | **0.39-0.41** | 0.37 |
| 20-40% | 0.39-0.50 | 0.56-0.63 | 0.55 |
| 40-60% | 0.38-0.46 | 0.67-0.71 | 0.71 |
| 60-80% | 0.31-0.37 | 0.77-0.79 | 0.84 |
| 80-100% | 0.15-0.18 | **0.88-0.90** | 0.94 |

Due fatti. La **persistenza** — `P(gioca | ha giocato) − P(gioca | non ha giocato)` — vale 0.29-0.36 su
tutte e quattro le piattaforma-stagione e **non è mai vicina a zero**: la disponibilità ha memoria vera,
quindi la costanza è un segnale reale. E `(Pv/giornate)^0.5` **riproduce la curva misurata** entro pochi
punti su ogni banda: l'esponente **0.5 non è una preferenza di rischio tarata a occhio, è la forma
misurata della beccabilità**.

Effetto dove la scarsità è reale: **Malen** (18/38 presenze) passa da 2° a 6° reale fra gli attaccanti,
scavalcato da Yildiz (36 presenze), Thuram, Douvikas e Hojlund. **Bremer** (26/38) da 5° a 9°.

## 5. La soglia: uno sconto si può ripagare, una categoria no

`min_availability` = **0.35** (≈13 giornate su 38, ≈11 su 31). Sotto quella quota un giocatore **non è
classificato** in una top-10 di surplus.

Serve perché **uno sconto può sempre essere ripagato da una partita straordinaria**: l'unica presenza di
Lukaku a 9.5 valeva +1.6 di surplus, la beccabilità l'ha tagliata a 0.3 — il più penalizzato di tutti,
×0.19 — e restava **7°**, perché in quel ruolo gli altri stavano fra 0.1 e 1.3. Non è un errore di
valutazione, è un **errore di categoria**: chi ha giocato una volta non è un giocatore che potevi
schierare, quindi non appartiene a una classifica di chi comprare, a nessuno sconto.

La soglia sta appena sotto il dominio `Pv ≥ 15` su cui il core FM è stato fittato, quindi sotto di essa
non c'era comunque nessuna stima validata. Filtra **solo il ranking**, e solo sotto SURPLUS: riga, numeri
e rango reale restano ovunque, e le liste VALORE non sono filtrate — sono il deliverable pre-registrato.

## 6. Un bug vero trovato dai nomi

Il controllo «Demirović, Schick, Igamane, João Pedro e Balogun devono stare tutti sopra Lukaku» ha
scoperto che la lista **reale** era valutata contro il livello di rimpiazzo delle stagioni di **input**.
Il livello `pc` euro è scivolato **8.02 → 7.80 → 7.38** in tre stagioni, quindi fantamedie 2025-26 venivano
misurate contro una base 2023-24: mezzo fantavoto, che su 28 presenze fa 14 punti — abbastanza per mettere
una punta da 28 partite sotto una da una partita sola.

Regola che ne esce, e che vale in generale: **una previsione può conoscere solo le stagioni di input; un
RESOCONTO si valuta contro la stagione di cui è resoconto.** Il `WindowData` porta ora entrambi i livelli
e il pannello mostra entrambi quando differiscono.

## 7. Esito

Nomi in comune fra previsto e reale, sui ruoli guardati: **23/70 con SURPLUS contro 22 di VALORE** —
il cambio di valuta non costa nomi. E i casi:

| | con VALORE | con SURPLUS |
|---|---|---|
| Dimarco (D) | fuori dai 10 | **1° previsto, 1° reale** |
| Rice (c) | fuori | **8° reale** (e il ruolo passa da 3 a 5 nomi su 10) |
| Haaland (pc) | fuori | **5°** |
| L. Martinez (A) | 4° reale | **1° reale** |
| Malen / Bremer | 2° / 5° reale | 6° / 9° reale |
| Politano · L.Henrique · De Roon · Colombo · Lauriente · Piccoli | dentro | **fuori** |
| Lukaku | 9° previsto | **non classificato** |
| Demirović · Schick · Igamane · João Pedro · Balogun | — | tutti sopra Lukaku |

**Kean resta 1°**, ed è il verdetto onesto: l'affollamento dell'attacco della Fiorentina non è un problema
di valuta, è una regola che manca — e il 28 luglio si è scoperto che non è nemmeno la regola che
pensavamo (vedi `gate-motore-v1.md` §11, R16b).

## 8. Cosa resta aperto

- La metrica **non è pre-registrata**. Il gate non la giudica perché non tocca FM né Pv, ma se un giorno
  vogliamo dichiararla validata serve un protocollo suo, con metrica dichiarata *prima* (punti / surplus /
  FVM catturati nelle top-10). Parte di quella verginità è già bruciata: l'esponente e la profondità sono
  stati scelti guardando tutte le finestre.
- La **persistenza per-giocatore** è un segnale reale e non è usata: oggi si usa la curva di beccabilità
  **della popolazione**, quindi due giocatori entrambi al 50% di disponibilità prendono lo stesso peso
  anche se uno ha giocato 19 partite di fila e l'altro 19 sparse. Usare la sua persistenza è una feature
  predittiva nuova → passa dal gate (provata come R15, cade: `gate-motore-v1.md` §11).
- Su euro il ruolo `pc` ha scarsità quasi nulla (rimpiazzo 7.89 contro àncora 7.47), quindi i surplus sono
  compressi e le posizioni 6-10 sono **zero statistico**. Là sotto si ordina rumore, con o senza pesi.

## 9. File

`config/league_config.json` (squadre, caselle, esponente, soglia — con le note che spiegano ogni scelta) ·
`engine/features.py` (`simultaneous_caps`, `derive_mantra_slots`, `replacement_levels`, `roster_depth`) ·
`engine/evaluate.py` (`auction_view(metric=...)`, default `value` per non toccare il gate) ·
`gui.py` (selettore **Rank by**, colonne che seguono la valuta). Commit `34aacd6`.

---

## 10. PRE-REGISTRAZIONE — beccabilità per-giocatore (scritta il 28 luglio 2026, prima di misurare)

**Ipotesi.** Oggi il surplus pesa con la curva di beccabilità **della popolazione**: due giocatori entrambi
al 50% di disponibilità prendono lo stesso peso anche se uno ha giocato 19 partite di fila e l'altro 19
sparse. L'ipotesi è che usare la **sua** beccabilità faccia meglio.

**Il prerequisito, e può uccidere l'idea da solo.** Sul lato *reale* la beccabilità si misura sulla stagione
di cui è resoconto, quindi è sempre disponibile. Sul lato *previsto* no: alla data d'asta si può conoscere
solo la persistenza della stagione di **input**. Quindi la versione per-giocatore è utilizzabile **solo se**
la persistenza si trasferisce da una stagione all'altra. Questa è la claim falsificabile, ed è diversa da
quella di R15: R15 chiedeva se la persistenza predice le **presenze**, questa chiede se predice la
**beccabilità**.

**Metrica dichiarata**, sulle liste d'asta, confrontando A = curva di popolazione (quella spedita) con
B = beccabilità per-giocatore dalla persistenza di input:

1. **Prerequisito**: la persistenza della stagione di input deve correlare **positivamente** con la
   beccabilità della stagione bersaglio su **ogni** finestra che la misura. Se cade su una sola finestra,
   B è archiviata e non si guarda nient'altro — perché senza trasferimento il lato previsto di B è un
   numero inventato.
2. **Non-danno**: B non deve perdere nomi contro A su più finestre di quante ne guadagni.

**Criterio di falsificazione**: se il prerequisito cade, la risposta è no e ci si ferma lì. Non si passa a
«allora usiamola solo sul lato reale», che sarebbe cambiare l'ipotesi dopo aver visto il dato — il lato
reale è un resoconto e non è la parte che serve all'asta.

**Contaminazione dichiarata**: la persistenza è già stata misurata sulla popolazione (0.29-0.36 su tutte e
quattro le piattaforma-stagione) e la sua correlazione **fra stagioni** non è mai stata guardata. Quello
che segue è quindi la prima misura di questa quantità.

### Esito: ARCHIVIATA. Il prerequisito cade, e la curva di popolazione ne esce confermata

ρ fra la persistenza della stagione di **input** e la beccabilità della stagione **bersaglio**, sui
giocatori presenti in entrambe:

| | finestre | ρ per-giocatore | ρ della curva di popolazione `(quota_prec)^0.5` |
|---|---|---|---|
| euro | 5 | **+0.054 · −0.037 · +0.004 · −0.011 · +0.030** | +0.335 … +0.447, **tutte positive** |
| Serie A | 10 | da **−0.029 a +0.099**, segno che salta | +0.291 … +0.468, **tutte positive** |

**La persistenza di un giocatore non si trasferisce alla stagione successiva.** Il valore è
indistinguibile da zero su 15 finestre su 15 e cambia segno. Nel frattempo la curva di popolazione — quella
che è già spedita — predice la stessa beccabilità con ρ **0.29-0.47, positiva su tutte e quindici**: un
ordine di grandezza meglio.

Come pre-registrato, ci si ferma qui: **non** si passa a «usiamola solo sul lato reale». Il lato reale è un
resoconto e non è la parte che serve all'asta, e cambiare l'ipotesi dopo aver visto il dato è precisamente
ciò da cui la pre-registrazione protegge.

**Il fatto sostanziale, che va oltre questa metrica**: la persistenza è reale **dentro** una stagione
(0.29-0.36, mai vicina a zero) e **non persiste fra** stagioni. Quindi la costanza è una proprietà della
stagione, non del giocatore. Il che spiega anche perché R15 è caduta sul lato presenze: stessa
non-trasferibilità, misurata su un bersaglio diverso. **La famiglia «persistenza» si chiude sul lato
previsionale**, non è sospesa in attesa di finestre — due bersagli indipendenti, quindici finestre, zero
segnale trasferito.

E una nota che va detta: la curva di popolazione era stata scelta perché era l'unica disponibile, non perché
fosse la migliore. Questa misura dice che **è anche la migliore delle due**, il che è fortuna, non merito.

## 11. Pressione di reparto (dichiarata il 28/07/2026, PRIMA della misura)

**La domanda dell'utente, dopo il verdetto di R17**: il gate ha stabilito che l'affollamento non è
una regola d'errore (il meccanismo esiste dentro la stagione e non si trasferisce — cinque
formulazioni respinte), ma all'asta il rischio resta: in un reparto dalla gerarchia dubbia
(David/Openda/Vlahović, Zapata/Simeone, Morata/Douvikas) comprare quello sbagliato è probabile, e
questo deve pesare CONTRO di loro rispetto a un attaccante più modesto ma dal posto garantito
(Davis). E, per ragionamento inverso, il posto garantito per **carenza di concorrenza** merita un
premio: gli errori vengono perdonati, le occasioni per ritrovare la forma tornano.

È un cambio di funzione obiettivo, quindi passa da QUESTA porta (non dal gate), col protocollo del
§10: forma e metrica dichiarate prima, misura dopo, verdetto a verbale qualunque sia.

### Perché il segnale è il CONTEGGIO dei pretendenti seri, non la somma delle share

Misurato su T2 default prima di congelare la forma: la somma delle share previste del reparto è
gonfiata dalle riserve (il baseline dà 0.55 a Taremi, 0.57 a Kouamè), e i nuovi arrivi — proprio i
casi pericolosi: Openda, David — possono essere INVISIBILI alle previsioni pur stando nel listone
con una Qt.I pesante. Il conteggio li vede: Juventus 25/26 = 4 pretendenti seri su K=1.55;
Como = 4 su 1.34 (i primi 3 di mercato tutti flop); Torino = 3 su 1.79 (Zapata, leader di Qt.I,
battuto da Adams — per questo il fattore è **di gruppo, non rank-gated**); Inter = 2 su 2.05 →
pressione 1, nessuno sconto, e infatti la coppia ha retto.

### Forma congelata (costanti DICHIARATE, zero fit)

```
gruppo        = gli 'A' del club nel listone target
serio         = share prevista ≥ 0.35  OPPURE  Qt.I ≥ max(6, ⅓ della Qt.I massima del gruppo)
pressione     = n_seri / K_c              (K = media attaccanti per XI, ≥10 XI, da club_match_lineups)
fattore       = clip(pressione^−0.5, 0.60, 1.15)
```

Applicato SOLO al punteggio di ordinamento (nuova valuta `SURPLUS × pressione` nel pannello); le
previsioni, il gate e le altre due valute non si muovono di un decimale. K non misurabile → fattore
1. Il premio (fino a +15%) scatta quando i seri sono meno dei posti schierati.

### Contaminazione dichiarata e metrica di validazione (scritte prima della misura)

Le soglie (0.35, ⅓, 6, esponente 0.5, clip 0.60/1.15) sono state scelte guardando **T2 default** —
finestra già bruciata. La validazione gira su TUTTE le finestre usabili, entrambe le piattaforme e
i giochi, con le finestre pulite riportate a parte, e confronta `SURPLUS × pressione` contro
`SURPLUS` liscio a parità di tutto:

1. **VALORE reale catturato** dalle top-10 predette (valuta surplus, stesso perfetto): la perdita
   aggregata non può superare il **2%** (lo stesso limite elastico del non-danno).
2. **Tasso di bust** nelle top-10 predette (reale < 40% del previsto, o mai sceso in campo): deve
   **scendere** in aggregato.

Se la (1) cade o la (2) non migliora, l'opzione nasce **SPENTA** nel pannello e il numero resta a
verbale. Niente fallback a forme alternative dopo aver visto il dato.

### Raffinamenti dichiarati per dopo (non in questa misura)

- **Compagni lungodegenti** (l'altro caso dell'utente): un concorrente fuori a lungo NON è un
  pretendente serio → premio a chi resta. Serve la tabella `injuries` (oggi vuota, input
  Priority-1, Transfermarkt); per l'asta 26/27 può leggere lo snapshot `availability` live.
- **Gli altri ruoli**: `club_match_lineups` ha già i conteggi G/D/M per XI; serve il cross-tab di
  vocabolario per D e C prima di estendere (per gli A è misurato: 57-81%).
- Integrazione con `probable_starter` settimanale quando avrà storia.

### Esito (28/07/2026, stessa giornata — misura unica sulle 30 viste finestra×piattaforma×gioco)

**L'opzione nasce SPENTA**, come la dichiarazione prevedeva per questo esito:

1. VALORE reale catturato: **−0.61%** aggregato (−0.68% sulle sole finestre pulite) — entro il
   limite del 2%. ✓
2. Tasso di bust nelle top-10 predette: **10.1% → 10.1%, identico su ogni singola finestra**. ✗

Il perché è più utile del verdetto. I flop dei reparti contesi **non stanno nelle top-10 predette**:
Openda e David erano imprezzabili per il motore (nessuno storico), quindi nessuna lista li proponeva
— lo sconto non può salvare da un acquisto che il motore non suggeriva. Dove la coppia contesa È in
lista (Inter, Fiorentina), il fattore è di club e uniforme, quindi raramente scambia nomi FRA club;
e i bust rimasti (Lukaku) sono infortuni, ciechi a qualunque logica di slot. Il costo del −0.61% è
concentrato dove il fattore morde a torto (euro/classic T1: −15.4%, è lo sconto su Marmoush+Haaland
che poi hanno reso entrambi).

**Cosa resta in produzione**: la valuta `surplus_pressure` esiste nel motore, testata, non offerta
dal pannello; la colonna **Pair** (K, co-start, ΔQt.I) porta la stessa evidenza al decisore SENZA
riordinare nulla — che è la forma in cui questa informazione oggi si guadagna il posto. Riaccendere
la valuta è una decisione da prendere ad alta voce, sapendo che compra 0 bust in meno.

**Cosa la riaprirebbe legittimamente**: (a) la tabella `injuries` (il raffinamento lungodegenti
dichiarato sopra: cambia CHI è serio, non la forma); (b) lo storico settimanale di
`probable_starter`, che renderà misurabile la serietà per-pretendente invece del conteggio; (c) una
copertura predittiva dei nuovi arrivi (finché Openda non è prezzabile, nessuna valuta lo tocca).
