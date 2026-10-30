# Pre-registrazione (scritta prima di qualunque fit, 30/10/2026)

Bersaglio: il voto base (`match_ratings.mv`) di una partita giocata, senza il rating del provider.
Misura: MAE sul voto, leave-one-season-out su 7 stagioni (2019-20 ... 2025-26).
Giudice principale: le righe ESTERE della piattaforma euro (Premier, Liga, Bundesliga, Ligue 1),
perche' e' li' che il voto sintetico serve. Serie A (default) come seconda popolazione.

Basi sulle STESSE righe: (a) media di ruolo; (b) ruolo + risultato (V/N/P, differenza reti);
(c) la retta sul rating del provider per ruolo (la forma di `mv_synth`, rifittata sugli stessi fold) = l'asticella.

Verdetti, decisi ora:
- EQUIVALENTE a mv_synth: MAE <= (c) + 0,03 su almeno 6 stagioni di 7, nessun ruolo peggiore di (c) di oltre 0,10.
- UTILIZZABILE come ripiego: batte (b) su 7 stagioni di 7 E chiude almeno il 50% del divario fra (b) e (c)
  in media, sulle righe estere.
- altrimenti RESPINTO: il ripiego resta l'ancora di ruolo.
Le statistiche che oggi vengono solo da SofaScore (tiri, passaggi chiave, tocchi) si misurano a parte,
come stima di quanto aggiungerebbe ESPN (che porta tiri e tiri in porta, non passaggi chiave ne' tocchi).
