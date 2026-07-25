# FantAssistant - briefing (read first)

Monorepo for the **EuroLeghe fantacalcio prediction engine**. Two parts:

- `toolkit/` - **euroleghe-ingest** (Python/SQLite): the data pipeline that feeds the engine, with
  a **lightweight UI** (Tkinter, `python -m euroleghe_ingest gui`) as the operator panel. **Work in progress.**
- `app/` - **final assistant** (Electron + Angular, TypeScript) with the `prediction-engine`. **Placeholder**:
  initialized after the toolkit (see roadmap).
- `config/` - shared configuration (`scoring_config.json`, per-league scoring) read by both the toolkit and the engine.
- `docs/` - manifest of the Drive documents (source of truth). `data/` - local datasets (rebuildable).

## Language convention
Chat replies to the user: **Italian**. Everything in the repo (code, comments, logs, UI strings, file names,
Markdown docs): **English**. The Google Drive documents are the user's Italian knowledge base (source of truth)
and stay in Italian.

## Reading order for a new session
Before any work, read from the Drive folder "Modello Previsionale Fantacalcio" (in Italian):
`00-BRIDGE-punto-di-ingresso.md` -> `stato-progetto-continuita-v4.md` -> `todolist-mantra-euroleghe-v4.md` ->
`spec-euroleghe-ingest-v8.md` -> `nota-modello-set-pieces-v2.md` -> `modello-previsionale-v3.8.md` -> consolidated notes.
File IDs are in [docs/DRIVE-MANIFEST.md](docs/DRIVE-MANIFEST.md).

## Golden rule (gate)
No prediction rule enters the engine without winning the **pre-registered out-of-sample gate**
on two independent windows (T1 23/24->24/25, T2 24/25->25/26). Overall MAE must never get worse.

## Toolkit principles (spec v8)
- `fc_id` (fantacalcio.it id) = **primary key**; the other sites live in `player_xref`/`club_xref`.
- Code identifiers in **English** (tables, columns, modules, variables).
- Raw files (Drive) = source of truth; the **DB is always rebuildable from scratch** (idempotent `rebuild`).
- No mandatory manual step; `manual_overrides` = optional highest-precedence overrides only.
- Volatile states (penalty takers, starters, injuries) = **dated time series** (`valid_from`), never static flags.
- `scoring_config` is **per-league parametric** (non-standard scoring changes the EV): no hard-coded +3/-3/+1.

## Credentials & security
fantacalcio.it credentials **only** in the local `.env` (see `.env.example`). NEVER on Drive, in chats,
in the repository, or in logs. `.env` is in `.gitignore` and `.claudeignore`.

## Conventions
Drive is updated ONLY on the user's explicit request · versioning vN replaces vN-1 ·
consolidate on Drive at the end of a session.
