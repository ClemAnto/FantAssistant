# Stato progetto & continuità — v5
**Aggiornato: 28 luglio 2026 (terza chiusura: il ruolo reale granulare)**
Documento autosufficiente: una sessione nuova, anche senza memoria, riparte da qui + i file della cartella "Modello Previsionale Fantacalcio".
*Glossario: T1/T2 = finestre di test (23/24->24/25, 24/25->25/26) · MAE = errore medio assoluto · cross-fitted = parametri stimati su una finestra, testati sull'altra · M2e = modello portieri decomposto con ClubElo · Pv_att = presenze attese · fc_id = id fantacalcio.it · EV = valore atteso · scoring_config = punteggi configurabili per lega · xG/xA = expected goals/assists · 2.5 pieno = backtest motore completo con flag.*

## Cos'e'
App per leghe EuroLeghe/fantacalcio.it (Classic+Mantra, 5 campionati) con motore previsionale. Metodo: ogni regola entra SOLO se batte il baseline fuori campione su finestre indipendenti (gate pre-registrato). Doc madre: modello-previsionale-v3.8.md.

## ⚠️ Lo stato corrente è in `00-BRIDGE-punto-di-ingresso.md`, blocco «STATO AL 29 LUGLIO 2026»

### 29 luglio 2026, in una riga: quattro credenze del fantacalcio misurate, e l'effetto è sempre su CHI GIOCA
Domande dell'utente: riposo corto, «vincere aiuta a vincere», l'undici che si conferma dopo una vittoria,
la sferzata del nuovo allenatore. Misurate su `platform='default'` (Serie A), 7 stagioni,
**106.977 partite-giocatore**, esiti demeaned dentro (giocatore, stagione), unità d'inferenza la
giocatore-stagione. **DESCRITTIVO: nessun giro di gate, nessun verdetto cambia, nessuna regola entra.**
Rapporto: [turnover-atteso-v1.md](turnover-atteso-v1.md) · sintesi: `gate-motore-v1.md` §5-duodecies.
**Riposo ≤3 giorni** (per chi aveva giocato ≥60'): **P(titolare) −9,8pp**, **P(voto) −4,4pp**, negativo
**7 stagioni su 7** — e **fantavoto −0,014 (t −0,5)**, segno instabile fra stagioni. **Dopo una vittoria
contro dopo una sconfitta**: **+5,0 / −4,1pp** per chi era titolare, specchiato sui panchinari (−4,8 /
+4,5), **XI confermato 78,2% vs 71,0%** (≈2,4 maglie cambiate dopo una vittoria, 3,2 dopo una sconfitta),
**7 su 7**. Le credenze sul **rendimento** cadono e una ha il **segno rovesciato**: fantavoto
**−0,046** dopo una vittoria (−0,032 corretto per l'avversario), e regge al proprio **null rimescolato**
(null −0,002; contrasto W−L −0,074 contro −0,002, t −3,4) — ma un punto di fantavoto in t−1 vale
**+2,35pp** di titolarità in t, cioè l'informazione passa dalla **scelta dell'allenatore**.
**«Ha segnato, si ripeterà?» (29/07, 300 rimescolamenti per sequenza)**: **il gol è senza memoria** — su
Serie A tutte e quattro le statistiche di raggruppamento sono a zero su 1.260 giocatore-stagione — mentre
**il livello di prestazione ha un filo di memoria** (quartile alto di fantavoto raggruppato su entrambe le
piattaforme, t +2,7…+6,5, ma **+0,014 su un tasso base di 0,408**: 42% contro 40%). ⚠️ Da qui una
**correzione**: la «mano calda a −0,035» della prima stesura era la **distorsione di campione finito**
(−1/(n−1) ≈ −0,044 con 24 partite), non un effetto; col null giusto è **+0,012 (+3,4 sd del null)**. Regola
di metodo: un'autocorrelazione ritardata dentro un gruppo demeaned si confronta con la sequenza
rimescolata, non con zero. **Nuovo allenatore** (31 cambi in corsa): grezzo +0,481 ppm, controlli
appaiati +0,253, **netto +0,227 (SE 0,118, t 1,9)** → **53% è ritorno alla media**; quello che fa davvero è
cambiare **1,2 maglie** subito (conferma 64,4% contro 75,1%). Coerente con la caduta di R10.
**La cornice**: **Var(ln pv) = 90,5%** di Var(ln fantapunti) su `default`, 89,9% su `euro`, contro ~2% di
Var(ln fm) — il 90% di una stagione sono le presenze, che spiega perché tutto l'adottato (R3, R3c, R7, R13)
è presenze o minuti. **Difetto di dati chiuso senza rete**: il risultato di una partita di Serie A è
derivabile offline (`goals` è al netto di rigori **e** autogol; screening severo → **278 giornate su 418**).
Manca, per farne una regola: un **gate per-giornata** e i dati di **coppa/Europa**.

### 28 luglio 2026 (notte tarda), in una riga: ogni calciatore ha il suo RUOLO REALE, e si sa dove collocarlo
Richiesta dell'utente: il ruolo reale di ogni giocatore, recuperato **quando gira lo snapshot**, per
sapere orientativamente dove metterlo in campo. **Dodici codici** (`GK` · `DL DC DR` · `DM` · `ML MC MR` ·
`AM` · `LW RW` · `ST`), **enumerati misurando** — 128 giocatori campionati non hanno restituito
nient'altro — con etichetta italiana e badge (`Ts`, `Dc`, `Td`, `M`, `C`, `T`, `Es/Ed`, `As/Ad`, `Pc`), e
sono una **griglia**: lato (−1…+1) e profondità (0 = porta propria … 1 = avversaria, lo stesso asse di
`avg_x`), quindi si posizionano. Nessuna colonna esistente li sostituiva: `role_classic` chiama `D` sia un
terzino sinistro sia un centrale, e **`positions.derived_role` li chiama `D` entrambi anche lui**; `DM`,
`MC` e `AM` sono tre posti in campo che il listone chiama tutti `C`.
Costo: **una richiesta per CLUB** (`/team/{id}/players` porta l'intera rosa) → 35 club invece di ~1500
giocatori, ~2 minuti, **zero** rieseguendo lo stesso giorno. Nuovo `positions --layer roles`; i team id
del provider dedotti *offline* dalle cache già presenti (92 club).
⚠️ **TERZO fatto non backfillabile**: `?seasonId=` risponde **200 e lo ignora** (Dimarco → `['ML']` per
ogni stagione), quindi `player_roles` è **datata** e sta accanto a `probable_starter` e `contract_until`.
Storiche e intatte: `derived_role` e `avg_x/avg_y`.
Precedenza sul lato **decisa misurando**: heatmap e codice concordano su **196/219** laterali (89%); nei 23
restanti vince il codice, ma un codice **centrale** non è una pretesa sulla fascia e lì resta la misura
(Bastoni `DC;DR` → −0.53). **1372 osservazioni datate, 745/883 righe del foglio (84%).**
E i dodici codici diventano **ruoli Mantra** (`desc_mantra_real`): il Mantra semplifica — `ML`/`MR` → `e`,
`LW`/`RW` → `w` — e due ruoli **nessun codice singolo** li produce, che è l'argomento per portarne fino a
tre: **`b` braccetto** = fascia difensiva **+** `DC` (139 giocatori contro i 28 del listone: è una
*capacità*, registrata e non tarata) e **`AM` → `t`|`a`** dalla linea larga del provider (63 `M`, 19 `F`).
Non sostituisce `rosters.roles`: **esiste per quando non esistono**, e nel foglio 26/27 sono 1343 su 1343.
Dove ci sono entrambi: **48% identici, 44% condividono un ruolo, 8% disgiunti**, e le disgiunte sono quasi
tutte `a` (listone) contro `w` (provider) — cioè per cosa lo compri contro dove gioca.
**Nessun verdetto del gate cambia**: fatti descrittivi + layout; il vincolo è registrato in
`gate-motore-v1.md` §5 punto 6. Dettaglio: spec «Novità v9.7».

### 28 luglio 2026 (notte, seconda parte), in una riga: il toolkit è completo, esporta e si ricostruisce da zero
Quattro richieste in una sessione, tutte chiuse — e **nessuna regola è entrata nel motore**: sono dati,
strumenti, infrastruttura. (1) I due buchi dichiarati: **`injuries`** (assenze datate con
`matches_missed`) e la **heatmap** `avg_x/avg_y`; ⚠️ la scadenza contratto esiste **solo per oggi**,
quindi `exit_risk` serve all'asta che viene e **non è gatabile sul passato**. (2) **`export`**: il
bundle dell'app, 229 116 righe / 29 MB, contratto derivato da `engine/features.py`, manifest con
provenienza, prezzi auction-safe, parametri provvisori e buchi noti, `--verify` che ri-apre quello che
ha scritto. (3) **Da zero su un'altra macchina**: `bootstrap --plan` (15 passi, ~17 h, ripartibile),
`elo` dall'API ClubElo (**76 righe/2 date → 921/10 date**), lega del club dalla cache provider,
`fetch --plan/--inbox`, `.env.example`, `ingest_runs` scritta. (4) **UI rifatta** con tema light/dark,
icone, metriche e log colorato. Misura utile arrivata di striscio: cross-tab dei ruoli
**D→D 97% · M→C 80% · F→A 80% · G→P 100%**, che era il prerequisito per estendere i conteggi di reparto
oltre gli attaccanti. **194 test verdi, ruff pulito.** Dettaglio: spec «Novità v9.4».
Questo documento è un registro cronologico: dove contraddice quel blocco, vince quello.

### 28 luglio 2026 (notte), in una riga: le coppie d'attacco sono state misurate, e il meccanismo c'è ma non paga
Domanda dell'utente: due attaccanti dello stesso club nelle top-10 (Kean+Piccoli, Marmoush+Haaland) sono
sospetti, trovare come distinguerli. Fatto in tre pezzi, senza **una** richiesta di rete: **dati** (sei
colonne di tiro + `club_match_lineups` → K = attaccanti schierati per undici, e i co-start), **regola**
(R17: coefficiente negativo e **stabile ovunque**, quindi il meccanismo esiste — ma i giocatori che sposta
peggiorano su 9 finestre×piattaforma su 10 → **quinta** formulazione dell'affollamento bocciata
sull'errore), **valuta d'asta** (pressione di reparto, con lo sconto ai reparti contesi e il **premio** al
posto garantito che l'utente ha chiesto: VALORE catturato −0.61%, entro il limite, ma **bust 10.1% →
10.1% identico su ogni finestra** → nasce SPENTA). Spedisce invece la colonna **Pair** (compagno, K,
co-start, ΔQt.I): stessa evidenza, zero riordino. Il diagnostico ha ribaltato la premessa del caso: su
T1/T2 le coppie top-15 dello stesso club hanno reso **entrambe 23 volte su 23**, e i flop veri stavano
fuori. **Voce nuova a leva più alta: i nuovi arrivi senza storico non sono prezzabili** — Openda e David
non stavano in nessuna top-10 predetta, quindi nessuna metrica d'asta può proteggere da loro.
Doc: `attacco-affollato-r17-v1.md`, `metrica-asta-surplus-v1.md` §11, spec «Novità v9.3». 167 test verdi.

### 28 luglio 2026 (sera), in una riga: è cambiata la valuta dell'asta, non il motore
Il pannello ordina per **SURPLUS = (FM − rimpiazzo) × Pv × beccabilità** con una soglia di schierabilità
(`metrica-asta-surplus-v1.md`), perché misurato `VALORE = FM × Pv` era quasi solo presenze. Non passa dal
gate — non tocca né FM né Pv — e i numeri pubblicati sono invariati al numero. **Sei candidate provate,
zero adottate** (nove in tutta la giornata, contando R13c, R5b, R3d); i set adottati **non cambiano**.
Chiuse due famiglie (forza-club, persistenza-previsionale), cambiati due criteri del gate (stabilità del
coefficiente come classifica, non-danno elastico al 2%), e adottata la regola che un coefficiente senza
provenienza non è un fatto — con l'audit che ne ha trovati 7 su 12 non riproducibili. Toolkit **v0.2.0**,
158 test verdi. Dettaglio: `gate-motore-v1.md` §5-quinquies … §5-undecies e `metrica-asta-surplus-v1.md`.

## Stato motore — TRE MODULI SU QUATTRO VALIDATI (invariato)
1. **Core Mantra**: FM = ANCORA_M(rm) + 0.42*(FM_prec - ANCORA_M). Ancore frazionarie 3 stagioni (por 5.00 · dc 5.98 · b=dc · ds/dd 6.10 · e 6.25 · m 6.26 · c 6.35 · w 6.74 · t 6.77 · a 7.12 · pc 7.40). Cambi ruolo listone ASIMMETRICI. Non-inferiore a Classic (T1 -19.9% vs -17.4%).
2. **Portieri M2e**: FM = Mv_pred - GsRate_pred + 0.055; Mv_pred = 6.15+0.40*(Mv_prec-6.15); GsRate = mix 50/50 persistenza + Elo asta. Gate -25%/-20%.
3. **Presenze attese**: share_att = 0.26+0.50*share_prec+0.14*(Mv-6.2)clip+0.04*cambio. Bias titolari +5.2 AZZERATO. **VALORE = FM_pred x Pv_att** = metrica d'asta.
4. **Strato flag/arrivi: I DATI CI SONO E IL GATE E' STATO ESEGUITO** (27/07). Delle feature ingerite
   **sono entrate nel motore**: copertura nuovi entrati via FM-equivalente (R1), minuti sulle giornate
   euro (R3c), curva d'eta' sulla FM (R4), persistenza presenze portieri (R7), nuovo allenatore (R10);
   su Serie A i minuti a stagione piena (R3) + R7. **9 ipotesi falsificate** con motivo registrato.
   Tutto in **`gate-motore-v1.md`** — leggerlo prima di proporre regole, contiene anche cosa NON
   riproporre.

## Stato motore dopo il gate (27/07) — quanto e' migliorato, ruolo per ruolo
MAE di VALORE sul campione comune (T1 / T2), set adottato contro B0:
- **euro**: P −0.5% / **−5.6%** · D −1.9% / −2.0% · C −1.3% / −1.2% · A −2.0% / −0.6% →
  **totale −1.7% / −1.6%**, top-10 6→8 e 12→14, copertura 475→532 e 489→548 giocatori prezzati.
- **Serie A**: P **−6.9% / −14.7%** · D −5.4% / −3.1% · C −3.8% / −1.5% · A −2.1% / −0.4% →
  **totale −4.3% / −2.7%**, top-10 11→13 e 14→15.
- Il buco n.1 resta lo stesso: **le presenze pesano da 3 a 11 volte piu' della FM** nell'errore di
  VALORE, in ogni ruolo e finestra. R3c e R7 lo attaccano, non lo chiudono.

## HARNESS DEL GATE — NUOVO (27/07), il pezzo che mancava da sempre
La regola d'oro non aveva forma eseguibile: il modello viveva nei documenti e in notebook usa-e-getta, quindi **nulla poteva essere davvero gated**. Ora c'e' `toolkit/euroleghe_ingest/engine/` (model/fitting/features/evaluate) + comando `python -m euroleghe_ingest backtest`, read-only sul DB, che scrive solo `data/reports/engine_backtest.json`. E' anche il **riferimento da cui verra' portato il motore TypeScript** in `app/prediction-engine`, quindi resta senza dipendenze ed esplicito.
- **`backtest --verify` riproduce 15 numeri pubblicati su 18.** Ancore Classic/Mantra, beta Mantra T1/T2, coefficienti Pv, portieri M2e (MAE e naive su entrambe le finestre), bias titolari T2: tutti OK.
- **3 da rivedere, tutti sul modulo presenze in T1 — ORA SPIEGATI**: `pv_gain_vs_naive_T1` (atteso
  -0.016, ottenuto +0.018), `pv_bias_naive_starters_T1` (5.2 → 4.17), `pv_gain_crossfit_T1` (+0.013).
  **Non e' il codice**: i coefficienti rifittati per finestra coincidono col pubblicato entro 0.015
  (T1 0.483/0.154/0.032 contro 0.47/0.16/0.03) e la tabella dei bias di T2 torna su tutti i segmenti.
  **Non e' la definizione dei segmenti**: il bias naive dei titolari e' monotono nella soglia (4.17 su
  30 giornate → 5.73 su 38) e nessuna soglia riproduce entrambi i numeri pubblicati. **E' la
  composizione del campione** (764/774 giocatori contro i 750/754 pubblicati) su un effetto da -1.6%.
  Conclusione da tenere: del modulo presenze e' confermata la **correzione del bias** (~5 giornate
  fantasma sui titolari), **non** il guadagno di MAE su T1. Nessuna regola va promossa su quel decimale.
- **Inventario input** (dice cosa manca al motore, non al DB): su T2/euro `fm_prev` 812/1453 · `minutes_prev` e `xg_prev` 989 · `foreign_fm_equiv` 301 · `birth_year` 1366 · `elo_target` 1067 · `penalty_rank` 144 · **`starter_prob` 0** (le probabili sono di oggi, non della stagione passata: servono snapshot settimanali per averle come input storico).

## TOOLKIT euroleghe-ingest — spec v9.3 — TUTTI I MODULI TRANNE fbref
*(v9.3, 28/07 notte, tutto offline: sei colonne di tiro su `external_match_stats`, tabella
**`club_match_lineups`** con i conteggi di reparto per undici — deliberatamente FUORI dall'imbuto
dell'identità, che da sola distruggeva il campione: Serie A 24/25 233 undici su 774, Juventus zero —
`probable_starter` con modulo/squadra/panchine, e `positions --layer reparse` che ri-parsa la cache senza
rete. ⚠️ Bug trovato lì: `SEASONS`, che è un default di download, limitava il reparse a 3 stagioni su 7.)*
Python, SQLite, naming inglese, con **UI operatore** (Tkinter, python -m euroleghe_ingest gui). Stato:
- **Operativi**: rosters, stats, ratings (+ **listone**), matchdays, fc_site, transfers, positions, synth, tournaments, arrivals, elo, validate, rebuild idempotente + GUI. Unico non implementato: **fbref** (Cloudflare). Dettaglio e numeri: spec v9.1 (fase 1) e v9.2 (strato flag/arrivi).
- **Correzione importante (26/07)**: nell'Excel dei voti `Rf` = rigori **fatti** e `Rs` = **sbagliati**, erano mappati al contrario → ai rigoristi il fantavoto applicava −3 invece di +3. **Il check FM e' passato da 234 giocatori fuori tolleranza a 0.** Nota: `Gf` esclude i rigori, il conteggio vero e' `goals + pen_scored`.
- **FBref e' bloccato** (403 Cloudflare su ogni path, anche con impersonation TLS) → **SofaScore e' la fonte primaria dei fatti**, e porta anche il rating per-partita che serve al voto sintetico. Client `curl_cffi`; `requests` prende 403.
- **GUI**: operazioni raggruppate per cadenza (setup / inizio stagione / ogni giornata), dialog opzioni per `ratings` e `positions`, griglia fantavoti sul **calendario reale** con le giornate fuori dal calendario euro colorate a parte (voto sintetico, arrotondato a 0.5).
- **Voti scaricati**: EuroLeghe (platform='euro') e Serie A classica (platform='default'), profondita' storica. rebuild li conserva re-ingerendo la cache Excel offline.
- **Listone (quotazioni)**: `GET /api/v1/Excel/prices/{championshipId}/1` (stesso id dei voti), fogli Tutti+Ceduti -> ruoli Mantra (RM) + prezzi per TUTTE le squadre, riempie i non-top di Serie A ricostruiti dai voti. Scaricato dentro lo scraping, ri-applicato offline nel rebuild. Copertura Mantra Serie A ~96%; prezzi anche su Premier/Liga/Bundes/Ligue1.
- **Code review (26/07)**: robustezza (utf-8-sig/BOM, scritture cache atomiche + try/except nei reingest, retry di rete, indici DB clubs.name e match_ratings(season,platform)) + consolidamenti (table_names, split ruoli su _norm_roles, RAW_INPUTS da SEASON_SOURCES). Scartato il bonus imbattibilita' nel fantavoto grezzo (verificato: FM-off 234->411, la fonte lo esclude). Ruff pulito, 25 test verdi (+1 skip GUI headless).
- **Commit** (branch master): 0bceb23 platform · 85b7a09 season_stats per-piattaforma · 258905e listone · 7619d27 listone Ceduti · e7e2394 migrazione doc in git · b831f5f code review.
- **Decisioni chiave v9** (dettaglio in spec-euroleghe-ingest-v9.md):
  - **platform = euro | default** in PK (calendari diversi; euro PARZIALE per la Serie A). euro = fantamedia/target; default = stagione reale piena. Ortogonale: **gameType = classic | mantra** (concern del motore).
  - **Aggregazione opzione A**: canoniche + layer grezzo match_rating_bonuses.
  - **season_stats per piattaforma**: euro (target) + default (propensione stagione piena).
  - **Propensione su stagione piena**: il calendario euro e' un sottoinsieme delle partite reali (un difensore puo' segnare fuori dal calendario euro). Target FM/Mv resta su euro; la propensione (gol/assist/xG per 90') si calcola su tutte le partite reali. Serie A dai voti default (gia' disponibile); altre 4 leghe da **FBref** (fatti) + **Sofascore** (rating + heatmap) con **voto sintetico CALIBRATO sulla sovrapposizione** (non a bucket), in external_stats taggato per fonte, mai nel target euro. Tutto passa dal gate.
  - **Mappa giornate euro<->reali PER LEGA** (matchday_map): una giornata euro = giornata reale diversa in ogni campionato. Verificata su Serie A 2023-24.

## LAYER PER-PARTITA COMPLETATO (27/07) — il difetto n.1 dei dati e' chiuso
Da 3.314 a **5.254 partite su 5.256 = 100%** (5 leghe x 3 stagioni), `external_match_stats` a 110.597
righe, **0 club con layer incompleto** contro 12/12/11. FM-equivalente attaccanti: MAE 0.249 -> 0.133 e
dal 67% al **94%** entro 0.3 dalla fantamedia reale. Le feature del motore ora si aggregano dal layer
per-partita (identita' indipendente dalla stagione, quindi copre i nuovi entrati): **copertura euro dal
31% al 42-43%**, **beta_new 0.19 -> 0.43**, Ezzalzouli da fuori-classifica a VALORE 110. Set adottati e
numeri sul campione comune invariati. Dettaglio, verdetti corretti (R2, R8) e il nuovo effetto da
ri-pre-registrare: `gate-motore-v1.md` §5-bis.

## RECENT_FORM — nuovo modulo (27/07): i prezzati senza storico
Ogni agosto il listone prezza 60-65 giocatori sopra la mediana del loro ruolo di cui non abbiamo NIENTE
(altri campionati o club fuori perimetro). `recent_form` ne prende le ultime N partite di club con
rating e minuti, datate, sotto `source='sofascore_recent'` (mai nella retta del voto sintetico: un 7.0
di Serie B non e' un 7.0 di Serie A). **113 giocatori, 1.094 partite, 89% risolti** con una scala di
identita' che rifiuta invece di indovinare. Il gate ha diviso la regola: **R13 presenze** dai minuti al
vecchio club PASSA su tutte e tre le piattaforme ed **e' adottata**; **R13b fantamedia** dal rating
confrontato fra campionati NO (lambda -0.45/+0.05). **Rivisto la sera del 27/07** col criterio
irrigidito: R13 batte la risposta banale su **Serie A** (dove i senza-storico vengono dall'estero) ma
non sull'euro, e la stessa sorte tocca a R1. Set adottati: **euro R0c+R3c+R4+R7+R10 · Serie A
R3+R7+R13**, con la copertura euro **dal 31% al 100%** grazie a R0c (il modello nullo esplicito:
ancora di ruolo + quota media, che nessuno degli stimatori sofisticati riusciva a battere).
Il regressore di R13 ora ha due termini invece di uno: **intensita'** (minuti per presenza) e
**disponibilita'** (partite a settimana sull'arco del campione) - il primo da solo non poteva
distinguere 38 presenze da 5, perche' il campione e' tagliato a dieci partite.

## Simulazione dell'asta 25/26 (27 luglio 2026) - la verifica che il committente ha chiesto
`backtest --auction --window T2`: set adottato, parametri stimati su T1, per ogni ruolo Classic le due
top 10 affiancate. **15/40 nomi** su entrambe le piattaforme (da 12/40 e 14/40 del baseline) ma
**l'80-81% del VALORE** delle top 10 perfette: il motore sbaglia i nomi fra giocatori comparabili.
Portieri il ruolo migliore (6/10 e 7/10, 87-88% del VALORE), difensori il peggiore (3/10, 70-77%:
l'ancora li schiaccia su ~6.1 e il vertice si decide sui bonus, che il motore non modella).
Dettaglio per ruolo, nomi e classificazione dei 25 errori in `gate-motore-v1.md` §3-bis.

## Due stagioni in piu' (sera del 27 luglio 2026) - il prerequisito piu' economico, sbloccato
Il prerequisito «stagioni precedenti al 23/24» era registrato come da verificare. **L'API le serve**:
la pagina pubblica dei voti risolve un championshipId per 22/23 (euro 105, Serie A 17), 21/22 (104/16) e
20/21 (103/15), e le cartelle Excel autenticate hanno **layout identico** a quelle attuali. Ingerite
22/23 e 21/22 su entrambe le piattaforme (~150 download educati, ~40 minuti l'una).

**Un limite trovato guardando i file, non dedotto**: EuroLeghe 21/22 **non ha voti** (ogni cella `Voto`
e' `'-'`, tutte le statistiche a zero, tutte le 30 giornate) mentre il listone e' vero. Quindi euro
guadagna **una** finestra (T0 = 22/23->23/24), Serie A **due** (Tm1 = 21/22->22/23).

Esito: **R10 confermata su tre finestre** (-5.2%/-3.5%/-4.9% di Pv MAE) e prima per contributo alle
top-10 · **R0c confermata** · **R4 esce** (contraddetta su T0, coefficiente instabile di 4.5x) ·
**R7 resta con riserva**: la sua premessa e' misurabile e falsa su una finestra su quattro, e non e'
valutabile il giorno dell'asta. Set adottati: **euro R0c+R3c+R7+R10 · Serie A R3+R7+R13**.
Numeri completi, decomposizione della regressione su euro T0 e i tre difetti del gate che solo piu'
finestre potevano rivelare: `gate-motore-v1.md` §3-ter.

**Poi spinto fino in fondo**: i voti Serie A ci sono almeno dal 2015-16 ed **euro 2020-21 ha i voti**
(il 21/22 e' un buco di una stagione, non il bordo). Ingerite 18/19, 19/20, 20/21 su Serie A e 19/20,
20/21 su euro: **7 finestre su Serie A, 4 su euro**.

**E qui il risultato piu' importante della giornata: R7 non era una scommessa, era uno stimatore
sbagliato.** La persistenza delle presenze dei portieri esce 0.505-0.798 su sette finestre, sempre sopra
lo 0.50 che il modello condiviso assume - il meccanismo e' confermato ovunque - ma ogni finestra veniva
valutata col coefficiente della SINGOLA finestra adiacente, fittato su ~30 portieri, che a volte era
quasi 0.50. Mettendo in comune le altre finestre (`POOLED_PARAMS`, leave-one-out): **da 4/7 a 7/7
finestre vinte, guadagno medio +9.8%, peggior finestra ancora +1.6%**. Su euro invece R7 esce.
Set finali: **euro R0c+R3c+R10 · Serie A R3+R7+R13**. Il set Serie A migliora il MAE di VALORE su tutte
e sette le finestre, non perde mai una posizione top-10, e porta i nomi azzeccati da 91 a 96 su 280.

**Ancora disponibile**: 17/18 e piu' indietro sulla Serie A (~7 minuti per stagione), e 19/20 e 18/19 su
euro. Ma il collo di bottiglia dell'euro non e' il numero di finestre: sono gli input
(`external_stats`, `arrivals`, `club_elo`, `new_coach`) che partono dal 23/24 e rendono cieche le
finestre vecchie sulle regole che contano.

## Audit dei dati (27 luglio 2026) - cosa manca davvero
Lo strato voti e' completo e **non serve altro scraping per i voti**. Due input non mancavano, erano solo
non ricalcolati - `flags.new_coach` (da `coaches`, storia fino al 1886) e `arrivals` (diff fra listoni):
ora 8 e 7 stagioni invece di 3 e 2, **senza una richiesta di rete**. Col test eseguibile **R10 cade**
(3/4 finestre euro, 4/7 Serie A, peggior finestra -6.7%). Set adottati: **euro R0c+R3c · Serie A
R3+R7+R13**. Verificato anche che il modello portieri M2e non usa `club_elo`, quindi le due sole date
di Elo non degradano nulla.

**FATTA il 27/07 sera, layer per-partita compreso**: 734 round, 109.126 righe, `matchday_map` per lega
sulle stagioni vecchie, sintetico ricalibrato, FM-equivalente su 1482 arrivi. Set finali: **euro R0c+R3c
(4/4, media +2.4%)** e **Serie A R3+R7+R13 (10/10, media +4.3%)**. R3 e R7 non hanno una sola finestra
contro; R8 e R4 bocciate senza dubbio (1/6 e 1/10). Restava scritto qui sotto come «la sola passata che
conta», e lo era: ~~SofaScore su 19/20-22/23~~ (aggregati stagionali ~1300 richieste/stagione,
layer per-partita ore) - senza i minuti storici le finestre vecchie sono cieche sulle regole che il
motore usa, ed e' per questo che R4, R7-euro e R10 sono sopravvissute cosi' a lungo. A costo quasi nullo:
euro 18/19 (~5 min) e Serie A 17/18-15/16 (~20 min) = quattro finestre in piu'. Impossibili: voti
EuroLeghe 21/22 (file vuoti alla sorgente) e la storia di `probable_starter`/`availability`, che va
accumulata da adesso. `injuries` resta senza fonte agganciata: e' una decisione, non una passata.

## Prossimo lavoro (aggiornato al 28/07 notte, in ordine)
0-quater. **Il toolkit non è più sul percorso critico** (v9.4): dati completi, bundle dell'app,
   ricostruzione da zero, UI. Le tre voci sotto restano, e sono tutte **del motore**, non della
   pipeline. Due cose però vanno FATTE SULLA MACCHINA, non nel codice: registrare il job settimanale
   (`pwsh scripts/weekly-snapshot.ps1 -Register` — ogni settimana non registrata è una finestra che non
   tornerà) e lasciar finire la camminata `injuries` (ore, ripartibile).
0-ter. **PREZZARE I NUOVI ARRIVI SENZA STORICO** (salita in cima la notte del 28/07): è il vincolo che ha
   reso inutile la pressione di reparto — Openda e David non erano in nessuna top-10 predetta, quindi
   nessuno sconto e nessun premio poteva proteggere da loro. Sblocca insieme la copertura Serie A (4
   attaccanti su 10 irraggiungibili) e la valuta d'asta. **Non serve un'ipotesi nuova**: R13c è ferma per
   campione (14-21 osservazioni valutabili per finestra) e il 26/27 la sblocca a costo zero.
0. **Modalita' live**: prezzare l'asta 26/27. Serve il listone (non ancora uscito) e un percorso che non
   pretenda un esito - oggi `_window_is_usable` vuole >=50 `fm_act`, il tab Auction mostra solo stagioni
   concluse e `auction_view` confronta due liste. E' il lavoro piu' importante e non e' iniziato.
0-bis. **Il lato fantamedia**: quattro delle cinque regole adottate sono presenze, una e' copertura. Sei
   famiglie di ipotesi sulla FM provate e cadute - prima di riprovarci serve un input nuovo, non una
   variante.

## Prossimo lavoro (elenco precedente, in parte superato)
1. ~~Completare il layer per-partita~~ **FATTO il 27/07** (sezione sopra): 100% delle partite, bias di
   selezione chiuso, copertura del motore dal 31% al 42-43% (e al 100% sull'euro con R0c).
2. **Storico `injuries`** (Transfermarkt, una richiesta per giocatore): l'unico input della Priorita' 1
   ancora assente, e meta' dei buchi nelle top-10 dei difensori sono infortuni.
3. ~~**Terza finestra**~~ **FATTA la sera del 27/07** (sezione sopra): euro a 3 finestre, Serie A a 4.
   Ha subito fatto il suo lavoro - R4 fuori, R7 con riserva, R10 rafforzata. Il passo successivo e'
   20/21 (id 103/15) e quanto ancora indietro la Serie A permetta.
4. **Ri-pre-registrare le due ipotesi che il layer completo ha cambiato** (`gate-motore-v1.md` §5-bis):
   la propensione per-90 (ora con il segno giusto) e la ~~sottostima da rifacimento rosa~~ (decaduta il
   28/07: nasceva da un segno che era un artefatto della baseline, vedi §5-septies) (effetto piu'
   grande di tutto il gate su Serie A, ma con l'etichetta sbagliata).
5. **Tarare i parametri provvisori** del 27/07 (decadimento/quarantena rigoristi, soglie tier T1/T3,
   U22): sono scelte di modello, non dati. Nota: i tier ora usano `Qt.I`, non `Qt.A`.
6. **Ad agosto, quando esce il listone 26/27**: aggiungere `2026-27` alle costanti `SEASONS` (ratings,
   positions, transfers), scaricare voti e Elo alla data d'asta 2026-08, salvare anche `Qt.A M`/`Qt.I M`/
   `FVM` -> **ALGORITMO COMPLETO asta 26/27**.

## Respinte dal gate (non riproporre senza nuove finestre)
beta per ruolo · baseline multi-stagione 62/38 · ancore per lega · **FAMIGLIA FORZA-CLUB CHIUSA il
28/07/2026 dopo quattro tentativi** (forza-club interna · Elo additivo movimento · R5 Elo alla data d'asta ·
R5b dagli xA): segno giusto tutte le volte, input derivabile dalla fantamedia del giocatore stesso, quindi
non incrementale. Riapribile solo con una misura **prospettica** e ortogonale alla sua storia — vedi
`gate-motore-v1.md` §5-nonies. Bias elite-in-big NON strutturale -> correttivo condizionale in pre-registrazione.
**Aggiunte il 27/07** (dettaglio e numeri in `gate-motore-v1.md`): sconto adattamento cross-lega
(segno opposto fra finestre, e il controllo intra-lega e' piu' grande) · propensione per-90 xG/xA
(gamma ~ 0 di segno sbagliato) · **ancora forza-club da ClubElo: TERZA bocciatura della famiglia**
(segno giusto, T1 sempre peggio) · rigoristi in forma ridotta (segno opposto, n=22/29) · fuori-ruolo da
heatmap · concorrenza posizionale (migliora il MAE ma non abbastanza; ⚠️ il «segno contrario
all'ipotesi» registrato qui era un artefatto della baseline pre-fit-a-due-passate — corretto il 28/07,
`gate-motore-v1.md` §5-septies: il segno **conferma** l'ipotesi ed e' stabile su 10 finestre su 10) · attesa di mercato Qt.I e sua revisione · eta' sulle presenze.
**Aggiunta il 28/07 notte** (dettaglio in `attacco-affollato-r17-v1.md` §9-10 e `gate-motore-v1.md` §4):
**R17, affollamento dall'uso rivelato** — la quota dei compagni sopra i posti che il club schiera davvero
(K da `club_match_lineups`), addebitata a chi il mercato mette dietro. È la **quinta** formulazione della
famiglia a cadere, e la più scomoda: il coefficiente è negativo e **stabile su tutte le finestre di
entrambe le piattaforme** (dispersione 0.24 e 0.15), cioè il meccanismo esiste dentro la stagione, ma i
giocatori che sposta **peggiorano su 9 combinazioni su 10**. Sul lato d'asta la stessa idea come valuta di
ordinamento (pressione di reparto, `metrica-asta-surplus-v1.md` §11) supera il vincolo sul VALORE
catturato (−0.61%) e **non sposta di un caso il tasso di bust** → spenta. ⚠️ Non riproporre l'affollamento
come regola d'errore: cinque forme, un solo esito.
**Aggiunte il 28/07** (dettaglio in `gate-motore-v1.md` §5-quinquies): **affollamento del reparto**
in due forme — con la sua quota (rumore: il segno salta) e con quella dei compagni, che ha coefficiente
stabile ma **di segno opposto all'ipotesi**, cioè misura forza-club e non affollamento · **produzione
misurata dei nuovi arrivi** (batte la predecessora sul rating, ma 14-21 osservazioni valutabili per
finestra) · **persistenza della disponibilità** (quasi: 8/10 su Serie A, e su euro un coefficiente
stabile sotto il pavimento d'ampiezza) · **forza-club dagli xA**, che passa formalmente 3/3 su Serie A e
**non è adottata** perché era pre-registrato che un passaggio sulle sole finestre di generazione
dell'ipotesi non confermi nulla.
⚠️ **Proxy da non riusare**: una correlazione a livello di club (misura di input ↔ gol del club l'anno
dopo) **non predice** quale misura aiuti la fantamedia di un giocatore — è contro-informativa.

**Non misurabili con i dati attuali**: modello piazzati (`assists_set_piece` NULL su tutte le righe di
voti di ogni stagione) e rigoristi difensori (n=7).

## Pre-registrazioni (giugno 2027)
arrivo_intra_lega · U22 · Bundesliga+ · beta attacco/difesa · ancora pc recenza · correttivo elite
condizionale · ancora B · **penalty_ev** (⚠️ la forma ridotta e' stata provata e bocciata il 27/07: la
versione strutturale richiede tasso rigori per club e conversione di carriera) · ~~**set_piece_duty**~~
(⚠️ **NON MISURABILE**: `assists_set_piece` e' NULL su tutte le righe di voti di ogni stagione).
**Aggiunte il 27/07**: concorrenza posizionale **pesata dalla Qt.I dei concorrenti** (nasce dai casi
Openda/David/Vlahovic; calcolabile ora che `price_initial` e' nel DB — ⚠️ **non** superata da R17, che è
un'ipotesi diversa: R17 pesa i posti schierati, non la Qt.I dei concorrenti) · **premio ai reparti
sguarniti per infortunio lungo** (l'inverso chiesto dall'utente il 28/07: un concorrente fuori a lungo
non è un pretendente serio; serve `injuries`, oggi vuota — `metrica-asta-surplus-v1.md` §11) · fuori-ruolo solo nel verso
«usato piu' indietro» quando il campione cresce oltre n~10 · ancora con peso di recenza (con due
finestre lambda non e' identificabile) · disponibilita' da storico infortuni, quando `injuries` esiste.

## Modello set-pieces (nota v2, pre-registrato per 2.5 pieno)
Asimmetria: rigore ha downside (malus), punizioni/corner solo upside. penalty_ev = rigori attesi x taker_share(confidence) x [conv_shrunk*bonus - (1-conv_shrunk)*malus], conv carriera shrunk verso 0.78. set_piece_ev senza termine negativo. Parametrico su scoring_config.

## Dati e lezioni operative
Dataset 3 stagioni in cassaforte (CSV 23/24; Excel 24/25 e 25/26 — header riga 2, Rm con ';', ruolo B dal 25/26; CSV 24/25 colonna squadra vuota -> ricostruita dai voti). elo-asta-mappa-club.csv (38 club, seed di club_xref). fc_id stabili verificati. File grossi a Claude: allegare in CHAT. Voti Serie A e EuroLeghe hanno **calendari diversi**: mai confrontarli direttamente (usare matchday_map).

## File di riferimento (ora in git: docs/model/)
modello-previsionale-v3.8.md · **todolist-mantra-euroleghe-v5.md (roadmap)** · **spec-euroleghe-ingest-v9.md (toolkit)** · **nota-modello-set-pieces-v2.md** · ancore-mantra-fase2_1.md · modulo-portieri-fase2_2.md · backtest-mantra-fase2_5lite.md · fm-per-ruolo-fase2_3-2_4.md · ancore-lega-forzaclub-fase3_1.md · clubelo-gate.md · presenze-attese-v1.md · dataset-euroleghe-README.md · dataset + mappa Elo (su Drive). Drive = archivio; git = casa canonica.

## Convenzioni
Repo pubblico su GitHub: **github.com/ClemAnto/FantAssistant** (`origin`, branch master) · Drive SOLO su richiesta esplicita · README prima di chiedere dati · consolidati a fine sessione · versioning via git · identificatori di codice in inglese · risposte in chat in italiano, tutto il repo (codice, commenti, log, nomi file, .md) in inglese.

---

## Sessione 29/07/2026 - lo snapshot d'asta diventa un tavolo di lavoro

Punto di ripresa per la prossima chat. Tutto quanto segue e' in git (`toolkit/`), 224 test verdi, ruff pulito.

### Cosa e' entrato

**La percentuale sulla maglia e' la quota di GIORNATE in cui parte titolare**, non un duello fra chi resta
libero in uno slot (quella normalizzazione faceva leggere 100% a un centrocampista con 14 presenze). Si
compone di due fattori misurati, mai di una valutazione fantacalcistica:
`standing` (start rate sulle partite in cui era **disponibile**, 65%, + quota minuti della stagione reale
completa, 35%) x `availability` (partite saltate per stagione, pesi di recency 1.0/0.6/0.35 = 51/31/18%).
Lo **schieramento tipo** legge la stagione (blasone), la **prossima giornata** legge la forma con lo
standing come zavorra (shrinkage di 3 partite): con la finestra vuota il numero E' lo standing, cosi' un
McTominay rientrato tardi dal Mondiale non sparisce dagli undici. Dove esiste uno snapshot probabili, sono
i probabili a scegliere gli undici (prima venivano schiacciati nelle linee del modulo: entrava un 35% e
restava fuori un 100%).

**Il campetto e' una griglia che rispecchia il modulo.** Uomini equidistanti in orizzontale, una riga per
linea, e `SLOT_SHAPE` dice cosa E' ogni slot: difesa a 3 = tre centrali (un terzino puo' adattarsi in uno
dei due esterni), difesa a 4/5 con i terzini in fascia, centrocampo <4 tutto centrale e centrato,
centrocampo a 4 con due esterni veri, trequarti 1-2 centrale, trequarti a 3 con due ali, attacco a 3 = due
ali + **sempre** una punta al centro (la `Sp` esiste solo nell'attacco a due). `slot_cost` completa: stessa
fascia 0, esterno dirottato sull'altra fascia 1, ala dentro 2, centrale in fascia 3, punta larga +2, terza
punta +4 - costi, mai veti. Un ballottaggio richiede un **codice reale condiviso** (fine di Hojlund-Neres).

**Il precampionato esiste.** `positions --layer extra` legge i fixture del club e prende cio' che nessun
calendario di campionato contiene: 330 partite, 25 amichevoli, coppe, Europa e le serie B/C di chi e'
retrocesso. Taggate `source='sofascore_extra'`, quindi **descrittive**: il motore legge solo i cinque
campionati (l'unica query che non filtrava - il regressore del gap piu' lungo - ora esclude il tag). Il
provider pubblica le formazioni delle amichevoli e **zero statistiche per giocatore**: si salva chi era in
campo (minuti nulli, cosi' non entra in nessuna media) e la striscia lo disegna come **pallino piccolo
grigio**, pieno se era negli undici. 178 giocatori del foglio euro hanno una presenza di precampionato.

**Snapshot AS OF una data e per un solo club**: `snapshot --date 2026-03-01 --club Napoli`. Ultime 10 = le
dieci prima di quel giorno, titolarita' e bonus dal per-match layer troncato alla data, modulo tipo dalle
formazioni precedenti (Napoli: 59% di 27 XI, non di 38). Non retrodatabili e dichiarati nel manifest: i
probabili (refresh saltato), i ruoli granulari (il provider ignora il seasonId - se ne prende in prestito
uno successivo e lo si scrive), i cartellini, la heatmap.

Altro: colonne della tabella tutte **per giornata** (Pv %, min/giornata, `tit` = probabilita' di prendere
**voto**, `inj` = % di giornate che saltera', g+a conteggio, flag a icone con tooltip, colonna Mantra);
selettore ruoli sul campetto (real / mantra / classic, dischetti rotondi con anello bianco); progress bar
sul Build now; TREND con pieno/vuoto a 75', gol 5x5 e assist 3x3 neri in alto a destra.

### Numeri di questa sessione
Infortuni: 30.945 assenze su 2.835 giocatori (walk completato). Heatmap: 2.241 player-season con avg_x/y.
Extra layer: 330 partite / 5.629 righe. Tempi snapshot offline: euro 23,5 s (880 giocatori, 34 club),
default 28,6 s (588, 20) - Serie A e' piu' lenta a calcolare (10 finestre di gate contro 5) e piu' veloce
a scaricare (20 pagine squadra contro 34).

### DA QUI SI RIPARTE - decisioni prese, non ancora implementate

1. ~~**Standing sul CLUB ATTUALE, con penalizzazione per il prestito.**~~ **FATTO il 29/07** - vedi la
   sezione «Sessione 29/07/2026 (2) » in fondo. Resta aperto solo **prestito contro acquisto** (un comprato
   non e' stato bocciato da QUESTO club: forse sconto minore, o il tier di arrivo al suo posto - `arrivals`
   conosce origine e cifra). Lo «sconto decrescente con le partite al club attuale» si e' chiuso da se':
   la quota minuti lo fa una partita alla volta.
2. **Inclinazione di `INJURY_WEIGHTS`** (oggi 1.0/0.6/0.35 = 51/31/18%): confermata come forma, aperta come
   valore. Alternative gia' calcolate: (1.0, 0.75, 0.5) = 44/33/22, (1.0, 0.45, 0.2) = 61/27/12.
   Da verificare anche che Transfermarkt non conti due volte una ricaduta: Rrahmani a 24,1 partite saltate
   per stagione e' al pavimento di `AVAILABILITY_FLOOR` (0.40), e se le spell sono duplicate quel pavimento
   sta punendo i cronici due volte.
3. **Centrocampo a 5**: la forma mette gli esterni sulle fasce, ma non distingue quale lato tocca all'ala e
   quale al terzino ("da un lato il piu' offensivo, dall'altro un terzino"). Non codificato.
4. **Operativo**: finire il top-up `injuries --layer all` sui 5 club agganciati dopo il fix del matching, poi
   un **Build now** per rigenerare il foglio con amichevoli e infortuni completi.

Commit della sessione: `e7049fd` `997601d` `2bcb744` `9196ef1` `8940ac9` `b950afe` `502bc0c` `19e8a13`
`73e9aa4` (+ il centraggio delle linee sotto i 4 elementi). Nota: `b950afe` ha inglobato per errore cinque
file `docs/model/` di una sessione parallela (`turnover-atteso-v1.md` e gli aggiornamenti a bridge/gate/
stato/todolist) - nulla e' perso, ma il commit mescola due lavori.

---

## Sessione 29/07/2026 (2) - di chi era quella stagione, e chi e' davvero in ballottaggio

228 test verdi, ruff pulito. I tre fogli (euro classic/mantra, default classic) rigenerati offline al
29/07: `data/reports/auction-snapshot-2026-27-*-2026-07-29`.

### 1. La stagione arriva spaccata in due, e la vista la PESA

I totali dicono quanto un allenatore lo ha usato; non dicono **di quale** allenatore. Quindi lo strato
per-partita - l'unico che ha un club per presenza - scrive nel foglio le **due meta'** della stagione
misurata: `desc_season_starts_club` / `desc_season_starts_elsewhere`, `desc_minutes_club` /
`desc_minutes_elsewhere` (`snapshot.at_current_club`). Sono due meta' di quello che ha misurato **quello
strato**, da leggere come quota e mai come conteggio da confrontare con l'aggregato di stagione: i due
divergono di un paio di partite, perche' lo strato porta competizioni che l'aggregato non ha.

`SnapshotView.at_club_weight` non sceglie un ramo, pesa: **quota minuti al club attuale +
`LOAN_DISCOUNT = 0.60` sul resto**. Ne segue che chi non si e' mosso e' identico a prima (nessuna deriva su
nessun numero pubblicato), chi ha giocato tutta la stagione altrove vale 0.60, e un trasferimento di
gennaio sta in mezzo - **cosi' lo sconto decresce da se'** man mano che accumula partite qui, che era il
secondo parametro che si voleva evitare. Applicato a `standing` **e** a `voto_share`: leggere il `tit` a
valore pieno mentre il campetto scontava sarebbe una tabella che risponde due volte alla stessa domanda.

Numeri: Marin R. **0.57 -> 0.34**, dietro Rrahmani (0.81), esattamente il bersaglio scritto ieri. Su euro
710 giocatori hanno lo split noto, **118 sono scontati**, 69 interamente altrove; su Serie A 483 / 86 / 49.
I piu' spostati sono tutti acquisti estivi: Van Hecke 0.93->0.56, Gila 0.89->0.53, Tielemans 0.88->0.53,
Provedel 0.76->0.46, Folorunsho 0.81->0.49. Split **ignoto** (nessuna riga nello strato per-partita) =
**nessuno sconto**: la stessa asimmetria di `availability` con una storia infortuni assente.

`LOAN_DISCOUNT` e' **provvisorio** e marcato tale nel codice: e' una scelta di modello, quindi la possiede
il gate. Aperto: **prestito contro acquisto** (un comprato non e' stato bocciato da QUESTO club).

### 2. I ballottaggi che non c'erano - tre cause, una radice

Domanda dell'utente: al Napoli Vergara, Neres, Lukaku, De Bruyne e Anguissa non si vedevano **nemmeno**
fra le alternative. La radice: un ballottaggio non era **posizionale**.

- `snapshot.duels` raggruppava per **ruolo Classic**, e al Napoli Politano, Lobotka, Elmas, McTominay,
  Anguissa, De Bruyne, Vergara e Neres sono tutti 'C' → dichiarava Politano in ballottaggio con un regista
  a trenta metri. Ora serve **un codice reale condiviso** (uno basta: 'RW;AM' e 'AM' competono davvero).
  **Decisione dell'utente, 29/07: si confronta sul ruolo REALE e mai su quello fanta** — quindi niente
  ripiego sul ruolo Classic nemmeno quando uno dei due non ha codici, e nemmeno sulla fascia che il
  listone implica (senza codici `side_of` legge i ruoli Mantra, che e' di nuovo il listone). Vale in
  entrambi i posti dove la domanda si pone: `snapshot.duels` e `SnapshotView.can_replace`.
- in `eleven` la lista dei probabili aveva **precedenza** sul bench posizionale: quando non nominava
  nessuno di quella maglia, l'intersezione era vuota e le alternative vere venivano **cancellate**
  (Politano: zero alternative, con Neres che condivide RW). Ora **filtra**, mai sostituisce.
- le alternative si sceglievano **dentro** il giro degli slot e si ripulivano dopo («un rivale non e' un
  titolare»), quindi una maglia i cui due migliori sfidanti diventavano titolari restava senza **nessuno**
  invece di prendere il successivo - McTominay, con tutto il suo centrocampo titolare, leggeva
  «incontrastato». Ora si scelgono a **undici formati**.
- `_declared` (modo *prossima giornata*): le alternative vengono da **tutta la rosa**, ordinata per
  `presence(recent)` - che E' la probabilita' dei probabili dove l'hanno data - e non solo dai nominati.
  Una probabilita' risponde «gioca domenica», la sua assenza non e' una risposta sulla maglia: Neres
  infortunato non e' in nessuna lista ed e' comunque l'uomo che prende il posto di Politano. Via anche il
  **secchiello di linea**, che arenava ogni trequartista in un undici che non schiera trequartisti (De
  Bruyne e Vergara, corsia 'T'), e un uomo viene offerto **una volta sola** - tre maglie di centrocampo che
  nominavano lo stesso primo cambio dicevano tre volte la stessa cosa e nascondevano il secondo e il terzo.

Esito al Napoli, schieramento tipo: Politano→Neres, Lobotka→Folorunsho/Anguissa, Hojlund→Cheddira,
Juan Jesus→Beukema. Prossima giornata: Lobotka→Anguissa, Politano→Mazzocchi, Rrahmani→Marin R.
**Lukaku non e' un bug**: 0 presenze da titolare nel 25/26 (stagione persa), quindi presenza ~1% e terzo
dietro Giovane e Lucca, tagliato dal tetto di due alternative per maglia. Spinazzola idem nel modo
*prossima giornata*, ma per il motivo giusto: e' `injured` oggi, ed e' l'unico ricambio di fascia sinistra.

### 3. Gli id sofascore recuperati: +815 identita', e il bug che le mangiava

Il vincolo del ruolo reale ha reso visibile un buco che c'era da prima: **827 fc_id avevano gli aggregati
di stagione `external_stats` (source `sofascore`) e nessuna riga in `player_xref`**. E ogni strato datato
passa da quella tabella - ruoli granulari, heatmap, per-partita - quindi quei giocatori erano invisibili a
tutti e tre insieme. Nomi veri: Saka, Guirassy, Torres F., Sorloth, Mbeumo, Cunha.

**Causa** (`positions.py`): l'identita' veniva scritta **dentro il giro per stagione**. Ogni stagione prima
cancellava le righe xref dei provider id che stava per ri-risolvere (`_clear_season`), poi riscriveva solo
le PROPRIE claim sopravvissute. Quindi l'identita' finiva per essere decisa da **quale stagione veniva
processata per ultima**: chi era respinto nella sua stagione piu' recente perdeva l'id che una stagione
precedente aveva stabilito, mentre i suoi aggregati restavano in tabella. Un'identita' non e' un fatto di
stagione, e scriverla in quel giro la trattava come tale.

**Fix**: `_store_identities`, un unico passaggio su tutte le stagioni del run - cancella e riscrive le xref
una volta, evidenza piu' forte vince e a pari merito la stagione piu' recente. Piu' un'asimmetria
deliberata (`authoritative`): su **tutta** la cache «non rivendicato» e' un verdetto e una mappatura stantia
va tolta; su un **sottoinsieme** di stagioni non e' un verdetto - le stagioni che lo identificherebbero non
sono state nemmeno lette - quindi un run parziale non cancella mai, sostituisce solo cio' che sa decidere.
Corretto anche il commento al call site, che prometteva «identity resolution always runs over the full
cache» mentre passava le stagioni richieste: ora senza `--season` copre davvero tutta la cache (11 stagioni,
~460 s offline, nessuna richiesta di rete).

**Recupero eseguito** (offline, `reingest_from_cache` su tutta la cache + `positions --layer reparse`):

| misura | prima | dopo |
|---|---|---|
| xref sofascore | 3021 | **3836** |
| fc_id con aggregati e senza id | 827 | **7** |
| righe `external_match_stats` | ~270k | **334.795** |
| giocatori del foglio euro senza codice granulare | 152 | **32** |
| foglio euro: split club/altrove noto | 710/905 | **842/916** |
| maglie senza alternativa (34 club x 2 modi) | 228/680 | **129/685** |
| alternative su codice reale condiviso | 602 | **843** |

I 7 residui sono vecchi omonimi (Marcos Alonso 15/16, Rafinha e Guilherme 17/18, Nacho e Baumgartner
18/19, Clark 22/23, Stein 23/24): il loro provider id ora appartiene a un altro fc_id, ed e' l'esito giusto
- solo uno dei due puo' possederlo. Backup del DB pre-recupero in scratchpad.

### Il prezzo del ruolo reale, misurato (prima del recupero)

Vietare il ripiego sul ruolo fanta **svuota** le maglie di chi non ha codici osservati: su 34 club x 2 modi
(680 maglie) le maglie senza alternativa passavano da 106 a **228**, e le 653 alternative che restavano
poggiavano tutte su un codice reale condiviso (prima 260 su 862 poggiavano sul listone). E' il prezzo
giusto — un ballottaggio falso e' peggio di nessun ballottaggio — ma il vincolo ha fatto **una cosa in
piu'**: ha reso il buco misurabile invece che mascherato, ed e' cosi' che si e' arrivati al punto 3 sopra.
Dopo il recupero degli id le maglie senza alternativa sono **129 su 685** e le alternative 843, tutte su
codice reale. La nota del run e il manifest dicono adesso a chiare lettere che per chi non ha codici il
ballottaggio e' **vuoto = ignoto**, mai «0 rivali».

---

## Sessione 29/07/2026 (3) - i tre punti minori, e i due difetti che nascondevano

232 test verdi, ruff pulito, i tre fogli rigenerati. Dettaglio: spec «Novita' v9.9».

### 1. Prestito contro acquisto: due sconti, e la differenza e' MISURATA
**Nessuna fonte nostra marca un prestito** - verificato prima di progettare: `arrivals.type` conosce solo
new/transfer_cross_league/transfer_intra_league, `transfers_history.fee` e' NULL per un gratuito **e** per
un prestito (1367 righe su 2067) e non ha **nessuna** riga dopo il 2026-06-01, cioe' non copre la finestra
che si sta prezzando. Lo dice invece la **storia delle rose**: `previously_at_club` →
`desc_at_club_before` = l'ultima stagione precedente in cui il listone di QUESTO club lo aveva.
Marin R. Napoli 24/25 → Villarreal 25/26 → il Napoli lo ha avuto e mandato via; Gila quattro stagioni alla
Lazio e oggi al Milan → il Milan non lo ha mai giudicato.
Quindi due costanti, perche' le ragioni per scontare sono due e non valgono sempre entrambe:
**`LOAN_DISCOUNT = 0.60`** (misurato altrove **e** mandato via da qui) e **`ARRIVAL_DISCOUNT = 0.80`**
(solo misurato altrove). Su euro: 145 scontati, **69 gia' stati qui** (Rashford, Jackson, Nelson,
Cheddira), **76 mai**. Marin R. resta 0.34, Giovane passa da 0.38 a 0.48 (arrivato, non bocciato).
Entrambe provvisorie, entrambe scelte di modello → le possiede il gate.

### 2. Uno slot sa la sua LINEA, non solo la sua fascia
La richiesta (in un centrocampo a 5, quale fascia all'ala e quale al terzino) era impossibile prima di due
difetti che si sono visti solo misurando:
- il **badge prendeva la fascia dal codice del giocatore**, non dallo slot in cui e' disegnato: l'Inter
  leggeva `Es` **due volte** nel 3-5-2, perche' Carlos Augusto e' mancino di codice e gioca esterno destro.
  Ora quando lo slot contraddice il codice vince lo slot (`MIRROR`): il ruolo resta suo, **la fascia e'
  della maglia**. Un ruolo centrale non cambia mai.
- una **linea senza uomini propri lasciava la maglia vuota**: il 4-5-1 del Bayern aveva quattro
  centrocampisti in corsia M e disegnava **dieci** uomini chiamandolo 4-4-1, con ali e trequartisti fuori
  dagli undici. Ora la maglia va al resto della rosa, con due regole trovate rompendole: una linea presta
  **solo il suo surplus** (servite in ordine, una difesa senza uomini si mangiava gli attaccanti) e presta
  **dalla panchina, mai la prima scelta**.
- e allora il difetto vero: con il prestito fra linee attivo, `slot_cost` sapeva **solo la fascia**, e il
  quinto centrocampista del Bayern e' diventato un centrale difensivo. Terzo termine **`LANE_DEPTH`**:
  distanza fra la profondita' della LINEA e quella del codice, sulla stessa griglia 0..1 di
  `REAL_ROLE_DEPTH`. Ultimo nella tupla, quindi separa **solo** chi le regole di fascia lasciano pari - fra
  due che possono fare quella fascia, il centrocampo prende quello la cui linea e' piu' vicina (un'ala e' a
  un passo, un centrale a due). **0 undici incompleti** su 68 (34 club x 2 modi), e il Bayern si disegna
  4-4-2 mentre i conteggi di linea dicono 4-5-1: entrambi veri, la didascalia porta entrambi.

### 3. Top-up infortuni: era gia' completo (voce stantia)
**3273 id Transfermarkt, 3273 pagine in cache, 0 mai visitate.** I 94 giocatori di rosa senza righe in
`injuries` sono «visitati e puliti», e il foglio lo dice gia' (`desc_injury_source` = «transfermarkt (no
absence recorded)»), che e' diverso da «nessun id: ignoto». Chiusa senza eseguire nulla.

### Cosa resta, in ordine di leva (dalla domanda «cosa manca al toolkit?»)
`fetch --plan` dice **«every source is populated»**: 19 tabelle piene, niente da acquisire. Resta:
1. **Il job settimanale**, che perde valore ogni giorno: `probable_starter` ha **2 date** (26 e 28/07),
   `availability` 2, `player_roles` **1**. Ogni settimana non girata e' una finestra che non esistera' mai.
2. **La modalita' LIVE del motore** - e non e' piu' del toolkit: `_window_is_usable` pretende voti su
   ENTRAMBE le stagioni, il tab Auction elenca solo stagioni concluse, `auction_view` confronta due liste.
   Per un'asta serve **una lista sola**. Piu' il gate 3.2 club-a-club (input pronto).
3. **I parametri provvisori al gate**: decay/quarantena rigoristi, soglie tier arrivi + eta' U22,
   `LOAN_DISCOUNT`/`ARRIVAL_DISCOUNT`, inclinazione `INJURY_WEIGHTS` + `AVAILABILITY_FLOOR`.
4. **Bloccato dal calendario** (agosto): listone/quotazioni 26/27, voti 26/27, Elo alla data d'asta. La
   modifica e' **una riga**: `"2026-27"` in `config.SEASONS`.
5. Residui misurati: 32 giocatori su 916 senza codice granulare (28 senza nessuno strato datato), 27 fuori
   dal layer per-partita, 7 orfani d'identita' (omonimi vecchi). `fbref` resta l'unico modulo non
   operativo (Cloudflare) e non serve piu': SofaScore lo ha sostituito.

### Commit della sessione 29/07/2026 (le tre passate)
`94ecd6e` fix(positions): un'identita' non e' un fatto di stagione — 827 giocatori l'avevano perduta ·
`2477965` feat(snapshot,gui): di chi era quella stagione, e un ballottaggio nel vocabolario dei ruoli reali ·
`94d4a5c` docs: v9.8 · `3659ade` feat(snapshot,gui): un prestito non e' un acquisto, e uno slot sa la sua
linea · `3b06b9e` docs: v9.9 · `32cff56` chore: toolkit 0.2.0 -> 0.3.0 (la versione finisce nel manifest
del bundle come `toolkit_version`, cioe' e' provenienza) · piu' il commit di chiusura.
**Pushati su `origin/master`** (repo PUBBLICO: `docs/model/` e' online).

### Dove NON toccare senza rileggere
- **`snapshot.duels` e `SnapshotView.can_replace` devono restare d'accordo**: sono la stessa regola in due
  posti (un codice reale condiviso). Se una delle due torna a ripiegare sul ruolo Classic, il Napoli torna
  a mettere Politano in ballottaggio con un regista.
- **`positions._store_identities` non va rimesso nel giro per stagione** — e' esattamente il bug che ha
  mangiato 827 identita'. `authoritative=False` per un run limitato a certe stagioni non e' un dettaglio:
  e' cio' che distingue «ri-risolvere» da «dimenticare».
- **`at_club_weight` legge i minuti, non le presenze da titolare**, ed e' applicato sia a `standing` sia a
  `voto_share`: separarli farebbe rispondere due volte alla stessa domanda nella stessa tabella.
- Il **badge** prende la fascia dallo slot disegnato solo quando questo contraddice il codice; il ruolo
  resta sempre del giocatore (un terzino non diventa ala perche' lo spostano).
