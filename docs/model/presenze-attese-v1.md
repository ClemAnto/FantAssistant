# Modulo presenze attese (Pv_att) — v1 ✅ GATE SUPERATO
**Chiuso:** 22 luglio 2026 · Gate cross-fitted su due finestre (750/754 giocatori, tutto il listone)
*(Pv_att = presenze attese; gate cross-fitted = parametri stimati su una finestra e testati sull'altra; T1 = 2023/24→2024/25, T2 = 2024/25→2025/26; MAE = errore medio assoluto)*

## Modello adottato
Regressione sulla quota di presenze (share = Pv/giornate della lega, gestisce 34 vs 38):
```
share_att = 0.26 + 0.50·share_prec + 0.14·(Mv_prec − 6.2)ᶜˡⁱᵖ + 0.04·cambio_squadra
Pv_att    = share_att × giornate_lega
```
Coefficienti stabilissimi tra le due finestre (0.47/0.53 · 0.16/0.13 · 0.03/0.06); rifittati ogni stagione sulla finestra precedente. **Elo destinazione: coefficiente ≈ 0** → la forza del club NON riduce le presenze attese (risultato nullo utile: chi si trasferisce in un top club gioca quanto gli altri a parità di storia).

## Gate
- Globale: batte il naive in entrambe le finestre (T1 −1.6%, T2 −1.3%).
- **Il valore vero è nel bias, non nel MAE**: il naive sbaglia sistematicamente —
  | Segmento | bias naive | bias modello |
  |---|---|---|
  | Titolari (share≥0.7) | **+5.2 / +5.3 giornate** | +0.4 / −0.2 |
  | Rotazione | +1.4 / +0.4 | +0.4 / −0.9 |
  | Fringe (<0.4) | −3.9 / −3.6 | −0.1 / +0.4 |
- Sui titolari (il segmento d'asta) anche il MAE migliora: 6.84→6.51 e 6.71→6.27 (−5%/−7%).
- **Lezione d'asta**: il titolare medio da 34 presenze ne fa ~29 l'anno dopo. Chi compra proiettando le presenze dell'anno scorso paga sistematicamente ~5 giornate fantasma.

## Metrica di valore stagionale (nuova, per il rank d'asta)
`VALORE = FM_pred × Pv_att` — ora il motore può ordinare per valore atteso, non solo per rendimento a partita. Con bias ≈ 0 su entrambi i fattori, il prodotto è non distorto.

## Limiti onesti
- MAE assoluto ~6.5-8 giornate: le presenze restano intrinsecamente rumorose all'asta (infortuni, mercato invernale, gerarchie che saltano). Il modulo corregge il sistematico, non l'imprevedibile → candidato naturale per gli intervalli di incertezza (task futuro).
- Upgrade path: minuti giocati FBref (titolare vero vs presenzialista da spezzoni) · curve età dallo storico 2017-2023 · flag infortunio-cronico (dataset flag).

## Stato algoritmo dopo questo modulo
Core Mantra ✅ · Portieri M2e ✅ · Presenze attese ✅ → **manca solo lo strato flag/arrivi** (dataset) per l'algoritmo completo di valutazione. Le presenze erano il buco n.2 della lista: chiuso.
