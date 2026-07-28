# Stato progetto & continuità — v5
**Aggiornato: 28 luglio 2026 (sera)**
Documento autosufficiente: una sessione nuova, anche senza memoria, riparte da qui + i file della cartella "Modello Previsionale Fantacalcio".
*Glossario: T1/T2 = finestre di test (23/24->24/25, 24/25->25/26) · MAE = errore medio assoluto · cross-fitted = parametri stimati su una finestra, testati sull'altra · M2e = modello portieri decomposto con ClubElo · Pv_att = presenze attese · fc_id = id fantacalcio.it · EV = valore atteso · scoring_config = punteggi configurabili per lega · xG/xA = expected goals/assists · 2.5 pieno = backtest motore completo con flag.*

## Cos'e'
App per leghe EuroLeghe/fantacalcio.it (Classic+Mantra, 5 campionati) con motore previsionale. Metodo: ogni regola entra SOLO se batte il baseline fuori campione su finestre indipendenti (gate pre-registrato). Doc madre: modello-previsionale-v3.8.md.

## ⚠️ Lo stato corrente è in `00-BRIDGE-punto-di-ingresso.md`, blocco «STATO AL 28 LUGLIO 2026 (sera)»
Questo documento è un registro cronologico: dove contraddice quel blocco, vince quello.

### 28 luglio 2026 (sera), in una riga: è cambiata la valuta dell'asta, non il motore
Il pannello ordina per **SURPLUS = (FM − rimpiazzo) × Pv × beccabilità** con una soglia di schierabilità
(`metrica-asta-surplus-v1.md`), perché misurato `VALORE = FM × Pv` era quasi solo presenze. Non passa dal
gate — non tocca né FM né Pv — e i numeri pubblicati sono invariati al numero. **Sei candidate provate,
zero adottate**; i set adottati non cambiano. Toolkit **v0.2.0**, 158 test verdi.

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

## Prossimo lavoro (aggiornato al 28/07, in ordine)
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
