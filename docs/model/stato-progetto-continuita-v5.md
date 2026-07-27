# Stato progetto & continuità — v5
**Aggiornato: 27 luglio 2026 (SOSTITUISCE la v4)**
Documento autosufficiente: una sessione nuova, anche senza memoria, riparte da qui + i file della cartella "Modello Previsionale Fantacalcio".
*Glossario: T1/T2 = finestre di test (23/24->24/25, 24/25->25/26) · MAE = errore medio assoluto · cross-fitted = parametri stimati su una finestra, testati sull'altra · M2e = modello portieri decomposto con ClubElo · Pv_att = presenze attese · fc_id = id fantacalcio.it · EV = valore atteso · scoring_config = punteggi configurabili per lega · xG/xA = expected goals/assists · 2.5 pieno = backtest motore completo con flag.*

## Cos'e'
App per leghe EuroLeghe/fantacalcio.it (Classic+Mantra, 5 campionati) con motore previsionale. Metodo: ogni regola entra SOLO se batte il baseline fuori campione su finestre indipendenti (gate pre-registrato). Doc madre: modello-previsionale-v3.8.md.

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

## TOOLKIT euroleghe-ingest — spec v9.2 — TUTTI I MODULI TRANNE fbref
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
confrontato fra campionati NO (lambda -0.45/+0.05). Copertura del motore sull'euro **dal 31% al
45-49%**. Set adottati: euro R1+R3c+R4+R7+R10+**R13** · Serie A R3+R7+**R13**.

## Prossimo lavoro
1. ~~Completare il layer per-partita~~ **FATTO il 27/07** (sezione sopra): 100% delle partite, bias di
   selezione chiuso, copertura del motore dal 31% al 42-43%.
2. **Storico `injuries`** (Transfermarkt, una richiesta per giocatore): l'unico input della Priorita' 1
   ancora assente, e meta' dei buchi nelle top-10 dei difensori sono infortuni.
3. **Terza finestra**: verificare quanto indietro va l'API Excel dei voti. Con T0 = 22/23->23/24 i
   parametri che oggi oscillano diventerebbero identificabili e il gate molto piu' severo.
4. **Ri-pre-registrare le due ipotesi che il layer completo ha cambiato** (`gate-motore-v1.md` §5-bis):
   la propensione per-90 (ora con il segno giusto) e la sottostima da rifacimento rosa (effetto piu'
   grande di tutto il gate su Serie A, ma con l'etichetta sbagliata).
5. **Tarare i parametri provvisori** del 27/07 (decadimento/quarantena rigoristi, soglie tier T1/T3,
   U22): sono scelte di modello, non dati. Nota: i tier ora usano `Qt.I`, non `Qt.A`.
6. **Ad agosto, quando esce il listone 26/27**: aggiungere `2026-27` alle costanti `SEASONS` (ratings,
   positions, transfers), scaricare voti e Elo alla data d'asta 2026-08, salvare anche `Qt.A M`/`Qt.I M`/
   `FVM` -> **ALGORITMO COMPLETO asta 26/27**.

## Respinte dal gate (non riproporre senza nuove finestre)
beta per ruolo · baseline multi-stagione 62/38 · ancore per lega · forza-club interna · Elo additivo
movimento. Bias elite-in-big NON strutturale -> correttivo condizionale in pre-registrazione.
**Aggiunte il 27/07** (dettaglio e numeri in `gate-motore-v1.md`): sconto adattamento cross-lega
(segno opposto fra finestre, e il controllo intra-lega e' piu' grande) · propensione per-90 xG/xA
(gamma ~ 0 di segno sbagliato) · **ancora forza-club da ClubElo: TERZA bocciatura della famiglia**
(segno giusto, T1 sempre peggio) · rigoristi in forma ridotta (segno opposto, n=22/29) · fuori-ruolo da
heatmap · concorrenza posizionale (migliora il MAE **col segno contrario all'ipotesi**: e' un proxy di
altro) · attesa di mercato Qt.I e sua revisione · eta' sulle presenze.
**Non misurabili con i dati attuali**: modello piazzati (`assists_set_piece` NULL su tutte le righe di
voti di ogni stagione) e rigoristi difensori (n=7).

## Pre-registrazioni (giugno 2027)
arrivo_intra_lega · U22 · Bundesliga+ · beta attacco/difesa · ancora pc recenza · correttivo elite
condizionale · ancora B · **penalty_ev** (⚠️ la forma ridotta e' stata provata e bocciata il 27/07: la
versione strutturale richiede tasso rigori per club e conversione di carriera) · ~~**set_piece_duty**~~
(⚠️ **NON MISURABILE**: `assists_set_piece` e' NULL su tutte le righe di voti di ogni stagione).
**Aggiunte il 27/07**: concorrenza posizionale **pesata dalla Qt.I dei concorrenti** (nasce dai casi
Openda/David/Vlahovic; calcolabile ora che `price_initial` e' nel DB) · fuori-ruolo solo nel verso
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
