# Nota di modello — Set pieces v2: rigoristi e specialisti da piazzato
**Aggiornata: 22 luglio 2026 (v2 — SOSTITUISCE la v1)** · Ipotesi PRE-REGISTRATE per il backtest 2.5 pieno · Dati: coperti dalla spec toolkit v8

> ## ⚠️ ESITO DEL GATE (27 luglio 2026) — leggere prima di lavorare su questa nota
> - **`set_piece_duty` NON È MISURABILE con i dati attuali.** La colonna `assists_set_piece` è **NULL su
>   tutte le ~18.000 righe di voti di ogni stagione**: la sorgente non ha mai splittato gli assist. Non
>   è un'ipotesi che ha fallito il gate, è un'ipotesi che non può entrarci. Serve una fonte che separi
>   gli assist da fermo (FBref, oggi bloccato da Cloudflare).
> - **`penalty_ev` in forma ridotta è stato provato e BOCCIATO**: λ +0.332 su T1 e −0.222 su T2 (segni
>   opposti) e peggiora gli attaccanti di +1.8%/+2.7% di FM MAE. La forma ridotta collassa tutto il
>   prodotto su `confidence` perché mancano il **tasso di rigori per club** e la **conversione di
>   carriera**: senza quei due input la forma strutturale di questa nota non è fittabile. I rigoristi
>   datati prima dell'asta sono solo 22 (T1) e 29 (T2).
> - **Difensori: 7 rigoristi designati in totale** → la parte «potenziale bonus dei difensori» non è
>   fittabile, anche se è il ruolo dove servirebbe di più (i difensori hanno il MAE migliore e la
>   precisione top-10 peggiore).
> Dettaglio e numeri in `gate-motore-v1.md` §4 e §5.
*Sigle: EV = valore atteso · conv_shrunk = conversione individuale regredita verso la media di lega · confidence = affidabilità della gerarchia dinamica (penalty_hierarchy, spec v8) · 2.5 pieno = backtest del motore completo con lo strato flag · scoring_config = configurazione punteggi della lega.*

## Principio 1 (v2) — ASIMMETRIA del rischio tra piazzati
- **Rigore**: ha un lato negativo — sbagliarlo è un malus. L'EV ha un termine di downside e può diventare NEGATIVO per un rigorista scarso.
- **Punizione e corner**: sbagliarli non costa nulla — sono **opzioni a solo upside**. Lo specialista da punizioni con conversione bassa resta a EV positivo (piccolo ma mai negativo); il rigorista con conversione bassa no.
Conseguenza pratica: la soglia di convenienza dell'incarico è diversa — il rigore va pesato per la qualità del calciatore, punizioni e corner quasi solo per il volume dell'incarico.

## Principio 2 (v2) — PUNTEGGI PARAMETRICI, mai costanti nel codice
Le leghe usano valori NON standard per rigori segnati/sbagliati e assist da fermo. Tutte le formule leggono da `scoring_config` (per lega):
```
scoring_config: { goal_bonus, penalty_scored_bonus, penalty_missed_malus,
                  assist_bonus, assist_set_piece_bonus, ... }   # default fantacalcio.it, override per lega
```
Il prediction-engine calcola gli EV con i valori della lega dell'utente; nessun +3/−3/+1 cablato. Il modulo `ratings` del toolkit decompone gli assist standard dagli **assist da fermo** in `match_ratings` (la piattaforma li distingue), così l'EV usa la categoria giusta.

## 1. Rigoristi — da flag binario a valore atteso (SOSTITUISCE il flag v3.8)
**Evidenza (21-22/7):** conversione media di lega 77.4%/79.0% (199 e 181 rigori). Con punteggi standard (+3/−3): 90% → +2.40 per rigore · 78% → +1.68 · 60% → +0.60 · 50% → 0. Il flag binario mescola giocatori che valgono il triplo l'uno dell'altro.
**Formula pre-registrata (parametrica):**
```
penalty_ev = expected_club_penalties × taker_share(confidence) ×
             [conv_shrunk × penalty_scored_bonus − (1 − conv_shrunk) × penalty_missed_malus]
conv_shrunk = (career_R+ + k·league_mean) / (career_Rc + k),  k ≈ 10, league_mean ≈ 0.78
```
`taker_share` dalla gerarchia dinamica (evidenza rivelata > liste; trigger: rigore sbagliato → quarantena confidence, infortunio/cessione → promozione rank 2). `conv_shrunk` su base CARRIERA (FBref): campioni stagionali (3-8 rigori) = rumore (persistenza +0.42 su n=8, inconcludente) → shrinkage obbligatorio.

## 2. Specialisti da piazzato — `set_piece_duty` (solo upside)
Valore reale: (a) **assist da corner/punizione** = canale principale (volume >> gol diretti: lo specialista top moderno fa 2-4 gol/stagione su punizione); (b) **trasferibilità** — non dipende da compagni/gioco → preziosa per lo strato ARRIVI; (c) **resistenza all'età** → interazione con curve età (task 1.4).
**Formula pre-registrata (parametrica, senza termine negativo):**
```
set_piece_ev = Σᵢ expected_club_events(i) × taker_share(i) ×
               [ P(goal|i) × goal_bonus + P(assist|i) × assist_set_piece_bonus ]
i ∈ {freekicks, corners}     # penalties: formula dedicata sopra, con downside
```
Tassi P(goal|i), P(assist|i) dai dati storici FBref (FK shots/goals, pass types, assist da piazzato); `taker_share` dalla gerarchia rivelata per tipo.

## Dati richiesti (tutti in spec v8)
Rc/R+/R− stagionali (nostri file dal 24/25) + carriera FBref · FK shots/goals e pass types FBref · assist da fermo distinti in match_ratings (modulo ratings) · gerarchie rivelate per tipo (FBref eventi + fc_site probabili + positions amichevoli) · scoring_config per lega.

## Gate
Adozione SOLO se, fuori campione sulle due finestre, ciascun termine batte il motore che ne è privo — e per i rigoristi anche il vecchio flag binario a bonus fisso (baseline dichiarato).
