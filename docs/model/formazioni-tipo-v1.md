# Formazioni tipo — come il pannello decide modulo e undici (v1)

*Consolidato l'08/08/2026 dalla sessione «formazioni tipo contro i giornalisti». Fonte di verità: il
codice (`toolkit/euroleghe_ingest/gui.py`, `engine/presence.py`, `modules/snapshot.py`); questo
documento ne fissa le formule, le costanti e i dati letti, con i riferimenti alle sezioni della spec
dove ogni scelta è stata pagata. Le righe di codice citate valgono alla data del consolidamento.*

La «formazione tipo» del pannello Snapshot è la risposta a TRE domande separate, ciascuna con la sua
funzione e il suo numero. Mischiarle è il difetto tornato tre volte (spec v9.16):

1. **QUALE MODULO** → `board_shape` / `shape_odds` (gui.py ~3586-3658)
2. **CHI gioca** → `claim`, cioè `presence.standing` (engine/presence.py) + la selezione di `eleven()`
3. **DOVE sta ciascuno** → `_assign`/`_slot_price` (ungherese) + la cascata `_reshape`

Nulla di tutto questo è gated: sono stime di DISPLAY per l'operatore. Il motore (`engine_*`) non le
legge; un parametro adottato in `presence.py` muove i FOGLI e le board, mai `backtest --verify`.

---

## 1. QUALE MODULO: `shape_odds` e `board_shape`

**Il disegno parte da `board_shape`, non dalla colonna `formation_typical`** del foglio (che è la sola
forma MISURATA del club: la moda degli undici completi della stagione di input). L'audit che confuse le
due cose costò un pomeriggio: «si verifica la FUNZIONE, non la colonna che le somiglia» (v9.38).

`shape_odds(club, info, mode)` mescola QUATTRO fonti, nessuna sufficiente da sola:

```
own          = formation_shapes del club          (clubs.csv, es. "3-4-3:43;4-4-2:2;4-3-3:1")
played       = somma degli undici osservati
his          = formation_typical_under_coach / played     # quota del campione che è dell'allenatore ATTUALE
trust        = 0.40 + 0.50 · clamp(his, 0, 1)             # SHAPE_TRUST_FLOOR / SHAPE_TRUST_RANGE
coach_share, sample = coach_shapes                        # il repertorio dell'UOMO, tutte le panchine
mine         = 0                        se sample < 20    # COACH_SHAPE_MIN
               min(1, (sample-20)/40)   altrimenti        # rampa fino a COACH_SHAPE_FULL = 60
scores[s]    = shape_matchdays(club, s, mode)             # quanto "vale" l'undici che quella forma schiera
                                                          # = somma dei claim degli undici scelti per s
per ogni forma s candidata:
  generic    = mine · coach_share[s] + (1-mine) · league_share[s]
  prior      = trust · own[s]/played + (1-trust) · generic
  weight[s]  = prior · exp((scores[s] - best) / 0.60)     # SHAPE_FIT_SCALE: due giornate sono decisive
odds         = weight normalizzati
```

- **club** = l'abitudine, il segnale più forte (`formation_shapes`);
- **allenatore** = `coach_shapes`/`coach_shapes_of`: il suo repertorio ovunque sia stato, contato su
  `coaches` × `club_match_lineups` risolti per CHIAVE CANONICA (v9.38: il join per nome perdeva il 26%
  degli undici e faceva disegnare il predecessore proprio ai club con l'allenatore nuovo). Entra AL
  POSTO della lega, pesato dal suo stesso campione;
- **lega** = `manifest.formation_repertoire` (cosa farebbe «una squadra qualsiasi» qui);
- **rosa** = `shape_matchdays`: una forma i cui posti obbligano in campo un uomo al 5% non è una forma
  che un allenatore sceglie. NB: è il valore dell'UNDICI SCELTO, non il costo dei posti della forma —
  il costo-posti fu provato e ANNULLATO (spostava 13 board su 108 e disfaceva decisioni già prese).

Scorciatoie, in ordine: `mode == "next"` con `formation_today` (le probabili dichiarate) → quella al
100%; la scelta manuale dell'operatore (`_shape_choice`) batte la stima; senza odds → `_formation`
(precedenza: `formation_next_fielded` → `formation_today` → `formation_typical` → derivata dalle medie
di linea, default 4-3-3).

**Il selettore porta DUE numeri, e non rispondono alla stessa domanda** (08/08/2026, richiesta
dell'operatore). La percentuale dice quanto è probabile che il club schieri quella forma; **`SUR` dice
il surplus MEDIO degli undici che quella forma mette in campo** (`eleven_surplus`), cioè quanto vale
la squadra che ne esce — e la forma probabile può schierare l'undici più povero, che è esattamente
ciò che serve vedere prima di puntare: Como 4-5-1 al 77% con ~17.3 contro il 4-4-2 al 3% con 18.3
(il caso Paz, §6.1, visto dal pannello); Inter 3-5-2 al 95% e anche il più ricco (25.3). Le odds
leggono i CLAIM (`shape_matchdays`), questo legge la VALUTAZIONE: sono due assi e il pannello non li
mescola. Tre regole nel numero: la media e non la somma (ogni forma schiera undici uomini, una somma
cambierebbe solo l'unità); **un surplus mancante è ignoto e non zero**, quindi la media è sugli
uomini che ne hanno uno e il conteggio la accompagna (`(9/11)`); `~` quando almeno uno degli undici
porta la STIMA (`est_surplus`) invece della valutazione gated — Frosinone è tutto `~`. `row_surplus`
è UNA definizione, letta dalla cella del foglio, dal suo tooltip e dal selettore.

**Costanti** (tutte ClassVar di `SnapshotView`, tutte display-only):

| costante | valore | significato |
|---|---|---|
| `SHAPE_TRUST_FLOOR` | 0.40 | fiducia nel club quando 0% del campione è dell'allenatore attuale |
| `SHAPE_TRUST_RANGE` | 0.50 | → 0.90 quando il campione è tutto suo |
| `COACH_SHAPE_MIN` | 20 | sotto, il repertorio dell'allenatore non pesa (con n=2 la moda è rumore) |
| `COACH_SHAPE_FULL` | 60 | da qui sostituisce interamente la quota di lega |
| `SHAPE_FIT_SCALE` | 0.60 | giornate di differenza che dimezzano le odds di una forma |
| `LEAGUE_SHAPE_FLOOR` | 0.01 | sotto questa quota di lega una forma è un artefatto di parsing |

⚠️ `COACH_SHAPE_MIN`/`FULL` = 20/60 furono tarati sui campioni ROTTI dal join per nome (v9.38): la
ragione della soglia regge, i valori vanno rimisurati contro una referenza esterna sulla stagione che
si asta — che è esattamente il confronto con i giornalisti di questa sessione.

**Vocabolario del provider.** Le forme sono contate nel vocabolario del provider, dove un'ala è un
centrocampista: un 4-3-3 con due ali si legge **4-5-1**, e il 3-4-2-1 della stampa è il nostro 3-4-3
disegnato con due trequartisti. Il confronto con un modulo pubblicato passa per il **picture** che
`lanes_for` restituisce dopo `_reshape` (es. board 3-4-3 → drawn 3-4-2-1), mai per la stringa cruda.

## 2. CHI GIOCA: il claim

`claim(row, horizon)` = «se tutti fossero sani, chi parte titolare?» — per definizione SENZA lo sconto
disponibilità (`availability` taglia `presence`, non il claim). Un uomo che `desc_left_for` dice
altrove ha claim 0. Due orizzonti:

- **season** (formazione tipo) → `presence.standing`:
  ```
  starts_rate  = min(starts · w / rounds, 1)
  minutes_rate = min(minutes · w / (rounds · 90), 1)
  measured     = 0·starts_rate + 1·minutes_rate            # standing_weights (0,1): MISURATO, i MINUTI
  lift         = investment + quality + level + level_gap + career   # adottati: level 0.06, level_gap 0.06
  standing     = clamp( shrink(measured) + lift )
  shrink(x)    = share·x + (1-share)·prior,  share = rounds/(rounds+10)   # standing_prior_rounds = 10
  ```
  Il prior e i quattro z-score (fm, career, level, level_gap) sono statistiche della POPOLAZIONE =
  l'intero foglio (`population()`), mai il club a schermo (il difetto dell'08/08: la prima squadra
  aperta fissava le medie di tutte). Il ramo «finestra» (nessuna stagione qui: `window_standing`, che
  il pannello mette a 1.0) è shrinkato sulle SUE partite come ogni campione corto, e prende i lift
  d'arrivo. Il pesare i minuti e non gli start, il decay infortuni (1.0/0.6/0.35), gli sconti
  prestito/arrivo (0.60/0.80) e il resto dei `Params` stanno in `presence.py` e sotto il gate/sweep
  (`gate-motore-v1.md` §7-ter e seguenti).
- **recent** (prossima giornata) → `presence(row, "recent")`: la `desc_starter_prob` degli editor
  vince secca; altrimenti `rate = (form_starts + 3·base)/(form_measured + 3)` e
  `0.60·rate + 0.40·base` (`FORM_WEIGHT`, `RECENT_PRIOR`).

`eleven(club, formation, mode)` poi: bucket per linea su TUTTI i codici reali (T→A, C→M); ordina per
claim; riempie linea per linea con prestiti tra linee (`can_lend`: solo dalla panchina, mai scoprendo
l'altra fascia); tre override di mestiere limitati a `FLANK_OVERRIDE_GAP` = 0.40 (`_flanked`: una
fascia la contendono tutti quelli che la giocano; `_fronted`: un posto davanti è di un attaccante;
`_pointed`: un posto centrale vuole un centrale). **E una fascia posseduta INTERA è un mestiere D/M**
(`_wing_back_trade`, 08/08/2026, «Malen dovrebbe giocare come Pc e non come centrocampista
esterno»): dove la linea difensiva non ha fasce proprie (difesa a 3 — a 5 le ha), le fasce del
centrocampo sono da esterno a tutta fascia e un attaccante puro (soli codici d'attacco) non le
contende alla selezione — Roma dava la destra del 3-4-2-1 a Malen (`RW;ST`, 0.391) invece che a
Rensch (`DR;MR`, 0.363) per 0.03 di claim. Davanti a una difesa a 4 le ali restano candidate (il
caso Bologna/Orsolini che generò `_flanked` non si tocca), e la regola 3 di `_reshape` copre ancora
l'emergenza di una fascia SVUOTATA. Effetto misurato: 3 board su 20 si muovono, tutte verso la
stampa sui nomi (Roma Rensch per Malen, che torna rivale del Pc; **Juventus 11/11** con Thuram K.
per Celik; Monza recupera Pessina).

## 3. DOVE STA CIASCUNO: il fit

Un'assegnazione UNICA (ungherese in casa, `_matching`) su tutti i posti del modulo, perché ogni
priorità greedy sbaglia un caso (v9.16). Il prezzo di un posto (`_slot_price`):

```
prezzo(codice) = 40·|REAL_ROLE_DEPTH[codice] − LANE_DEPTH[linea]|
               + 2·SIDE_WEIGHT[linea]·|REAL_ROLE_SIDE[codice] − lato_voluto|
               + 1 se non è il PRIMO codice                    # mezzo passo di spareggio
prezzo(riga)   = min sui codici + 4 se ST su fascia del tridente + 2·_off_the_front
```

- `SIDE_WEIGHT` = P 3, **D 8, M 8** (la fascia È un mestiere), **T 3, A 3** (i tre davanti si
  scambiano). Un peso unico fu provato: ogni valore rompeva un caso per aggiustarne un altro.
- `REAL_ROLE_DEPTH`: GK 0 · DL/DC/DR 0.25 · DM 0.45 · ML/MC/MR 0.60 · AM/LW/RW 0.80 · ST 1.0;
  `LANE_DEPTH`: P 0 · D 0.25 · M 0.60 · T 0.80 · A 0.90. Una linea intera = 7 (`LINE_REACH`), che è
  anche quanto paga chi non gioca NESSUNA linea d'attacco per un posto là davanti (`_off_the_front` —
  un costo, mai un veto).
- La heatmap NON pesa nel fit (`HEATMAP_SIDE`/`DEPTH` = 0, misurato su griglia pre-registrata: l'asse
  profondità satura davanti — mediana avg_x: terzino 47, mediano 51, ala 61, PUNTA 62 — e l'asse
  fascia non aggiunge nulla perché i codici già lo dicono). Dove la misura batte il codice (97.9% vs
  93.9% sul nominare una fascia) è già letta: `lateral`, il badge, `across_bucket`.
- `_settle` ripara solo in termini di Pareto (mai un fit peggiore; a pari fit serve `CLAIM_MARGIN` =
  0.05 di claim), max `SETTLE_ROUNDS` = 6.
- `_reshape`, la trasformazione alle regole dell'operatore (cinque + una, v9.17): nessuno gioca a due
  linee da casa; una fascia la copre un esterno (difesa esente: braccetti); una fascia di centrocampo
  svuotata la copre l'attaccante esterno che arretra; la linea d'attacco è degli attaccanti e
  assottigliata tiene le punte centrali; il centrocampo è 5 al massimo; un posto centrale davanti non
  lo tiene chi non ha un codice centrale. Più il vocabolario: le fasce vanno in coppia (Ed⇔Es), una
  punta centrale non diventa ala, una riga tocca entrambe le touchline o nessuna.
- Chi viene spostato da `_reshape` è registrato (`_reshaped`): `lanes_for` non gli rilegge la corsia
  dai codici — il «secondo parere non prezzato» che disfaceva la decisione prezzata è il difetto
  fondante di tutta questa famiglia.

## 4. I DATI: chi produce cosa, chi lo legge

| produttore (build, snapshot.py) | tabella/e | colonna del foglio | lettore (board) |
|---|---|---|---|
| `typical_formation` | `club_match_lineups` (11 titolari, somma linee = 11) | `formation_typical(_share/_of/_basis/_under_coach)`, `formation_shapes` | prior del club in `shape_odds` |
| `league_repertoire` | `club_match_lineups` (tutta la stagione) | `manifest.formation_repertoire` | quota di lega |
| `coach_repertoires` | `coaches` × `club_match_lineups` via `club_index` | `coach_shapes(_of)` | repertorio allenatore |
| `club_context` | `coaches`, `probable_starter`, `club_elo`, `arrivals`, `flags` | `coach`, `new_coach`, `formation_today`, `formation_next_fielded`, `lines_fielded_*`, `league_XIs` | scorciatoie e denominatori |
| righe giocatore | `external_stats`, `external_match_stats`, `player_roles`, `positions`, `probable_starter`, `injuries`, `rosters`+`listone_quotes`, `transfers_history`, `squad_snapshot`, `club_levels` | `desc_*` (starts, minuti, codici reali, infortuni, arrivi, livelli, `desc_left_for`…) | claim e fit |

Fatti per-GIORNO che non si backfillano: `desc_real_roles` (il provider ignora `seasonId`),
`desc_starter_prob` (con la sua STAGIONE, v9.32), la rosa live (`squad_snapshot`, quattro fonti,
guardia `SQUAD_COMPLETENESS` 0.90). E `press_formations` (§5-bis), che è per-GIORNO per la stessa
ragione e sta fuori da questa tabella per una diversa: **nessuno la legge**, è il giudice.

**Un uomo può avere l'aggregato d'ingresso vuoto perché il PERIMETRO del listone è cambiato**
(08/08/2026). Le righe giocatore vengono da `external_stats`, e l'identità che le attribuisce si
risolve contro i pool del roster DI QUELLA STAGIONE: un uomo comprato dentro il perimetro
quest'anno non è in nessun pool dell'anno che ha davvero giocato — 59 uomini del listone 2026-27
avevano ZERO aggregato 2025-26 col provider id già in `player_xref`, quindi start e minuti mancanti
invece che misurati, quindi claim vuoto (Doekhi, Geubbels, entrambi titolari per la stampa). Curato
con un quarto pass sull'identità già nota, che è l'evidenza più debole e **non decide mai
un'identità**; e `player_xref.resolved_by` dice chi ha stabilito una mappatura, perché tre moduli
ci scrivono con evidenze diverse e uno solo cancella. Dettagli e numeri: todolist voce 2.

**...e può averlo vuoto perché il suo CAMPIONATO non era in tabella.** Un campionato d'ORIGINE
(`config.FEEDER_LEAGUES`: oggi la Serie B) non è in scope — nessun listone lo quota — ed è un
campionato vero, quindi la sua stagione va acquisita e conta come campionato dove la domanda è «è una
partita di campionato?» (`config.CHAMPIONSHIPS`, che è il denominatore di ogni quota di stagione:
38 giornate di B, non i 24 undici che abbiamo parsato). Per un feeder l'identità si risolve contro il
roster della stagione **DOPO** — nessuno sta in un listone mentre ci gioca. Frosinone da 4/11 a
10/11 contro la stampa; todolist voce 1, e il suo rovescio (il salto di livello) è la 1-bis.

**Il perimetro del foglio** (chi può comparire): dal 08/08/2026 (`SHEET_REVISION` 10) è **il listone
della stagione bersaglio** (`listone_quotes`, contingente ≥ 11), con i ratings come ripiego per le
finestre senza backfill. Letto dai soli ratings era vecchio di una stagione su ogni foglio di
preseason: il 2026-27 teneva 94 righe di Cremonese/Pisa/Verona retrocesse e scartava in silenzio i
74 quotati di Frosinone/Monza/Venezia — tre club interi senza righe e senza board.

## 5. Verifiche, e le referenze esterne

- **Invarianti**: 394 board (ogni club × ogni forma del repertorio × due modalità × due fogli):
  0 righe oltre il massimo, 0 codici di fascia spaiati, 0 righe sbilenche; test nominati in
  `test_snapshot.py` (simmetria, coppie di fascia, tetto a 5, fasce contese, fronte agli attaccanti).
- **Referenza mid-25/26** (SOS Fanta, formazioni tipo della stessa finestra): 83% degli uomini
  (183/220), 16/20 conteggi di linea.
- **Referenza 26/27** (pazzidifanta 03/08, previsione sulla stagione che si asta): 9/17 moduli, il
  giudice con cui `coach_shapes` fu adottato (8/17 → 9/17, Atalanta e Napoli corretti).
- **Referenza 26/27 della stampa, 08/08/2026** (fantacalcio.it, DAZN, SOS Fanta, fantamaster,
  pazzidifanta, goal.com — 4-5 fonti per club, tutte del 3-7 agosto): **moduli 10/20 uguali +
  4/20 sull'alternativa che la stampa stessa dichiara, 6 divergenti; uomini 164/220 = 75%**.
  ⚠️ Questi sono i numeri dell'harness `press` sul foglio corrente. La prima stesura di questa nota
  citava «10 + 5 + 5, 159/220», che era uno stato di metà sessione le cui board non furono salvate:
  l'archivio di quel giorno (`data/reports/press-formations-2026-08-08/`) ne dà 9/5/6 e 160/220, e
  il +1 sugli uomini è Doekhi, entrato nell'undici della Lazio col recupero degli aggregati
  (todolist voce 2). **Da qui in poi la referenza è un DATO e il confronto un comando**
  (`press --import` / `press --sheet`, §5-bis): un numero di questa riga si cita dal report, mai a
  memoria.
  I sei moduli divergenti, ciascuno con la sua causa: Como e Lecce (il 4-2-3-1 della stampa È il
  nostro 4-5-1 nel vocabolario del provider, e al Como la selezione lascia comunque fuori Paz —
  sotto), Juventus e Napoli (il repertorio misurato dell'allenatore contro l'annuncio tattico del
  ritiro: Spalletti 3-4-3 misurato alla Juve vs 4-2-3-1 atteso, Allegri 3-5-2 di carriera vs 4-3-3
  atteso), Milan (3-4-3 vs 3-4-2-1, vocabolario) e Bologna. Dove l'XI diverge di più la causa è il
  DATO, non il disegno — ed è la causa che nella sessione dell'08/08 si è mossa: Frosinone **10/11**
  (era 4/11: mancava il campionato d'origine, voce 1), Lazio **5/11** (era 4/11: transfers e identità
  degli arrivi, voce 2), e restano a 6-8/11 i club di mercato estivo pesante, con arrivi di storia
  sottile o straniera (Cagliari, Parma, Fiorentina, Venezia).

## 5-bis. Il giudice è un comando, non uno script (modulo `press`, 08/08/2026)

La referenza stampa e il confronto vivevano in script di scratchpad e JSON copiati a mano; ora sono
un modulo del toolkit — voce 0 della todolist, e la condizione perché le voci 3, 4 e 5 si possano
decidere «contro la stampa» due volte di seguito con lo stesso metro.

```
press --import FILE --season 2026-27 [--observed-on YYYY-MM-DD] [--source NAME]
press                                   # rigioca gli archivi (offline; è quello che fa rebuild)
press --sheet data/reports/auction-snapshot-...    # giudica le board di quel foglio
```

- **`press_formations`** = un fatto per-GIORNO come `probable_starter` (`club, season, observed_on,
  source` in chiave), mai backfillabile; ogni import è archiviato in `data/raw/press/` e `rebuild`
  lo rigioca, così il DB resta ricostruibile dai raw. **È un GIUDICE, mai un input**: nessuna
  funzione del motore o del pannello lo legge, e leggerlo dentro il claim renderebbe circolare
  proprio il confronto che lo usa.
- **L'estrazione guida il PANNELLO VERO**: `SnapshotView.load_sheet` — l'unico loader, estratto da
  `load_selected` proprio perché una seconda copia della lista di cache sarebbe una seconda
  popolazione (il difetto dell'08/08 preso alla radice) — e poi `board_shape`/`eleven`/`lanes_for`,
  mai le colonne che le somigliano.
- **Verdetto sul PICTURE disegnato** (§1: il vocabolario del provider), tre classi: `MATCH` = il
  modulo della stampa, `ALT` = una delle alternative che la stampa stessa dichiara (il qualificatore
  fra parentesi non conta: si legge il primo token), `DIFF` = nessuno dei due. Club uniti per
  `club_identity`, uomini per token di cognome, e un club senza board è `NO BOARD` nel report e nel
  sommario — non un buco silenzioso.
- Report: `data/reports/press_comparison.json`. Un test blocca la riproduzione del confronto
  archiviato dell'08/08 (9/5/6, 160/220).

## 6. Tre cose che il confronto dell'08/08/2026 ha esposto

1. **Un trequartista di claim massimo può cadere tra le linee.** Como: Paz N. ha il claim più alto
   della rosa (0.753, 33 start) e NON è nell'undici disegnato. Il suo primo codice (AM) lo mette nel
   pool d'ATTACCO; il 4-5-1 (che è il 4-2-3-1 di Fàbregas nel vocabolario del provider) ha UN posto
   davanti e `_fronted` lo dà alla punta (Douvikas, gap 0.155 < 0.40, la regola «un posto davanti è
   di un attaccante» funziona come scritto); non essendoci una riga di trequarti, l'uomo migliore
   della squadra resta fuori mentre un terzino a claim-prior 0.562 gioca esterno di centrocampo.
   Stessa famiglia del «Touré a 0.00» che generò `_flanked`, ma sul TREQUARTISTA: la domanda del
   claim va posta anche quando la selezione decide se una riga a 5 si spezza in 2+3 (`_two_rows`
   arriva DOPO la selezione, e a quel punto Paz è già fuori). Da decidere con una misura, non
   inline: è il prossimo caso per la famiglia di regole della selezione.
2. **Per un club promosso il claim era rumore — perché il suo campionato non era in tabella.**
   Frosinone: XI disegnato con claim 0.07-0.43, 4/11 contro la stampa. `club_match_lineups` copriva
   la Serie B (quindi modulo e repertorio allenatore c'erano — il MODULO infatti era giusto), ma
   `external_stats` non aveva il campionato: starts e minuti **mancanti, non misurati**. Chiuso lo
   stesso giorno acquisendo la Serie B come campionato d'ORIGINE (todolist voce 1): **4/11 → 10/11**,
   e i tre promossi passano da 2/3/5 a 22/17/21 uomini con un aggregato. Tre cose che restano come
   regole: un feeder non è un campionato in scope ma è un campionato vero (`config.FEEDER_LEAGUES`,
   e `CHAMPIONSHIPS` dove la domanda è «è una partita di campionato?»); **per un feeder il pool
   d'identità è quello della stagione DOPO**, perché nessuno sta in un listone mentre ci gioca; e
   derivare l'aggregato dal per-partita sarebbe stato peggio del vuoto (97 partite su 380: direbbe
   «ha giocato un terzo della stagione» di chi l'ha giocata tutta). Il rovescio della medaglia — 34
   start in B non sono 34 in A, e il canale che lo direbbe non raggiunge chi non ha cambiato club di
   listone — è misurato e messo in coda come voce 1-bis, non risolto inline: cambia la popolazione
   di un canale adottato, quindi vuole lo sweep.
3. **Un mercato pesante svuota l'undici anche a dati freschi — ma la metà era il DATO, e si è
   mossa.** Lazio 4/11: tre titolari attesi sono arrivi di luglio con storia altrove (Doekhi,
   Pedraza, Taylor), la stagione di input era anomala (Rovella 6 start da infortunio, il portiere
   titolare è partito), e i trasferimenti arrivavano datati 01/07 con 4.422 nomi irrisolti — Molina
   N. senza NESSUNA riga transfer pur avendo l'identità. Chiuso lo stesso giorno (todolist voce 2):
   irrisolti 4.422 → 2.508 leggendo la chiave canonica che il parser buttava, l'affare doppio fra due
   club del perimetro fuso in una riga, `first_seen` per la freschezza — **e il collo di bottiglia
   vero, che era un'altra tabella**: 59 uomini del listone 2026-27 senza aggregato d'ingresso perché
   il perimetro del listone cambia ogni estate e il funnel identità risolve contro i pool della
   stagione (`external_stats` +5.238 righe). Lazio **4/11 → 5/11**, Doekhi entra con 34 start e 3060
   minuti misurati. Ciò che resta è davvero il modello: i canali d'arrivo adottati (level,
   level_gap) su uomini la cui storia sta altrove.

## 6-bis. Una regola misurata, implementata e REFUTATA: la co-titolarità (08/08/2026)

Vale la pena di stare qui perché è il ciclo completo, e perché il dato è rimasto.
**L'ipotesi** (operatore): «Scamacca e Krstovic giocheranno entrambi ma non contemporaneamente».
**La misura le dà ragione sulla coppia e torto sul ruolo**: 2 co-start di 15/18 sulle 35 partite in
cui erano entrambi disponibili (**0.13**) contro Lautaro Martinez e Thuram a **0.58**. Con i due
ancoraggi sulla stessa scala, «mai due Pc» è falso e «due che non coesistono» è misurabile.
**Il denominatore È la misura**: contata su tutte le partite, ogni coppia separata da un
trasferimento legge 0.00 — 35 coppie sembravano «non coesistono» e 32 non avevano mai condiviso una
rosa. Con le sole partite in cui entrambi erano in rosa restano 198 coppie e **3 sotto 0.25**.
**Dove va la regola**: non alla selezione. Il pool d'attacco dell'Atalanta è guidato da Zalewski e
Pasalic (centrocampisti con codice `AM`) ed è `_fronted` a metterci le punte — una regola sulla
COPPIA deve vedere la coppia, quindi è il quarto override di mestiere.
**Il verdetto**: uomini **164 → 162**, Atalanta **7/11 → 6/11**, modulo da ALT a DIFF. **La stampa
schiera Scamacca**, cioè l'uomo che la regola toglieva: scarta il claim più basso (0.468 vs 0.490) e
sull'unico caso per cui esiste sbaglia metà. Ritirata (v9.16).
**Cosa resta**: `desc_costart_low` sul foglio, e la domanda vera scritta — serve un segnale su QUALE
dei due ruotanti comanda, e il claim non lo è, perché in una rotazione i minuti sono quasi pari per
costruzione.

## 7. Limiti dichiarati

- `formation_typical` è la stagione di INPUT: per un allenatore nuovo descrive il predecessore, e lo
  dice (`formation_typical_basis`); è `coach_shapes` a correggere il disegno, quando il campione regge.
- **Un'identità che nessun pool per nome può ristabilire non è ritrattabile da `positions`** e resta
  finché un claim per nome non la contraddice: `resolved_by` protegge chi l'ha stabilita, ma le righe
  precedenti la colonna sono `unknown` e nessuno le ritratta (§4). È il prezzo scelto — meglio di
  cancellare un'identità pagata da un altro modulo — ed è dichiarato, non nascosto.
- I club PROMOSSI hanno la Serie B in `club_match_lineups` e ora anche in `external_stats` (voce 1),
  ma `formation_shapes` può essere di due stagioni fa (l'ultima in A) e nulla sconta il salto di
  livello di chi ha giocato in B: il claim dice chi parte titolare, non contro chi (voce 1-bis).
- `COACH_SHAPE_MIN`/`FULL` da ritarare (sopra). `PREVIOUS_COACH_WEIGHT` = 0.25 nel conteggio di club.
- Il claim di preseason non legge le amichevoli (misurato e NON adottato, cinque ragioni in v9.17 §6;
  pre-registrato per giugno 2027).
- Le probabili estive degli editor sono della stagione finita finché la nuova non parte (v9.32): i
  lettori filtrano sulla stagione, quindi in agosto `desc_starter_prob` è vuota per costruzione.
