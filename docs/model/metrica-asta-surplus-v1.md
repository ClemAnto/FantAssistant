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


## 12. Quando il SURPLUS è VUOTO (4 agosto 2026)
Una cella vuota non è uno zero e non è un difetto: il core **rifiuta di prevedere** fuori dal dominio su cui è
stato fittato — `model.MIN_PV_PREV = 15` voti nella stagione d'ingresso (le beta), `ANCHOR_MIN_PV = 20` (le
àncore) — e senza fantamedia prevista non c'è VALORE e non c'è SURPLUS (`evaluate._predict_fm`).
Cosa succede allora dipende dalla **piattaforma**: su **euro** il set adottato contiene **R0c**, l'àncora di
ruolo, che prezza comunque chi non ha storico; su **default R0c non è adottata** (là non ha mai battuto
l'àncora), quindi non c'è nulla su cui ripiegare. Sul foglio Serie A del 29/07 sono **253 righe su 598**.
Esempio che l'ha fatto notare: **Raspadori** ha surplus **−3.7** sul foglio EuroLeghe (euro/classic) e
**vuoto** su quello Serie A, perché il suo 2025-26 su `default` è di **13 voti**. Da oggi lo dicono il
`manifest.json` (conteggio, motivo, cinque nomi) e il tooltip della colonna SUR; le colonne `desc_*` non sono
toccate, perché sono misurate e non previste.


## 13. Su mantra il SURPLUS *era* il VALORE (7 agosto 2026)

Trovato verificando i dati, non leggendo il codice: `engine_replacement_fm` era **0 su 1031** sul foglio
EuroLeghe e `engine_surplus` **identico a `engine_value` su tutte e 1007** le righe prezzate, mentre sul
foglio Serie A i livelli c'erano (648 su 649). Un'asimmetria fra due fogli che eseguono lo stesso codice è
sempre una chiave che non combacia, e infatti: `features.replacement_levels` restituisce i livelli nel
vocabolario del **gioco** (`por` 4.33 · `ds` 5.72 · `e` 5.86 · `w` 6.56 · `pc` 7.19 sulla finestra euro
2026-27), e i tre lettori li cercavano con `role_classic` (`P/D/C/A`), che su mantra non è chiave di niente.
Ogni lettore prendeva allora il ramo documentato «nessun livello ⇒ ripiega su VALORE» — che è corretto per
il gate, il quale prepara le finestre **senza lega** apposta, e silenzioso per il pannello, che una lega ce
l'ha.

Non era cosmetico. Il livello non è una costante additiva: cambia per ruolo, quindi ordinare per VALORE è
ordinare un'altra domanda. Nelle top-10 per ruolo **sopravvivevano 1 o 2 posizioni su 10** (`t`: Rogers,
Baumgartner, Fernandez E. lasciano il posto a Gnabry, Palmer, Uzun; `pc`: Haaland scende sotto Mbappé). E
lo stesso difetto stava un livello sopra, in `engine_role_rank`, che raggruppava per ruolo di listone: la
posizione stampata sulla riga non era la posizione in nessuna lista che il pannello mostra — perché
`evaluate.auction_view` la chiave giusta la usava, ed è per questo che le liste per ruolo erano corrette
mentre la colonna accanto non lo era.

Tre cose che restano, e la terza è la più istruttiva:

- **una definizione sola, letta da tutti**: `snapshot.auction_level` risponde alla domanda «contro quale
  livello si misura questa riga» per il foglio, per il rango, per `est_surplus`, per il pannello
  (`gui._estimates`) e per l'armonica `estimates`. Erano cinque copie della stessa `.get()` sbagliata.
- **un numero deve dire di cosa parla**: su mantra un `w;a` ha due livelli e la riga ne mostra uno, quello
  dello slot in cui vale di più (il livello più basso fra i suoi codici, che è lo slot in cui lo si
  schiera). La colonna **`engine_role_slot`** lo nomina, altrimenti `engine_replacement_fm` è un numero che
  la riga non sa spiegare.
- **correggere un difetto comune scopre quello che nascondeva.** Chi il listone non lo porta non ha codice
  mantra — è da lì che i codici vengono — quindi restava senza livello anche dopo il fix, e il suo
  `est_surplus` continuava a essere un VALORE in una colonna di surplus: **11 delle prime 12 righe** del
  foglio corretto erano uomini stimati, con 45-53 contro i 53.7 di Kane. Ora prende la **media** del suo
  gruppo di listone (6.917 per gli attaccanti) e non il minimo: scegliere il proprio slot migliore è
  un'affermazione su chi gli slot li ha, e di lui non sappiamo quale sia. Cioffi passa da +48.9 a −4.5, e
  la top-12 torna a essere fatta di uomini misurati.

`backtest --verify` resta **22/22** e il foglio `default/classic` non muove un decimale: là i due vocabolari
sono lo stesso. Fogli e bundle rigenerati a `sheet_revision` **6**.


## 14. SpM e dVM: il surplus in CREDITI, e l'FVM è un prezzo (8 agosto 2026)

**Richiesta dell'operatore**: «calcola un valore che trasformi il surplus in un nuovo valore confrontabile
con l'FVM, che chiameremo SpM (surplus di mercato)», più la colonna **dVM = SpM − FVM**.

### 14.1 Due correzioni dell'operatore che cambiano la taratura, non solo le parole

1. **«FVM non è di fine stagione: cambia a ogni evento saliente.»** È uno **stato volatile**, non una
   grandezza di fine anno — per questo esiste `fvm_history` e per questo su una stagione passata quello
   che abbiamo è *l'ultima lettura di quel listone*, che l'esito lo conosce già. La conclusione «reporting
   only» non cambia; cambia la descrizione, corretta ovunque la portasse sbagliata
   (`features.FEATURE_INVENTORY`, l'aiuto della colonna, la riga sotto i selettori).
2. **«L'FVM massimo è 500 ed è tarato su una ipotetica asta a 10 squadre con 1000 di budget.»** Questo non
   è un dettaglio di scala: fa dell'FVM un **prezzo** con un monte crediti noto. Verificato invece che
   preso per buono — sul listone Serie A **2025-26 completo**, i primi 10 × 25 uomini per FVM sommano
   **10.323**, cioè **1.032 crediti a squadra** contro i 1.000 di riferimento. (Il listone EuroLeghe è
   tarato su un monte più grande: 2.063 a squadra a dieci squadre.)

### 14.2 La conversione è un problema di BUDGET, e questo fissa la popolazione

Il surplus è in fantapunti sopra la panchina, l'FVM è in crediti. Con il monte noto, il tasso non è un
coefficiente da scegliere: per ogni ruolo di listone, con **N = squadre × slot** della lega,

> **budget** = Σ FVM sugli N uomini che il **mercato** rosterizza (i suoi primi N per FVM)
> **earned** = Σ SURPLUS sugli N uomini che il **motore** rosterizzerebbe (i suoi primi N, solo positivi)
> **tasso = budget / earned** · **SpM = tasso × surplus** · **dVM = SpM − FVM**

Così **la mia rosa costa esattamente il monte crediti della sua**: stesso budget, stesso numero di slot,
un'altra opinione su chi se li merita. Il null è esatto e verificato in test: sommato sui miei rosterati,
dVM è **quanto costa in più la rosa del mercato rispetto alla mia ai prezzi di mercato**, e non può essere
negativo (nessun sottoinsieme di N costa più dei primi N). Chi ha surplus ≤ 0 non entra nel fit — la moneta
del mercato verrebbe divisa per qualcosa che non ha comprato — ma **prende comunque un SpM negativo**, che è
esattamente ciò che la colonna deve dirgli.

**Tararlo su tutti i quotati è sbagliato, ed è misurato**: spalma lo stesso monte su ~900 uomini invece che
sui 300 che si comprano, e legge i rosterati come **sopravvalutati del 23%** per costruzione (euro/mantra
2026-27: monte SpM 17.044 contro i 22.208 che il mercato spende davvero). Con la taratura giusta i due monti
coincidono per costruzione. Tassi misurati (euro 12 squadre): **P 2.07 · D 3.83 · C 8.99 · A 18.42**;
Serie A 10 squadre: **P 1.11 · D 2.43 · C 3.87 · A 2.93**.

Il tasso è fittato **una volta sola sulla lista intera**: i filtri (Include, ruolo, squadra) nascondono
righe e non rifittano niente, o l'SpM di un uomo cambierebbe a seconda di chi altro è a video.

### 14.3 Il pool è il RUOLO DI LISTONE, e le altre due scelte sono state misurate

- **un tasso unico per tutti** riduce la colonna a un'affermazione sui RUOLI: media dVM **+38 ai portieri**
  contro **−57 agli attaccanti**, e **14 delle prime 15 righe per dVM sono portieri**. Vero, incomprabile,
  e affoga la domanda che si fa al tavolo.
- **il pool per SLOT mantra** spacca due ali quasi identiche in **8.9 (`w`)** e **26.4 (`a`)**: due tassi
  fra cui un multi-ruolo si sposta a seconda di quale codice lo prezza meglio.
- **il ruolo di listone** è il pool in cui il mercato stesso prezza (FVM 1-70 sui portieri, 1-499 sugli
  attaccanti) ed è quello per cui il monte crediti è ripartito. **Gli stimati (~) stanno nel fit**: toglierli
  muove i tassi Serie A di ≤5% e su euro di zero, mentre lasciarli dentro conserva la legge su tutta la
  lista mostrata.

### 14.4 Cosa NON dice, e va detto

- **Non riparte il budget fra i reparti.** Prende per buona la ripartizione del mercato fra P/D/C/A: dice
  chi è caro *fra i suoi pari ruolo*, non se convenga spendere sugli attaccanti. Quella domanda vuole il
  prezzo ombra del credito ([assistente-asta-v1.md](assistente-asta-v1.md) §4.2) e l'asta in corso.
- **In cima la scala salta.** Kane esce a **SpM 989** su un listone che arriva a 499: il suo surplus previsto
  è quasi il doppio del secondo e l'FVM in alto è compresso. Non è un prezzo pagabile, è «a questo tasso vale
  metà rosa» — su euro il monte è 1.851 a squadra.
- **Su una stagione finita l'FVM si è già mosso con la stagione stessa**, quindi un dVM grande non è un
  affare che qualcuno poteva prendere: è il motore contro un prezzo che l'esito lo conosce.
- **È REPORTING**, come l'FVM su cui è calibrato: nessuna regola lo legge, il gate non lo vede mai,
  `backtest --verify` resta 22/22.

---

## 15. In un DRAFT la moneta è il VALORE, e la copertura per ruolo vale dieci volte la moneta (10 agosto 2026)

**Campagna di misura su richiesta dell'operatore** («conviene prendere sempre il meglio, giocare per
scegliere sempre primo o una via di mezzo?», poi «consolida su più stagioni»). È la prima volta che il
metro di questo documento viene messo alla prova **contro l'esito vero**, e ne esce ridimensionato per un
formato preciso: il draft.

### 15.1 Il banco

Due attrezzi, entrambi sulle **cinque finestre euro/mantra misurabili del gate** (Tm4, Tm3, T0, T1, T2 —
bersagli 2019-20, 2020-21, 2023-24, 2024-25, 2025-26; la 21/22 è vuota alla fonte e ne costa due):

1. **Replay del draft**: 12 squadre, 25 giri, ordine ricalcolato con la regola vera della piattaforma
   (§11.1), rivali **eterogenei** come al tavolo (2 sul surplus, 4 con giudizio personale = prezzo per un
   rumore fisso per giocatore, 5 sul prezzo; tutti punti-per-credito in coda al giro). 8 semi × 12 sedie
   = 96 aste per politica e per finestra.
2. **Prova di sola graduatoria**, senza avversari: si ordina il listone per un criterio, si prende la rosa
   mantra standard e si guarda l'undici che ne esce.

Due metri, perché uno solo dice cose che l'altro smentisce: i **totali di stagione** del miglior undici
legale, e — la definizione di questo progetto (§12.1) — la **somma sulle giornate del miglior undici
LEGALE fra i disponibili di quella giornata**, coi `fantavoto` veri. L'undici è legale sui moduli del
regolamento (`config/mantra_modules.json`): l'abbinamento ai posti tipizzati è un matroide trasversale,
quindi il greedy sul peso è esatto. Confronto **appaiato** (io meno la media dei rivali NELLO STESSO
draft) e in **percentuale**, perché le stagioni hanno 29-31 giornate.

**Il prezzo è il Qt.I.** L'FVM archiviato è l'ultima lettura del listone, presa a stagione finita: con
quello come prezzo ogni politica perdeva, ed era il prezzo che conosceva l'esito.

### 15.2 La risposta alla domanda: né «sempre il meglio» né «sempre primo»

Politica = `qualità × bisogno / (prezzo + pavimento)`; pavimento ∞ = prendi sempre il meglio e ignora
l'ordine, pavimento 0 = gioca per scegliere primo. Metro a giornata, cinque finestre:

| politica | Tm4 | Tm3 | T0 | T1 | T2 | media | verdetto |
|---|---|---|---|---|---|---|---|
| prezzo, pavimento 200 | +4,7 | +2,2 | −0,1 | +1,3 | +1,3 | +1,9% | robust |
| VALORE, sempre il meglio | +1,1 | +3,1 | +2,3 | −3,3 | −0,3 | +0,6% | — |
| VALORE, pavimento 200 | +1,0 | +3,2 | −0,5 | −5,1 | +1,3 | +0,0% | — |
| SURPLUS, sempre il meglio | −15,7 | +0,9 | +2,0 | −5,6 | −1,7 | −4,0% | — |
| sempre primo (pavimento 0) | −24,8 | −51,2 | −53,7 | −53,6 | −45,7 | −45,8% | — |

**«Giocare per scegliere primo» è rovinoso**: −45,8%, 0/5 finestre. È il risultato più solido della
campagna e non dipende da nessuna taratura: la posizione nel giro dopo non ripaga una rosa di scarti.
**Il SURPLUS come moneta generale del draft è refutato**: −4,0%, 2/5, e −15,7% su una finestra.

Attenzione al NULL di quella tabella: il confronto è contro la MEDIA dei rivali, che contiene teste
deliberatamente deboli, quindi il +1,9% del prezzo è in buona parte «essere come i rivali migliori».

### 15.3 Perché il surplus perde QUI, e dove resta giusto

Il surplus sottrae il rimpiazzo **per slot**, e in mantra quella scarsità **il regolamento non la impone**:
la rosa vincola 3 portieri + 22 di movimento e nessuna quota per slot, e 497 quotati su 1014 hanno 2+
codici, quindi la flessibilità annacqua ancora la scarsità. La domanda per slot dietro al surplus è
DEDOTTA dai moduli (`auction-value.slotShares`, dichiarata come scelta di modello), non imposta dal gioco.

Resta la grandezza giusta dove il vincolo è reale:
- **la porta**, dove ne schieri esattamente uno (rimpiazzo `por` 4,36 di fantamedia contro `pc` 7,29 — e
  con la regola delle **porte** di questa lega l'unità è il club, quindi ancora di più);
- **le aste a CREDITI**, dove la risorsa scarsa è il budget e non la scelta: tutto il resto di questo
  documento parla di quelle e non cambia di una riga.

Da qui la moneta ibrida — VALORE sul movimento, SURPLUS in porta — che è **pre-registrata e non ancora
misurata**: [todolist-draft-v1.md](todolist-draft-v1.md) item 1.2.

### 15.4 La leva grossa non è la moneta: è la COPERTURA per ruolo

Prova di graduatoria, punti per giornata, media sulle cinque stagioni:

| rosa | FVM* | SURPLUS | VALORE | Qt.I | FM−1 |
|---|---|---|---|---|---|
| modulo coperto una volta, panchina ai migliori | 84,0 | **78,7** | 74,7 | 72,8 | 65,7 |
| — posti coperti | 90,6% | 89,2% | 83,3% | 80,3% | 72,7% |
| modulo coperto **due volte** (20 movimento + 2) | 93,6 | 84,5 | **85,3** | 84,8 | 78,8 |
| — posti coperti | 99,7% | 97,6% | 98,7% | 95,4% | 91,4% |

FVM* = FVM archiviato: conosce l'esito. Sta lì come **tetto**, non come criterio da tavolo.

Tre cose, in ordine di importanza. **Imporre la seconda copertura vale +10,6 punti a giornata** al valore
e +5,8 al surplus, contro gli **0,8** che separano le monete fra loro: la ripartizione per ruolo è un
VINCOLO da imporre, non una cosa da comprare con la moneta. **I primi 25 di QUALUNQUE graduatoria non
schierano un undici legale** — i migliori 22 di movimento sono attaccanti ed esterni, 4-10 posti coperti
su 11 — quindi la rosa si costruisce coprendo prima il modulo. E nella prima riga il surplus vince 5/5
non perché classifichi meglio, ma perché essendo normalizzato per slot **la copertura la compra da sé**:
imposta il vincolo e il suo vantaggio svanisce.

Questo risponde anche all'intuizione dell'operatore («quando gli slot scarseggiano e servono buone
alternative in ogni ruolo, il surplus acquista importanza»): giusta nel MECCANISMO, sbagliato il rimedio.
La schedula che cambia moneta durante l'asta è stata misurata ed è **peggio** in modo monotono a quanto
prima si cambia (θ lineare −36, gradino al giro 6 −131, al giro 11 −162 punti contro i rivali), e la
schedula ROVESCIA pareggia il valore puro. Si misura esattamente perché le due monete differiscono per un
termine solo: `surplus = valore − rimpiazzo × presenze`.

### 15.5 La fantamedia dell'undici non separa i criteri; la disponibilità sì

La fantamedia vera del miglior undici legale sta fra **7,05 e 7,56** per tutti e cinque i criteri, su
tutte e cinque le stagioni: un undici scelto fra i migliori 25 di qualunque graduatoria rende ~7,2
*quando gioca*. Ciò che separa i criteri è la **disponibilità** (65,7 → 84,5 punti a giornata). Coerente
con quello che il gate sapeva da un'altra strada: `Var(ln pv)` è il 90% della varianza dei fantapunti.
E `FM −1` è il peggiore dei criteri onesti (65,7 / 78,8): motore e prezzo aggiungono qualcosa di reale
sopra «la fantamedia dell'anno scorso».

### 15.6 Due conclusioni RITIRATE, e vanno ricordate come metodo

Entrambe erano state misurate su **T2 sola** e riportate all'operatore prima del consolidamento:

1. **«La via di mezzo vale +92»** (pavimento 200 sulla moneta VALORE). Sulle cinque finestre fa
   **+0,0%**, 3/5, nessun verdetto — con T1 a −5,1%. Sui totali di stagione +2,6%, 4/5, ancora nessun
   verdetto. La FORMA della curva (optimum interno per finestra) resta vera; il LIVELLO no.
2. **«Il motore batte il mercato».** Correlazione col risultato vero (fm × presenze) sulle cinque
   stagioni: **Qt.I +0,545** contro **VALORE +0,514**, e il valore vince solo su 2025-26 (0,569 contro
   0,549) — la finestra su cui era stato misurato. In cima alla lista i due restano vicini (il valore
   avanti 4/5 a copertura singola, 3/5 a doppia): **nessuno dei due ha un verdetto**. Il tetto è vicino
   per entrambi — l'FVM che conosce l'esito correla +0,591, cioè 0,046 sopra il Qt.I.

Una conclusione su una finestra non è una conclusione. È la stessa disciplina del §5-duodecies del gate
sul null, applicata al numero di finestre invece che al confronto.

### 15.7 Cosa NON è stato misurato, dichiarato

- **Legalità CLASSIC.** Tutto quanto sopra è mantra. In classic la legalità è per macro-ruolo (1 P + D +
  C + A) e la quota per ruolo È un vincolo di regolamento, quindi la gerarchia delle monete va
  **rimisurata**: l'ipotesi è che il surplus vi si comporti molto meglio, ed è un'ipotesi.
- I rivali sono il **modello** del tavolo, e nessuno di loro usa la disciplina sul prezzo fuori dalla coda
  del giro: il margine si assottiglia se un avversario la adotta.
- Il pavimento 200 era stato scelto guardando T2, quindi **come parametro non è ancora giudicabile**:
  serve il cross-fit leave-one-out (todolist item 1.3).
- Nessuna riga di `engine_*` si muove: la campagna misura POLITICHE di scelta, non regole di previsione,
  e il gate non è stato attraversato.

### 15.8 Errori di banco pagati (perché non si ripetano)

- «I migliori 11» **non è** un undici legale: serve l'abbinamento sui posti tipizzati del modulo.
- Un posto scoperto vale **zero** e non azzera la giornata (come un «senza voto» senza panchinaro dello
  stesso ruolo): l'errore opposto azzerava il 37% delle giornate e gonfiava i margini di un ordine di
  grandezza.
- I ruoli mantra vanno passati **completi** al matching (497/1014 hanno 2+ codici): col solo codice
  primario la flessibilità sparisce e le conclusioni cambiano.
- L'FVM archiviato non è un prezzo di pre-stagione.

## 16. La COPERTURA è un vincolo, e la moneta con cui il pannello consigliava era la peggiore di tutte (10 agosto 2026, sera)

**Esecuzione della [todolist-draft-v1.md](todolist-draft-v1.md): item 0.1-0.3, 1.1, 1.2, 1.3, 3.2, 3.3.** Il
banco è entrato nel repo (`toolkit/bench/draft/`) e adesso **legge il codice vero dell'app** invece di una
copia: `entry.ts` ri-esporta `needFor`, `predictRivalPick`, `startingPlaces`, `lambdaOf`, `netOf` e la
legalità mantra da `app/src/app/core/`, e `build.mjs` li impacchetta con l'esbuild dell'app. Il porting è
stato **verificato riproducendo i numeri del §15 finestra per finestra** (SURPLUS −4,0% 2/5, primo pick
−45,8% 0/5, via di mezzo +0,0%); le due righe «prezzo» differiscono nell'ultimo decimale per finestra e non
nella media, perché l'originale consumava il PRNG del rumore dei rivali anche sulla nostra sedia.

Un errore di porting pagato subito, e vale come regola: la nuova firma passa il GIOCATORE dove la vecchia
passava lo slot, e le politiche pubblicate passavano ancora `needFor` direttamente. `places.get(giocatore)`
è `undefined`, quindi il peso valeva 1 per tutti e la prima tabella diceva che il surplus era la moneta
migliore. Riprodurre i numeri pubblicati è quello che lo ha scoperto: **un porting si verifica sui numeri,
non sulla compilazione.**

### 16.1 Il difetto più grosso non era nella lista: era la moneta con cui il pannello CONSIGLIA

`pickForUs` — la riga che il pannello raccomanda — non ordinava per valore né per surplus, ma per **netto**
(`surplus − λ × prezzo`), e non razionava per ruolo **affatto**. Misurata come politica, cinque finestre,
metro a giornata:

| politica | Tm4 | Tm3 | T0 | T1 | T2 | media | vinte | coperti | speso |
|---|---|---|---|---|---|---|---|---|---|
| PANNELLO OGGI: netto, 0 razionamento | −37,9 | −39,6 | −67,9 | −66,3 | −49,7 | **−52,3%** | 0/5 | 51,9% | **34** |
| netto + copertura ×2 | −19,9 | −41,9 | −73,5 | −66,8 | −50,1 | −50,4% | 0/5 | 54,2% | 34 |
| VALORE + copertura ×2 (adottata) | +2,2 | +4,2 | +5,4 | −0,6 | −0,9 | +2,1% | 3/5 | 97,4% | 299 |

**34 crediti spesi in 25 scelte**: il netto, in un draft, è un generatore di giocatori quasi gratis. La causa
è **strutturale e non una taratura**: λ è il tasso di cambio fra un credito e un fantapunto, e in un draft
non spendi crediti, spendi **SCELTE** (§11.2) — sottrarre un tasso che nessuno paga premia l'essere gratis.
Il razionamento non lo salva (−50,4%): la moneta va cambiata, non pesata.

Due cose che questo spiega a posteriori, e che erano state **rattoppate localmente due volte** senza che la
causa fosse trovata: la coda del giro che prendeva riempitivi da 1 credito (Lahdo, Goldaniga — da lì
`TAIL_PRICE_FLOOR`) e la terza striscia che offriva «uno sconosciuto da 11 crediti» invece dell'attaccante da
244 che teneva davvero il posto nell'ordine. Erano lo stesso difetto visto due volte dal bordo. **Quando lo
stesso sintomo va rattoppato due volte in punti diversi, il difetto è nella grandezza che entrambi leggono.**

Il netto e il surplus **restano sulla riga e nelle colonne**: sono i numeri giusti in un'asta a rilanci.
Quello che cambia è la CHIAVE DI ORDINAMENTO di un draft, e ora il codice dice quale formato sta prezzando.

### 16.2 Item 1.1 — la copertura si conta sui POSTI, e «×2» sulle quote non vincola niente

Il tentativo letterale della todolist («il bersaglio del mio pick è `startingPlaces × 2`») **non vincola**:
`startingPlaces` è il *ceil* della quota media di ogni ruolo sugli undici moduli e somma **16**, non 10,
quindi una rosa da 22 di movimento non arriva quasi mai al doppio di una quota. Raddoppiarlo non stringe la
regola, la **spegne** (−4,20%, 0/5). Quello che il regolamento raziona è un **POSTO**, e «quest'uomo copre un
posto che la rosa non copre ancora?» è esattamente la domanda del matroide che il progetto già sa risolvere.

Guadagno % sui NOSTRI punti a giornata contro il razionamento che l'app aveva (`needFor`), cinque finestre:

| candidato | Tm4 | Tm3 | T0 | T1 | T2 | media | vinte | verdetto | coperti | speso |
|---|---|---|---|---|---|---|---|---|---|---|
| **posti ×2: due undici** | +1,36 | +0,62 | +3,13 | +2,90 | −0,64 | **+1,47%** | 4/5 | **robust** | 97,4% | 299 |
| quote ×2 graduata (1/0,7/0,35) | +0,29 | +2,46 | +0,97 | −0,37 | +0,17 | +0,70% | 4/5 | robust | 95,1% | 318 |
| posti ×2 VINCOLO (0 fuori) | −2,70 | −1,63 | −0,20 | +1,13 | −3,80 | −1,44% | 1/5 | — | 97,0% | 270 |
| posti ×1: un undici | −9,54 | −3,50 | −3,31 | −2,46 | −7,88 | −5,34% | 0/5 | — | 86,6% | 365 |
| posti ×3: tre undici | −4,12 | −5,05 | −4,16 | −0,69 | −7,51 | −4,31% | 0/5 | — | 89,5% | 303 |
| quote ×2 morbida | −4,86 | −2,84 | −3,24 | −3,19 | −6,89 | −4,20% | 0/5 | — | 89,1% | 300 |
| nessuna copertura (peso 1) | −44,23 | −16,04 | −23,80 | −32,57 | −30,26 | −29,38% | 0/5 | — | 60,0% | 379 |

**Adottata: `COVER_COPIES = 2`** — copri due undici legali, poi il peso torna a `DEPTH_WEIGHT` = 0,35.
Verdetto **robust** e non strict (T2 −0,64%), come R19 e come `level_gap_weight`: si adotta e si dichiara.
Tre cose la sostengono oltre alla media: la copertura dell'undici sale **93,4% → 97,4%** delle giornate, si
spendono **30 crediti in meno**, e il parametro è **interno alla griglia** (un undici −5,34%, tre −4,31%).

Il **vincolo duro** (non prendere NIENTE fuori dalla copertura) perde: −1,44%. La copertura è un bisogno, non
un divieto — a rosa quasi chiusa il vincolo duro rifiuta l'unico uomo forte rimasto.

La runner-up va citata col suo margine, come vuole la regola del progetto: le quote ×2 GRADUATE (1 fino alla
quota, 0,7 fino al doppio, 0,35 dopo) passano robust a +0,70%, cioè **0,77 punti percentuali sotto** la
regola adottata, con 2,3 punti di copertura in meno e 19 crediti in più. È un cambio di un numero solo
invece di un abbinamento, quindi è la ricaduta se un giorno il matroide diventasse un costo.

### 16.3 Item 1.2 — l'ibrida è RESPINTA, e per la ragione dichiarata prima della misura

Tutte le righe sopra il razionamento adottato, guadagno contro il VALORE puro, metro a giornata:

| candidato | Tm4 | Tm3 | T0 | T1 | T2 | media | vinte | coperti |
|---|---|---|---|---|---|---|---|---|
| SURPLUS puro | −4,47 | −1,65 | −1,17 | −1,62 | +1,51 | −1,48% | 1/5 | 98,1% |
| **IBRIDA letterale** (surplus in porta) | −3,35 | −5,62 | −4,99 | −5,11 | −5,33 | **−4,88%** | 0/5 | **89,2%** |
| IBRIDA per scelta interna | +2,47 | −0,00 | −1,91 | −0,98 | −0,74 | −0,23% | 1/5 | 97,4% |

L'ibrida letterale perde **per il difetto di SCALA nominato prima di girarla**: il surplus di un portiere e il
valore di un uomo di movimento non stanno sulla stessa scala (lo zero del `por` è 4,36 di fantamedia, quello
di un `pc` 7,29), quindi metterli in un solo argmax non prezza la scarsità della porta — **rimanda solo i
portieri**, e la copertura crolla di 8 punti perché il posto del portiere resta scoperto. Non è l'ipotesi che
è sbagliata: è la forma in cui era scritta.

La forma **onesta sulla scala** — il valore decide SE spendere una scelta su un portiere, il surplus decide
QUALE portiere, e i due numeri non si confrontano mai — non è peggiore: −0,23%, dentro il rumore, e sui
totali di stagione è la riga migliore del banco (+4,6%, 5/5, strict, contro +4,2% del valore puro). Sotto il
pavimento dello 0,5% sul metro del progetto, quindi **non si adotta**: è un «confermato niente da
guadagnare», non un «trovato peggio», e la distinzione va scritta perché la seconda inviterebbe a riprovare e
la prima no.

Quindi: **in un draft la moneta è il VALORE per tutti, portiere compreso.** E il surplus puro, col vincolo di
copertura imposto, passa da −4,0% (§15.2) a **−1,48%**: buona parte del suo svantaggio era copertura, non
moneta — la faccia opposta del «col vincolo imposto il vantaggio del surplus svanisce» del §15.4. Le due
misure insieme dicono una cosa sola: **quasi tutto quello che sembrava una questione di moneta era una
questione di ripartizione.**

### 16.4 Item 1.3 — nessun pavimento prezzo passa il cross-fit: il consiglio non ne usa

Protocollo dello `sweep`: si scegle il pavimento su quattro finestre e si giudica sulla quinta. Griglia
**pre-registrata** {0, 25, 50, 100, 200, 400, 800}, sopra il razionamento adottato.

| finestra tenuta fuori | scelto sulle altre 4 | guadagno in training | guadagno HELD-OUT |
|---|---|---|---|
| Tm4 | 400 | +0,29% | −1,42% |
| Tm3 | 400 | +0,16% | −0,93% |
| T0 | 400 | −0,11% | +0,17% |
| T1 | 400 | −0,51% | +1,76% |
| T2 | 400 | −0,10% | +0,14% |

**Media held-out −0,05%, 3/5, nessun verdetto.** Il cross-fit scegle 400 su tutte e cinque le pieghe (e 400
non è il bordo: 800 lo è), ma la curva sopra 200 è **piatta a zero** — 200 → −0,30%, 400 → −0,05%, 800 →
−0,35% — mentre sotto crolla (100 → −2,26%, 50 → −3,24%, 25 → −7,29%, 0 → −44,50%). Quindi il consiglio
**non usa pavimenti**: restano il tie-break «a parità prendi il meno quotato» e la coda punti-per-credito
(`TAIL_POSITIONS` / `TAIL_PRICE_FLOOR`), già misurate e già nel codice.

Un pezzo di meccanismo in regalo: **il «pavimento 200» comprava copertura.** Col vincolo di copertura imposto
vale −0,30%; era una disciplina che spargeva le scelte sui ruoli per via del prezzo, e il vincolo fa la stessa
cosa meglio e senza rinunciare ai nomi (299 crediti spesi contro 275). Chiude il §15.6 punto 1: la via di
mezzo non era un livello sbagliato, era un **rimedio indiretto** a un problema che ora ha il suo.

### 16.5 Item 3.2 — la sesta finestra: non da `default`, e la ragione è misurata

Tm5 (2017-18 → 2018-19) ha 566 giocatori con voti euro nel bersaglio. Costruire l'INPUT da `default` copre
**88 di 566 (15,5%)** — gli italiani — quindi non è «una sesta finestra», è una finestra su un sesto della
popolazione, e i 478 che mancano sono esattamente gli stranieri per cui la piattaforma euro esiste. Da
`external_stats` (FBref + Sofascore, il layer nato per le altre quattro leghe) la copertura è **501 di 566
(88,5%)**, quindi la finestra è *costruibile* — ma con l'input SINTETICO per la totalità della popolazione
invece che per una parte, cioè su una qualità d'ingresso sistematicamente diversa dalle altre cinque.
Aggiungere una finestra muove OGNI verdetto del gate, quindi è una **pre-registrazione** e non una cosa da
infilare: resta nella todolist e non è stata fatta.

E una trappola trovata mentre lo si verificava, che vale più della finestra: **`match_ratings` per euro
2021-22 ha 17.825 righe con tutte le colonne di bonus/malus piene e `mv` a 0 su 17.825.** Chi conta le righe
conclude l'opposto del vero — il buco è il VOTO, non la stagione. Sintetizzarlo con `synth` contaminerebbe il
bersaglio euro con una trasformazione fittata (vietato da una regola che esiste già), quindi Tm2 e Tm1 restano
fuori da euro, e ora è scritto **col numero** invece che «vuota alla fonte».

### 16.6 Cosa NON è stato misurato in questa tornata, dichiarato

- **Legalità CLASSIC** (item 3.1): i moduli classic ora sono configurazione (`config/classic_modules.json`,
  letti dal regolamento leghe private, trascrizione verificata — sette moduli, ogni riga somma dieci e
  riproduce il proprio nome) e la lega `Leghe Mantra` (`default`/mantra, 10 squadre, 2 portieri + 21 di
  movimento) è dichiarata col suo foglio nel bundle (635 righe: 310 prezzate, 325 stimate). Ma la gerarchia
  delle monete su classic **non è stata rimisurata**: resta un'ipotesi che il surplus vi si comporti meglio,
  ed è l'ipotesi più interessante rimasta, perché in classic la quota per ruolo È un vincolo di regolamento.
- **La testa dei rivali stimata dai loro pick** (item 1.4) e **il valore di BLOCCO** (item 1.5): nessuna
  misura, servono due banchi nuovi.
- I rivali restano il **modello** del tavolo, e nessuno di loro raziona per copertura: il margine si
  assottiglia se un avversario adotta la stessa regola. Ora che la regola è nel repo, è più facile che accada.
- Nessuna riga di `engine_*` si muove. Il gate non è stato attraversato: si misurano POLITICHE di scelta.

## 17. Le teste dei rivali, il valore di blocco, e il giro su CLASSIC che ha corretto un'adozione (10 agosto 2026, notte)

**Seconda passata sulla [todolist-draft-v1.md](todolist-draft-v1.md): item 1.4, 1.5, 3.1, 2.5.** Tre misure e
un rifiuto di misurare. La più importante delle quattro **corregge quello che il §16 aveva appena adottato**,
ed è la ragione per cui il giro su classic era in lista.

### 17.1 Item 1.4 — la testa di ogni rivale si legge dai suoi pick, e vale 13 punti di previsione

Il pannello assume UNA testa per tutti («il più caro che gli serve»). Il candidato: indovinare la testa di
ognuno dalle scelte che ha già fatto, e prevedere con quella. Banco: `heads.mjs`, cinque finestre, tavolo con
teste vere miste, valutato sulla **quota di pick avversari indovinati** — che è il metro che l'item chiede,
perché la testa stimata cambia quello che il pannello MOSTRA e non quello che consiglia (la nostra scelta è
miope per costruzione).

| predittore | Tm4 | Tm3 | T0 | T1 | T2 | media | vinte |
|---|---|---|---|---|---|---|---|
| pannello: sempre «il più caro» | 69,5% | 69,4% | 68,9% | 68,8% | 69,6% | 69,2% | — |
| **testa stimata, warmup 2** | 83,4% | 82,9% | 82,5% | 82,3% | 82,9% | **82,8%** | **5/5** |
| testa stimata, warmup 4 | 82,2% | 81,7% | 81,3% | 81,3% | 81,7% | 81,7% | 5/5 |
| testa stimata, warmup 8 | 79,8% | 79,4% | 79,0% | 78,9% | 79,4% | 79,3% | 5/5 |
| APP: evidenza senza coda | 83,2% | 82,9% | 82,5% | 82,3% | 82,7% | 82,7% | 5/5 |

**+13,6 punti, 5/5, e il warmup più corto è il migliore** (due pick bastano a distinguere una testa a surplus
da una a prezzo, e ogni pick in più speso sulla testa di default è un pick previsto con la testa sbagliata).
Classificazione a fine draft: `prezzo` 100%, `surplus` 100%, `valore` 100%, `giudizio` → letto come `prezzo`
nel 93-95% — che non è un errore ma **l'informazione che il tavolo non emette**: il suo rumore è per
giocatore e privato, quindi di lui è conoscibile solo la parte sistematica, il prezzo.

Tre cose che valgono più del numero.

**Un buco della misura invisibile da dentro la misura.** Il tavolo di default (`MIXED`, il modello del tavolo
vero) non contiene NESSUNA testa a valore, quindi il classificatore non era mai stato interrogato su una.
Aggiunto un tavolo con tutte e quattro (`EVERY_KIND`, tre sedie a testa) la riconosce al 100% — e su quel
tavolo la politica unica **crolla al 28,4% contro il 74,8%**. Il che dice anche quanto vale l'assunzione
attuale: regge solo perché il tavolo vero è in maggioranza guidato dal prezzo.

**Una discrepanza fra ciò che è misurato e ciò che spedisce, chiusa con un numero.** Nel banco l'evidenza è
punteggiata con la regola della coda; nell'app la posizione nel giro non è ricostruibile da una lista di
pick, quindi il classificatore la ignora. Misurata invece che assunta: **82,7% contro 82,8%**, la cecità
sulla coda non costa niente.

**Quello che NON è stato toccato, e per una ragione.** La regola della coda resta com'era (i punti per
credito sulla NOSTRA valutazione). I due bracci della misura la condividono, quindi la misura non dice niente
su di essa — e «la sua moneta per credito» renderebbe un rivale guidato dal prezzo affamato del più CARO in
coda (`prezzo/(prezzo+pavimento)` cresce col prezzo), che è l'opposto dell'incentivo per cui la regola
esiste. Misurare la coda è una domanda a sé e non è stata posta.

### 17.2 Item 1.5 — il denial paga PRESTO, e mai tardi

`block.mjs`. La prima versione della diagnostica **era sbagliata e vale come lezione**: definiva il denial
come «il massimo che qualunque rivale guadagnerebbe da lui», che è un numero su un contro-fattuale che nessuno
affronta — e faceva sembrare l'84% dei pick un caso da denial. Il denial vale qualcosa **solo se quel
giocatore sparirebbe davvero** prima del nostro turno successivo: se resta lì lo prendiamo poi, e prenderlo
adesso non compra niente. Riscritta sulla sequenza VERA dei pick della stessa asta:

- `ourGain(X)` = miglior XI(nostra rosa + X) − miglior XI(nostra rosa)
- `denial(X)` = quanto guadagna il rivale che lo ha PRESO davvero, zero se nessuno lo prende
- `cost(X)` = `ourGain(B) − ourGain(X)`, con B la scelta della politica adottata

Il tasso di cambio è la risposta, non un sì/no: in questo gioco incontri ogni rivale una volta a giornata,
quindi un punto tolto a UNO di loro vale circa 1/(squadre−1) del nostro — il denial deve essere **11 volte**
più grande di quello che rinunciamo.

| pick | n | «free» | reali | paga @1 | paga @11x | mediana | p90 | denial | costo |
|---|---|---|---|---|---|---|---|---|---|
| tutti | 747 | 57,3% | 319 | 86,2% | 56,4% | 14,11 | 51,38 | 144,53 | 10,47 |
| giri 1-5 | 147 | 34,0% | 97 | 100% | 62,9% | 14,57 | 69,91 | 185,92 | 13,03 |
| giri 6-15 | 300 | 43,0% | 171 | 100% | 69,6% | 17,94 | 53,51 | 140,08 | 7,70 |
| **giri 16+** | 300 | 83,0% | 51 | 13,7% | **0,0%** | 0,19 | 1,04 | 16,84 | 119,68 |

**Il denial paga nei primi due terzi del draft e non paga più nell'ultimo**, e va letto sul MECCANISMO e non
sul rapporto: 144/11 = 13,1 contro un costo di 10,5. Il rapporto è un numero grande su uno piccolo — il
valore di un giocatore intero sopra la distanza fra due candidati che valutiamo quasi uguali — quindi con
mille uomini sulla lavagna un quasi-pareggio esiste sempre e il rapporto esplode per costruzione. Il margine
vero è **un quarto** (tutti i giri) a **due terzi** (giri 6-15) del costo: reale, non un ordine di grandezza.
Dopo il giro 16 il costo esplode a 119,7 perché chi se ne va vale poco e le nostre alternative valgono molto.

**Deliverable, quello che l'item chiedeva:** una NOTA nel consiglio, non un cambio di scelta. Ogni pick
previsto porta `denies` — i fantapunti che il suo undici guadagnerebbe — e il pannello lo mostra sopra i 50,
sotto i quali non ripagherebbe nemmeno un piccolo sacrificio. Un bias dichiarato: un uomo che il foglio non
sa prezzare non è schierato nell'undici del rivale («vuoto = ignoto»), quindi la sua rosa mostra posti vuoti
e il denial è un LIMITE SUPERIORE, tanto più largo quanto meno della sua rosa sappiamo prezzare (sul listone
Serie A il motore rifiuta 111 uomini su 433).

**E un candidato NUOVO che questa misura ha fatto emergere**, segnato e non adottato: il 57,3% di «free» dice
che fra gli uomini che stanno per sparire ce n'è uno che alza il NOSTRO undici almeno quanto la scelta della
politica. Non è un'evidenza sul denial: è un'evidenza che **valore × copertura e «il massimo guadagno
marginale sull'undici» non sono lo stesso obiettivo**. Il secondo non è mai stato misurato come politica.

### 17.3 Item 3.1 — il giro su CLASSIC, e l'adozione del §16.2 va ristretta

Dieci finestre Serie A (Tm7…T2), lega `Leghe` (default/classic, 10 squadre, 25 giri), legalità classic dai
sette moduli di `config/classic_modules.json`. **Un limite che va detto prima dei numeri:** il motore prezza
**301 uomini su 433** (111 sono sotto i 15 voti, e su `default` non è adottato R0c che li ancorerebbe), e il
draft ne consuma 250 — il pool è più grande della domanda solo del 20%, quindi gli ultimi giri sono quasi
forzati e le differenze fra politiche si comprimono. Non invalida il confronto (ogni politica affronta lo
stesso pool) ma spiega le ampiezze.

**L'ipotesi dell'item era che il surplus si comportasse molto meglio su classic. Direzione giusta, non
abbastanza:** guadagno sui nostri punti a giornata contro il VALORE, dieci finestre, media **−0,50%, 5/10**
(contro −1,48% e 1/5 su mantra). Si avvicina alla parità e vince metà delle finestre, ma non supera il valore
e non ha verdetto. **L'ibrida letterale è respinta anche qui** (−2,94%, 0/10) e l'ibrida per scelta interna è
esattamente zero su sette finestre (−0,17%): su classic «quale portiere» non cambia quasi nulla. Quindi **la
moneta non cambia per gioco: è il VALORE su entrambi.**

**E poi la correzione, che è il risultato più importante della notte.** La regola di copertura adottata nel
§16.2 — coprire due undici, contata sui POSTI — su classic **PERDE**:

| candidato | media su 10 finestre | vinte | verdetto |
|---|---|---|---|
| **quote ×2 graduata** (1 / 0,7 / 0,35) | **+0,77%** | 6/10 | **robust** |
| posti ×1: un undici | +0,22% | 7/10 | — |
| quote ×2 morbida | −0,87% | 3/10 | — |
| **posti ×2: due undici** (adottata su mantra) | **−1,00%** | 4/10 | — |
| posti ×2 VINCOLO (0 fuori) | −3,19% | 1/10 | — |
| nessuna copertura (peso 1) | −4,93% | 1/10 | — |
| PANNELLO OGGI: netto, 0 razionamento | −30,82% | 0/10 | — |

Il meccanismo è leggibile e non è un mistero: su classic `startingPlaces` somma **esattamente dieci** (d4 c4
a2), perché i posti di un modulo classic sono interi e le quote medie sono già un undici — non c'è il *ceil*
che su mantra gonfia la somma a sedici. Quindi la quota per ruolo è già ben calibrata, e imporre due undici
INTERI su un pool più grande della domanda del 20% compra uomini debolissimi per coprire posti che sarebbero
stati coperti comunque.

**Cosa è stato adottato, e la forma della decisione.** La **quota graduata** è l'unica regola con un verdetto
su entrambi i giochi (+0,70% su mantra dove è la runner-up, +0,77% su classic dove vince), quindi è quella che
spedisce su CLASSIC; su mantra resta la regola sui posti, che lì vale il doppio. Un parametro appartiene alla
popolazione su cui è stato misurato — e il gate fa la stessa cosa quando l'evidenza cambia per piattaforma
(R19 adottata su `default` e non su euro). La cosa da NON fare era lasciare l'adozione di mantra a decidere
per un gioco che la misura dice essere l'opposto.

**Un difetto che questa misura ha scoperto nel codice appena scritto:** l'app leggeva i moduli SOLO per
mantra, quindi dopo il §16 su classic non razionava affatto — la riga da **−4,93%**. Adesso il bundle porta
anche `classic_modules.json` (aggiunto al contratto di `export`) e il razionamento è deciso dal GIOCO e non
da «quali forme sono state caricate». Leggere «nessuna forma» come «nessun razionamento» è la stessa famiglia
di «vuoto = zero».

**E un fatto scomodo che va lasciato in piedi: su classic il nostro posto perde contro la media dei rivali**
— il valore fa **−2,6%** a giornata (2/10) e ogni politica provata è negativa. Non è un difetto del
razionamento (la base `needFor` fa −1,4%): è che su Serie A, con un pool appena più grande della domanda e
sei sedie su dieci guidate dal Qt.I, il vantaggio informativo è sottile. Su mantra le stesse politiche stanno
sopra la media (+2,1%).

### 17.4 Il mercato ci batte SU EURO, non su Serie A — e la conclusione era scritta al singolare

Misurato con lo stesso `signal.py` sulle dieci finestre di `default` (§7-octovicies(a) lo aveva fatto sulle
cinque di euro):

| segnale | euro (5 finestre) | default (10 finestre) |
|---|---|---|
| `pv_pred` | +0,459 | +0,426 (**10/10** contro `fm_pred`) |
| `fm_pred` | +0,259 | +0,283 |
| `value` = fm × pv | +0,499 | **+0,475** |
| Qt.I | **+0,574** | +0,463 |

Due conclusioni, e la seconda è una correzione. **Il collo di bottiglia `pv` regge su quindici istanze
finestra** (5 euro + 10 default), 15/15, e con la varianza a dirlo da un'altra strada (85-91% su default).
E **«il mercato ci batte nel classificare» è una frase su una PIATTAFORMA**: su euro il Qt.I ci batte
(+0,574 contro +0,499), su Serie A lo battiamo noi (+0,475 contro +0,463). È la terza volta che una
conclusione di questo progetto viene scritta al singolare su una quantità che dipende dalla piattaforma —
il CLAUDE.md lo elenca già come difetto ricorrente, e questa volta la correzione arriva dalla misura e non
da una rilettura.

### 17.5 Item 2.5 — il banco NON può rispondere, e le due ragioni sono misurate

Pesare il pv dell'orizzonte col calendario del club non è misurabile su questo banco, e non per mancanza di
una politica in più:

1. **Su una stagione intera il calendario è identico per tutti.** Un girone all'italiana fa giocare ognuno
   contro tutti, quindi la difficoltà cumulata è la stessa per definizione e un peso di calendario può
   contare solo su un orizzonte PARZIALE. Il banco misura stagioni intere.
2. **Le partite storiche non ci sono.** `fixtures` contiene 2.538 righe e sono **tutte 2026-27**: per le
   finestre del banco non esiste nessun calendario, quindi la politica non è nemmeno calcolabile.

Quindi l'item resta aperto con due prerequisiti nominati: un metro su orizzonte parziale, e l'acquisizione
dei calendari storici. Dirlo è meglio di una mezza misura — e la prima delle due ragioni vale anche come
avvertimento sul pannello: le colonne `desc_easy_matches` e `desc_calendar_margin` hanno senso sulla finestra
`from`–`to`, non sulla stagione.

## 18. Sfruttare l'asimmetria: il nostro vantaggio è UN numero, e la leva più grossa non è informativa (10 agosto 2026, notte)

**Domanda dell'operatore:** «noi conosciamo Qt.I, FVM, surplus e valore; gli altri solo Qt.I e FVM — come lo
sfruttiamo?» La risposta è misurata e non è quella che sembra: il nostro vantaggio informativo è reale, largo
un numero solo, e **più piccolo del loro**; la leva che paga davvero non usa informazione affatto.

### 18.1 Prima di sfruttarla, verificare che esista: parziali contro l'esito

`edge.py`. Un vantaggio esiste solo se il nostro numero porta informazione che il PREZZO non ha — e «la nostra
correlazione è più alta» non lo dimostra, due segnali possono ordinare uguale e dire la stessa cosa. Quindi si
chiede come il progetto chiede ogni domanda incrementale (gate §7-duovicies): partial Spearman contro l'esito
vero, ciascun segnale controllato per l'altro.

| segnale, controllato per | euro (5 finestre) | Serie A (10 finestre) |
|---|---|---|
| **value \| Qt.I** (il nostro vantaggio) | **+0,214** | **+0,246** |
| **Qt.I \| value** (il loro) | **+0,388** | +0,211 |
| pv_pred \| Qt.I | +0,198 | +0,243 |
| fm_pred \| Qt.I | +0,046 | **−0,032** |
| surplus \| Qt.I | +0,006 | **−0,077** |

Tre letture, e la terza è la più importante.

**Il vantaggio esiste** e non è redundante: il nostro valore aggiunge +0,21/+0,25 sopra il prezzo.
**Ma su euro il loro è quasi il doppio del nostro** (+0,388 contro +0,214): là l'asimmetria taglia contro di
noi, ed è coerente col §17.4 (Qt.I +0,574 contro +0,499) e col §15.2 (il prezzo è la miglior testa delle dieci
provate). Su Serie A si ribalta (+0,246 contro +0,211). **Quindi «fidati del nostro numero» non è la risposta
su euro, e «fidati del prezzo» butta via la nostra metà.**

**E il vantaggio è largo UN NUMERO SOLO: le presenze.** Controllando per il prezzo, `pv_pred` vale +0,198 e
+0,243, la fantamedia **+0,046 e −0,032**, il surplus **+0,006 e −0,077**. Il nostro vantaggio su un tavolo
guidato dal prezzo non è la fantamedia e non è il surplus: è chi gioca. Terzo chiodo indipendente sul surplus
come chiave d'asta, dopo il −4,0% del draft e il −0,077 di Serie A.

La prova del disaccordo lo conferma dall'altro lato: dove noi lo mettiamo alto e il mercato basso (1182 uomini
su euro), l'esito vero cade al 45,2° percentile contro il nostro 62,6 e il loro 31,8 — **più vicino a loro**.
Su Serie A cade al 49,1 contro 62,3 e 33,7, appena più vicino a noi. I nostri disaccordi con il prezzo, su
euro, sono in media **nostri errori**.

### 18.2 La leva che paga: PRENDI CHI SPARIRÀ, RACCOGLI CHI RESTA (adottata, +4,54% strict)

Se il vantaggio informativo è sottile, quello **comportamentale** non lo è: i rivali ordinano per prezzo,
quindi i cari sparisco e gli economici restano. Due candidati che valutiamo uguale **non sono equivalenti**: il
caro va preso ADESSO o è perso, l'economico si raccoglie al giro dopo. Comprare il sopravvissuto per primo
spende una scelta per avere ciò che aspettare dava gratis.

`survival(sconto)` in `policies.mjs`: il valore, moltiplicato per lo sconto se l'uomo **sopravvivrà** al nostro
prossimo turno. Chi sparirà è SIMULATO con quello che il tavolo mostra — la regola d'ordine della piattaforma,
le rose pubbliche dei rivali, e una testa sola per tutti (il prezzo, deliberatamente: la più debole delle due
assunzioni disponibili, così il candidato vince o perde senza il classificatore del §17.1). Non vede il futuro.

Guadagno sui nostri punti a giornata contro la politica ADOTTATA (valore + copertura ×2), cinque finestre:

| candidato | Tm4 | Tm3 | T0 | T1 | T2 | media | vinte | verdetto | speso |
|---|---|---|---|---|---|---|---|---|---|
| sopravvive → sconto 0,85 | +4,84 | +2,08 | +0,64 | +8,20 | +3,03 | +3,76% | 5/5 | **strict** | 338 |
| **sopravvive → sconto 0,70** | +4,63 | +2,24 | +3,75 | +7,43 | +4,63 | **+4,54%** | 5/5 | **strict** | 345 |
| sopravvive → sconto 0,50 | +6,41 | +1,07 | +2,61 | +7,14 | +3,54 | +4,16% | 5/5 | **strict** | 352 |

**È la leva più grossa di tutta la campagna e l'unico verdetto STRICT che questo banco abbia prodotto**: tre
volte il vincolo di copertura (+1,47%, robust), che era il record precedente. Il parametro è **interno**
(0,85 → 0,70 → 0,50 sale e poi scende) e 1,0 è la regola spenta, cioè la base. La spesa sale da 299 a 345
crediti, e **quella è il meccanismo**: compra ciò che sarebbe sparito. La copertura sale ancora un po'
(97,4% → 98,4%). Adottata: `SURVIVOR_DISCOUNT = 0,7`, e il banco verifica che il codice spedito riproduca la
misura riga per riga (`APP: sopravvivenza dal pannello`, identica in ogni colonna).

Vale la pena notare cosa questo dice del §16.4: il pavimento prezzo fallisce perché spinge verso gli
ECONOMICI, cioè esattamente verso i sopravvissuti — comprava per primi quelli che si potevano aspettare. La
regola giusta è il contrario del pavimento, e ha lo stesso ingrediente (il prezzo) usato al rovescio.

### 18.3 Il blend prezzo+nostro: passa, ma è lo STESSO meccanismo più smussato

Griglia pre-registrata, percentili dentro la finestra (due segnali si mescolano su una scala sola o si mescolano
le loro unità). Guadagno contro il valore puro:

| candidato | media | vinte | verdetto | speso |
|---|---|---|---|---|
| prezzo + valore, w=0,25 | **+2,35%** | 5/5 | strict | 367 |
| prezzo + PRESENZE, w=0,25 | +2,31% | 5/5 | strict | 364 |
| prezzo + valore, w=0,75 | +1,94% | 5/5 | strict | 339 |
| prezzo puro | +1,57% | 4/5 | robust | 374 |
| prezzo + valore, w=0,5 | +1,53% | 2/5 | — | 357 |

Funziona (w = 0,25 è interno fra 0 e 0,5) e vale **metà** della sopravvivenza. E non si sommano: misurato,
**sopravvivenza SU blend fa +2,52%, 4/5 — peggio della sopravvivenza da sola**. Sono lo stesso meccanismo
contato due volte: ordinare più vicino al prezzo significa prendere gli uomini che i rivali vogliono, cioè
quelli che sparirebbero, e lo sconto sui sopravvissuti lo fa di nuovo. Quindi **non si adotta il blend**: la
forma esplicita è il doppio e la composizione è dannosa. Vale come metodo: due guadagni che «sembrano
indipendenti» vanno moltiplicati insieme prima di sommarli a parole.

### 18.4 «Fare l'asta due giornate dopo l'inizio dovrebbe favorire surplus e value»

**Ipotesi dell'operatore, misurata (`late.py`), e il meccanismo è giusto mentre il beneficiario no.**

Il bersaglio di un'asta fatta dopo la giornata k non è la stagione: sono i fantapunti dalla k+1 in poi, e li
abbiamo giornata per giornata. Spostato il bersaglio, il nostro vantaggio sul prezzo **non si muove**:

| | stagione intera | dalla 3ª (k=2) | dalla 7ª (k=6) |
|---|---|---|---|
| value \| Qt.I (euro) | +0,214 | +0,209 | +0,204 |
| surplus \| Qt.I (euro) | +0,006 | +0,004 | −0,001 |
| value \| Qt.I (Serie A) | +0,246 | +0,240 | — |

Ma quelle giornate sono **PUBBLICHE**, e sono il segnale più grosso di tutto il file:

| | k=2 | k=6 |
|---|---|---|
| presenze VISTE \| Qt.I (euro) | **+0,443** | **+0,536** |
| presenze VISTE \| value (euro) | **+0,494** | **+0,584** |
| presenze VISTE \| Qt.I (Serie A) | +0,278 | — |

Più grosso del Qt.I, più grosso del nostro valore, e **cresce con k**. E ci mangia il vantaggio: una volta noto
il prezzo E le presenze osservate, `value` scende da +0,209 a **+0,170**, `pv_pred` da +0,192 a **+0,127** (un
terzo perso) e il **surplus va NEGATIVO, −0,028**.

Quindi: **l'intuizione sul meccanismo è esatta — le presenze diventano meno incerte e le presenze sono tutto il
gioco — ma il beneficiario non siamo noi. L'incertezza ERA il nostro vantaggio**, e togliergliela lo toglie a
noi. Il fatto che `presenze VISTE | value` (+0,494) sia più alto di `presenze VISTE | Qt.I` (+0,443) è la parte
che brucia: le formazioni viste aggiungono più sopra il NOSTRO numero che sopra il loro, cioè il nostro numero
cattura quelle informazioni peggio del prezzo.

**Due conseguenze operative, e la prima è un requisito, non una raffinatezza.**
1. **Se l'asta è a stagione iniziata, il foglio va ricostruito a quella data e il pv deve LEGGERE le giornate
   giocate.** `engine_pv_pred` è costruito sulla stagione precedente; le presenze osservate valgono +0,443 a
   k=2 e +0,536 a k=6 sopra il prezzo, che è il numero più grande misurato in tutta questa campagna. Un
   pannello che non le legge, in un'asta al terzo turno, sta ignorando il segnale principale.
2. **Se possiamo scegliere quando farla, farla PRESTO tiene la gara sulla previsione**, che è dove un motore
   batte uno scalare; farla tardi consegna a tutti gratis un segnale che noi ancora non leggiamo.

### 18.5 La risposta breve, e cosa NON fare

- L'asimmetria informativa è **reale, larga un numero (le presenze) e più piccola della loro su euro**. Non si
  sfrutta preferendo il nostro numero: su euro i nostri disaccordi col prezzo sono in media nostri errori.
- Si sfrutta **sapendo cosa faranno**, non sapendo più di loro: `SURVIVOR_DISCOUNT` = 0,7, +4,54% strict, e il
  classificatore delle teste (§17.1) rende la simulazione migliore di quella con cui è stata misurata.
- Il **surplus** non aggiunge niente sopra il prezzo (+0,006 su euro, −0,077 su Serie A, −0,028 a stagione
  iniziata). Come chiave di ordinamento è finita: resta la grandezza giusta per un'asta a CREDITI, dove la
  domanda non è «chi ordinare» ma «quanto pagare».
- Da **non** fare: sommare blend e sopravvivenza (misurato, peggio); reintrodurre un pavimento prezzo (§16.4 —
  ed è il rovescio esatto della regola che funziona).

## 19. La COPPIA «uno che fa bonus e gioca poco + una riserva affidabile»: misurata in due forme, respinta in entrambe (10 agosto 2026, notte)

**Idea dell'operatore:** per un posto del modulo, prendere un calciatore che gioca poco ma fa spesso bonus
INSIEME a uno da panchina, dello stesso posto, che fa molte presenze e pochi bonus. La coppia copre il posto:
quando gioca il primo prendi il bonus, quando non gioca c'è il secondo.

Il meccanismo è reale e ha una forma matematica esatta, quindi è stata misurata in due forme invece di una —
perché «sostituisci la moneta» e «preferisci quella riserva» sono due ipotesi diverse e potevano dare risposte
diverse. Non l'hanno data: perdono entrambe.

### 19.1 La forma FORTE: la resa attesa del posto come moneta

Se schieri sempre il migliore fra quelli che si presentano, un posto rende

    E = SOMMA_i  fm_i × p_i × PRODOTTO_{j<i} (1 − p_j)

e il valore marginale di aggiungere un uomo a un posto già tenuto da uno inaffidabile è
`fm × p × (1 − p_tenuto)` — grande esattamente quando il titolare è inaffidabile. È l'idea dell'operatore
scritta, **senza nessun parametro**, e sostituirebbe `DEPTH_WEIGHT` = 0,35 (una costante dichiarata) con una
quantità calcolata. Per questo valeva la misura.

Guadagno contro la politica che SPEDISCE (valore × copertura ×2 × sopravvivenza 0,7), cinque finestre:

| candidato | Tm4 | Tm3 | T0 | T1 | T2 | media | vinte | coperti |
|---|---|---|---|---|---|---|---|---|
| **portafoglio (resa del posto)** | −0,28 | −3,93 | −5,88 | −8,58 | −4,79 | **−4,69%** | 0/5 | 94,4% |
| portafoglio, senza copertura | −3,54 | −9,04 | −8,28 | −13,93 | −7,56 | −8,47% | 0/5 | 90,3% |
| portafoglio, senza sopravvivenza | −5,00 | −11,21 | −5,34 | −9,29 | −7,64 | −7,70% | 0/5 | 93,3% |

**Refutata, e il meccanismo è leggibile.** Due difetti, e sono lo stesso difetto visto da due lati.
**Raziona la profondità molto più duramente di quanto convenga**: il fattore `(1 − p_tenuto)` vale 0,15-0,30
per un titolare con p fra 0,70 e 0,85, contro il **0,35** piatto che spedisce — quindi compra meno riserve, e
la copertura scende da 98,4% a 94,4% delle giornate, cioè proprio la leva che il §16.2 ha misurato valere un
ordine di grandezza. E **tratta i posti come INDIPENDENTI**, definendo «chi gli compete il posto» come «chi
condivide un codice di ruolo»: su mantra 497 quotati su 1014 hanno 2+ codici, quindi un uomo flessibile viene
scontato contro il posto meglio coperto fra quelli che sa occupare, e la flessibilità è ciò che rende legale un
undici. È un tetto per ruolo travestito, e che i tetti per ruolo non bastino a esprimere il vincolo questo
progetto lo ha già stabilito (`assistente-asta-v1.md` §12.3).

### 19.2 La forma RISTRETTA: tieni la moneta, preferisci solo la riserva affidabile

Un moltiplicatore limitato SOPRA quello che spedisce — 1 per un posto vuoto, `1 + k × (1 − p_tenuto) × p` per
un posto già occupato — così non può razionare la profondità e isola la sola preferenza sulla coppia:

| candidato | media | vinte | coperti |
|---|---|---|---|
| coppia: riserva affidabile k=0,3 | −0,40% | 0/5 | 98,2% |
| coppia: riserva affidabile k=0,6 | −0,50% | 1/5 | 98,1% |
| coppia: riserva affidabile k=1,0 | −0,55% | 1/5 | 98,1% |

**Piatta e monotona nella direzione sbagliata**: non danneggia, non paga, e peggiora al crescere di k. È un
«confermato niente da guadagnare» e non un «trovato peggio» — la distinzione conta, perché il secondo invita a
riprovare e il primo no.

### 19.3 Perché non paga: due ragioni che il progetto aveva già misurato

**La moneta la contiene già.** `valore = fm × pv`. Un uomo che fa bonus e gioca poco ha le poche presenze già
dentro il prezzo del suo numero; una riserva affidabile che non fa bonus ha la fantamedia bassa già dentro il
suo. Sono sulla stessa scala, quindi una preferenza sulla coppia **ri-addebita informazione che la moneta ha
già** — la stessa forma dell'età (CLAUDE.md, «una differenza fra due gruppi non è un canale»: i trentenni
hanno già meno minuti misurati, quindi un termine sull'età addebita due volte la stessa evidenza).

**Il metro ti regala già il beneficio della coppia.** `matchdayXI` schiera il miglior undici legale fra i
DISPONIBILI di ogni giornata: la riserva affidabile entra da sé nelle giornate in cui il titolare non c'è,
senza che nessuno l'abbia accoppiata di proposito. Il guadagno che l'idea si aspetta è già nella base;
imporlo distorce solo la graduatoria.

E la terza, che è la più scomoda: **ciò che separa i criteri è la disponibilità, non la fantamedia** (§15.5 —
la fantamedia vera del miglior undici sta fra 7,05 e 7,56 per TUTTI i criteri e tutte le stagioni). «Uno che
fa bonus ma gioca poco» compra la dimensione che non separa.

### 19.4 E il metro era GENEROSO con l'idea, il che rafforza il rifiuto

`matchdayXI` concede la previsione perfetta dentro la giornata: schiera il migliore fra i disponibili come se
si sapesse in anticipo chi gioca. Il gioco vero dà una **gerarchia ordinata di sostituzioni** con il malus
fuori posizione (`mantra_modules.json`, «optimal → efficient → adapted»), quindi la coppia copre **meno bene**
di quanto il banco assuma. Un'idea che perde con il metro a suo favore perde di più nella realtà.

Da nominare per la stessa ragione: se questa lega accende l'**R-Factor**, spinge ancora contro. L'R-Factor
«misura il numero di calciatori con voto di BASE almeno sufficiente» (§14.2) — i bonus non lo alimentano —
quindi un uomo che vive di bonus con un voto base mediocre non gli porta niente, mentre la riserva affidabile
da 6,0 gli porta tutto.

### 19.5 Cosa NON è stato misurato, e va detto perché il rifiuto non lo copre

Quello che è stato refutato è «fantamedia alta con poche presenze, accoppiata a molte presenze con fantamedia
bassa». **NON** è stato misurato se la QUOTA DI BONUS della fantamedia conti separatamente dal suo livello:
due uomini da 7,0 di fantamedia, uno costruito sui bonus e uno sul voto base, per il totale dei fantapunti
sono lo stesso uomo, e il motore ne prevede un numero solo (`fm_pred`) — non sa distinguerli.

Ci sono due strade per cui la distinzione potrebbe contare, e nessuna delle due è nei numeri qui sopra:
- **l'R-Factor**, che conta i voti base e non i bonus (sopra) — e spinge contro il bonus-man;
- la **varianza**, che in un campionato a scontri diretti non è neutra: una rosa a varianza alta vince più
  partite improbabili e perde più partite probabili, che vale qualcosa per una squadra sfavorita e niente per
  una favorita. Il banco misura i PUNTI, non le partite vinte, quindi su questo non dice nulla.
`match_rating_bonuses` conserva i bonus riga per riga, quindi una «quota di bonus» per giocatore è
costruibile: è una misura possibile, non fatta, e non è quella che questa sezione ha respinto.

### 19.6 Un difetto di banco pagato, e vale come regola

La prima esecuzione non finiva mai. `withSurvival` costruiva il memo della simulazione **dentro** la funzione
restituita invece che dove la politica si costruisce: il memo diventava per-chiamata e il look-ahead veniva
rifatto per OGNI candidato di ogni scelta. Non falliva — girava e non arrivava mai, che è il modo peggiore di
sbagliare. **Un hook memoizzato si costruisce dove si costruisce la politica**, e una politica che rallenta di
due ordini di grandezza va guardata prima di attribuire la lentezza al banco.
