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

Una QUINTA fonte è stata scritta e **non adottata**: le forme del RITIRO (`friendly_shapes`, la
stagione bersaglio, 1-3 undici per club — copertura verificata prima di scrivere il codice). Griglia
pre-registrata 0/0.15/0.30/0.45/0.60: i moduli esatti non migliorano a nessun peso e gli uomini
scendono da 166 a 163, quindi `PRESEASON_WEIGHT` = 0 come `HEATMAP_*`. Il dato resta sul foglio, e
la ragione è che una forma da ritiro è scelta contro avversari fuori campionato e con una rosa non
ancora chiusa (todolist voce 5). Rifiutato anche il SUR come discrimine di modulo: sceglierebbe
4 MATCH / 3 ALT / 13 DIFF contro 11/5/4 (voce 5-bis).

Scorciatoie, in ordine: `mode == "next"` con `formation_today` (le probabili dichiarate) → quella al
100%; la scelta manuale dell'operatore (`_shape_choice`) batte la stima; senza odds → `_formation`
(precedenza: `formation_next_fielded` → `formation_today` → `formation_typical` → derivata dalle medie
di linea, default 4-3-3).

**Il giudizio dell'operatore è un FATTO PERSISTENTE, non una preferenza di sessione**
(`config/board_rulings.json`, 08/08/2026). Una scelta in modalità `typical` è un giudizio sulla rosa di
quella stagione («il Napoli di Allegri gioca a 4-3-3»), quindi si salva come `{stagione: {club:
{shape, decided_on}}}` — stessa specie di `league_config.json`: una dichiarazione dell'operatore, non
una misura nostra. Tre proprietà, ciascuna la risposta a un modo di marcire:

- **torna solo per la SUA stagione, e joina i club per IDENTITÀ** (`club_identity`), mai per la
  stringa scritta nel file — il join per nome perse Milan, Roma e Napoli una volta;
- **si REVOCA**: la voce «auto · the odds decide» del selettore lo toglie dal file invece di coprirlo,
  ed è offerta solo dove c'è un giudizio da revocare. Senza, un giudizio sbagliato si potrebbe soltanto
  sostituire con un altro. Una forma uscita dalle odds plausibili smette di applicarsi da sola;
- **i due giudici non lo vedono MAI**: `press.extract_boards` carica con `apply_rulings=False`. Un
  giudizio è spesso preso GUARDANDO la stampa, e un giudice non può valutare le risposte
  dell'operatore — è la stessa circolarità di «la stampa è un GIUDICE, mai un input» (§5-bis).
  Una scelta in modalità `next` riguarda UNA giornata e resta volatile per costruzione.

**Perché esiste, ed è la lezione**: quando un operatore ha ragione con indizi che il modello non può
raggiungere, la terza via non è né adottare un canale contro il giudice né lasciare la board sbagliata.
Il caso fondante è il Napoli 2026-27 (§6-ter).

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

✅ `COACH_SHAPE_MIN`/`FULL` = 20/60 furono tarati sui campioni ROTTI dal join per nome (v9.38), e
sono stati **rimisurati contro la referenza esterna** (todolist voce 4) su griglia pre-registrata,
MIN ∈ (10,15,20,30,40) × span ∈ (20,40,60): **il verdetto è piatto** — ogni cella da 10/50 a 40/80
dà lo stesso 11 MATCH / 5 ALT / 4 DIFF, e solo gli estremi si muovono (10/30 perde un ALT, 40/100 un
MATCH). 20/60 sta in mezzo al plateau, il giudice interno diceva «tenere o alzare»: due misure
indipendenti, nessuna chiede di spostarle, la questione è **chiusa**.

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
- **...e per una linea d'attacco di UNO la domanda è più severa** (`_off_the_front(..., lone=True)`,
  08/08/2026): «nel 4-5-1 o 4-2-3-1 lì davanti ci vuole una Pc, o al massimo una A». Un tridente si
  scambia i posti, quindi un'ala ne tiene uno di diritto; una linea di uno non ha fascia con cui
  scambiarsi. Chi non «guida la linea» (`_leads_the_line`: `ST` fra i codici, oppure la A del listone
  per chi non ha codici osservati — un'ala CODIFICATA è A di listone e non è una punta, «Neres non è
  una Sp») paga la linea intera anche lì. Il caso: Bologna schierava Odgaard (`AM;RW`, 0.429) invece di
  Dovbyk (`ST`, 0.382) e nessuna guardia poteva obiettare — `RW` lo rendeva uomo d'attacco per
  `_fronted`, `AM` uomo centrale per `_pointed`. **Sta dentro l'UNICA definizione** e non in una
  guardia nuova: il primo tentativo era una guardia alla sola selezione, e `_settle` — che prezza i
  posti senza conoscerla — la aggirava RICOLLOCANDO la punta a centrocampo. Costo: 1 board su 57, due
  giudici identici prima e dopo, 394 invarianti verdi.
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
  pazzidifanta, goal.com — 4-5 fonti per club, tutte del 3-7 agosto): **moduli 11/20 uguali +
  5/20 sull'alternativa che la stampa stessa dichiara, 4 divergenti; uomini 166/220 = 75%**.
  ⚠️ Questi sono i numeri dell'harness `press` sul foglio corrente. La prima stesura di questa nota
  citava «10 + 5 + 5, 159/220», che era uno stato di metà sessione le cui board non furono salvate:
  l'archivio di quel giorno (`data/reports/press-formations-2026-08-08/`) ne dà 9/5/6 e 160/220, e
  il +1 sugli uomini è Doekhi, entrato nell'undici della Lazio col recupero degli aggregati
  (todolist voce 2). **Da qui in poi la referenza è un DATO e il confronto un comando**
  (`press --import` / `press --sheet`, §5-bis): un numero di questa riga si cita dal report, mai a
  memoria.
  **I quattro moduli divergenti rimasti**, ciascuno con la sua causa: Juventus e Napoli (il
  repertorio misurato dell'allenatore contro l'annuncio tattico del ritiro: Spalletti 3-4-3 misurato
  alla Juve vs 4-2-3-1 atteso, Allegri 3-5-2 di carriera vs 4-3-3 atteso — e le forme del ritiro
  sono state misurate come quinta fonte e NON pagano, todolist voce 5), Lecce (4-5-1 vs 4-2-3-1) e
  Milan (3-4-3 vs 3-4-2-1), entrambi in parte vocabolario. Como e Bologna erano qui e ne sono usciti
  con la voce 3. Dove l'XI diverge di più la causa è il DATO, non il disegno — ed è la causa che
  nella sessione dell'08/08 si è mossa: Frosinone **10/11** (era 4/11: mancava il campionato
  d'origine, voce 1), Lazio **5/11** (era 4/11: transfers e identità degli arrivi, voce 2), e restano
  a 6-8/11 i club di mercato estivo pesante (Cagliari, Parma, Fiorentina, Venezia).

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

## 5-ter. IL SECONDO GIUDICE: le board contro l'esito, e il suo null (08/08/2026)

Richiesta dell'operatore: «provare sulla passata stagione i criteri attuali per individuare gli 11
titolari tipo, e verificare quanto erano corretti». È il giudice più forte che abbiamo — non è
l'opinione di nessuno — e vive solo per una stagione già giocata:

```
snapshot --season 2025-26 --date 2025-08-15      # il foglio come sarebbe stato al giorno d'asta
press --sheet <quel foglio> --against outcome    # giudicato su cosa i club hanno FATTO
```

`outcome_reference` costruisce per club la **forma modale** degli undici completi della stagione e i
suoi **undici uomini più schierati** (campionato solo, come ogni quota di stagione qui).

**Risultato (Serie A, board del 15/08/2025 contro l'esito 2025-26)**:

| | moduli | uomini |
|---|---|---|
| **BOARD** | **13** MATCH / 1 ALT / 6 DIFF | **134/220 (61%)** |
| NULL (gli stessi dell'anno prima) | 9 MATCH / 2 ALT / 6 DIFF | 104/220 (47%) |

La board batte la baseline su **entrambi** gli assi: +4 moduli esatti e **+30 uomini**. E il null è
muto su tre club — i promossi non hanno stagione precedente in questo campionato — dove la board
porta 20 uomini: contati a parte, perché «0 su 11» lì è una proprietà della baseline e non evidenza
su di essa (regola del «right null»).

**Due cose che questa misura ha insegnato, e valgono oltre il numero.**
1. **Quale delle nostre due stringhe di forma si confronta lo decide la REFERENZA.** La stampa scrive
   moduli a quattro numeri → si giudica sul `picture` dopo `_reshape`. L'esito è contato su
   `club_match_lineups`, che tiene TRE linee e **non può dire 4-2-3-1**: giudicato sul picture legge
   disaccordo ogni volta che la trasformazione ha spezzato una riga, cioè la stessa forma scritta due
   volte (Atalanta 3-4-3 disegnata 3-4-1-2, Roma 3-4-3 → 3-4-2-1, Como 4-5-1 → 4-4-1-1). Quell'artefatto
   da solo valeva **5 club su 20**: la differenza fra 7 MATCH e 12.
2. **Il 61% ha un tetto che non è il modello.** La stagione porta infortuni, mercato di gennaio ed
   esoneri, e nessun undici d'agosto li prevede: il Verona fa **2/11** perché ha cambiato quasi tutto.
   La referenza stampa di mid-season faceva 83%, ma era già informata di mezzo campionato — non è lo
   stesso esame.

**Contaminazioni dichiarate** (il foglio retrodatato non è puro e va detto): i **ruoli granulari** non
sono backfillabili, quindi 1773 di essi sono osservati nel 2026 e usati comunque — il foglio lo scrive
da sé e `desc_real_role_observed` porta la data vera; le **probabili** sono vuote (il `typical` non le
legge); la **rosa live** del 2025-08-15 è d'epoca; ma **transfers e arrivi sono derivati oggi**, quindi
la board conosce il mercato estivo 2025 completo, che a metà agosto non era chiuso. Le prime due sono
neutre o a sfavore, la terza è a FAVORE del modello: il 61% va letto come un limite superiore.

**E la voce 1 (Serie B) verificata fuori campione**: scaricata la Serie B 2024-25 e rifatto il foglio,
i moduli passano da 12 a **13** e il Pisa da 4 a 7 uomini, con il netto sugli uomini a −1 (rumore).
Molto più tiepido del Frosinone 4→10 sul 2026-27, e la ragione è misurata: **il valore degli aggregati
d'origine scala con quanto la rosa promossa è NUOVA alla Serie A**. Quota di rosa quotata con almeno 5
start di Serie A in carriera: Cremonese 2025-26 **79%**, Pisa 63%, Sassuolo 54% — contro Frosinone
2026-27 **16%**, Monza 48%, Venezia 46%. Dove il claim aveva già una storia di Serie A da leggere, la
Serie B aggiunge poco; dove non l'aveva, vale sei uomini su undici.

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

## 6-ter. Il caso Napoli: quando l'operatore ha ragione e nessun canale può dargliela (08/08/2026)

Il ciclo completo dell'altro esito possibile — tre indizi veri, ogni canale che li leggerebbe già
misurato e rifiutato, e la terza via.

**Gli indizi dell'operatore**, verificati uno per uno invece che accettati o respinti in blocco:
1. «Le amichevoli sono 4-3-3» — **vero**, 2 su 2 (22 e 26 luglio), `friendly_shapes = 4-3-3:2`.
2. «La rosa è di esterni, non è costruita per il 3-5-2» — vero, e il fit è **volutamente sordo** a
   questo argomento: caricare una forma per i posti che la rosa non copre fu provato e ANNULLATO
   (`shape_matchdays`, e il club che spostava era proprio il Napoli).
3. «L'anno scorso giocava 4-3-3» — **parzialmente vero, e il dato è più interessante della domanda**:
   partito a QUATTRO (8 giornate di 4-5-1 + 3 di 4-3-3), poi **27 giornate di 3-4-3** da fine ottobre.
   La moda 3-4-3 è onesta, ed è comunque l'abitudine di CONTE: pesa 0.40 per un allenatore nuovo.

**Il canale che li leggerebbe è stato misurato due volte, e perde due volte.** Oltre alla voce 5
(modulo del ritiro, ottimo al bordo), l'operatore ha proposto la variante più forte e più difendibile:
pesare solo la **FAMIGLIA DI DIFESA** (3 dietro vs 4), «la base su cui montare il resto». Misurata sui
16 club con ritiro parsato, contro la stampa:

| predittore | famiglia di difesa indovinata |
|---|---|
| difesa del ritiro | **11/16** |
| board attuale (repertorio + abitudine + fit), stessi club | **14/16** |

Il ritiro vince **esattamente dove l'operatore diceva** — Napoli e Juventus, i due divergenti
registrati, entrambi con allenatore nuovo — e perde su cinque: Genoa e Udinese con letture **2-0 forti
quanto quella del Napoli**, in direzione opposta. Sui soli allenatori nuovi è **4 giuste / 4 sbagliate**,
una moneta, contro 6/8 della board. Un peso capace di girare il Napoli gira anche quelli.
Stessa cosa rimisurando `PRESEASON_WEIGHT` sulla griglia della voce 5: a 0.30 il Napoli gira sul 4-3-3
e **la Fiorentina gira al contrario** (ritiro 3-5-2 contro stampa 4-3-3) — saldo 0 moduli, −1 uomo.

**Un limite dichiarato invece che nascosto**: il giudice FORTE non può pronunciarsi. Il DB non ha
amichevoli del ritiro 2025 (le 24 «friendly» 2025-26 sono di marzo-maggio 2026), quindi tutto questo è
misurato contro la STAMPA, che è una previsione. Il ritiro 2026 è archiviato (310 undici, 20 club su
20): a maggio 2027 l'esito 2026-27 lo misura per la prima volta contro la verità. **Voce di
manutenzione pre-registrata**: se la famiglia di difesa del ritiro batte le fonti della board
sull'esito, il canale entra con quel numero.

**La terza via, e la lezione generale.** Adottare un canale che il giudice rifiuta perché un caso lo
fallisce è allargare un criterio (vietato); lasciare la board sbagliata è ignorare l'operatore, che qui
sa qualcosa di vero. Quindi il giudizio si **dichiara** invece di essere inferito: `board_rulings.json`
(§1), fuori da ogni misura. **Un giudizio che il modello non può raggiungere non si adotta come
parametro: si dichiara come fatto.** E resta la via che si chiude da sola — dalle prime giornate vere
`formation_typical_under_coach` sposta `trust` sull'abitudine del club sotto l'allenatore nuovo, e la
board gira senza che nessuno tocchi un parametro.

## 6-quater. La board e il motore prevedono due cose diverse su chi gioca, e adesso lo dicono (17/08/2026)

Misurato sul bundle spedito, non discusso: l'undici disegnato condivide **296 uomini su 396** con gli undici
di maggior `engine_pv_pred` dello stesso club su euro (36 club) e **150 su 187** su Serie A (17 club). Il
`claim` di `presence.py` contro la quota attesa del motore correla **ρ 0,58 su euro** e **0,83 su Serie A**,
con mediane praticamente uguali (0,68 contro 0,63 · 0,69 contro 0,69).

**Non è un difetto da correggere e non era una cosa da tacere.** Le due domande sono diverse per costruzione
— `claim` è «chi parte titolare quando stanno tutti bene», `engine_pv_pred` è «in quante giornate prende un
voto», e un subentrato il voto lo prende — quindi allinearle a forza sarebbe cambiare una regola senza una
finestra che la giudichi. Ma una carta che mostra un undici e prezza quegli stessi uomini su una previsione
che lo contraddice **in silenzio** è il difetto che `presence.py` scrive di sé: «una board che non disegna
nessuno dove il motore prevede qualcuno sono due risposte a una domanda».

Decisione dell'operatore (17/08/2026): **mostrare il disaccordo**. I due campetti dell'app (asta e Squadre,
che leggono la stessa funzione) marcano l'uomo dove i due numeri distano più di `BOARD_ENGINE_GAP` = **0,20
di calendario**, e il tooltip nomina le due domande invece di dichiarare un vincitore. La soglia è una
scelta di VISUALIZZAZIONE dichiarata — nessun gate la possiede — ma è **misurata e non scelta**: il divario
|claim − quota| ha mediana 0,07 e p90 **0,20** su euro, mediana 0,05 e p90 0,14 su Serie A, quindi a 0,20 il
marchio tocca il 10% dell'undici euro (circa un uomo per club) e il 3% su Serie A. A 0,15 sarebbe un uomo su
cinque, cioè una decorazione.

Le due direzioni dicono cose diverse e la frase lo rispetta: **board più alta** = gli dà la maglia e il
motore lo prevede a voto in molte meno giornate (Petrovic D. 0,87 contro 0,50); **motore più alto** = spesso
per quel posto la board non aveva nessuno di meglio (Tornqvist, Cuenca A., Milla, Azon: claim 0,08 contro una
quota attesa di 0,50). Quale delle due prevedere meglio chi ha davvero giocato è **una misura che nessuno ha
ancora fatto**, e il giudice esiste già: l'esito della stagione, come in `press --against outcome`.

## 6-quinquies. UN CAMPETTO SOLO, e un item è un POSTO (18/08/2026)

Richieste dell'operatore, tutte lo stesso giorno, e ognuna con la misura che l'ha resa possibile.

**Un componente per due schermate.** «Il campetto di una squadra reale deve essere sempre uguale sia nella
schermata dell'asta che in quello delle squadre»: erano due componenti con due template che si assomigliavano,
adesso è `ui/club-board/` e le due viste gli passano solo quello che sanno loro (la vista Squadre niente, il
pannello d'asta chi è già stato preso). È la stessa ragione per cui l'undici lo disegna il toolkit: due copie
di una carta finiscono per dire due cose.

**Un item è un posto, non un uomo.** Sopra il **ruolo reale** che quel posto chiede (il marcatore del
pannello: `Td`, `Dc`, `Pc`), sotto i calciatori che se lo giocano - titolare per primo - ognuno con il suo
ruolo di listone, le sue icone, il suo **Overall 0-99** (lo stesso della tabella Giocatori, letto da lì e non
ricalcolato) e i **minuti attesi per partita del club**. Quest'ultimo numero non esiste nel bundle: è il
prodotto DICHIARATO di due colonne pubblicate — `engine_pv_pred / giornate` per `desc_minutes_full_season /
desc_season_matches` — scelto dall'operatore fra tre numeri veri, e va letto come «quanti minuti ti aspetti
da lui in una partita qualunque», assenze comprese.

**Un uomo in ballottaggio su un posto solo.** Il pannello calcola i rivali POSTO per posto, quindi un vice che
copre due maglie compariva due volte: misurato sul bundle, **171 voci di ballottaggio su 610 sono ripetizioni**
su euro (35 club su 37) e 104 su 371 su Serie A (tutti e 20). Il claim è UNO per uomo, quindi «dove è più
alto» non distingue fra due posti: si tiene dove il posto chiede uno dei suoi codici granulari (l'ordine di
`placeCodes` è già una preferenza) e, a pari fit, dove il TITOLARE è più debole - perché è là che entrerebbe.

**Un ballottaggio sotto il 20% di titolarità non si disegna** («se non ci sono ballottaggi accetta qualsiasi
claim; nel caso di ballottaggi scarta quelli sotto il 0,20»). Vale sui RIVALI e non sul titolare, o l'undici
avrebbe un posto vuoto che il toolkit non ha lasciato. Misurato prima di scegliere, su 610 rivali di euro: a
0,20 se ne scartano 95 e 40 posizioni su 357 restano senza ballottaggio; a 0,30 sarebbero 161 e 72, cioè un
ballottaggio vero su quattro; a 0,15 solo 62, appena la coda (il decimo percentile dei rivali sta a 0,145).
Come le soglie degli infortuni: scelta di VISUALIZZAZIONE, nessun gate la possiede — e la carta **dice quanti
nomi non ha disegnato e per quale delle due ragioni**, perché un filtro silenzioso è un filtro che inganna.

**I moduli con percentuali importanti si possono provare.** Dove due o più forme stanno sopra il **30%**
(`boards.ALTERNATIVE_MIN_ODDS`) il campetto mostra dei tastini e disegna l'undici di quella scelta. L'undici
però lo scrive il TOOLKIT, uno per forma, chiamando le stesse funzioni del pannello (`_drawn`): un undici di
un club vero è una previsione su una persona, quindi l'app non ne calcola nessuno - la regola di «A drawing is
a claim too» vale anche per la seconda risposta. Misurato sul bundle del 18/08: **7 club su 37 su euro** e 3-4
su 20 su Serie A hanno un'alternativa; una forma che si rimodella nella stessa figura viene scartata, perché
sarebbe un tastino che non cambia niente. Il tastino porta la FIGURA disegnata e il tooltip dice su quale
forma è stata risolta (Atalanta: «3-4-1-2 38%», risolto su 3-4-3).

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
- `COACH_SHAPE_MIN`/`FULL` = 20/60: **non più da ritarare**, rimisurati su griglia pre-registrata e
  chiusi (§1, todolist voce 4 — il verdetto è piatto e 20/60 sta in mezzo al plateau).
  `PREVIOUS_COACH_WEIGHT` = 0.25 nel conteggio di club.
- **Lo standing legge UNA stagione, e due popolazioni ne pagano il prezzo** (misurate 08/08/2026,
  entrambe candidate a sweep pre-registrato e nessuna delle due decisa a mano):
  * **il trasferimento di GENNAIO** — `season_calendar` gli lascia il calendario del club perché ha
    minuti su due calendari e nessun denominatore è giusto (v9.37, limite già dichiarato). Malen è il
    caso che lo mostra: 1478' in 18 presenze su 18 da titolare alla Roma da gennaio, letti come
    **0.405** di stagione, quarto del reparto — e fuori dall'undici. Un denominatore sull'UNIONE DEGLI
    SPELL (lo stesso principio con cui si contano già le assenze) darebbe ~0.59. È una formula di
    `presence.py`: la decide lo sweep, non una sessione;
  * **la stagione mangiata da un infortunio** — per chi ha la t−1 quasi vuota, la shrinkage tira verso
    il prior della BANDA e non verso la sua t−2. Dovbyk (396', 22 turni fuori, 3 titolarità sui 16
    turni disponibili) legge 0.382: onesto sul dato, cieco sul fatto che l'anno prima era titolare.
    Un prior personale su t−2 è la variante pre-registrabile.
- Il claim di preseason non legge le amichevoli (misurato e NON adottato, cinque ragioni in v9.17 §6;
  pre-registrato per giugno 2027).
- Le probabili estive degli editor sono della stagione finita finché la nuova non parte (v9.32): i
  lettori filtrano sulla stagione, quindi in agosto `desc_starter_prob` è vuota per costruzione.
