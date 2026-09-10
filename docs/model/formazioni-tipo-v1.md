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

## 5-quater. IL TERZO GIUDICE: la giornata GIÀ GIOCATA (`--against round`, 24/08/2026)

`press` aveva due giudici e nessuno dei due parla quando serve. La **stampa** è una previsione di altri,
e c'è; l'**esito** è quello che i club hanno fatto davvero — nessuna opinione, contato nel vocabolario a
tre linee delle board — ma esiste solo a stagione finita, quindi vuole un foglio retrodatato. Fra
l'asta di agosto e maggio non c'è niente. Il terzo giudice è l'esito **ristretto alle giornate già
giocate**: stessa prova, stessa aritmetica, stesso null, disponibile dal primo fine settimana.

`press --sheet DIR --against round --round N` (ripetibile). Un club che ha giocato più di una delle
giornate scelte è giudicato sull'**ultima**, e la voce porta la **data**: l'unità è la PARTITA e mai la
giornata, così un rinvio si vede invece di essere mediato. Il verdetto sul modulo si dà sulla
`board_shape` e non sulla figura disegnata, per la stessa ragione dell'esito: `club_match_lineups` tiene
tre linee e un 4-2-3-1 non lo sa dire. Report: `data/reports/board_round_check.json`.

**Due popolazioni, e non sono la stessa.** La FORMA è contata su ogni riga di formazione e non passa
dall'imbuto delle identità, quindi è completa; gli UOMINI passano da `player_xref`, quindi il
denominatore sono i nomi che l'imbuto ha risolto e il report lo dice club per club (`xi_resolved`). Un
riferimento da 10 su 11 contato come 11 ci addebiterebbe un errore che non abbiamo fatto.

**Una board con meno di undici uomini non è una previsione sbagliata**, è un club il cui contingente su
quel foglio non riesce a schierarne uno: `short_board` la conta a parte, come il null conta a parte una
neopromossa. È servito subito — vedi Como più sotto.

### Il verdetto della 1ª giornata 2026-27 (fogli del 20/08, board estratte dal CSV congelato)

Serie A, 18 club su 20 (Roma-Fiorentina ancora in corso):

| | board | null (stessa formazione dell'anno prima) |
|---|---|---|
| modulo MATCH | **9/18** | 7/18 |
| uomini in comune | **119/186 = 64,0%** | 104/186 = 55,9% |

EuroLeghe, 24 club (23 con la board piena):

| | board | null |
|---|---|---|
| modulo MATCH | **18/23** | 16/24 |
| uomini in comune | **147/233 = 63,1%** | 124/243 = 51,0% |

**E il numero che conta di più non è quello.** Degli uomini che abbiamo disegnato e che il club NON ha
schierato dal primo minuto, **il 37,7%** (Serie A) e **il 34,0%** (euro) è entrato lo stesso. Quindi dei
198 uomini disegnati sul foglio Serie A, 119 hanno cominciato e **148 sono andati in campo (74,7%)** —
che è la domanda del progetto, perché la titolarità qui è «gioca abbastanza da prendere il voto» e non
«parte titolare». Il Milan è il caso limite e vale come esempio: 3/11 sugli undici iniziali, ma dei
nostri otto «errori» **cinque sono entrati** (Modric 34', Rabiot 34', Bartesaghi 24', Saelemaekers 24',
Gabbia 14') contro un undici tutto nuovo (Maignan; Gila, De Winter, Pavlovic; Chukwueze, Musah, Jashari,
Estupiñán; Loftus-Cheek, Cissé A., Ramos G.).

**UNA GIORNATA NON È UN VERDETTO**, ed è la regola di casa: nove partite, una sola estrazione di una
forma che quel club schiererà trentotto volte, con la preparazione ancora addosso e il mercato aperto.
Quello che si può dire è che in AGGREGATO le board battono il null su tutte e quattro le misure, di 8-12
punti sugli uomini e di due moduli su Serie A. Si rimisura a ogni giornata con lo stesso comando.

### Due difetti trovati arrivandoci, e il primo impediva la misura stessa

- **`positions.perimeter_club_keys` leggeva i VOTI euro della stagione bersaglio**, che ad agosto non
  esistono: `perimeter_club_keys('2026-27')` tornava vuoto e tutto lo strato per-partita rispondeva «no
  euro ratings yet - perimeter unknown, skipping». Cioè le prime giornate della stagione nuova non si
  potevano scaricare affatto, in silenzio e con exit 0. È **lo stesso difetto già trovato e curato nel
  perimetro del FOGLIO l'08/08/2026** («The sheet's PERIMETER is the TARGET listone»), sopravvissuto un
  modulo più in là. Curato instradandolo su `snapshot.perimeter_clubs` — una definizione sola, il listone
  bersaglio prima e i voti come ripiego: 0 → 37 club. Il listone sa di una promozione prima che si giochi;
  i voti di una stagione lo sanno solo dopo.
- **Il foglio euro del 20/08 porta 5 righe del Como** contro le 29 quotate su quel listone (ogni altro
  club ne ha 20+), e sono le cinque senza calcio misurato lì. La board del Como su euro è quindi di
  quattro uomini e legge 0/10 — che è un fatto sul foglio, non sulla board, ed è per questo che
  `short_board` esiste. Il DB di oggi è coerente (Como 29, `league` = serie_a, una sola riga in `clubs`),
  quindi era uno stato transitorio di quella costruzione: da riverificare sul foglio che l'aggiornamento
  ricostruisce.

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
pannello: `Td`, `Dc`, `Pc`, disegnato in grigio dal 18/08 sera: i colori del listone sono dei calciatori, e un
marcatore acceso come loro faceva leggere il posto come un dodicesimo uomo), sotto i calciatori che se lo
giocano - titolare per primo - ognuno con il suo ruolo di listone, le sue icone accanto al NOME, il suo
**Overall 0-99** (lo stesso della tabella Giocatori, letto da lì e non ricalcolato, e colorato a bande che
sono QUANTILI del listone) e due numeri senza parole: i **minuti che gioca quando gioca** e la **quota di
giornate** in cui il motore se lo aspetta a voto. Una cella non passa il **terzo** della riga, o una riga di
uno - la porta - si prendeva tutta la larghezza mentre gli altri dieci stavano in colonnine.

~~I minuti attesi per partita del club: il prodotto dichiarato di `engine_pv_pred / giornate` per
`desc_minutes_full_season / desc_season_matches`.~~ **Cambiato due volte in due giorni, e le due correzioni
sono l'operatore che stringe la stessa vite.** Il 18/08 il prodotto è uscito dal chip - «mescolava una misura
e una previsione in un numero solo» - e al suo posto è andata la media MISURATA, «minuti totali stagione
scorsa / partite giocate». Il 19/08 la domanda è diventata quella giusta: quella media descrive la stagione
FINITA, e al tavolo si compra quella che viene. Il numero sul chip è ora una previsione dichiarata,
`engine/minutes.py`, misurata in §6-sexies; la media misurata resta nel tooltip **col suo nome**, insieme alle
altre due (per partita del club, e ultime dieci) - tre denominatori diversi, tre etichette, mai una cifra nuda.

**Un uomo in ballottaggio su un posto solo... e i posti con un numero simile di alternative.** Il pannello
calcola i rivali POSTO per posto, quindi un vice che copre due maglie compariva due volte: misurato sul
bundle, **171 voci di ballottaggio su 610 sono ripetizioni** su euro (35 club su 37) e 104 su 371 su Serie A
(tutti e 20). La prima regola li toglieva un uomo alla volta - dove il posto chiede uno dei suoi codici e, a
pari fit, dove il titolare è più debole - e il 18/08 sera l'operatore ha mostrato cosa lasciava in piedi:
l'Atalanta con i due centrali di riserva **tutt'e due** sul terzino sinistro, i due `Dc` senza nessuno, e un
mancino in ballottaggio a destra perché era lì che il toolkit l'aveva elencato. Una scelta per uomo non può
vedere quel disegno: è un'**assegnazione** su tutto il campetto (`spreadDuels`), con tre prezzi dichiarati -
il fit sul ruolo REALE, che domina; la FOLLA, convessa, così «uno e uno» batte «due e zero»; lo SPOSTAMENTO su
un posto che il toolkit non gli aveva elencato, permesso solo dentro la sua LINEA e solo se il ruolo reale lo
giustifica, perché nessun ballottaggio viene inventato.
Misurato chiamando la funzione che spedisce, stessi rivali disegnati, prima e dopo:

| | posti senza alternative | con una | con due | fuori ruolo |
|---|---|---|---|---|
| Serie A prima | 126 | 46 | 48 | 5 |
| Serie A adesso | **91** | **116** | **13** | **2** |
| euro prima | 218 | 106 | 76 | 10 |
| euro adesso | **165** | **212** | **23** | **3** |

Nessuno compare due volte, nemmeno su due LINEE diverse - il difetto che la versione per riga aveva
reintrodotto (Pasalic, ballottaggio in mezzo e sulla trequarti insieme).

**Un ballottaggio sotto il 20% di quota da titolare non si disegna** («se non ci sono ballottaggi accetta qualsiasi
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

## 6-sexies. I MINUTI PREVISTI, e il rapporto dei claim che è stato misurato e respinto (19/08/2026)

**La domanda dell'operatore**: «riusciamo a rimodulare i minuti per match della scorsa stagione in modo che
rispecchino i minuti per match PREVISTI nella stagione corrente? Dovremmo trovare il rapporto (claim stagione
scorsa) / (claim stagione corrente)».

**Il rapporto secco non si può usare, e la ragione è algebrica prima che empirica.** Il claim È costruito sui
minuti della stagione scorsa (`standing_weights` = (0, 1), adottato su dieci fold di dieci): la sua parte
misurata è `minuti × peso / (giornate × 90)`. Quindi

    perMatch × claim_now / claim_prev = (minuti/partite) × claim_now × giornate × 90 / minuti
                                      = 90 × giornate × claim_now / partite

— **i minuti misurati si cancellano**. Lo stimatore butta via il numero che dice di correggere, e quel che
resta non ha più niente di suo tranne il denominatore. Stessa famiglia del difetto `contested`/`availability`
(«sottrarre e rimoltiplicare la stessa stima si annulla»). Misurato, è il braccio peggiore di tutta la
tabella: **−59% e −55%** contro il non fare niente. Un test di `engine/minutes.py` lo tiene come aritmetica,
così nessuno lo ripropone.

**Cosa è stato adottato.** Un minuto per presenza è la miscela di due tipi di presenza, e quando cambia il
ruolo cambia la MISCELA: `minuti = C + P × (S − C)`, con `P` = P(titolare | presenza). `S` e `C` sono
MISURATI su 247.825 presenze di lega (`external_match_stats`, 19/08/2026), per ruolo di listone:

| ruolo | partenze | S | subentri | C |
|---|---:|---:|---:|---:|
| P | 12.589 | 89,5 | **178** | 35,4 |
| D | 52.533 | 84,5 | 13.023 | 21,3 |
| C | 48.615 | 79,9 | 22.153 | 21,1 |
| A | 26.441 | 78,5 | 16.588 | 20,7 |
| ? | 42.995 | 83,4 | 12.710 | 20,5 |

`P` prossimo è una MISCELA di due letture, non una sola: la quota misurata l'anno scorso (`desc_start_share`,
che divide per le sue PRESENZE - la colonna che il pannello dichiara sbagliata come quota da titolare è quella
giusta qui, perché la cosa che si sta dividendo è una presenza) e quella implicita nel modello
(`presence / (engine_pv_pred / giornate)`, **due quote e non due conteggi**, o sarebbe il denominatore
sbagliato di sempre). Il peso del modello è **0,30**, e la ragione è misurata e scomoda: **la previsione del
modello è PEGGIORE della misura** come stima della quota da titolare che verrà.

| stima di P | bias | MAE | correlazione con P reale |
|---|---:|---:|---:|
| quota misurata l'anno scorso | +0,010 / +0,022 | **0,200 / 0,197** | **0,497 / 0,468** |
| quota implicita nel modello | +0,085 / +0,109 | 0,234 / 0,237 | 0,408 / 0,359 |

Non è un motivo per buttarla: sa di un trasferimento, di un allenatore nuovo e di una storia infortuni che la
misura non può vedere. È un motivo per darle la MINORANZA. Il braccio col modello puro è negativo su tutt'e
due le finestre (−4,2% e −8,4%).

**Il giudizio.** Due fogli PRE-stagione retrodatati (`snapshot --season S --date S-08-15`: sotto le cinque
giornate il foglio misura la stagione precedente, cioè lo stato di un'asta d'agosto), esito = i minuti per
presenza realizzati nella stagione bersaglio, minimo tre presenze, 2.303 coppie:

| finestra | naive (media invariata) | adottato | |
|---|---:|---:|---|
| 2024-08-15 → 2024-25 | MAE 14,29 | **13,21** | **+7,5%** · D +9,4% · C +8,5% · A +2,8% |
| 2025-08-15 → 2025-26 | MAE 13,89 | **12,84** | **+7,6%** · D +7,0% · C +7,7% · A +8,8% |
| in pool | 14,09 | **13,02** | **+7,6%** |

Il criterio era scritto prima della corsa (batte il naive su tutt'e due le finestre e in pool di almeno il 3%
relativo, nessun ruolo peggio del 2%) e i due parametri sono scelti **cross-fit** - ognuno sulla finestra che
non lo giudica - con optimum **interno** su tutt'e due (mix 0,25-0,30, ancora 0-0,2). Non è un gate: è
REPORTING, e nessun `engine_*` si muove (`backtest --verify` resta 22/22).

**Tre cose che vale la pena portarsi dietro.** È anche una CONTRAZIONE e non solo una riscalatura: solo 0,20
del residuo personale sopravvive, e il braccio che non fa altro che contrarre (P invariato) vale già
**+4,6% / +4,9%** dei sette punti - una media misurata su poche presenze regredisce come ogni altro tasso, e
88′ su quattro presenze non sono una promessa. **Il portiere non si riscala**: la sua P è 1 per regolamento e
il modello non lo sa (MAE 3,65 → 6,19 e 2,24 → 5,88), quindi per lui la misura È la previsione. E il tetto
della famiglia, sostituendo il P VERO, è MAE **3,78 / 3,54 (+74%)**: la forma è giusta e quel che manca è una
previsione di chi parte titolare - **è quello che riaprirebbe la questione, non una formula più grande**.

Il numero si muove poco e dove deve: mediana |Δ| **4,2-4,5 minuti**, e solo il **13%** degli uomini si sposta
di dieci minuti o più. Chi non ha una stagione misurata non ha previsione e la carta lo dice: vuoto = ignoto.

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

## LA MISCELA DELLE DUE FINESTRE (5 settembre 2026)

Il claim e la board di una stagione GIA' COMINCIATA non leggono piu' soltanto le giornate giocate.
`snapshot.measured_season` commutava - sopra cinque giornate contate su CINQUE campionati insieme, quindi
sempre - e per un uomo di Serie A il campione erano **due partite**: Douvikas 2/2 letto `titolare` a 75',
Kean un ingresso da 27' letto `riserva` con `play_share` 0,021, e 313 righe su 358 in disaccordo col
proprio Pa.

Adesso `presence.blend_seasons` mette insieme le finestre, ognuna col PROPRIO denominatore (che cura da
se' l'errore di unita': Douvikas era diviso per 2 e Kean per 38, nella stessa colonna), con la stagione
precedente riscalata a `season_prior_rounds` = 10 giornate di prior - la K che il gate ha ADOTTATO per
R20 su `default`, 6 su euro - e il ritiro a una giornata, senza minuti.

**Giudicata dai giudici di questo documento**, che e' la ragione per cui esistono: `press --against
press` legge **153 uomini su 220** contro i 137 di prima (null: 104), e i moduli scendono da 10 a 8
MATCH. Si adotta sui NOMI e il prezzo sui moduli e' detto. `--against round --round 2` NON puo'
arbitrare qui e va scritto: dava al foglio vecchio `bandiera` 100,0%, perche' quella giornata ERA il suo
intero campione - un giudice che ha letto la risposta non e' un giudice.

Mediana di `Pa/giornate` per gradino, prima -> dopo: bandiera 0,58 -> **0,78** · titolare 0,71 -> 0,73 ·
ballottaggio 0,61 -> 0,64 · panchina — -> 0,52 · riserva 0,50 -> **0,34**.

## 8. IL RIENTRO DA UN'ASSENZA LUNGA: si riprende il posto? (5 settembre 2026)

Misura chiesta dall'operatore («altri contendenti di quel ruolo potrebbero ben figurare e prendersi il
posto») e fatta prima di scrivere una riga di codice, perché era la metà della sua ipotesi che questo
progetto non modellava affatto. La metà che modellava già — il RODAGGIO — era stata misurata il 04/09 e
vale ~1,3% di fantapunti: piccola.

**Criterio scritto PRIMA della corsa.** Uno spell di `injuries` chiuso e datato che costa almeno 4
giornate di campionato del suo club, di un uomo che nelle 6 giornate prima era titolare in almeno 4. Si
cammina sulle DATE del club, mai sulle giornate. **856 casi**, 2019-20 → 2025-26, cinque campionati. Il
null sono i compagni della **sua stessa linea rimasti sani**, sulle stesse giornate: un club cambia
allenatore e modulo, quindi il suo prima/dopo da solo non è attribuibile a niente.

### Si riprende il posto? (quota da titolare, appaiata coi compagni sani)

| assenza | n | prima | al rientro (6 g.) | **appaiato** | poi (g. 7-18) | **appaiato** |
|---|---|---|---|---|---|---|
| 4-7 g. (~1 mese) | 660 | 0,841 | 0,521 | **−0,116 ± 0,017** | 0,539 | −0,064 ± 0,018 |
| 8-13 g. (~2-3 mesi) | 158 | 0,834 | 0,460 | **−0,134 ± 0,034** | 0,508 | −0,052 ± 0,042 |
| 14-25 g. (~4-6 mesi) | 38 | 0,838 | 0,325 | **−0,256 ± 0,081** | 0,343 | **−0,143 ± 0,070** |

### Lo stesso, in MINUTI — la valuta su cui poggia lo `standing` (pesi (0,1), sweep 29/07)

| assenza | prima | al rientro | **appaiato** | poi | **appaiato** | resta |
|---|---|---|---|---|---|---|
| ~1 mese | 71,1' | 47,1' | **−5,2' ± 1,5** | 47,4' | −1,3' ± 1,6 | 0,93 |
| ~2-3 mesi | 70,1' | 42,6' | **−5,6' ± 2,8** | 45,7' | −0,3' ± 3,5 | 0,92 |
| ~4-6 mesi | 69,9' | 29,4' | **−19,2' ± 6,6** | 30,3' | **−12,4' ± 5,6** | **0,72** |

### I contendenti

Quota da titolare dei compagni della sua linea che **non** erano titolari prima: raddoppiano durante
l'assenza (0,21 → 0,41) e ne **tengono metà** dopo il rientro — **+0,133 · +0,122 · +0,133** sulle tre
bande, cioè **piatto**. Quello che cambia con la durata non è quanto guadagnano loro: è quanto lui non
recupera.

### IL REGIME CAMBIA FRA I TRE E I QUATTRO MESI, in tutte e due le valute

Sotto i tre mesi la perdita è **transitoria**: dopo sei giornate è già rientrata nel rumore (−0,052 ±
0,042 e −0,3' ± 3,5, nessuna delle due distinguibile da zero). Sopra i quattro mesi **un terzo non
torna**: −0,143 di quota e −12,4 minuti che restano, cioè torna al **0,72** di quello che era.

**Le due soglie che l'operatore aveva dichiarato guardando il calcio — «tre mesi rientra con tanti dubbi»,
«sei mesi non rientra» — cadono esattamente dove il regime cambia.** Vale come le altre due volte in cui è
successo in questo progetto (`EASY_MARGIN` ↔ il 40% di porta inviolata, `DEPTH_TIER` ↔ la banda
dell'archivio): è evidenza, e NON è una ragione per tarare la soglia su questi numeri.

Quindi la regola prende una forma diversa nelle due bande, e nessuna delle due è quella che sembrava
ovvia prima della misura:

* **fino a 3 mesi** il costo sono le **giornate saltate**, più una coda di ~6 giornate. Non è una
  demozione: sei giornate dopo è di nuovo lui, e «con tanti dubbi» ha un prezzo che SCADE.
* **da 4 mesi in su** il posto l'ha perso davvero, ed è l'argomento misurato per l'esclusione dall'undici
  tipo che l'operatore ha dichiarato lo stesso giorno.

### Cosa questa misura NON può dire, e va detto perché è la parte utile

* **n = 38** nella banda lunga (18 per la coda). La direzione è netta (t 2,2-2,9), **la soglia non si tara
  qui**.
* Solo spell **chiusi** e con almeno 6 giornate giocate dopo: chi non è mai tornato non è nella
  popolazione. È la lettura **ottimistica**.
* La linea è **G/D/M/F**, l'unica posizione storica per partita che il layer ha: un terzino e un centrale
  sono entrambi «D», quindi i contendenti sono sovrastimati e l'effetto è diluito **verso lo zero**.
* Misura il **rientro**, non l'assenza: si moltiplica per le giornate che gioca, non la sostituisce.

---

# §9 — Il campetto: i rivali di un POSTO, la difesa NATIVA, e le dritte dell'operatore (7 settembre 2026)

Nati da **cinque nomi** che l'operatore ha portato guardando la pagina Formazione: Neres, Estupinan,
Pinamonti, Belahyane, Karlstrom. Tre difetti diversi, due curati nel codice e uno che è diventato un
canale nuovo.

## 9.1 — I rivali venivano dalla linea per cui l'uomo era stato SCELTO, non dal posto che occupa

`benches` si costruiva da `by_role[linea di partenza]` prima delle riparazioni, e chi una riparazione
toglieva dall'undici restava in `taken`: quindi un uomo disegnato sul posto di un'ALTRA linea ereditava i
rivali di quella di partenza, e uno scambiato fuori non era nel serbatoio di nessuna maglia.

| caso | prima | dopo |
|---|---|---|
| Napoli, fasce d'attacco | Lang 0,372 su entrambe; **Neres 0,440 in nessuna** | Neres su entrambe |
| Milan, fascia di mezzo (Bartesaghi `DL;ML;DC`) | Moreira 0,386 e **Terracciano F. 0,304, un DESTRO** | Gabbia 0,543 e Tomori 0,498 |

Ora il serbatoio è **tutti gli eleggibili fuori dall'undici finale**, col filtro posizionale `can_replace`
— che è la regola che il commento accanto dichiarava da sempre: si è allargato il POOL alla regola, non
la regola. Cambia i rivali di **14 club su 20** e non può muovere l'undici (`able[:2]` alimenta solo la
lista dei rivali), il che è verificato e non dedotto: zero differenze sulle 9 colonne `engine_*`.

Il limite resta detto: **si disegnano due rivali per maglia**, quindi il terzo per claim non si vede
(Estupinan 0,406 dietro Gabbia 0,543 e Tomori 0,498). Per quello servono le dritte, §9.3.

## 9.2 — Un posto in DIFESA va a chi la difesa la gioca, finché uno arruolabile ce n'è

Regola dell'operatore, dettata su Karlstrom dell'Udinese: «finché ci sono Dc di buon livello e
disponibili devono giocare loro nella posizione Dc; se mancassero Dc e nella sua storia avesse giocato Dc
allora potrebbe posizionarsi lì» — e la generale: «adattamenti in posizioni che non gli competono devono
essere avallati da situazioni realmente viste in campo e non immaginate: senza controprova statistica è
solo fantasia». La controprova esiste: `player_roles` sono i codici OSSERVATI.

**Il trace dice che il difetto era in `_assign` e non nella scelta**: la difesa prendeva Solet, Zanoli,
Vojvoda, Kabasele e il centrocampo Karlstrom + 3; poi l'assegnazione scambiava le due linee di Zanoli e
Karlstrom, perché quella coppia costa **10** contro i **16** della coppia giusta (Zanoli a destra in
difesa, dove il suo `DR` paga zero, e un centrale di mezzo sulla fascia, che paga il lato).

**LA PRIMA CURA ERA UN PREZZO E VA SCRITTA PERCHÉ NESSUNO LA RIPROVI.** Un pedaggio di 40 dentro
`_slot_price` per chi la linea non la gioca: metteva Karlstrom a centrocampo e il giudice stampa
*migliorava* (157/220 contro 156). **Rifiutata comunque**, perché ha fatto cadere tre test guardiani —
vietava gli attraversamenti che questo modulo RICHIEDE («una fascia di centrocampo scoperta viene coperta
dal fronte»), e la riga di mezzo del Liverpool restava senza l'ala destra. *Un punteggio migliore non
compra una regola che ne rompe un'altra.*

E il fixture del Liverpool ha detto qual era la distinzione giusta: là **nessun altro centrale esiste**,
quindi il mediano che scala è il comma 2 dell'operatore e questo modulo l'aveva già misurato. La domanda
non è sulla griglia, è sulla ROSA — quindi è una **selezione** e non un prezzo (`_native_defence`, dopo
il rimodellamento): il posto va al miglior difensore disponibile, e l'adattato torna nella sua linea se
là c'è un posto che tiene un uomo più debole (Karlstrom 0,672 contro Piotrowski 0,508), altrimenti il
claim ha già detto che non è un titolare.

Effetto: Udinese disegna **Vojvoda · Kabasele · Bertola · Solet** con **Karlstrom a centrocampo**. Sui
venti club, uomini disegnati in una linea che i loro codici non coprono: **9 → 8, e ZERO in difesa** (gli
otto restanti sono 4 sulla trequarti e 4 a centrocampo — ali e trequartisti a una riga dal loro mestiere,
fuori dal perimetro della regola). Tre undici su venti cambiano. **Giudice stampa: 8 MATCH / 2 ALT / 10
DIFF, 156/220 — identico a prima: la regola non costa niente**, ed è dichiarata, quindi il giudice serve
a dire che il disegno non peggiora, non ad approvarla.

## 9.3 — `config/player_rulings.json`: le dritte che i dati non hanno

Richiesta dell'operatore: «servirebbe qualche parte dove ti posso dare delle "dritte" che esulano dalle
statistiche... se un certo calciatore è un titolare o una riserva, perché io ho delle conoscenze che i
dati non hanno». È la **terza** cosa dichiarata del progetto e ha la forma delle altre due
(`board_rulings.json`, `player_notes.json`): unita per `fc_id`, datata, revocabile, **invisibile ai due
giudici** (`apply_rulings=False`) — una dritta si dà guardando il giudice.

Tre valori, ognuno con un effetto preciso, perché una dichiarazione che non si può applicare non si può
nemmeno smentire: **`starter`** entra nell'undici (e una riparazione non lo scavalca più), **`alternative`**
compare fra i rivali di una maglia che può indossare, **`reserve`** esce dai candidati e resta disegnabile
come alternativa. È un **vincolo e mai un peso**: spostargli il claim riordinerebbe in silenzio tutto il
resto e nessuno saprebbe più quale numero è misurato.

Verificato guidando il pannello vero: con le dritte Estupinan, Belahyane e Pinamonti compaiono; con
`apply_rulings=False` spariscono tutti e tre. Sei test, e una parola che nessuno sa applicare viene
IGNORATA invece di interpretata.

## 9.4 — E un caso non era un difetto

**Belahyane**: il foglio legge `pv_seen` **1 su 2** giornate e la stagione scorsa **11 voti su 38** (quota
0,289, minuti 0,179), quindi il claim 0,355 è aritmetica — la miscela pesa «adesso» al 25% alla seconda
giornata (K = 5, adottata il 05/09 a +31,9% fuori campione, e la percentuale fissa 50/50 fu misurata
**peggiore**). Il prezzo dichiarato: un titolare nuovo emerge in 4-5 giornate. Per vederlo prima serve una
dritta, che è esattamente perché il canale del §9.3 esiste.

**Pinamonti** invece è un pareggio non spezzato: il `Pc` va a Gudmundsson A. (`ST;AM`, 0,415) e il secondo
posto da rivale a Noslin (`RW;ST`, **0,366**) contro il suo **0,363** — tre millesimi, mentre lui è l'unico
`ST` puro e il motore lo mette secondo dell'attacco della Lazio (`engine_pv_pred` 23,2 contro 21,2 e 19,7).
Il pareggio non è rotto dal mestiere del posto: resta come voce aperta.

## 10. DUE ORIZZONTI, non due freschezze (10 settembre 2026)

Richiesta dell'operatore: «un algoritmo per valutare automaticamente le ultime 3 partite e implementare
questi giudizi per ottenere i giusti valori di titolarità ... in questo modo possiamo ottenere la
formazione tipo nell'ultimo periodo switchabile con quella tipo a lungo periodo». Più tre precisazioni
arrivate mentre la misura girava: «chi gioca dal principio, chi subentra e i minuti giocati da ognuno»,
«se chi ha giocato aveva spazio per il titolare che era infortunato/squalificato/indisponibile», e
«giocare 90' è un segnale molto forte di titolarità».

**Non è una lettura più fresca della stessa cosa: sono due BERSAGLI.** La lettura di stagione prevede le
giornate che RESTANO — il bersaglio su cui `season_prior_rounds` = 5 è stato adottato il 05/09 — e serve a
un'asta, dove si compra per maggio. La lettura corta prevede la PROSSIMA partita. Due domande, due nomi
(`season` / `short`), come `engine_replacement_fm` e lo zero schierato sono due zeri per due domande.

### 10.1 — Metà esisteva già e non viaggiava

`claim(row, horizon="recent")`, `presence(row, "recent")`, `eleven(club, shape, mode="next")` e
`boards.write_boards(mode=...)` esistono da agosto, e il pannello Tk ha il selettore «schieramento tipo /
prossima giornata» dal 03/08. Quello che mancava: `snapshot` chiamava `write_boards` **solo** con
`typical`, la finestra era dieci partite di OGNI competizione, la scala non aveva un gemello corto, e
l'app non aveva il pulsante. Più un debito: `gui.FORM_WEIGHT` = 0.60 e `gui.RECENT_PRIOR` = 3.0 erano
dichiarate scelte di visualizzazione, **mai misurate**, e non stavano in `presence.Params` — cioè
irraggiungibili da `sweep`, contro la regola che quel file stesso scrive. Il rimando che portavano («gate
§7-octies») oggi punta a un'altra sezione, che è come si scopre che nessuno le ha mai corse.

### 10.2 — La misura: quale finestra prevede la prossima partita

Fuori campione per costruzione: al match *m* di un club si legge solo il calcio **< m** e si giudica su
*m*. **3.638 partite-club, 72.022 righe, due stagioni complete × cinque campionati** (2024-25, 2025-26).
Il null banale è «gli stessi undici di ieri».

| lettura | Brier (parte titolare) | dei veri 11 |
|---|---|---|
| gli stessi di ieri (null) | 0.2314 | 8.43 |
| **la stagione** (quello che il foglio faceva) | 0.1696 | 8.46 |
| solo le ultime 3 | 0.1749 | 8.60 |
| ultime 3 + prior di 3 | 0.1581 | 8.68 |
| **ultime 3 + prior di 3, prova in MINUTI** | **0.1544** | **8.69** |

Due cose che quella tabella dice e vanno lette insieme: **le ultime tre DA SOLE scelgono l'undici meglio
della stagione** (8.60 contro 8.46) **e sono tarate peggio** (0.1749 contro 0.1696). È la ragione per cui
si adotta la miscela e non la finestra nuda: tiene il guadagno sull'ordine e aggiusta il numero.

`recent_window` è **piatta fra 2 e 4** e scende da 5 in su, quindi le 3 dell'operatore cadono sull'ottimo;
`recent_prior` ottima a **3**, che è lo stesso valore che `RECENT_PRIOR` portava a occhio — due strade
indipendenti sullo stesso numero, come per `season_prior_rounds` e la K di R20. E **UNA miscela e non
due**: la forma del pannello ne faceva due in cascata (accorciare verso lo standing, poi mescolare con
`FORM_WEIGHT`), e quella che vince è la forma che questo repository scrive da sempre, `k` osservate contro
`K` di prior.

### 10.3 — I 90 minuti: il meccanismo è suo, e la prova va sulla SUA quantità

Sul bersaglio «chi comincia la prossima partita» i minuti vincono davvero:

| quanto vale una partita come prova | Brier | dei veri 11 |
|---|---|---|
| partenza sì/no | 0.1710 | 8.58 |
| **minuti/90** | **0.1544** | **8.69** |
| «90' = 1, sostituito = 0,5» (la lettura letterale) | 0.1746 | 8.62 |

I minuti valgono +9,7% sulla partenza binaria e migliorano anche l'ORDINAMENTO, che è immune alla
taratura. La versione a gradini è **peggiore della binaria**: l'osservazione è vera e una soglia è la
forma sbagliata per esprimerla.

**E QUEL PARAMETRO È STATO APPLICATO ALLA QUANTITÀ SBAGLIATA, spedito così, e corretto lo stesso giorno**
su richiesta dell'operatore («verifica se i ragionamenti sui titolari a breve termine sono corretti
confrontando l'andamento con le stagioni passate»). `recent_share` non è «chi comincia»: è la quota delle
partite in cui prende il VOTO — l'asse su cui la scala a sei parole è costruita — e un uomo che entra ogni
partita per 45' vale 1,0 di presenze e 0,5 di minuti. Misurato sulla sua propria quantità, fuori campione,
76.315 osservazioni, errore medio della quota prevista sulle partite successive:

| prova della finestra | +1 | +3 | +5 |
|---|---|---|---|
| nessuna (la sola stagione: il null) | 0.2103 | 0.1716 | 0.1607 |
| **minuti** — quella spedita | 0.2566 | **0.2073** | 0.1944 |
| **presenze** — adottata | 0.1956 | **0.1614** | 0.1531 |

La versione spedita era **peggio del non avere la finestra affatto**. Sull'altro bersaglio, la quota da
TITOLARE, i minuti vincono ancora (0.2187 contro 0.2199 delle partenze e 0.2359 della sola stagione) — ma
lì la quantità è `recent_starting_share`, che ha la sua prova per la stessa regola: **la prova di una
quantità è la quantità stessa**, e 0,0012 di errore non vale un'eccezione che rende inspiegabile perché
due funzioni vicine leggano assi diversi.

*È «un parametro appartiene alla domanda su cui è stato misurato» commesso dentro la sessione che quella
stessa regola stava applicando altrove — e trovato solo perché l'operatore ha chiesto di verificare le
parole invece del numero.*

### 10.3-bis — Le sei PAROLE sulla finestra corta: promessa contro realizzato

Quello che mancava. La misura del 10/09 aveva giudicato il NUMERO; le sei parole no — `status.py` porta
per la scala lunga una tabella promessa-contro-realizzato e la corta non ne aveva nessuna. Stesso disegno
con l'orizzonte accorciato, 79.334 osservazioni, senza il cancello della board su tutt'e due i bracci:

| gradino | promessa | +1 | +3 | +5 | +10 | n (a +3) |
|---|---|---|---|---|---|---|
| bandiera | >.90 / 75' | .975 / 83' | .965 / 81' | .959 / 80' | .949 / 80' | 21.842 |
| titolarissimo | >.80 / 75' | .898 / 81' | .873 / 78' | .860 / 77' | .837 / 76' | 1.424 |
| titolare | >.80 / 65' | .946 / 70' | .931 / 68' | .924 / 67' | .914 / 66' | 8.399 |
| ballottaggio | >.80 | .876 / 53' | .864 / 51' | .858 / 51' | .847 / 51' | 17.272 |
| panchina | >.50 | .719 / 52' | .711 / 51' | .705 / 50' | .700 / 51' | 15.043 |
| riserva | — | .295 / 41' | .307 / 40' | .317 / 41' | .333 / 43' | 15.329 |

**Sei promesse su sei mantenute a ogni orizzonte**, e la scala corta spiega PIÙ della lunga: varianza
dell'esito spiegata dalla parola **0.4384 contro 0.4047**, errore medio 0.1937 contro 0.2002. Il livello
regge fino a +10 partite, cioè oltre la finestra che l'ha prodotta.

**Il prezzo è la STABILITÀ, e va detto**: fra una partita e la successiva la parola corta cambia il
**19,6%** delle volte contro il **7,5%** della lunga. Una lettura di tre partite è un bollettino e non una
caratterizzazione — è anche la ragione per cui il gradino del FOGLIO resta quello di stagione: con quello
si compra.

E il numero prima della correzione diceva l'opposto: varianza spiegata **0.3989**, cioè sotto la lunga. La
stessa tabella su cui la scala corta ora vince era la tabella che l'ha condannata: *una scala si verifica
sulle parole e non solo sul numero che le produce.*

### 10.4 — Lo sconto del «posto liberato»: RESPINTO come peso, adottato come DICHIARAZIONE

La prima forma — pesare meno una partenza presa mentre un superiore era assente — è misurata e respinta in
**tutte e tre** le definizioni di rivale, su **19.259 partenze ereditate di 115.955 (17%)**, cioè una
popolazione reale:

| rivale assente definito come | peso 0.75 | peso 0.50 |
|---|---|---|
| stesso ruolo granulare (i 12 codici) | 0.1545 | 0.1550 |
| stessa linea G/D/M/F | 0.1545 | 0.1554 |
| chiunque con più partenze | 0.1548 | 0.1564 |
| *nessuno sconto* | **0.1544** | |

Monotono nel peso, ottimo su «non fare niente». La direzione dice che il meccanismo è reale — più
precisamente si nomina il rivale, meno costa — e troppo piccolo. La ragione: **una finestra di 3 partite si
autocorregge, perché dimentica.** Se il titolare torna, il vice esce dalla finestra in tre partite; lo
sconto conterebbe due volte un fatto che la finestra corregge da sé. Stessa famiglia delle squalifiche
(R21, −1,58%) e dell'età.

**Quello che si adotta è la forma che l'operatore ha dettato dopo**, ed è un VINCOLO in avanti e non un
peso sul passato: se la board BREVE disegna A in un posto e la board LUNGA ci disegna B, e B è
indisponibile oggi e rientra entro l'orizzonte, **A è tappato a `ballottaggio`**. Fuori dall'orizzonte si
ignora («stiamo valutando la formazione nel breve termine»); **senza una data non si retrocede**, che è lo
specchio di «ignoto non promuove» e va nella direzione del calcio — la durata residua di un'assenza CRESCE
con quella trascorsa.

**La prima formulazione che ne avevo scritto era VUOTA PER COSTRUZIONE, e contarla prima l'ha salvata**:
«la board lunga disegna l'infortunato in quel posto» legge **0 righe su 182**, perché un uomo elencato fra
i `duels` di un posto non è mai nella sua linea — è un rivale *proprio perché* la maglia non è sua. Il
confronto è fra le due BOARD, e lì la popolazione esiste: **40 dei 220 uomini che la board lunga di Serie A
disegna sono indisponibili oggi**, 15 con una data di rientro, 13 entro trenta giorni (Hien `titolare`
rientro 05/10, Orsolini `titolare` 25/09). *Una regola muta si legge esattamente come una regola che
funziona.*

Tre confini, e ognuno è un test: il tappo è il **pavimento che i disegnati hanno già** («chi la board
schiera non scende sotto `ballottaggio`»), quindi la regola non può portare nessuno fuori dal proprio
perimetro; non tocca chi la board non disegna, perché lì il posto è di un altro che È il suo contendente;
e **non litiga con la regola dell'08/09** — «nessuno gli contende la maglia» è falso se il padrone torna la
settimana prossima, quindi la promozione non scatta. Sono due metà di una domanda sola sullo stesso posto.

L'orizzonte è **4 partite del suo club** e non trenta giorni: è il «un mese» dell'operatore tradotto
nell'unità che sopravvive a due calendari — una giornata euro non è una giornata di Serie A (la lezione di
R20 applicata a un rientro). La quantità che decide è `desc_out_rounds`, che vale `None` quando non c'è una
data: nessuna soglia nuova, nessun parsing di date.

### 10.5 — Chi è «disponibile», e perché la panchina risponde a tre domande insieme

Il denominatore della finestra corta sono le partite in cui aveva una RIGA nel livello per-partita,
**panchina compresa**. Una partita senza riga è IGNOTA — fuori rosa, infortunato o squalificato — e nessuna
delle tre è una preferenza dell'allenatore per un altro. È anche il modo in cui questa finestra osserva
un'indisponibilità **senza unire tre tabelle**: la distinta di una partita è una lettura-di-rosa completa,
quindi vale la regola del 05/08 e la panchina batte uno stop datato (14/08). Un fatto solo che serve a
tutt'e due i lati — il denominatore suo, e il posto vuoto del rivale.

Verificato che il codice e la misura leggano la STESSA cosa: in un campionato le righe sono esattamente `p`
(minuti > 0) e `b` (minuti NULL), **zero righe `x` su 103.565** nei cinque campionati, perché il payload di
una partita di lega porta sempre le statistiche. Un test lo asserisce.

### 10.6 — Cosa NON cambia, e perché

- **La FORMA del modulo.** La board breve cambia CHI, non lo schema: un modulo modale su tre partite è una
  statistica su tre osservazioni, e i moduli hanno un giudice loro (`press --against`). Limite dichiarato,
  non dimenticanza.
- **`engine_*` e il gate.** `evaluate` non importa `presence`, quindi `backtest --verify` resta 22/22. E la
  finestra è **vuota per costruzione su una pre-stagione**, quindi ogni finestra su cui il gate ha
  pubblicato un numero legge la stagione intatta.
- **Le probabili.** `next` (la prossima giornata, pannello Tk) le legge; `short` no — una descrizione
  dell'ultimo periodo che leggesse il giornale di domani non descriverebbe più quel periodo. Le due
  differiscono per quella sola riga e condividono tutto il resto.
- **Gli indisponibili di oggi sono FUORI dalla board breve** (`gui.TODAY_MODES`), e non è una simmetria
  gratuita con `next`: la finestra di un infortunato è VUOTA, quindi la miscela gli restituirebbe lo
  standing di stagione intatto e senza l'esclusione la board breve sarebbe identica alla lunga proprio
  sugli uomini per cui l'operatore l'ha chiesta.

### 10.7 — Dove vive ogni pezzo

| pezzo | dove | natura |
|---|---|---|
| la finestra e le sue quattro costanti | `engine/presence.py` (`RecentWindow`, `recent_*`) | MISURATE, sweep-abili |
| il tappo della scala | `engine/status.py` (`owner_returning`) | DICHIARATA |
| la camminata sulle ultime partite | `snapshot.recent_block` → sei colonne `desc_recent_*` | misura |
| il confronto fra le due board | `boards._returning_owner` | dichiarata |
| le due board nello stesso file | `boards.write_boards` → `boards.json` con `short` | — |
| la scelta di quale leggere | `core/valuation-store.boardViewOf` + il pulsante su `/clubs` | display |
