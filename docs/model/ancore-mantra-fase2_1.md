# Fase 2.1 — Àncore e BETA per ruolo Mantra (scala Euroleghe) ✅
**Chiusa:** 21 luglio 2026 · Stagioni 2023/24, 2024/25, 2025/26 · Pv≥20 (àncore), Pv≥15 (coppie BETA)

## Integrità dati ✅
- Àncore Classic ricalcolate = valori README v2 su tutte e 12 le celle (P/D/C/A × 3 stagioni).
- Cross-validazione CSV (scraping MHT) vs Excel ufficiale 24/25: **1060/1060 identici** su Pv, Mv, Fm, Rm.

## Àncore Mantra — variante frazionaria (ADOTTATA)
FM del multi-ruolo contata 1/k su ciascuno dei k ruoli. Scarto medio tra stagioni: frazionaria 0.05 vs ruolo-primario 0.10; sui ruoli sottili la differenza è decisiva (e: 6.27/6.24/6.23 vs 6.32/6.50/6.40 del primario; t: 6.83/6.80/6.69 vs 7.17/7.09/6.83).

| Ruolo | 23/24 | 24/25 | 25/26 | **Àncora motore** |
|---|---|---|---|---|
| por | 4.98 | 5.01 | 4.99 | **5.00** |
| dc | 5.97 | 5.97 | 6.01 | **5.98** |
| b | — | — | 6.14 (n=5) | **= dc** (provvisoria) |
| ds | 6.19 | 6.05 | 6.07 | **6.10** |
| dd | 6.15 | 6.08 | 6.07 | **6.10** |
| e | 6.27 | 6.24 | 6.23 | **6.25** |
| m | 6.24 | 6.29 | 6.24 | **6.26** |
| c | 6.39 | 6.33 | 6.33 | **6.35** |
| w | 6.78 | 6.74 | 6.70 | **6.74** |
| t | 6.83 | 6.80 | 6.69 | **6.77** |
| a | 7.07 | 7.19 | 7.10 | **7.12** |
| pc | 7.54 | 7.52 | 7.15 | **7.40 ⚠️** |

Note:
- **Gradiente monotono** por→pc come atteso. Le àncore Classic mediavano spread interni fino a 0.5 punti (m 6.26 vs t 6.77 dentro la C; a 7.12 vs pc 7.40 dentro la A).
- **⚠️ pc instabile nel 25/26** (7.15 vs 7.52-7.54): effetto ambiente-gol di stagione, speculare al calo dell'àncora Classic A (7.34→7.16). Conferma il ricalcolo stagionale automatico (task 3.1) e suggerisce di valutare àncore con peso di recenza.
- **Ruolo B (braccetto)**: introdotto nel listone 25/26, campione insufficiente (n=5) → àncora = dc finché non matura.

## BETA con àncore Mantra
Due finestre indipendenti: **0.382** (23/24→24/25, 349 coppie) e **0.448** (24/25→25/26, 367 coppie).

- **BETA Mantra adottato: 0.42** (media delle due stime). Sistematicamente sotto lo 0.50 Classic: le àncore fini assorbono più varianza sistematica, resta meno persistenza da regredire. **Nel motore Mantra il BETA non si eredita dal Classic.**
- **Beta per gruppo di ruolo: NON adottati** (gate fallito). Instabili tra finestre: dc 0.51→0.22, mediani 0.23→0.49. Unico segnale coerente: attacco alto in entrambe (0.48/0.59) e terzini/portieri bassi (0.27-0.34) → candidati a pre-registrazione per verifica a giugno 2027, non regole attive.

## Formula motore Mantra (consolidata)
`FM = ANCORA_M(rm) + 0.42 × (FM_prec − ANCORA_M(rm)) + Σ flag`
con ANCORA_M frazionaria dalla tabella sopra, rm = ruolo Mantra previsto per la stagione target (i flag avanzamento/fuori_ruolo diventano cambi di àncora, task 2.4).

## Prossimi passi
1. **2.2 Modulo portieri** (bloccante Mantra): àncora 5.00 solida; manca il modello gol subiti attesi (ClubElo) + clean sheet + rigori parati. Gate: MAE < naive. → CHIUSO, vedi modulo-portieri-fase2_2.md
2. 2.3 FM per ruolo posseduto + bonus flessibilità multi-ruolo.
3. Pre-registrare per giugno 2027: beta attacco alto / difesa bassa · àncora pc con peso recenza · àncora B dedicata quando n cresce.
