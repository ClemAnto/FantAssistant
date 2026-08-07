# Stato progetto & continuità — v5
**Aggiornato: 7 agosto 2026 (aggiornamento dati: quattro difetti trovati aggiornando, tre chiusi — dettaglio nel 00-BRIDGE)**
Documento autosufficiente: una sessione nuova, anche senza memoria, riparte da qui + i file della cartella "Modello Previsionale Fantacalcio".
*Glossario: T1/T2 = finestre di test (23/24->24/25, 24/25->25/26) · MAE = errore medio assoluto · cross-fitted = parametri stimati su una finestra, testati sull'altra · M2e = modello portieri decomposto con ClubElo · Pv_att = presenze attese · fc_id = id fantacalcio.it · EV = valore atteso · scoring_config = punteggi configurabili per lega · xG/xA = expected goals/assists · 2.5 pieno = backtest motore completo con flag.*

## Cos'e'
App per leghe EuroLeghe/fantacalcio.it (Classic+Mantra, 5 campionati) con motore previsionale. Metodo: ogni regola entra SOLO se batte il baseline fuori campione su finestre indipendenti (gate pre-registrato). Doc madre: modello-previsionale-v3.8.md.

## ⚠️ Lo stato corrente è in `00-BRIDGE-punto-di-ingresso.md`, blocco «STATO AL 5 AGOSTO 2026»

### 7 agosto 2026, in una riga: un aggiornamento di routine trova quattro difetti, e li chiude tutti — l'ultimo è il PREZZO

Stato completo nel **00-BRIDGE**, blocco «STATO AL 7 AGOSTO 2026»; dettaglio nella spec **«Novità v9.32»** e
**«v9.33»**. **318 test**, `backtest --verify` **22/22**, nessuna regola entrata nel motore,
`SHEET_REVISION` **2 → 5**, `validate` pulito. Tre commit pushati: `dd5d675`, `010af4a`, `8ed81e8`.

**Tutti e quattro i difetti chiusi**: la rosa live letta PRIMA del run che la scarica (ogni foglio portava
quella del giorno prima) · le probabili di una stagione già GIOCATA usate come previsione (428 righe su 648,
415 duelli) · le pagine editoriali EuroLeghe che nessuno leggeva · e **la quotazione come fatto di
piattaforma** — `listone_quotes` con `platform` nella chiave, più `fvm_history` e `arrivals` allargati, più il
backfill di tutta la storia dalla cache (16.375 righe, 12 stagioni Serie A e 9 EuroLeghe, zero richieste).
Il rituale «rileggi il listone giusto prima di costruire» è morto: `rosters` porta 15/56 per Svilar e il
foglio Serie A stampa 18/65.

**Una correzione da portarsi dietro**: il tier d'arrivo NON arriva a `engine_*`. Lo sconto di `presence` si
basa sull'aver cambiato campionato e `evaluate` non legge `arrival_tier`; gli 82 arrivi che cambiano fascia
fra le piattaforme finiscono nella colonna e nel braccio tier dello sweep.

**Cosa manca, in ordine di costo**: Transfermarkt e ClubElo giù (contratti e valori di mercato fermi al
29/07) · **803 giocatori** in coda per `recent_form` · il blocco **tier** dello sweep scaduto perché i pool
sono cambiati · le probabili vuote finché la stagione non parte · e il pezzo grosso, **`app/`: un README e
zero file TypeScript**, col contratto dati già pronto e verificato.

### 6 agosto 2026, in una riga: quattro regole entrano da un harness, sei ipotesi cadono, e il gate impara a difendere il prodotto

Stato completo nel **00-BRIDGE**, blocco «STATO AL 6 AGOSTO 2026». Dodici commit pushati, 313 test,
`backtest --verify` 22/22. Adottate: `level_weight` 0.06, `standing_prior_rounds` 10, R19 su default (la
prima sul solo robust), R18 su euro. Falsificate e scritte: sei. Il gate ora vincola anche il SURPLUS
CATTURATO, e i suoi criteri sono cambiati — ogni verdetto anteriore al 06/08 va riletto con quella nota.

### 5 agosto 2026, sera, in una riga: la rosa live decide chi è in rosa, ma solo dove è abbastanza completa

Partiti da una domanda dell'operatore («perché risulta ancora Gutierrez nel Napoli?») e finiti su un audit di
tutta la base di conoscenza contro il codice. Dettaglio: spec **«Novità v9.30»**. 306 test verdi,
`backtest --verify` **22/22** ri-eseguito. **Nessuna regola del motore è entrata, nessun verdetto cambia.**

- Gutierrez risultava al Napoli **per progetto** (il listone dichiara e non si sovrascrive) — ma la rosa live
  si agganciava per STRINGA e non per `_club_key`, e parlava anche dove il payload era mezzo vuoto.
- Nuovo guardiano `complete_squads` con `SQUAD_COMPLETENESS` = **0.90**, misurata su 172 assenze (precisione
  57.6% → 83.1%). Righe marcate 93 → **48**, zero nuove; sopravvivono due sole asserzioni di sola assenza.
- L'undici non schiera più chi è partito (`eligible`), in entrambi i modi. Ordine obbligato: senza il
  guardiano avrebbe messo in panchina dodici giocatori del West Ham che ci sono davvero.
- **Identità gemelle dei club: FUSE.** `fc_club_id` era un surrogato coniato sulla stringa esatta, quindi
  Newcastle 12/60, Eintracht 22/59 e PSG 4/37 erano lo stesso club due volte, con `rosters`, `club_xref`,
  `club_elo`, `coaches` e `penalty_hierarchy` divisi a metà. `matching.club_identity` + `merge_twin_clubs`
  (idempotente, derivata dai dati, nel percorso di `apply_schema`): **109 → 106 club**, perse solo 4 righe
  `club_elo` duplicate e contate, l'Eintracht passa da **0 a 70** spell di allenatore.
- **La FM stimata entra nella colonna FM col `~`** e con la propria chiave di ordinamento (Mazzocchi, 11 voti
  su 15, prima cella vuota, ora `~5.9`).
- **La cascata delle stime applicata fuori popolazione**, trovata dall'operatore due volte: Kolo Muani
  (−9.9, la sua stagione euro 25-26 è il Tottenham) e Ramos G. (+22.5, che in Serie A non ha **mai** giocato
  e prendeva la sua Ligue 1). Ora `other_platform` **e** `older` portano lo stesso test di competizione.
- **Una vecchia FM va ristretta prima di diventare previsione** (`est.regress`, β 0.40 misurato): rientranti
  MAE 0.407 vs continui 0.395 → sì, è confrontabile; ma grezza perde contro l'àncora (0.369) e il
  restringimento batte entrambe (0.326). **42 righe su 651** cambiano rispetto a stamattina: Ramos 22.5 →
  **2.3** (àncora), Kolo Muani −9.9 → **15.1**, Vasquez D. 13.2 → **20.4** (la sua vecchia FM era *sotto*
  l'àncora). Resta aperto: `older` sceglie «più voti vince» e può prendere una stagione euro MISTA.
- **`manifest.sheet_revision`** (oggi **2**): un foglio non sapeva dire se era scaduto. Le dodici cartelle
  esistenti non hanno il campo → revisione 0, tutte da rifare.
- L'audit: 1083 nomi di codice citati dai .md verificati, 30 conclusioni controllate una per una. Tutte le
  costanti pubblicate riprodotte; corretti `squad_size`→`squad_slots`, `match_votes`→`match_ratings`,
  `SIDE_PRICE`/`_fit_across` (nomi del pricer greedy sostituito), README 232→306 test; marcata come
  **progetto e non codice** la regola del calendario facile (`EASY_MARGIN`/`HOME_ADVANTAGE`).

### 5 agosto 2026, in una riga: esiste UNA lista con cui andare all'asta, e il listone di agosto entra

Due passate. Il pomeriggio ha chiuso la «modalità LIVE»: il tab Auction offre `2026-27 · LIVE`, una tabella
sola per ruolo, prezzata dalla stessa funzione del foglio - il blocco era il **calendario** di una stagione
mai giocata, e il suo ripiego viveva in un chiamante invece che dove si decide il prezzo (spec «Novità
v9.20», sezione in fondo al documento).

### 5 agosto 2026, notte, in una riga: chi non ha storico si prezza sulle PRESENZE, e la fantamedia resta l'àncora

Ultima sessione in fondo al documento, sezione «Sessione 05/08/2026». Tre strumenti diversi, la stessa risposta
(R1 su sei finestre, R13c sul campione, lo scostamento della Serie B): la fantamedia di chi non ha storico qui
non si prevede, le sue presenze sì. **Nessuna regola nuova nel motore.**

### 4 agosto 2026, in una riga: un modulo disegnato è un modulo VERO, e un secondo parere non prezzato disfaceva una decisione prezzata

Sessione interamente sul pannello Snapshot, guidata da sei osservazioni dell'utente sui board di Napoli,
Atalanta, Liverpool, Fiorentina e Roma. **Nessuna regola del motore è entrata, nessun verdetto del gate
cambia.** Dettaglio: spec **«Novità v9.17»**, misure nel gate **§5-quaterdecies**. Commit `1108803` (le
regole) e `51d069e` (le misure). 278 test verdi.

**La causa era una sola.** L'undici viene assegnato ai posti del modulo e ogni posto è **prezzato**
(`_assign` + `_slot_price`, una sola assegnazione risolta come un tutto); poi `lanes_for` rileggeva la corsia
dal **primo codice** di ciascuno e buttava via la decisione. Liverpool 4-5-1, misurato: il fit aveva dato a
Gakpo (`LW`) la fascia sinistra dei cinque e a Gravenberch (`MC;DM`) il secondo centrale della difesa a
quattro — un mediano che scala costa 4, un terzino destro che cambia fascia 8 — e la rilettura li spediva in
attacco e a centrocampo. Uscivano una **difesa a tre**, cinque schiacciati nella metà destra con la touchline
sinistra vuota e un attacco di due mancini: «il modulo non può perdere la simmetria». Ora quella rilettura fa
**solo** la mossa per cui esiste — un **centrale** una riga avanti, sulla trequarti — e le altre tre
direzioni, tutte misurate, erano tutte sbagliate: attraverso le linee (Liverpool), fuori da una fascia
(Bayer, usciva un 3-3-3-1), indietro sulla riga (Verona 3-5-1-1: sei in fila **e** trequarti vuota).

**Le regole, in cascata, ognuna con le parole dell'utente come definizione** (`_reshape`): nessuno gioca a
due linee da casa · una fascia la copre un esterno, il centrale si disloca sul codice più avanzato (difesa
esente: i braccetti) · **la fascia di centrocampo svuotata la copre l'attaccante esterno che arretra**, che
era la metà mancante della frase · **un posto in attacco è il lavoro di un attaccante** (Roma: il 3-4-3 esce
3-4-2-1 con Dybala e Soulé trequartisti e **Malen `Pc` al centro**, la forma che le sue probabili dichiarano)
e l'attacco assottigliato **tiene le punte** · la riga di centrocampo è **cinque al massimo**, e il tetto è
l'ultimo passo perché la regola 4 può consegnarle un uomo (Genoa usciva 3-6-1 così).

**Il vocabolario**: le fasce sono una **coppia di mestieri** («se c'è un Ed ci deve essere anche una Es»,
idem Ad/As e Td/Ts) e un codice spaiato ripiega sul mestiere centrale della linea — questo ha corretto anche
una difesa a **tre** che leggeva `Td` senza `Ts`; una **punta centrale non diventa un'ala** per il posto che
le danno («Krstovic e Scamacca sono Pc e basta»), quindi `ST` è l'eccezione alla regola «la fascia appartiene
alla maglia» e chi non è il centravanti legge `Ad`/`As` solo se gioca lì, altrimenti `Sp`; e **entrambe le
touchline o nessuna** — la riga sbilenca era stata difesa come informazione e l'utente l'ha superata.

**Un solo listino**: `slot_cost` **eliminato** (restava usato solo il suo terzo termine, ora `_line_gap`).
Era un secondo listino accanto a `_slot_price` e i due **discordavano** — diceva «un posto largo della linea
d'attacco è di un attaccante» e `_slot_price` no — ed è esattamente così che Gosens (`ML;DL`, 6) ha scalzato
Piccoli (`ST`, 7) sulla fascia del tridente della Fiorentina e **la terza punta è uscita dagli undici**.
Adesso la regola sta dove si decide il prezzo (`_off_the_front`), e la griglia è **raddoppiata** perché mezzo
passo faccia da spareggio sul **primo** codice (Olivera `DL;DC` a sinistra, il `DC;DL` dentro) — spareggio
tenuto **fuori** dai confronti «mai un fit peggiore» di `_settle`, dove faceva sparire riparazioni vere
(Cagliari, Udinese). E `_flanked`: **le fasce di una riga le contende chi le gioca**, non solo il pool della
sua linea (Bologna prendeva un `MR` a 0.44 e un **centrale di difesa** per le ali, con Orsolini `RW` 0.64
fuori) — sempre con la domanda del claim, che è ciò che tiene fuori il Touré a 0.00 da cui la famiglia nasce.

**La heatmap, modello dell'utente e sua formulazione**: «l'heatmap è un dato effettivo che certifica in che
parte del campo gioca; le posizioni di Sofascore sono indicative — in passato o in potenza. Due elementi che
si completano, con pesi diversi». Validata: sui 52 uomini di cui le fonti dichiarano la fascia, primo codice
**93.9%**, **centroide 97.9%**, banda dominante del cloud 97.8%. **La misura batte il codice** e il cloud
**non** batte il centroide — che è già quello che `lateral` legge per primo. Quattro tentativi di usarla
altrove, **tutti piatti o negativi** (riordino dei codici, pesi per asse, fascia dalle bande, fascia in
`sides_of`), e la ragione che chiude la famiglia: **quello che il codice primario perde, la lista dei codici
ce l'ha già** (Zé Pedro `DC;DR`, 75% dei tocchi a destra). Ogni peso sulla **profondità** peggiora perché
quell'asse **satura**: punta 62, ali 61-63, terzino 47, centrale 34 — i tocchi si accumulano dove uno riceve
il pallone, quindi lassù punta e ala sono indistinguibili. Pesi a zero, bracci raggiungibili, numeri accanto.

**Verifica**: **394 board** (ogni club × ogni forma del repertorio × 2 modalità × 2 fogli) con **0 righe
oltre il massimo, 0 codici di fascia spaiati, 0 righe asimmetriche**, e ogni forma disegnata è un modulo
reale (prima uscivano 2-5-3, 4-2-4, 2-6-2, 3-3-3-1, 3-6-1). Contro le formazioni tipo pubblicate della
**stessa finestra** (SOS Fanta, metà 25/26): **183/220 = 83% degli uomini** e **16 su 20** conteggi di linea
(era 15). Verificato anche **sul canvas vero** del pannello leggendo gli item disegnati. Dei due punti aperti
del giro precedente: i **centrali su una fascia** sono **3 → 0**, e gli **attacchi senza attaccante 9/340 →
4/394**, tutti Lilla e tutti lo stesso pari merito di claim (0.83) fra un trequartista e una punta per
l'**unico** posto d'attacco di un 4-5-1 — capito, non ancora chiuso.

### 4 agosto 2026 (pomeriggio), in una riga: la quotazione scende all'ultimo posto, e un numero ha scoperto un difetto dell'harness

Stesso giorno, altro strato: **dati e gate**, non disegno. Spec **«Novità v9.18»**, gate **§7-quinquies** e
**§7-sexies**. Toolkit **0.7.0**, **285 test verdi**, `backtest --verify` **22/22**.

**L'allenatore nuovo pesa, per la FORMA.** 12 club su 34 (7 su 20 in Serie A) hanno un allenatore con **zero
undici in quel club**, quindi il board disegnava il modulo del **predecessore**. `coach_shapes` /
`coach_shapes_of` contano le forme di *quell'allenatore* in ogni sua panchina (`coaches` ×
`club_match_lineups`, una passata SQL offline) ed entrano in `shape_odds` **al posto della lega** — il
repertorio di lega è la risposta generica a «cosa farebbe una squadra qui», 188 undici di un allenatore sono
la risposta specifica — pesate da soglia e rampa sul **proprio campione**, che va da Sarri 188 a Iraola 0.
Giudizio sulla previsione 26/27: **8/17 → 9/17**; l'Atalanta passa al **4-3-3 di Sarri** con la difesa a
quattro e 9 uomini su 11 come la fonte. La soglia non è un dettaglio: con n=2 la moda è rumore e
sovrascriverebbe un'abitudine di club già giusta (Lazio).

**La PRE-SEASON è una lettura, non un criterio.** Sul caso dell'utente sembra decisiva — le due amichevoli di
Sarri le iniziano **Gaetano, Samardzic, Scamacca e Raspadori** e De Roon/Ederson/Krstovic **nessuna** — e non
è usabile, per cinque ragioni misurate: una sola pre-season di dati per-giocatore (1696 righe contro 37), 1-3
partite, **Milan e Napoli a zero**, minuti assenti in 1399 righe su 1716, e avversari l'**U23 del club stesso**
e l'Arezzo. Va sulla targhetta (`desc_preseason_*`) e su nulla che scelga un undici; pre-registrata per giugno
2027, quando esisterà un fuori campione.

**Il VALORE DI MERCATO storico esiste, ed è gratis.** Nella pagina rosa di Transfermarkt che già scarichiamo:
**9388 valori · 3180 giocatori · 11 stagioni**, e la pagina di una stagione passata porta il valore **di quella
stagione** (verificato). Tabella `market_values`, nel contratto d'export. Chiude §7-quater col proxy giusto —
il cartellino era NULL per chi arriva gratis, cioè diceva «nessun investimento» su Modric e De Bruyne. Esito:
**non adottato**, e la sfumatura è il risultato — su euro il migliore in pool è **zero**, su Serie A **tutti e
sei** i fold scelgono un peso non nullo ma il guadagno medio è **+0.08%** contro un pavimento di 0.5%. Il
proxy migliore ha comprato **il verso, non la taglia**; il cartellino non aveva nemmeno il verso.

**La QUOTAZIONE all'ultimo posto**, decisione dell'operatore («è il giudizio soggettivo di chi quota»).
Verificato che il motore adottato **non la leggeva già**; l'unico punto vivo era quale percentile instrada un
arrivo, e ora ha tre livelli: **calcio giocato → fantavalore → quotazione**. Su euro `measured_first` vince
**7 fold su 7** (CONFIRMED, +0.89%); su Serie A la quotazione guadagnerebbe +0.42%, **sotto il pavimento**, e
la causa è la **copertura** del misurato (25-29% contro 14-20%). Il seguito non è tornare al prezzo: è
allargare il misurato alla Serie B e ai campionati non coperti.

**Il fantavalore è uno stato volatile tenuto come campo statico**, ed è stato corretto: `fvm_history(fc_id,
season, observed_on, ...)` accumula da oggi (la storia settimanale non esiste da nessuna parte), e prima del
2022-23 l'FVM è **0 e non NULL** — la «copertura piena» era illusoria.

**E un numero ha scoperto un difetto dell'harness.** Inserendo il fantavalore, la quotazione otteneva un
`robust PASS` su `default`: falso, perché lo sweep giudicava i tier su **tutti** gli arrivi mentre un tier
instrada solo chi il **core non può prezzare**. Scorato sulla popolazione giusta (2573 / 2180 invece di 2963 /
2842) il PASS spariva. **Un parametro va giudicato sulla popolazione su cui agisce** — regola nuova in
CLAUDE.md.

**L'harness riproduce 22 numeri su 22** (era 15/18). I tre che mancavano erano tutti del modulo presenze su
T1 e la causa era la **data**: quel documento è del 22 luglio, `platform` è entrata il 25-26, quindi erano
misurati su un dataset che mescolava i calendari — e la conclusione era data al **singolare** su una quantità
dipendente dalla piattaforma (su `default` il modulo batte il naive su entrambe le finestre, su `euro` solo su
T2; il **bias**, cioè il criterio di adozione, si riproduce su tutto). I check sul Pv sono ora controlli di
**regressione** e non test sul **segno**, ed è stato aggiunto il MAE dei **titolari**, citato dal documento e
verificato da nessuno.

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
   tornerà) e lasciar finire la camminata `injuries` (ore, ripartibile). ⛔ **SUPERATO il 05/08/2026**: nessun job, decisione dell'operatore (vedi il blocco in cima).
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
1. **Il job settimanale**, che perde valore ogni giorno: `probable_starter` ha **2 date** (26 e 28/07), ⛔ **SUPERATO il 05/08/2026**: nessun job, decisione dell'operatore (vedi il blocco in cima).
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

---

## Sessione 29/07/2026 (4) — la LEGA come parametro del foglio (v9.10, riepilogo)

Non consolidata in tempo: il dettaglio sta nella spec, «Novità v9.10» (otto punti). In breve, perché un
chat nuovo non deve andarselo a cercare: `config/league_config.json` dichiara ora **`my_leagues`** (una voce
per lega giocata, con platform, game e caselle) e si costruisce **un foglio per lega**, con lo slug nella
cartella e il blocco `league` nel manifest — senza il quale due leghe sullo stesso platform+game si
sovrascrivono pur avendo livelli di rimpiazzo diversi. Misurato per decidere gli assi: sui **265** giocatori
dei 9 club che euro e default condividono, TUTTE le colonne engine cambiano fra i due fogli; e su euro
2026-27 **904 surplus su 916** cambiano fra classic e mantra. La barra Snapshot è `[Lega] [Quando] [Build]`
e Build non chiede più niente. Più: ballottaggi **impilati** con la loro percentuale (max 2 per targhetta,
derivato dalla geometria), il **modulo scelto con la sua probabilità** (`shape_odds` = quanto lo schiera il
club, quanto la lega, quanto la rosa lo copre; i tre `SHAPE_MARGIN*` sono stati rimossi), e i **top player**
come congiunzione (minuti per partita di LEGA ≥70' nel ≥70% delle ultime, surplus ≥ p90 del foglio, primo
rivale sotto il 60%): 26 evidenziati su 34 club.

## Sessione 29/07/2026 (5) — il denominatore di una quota, e i due numeri che si annullavano

Punto **2** della lista «cosa resta» (il difetto che la v9.10 §8 aveva dichiarato aperto). Dettaglio: spec
«Novità v9.11». **251 test verdi, ruff pulito, tre fogli rigenerati.**

### Cosa era rotto
I numeratori di ogni quota del foglio sono **di campionato** — `external_stats` ha una riga per campionato
e nient'altro, su tutte e 11 le stagioni — e il denominatore era ogni undici parsato in **qualsiasi**
competizione: Arsenal 58, Bayern 50, Napoli 38 (solo Serie A). Sui 45 club del perimetro la quota di
campionato va da **66% a 100%**, quindi la titolarità di una maglia non era confrontabile con quella
accanto. Correlazione fra quota di campionato del club e titolarità media dei suoi giocatori: **+0.796**
prima, **−0.172** dopo.

### Le quattro correzioni
1. `clubs.csv`: **`league_XIs`** (+ `league`) accanto a `complete_XIs`. `club_matches()` = le giornate del
   campionato; `complete_XIs` resta perché è il calendario su cui una fonte conta le assenze.
2. `titolarita` / `propensity` / `at_current_club` filtrano le competizioni di lega **in entrambi i
   percorsi**: il percorso datato contava le coppe mentre l'aggregato no, quindi la stessa colonna
   significava due cose diverse secondo il giorno del foglio (Kane: `desc_minutes_club` 2994 vs
   `desc_minutes_full_season` 2382, nella stessa riga).
3. La `%` delle presenze previste va sul **calendario della piattaforma** (31 giornate euro, 38 default),
   dichiarato nel manifest: 26,6 presenze su 31 stampavano 53% perché divise per le 50 partite del Bayern.
4. Le assenze si **contano in giornate** (`rounds_missed`): le partite di campionato del suo club, per
   data, dentro l'**unione** degli spell. Niente scaling — che correggeva i tedeschi e lasciava intatti gli
   italiani, con 8 giocatori del foglio euro sopra il proprio calendario. Coperti 868/907, e
   `desc_injury_rounds_seasons = 0` dice «ignoto» per i 39 restanti.

### I due numeri che erano lo stesso numero
`contested` usava la **previsione a tre stagioni**, la stessa che `availability` moltiplica: sottrarla e
rimoltiplicarla **si annulla** quasi esattamente in `presence`, quindi la storia infortuni contava solo
attraverso i clamp. Ora `contested` usa quello che ha DAVVERO saltato nella stagione misurata (un fatto) e
`availability` la previsione (uno sconto). Giocatori sul pavimento **da 201 a 9**; `contested` collassato
alla guardia da 14 a 2; zero presenze oltre il 100%. Il 201 era il vero difetto: `availability` divideva
per le **presenze del giocatore stesso**, che si accorciano proprio quando è infortunato.

Kane 49→75%, Haaland 61→82%, Saka 28→62%, Rrahmani 33→71%, Yamal 41→77%, Van Dijk 76→100%. Scendono
quelli che i clamp tenevano su: Ouedraogo −13%, Teze −10%, Militao −8%.

### Un pezzo del punto 3 chiuso per strada
La domanda pre-registrata su Transfermarkt (**§7-bis**: «una ricaduta è contata due volte?») ha una
risposta misurata: contare le giornate dentro l'UNIONE degli spell non può contarne una due volte. E il
confronto dice che l'eccesso della fonte **non** è duplicazione: TM 6489 partite contro 4485 giornate
contate (69%), e sui club il cui elenco parsato coincide col campionato — gli italiani, dove lo scaling
sarebbe 100% — 1465 contro 1079 = **74% ≈ 38/50**, cioè le coppe e l'Europa che non parsiamo.

---

## Sessione 29/07/2026 (6) — lo sweep: i parametri provvisori davanti al gate

Punto **3** della lista «cosa resta». Referto completo con tutti i numeri:
[gate-motore-v1.md §7-ter](gate-motore-v1.md). Dettaglio implementativo: spec «Novità v9.12».
**256 test verdi, ruff pulito.**

### Cosa è stato costruito
- **`engine/presence.py`**: le formule della titolarità estratte dalla vista Tk, con i parametri in una
  dataclass. La ragione è una frase: *un parametro che nessun harness può raggiungere è un parametro che
  nessuno può spazzare*. Il pannello ora costruisce un `presence.Inputs` dalla riga del foglio e chiama le
  stesse funzioni che lo sweep giudica.
- **`python -m euroleghe_ingest sweep`**: STANDALONE, read-only, scrive `data/reports/sweep_presence.json`.
  Tre famiglie (presenza, rigoristi, tier d'arrivo), lo stesso protocollo del gate delle regole: griglie
  pre-registrate, un parametro alla volta, **cross-fit leave-one-out**, strict e robust affiancati.
- Due bersagli e non uno, perché i parametri non toccano lo stesso: le PRESENZE (`pv`, calendario della
  piattaforma) e le TITOLARITÀ (giornate del suo campionato in cui è partito, dal layer per-partita — i voti
  non portano `started`: la colonna è NULL in ogni stagione).

### Gli esiti
- **ADOTTATO — `STANDING_WEIGHTS` = (0, 1)**: la titolarità si prevede dai **minuti**, non dal tasso di
  titolarità. Strict e robust su **tutti e dieci** i fold, +1.55% euro / +1.32% default, peggiore +0.70%,
  curva monotona. Sul campetto: 38 giocatori su 907 si muovono oltre 5 punti, **10 club su 34** cambiano
  l'undici disegnato.
- **CONFERMATI**: la forma nuova di `contested` (v9.11), `ARRIVAL_DISCOUNT` 0.80 (a 0.0 l'errore cresce del
  30%: il parametro conta), il decay dei rigoristi 0.75.
- **APERTI, con il motivo**: `LOAN_DISCOUNT` è **platform-dependent** (euro tira a 0.2, default a 0.8, curva
  piatta in mezzo); di `INJURY_WEIGHTS` è confermata la FORMA (le degeneri perdono) e resta aperta
  l'inclinazione (0.3% fra le tre candidate, e le piattaforme preferiscono l'opposto); `AVAILABILITY_FLOOR`
  vale 0.6% su tutta la griglia, sotto il pavimento del gate; le soglie dei tier non sono separabili da
  questo criterio, e `t3_price` passa robust su euro puntando in direzione OPPOSTA su default — riportare il
  solo euro sarebbe l'errore che questo progetto si è già fatto una volta.

### Il difetto che lo sweep ha trovato (e che ha confermato il valore che sembrava smentito)
`fc_site.penalty_events` restituiva **ogni rigore di Serie A due volte** (una riga per piattaforma, lo
stesso calcio): 387 tuple su 1675, 2089 eventi contro 1745. Poiché il peso del k-esimo rigore decade come
`DECAY**k`, una serie doppia applica il decay due volte per rigore reale → la memoria era **metà** per un
club italiano. Alla prima passata lo sweep prendeva 0.5 su tutti i fold (+4.25%) e sembrava bocciare 0.75:
√0.5 = 0.707 ≈ 0.75. Deduplicato, il minimo torna su **0.75**. `penalty_hierarchy` riscritta.

### Una cosa che va detta e non lasciata intendere
Il foglio **non** batte il motore sulle presenze: `voto_share` fa MAE 0.2247 su euro contro 0.2163 del
modello presenze gatato, e vince solo sulle finestre default più vecchie. Coerente con quello che la spec
dice delle colonne `desc_*` (aiuto alla lettura, non previsione adottata), e va scritto.

---

## Sessione 29/07/2026 (7) — decisione dell'utente: le probabili non si storicizzano

Correzione di priorità, non di codice, e va scritta perché contraddice quello che questi documenti
dicevano fino a stamattina («il job settimanale è la leva 1, ogni settimana non girata è una finestra che
non esisterà mai»).

**Il ragionamento dell'utente**, che è di dominio e regge: le probabili pubblicate sono **poco affidabili** e
ragionano con gli **stessi fattori che già misuriamo** (ultimi undici, infortuni, abitudini di modulo, ruoli
reali). Il valore aggiunto vero arriva **a ridosso del calcio d'inizio**, quando si sono ascoltate le
dichiarazioni dell'allenatore: quindi la lettura che serve è una **rilevazione pre-partita, usata subito**,
non una serie storica.

A questo si aggiunge un argomento che questi documenti avrebbero dovuto trarre da soli: il bersaglio del
toolkit è l'**asta iniziale**, che si fa in agosto, quando la pagina delle probabili **non esiste ancora**
(il sito la pubblica a stagione già avviata). Una storia settimanale servirebbe solo a gatare una regola
della **giornata**, cioè un altro prodotto — e se il pronostico degli editori è ridondante con ciò che
calcoliamo, quella regola non la si scriverebbe.

### Cosa cambia
- **Il cron settimanale non è più la leva 1**: non era comunque mai stato registrato, quindi non c'è nulla
  da spegnere. `scripts/weekly-snapshot.ps1` resta lì per chi volesse una serie, senza esserne il piano.
- **`starter_prob` 0/1453 nel gate = vuoto per scelta**, non un buco da colmare. Aggiornato in spec e in
  CLAUDE.md, che dicevano il contrario.
- **Il ruolo granulare resta datato e resta necessario**: il provider ignora `seasonId`, e quei codici
  reggono ballottaggi e campetto, che sono fatti del giorno d'asta. Ma la cadenza giusta è quella dell'asta
  (e un rinfresco occasionale), non settimanale.
- **`availability`**: già derubricato nella sessione (5) — gli spell datati di Transfermarkt lo ricostruiscono
  a posteriori, quindi non era nella lista dei tre.

### L'unica cosa da IMPLEMENTARE se la rilevazione pre-partita deve valere
`valid_from` e il nome del file di cache sono **per GIORNO** (`fc_site_probabili_2026-07-29.html`, PK
`(fc_id, valid_from)`), quindi due rilevazioni nello stesso giorno **si sovrascrivono**: una giornata di
Serie A si gioca su più fasce (15:00, 18:00, 20:45) e con la granularità di oggi il posticipo leggerebbe lo
stato del pomeriggio. Serve l'**ora** nella serie datata, e attenzione ai confronti: ogni lettura fa
`valid_from <= data_asta`, e `'2026-08-23T20:00' <= '2026-08-23'` è **falso** — quindi il cambio di formato
tocca `latest_starters`, `availability_now`, `positions.roles_as_of` e chiunque altro confronti quella
colonna con una data. Non è una riga: è una riga più i confronti.

### E una cosa da non lasciare implicita nel codice
`SnapshotView.presence(horizon="recent")` dà a `desc_starter_prob` **precedenza assoluta** su tutto ciò che
è misurato («gli editori hanno risposto alla domanda; niente di misurato batte questo»). Con una rilevazione
a un'ora dal via è difendibile — è la risposta dell'allenatore; con una probabile di tre giorni prima è
esattamente l'assunzione che l'utente sta contestando. Quella precedenza va resa **condizionata a QUANDO**
la foto è stata presa, ed è un altro motivo per cui l'ora serve.

### Seguito della (7): un foglio nel passato non prevede, guarda l'undici schierato

Dalla decisione sulle probabili segue una cosa da implementare, e l'ho fatta (spec «Novità v9.13»):
per un foglio **retrodatato** le probabili non servono perché **l'undici schierato esiste**. Quindi il
foglio porta una **terza classe** di colonne, `actual_next_match` / `_started` / `_minutes` (+
`formation_next_fielded` e `next_match_date` in `clubs.csv`): la prima partita del club DOPO la data d'asta.

Il prefisso non è cosmetico: sono misurate **dopo** la data d'asta, quindi sola rendicontazione, e nessuna
colonna `desc_*`/`engine_*` le legge. Versarle in `desc_starter_prob` — che era la scorciatoia — avrebbe
reso un pronostico e una certezza indistinguibili nella stessa colonna. Il campetto in modalità «prossima
giornata» ora ha una precedenza dal fatto al pronostico (schierato → probabili → chi gioca ultimamente) e la
didascalia dice `FIELDED on <data> - a fact, not a forecast`.

Due difetti trovati misurando: `match_id` porta **entrambe** le squadre, quindi senza il controllo sul club
il Milan leggeva **dodici** titolari e l'avversario del Napoli era «SSC Napoli»; e su 21 club solo **10**
hanno tutti e undici gli uomini fra le righe, perché il row set sono le rose di OGGI (l'undici dell'Inter è
completo tranne Pavard, che ha cambiato club) — nella nota del run, non nascosto.

E una conseguenza da tenere: la granularità per **giorno** di `valid_from` va bene così. L'ora sarebbe
servita per conservare una SERIE di probabili; se si vuole sempre la più recente, sovrascrivere è il
comportamento corretto. Resta invece vera l'altra osservazione della (7): la precedenza assoluta di
`desc_starter_prob` in `presence(recent)` è difendibile solo per una rilevazione vicina al calcio d'inizio —
ora però non è più l'ultima parola, perché su un foglio passato la batte il fatto.

---

## Sessione 29/07/2026 (8) - l'investimento del club (ipotesi bocciata) e l'unita' PARTITA

### L'ipotesi dell'utente, misurata e non adottata
«Una societa' che ha speso vuole vedere il giocatore in campo, e l'allenatore gli perdona una brutta partita,
a scapito dei giovani». Resa misurabile in due canali - cartellino come **quota della spesa del club** e
**Qt.I percentile nel ruolo** - perche' la misura ha imposto il secondo: **Modric e De Bruyne sono arrivati a
parametro zero**, quindi il solo cartellino avrebbe detto «nessun investimento» sui due nomi dell'ipotesi.
Due forme pre-registrate (lift sulla standing di tutti; oppure chiusura di parte dello sconto d'arrivo) e
bersaglio le **titolarita'**. Verdetto: **NON adottata**, pesi a zero. `fee_weight` peggiora monotonamente,
`stature_weight` peggiora in **entrambe** le direzioni (+0.30 costa il 12.9%), la forma `arrival` e'
indistinguibile da spento (quarta cifra) benche' i tre fold piu' recenti la preferiscano col segno previsto.
Numeri completi: gate **7-quater**. Lettura: il meccanismo **e' gia' assorbito dai minuti** - e' lo stesso
sweep che ha appena adottato «la titolarita' si prevede dai minuti» - e resta un segno solo dove i minuti non
possono vederlo, cioe' l'arrivo appena comprato. Da tenere: il test e' **predittivo, non causale**; gli
**ingaggi** (la misura giusta) non esistono in whitelist; il «perdono per una brutta partita» e' per GIORNATA
e il gate per-giornata non c'e'; e il cartellino dell'estate 2026 manca (`transfers` da rilanciare).

### L'unita' e' la PARTITA, non la giornata
Osservazione dell'utente, verificata sui dati: **(giocatore, giornata) non e' una coppia unica** - con un
rinvio piu' un trasferimento un uomo gioca la stessa giornata per due club (Serie A 23/24 g21: fc_id 49
Udinese il 20/01 e Torino il 22/02; Dimarco 19/20 g17 Inter e Verona). E la **PK di `match_ratings`
`(fc_id, season, matchday, platform)` non puo' rappresentarlo**: i voti hanno 1 riga dove il layer
per-partita ne ha 2, quindi per quei casi una presenza si perde. Zero duplicati oggi nella tabella, che e'
quello che mostrerebbe comunque una PK che li vieta.
Il codice che cammina su un calendario cammina su **date**, e lo fa gia' (`club_form`, `rounds_missed`,
`fielded_next`); `fielded_next` ora porta anche la **giornata** nell'etichetta, cosi' un recupero non si
legge come la giornata successiva. La PK resta una **decisione aperta**: cambiarla e' migrazione piu'
re-ingest.

---

## Sessione 29/07/2026 (9) — il pannello: l'altezza si spende sul campetto, non sul suo bordo

Richiesta dell'utente sul layout del tab Snapshot, e nessun numero del motore cambia. Dettaglio in
[spec «Novità v9.15»](spec-euroleghe-ingest-v9.md). Vale la pena ricordare **come** è stato fatto, perché è
quello che ha prodotto il risultato: una **sonda sulle geometrie dei widget** (`winfo_height`/`winfo_rooty` su
finestra reale) prima e dopo, invece di guardare lo schermo e aggiustare.

### Cosa è cambiato, a parità di finestra (1180x780)
Campetto **388 → 493px (+27%)**, tabella rosa **448 → 534px**, chrome sopra il campetto **242 → 165px**.
L'header dell'app passa da 75 a 43px (una riga), la strip dei tab da 45 a 33, la card del club da 94 a 31 —
quest'ultima perché nome e informazioni stanno sulla stessa riga e **il modulo con il suo perché era già
scritto in altri due punti della stessa schermata**. La finestra ora si apre **massimizzata** (client
1536x793 su questo schermo: campetto 449x506) e ricorda la scelta dell'operatore in `ui-prefs.json`.

### I due difetti che solo la misura ha fatto vedere
- **La status bar era invisibile da sempre**: packata *dopo* uno shell con `expand=True`, quindi il packer non
  le lasciava cavità — creata, riempita e aggiornata a **1x1 pixel**. Ora è la prima packata (27px).
- **La targhetta dell'attaccante veniva disegnata sopra la didascalia** del campetto: ora la canvas riserva
  `CAPTION_BAND_PX = 34` e l'undici si dispone in `field = height − banda`. Effetto misurato: le targhette
  nominano **2 rivali invece di 1** (`plate_rivals_for` dipende dalla distanza fra le corsie).
- **276px di colonne della rosa non erano strette, erano assenti**: Tk taglia e non offre come raggiungere.
  Split 1/3–2/3, scrollbar orizzontale **solo quando serve**, larghezze rimisurate sui valori veri (la
  sfoltitura a occhio ne aveva tagliate sei: `real` scriveva `DC/D` per `DC/DR`).

### La lezione da tenere
**Una tesi sul layout va misurata come qualunque altra.** Il pannello ha 5.100 righe di codice e nessun test
guardava la geometria: è per questo che una barra alta un pixel è sopravvissuta per settimane, mentre bastava
una `winfo_height`. Ora c'è
`test_the_panel_spends_its_height_on_the_board_and_not_on_its_own_chrome`, in **rapporti** e non in pixel.

---

## CHIUSURA della sessione 29/07/2026 (sera-notte)

### I commit
`03179d9` una quota di stagione è una quota del CAMPIONATO (spec v9.11) · `b6b29c3` **`sweep`**: le costanti
provvisorie davanti al gate (v9.12, gate §7-ter) · `1fb0d40` il bridge punta alle passate del giorno ·
`942e753` le probabili non si storicizzano — decisione dell'utente e cosa cambia · `ca23c35` un foglio
retrodatato non prevede: legge l'undici **schierato** (v9.13) · `6781d95` l'investimento del club: misurato,
pre-registrato, **bocciato** (v9.14, gate §7-quater) · il layout del pannello: l'altezza va al campetto e
alla rosa, e la status bar esiste (v9.15) · più questo commit di chiusura.
**Non pushati**: la repo è pubblica, il push è una scelta dell'utente.

### Lo stato in una riga
Il toolkit non ha più buchi di dati (`fetch --plan`: «every source is populated»); ha ora **due** comandi di
gate (`backtest` sulle regole, `sweep` sulle costanti), un modulo `engine/presence.py` portabile, e il foglio
d'asta ha **tre** classi di colonne (`engine_*` validate, `desc_*` descrittive, `actual_*` esiti dopo la data
d'asta) — che ora si leggono su un board dove il campetto vale il 60% dell'altezza e nessuna colonna è fuori
dallo schermo. **260 test verdi, ruff pulito, toolkit 0.5.0.**

### I prossimi passi, in ordine di leva
1. **Ritestare l'investimento col valore di mercato Transfermarkt** — è il seguito naturale del §7-quater e
   il lavoro è **offline**: 561 pagine rosa già in cache (51 club × 11 stagioni, ~30 valori per pagina), il
   valore sta nell'HTML come `marktwertverlauf/spieler/<id>">35,00 mln €`. Serve un parser, una tabella
   `player_market_value(fc_id, season, value, source)` con la sua migrazione, due colonne nel foglio (valore
   e **quota del valore della rosa** — «quanto di questa squadra è lui», che è la normalizzazione che
   l'utente ha chiesto) e lo stesso sweep rilanciato con `stature` = valore di mercato. Copre 11 stagioni
   contro le 3 dei cartellini, quindi nessun fold resta cieco.
2. **La modalità LIVE del motore** — non è del toolkit e resta il lavoro più importante: `_window_is_usable`
   pretende voti su entrambe le stagioni, il tab Auction elenca solo stagioni concluse, `auction_view`
   confronta due liste. Per un'asta serve **una lista sola**. Più il gate 3.2 club-a-club (input pronto).
3. **Bloccato dal calendario (agosto)**: `"2026-27"` in `config.SEASONS` (una riga), listone/quotazioni,
   voti, Elo alla data d'asta — e **`transfers` da rilanciare**, perché i cartellini dell'estate 2026 non ci
   sono e senza quelli il canale `fee` è cieco sulla finestra che conta.
4. **Decisioni aperte, non lavori**: la PK di `match_ratings` che non rappresenta due partite nella stessa
   giornata (migrazione + re-ingest); i parametri che lo sweep ha lasciato aperti col loro motivo misurato.

### Dove NON toccare senza rileggere (aggiunte di oggi)
- **L'ordine di packing dentro `root`**: la status bar va packata PRIMA dello shell che espande, altrimenti
  torna a 1x1 pixel senza che nulla protesti. E il campetto ha un pavimento di larghezza (446px): sotto
  quello le targhette perdono lettere dei nomi, che è la cosa per cui il campetto esiste.
- **I denominatori**: ogni quota del foglio si conta sul **campionato** (`league_XIs`), le assenze in
  **giornate** dentro l'unione degli spell, e `engine_pv_pred` sul calendario della **piattaforma**. Mischiare
  le tre unità è il difetto che ha prodotto Kane al 49% e 201 giocatori sul pavimento.
- **`contested` usa le assenze MISURATE, `availability` la previsione**: se tornano a essere lo stesso
  numero si annullano e la storia infortuni diventa decorativa.
- **`actual_*` non si versa in `desc_*`**: sono esiti posteriori alla data d'asta, e un foglio dove una
  certezza e un pronostico condividono una colonna non si può più leggere.
- **`fc_site.penalty_events` deduplica per calcio**: senza quello ogni rigore di Serie A vale due volte e il
  decay si comporta come il suo quadrato.
- **`_cross_fit` scarta i fold ciechi**: un fold la cui curva non si muove non è un fallimento, è un fold che
  non vede la feature — contarlo come 0.0 boccia meccanicamente ogni ipotesi sullo strict.


---

## Sessione 03-04/08/2026 — il board risponde a CHI gioca e DOVE, e la tabella lo dice a colori

Quindici richieste dell'utente, tutte sul pannello Snapshot, più i difetti che quelle richieste hanno fatto
emergere. **Nessun verdetto del gate cambia: qui non è entrata nessuna regola.** Dettaglio completo con tutti
i numeri: spec **«Novità v9.16»** (§1→§10-sexies). Misura nuova nel gate: **§5-terdecies**.
**Toolkit 0.5.0 → 0.6.0 · 271 test verdi · ruff pulito.**

### Le cose che sono entrate
1. **Percentuale della build** (`snapshot.Progress`): pesi in **secondi misurati**, riga `[snapshot] stages:`
   per rimisurarli, fasi di rete fuori dal denominatore quando non girano, `tick(0,0)` = «niente da
   scaricare».
2. **`claim` ≠ `presence`**: il tipo è la squadra con tutti disponibili, quindi `standing` senza sconto
   infortuni (De Bruyne 1.00×0.53 non deve perdere il posto da Elmas 0.62×0.92). `presence` resta la domanda
   d'asta e sta nel tooltip accanto.
3. **Assegnazione globale** (`_matching`, Hungarian scritto in casa) con il prezzo di una casella =
   distanza sulla griglia dei codici, **fascia pesata per linea** (`SIDE_WEIGHT` 8 su D/M, 3 su T/A). Più
   `_settle` (riparazione **Pareto**, `CLAIM_MARGIN` 0.05, scambio e presa-con-rimpiazzo) e `_reshape` (il
   cambio di linea è un **passo obbligato**). Somma dei claim su 340 undici: **2708 → 2932**.
4. **Badge**: in una linea a quattro gli esterni sono `Ts`/`Td`; in una difesa a tre restano `Dc`.
5. **Piede** (misurato) come spareggio dentro la linea; **corpo** (altezza/peso, dalla stessa pagina) come
   lettura e **non** come criterio: la punta più usata è la più alta 48% delle volte.
6. **Tabella su canvas**: pillole di ruolo, numeri verdi/rossi **rispetto alla media del foglio**, check per
   calciatore che rifà gli undici senza di lui.
7. **Tooltip che non escono più dallo schermo** (misurati e ribaltati) e **un SURPLUS vuoto che si spiega**
   (`MIN_PV_PREV` 15, R0c non adottata su default: 253 righe su 598).

### Le tre lezioni di metodo, ognuna pagata due volte
- **La selezione non è della calzata.** Dare le maglie una casella per volta al candidato che calza meglio ha
  messo in campo un uomo a claim 0.00 (Touré) e, per rimediare, due terzini nell'attacco dell'Atalanta: il
  3-4-3 usciva **3-6-1 con un attaccante**. Il claim scegli chi gioca, la calzata solo dove.
- **Un ordine di priorità fisso fra fascia e linea non esiste**: con la fascia per prima un mediano diventa
  esterno («Lobotka esterno»), con la linea per prima il centravanti va sulla trequarti («Hojlund non può mai
  stare sulla trequarti»). Sono la stessa tupla letta in due modi: la risposta riguarda **l'undici intero**,
  ed è per questo che si assegna come un tutto.
- **Tarare un numero alla volta non converge.** Ogni ritocco del prezzo della fascia sistemava un club e ne
  rompeva un altro, finché il modello non ha avuto il peso **per linea**. Quando è ricapitato (attaccanti in
  testa al pool: sistema il Barcellona, rompe l'Atalanta) ho **annullato e scritto**, invece di tarare di
  nuovo.

### Commit della sessione
`c93a29f` il board risponde a CHI gioca e DOVE, e la tabella lo dice a colori · `a6c7896` chore: toolkit
0.5.0 → 0.6.0 · `8d5a4a7` una maglia può cambiare mano per il solo CLAIM, e un tooltip resta nello schermo ·
`0d89b63` il corpo di un centravanti: misurato, mostrato, non un criterio · `6e9a85a` in una difesa a quattro
gli esterni sono TERZINI, e il badge lo dice · `660231d` il claim scegli CHI gioca, la calzata solo DOVE — e
una casella costa secondo la sua LINEA · `971e6fa` un SURPLUS vuoto si spiega, e cosa dicono gli undici di un
allenatore nuovo · più questo commit di chiusura. **Non pushati**: la repo è pubblica, il push è una scelta
dell'utente.

### I prossimi passi, in ordine di leva
1. **Le due cose aperte sul board**, misurate e non tarate: separare il pool `T` da quello `A` quando il
   modulo ha una linea di trequartisti (9 attacchi su 340 senza un attaccante, 3 centrali su una fascia), e
   far pesare gli undici del **nuovo allenatore** — amichevoli comprese — nel prior del modulo e nel claim
   (Atalanta/Sarri: `under_coach = 0`, 4-3-3 su 188 undici misurati, due amichevoli con Raspadori titolare).
2. **Il valore di mercato è arrivato gratis**: `proposedMarketValue` è nella stessa pagina rosa del provider.
   È il proxy che §7-quater aspettava, per GIOCATORE. Migrazione + parse + lo stesso sweep.
3. **La modalità LIVE del motore**, invariata e sempre la più importante: per un'asta serve **una lista sola**.
4. **Bloccato dal calendario (agosto)**: `"2026-27"` in `config.SEASONS`, listone/quotazioni, voti, Elo alla
   data d'asta, `transfers` da rilanciare.
5. ~~Il job settimanale va registrato sulla macchina~~ — **DECISO il 05/08: non serve**, e la richiesta è
   chiusa (vedi la sezione «nessun job settimanale» in fondo).

### Dove NON toccare senza rileggere (aggiunte di questa sessione)
- **`_slot_price` è UNA funzione di costo e la leggono tutti** (assegnazione e riparazione). Se tornano a
  esistere due metri diversi, tornano i due difetti opposti: il mediano esterno e il centravanti trequartista.
- **`SIDE_WEIGHT` è per linea per una ragione**: a centrocampo la fascia è un ruolo, in attacco i tre si
  scambiano. Un peso unico non esiste — è stato provato.
- **`_reshape` sposta solo chi è obbligato** (fascia che non gioca, linea che non gioca), e **la difesa è
  esente** dalla regola della fascia: i braccetti sono centrali per mestiere.
- **`_settle` è Pareto**: una mossa non peggiora mai la calzata, e a calzata invariata chiede
  `CLAIM_MARGIN`. Senza quel margine due mosse da +0.01 svuotano un attacco.
- **Il corpo e il piede non selezionano nessuno.** Il piede è uno spareggio dentro la linea; l'altezza è una
  lettura, e la misura che lo dice sta nel gate §5-terdecies.
- **La media dei colori della tabella è del FOGLIO**, su tutti i giocatori di tutte le squadre: cambiarla in
  «media del club» cambia il senso di ogni cella.

## Sessione 05/08/2026 (notte-mattina) — il listone di agosto, il buco che si vede, e tre muri identici

Dettaglio tecnico: spec **«Novità v9.19»**. Verdetti nuovi nel gate: **§7-septies**, **§7-octies**,
**§7-nonies**. **Nessuna regola è entrata nel motore**, e i set adottati restano `euro R0c+R3c` ·
`Serie A R3+R7+R13`. **Toolkit 0.7.0 → 0.8.0 · 295 test (294 verdi + 1 skip senza display) · ruff pulito.**

### Le cose che sono entrate
1. **Il listone Serie A 2026-27**: 494 giocatori, 20 club, 154 arrivi riclassificati. Il blocco era che l'**id
   campionato** si leggeva solo dalla pagina dei **voti**, che ad agosto non esiste; ora c'è il fallback sulle
   **quotazioni** (Serie A 26/27 = 21) con la **guardia della stagione dichiarata nel file**, perché quelle
   pagine servono «la lista corrente» qualunque stagione chiedi (la pagina euro risponde ancora 108 = 25/26).
2. **Il tabellone distingue un 4-5-1 da un 4-2-3-1** (`_two_rows`): la fonte pubblica tre linee, quindi 4-5-1 è
   1746 stringhe su 4812 e ci finisce dentro chiunque abbia due mediani e tre trequartisti. Più `_flanked`
   esteso al tridente, `_pointed` (il centro dell'attacco vuole un attaccante), la regola 6 e la **targhetta
   che legge il posto** dove il posto decide. 17 disegni cambiati su 108 board e **tutti** gli invarianti a
   zero (erano 4 + 7 + 4).
3. **Il marchio ⧖ / ⟳ / →**: chi il core non può prezzare e il toolkit può ancora **misurare** si vede, si vede
   riempirsi e poi porta la freccia con il tooltip di **cosa** ha chiuso il buco. Una definizione sola
   (`recent_form.awaiting_data`), letta dal modulo sul DB e dal pannello sul foglio. Più la **barra
   determinata** da qualunque modulo (`Context.progress`, totali contati, zero non stampa).
4. **`window_standing`**: un uomo senza stagione qui ma con una finestra misurata altrove **concorre** al claim
   (693 minuti su 10 partite = 77%, sconto d'arrivo 0.80 → 0.616). Spento nel motore, acceso nel pannello,
   pre-registrato.
5. **`synth` converte solo dove è calibrato** (`calibrated_competitions`, dai dati): 241.913 partite su 250.678,
   e le 3756 righe di Serie B che prendevano un voto da una retta che non le ha viste ora restano NULL.
   `mv_synth` rilanciato: gli arrivi con FM-equivalente passano da **707 a 2045**.

### I tre muri, che sono lo stesso muro
Nello stesso giorno, con tre strumenti diversi e la stessa risposta: **R1** ri-misurata con la copertura tripla
non passa su **sei** finestre (peggio dell'àncora su cinque), **R13c** resta ferma sul campione, e lo
**scostamento della Serie B** — che esiste, vale −0.181 e riduce del 20% l'errore contro la retta nuda — perde
contro l'àncora di ruolo. La fantamedia di chi non ha storico qui **non si prevede**; le sue **presenze** sì,
ed è R13, che è già adottata: Alajbegovic passa da nessuna riga a FM 6.245 (l'àncora, dichiarata tale), PV 20.2,
surplus 4.1 — non una regola nuova, è che le sue dieci partite adesso **esistono** nel DB.

### Le lezioni di metodo di questa sessione
- **Una trasformazione calibrata si applica solo dove è stata calibrata**, e l'idoneità si legge **dai dati**,
  non da un tag né da un elenco a mano. Il tag `source='sofascore'` diceva «questa riga viene dal provider», e
  veniva usato per dire «questa riga è convertibile»: due affermazioni diverse, e la seconda era falsa per
  4784 righe.
- **Una regola che seleziona una popolazione ha UNA definizione.** Il marchio del pannello e la coda del
  modulo sono la stessa domanda vista da due lati: due copie sarebbero due popolazioni, e il marchio
  smetterebbe di significare quello che dice.
- **Un parametro non si adotta al bordo della griglia.** L'investimento condizionale passa robust su Serie A e
  resta a zero perché tutti i fold scelgono 0.5 su 0.5: la curva non è mai stata valutata oltre. E allargare
  la griglia dopo aver visto la curva è l'altro modo di fittare.
- **Un criterio scritto prima si onora anche quando il secondo numero lo contraddice**: la Champions passa la
  maggioranza dei suoi 98 uomini **e** ha MAE media peggiore dell'àncora. Entrambi nel report, decisione
  all'operatore, `APPLY_OFFSETS` spento.

### Commit della sessione
`5123413` pre-registrazione §7-septies · `fc6bbd4` un 4-5-1 con tre uomini d'attacco è un 4-2-3-1 · `709bde7`
il listone esce prima dei voti · `69f644d` l'investimento condizionale passa robust su Serie A, e il NULL dice
quanto · `1538dc1` un buco che il toolkit può ancora chiudere si vede · `fe26c39` il giovane senza storico ha
una valutazione e concorre · `62040e9` quando il buco si chiude, il marchio dice con che cosa · `1cf75f8` un
uomo la cui finestra è arrivata non è più in attesa · `62dbaf2` pre-registrazione §7-nonies · `38e5210` lo
scostamento della Serie B esiste, vale −0.181 e non basta · più il commit di chiusura. **Non pushati**: la
repo è pubblica, il push è una scelta dell'utente.

### I prossimi passi, in ordine di leva
1. **L'asta è adesso.** Il listone 26/27 esce a scaglioni (494 su ~1450) e `fvm_history` ha **una** rilevazione:
   serve la **cadenza** di rilancio (listone → `arrivals`, `recent_form` → `synth` → `arrivals`) e poi la
   **modalità LIVE**, che resta la voce più importante di tutto il progetto — per un'asta serve **una lista
   sola**. Il listone **euro** 26/27 non è ancora pubblicato (la pagina serve 25/26 e la guardia lo rifiuta):
   va riprovato, non forzato.
2. **I portieri, che il caso Daffara ha lasciato aperti**: l'FM-equivalente somma gol e assist e non sottrae
   mai i gol presi (+1.06 / +1.08 / +1.12 sopra la fantamedia reale), quindi un portiere ottiene un voto base
   convertito e **non** un equivalente. Serve un equivalente col punteggio dei portieri: lavoro in `arrivals`.
3. **Due decisioni dell'operatore in sospeso**: `APPLY_OFFSETS` (la Champions passa il criterio e peggiora la
   MAE media — raccomandazione: lasciarlo spento). ⚠️ Il job settimanale **non è più una voce aperta**:
   l'operatore ha deciso il 05/08 che non serve.
4. **Il follow-up pre-registrato di §7-septies**, come corsa separata: griglia estesa oltre 0.5 sul solo
   braccio A, il canale valore misurato **al netto** del null, e la conferma sulla finestra 26/27 — l'unica che
   non ha partecipato a niente.
5. **§7-sexies va rimisurata**, e la ragione l'ha trovata la chiusura di questa sessione: quella corsa ha
   girato su un `mv_synth` **fermo**, quindi la copertura del misurato (25-29% euro, 14-20% default) è un
   **pavimento** e il +0.42% della quotazione su `default` non è più il numero di oggi. Il verso non cambia
   (euro vinceva 7 fold su 7); la corsa sì. Nota aggiunta in fondo a §7-sexies.
6. **La regola 4a alla selezione** (4 board su 394, tutti il Lilla) e **allargare il misurato** alla Serie B e
   ai campionati fuori perimetro, che è il seguito vero della regola sulla quotazione.

### Dove NON toccare senza rileggere (aggiunte di questa sessione)
- **`synth` converte per COMPETIZIONE, non per fonte.** `calibrated_competitions` si legge dai dati: se
  qualcuno rimette il tag al suo posto, la Serie B ricomincia a ricevere un voto da una retta che non l'ha
  vista.
- **`APPLY_OFFSETS` è spento per decisione, non per dimenticanza**, e gli offset sono comunque nel report.
- **`awaiting_data` è UNA funzione con un parametro `measured`**, ed è il parametro a dire da quale lato la si
  guarda. «Misurato» per il pannello include la finestra recuperata **altrove**: senza quello il tabellone
  chiede una corsa già fatta.
- **`window_standing` è 0.0 nei `DEFAULTS` del motore e 1.0 solo nel pannello.** Accenderlo nel motore è un
  giro di gate, non un default.
- **Il fallback dell'id campionato non è una scorciatoia sulla stagione**: la guardia è il file che dichiara la
  sua stagione. Togliendola, un agosto qualunque archivia il listone dell'anno prima sotto l'anno nuovo.
- **`_two_rows` spezza la riga sulla MAGGIORANZA**, non su «almeno uno»: con «almeno uno» due esterni che
  arretrano (regola 3) fanno esplodere Napoli, Bologna, Chelsea e Liverpool.

## Sessione 05/08/2026 (pomeriggio) — la LISTA con cui si va all'asta

Dettaglio: spec **«Novità v9.20»**. **Nessun verdetto del gate cambia e nessun numero del motore si muove**:
stesso prezzatore, stessi parametri fittati su un'altra finestra. Toolkit **0.8.0 → 0.9.0 · 297 test verdi ·
ruff pulito.** Chiude la voce che il documento portava aperta da tre sessioni come «la più importante».

### Il blocco era il calendario, e stava nel chiamante
Le presenze sono una **quota** del calendario bersaglio, e una stagione mai giocata ha `matchdays_target = 0`:
quindi ogni `pv_pred` era 0, VALORE e SURPLUS erano 0 e la lista era ordinata da **niente** (misurato: Svilar
`pv 0.0`, ordine per `fc_id`). Il ripiego «il calendario è quello dell'anno scorso» esisteva già ma viveva in
`snapshot.build`, cioè in **un** chiamante — e il secondo chiamante, il tab Auction, si prendeva un listone
intero a zero. Ora sta in `snapshot.engine_predictions`, dove il prezzo è deciso. Dopo: Svilar `pv 32.1`.

### Cosa c'è adesso nel tab Auction
Prima voce del selettore, **`2026-27 · LIVE`**: una tabella sola per ruolo, prezzata dalla **stessa funzione
del foglio Snapshot** (fit iniettati per non preparare due volte le undici finestre, ma la scelta del fit
resta là dentro), su **rose reali** perché il listone di agosto è parziale. Non dichiara nomi in comune né
quota del top-10 perfetto — nessuno ha giocato, sarebbero zeri travestiti da punteggio — e dichiara invece
`357 of 806 players priced`, le note del motore **a schermo** e la profondità prezzabile per ruolo. Le colonne
dell'esito sono **assenti**, non vuote. Serie A/classic per SURPLUS: Svilar 32 · Dimarco 27 · Paz N. 21 ·
Malen 45.

### Due difetti trovati misurando, non rileggendo
- **Layout**: gli ~800 px in più di una tabella sola sono stati provati in tre modi — entrambe le colonne
  elastiche lascia 300 px vuoti a `Player`; nessuna elastica **taglia** `Pair` a 170 px (via il ΔQt.I), che è
  «non stretta, assente»; `Pair` elastica è la giusta, una volta allineata l'intestazione alle sue celle.
- **Test che leggevano il DB reale**: `Config(data_dir=tmp_path)` **non sposta `db_path`** (campi
  indipendenti), quindi il test di geometria apriva il DB da 313 MB e il thread del tab Auction sopravviveva
  al test morendo nel GC (`Windows fatal exception`). Quattro punti reindirizzati.

### I prossimi passi, in ordine di leva
1. **Il listone euro 26/27 quando esce** (oggi la pagina serve 25/26 e la guardia lo rifiuta), e il listone
   Serie A che cresce a scaglioni: la lista LIVE migliora da sé a ogni rilancio di `ratings` → `arrivals`.
2. **I portieri** (caso Daffara): equivalente col punteggio dei portieri, in `arrivals`.
3. **Rimisurare §7-sexies** sulla popolazione nuova, e il **follow-up di §7-septies**.
4. La **decisione dell'operatore** che resta: `APPLY_OFFSETS`. Il job settimanale è stato **chiuso** il
   05/08 («non serve»).

### Dove NON toccare senza rileggere
- **Il ripiego del calendario sta in `engine_predictions`**, non nei chiamanti. Rimetterlo in `build`
  riporta il tab Auction a zero presenze senza che nessun test del foglio se ne accorga.
- **La lista LIVE non ha un esito**: qualunque colonna o riga che parli di «reale» va tenuta fuori, e
  `hits`/`captured_value` su un blocco live sono zeri e non misure.
- **`db_path` non discende da `data_dir`**: un test che vuole stare lontano dal DB reale deve dirlo.


## Sessione 05/08/2026 (sera) — il portiere ha un FM-equivalente, e serviva un numero solo

Gate **§7-decies**, spec **«Novità v9.21»**. **ADOTTATO** (non è una regola del motore: è il layer che
instrada i tier degli arrivi), `backtest --verify` **22/22**, 298 test, ruff pulito.

### Cosa mancava, e non era un modello
Il fantavoto di un portiere è un'**identità**: misurato su **16.017** righe con entrambi i voti, su entrambe le
piattaforme, `mv − gol_presi + 3·rigori_parati − cartellini` ha residuo **0.000 nel 100% dei casi** — e il
**bonus imbattibilità non esiste** (residuo 0.000 anche sulle 4.872 partite a zero, mentre `scoring_config` lo
dichiara 1.0; `ratings` già lo escludeva, ora il config porta la misura). Quindi serviva **un numero solo**, i
gol presi. Erano **già in cache**: `goalsConceded` e `saves` sono chiesti al provider dal primo giorno e
buttati al parse perché `external_stats` non aveva le colonne. Migrazione + parse + re-ingest offline: 11.725
righe su 11.732.

### Il verdetto, col criterio scritto prima
Su **201** portieri-stagione (euro) e **51** (default): bias **−0.00…−0.18** (sempre negativo, come previsto:
manca il +3 dei rigori parati, che la fonte non pubblica), MAE **0.084-0.191** contro **0.214-0.336**
dell'àncora di ruolo, **89-100% entro 0.3** contro lo **0%** della formula dei movimenti — che sugli stessi
uomini riproduce +0.82…+1.22 e conferma su sei stagioni che escluderli era giusto.
**E il guadagno è piccolo, come la pre-registrazione aveva dichiarato**: gli arrivi che guadagnano un
equivalente sono **1/15/19/8** per stagione, il totale passa da 2045 a **2128**, e parte di quei portieri il
core li prezza già. Donnarumma 5.162, Milinkovic-Savic 5.132, Hradecky 4.638.

### ⚠️ Daffara resta NULL, e servono DUE cose — corretto la sera del 05/08
La prima stesura di questa sezione diceva che conservare lo **score** avrebbe reso calcolabile l'equivalente
«Serie B compresa». È **falso**, e vale più della promessa: servono **due** cose, i gol presi *e* un voto base
convertibile. I gol presi esistono solo come aggregato di stagione delle 5 leghe (la Serie B non ne ha uno) e
per partita non esistono più, perché le cache di giornata e di giocatore sono **distillate**; il voto base
della Serie B, invece, il gate lo ha **rifiutato** (§7-nonies: δ = −0.181, reale e battuto dall'àncora). Quindi
un portiere di Serie B resta senza equivalente **per due decisioni misurate**, non per un pezzo di codice
mancante. Dove le due si incontrano sono le coppe e le 5 leghe — dove però l'aggregato di stagione già copre.

### §7-sexies rimisurata sulla popolazione nuova, ed è la prima verifica di «il collo di bottiglia è la copertura»
Con l'FM-equivalente passato da 707 a **2128** arrivi: su **euro** `measured_first` resta CONFIRMED e il suo
margine **cresce** (+0.89% → **+1.00%**, 7 fold su 7); su **default** la quotazione resta la migliore in pool
ma il suo guadagno **scende** (+0.42% → **+0.32%**), sempre sotto il pavimento e con margine negativo sul
secondo. Più calcio misurato, meno vantaggio alla quotazione: la direzione prevista, senza che nessuno abbia
ritoccato un parametro. Trovato nella stessa corsa e **non adottato**: `t3_price` prende un robust PASS a 0.20
su euro (bordo della griglia, margine negativo sul secondo) mentre su `default` il migliore è 0.60, il bordo
opposto — due estremi della stessa griglia è come si presenta un parametro senza segnale.

### La catena, di nuovo
`positions --layer reparse` riscrive `external_match_stats` e quindi **azzera `mv_synth`**: gli arrivi con
equivalente sono crollati a **716** finché `synth` non è stato rilanciato. Stessa catena di §7-octies, questa
volta vista come regressione invece che come strato invecchiato in silenzio. Chi rifà `positions` rifà `synth`
e poi `arrivals`.


## Sessione 05/08/2026 (notte) — l'investimento: erano due metà, e nessuna arriva al pavimento

Gate **§7-septies**, follow-up pre-registrato ed eseguito. **NON ADOTTATA, famiglia CHIUSA** sul lato
investimento: `value_weight` e `shrink_weight` restano **0.0**. 297 test, ruff pulito.

### Le due domande che la prima corsa aveva lasciato aperte, entrambe risposte
1. **Il bordo**: la prima corsa vedeva ogni fold scegliere 0.50 su una griglia che finiva a 0.50, quindi
   l'optimum stava fuori dal misurato. Con la griglia estesa (0.50 → 3.00, tetto motivato: un titolare è ~0.09
   del valore della sua rosa, quindi 3.0 aggiunge 0.27 di stagione) la curva **gira dentro**: migliore **0.75**
   su `default` (robust PASS, media +0.56%) e **0.50** su euro (media +0.34%, sotto il pavimento). A 3.0 il
   termine costa più che essere spento. Non era monotono: era monotono fino a dove la griglia finiva.
2. **Il null**, che la pre-registrazione chiamava «la parte che conta». Con `shrink_weight` accesa al suo
   migliore e il peso del valore spazzato sopra, misurato **per fold contro il punto solo-null**: il valore
   aggiunge **+0.41%** su `default` e **+0.045%** su euro, entrambi **sotto il pavimento** di 0.5%.
   E i conti tornano: su `default` il null da solo vale +0.37%, il valore sopra +0.41%, somma +0.78% = il
   +0.79% che la forma grezza otteneva in robust PASS. **Il PASS era la somma di due effetti entrambi sotto il
   pavimento**, ed è esattamente ciò che il pavimento esiste per rifiutare.

### Due cose di metodo che questa corsa ha prodotto
- **Un baseline dichiarato per famiglia** (`sweep.BASELINES`): il contributo marginale si misura contro il
  punto solo-null **per fold**, non sottraendo le medie pooled di due famiglie — i fold non pesano uguale. Il
  test che pretendeva «lo stato in uso sta nella sua griglia» ora pretende, per quelle famiglie, che sia il
  **baseline dichiarato** a starci: un punto di confronto che nessun fold ha valutato non è un confronto.
- ⚠️ **Un errore mio nella pre-registrazione**, scritto invece che aggirato: fra i criteri avevo messo
  «margine sul secondo positivo», ma quel numero è definito come quanto il valore **in uso** batte il miglior
  rivale — e per una famiglia il cui valore in uso è **spento** un margine positivo significherebbe «il termine
  non fa niente». La condizione era impossibile per costruzione. Lezione: un criterio si scrive prima, **e va
  verificato che sia esprimibile con le metriche che il report produce**.

### Cosa riaprirebbe la famiglia, dichiarato
Non un'altra griglia: due corse coprono 0.005 → 3.0. Servirebbe un proxy dell'investimento che **non sia già
nei minuti** — gli **ingaggi**, che nessuna fonte in whitelist pubblica — o la **variazione** del valore dentro
la stagione, che è un'altra domanda e richiede una serie per data. La conferma indipendente resta 26/27.


## Sessione 05/08/2026 (notte, 2) — un posto in attacco è il lavoro di un attaccante, alla SELEZIONE

Spec **«Novità v9.22»**. Chiude l'ultimo caso della famiglia «attacchi senza un attaccante». 299 test.

### La misura ha ridefinito il numero prima di scrivere la regola
La conta delle sessioni precedenti («4 board su 394») mescolava due cose: in modalità **`next`**, dove le
fonti dichiarano almeno 11 titolari, il board **è l'undici dichiarato** e chi occupa un posto non è una scelta
del modello. Separati: **516 board che il modello seleziona** contro **150 che la fonte dichiara**. Sui primi:
**6 attacchi senza attaccante**, tutti il **Lilla** e lo stesso uomo, e **1 centrale su una fascia** (Manchester
United, ma sulla fascia della **trequarti**, che `_flanked` non copre — aperto e scritto).
⚠️ Lezione da tenere: attribuire al modello un board dichiarato dalle fonti gli attribuisce scelte degli
editor — l'Atalanta `next` esce col portiere Sportiello (0.03) e Carnesecchi (0.82) fuori, ed è la **probabile**,
non il modulo.

### `_fronted`, e perché non è la strada che la todolist proponeva
La todolist diceva «la riga di centrocampo cede un posto e il modulo esce 4-4-1-1». Implementato invece un
**override di selezione**: il MESTIERE decide chi è eleggibile per il posto d'attacco (`_off_the_front`, la
definizione già esistente, che copre anche chi non ha codici) e il claim decide fra i candidati, col tetto dei
due override che c'erano già. Perché: cedere un posto **cambia la forma**, e la forma ha già un unico
proprietario (`_reshape`, che trasforma solo se obbligata); e restare nella stessa valuta evita un terzo metro.
Il Lilla esce **4-5-1 con Fernandez-Pardo davanti**, cioè la squadra schiera la sua punta.

### Cosa è costato, misurato disegnando ogni board due volte
**67 board su 666 cambiati**, costo medio in claim **−0.108**, peggiore −0.480 (due scambi al tetto). Lilla:
Haraldsson (`AM` 0.83) → **Fernandez-Pardo** (`ST` 0.83, pari claim). Atalanta 3-4-3: Pasalic (`MC;DM;AM` 0.56)
→ **Scamacca** (`ST` 0.47). Lazio 3-3-4: Dele-Bashiru → **Cancellieri** (`RW` 0.62). Attacchi senza attaccante
**6 → 0**; nessun non-attaccante entra in una linea d'attacco (il pool lo esclude per costruzione); e le
asserzioni dei board **già giudicati dall'operatore** (Napoli, Atalanta, Roma, Fiorentina, Liverpool, Bologna)
restano tutte verdi — è quella la guardia vera, non il conteggio.


## Sessione 05/08/2026 (sera-notte) — tre segnalazioni dell'operatore sul foglio, e un buco trovato

Spec **«Novità v9.23»**. 299 test, ruff pulito.

1. **Il nome del foglio selezionabile porta piattaforma e game** — una lega dichiarata li fissa, quindi il
   selettore League non ne mostrava nessuno e due fogli della stessa lega su calendari diversi leggevano uguale.
2. ⚠️ **`evidence_age`, e il buco vero**: «Gutierrez non è più nel Napoli». Il foglio aveva ragione su quello che
   aveva (entrambe le fonti dicevano Napoli: `fc_site` 04/08, `transfermarkt` 29/07) e non diceva quanto fosse
   vecchio. E **`transfers_history` non conteneva un solo movimento datato 2026** — il più recente 2025-07-01 —
   cioè il mercato che ha costruito queste rose non era nel DB. Ora ogni foglio dichiara l'età dell'evidenza per
   fonte e se il layer trasferimenti copre la finestra; `transfers` rilanciato.
3. **`engine_unpriced_reason`**: la cella vuota del SURPLUS ora dice quale delle due affermazioni è — «only N
   votes of 15» (Boga 13, Dovbyk 12, Pavard 1) o «no season on this platform» (Kolo Muani, 23 voti euro e zero
   Serie A; Stones 3). Sul foglio Serie A **283 su 629 = 157 + 126**. Su euro non si vede perché R0c prezza
   all'àncora; convertire il secondo caso è R1, respinta due volte.

### La lezione, che è la stessa di tre volte oggi
Un foglio che è **giusto su quello che ha** e non dice **quanto vecchio** sia quello che ha, invita a fidarsi di
un fatto che nessuno ha ricontrollato. Vale per le rose come per un coefficiente: la data è parte del numero.


## Sessione 05/08/2026 (notte, 3) — OGNI calciatore ha un SURPLUS, penalizzato e dichiarato

Spec **«Novità v9.24»**, regola dell'operatore. 301 test, `backtest --verify` **22/22**: `engine_*` non si
muove di un decimale.

### La forma della soluzione
Nuovo `engine/estimate.py` e una **quarta** classe di colonne, `est_*` (stimate: né gatate né misurate). La
cascata ha cinque gradini e ognuno porta la misura che lo ha messo lì — l'altra piattaforma (differenza media
**+0.001**, 92% entro 0.3 su 870 stagioni-giocatore), una stagione più vecchia (MAE 0.396 a t-2 contro 0.368 a
t-1), la sua stagione sottile **mescolata** col livello del club per quel ruolo (spread misurato 1.36 sugli
attaccanti, 0.25 sui portieri: il punto Juve-contro-Verona quantificato), e l'àncora di club come pavimento.
⚠️ L'**FM-equivalente estero non è un gradino**: R1 lo ha messo contro l'àncora su sei finestre e ha perso su
cinque.

### Le tre proprietà che la tengono onesta
1. **stessa aritmetica** di `engine_surplus` × la confidenza — una riga `core` esce esattamente al suo surplus
   gatato (0 discordanti). La prima versione pesava anche la beccabilità e Hojlund passava 28.4 → 24.6 senza
   che nulla di lui fosse cambiato;
2. la **penalità moltiplica il surplus**, mai la fantamedia: l'indeterminazione è un fatto sul numero;
3. ogni riga stimata **dice perché** (`est_basis`, `est_confidence`, `est_note`) e nel pannello la cella porta
   `~` col tooltip che riporta base, nota e penalità.

### Un numero inventato, trovato provando e sostituito da una misura
Mezzo calendario di presenze per un uomo senza nulla di misurato faceva valere un portiere **ignoto** più del
terzo portiere del suo club che aveva giocato una volta. Misurato su tre finestre: chi non ha stagione
precedente gioca una quota mediana di **0.289** (default) e 0.194 (euro); chi ha una stagione sottile **0.421**
/ 0.290. Ora Rossi F. 5.4, Sportiello 4.4, Carnesecchi 35.1.

### Effetto
Foglio Serie A: righe con un surplus da **346 su 629** a **629 su 629** (346 gatate + 283 stimate: 146
`shrunk`, 100 `anchor`, 28 `older`, 9 `other_platform`). Foglio euro: tutte `core`, perché là R0c prezza già
tutti.


## Sessione 05/08/2026 (notte, 4) — le rose contro i trasferimenti, e una PK che perdeva un evento

Spec **«Novità v9.25»**, dalla segnalazione «Gutierrez non è più nel Napoli». 302 test, `backtest --verify`
22/22.

- **Il caso**: ogni fonte del foglio diceva Napoli (listone 26/27, `fc_site` 04/08, `transfermarkt` 29/07); a
  sapere era il trasferimento (Napoli → Bayer 04 Leverkusen, 01/07/2026, 26M), che non era nel DB perché
  `transfers` non era stato rilanciato per l'estate 2026.
- ⚠️ **Un OUT non è una partenza**: la prima versione del controllo segnalava **82** partenze, fra cui Hojlund
  e Malen, perché la pagina di un club porta lo stesso uomo due volte con la data del 1 luglio — rientro dal
  prestito e acquisto definitivo. Corretto: OUT dal suo club **e** nessun arrivo che lo riporta lì → 51 righe.
- **La causa era la PK** `(fc_id, date)`: tutti i movimenti estivi sono datati `YYYY-07-01`, quindi le due
  righe si schiacciavano e vinceva l'ultima scritta. Migrazione esplicita (`widen_transfers_pk`) e re-ingest
  offline: **2949 → 4383** trasferimenti. Stessa forma del difetto documentato per `match_ratings`.
- **Il foglio dichiara e non sposta**: `desc_left_for`/`desc_left_on`, nota di foglio, marchio ⇥ nel pannello.
  Il listone è l'autorità del gioco su chi è in una rosa; dove due fonti discordano si dice, non si indovina.


## Decisione 05/08/2026 — NESSUN job settimanale, e la richiesta è chiusa

«Il job ogni settimana non serve, elimina questa richiesta.» È la stessa logica del 29/07 sulle probabili,
portata a conclusione, e vale scriverla perché il progetto la chiedeva da tre sessioni.

**Perché è la scelta giusta e non una rinuncia**: un'asta iniziale si prepara in **agosto**, quando la pagina
delle probabili non esiste ancora; e quello che gli editor aggiungono che non sappiamo calcolare arriva
**tardi**, dalle parole dell'allenatore — quindi la lettura che vale è quella presa **subito prima** della
sessione e usata subito, non una serie storica. `starter_prob` 0/1453 sulle finestre del gate è **vuoto per
scelta**, e nessuna regola adottata lo aspetta.

**Cosa è stato applicato**: `scripts/weekly-snapshot.ps1` → `scripts/refresh-editorial.ps1`, che fa una cosa
sola su richiesta (le probabili/indisponibili di oggi) senza più la macchina di registrazione dello scheduled
task; `bootstrap` e `toolkit/README.md` non chiedono più di programmare niente.

**Cosa lo sostituisce, ed è meglio**: il foglio **dichiara l'età** della sua evidenza per fonte
(`evidence_age`, v9.23) e la rosa viva del provider è letta come quarta fonte (v9.26). Un board disegnato su
rose vecchie si vede come una **data**, invece di essere creduto — che è esattamente ciò che un job avrebbe
dovuto evitare, ottenuto senza un job.

## CHIUSURA della sessione 05/08/2026 — undici passate, e la più istruttiva è quella che si è ribaltata

Sessione lunga: dal listone di agosto alla lista con cui si va al tavolo, passando per tre muri identici e una
decisione dell'operatore che ha rovesciato una scelta di un'ora prima. **Nessuna regola nuova è entrata nel
motore** — i set adottati restano `euro R0c+R3c` · `Serie A R3+R7+R13` e `backtest --verify` resta **22/22** —
e tutto quello che è cambiato è dati, strumenti, tabellone e un layer di ripiego dichiarato come tale.

### Quello che ora esiste e prima no
1. **Il listone di agosto entra** (l'id campionato dalle quotazioni, con la guardia della stagione dichiarata
   nel file) e **`transfers` è stato rilanciato**: 2949 → **4383** movimenti, 523 datati 2026.
2. **La lista LIVE d'asta**: `2026-27 · LIVE` come prima voce, prezzata dalla stessa funzione del foglio. Il
   blocco era il **calendario** di una stagione mai giocata, e il suo ripiego viveva in un chiamante.
3. **Ogni calciatore ha un SURPLUS** (`est_*`, quarta classe di colonne): cascata dichiarata, ogni rung con la
   misura che l'ha messo lì, penalità sul surplus e **nota per riga**. 628 → 629 righe su 629 prezzate.
4. **`estimates`**, comando nuovo: misura sul passato se mescolare stime e misure conviene. Dice **no**
   (−12.40% su 10 finestre su 10); l'operatore ha scelto di mescolarle comunque, e il **filtro** `include`
   (all | measured | estimated) rende la scelta reversibile a ogni sguardo.
5. **I portieri hanno un FM-equivalente** (§7-decies, adottato): il loro fantavoto è un'identità esatta su
   16.017 righe, mancava un numero solo — i gol presi — e **era già in cache**.
6. **La rosa viva del provider** è la quarta fonte di `squad_snapshot`: sa di una partenza **una settimana
   prima** del listone e delle pagine rosa, e la sua forza è l'**assenza**, che nessun'altra fonte esprime.
7. **Il tabellone**: `_two_rows` (un 4-5-1 con tre uomini d'attacco è un 4-2-3-1), `_fronted` (un posto in
   attacco è il lavoro di un attaccante, **alla selezione**), il marchio ⧖/⟳/→ e l'età dell'evidenza dichiarata.

### I verdetti del gate, tutti negativi e tutti utili
- **R1** ri-misurata con copertura tripla: **non passa** su sei finestre. **R13c**: muro di campione. Lo
  **scostamento Serie B**: reale (−0.181, −20% sull'errore) e battuto dall'àncora. Tre muri identici in un
  giorno, e la lettura è una: **la fantamedia di chi non ha storico qui non si predice; le presenze sì**.
- **L'investimento**: la griglia estesa mostra che l'optimum era dentro (0.75), e il **marginale sul null**
  vale +0.41% su Serie A e +0.045% su euro — sotto il pavimento. Il PASS robust era la **somma di due effetti
  entrambi sotto il pavimento**. Famiglia chiusa.
- **§7-sexies rimisurata** sulla popolazione nuova: il margine del misurato **cresce** su euro (+1.00%) e il
  vantaggio della quotazione su Serie A **scende** (+0.32%) — prima verifica quantitativa di «il collo di
  bottiglia è la copertura».
- **Champions** passa il criterio di §7-nonies e resta spenta: decisione dell'operatore, con la MAE media
  peggiore dell'àncora sul tavolo.

### Le lezioni di metodo, e ognuna è costata qualcosa
- **Una lista mostrata le cui metriche descrivono un'altra lista è peggio di nessuna metrica**: il primo
  merge delle stime lasciava `captured`/`hits` sulla lista gatata e l'harness stampava **+0.00% su 10 su 10**.
- **Una trasformazione calibrata vale solo dove è stata calibrata**, e l'idoneità si legge dai dati (4784
  righe convertite da una retta che non le aveva viste).
- **Un parametro non si adotta al bordo della griglia**, e **un criterio va scritto prima E verificato che sia
  esprimibile** con le metriche del report (il mio «margine sul secondo positivo» non lo era).
- **Una rosa è un fatto giornaliero**, e solo una lettura intera può dire che qualcuno è andato — con la
  guardia «vuoto = ignoto, mai zero».
- **Quando un fallback ha bisogno di un numero che nessuno ha misurato, misuralo**: «mezzo calendario» per un
  ignoto faceva valere un portiere sconosciuto più del terzo portiere del suo club (0.289 e 0.421 le quote vere).

### Commit della sessione (24, in ordine)
`5123413` pre-registrazione §7-septies · `fc6bbd4` un 4-5-1 con tre uomini d'attacco è un 4-2-3-1 · `709bde7`
il listone esce prima dei voti · `69f644d` l'investimento condizionale e il NULL · `1538dc1` un buco che si
vede · `fe26c39` il giovane senza storico concorre · `62040e9` il marchio dice con che cosa · `1cf75f8` chi è
arrivato non è più in attesa · `62dbaf2` pre-registrazione §7-nonies · `38e5210` lo scostamento Serie B ·
`d198fb8` chiusura della passata notturna · `100329c` esiste UNA lista per l'asta · `f7c2d77` l'FM-equivalente
dei portieri · `14fe7ed` §7-sexies rimisurata · `f4c164b` l'investimento erano due metà · `3cd960c` un posto
in attacco è di un attaccante · `f2b9e7c` il nome del foglio, l'età dell'evidenza, il perché di una cella
vuota · `63dc447` ogni calciatore ha un SURPLUS · `3e0023f` un OUT non è una partenza, e la PK · `41138f3`
l'ente affidabile era già in cache · `24ddd80` nessun job settimanale · `f379daf` la lista ordina anche gli
stimati · `447d86f` la stima messa alla prova · `817e99e` l'assistente d'asta progettato prima del codice
(+ questo di chiusura). **Non pushati**: la repo è pubblica, il push è una scelta dell'utente.

### I prossimi passi, in ordine di leva
1. **La lega dell'operatore non è ancora dichiarabile**, e questo blocca numeri veri: `Config._league_setup`
   cancella la dimensione «rosa senza quote» (12 partecipanti, euro/mantra, 25 = 2 porte + 23), quindi i
   livelli di rimpiazzo — e ogni surplus di quella lega — sono verosimili e sbagliati. Tre modifiche piccole e
   insieme: `assistente-asta-v1.md` §16.4.
2. **Acquisizioni che bloccano numeri veri**: listone **euro 26/27** (oggi la pagina serve 25/26 e la guardia
   lo rifiuta), calendario della stagione, ClubElo giornaliero e club fuori perimetro, la scala dell'R-Factor.
3. **Il refactor dell'assegnamento fuori da `gui.py`** e il **simulatore di draft** — in un draft il prezzo è
   pubblico e fisso, quindi è simulabile e **pre-registrabile**.
4. **Allargare il misurato** ai campionati fuori perimetro: è il seguito vero della regola sulla quotazione.
5. Restano una decisione (`APPLY_OFFSETS`, raccomandazione: spento) e due voci minori: un centrale sulla fascia
   della **trequarti** (1 board su 516) e la **PK di `match_ratings`** (due partite nella stessa giornata).

### Dove NON toccare senza rileggere (aggiunte di questa sessione)
- **`est_*` non è `engine_*`**: la cascata non è gatata e non deve entrare in nessuna colonna che lo sia. Il
  gate non passa mai `estimates` né `include`, ed è così che `backtest --verify` resta 22/22.
- **Ogni cifra di un blocco d'asta viene dalla lista che il filtro produce.** Se tornano a essere due liste,
  torna il `+0.00% su dieci finestre`.
- **Le confidenze della cascata non si ritarano sulle dieci finestre della misura**: sarebbe fittare sul
  deliverable. Sono dichiarate, e ogni riga porta la sua.
- **Il ripiego del calendario sta in `engine_predictions`**, non nei chiamanti.
- **L'assenza dalla rosa viva è evidenza solo per chi il provider sa identificare**, e il flag porta sempre la
  data dell'osservazione.
