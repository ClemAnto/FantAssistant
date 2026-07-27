# Modello previsionale calciatori — Documento di riferimento

> ⚠️ **Verdetti superati**: questo documento descrive il modello, non l'esito del gate. I set
> adottati e le regole cadute sono in `00-BRIDGE-punto-di-ingresso.md`, blocco «STATO AL 28
> LUGLIO 2026» - fra le cadute ci sono la curva d'eta' (R4) e il fattore allenatore (R10),
> che qui potrebbero comparire come promettenti.

**Progetto:** App EuroLega Fantacalcio · **Versione modello:** v3.8 (validata) → v4 (progettata)
**Ultimo aggiornamento:** 19 luglio 2026

---

## 1. Scopo

Prevedere la fantamedia di un calciatore per la stagione successiva usando solo fattori oggettivi noti prima dell'inizio del campionato (all'asta). Il modello è stato costruito e validato in tre iterazioni su dati reali di Serie A (2023/24 → 2025/26) con spot-check su Premier League.

---

## 2. Formula v3 (validata su Serie A)

> **Nota di allineamento (27 luglio 2026)** — questo documento resta la doc madre del *disegno*, ma il
> gate è stato eseguito e alcune sue proposte sono cadute. Cosa è **entrato** nel motore, con che numeri,
> e cosa **non va riproposto**: **`gate-motore-v1.md`**. In breve: il primo punto della lista
> «miglioramenti» qui sotto — l'**àncora forza-squadra da ClubElo** — è stato ritestato ed è la **terza
> bocciatura** di quella famiglia (segno giusto su entrambe le finestre, MAE di T1 sempre peggiore); il
> **fattore allenatore** invece è entrato (R10) ma con il segno opposto a quello che ci si aspettava —
> sui top club un nuovo allenatore *rafforza* la gerarchia precedente; la **propensione xG/xA** non
> aggiunge nulla alla FM precedente (γ ≈ 0 di segno sbagliato).

### Struttura

```
FM_prevista = ANCORA(ruolo) + BETA × (FM_precedente − ANCORA(ruolo)) + Σ aggiustamenti
```

Per i **nuovi arrivi** (nessuna FM di Serie A precedente) la base è sostituita da:

```
FM_prevista = ANCORA(ruolo) + bonus_arrivo + Σ aggiustamenti
```

### Parametri validati

| Parametro | Valore | Note |
|---|---|---|
| ANCORA attaccanti | 6.80 | fantamedia tipica di un titolare |
| ANCORA centrocampisti | 6.70 | |
| ANCORA difensori | 6.40 | |
| BETA (persistenza) | 0.50 | metà del "sopra media" si conserva l'anno dopo |

### Regole di aggiustamento (codificate, applicazione automatica)

| Flag | Valore | Condizione oggettiva |
|---|---|---|
| `arrivo_top5` | +0.60 | arrivo da campionato top-5 con output da titolare |
| `arrivo_fascia2` | +0.30 | arrivo da lega di seconda fascia (Serie B, Argentina, Eredivisie…) |
| `arrivo_u24` | ~~+0.10~~ | ❌ **RIMOSSA** (ablazione 19/7/26: Δ+2.5‰ su 1 attivazione ≈ nullo; ridondante col trigger U22 del fattore 11) |
| `dest_big` (H+) | +0.50 | destinazione squadra di vertice — **validata OOS 25/26** |
| `transfer_up` | +0.40 | trasferimento in squadra più forte da titolare designato |
| `rigorista_new` | +0.30 | acquisisce lo status di rigorista |
| `transfer_conc` | −0.30 | trasferimento con concorrenza/gerarchie incerte, arrivo a mercato chiuso senza preparazione |
| `avanzamento` | +0.30 | spostato di una linea in avanti / ruolo più offensivo nel nuovo modulo |
| `fuori_ruolo` | −0.30 | schierato fuori dalla posizione naturale |
| età 30–32 | ~~−0.20~~ | ⚠️ **SOSPESA** (ablazione 19/7/26: Δ−5‰ su 4 attivazioni ≈ nullo; campione distorto da survivorship — i crolli 30+ escono dalla top 50. In v4 sostituita da curva età continua per ruolo + baseline multi-stagione) |
| età 33+ | −0.50 | mantenuta nonostante ablazione −23‰: le 2 attivazioni misurabili (De Bruyne, Modrić) sono outlier tecnici sopravvissuti; i crolli previsti giusti (Salah, Immobile, Giroud) sono fuori dal campione per survivorship. Eccezione profili tecnici già prevista (§3) |
| `infortunio_grave` (anno prec.) | −0.50 (−1.00 se 29+) | **da validare quantitativamente** — tetto minuti attesi al 60% |
| 2ª stagione post-infortunio | 0 (malus rimosso) | spesso l'occasione d'asta (caso Chiesa 23/24) |

**Ablazione (19/7/26, 40 casi storici)** — contributi marginali all'errore: `arrivo_top5` +690‰ · `arrivo_fascia2` +92‰ · `transfer_up` +40‰ · `dest_big` +32‰ · àncore per ruolo +18‰ · `rigorista_new` e `avanzamento` +7.5‰ (tutte confermate). `transfer_conc` −7.5‰ mantenuta: l'unico caso numerico (Soulé) è fuorviante, la validazione vera è Isak, fuori dal campione. Regole mai attivate nei backtest (non giudicabili): `fuori_ruolo`, `infortunio_grave`, 2ª stagione. ⚠️ L'ablazione stessa soffre del survivorship bias di §4: le regole di malus vengono misurate solo sui sopravvissuti.

### Correttivi v4 (scoperti nel test fuori campione, da implementare)

1. **Àncora forza-squadra**: sostituire l'àncora di lega con un'àncora corretta per la qualità della squadra (fonte: ClubElo). Motivazione: l'intero blocco Inter 25/26 (Lautaro 8.92, Calhanoglu 8.63, Thuram 8.56, Dimarco 8.44) ha battuto le previsioni perché il modello regrediva verso la media di lega invece che verso la media di una squadra dominante.
2. **Regola giovani in ascesa**: per under-22 con trend in crescita, disattivare la regressione verso il basso (casi mancati: Yıldız 7.49→8.28, Nico Paz 7.49→8.26). **Trigger oggettivo (verificato 19/7/26)**: convocazione in nazionale maggiore entro i 22 anni — i tre U22 con convocazione senior del test OOS hanno residuo medio −0.83, il peggiore di tutti i gruppi.
3. **Coefficiente club-a-club**: nei trasferimenti tra leghe usare il rapporto ClubElo tra club di origine e destinazione (ingloba forza lega + destinazione big in un solo numero).
4. **Tornei internazionali a metà stagione (progettato 19/7/26)** — Coppa d'Africa, Coppa d'Asia. Doppia applicazione: (a) **malus anno target** (`coppa_intermedia`): −5/−7 giornate sulle *presenze attese* (profondità stimata via Elo nazionale), FM −0.2 sulle 2-3 giornate post-rientro, rischio infortunio maggiorato; input oggettivi: nazionalità + qualificazione + status convocabile (riusa i dati NT-fallback). (b) **Correzione anno input** (`coppa_intermedia_prec`): presenze basse da torneo ≠ inaffidabilità (non penalizzare la titolarità); se possibile ricalcolare la FM escludendo la finestra torneo+rientro. Retroattivo sul backtest: input 23/24 di Osimhen/Lookman compressi da CAF gen-feb 2024; input 25/26 dei reduci CAF 2025 (Marocco, 21/12–18/1, es. Anguissa, N'Dicka) da normalizzare. **Nota architetturale**: agisce sul secondo output del modello (presenze attese, da esporre nel listone), non sulla FM per partita. Primo caso d'uso multi-lega: Coppa d'Asia gennaio 2027 → malus ai titolari asiatici di Premier/Liga/Ligue 1 nel 26/27.
5. **Modulo NT-fallback (progettato 19/7/26)** — base dati dalle partite in nazionale per giocatori senza dati di club calibrabili (giovani, leghe non coperte). Attivazione: <900 min in 2 anni in lega con coefficiente, o provenienza non coperta. Peso di ogni partita = W_competizione (fase finale 1.0 · qualificazioni 0.7 · Nations League 0.6 · amichevoli 0.4 · U21/U20 0.5) × W_avversario (Elo nazionale avversaria / Elo mediano, cap 0.5–1.3) × W_recenza (≤12 mesi 1.0 · 12–24 0.7 · oltre 0.4). Miscela anti-hype: `FM = w·base_NT + (1−w)·(àncora + bonus_arrivo)` con `w = n_eff/(n_eff+12)` — una rivelazione da torneo con 6 partite pesate incide solo ~1/3. Caso pro: Retegui 2023 (gol in nazionale maggiore → adattamento confermato 7.61). Contro-caso gestito: bomber da qualificazioni contro avversari deboli (sgonfiato da W_avversario). Fonti: API-Football (partite NT, già in architettura), FBref (tornei), eloratings.net (Elo nazionali, gratuito). **Da validare su casi storici quantificati.**

---

## 2-bis. Livello esplicativo (explainability, progettato 19/7/26)

Ogni regola del motore è una tripletta **condizione oggettiva → delta numerico → template testuale** (con valori dinamici). Quando una regola scatta, emette entrambi gli output: il testo è quindi coerente col numero *per costruzione* (deterministico, testabile, nessuna generazione libera).

**Struttura della scheda giocatore** (output del `prediction-engine`):

```typescript
interface PlayerCard {
  fmPrevista: number;
  presenzeAttese: number;        // secondo output (v. fattore 15)
  statoValutazione: {            // fattore 22: regime + orizzonte
    regime: "STABILE" | "TRANSITORIO";
    orizzonteConvergenza: number;  // partite stimate perché emerga il livello vero
    cause: string[];               // flag transitori attivi (max degli orizzonti)
  };
  affidabilita: "ALTA" | "MEDIA" | "BASSA";  // derivata: STABILE=ALTA, transitorio corto=MEDIA, lungo=BASSA
  profilo: {                     // 7 dimensioni (v. §2-ter), scala 0-100
    garanziaPresenze: number;
    propensioneBonus: number;
    costanza: number;
    minutaggio: number;
    rankRuolo: { classic: number; mantra: Record<string, number> };
    contratto: number;           // rischio cessione invertito: alto = stabile
    fisico: number;
  };
  archetipo?: "muratore" | "lampadina" | "top";
  driver: {
    flag: string;                // id regola scattata
    delta: number;               // impatto (FM o presenze)
    segno: "positivo" | "negativo";
    testo: string;               // template renderizzato coi valori reali
  }[];                           // ordinati per |delta| decrescente
}
```

Regole di composizione: driver negativi e positivi separati, massimo 4-5 righe, l'affidabilità è sempre esplicitata. Esempi di template: regressione → "Career year su campione ridotto: il {fm} è costruito in sole {presenze} presenze (−{delta} da regressione)"; 2ª stagione post-infortunio → "malus rimosso, rendimento in risalita — profilo storico 'occasione d'asta' (caso Chiesa 23/24)"; coppa_intermedia → "titolare {nazionale}: −{n} giornate attese per {torneo} a gennaio".

---

## 2-ter. Profilo a 7 dimensioni (specifica 19/7/26)

Oltre alla FM prevista, la scheda espone 7 assi di valutazione (scala A–E o 0–100), ciascuno con metrica oggettiva e fonte:

| # | Dimensione | Metrica | Fonte |
|---|---|---|---|
| 1 | **Garanzia presenze** | quota partite squadra con voto (2 stagioni pesate), corretta da flag infortuni/tornei/gerarchie | FBref minuti |
| 2 | **Propensione bonus** | bonus attesi/partita da xG+xA per 90' (più stabili dei gol reali: caso Kean) + rigori/punizioni | FBref, dati rigoristi |
| 3 | **Costanza** | media voto *pura* (senza bonus) + deviazione standard dei voti | voti storici per giornata |
| 4 | **Minutaggio** | minuti/presenza, % da titolare, pattern sostituzioni | FBref |
| 5 | **Rank ruolo** | ordinamento FM prevista nel ruolo di listone; **Mantra**: rank separato per ogni ruolo posseduto (posizione reale FBref, fattore 7) + bonus flessibilità multi-ruolo | derivato |
| 6 | **Contratto** | scadenza ≤12-18 mesi senza rinnovo, richiesta cessione pubblica, esclusioni da preparazione, clausole; segno positivo se rinnovo recente | Transfermarkt, news codificate |
| 7 | **Fisico** | giorni persi attesi (media pesata 3 stagioni), maggiorazione muscolari ricorrenti vs traumatici, × età; regole ritorno da infortunio grave (fattore 8) | Transfermarkt infortuni |

**Archetipi dalla coppia (2,3)** — usati nel testo esplicativo: *muratore* (costanza alta, bonus bassi — da modificatore), *lampadina* (bonus alti, costanza bassa — o segna o 5.5), *top* (alti entrambi). La fantamedia da sola li confonde; scomposta li separa.

**Casi di validazione fattore 6 (contratto/rapporto società)**: Lookman 25/26 (8.46 → fuori top 50 dopo la rottura estiva con l'Atalanta) · Isak 25/26 (transfer_conc + rottura Newcastle → stagione compromessa).

---

## 3. Estensione multi-lega (v4, progettata)

| Lega | Correttivi specifici |
|---|---|
| Premier | sconto adattamento arrivi maggiorato (intensità); minuti meno prevedibili nelle big (rotazione); coefficiente in uscita più alto |
| Bundesliga | ambiente ad alto punteggio → àncora attaccanti più alta; curva d'età anticipata (giovani esplodono prima) |
| La Liga | malus età ridotto per profili tecnici; ambiente a basso punteggio |
| Ligue 1 | àncora separata per il PSG (monopolio); forte sconto in uscita per capocannonieri non-PSG; bonus affidabilità U22 |
| Serie A | parametri base come validati |

**Variabile obiettivo unificata:** voti fantacalcio.it Euroleghe (coprono le 5 leghe con criteri omogenei); fallback rating SofaScore/indice FBref normalizzato per lega. ⚠️ Requisito dati: verificare in ingestione la profondità storica dei voti Euroleghe per il backtest multi-lega.

**Allineamento parametri (verifica 19/7/26):** le àncore numeriche (6.80/6.70/6.40), il BETA e gli orizzonti di convergenza del fattore 22 sono calibrati SOLO su Serie A → diventano configurazione per-lega nel motore, da ricalibrare sullo storico Euroleghe. Orizzonti di adattamento modulati per lega: Premier +25-50% (coerente con lo sconto adattamento maggiorato). Il modulo amichevoli (fattore 21) vale per tutte le leghe (tour estivi, Community Shield, supercoppe — fonte API-Football multi-lega).

**Allineamento Mantra (verifica 19/7/26):** la formula attuale usa i ruoli Classic (A/C/D) — per le Euroleghe Mantra servono **àncore per ruolo Mantra** (Por, Dc, B/Dd/Ds, E, M, C, W, T, Pc): la FM attesa di un Pc ≠ W ≠ T. Derivabili dalla posizione reale FBref (fattore 7); la FM prevista va calcolata per ciascun ruolo Mantra posseduto (già previsto nel rank multi-ruolo, §2-ter dim. 5). La lacuna portieri (§9) è **bloccante per Mantra** (Por obbligatorio) → priorità alzata. L'archetipo "muratore da modificatore" è un concetto Classic; in Mantra la costanza pesa via media voto e vincoli di modulo.

**Curve età per ruolo (riferimento):** portieri 28–33, difensori centrali 27–30, terzini 25–28, centrocampisti 25–28, attaccanti 24–28. Declino post-30 più ripido per profili basati sulla velocità (validato: Salah 33 anni, da 29 a 7 gol) che per profili tecnici (Modrić a 40: media voto 7.55; Bruno Fernandes a 31: 21 assist).

---

## 4. Risultati dei backtest

| Test | Campione | MAE modello | MAE naive | Esito |
|---|---|---|---|---|
| v1 in-sample (23/24→24/25) | 16 giocatori Serie A | 0.37 | 0.73 | −49% errore |
| v2 regole codificate (23/24→24/25) | 16 + 5 arrivi | 0.36 / 0.66 (arrivi) | 0.73 | −51%; bias arrivi −0.66 → nasce ipotesi H+ |
| **Fuori campione (24/25→25/26)** | 16 giocatori (solo top-50) | 0.76 | 0.51 | vedi lettura sotto |
| Spot-check Premier 25/26 | Salah, Isak, Haaland | — | — | direzione corretta in tutti e 3 i casi |

### Lettura del test fuori campione (importante)

- **Colpi perfetti**: Kean previsto 7.57 / reale 7.57 · Orsolini 7.57 / 7.55 · Krstović 7.62 / 7.68 (regola transfer_up) · Esposito 7.43 / 7.64.
- **Ipotesi H+ (destinazione big) confermata sugli arrivi**: De Bruyne err −1.16→−0.66 · Modrić −0.96→−0.46 · Højlund −0.40→+0.10.
- **Il confronto MAE 0.76 vs 0.51 è distorto da survivorship bias**: misurabili solo i giocatori rimasti in top-50 (i migliorati). I crolli previsti correttamente dal modello (Lookman da 8.46, Dybala, Zaccagni, Dovbyk — tutti fuori dalla top 50 del 25/26) non entrano nel confronto numerico ed è dove il naive perde di più.
- **14/16 errori negativi** → modello troppo prudente su élite in squadre dominanti e giovani in ascesa (da qui i correttivi v4 §2).

### Spot-check Premier League (25/26, fuori campione)

- **Salah** (32 anni, career year 24/25: 29 gol + 18 assist): regole "regressione da career year + età 33" → crollo previsto. Reale: **7 gol**. ✔
- **Isak** (23 gol nel 24/25): flag `transfer_conc` (arrivo a mercato chiuso, rottura col club, zero preparazione) → sconto pesante. Reale: primo gol alla 13ª giornata, stagione compromessa. ✔
- **Haaland** (25 anni, 22 gol nel 24/25 = *sotto* il suo standard 36/27): regressione al contrario → rimbalzo previsto. Reale: capocannoniere con 27 gol. ✔

---

## 5. Fonti dati e avvertenze

| Fonte | Uso | Avvertenze |
|---|---|---|
| fantacalcio.dev | FM storiche Serie A (23/24, 24/25, 25/26 verificate, formula omogenea) | ⚠️ dati 22/23 e precedenti: "fantavoti editoriali importati", scala diversa e valori inconsistenti (es. Traoré FM 85.0 con 0 gol) → **inutilizzabili, serve validazione all'ingestione** |
| FBref | xG, xA, posizioni giocate, minuti, dataset completi 5 leghe | usare per eliminare il survivorship bias (mai classifiche top-N) |
| Transfermarkt | storico infortuni (giorni persi); contratti e scadenze; movimenti di mercato; valore rosa e spesa netta | per moduli infortuni, contratto e fattori 16-18-19-20 |
| ClubElo | forza club (àncora squadra + coefficienti trasferimento) | gratuito, API |
| API-Football | anagrafiche, rose, formazioni, partite nazionali, amichevoli precampionato (5 leghe) | già previsto in architettura app |
| fantacalcio.it Euroleghe | variabile obiettivo multi-lega | |

URL dati verificati:
- https://fantacalcio.dev/stagioni/2023-24/fantamedia-migliore
- https://fantacalcio.dev/stagioni/2024-25/fantamedia-migliore
- https://fantacalcio.dev/stagioni/2025-26/fantamedia-migliore

---

## 6. Fattori del modello e stato di validazione

| # | Fattore | Stato |
|---|---|---|
| 1 | Regressione alla media (career year) | ✅ validato 2 volte + Premier |
| 2 | Minuti/titolarità attesi | ✅ implicito nei filtri; da modellare esplicitamente |
| 3 | Curva età per ruolo | ✅ validato (Salah, Dybala, Calhanoglu; eccezioni tecniche: Modrić) |
| 4 | Regressione xG (over/under-performance) | ✅ validato qualitativamente (Kean, Lautaro); da quantificare con FBref |
| 5 | Rigoristi / piazzati | ✅ validato (Retegui) |
| 6 | Trasferimento (up / concorrenza / turbolento) | ✅ validato 3 volte (Retegui, Krstović, Isak) |
| 7 | Cambio ruolo / avanzamento posizione | ✅ validato (McTominay); listone vs posizione reale (Dumfries) |
| 8 | Ritorno da infortunio grave | 🔶 regole definite, validazione quantitativa mancante (dataset Transfermarkt) |
| 9 | Arrivi da altre leghe + destinazione big | ✅ H+ validata OOS; da sostituire con coefficiente ClubElo club-a-club |
| 10 | Àncora forza-squadra | 🔶 scoperta OOS, da implementare (v4) |
| 11 | Giovani U22 in ascesa | 🔶 scoperta OOS, da implementare (v4) — trigger: convocazione senior entro i 22 anni ✅ |
| 12 | Bonus "titolare in nazionale" (affermati) | ❌ **respinto (19/7/26)**: collineare con la FM; senza blocco Inter il gradiente sparisce (titolari −0.42 vs nessuna convocazione −0.66); peggiora i colpi esatti (Kean +0.01→+0.31, Krstović −0.06→+0.24); controesempi: Salah, Isak, Kean tutti titolari NT crollati |
| 13 | Flag `post_torneo` (titolari NT dopo Mondiale/Euro: preparazione ridotta → partenza lenta) | 🔶 ipotesi da validare su dati post-Euro 2024 / post-Mondiale 2022 — rilevante per l'asta 26/27 |
| 14 | NT-fallback (base dati da partite in nazionale, pesate per competizione/avversario/recenza) | 🔶 progettato (v4 §2.4), da validare su casi storici (pro: Retegui 2023, Kvaratskhelia 2022; rischio gestito: hype da torneo, es. Manzambi 2026) |
| 15 | Tornei intermedi (Coppa d'Africa/Asia): malus presenze anno target + normalizzazione FM anno input | 🔶 progettato (v4 §2.4), da validare sui reduci CAF 2024 e 2025 — agisce sull'output presenze attese |
| 16 | Contratto / rapporto con la società (rischio cessione) | 🔶 specificato (§2-ter dim. 6) — validazione qualitativa: Lookman e Isak 25/26; da codificare con dati Transfermarkt |
| 17 | Scomposizione FM: voto puro + bonus attesi (costanza vs propensione bonus, archetipi) | 🔶 specificato (§2-ter dim. 2-3) — richiede voti storici per giornata |
| 18 | Rischio cambio allenatore in stagione (`rischio_panchina`) | 🔶 specificato (§9): indice instabilità club (esoneri 5 anni, gap ambizioni/Elo, contratto tecnico) → allarga incertezza rosa + malus condizionale sui "fedelissimi" del tecnico. Caso: Roma 24/25 (3 allenatori, crollo Dovbyk) |
| 19 | Propensione mercato invernale (`attivita_mercato`) | 🔶 specificato (§9): indice trading club (cessioni gennaio 5 anni pesate per minuti, Transfermarkt) × appetibilità individuale (aggancio fattore 16) → rischio su presenze attese, entrambi i versi (cessione: Kvara→PSG gen 25, Lookman→Atlético gen 26; concorrenza in entrata: Kolo Muani gen 25) |
| 20 | Club-progetto in accelerazione (`club_progetto`, caso Como) | 🔶 specificato (§9): gap valore-rosa/spesa vs percentile Elo → àncora corretta al rialzo (metà gap) + affidabilità ridotta; trigger giovani aggiuntivo "recompra/vivaio top club" (Nico Paz–Real); input = 2ª metà stagione precedente per i profili in adattamento. La regressione individuale dai career year resta attiva (Douvikas). Validazione storica candidata: Newcastle post-21, Aston Villa 22-24, Como 24-26 |
| 21 | Amichevoli precampionato (modulo aggiornamento flag, agosto) | ✅ **validato storicamente (19/7/26)** su segnali di utilizzo/eventi, MAI prestazioni/gol (rumore: Juve-Motta perse 3-0 col Norimberga e poi fece lunga serie utile in campionato). Casi verificati estate 2024: (a) Chiesa non convocato per l'amichevole col Brest 3/8, Motta: "chi è rimasto a Torino è situazione di mercato", 8 tagliati, fuori rosa a Ferragosto → stagione persa a Liverpool — flag "escluso dalla generale = uomo mercato" (fattori 16/19); (b) Scamacca crociato nell'amichevole col Parma 4/8 → l'Atalanta ingaggia Retegui che diventa titolare+rigorista e capocannoniere 9.06: i flag transfer_up/rigorista_new nascono in quella partita. Ultime 2-3 amichevoli → aggiornano: gerarchie/titolarità, posizione nel modulo, rigoristi, minuti post-infortunio, esclusioni. Fonte: API-Football. Metrica di controllo: concordanza formazione generale vs 1ª giornata (target >80%) |
| 22 | Regime di valutazione + orizzonte di convergenza (`stato_valutazione`) | 🔶 specificato (19/7/26): STABILE (≥2 stagioni a minutaggio pieno nello stesso contesto, nessun flag transitorio) vs TRANSITORIO, con orizzonte = max partite-a-convergenza dei flag attivi: cambio lega 15-20 (Baturina), cambio squadra 8-12, cambio allenatore 8-12, rientro infortunio grave 10-15, promozione vivaio 5-8, campione ridotto = presenze mancanti a 15 da titolare. Uso all'asta: convergenza corta = errore correggibile al mercato di riparazione; lunga = capitale bloccato (combinazione peggiore: transitorio lungo a prezzo massimo, es. Malen 26/27). Distinzione: rischio epistemico (regime) ≠ rischio strutturale (età/fisico: Modrić = STABILE ma fragile). Sostituisce/deriva `affidabilita`. Orizzonti da calibrare sui casi storici |

---

## 7. Roadmap

1. **Dataset completo**: ingestione FBref di tutti i giocatori delle 5 leghe (elimina survivorship bias) + validazione qualità dati all'ingresso.
2. **Motore v4 in TypeScript** (`prediction-engine`): formula + configurazione parametri per lega, integrazione ClubElo e API-Football, da agganciare all'app Electron/Angular. Include il **livello esplicativo** (§2-bis): ogni regola emette delta numerico + testo motivazionale, output `PlayerCard` con FM prevista, presenze attese, affidabilità e driver ordinati per impatto.
3. **Modulo infortuni**: dataset Transfermarkt (giorni persi), validazione regole −0.5/−1.0 e "seconda stagione".
4. **Ricalibrazione** di BETA e delle àncore sul dataset completo (attuali valori tarati su campione top-50).
5. **Backtest continuo**: ogni nuova stagione conclusa diventa test fuori campione automatico.

---

## 8. Riproducibilità

Tutti i test sono riproducibili con lo script `backtest_completo.py` allegato (dataset verificati incorporati). Regola d'oro adottata: le ipotesi correttive si formulano **prima** di vedere i dati nuovi e si verificano solo fuori campione, mai ritarando sugli stessi dati (overfitting).

---

## 9. Revisione critica e priorità (19/7/26)

### Lacune strutturali individuate

1. **Portieri**: nessuna àncora né regole; il voto dipende quasi interamente dalla squadra → modulo basato su gol subiti attesi del club (ClubElo) + rigori parati + clean sheet.
2. **Fattore allenatore**: driver reale di casi codificati come "avanzamento" (McTominay/Conte, De Ketelaere/Gasperini). Oggettivabile con profilo storico del tecnico (gol prodotti, moduli, resa per ruolo nel suo sistema).
3. **Presenze attese non modellate** (fattore 2 ancora implicito): metà del valore fantacalcistico è FM × presenze. Mancano modulo infortuni quantificato, carico coppe europee (rotazione big / freschezza di chi non le gioca), regola neopromosse.

### Stabilità del contesto in stagione (fattori 18-19, aggiunti 19/7/26)

- **`rischio_panchina`** — indice instabilità club: esoneri ultime 5 stagioni + gap ambizioni/qualità rosa (Elo) + tecnico nuovo/in scadenza. Effetti: (a) allarga l'incertezza per tutta la rosa (agisce su `affidabilita`, non sulla FM); (b) malus condizionale sui "fedelissimi" del tecnico (valore cucito sul sistema: McTominay nel Napoli di Conte); (c) lieve segno positivo per gli emarginati. Validazione storica: Roma 24/25 (De Rossi→Juric→Ranieri, gerarchie riscritte 3 volte, crollo Dovbyk), Juve 24/25 (Motta→Tudor).
- **`attivita_mercato`** — indice trading club: cessioni rilevanti a gennaio negli ultimi 5 anni pesate per minutaggio del ceduto (Transfermarkt) + necessità di bilancio note + multiproprietà. Rischio individuale = indice club × appetibilità (valore in crescita, contratto corto — aggancio fattore 16). Due versi: cessione a metà stagione (Kvaratskhelia→PSG gen 2025, Lookman→Atlético gen 2026 = 15-18 giornate perse) e concorrenza in entrata (Kolo Muani→Juve gen 2025 su Vlahović). Output: probabilistico sulle presenze attese + testo esplicativo.
- **Pre-validazione richiesta**: verificare che gli indici storici di instabilità/trading predicano il comportamento futuro del club (ipotesi: comportamenti societari persistenti).

### Caso Como — club-progetto in accelerazione (fattore 20, aggiunto 19/7/26)

Fenomeno speculare al blocco Inter: lì l'àncora di lega ignorava una forza consolidata, qui ClubElo (retrospettivo) ignora una forza in costruzione — nuova proprietà, capitale investito non ancora diventato storia. Errore documentato: Nico Paz previsto 7.10, reale 8.26. Tre segnali codificati:

1. **`club_progetto`**: valore rosa + spesa netta (Transfermarkt) ≫ percentile ClubElo → àncora corretta al rialzo di *metà* del gap (i progetti possono fallire) + affidabilità ridotta su tutto il blocco.
2. **Trigger giovani "recompra"**: acquisto da top club con clausola di riacquisto o provenienza da accademia d'élite = validazione esperta pubblica (Nico Paz–Real Madrid), equipollente alla convocazione NT del fattore 11.
3. **Curva di adattamento**: per i giovani dei club-progetto usare come input i voti della 2ª metà della stagione precedente (trend infra-stagionale, richiede fattore 17) + bonus secondo anno (già validato). **✅ Validata (19/7/26) — caso Baturina 25/26**: arrivo_fascia2 dalla Dinamo Zagabria (18M+bonus, grande attesa), primi mesi di ambientamento anonimi, poi girone di ritorno da un gol ogni 2 partite nel Como 2° per punti nel ritorno e qualificato in Champions. Segnale strutturale (mezzo campionato) ≠ fiammata da poche partite (Vergara). Per l'asta 26/27: bonus 2° anno + trigger giovani (titolare Croazia) + erede designato di Nico Paz sui piazzati; cautele: `post_torneo` (Mondiale fino a giugno) e prima Champions del club.

**Contrappeso**: il fattore corregge l'àncora della squadra, non sospende le regole individuali — Douvikas 14 gol resta un career year da regredire anche dentro il progetto. Validazione storica candidata: Newcastle post-2021, Aston Villa 2022-24, Como 2024-26.

### Migliorie ad alto rendimento

1. **Baseline personale multi-stagione** (50/30/20) al posto della sola ultima FM — risolve il caso Haaland ("sotto il suo standard") e parte della sottostima élite. *Priorità massima, costo basso.*
2. **Definizione numerica dei flag** soggettivi ("squadra più forte" → delta ClubElo > soglia) — elimina il rischio senno-di-poi nei backtest. *Priorità massima, costo basso.*
3. **Calibrazione dei pesi** (+0.4, −0.5… oggi a intuito) con regressione regolarizzata sul dataset completo, mantenendo la struttura a regole.
4. **Intervalli di incertezza** sulla FM prevista (dalla distribuzione storica degli errori per profilo): 7.5±0.2 ≠ 7.5±1.0 all'asta.
5. Minori: flag `rigorista_lost` (−0.3, oggi esiste solo il verso positivo); àncore ricalcolate ogni stagione dalla media di lega (deriva dell'ambiente-voti).

### Vincolo di processo (gate)

Con 22 fattori su campioni da 16-20 giocatori, il modello cresce più in fretta dei dati che lo validano. Regola dura: **nessuna regola entra nel motore senza vittoria fuori campione pre-registrata**, e ogni fattore aggiunto deve superare il gate del `backtest_completo.py` (MAE complessivo non peggiorato).

### Ordine di lavoro suggerito

Baseline multi-stagione + definizione numerica flag (subito) → **modulo portieri (priorità alzata: bloccante per Mantra)** + fattore allenatore + presenze attese (con dataset completo) → indici club 18-19-20 (dati Transfermarkt) → calibrazione pesi e intervalli (ultimi, richiedono il dataset pieno).

---

## 10. Ciclo di lega: 8 finestre di riparazione gennaio/febbraio (19/7/26)

Il formato di lega (8 finestre di riparazione concentrate a gen/feb) ricontestualizza tre fattori e aggiunge un deliverable:

1. **Fattore 22 — soglia pratica di convergenza**: un TRANSITORIO che converge entro la ~17ª giornata è un errore correggibile nelle finestre; oltre, è capitale bloccato per la stagione. Le scommesse convesse (profilo Vergara) guadagnano valore: opzione d'uscita multipla a costo basso.
2. **Listone di gennaio** (nuovo deliverable del motore): (a) arrivi invernali da altra lega → prudenza massima: l'orizzonte di adattamento 15-20 partite converge a stagione finita; deroga per arrivi "pronti" dalla stessa lega (Raspadori→Atalanta gen 26); (b) **rientri Coppa d'Africa/Asia = acquisti-obiettivo a sconto** (tornano a febbraio con prezzo depresso dal malus presenze già scontato); (c) rientri da infortunio con seconda metà favorevole (profilo Scamacca feb 25); (d) cedibili (fattori 16/19) da vendere PRIMA della cessione reale — l'indice `attivita_mercato` qui diventa operativo.
3. **Requisito app — 4 momenti di ricalcolo listone**: fine stagione (parametri strutturali) → estate (flag mercato) → agosto (modulo amichevoli, fattore 21) → gennaio (listone di riparazione). Il campo `orizzonteConvergenza` si aggiorna a ogni giornata giocata.
