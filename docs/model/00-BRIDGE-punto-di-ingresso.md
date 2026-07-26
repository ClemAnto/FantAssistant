# 00 — BRIDGE · Punto d'ingresso del progetto (leggere per primo)
**Aggiornato: 26 luglio 2026** · Questo file inizializza qualsiasi sessione/strumento nuovo. Il prefisso "00" lo tiene in cima alla cartella.

## Il progetto in breve
Motore previsionale per fantacalcio **EuroLeghe** (fantacalcio.it): valutazione calciatori Classic e Mantra sui 5 grandi campionati europei (Serie A, Premier, Liga, Bundesliga, Ligue 1 — perimetro: i ~35 top club del gioco). Prevede fantamedia (FM), presenze attese e VALORE stagionale = FM × presenze. Metodo scientifico: **ogni regola entra nel motore solo se batte il baseline fuori campione su finestre indipendenti** (gate pre-registrato). Stato: core validato (Mantra, Classic, portieri, presenze); manca lo strato flag/arrivi, sbloccato dal toolkit dati `euroleghe-ingest` (in implementazione).

## Casa dei documenti: GIT (non più Drive)
La knowledge base è ora nel repo git **`FantAssistant`**, cartella **`docs/model/`** (italiano, casa canonica; git gestisce il versioning). La cartella Drive "Modello Previsionale Fantacalcio" resta come **mirror/archivio** e ospita i **dataset** (xlsx/csv, non in git); c'è un marker `00-MOVED-TO-GIT.md`. Mappa ID Drive in `docs/DRIVE-MANIFEST.md`.

| Sorgente | Ruolo | Affidabilità |
|---|---|---|
| **git `docs/model/`** | FONTE DI VERITÀ: documenti consolidati, decisioni, ipotesi respinte/pre-registrate | Permanente, versionata |
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

## PROSSIMO LAVORO
1. **Scraping per-partita delle 4 leghe estere** (+ Serie A 24/25 e 25/26): comando già pronto,
   `positions --layer match`, ~2 h di rete, ripartibile. Poi ri-calibrare `synth` (avrà anche il controllo
   fuori campione) e ri-derivare `matchdays` per le leghe estere.
2. **Heatmap SofaScore → `positions.derived_role`** (fattore 21, off_role_usage): manca l'endpoint heatmap
   stagionale per giocatore.
3. Poi: `fc_site` (rigoristi/probabili/indisponibili) e `transfers` → arrivals+flag → gate 3.2 +
   FM-equivalente estera + 2.5 pieno → algoritmo completo asta 26/27.

## Convenzioni operative
git = casa canonica (Drive solo su richiesta esplicita) · risposte in chat in **italiano**, tutto il repo (codice, commenti, log, nomi file, .md) in **inglese**; i doc KB in `docs/model/` restano in italiano · `fc_id` chiave primaria · credenziali solo in `.env` · **quando l'utente scrive "chiudi"**: consolidare tutti gli .md di `docs/model/` (+ CLAUDE.md se serve) con stato/decisioni/commit/prossimi passi e committare.
