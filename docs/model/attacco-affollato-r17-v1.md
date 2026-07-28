# Attacco affollato — pre-registrazione di R17 (v1)

**Data: 28 luglio 2026 — scritta e committata PRIMA di qualunque corsa di gate su R17.**
Il commit di questo file è il timestamp della pre-registrazione (convenzione di
`gate-motore-v1.md` §10). La forma funzionale qui sotto è CONGELATA: qualunque variante
è un'ipotesi diversa e richiede la sua pre-registrazione.

## 1. Il problema, e i quattro fatti che vincolano la forma

Le top-10 di inizio stagione ordinano insieme due attaccanti dello stesso club (euro:
Marmoush+Haaland; default: Kean+Piccoli). Di norma uno cannibalizza l'altro (titolare vs
riserva); alcune coppie convivono davvero (Thuram+Lautaro). Quattro autopsie vincolano
qualunque nuovo tentativo:

1. **R16b ha già misurato «quanto reclamano i compagni» contro i GOL del club, e il segno è
   uscito POSITIVO su 13/15 finestre**: quel regressore misura la forza dell'attacco, non
   l'affollamento. La penalità non è negli aggregati stagionali di produzione.
2. **R11 ha confermato il meccanismo** (più arrivi nello stesso ruolo → meno presenze, λ
   negativo e stabile 10/10 su Serie A) **ma non passa il pavimento d'errore**, e vede solo
   gli ARRIVI: i titolari già in rosa gli sono invisibili.
3. **La famiglia forza-club è CHIUSA** (4 bocciature): riapre solo con input prospettici e
   ortogonali alla storia del giocatore. Predittore registrato: «un'ipotesi il cui input è
   derivabile dalla storia del giocatore stesso va attesa come fallimentare».
4. **Il ruolo di listino non discrimina**: l'Inter 24/25 lista `pc` Lautaro, Thuram, Taremi
   e Arnautovic. La gerarchia va letta dall'USO, non dal listone.

Il segnale che mancava è nel layer per-partita (28/07/2026, righe club-level in
`club_match_lineups`, costruite su TUTTE le righe dei lineup — anche i non quotati, che il
filtro identità avrebbe distorto): **quanti attaccanti un club schiera davvero per
undicesimo**. Inter 24/25: K = 2.05 (2 punte in 36/38); Fiorentina 24/25: K = 1.71
(1 punta in 16 XI, 2 in 13, 3 in 6). E i **co-start**: Lautaro+Thuram titolari insieme 23
volte, Lautaro+Taremi 3.

## 2. Forma funzionale (CONGELATA)

Per ogni club `c` del listone target con capienza misurabile, e per i suoi attaccanti di
listone (`role_classic = 'A'`):

```
pretendenti  = gli 'A' del club nel listone target
ordine       = Qt.I decrescente (Qt.I mancante = ultimo; pari merito: share_prev, poi fc_id)
K_c          = MEDIA degli attaccanti schierati per XI del club nella stagione di input
               (undicesimi completi: starters = 11 e somma slot G/D/M/F = 11; misurabile
               con n_XI >= 10, altrimenti la regola TACE su quel club)
s_j          = share di presenze previste dal set di regole share-replacing attivo
               (baseline a due passate, la stessa dei fit residuali)

x_i = max(0, Σ_{j≠i} s_j − K_c)   se rank_i > K_c        (il mercato lo ordina SOTTO la capienza)
x_i = 0                            altrimenti
share'_i = share_i + λ·x_i         λ unico, fittato cross-window, segno atteso NEGATIVO
```

**Perché la MEDIA e non il p90**: la media degli attaccanti schierati per XI È il budget di
titolarità che il club distribuisce agli attaccanti per giornata — esattamente la quantità
che la somma delle share previste non può superare. Il p90 sovrastima i club eterogenei
(Fiorentina: p90 = 3 contro media 1.71) e nel `simultaneous_caps` esisteva solo per
compensare l'inflazione multi-ruolo dei listing, che qui non c'è (lo slot provider è unico).

**Perché escludere la propria share** (`Σ_{j≠i}`): rimuove l'autoreferenza che ha affondato
R16 («la sua quota dei gol del club è già dentro la sua fantamedia»).

**Perché gli SLOT schierati e non i gol**: rimuove il termine di produzione che ha ribaltato
il segno di R16b. Nessuna misura di forza può rientrare da questa porta: a parità di club i
pretendenti vedono la stessa K, e il regressore varia TRA compagni.

**Verifica sui casi motivanti (fatta sugli input, prima del gate)**: con K Inter ≈ 2.05,
Thuram (rank 2) non è caricato e Taremi (rank 3) sì; con K Fiorentina ≈ 1.71, Piccoli
(rank 2) è caricato; un Man City con K < 2 carica Marmoush e mai Haaland.

## 3. Input e legalità d'asta

| input | fonte | legalità |
|---|---|---|
| K_c (media, p90 riportato a fini descrittivi) | `club_match_lineups` della stagione di INPUT | lineups di ieri: legale |
| pretendenti e ruoli | listone target (`rosters`) | pubblicato pre-asta: legale |
| ordine dei pretendenti | `price_initial` (Qt.I) | l'UNICO prezzo che una regola può leggere |
| s_j | share previste dalla configurazione | derivate da input legali |

Il nome club provider→canonico è risolto per voto di maggioranza stagionale dei titolari
risolti (`features._club_name_map`); un club senza voti resta assente — assente, non zero.

## 4. Finestre che misurano, finestre pulite

Il layer per-partita parte dal 2019-20, quindi:

- **default (Serie A): Tm3, Tm2, Tm1, T0, T1, T2** — 6 finestre (20/21 e 22/23 completate
  il 28/07/2026, ~340 richieste).
- **euro: Tm3, T0, T1, T2** — 4 finestre (le leghe estere 19/20 e 22/23 completate il
  28/07/2026); un club sotto le 10 XI misurabili è NON MISURABILE, mai un fallimento.

**Decisione presa ad alta voce prima del diagnostico (28/07/2026, utente)**: lo studio
`backtest --pairs` legge gli ESITI **solo su T1 e T2** — le due finestre già dichiarate di
generazione (§9 del gate) — e su tutte le altre legge solo gli input. Quindi restano
**pulite per R17: Serie A Tm3/Tm2/Tm1/T0, euro Tm3/T0**. Un pass confinato a T1/T2 non
conferma nulla; un pass sulle finestre pulite è evidenza vera già in questa stagione, e la
conferma definitiva resta la finestra 26/27.

## 5. Criteri di verdetto (invariati, più il set)

Valgono i criteri correnti, nessuno nuovo: strict (≥0.5% sui giocatori mossi, ogni finestra
misurante) e robust (maggioranza, media ≥0.5%, peggiore ≥−2%), più il **non-danno elastico e
vincolante** (FM/VALORE entro 0.1% sul campione comune; nomi top-10 su `auction_view`,
perdita aggregata ≤2%). In aggiunta, lezione R15/R3d: **la valutazione vale dentro il set
adottato** (`euro: R0c+R3c+R17`, `default: R3+R7+R13+R17`) con controllo manuale della
configurazione (`--auction` prima/dopo, conteggi di attivazione e nomi), non solo standalone
contro B0. Il verdetto si registra in `gate-motore-v1.md` **qualunque sia**.

## 6. Perché NON è la quinta corsa alla famiglia forza-club

1. **Identificazione within-club**: la forza del club è costante tra i suoi pretendenti in
   una finestra; il regressore di R17 varia TRA compagni (sopra/sotto K). Un termine
   between-club non può spiegare variazione within-club — strutturale, non retorico, ed è
   esattamente il confondimento che R16b non poteva rompere.
2. **Nessun input deriva dalla storia del giocatore** (il predittore registrato della
   chiusura): K è la forma rivelata dell'allenatore misurata sull'intero club; la condizione
   di carico è il mercato che prezza ALTRI sopra di lui. La sua Qt.I entra solo nel rango, e
   la Qt.I è della stessa classe dei riaperti ammessi dal testo di chiusura («quote di
   mercato pre-stagione»).
3. **Segno atteso negativo** — l'opposto di tutti e quattro i fit della famiglia chiusa
   (tutti usciti col segno della forza).

## 7. Cosa NON è pre-registrato qui

- **R18 (co-start come regola)**: meccanismo diverso (compatibilità di coppia rivelata), con
  un buco strutturale — non esiste per le coppie nuove (Kean/Piccoli: 0 co-start per
  costruzione). Resta evidenza descrittiva nel pannello (Track D). Si pre-registra solo se
  il diagnostico mostra che separa gli esiti A PARITÀ di K su T1/T2.
- **Varianti**: overflow proporzionale alla Qt.I, K = p90, soglie diverse da 10 XI, gruppo
  pretendenti per slot provider anziché ruolo di listone. Sono ipotesi DIVERSE.
- La pre-registrazione viva del §7 del gate (concorrenza pesata dalla Qt.I degli ARRIVI)
  resta viva: R17 non la sostituisce, misura un'altra cosa.

## 8. Limiti dichiarati prima della corsa

- **K è la forma della gestione precedente**: un club con `new_coach_target` la mantiene
  (nessun secondo parametro); le neopromosse non hanno K → regola muta. Costo accettato e
  dichiarato.
- Il gruppo pretendenti è il ruolo Classic 'A' del listone; lo slot provider 'F' è un
  vocabolario diverso (ali listate C, trequartisti listati A). Il diagnostico riporta il
  cross-tab per finestra PRIMA della corsa: se il disaccordo supera quanto il rank-gate può
  assorbire, la corsa si ferma e si ri-pre-registra — non si aggiusta in corsa.
- `FORWARD_MIN_XI = 10` e l'ordinamento dei pretendenti sono COSTANTI dichiarate, non
  parametri: non si sweepano.

## 9. Esito del diagnostico pre-gate (`backtest --pairs`, 28/07/2026, prima della corsa)

**Cross-tab F-starter ↔ ruolo listone** (stagioni di input, per finestra): i titolari nello slot
provider 'F' sono **57-81% listati A, 19-30% listati C** (ali e trequartisti), quota irrisolta
7-23% solo su euro (giocatori fuori perimetro). Il disaccordo è **unidirezionale e conservativo**:
K conta anche gli F listati C, quindi SOVRASTIMA gli slot disponibili agli 'A' e la regola semmai
sotto-carica. Nessun blocco: la corsa procede con la forma congelata. Nota a margine: la
convenzione provider varia per squadra (K Barcellona 1.21 contro PSG 2.94 a parità di tridente
nominale) — rumore che il gate sconterà da sé.

**Esiti T1/T2 delle coppie both-top15 (finestre bruciate)** — e vanno letti CONTRO l'ipotesi:
**23 coppie su 23 hanno retto entrambe** (both ≥60% del VALORE previsto), compresi i casi
motivanti — Kean 175/199 + Piccoli 170/189 (T2 default), Marmoush 272/189 + Haaland 204/188
(T1 euro), Lautaro+Thuram su entrambe le piattaforme. Il membro n.2 che R17 avrebbe CARICATO ha
reso in media **1.04× il previsto** contro 1.07× dei non caricati: al vertice della lista, sulle
due finestre di generazione, la penalità non si vede. I flop veri di T2 (Lukaku, Dovbyk,
Mosquera) stanno in coppie FUORI dalla top-15 o in club senza K misurabile.

**Aspettativa dichiarata prima del gate, di conseguenza**: l'evidenza delle finestre bruciate è
CONTRO l'ipotesi nella zona alta della lista. Il dominio della regola è più largo (ogni
pretendente sotto-capienza di un club sovra-reclamato, ~decine per finestra, non solo le top-15),
e a giudicare sono le finestre pulite (Serie A Tm3/Tm2/Tm1/T0, euro Tm3/T0). Un λ nullo o
instabile è l'esito più probabile alla luce di questo; se così sarà, il verdetto si registra e la
famiglia «affollamento per capienza» avrà la sua prima corsa onesta a verbale — che è comunque
più di quanto R16b potesse dire.

## 10. Verdetto

_Da registrare dopo la corsa, qualunque sia, con rimando a `gate-motore-v1.md`._
