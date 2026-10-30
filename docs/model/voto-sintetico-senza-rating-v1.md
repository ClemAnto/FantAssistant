# Voto sintetico SENZA il rating del provider — v1 (30/10/2026)

**Perché.** `mv_synth` converte il rating SofaScore in un voto sulla scala del fantacalcio, ed è il voto delle
partite che il fantacalcio non vota (campionati esteri per chi arriva, coppe, amichevoli). SofaScore risponde
403 dal 24/09/2026, quindi da allora quel rating non arriva più. Richiesta dell'operatore: inventare una
funzione che ricrei il voto da risultato, Elo, bonus della partita e qualche statistica in più, e confrontarla
coi voti veri delle stagioni passate. Due sue indicazioni hanno dato la forma alla misura:
- partire dalla regola classica — 6 di base, +1 al gol, +0,5 all'assist, −1 ai difensori quando la squadra
  prende molti gol, +0,5 ai centrocampisti quando ne fa molti;
- guardare anche «all'inverso»: quanto il risultato e la difficoltà muovono i voti veri.

Arnese e script: `toolkit/scripts/synth_vote/` (`PREREG.md` è il criterio scritto prima di qualunque fit). Gli
script leggono una COPIA privata del DB e i percorsi sono quelli della sessione: per rigirarli si cambia la
prima riga. Coefficienti in `coef_L3.json` (proposta), `coef_operator.json` (la sua forma, fittata) e
`coef_M1pos.json`.

## 1. Criterio pre-registrato
Bersaglio il voto base (`match_ratings.mv`) di una partita giocata, con MAE lasciando fuori una stagione alla
volta su 7 stagioni (2019-20 … 2025-26). Il giudice principale sono le righe ESTERE della piattaforma euro,
perché è lì che il voto sintetico serve; la Serie A è la seconda popolazione. L'asticella è la retta sul rating
per ruolo, cioè la forma di `mv_synth`, rifittata sugli stessi fold. I verdetti:
- **EQUIVALENTE** se la MAE resta entro l'asticella + 0,03 su 6 stagioni di 7, senza ruoli peggiori di 0,10;
- **UTILIZZABILE** se batte «ruolo + risultato» su 7 di 7 e chiude almeno metà del divario con l'asticella;
- **RESPINTO** altrimenti.

## 2. Dati
138.794 voti veri: 75.183 di Serie A (`default`) e i quattro esteri da `euro`, con la giornata reale da
`matchday_map`.
- Minuti, titolare e posizione vengono da `tm_appearances` (copertura 91-100%).
- Il risultato si ricava dai voti stessi: gol fatti = `goals + pen_scored`, gol subiti dal portiere.
  Concorda col portiere avversario nel 99,4% dei casi.
- I club sono uniti per identità (`club_index`), mai per nome.
- L'Elo è l'istantanea pre-stagione.
- Transfermarkt concorda col voto del fantacalcio sui gol nel 99,99% dei casi, sui cartellini nel 99,8%, sugli
  assist nel 98,3%.

## 3. Verdetto: EQUIVALENTE, anzi migliore
| Modello | MAE estero | MAE Serie A | entro ±0,5 (estero) |
|---|---|---|---|
| (a) media del ruolo | 0,489 | 0,474 | 57% |
| (b) ruolo + risultato | 0,428 | 0,423 | 68% |
| **regola dell'operatore così com'è** | 0,350 | 0,366 | 88%¹ |
| stessa forma, coefficienti fittati | 0,343 | 0,364 | 76% |
| + termini classici (rosso, rigori, autogol, porta inviolata) | 0,313 | 0,328 | 79% |
| + minuti e titolare | 0,304 | 0,313 | 81% |
| **+ Elo e campo = L3 (proposta)** | **0,303** | **0,310** | 81% |
| + tiri e tiri in porta (li porterebbe ESPN) | 0,302 | 0,309 | 81% |
| + passaggi chiave e tocchi (solo SofaScore) | 0,297 | 0,299 | 82% |
| (c) retta sul rating = `mv_synth` | 0,372 | 0,363 | 72% |

¹ Scrive solo mezzi punti e spesso esattamente 6, quindi quella quota è alta per costruzione: conta la MAE.

- L3 batte la retta sul rating su **6 stagioni di 6 all'estero e 7 di 7 in Serie A**.
- Arrotondata al mezzo punto L3 sbaglia 0,279 / 0,286, e sul fantavoto l'errore è lo stesso del voto (i bonus
  sono fatti noti).
- Fittata sulla Serie A e provata all'estero regge (0,312).
- **Unico ruolo che perde: il portiere**, 0,368 contro 0,333. Gli mancano le parate, che porta solo ESPN.
- Il voto medio dell'anno prima del giocatore come prior non aggiunge niente (0,302 → 0,302).

## 4. La regola dell'operatore, dichiarata contro misurata
| Termine | Dichiarato | Misurato, stessa forma | Misurato con i termini classici |
|---|---|---|---|
| base | 6 | P 6,21 · D 5,90 · C 5,87 · A 5,75 | P 6,32 · D 5,86 · C 5,87 · A 5,72 |
| gol | +1 | +0,97 / +0,97 / +0,99 (D/C/A) | +0,94 / +0,94 / +0,98 |
| assist | +0,5 | +0,60 / +0,60 / +0,65 | +0,56 / +0,56 / +0,63 |
| 3+ gol subiti, difensori | −1 | −0,65 (P −0,39 · C −0,35 · A −0,21) | −0,37 |
| 3+ gol fatti, centrocampisti | +0,5 | +0,21 (D +0,17 · A +0,14) | ~0 (lo assorbe la vittoria) |

In sintesi:
- gol e assist sono giusti al decimo, e l'assist vale un po' di più (0,6);
- la base è circa 5,8 e non 6;
- «molti gol» vale circa la metà del dichiarato, perché quasi tutto lo porta già il risultato.

Fra i termini dell'«ecc.» pesano:
- espulsione −1,0 (portiere −1,4), rigore sbagliato −0,8, autogol −0,55, rigore parato +1,0;
- vittoria +0,15, sconfitta −0,20;
- porta inviolata per un difensore +0,30, ogni gol subito dal portiere −0,14;
- subentrato per 30 minuti o meno +0,15.

Pesano zero l'ammonizione (fra −0,01 e −0,07) e la porta inviolata per centrocampisti e attaccanti.

## 5. All'inverso: quanto la partita muove il voto vero
Media del voto per fascia, contro la media del ruolo:
- **Gol subiti 0 / 1 / 2 / 3+**:
  - difensori +0,36 / +0,09 / −0,20 / −0,57;
  - portieri +0,20 / +0,04 / −0,10 / −0,33;
  - centrocampisti +0,21 / +0,05 / −0,12 / −0,34;
  - attaccanti +0,15 / +0,04 / −0,08 / −0,25.
- **Gol fatti 0 / 1 / 2 / 3 / 4+**:
  - attaccanti −0,52 / −0,14 / +0,19 / +0,46 / +0,75;
  - centrocampisti −0,33 / −0,09 / +0,12 / +0,30 / +0,47;
  - difensori −0,23 / −0,06 / +0,09 / +0,19 / +0,31;
  - portieri piatto.
- **Vittoria / pareggio / sconfitta**: giocatori di movimento da +0,29 a +0,37 / circa 0 / da −0,34 a −0,41;
  portieri +0,10 / +0,04 / −0,16.
- **Casa / fuori**: ±0,04-0,06.
- **Partita facile / media / difficile** (`fixtures.edge`, margine 75, vantaggio casa 35; la fascia «difficile»
  è lo specchio a −75): da +0,08 a +0,12 / circa 0 / da −0,12 a −0,17.
- **Correlazioni al netto di gol, assist, cartellini, rigori e minuti del giocatore stesso**:
  - differenza reti: D 0,52 · C 0,44 · A 0,33 · P 0,22;
  - gol subiti: D −0,58 · C −0,38 · P −0,34 · A −0,24;
  - gol fatti: D 0,20 · C 0,26 · A 0,23 · P 0,01.

  Quindi gli effetti di squadra non sono i bonus del giocatore travestiti, e **i gol subiti pesano più dei gol
  fatti per tutti i ruoli**.
- **La difficoltà, a risultato noto, si inverte e quasi sparisce**: da +0,02 a +0,06 per chi ottiene lo stesso
  risultato da sfavorito, 0,001-0,002 di MAE. La difficoltà sta tutta nel punteggio, e come termine separato non
  serve.

## 6. La funzione proposta, L3 (senza dipendenze)
`voto = base[ruolo] + Σ coef[ruolo][x] · x`. Variabili:
- eventi propri: gol (rigori compresi), assist, cartellini, rigori sbagliati, autogol; per il portiere gol
  subiti e rigori parati;
- risultato: vittoria, sconfitta, differenza reti (fino a ±3), gol fatti e subiti dalla squadra (fino a 5),
  3+ subiti, 3+ fatti, porta inviolata per D e P con almeno 60 minuti;
- tempo in campo: minuti/90, titolare, subentrato per 30 minuti o meno, differenza reti × minuti/90;
- forza: differenza Elo /100, Elo della squadra, campo.

Coefficienti in `coef_L3.json`. Basi: P 6,04 · D 6,03 · C 5,73 · A 5,66.

**Limiti.**
- Il portiere perde per le parate mancanti.
- Senza minuti (né Transfermarkt né ESPN) si torna verso 0,311.
- Senza rigori e autogol esteri si sale a 0,306.
- L'errore per singola partita resta circa 0,3, e la coda è il migliore in campo senza nessun evento registrato.
- L'Elo è una lettura per stagione e non per partita.

**Cosa aggiunge ESPN.**
- Minuti e cambi, rigori e autogol dai `keyEvents`, le parate per il portiere (non misurabili sullo storico).
- Tiri e tiri in porta valgono 0,001.
- Passaggi, contrasti e tocchi ESPN non li porta, e il loro equivalente SofaScore varrebbe solo 0,005-0,010.

## 7. Aperti
- **Dove entra L3 è una decisione dell'operatore.** `mv_synth` alimenta percorsi giudicati (le tier degli
  arrivi, l'FM-equivalente, `est_*`), quindi L3 come gradino dove il rating manca va misurata lì prima di
  sostituire qualunque cosa.
- La ricerca ha trovato `mv_synth` **vuoto dal 2024-25** sulle righe delle cinque leghe: va verificato sul DB
  vivo prima di crederci (potrebbe essere la popolazione della query).
- Il portiere aspetta le parate di ESPN (passo 2, il livello per-partita).
