# Turnover atteso — v1 · quattro credenze misurate, e un solo canale (29 luglio 2026)

**Stato: DESCRITTIVO. Non è un giro di gate, nessun verdetto cambia, nessuna regola entra.** Le quattro
domande arrivano dall'utente (29/07/2026) e sono le credenze standard del fantacalcio:

1. chi ha giocato pochi giorni prima rende peggio?
2. «vincere aiuta a vincere»: il risultato precedente predice la prestazione successiva?
3. una vittoria induce il mister a confermare l'undici, una sconfitta a cambiare?
4. l'arrivo di un nuovo allenatore dà una sferzata?

**Risposta in una riga: tutte e quattro hanno un effetto reale, e in tutte e quattro l'effetto è su CHI
GIOCA, non su come gioca.** Dove la credenza parla di rendimento (1, 2, 4) l'effetto sul voto è nullo o
di segno rovesciato; dove parla di scelte dell'allenatore (3) è uno degli effetti più robusti misurati su
questi dati.

## Il pannello (provenienza, come chiede la convenzione dei coefficienti)

| | |
|---|---|
| piattaforma | **`default`** (Serie A, tutte e 20 le squadre). L'euro **non** è misurato. |
| finestra | **2019-20 → 2025-26**, 7 stagioni (dove esiste il layer per-partita con le date) |
| righe | **106.977** partita-giocatore · 104.161 con riposo club · 69.263 con risultato precedente · 67.895 con fantavoto reale · 52.766 da titolare |
| fonti | `external_match_stats` (`source='sofascore'`, `competition='serie_a'`) → data, titolarità, minuti, rating; **join** su `match_ratings` (`platform='default'`) con `real_md = matchday` → **mv e fantavoto REALI** |
| metodo | ogni esito **demeaned dentro (giocatore, stagione)**; l'unità d'inferenza è la **giocatore-stagione**, non la partita, quindi la SE è clusterizzata per costruzione |
| data | 29/07/2026 · baseline residua: nessuna, sono medie condizionate su dati grezzi (non residui di una regressione delle quote) |

## Scoperta di percorso: il risultato di una partita di Serie A è derivabile OFFLINE

Il DB non ha nessuna colonna punteggio, e `positions.download_round` scarta `homeScore`/`awayScore` al
parse. Ma da `match_ratings` (`platform='default'`) il risultato si ricostruisce:

- **`goals` è al netto dei rigori E degli autogol** — verificato, non assunto: `goals + own_goals +
  pen_scored` pareggia i gol subiti dai portieri su **386 giornate su 418**, media dello scarto −0.02.
  Le sole `goals` sbagliano di +3.46 gol per giornata.
- quindi **gol fatti = `SUM(goals) + SUM(pen_scored)`** del club, **gol subiti = `SUM(goals_conceded)`**
  delle righe `role='P'` con voto (somma, non massimo: 84 club-giornata hanno due portieri a referto).
- **Screening severo**: si tiene una giornata solo se il bilancio quadra **e** vittorie == sconfitte **e**
  i pareggi sono pari. Restano **278 giornate su 418 (66,5%)**, cioè **5.560 club-giornata**, 53-76% per
  stagione. Lo scarto non è casuale e va detto.

Per le altre quattro leghe il risultato **non** è derivabile così (nessun `match_ratings` `default`):
serve una richiesta per giornata sull'endpoint dei round.

## 1. I giorni tra le partite

Chi ha giocato **≥60'** nell'ultima partita del club (il gruppo su cui la fatica ha senso), riposo del
club a ≤3 giorni contro il resto:

| esito | ≤3 giorni | 4 giorni | 5-6 | 7 | 8-10 | 11+ |
|---|---|---|---|---|---|---|
| **P(titolare)** | **−9,8pp** (t −13,3) | −5,9pp (t −7,8) | +3,1 | +2,5 | +2,4 | +1,6 |
| **P(prende un voto)** | **−4,4pp** (t −7,8) | −2,6pp (t −4,4) | +1,6 | +0,8 | +1,1 | +0,7 |
| minuti | −6,6 (t −12,6) | −3,8 | +2,1 | +1,6 | +1,6 | +1,2 |
| **fantavoto** \| gioca | **−0,014** (t −0,5) | −0,065 (t −2,4) | −0,004 | +0,035 | −0,007 | −0,008 |
| mv \| gioca | −0,001 (t −0,1) | −0,026 | −0,001 | +0,014 | −0,007 | −0,007 |
| rating SofaScore \| gioca | −0,035 (t −3,8) | −0,027 (t −2,8) | +0,005 | +0,008 | +0,004 | +0,005 |

**Robustezza (il criterio del gate applicato a mano)**, ≤4 giorni contro 5+, stagione per stagione:
titolarità negativa su **7 su 7** (da −9,2 a −16,8pp, t da −4,2 a −10,1); P(voto) negativa su **7 su 7**
(−2,7…−7,9pp). Il **fantavoto cambia segno** fra stagioni (+0,024 nel 21/22, −0,151 nel 23/24) e solo 2
celle su 7 sono nominalmente significative. Escludendo il calendario COVID (2020-21) il pool dà P(start)
−11,7pp (t −16,9), P(voto) −5,2pp (t −9,5), fantavoto **−0,052** (t −2,3).

⚠️ **Un'asimmetria da non archiviare come rumore né promuovere a effetto**: le tre stagioni più recenti
danno fantavoto −0,15 / −0,10 / −0,10, le quattro precedenti zero o positivo. O il calendario si è
compresso davvero dal 2023, o è la solita coda. Con questi dati non si decide.

**In fantapunti attesi per partita** (media del fantavoto quando gioca: **6,123**, n=67.872): canale
presenze **−0,32**, canale voto **−0,05** al lordo (−0,04 pesato per la probabilità di prendere il voto),
cioè **88% / 12%**, ovvero il canale presenze pesa **~7 volte** l'altro.

**La coda lunga esiste, ed è l'altro verso**: chi non gioca **da 21+ giorni** rende −0,037 di rating
(t −5,4) e fa −10,3 minuti (t −28,6). Il rientro si vede; la fatica quasi no. Coerente con §5-quater del
gate (inattività: segnale reale nei dati grezzi).

⚠️ **Limite che decide l'interpretazione**: nel DB **non ci sono partite di coppa né europee**, quindi il
riposo è misurato sul solo calendario di campionato. Il bucket ≤4 giorni è **pulito** (fra due gare di
campionato a 3-4 giorni non c'è spazio per un turno europeo), quello 5+ è **contaminato** per le squadre
che giocano in Europa. Il bias **sottostima** l'effetto, non lo gonfia.

## 2. Il risultato precedente: la credenza è vera sulle scelte, rovesciata sul rendimento

| esito | dopo una **vittoria** | dopo un **pari** | dopo una **sconfitta** |
|---|---|---|---|
| **era titolare → è titolare** | **+5,0pp** (t +11,7) | +0,1 | **−4,1pp** (t −8,9) |
| **era in panchina → è titolare** | −4,8pp (t −11,2) | −0,4 | **+4,5pp** (t +10,4) |
| P(prende un voto) \| era titolare | +3,0pp (t +8,4) | +0,3 | −2,6pp (t −6,6) |
| minuti (chi giocò ≥60') | +2,8 (t +9,3) | +0,1 | −2,5 (t −7,3) |
| **fantavoto** \| gioca | **−0,046** (t −3,8) | +0,028 | +0,015 |
| fantavoto **corretto per la forza dell'avversario** (decili) | −0,032 (t −2,6) | +0,038 | −0,005 |
| mv \| gioca | −0,021 (t −3,9) | +0,013 | +0,002 |
| rating SofaScore \| gioca | −0,019 (t −4,5) | +0,002 | +0,015 (t +3,4) |

**Churn a livello di club** — quota dell'undici confermata alla giornata dopo:

| dopo | n | quota dell'XI mantenuta | demeaned dentro (stagione, club) |
|---|---|---|---|
| vittoria | 1.096 | **78,2%** (SE 0,5) | **+4,4pp** (t +9,5) |
| pari | 752 | 75,1% (SE 0,6) | +0,4pp (t +0,9) |
| sconfitta | 1.087 | **71,0%** (SE 0,5) | **−4,5pp** (t −9,4) |

Cioè **~2,4 maglie cambiate dopo una vittoria, ~3,2 dopo una sconfitta**. Su **7 stagioni su 7** sia la
titolarità (+7,0…+11,4pp fra W e L) sia il churn (+4,8…+10,8pp): è l'effetto più robusto di tutta la
misura. Sul **fantavoto** invece W−L è negativo in **5 stagioni su 7** — «vincere aiuta a vincere» non è
solo assente, il segno è mite ma **rovesciato**: ritorno alla media.

⚠️ **Correzione della prima stesura, stesso giorno.** La riga «la mano calda non esiste,
`corr(fv in t−1, fv in t)` = −0,035» era **un artefatto** e va letta in §4: quel −0,035 è la
**distorsione di campione finito** di una correlazione ritardata su una serie demeaned
(−1/(n−1) ≈ −0,044 con 24 partite). Col null giusto la mano calda è **leggermente POSITIVA**. Resta vero e
verificato che un punto di fantavoto in più in t−1 vale **+2,35pp** di titolarità in t (n=45.689):
l'informazione sulla prestazione viaggia soprattutto attraverso la scelta dell'allenatore.

**Il «dopo una vittoria» invece NON è un artefatto**, ed è stato messo alla prova con lo stesso null:
tenendo le etichette W/D/L al loro posto e rimescolando solo i fantavoto del giocatore, il null è
**−0,002** (cioè zero) contro un osservato di **−0,048**; il contrasto W−L è **−0,074 osservato contro
−0,002 atteso** (eccesso −0,072, SE 0,021, **t −3,4**, 2.445 giocatore-stagione). Il motivo per cui qui la
distorsione non morde è che si condiziona sul risultato **della squadra**, non sul voto **suo**. Sul canale
delle scelte lo stesso test dà W−L **+7,77pp** contro un null di −0,01pp (t +11,7).

⚠️ Il churn è un **limite inferiore**: l'undici misurato ha **10,3 titolari nominati su 11**, perché la
titolarità per giocatore passa dall'imbuto dell'identità — la stessa distorsione per cui esiste
`club_match_lineups`. Gli irrisolti sono i marginali, cioè i primi a essere cambiati.

## 3. Il nuovo allenatore: metà sferzata è aritmetica

31 cambi a stagione in corso (solo club del perimetro `coaches`), punti per partita sulle 5 gare prima e
sulle 5 dopo, contro **2.219 finestre 5+5 pulite** (nessun cambio) riportate alla stessa distribuzione di
forma di partenza:

| | punti/partita |
|---|---|
| prima del cambio | 0,889 |
| dopo | 1,369 |
| **sferzata grezza** | **+0,481** (SE 0,117) |
| controlli appaiati, stessa forma di partenza | **+0,253** |
| **sferzata NETTA** | **+0,227** (SE 0,118, **t 1,9**) |

**Il 53% del rimbalzo è regressione verso la media**, e il residuo non è risolvibile con 31 eventi. Con un
dettaglio che ribalta la vulgata: nelle crisi nere (<0,4 ppm prima) il netto è **+0,07** — lì il rimbalzo
sarebbe arrivato comunque; dove la squadra non andava male (1,2+ ppm) il netto è +0,27, su 11 casi.

Quello che il nuovo allenatore fa e si misura: **conferma il 64,4% dell'undici** alla prima partita
(n=24) contro **75,1%** delle settimane normali degli stessi club (n=273), differenza **−10,6pp**
(SE 0,031, t −3,5) = **1,2 maglie subito**. Suggestivo e su campione minimo: dopo una brutta serie
conferma 70,7% (n=13), dopo una serie decente 57,0% (n=11).

Coerente con la caduta di **R10** (§3-quinquies): come *regola* R10 esce da entrambi i set, e qui si vede
perché — la parte solida del fenomeno è la ridistribuzione dei posti, non un guadagno di rendimento.

## 4. Le migliori prestazioni si raggruppano nel tempo? (domanda dell'utente, 29/07)

Le due credenze opposte: «ha segnato la scorsa, difficile che si ripeta» contro «ha segnato, è in forma».
**Il test ingenuo è distorto e sbaglierebbe in favore della prima**: su una sequenza finita
`P(evento | evento la volta prima) − P(evento | no)` è **negativa anche quando i dati sono perfettamente
casuali** (bias di Miller–Sanjurjo). Quindi ogni statistica è confrontata con **la stessa sequenza
rimescolata 300 volte**, che tiene fissi il suo tasso e il suo numero di partite e distrugge solo l'ORDINE.
Sequenze da `match_ratings`, sole giornate in cui ha preso un voto, ≥15 partite.

**Eccesso sull'atteso** (osservato − media dei rimescolamenti), aggregato per giocatore-stagione:

| evento | piattaforma | n | coppie adiacenti | serie più lunga | P(hit\|hit)−P(hit\|miss) | dispersione a blocchi di 5 |
|---|---|---|---|---|---|---|
| **gol** (rigori inclusi, ≥3) | `default` | 1.260 | +0,003 (t +0,1) | +0,033 (t +1,6) | +0,003 (t +0,6) | −0,014 (t −1,1) |
| gol su azione (≥3) | `default` | 1.180 | −0,011 (t −0,5) | +0,018 (t +0,9) | +0,001 (t +0,1) | −0,009 (t −0,7) |
| bonus, gol o assist (≥4) | `default` | 1.505 | +0,043 (t +1,6) | +0,041 (t +1,8) | +0,009 (t +1,8) | +0,022 (t +1,8) |
| **suo quartile alto di fantavoto** | `default` | 3.994 | **+0,078** (t +4,1) | **+0,080** (t +4,3) | **+0,014** (t +4,4) | +0,019 (t +2,7) |
| fantavoto ≥8 (≥3) | `default` | 1.486 | +0,030 (t +1,3) | +0,045 (t +2,4) | +0,006 (t +1,3) | +0,001 (t +0,1) |
| **gol** (rigori inclusi, ≥3) | `euro` | 1.408 | +0,040 (t +1,8) | +0,045 (t +2,2) | +0,010 (t +1,9) | +0,035 (t +2,3) |
| bonus (≥4) | `euro` | 1.715 | +0,054 (t +2,2) | +0,069 (t +3,2) | +0,014 (t +2,8) | +0,036 (t +2,7) |
| **suo quartile alto di fantavoto** | `euro` | 3.848 | **+0,070** (t +4,0) | **+0,129** (t +6,5) | **+0,015** (t +4,1) | +0,028 (t +3,6) |
| fantavoto ≥8 (≥3) | `euro` | 1.613 | +0,059 (t +2,8) | +0,076 (t +3,8) | +0,015 (t +3,0) | +0,038 (t +2,7) |

**Verdetto: il GOL è senza memoria, la PRESTAZIONE ne ha un filo.**

1. **Nessuna delle due credenze regge sul gol in Serie A.** Tutte e quattro le statistiche sono a zero su
   1.260 giocatore-stagione. Non c'è «è difficile che si ripeta» e non c'è «è in forma».
2. **Il livello di prestazione si raggruppa davvero**, su entrambe le piattaforme e su tutte e quattro le
   statistiche (t da +2,7 a +6,5, ~3.900 giocatore-stagione per piattaforma). **Ma la taglia è irrisoria**:
   +0,014 su un tasso base di 0,408 significa 42% contro 40%, e +0,08 coppie adiacenti su 4,5 attese
   (+1,7%). Statisticamente solido, praticamente non scommettibile.
3. **Il bias esiste e si vede nei nostri dati**: l'osservato di `P(hit|hit)−P(hit|miss)` è **negativo
   ovunque** (≈ −0,03) e il null rimescolato è **anch'esso negativo** (≈ −0,04). Chi calcola il numero
   grezzo «dimostra» la prima credenza. È lo stesso errore che ha prodotto la riga sbagliata in §2.
4. **Su `euro` il gol mostra un piccolo raggruppamento** (t +1,8…+2,7 su tutte e quattro) che in Serie A non
   c'è. Non chiamarlo «forma»: la permutazione distrugge l'ordine, quindi conta come raggruppamento
   **qualunque** causa, incluse due partite facili di fila. `euro` = club di vertice di 5 leghe, dove le
   sequenze di avversari deboli sono più comuni. Da separare con un controllo per avversario, non concluso qui.

**Verifica del bias, diretta** (`corr` ritardata sui fantavoto, stesso stimatore di §2): `default`
osservato **−0,0289**, null rimescolato **−0,0413** (atteso teorico −1/(n−1) = −0,0435 con 24 partite),
**eccesso +0,0124 = +3,4 sd del null**; `euro` osservato −0,0399, null −0,0499, **eccesso +0,0100 (+2,4 sd)**.
La mano calda del fantavoto è dunque **positiva e minuscola**, non negativa.

## 5. La cornice: perché è sempre lo stesso canale

`fantapunti totali = pv × fm`, quindi `Var(ln totale) = Var(ln pv) + Var(ln fm) + 2Cov`:

| piattaforma | n giocatore-stagione | Var(ln pv) | Var(ln fm) | 2Cov |
|---|---|---|---|---|
| **`default`** (11 stagioni) | 6.025 | **90,5%** | 1,8% | +7,7% |
| **`euro`** (7 stagioni) | 5.903 | **89,9%** | 2,1% | +8,0% |

`default`: fm media 5,99 (sd 0,75), pv media 19,1 (sd 11,4). **Il 90% di quello che separa una stagione
buona da una scarsa sono le presenze.** La qualità per partita è *più persistente* di anno in anno
(fm r=+0,61 contro pv r=+0,47 su `default`; +0,69 contro +0,47 su `euro`) ma pesa **45 volte meno** in
varianza. Le quattro credenze non finiscono sullo stesso canale per caso: quel canale è dove sta il gioco.

## Cosa NON è stato fatto, e cosa sarebbe una pre-registrazione

- **Nessun gate.** Il gate giudica un bersaglio **stagionale all'asta**; questa è una misura
  **per-giornata**. Le due cose non sono confrontabili e niente di qui è adottabile come regola d'asta.
- La forma legittima è **una** famiglia, non quattro regole: **turnover atteso dell'undici**, bersaglio
  `P(voto)` e minuti attesi (mai la fantamedia), tre input (risultato precedente, giorni di riposo,
  impegni infrasettimanali), identificazione **within-club** — un regressore che varia fra compagni di
  squadra, la via con cui R17 era uscito dalla trappola della famiglia forza-club. Serve un **gate
  per-partita che non esiste**: quello è il lavoro, non la regola.
- Attenzione al confine già battuto: «vincere aiuta a vincere» come regressore **d'asta** *è* la famiglia
  forza-club, **CHIUSA** (§5-nonies) sullo stesso difetto — un input derivabile dalla fantamedia del
  giocatore non può migliorarla.

**Passi di dati che servirebbero, in ordine di leva**: (a) le **partite di coppa ed europee**, senza cui
la congestione vera resta non misurata e il bucket «riposo normale» resta contaminato; (b) i **punteggi
delle altre 4 leghe** (una richiesta per giornata, non per partita) per uscire da una sola piattaforma;
(c) niente altro — nessuna delle misure qui sopra ha richiesto una singola richiesta di rete.

**Riproducibilità**: le query e i criteri sono tutti descritti qui; gli script della corsa del 29/07 sono
in area temporanea e **non** nel repo. Se la famiglia viene pre-registrata, il posto giusto è un modulo
`engine/diagnostics`-like, read-only sul DB come il resto dell'harness.
