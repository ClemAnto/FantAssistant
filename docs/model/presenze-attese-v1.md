# Modulo presenze attese (Pv_att) — v1 ✅ GATE SUPERATO

> ⚠️ **Verdetti superati**: questo documento descrive il modello, non l'esito del gate. I set
> adottati e le regole cadute sono in `00-BRIDGE-punto-di-ingresso.md`, blocco «STATO AL 28
> LUGLIO 2026» - fra le cadute ci sono la curva d'eta' (R4) e il fattore allenatore (R10),
> che qui potrebbero comparire come promettenti.

**Chiuso:** 22 luglio 2026 · Gate cross-fitted su due finestre (750/754 giocatori, tutto il listone)
*(Pv_att = presenze attese; gate cross-fitted = parametri stimati su una finestra e testati sull'altra; T1 = 2023/24→2024/25, T2 = 2024/25→2025/26; MAE = errore medio assoluto)*

## Modello adottato
Regressione sulla quota di presenze (share = Pv/giornate della lega, gestisce 34 vs 38):
```
share_att = 0.26 + 0.50·share_prec + 0.14·(Mv_prec − 6.2)ᶜˡⁱᵖ + 0.04·cambio_squadra
Pv_att    = share_att × giornate_lega
```
Coefficienti stabilissimi tra le due finestre (0.47/0.53 · 0.16/0.13 · 0.03/0.06); rifittati ogni stagione sulla finestra precedente. **Elo destinazione: coefficiente ≈ 0** → la forza del club NON riduce le presenze attese (risultato nullo utile: chi si trasferisce in un top club gioca quanto gli altri a parità di storia).

## ⚠️ RIMISURATO il 4 agosto 2026 — i numeri sotto sono PRE-PIATTAFORMA, e uno di essi non si riproduce

I tre numeri che l'harness del gate non riusciva a riprodurre (`backtest --verify`: 15/18 dal 28 luglio)
erano tutti di questo modulo, tutti su **T1**, e la causa è **la data di questo documento**: è chiuso il
**22 luglio 2026**, e la dimensione `platform` (`euro` | `default`, due calendari diversi) è entrata nella
spec il **25-26 luglio**. Le misure qui sotto sono quindi state fatte su un dataset che **mescolava i due
calendari** — è esattamente ciò che significa «gestisce 34 vs 38 giornate», un accoppiamento che oggi non
esiste più. Nessuna configurazione di oggi le riproduce, e per la regola del progetto («se nessuna la
riproduce, il numero è vecchio») vanno lette come storia.

**E la conclusione era data al SINGOLARE su una quantità che dipende dalla piattaforma** — l'errore che
CLAUDE.md segnala. Rimisurato oggi, finestra per finestra:

| | naive → modello, bias titolari | MAE globale | MAE titolari |
|---|---|---|---|
| **euro** (30→31 giornate) T1 | **+4.17 → −0.11** | 7.25 vs 7.12 (**+1.8%**, perde) | 6.61 vs 6.42 (+3.0%) |
| **euro** T2 | **+5.47 → +0.09** | 6.56 vs 6.70 (−2.1%) | **6.22 vs 6.80 (−8.5%)** |
| **default** (38→38) T1 | **+6.26 → −0.37** | 8.38 vs 8.84 (**−5.2%**) | — |
| **default** T2 | **+5.64 → −1.33** | 8.41 vs 8.66 (−2.9%) | — |

Come va letto, e la distinzione è quella che questo documento stesso aveva già scritto — «il valore vero è
nel bias, non nel MAE»:
- **il criterio di adozione si riproduce su tutto**: il naive promette al titolare medio **da 4 a 6 giornate
  fantasma** e il modello lascia un bias residuo intorno a zero. Su ogni finestra e su entrambe le
  piattaforme;
- **il MAE globale è dipendente dalla piattaforma**: su `default` il modulo batte il naive su entrambe le
  finestre (−5.2%, −2.9%); su `euro` solo su T2. Su euro/T1 perde dell'1.8%, e il perché è misurato: il
  **naive oggi sbaglia meno** (bias titolari 4.17 contro il 5.2 pubblicato, MAE titolari 6.42 contro 6.84)
  perché la stagione 24/25 è meglio strumentata di quanto fosse il 22 luglio, mentre il modello è fermo
  (6.61 contro 6.51). Con meno errore sistematico da togliere, il vantaggio sul MAE si assottiglia fino a
  cambiare segno — e il bias, che è il motivo dell'adozione, resta azzerato.

Conseguenze operative, già applicate:
- `engine.model.REFERENCE_GATE` porta ora la **misura di oggi con la sua piattaforma** (euro/mantra, la
  configurazione in cui i trust check girano) e i numeri di luglio nel commento, come superati;
- i check sul Pv sono diventati **controlli di regressione** («il codice calcola ancora quello che
  calcolava») invece di test sul **segno**: un test sul segno chiede all'harness di ri-dibattere il gate ogni
  volta che i dati migliorano, ed è precisamente quello che era successo;
- **aggiunto il numero che questo documento cita e che nessuno verificava**: il MAE del segmento
  **titolari** (`pv_mae_starters_*`). È il segmento su cui si decide un'asta, quindi una deriva silenziosa
  lì è quella che costa. `backtest --verify` è passato da **15/18 a 22/22**.

## Gate
- Globale: batte il naive in entrambe le finestre (T1 −1.6%, T2 −1.3%). ⚠️ **pre-piattaforma, vedi sopra**:
  oggi vale su `default` (−5.2% / −2.9%) e su `euro` solo per T2.
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
