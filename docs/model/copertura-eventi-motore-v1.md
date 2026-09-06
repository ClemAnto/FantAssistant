# Copertura degli eventi — cosa il motore LEGGE, cosa ha misurato e RESPINTO, cosa non vede
**6 settembre 2026 · v1** · Nato dalla domanda dell'operatore: «verifica se nel nostro algoritmo per
prevedere le presenze attese e la fantamedia abbiamo tenuto conto dei seguenti eventi», con una lista
di ventisei voci in sei blocchi.

Questa pagina non misura niente di nuovo: è una MAPPA fra gli eventi che un fantallenatore nomina e i
canali che questo progetto ha costruito, con il verdetto e il numero di ciascuno. Esisteva già tutto,
sparso fra `gate-motore-v1.md` (i verdetti), `metrica-asta-surplus-v1.md` §20 (i segnali d'esito),
`presence.py` (i canali del pannello) e `nota-modello-set-pieces-v2.md`; quello che non esisteva era
l'indice per EVENTO, che è il modo in cui la domanda arriva.

Verificata **leggendo il codice e interrogando il DB**, non citando i documenti — e la sola voce in cui
ho citato un documento invece di misurare è quella che è risultata sbagliata (§9.3).

---

## 1. Il quadro in una riga

Il motore **vede** quasi tutto quello che la lista nomina: `features.Observation` porta l'età, il nuovo
allenatore, gli arrivi nello stesso ruolo, il rigorista, la coppa, il fuori-ruolo, la persistenza della
disponibilità, la forza d'attacco del club. Non li **legge**, perché il gate li ha bocciati. I campi
restano in `Observation` di proposito, così il gate può ri-giudicarli quando l'input migliora.

Quello che gira davvero (`evaluate.ADOPTED`):

| piattaforma | insieme adottato |
|---|---|
| `default` (Serie A) | R0 · **R3** minuti · **R7** portieri · **R13** forma recente altrove · **R19** Elo del club d'ORIGINE · **R20K10** giornate già giocate · **R23** il reparto in cui arriva |
| `euro` | R0 · R0c · **R3c** minuti sul calendario euro · **R18** carriera + ultima stagione · **R20K6** · **R23** |

Su Serie A **la scala della fantamedia è piatta su ogni riga**: tutte le regole adottate là lavorano
sulle presenze, quindi `engine_fm_pred` è «la sua stagione scorsa regredita verso l'ancora di ruolo» e
niente altro (`letture-app-v1.md` §30). È coerente con la calibrazione del 06/09: l'errore sta sulle
**presenze** (6,87 giornate su 36 previste) e non sulla fantamedia (0,317).

## 2. Le cinque risposte possibili

Ogni voce cade in una di queste, e la distinzione è la parte utile:

- **ADOTTATA** — dentro `engine_*`, passata dal gate.
- **PANNELLO** — dentro il `claim` / la board / le colonne `desc_*`, quindi muove chi la board disegna
  e la scala di titolarità, ma **non** `engine_pv_pred`. `presence.py` non importa `evaluate`.
- **RESPINTA** — misurata con un criterio scritto prima della corsa e bocciata. Col numero.
- **REPORTING** — la colonna esiste ed è a schermo, nessuna previsione la legge.
- **IMPOSSIBILE** — il dato non c'è, e si dice quale dato.

---

## 3. Ruolo e uso tattico

| evento | verdetto | numero |
|---|---|---|
| Cambio di posizione tattica | **RESPINTA** + reporting | R8 (fuori-ruolo da heatmap): 2/4 e **1/6** finestre, peggiore −19,2%. Come segnale d'esito «posizione più avanzata» **+0,009, 4/8** = una monetina. Reporting: `desc_real_role*`, `desc_avg_x/y`, `desc_place_*` |
| Cambio di modulo dell'allenatore | **PANNELLO** + **RESPINTA** | Nessun input di forma né in `Observation` né in `presence.Inputs`. Entra nella BOARD (gli undici sono assegnati ai posti del modulo, quindi un difensore compete per 3 o 4 posti) e la board è il GATE della scala di titolarità. Come segnale d'esito: **−0,032, 2/8**. La forma del ritiro: `PRESEASON_WEIGHT` = 0, ottimo al bordo. **E la forma diretta è stata misurata il 06/09 e ha il SEGNO ROVESCIATO: §9.1** |
| Rigori | **RESPINTA** + reporting | R6: λ **+0,332 / −0,222** (segni opposti fra finestre), peggiora gli attaccanti +1,8/+2,7%. `penalty_hierarchy` 3.384 righe / 444 uomini → `desc_penalty_rank`, `desc_penalty_confidence`. Come segnale d'esito il rigorista dà +0,035, 7/8 |
| Punizioni e corner | **IMPOSSIBILE** | `assists_set_piece` è NULL su **tutte le 264.681 righe** di `match_ratings` (interrogato 06/09): la fonte non ha mai splittato gli assist. `desc_set_piece_duty` scrive «not available» invece di un numero |
| Nuovo ruolo sul listone (slash D/C, C/A) | **ADOTTATA, indirettamente** | L'ancora di un multi-ruolo mantra è la media delle ancore dei suoi k codici (`model.fractional_anchor`), quindi cambiare codice cambia `engine_fm_pred`. Nessun termine legge il CAMBIO come evento |
| Compiti più difensivi / più offensivi | come il primo: RESPINTA | — |

## 4. Contesto squadra

| evento | verdetto | numero |
|---|---|---|
| Trasferimento a club più forte / più debole | **ADOTTATA, ma solo il verso giusto** | **R19** (Elo del club di ORIGINE, per chi cambia club): 9/10 finestre, media +1,7% — **solo `default`**, su euro 0/5. Pannello: `level_weight` 0,06 e `level_gap_weight` 0,06 (il SALTO origine−destinazione, r parziale **+0,220** contro +0,117 del livello assoluto). Il livello del club di DESTINAZIONE da solo è la famiglia respinta **quattro volte** (R5, R5b, R16b) |
| Cambio allenatore | **RESPINTA** | R10: viva su due finestre, morta su dieci. Segnale d'esito **−0,014, 2/8**. `desc_new_coach` reporting — e attenzione, `flags.new_coach` porta il NOME dell'allenatore, non `yes`/`no` |
| Qualità di chi rifornisce / finalizza | **RESPINTA** | R5b (assist attesi del club, quarta corsa della famiglia forza-club) e R16 (budget gol del club × la sua quota). Non esiste un canale «chi lo rifornisce» per-uomo |
| Concorrenza nel reparto | **UNA passa, cinque no** | Respinte: R11 (arrivi stesso ruolo), R11b (soglia 2+), R16, R16b, R17 — cinque meccanismi diversi. **ADOTTATA R23** (20/08, tutt'e due le piattaforme, 5/5 euro e **10/10** Serie A): il suo valore di mercato contro il compagno più caro che condivide un codice mantra, più il percentile di valore |
| Ritorno di un titolare | **REPORTING** | `snapshot.place_changes`, col controllo di reparto e la DATA («chi gioca perché il titolare davanti è rotto non ha vinto il posto»). La forma previsionale è misurata: **+0,049, 6/8** — debole e instabile. «Mostrarlo è utile, ordinarci sopra no» |
| Obiettivi stagionali e solidità | **ASSENTE** | Nessun input, ed è la stessa famiglia respinta quattro volte |

## 5. Disponibilità

| evento | verdetto | numero |
|---|---|---|
| Infortuni: numero, gravità, recidive | **PANNELLO**, non motore | Motore: solo il PROXY (`longest_gap_days`, `days_since_last_match`); R14/R14b respinte; **R15 è il near-miss più vicino di tutto il set** (Serie A 8/10, media +2,6%; euro 5/5 ma una sotto il pavimento) e resta fuori — «la tentazione di allentare un criterio per una regola che piace è esattamente ciò per cui il criterio esiste». Pannello: `availability` = 1 − assenze/38 con `injury_weights` **(1,0 · 0,6 · 0,35)** sulle tre stagioni e pavimento **0,40**. App: `core/injury-window.ts` riprezza la plancia sulla finestra di rientro |
| Squalifiche e cartellini | **ESITO sì, previsione no** | I cartellini ci sono (**33.611 gialli e 1.855 rossi** in `match_ratings`), quindi sono già dentro la fantamedia misurata che il motore regredisce; nessun canale prevede le giornate perse. `match_ratings.status` non ha mai scritto `suspended`. `availability` porta lo stato di OGGI e la board esclude lo squalificato per la prossima. **Tetto misurato: §9.2** |
| Da titolare a subentrante | **IL CUORE DEL MOTORE** | R3/R3c (minuti), `standing_weights` = **(0, 1)** — i minuti battono le partite da titolare su 10 fold di 10 — R20K10/K6 (giornate già giocate). E **R24** («una partenza non è una presenza»), pre-registrata il 06/09: **RESPINTA** su tutt'e due, `default` +0,35% (6/14, sotto il pavimento) e `euro` +0,81% (5/10, peggiore −2,11% su I19feb), a HEAD `63022bf` |
| Turnover per le coppe europee | **ASSENTE** | Mai misurato. R21 riguarda le coppe per NAZIONALI, non Champions/Europa |
| Nazionale, Coppa d'Africa, tornei estivi | **RESPINTA** + reporting | DiD su quattro finestre-torneo: AFC **0,59** · CAF 0,35 con cap / 0,20 senza. Dentro `engine_pv_pred` (R21): Serie A T2 MAE presenze 7,181 → **7,472 (+4,0%)** — chi va in coppa ci andava anche l'anno prima e `minutes_prev` porta già lo sconto, quindi sottrarlo lo conta due volte. Reporting: `desc_pv_cup`, `desc_surplus_cup`. Nel 2026-27 la CAN è **19/06→17/07/2027** e non tocca il campionato: l'unica dentro è la Coppa d'Asia (07/01→05/02), 4 quotati in Serie A e 9 su euro |

## 6. Fattori individuali

| evento | verdetto | numero |
|---|---|---|
| Regressione dopo sovraperformance (gol > xG) | **FALSIFICATA tre volte** | «Fortuna da correggere» (gol − xG) **0,000, 3/8** — e su una finestra sola valeva −0,181, cioè sarebbe stata adottata da chi guarda una stagione. «Crea e non segna ancora» −0,046, 3/8. «Sopra le proprie medie quindi scenderà», col null rimescolato (Miller-Sanjurjo): eccesso vero **+0,0167 · +0,0072 · −0,0007** a 2/3/5 giornate, dentro il rumore e cambia segno. Ma la regressione GENERICA è il motore stesso: ancora + β(fm_prev − ancora) |
| Curva d'età | **RESPINTA da due giudici** | R4/R4b: vive su due finestre, morte su dieci. Pannello `age_decline` = 0 su griglia pre-registrata (29/30/31 × 0/0,03/0,06/0,09): sweep +0,23% su euro con ottimo **AL BORDO**, +0,04% su default, e il giudice esito peggiora a OGNI punto. Segnale d'esito −0,069, **0/8**. Il meccanismo: i trentenni portano già meno minuti misurati, quindi lo standing li sconta prima di ogni termine d'età |
| Adattamento a nuovo campionato | **RESPINTA** | R1b: 3/10, peggiore −14,2%, e il criterio di falsificazione scritto in pre-registrazione è scattato — δ_intra > δ_cross, cioè il segnale non è l'adattamento alla lega ma un generico cambio squadra. Quello **è** dentro: `arrival_discount` 0,80, e misurato chi arriva dall'estero è quasi non distorto (**−0,013**) contro chi arriva dalla porta accanto (**−0,057**) |
| Motivazione: contratto, mercato, personale | **DICHIARATO** | `desc_contract_until` / `desc_exit_risk` reporting; `config/player_notes.json` (`out_of_squad` · `dispute` · `wants_out`) è dell'operatore e **nessun percorso motore lo legge** — niente in questo progetto osserva un litigio |
| Condizione fisica e preparazione estiva | **REPORTING + pre-registrato** | `desc_preseason_matches` / `desc_preseason_starts`. `PRESEASON_WEIGHT` = 0, ottimo al bordo; la famiglia della linea difensiva dal ritiro legge 11/16 contro il **14/16** della board. Pre-registrazione a **giugno 2027**. Limite di copertura: le amichevoli coprono 20 club di Serie A su 20 solo per il 2026-27, **2 e 4** nelle due stagioni prima, quindi nessuno screen è verificabile all'indietro |

## 7. Rumore e campionamento

| evento | verdetto | numero |
|---|---|---|
| Autogol, rigori sbagliati | **ESITO sì, previsione no** | 650 autogol, 661 rigori sbagliati, 410 parati in `match_ratings`: dentro la fantamedia misurata, nessuno li prevede separatamente |
| Pali, gol annullati dal VAR | **IMPOSSIBILE** | Non esistono in nessuna tabella |
| Rigori concessi alla squadra | **DATO PRESENTE, input debole** | **Corretto il 06/09, §9.3**: non è un'acquisizione mancante. `pen_scored`/`pen_missed` danno **~6,5 rigori per club-stagione** a stagione finita, ma la persistenza t→t+1 è **+0,291** su 187 coppie. Della formula strutturale della nota set-pieces resta fuori la conversione di CARRIERA |
| Campione piccolo (8-12 presenze) | **MODELLATO tre volte** | `MIN_PV_PREV` = 15: sotto quella soglia il core **rifiuta** di prevedere e la cella resta vuota con la ragione scritta. β regredisce verso l'ancora di ruolo. `standing_prior_rounds` = **10** nel pannello, il verdetto più netto dello sweep (euro strict E robust, +2,82%, peggior fold +1,97%, minimo interno). Più la cascata `est_*` con la sua penale di confidenza. E dal 05/09 il prior di chi qui non ha mai giocato è la **mediana della sua popolazione** (K = 5), non zero |
| Severità del redattore | **PARZIALE, e non si chiama così** | Le ancore di ruolo sono **per stagione**, e un backtest le costruisce solo da stagioni ≤ input: una deriva del livello dei voti entra come livello dell'ancora. Quello che NON c'è è un peso di RECENZA su quell'ancora — **R9 è dichiarata in `RULES` e non è mai entrata in `CANDIDATES`**: «con due finestre λ è quasi non identificabile» |

## 8. Regolamento e contesto

| evento | verdetto | numero |
|---|---|---|
| Regolamento della lega | **PER COSTRUZIONE** | `config/scoring_config.json` è parametrico per campionato: nessun +3/−3/+1 cablato, e assist / assist da fermo / rigori segnati / rigori sbagliati hanno voci separate. Il **modificatore difesa** è un input DICHIARATO (sceglie il modulo di riferimento delle buste) e non entra in nessuna previsione: nessuno qui ha misurato cosa paga la media dei tre migliori difensori |
| Nuove direttive arbitrali | **ASSENTE** | Nessun canale, e senza una previsione dei cartellini non avrebbe dove entrare |
| Salto di categoria dalla B | **Denominatore sì, salto no** | `config.FEEDER_LEAGUES` mette la Serie B fra i `CHAMPIONSHIPS`, quindi una quota di stagione si divide per le 38 giornate vere e non per gli undici che abbiamo parsato. Ma niente sconta il SALTO come tale: il canale che lo direbbe è `level_gap` (Elo origine − destinazione) e vale solo per chi CAMBIA CLUB, mentre il neopromosso resta al suo. Quanto vale l'acquisizione dipende da quanto è nuova la rosa: quotati con 5+ presenze da titolare in A in carriera **79% al Cremonese 2025-26 contro 16% al Frosinone 2026-27** |

---

## 9. I tre buchi proposti, e perché nessuno vale uno slot di gate

La prima stesura di questa pagina (mattina del 06/09) chiudeva con tre voci «da aprire». Nel giro di
poche ore tutte e tre sono state ridimensionate, due da misure di un'altra sessione e una da una mia
correzione. **Il fatto che l'elenco degli aperti sia sopravvissuto meno di un pomeriggio è il risultato
più utile di questa pagina**, e la ragione per cui una lista di «cose promettenti» va misurata prima di
essere consegnata.

### 9.1 Il modulo sui difensori — MISURATO, e il segno è al contrario
Era la raccomandazione numero uno: meccanismo forte, dato in casa, zero presenza nel motore. Misurato
(`gate-motore-v1.md` §7-sexquadragies, altra sessione) su chi RESTA nello stesso club, con la forma
modale per (club, stagione) da `club_match_lineups` e almeno dieci distinte complete — **686 forme,
1.449 coppie** su `default`:

    tutti  1.449   r(Δ posti della sua linea, Δ quota presenze) = −0,045
    D        618   r = −0,048   +1 posto −0,0880   −1 posto −0,0013   (35 su / 83 giù)
    C        545   r = −0,017   +1 posto −0,0406   −1 posto −0,0237   (92 / 71)
    A        286   r = −0,083   +1 posto −0,0789   −1 posto −0,0364   (54 / 52)
    null (chi non cambia posti): −0,0242 su 1.062

**Guadagnare un posto nella propria linea si accompagna a giocare MENO**, non più: un difensore il cui
club passa da tre a quattro dietro perde 0,06 di quota IN PIÙ del null. Il meccanismo che spiega il
segno rovesciato è anche quello che uccide la formulazione — un club aggiunge un posto in un reparto
**perché ha comprato lì**, quindi la maglia in più la riempie l'arrivo e chi c'era trova più
concorrenza. La quantità giusta diventa «posti meno pretendenti», che è la famiglia
R11/R11b/R16/R16b/R17, respinta cinque volte su cinque meccanismi diversi. Limiti dichiarati: le celle
che si muovono sono poche, la modale schiaccia chi alterna, la misura è su `default`. È una DIAGNOSTICA
e non un verdetto: dice che non c'è ragione di spendere uno slot di gate su quella forma.

**E la prima versione di quella misura univa i club PER NOME.** `club_match_lineups.club` è la grafia
del provider («AC Milan», e il commento nello schema lo dice) e `match_ratings.team` è quella
dell'Excel dei voti: misurato, **26 grafie su 35** si appaiano, e le non appaiate sono **Milan · Napoli
· Roma** più Chievo, Crotone, Palermo, Pescara, Verona, Carpi — le tre squadre più forti del
campionato. Quinta istanza documentata di questa famiglia. Rifatta con `matching.club_identity` le
coppie passano da 1.097 a **1.449 (+32%)** mentre le forme restano 686 contro 687: mancavano i
GIOCATORI di nove club, non le sagome. **Quello che è sopravvissuto al join sporco è esattamente quello
che CLAUDE.md prevede** — l'aggregato regge (−0,040 → −0,045) e le celle si muovono, coi centrocampisti
che **cambiano segno** (+0,001 → −0,017). La conclusione era vera e poggiava su numeri che non erano
quelli veri.

### 9.2 Le squalifiche — costruibili, con un tetto
Il canale si può costruire: `yellows`/`reds` sono popolate (su `default`, 18.063 gialli e 1.098 rossi su
5.035 stagioni-giocatore con almeno un cartellino). Il tetto è la parte che decide: come squalifiche
attese (rossi + gialli/5) fa **0,65-0,94 giornate per stagione-giocatore** contro un MAE di **6,56**,
cioè **≤14% dell'errore nel caso perfetto**. Resta la più sensata delle tre, sapendo quanto vale.

### 9.3 I rigori per club — il dato c'era, e l'errore è mio
Avevo elencato «tasso di rigori per club» come acquisizione mancante, **citando
`nota-modello-set-pieces-v2.md` invece di interrogare la tabella**. È in `match_ratings` da sempre:
~6,5 rigori per club-stagione a stagione finita (5,97 includendo il 2026-27, che con due giornate legge
0,00 — due sessioni hanno sbagliato lo stesso numero nello stesso modo, per finestre diverse). Quello
che manca non è il dato: è che **si prevede male**, persistenza t→t+1 **+0,291** su 187 coppie (+0,254
su 153 in una finestra più corta). Sesta istanza di «il dato c'era e nessuno lo leggeva» dopo i
campetti, `availability`, l'asterisco del listone, la data di rientro e le partite di Varela — e la
prima commessa citando un documento.

**Una nota di metodo che è valsa la pena**: raggruppare per `match_ratings.team` usa la grafia del
provider e non una chiave canonica, cioè la famiglia di join di §9.1. Controllato prima di allarmare
nessuno: **20 club distinti in ogni stagione e 35 in dodici stagioni**, nessuna grafia doppia, il
conteggio è pulito. *Un allarme verificato che risulta infondato vale più di uno non verificato che
risulta fondato.*

---

## 10. Come è stata fatta, e i sei errori che l'hanno attraversata

La verifica è `cat`/`grep` sui sorgenti più `SELECT` in sola lettura: nessuna scrittura sul DB, sui
rapporti o sull'albero. Tre sessioni lavoravano sullo stesso repository, e le **sei correzioni** fra due
di esse sono tutte la STESSA famiglia — «verifica la FUNZIONE, non la colonna che le somiglia» —
applicata a tre cose diverse, che è la ragione per cui vale la pena elencarle insieme:

| # | cosa si è letto al posto di cosa | costo |
|---|---|---|
| 1 | **il NOME**: un grep sul CAMPO (`.rounds`) mentre il lettore usa l'ACCESSORE (`rounds_for`) | «`evaluate` non legge quel campo» → è falso, `evaluate.py:667` dentro `derive()`, e il docstring di `league_rounds` lo diceva due righe sopra |
| 2 | **la VERSIONE**: l'albero di lavoro letto per rispondere a una domanda sul PASSATO | «il fallback dichiarato dava già 34» → `DECLARED_ROUNDS` non esisteva prima del commit, il default era 38 cablato |
| 3 | **la GRAFIA**: due tabelle che nominano un club con due colonne dal nome diverso (`club` e `team`) | 26 join su 35, persi Milan Roma Napoli (§9.1) |
| 4 | il mtime di un artefatto al posto del suo CONTENUTO | «il rapporto di gate è stato sovrascritto» → il file non ha la chiave `gate`, non poteva essere quello |
| 5 | tre righe di `ingest_runs` al posto dell'artefatto | attribuzione di una corsa alla sessione sbagliata |
| 6 | un DOCUMENTO al posto della tabella | §9.3, i rigori per club |

Le varianti utili, tutte pagate:
- **Quando due tabelle nominano un club con due colonne dal nome diverso, la prima cosa da cercare è il
  RISOLUTORE, non la corrispondenza.** Due nomi diversi fanno sentire che si stanno unendo due cose e
  non due grafie della stessa cosa.
- **La lista dei lettori di un campo si prende con un grep che include il motore, e se il docstring
  della funzione ne nomina uno, quello va nella lista prima di ogni ragionamento.**
- **Per rispondere a «com'era prima», si legge la versione di prima** (`git show <sha>:<file>`), non
  l'albero di lavoro.
- **Un'inerzia si dichiara con le condizioni che la reggono.** «Il cambio A non muove il gate» è vero
  ma condizionale: `league_rounds` È nel percorso del gate (`derive` → `rounds_for`), e lo zero poggia
  su due fatti che possono cambiare tutt'e due — **R3 è l'unica adottata che legge quella quantità ed è
  solo su `default`, e il listone `default` è monolingua** (2018-19: 641 righe, tutte `serie_a`; su
  euro i tedeschi ci sono, 79, ma là c'è R3c che legge un altro campo). Scritto come «lo zero è
  strutturale», il prossimo lettore si sentirebbe autorizzato a toccare `league_rounds` senza gate.
