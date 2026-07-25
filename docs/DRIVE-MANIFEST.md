# Document manifest - Google Drive (SOURCE OF TRUTH)

The consolidated documents and datasets live in the Drive folder **"Modello Previsionale Fantacalcio"**
(owner: a.clemente@fantacalcio.it). This repo does NOT keep copies of them (they would go stale): here
there is only the map with the IDs, so any session can re-download them with the Google Drive connectors.
The Drive documents themselves are in Italian (the user's knowledge base).

- Folder: `1v_PtplA9E_vwcuALwAL-23skjjoU1MqF`
- Rule: Drive is updated ONLY on the user's explicit request; the vN-1 versions are disposable.

## Reading order (initialization)

| # | Document | File ID |
|---|---|---|
| 1 | `00-BRIDGE-punto-di-ingresso.md` (entry point) | `1t_7B7MFpOSIZv-6JFbrv7XBYiL3lzK-i` |
| 2 | `stato-progetto-continuita-v4.md` (full status) | `1QmjFyV9qiB7bSiAnjPivP9rh0mAr04fS` |
| 3 | `todolist-mantra-euroleghe-v4.md` (roadmap) | `17c9w4iH22NoVi6gxeNz7BNA2hVtrbf0e` |
| 4 | `spec-euroleghe-ingest-v8.md` (toolkit spec) | `1CshEefLB6G2FNoxMFJbL86RdDmH8fuSq` |
| 5 | `nota-modello-set-pieces-v2.md` (penalty takers/set pieces) | `1GsaKRLNJiNKvSQEHQ3D4uVm45BIZ3eZF` |
| 6 | `modello-previsionale-v3.8.md` (parent doc, 22 factors) | `14cNaqt_olU0oDqYaB8S9HaaRL3FRwKmW` |

## Consolidated detail notes

| Document | File ID |
|---|---|
| `ancore-mantra-fase2_1.md` | `1DsMT__I2urhq0apviplkMEkfeLpelhhA` |
| `modulo-portieri-fase2_2.md` | `1QuCpbKAtjZBp05aTdiwWPf5wveZ85lHU` |
| `fm-per-ruolo-fase2_3-2_4.md` | `1FxON5bdxvEmvok7jmai8Sq1QRDio9C0l` |
| `backtest-mantra-fase2_5lite.md` | `1WMGmHUa0CKEjQTVlakjXhpeczM7aVhkt` |
| `ancore-lega-forzaclub-fase3_1.md` | `1KJKAKyRATB5t2KqetzNJS_fLnKQ1yLwB` |
| `clubelo-gate.md` | `13Vd_VzJo9-xC9Uz0HaI3gRyfcptndMVg` |
| `presenze-attese-v1.md` | `1MWcCbH5C7P8efOoSAs9uvxHqH9FpwH2-` |
| `dataset-euroleghe-README.md` | `1ERXu0plbc1kh325Y9synYjyV-IkQk1hp` |

## Datasets (to download into `data/raw/`)

| File | File ID | Notes |
|---|---|---|
| `Statistiche_Fantacalcio_EuroLeghe_Stagione_2025_26.xlsx` | `1LoDYCBwJjEbK54i7eZRqQe5DoLvSrY3c` | 1014 players, full schema with Mantra Rm |
| `euroleghe-stats-2024-25.csv` | `1a5HtxajKN742aahAq15gBHfxI6QWqblQ` | ⚠️ `squadra` column empty -> use the Excel for per-club analysis |
| `euroleghe-stats-2023-24.csv` | `1nrfJT4foJunqmN5hK1spIFV3D5s_WRZu` | 1125 players |
| `elo-asta-mappa-club.csv` | `1g4m21bxQDBTOrsOthShOjJmy7MEkssmW` | 38 clubs, seed of `club_xref` |
| `backtest_completo.py` (reference) | `1py4kU9YsVqnsP48AisPHKzkDyUsQYThj` | historical backtest script |
