# 00 — BRIDGE · Punto d'ingresso del progetto (leggere per primo)
**Aggiornato: 22 luglio 2026** · Questo file inizializza qualsiasi device, sessione o strumento nuovo. Il prefisso "00" lo tiene in cima alla cartella.

## Il progetto in breve
Motore previsionale per fantacalcio **EuroLeghe** (fantacalcio.it): valutazione calciatori Classic e Mantra sui 5 grandi campionati europei (Serie A, Premier, Liga, Bundesliga, Ligue 1 — perimetro: i ~35 top club del gioco). Prevede fantamedia (FM), presenze attese e VALORE stagionale = FM × presenze. Metodo scientifico: **ogni regola entra nel motore solo se batte il baseline fuori campione su finestre indipendenti** (gate pre-registrato). Stato: core validato (Mantra, Classic, portieri, presenze); manca lo strato flag/arrivi, sbloccato dal toolkit dati `euroleghe-ingest` (da implementare).

## Le sorgenti di conoscenza e i loro ruoli
| Sorgente | Ruolo | Affidabilità |
|---|---|---|
| **Questa cartella Drive** ("Modello Previsionale Fantacalcio") | FONTE DI VERITÀ: documenti consolidati, dataset, decisioni, ipotesi respinte/pre-registrate | Permanente, autosufficiente |
| **Chat Claude del progetto** (claude.ai, progetto dedicato) | Storia decisionale e analisi completa; ricercabile dalle sessioni future | Persistente ma verbosa: le conclusioni sono GIÀ nei consolidati |
| **Memoria Claude del progetto** | Riassunto automatico per ripartire in fretta | Cache volatile: comoda ma MAI fonte di verità |
| **Ambiente locale VS Code + Claude Code** | Implementazione del codice (toolkit, prediction-engine) | Il codice fa fede una volta scritto; briefing locale in CLAUDE.md |
| **Credenziali fantacalcio.it** | Solo in `.env` locale sul computer | MAI su Drive, MAI nelle chat, MAI nel repository |

## Inizializzare un device/strumento nuovo
- **Nuova chat Claude (anche senza memoria)**: leggere `stato-progetto-continuita-v4.md` → si riparte con contesto completo.
- **Claude Code su un computer nuovo**: creare cartella progetto, scaricare da Drive i doc in `docs/` e i dataset in `data/raw/`, creare `CLAUDE.md` nella radice con il template qui sotto, `.env` con le credenziali (in `.gitignore` e `.claudeignore`).
- **Qualsiasi altro strumento/persona**: ordine di lettura → questo file → continuità v4 → roadmap v4 → spec v8 → note di modello → consolidati di dettaglio.

## Template CLAUDE.md (per l'ambiente locale)
```markdown
# euroleghe-ingest — briefing
Prima di qualsiasi lavoro leggi docs/stato-progetto-continuita-v4.md.
Spec da implementare: docs/spec-euroleghe-ingest-v8.md (fc_id chiave primaria,
identificatori in inglese, nessun passaggio manuale obbligatorio, stati volatili
come serie temporali, scoring_config parametrico per lega).
Modello: docs/nota-modello-set-pieces-v2.md e consolidati in docs/.
Regola d'oro: nessuna regola di previsione si adotta senza gate fuori campione.
Credenziali in .env (mai leggerle nei log, mai committarle).
Dataset in data/raw/ (fonte di verità: la cartella Drive del progetto).
```

## Mappa dei documenti (versioni correnti — le vecchie vN∑1 sono cestinabili)
1. `00-BRIDGE` (questo file) — punto d'ingresso
2. `stato-progetto-continuita-v4.md` — stato completo e autosufficiente
3. `todolist-mantra-euroleghe-v4.md` — roadmap e percorso critico
4. `spec-euroleghe-ingest-v8.md` — specifica del toolkit dati
5. `nota-modello-set-pieces-v2.md` — modello rigoristi/piazzati (pre-registrato)
6. `modello-previsionale-v3_8.md` — documento madre del modello
7. Consolidati di dettaglio: ancore-mantra-fase2_1 · modulo-portieri-fase2_2 · backtest-mantra-fase2_5lite · fm-per-ruolo-fase2_3-2_4 · ancore-lega-forzaclub-fase3_1 · clubelo-gate · presenze-attese-v1 · dataset-euroleghe-README
8. Dati: euroleghe-stats-*.csv, Excel stagioni, elo-asta-mappa-club.csv

## Convenzioni operative
Drive si aggiorna SOLO su richiesta esplicita dell'utente · versioning vN sostituisce vN−1 · identificatori di codice in inglese · sigle spiegate tra parentesi a fine frase · file grossi a Claude: allegati in chat (graffetta), non nella Knowledge del progetto · consolidare su Drive a fine sessione.
