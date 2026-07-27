# 00 — BRIDGE · Punto d'ingresso del progetto (leggere per primo)
**Aggiornato: 27 luglio 2026** · Questo file inizializza qualsiasi sessione/strumento nuovo. Il prefisso "00" lo tiene in cima alla cartella.

## Il progetto in breve
Motore previsionale per fantacalcio **EuroLeghe** (fantacalcio.it): valutazione calciatori Classic e Mantra sui 5 grandi campionati europei (Serie A, Premier, Liga, Bundesliga, Ligue 1 — perimetro: i ~35 top club del gioco). Prevede fantamedia (FM), presenze attese e VALORE stagionale = FM × presenze. Metodo scientifico: **ogni regola entra nel motore solo se batte il baseline fuori campione su finestre indipendenti** (gate pre-registrato). Stato: core validato (Mantra, Classic, portieri, presenze); manca lo strato flag/arrivi, sbloccato dal toolkit dati `euroleghe-ingest` (in implementazione).

## Casa dei documenti: GIT (non più Drive)
La knowledge base è ora nel repo git **`FantAssistant`**, cartella **`docs/model/`** (italiano, casa canonica; git gestisce il versioning). La cartella Drive "Modello Previsionale Fantacalcio" resta come **mirror/archivio** e ospita i **dataset** (xlsx/csv, non in git); c'è un marker `00-MOVED-TO-GIT.md`. Mappa ID Drive in `docs/DRIVE-MANIFEST.md`.

| Sorgente | Ruolo | Affidabilità |
|---|---|---|
| **git `docs/model/`** | FONTE DI VERITÀ: documenti consolidati, decisioni, ipotesi respinte/pre-registrate | Permanente, versionata |
| **GitHub `ClemAnto/FantAssistant`** | remote `origin` (repo **pubblico**), branch `master` | Copia remota della verità |
| **Drive (cartella progetto)** | Archivio/mirror + dataset (xlsx/csv) | Non più aggiornato (solo su richiesta esplicita) |
| **Memoria Claude del progetto** | Riassunto automatico per ripartire in fretta | Cache: comoda ma MAI fonte di verità |
| **Credenziali fantacalcio.it** | Solo in `.env` locale | MAI su Drive/chat/repo/log |

## Ordine di lettura per una nuova sessione
`00-BRIDGE` (questo) → `stato-progetto-continuita-v5.md` → `todolist-mantra-euroleghe-v5.md` → `spec-euroleghe-ingest-v9.md` → `nota-modello-set-pieces-v2.md` → `modello-previsionale-v3.8.md` → consolidati di dettaglio. Tutti in `docs/model/`.

## STATO PRECEDENTE (primo giro toolkit, 26 luglio 2026)
**Toolkit `euroleghe-ingest` — primo giro IMPLEMENTATO** (Python 3.13, venv in `toolkit/.venv`, SQLite `data/euroleghe.db`, GUI Tkinter `python -m euroleghe_ingest gui`):
- **Operativi**: `rosters`, `stats`, `ratings` (scraping Excel autenticato **+ listone quotazioni**), `arrivals`, `elo`, `validate`, `rebuild` (idempotente, reset in-place). GUI: vista calciatori (pillole ruolo colorate, ordinamento persistente per ruolo, toggle Fantavoti a griglia, icona campetto).
- **Dati scaricati e riallineati**: voti EuroLeghe (`platform='euro'`) + Serie A classica (`platform='default'`) per 2023-24/24-25/25-26; **listoni** (ruoli Mantra + prezzi, fogli Tutti+Ceduti) per entrambe le piattaforme → Serie A copertura Mantra ~96%, prezzi anche su Premier/Liga/Bundes/Ligue1. `rebuild` verde (allora 234 FM-off nel soft check: causa individuata e corretta in fase 1, ora 0).
- **Decisioni chiave** (dettaglio in `spec-euroleghe-ingest-v9.md`): `platform` = euro|default in PK (calendari diversi) · `gameType` = classic|mantra (motore) · aggregazione opzione A · `season_stats` per piattaforma · propensione stagione piena (FBref fatti + Sofascore rating/heatmap + **voto sintetico calibrato**, mai nel target euro; tutto passa dal gate) · mappa giornate euro↔reali **per lega**.
- **Code review** fatta (robustezza: utf-8-sig/BOM, scritture atomiche + try/except nei reingest, retry di rete, indici DB; consolidamenti). Scartato l'aggiunta del bonus imbattibilità al fantavoto grezzo (verificato: peggiora la coerenza FM). Ruff pulito, 25 test verdi (+1 skip GUI headless).

**Commit** (branch `master`): `0bceb23` platform · `85b7a09` season_stats per-piattaforma · `258905e` listone · `7619d27` listone Ceduti · `e7e2394` migrazione doc in git · `b831f5f` code review.

## FASE 1 — FATTA (26 luglio 2026), con SofaScore al posto di FBref
Dettaglio tecnico e numeri in `spec-euroleghe-ingest-v9.md` → «Novità v9.1».
- **FBref è bloccato** (interstitial Cloudflare: 403 su ogni path anche con impersonation TLS) → **SofaScore
  è la fonte primaria dei fatti**: stessi dati (gol/assist/minuti/xG/xA) **più il rating per-partita** che
  serve al voto sintetico. FBref resta arricchimento futuro (rigori di carriera, piazzati) via browser
  headless o inbox manuale. Client `curl_cffi` (impersonate chrome): `requests` prende 403.
- **Nuove tabelle**: `external_stats`, `external_match_stats`, `matchday_map`. **Nuovi moduli**: `matchdays`
  (calendario euro↔reale) e `synth` (voto sintetico); `positions` è il modulo SofaScore
  (`--layer season|match|all`). Identità in `matching.py` (tier + pool club→lega→stagione, iniettività
  fc_id↔id provider, `manual_overrides` con precedenza, non risolti nel `coverage_report`).
- **BUG CORRETTO: rigori invertiti** nell'Excel dei voti (`Rf` = fatti, `Rs` = sbagliati; erano scambiati) →
  ai rigoristi il fantavoto applicava −3 invece di +3. **Il check FM è passato da 234 fuori tolleranza a 0.**
- **Validazioni**: gol SofaScore vs Serie A `default` **100% esatti** su 3 stagioni · copertura perimetro
  **96–100%** · la mappa giornate da SofaScore concorda **29/29** con quella dai nostri voti.
- **Voto sintetico**: retta per ruolo sul Mv euro (pendenza 0.52 P → 0.84 A), MAE 0.358 vs 0.460 baseline.
- **Vista calciatori**: griglia sul calendario **reale** con le giornate fuori dal calendario euro colorate
  a parte (valore = voto sintetico). Test: 52 verdi. `rebuild` offline verde.

## STRATO FLAG/ARRIVI — FATTO (27 luglio 2026)
Dettaglio e numeri in `spec-euroleghe-ingest-v9.md` → «Novità v9.2». In sintesi, le tabelle che erano
vuote ora ci sono: `penalty_hierarchy` 1463 · `probable_starter` 442 · `availability` 103 ·
`positions` 3862 · `flags` 837 · `arrivals.tier` 1390 e `foreign_fm_equiv` 655 · `birth_year` 1861 ·
`tournaments_squads` (Mondiale 2026: 344 giocatori del perimetro, 95 247 minuti) · `coaches` e
`transfers_history` da Transfermarkt.
- **Rigoristi**: la pagina ufficiale è ancora vuota (preseason) → implementata la **gerarchia
  rivelata** dai nostri voti, che lo spec mette comunque al primo posto (918 rigori).
- **Ruolo reale gratis**: il layer per-partita aveva già la posizione su 100% delle righe → 312 flag
  `off_role_usage` senza una richiesta in più.
- **FM-equivalente estera**: calcolata sulla stagione reale piena, **+0.035 di scarto medio** dalla
  FM euro reale dove possiamo confrontarle. È l'input che mancava al gate 3.2.
- ⚠️ **Parametri provvisori** (`DECAY`/`MISS_PENALTY` dei rigoristi, soglie di tier): sono scelte di
  modello, le possiede il gate. Non usarli come stabiliti.

## HARNESS DEL GATE — ESISTE (27 luglio 2026)
Il collo di bottiglia storico è stato affrontato: la regola d'oro ora ha **forma eseguibile**.
`toolkit/euroleghe_ingest/engine/` (model · fitting · features · evaluate) + comando
`python -m euroleghe_ingest backtest`, **read-only** sul DB, scrive solo
`data/reports/engine_backtest.json`. È anche il **riferimento da cui portare il motore TypeScript**
in `app/prediction-engine`, quindi resta senza dipendenze ed esplicito.
- `backtest --verify` **riproduce 15 numeri pubblicati su 18** (ancore Classic/Mantra, beta Mantra,
  coefficienti Pv, portieri M2e su entrambe le finestre, bias titolari T2).
- **3 da rivedere, tutti sul modulo presenze in T1**: `pv_gain_vs_naive_T1` (atteso −0.016, ottenuto
  +0.018), `pv_bias_naive_starters_T1` (5.2 → 4.17), `pv_gain_crossfit_T1` (−0.016 → +0.013). In T2
  tornano. **Finché non è chiarito, il guadagno del modulo presenze su T1 non è confermato.**
- L'**inventario input** stampato dice cosa manca al motore: su T2/euro `starter_prob` è **0/1453**
  (le probabili sono di oggi, non della stagione passata → servono snapshot settimanali).

## PROSSIMO LAVORO
1. **Chiarire i 3 numeri presenze/T1**: è l'unico punto dove harness e documenti non concordano.
   Prima di questo, non aggiungere regole.
2. **Eseguire i gate ora possibili**: 3.2 club-a-club con ClubElo (input pronto), 2.5 pieno con i
   flag, e **tarare i parametri provvisori** del 27/07 (decadimento/quarantena rigoristi, soglie tier,
   U22) — sono scelte di modello, non dati.
3. **Dati ancora mancanti**: `injuries` + flag `exit_risk`; heatmap per `avg_x/avg_y`;
   `starter_prob` storico; `fbref` (bloccato da Cloudflare).
4. **Ad agosto, quando esce**: listone/quotazioni 26/27 → aggiungere `2026-27` alle costanti `SEASONS`
   (`ratings.py`, `positions.py`, `transfers.py`), scaricare voti e Elo alla data d'asta 2026-08.
5. Poi: algoritmo completo asta 26/27.

## Convenzioni operative
git = casa canonica (Drive solo su richiesta esplicita) · risposte in chat in **italiano**, tutto il repo (codice, commenti, log, nomi file, .md) in **inglese**; i doc KB in `docs/model/` restano in italiano · `fc_id` chiave primaria · credenziali solo in `.env` · **quando l'utente scrive "chiudi"**: consolidare tutti gli .md di `docs/model/` (+ CLAUDE.md se serve) con stato/decisioni/commit/prossimi passi e committare.
