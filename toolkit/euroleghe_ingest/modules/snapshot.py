"""snapshot - everything needed to build the action plan for an initial auction, as of TODAY.

One command per auction, run on the day you sit down to prepare it. It refreshes the volatile states
that only exist "now", then writes a dated folder under data/reports/ with one row per player, one row
per club, and a manifest saying what each number is and how much it can be trusted.

THE ONE RULE THIS MODULE OBEYS. The output is split in two, in the CSV header itself:

  * `engine_*`      the valuation the gate validated: predicted fantamedia, expected appearances,
                    VALUE, SURPLUS, the role's replacement level. Produced by calling `engine/` -
                    never re-implemented here - with the ADOPTED rule set for the platform and the
                    parameters fitted on a window that is not the one being predicted.
  * `desc_*`        DESCRIPTIVE columns, computed here and NOT gated: form over the last matches,
                    injury propensity, expected minutes, starting duels, bonus propensity, penalty
                    duty, discipline, contract situation. They are for the human reading the sheet.
                    NONE of them may be turned into a coefficient without a pre-registered gate run -
                    six families of fantamedia hypotheses have already died that way.

Anything the sources cannot answer is a column of NULLs with the reason in the manifest, never a
plausible-looking number. Two of those are worth knowing before reading the sheet:

  * "rapporto con la società" is NOT measurable from any source in the whitelist. What IS measurable
    sits in `desc_contract_until` / `desc_exit_risk` / `desc_arrival*` / `desc_seasons_at_club` /
    `desc_new_coach`, and those are proxies for it, not it.
  * set-piece duty beyond penalties is NOT available: the votes API never fills `assists_set_piece`,
    so corners and free kicks cannot be attributed. Penalties are, and they are revealed from our own
    votes rather than from an editorial list.

The auction date is TODAY for the season being auctioned, so today's probabili, injuries, squads and
listone count; for a season already PLAYED it is that season's conventional 15 August, so a dry run
cannot read the future it is pretending not to know. It used to be `min(15 August, today)` for both,
which is the same thing until 15 August and freezes the sheet in the past afterwards (revision 27).
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import os
import sqlite3
import time
from collections.abc import Mapping
from dataclasses import replace
from pathlib import Path
from typing import NamedTuple

from euroleghe_ingest import config, matching
from euroleghe_ingest.context import Context
from euroleghe_ingest.engine import cups as engine_cups
from euroleghe_ingest.engine import estimate as est
from euroleghe_ingest.engine import evaluate, features, model, projection
from euroleghe_ingest.modules import arrivals, fixtures, positions
from euroleghe_ingest.sources import MANTRA_BY_CLASSIC

NAME = "snapshot"
DESCRIPTION = "Today's auction snapshot: refresh the volatile state, then one row per player + per club"
DEPENDS_ON: list[str] = ["rosters"]
RAW_INPUTS: list[str] = []
# The three VOLATILE STATES a sheet refreshes, and nothing else: today's editorial pages, today's live
# squads + granular roles, and the target season's listone. Everything else is computed from the DB.
NETWORK = True

# How many recent matches "form" is measured over. The user's own number, and it is a WINDOW, not a
# model parameter: nothing downstream fits on it.
FORM_MATCHES = 10
# A starting duel: two players of the same club and role whose starting probabilities are this close.
# A threshold for a human reading a sheet, not a coefficient.
BALLOTTAGGIO_MARGIN = 0.25
# How many seasons of injuries the propensity looks back over, newest first, with these weights.
INJURY_WEIGHTS: tuple[float, ...] = (1.0, 0.6, 0.35)
# Above this share of its complete elevens, a club's modal shape is the coach's PREFERRED formation
# rather than one of several he alternates. A reading threshold, stated in the sheet, not a coefficient.
FORMATION_SETTLED = 0.60

# How far back an appearance still says "he is in this squad". Fourteen months, so a full season plus a
# transfer window fits and the season before it does not: with no bound at all a player's last
# appearance EVER counted, which put two retired keepers in Inter's 2026 squad.
SQUAD_APPEARANCE_MONTHS = 14

# WHEN AN OLD SHEET IS STALE. `generated_at` says when a folder was written; it cannot say whether the code
# that wrote it still computes the same numbers, and «rifare gli snapshot» was a question nobody could answer
# from the folder itself (06/08/2026). Bump this whenever a change moves a value a sheet CARRIES - a rule, a
# constant, a layer, an identity in the DB - and leave it alone for anything cosmetic. A folder whose
# `sheet_revision` is lower than this one was built by a different model and is to be rebuilt.
#   1  everything up to 05/08/2026 (folders with no `sheet_revision` at all are revision 0 by definition)
#   2  06/08/2026 - the live squad's completeness guard (93 marked rows -> 48); the twin club identities
#      merged (109 -> 106 clubs, so coaches / elo / penalty hierarchy / the live-squad join all move);
#      `other_platform` restricted to the same competition (13 rows); the `older` rung regressed toward the
#      anchor (38 rows).
#   3  07/08/2026 - the live squad is derived AGAIN after the roles step, which is what downloads the
#      payload it reads: every sheet before this one carried the PREVIOUS day's live squad, so the
#      departures (⇥) and the eleven were one reading behind.
#   5  07/08/2026 - THE QUOTATION IS READ PER PLATFORM (`listone_quotes`): the Serie A sheet shows the
#      Serie A listone's Qt.I and FVM and the EuroLeghe sheet its own, where before both showed whichever
#      was downloaded last (249 rows, 202 prices and 226 fantavalori apart - Svilar 18/65 against 15/56).
#      The arrival TIER moves with it, since it is a percentile inside a listone: 82 arrivals of 330 sit
#      in a different band on the two platforms. Where that lands, checked rather than assumed: the
#      `desc_arrival_tier` column and the sweep's tier arm, and NOWHERE else - `presence`'s arrival
#      discount keys on whether he crossed a championship, not on the tier, and `evaluate` never reads it.
#      So `engine_*` is untouched by the tier and moves only where a rule reads a price, i.e. nowhere
#      adopted (R12/R12b are falsified). What the operator SEES change is the quotation and the tier.
#   4  07/08/2026 - the probabili are read only for the season being AUCTIONED
#      (`probable_starter.season`): until now the freshest reading was the last 2025-26 round, so 428 of
#      648 Serie A rows carried a starting probability of 1.0 taken from line-ups already played, 415
#      duels were built on it, and its 442 players asserted a 2026-27 squad. Now empty by design.
#   6  07/08/2026 - A MANTRA SHEET HAD NO REPLACEMENT LEVEL AT ALL, so its SURPLUS was the VALUE. The
#      levels come back keyed on the game's own vocabulary (`por` 4.33 ... `pc` 7.19) and all three
#      readers asked for them with `role_classic` ('P'/'D'/'C'/'A'), which matches nothing on mantra:
#      `engine_replacement_fm` 0 of 1031, `engine_surplus` == `engine_value` on all 1007 priced rows,
#      `est_surplus` the same, and `engine_role_rank` ranked inside the classic role with that same
#      fallback. Only 1 or 2 of each role's top ten survived the correction (`t`: Rogers, Baumgartner,
#      Fernandez E. gave way to Gnabry, Palmer, Uzun). Nothing gated moved - the gate runs without a
#      league and ranks by VALUE on purpose (`backtest --verify` 22/22) - and `default/classic` is
#      unchanged, since there the two vocabularies are the same one. Correcting it exposed a second
#      layer the common fallback had been hiding: a man the listone does not carry has NO mantra code,
#      so he had no level either and his `est_surplus` stayed a VALUE in a column of surpluses - 11 of
#      the sheet's top 12 rows. He is levelled on his classic group's mean (`auction_level`).
#   7  07/08/2026 - `desc_arrival_origin_rounds`, the calendar a man's MEASURED season belongs to. Every
#      numerator on the row is his old championship's when he was bought from abroad, and the denominator
#      was his new club's: Gonçalo Ramos's 1320 Ligue 1 minutes read against Milan's 38 rounds instead of
#      34, i.e. 0.386 of a season where he played 0.431. It is «a share of a season is a share of the
#      CHAMPIONSHIP» (v9.11) broken for exactly the men it was written for, and it kept him out of the
#      typical eleven by 0.013 of claim. No `engine_*` column moves - the engine's presences are R13's,
#      not `presence`'s - but the CLAIM the board ranks by does, on 2 clubs of 20.
#   8  08/08/2026 - `coach_shapes` joined the line-ups to `clubs` ON A NAME, so a coach's own repertoire
#      was missing 26% of his elevens and missing them where it decides: Gattuso came back with 2 elevens
#      and has 79, Tedesco 3 of 28, Spalletti 31 of 107. Three coaches sat under `COACH_SHAPE_MIN` while
#      their real sample was well over it, which is the board drawing the PREDECESSOR's shape at exactly
#      the clubs `coach_shapes` exists for. Resolved through `club_index` like every other club join.
#   9  08/08/2026 - `desc_level_elo` is filled for a man with NO previous roster too, from the club of his
#      measured WINDOW: Alajbegovic had never been in a listone, so he carried no level at all while his
#      ten matches were Bayer Leverkusen's (1836.6, above Juventus's own 1819.4). The adopted level
#      channels now reach him, and the window branch of `presence.standing` takes them.
#  10  08/08/2026 - THE PERIMETER IS THE TARGET LISTONE, NOT LAST SEASON'S RATINGS. `perimeter_clubs`
#      read `match_ratings` for (input, target); in August the target has no ratings, so every
#      preseason sheet was filtered on the season that ENDED: the 2026-27 Serie A sheet listed the
#      relegated Cremonese, Pisa and Verona (94 rows, none purchasable) and silently dropped all 74
#      quoted players of the promoted Frosinone, Monza and Venezia - three clubs you WILL buy from,
#      absent from the auction sheet and from every board. Found comparing the boards with the
#      press's 2026-27 typical formations. The perimeter now comes from `listone_quotes` for the
#      target season (contingent >= PERIMETER_SQUAD_MIN, or a stray roster row smuggles a foreign
#      club in), with ratings as the fallback for windows the quotes backfill does not cover.
#  11  08/08/2026 (evening) - THE MEASURED SEASON GOT BIGGER, in three ways that all move `desc_*` and
#      therefore every claim built on them. (a) An identity already in `player_xref` now attributes a
#      season the name pools cannot see, because the listone's perimeter changes every summer: 59 men
#      of the 2026-27 listone had NO 2025-26 aggregate at all (Doekhi, Geubbels - both started by the
#      press), and `external_stats` went from 11,732 to 16,970 rows. (b) The FEEDER championships
#      arrived (`config.FEEDER_LEAGUES`: Serie B), so a promoted club's men have measured starts and
#      minutes instead of none - Frosinone 2 of 25 quoted players with an aggregate, now 22 - and
#      `CHAMPIONSHIPS` is the denominator, 38 rounds of Serie B rather than the 24 elevens we parsed.
#      (c) `transfers_history` resolves by the canonical Transfermarkt id (unresolved 4,422 -> 2,508)
#      and no longer keeps the same deal twice under two club spellings. Plus one new column,
#      `desc_costart_low`. Measured against the press: 160 -> 164 of 220 men, 9 -> 10 modules exact.
#  12  08/08/2026 (late) - one new column, `desc_age`, and no value moved: the panel builds its
#      `presence.Inputs` from the sheet, so an age channel could not even be MEASURED without it (the
#      `level_z` lesson - a parameter whose input never reaches the caller is switched on and blind).
#      The channel itself was measured and refused by both judges and sits at 0; the column stays,
#      because the next hypothesis about age should not have to pay for it again.
#  13  08/08/2026 - THE LEVEL OF A MAN WHO WAS NEVER IN A LISTONE. `desc_level_elo` read the roster's
#      previous club, so for somebody arriving from outside the perimeter it had nothing to read and the
#      two ADOPTED level channels were blind on him: 91 of 158 arrivals on the Serie A sheet carried no
#      level at all. Third fallback added - the club his season AGGREGATE says he played for, by the
#      provider's team id (`elo.levels_by_minutes`) - which reaches a man whose recent-form window was
#      never fetched. Coverage on arrivals 67 -> 74, and the guard is the interesting half: the fallback
#      REFUSES a club that is the one he is still at, because `level_gap` measures what a man gains by
#      MOVING and a promoted squad moved nowhere. Without that guard it took Frosinone from MATCH to
#      DIFF against the press and drew it 3-3-1-3. Judges: press unchanged (11/5/4, 166/220), outcome
#      134 -> 137 men of 220.
#  14  08/08/2026 - A NEW SIGNING IS NOT AN UNKNOWN MAN. `est_pv` for whoever has no season on this
#      platform was the share of a man with NOTHING measured anywhere (0.29 default / 0.19 euro), which
#      is what the sheet said about Gonçalo Ramos - 11 presences of 38 for a €74M striker with 1320
#      measured Ligue 1 minutes and 13 starts. Found by the operator on the number, not on the code:
#      «è comunque l'attaccante titolare di una squadra di buon livello». The three inputs he really
#      lacks are `pv_prev`/`mv_prev`/`fm_prev` ON THIS PLATFORM; his football abroad is measured and was
#      simply not read. Now it is: `est.presences_from_abroad`, a line fitted on that exact population
#      (his league minutes over that league's rounds), leave-one-SEASON-out MAE 0.2300 against 0.2803
#      for the constant on default (+17.9%) and 0.2831 against 0.2983 on euro (+5.1%). The FANTAMEDIA
#      stays the anchor - R1 lost to it on five windows of six, and what a man did abroad predicts how
#      much he PLAYS, not how well. `engine_*` does not move: this is the estimate layer, which the gate
#      never sees (`backtest --verify` 22/22).
#  16  14/08/2026 - THE TREND OF THE LAST TEN REAL MATCHES, and the bench that was already in the data.
#      Eleven new `desc_trend_*` columns (the operator's item 5): the club's last ten CHAMPIONSHIP
#      matches with the vote, the fantapunti, the cards, the xG+xA and a mark on the rounds the euro
#      calendar never counted - 3 to 7 a season per league, i.e. 18% of a man's football invisible in
#      his euro fantamedia. Plus `desc_form_bench` / `desc_form_out`, which SPLIT a count the sheet
#      used to give as one: an unused substitute has always been in the per-match layer (79,437 rows,
#      `started` = 0 and `minutes` NULL, because the provider's payload gives him a statistics object
#      with `totalShots` and no `minutesPlayed`), so the planned offline re-parse was not needed - the
#      todolist's claim that «the parse discards the bench» came from a true observation (no row has
#      `minutes` = 0) and a wrong conclusion. Nothing gated moves; `engine_*` is untouched.
#  17  14/08/2026 - WHO GAINED A PLACE AND WHO LOST ONE (the operator's item 6). Nine `desc_place_*`
#      columns: the DAY a man's minutes changed durably, and what was happening on his line at that
#      day. The control is the point - «a man who plays because the starter in front of him is broken
#      has not won the place» - and it is done on DATES, because co-occurrence answers the wrong thing:
#      Bartesaghi's first 90 minutes are the round of 3-5 October and Estupinan's ankle is of the 12th,
#      so the injury consolidated the place and did not cause it. Measured on 635 Serie A rows: 243
#      changes, 128 gained and 115 lost. Reporting only - the predictive form of this idea reads +0.049
#      over 8 instances (6/8) - and `engine_*` is untouched again.
#  18  15/08/2026 - AND THE OTHER HALF OF THE PAIR: `est_mv`, so every player always has a realistic MV
#      as well as an FM (the operator's rule of 05/08, one column further). It is DERIVED and never
#      guessed apart - `MV = FM - bonus per appearance` - with his own rate padded toward his role's by
#      the votes he has (`est.bonus_rate`, the same shrink as everywhere else - REPLACED at 32). Measured on 3750 Serie A
#      player-seasons: the rate is a property of the man (r = +0.842 from one season to the next) and it
#      is huge for keepers (-1.29) against +0.05 for defenders, so a single number would have been
#      useless. A direct estimate of the MV was available and about as good (anchor + 0.45(his - anchor),
#      MAE 0.148 against 0.166 for the anchor alone and 0.170 for his own raw MV) and is refused on
#      purpose: a second free number could contradict the first, and «fm - mv» would stop being a bonus
#      rate anybody chose. Reporting, like the whole `est_*` prefix: `engine_*` does not move a decimal.
#      CORRECTED at revision 32: the direct estimate this entry refused is the one that ships, and the
#      reason given for refusing it was wrong - deriving the RATE keeps one number and one derivation just
#      as well, and puts the regression toward the anchor on the half that can carry it.
#  19  16/08/2026 - IL VALORE DI MERCATO SI LEGGE AL GIORNO DELL'ASTA. `desc_market_value` (e la quota di
#      squadra che ne esce) veniva dalla fotografia della stagione di INPUT, vecchia fino a un anno;
#      adesso e' l'ultimo punto della CURVA a quella data (`market_value_history`), con la fotografia
#      come ripiego e `desc_market_value_basis` che dice quale delle due e' finita nella riga. Copertura
#      sul foglio di oggi 76% -> 96% su Serie A e 82% -> 89% su euro. `engine_*` non si muove: il peso
#      di questo canale e' 0 finche' lo sweep non parla.
#  20  16/08/2026 - IL SURPLUS IN CREDITI SUL FOGLIO: `desc_spm` (surplus x il tasso del suo ruolo di
#      listone) e `desc_dvm` (SpM - FVM), che vivevano solo nel pannello Tk. Stessa coppia di funzioni
#      (`evaluate.market_rates` / `market_surplus`), tasso fittato sulla lista INTERA prima di ogni
#      restringimento, surplus quello che la riga mostra (motore dove c'e', stima altrove). Reporting,
#      come l'FVM su cui e' tarata: nessuna regola la legge e il gate non la chiama.
#  21  16/08/2026 - R20 ADOTTATA, un K per piattaforma (K=10 su Serie A, K=6 su euro): un foglio
#      costruito a stagione iniziata (`--date`) legge le giornate gia' giocate nelle presenze attese.
#      Su un foglio PRE-STAGIONE non cambia un decimale - la regola e' inerte a zero giornate viste - ma
#      la revisione sale lo stesso, perche' i pacchetti del viaggio nel tempo SONO in-season e i loro
#      numeri si muovono: una revisione per due comportamenti sarebbe una cartella che non sa dire quale
#      dei due la descrive.
#  22  16/08/2026 - L'ALTRO ZERO SUL FOGLIO: `desc_replacement_fielded` e `desc_surplus_fielded`, il
#      rimpiazzo che ENTRA (rango `squadre x posti che il regolamento schiera`, non `x slot di rosa`) e
#      il surplus misurato su di lui. Due domande diverse e nessuna vince: «chi conviene comprare» conta
#      dal marginale di rosa, «quanto costa una giornata saltata» dal rimpiazzo schierato, e sui primi
#      25 del foglio Serie A i due ordini condividono 13 nomi su 25 (P5 D1 C0 A19 contro P3 D5 C8 A9).
#      REPORTING: `engine_surplus` non si muove di un decimale - e' gated - e il gate non vede queste
#      colonne. I posti vengono CONTATI dal regolamento (`features.fielded_places`), non scelti.
#  23  17/08/2026 - LA COPPA CONTINENTALE IN MEZZO AL CAMPIONATO: `desc_cup*`, `desc_pv_cup`,
#      `desc_value_cup`. Tre fatti e una misura: le finestre e le qualificate sono DICHIARATE
#      (`config/international_cups.json`, dal registro pubblico), la nazionalità è un'IDENTITÀ letta dai
#      payload che già pagavamo (`players.nationality`, 0 righe su 4674 prima di oggi, 1840 dopo, e
#      validata sui 300 quotati del Mondiale 2026 a 299), e quanto perde uno di quel profilo è MISURATO
#      col difference-in-differences su quattro finestre-torneo (AFC 0.59 · CAF 0.35 se nazionale, 0.20
#      se no). Sul 2026-27 tocca 13 quotati e nessun africano: la Coppa d'Africa 2027 è a giugno.
#      REPORTING - `engine_pv_pred` non si muove di un decimale e il gate non vede queste colonne.
#  24  17/08/2026, poche ore dopo - PENALITÀ A TUTTI, e la revisione sale perché i NUMERI della 23 sono
#      già superati: il coefficiente non è più uno per confederazione ma uno per POPOLAZIONE (`regular` /
#      `rotation` / `fringe`, misurate: CAF 0,35/0,09/0,03 da nazionale e 0,20/0,07/0,03 da convocabile,
#      AFC 0,59 e la forma prestata sotto), al posto del tappo `pv/calendario` che sbagliava di quattro
#      volte in basso. Con le rose dei tornei scaricate arrivano anche `desc_cup_band` /
#      `desc_cup_confirmed` - una convocazione NOTA cancella la probabilità e la penalità diventa il
#      costo di andarci (0,59, misurato su quattro tornei e identico in Africa e in Asia) - e i due
#      surplus al netto (`desc_surplus_cup`, `desc_surplus_fielded_cup`), con la stessa penale di
#      confidenza dei gated: senza quella la coppa sembrava PAGARE su una riga stimata.
#      Il POST-TORNEO estivo è stato misurato e RIFIUTATO (+0,06 e +0,02 su due finestre, segno opposto).
#  25  17/08/2026, notte - CHI E' IN ROSA LO DECIDE SOFASCORE, e il foglio OBBEDISCE. Fino a qui la regola
#      era l'opposto e sta scritta in CLAUDE.md: «il listone e' l'autorita' del gioco su chi e' in rosa -
#      e' quello da cui compri - quindi una contraddizione si RIPORTA e non si applica», e la riga restava
#      al suo club con un `⇥`. L'operatore l'ha ribaltata («l'autorita' di chi e' in rosa e' sofascore»),
#      quindi un uomo che i due segnali indipendenti dicono partito ESCE dal foglio: non e' comprabile da
#      quel club, e una riga comprabile che non lo e' e' peggio di una riga in meno. Misurato sui fogli di
#      oggi: Serie A 53 righe in meno (36 da un trasferimento che nomina la destinazione, 17 dalla rosa
#      live), euro 63 (29 + 34). IL COSTO VA DETTO: il segnale della rosa live ha precisione misurata
#      **83,1%** al gate di completezza (`SQUAD_COMPLETENESS` 0.90, 172 assenze), quindi circa un uomo su
#      sei fra quelli tolti per assenza c'e' ancora - prima quel costo lo pagava la board, che lo
#      escludeva gia', e adesso lo paga anche la lista d'asta. Reversibile a ogni corsa: `--keep-departed`
#      rimette la vecchia regola, e la nota del foglio dice sempre quanti e chi.
#  26  17/08/2026, notte tarda - LE RIGHE SONO LE ROSE OSSERVATE e non piu' i soli quotati: «quando fai lo
#      snapshot devi vedere tutti i calciatori in rosa a prescindere se e' quotato o meno nel listone»
#      (operatore). Il modo `squad` di `features.load`: il CLUB e il CAMPIONATO vengono dalla rosa che la
#      fonte legge ogni giorno, le quotazioni dal listone per chi ce le ha, e chi la fonte non ha mai visto
#      tiene il club del listone (ignoto non e' partito). Il caso che lo ha deciso e' Molina: quotato
#      all'Atletico sul listone euro, alla Roma dal 14/08 secondo la fonte, quindi prima non esisteva sul
#      foglio Serie A e su euro era all'Atletico. Misurato sulla finestra Serie A di quel giorno: 499 righe
#      quotate contro **730** osservate. `--listone-only` torna al foglio di prima. Il gate non si muove: il
#      suo `squad_source` resta `listone` e un test lo asserisce.
#  27  18/08/2026 - IL FOGLIO STA SU OGGI, e le fonti ufficiali si rileggono davvero. Tre difetti, una
#      domanda dell'operatore («Vicario oggi e' stato ufficializzato alla Juventus, perche' lo snapshot
#      non lo ha aggiornato?»): (a) la data d'asta era `min(15 agosto, oggi)`, quindi dal 16/08 ogni
#      foglio stava tre giorni indietro e tutto cio' che e' datato dopo era invisibile PER COSTRUZIONE -
#      comprese le probabili scaricate quella mattina; (b) di conseguenza il refresh della rosa live era
#      un no-op silenzioso, perche' `fetch_roles` chiedeva i file di cache del 15/08 che erano gia' su
#      disco (0 richieste, «0 clubs to fetch»); (c) il listone non veniva riletto mai - quello sul disco
#      era del 07/08 e di Vicario non aveva nessuna riga. Ora la data e' OGGI per la stagione che si
#      compra (il 15 agosto convenzionale resta solo per una stagione gia' passata, dove serve a impedire
#      il look-ahead), l'osservazione della rosa live e' datata col giorno in cui si osserva, e
#      `snapshot --refresh` rilegge anche il listone dichiarando chi ha cambiato club.
#   28 (19/08/2026) - la board porta `minutes_next`, i minuti che ci si aspetta da un uomo in una partita
#      che gioca la stagione che viene (`engine/minutes.py`). Non e' una colonna del foglio - il claim
#      esiste solo nel pannello - ma viaggia nella cartella del foglio, quindi una cartella senza il campo
#      e' da rifare: l'app disegna `—` invece del numero, che e' onesto e non e' quello che si vuole.
#   29 (19/08/2026) - LE PRESENZE DEL RUNG `older` NON SONO PIU' IL SUO VECCHIO PV. Da sempre quel gradino
#      REGREDISCE la fantamedia verso l'ancora e consegnava le presenze intatte, senza nemmeno convertirle
#      fra i due calendari: lo stesso difetto, sull'altra meta' della coppia. Trovato dove una presenza
#      grezza pesa di piu' - l'Overall dell'app e' `presenze x (voto + bonus)` - su Arthur Melo, 32 voti
#      alla Fiorentina nel 2023-24 e niente da allora, letto 32 su 38 e QUARTO di tutto il listone di
#      Serie A con una fantamedia da 6,34. Misurato sulla popolazione che quel pv la usa davvero (niente
#      misurato a t-1 su nessuna delle due piattaforme e nessun minuto di lega all'estero), leave-one-
#      season-out, chi non gioca contato per lo zero che e': MAE 0,3749 -> 0,2689 su default (n=221, 8
#      stagioni, +28,3%, positivo su 8 su 8) e 0,3510 -> 0,2993 su euro (n=48, 3 stagioni, +14,7%).
#      `est.OLDER_SHARE` / `OLDER_PV_BETA`, per piattaforma perche' le due dicono cose diverse e il
#      meccanismo si spiega; il valore euro e' fragile e la nota lo dichiara. Si muovono `est_pv`, e
#      quindi `est_surplus`, `desc_spm`/`desc_dvm` e i due surplus di coppa, sulle 46 righe `older` del
#      foglio Serie A e sulle omologhe di euro. `engine_*` non si muove di un decimale: e' un ripiego.
#   30 (19/08/2026) - QUANTO IL CLUB HA INVESTITO SU DI LUI, RISPETTO A CHI GLI CONTENDE LA MAGLIA.
#      Dalla contestazione dell'operatore su Gonçalo Ramos: 30 partite su 34 in Ligue 1 con 13 da titolare,
#      e il foglio gli dava 18,1 presenze su 38. Tre canali provati e respinti (le presenze all'estero al
#      posto dei minuti, il passo di livello Elo, il reparto per macro-ruolo), uno adottato: il rapporto
#      fra il suo valore di mercato e quello del migliore dei rivali PESATO dalla rivalita', piu' il suo
#      percentile di valore. La rivalita' e' l'intersezione dei profili di posizione sulle ultime DUE
#      stagioni (scelta dichiarata dell'operatore), da `tm_appearances.position_id` - la posizione partita
#      per partita di Transfermarkt, acquisita oggi: 3.446 giocatori, 2.047.914 partite, zero richieste
#      senza risposta. Leao ha giocato da centravanti nel 27% delle sue partite, quindi contende a Ramos
#      un quarto di maglia e non una. Cross-fit leave-one-window-out: +4,74% su default (5 finestre di 6)
#      e +5,56% su euro (4 su 4); il reparto per codice mantra fa +4,86% e +4,00%, e la scelta di
#      spedire le POSIZIONI costa 0,12 punti su default per guadagnarne 1,56 su euro con una definizione
#      sola - il prezzo sta scritto in `est.INVESTMENT_SHARE`. Ripiego sul codice mantra per chi la fonte
#      non ha mai visto (2 righe su 259 e 8 su 560) e la riga dichiara quale reparto ha risposto.
#      Si muovono `est_pv` e tutto quello che lo moltiplica - `est_surplus`, `desc_spm`/`desc_dvm`, i due
#      surplus di coppa - e quindi anche Overall, Lead, Margine e Fantapunti dell'app, che e' la scelta
#      (b) dell'operatore: un uomo ha una previsione sola. `engine_*` non si muove: e' sempre un ripiego.
#   31 (19/08/2026) - LA QUOTA DI RIPIEGO E' DEL RUOLO, e le tre colonne `pi_*` di Fpi viaggiano.
#      Dalla domanda dell'operatore, «un terzo portiere dovrebbe avere pv=0, perche' risulta 15?»: la
#      costante era misurata a ruoli MESCOLATI e per un portiere valeva tre volte troppo - 0.098 contro
#      lo 0.29 in vigore su default, 0.076 contro 0.19 su euro, con il 77% di quella popolazione che non
#      gioca affatto e la mediana a ZERO. Pesati sulla loro numerosita' i quattro ruoli ridanno
#      l'aggregato in vigore (0.272 e 0.207): la misura non cambia, si DIVIDE, e il pezzo sbagliato era
#      uno solo. Cercata prima nel posto sbagliato, e vale scriverlo: il foglio prevedeva 56 presenze da
#      portiere per club contro le 38 che un club distribuisce davvero, e sembrava un vincolo di
#      bilancio - ma sugli altri ruoli il bilancio era gia' giusto (D +7%, C +4%, A -0%), quindi non
#      c'era niente da normalizzare. Le due normalizzazioni provate e respinte, con i numeri e con i
#      nomi che le hanno fatte cadere, stanno in `est.PRESENCE_SHARE_BY_ROLE`.
#      Si muovono `est_pv` e tutto quello che lo moltiplica; `engine_*` no.
#   33 (20/08/2026) - QUANTO IL CLUB HA PAGATO PER AVERLO, sul totale che ha speso. Dalla domanda
#      dell'operatore su Kolo Muani: 30 partite col Tottenham, ne aspetta 28, il foglio ne dava 20. La
#      causa era leggibile e nessuno la leggeva: il canale investimento usa il VALORE DI MERCATO, che per
#      lui e' del 03/06/2026 e quindi PRECEDE il trasferimento (Transfermarkt aggiorna a trimestri),
#      mentre la fee - 41,2M - era in `transfers_history` da sempre. Quattro bracci pre-registrati sulla
#      fee GREZZA sono caduti tutti (-1,1% a -9,8% su default, -0,5% a -0,8% su euro); quello che passa e'
#      la fee in rapporto alla spesa totale del club, che e' anche la sola forma che il progetto avesse
#      scritto prima («the FEE, 54% and 27% of what their clubs spent»), ed e' POST-HOC e lo dichiara.
#      Cross-fit leave-one-window-out su T0/T1/T2 - tre finestre, perche' le fee cominciano nel 2023:
#      **euro +4,30% 3/3 strict** sulle righe con fee (+1,16% su tutta la popolazione), e regge i due
#      controlli che decidono - la spesa del club messa nel modello (+2,71%, e da sola la spesa non porta
#      niente: -0,02%) e la soglia sulle fee pubblicate (strict a 0/3/5/8). Su **default non si adotta**:
#      stessa direzione (k +0,40 contro +0,21) e valore non identificato, il verdetto si ribalta togliendo
#      TRE righe su 57. Additivo sopra il numero del gradino precedente, quindi chi non ha una fee resta
#      identico per costruzione. Pesa poco e va detto: mediana +0,6 giornate su 31, massimo +3,9, e Kolo
#      Muani ne guadagna +1,0 - non le otto che mancano ai suoi 28. Si muovono `est_pv` del foglio euro e
#      tutto quello che lo moltiplica; `engine_*` no, e i fogli Serie A non si muovono affatto.
#   34 (20/08/2026) - R23 ADOTTATA, e il minutaggio della board non e' piu' al rovescio su euro.
#      R23 (`quota, Mv, cambio, top, percentile`: il REPARTO in cui un uomo arriva, misurato sul compagno
#      piu' caro che gli disputa il posto) e' robusta su default 9 finestre su 10 (+2,84%) e passa su
#      euro/mantra 5 su 5 (+3,82%), quindi si muovono `engine_pv_pred` e TUTTO quello che lo moltiplica -
#      Overall, Lead, Margine, Fantapunti, Fpi. Cade su euro/classic (i nomi d'asta 43 -> 42) e la
#      decisione e' scritta in chiaro nel gate, §7-noviestricies.
#      E l'adozione ha reso visibile il difetto accanto: `minutes.start_rate_next` divideva il numeratore
#      del PANNELLO per il denominatore del MOTORE, e `presence.py` non importa `evaluate` - quindi ogni
#      regola nuova alzava le presenze e ABBASSAVA per costruzione i minuti previsti a partita, mentre i
#      due cambi realizzati si muovono insieme (r +0,566 / +0,448). Ora su euro il denominatore e' la
#      risposta del pannello alla stessa domanda (`presence.voto_share`, +1,44% su 4 finestre su 4,
#      strict): si muove `minutes_next` dentro `boards.json`, di -1,0' in media e +1,1' su chi arriva da
#      un altro campionato. Su default non si adotta e non si muove niente (§7-quadragies).
SHEET_REVISION = 34

# How complete a live payload must be before its SILENCE counts as evidence, as a share of the identified
# squad the sheet itself shows for that club. MEASURED, not chosen (05/08/2026, over the euro and the
# Serie A sheets, 172 absences, precision = the share a transfer corroborates - a LOWER bound, since the
# provider caught Gutierrez a week before the transfers layer did):
#
#   gate   absences kept   corroborated   precision   absence-only claims kept
#   0.00        172              99          57.6%              73
#   0.80        130              94          72.3%              36
#   0.85         94              77          81.9%              17
#   0.90         59              49          83.1%              10      <- the plateau starts here
#   0.95         27              24          88.9%               3      <- and the signal all but vanishes
#
# `/team/{id}/players` is the FIRST TEAM, and how much of it the provider publishes varies: West Ham reads
# 18 men against 29 identified, and every one of its 14 "departures" was uncorroborated - while Bologna at
# 0.86 was 6/6 right. Below the gate a silence is under-reading, not a departure. Precision is what this
# guard buys and recall is what it costs, and the asymmetry decides: a false departure hides a man who is
# really there, a missed one only leaves the listone's own claim standing.
SQUAD_COMPLETENESS = 0.90

# The stages a build walks, in order, each with the SECONDS it was measured to cost - which is the only
# reason a percentage may be shown at all. Seconds and not shares, because the two stages that touch the
# network dominate the total when they run and cost nothing when the cache already answers, so a fixed
# share would be wrong in both directions.
# Measured on 03/08/2026, euro/mantra 2026-27 (910 rows, 34 clubs): the offline stages from
# `[snapshot] stages:`, the timing line every run now prints (65s in total, of which the engine fit is
# 37); `roles` from the cache timestamps of a real refresh - 35 club pages in 95s plus a 71-player
# top-up in 197s - and `refresh` from its two page fetches, the one stage small enough not to matter.
# They are re-measurable the same way: read the timing line after any run.
# What the percentage is NOT: an estimate of the seconds remaining. A build's cost is dominated by
# whatever the DB is missing that day, so the honest reading is "this much of the WORK is behind us",
# with the stage name beside it saying which work. The label is what the operator reads.
STAGES: tuple[tuple[str, str, float], ...] = (
    ("refresh", "today's probabili + the listone", 14.0),
    # The three network refreshes added 18/08/2026, each bounded by the perimeter (59 clubs with a
    # Transfermarkt id) and each cached PER DAY, so the second and third sheet of an afternoon pay ~0.
    # Costs from the first real run of the chain; re-read them off the timing line like the others.
    ("market", "the summer market", 365.0),
    ("contracts", "the clubs' own squad pages", 215.0),
    ("strength", "the clubs' Elo", 69.0),
    ("derive", "the layers a new listone moves", 20.0),
    # ...and the stages a run without `--refresh` does not walk at all, so the bar's denominator is the
    # work this build will really do.
    ("squads", "real squads", 14.0),
    ("roles", "granular real roles", 293.0),
    ("prepare", "engine features", 5.0),
    ("predict", "engine predictions", 37.0),
    ("form", "the club's last ten", 4.4),
    ("layers", "descriptive layers", 4.3),
    ("fielded", "the eleven fielded next", 0.5),
    ("rows", "the sheet's rows", 1.0),
    ("write", "csv + manifest", 0.5),
    ("boards", "the drawn boards", 6.0),
)


#: The stages a build WITHOUT `--refresh` does not walk. Derived from one place so the bar and the
#: chain cannot disagree: every network stage plus the offline re-derivation that only a refresh causes.
SKIPPED_WITHOUT_REFRESH: tuple[str, ...] = (
    "refresh", "market", "contracts", "strength", "derive", "roles")


class Progress:
    """How much of a build is behind us, printed as a percentage the panel can read.

    One line per stage, `[snapshot] 46% · descriptive layers`, on stdout with everything else the module
    says - so the CLI log, the Operations log and the Snapshot tab's own bar all get the same signal from
    the same place, and none of them has to model this module's phases. The panel parses the percentage
    (`SnapshotView.building`) and falls back to the stage text on a line that carries no number.

    The arithmetic is in SECONDS: each finished stage adds its measured cost, and the percentage is that
    over the cost of the stages this run will really walk. Hence a build with no refresh is not a bar
    that stops at 20% - the two network stages are dropped from the denominator - and a `tick(0, 0)`
    means "this stage found nothing to do", which drops it too rather than jumping the bar over work that
    never happened. Monotone by construction: a stage closes at its full cost, and dropping a stage only
    ever shrinks the denominator.

    Within a long stage `tick()` interpolates over a COUNTED total (clubs to observe, players to walk) -
    a real fraction of a real denominator, never a spinner dressed up as a number.

    It also records how long each stage really took and prints it at the end, which is what makes the
    costs above a measurement instead of a guess: they were read off that line, and re-reading it is how
    they get corrected when the module changes.
    """

    def __init__(self, skip: tuple[str, ...] | set[str] = ()) -> None:
        self.cost = {key: seconds for key, _label, seconds in STAGES if key not in skip}
        self.labels = {key: label for key, label, _seconds in STAGES}
        self.spent = 0.0                    # the measured seconds the finished stages account for
        self.current: str | None = None
        self.timings: dict[str, float] = {}
        self._started = time.monotonic()
        self._stage_started = self._started

    def _say(self, seconds: float, label: str) -> None:
        share = seconds / (sum(self.cost.values()) or 1.0)
        print(f"[snapshot] {min(round(share * 100), 99):2.0f}% · {label}", flush=True)

    def stage(self, key: str, label: str | None = None) -> None:
        """Start a stage: closes the one before it at its FULL cost and announces this one."""
        now = time.monotonic()
        if self.current:
            self.timings[self.current] = now - self._stage_started
            self.spent += self.cost.get(self.current, 0.0)
        self._stage_started = now
        self.current = key
        if key in self.cost:
            self._say(self.spent, label or self.labels.get(key, key))

    def tick(self, count: int, total: int, label: str | None = None) -> None:
        """Interpolate inside the current stage over a counted total (`4/34 clubs`).

        `total == 0` is the answer "nothing to fetch": the stage is dropped from the denominator, which
        is the difference between a bar that credits the cache and one that pretends 34 clubs were
        observed in a second.
        """
        if not self.current:
            return
        if not total:
            self.cost.pop(self.current, None)
            self._say(self.spent, f"{self.labels.get(self.current, self.current)} - nothing to fetch")
            return
        share = self.spent + self.cost.get(self.current, 0.0) * min(count / total, 1.0)
        self._say(share, f"{label or self.labels.get(self.current, self.current)} {count}/{total}")

    def finish(self) -> None:
        """100%, and the timing line the costs are re-measured from."""
        if self.current:
            self.timings[self.current] = time.monotonic() - self._stage_started
            self.current = None
        elapsed = time.monotonic() - self._started
        print("[snapshot] 100% · done", flush=True)
        if self.timings:
            measured = " · ".join(f"{key} {value:.1f}s ({value / (elapsed or 1):.0%})"
                                  for key, value in self.timings.items())
            print(f"[snapshot] stages: {measured} · total {elapsed:.1f}s")


def _months_before(date: str, months: int) -> str:
    year, month, day = (int(part) for part in date.split("-"))
    month -= months
    year += (month - 1) // 12
    month = (month - 1) % 12 + 1
    return f"{year:04d}-{month:02d}-{min(day, 28):02d}"


# ---------------------------------------------------------------- window
def season_of(date: str) -> str:
    """The season a date belongs to: July onwards opens the new one ('2026-07-28' -> '2026-27')."""
    year, month = int(date[:4]), int(date[5:7])
    start = year if month >= 7 else year - 1
    return f"{start}-{(start + 1) % 100:02d}"


def resolve_window(conn, season: str | None = None, today: str | None = None,
                   as_of: str | None = None) -> tuple[features.Window, str | None]:
    """(window, note). The target is the season being AUCTIONED, listone or not.

    The default target is the season today belongs to - not the newest listone. That is the whole point
    of the exercise: in July the auction being prepared is for a season whose listone does not exist
    yet, and the sheet has to work anyway, off the real squads. When the listone IS out it simply adds
    the roles and the quotations on top.
    """
    seasons = [row[0] for row in conn.execute(
        "SELECT DISTINCT season FROM rosters ORDER BY season")]
    if not seasons:
        raise RuntimeError("no rosters in the DB - run `bootstrap` (or at least `ratings`) first")
    # `as_of` IS the day the sheet stands on, so it is also the day that decides which season is being
    # played: standing on 1 March 2026 the season in progress is 2025-26, and reading "today" from the
    # clock instead would auction 2026-27 with March's squads - two different seasons in one sheet.
    today = as_of or today or dt.datetime.now(tz=dt.UTC).date().isoformat()
    target = season or season_of(today)
    note = None
    if target not in seasons:
        note = (f"{target} has no listone yet (rosters = 0): the sheet is built from the REAL squads, "
                f"so roles come from each player's last listone row and there are no quotations to "
                f"show. Rerun it when the listone is out and the same command fills them in.")
    earlier = [value for value in seasons if value < target]
    input_season = earlier[-1] if earlier else target
    # `as_of` is taken literally, 15 August is not imposed on it: the point of a back-dated snapshot is to
    # stand on a DAY inside a season - "what did this squad look like on 1 March" - and clamping it to the
    # pre-season would answer a different question.
    #
    # Without it: TODAY for the season being auctioned, and the conventional 15 August only for a target
    # season already PAST, where it is what stops a dry run from reading the future it pretends not to
    # know. It used to be `min(15 August, today)`, which is the same thing until 15 August and FREEZES the
    # sheet afterwards - the mirror of the `elo.auction_dates` defect (a conventional day filed before it
    # had arrived), met on the other side of the same date. Measured on 18/08/2026, the day the operator
    # asked why an official transfer was not in the sheet: every run stood on 2026-08-15 and therefore
    # (a) discarded that day's own probabili and injuries, dated after it, (b) turned the live-squad
    # refresh into a silent no-op, because `fetch_roles` asks for `sofascore_squad_*_{date}.json` and the
    # 15/08 files were already on disk - so the freshest squad the sheet could ever see was frozen three
    # days back, and would have stayed frozen for the whole season.
    auction = as_of or (today if target >= season_of(today) else f"{target.split('-')[0]}-08-15")
    return features.Window("SNAP", input_season, target, auction), note


# ---------------------------------------------------------------- the real squad
def club_index(conn):
    """A function mapping ANY spelling of a club to one canonical key.

    Necessary, not tidy: the fixtures are keyed by the provider's name ('FC Bayern München'), the
    listone says 'Bayern Monaco' and Transfermarkt says something else again. Keyed naively, the same
    club becomes three, which reads as a transfer that never happened and as a squad whose matches
    cannot be found.
    """
    from euroleghe_ingest.matching import CLUB_ALIASES, club_key

    canonical: dict[str, str] = {}
    for (name,) in conn.execute("SELECT canonical_name FROM clubs WHERE canonical_name IS NOT NULL"):
        for spelling in (name, CLUB_ALIASES.get(name, name)):
            canonical.setdefault(club_key(spelling), name)
    # ...and every OTHER spelling of ours that the alias table sends to the same provider club. Needed
    # since the twin identities were merged (`db.database.merge_twin_clubs`): `Eintracht Francoforte` was
    # a row of `clubs` and is now only an alias key, while 1210 rows of `match_ratings.team` and 27
    # transfers still spell it that way - and a source string is EVIDENCE, never rewritten to match a
    # table. Without this the merge would have traded three split clubs for three unreadable spellings.
    for ours, theirs in CLUB_ALIASES.items():
        known = canonical.get(club_key(theirs))
        if known is not None:
            canonical.setdefault(club_key(ours), known)

    def resolve(name: str | None) -> tuple[str, str] | tuple[None, None]:
        """(key, our canonical name). The KEY is derived from the canonical name, not from the input:
        keyed on the input, 'Bayern Monaco' and 'FC Bayern München' both map to the same club and still
        land in two different buckets - which is what made half the squad look transferred."""
        if not name:
            return None, None
        ours = canonical.get(club_key(name))
        if ours is None:
            return club_key(name), name
        return club_key(ours), ours

    return resolve


def derive_squads(ctx: Context, date: str | None = None,
                  season: str | None = None) -> dict[str, int]:
    """Who is REALLY in each club's squad today -> `squad_snapshot`. Offline, from three sources.

    An auction is prepared before the listone exists, so the sheet cannot be built from `rosters`.
    These are, strongest first:

      fc_site        the probabili page carries an exact fc_id in every href, so its 20 Serie A squads
                     are certain - but it is Serie A only, AND only for the season the page is about:
                     `season` keeps the last round of the season that ended from asserting a squad for
                     the one being auctioned (07/08/2026: 442 rows a day, all of 2025-26);
      transfermarkt  the CURRENT squad page of each perimeter club (already cached by `injuries`),
                     resolved through player_xref: all five leagues, ~1400 players;
      appearances    whoever actually played for the club in its recent matches - the backstop, and the
                     only source for a club neither page covers.

    Dated on purpose: a squad is a fact about a DAY, and in August it changes weekly. Same discipline as
    every other volatile state - the snapshot then reads "the squad as of the auction date".
    """
    from euroleghe_ingest.db import database

    conn = ctx.require_conn()
    date = date or dt.datetime.now(tz=dt.UTC).date().isoformat()
    counts = {"fc_site": 0, "sofascore": 0, "transfermarkt": 0, "appearances": 0}

    # A SECOND WRITER CAN BE HOLDING THE LOCK, and this phase is where it hurts most: it is the FIRST thing
    # a snapshot writes, so a long acquisition running beside it kills a run before it has produced
    # anything. Measured 19/08/2026 - a `timepack --all --refresh` died here after 8 minutes and three
    # packs, with `database is locked` on the first INSERT, while another session held the write lock.
    # `busy_timeout` (5s, one statement) cannot cover a lock held for minutes; the growing wait can, and it
    # is ONE definition for every writer (`db.database.retry_on_lock`) precisely because the private copy
    # `performance.store` grew on 17/08 could not be reached from here.
    def write(sql: str, args: tuple) -> None:
        database.retry_on_lock(lambda: conn.execute(sql, args), what="real squads")
    # Normalized ON WRITE: the three sources spell a club three ways, and a squad table keyed on the
    # provider's spelling cannot be joined to `clubs` - which is how a real squad ends up with no
    # league, no fixtures and no club in the sheet.
    resolve = club_index(conn)

    def canonical(name):
        return resolve(name)[1]

    # Each source is dated with ITS OWN date, never with the run's: writing today's probabili as if
    # they had been known on an August 2025 auction day is look-ahead, and the whole point of dating
    # these states is that a dry run cannot read the future it pretends not to know.
    latest_probabili = conn.execute(
        "SELECT MAX(valid_from) FROM probable_starter WHERE valid_from <= ?"
        + (" AND season = ?" if season else ""),
        (date, season) if season else (date,)).fetchone()[0]
    if latest_probabili:
        for fc_id, team, role in conn.execute(
                "SELECT fc_id, team, role FROM probable_starter WHERE valid_from = ?"
                + (" AND season = ?" if season else ""),
                (latest_probabili, season) if season else (latest_probabili,)):
            write(
                "INSERT OR REPLACE INTO squad_snapshot(fc_id, valid_from, club, source, role_hint) "
                "VALUES (?, ?, ?, 'fc_site', ?)",
                (fc_id, latest_probabili, canonical(team), role))
            counts["fc_site"] += 1

    # THE LIVE SQUAD, and it is the freshest thing we have: `/team/{id}/players` is one request per club,
    # already downloaded every day for the granular roles, and dated. Measured on the case that asked for a
    # reliable source: on 28/07 its Napoli payload had 46 players and NOT Gutierrez, while `fc_site` still
    # listed him on 04/08 and the Transfermarkt squad page on 29/07 - the provider had the departure a week
    # before either of them. Read from the same cache the roles layer reads (`positions._squad_players`), so
    # there is one parser and no new request.
    from euroleghe_ingest.modules.positions import _SQUAD_CACHE_NAME, _squad_players

    by_provider = {source_id: club for source_id, club in conn.execute(
        "SELECT x.source_id, cl.canonical_name FROM club_xref x JOIN clubs cl "
        "ON cl.fc_club_id = x.fc_club_id WHERE x.source = 'sofascore'")}
    player_ids = {source_id: fc_id for source_id, fc_id in conn.execute(
        "SELECT source_id, fc_id FROM player_xref WHERE source = 'sofascore'")}
    newest: dict[str, tuple[str, Path]] = {}
    for path in sorted(ctx.config.cache_dir.glob("sofascore_squad_*.json")):
        key = _SQUAD_CACHE_NAME.search(path.name)
        if not key or key.group(2) > date:
            continue                          # a payload observed after the sheet's day is the future
        club = by_provider.get(key.group(1))
        if club and (club not in newest or key.group(2) > newest[club][0]):
            newest[club] = (key.group(2), path)
    for club, (observed, path) in newest.items():
        try:
            players = _squad_players(json.loads(path.read_text(encoding="utf-8")))
        except Exception as exc:   # noqa: BLE001 - a corrupt cache file must not abort a snapshot
            print(f"[snapshot] skipping unreadable squad cache {path.name}: {exc}")
            continue
        for player in players:
            fc_id = player_ids.get(str(player.get("id") or ""))
            if fc_id is None:
                continue
            write(
                "INSERT OR REPLACE INTO squad_snapshot(fc_id, valid_from, club, source, role_hint) "
                "VALUES (?, ?, ?, 'sofascore', NULL)", (fc_id, observed, club))
            counts["sofascore"] = counts.get("sofascore", 0) + 1

    from euroleghe_ingest.modules.injuries import _SQUAD_CACHE, parse_squad

    xref = {source_id: fc_id for source_id, fc_id in conn.execute(
        "SELECT source_id, fc_id FROM player_xref WHERE source = 'transfermarkt'")}
    clubs = {tm_id: club for club, tm_id in conn.execute(
        "SELECT c.canonical_name, x.source_id FROM club_xref x JOIN clubs c USING(fc_club_id) "
        "WHERE x.source = 'transfermarkt'")}
    # The Transfermarkt pages already carry their own date in the file name, which is why a page
    # fetched today does not inform an auction dated last August.
    for path in sorted(ctx.config.cache_dir.glob("transfermarkt_squad_*.html")):
        key = _SQUAD_CACHE.search(path.name)
        club = clubs.get(key.group(1)) if key else None
        if not club:
            continue
        try:
            records = parse_squad(path.read_text(encoding="utf-8"))
        except OSError:
            continue
        for rec in records:
            fc_id = xref.get(rec["tm_id"])
            if fc_id is None:
                continue
            write(
                "INSERT OR REPLACE INTO squad_snapshot(fc_id, valid_from, club, source, role_hint) "
                "VALUES (?, ?, ?, 'transfermarkt', NULL)", (fc_id, key.group(2), canonical(club)))
            counts["transfermarkt"] += 1

    # The backstop: whoever appeared for a club RECENTLY is in that club's squad. Two bounds, both
    # learned from the sheet itself:
    #   * only a club we KNOW - otherwise the sheet grows rows for Al-Qadsiah and Rosenborg, clubs
    #     nobody in this league can buy from, arriving with no league and no fixtures;
    #   * only the last `SQUAD_APPEARANCE_MONTHS` - his LAST appearance EVER put Handanovic and Cordaz
    #     in Inter's 2026 squad, and made Lecce a 70-man club. A squad is who is there now.
    known_clubs = {name for (name,) in conn.execute(
        "SELECT canonical_name FROM clubs WHERE canonical_name IS NOT NULL")}
    # A club whose CURRENT squad page we have needs no backstop, and taking one anyway is what made
    # Bologna a 72-man club: everyone who appeared for it in fourteen months, including the men it sold
    # in January. Where the page exists it IS the squad; the backstop is for the clubs without one.
    with_page = {club for (club,) in conn.execute(
        "SELECT DISTINCT club FROM squad_snapshot WHERE source IN ('transfermarkt', 'fc_site')")}
    floor = _months_before(date, SQUAD_APPEARANCE_MONTHS)
    for fc_id, club in conn.execute(
            """SELECT e.fc_id, e.club FROM external_match_stats e
               JOIN (SELECT fc_id, MAX(match_date) AS last FROM external_match_stats
                     WHERE COALESCE(minutes, 0) > 0 AND match_date >= ? AND match_date < ?
                     GROUP BY fc_id) last
                 ON last.fc_id = e.fc_id AND last.last = e.match_date
               WHERE e.club IS NOT NULL AND COALESCE(e.minutes, 0) > 0
               GROUP BY e.fc_id""", (floor, date)):
        name = canonical(club)
        if name not in known_clubs or name in with_page:
            continue
        write(
            "INSERT OR REPLACE INTO squad_snapshot(fc_id, valid_from, club, source, role_hint) "
            "VALUES (?, ?, ?, 'appearances', NULL)", (fc_id, date, name))
        counts["appearances"] += 1
    # ...and the COMMIT waits too: SQLite takes the write lock at the first statement and needs to upgrade
    # it here, so a reader that arrived in between - the Tk panel is one - can refuse a phase that has
    # already done all its work.
    database.retry_on_lock(conn.commit, what="real squads")
    total = conn.execute("SELECT COUNT(DISTINCT fc_id) FROM squad_snapshot").fetchone()[0]
    print(f"[snapshot] real squads: {total} players "
          f"(fc_site {counts['fc_site']}, sofascore {counts['sofascore']}, "
          f"transfermarkt {counts['transfermarkt']}, appearances {counts['appearances']})")
    return counts


# ---------------------------------------------------------------- descriptive layers
# What KIND of match a performance happened in. Ten goals in friendlies are worth something, and much
# less than ten in a league - so the classes are reported side by side and never summed into one number.
# The slugs are the provider's own (`external_match_stats.competition`).
COMPETITION_CLASSES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("friendly", ("friendly", "amichevo", "club-friendly", "pre-season", "trophy")),
    ("continental", ("champions-league", "europa-league", "conference", "libertadores",
                     "sudamericana", "club-world", "super-cup", "supercoppa", "supercup")),
    ("national", ("world-cup", "euro-", "nations-league", "copa-america", "africa-cup", "asian-cup",
                  "qualification", "friendlies-international")),
    ("cup", ("coppa", "cup", "copa", "pokal", "dfb", "efl", "carabao", "fa-", "coupe")),
    ("league", ()),        # the fallback: our own five leagues and every other domestic championship
)

# THE COMPETITIONS THAT MAKE UP A PLATFORM'S CALENDAR, and therefore the only ones a "share of the
# season" may be measured over. They are the CHAMPIONSHIPS (`config.CHAMPIONSHIPS`: the five in scope
# plus the feeder ones a promoted club comes up from), which is also the value
# `external_match_stats.competition` / `club_match_lineups.competition` carry for a league match - the
# cups and the continental rounds arrive with the provider's own slug ('uefa-champions-league',
# 'coppa-italia', ...), so the set is exact and not a prefix match.
#
# Why it is a filter and not a detail: the season AGGREGATE (`external_stats`) stores one row per
# championship and nothing else, so every numerator in this sheet - starts, appearances, minutes - is
# already league-only. The DENOMINATOR was the club's whole fixture list, and the competition mix is
# different for every club (Arsenal 58 elevens = 38 + 14 + 6, Bayern 50, Napoli 38 = Serie A alone).
# A percentage of one and a percentage of the other are not the same quantity, so the shirts read
# titolarità that could not be compared across clubs: Kane 25 starts of 34 Bundesliga rounds printed
# 50%, and a European campaign was indistinguishable from a bench.
# `CHAMPIONSHIPS` and not `LEAGUES`: the question here is «is this a league match?», not «is it one of
# our five?». A promoted club's last season was a real championship with a real calendar, and counting
# it as no championship at all divided its men's starts by the elevens we happened to parse (Frosinone
# 24) instead of by Serie B's 38 rounds - the same defect as Kane's 49%, on the clubs least able to
# absorb it. The cups and continental ties still arrive with the provider's own slug and are excluded.
LEAGUE_COMPETITIONS: tuple[str, ...] = config.CHAMPIONSHIPS
_LEAGUE_IN = ",".join("?" * len(LEAGUE_COMPETITIONS))


def competition_class(slug: str | None) -> str:
    lowered = (slug or "").lower()
    for label, needles in COMPETITION_CLASSES:
        if any(needle in lowered for needle in needles):
            return label
    return "league"


def squad_as_of(conn, date: str) -> tuple[dict[int, str], dict[int, str]]:
    """(club per player, source per player) from `squad_snapshot` as of a date.

    Precedence where the sources disagree: fc_site (an exact fc_id in the page) beats Transfermarkt
    (a resolved name) beats an appearance. Ties within a source go to the most recent observation.
    """
    order = {"fc_site": 0, "transfermarkt": 1, "appearances": 2}
    best: dict[int, tuple] = {}
    for fc_id, club, source, valid_from in conn.execute(
            "SELECT fc_id, club, source, valid_from FROM squad_snapshot WHERE valid_from <= ? "
            "ORDER BY valid_from", (date,)):
        rank = (order.get(source, 9), )
        current = best.get(fc_id)
        if current is None or rank <= current[0]:
            best[fc_id] = (rank, club, source, valid_from)
    return ({fc_id: entry[1] for fc_id, entry in best.items()},
            {fc_id: entry[2] for fc_id, entry in best.items()})


def club_matches(conn, auction_date: str, resolve, limit: int = FORM_MATCHES,
                 competitions: tuple[str, ...] | None = None) -> dict[str, list[tuple]]:
    """Each club's last `limit` matches before the auction date: (date, match_id, competition, season).

    Two sources, unioned: `club_match_lineups` (one row per club-match of the five leagues we scrape)
    and the per-match rows themselves, which is what brings in the cups, the friendlies and the other
    championships `recent_form` fetched. Keyed by the canonical club, so the provider's spelling and
    the listone's agree. A match nobody appeared in and no lineup recorded does not exist for us, and
    the count says so rather than pretending it was a rest.

    `competitions` restricts the walk, and the TREND is the caller that needs it: «the last ten REAL
    matches» are the last ten of a CHAMPIONSHIP, because those are the only ones a vote can exist for
    (a cup tie has neither a fantacalcio vote nor a calibrated synthetic one) and because the question
    behind the window - how much of him the euro calendar never counted - is about league rounds. One
    function, two calls, the argument saying which side is asking.
    """
    where = ""
    params: tuple = (auction_date, auction_date)
    if competitions:
        holes = ",".join("?" * len(competitions))
        where = f" AND competition IN ({holes})"
        params = (auction_date, *competitions, auction_date, *competitions)
    rows = conn.execute(
        f"""
        SELECT club, match_date, match_id, competition, season FROM club_match_lineups
        WHERE match_date IS NOT NULL AND match_date < ?{where}
        UNION
        SELECT club, match_date, match_id, competition, season FROM external_match_stats
        WHERE match_date IS NOT NULL AND match_date < ? AND club IS NOT NULL{where}
        ORDER BY match_date DESC
        """,
        params,
    ).fetchall()
    # More than `limit` per club: a fixture is only a candidate until it is known WHOSE it was, and a
    # man who joined this summer does not own his new club's spring (see `player_clubs`). Keeping a
    # deeper list is what lets his own window reach back past the transfer instead of ending short.
    depth = limit * 6
    out: dict[str, list[tuple]] = {}
    for club, date, match_id, competition, season in rows:
        key, _name = resolve(club)
        if key is None:
            continue
        bucket = out.setdefault(key, [])
        if len(bucket) < depth and all(str(match_id) != str(known[1]) for known in bucket):
            bucket.append((date, match_id, competition, season))
    return out


def _by_date(item: tuple):
    """Sort key for a fixture tuple: its date. A named function, so no closure captures a loop name."""
    return item[0]


# One token per match of the club's last ten, oldest first, so the strip reads left to right like a
# calendar. Deliberately compact: the sheet is a CSV a human also opens in Excel.
#   p:<rating>:<minutes>  he played        b  in the layer, no minutes: bench or left out
#   i                     inside a recorded INJURY spell on that date
#   s                     inside a recorded SUSPENSION - a different reason from an injury, and from a
#                         choice: the absence list carries it as its own kind
#   n                     no player-level data for that match at all - unknown, which includes not
#                         being in the squad. Never conflated with `b`.
def absence_spells(conn, auction_date: str) -> dict[int, list[tuple[str, str, str]]]:
    """(start, end, token) per player: 's' for a suspension, 'i' for anything else.

    A suspension is not an injury and not a choice, and the absence list already tells them apart -
    Transfermarkt lists "Squalifica" as its own kind, which `classify_injury` maps to `suspension`. The
    end is filled with the auction date when the spell is still open. A suspension nobody recorded reads
    as bench, which is the honest fallback: we do not know that he was banned.
    """
    out: dict[int, list[tuple[str, str, str]]] = {}
    for fc_id, start, end, kind in conn.execute(
            "SELECT fc_id, start_date, end_date, kind FROM injuries WHERE start_date <= ?",
            (auction_date,)):
        out.setdefault(fc_id, []).append(
            (start, end or auction_date, "s" if kind == "suspension" else "i"))
    return out


def player_clubs(conn, resolve) -> dict[int, dict[str, set[str]]]:
    """{fc_id: {club_key: the seasons he belonged to it}} - whose calendar a man's window may walk.

    Found by CALLING the function on a real case rather than by reading it (14/08/2026): Doekhi, in
    the 2026-27 listone at Lazio after a summer from Union Berlin, was given a window that interleaved
    Lazio's spring with his own Bundesliga matches and scored him ZERO on six rounds his new club
    played while he was still in Germany. The two-pass club resolution was right about which clubs the
    window spans and had no way to say WHEN each of them was his.

    Two sources, and neither alone is enough. The LISTONE says where he was quoted each season, which
    is what keeps a man injured from August to May attached to his club - he has no appearances at all
    and his rounds must still read «injured» and not «no window». The APPEARANCES say where he really
    played, which is what covers a season the listone never quoted him in (a foreign club, a promoted
    side, a January move). A club is his for a season if either says so.
    """
    out: dict[int, dict[str, set[str]]] = {}
    for fc_id, season, club in conn.execute(
            """SELECT r.fc_id, r.season, c.canonical_name FROM rosters r
               JOIN clubs c ON c.fc_club_id = r.fc_club_id WHERE c.canonical_name IS NOT NULL"""):
        key, _name = resolve(club)
        if key:
            out.setdefault(fc_id, {}).setdefault(key, set()).add(season)
    for fc_id, season, club in conn.execute(
            """SELECT DISTINCT fc_id, season, club FROM external_match_stats
               WHERE club IS NOT NULL"""):
        key, _name = resolve(club)
        if key:
            out.setdefault(fc_id, {}).setdefault(key, set()).add(season)
    return out


def bench_matches(conn, auction_date: str) -> dict[int, set[str]]:
    """{fc_id: the matches he was NAMED ON THE BENCH for and never came on}.

    MEASURED, not derived: in a league payload an unused substitute carries a statistics object with
    `totalShots` and no `minutesPlayed` at all, so the parser has always stored his row - 79,437 of
    them, `started` = 0 and `minutes` NULL, and 7 of those carry a rating. The todolist said the parse
    «discards the bench without an appearance» and planned an offline re-parse to recover it; the
    re-parse was not needed, and the claim came from the right observation (no row anywhere has
    `minutes` = 0) with the wrong conclusion attached. The bench was already in the database, under a
    NULL.

    The LEAGUE source only. In `sofascore_extra` a row with no minutes means something else and the
    difference is not a detail: the provider publishes a friendly's eleven and NO per-player statistics
    at all, so there `started` = 0 with no minutes cannot tell an unused substitute from a man who
    played an hour. Reading it as a bench would be a claim about the player made out of a gap in the
    source - the same reason the app's consultation table refuses it.
    """
    out: dict[int, set[str]] = {}
    for fc_id, match_id in conn.execute(
            """SELECT fc_id, match_id FROM external_match_stats
               WHERE source = 'sofascore' AND match_date IS NOT NULL AND match_date < ?
                 AND COALESCE(started, 0) = 0 AND minutes IS NULL""", (auction_date,)):
        out.setdefault(fc_id, set()).add(str(match_id))
    return out


def euro_mapped_leagues(conn) -> set[tuple[str, str]]:
    """The (season, league) pairs the euro calendar is aligned for, so «outside it» can be said at all.

    A season nobody has mapped is not a season the euro game skipped: `matchday_map` is empty for
    2021-22 (a source limit, `fetch --plan` classifies it), and marking every round of it as invisible
    would turn a hole of ours into a fact about the game. Where the pair is missing the mark is unknown.
    """
    return {(season, league) for season, league in conn.execute(
        "SELECT DISTINCT season, league FROM matchday_map")}


def _xga(xg, xa, shots) -> float | None:
    """xG + xA of one match, or None when the provider did not serve it that season.

    The convention on a NULL is MEASURED and it is not the same on both halves. A NULL `xg` on a row
    with `shots` = 0 is a zero - 19,719 of 19,719 such rows in 2025-26 have no shots, and the provider
    changed the payload's shape between seasons (an explicit 0 until 2022-23, the key omitted from
    2024-25), so the reader imposes the convention instead of trusting the encoding. A NULL on a row
    that DID shoot is unknown: before 2022-23 the payload carries no xG at all (0 of 446 players in
    the cached 2021-22 files), and drawing a zero there would be the opposite defect - inventing a
    measurement out of a season the source never covered.
    """
    if xg is None and (shots is None or shots > 0):
        return None
    if xa is None and (shots is None or shots > 0):
        return None
    return round((xg or 0.0) + (xa or 0.0), 3)


def match_worth(real_fantavoto, real_mv, mv_synth, goals: int, assists: int,
                keeper: bool, scoring: dict[str, float] | None) -> tuple:
    """(vote, source, fantapunti) for one match, from a cascade DECLARED here and nowhere else.

    The bar's height is a VOTE and the judgement is in FANTAPUNTI - two different numbers, and the
    operator asked for both: the real vote when the game gave one, the calibrated synthetic base voto
    when the euro calendar skipped that round (18% of a championship), and nothing at all otherwise.
    Never a zero: a match with no vote is a match we cannot score, and a zero would be a bad one.

    The real side is taken WHOLE - `match_ratings.fantavoto`, the fantavoto the votes API's own
    arithmetic produced - so the sheet and the ratings can never disagree about a match that was
    voted. The synthetic side has to be built, and it is built with the same terms the FM-equivalent
    uses (`arrivals.fm_equivalent`): base voto plus the league's own goal and assist bonuses. TWO
    things it cannot carry, stated instead of approximated:

    * CARDS. The per-match layer has no bookings (0 non-null `yellows` in 250,678 rows), so a
      synthetic fantapunto is missing a malus that is real - it reads slightly HIGH, by at most the
      card malus itself.
    * GOALKEEPERS. Their fantavoto is dominated by the goals conceded, which no per-match row of ours
      carries; measured on the men it could be measured on, the outfield formula reads +0.82 to +1.22
      above a keeper's real fantamedia. So a keeper's synthetic match has a vote and NO fantapunti,
      and the trend's denominator loses it rather than gaining a number inflated by a goal a game.

    No scoring handed in - a caller that has no league to read one for - means the same thing: the
    vote still stands, the fantapunti do not, because the bonus values are a LEAGUE's and this project
    hard-codes none of them.
    """
    if real_fantavoto is not None:
        return real_mv, "real", real_fantavoto
    if mv_synth is None:
        return None, None, None
    if keeper or not scoring:
        return mv_synth, "synth", None
    return (mv_synth, "synth",
            round(mv_synth + scoring["goal_bonus"] * goals + scoring["assist_bonus"] * assists, 3))


class Appearance(NamedTuple):
    """One match a player really played, with what it was worth. Keyed by (fc_id, match_id)."""
    club: str | None
    competition: str | None
    date: str
    minutes: int
    started: int | None
    rating: float | None
    goals: int
    assists: int
    vote: float | None
    vote_source: str | None
    points: float | None
    yellows: int | None
    reds: int | None
    xga: float | None
    in_euro: int | None


def appearances_with_worth(conn, auction_date: str,
                           scoring: dict[str, dict[str, float]] | None = None,
                           ) -> dict[int, dict[str, Appearance]]:
    """Every appearance before the auction date, with the vote and the fantapunti of that match.

    The join is the one `arrivals` already uses and it is the only one that reaches a real vote from a
    per-match row: `matchday_map` translates the real round into the euro one, and on Serie A the
    `default` platform IS the real calendar, so its matchday and `real_md` are the same number
    (verified: 11,899 of 11,901 played Serie A rows of 2025-26 find their ratings row). `default` is
    preferred where both exist - it covers the whole championship, while euro covers 31 rounds of 38 -
    and it is restricted to `serie_a`, or a foreign round number would meet an Italian one.
    """
    out: dict[int, dict[str, Appearance]] = {}
    mapped = euro_mapped_leagues(conn)
    for (fc_id, match_id, club, competition, date, minutes, started, rating, goals, assists,
         real_fv, real_mv, mv_synth, xg, xa, shots, position, yellows, reds,
         euro_md, season) in conn.execute(
            """
            SELECT e.fc_id, e.match_id, e.club, e.competition, e.match_date,
                   COALESCE(e.minutes, 0), e.started, e.rating,
                   COALESCE(e.goals, 0), COALESCE(e.assists, 0),
                   COALESCE(dm.fantavoto, em.fantavoto), COALESCE(dm.mv, em.mv), e.mv_synth,
                   e.xg, e.xa, e.shots, e.position,
                   COALESCE(dm.yellows, em.yellows), COALESCE(dm.reds, em.reds),
                   m.euro_md, e.season
            FROM external_match_stats e
            LEFT JOIN matchday_map m ON m.season = e.season AND m.league = e.competition
                                    AND m.real_md = e.real_md
            LEFT JOIN match_ratings em ON em.fc_id = e.fc_id AND em.season = e.season
                                      AND em.platform = 'euro' AND em.matchday = m.euro_md
            LEFT JOIN match_ratings dm ON dm.fc_id = e.fc_id AND dm.season = e.season
                                      AND dm.platform = 'default' AND e.competition = 'serie_a'
                                      AND dm.matchday = e.real_md
            WHERE e.match_date IS NOT NULL AND e.match_date < ? AND COALESCE(e.minutes, 0) > 0
            """, (auction_date,)):
        vote, source, points = match_worth(
            real_fv, real_mv, mv_synth, goals, assists, position == "G",
            (scoring or {}).get(competition or "") or (scoring or {}).get(""))
        out.setdefault(fc_id, {})[str(match_id)] = Appearance(
            club, competition, date, minutes, started, rating, goals, assists,
            vote, source, points,
            yellows if source == "real" else None, reds if source == "real" else None,
            _xga(xg, xa, shots),
            (1 if euro_md is not None else 0) if (season, competition) in mapped else None)
    return out


def _state_token(fc_id: int, match_id: str, date: str, entry: Appearance | None, known: bool,
                 benched: dict[int, set[str]], lineup_only: dict[int, set[str]],
                 spells: dict[int, list[tuple[str, str, str]]]) -> str:
    """What happened to this man in this match, in one character. The ORDER is the claim.

      p:<rating>:<minutes>  he played
      b                     NAMED ON THE BENCH and never came on - measured, not inferred
      x                     in the ELEVEN of a match nobody has statistics for (a friendly)
      i / s                 inside a recorded injury / suspension spell on that date
      o                     the match is on file, he has no row and no spell: OUT of the squad
      n                     no player-level data for that match at all - unknown

    The bench WINS over a spell, and that is the whole point of item 6.6: a man named among the
    substitutes was available and was not chosen, which is a different fact from being unavailable -
    and it is the one that changes a bid. A spell whose dates happen to cover the day cannot overrule
    the team sheet he is printed on.
    """
    if entry:
        return f"p:{entry.rating if entry.rating is not None else ''}:{entry.minutes}"
    if match_id in benched.get(fc_id, ()):
        return "b"
    if match_id in lineup_only.get(fc_id, ()):
        return "x"
    if (reason := next((code for start, end, code in spells.get(fc_id, ())
                        if start <= date <= end), None)):
        return reason
    return "o" if known else "n"


def club_form(conn, auction_date: str, observations, squads: dict[int, str],
              limit: int = FORM_MATCHES,
              scoring: dict[str, dict[str, float]] | None = None,
              target_season: str | None = None) -> dict[int, dict]:
    """Form measured over the last `limit` matches of the player's CLUB, not of the player.

    The difference is the whole point. A player's own last ten appearances hide the weeks he sat on the
    bench; his CLUB's last ten do not - a man who never came on reads `played 0 of 10`, which is the
    fact an auction needs. Where he changed club inside the window the two clubs' matches are merged in
    date order, so the sample follows the player and not a shirt.

    Two honesty rules, both learned the hard way on this very sheet:

    * a player with NO rows in the per-match layer (identity unresolved, or a league we do not scrape)
      reads UNKNOWN, not `0 of 10`. 231 of the 2025-26 listone are in that state, and reporting them as
      "never played" would be a lie about a fact we do not have. `desc_form_source` says which it is.
    * "named on the bench" is now MEASURED and no longer folded into "not in the squad" (see
      `bench_matches`): `desc_form_bench` counts the first, `desc_form_out` the second, and `unused`
      stays as their sum so nothing that read it changes meaning.

    Goals and assists are split league / other and never summed: ten goals in friendlies are worth
    something, and nothing like ten in a league.

    TWO WINDOWS COME OUT OF ONE WALK, and they answer two questions. `form` is the club's last ten in
    EVERY competition - "has he been playing", which in August is mostly friendlies. `trend` is the
    club's last ten of a CHAMPIONSHIP with what each of them was worth - "how has he been doing" - and
    it is the operator's own reading (14/08/2026): the euro calendar skips 3 to 7 real rounds a season,
    so a man judged on his euro fantamedia alone is judged on 82% of his football. Two windows means
    two sets of counters, never one picture explained by the other's numbers.
    """
    resolve = club_index(conn)
    fixtures = club_matches(conn, auction_date, resolve, limit)
    league_fixtures = club_matches(conn, auction_date, resolve, limit, LEAGUE_COMPETITIONS)
    spells = absence_spells(conn, auction_date)
    benched = bench_matches(conn, auction_date)
    belongs = player_clubs(conn, resolve)
    now = {target_season} if target_season else None
    covered = {fc_id for (fc_id,) in conn.execute(
        "SELECT DISTINCT fc_id FROM external_match_stats")}
    # Which MATCHES we have player-level rows for at all. A club's last ten include cups and other
    # competitions we never scraped player-by-player: counting those as "he did not play" would turn a
    # gap in our data into a statement about the player. They are counted apart.
    with_players = {str(match_id) for (match_id,) in conn.execute(
        "SELECT DISTINCT match_id FROM external_match_stats "
        "WHERE match_date IS NOT NULL AND COALESCE(minutes, 0) > 0")}
    # In the ELEVEN of a match nobody has statistics for - a pre-season friendly. It is neither a
    # performance nor an absence, so it is counted as neither: it gets its own token, and the strip
    # draws it small and grey because there is no rating to colour it with.
    lineup_only: dict[int, set[str]] = {}
    for fc_id, match_id in conn.execute(
            """SELECT fc_id, match_id FROM external_match_stats
               WHERE match_date IS NOT NULL AND match_date < ? AND started = 1
                 AND COALESCE(minutes, 0) = 0""", (auction_date,)):
        lineup_only.setdefault(fc_id, set()).add(str(match_id))
    appearances = appearances_with_worth(conn, auction_date, scoring)
    # Who the club played, per match: a fact about the FIXTURE, so it is available for the matches he did
    # not play too - which is exactly where the strip needs it to become readable.
    opponents: dict[tuple[str, str], tuple[str, int]] = {}
    for match_id, club, opponent, home in conn.execute(
            """SELECT match_id, club, opponent, home FROM external_match_stats
               WHERE match_date IS NOT NULL AND match_date < ? AND opponent IS NOT NULL
               GROUP BY match_id, club""", (auction_date,)):
        key, _name = resolve(club)
        if key:
            opponents[(key, str(match_id))] = (opponent, home or 0)

    out: dict[int, dict] = {}
    for obs in observations:
        if obs.fc_id not in covered:
            out[obs.fc_id] = {"source": "not in the per-match layer (identity unresolved, or a "
                                        "competition we do not scrape): UNKNOWN, not zero"}
            continue
        mine = appearances.get(obs.fc_id, {})

        def build(clubs: dict[str, str], calendar=fixtures, _mine=obs.fc_id) -> list[tuple]:
            his = belongs.get(_mine, {})
            pool: list[tuple] = []
            for key in clubs:
                # A club neither the listone nor his appearances attach to him is one the LIVE SQUAD
                # put there: he is at it NOW, so its current season counts and its past does not.
                seasons = his.get(key, now)
                pool += [(date, match_id, competition, key)
                         for date, match_id, competition, season in calendar.get(key, [])
                         if seasons is None or season in seasons]
            pool.sort(key=_by_date, reverse=True)
            seen: set[str] = set()
            window: list[tuple] = []
            for date, match_id, competition, key in pool:
                if str(match_id) in seen:
                    continue
                seen.add(str(match_id))
                window.append((date, match_id, competition, key))
                if len(window) >= limit:
                    break
            return window

        # WHOSE calendar the window walks: where he is NOW, plus every club of his last `limit`
        # appearances. A transfer is exactly what this resolves - the sample becomes his old club's
        # matches up to the move and his new club's after it - and the two halves cannot bleed into
        # each other, because `build` keeps a club's fixtures only for the seasons that club was his
        # (`player_clubs`). Both halves are needed: without the current club a man injured all season
        # has no window at all, and without the clubs he played for a summer arrival's window is his
        # new club's pre-season and nothing else.
        clubs: dict[str, str] = {}
        for candidate in (squads.get(obs.fc_id), obs.club_target):
            key, name = resolve(candidate)
            if key:
                clubs.setdefault(key, name)
        for entry in sorted(mine.values(), key=lambda one: one.date, reverse=True)[:limit]:
            key, name = resolve(entry.club)
            if key:
                clubs.setdefault(key, name)
        window = build(clubs)
        if not window:
            out[obs.fc_id] = {"source": f"no recent matches recorded for "
                                        f"{', '.join(clubs.values()) or 'his club'}"}
            continue

        played = starts = minutes = measured = bench = 0
        ratings: list[float] = []
        goals: dict[str, int] = {}
        assists: dict[str, int] = {}
        kinds: dict[str, int] = {}
        series: list[str] = []
        detail: list[str] = []
        for date, match_id, competition, club_key in reversed(window):  # oldest first, for the strip
            kind = competition_class(competition)
            kinds[kind] = kinds.get(kind, 0) + 1
            known = str(match_id) in with_players
            if known:
                measured += 1
            entry = mine.get(str(match_id))
            token = _state_token(obs.fc_id, str(match_id), date, entry, known,
                                 benched, lineup_only, spells)
            if token == "b":
                bench += 1
            series.append(token)
            # One line per match for the popup: everything a dot cannot say. Same order as the strip.
            opponent, home = opponents.get((club_key, str(match_id)), ("", 0))
            detail.append("|".join(str(part) for part in (
                date, competition or "", opponent, "H" if home else "A", token.split(":")[0],
                entry.minutes if entry else "", entry.rating if entry and entry.rating is not None else "",
                entry.goals if entry else "", entry.assists if entry else "",
                1 if entry and entry.started else "")))
            if not entry:
                continue
            played += 1
            minutes += entry.minutes
            starts += 1 if entry.started else 0
            if entry.rating is not None:
                ratings.append(entry.rating)
            goals[kind] = goals.get(kind, 0) + entry.goals
            assists[kind] = assists.get(kind, 0) + entry.assists
        out[obs.fc_id] = {
            "club_matches": len(window),
            "measured": measured,
            "played": played,
            # bench or out of the squad, among the matches we DO have player rows for. Kept as their
            # sum because everything that already read it means "he did not play"; the split is in
            # `bench` and `out`, and the bench half is measured (`bench_matches`).
            "unused": measured - played,
            "bench": bench,
            "out": measured - played - bench,
            "unknown": len(window) - measured,
            "starts": starts,
            "minutes": minutes,
            "minutes_per_club_match": round(minutes / measured, 1) if measured else None,
            "rating": round(sum(ratings) / len(ratings), 2) if ratings else None,
            "goals_league": goals.get("league", 0),
            "assists_league": assists.get("league", 0),
            "goals_other": sum(count for kind, count in goals.items() if kind != "league"),
            "assists_other": sum(count for kind, count in assists.items() if kind != "league"),
            "competitions": " ".join(f"{kind}x{count}" for kind, count in
                                     sorted(kinds.items(), key=lambda item: -item[1])),
            # only a REAL transfer shows up here: the clubs are compared canonically, so the provider's
            # 'FC Bayern München' and the listone's 'Bayern Monaco' are one club, not two
            "clubs": "; ".join(sorted(clubs.values())) if len(clubs) > 1 else None,
            "last_match": window[0][0] if window else None,
            "series": " ".join(series),
            "detail": ";".join(detail),
            "source": "per-match layer",
            **trend_block(obs.fc_id, build(clubs, league_fixtures), mine, with_players,
                          benched, lineup_only, spells, opponents),
        }
    return out


# What a match he did not play is worth in the trend: ZERO, and the reason is the operator's own
# formula - the mean has to carry AVAILABILITY as well as quality, because `Var(ln pv)` is 90% of
# `Var(ln fantapunti)` and a man who is not on the pitch collects nothing. What it must never do is
# put a zero where we do not KNOW: an unmeasured match leaves the denominator instead.
_TREND_ZERO: frozenset[str] = frozenset({"b", "i", "s", "o"})


def trend_block(fc_id: int, window: list[tuple], mine: dict[str, Appearance],
                with_players: set[str], benched: dict[int, set[str]],
                lineup_only: dict[int, set[str]],
                spells: dict[int, list[tuple[str, str, str]]],
                opponents: dict[tuple[str, str], tuple[str, int]]) -> dict:
    """The last ten CHAMPIONSHIP matches, one record each, and the judgement that orders them.

    `trend_fp` is the mean of the fantapunti he collected over them - the operator's own definition
    (14/08/2026): a match he did not play counts ZERO, a match nobody can score does not enter the
    denominator at all. `trend_matches` says how many did, so a mean over three matches never reads
    as a mean over ten.

    IT IS A DESCRIPTION AND NOT A PREDICTION, and that has to travel with the number. The same day it
    was measured that a player's departure from his own averages does NOT predict what he does next -
    the true excess over the reshuffled null is +0.0167 / +0.0072 / -0.0007 at two, three and five
    matchdays, and the sign changes - so ordering by the trend is ordering by «what he has done»,
    which is legitimate and fast, and selling it as «what he will do» would be the third refused form
    of one idea. Nothing under `engine/` reads this.
    """
    record: list[str] = []
    points: list[float] = []
    played = starts = minutes = bench = missed = 0
    goals = assists = 0
    outside = 0
    for date, match_id, competition, club_key in reversed(window):     # oldest first, like the strip
        entry = mine.get(str(match_id))
        token = _state_token(fc_id, str(match_id), date, entry, str(match_id) in with_players,
                             benched, lineup_only, spells)
        state = token.split(":")[0]
        if state == "b":
            bench += 1
        if state in _TREND_ZERO:
            missed += 1
            points.append(0.0)
        if entry:
            played += 1
            minutes += entry.minutes
            starts += 1 if entry.started else 0
            goals += entry.goals
            assists += entry.assists
            if entry.points is not None:
                points.append(entry.points)
            if entry.in_euro == 0:
                outside += 1
        opponent, home = opponents.get((club_key, str(match_id)), ("", 0))
        record.append("|".join("" if part is None else str(part) for part in (
            date, competition or "", opponent, "H" if home else "A", state,
            entry.minutes if entry else "", 1 if entry and entry.started else "",
            entry.vote if entry else None, entry.vote_source if entry else None,
            entry.points if entry else None,
            entry.goals if entry else "", entry.assists if entry else "",
            entry.yellows if entry else None, entry.reds if entry else None,
            entry.xga if entry else None, entry.in_euro if entry else None)))
    return {
        "trend_window": len(window),
        "trend_played": played,
        "trend_starts": starts,
        "trend_bench": bench,
        "trend_minutes": minutes,
        "trend_goals": goals,
        "trend_assists": assists,
        # How many of them the euro calendar never counted: the reason this window exists at all.
        "trend_outside_euro": outside,
        "trend_matches": len(points),
        "trend_fp": round(sum(points) / len(points), 3) if points else None,
        "trend_detail": ";".join(record),
    }


# ---------- who GAINED a place during the season, and who LOST it (item 6) ----------
# How many matches each side of the split, and how big the step has to be. DISPLAY thresholds, in the
# same class as the injury marks: nothing fits on them, no valuation reads them, and they are declared
# here rather than tuned. Five matches because four is a rotation; thirty minutes a match because a
# place is not won for a quarter of an hour, and because both cases the operator brought are far above
# it (Bartesaghi 6 -> 78, Angelino 78 -> 2).
PLACE_MIN_SIDE = 5
PLACE_MIN_JUMP = 30.0
# How long after the change an injury still counts as «it came later, and consolidated it». The Milan
# case is exactly this: the place changed hands on 3-5 October and the ankle is of the 12th.
PLACE_FOLLOWS_DAYS = 30


def _role_codes(roles: str | None) -> list[str]:
    """`DL;ML` -> ['DL', 'ML']. The GRANULAR vocabulary, which is upper case and stays that way: the
    Mantra splitter next door lower-cases, and one of these lists joined to the other would match
    nothing at all."""
    return [code.strip().upper() for code in (roles or "").split(";") if code.strip()]


def season_fixtures(conn, season: str, resolve, before: str | None = None) -> dict[str, list[tuple]]:
    """{club_key: every CHAMPIONSHIP match of that season, oldest first}.

    The whole season and not a window: the question is when a place changed hands, and that day can be
    anywhere in it. Ordered by DATE and never by matchday - a postponement makes round 16 arrive after
    round 20, which is exactly what the per-match layer shows for Milan 2025-26, and a walk that trusted
    the number would place the change on the wrong day.
    """
    where = " AND match_date < ?" if before else ""
    params: tuple = ((season, *LEAGUE_COMPETITIONS) + ((before,) if before else ())) * 2
    rows = conn.execute(
        f"""SELECT club, match_date, match_id, real_md FROM club_match_lineups
            WHERE season = ? AND competition IN ({_LEAGUE_IN}) AND match_date IS NOT NULL{where}
            UNION
            SELECT club, match_date, match_id, real_md FROM external_match_stats
            WHERE season = ? AND competition IN ({_LEAGUE_IN}) AND match_date IS NOT NULL
              AND club IS NOT NULL{where}""", params).fetchall()
    out: dict[str, list[tuple]] = {}
    for club, date, match_id, real_md in rows:
        key, _name = resolve(club)
        if key:
            out.setdefault(key, []).append((date, str(match_id), real_md))
    for key, fixtures in out.items():
        seen: set[str] = set()
        unique = []
        # By DATE and by match id only: a round number can be NULL on one of the two sources, and
        # sorting tuples that carry it would compare an int with a None on the first such row.
        for date, match_id, real_md in sorted(fixtures, key=lambda one: (one[0], one[1])):
            if match_id not in seen:
                seen.add(match_id)
                unique.append((date, match_id, real_md))
        out[key] = unique
    return out


def his_season(fc_id: int, season: str, fixtures: dict[str, list[tuple]],
               belongs: dict[int, dict[str, set[str]]],
               spans: dict[int, dict[str, list[str]]]) -> list[tuple]:
    """One man's championship fixtures for a season, oldest first: (date, match_id, real_md).

    A club's calendar is his only WHILE he was there. The bound is his own first and last appearance
    for it, and it is applied ONLY to a man who really played for two clubs that season (123 of 1,692
    on 2025-26): for everybody else it would cut off exactly the rounds a place is won in - the four
    Milan matches before Bartesaghi's first are the evidence, not noise.

    ONE definition, because two readings of «his season» - who lost a place, and who is being rotated -
    would eventually disagree about which matches were his, and the first place anybody would notice is
    a table.
    """
    clubs = {key for key, seasons in (belongs.get(fc_id) or {}).items() if season in seasons}
    if not clubs:
        return []
    played_at = spans.get(fc_id, {})
    bounded = len([club for club in played_at if club in clubs]) > 1
    window: list[tuple] = []
    seen: set[str] = set()
    for club in clubs:
        span = played_at.get(club) if bounded else None
        for date, match_id, real_md in fixtures.get(club, ()):
            if span and not (span[0] <= date <= span[1]):
                continue
            if match_id not in seen:
                seen.add(match_id)
                window.append((date, match_id, real_md))
    window.sort()
    return window


def _changepoint(minutes: list[float]) -> tuple[int, float, float] | None:
    """The split that best separates his season in two, or None. (index, before, after) in minutes.

    A mean either side and the biggest step wins - no fit, no parameter anybody could tune afterwards.
    What makes it honest is the FLOOR on both sides: a man who plays once in October and once in May
    has no two halves, and reading a step off two matches would manufacture a story out of rotation.
    """
    if len(minutes) < PLACE_MIN_SIDE * 2:
        return None
    best = None
    for split in range(PLACE_MIN_SIDE, len(minutes) - PLACE_MIN_SIDE + 1):
        before = sum(minutes[:split]) / split
        after = sum(minutes[split:]) / (len(minutes) - split)
        if best is None or abs(after - before) > abs(best[2] - best[1]):
            best = (split, before, after)
    if best is None or abs(best[2] - best[1]) < PLACE_MIN_JUMP:
        return None
    return best


def place_changes(conn, season: str, observations, squads: dict[int, str],
                  belongs: dict[int, dict[str, set[str]]], roles: dict[int, dict],
                  before: str | None = None) -> dict[int, dict]:
    """Who took a shirt during `season` and who lost one, with the DEPARTMENT control.

    The control is what makes the flag honest, and it is the operator's own point: **a man who plays
    because the starter in front of him is broken has not won the place**, and the difference is that he
    goes back when the other one returns. So the change is dated, and the spells of his line-mates are
    read AT THAT DATE - not over the season, which would have answered the wrong thing on a case he
    knows: Bartesaghi's first 90 minutes are the round of 3-5 October and Estupinan's ankle is of the
    12th. He took the place a week BEFORE; the injury consolidated it. Co-occurrence alone reads that
    backwards, and the order between the two days is the whole measurement.

    THE LINE IS THE GRANULAR ROLE (`player_roles`), never the macro-role: a right back does not cover a
    centre back, and `role_classic` calls both D. Its own limit travels with it - the provider serves
    only today's codes, so the line of a man measured last season is read from the roles he has NOW.

    SUSPENSIONS CANNOT BE CHECKED and the flag says so instead of implying their absence: `availability`
    is a two-week snapshot of 2026 and `reds` is 0 on the whole 2025-26 of the per-match layer, so a
    team-mate's ban is invisible. «Not checked» is the honest word, and «no suspension» would be a
    claim the data cannot make.

    REPORTING ONLY. The predictive form of this idea was measured on 14/08/2026 as «promotion in
    minutes» - minutes per match in the window against the previous season's, controlling for the price
    and the minutes already seen - and it came out at a mean of +0.049 over 8 instances, 6 of them
    positive: weak and not stable. Showing it is useful, ranking on it is not.
    """
    resolve = club_index(conn)
    fixtures = season_fixtures(conn, season, resolve, before)
    benched = bench_matches(conn, before or "9999-12-31")
    spells: dict[int, list[tuple[str, str, str]]] = {}
    for fc_id, start, end, kind in conn.execute(
            "SELECT fc_id, start_date, end_date, kind FROM injuries WHERE start_date IS NOT NULL"):
        spells.setdefault(fc_id, []).append((start, end or "9999-12-31", kind))
    minutes_of: dict[int, dict[str, int]] = {}
    # ...and WHEN he was at each club, from his own appearances. A man who moves in January belongs to
    # two clubs in one season, and the union of their calendars would give him 76 fixtures with half of
    # them played by a side he was not in - which reads as «he lost his place» on the day of the
    # transfer. 123 players of 1,692 are in that state on 2025-26 (7.3%), so it is not a corner.
    spans: dict[int, dict[str, list[str]]] = {}
    for fc_id, match_id, minutes, club, date in conn.execute(
            f"""SELECT fc_id, match_id, COALESCE(minutes, 0), club, match_date
                FROM external_match_stats
                WHERE season = ? AND source = 'sofascore' AND competition IN ({_LEAGUE_IN})""",
            (season, *LEAGUE_COMPETITIONS)):
        minutes_of.setdefault(fc_id, {})[str(match_id)] = minutes
        if minutes and club and date:
            key, _name = resolve(club)
            if key:
                span = spans.setdefault(fc_id, {}).setdefault(key, [date, date])
                span[0], span[1] = min(span[0], date), max(span[1], date)
    names = {fc_id: name for fc_id, name in conn.execute(
        "SELECT fc_id, canonical_name FROM players")}
    # Who else played that line at that club, THAT SEASON. Built from the same source as the window
    # itself (`player_clubs`), so a man's club and his line-mates can never come from two different
    # ideas of where he was.
    mates: dict[tuple[str, str], set[int]] = {}
    for fc_id, clubs in belongs.items():
        for code in _role_codes((roles.get(fc_id) or {}).get("roles")):
            for club, seasons in clubs.items():
                if season in seasons:
                    mates.setdefault((club, code), set()).add(fc_id)

    def open_spell(fc_id: int, day: str):
        return next(((start, end, kind) for start, end, kind in spells.get(fc_id, ())
                     if start <= day <= end), None)

    out: dict[int, dict] = {}
    for obs in observations:
        window = his_season(obs.fc_id, season, fixtures, belongs, spans)
        if not window:
            continue
        played = [float(minutes_of.get(obs.fc_id, {}).get(match_id, 0)) for _d, match_id, _md in window]
        change = _changepoint(played)
        if change is None:
            continue
        split, mean_before, mean_after = change
        day, _match, real_md = window[split]
        gained = mean_after > mean_before
        block = {
            "change": "gained" if gained else "lost",
            "on": day,
            "md": real_md,
            "minutes": f"{mean_before:.0f} -> {mean_after:.0f}",
            "sample": f"{split}/{len(window) - split}",
        }
        code = ((roles.get(obs.fc_id) or {}).get("primary") or "").upper() or None
        # Whether he was in the side at all BEFORE: taking a shirt off somebody and being given more
        # of the pitch are two different promotions, and the sentence has to say which one it saw.
        block["played_before"] = sum(1 for minute in played[:split] if minute)
        if gained:
            # WHO was missing in front of him, and WHEN his absence started. The order decides the
            # sentence, and the two sentences are different facts about the same man.
            rivals = [fc for club in clubs for fc in mates.get((club, code or ""), ())
                      if fc != obs.fc_id]
            out_now = [(fc, open_spell(fc, day)) for fc in rivals]
            missing = [(fc, spell) for fc, spell in out_now if spell and spell[0] <= day]
            if missing:
                fc, spell = missing[0]
                block["cause"] = "front_injured"
                block["who"] = f"{names.get(fc, fc)} ({spell[2]}, {spell[0]} -> {spell[1]})"
            else:
                later = [(fc, start, end, kind) for fc in rivals
                         for start, end, kind in spells.get(fc, ())
                         if day < start <= _days_after(day, PLACE_FOLLOWS_DAYS)]
                if later:
                    fc, start, end, kind = later[0]
                    block["cause"] = "won_then_injury"
                    block["who"] = f"{names.get(fc, fc)} ({kind}, {start} -> {end})"
                else:
                    block["cause"] = "won_it"
                    block["who"] = None
        else:
            # WHY he is not playing is a question about the whole window and not about one day, and
            # the difference is the operator's own case: Angelino's place changes hands the week of a
            # six-day flu, and what matters is that fifteen rounds later he is still not playing with
            # NO spell on record. Counting the states of every match after the split says that; reading
            # the day alone would have answered «influenza» and stopped there.
            missed = [(date, match_id) for date, match_id, _md in window[split:]
                      if not minutes_of.get(obs.fc_id, {}).get(match_id)]
            hurt = sum(1 for date, _match in missed if open_spell(obs.fc_id, date))
            on_the_bench = sum(1 for _date, match_id in missed
                               if match_id in benched.get(obs.fc_id, ()))
            free = len(missed) - hurt
            block["missed"] = f"{hurt} injured, {on_the_bench} benched, {len(missed)} in all"
            if len(missed) * 2 < len(window) - split:
                # He is STILL PLAYING and playing less, which is a different fact from losing a shirt
                # - and calling it «he was out himself» off one missed match, as the first version did
                # for a man who played five of six, is a claim the data does not make.
                block["cause"] = "fewer_minutes"
                block["who"] = f"still played {len(window) - split - len(missed)} of " \
                               f"{len(window) - split}"
            elif hurt * 2 >= len(missed):
                block["cause"] = "own_injury"
                block["who"] = f"out for {hurt} of the {len(missed)} he missed"
            elif on_the_bench >= free / 2:
                # 6.6: fit and not chosen. Fifteen rounds on the bench in good health are not a
                # convalescence, and this is the half of the question that changes a bid.
                block["cause"] = "benched"
                block["who"] = (f"on the bench for {on_the_bench} of the {len(missed)} he missed, "
                                f"and {free} of them with no spell on record at all")
            else:
                block["cause"] = "out_of_squad"
                block["who"] = f"{free} of the {len(missed)} he missed with no spell on record"
        block["note"] = _place_note(block, code)
        out[obs.fc_id] = block
    return out


def _days_after(day: str, days: int) -> str:
    return (dt.date.fromisoformat(day) + dt.timedelta(days=days)).isoformat()


# ---------- «he was sold as a starter and he is not one» (the operator's Lewandowski case) ----------
# CALIBRATED, not chosen (14/08/2026, four seasons x the five leagues): the window is the last five
# rounds OF HIS CLUB, the man is flagged when he averages under 45 minutes a match AND started at most
# one of them, and the pool is the top 15% of his role BY QUOTATION - which is what «sold as a starter»
# means, and the pool is part of the measurement.
#
# THE NUMBERS ARE THE SHIPPED FUNCTION'S OWN, and that correction is the interesting half. A first
# calibration walked each man's own ROWS and read 84.5% precision against a 34.9% base (2.42x); this
# function walks his CLUB'S FIXTURES and counts the rounds he missed as zero, which is a different
# window and a different denominator. Re-measured by calling `rotation_watch` itself at six dates of
# each season and scoring what it returned: 3,711 readings, 471 flagged (12.7%), precision 90.4%
# against a base of 59.5% - a lift of 1.52x. Per season 91.0% / 95.9% / 86.7% / 87.3%. Nine of ten
# flagged men really end the rest of the season under 60 minutes a club match; the tenth becomes a
# starter after all, which is why this is a mark and not a number.
#
# Declared rather than tuned away: the screen WEAKENS as the season closes (the last reading of 2025-26
# is 70.0% against a 72.0% base, i.e. nothing at all), because with eight rounds left almost everybody
# in the pool is under the bar. `ROTATION_LEFT` was fixed by the calibration and is not moved after
# seeing that curve - widening a grid because a case fell on it is the other way of fitting.
#
# The case it was built from: Lewandowski 2025-26 fires at round 5 (27.6 minutes and one start over
# Barcelona's last five) and again mid-season, after a 2024-25 of 32 starts in 36 and 74 minutes.
ROTATION_WINDOW = 5           # rounds of his club, the most recent ones
ROTATION_MINUTES = 45.0       # mean minutes a match under which the reading fires
ROTATION_STARTS = 1           # ...and at most this many starts inside the window
ROTATION_POOL = 85.0          # percentile of his own listone role: «sold as a starter»
# ...and the EARLY reading, on the operator's request of 14/08/2026: «anche prima della quinta giornata
# segnala i top che mostrano segnali di incertezza». Measured before it was drawn, on the season's
# opening window with the only threshold a short sample can carry - he has NEVER started - and the
# answer has a sharp edge in it:
#
#   after 1 round   130 flagged   76.9% precision   base 56.3%   1.37x   (per season 82/74/80/68%)
#   after 2 rounds   99            78.8%                 57.5%   1.37x   (74/80/90/65%)
#   after 3 rounds   70            84.3%                 57.8%   1.46x   (88/84/88/67%)
#   after 4 rounds   54            96.3%                 58.1%   1.66x   (91/93/100/100%)
#   after 5 rounds   78            94.9%                 58.6%   1.62x   (95/95/93/100%)
#
# So the FOURTH round is worth as much as the fifth and the mark fires there in full; two and three are
# worth about 81% against a 58% base (1.40x), which is a reason to look and NOT the same sentence - and
# the counter-example is the one that settles it: after two rounds of 2025-26 the reading would have
# named Donnarumma at Manchester City on 0 minutes, and he then averaged 85. Six of its seventeen names
# became starters. Hence two marks and not one drawn earlier: «he is not the starter» from the fourth
# round, «he is showing signs of uncertainty» from the second, each carrying its own number.
ROTATION_EARLY = 2            # rounds under which nothing is said at all
ROTATION_FULL = 4             # ...and from which the reading is as strong as the five-round one
# The outcome the screen was scored against - a DISPLAY definition of «not a starter», stated so nobody
# reads the mark as being about anything else.
ROTATION_OUTCOME = 60
# ...and it says nothing about a season that is nearly over: the screen was measured predicting the REST
# of a season, and the calibration required at least this many rounds still to play.
ROTATION_LEFT = 8


# ---------- ...and the MIRROR: given as a reserve, playing like a starter ----------
# The operator's own inverse question (14/08/2026), with his own three cases as the test: Ferran Torres
# and Douvikas 2025-26, Castro 2024-25. Same machinery as the rotation watch and the opposite reading.
#
# WHAT «HE BECAME A STARTER» MEANS was corrected by those cases, and the correction is declared rather
# than buried. The first scoring reused the rotation screen's bar - 60 minutes a club match over the
# rest of the season - and it called BOTH flagged cases wrong: Castro reads 58 and Ferran 49. But
# Castro started 27 of 37 matches; the bar says «he is not a starter» about a man who started three
# quarters of a season. The mirror of «he is not a starter» is not «he is one»: the word is about how
# often he STARTS, so that is what the outcome counts (half the remaining matches). Both readings are
# on the record - on the minutes bar the same screen reads 54.9% against a base of 22.2% (2.47x) - so
# nothing is hidden by the change, and the reason for it does not depend on the screen's own score.
#
#   after 3 rounds   1022 flagged   73.6% precision   base 39.4%   1.87x   (78/73/75/69%)
#   after 4           810           79.1%                  40.9%   1.94x   (81/80/80/76%)
#   after 5           973           77.3%                  39.5%   1.96x   (76/79/80/74%)
#
# THE POOL IS A BAND, and both edges do work: above the 85th percentile of his role he was sold as a
# starter (that is the other screen's population, and «he is playing» is not news), below the 30th he
# is a filler whose four good matches are a cup run. Ferran reads 64, Castro 46.
#
# The known miss, stated because a screen without its misses is a slogan: DOUVIKAS does not fire. He
# started 3 of the first 5 and averaged 49 minutes, under both thresholds, and he went on to start 67%
# of the rest. The screen is deliberately strict - four starts of five - and a slow riser is what it
# gives up in exchange for the 79%.
RISER_POOL = (30.0, 85.0)     # percentile band inside his role: «a reserve, but not a filler»
RISER_WINDOW = 5              # rounds of his club, the most recent ones
RISER_MINUTES = 65.0          # mean minutes a match from which the reading fires
RISER_START_SHARE = 0.8       # ...and this share of the window started
RISER_FROM = 4                # nothing is said before this many rounds: a rise needs to be seen
RISER_OUTCOME = 0.5           # what it claims: he starts at least half of what is left


def starter_signs(conn, season: str, observations, belongs: dict[int, dict[str, set[str]]],
                  prices: dict[int, float], before: str | None = None) -> dict[int, dict]:
    """Who was given as a reserve and is playing like a starter. The inverse of `rotation_watch`.

    Same window, same pool discipline, opposite direction - and a WEAKER claim, which the note says:
    losing a place is far more predictable than winning one (90.4% against 79.1%), because a man who
    stops playing has usually been dropped for a reason that lasts, while a man who starts five matches
    may be covering for somebody.
    """
    resolve = club_index(conn)
    fixtures = season_fixtures(conn, season, resolve, before)
    length: dict[str, int] = {}
    for club, rounds in conn.execute(
            f"""SELECT club, MAX(real_md) FROM external_match_stats
                WHERE season = ? AND source = 'sofascore' AND competition IN ({_LEAGUE_IN})
                GROUP BY club""", (season, *LEAGUE_COMPETITIONS)):
        key, _name = resolve(club)
        if key and rounds:
            length[key] = max(length.get(key, 0), int(rounds))
    minutes_of: dict[int, dict[str, int]] = {}
    spans: dict[int, dict[str, list[str]]] = {}
    for fc_id, match_id, minutes, club, date in conn.execute(
            f"""SELECT fc_id, match_id, COALESCE(minutes, 0), club, match_date
                FROM external_match_stats
                WHERE season = ? AND source = 'sofascore' AND competition IN ({_LEAGUE_IN})""",
            (season, *LEAGUE_COMPETITIONS)):
        minutes_of.setdefault(fc_id, {})[str(match_id)] = minutes
        if minutes and club and date:
            key, _name = resolve(club)
            if key:
                span = spans.setdefault(fc_id, {}).setdefault(key, [date, date])
                span[0], span[1] = min(span[0], date), max(span[1], date)
    started_in = {(fc_id, str(match_id)) for fc_id, match_id in conn.execute(
        f"""SELECT fc_id, match_id FROM external_match_stats
            WHERE season = ? AND source = 'sofascore' AND started = 1
              AND competition IN ({_LEAGUE_IN})""", (season, *LEAGUE_COMPETITIONS))}

    out: dict[int, dict] = {}
    low, high = RISER_POOL
    for obs in observations:
        pct = prices.get(obs.fc_id)
        if pct is None or not (low <= pct < high):
            continue
        window = his_season(obs.fc_id, season, fixtures, belongs, spans)
        if len(window) < RISER_FROM:
            continue
        his = {key for key, seasons in (belongs.get(obs.fc_id) or {}).items() if season in seasons}
        rounds = max((length.get(club, 0) for club in his), default=0)
        if rounds - (window[-1][2] or len(window)) < ROTATION_LEFT:
            continue
        recent = window[-RISER_WINDOW:]
        minutes = [float(minutes_of.get(obs.fc_id, {}).get(match_id, 0))
                   for _d, match_id, _md in recent]
        starts = sum(1 for _d, match_id, _md in recent if (obs.fc_id, match_id) in started_in)
        mean = sum(minutes) / len(minutes)
        if mean < RISER_MINUTES or starts < RISER_START_SHARE * len(recent):
            continue
        # A KEEPER's percentile is not the same sentence as an outfield player's, and the split was
        # measured: the reserve band of the goalkeepers is made of real reserves (base 22.3%, against
        # 42.3% outfield), so a cheap keeper who starts the first rounds is the strongest reading this
        # screen produces - 81.9% precision, 3.68x - and what it says about him is «he is the number
        # one», not «he is rising». Outfield: 76.8% and 1.82x.
        keeper = (obs.role_classic or "").upper() == "P"
        evidence = (f"MEASURED on four seasons: for a GOALKEEPER this is the strongest reading the "
                    f"screen produces - 81.9% of those who read like this started at least half of "
                    f"the rest of the season, against 22.3% of the reserve band (3.68x). For a keeper "
                    f"it means «he is the number one», not «he is rising»."
                    if keeper else
                    f"MEASURED on four seasons: 76.8% of the outfield men who read like this went on "
                    f"to START at least half of the rest of the season, against 42.3% of the band "
                    f"that did not (1.82x). It is a WEAKER claim than the rotation mark - losing a "
                    f"place is more predictable than winning one - and a slow riser is what the "
                    f"strictness gives up: Douvikas 2025-26 does not fire and started 67% of his "
                    f"rest.")
        out[obs.fc_id] = {
            "minutes": round(mean, 1),
            "starts": starts,
            "window": len(recent),
            "keeper": keeper,
            "from": recent[0][0],
            "to": recent[-1][0],
            "note": (f"He was quoted in the {pct:.0f}th percentile of his role - a reserve, not a "
                     f"filler - and over his club's last {len(recent)} rounds he has started {starts} "
                     f"of them, averaging {mean:.0f} minutes. {evidence}"),
        }
    return out


def role_percentiles(observations) -> dict[int, float]:
    """{fc_id: the percentile of his pre-auction quotation INSIDE HIS ROLE, on this sheet's listone}.

    The Qt.I and nothing else: it is the only auction-safe price (the FVM moves with the season) and it
    is the market's own reading of «he will be a starter» - which is exactly the claim the rotation
    screen tests. Ties share the average rank, and a role with fewer than twenty quoted men is not a
    distribution, so nobody in it gets a percentile at all.
    """
    pools: dict[str, list[tuple[int, float]]] = {}
    for obs in observations:
        price = getattr(obs, "price_initial", None)
        role = (getattr(obs, "role_classic", None) or "").upper()
        if price and role:
            pools.setdefault(role, []).append((obs.fc_id, float(price)))
    out: dict[int, float] = {}
    for group in pools.values():
        if len(group) < 20:
            continue
        order = sorted(range(len(group)), key=lambda at: group[at][1])
        index = 0
        while index < len(order):
            last = index
            while last + 1 < len(order) and group[order[last + 1]][1] == group[order[index]][1]:
                last += 1
            rank = (index + last) / 2 + 1
            for at in range(index, last + 1):
                out[group[order[at]][0]] = 100 * (rank - 0.5) / len(group)
            index = last + 1
    return out


def rotation_watch(conn, season: str, observations, belongs: dict[int, dict[str, set[str]]],
                   prices: dict[int, float], before: str | None = None) -> dict[int, dict]:
    """Who was bought as a starter and is being ROTATED, once the season has been played a little.

    This is the operator's own case (14/08/2026): a man «indicato all'inizio come titolare» who is not
    one in fact - and the shape is not the one item 6 looks for. Lewandowski 2025-26 has no step down to
    find: he plays every week (14, 12, 22, 90, 25, 90, 90, 16, 90...) and is simply not the starter, so
    a changepoint over a whole season reads nothing while the table loses points every Sunday.

    THE READING IS OF THE SEASON BEING PLAYED, and it is silent until there is one. Five rounds have to
    be behind it and eight still to come - the calibration measured it predicting the REST of a season,
    and a mark that fired in August, or on the last day of May, would be making a claim nobody scored.
    Consequence to state rather than treat as a gap: on a PRE-SEASON sheet this column is empty by
    construction, which is the same thing item 4.4 measured from the other side - what pays after
    kick-off is the appearances everybody can see.
    """
    resolve = club_index(conn)
    fixtures = season_fixtures(conn, season, resolve, before)
    # HOW LONG THE CHAMPIONSHIP IS, and it must not be read off the fixtures above: those are filtered
    # to the sheet's own date, so counting them says «five rounds played, five rounds long» and the
    # «enough left to play» guard rejects everybody. Found by calling the function on the case it was
    # built from and getting a uniform zero - which is far more often a wrong quantity than a real hole.
    length: dict[str, int] = {}
    for club, rounds in conn.execute(
            f"""SELECT club, MAX(real_md) FROM external_match_stats
                WHERE season = ? AND source = 'sofascore' AND competition IN ({_LEAGUE_IN})
                GROUP BY club""", (season, *LEAGUE_COMPETITIONS)):
        key, _name = resolve(club)
        if key and rounds:
            length[key] = max(length.get(key, 0), int(rounds))
    minutes_of: dict[int, dict[str, int]] = {}
    spans: dict[int, dict[str, list[str]]] = {}
    for fc_id, match_id, minutes, club, date in conn.execute(
            f"""SELECT fc_id, match_id, COALESCE(minutes, 0), club, match_date
                FROM external_match_stats
                WHERE season = ? AND source = 'sofascore' AND competition IN ({_LEAGUE_IN})""",
            (season, *LEAGUE_COMPETITIONS)):
        minutes_of.setdefault(fc_id, {})[str(match_id)] = minutes
        if minutes and club and date:
            key, _name = resolve(club)
            if key:
                span = spans.setdefault(fc_id, {}).setdefault(key, [date, date])
                span[0], span[1] = min(span[0], date), max(span[1], date)
    started_in = {(fc_id, str(match_id)) for fc_id, match_id in conn.execute(
        f"""SELECT fc_id, match_id FROM external_match_stats
            WHERE season = ? AND source = 'sofascore' AND started = 1
              AND competition IN ({_LEAGUE_IN})""", (season, *LEAGUE_COMPETITIONS))}
    spells: dict[int, list[tuple[str, str]]] = {}
    for fc_id, start, end in conn.execute(
            "SELECT fc_id, start_date, COALESCE(end_date, '9999-12-31') FROM injuries "
            "WHERE start_date IS NOT NULL"):
        spells.setdefault(fc_id, []).append((start, end))
    # The pool is part of the measurement: his quotation's percentile INSIDE HIS ROLE, on the listone
    # this sheet is built for. A man the market did not sell as a starter cannot fail to be one.
    out: dict[int, dict] = {}
    for obs in observations:
        if prices.get(obs.fc_id, 0.0) < ROTATION_POOL:
            continue
        window = his_season(obs.fc_id, season, fixtures, belongs, spans)
        if len(window) < ROTATION_EARLY:
            continue
        # ...and enough of the season still to come for the reading to be about anything: the last
        # round he has played against the length of HIS OWN championship (34 in the Bundesliga and
        # Ligue 1, 38 elsewhere - never one number for everybody).
        his = {key for key, seasons in (belongs.get(obs.fc_id) or {}).items() if season in seasons}
        rounds = max((length.get(club, 0) for club in his), default=0)
        if rounds - (window[-1][2] or len(window)) < ROTATION_LEFT:
            continue
        recent = window[-ROTATION_WINDOW:]
        minutes = [float(minutes_of.get(obs.fc_id, {}).get(match_id, 0))
                   for _d, match_id, _md in recent]
        starts = sum(1 for _d, match_id, _md in recent if (obs.fc_id, match_id) in started_in)
        mean = sum(minutes) / len(minutes)
        # A SHORT window carries one threshold and not two: under four rounds the reading is «he has
        # never started», because one start of two says nothing anybody measured.
        allowed = ROTATION_STARTS if len(recent) >= ROTATION_WINDOW else 0
        if mean >= ROTATION_MINUTES or starts > allowed:
            continue
        # A man who spent that window INJURED is not a man being rotated. The screen scores the same
        # either way (86.3% against 85.7% with the injured rounds taken out, so the outcome does not
        # depend on it), but the SENTENCE would be false and he already carries the injury mark - and
        # two marks saying two different things about the same five matches is how a table stops
        # trusting both.
        hurt = sum(1 for date, _match, _md in recent
                   if any(start <= date <= end for start, end in spells.get(obs.fc_id, ())))
        if hurt * 2 > len(recent):
            continue
        season_minutes = sum(float(minutes_of.get(obs.fc_id, {}).get(match_id, 0))
                             for _d, match_id, _md in window) / len(window)
        season_starts = sum(1 for _d, match_id, _md in window
                            if (obs.fc_id, match_id) in started_in)
        strong = len(recent) >= ROTATION_FULL
        evidence = (
            "MEASURED on four seasons by scoring this very screen: 90.4% of the men who read like this "
            f"ended the rest of the season under {ROTATION_OUTCOME} minutes a club match, against 59.5% "
            "of the pool that did not trip it (1.52x) - a reason to look, and one in ten becomes a "
            "starter after all."
            if strong else
            "MEASURED on the same four seasons, and this reading is the WEAKER one: after two or three "
            "rounds it is right about 81% of the time against a base of 58% (1.40x), where the "
            "four-round reading is right 96%. It says «look at him», not «he is not the starter» - "
            "after two rounds of 2025-26 it would have named Donnarumma at Manchester City on 0 "
            "minutes, and he went on to average 85.")
        out[obs.fc_id] = {
            "minutes": round(mean, 1),
            "starts": starts,
            "window": len(recent),
            "strength": "watch" if strong else "early",
            "from": recent[0][0],
            "to": recent[-1][0],
            "season_minutes": round(season_minutes, 1),
            "season_starts": f"{season_starts}/{len(window)}",
            "note": (f"He was quoted in the top {100 - ROTATION_POOL:.0f}% of his role and over his "
                     f"club's last {len(recent)} round{'s' if len(recent) != 1 else ''} he averaged "
                     f"{mean:.0f} minutes with {starts} start{'s' if starts != 1 else ''} - "
                     f"{season_starts} of {len(window)} and {season_minutes:.0f} minutes a match on "
                     f"the season so far. {evidence}"),
        }
    return out


_PLACE_SENTENCE: dict[str, str] = {
    "front_injured": "he came in while {who} was already out - the place may go back when he returns",
    "won_then_injury": "he took the place first and {who} broke down afterwards: the injury "
                       "consolidated it, it did not cause it",
    "won_it": "nobody of his line was out on that day",
    "own_injury": "he was out himself ({who})",
    "benched": "he was AVAILABLE and not fielded ({who})",
    "out_of_squad": "he was not in the squad ({who})",
    "fewer_minutes": "he is still in the side and playing less ({who})",
}


def _place_note(block: dict, code: str | None) -> str:
    """The sentence, with what could NOT be checked stated rather than implied."""
    if block["change"] == "gained":
        # He was already in the side more often than not: what he gained is PITCH, not a shirt.
        before = int(block["sample"].split("/")[0])
        what = "gained minutes" if block["played_before"] * 2 > before else "took a place"
    else:
        what = "lost minutes" if block["cause"] == "fewer_minutes" else "lost his place"
    where = f" of the {code} line" if code else ""
    sentence = _PLACE_SENTENCE[block["cause"]].format(who=block.get("who") or "")
    unchecked = (" Suspensions are NOT checked - no dated source covers them for a past season, so "
                 "this is «not looked at» and never «he was not banned»."
                 if block["cause"] in ("won_it", "out_of_squad", "benched", "fewer_minutes") else "")
    return (f"He {what}{where} around {block['on']} (round {block['md']}), "
            f"{block['minutes']} minutes a match over {block['sample']} of them: {sentence}.{unchecked}")


def _merged_spells(dates: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """The UNION of a player's absence intervals, so an overlap is one absence and not two.

    This is also the answer to "does Transfermarkt count a relapse twice": counting the ROUNDS inside the
    union cannot, whatever the source lists, because a round is counted once or not at all.
    """
    out: list[tuple[str, str]] = []
    for start, end in sorted(dates):
        if out and start <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], end))
        else:
            out.append((start, end))
    return out


def rounds_missed(conn, auction_date: str, seasons: list[str]) -> dict[int, dict[str, int]]:
    """Absences counted in the LEAGUE ROUNDS of his own club: {fc_id: {season: rounds}}.

    The unit is what makes it usable. Transfermarkt says how many of the club's GAMES a spell cost him,
    over every competition it played, and that number cannot be taken off a championship calendar or
    divided by one: Bayern play 50 fixtures and 34 of them are Bundesliga rounds, and for the Italian
    clubs our own parsed fixture list is the championship alone (38), so scaling by what we parsed
    corrects the German and leaves the Italian untouched - 8 players of the euro sheet ended up with more
    absences than their season had rounds. Here the rounds are COUNTED: his club's league fixtures, by
    date, inside the union of his spells. No scaling, no ratio, and comparable between two clubs by
    construction.

    Which club's calendar: the one he appeared for that season where the per-match layer knows (the modal
    club by appearances), the listone's otherwise - which is the case that matters, because a man injured
    from August to May has no appearances at all. A season whose calendar we do not have (a club outside
    the five leagues) is left out rather than counted as zero, and `seasons` in the result says how many
    were really measured.
    """
    resolve = club_index(conn)
    wanted = set(seasons)
    fixtures: dict[tuple[str, str], list[str]] = {}
    for club, season, date in conn.execute(
            f"""SELECT club, season, match_date FROM club_match_lineups
                WHERE competition IN ({_LEAGUE_IN}) AND match_date IS NOT NULL""",
            LEAGUE_COMPETITIONS):
        if season not in wanted:
            continue
        key, _name = resolve(club)
        if key:
            fixtures.setdefault((key, season), []).append(date)
    # Where he was, season by season: appearances first (they are the fact), the listone as the fallback.
    where: dict[tuple[int, str], str] = {}
    for fc_id, season, club in conn.execute(
            """SELECT r.fc_id, r.season, c.canonical_name FROM rosters r
               JOIN clubs c ON c.fc_club_id = r.fc_club_id
               WHERE c.canonical_name IS NOT NULL"""):
        if season in wanted:
            key, _name = resolve(club)
            if key:
                where[(fc_id, season)] = key
    counts: dict[tuple[int, str], dict[str, int]] = {}
    for fc_id, season, club, appearances in conn.execute(
            """SELECT fc_id, season, club, COUNT(*) FROM external_match_stats
               WHERE source = 'sofascore' AND COALESCE(minutes, 0) > 0 AND club IS NOT NULL
               GROUP BY fc_id, season, club""", ()):
        if season not in wanted:
            continue
        key, _name = resolve(club)
        if key:
            counts.setdefault((fc_id, season), {})[key] = appearances
    for (fc_id, season), by_club in counts.items():
        where[(fc_id, season)] = max(by_club, key=lambda club: by_club[club])

    spells: dict[int, list[tuple[str, str]]] = {}
    for fc_id, start, end in conn.execute(
            "SELECT fc_id, start_date, COALESCE(end_date, ?) FROM injuries WHERE start_date <= ?",
            (auction_date, auction_date)):
        spells.setdefault(fc_id, []).append((start, min(end, auction_date)))
    out: dict[int, dict[str, int]] = {}
    for fc_id, mine in spells.items():
        merged = _merged_spells(mine)
        for season in seasons:
            dates = fixtures.get((where.get((fc_id, season)) or "", season))
            if not dates:
                continue
            out.setdefault(fc_id, {})[season] = sum(
                1 for date in dates if any(start <= date <= end for start, end in merged))
    return out


def investment(conn, window, observations, squads: dict[int, str],
               platform: str = "default") -> dict[int, dict]:
    """How much this club has PUT INTO him, in two channels that must not be merged.

    The hypothesis (the user's, 29/07/2026): a club that has spent on a player wants to see him play, and
    the coach is more forgiving with him than with a youth-team man - so investment should weigh on who is
    selected, beyond what last season's minutes already say.

    Two channels, because they catch different players, and MEASURED rather than assumed:

    * `fee_share` - what he cost, as a share of everything this club spent in that window. Isak 145 M of
      Liverpool's 336 M is 0.43; a man already at the club has no new spending and reads 0. A SHARE, so it
      is the argument "relative to the club's cash" as far as our data can carry it: we have what the club
      spent, never what it earns or pays in wages.
    * `stature` - his Qt.I percentile WITHIN his role: the market's own statement about how important he is.
      This is the channel that catches the celebrity, and the measurement is why both exist - **Modric and
      De Bruyne arrived on FREE transfers**, so the fee says "no investment" for exactly the two names the
      hypothesis was built on, while their Qt.I sits at the 77th and 94th percentile of the midfielders.
      Centred and doubled to [-1, +1], because the claim has two sides: the expensive man is forgiven a bad
      game AND the cheap youngster pays for it.

    WAGES ARE NOT AVAILABLE and no whitelisted source carries them. They are the best single measure of a
    club's standing commitment, and their absence is a limit of this layer, not a detail.

    Legality: the fee is dated and read only before the auction date; Qt.I is the PRE-auction quotation (the
    only price a rule may read), taken from the season being auctioned where the listone exists and from the
    previous one where it does not yet - which is the case in July, when this sheet is built; and the market
    value is the last point of his CURVE on or before the auction day, which is the strictest of the three
    (a dated observation filtered on the date) and falls back to the input season's snapshot where the curve
    does not reach him.
    """
    resolve = club_index(conn)
    now: dict[int, str] = {}
    for obs in observations:
        key, _name = resolve(obs.club_target or squads.get(obs.fc_id))
        if key:
            now[obs.fc_id] = key
    # The transfer window being priced: from the June before the target season to the auction day.
    since = f"{int(window.target_season.split('-')[0]) - 1}-06-01" \
        if window.auction_date[5:7] < "06" else f"{window.target_season.split('-')[0]}-06-01"
    fees: dict[int, float] = {}
    spent: dict[str, float] = {}
    for fc_id, to_club, fee in conn.execute(
            """SELECT fc_id, to_club, fee FROM transfers_history
               WHERE fee IS NOT NULL AND date >= ? AND date <= ?""", (since, window.auction_date)):
        key, _name = resolve(to_club)
        if key is None:
            continue
        fees[fc_id] = max(fees.get(fc_id, 0.0), float(fee))
        spent[key] = spent.get(key, 0.0) + float(fee)
    # Qt.I percentile within the role, on the listone being auctioned - or the previous one while it does
    # not exist. A percentile and not the price: a 20 is elite for a defender and mid-table for a striker.
    prices: dict[int, tuple[float, str]] = {}
    for season in (window.target_season, window.input_season):
        for fc_id, price, role in conn.execute(
                # THIS platform's listone: a percentile is a comparison, and the two lists are two
                # currencies (schema.sql, `listone_quotes`).
                "SELECT q.fc_id, q.price_initial, r.role_classic FROM listone_quotes q "
                "JOIN rosters r ON r.fc_id = q.fc_id AND r.season = q.season "
                "WHERE q.season = ? AND q.platform = ? AND q.price_initial IS NOT NULL",
                (season, platform)):
            prices.setdefault(fc_id, (float(price), role or "?"))
        if prices:
            break
    by_role: dict[str, list[float]] = {}
    for price, role in prices.values():
        by_role.setdefault(role, []).append(price)
    # THE THIRD CHANNEL, and the one the other two were missing: his MARKET VALUE as a share of the value
    # of the squad he is in, both read on the INPUT season (`market_values`, from the source's own squad
    # page of that season - a season fact, never today's). It is the same argument as `fee_share` - how big
    # a part of this club's commitment is he - and unlike the fee it exists for a man who arrived FREE,
    # which is exactly where the fee proxy failed: Modric and De Bruyne read "no investment" (gate
    # 7-quater). Read on the input season and never on the target one: the target season's value would
    # know the outcome.
    #
    # ...AND SINCE 16/08/2026 IL VALORE SI LEGGE AL GIORNO DELL'ASTA, non sulla stagione di input.
    # `market_value_history` porta la CURVA (ogni variazione con la sua data), quindi la domanda «quanto
    # valeva il giorno in cui lo compravi» ha una risposta esatta invece di una approssimata da una
    # fotografia vecchia fino a un anno - ed e' anche la legalita' piu' stretta delle due: un punto della
    # curva e' datato e si filtra sulla data d'asta, mentre lo scatto di una stagione e' un numero che
    # nessuno sa quando e' stato preso. Sul foglio di oggi la copertura sale dal 76% al 96% su Serie A e
    # dall'82% all'89% su euro.
    # LE DUE BASI CONVIVONO E OGNI RIGA DICE LA SUA (`value_basis`), che e' la stessa disciplina della
    # cascata di `estimate.py`: la curva dove c'e', lo scatto di stagione dove la curva non arriva, e il
    # denominatore somma per ogni uomo la lettura che quell'uomo ha. Sono la stessa grandezza nella stessa
    # unita' (valore di mercato in euro) lette in due momenti, e una quota di squadra normalizza il
    # livello; quello che non si puo' fare e' tacere quale delle due e' stata usata.
    curve = {int(fc_id): float(value) for fc_id, value, _when in conn.execute(
        """SELECT fc_id, value, MAX(observed_on) FROM market_value_history
           WHERE observed_on <= ? AND value IS NOT NULL GROUP BY fc_id""", (window.auction_date,))}
    snapshots = {int(fc_id): float(value) for fc_id, value in conn.execute(
        "SELECT fc_id, value FROM market_values WHERE season = ? AND value IS NOT NULL",
        (window.input_season,))}
    values = {**snapshots, **curve}
    squad_value: dict[str, float] = {}
    for fc_id, value in values.items():
        club = now.get(fc_id)
        if club:
            squad_value[club] = squad_value.get(club, 0.0) + value
    out: dict[int, dict] = {}
    for obs in observations:
        club = now.get(obs.fc_id)
        fee = fees.get(obs.fc_id)
        total = spent.get(club or "", 0.0)
        entry: dict = {
            "fee": fee,
            # None, not 0, when the club spent nothing we know of: a share of an unknown total is unknown,
            # and reporting it as 0 would say "he was free" about a club whose fees we simply do not have.
            "fee_share": round(fee / total, 3) if fee and total else (0.0 if total else None),
            "value": values.get(obs.fc_id),
            # Quale delle due letture e' finita nella riga: «curve» = il punto al giorno dell'asta,
            # «season» = la fotografia della stagione di input. None quando non c'e' ne' l'una ne' l'altra.
            "value_basis": ("curve" if obs.fc_id in curve
                            else "season" if obs.fc_id in snapshots else None),
            # ...and the same rule for the share: unknown squad total, unknown share.
            "value_share": (round(values[obs.fc_id] / squad_value[club], 4)
                            if obs.fc_id in values and squad_value.get(club) else None),
        }
        if obs.fc_id in prices:
            price, role = prices[obs.fc_id]
            peers = by_role.get(role) or [price]
            entry["stature"] = round(sum(1 for other in peers if other <= price) / len(peers), 3)
        out[obs.fc_id] = entry
    return out


def fielded_next(conn, auction_date: str, observations, squads: dict[int, str]
                 ) -> tuple[dict[int, dict], dict[str, dict]]:
    """Who ACTUALLY started the club's first match AFTER the auction date. A fact, not a forecast.

    Why it exists, and it is a decision worth reading before the code: a sheet standing on TODAY refreshes
    the probabili, because the editors' list is the most recent thing there is and the coach's words are
    already in it. A sheet standing on a PAST date cannot use them - and does not need to, because for that
    date the eleven that was actually fielded EXISTS. A forecast is only interesting while the outcome is
    unknown.

    So these columns are neither `engine_*` nor `desc_*`: they are `actual_*`, measured strictly AFTER the
    auction date, reporting only, and no rule and no prediction may read them. The prefix is the guard - the
    board draws them, says out loud that they are the fielded eleven, and never pours them into
    `desc_starter_prob`, because then nobody could tell a guess from an outcome.

    Empty by construction for a sheet built today: the next match has not been played.
    """
    resolve = club_index(conn)
    # The first fixture after the date, per club, with the line-up it fielded. `club_match_lineups` is the
    # right source: one row per club-match, so it exists even for a club whose players we cannot all resolve.
    # By DATE, and that is the only unit that survives a postponement: a match can be played weeks after
    # the round it belongs to, so "the next match" is a date and never a matchday number. The round is
    # carried along so a catch-up is visible in the label instead of reading as the following round.
    first: dict[str, tuple] = {}
    for club, match_id, date, competition, real_md, defenders, midfielders, forwards, starters in \
            conn.execute(
                """SELECT club, match_id, match_date, competition, real_md,
                          defenders, midfielders, forwards, starters
                   FROM club_match_lineups
                   WHERE match_date IS NOT NULL AND match_date > ? ORDER BY match_date""",
                (auction_date,)):
        key, _name = resolve(club)
        if key and key not in first:
            first[key] = (str(match_id), date, competition, real_md,
                          defenders, midfielders, forwards, starters)
    clubs: dict[str, dict] = {}
    for obs in observations:
        key, name = resolve(obs.club_target or squads.get(obs.fc_id))
        if key in first and name not in clubs:
            match_id, date, competition, real_md, defenders, midfielders, forwards, starters = first[key]
            clubs[name] = {
                "match_id": match_id, "date": date, "competition": competition, "round": real_md,
                # the shape as FIELDED, in the provider's vocabulary (a winger is a midfielder)
                "shape": (f"{defenders}-{midfielders}-{forwards}"
                          if starters == 11 and None not in (defenders, midfielders, forwards)
                          and defenders + midfielders + forwards == 10 else None),
            }
    wanted = {entry["match_id"] for entry in clubs.values()}
    # Keyed by the player AND by his club in that match, because a match_id carries BOTH teams: read
    # without the club, a man the listone puts at Milan who actually played that day for the opponent was
    # counted among Milan's starters (twelve of them), and the opponent field came out as the club itself.
    played: dict[tuple[str, int], tuple] = {}
    fixture: dict[tuple[str, str], tuple] = {}
    if wanted:
        placeholders = ",".join("?" * len(wanted))
        for match_id, fc_id, club, started, minutes, opponent, home in conn.execute(
                f"""SELECT match_id, fc_id, club, COALESCE(started, 0), COALESCE(minutes, 0),
                           opponent, home
                    FROM external_match_stats WHERE match_id IN ({placeholders})""", (*wanted,)):
            key, _name = resolve(club)
            if not key:
                continue
            played[(str(match_id), fc_id)] = (started, minutes, key)
            if opponent:
                fixture[(str(match_id), key)] = (opponent, home)
    out: dict[int, dict] = {}
    for obs in observations:
        key, name = resolve(obs.club_target or squads.get(obs.fc_id))
        entry = clubs.get(name or "")
        if not entry:
            continue
        row = played.get((entry["match_id"], obs.fc_id))
        if row and row[2] != key:
            row = None          # he played that match for the other side: not this club's eleven
        opponent, home = fixture.get((entry["match_id"], key or ""), (None, None))
        out[obs.fc_id] = {
            "match": " ".join(part for part in (
                entry["date"], entry["competition"] or "",
                f"md{entry['round']}" if entry.get("round") else "",
                f"vs {opponent}" if opponent else "",
                "(H)" if home else "(A)" if home == 0 else "") if part),
            # 1 he started · 0 he came on or was not used · empty only when the layer has no rows at all
            "started": (1 if row and row[0] else 0) if played else None,
            "minutes": row[1] if row else 0 if played else None,
        }
    return out, clubs


def injury_history(conn, auction_date: str, seasons: list[str],
                   measured: str | None = None) -> dict[int, dict]:
    """Absences per player: matches missed, weighted by recency, plus whatever is open right now.

    `matches_missed` and not days: days become matches only through the calendar, and the source
    already did that translation. A player with no rows is NOT a player with zero absences - he may
    simply have no Transfermarkt id, which is why `desc_injury_source` says which of the two it is.

    Two numbers, and they answer different questions - which is why the sheet now carries both:

    * `weighted` over three seasons = how much a man LIKE THIS misses in a season. A FORECAST, and the
      only one of the two that belongs in an availability discount.
    * `missed_measured` = what he actually missed inside the season the other layers measure. That is a
      fact about a sample, and it is what the denominator of a start RATE needs: a man injured for two
      months started fewer matches, and dividing by the whole calendar reads his absence as the coach
      preferring someone else. Putting the three-season forecast there instead - which is what this sheet
      did until the units were checked - makes the discount cancel almost exactly out of `presence`,
      because the same estimate is subtracted and then multiplied back in.

    Both of them come in two units, and the sheet carries both because they are not equally good. The
    source's own count is over every competition the club played (`matches_missed`, `weighted`); the
    ROUNDS versions (`rounds_measured`, `rounds_weighted`) are counted on his club's league fixtures by
    date (`rounds_missed`), which is the unit every share in this sheet is expressed in - and the only one
    that can be compared between two clubs. `rounds_seasons` says how many of the three seasons had a
    calendar to count on: zero means the rounds are unknown, not zero, and the view falls back to scaling
    the source's number.
    """
    known = {fc_id for (fc_id,) in conn.execute(
        "SELECT DISTINCT fc_id FROM player_xref WHERE source = 'transfermarkt'")}
    weights = {season: INJURY_WEIGHTS[index] for index, season in
               enumerate(reversed(seasons[-len(INJURY_WEIGHTS):]))}
    rounds = rounds_missed(conn, auction_date,
                           sorted({*weights, *([measured] if measured else [])}))
    out: dict[int, dict] = {}
    for fc_id, start, end, kind, days, missed in conn.execute(
            """SELECT fc_id, start_date, end_date, kind, days_out, matches_missed FROM injuries
               WHERE start_date <= ? ORDER BY start_date DESC""", (auction_date,)):
        season = f"{int(start[:4]) - (0 if start[5:7] >= '07' else 1)}-" \
                 f"{(int(start[:4]) + (1 if start[5:7] >= '07' else 0)) % 100:02d}"
        entry = out.setdefault(fc_id, {"spells": 0, "matches_missed": 0, "days_out": 0,
                                       "weighted": 0.0, "missed_measured": 0, "worst_kind": None,
                                       "open": None, "last_start": start})
        entry["spells"] += 1
        entry["matches_missed"] += missed or 0
        entry["days_out"] += days or 0
        entry["weighted"] += (missed or 0) * weights.get(season, 0.0)
        if measured and season == measured:
            entry["missed_measured"] += missed or 0
        if (end is None or end >= auction_date) and entry["open"] is None:
            entry["open"] = f"{kind} since {start}"
        # DA QUANTI GIORNI E' RIENTRATO: la fine dello stop CHIUSO piu' recente che gli sia costato
        # almeno una giornata. La condizione sulle giornate serve a non chiamare «rientro» un'influenza
        # di tre giorni fra due soste - e le righe arrivano gia' dalla piu' recente, quindi la prima che
        # passa e' quella. Uno stop ancora aperto non e' un rientro: quello lo dicono le assenze.
        if (entry.get("days_since_return") is None and end is not None and end < auction_date
                and (missed or 0) >= 1):
            entry["days_since_return"] = (
                dt.date.fromisoformat(auction_date) - dt.date.fromisoformat(end)).days
        if entry["worst_kind"] is None or (days or 0) >= (entry.get("worst_days") or 0):
            entry["worst_kind"], entry["worst_days"] = kind, days or 0
    for fc_id, entry in out.items():
        entry["weighted"] = round(entry["weighted"], 2)
        entry["source"] = "transfermarkt"
        del entry["worst_days"]
        mine = rounds.get(fc_id, {})
        # The same numbers in ROUNDS of his own championship. Per season and MOST RECENT FIRST, aligned
        # with INJURY_WEIGHTS, because that is what keeps the weights sweepable: a pre-weighted total
        # freezes them at the values it was written with, and they are provisional (gate 7-bis). A season
        # with no calendar to count on is an empty entry - unknown, never a zero.
        by_season = [mine.get(season) for season in sorted(weights, reverse=True)]
        counted = {season: weight for season, weight in weights.items() if season in mine}
        entry["rounds_by_season"] = ";".join("" if value is None else str(value)
                                            for value in by_season)
        entry["rounds_weighted"] = (
            round(sum(mine[season] * weight for season, weight in counted.items())
                  / sum(counted.values()) * sum(INJURY_WEIGHTS), 2) if counted else None)
        entry["rounds_measured"] = mine.get(measured) if measured in mine else None
        entry["rounds_seasons"] = len(counted)
    for fc_id in known - set(out):
        out[fc_id] = {"spells": 0, "matches_missed": 0, "days_out": 0, "weighted": 0.0,
                      "missed_measured": 0, "rounds_weighted": 0.0, "rounds_measured": 0,
                      "rounds_by_season": ";".join(["0"] * len(weights)),
                      "rounds_seasons": len(weights),
                      "worst_kind": None, "open": None, "last_start": None,
                      "source": "transfermarkt (no absence recorded)"}
    return out


def evidence_age(conn, window: features.Window, platform: str | None = None) -> tuple[dict, list[str]]:
    """How old the SQUAD and TRANSFER evidence behind this sheet is. Returns (facts, notes).

    Asked for by the operator, on a case: «Gutierrez non è più nel Napoli». The sheet was right about what
    it had - both squad sources said Napoli - and what it had was days old, while `transfers_history` did
    not carry a single move dated 2026: the whole summer market was missing and nothing said so. A squad is
    a VOLATILE state, so its age is part of the answer, and an auction sheet that cannot say how old its
    rosters are is inviting the operator to trust a fact nobody has re-checked.

    Two things are reported and neither is inferred from the other: the newest observation PER SOURCE
    (`squad_snapshot` is written by `fc_site`, `transfers`/Transfermarkt and the appearances backstop, and
    one being fresh says nothing about the others), and whether the transfer layer has any move at all in
    the window that feeds this sheet - the summer before the target season, which is exactly the market an
    August auction is about.
    """
    facts: dict = {"squad_sources": {}, "transfers_latest": None, "transfers_in_window": 0,
                   "listone_read_on": None}
    notes: list[str] = []
    today = window.auction_date
    for source, latest in conn.execute(
            "SELECT source, MAX(valid_from) FROM squad_snapshot GROUP BY source"):
        facts["squad_sources"][source] = latest
    facts["transfers_latest"] = conn.execute(
        "SELECT MAX(date) FROM transfers_history").fetchone()[0]
    # The window: moves from the January of the target season's own year onwards, i.e. the market that
    # built the squads this sheet prices.
    since = f"{window.target_season.split('-')[0]}-01-01"
    facts["transfers_in_window"] = conn.execute(
        "SELECT COUNT(*) FROM transfers_history WHERE date >= ?", (since,)).fetchone()[0]
    stale = {source: latest for source, latest in facts["squad_sources"].items()
             if not latest or latest < today}
    # ...and WHICH command moves each date. A note that names the wrong module is worse than one that names
    # none: two of these four are refreshed by the snapshot itself, so seeing them stale means the refresh
    # was off or failed - a different diagnosis from "nobody has run `injuries` in three weeks".
    fills = {"fc_site": "`snapshot` refreshes it; `fc_site` on its own",
             "sofascore": "`snapshot` refreshes it; `positions --layer roles` on its own",
             "transfermarkt": "`injuries` caches the squad pages",
             "appearances": "`positions --layer matches`"}
    if stale:
        notes.append("SQUAD EVIDENCE is older than the sheet's own date (" + today + "): "
                     + " · ".join(f"{source} last observed {latest or 'never'}"
                                  f" ({fills.get(source, 'no command declared')})"
                                  for source, latest in sorted(stale.items()))
                     + ". A squad is a volatile state: a man transferred since then is still drawn where "
                       "he was.")
    # ...and the LISTONE, which is a volatile state too and was the one nobody dated. Its reading day is
    # `fvm_history.observed_on`: the fantavalore moves weekly and on events, so every re-read leaves a
    # dated row, which makes it the honest answer to «when did we last ask the game who is where». Only
    # reported when the list EXISTS for this platform and season - a season with no listone yet is a
    # different statement, and it already has its own note.
    quoted = conn.execute(
        "SELECT COUNT(*) FROM listone_quotes WHERE season = ? AND platform = ?",
        (window.target_season, platform)).fetchone()[0] if platform else 0
    if quoted:
        facts["listone_read_on"] = conn.execute(
            "SELECT MAX(observed_on) FROM fvm_history WHERE season = ? AND platform = ?",
            (window.target_season, platform)).fetchone()[0]
        if not facts["listone_read_on"] or facts["listone_read_on"] < today:
            notes.append(
                f"THE LISTONE behind this sheet was last read "
                f"{facts['listone_read_on'] or 'on a day nothing recorded'}, before the sheet's own date "
                f"({today}): the club the GAME says a player is at, and his ask price, are that old. An "
                f"official transfer announced since then is not here at all - not at his new club and "
                f"not with a quotation. `snapshot` re-reads it; `ratings --platform {platform} --season "
                f"{window.target_season}` does it on its own.")
    if facts["transfers_in_window"]:
        pass                                   # counted per row instead; the note is written with the rows
    if not facts["transfers_in_window"]:
        notes.append(f"TRANSFER LAYER has no move dated {since} or later (newest: "
                     f"{facts['transfers_latest'] or 'none'}), so the market that built these squads is "
                     f"not in the DB at all: an arrival's origin club and fee are blind, and any check of "
                     f"a roster against the transfers cannot fire. `transfers` fills it.")
    return facts, notes


def latest_starters(conn, auction_date: str, season: str | None = None
                    ) -> tuple[dict[int, dict], str | None]:
    """The most recent probabili snapshot at or before the auction date, per player.

    Of the season being AUCTIONED, which is not the same question as "the freshest reading". The page
    keeps serving the last round of the season that ended until the new one starts, so in August the
    newest snapshot describes 2025-26 with probabilities of 1.0 - line-ups that were FIELDED, not
    forecast. Those are a fact about a season nobody is buying any more, and the sheet says «no probabili
    snapshot» instead, which is what it is (`probable_starter.season`).
    """
    date = conn.execute(
        "SELECT MAX(valid_from) FROM probable_starter WHERE valid_from <= ?"
        + (" AND season = ?" if season else ""),
        (auction_date, season) if season else (auction_date,)).fetchone()[0]
    if not date:
        return {}, None
    out = {fc_id: {"probability": probability, "starter": bool(starter), "status": status,
                   "team": team, "formation": formation, "role": role}
           for fc_id, probability, starter, status, team, formation, role in conn.execute(
               "SELECT fc_id, probability, starter, status, team, formation, role "
               "FROM probable_starter WHERE valid_from = ?"
               + (" AND season = ?" if season else ""),
               (date, season) if season else (date,))}
    return out, date


def availability_now(conn, auction_date: str) -> dict[int, str]:
    """Latest injured/suspended state per player at the auction date (dated series, newest wins)."""
    out: dict[int, str] = {}
    for fc_id, status in conn.execute(
            "SELECT fc_id, status FROM availability WHERE valid_from <= ? ORDER BY valid_from",
            (auction_date,)):
        out[fc_id] = status
    return out


# A co-start share is only worth storing where it is LOW: a rule can refuse to draw two men who never
# coexist, and nothing reads "these two always play together". Kept generously above any threshold a
# sweep might pick, so the grid can move without rebuilding the sheet.
COSTART_LOW = 0.50
# ...and how much shared football is enough to say anything at all. Below these the pair is UNKNOWN and
# gets no entry, which is not the same as a low share: two men who were never in a squad together have
# co-started nothing by construction - the trap this measurement walked into first, where every summer
# signing read 0.00 against every team-mate.
COSTART_MIN_SHARED = 8
COSTART_MIN_STARTS = 5


def costarts(conn, season: str, fc_ids: set[int], clubs: dict[int, str],
             before: str | None = None) -> dict[int, str]:
    """fc_id -> "name:share;..." for the team-mates he rarely STARTS beside.

    «Scamacca e Krstovic giocheranno entrambi ma non contemporaneamente» (operator, 08/08/2026), and
    the measurement agrees where it can see: 2 co-starts of 15/18 over the 35 matches both were
    available for, 0.13 - against Lautaro Martinez and Thuram at 0.58, the pair that really does
    coexist. So «never two centre-forwards» is false and «two who do not coexist are not drawn
    together» is measurable, with both anchors on the same scale.

    The denominator is over the matches BOTH had a row in - i.e. both were in the squad - because the
    question is whether a coach who COULD field them together does. Over all matches instead, every
    pair split by a transfer reads 0.00: measured on the boards, 35 pairs looked like "they never
    coexist" and 32 of them had simply never shared a squad (Doekhi and Romagnoli, Kolo Muani and
    Conceição). Same rule as the duel columns: absence of evidence is not evidence.
    """
    if not fc_ids:
        return {}
    holes = ",".join("?" * len(fc_ids))
    present: dict[int, set] = {}
    started: dict[int, set] = {}
    query = (f"""SELECT fc_id, match_id, started FROM external_match_stats
                 WHERE season = ? AND fc_id IN ({holes})"""
             + (" AND match_date IS NOT NULL AND match_date < ?" if before else ""))
    params = [season, *fc_ids] + ([before] if before else [])
    for fc_id, match_id, was_start in conn.execute(query, params):
        present.setdefault(fc_id, set()).add(match_id)
        if was_start:
            started.setdefault(fc_id, set()).add(match_id)

    by_club: dict[str, list[int]] = {}
    for fc_id in fc_ids:
        club = clubs.get(fc_id)
        if club:
            by_club.setdefault(club, []).append(fc_id)
    out: dict[int, list[tuple[float, int]]] = {}
    for mates in by_club.values():
        for index, one in enumerate(mates):
            for other in mates[index + 1:]:
                shared = present.get(one, set()) & present.get(other, set())
                if len(shared) < COSTART_MIN_SHARED:
                    continue                      # unknown, and not a low share
                starts_one = started.get(one, set()) & shared
                starts_other = started.get(other, set()) & shared
                floor = min(len(starts_one), len(starts_other))
                if floor < COSTART_MIN_STARTS:
                    continue                      # one of them barely started: nothing to conclude
                share = len(starts_one & starts_other) / floor
                if share <= COSTART_LOW:
                    out.setdefault(one, []).append((share, other))
                    out.setdefault(other, []).append((share, one))
    names = dict(conn.execute("SELECT fc_id, canonical_name FROM players"))
    return {fc_id: ";".join(f"{names.get(mate, mate)}:{share:.2f}"
                            for share, mate in sorted(pairs))
            for fc_id, pairs in out.items()}


def duels(observations, starters: dict[int, dict],
          roles: dict[int, dict] | None = None) -> dict[int, dict]:
    """Starting duels: same club, same POSITION, comparable starting probability.

    Read off the probabili snapshot, which is the only source that says who the editors expect to
    start. Without a snapshot the column is empty rather than guessed from minutes - "who plays" and
    "who played" are different questions, and the second one already has its own column.

    The position is the GRANULAR REAL ROLE, and one shared code is enough ('RW;AM' and 'AM' do compete
    for a shirt). The Classic role is not a fallback and not a first pass: it says what you buy a man as,
    not where a coach puts him, and at Napoli it calls Politano, Lobotka, Elmas, McTominay, Anguissa, De
    Bruyne, Vergara and Neres all 'C' - so it declared a right winger in a duel with a regista thirty
    metres away, and the sheet then handed his shirt's alternatives to men who cannot take it while the
    real challenger went unnamed.

    A player with no code is therefore left OUT of the result entirely - unknown, not "no rival":
    reporting it as a zero would be the usual absence of evidence dressed as evidence. It is a gap in the
    OBSERVED roles, and for most of them the missing piece is the provider identity rather than a run:
    `positions --layer roles` can only observe a man it can identify. Same rule, same vocabulary, as
    `SnapshotView.can_replace`, which is where a duel becomes a shirt.
    """
    roles = roles or {}

    def codes(fc_id: int) -> set[str]:
        return {code.strip().upper()
                for code in ((roles.get(fc_id) or {}).get("roles") or "").split(";") if code.strip()}

    by_club: dict[str, list] = {}
    for obs in observations:
        entry = starters.get(obs.fc_id)
        if not obs.club_target or not entry or entry.get("probability") is None:
            continue
        if not codes(obs.fc_id):
            continue
        by_club.setdefault(obs.club_target, []).append(
            (obs.fc_id, obs.name, float(entry["probability"])))
    out: dict[int, dict] = {}
    for group in by_club.values():
        group.sort(key=lambda item: -item[2])
        for fc_id, _name, probability in group:
            mine = codes(fc_id)
            rivals = [name for other, name, other_probability in group
                      if other != fc_id
                      and abs(other_probability - probability) <= BALLOTTAGGIO_MARGIN
                      and mine & codes(other)]
            # ALL of them, not the first three: `rivals` is an exact count, so a truncated name list
            # made the two columns of the same fact disagree - 6 men of the 2026-27 euro sheet read
            # "4 rivals" next to three names, with nothing saying which one was missing. Capping how
            # many can be DRAWN is the pitch's business (`SnapshotView.rival_text`), not the data's.
            out[fc_id] = {"rivals": len(rivals), "names": "; ".join(rivals)}
    return out


def penalty_duty(conn, auction_date: str) -> dict[int, tuple[int, float]]:
    """Revealed penalty hierarchy at the auction date: (rank, confidence) per player."""
    out: dict[int, tuple[int, float]] = {}
    for fc_id, rank, confidence in conn.execute(
            "SELECT fc_id, rank, confidence FROM penalty_hierarchy WHERE valid_from <= ? "
            "ORDER BY valid_from", (auction_date,)):
        out[fc_id] = (rank, confidence)
    return out


def cup_rounds_by_league(conn, season: str, cup, after: str | None = None) -> dict[str, tuple[int, int]]:
    """Per championship: (rounds inside the cup's window, rounds in the whole season), from `fixtures`.

    COUNTED and not assumed, because the same tournament costs a different number of rounds in each
    league - the Asian Cup of January 2027 covers 4 Serie A rounds, 5 Bundesliga ones and 3 Premier
    ones - and because the calendar is the one thing about next January that is already published.

    `after` drops what has already been played: a round before the auction date is not a round at risk,
    and an auction held in February looks at a tournament that is over. A league whose calendar we do
    not have yields nothing at all rather than a zero, which is the difference between «no rounds fall
    in the window» and «we cannot say» - and the sheet's column has to mean the first one only.
    """
    start = max(cup.start, after) if after else cup.start
    out: dict[str, tuple[int, int]] = {}
    total = {league: rounds for league, rounds in conn.execute(
        "SELECT league, COUNT(DISTINCT round) FROM fixtures WHERE season = ? GROUP BY league", (season,))}
    inside = {league: rounds for league, rounds in conn.execute(
        "SELECT league, COUNT(DISTINCT round) FROM fixtures WHERE season = ? AND date BETWEEN ? AND ? "
        "GROUP BY league", (season, start, cup.end))}
    for league, rounds in total.items():
        if rounds:
            out[league] = (inside.get(league, 0), rounds)
    return out


def cup_exposure(ctx: Context, conn, window, observations, platform_rounds: int | None,
                 pv_by_id: Mapping[int, float] | None = None) -> dict[int, dict]:
    """Who a mid-season continental cup takes away, and what it is expected to cost him.

    Three facts meet here and none of them is guessed. WHEN the tournament is played and WHO is in it
    are declared (`config/international_cups.json`, read from the public record). WHICH country a man
    belongs to is his identity, from the provider payloads (`players.nationality`, validated against
    the 2026 World Cup at 299/300). HOW MUCH a player of that profile loses is MEASURED - the
    difference-in-differences of `engine/cups.py`, which already contains the probability of being
    called up at all, so nothing here needs a call-up list that does not exist in August.

    The rounds are converted to the PLATFORM's calendar before they are subtracted, because that is the
    unit `engine_pv_pred` lives on: 4 Serie A rounds of 38 are 3.3 rounds of a 31-round euro season.
    Without that conversion the sheet would take championship rounds off a platform number.

    REPORTING. The adjusted appearances are a column of their own beside the gated one - the same
    treatment «Margine» gets beside «Surplus» - and `engine_pv_pred` is not touched by a decimal.
    """
    declared = ctx.config.load_international_cups()
    cups, membership = engine_cups.parse(declared)
    if not cups:
        return {}
    # ...and whoever the operator has declared out of his passport's national team. It only removes.
    excused = engine_cups.excused(declared)
    season = window.target_season
    # Everything this season can still be hit by: a cup whose window ended before the auction date is
    # over and costs nothing, while one that has not started yet is exactly what an August sheet exists
    # to warn about. The season filter is the file's own declaration, so a back-dated sheet cannot pick
    # up a tournament from a different year.
    live = [cup for cup in cups.values() if cup.end >= window.auction_date
            and (not cup.seasons or season in cup.seasons)]
    if not live:
        return {}
    rounds_by_cup = {cup.key: cup_rounds_by_league(conn, season, cup, after=window.auction_date)
                     for cup in live}
    pv_by_id = pv_by_id or {}
    # ...e CHI È DAVVERO CONVOCATO, quando la lista esiste: `tournaments_squads` porta chi ha giocato un
    # torneo, quindi per una coppa GIÀ GIOCATA (un foglio retrodatato) è un fatto, e per quella che
    # verrà lo diventa quando le rose vengono pubblicate. Una convocazione nota cancella la probabilità:
    # la penalità diventa il COSTO di andarci (0,53 di finestra) invece di quel costo per la probabilità.
    confirmed: dict[int, set[str]] = {}
    for fc_id, tournament in conn.execute(
            "SELECT fc_id, tournament FROM tournaments_squads WHERE tournament IN "
            f"({','.join('?' * len(live))})", [cup.key for cup in live]) if live else ():
        confirmed.setdefault(fc_id, set()).add(tournament)
    nationality = {fc_id: (country, capped) for fc_id, country, capped in conn.execute(
        "SELECT fc_id, nationality, capped_on FROM players WHERE nationality IS NOT NULL")}
    out: dict[int, dict] = {}
    for obs in observations:
        country, capped_on = nationality.get(obs.fc_id, (None, None))
        went = confirmed.get(obs.fc_id, set())
        # Senza nazionalità e senza convocazione non c'è niente da dire; con la convocazione la
        # nazionalità non serve più. L'eccezione dichiarata toglie in entrambi i casi: è l'operatore che
        # dice «questo non ci va», e nessun dato di qui può contraddirlo.
        if (not country and not went) or obs.fc_id in excused:
            continue
        # QUALE POPOLAZIONE, che è quella che scegli il coefficiente: la quota di calendario che gli è
        # prevista. Un titolare giapponese perde lo 0,59 della finestra, un suo riservista lo 0,05, e
        # sono due numeri MISURATI su due popolazioni invece di uno tagliato a occhio.
        pv_for_band = pv_by_id.get(obs.fc_id)
        played_share = (pv_for_band / platform_rounds
                        if pv_for_band is not None and platform_rounds else None)
        def rounds_in_window(cup, league=obs.league):
            inside, total = rounds_by_cup[cup.key].get(league or "", (0, 0))
            if not inside or not total:
                return 0.0
            # championship rounds -> the platform's own calendar, which is what pv_pred counts on
            return inside * (platform_rounds / total) if platform_rounds else inside
        exposures = engine_cups.exposure_of(country, capped_on is not None, live, membership,
                                            rounds_in_window, played_share=played_share,
                                            confirmed_in=went)
        if not exposures:
            continue
        first = exposures[0]
        out[obs.fc_id] = {
            "band": first.band,
            "confirmed": first.confirmed,
            "cup": first.cup.key,
            "name": first.cup.name,
            "country": country,
            "capped": capped_on is not None,
            "rounds": round(sum(e.rounds_at_risk for e in exposures), 1),
            "share": first.share_lost,
            "note": " · ".join(e.note() for e in exposures),
            "exposures": exposures,
        }
    return out


def contract_state(conn, season: str, platform: str = "default") -> dict[int, dict]:
    """The club-relationship PROXIES: contract expiry, exit risk, arrival, seasons at the club.

    `platform` reaches the ARRIVAL TIER only, which is a percentile inside a listone and therefore has one
    (schema.sql, `arrivals`): the arrival itself, the contract and the seasons at the club do not.
    """
    out: dict[int, dict] = {}
    for fc_id, flag, value in conn.execute(
            "SELECT fc_id, flag, value FROM flags WHERE flag IN "
            "('contract_until', 'exit_risk', 'new_coach', 'u22_trigger') AND season = ?", (season,)):
        out.setdefault(fc_id, {})[flag] = value
    for fc_id, kind, tier, origin, equivalent in conn.execute(
            "SELECT fc_id, type, tier, origin_league, foreign_fm_equiv FROM arrivals "
            "WHERE season = ? AND platform = ?", (season, platform)):
        out.setdefault(fc_id, {}).update(
            {"arrival": kind, "tier": tier, "origin": origin, "equiv": equivalent})
    for fc_id, seasons in conn.execute(
            """SELECT r.fc_id, COUNT(*) FROM rosters r
               JOIN rosters t ON t.fc_id = r.fc_id AND t.season = ? AND t.fc_club_id = r.fc_club_id
               WHERE r.season <= ? GROUP BY r.fc_id""", (season, season)):
        out.setdefault(fc_id, {})["seasons_at_club"] = seasons
    for fc_id, fee, to_club in conn.execute(
            "SELECT fc_id, fee, to_club FROM transfers_history WHERE date >= ? ORDER BY date",
            (f"{season.split('-')[0]}-01-01",)):
        if fee:
            out.setdefault(fc_id, {}).update({"fee": fee, "fee_to": to_club})
    return out


def discipline(conn, season: str, platform: str) -> dict[int, dict]:
    """Cards per appearance (correttezza), from the platform's own season aggregate."""
    return {fc_id: {"yellows": yellows or 0, "reds": reds or 0,
                    "per_match": round(((yellows or 0) + 3 * (reds or 0)) / pv, 3) if pv else None}
            for fc_id, yellows, reds, pv in conn.execute(
                "SELECT fc_id, yellows, reds, pv FROM season_stats WHERE season = ? AND platform = ?",
                (season, platform))}


def _unpriced_reason(prediction, obs) -> str | None:
    """Why a row has no predicted fantamedia - `''` when it has one.

    The core refuses to predict outside the domain its coefficients were fitted on (`MIN_PV_PREV` votes in
    the input season), and where that leaves the cell empty depends on the platform: euro has R0c adopted
    and prices him at the role anchor, default does not. Both cases read the same in the cell and are not
    the same fact, so the row carries which one it is - with the number, because "13 of 15" and "1 of 15"
    are different distances from a prediction.
    """
    if prediction is not None and prediction.fm_pred is not None:
        return None
    if obs.pv_prev is None:
        return "no season on this platform"
    if obs.pv_prev < evaluate.model.MIN_PV_PREV:
        vote = "vote" if obs.pv_prev == 1 else "votes"
        return f"only {obs.pv_prev} {vote} of {evaluate.model.MIN_PV_PREV}"
    return "no prediction"


def departures(conn, window: features.Window, date: str) -> dict[int, dict]:
    """{fc_id: {"at": {club keys he ARRIVED at}, "out": [(from key, destination, date)]}} in this window.

    The operator's case: «Gutierrez ad esempio non è più nel Napoli» - and every source the sheet had said
    Napoli, because the 26/27 listone lists him there and the squad pages had not caught up (fc_site 04/08,
    transfermarkt 29/07). What DID know is the transfer: Napoli -> Bayer 04 Leverkusen, 01/07/2026, 26M.

    ⚠️ AN OUT IS NOT A DEPARTURE ON ITS OWN, and finding that out is why this reads both directions. A club's
    page carries the same man twice on the same 1 July when a loan RETURNS him and the club then signs him
    permanently: Hojlund is in Napoli's OUT (to Manchester United, no fee) and in its IN (from Manchester
    United, 44M). Reading the OUT alone reported him as leaving the club that had just bought him - and 82
    rows of the first version were exactly that. So a man counts as gone only when the window holds an OUT
    from his club and NO arrival back at it.

    Only transfers dated at or before the sheet's own date: a back-dated sheet must not read a move that had
    not happened yet. `transfers_history` had to be re-keyed for this to be possible at all - see
    `db.database.widen_transfers_pk`.
    """
    floor = f"{int(window.target_season.split('-')[0])}-01-01"
    out: dict[int, dict] = {}
    for fc_id, moved_on, from_club, to_club, fee in conn.execute(
            """
            SELECT fc_id, date, from_club, to_club, fee FROM transfers_history
            WHERE date >= ? AND date <= ? ORDER BY date
            """,
            (floor, date)):
        mine = out.setdefault(fc_id, {"at": set(), "out": []})
        if to_club:
            mine["at"].add(_club_key(to_club))
        if from_club:
            mine["out"].append((_club_key(from_club), to_club, moved_on, fee))
    return out


def live_squads(conn, date: str) -> dict[str, dict]:
    """{club key: {"on": date, "club": name, "ids": {fc_id, ...}}} - each club's LIVE squad at or before `date`.

    The reliable, near-real-time source the operator asked for, and it was already in the cache: the provider's
    `/team/{id}/players` is one request per club, downloaded every day for the granular roles, and it had
    Gutierrez out of Napoli on 28/07 while the listone and both squad pages still had him days later.

    Its power is ABSENCE, which no other source of ours can express: a squad page lists who is in, a transfer
    lists an event, and only a full squad read can say "he is not in it". Hence the second half of this layer -
    and hence the two guards, because absence has two twins that mean the opposite: a man the provider cannot
    identify (`observed_players`), and a payload too thin to be a squad at all (`complete_squads`).

    Keyed on `_club_key` and NOT on the spelling: the sheet says `Newcastle` where the provider says
    `Newcastle United`, and a raw-string lookup silently answers "no payload" - which reads as "no evidence"
    and switches the whole signal off for that club without saying so.
    """
    out: dict[str, dict] = {}
    for club, observed in conn.execute(
            "SELECT club, MAX(valid_from) FROM squad_snapshot WHERE source = 'sofascore' "
            "AND valid_from <= ? GROUP BY club", (date,)):
        key = _club_key(club)
        if key not in out or observed > out[key]["on"]:
            out[key] = {"on": observed, "club": club, "ids": set()}
    for entry in out.values():
        entry["ids"] = {fc_id for (fc_id,) in conn.execute(
            "SELECT fc_id FROM squad_snapshot WHERE source = 'sofascore' AND club = ? AND valid_from = ?",
            (entry["club"], entry["on"]))}
    return out


def live_club_of(conn, date: str) -> dict[int, tuple[str, str]]:
    """{fc_id: (club, giorno)} - IL CLUB IN CUI LA FONTE LO VEDE, la lettura piu' recente al `date`.

    Serve perche' «l'autorita' di chi e' in rosa e' sofascore» (operatore, 17/08/2026) e la fonte non dice
    soltanto «non e' piu' qui»: dice DOVE E'. La prima versione di quella regola leggeva l'assenza come
    «non comprabile» e toglieva la riga; misurato sui fogli del giorno, di 20 tolti su euro **6 erano falsi**
    (la fonte lo da' ancora al suo club: il payload di un giorno dopo non lo elencava) e **8 erano
    SPOSTATI** in un club che la piattaforma gioca - Molina alla Roma, Bruno Guimaraes all'Arsenal, Araujo al
    Liverpool. Toglierli era sbagliato due volte: uno c'e', l'altro si compra ancora.

    Un uomo che compare in due payload - il vecchio club e il nuovo - vale per il piu' RECENTE, e chi la
    fonte non ha mai visto non ha club qui: ignoto, e allora l'autorita' non ha parlato.
    """
    out: dict[int, tuple[str, str]] = {}
    for fc_id, club, observed in conn.execute(
            "SELECT fc_id, club, MAX(valid_from) FROM squad_snapshot WHERE source = 'sofascore' "
            "AND valid_from <= ? GROUP BY fc_id", (date,)):
        out[int(fc_id)] = (club, observed)
    return out


def complete_squads(live: dict[str, dict], observations, known: set[int],
                    completeness: float = SQUAD_COMPLETENESS) -> dict[str, dict]:
    """The payloads whose SILENCE is evidence: those covering `completeness` of the squad the sheet shows.

    A payload is the club's FIRST TEAM as the provider publishes it, and how much of it arrives varies by
    club - so "he is not in it" means one thing at Bologna (24 men against 28 identified, 6 departures and
    6 of them corroborated by a transfer) and another at West Ham (18 against 29, fourteen "departures" and
    NOT ONE corroborated). The denominator is the identified squad on this very sheet, because that is the
    population the absence is being read against; see `SQUAD_COMPLETENESS` for the measured curve.

    Dropped payloads keep their entry with an empty `ids` - `left_his_club` already reads that as "this
    source has nothing to say", which is exactly true, rather than as "the squad is empty".
    """
    rostered: dict[str, int] = {}
    for obs in observations:
        if obs.fc_id in known:
            key = _club_key(obs.club_target)
            if key:
                rostered[key] = rostered.get(key, 0) + 1
    out: dict[str, dict] = {}
    for key, entry in live.items():
        size = len(entry["ids"])
        enough = size >= completeness * rostered.get(key, 0) if rostered.get(key) else False
        out[key] = dict(entry, ids=entry["ids"] if enough else set(),
                        thin=None if enough else (size, rostered.get(key, 0)))
    return out


def observed_players(conn) -> set[int]:
    """Whoever the provider can be asked about at all: an fc_id with a sofascore identity.

    ⚠️ THE GUARD, and without it the live squad reads backwards. A man missing from a squad payload is either
    gone or never identified - 1352 provider ids have no resolved identity, and the same is true the other way
    round - and «vuoto = ignoto, mai zero rivali» is the rule this project already paid for twice. So absence
    is only evidence about a man the provider KNOWS.
    """
    return {fc_id for (fc_id,) in conn.execute(
        "SELECT fc_id FROM player_xref WHERE source = 'sofascore'")}


def left_his_club(obs, moves: dict | None, live: dict | None = None,
                  known: set[int] | None = None) -> tuple[str | None, str | None]:
    """(where he is now / how we know, date) if he is no longer in the squad this row shows him at.

    Two independent signals, strongest first: a TRANSFER that names the destination, and the LIVE SQUAD that
    simply does not contain him. The second exists because a listone is a weekly publication and a squad is a
    daily fact - it caught Gutierrez a week before anything else - and it is read only where absence can mean
    absence: for a man the provider can identify (`observed_players`), out of a payload complete enough to be
    a squad (`complete_squads`). Otherwise "not in the payload" means "we never matched him", or "the provider
    published eighteen of them".
    """
    here = _club_key(obs.club_target)
    if not here:
        return None, None
    if moves and here not in moves["at"]:
        for from_key, to_club, moved_on, _fee in reversed(moves["out"]):
            if from_key == here and _club_key(to_club) != here:
                return to_club, moved_on
    if live and known is not None and obs.fc_id in known:
        squad = live.get(here)
        if squad and squad["ids"] and obs.fc_id not in squad["ids"]:
            return "not in the club's live squad", squad["on"]
    return None, None


# Quante partite servono perche' un profilo di posizioni sia un profilo e non un aneddoto. Cinque: sotto,
# si ripiega sul codice mantra del listone e la riga lo dichiara.
PEER_MIN_GAMES = 5
# Su quante stagioni si conta la quota di posizione. DUE, ed e' una scelta DICHIARATA dell'operatore
# (19/08/2026, «la quota si conta sulle ultime 2 stagioni»), non una misura: un ruolo cambia, e due
# stagioni sono abbastanza recenti da dire quello di adesso e abbastanza lunghe da avere un campione.
PEER_SEASONS = 2


def _peer_groups(conn, window: features.Window, data_ids, marks: str) -> dict[int, dict]:
    """{fc_id: {top, value_percentile, source, rivals}} - chi gli contende la maglia, e quanto.

    IL REPARTO SI PESA INVECE DI CONTARLO, e la ragione e' una domanda dell'operatore (19/08/2026): «se
    Leao e Pulisic sono giudicati ST per la fonte devi vedere se ci sono percentuali in merito, perche' e'
    vero che hanno giocato in quel ruolo ma in pochissime situazioni». Aveva ragione, e la fonte lo dice:
    Leao ha giocato da centravanti nel 27% delle sue partite di club e da esterno sinistro nel 60%.

    TUTTO E' DATATO PRIMA DELL'ASTA: il profilo sulle due stagioni CHIUSE (mai la bersaglio - quella e' il
    futuro, ed e' l'errore che la prima versione della misura conteneva), il valore all'ultimo punto della
    curva a quella data, la rosa dal listone bersaglio, che ad agosto e' gia' pubblicato.

    `source` dice quale reparto ha risposto - `positions` o `mantra` - perche' una colonna con due basi
    deve dire quale delle due sta parlando.
    """
    seasons = tuple(f"{int(window.input_season.split('-')[0]) - back}-"
                    f"{str(int(window.input_season.split('-')[0]) - back + 1)[-2:]}"
                    for back in range(PEER_SEASONS))
    season_marks = ",".join("?" * len(seasons))
    counts: dict[int, dict[int, float]] = {}
    try:
        for fc_id, position, played in conn.execute(
                f"SELECT fc_id, position_id, COUNT(*) FROM tm_appearances "
                f"WHERE season IN ({season_marks}) AND state = 'played' AND is_national = 0 "
                # `position_id` 0 e' il bucket «non pervenuta» della fonte (11% delle righe): contarlo
                # come una posizione inventerebbe un ruolo che nessuno ha giocato.
                f"AND position_id IS NOT NULL AND position_id != 0 GROUP BY fc_id, position_id", seasons):
            counts.setdefault(fc_id, {})[position] = float(played)
    except sqlite3.OperationalError:
        # Un DB che quel layer non ce l'ha (una base vecchia, una fixture): il reparto torna a essere il
        # codice del listone per tutti e la riga lo dichiara, che e' il ripiego gia' previsto. Uno strato
        # opzionale che manca non fa cadere un foglio.
        counts = {}
    profile: dict[int, dict[int, float]] = {}
    for fc_id, spread in counts.items():
        total = sum(spread.values())
        if total >= PEER_MIN_GAMES:
            profile[fc_id] = {position: n / total for position, n in spread.items()}

    value: dict[int, float] = {}
    try:
        for fc_id, worth in conn.execute(
                "SELECT fc_id, value FROM market_value_history m WHERE observed_on <= ? "
                "AND value IS NOT NULL AND observed_on = (SELECT MAX(observed_on) "
                "FROM market_value_history x WHERE x.fc_id = m.fc_id AND x.observed_on <= ?)",
                (window.auction_date, window.auction_date)):
            value[fc_id] = float(worth)
    except sqlite3.OperationalError:
        return {}                    # senza la curva dei valori non c'e' confronto: il canale tace
    if not value:
        return {}
    ladder = sorted(value.values())

    squad: dict[str, list[tuple[int, frozenset, float]]] = {}
    for fc_id, club, roles in conn.execute(
            "SELECT r.fc_id, c.canonical_name, r.roles FROM rosters r "
            "JOIN clubs c ON c.fc_club_id = r.fc_club_id "
            "WHERE r.season = ? AND r.role_classic IS NOT NULL", (window.target_season,)):
        if fc_id in value:
            squad.setdefault(club, []).append(
                (fc_id, frozenset(model.split_roles(roles)), value[fc_id]))
    club_of = {fc_id: club for club, men in squad.items() for fc_id, _codes, _worth in men}

    # ...E QUANTO IL CLUB HA PAGATO PER AVERLO sul totale che ha speso (`est.presences_from_fee`, e la
    # misura del 20/08/2026 con i quattro bracci respinti sta la'). La FINESTRA DELLE FEE e' la stessa
    # della misura - da gennaio della stagione di input alla data d'asta, due mercati estivi e due di
    # gennaio - perche' una rosa si costruisce in piu' di una sessione, e perche' guardare il solo anno
    # d'asta faceva leggere quote di 1,00 ai club di cui la fonte ha pubblicato una fee sola.
    since = f"{int(window.input_season[:4])}-01-01"
    spent: dict[str, float] = {}
    paid: dict[int, float] = {}
    for fc_id, to_club, amount in conn.execute(
            "SELECT fc_id, to_club, fee FROM transfers_history WHERE date <= ? AND date >= ? "
            "AND fee IS NOT NULL AND fee > 0 ORDER BY date", (window.auction_date, since)):
        key = matching.club_key(to_club or "")
        if not key:
            continue
        spent[key] = spent.get(key, 0.0) + float(amount)
        # la fee che conta e' quella del trasferimento verso il club del listone BERSAGLIO, non l'ultima
        # che la fonte abbia scritto su di lui: un ritorno da prestito porta la stessa data e nessuna cifra.
        if key == matching.club_key(club_of.get(fc_id) or ""):
            paid[fc_id] = float(amount)

    out: dict[int, dict] = {}
    for fc_id in data_ids:
        mine = value.get(fc_id)
        club = club_of.get(fc_id)
        if mine is None or club is None:
            continue
        mates = [(other, codes, worth) for other, codes, worth in squad.get(club, []) if other != fc_id]
        if not mates:
            continue
        my_profile = profile.get(fc_id)
        weighted = [(est.rivalry(my_profile, profile[other]), worth)
                    for other, _codes, worth in mates if other in profile] if my_profile else []
        if weighted:
            top, source = est.weighted_top(mine, weighted), "positions"
        else:
            # Chi la fonte non ha mai visto: il reparto torna a essere il codice del listone, e la riga
            # lo dichiara. Un uomo senza reparto non avrebbe denominatore e il canale gli diventerebbe
            # muto, cioe' uno zero travestito da misura.
            my_codes = frozenset(model.split_roles(
                (conn.execute("SELECT roles FROM rosters WHERE fc_id = ? AND season = ?",
                              (fc_id, window.target_season)).fetchone() or [None])[0]))
            same = [worth for _other, codes, worth in mates if my_codes & codes]
            top = (min(est.INVESTMENT_TOP_CAP, mine / max(same)) if same
                   else est.INVESTMENT_TOP_CAP)
            source = "mantra"
        club_spend = spent.get(matching.club_key(club)) or 0.0
        out[fc_id] = {
            "top": top,
            "value_percentile": sum(1 for worth in ladder if worth < mine) / len(ladder),
            "source": source,
            "rivals": len(weighted) if weighted else len(mates),
            # None e non zero per chi una fee non l'ha: la fonte non distingue prestito, parametro zero e
            # cifra non dichiarata, quindi «senza fee» e' IGNOTO e il gradino non deve muoverlo.
            "fee": paid.get(fc_id),
            "fee_share": (min(1.0, paid[fc_id] / club_spend)
                          if fc_id in paid and club_spend else None),
            "club_spend": club_spend or None,
        }
    return out


def estimation_layer(conn, window: features.Window, platform: str,
                     observations) -> dict[int, dict]:
    """Everything the fallback valuation needs, gathered once: {fc_id: {...}} - see `engine.estimate`.

    Three reads, and each one is a rung of the ladder that module declares:
      * the same input season on the OTHER platform (its fantamedia stands in with mean +0.001 and 92%
        inside 0.3 - measured on 870 player-seasons, and its presences scale by the calendar, median 1.269
        against the 38/31 = 1.226 the two calendars imply);
      * the most recent season FURTHER BACK, any platform, with a full set of votes;
      * each CLUB's own mean fantamedia per role on the input season, which is what moves the anchor for a
        man nobody has measured («un attaccante della Juve ... è sempre meglio di un attaccante del Verona»).
    Read-only, one query each, no per-player round trips.
    """
    ids = tuple({obs.fc_id for obs in observations})
    if not ids:
        return {}
    marks = ",".join("?" * len(ids))
    other = "euro" if platform == "default" else "default"
    layer: dict[int, dict] = {fc_id: {} for fc_id in ids}
    # ⚠️ ONLY WHERE IT IS THE SAME FOOTBALL. The +0.001 was measured on players with a full season on BOTH
    # platforms - Serie A men, whose euro and default rows are one season seen from two calendars. For a
    # `default` sheet, a euro row belonging to another league is not that at all: it is a FOREIGN
    # fantamedia, which is R1, refused by the gate on five windows of six. Found by the operator on Kolo
    # Muani, whose euro 2025-26 is TOTTENHAM: it priced him at 5.74 and −9.9 of surplus while his own
    # Serie A season (Juventus 2024-25, 16 votes, 7.62) sat one rung below, unread. Seven of the nine
    # `other_platform` estimates on that sheet were foreign, and they erred BOTH ways - Gonzalez N. was
    # lifted to +17.8 off a Liga season against his measured 6.41 here. `default` covers Serie A alone, so
    # the test is the roster's own league; on a euro sheet the other platform IS Serie A and always
    # qualifies. Same rule as `synth.calibrated_competitions`: a fitted transform belongs to the
    # population it was fitted on, and eligibility is read from the data, never from a tag.
    eligible_other = {fc_id for (fc_id,) in conn.execute(
        f"SELECT fc_id FROM rosters WHERE season = ? AND league = 'serie_a' AND fc_id IN ({marks})",
        (window.input_season, *ids))} if platform == "default" else set(ids)
    for fc_id, pv, mv, fm in conn.execute(
            f"SELECT fc_id, pv, mv, fm FROM season_stats WHERE season = ? AND platform = ? "
            f"AND fm IS NOT NULL AND fc_id IN ({marks})",
            (window.input_season, other, *ids)):
        if fc_id in eligible_other:
            layer[fc_id]["other"] = {"pv": pv, "mv": mv, "fm": fm, "platform": other}
    # The newest season BEFORE the input one, whichever platform measured it best (most votes wins, then
    # the newest): an older season is a weaker rung, and `engine.estimate` prices that by how far back it is.
    # ...and it is bound by the SAME competition test as the rung above, which the first version of this
    # filter forgot - caught by the operator with one question, «dove gioca Ramos?». Gonçalo Ramos has never
    # played in Serie A (PSG 2023→2026), so `other_platform` was correctly refused and then `older` handed
    # over his LIGUE 1 2024-25 (19 votes, 7.50) as «his last measured season», priced him 7.50 and gave him
    # +22.5 of surplus on a Serie A sheet. Same foreign fantamedia, same R1, one rung lower. A man with no
    # season in this competition at all belongs at the ANCHOR, which is exactly what the gate measured R1
    # against and what it preferred on five windows of six.
    older_join = (" JOIN rosters r ON r.fc_id = s.fc_id AND r.season = s.season "
                  "AND r.league = 'serie_a' ") if platform == "default" else ""
    # ...and the CALENDAR that season was played on travels with it, because the pv is a count and the sheet
    # needs a share: 32 votes are 84% of a Serie A season and 100% of a euro one, and the first version of
    # this rung handed the number across untouched (`est.presences_from_older`).
    calendars = {(plat, season): rounds for plat, season, rounds in conn.execute(
        "SELECT platform, season, COUNT(DISTINCT matchday) FROM match_ratings GROUP BY platform, season")}
    for fc_id, season, plat, pv, mv, fm in conn.execute(
            f"SELECT s.fc_id, s.season, s.platform, s.pv, s.mv, s.fm FROM season_stats s{older_join} "
            f"WHERE s.season < ? AND s.fm IS NOT NULL AND s.pv >= ? AND s.fc_id IN ({marks}) "
            f"ORDER BY s.season ASC, s.pv ASC",
            (window.input_season, est.FULL_SEASON_VOTES, *ids)):
        layer[fc_id]["older"] = {"season": season, "platform": plat, "pv": pv, "mv": mv, "fm": fm,
                                 "calendar": calendars.get((plat, season))}
    # ...and the FOOTBALL HE PLAYED ELSEWHERE, which is what a new signing has instead of a season here.
    # One row per (player, competition) in `external_stats`: the league he played MOST in is his origin,
    # and its own rounds are the denominator (`features.league_rounds`, the same one `desc_arrival_origin_
    # rounds` uses - a share of a season is a share of the CHAMPIONSHIP). Cups are not in it, by the same
    # rule: they are not matchdays of the league whose calendar we are scaling.
    rounds = features.league_rounds(conn, window.input_season)
    for fc_id, competition, minutes in conn.execute(
            f"SELECT fc_id, competition, SUM(COALESCE(minutes, 0)) FROM external_stats "
            f"WHERE season = ? AND source = 'sofascore' AND COALESCE(minutes, 0) > 0 "
            f"AND fc_id IN ({marks}) GROUP BY fc_id, competition",
            (window.input_season, *ids)):
        seen = layer[fc_id].get("abroad")
        if competition in rounds and (seen is None or minutes > seen["minutes"]):
            layer[fc_id]["abroad"] = {"minutes": minutes, "rounds": rounds[competition],
                                      "league": competition}
    # ...E CHI GLI CONTENDE LA MAGLIA, pesato: il reparto per POSIZIONE VERA e non per etichetta.
    # La misura e le tre alternative respinte stanno in `est.INVESTMENT_SHARE`; qui c'e' solo la raccolta
    # dei tre ingredienti, che sono tutti datati PRIMA dell'asta - il profilo sulle due stagioni chiuse,
    # il valore all'ultimo punto della curva a quella data, la rosa del listone bersaglio, che ad agosto
    # e' pubblicata.
    for fc_id, peers in _peer_groups(conn, window, data_ids=ids, marks=marks).items():
        layer[fc_id]["peers"] = peers
    # THE ROLE'S BONUS PER APPEARANCE, which is what separates a fantamedia from a base vote and therefore
    # the only thing needed to turn one anchor into the other (`est.mv_anchor`). His OWN rate is no longer
    # collected: since 19/08/2026 the estimated MV is PREDICTED from his own measured MV and the rate is
    # what falls out of the pair, so a per-player rate would be an input to nothing - and taking it whole,
    # which is what this query fed, is the worst point of its own grid (`est.MV_BETA` carries the numbers).
    role_bonus: dict[str, float] = {}
    for role, rate in conn.execute(
            """
            SELECT r.role_classic, SUM((s.fm - s.mv) * s.pv) / SUM(s.pv)
            FROM season_stats s
            JOIN rosters r ON r.fc_id = s.fc_id AND r.season = s.season
            WHERE s.season = ? AND s.platform = ? AND s.pv >= ? AND s.fm IS NOT NULL AND s.mv IS NOT NULL
            GROUP BY 1
            """,
            (window.input_season, platform, est.FULL_SEASON_VOTES)):
        if role:
            role_bonus[role] = rate
    club_level: dict[tuple[str, str], tuple[float, int]] = {}
    for club, role, mean_fm, count in conn.execute(
            """
            SELECT cl.canonical_name, r.role_classic, AVG(s.fm), COUNT(*)
            FROM season_stats s
            JOIN rosters r ON r.fc_id = s.fc_id AND r.season = s.season
            JOIN clubs cl ON cl.fc_club_id = r.fc_club_id
            WHERE s.season = ? AND s.platform = ? AND s.pv >= ? AND s.fm IS NOT NULL
            GROUP BY 1, 2
            """,
            (window.input_season, platform, est.FULL_SEASON_VOTES)):
        if club and role:
            club_level[(club, role)] = (mean_fm, count)
    return {"players": layer, "club_level": club_level, "role_bonus": role_bonus}


def estimate_for(obs, prediction, layer: dict, anchors: dict, data,
                 window: features.Window, platform: str = "euro") -> est.Estimate:
    """The rung, and then the BASE VOTE that goes with whatever fantamedia it produced.

    The MV is PREDICTED and the bonus rate is what falls out (`est.mv_predict`): still one number and one
    derivation, so `fm - mv` stays the bonus per appearance the row expects of him instead of being the
    difference between two independent guesses - but the regression toward the anchor now lands on the
    rate, which can carry it, and not on the base vote, which cannot. It is filled for EVERY row, `core`
    included - the operator's rule is that every player always has a realistic FM and MV.
    """
    guess = _rung_for(obs, prediction, layer, anchors, data, window, platform)
    if guess.mv is None:
        # A rung whose source carried no base vote at all - 166 `core` rows of 998 on the euro sheet, 11
        # of 295 on Serie A. Then the only thing left to read it off is the FANTAMEDIA the row already
        # carries, which is the operator's «chi segna ha sempre o quasi un voto buono» as arithmetic:
        # `est.MV_FROM_FM`, an interior optimum that beats both taking the anchor alone and taking
        # `FM - the role's rate`, which is what this branch used to do for EVERYBODY.
        role = obs.role_classic or ""
        guess = replace(guess, mv=est.mv_predict(
            None, None,
            est.mv_anchor(anchors.get(role), layer.get("role_bonus", {}).get(role), None, role),
            guess.fm, layer.get("role_bonus", {}).get(role), platform))
    if guess.mv is None or guess.fm is None:
        return guess
    said = f"MV attesa {guess.mv:.2f}, cioè {guess.fm - guess.mv:+.2f} di bonus a presenza"
    return replace(guess, note=f"{guess.note} · {said}" if guess.note else said)


def _rung_for(obs, prediction, layer: dict, anchors: dict, data,
              window: features.Window, platform: str = "euro") -> est.Estimate:
    """One player's fallback valuation, down the ladder `engine.estimate` declares. Never returns None.

    The order is the measured one and NOT "his own football first": R1 put a foreign FM-equivalent against
    the role anchor on six windows and lost on five, so an equivalent is not a rung at all - what a man did
    in a league the calendar does not cover is descriptive, and the anchor beats it at predicting here.
    """
    role = obs.role_classic or ""
    role_anchor = anchors.get(role) or (prediction.anchor if prediction else None) or 6.0
    anchor = est.club_anchor(
        role_anchor,
        *(layer.get("club_level", {}).get((obs.club_target or "", role)) or (None, 0)))
    # The anchor of the BASE VOTE, and it is NOT the fantamedia anchor minus anything: a keeper's sits
    # ABOVE his FM anchor (-1.29 of bonus) and a forward's well below (+0.74), and the CLUB's own level is
    # base vote only in part - a solid defence is clean sheets and good marks, a strong attack is bonus,
    # and `est.CLUB_MV_SHARE` carries how much of each. Every rung that transforms a measured season
    # transforms his MV toward this one exactly as it transforms his FM toward the other, so `fm - mv`
    # stays a bonus rate and never becomes the leftover of two unrelated shrinkages.
    role_bonus = layer.get("role_bonus", {}).get(role)
    anchor_mv = est.mv_anchor(role_anchor, role_bonus, anchor, role)
    mine = layer.get("players", {}).get(obs.fc_id, {})
    calendar = data.matchdays_target or 0
    if prediction is not None and prediction.fm_pred is not None:
        # The engine predicts a fantamedia and no base vote, so the MV is this rung's own answer - and it
        # is PREDICTED from his own measured base vote, never derived by subtracting his raw bonus rate
        # from a fantamedia that has already been regressed toward the anchor. That subtraction is what
        # put Malen at 5.67 of MV against the 6.75 he really averaged; `est.mv_predict` carries the
        # measurement, and `fm - mv` is still the bonus per appearance the row expects of him.
        return est.Estimate(
            prediction.fm_pred, prediction.pv_pred, "core", est.CONFIDENCE["core"], "",
            mv=est.mv_predict(obs.mv_prev, obs.pv_prev, anchor_mv, prediction.fm_pred,
                              role_bonus, platform))
    other, older = mine.get("other"), mine.get("older")
    pv_pred = prediction.pv_pred if prediction else None

    # How much of LAST season he played, wherever he played it - the same line for every rung, because
    # «i calciatori nelle condizioni di Ramos» are not only the ones who reach the last rung: the fit's
    # population is everybody with no season on this platform at t-1, which is `anchor` + `older` +
    # `other_platform`. See `est.presences_from_abroad`.
    abroad = (layer.get("players", {}).get(obs.fc_id, {}) or {}).get("abroad") or {}
    abroad_share = ((abroad.get("minutes") or 0) / (90 * abroad["rounds"])
                    if abroad.get("rounds") else None)
    from_abroad = est.presences_from_abroad(calendar, platform, abroad_share)
    # ...e poi QUANTO IL CLUB HA INVESTITO SU DI LUI rispetto a chi gli contende la maglia, che e' il solo
    # ingrediente oggettivo che distingua un titolare annunciato da un riempi-rosa a parita' di minuti
    # (`est.INVESTMENT_SHARE`, e le tre alternative respinte stanno li'). E' un RAFFINAMENTO della retta
    # sopra e non un suo sostituto: senza i due termini nuovi resta quella, mai uno zero.
    peers = (layer.get("players", {}).get(obs.fc_id, {}) or {}).get("peers") or {}
    if from_abroad is not None and calendar:
        with_money = est.presences_from_investment(
            calendar, platform, from_abroad / calendar,
            peers.get("top"), peers.get("value_percentile"))
        if with_money is not None:
            from_abroad = with_money
        # ...e infine QUANTO HANNO PAGATO PER AVERLO sul totale speso, che e' l'unico ingrediente fresco
        # per un uomo appena comprato: la curva dei valori si aggiorna a trimestri, quindi per lui porta
        # ancora il prezzo di prima del trasferimento. ADDITIVO sopra il numero appena calcolato - senza
        # fee non aggiunge niente e la riga resta identica - e ZERO su `default`, dove il verdetto si
        # ribalta togliendo tre righe su 57 (`est.INVESTMENT_FEE_WEIGHT` porta la misura e le due
        # controprove: la spesa del club nel modello, e la soglia sulle fee pubblicate).
        with_fee = est.presences_from_fee(
            calendar, platform, from_abroad / calendar, peers.get("fee_share"))
        if with_fee is not None:
            from_abroad = with_fee

    def presences(source_pv=None, source_calendar_ratio=1.0, recent_first=False, from_older=None):
        """His presences, if the engine has none: the other calendar's, scaled by the two calendars.

        `recent_first` prefers LAST season's measured minutes to the rung's own source, and it is used
        exactly where the rung's source is older than they are: a season two years back says less about
        how much he will play than the one he has just finished somewhere else.

        `from_older` is the last of those sources and the only one that is not handed over as it stands:
        an old pv is worth almost nothing as a forecast of appearances (`est.presences_from_older` carries
        the measurement), so it is regressed toward the share that population really gets - the same
        treatment the fantamedia beside it has had since 06/08/2026.
        """
        if pv_pred is not None:
            return pv_pred
        if recent_first and from_abroad is not None:
            return from_abroad
        if from_older is not None:
            return est.presences_from_older(calendar, platform, from_older.get("pv"),
                                            from_older.get("calendar"))
        if source_pv is None:
            return None
        return round(source_pv * source_calendar_ratio, 1)

    if other and (other["pv"] or 0) >= est.FULL_SEASON_VOTES:
        ratio = (calendar / 31.0) if calendar else 1.0
        return est.Estimate(
            other["fm"], presences(other["pv"], ratio), "other_platform",
            est.CONFIDENCE["other_platform"],
            f"his {window.input_season} on {other['platform']} ({other['pv']} votes) stands in for "
            f"a season this platform has not got",
            mv=other.get("mv"))
    level = f"the level of {obs.club_target or 'the club'}'s {role or 'players'} ({anchor:.2f})"
    if obs.pv_prev and obs.fm_prev is not None:
        value, confidence = est.shrink(obs.fm_prev, obs.pv_prev, anchor)
        base = (est.shrink(obs.mv_prev, obs.pv_prev, anchor_mv)[0]
                if obs.mv_prev is not None and anchor_mv is not None else None)
        return est.Estimate(value, presences(obs.pv_prev), "shrunk", confidence,
                            f"only {_votes(obs.pv_prev)} here, so his mean is blended with {level}",
                            mv=base)
    if other and other["fm"] is not None and (other["pv"] or 0) >= 1:
        value, confidence = est.shrink(other["fm"], other["pv"], anchor)
        base = (est.shrink(other["mv"], other["pv"], anchor_mv)[0]
                if other.get("mv") is not None and anchor_mv is not None else None)
        ratio = (calendar / 31.0) if calendar else 1.0
        return est.Estimate(value, presences(other["pv"], ratio), "shrunk", confidence * 0.9,
                            f"only {_votes(other['pv'])} on {other['platform']} and none here, blended "
                            f"with {level}", mv=base)
    if older:
        # how many seasons back it is, from the season the sheet predicts FROM: 2 by construction, since
        # anything at t-1 would have been caught by the rungs above.
        back = int(window.input_season[:4]) - int(older["season"][:4]) + 1
        # ...and it is REGRESSED toward the anchor, not handed over raw: an old fantamedia used as a
        # prediction is the naive baseline the core beats, and it is biased upward for exactly the men
        # this rung serves (`est.OLDER_BETA` carries the measurement).
        value = est.regress(older["fm"], anchor)
        base = (est.regress(older["mv"], anchor_mv)
                if older.get("mv") is not None and anchor_mv is not None else None)
        pv_est = presences(recent_first=True, from_older=older)
        said = (f"his last measured season is {older['season']} on {older['platform']} "
                f"({older['pv']} votes, {older['fm']:.2f}), {back} seasons back - pulled "
                f"{int((1 - est.OLDER_BETA) * 100)}% toward {level}")
        # ...and the row says what happened to the PRESENCES too, because they are transformed now and a
        # note that explains one half of a pair invites the reader to trust the other half raw.
        if pv_pred is None and from_abroad is None and older.get("calendar"):
            said += (f"; his {older['pv']} votes are {older['pv'] / older['calendar']:.0%} of that "
                     f"calendar and read as {pv_est} of {calendar} here - an old pv barely predicts "
                     f"appearances, so it is pulled toward the share this population really gets")
        return est.Estimate(value, pv_est, "older", est.older_confidence(back), said, mv=base)
    # The last rung, and it has TWO cases that the first version told apart with one constant. A man
    # nobody has ever measured gets the unmeasured share; a man measured ELSEWHERE - the new signing from
    # abroad - gets his own minutes converted by a line fitted on exactly that population
    # (`est.presences_from_abroad`, +17.9% out-of-sample on default). His fantamedia stays the anchor,
    # which is what the gate preferred to R1 on five windows of six: what he did abroad does not predict
    # his fantamedia here, and it does predict how much he PLAYS.
    note = f"nothing measured anywhere: {level}"
    if from_abroad is not None:
        note = (f"no season here, so his {abroad['league']} minutes stand in for the calendar "
                f"({abroad_share:.0%} of it) - {level} for the fantamedia, which is what the gate "
                f"preferred")
    return est.Estimate(anchor, presences(None) or from_abroad
                        # Il RUOLO entra nella costante: la quota di un portiere e' 0.098 e non 0.29,
                        # e senza passarlo il terzo portiere di ogni club leggeva 11 giornate su 38
                        # contro una mediana di zero.
                        or est.default_presences(calendar, platform, "unmeasured", obs.role_classic),
                        "anchor", est.CONFIDENCE["anchor"], note, mv=anchor_mv)


def _club_key(name: str | None) -> str:
    """Two spellings of one club must not read as two clubs: «LOSC Lilla» and «Lille» are the same side, and
    a naive comparison would report a departure for every man on the sheet whose provider spells it its own
    way. Same normalisation `matching.club_key` uses, which is what `club_xref` was built with."""
    return matching.club_key(name or "") if name else ""


def _votes(count: int) -> str:
    """«1 vote», not «1 votes»: a note the operator reads has to read like a sentence."""
    return f"{count} vote" if count == 1 else f"{count} votes"


def measured_season(conn, window) -> tuple[str, str | None]:
    """(the season the descriptive layers measure, a note). Which season "so far" even means.

    Standing on 1 March 2026 the interesting titolarità is THIS season's, up to that day - not last
    season's total, which is what a pre-season snapshot has to use because nothing else exists yet. So
    the target season is measured when it has really been played by then, and the previous one otherwise.
    """
    # ROUNDS, not matches. Counting matches made two pre-season friendlies (25 of them across the
    # perimeter) look like a season under way, and it switched every rate onto a two-game sample. A
    # matchday only exists for a league round, which is exactly the thing that says the season started.
    played = conn.execute(
        """SELECT COUNT(DISTINCT competition || ':' || real_md) FROM external_match_stats
           WHERE season = ? AND source = 'sofascore' AND real_md IS NOT NULL
             AND match_date IS NOT NULL AND match_date < ?""",
        (window.target_season, window.auction_date)).fetchone()[0]
    if played >= TO_DATE_MIN_ROUNDS:
        return window.target_season, (
            f"measured on {window.target_season} up to {window.auction_date} ({played} league rounds in "
            f"the per-match layer), not on the season total: everything after that date is ignored")
    return window.input_season, None


# Below this many league rounds played, "this season to date" is not a sample: the layers fall back to
# the previous season's totals, which is what a pre-season snapshot uses anyway. Five is one September.
TO_DATE_MIN_ROUNDS = 5


def propensity(conn, season: str, before: str | None = None) -> dict[int, dict]:
    """Bonus propensity per 90 over the FULL real season - the engine's own input, reported as-is.

    `before` switches the source from the season AGGREGATE to the per-match layer bounded by that date,
    which is the only way to say "his rate so far" without reading matches that had not been played.

    "FULL real season" means his whole CHAMPIONSHIP - all 38 rounds against the euro calendar's subset -
    and not every competition he appeared in. The aggregate has always read it that way (`external_stats`
    is one row per championship); the dated path counted the cups, so the same rate was measured over two
    different samples depending on the day the sheet was built, and `minutes` could not be divided by a
    league calendar. `LEAGUE_COMPETITIONS` is now the sample in both.
    """
    query = (f"""SELECT fc_id, SUM(COALESCE(minutes, 0)), SUM(COALESCE(goals, 0)),
                        SUM(COALESCE(assists, 0)), SUM(COALESCE(xg, 0)), SUM(COALESCE(xa, 0))
                 FROM external_match_stats
                 WHERE season = ? AND source = 'sofascore' AND match_date IS NOT NULL
                   AND match_date < ? AND competition IN ({_LEAGUE_IN}) GROUP BY fc_id""" if before
             else
             f"""SELECT fc_id, SUM(COALESCE(minutes, 0)), SUM(COALESCE(goals, 0)),
                        SUM(COALESCE(assists, 0)), SUM(COALESCE(xg, 0)), SUM(COALESCE(xa, 0))
                 FROM external_stats WHERE season = ? AND source = 'sofascore'
                   AND competition IN ({_LEAGUE_IN}) GROUP BY fc_id""")
    out: dict[int, dict] = {}
    for fc_id, minutes, goals, assists, xg, xa in conn.execute(
            query, ((season, before, *LEAGUE_COMPETITIONS) if before
                    else (season, *LEAGUE_COMPETITIONS))):
        if not minutes:
            continue
        per90 = 90.0 / minutes
        out[fc_id] = {"goals_p90": round((goals or 0) * per90, 3),
                      "assists_p90": round((assists or 0) * per90, 3),
                      "xg_p90": round((xg or 0) * per90, 3), "xa_p90": round((xa or 0) * per90, 3),
                      "minutes": minutes}
    return out


def lineup_spellings(conn, resolve) -> dict[str, list[str]]:
    """canonical key -> every spelling `club_match_lineups` holds for that club.

    Needed for the same reason the fixtures needed it: the lineup table is keyed by the PROVIDER's name
    ('FC Barcelona'), and querying it with ours ('Barcellona') returned zero elevens for every club
    outside Serie A - which is exactly the population whose formation nobody knows by heart.
    """
    out: dict[str, list[str]] = {}
    for (club,) in conn.execute("SELECT DISTINCT club FROM club_match_lineups WHERE club IS NOT NULL"):
        key, _name = resolve(club)
        if key:
            out.setdefault(key, []).append(club)
    return out


# How much an eleven played by the PREVIOUS coach still counts when the coach has changed. Not zero:
# with three matches under a new man his predecessor's habit is still the best evidence there is, and a
# hard cut would answer "3-4-3, 100% of 3 elevens" from a pre-season friendly. Not one either - that is
# the whole point of the request. A READING weight, stated in the sheet, and no rule fits on it.
PREVIOUS_COACH_WEIGHT = 0.25


def league_repertoire(conn, season: str, before: str | None = None) -> dict[str, int]:
    """{shape: complete elevens that used it} over EVERY club of the season - football's own repertoire.

    A club's history says what its coach does; this says what a formation IS. It exists because the two
    questions are different: a coach can try a shape he has never used - a new man, a summer arrival, an
    opponent - and the board must be able to draw it, while still refusing to invent one. Measured on
    2025-26: 4812 elevens over 11 distinct shapes, of which SEVEN are above 1% (4-5-1 36%, 3-4-3 22%,
    3-5-2 13%, 4-3-3 12%, 4-4-2 10%, 5-3-2 3.3%, 5-4-1 2.5%) and the remaining four are two elevens each
    (2-6-2, 4-2-4, 4-6-0) or twelve (3-6-1) - parsing tails, not modules. Whoever reads this applies the
    floor; storing the counts keeps the judgement in the open.
    """
    rows = conn.execute(
        """SELECT defenders, midfielders, forwards, COUNT(*) FROM club_match_lineups
           WHERE season = ? AND starters = 11
             AND goalkeepers + defenders + midfielders + forwards = 11
             AND (? IS NULL OR (match_date IS NOT NULL AND match_date < ?))
           GROUP BY 1, 2, 3 ORDER BY 4 DESC""", (season, before, before)).fetchall()
    return {f"{defenders}-{midfielders}-{forwards}": count
            for defenders, midfielders, forwards, count in rows}


class Typical(NamedTuple):
    """What the club's complete elevens say about its shape."""

    shape: str | None
    share: float | None
    counted: int
    basis: str
    under_coach: int
    # Every shape it actually fielded, with how many times: "3-4-3:27;4-5-1:8;4-3-3:3". The MODE alone
    # cannot answer "what else does this side line up in", and that is the question a board has to answer
    # when the modal shape asks for a player the squad has not got. Raw counts, not the coach weighting:
    # the counts are the fact, and whoever reads them can see for himself how much is the predecessor's.
    shapes: str


def typical_formation(conn, spellings: list[str], season: str, coach_since: str | None = None,
                      before: str | None = None) -> Typical:
    """The club's MODAL formation over its complete elevens, and the whole distribution with it.

    The mode, not the mean. A club that alternates 3-5-2 and 4-3-3 has a mean of 3.5 defenders, which is
    not a formation anyone can field; its mode is one of the two, and the share says how settled it is -
    97% of 38 elevens is Atalanta's habit, 63% is Arsenal choosing.

    When `coach_since` says the man in charge arrived DURING the sample, his own elevens weigh four times
    his predecessor's: a new coach's shape is the club's shape now, and the previous one is only evidence
    about a side that no longer exists. The `basis` says which of the two happened, because "3-4-3" from
    38 elevens and "3-4-3" from four are not the same statement.
    """
    if not spellings:
        return Typical(None, None, 0, "no lineups", 0, "")
    placeholders = ",".join("?" * len(spellings))
    rows = conn.execute(
        f"""SELECT defenders, midfielders, forwards, match_date FROM club_match_lineups
            WHERE club IN ({placeholders}) AND season = ? AND starters = 11
              AND goalkeepers + defenders + midfielders + forwards = 11
              AND (? IS NULL OR (match_date IS NOT NULL AND match_date < ?))""",
        (*spellings, season, before, before)).fetchall()
    if not rows:
        return Typical(None, None, 0, "no lineups", 0, "")
    weights: dict[tuple[int, int, int], float] = {}
    counts: dict[tuple[int, int, int], int] = {}
    under_coach = 0
    for defenders, midfielders, forwards, date in rows:
        his = bool(coach_since and date and date >= coach_since)
        under_coach += his
        weight = 1.0 if (his or not coach_since) else PREVIOUS_COACH_WEIGHT
        shape = (defenders, midfielders, forwards)
        weights[shape] = weights.get(shape, 0.0) + weight
        counts[shape] = counts.get(shape, 0) + 1
    total = sum(weights.values())
    shape, weight = max(weights.items(), key=lambda item: item[1])
    if coach_since and not under_coach:
        # The reweighting cannot help here: with no eleven of his own, every match is the predecessor's
        # and scaling them all by the same factor changes nothing. What CAN be done is say so - a 97%
        # 3-4-3 that the current coach has never fielded describes a side that no longer exists, and at
        # an auction that is the difference between a habit and a historical note.
        basis = f"0 of {len(rows)} XIs under this coach - this is his PREDECESSOR's shape"
    elif coach_since and under_coach < len(rows):
        basis = f"{under_coach} of {len(rows)} XIs under this coach"
    else:
        basis = f"{len(rows)} XIs"
    # `under_coach` is returned as a NUMBER as well as inside the sentence: whoever has to decide how much
    # to trust this shape needs a value it can compare, and the Auction board does exactly that - a modal
    # shape resting on 0 elevens of the current coach is a historical note, not a habit, and the board is
    # allowed to draw a different one. Parsing the sentence back out would be reading our own prose.
    spread = ";".join(f"{'-'.join(str(part) for part in key)}:{count}"
                      for key, count in sorted(counts.items(), key=lambda item: -item[1]))
    # No `coach_since` inside the sample means the man in charge PREDATES it, so every eleven is his -
    # counting the rows that fall after a date that does not exist returned 0 and read as "this is his
    # predecessor's shape" for Arteta, who has been at Arsenal since 2019.
    return Typical("-".join(str(part) for part in shape), round(weight / total, 2), len(rows), basis,
                   len(rows) if not coach_since else under_coach, spread)


def measured_elsewhere(conn, window) -> dict[int, dict]:
    """{fc_id: matches, minutes, where} - the window of football a man with no season here DID play.

    It is `features._recent_form`'s own sample, read through the same bounds (the input season's July to the
    auction date) and reduced to what a sheet column can hold. Written so the panel can stand on the fact
    the ENGINE already stands on: R13 - adopted on Serie A - predicts this man's presences from exactly
    these matches, and the board was drawing him at a standing of zero.

    `where` is the competitions, most matches first, because ten matches somewhere are not a season here and
    the plate has to say where they were played.

    `club` is the side he played those matches FOR, most minutes first, and it is not decoration: it is the
    only thing that can say at what LEVEL that window was played. `desc_level_elo` is filled from a man's
    previous ROSTER, so a player who has never been in a listone carries none - and Alajbegovic's ten
    matches are Bayer Leverkusen's (Elo 1836.6, above Juventus's own 1819.4), which is exactly the evidence
    the adopted level channels exist to read. Resolved by the canonical index, never by the spelling.
    """
    out: dict[int, dict] = {}
    floor = f"{window.input_season.split('-')[0]}-07-01"
    for fc_id, matches, minutes, competitions in conn.execute(
            """SELECT fc_id, COUNT(*), SUM(COALESCE(minutes, 0)),
                      GROUP_CONCAT(DISTINCT competition)
               FROM external_match_stats
               WHERE source = 'sofascore_recent' AND match_date >= ? AND match_date < ?
                 AND COALESCE(minutes, 0) > 0
               GROUP BY fc_id""", (floor, window.auction_date)):
        out[fc_id] = {"matches": matches, "minutes": minutes,
                      "where": (competitions or "").replace(",", " ")[:40] or None}
    for fc_id, club in conn.execute(
            """SELECT fc_id, club FROM external_match_stats
               WHERE source = 'sofascore_recent' AND match_date >= ? AND match_date < ?
                 AND COALESCE(minutes, 0) > 0 AND club IS NOT NULL
               GROUP BY fc_id, club ORDER BY SUM(COALESCE(minutes, 0))""",
            (floor, window.auction_date)):
        if fc_id in out:
            out[fc_id]["club"] = club          # last wins = the club he played most of the window for
    return out


def preseason_starts(conn, season: str, coach_since: str | None = None) -> dict[int, tuple[int, int]]:
    """fc_id -> (elevens he STARTED, friendlies he appeared in) in the TARGET season's pre-season.

    A READING and never a criterion, and the reason is measured rather than assumed. For an August auction
    the pre-season is the only football the new coach has played, and the operator's own case says how much
    it can be worth: Atalanta's two friendlies under Sarri were started by Gaetano, Samardzic, Scamacca and
    Raspadori - the four the published prediction fields and our claim does not - while De Roon, Ederson and
    Krstovic, whom our board starts, started NEITHER.
    That looks like a signal, and it is not usable as one:
      * NO out-of-sample test is possible: per-player friendlies exist for exactly ONE pre-season (1696 rows
        on 2026-27 against 37 on 2025-26), so nothing can be judged on a window that does not judge itself,
        which is this project's own rule;
      * the sample is 1-3 matches, and **two of the seven Serie A clubs with a new coach have none at all**;
      * minutes and ratings are absent from 1399 of 1716 rows, so the only thing there is the `started` flag;
      * and the fixtures are what they are: Atalanta's two are against **their own U23 side** and Arezzo,
        where a coach fields whoever he wants. A starting eleven there is not a competitive statement;
      * the one external source that agrees (the published 26/27 elevens) is NOT independent - it read the
        same friendlies.
    So it goes where a true, non-predictive fact goes on this board: the plate, for the human who is
    bidding. Same treatment as the body (height/weight, gate §5-terdecies), for the same reason.
    Pre-registered instead of guessed: in June 2027 this season's outcome exists, and the pre-season signal
    becomes testable out of sample for the first time (gate §7).
    """
    rows = conn.execute(
        """SELECT fc_id, SUM(COALESCE(started, 0)), COUNT(*) FROM external_match_stats
           WHERE season = ? AND competition LIKE '%friendly%'
             AND (? IS NULL OR (match_date IS NOT NULL AND match_date >= ?))
           GROUP BY fc_id""", (season, coach_since, coach_since)).fetchall()
    return {fc_id: (int(started or 0), int(matches or 0)) for fc_id, started, matches in rows}


def coach_repertoire(conn, coach: str | None, before: str | None = None,
                     repertoires: dict[str, dict[str, int]] | None = None) -> tuple[str, int]:
    """({shape: count} as "4-3-3:162;4-4-2:20", how many elevens) — what THIS COACH lines up in, anywhere.

    The third source of a shape, and the one that was missing. A club's own history answers «what does this
    side do», the league's repertoire «what is a formation»; neither answers «what does the man who is here
    NOW do», and for a new coach that is the only question that matters. Measured on the 26/27 sheets: 12 of
    34 euro clubs (7 of 20 Serie A) have a coach with **zero** elevens at this club, so what the board drew
    was his predecessor's shape.

    His OWN elevens, from every spell in `coaches` and every competition we parsed - a coach's habit travels
    with him, so restricting it to this club would answer nothing, and restricting it to the league would
    throw away the seasons that make the sample big enough to mean something.

    The sample is what decides whether it may be used, and it is wildly uneven, which is why the count is
    returned with it: Gasperini 271 elevens, Sarri 188 (4-3-3 at 86%), Allegri 152 (3-5-2 at 62% - a coach
    who is genuinely shape-fluid), Spalletti 107, against Aquilani 1 and Abate 2, and Iraola / Filipe Luís /
    Carles Martínez at **zero**, because their careers were spent outside the five leagues we cover. A floor
    is not optional: with n = 2 the mode is noise, and it would replace a club habit that is already right.

    THE CLUB IS RESOLVED THROUGH THE CANONICAL INDEX, and it was not (fixed 08/08/2026). This joined
    `club_match_lineups.club` - a string the parser wrote, 'AC Milan', 'RB Leipzig', 'SSC Napoli' - to
    `clubs.canonical_name` with `=`, which is the join this project has now paid for four times («an entity
    joins through its CANONICAL KEY, never through the string a source uses to name it»). It cost the
    repertoires 26% of their elevens and it cost them WHERE IT DECIDES: Gattuso came back with **2** elevens
    and has **79**, Tedesco with 3 of 28, Spalletti with 31 of 107 - i.e. three coaches sat under
    `COACH_SHAPE_MIN` or read the wrong mode while their real sample was well over it, so the board kept
    drawing the predecessor's shape for the very clubs this function exists for. The irony worth recording:
    `club_context` had `lineup_spellings` in its hand for the club's OWN shapes and did not pass it here.

    One pass over the line-ups for EVERY coach (`coach_repertoires`) rather than one query each, because
    resolving a name is Python's job and 24k elevens scanned 35 times is not. `repertoires` is that pass,
    handed in by a caller with a loop over clubs; without it this computes its own, which is what a single
    call wants. An eleven is counted ONCE even where two spells overlap - the old SQL join counted it per
    matching spell.
    """
    if not coach:
        return "", 0
    table = repertoires if repertoires is not None else coach_repertoires(conn, before)
    shapes = table.get(coach) or {}
    rows = sorted(shapes.items(), key=lambda item: -item[1])
    return (";".join(f"{shape}:{count}" for shape, count in rows), sum(shapes.values()))


def coach_repertoires(conn, before: str | None = None) -> dict[str, dict[str, int]]:
    """{coach: {shape: how many elevens}} for every coach we have a spell for. ONE pass, no hidden state.

    The club is resolved through `club_index` on both sides - the coach's spells name it our way, the
    line-ups name it the provider's. Computed once by whoever loops over clubs and passed down, rather than
    memoised here: a cache keyed on a connection is state nobody can see, and a test that has to clear it is
    the warning that comes with it.
    """
    resolve = club_index(conn)
    spells: dict[str, list[tuple[str, str, str]]] = {}
    for coach, name, valid_from, valid_to in conn.execute(
            """SELECT h.coach_name, c.canonical_name, h.valid_from, h.valid_to FROM coaches h
               JOIN clubs c USING(fc_club_id) WHERE c.canonical_name IS NOT NULL"""):
        key, _name = resolve(name)
        if key and coach:
            spells.setdefault(key, []).append((coach, valid_from or "0000", valid_to or "9999"))
    out: dict[str, dict[str, int]] = {}
    for club, defenders, midfielders, forwards, date in conn.execute(
            """SELECT club, defenders, midfielders, forwards, match_date FROM club_match_lineups
               WHERE starters = 11 AND match_date IS NOT NULL
                 AND goalkeepers + defenders + midfielders + forwards = 11"""):
        if before and date >= before:
            continue
        key, _name = resolve(club or "")
        for coach, valid_from, valid_to in spells.get(key or "", ()):
            if valid_from <= date <= valid_to:
                shape = f"{defenders}-{midfielders}-{forwards}"
                shapes = out.setdefault(coach, {})
                shapes[shape] = shapes.get(shape, 0) + 1
                break
    return out


# The positional heatmap says WHERE across the pitch a player stood, but not which touchline y=0 is on.
# So the orientation is CALIBRATED from the players whose listone role names a side: right backs and left
# backs cannot both be at the same end of the axis. Below this many of each, no side is claimed at all -
# an uncalibrated axis would put half a defence on the wrong flank, which is worse than saying nothing.
SIDE_CALIBRATION_MIN = 8


def measured_sides(conn, season: str, notes: list[str]) -> dict[int, float]:
    """fc_id -> where he really stood across the pitch, -1 the team's left ... +1 its right.

    From `positions.avg_y` (the season heatmap), oriented by the calibration above. This is the precise
    answer the listone's role only approximates: a nominal centre back who spent the year on the left of
    a back three shows up as one, and a 'dc' really in the middle stays in the middle.
    """
    rows = conn.execute(
        """SELECT p.fc_id, p.avg_y, r.roles FROM positions p
           JOIN rosters r ON r.fc_id = p.fc_id AND r.season = p.season
           WHERE p.season = ? AND p.source = 'sofascore' AND p.avg_y IS NOT NULL""",
        (season,)).fetchall()
    if not rows:
        return {}
    right = [avg_y for _fc, avg_y, roles in rows if "dd" in (roles or "").split(";")]
    left = [avg_y for _fc, avg_y, roles in rows if "ds" in (roles or "").split(";")]
    if min(len(right), len(left)) < SIDE_CALIBRATION_MIN:
        notes.append(f"the heatmap axis could not be calibrated ({len(right)} right backs and "
                     f"{len(left)} left backs with a heatmap, {SIDE_CALIBRATION_MIN} of each needed), "
                     f"so no measured side is published: the sheet falls back to the listone's roles. "
                     f"Run `positions --layer heatmap` to fill it.")
        return {}
    orientation = 1.0 if sum(right) / len(right) < sum(left) / len(left) else -1.0
    notes.append(f"heatmap axis calibrated on {len(right)} right backs and {len(left)} left backs: "
                 f"{'low' if orientation > 0 else 'high'} y is the team's right")
    return {fc_id: round(max(-1.0, min(1.0, orientation * (50.0 - avg_y) / 50.0)), 3)
            for fc_id, avg_y, _roles in rows}


def titolarita(conn, season: str, before: str | None = None) -> dict[int, dict]:
    """How often he STARTED over the full real season: (starts, matches, share).

    This - not any valuation - is what says whether a coach fields him. Read over the whole season
    because the "schieramento tipo" is a habit over a year; the last ten matches are a separate column
    and answer the other question, which side the coach is picking now.

    `before` reads the per-match layer up to that date instead of the season aggregate: on 1 March the
    habit is the one measured through February, and the aggregate would carry the rest of the season -
    matches that, from where the sheet is standing, have not been played.

    LEAGUE matches only, in both paths. The aggregate has no choice - `external_stats` stores one row per
    championship - and the dated path used to count the cups too, so the same column meant two different
    things depending on when the sheet was built, and neither could be divided by a club's league
    calendar. `desc_season_starts` is therefore always "starts in his championship".
    """
    query = (f"""SELECT fc_id, SUM(COALESCE(started, 0)), COUNT(*) FROM external_match_stats
                 WHERE season = ? AND source = 'sofascore' AND COALESCE(minutes, 0) > 0
                   AND match_date IS NOT NULL AND match_date < ?
                   AND competition IN ({_LEAGUE_IN}) GROUP BY fc_id""" if before else
             f"""SELECT fc_id, SUM(COALESCE(starts, 0)), SUM(COALESCE(matches, 0))
                 FROM external_stats WHERE season = ? AND source = 'sofascore'
                   AND competition IN ({_LEAGUE_IN}) GROUP BY fc_id""")
    out: dict[int, dict] = {}
    for fc_id, starts, matches in conn.execute(
            query, ((season, before, *LEAGUE_COMPETITIONS) if before
                    else (season, *LEAGUE_COMPETITIONS))):
        if not matches:
            continue
        out[fc_id] = {"starts": starts, "matches": matches,
                      "share": round((starts or 0) / matches, 3)}
    return out


def previously_at_club(conn, observations, squads: dict[int, str], season: str) -> dict[int, str]:
    """fc_id -> the most recent EARLIER season in which THIS club's listone already had him.

    The one thing that separates a man his club SENT AWAY from a man it has just taken on, and it is
    measured rather than looked up: no source of ours marks a loan. `arrivals.type` knows only
    new/transfer_cross_league/transfer_intra_league, `transfers_history.fee` is NULL for a free transfer
    and for a loan alike (1367 of 2067 rows) and carries nothing at all for the window being auctioned.
    A club's own roster history does carry it: Marin R. was in Napoli's listone in 2024-25 and in
    Villarreal's in 2025-26, so Napoli had him and let him go; Gila has been Lazio's for four seasons and
    is Milan's now, so Milan has never judged him.

    Read against the club he is at NOW, not against the listone's - in July the listone does not exist.
    Seasons at or after `season` (the measured one) are ignored: the question is about BEFORE.
    """
    resolve = club_index(conn)
    now: dict[int, str] = {}
    for obs in observations:
        key, _name = resolve(obs.club_target or squads.get(obs.fc_id))
        if key:
            now[obs.fc_id] = key
    out: dict[int, str] = {}
    for fc_id, roster_season, club in conn.execute(
            """SELECT r.fc_id, r.season, c.canonical_name FROM rosters r
               LEFT JOIN clubs c ON c.fc_club_id = r.fc_club_id
               WHERE r.season < ? AND c.canonical_name IS NOT NULL ORDER BY r.season""",
            (season,)):
        if fc_id in now and resolve(club)[0] == now[fc_id]:
            out[fc_id] = roster_season          # ascending, so the last write is the most recent
    return out


def at_current_club(conn, season: str, observations, squads: dict[int, str],
                    before: str | None = None) -> dict[int, dict]:
    """His measured season split in two: what he played AT THE CLUB HE IS AT NOW, and what ELSEWHERE.

    The season totals say how much a coach used him; they do not say WHOSE coach. Marin R. is at Napoli
    with 21 starts and 1980 minutes, and every one of them is Villarreal's - read as a Napoli standing
    they put him ahead of Rrahmani. So the split travels in the sheet as two halves of one season and the
    view discounts the half made elsewhere (`SnapshotView.LOAN_DISCOUNT`) instead of dropping it: being
    sent on loan is the club's own judgement of a player, and zeroing it would delete every summer
    signing from the eleven.

    From the per-match layer, the only place that stores a club per appearance, and over the CHAMPIONSHIP
    rounds only - the same sample as `titolarita` and `propensity`, so the three halves of one season can
    be read against each other. Counting the cups here made `desc_minutes_club` and
    `desc_minutes_full_season` two different numbers for the same season in the same row (Kane 2994
    against 2382), and the share was taken over a sample whose size depended on how far his club went in
    Europe. A player the layer has no row for is absent from the result, which leaves the columns empty
    and his standing undiscounted: not knowing where he played is not knowing.
    """
    resolve = club_index(conn)
    # The club whose shirt he is competing for in THIS sheet - the same one the pitch draws him at.
    now: dict[int, str] = {}
    for obs in observations:
        key, _name = resolve(obs.club_target or squads.get(obs.fc_id))
        if key:
            now[obs.fc_id] = key
    query = (f"""SELECT fc_id, club, COALESCE(started, 0), COALESCE(minutes, 0)
                 FROM external_match_stats
                 WHERE season = ? AND source = 'sofascore' AND COALESCE(minutes, 0) > 0
                   AND competition IN ({_LEAGUE_IN})
                   AND match_date IS NOT NULL AND match_date < ?""" if before else
             f"""SELECT fc_id, club, COALESCE(started, 0), COALESCE(minutes, 0)
                 FROM external_match_stats
                 WHERE season = ? AND source = 'sofascore' AND COALESCE(minutes, 0) > 0
                   AND competition IN ({_LEAGUE_IN})""")
    out: dict[int, dict] = {}
    for fc_id, club, started, minutes in conn.execute(
            query, ((season, *LEAGUE_COMPETITIONS, before) if before
                    else (season, *LEAGUE_COMPETITIONS))):
        if fc_id not in now:
            continue
        entry = out.setdefault(fc_id, {"starts": 0, "minutes": 0,
                                       "starts_elsewhere": 0, "minutes_elsewhere": 0})
        here = resolve(club)[0] == now[fc_id]
        entry["starts" if here else "starts_elsewhere"] += 1 if started else 0
        entry["minutes" if here else "minutes_elsewhere"] += minutes
    return out


def club_context(conn, data: features.WindowData, starters_date: str | None,
                 clubs: list[str], measured: str | None = None,
                 before: str | None = None, fielded: dict[str, dict] | None = None,
                 platform: str = "default") -> list[dict]:
    """One row per club OF THE SHEET: coach, formation, lines fielded, arrivals, Elo.

    The club list comes from the sheet's own rows, not from `rosters`: with no listone for the season
    being auctioned there are no roster rows to enumerate, and the clubs are exactly the ones whose real
    squads the sheet just described.
    """
    window = data.window
    resolve = club_index(conn)
    spellings = lineup_spellings(conn, resolve)
    # Every coach's own repertoire, in ONE pass - the club resolved by key, never by spelling. Computed
    # here because the loop below asks for it once per club and the answer is the same table every time.
    repertoires = coach_repertoires(conn, before)
    formations: dict[str, str] = {}
    if starters_date:
        formations = {team: formation for team, formation in conn.execute(
            "SELECT team, formation FROM probable_starter WHERE valid_from = ? AND team IS NOT NULL "
            "AND formation IS NOT NULL GROUP BY team", (starters_date,))}
    elo_date = conn.execute("SELECT MAX(date) FROM club_elo WHERE date <= ?",
                            (window.auction_date,)).fetchone()[0]
    elo = dict(conn.execute(
        "SELECT c.canonical_name, e.elo FROM club_elo e JOIN clubs c USING(fc_club_id) "
        "WHERE e.date = ?", (elo_date,))) if elo_date else {}
    # Which championship each club plays in - the calendar its share-of-the-season denominators count.
    championships = dict(conn.execute(
        "SELECT canonical_name, league FROM clubs WHERE canonical_name IS NOT NULL"))
    out = []
    for club in clubs:
        coach = conn.execute(
            """SELECT co.coach_name, co.valid_from FROM coaches co JOIN clubs c USING(fc_club_id)
               WHERE c.canonical_name = ? AND co.valid_from <= ?
               ORDER BY co.valid_from DESC LIMIT 1""", (club, window.auction_date)).fetchone()
        mine = spellings.get(resolve(club)[0], [])
        placeholders = ",".join("?" * len(mine)) or "NULL"
        season = measured or window.input_season
        lines = conn.execute(
            f"""SELECT AVG(defenders), AVG(midfielders), AVG(forwards), COUNT(*),
                       SUM(competition IN ({_LEAGUE_IN}))
                FROM club_match_lineups
                WHERE club IN ({placeholders}) AND season = ? AND starters = 11
                  AND goalkeepers + defenders + midfielders + forwards = 11
                  AND (? IS NULL OR (match_date IS NOT NULL AND match_date < ?))""",
            (*LEAGUE_COMPETITIONS, *mine, season, before, before)).fetchone()
        # The coach's own start date, and only when he arrived after the sample began: an unchanged
        # coach needs no reweighting, the whole season is his.
        coach_since = coach[1] if coach and coach[1] else None
        if coach_since and coach_since <= f"{season.split('-')[0]}-07-01":
            coach_since = None
        # NOT `measured`: that name is this function's own parameter, the season the layers are measured
        # on, and shadowing it fed a NamedTuple to the next query as a season.
        shapes = typical_formation(conn, mine, season, coach_since, before)
        # ...and the same over the TARGET season, which before a ball is kicked is the pre-season alone
        friendly = typical_formation(conn, mine, window.target_season, None, before)
        typical, share, counted, basis = shapes.shape, shapes.share, shapes.counted, shapes.basis
        coach_shapes, coach_shapes_of = coach_repertoire(
            conn, coach[0] if coach else None, before, repertoires)
        arrivals = conn.execute(
            """SELECT COUNT(*) FROM arrivals a JOIN rosters r
               ON r.fc_id = a.fc_id AND r.season = a.season
               JOIN clubs c ON c.fc_club_id = r.fc_club_id
               WHERE a.season = ? AND a.platform = ? AND c.canonical_name = ?""",
            (window.target_season, platform, club)).fetchone()[0]
        new_coach = conn.execute(
            """SELECT COUNT(*) FROM flags f JOIN rosters r
               ON r.fc_id = f.fc_id AND r.season = f.season
               JOIN clubs c ON c.fc_club_id = r.fc_club_id
               WHERE f.flag = 'new_coach' AND f.season = ? AND c.canonical_name = ?""",
            (window.target_season, club)).fetchone()[0]
        out.append({
            "club": club,
            "coach": coach[0] if coach else None,
            "coach_since": coach[1] if coach else None,
            "new_coach": "yes" if new_coach else "no",
            # The MODULO TIPO: the shape this club actually lines up in most often, not the mean of its
            # lines. The mean is an artefact - Arsenal's 4.0/3.74/2.26 rounds to 4-4-2, a formation they
            # never played - while the mode is a formation that was on the pitch, and its share says how
            # much of a habit it is.
            "formation_typical": typical,
            "formation_typical_share": share,
            "formation_typical_of": counted,
            "formation_typical_basis": basis,
            # How many of those elevens are the CURRENT coach's. Zero means the modal shape belongs to a
            # side that no longer exists, which is what lets a reader (and the Auction board) decide how
            # much of a habit it is instead of taking a percentage at face value.
            "formation_typical_under_coach": shapes.under_coach,
            # And every shape it fielded, with counts. The board draws one of THESE when the modal shape
            # asks for a player the squad has not got - a formation nobody lined up in is not an
            # alternative, it is an invention.
            "formation_shapes": shapes.shapes,
            # THE SHAPES OF THE PRE-SEASON, i.e. of the TARGET season - the only elevens that exist for
            # a side that has not played a competitive match yet, and the one thing the repertoire
            # cannot answer: «what has he announced for THIS squad». Same format as `formation_shapes`.
            # Small on purpose and stated: 1-3 complete elevens per club (297 over 200 clubs), which is
            # why whoever reads it must weigh it by its own sample. The claim is deliberately NOT built
            # on friendlies (measured and refused, five reasons in v9.17 §6); a SHAPE is a different
            # signal from a per-player minute, and it is a declaration by the coach.
            "friendly_shapes": friendly.shapes,
            "friendly_XIs": friendly.counted,
            # ...and every shape THE COACH fielded, anywhere, with how many elevens it rests on
            # (`coach_repertoire`). It is the answer to «what does the man who is here NOW do», which
            # neither of the two above can give, and the board weighs it by its own sample size - Sarri
            # arrives at Atalanta with 188 elevens and a 4-3-3 at 86% while the club's own habit is his
            # predecessor's 3-4-3, and Iraola arrives at Liverpool with none at all.
            "coach_shapes": coach_shapes,
            "coach_shapes_of": coach_shapes_of,
            # "Absolutely preferred" is a measured thing: a shape used in most of the elevens is the
            # coach's, one used in a third of them is a coach still choosing - and the two must not be
            # presented the same way.
            "formation_settled": (("no" if "PREDECESSOR" in (basis or "")
                                   else "yes" if (share or 0) >= FORMATION_SETTLED else "no")
                                  if share else None),
            "formation_today": formations.get(club),
            # What it ACTUALLY lined up in, in the first match after the auction date - a fact, and only on
            # a back-dated sheet. The pair with `formation_today` is deliberate: one is the editors' guess
            # for that week, the other is what happened, and they must never be read as the same column.
            "formation_next_fielded": (fielded or {}).get(club, {}).get("shape"),
            "next_match_date": (fielded or {}).get(club, {}).get("date"),
            "probabili_date": starters_date,
            "lines_fielded_D": round(lines[0], 2) if lines and lines[0] is not None else None,
            "lines_fielded_M": round(lines[1], 2) if lines and lines[1] is not None else None,
            "lines_fielded_F": round(lines[2], 2) if lines and lines[2] is not None else None,
            # Every complete eleven we parsed, whatever the competition: the sample the lines above are
            # averaged over, and the fixture list Transfermarkt counts a man's absences against.
            "complete_XIs": lines[3] if lines else 0,
            # ...and how many of those are the CHAMPIONSHIP's. This is the denominator of a share of the
            # season: the platform's calendar is made of league rounds, the numerators are league-only
            # (`external_stats` stores nothing else), and the club-to-club spread of the other number is
            # 66%-100% (Arsenal 38 of 58, Napoli 38 of 38). A titolarità divided by the whole fixture
            # list is not comparable between two clubs, which is what made Kane read 49%.
            "league_XIs": lines[4] if lines and lines[4] is not None else 0,
            # The championship those rounds belong to, so the sheet says which calendar it counted.
            "league": championships.get(club),
            "arrivals": arrivals,
            "elo": round(elo[club], 1) if club in elo else None,
        })
    return out


# ---------------------------------------------------------------- the engine half
def engine_predictions(conn, window: features.Window, platform: str, game: str,
                       league, squad_source: str = "real", prepared=None, fits=None
                       ) -> tuple[features.WindowData, list, str, list[str]]:
    """The validated valuation: ADOPTED rules, parameters fitted on a DIFFERENT window.

    Nothing here is new model code - it calls the same functions `backtest --auction` calls, which is
    what keeps the sheet and the gate from ever disagreeing.

    `fits` = `{window key: Params}` over the windows the caller has ALREADY fitted, in `WINDOWS` order.
    It exists for the Auction panel, which fits every window to cross-score them and would otherwise
    pay for eleven `prepare` calls twice over; the CHOICE of which fit prices a live target stays here,
    in one place, because a second copy of that choice is how the sheet and the panel start disagreeing.
    """
    notes: list[str] = []
    if prepared is None:
        prepared = features.prepare(conn, window, platform, game, league=league,
                                    squad_source=squad_source)
    data = prepared
    if not data.matchdays_target:
        # THE CALENDAR OF A SEASON NOT YET PLAYED, and it lives here rather than in whoever calls this:
        # appearances are predicted as a SHARE of the target calendar, so a calendar of zero rounds turns
        # every prediction into zero - and then VALUE and SURPLUS are zero too and the ranking is sorted
        # by nothing. It used to sit in `snapshot.build`, which is the caller: the Auction panel asking
        # the same question got a whole listone priced at zero appearances. Same shape as every other
        # defect this project has paid for - the fix belongs where the price is decided.
        data.matchdays_target = data.matchdays_prev
        notes.append(f"{window.target_season} has no matchdays yet, so expected appearances are "
                     f"scaled on {window.input_season}'s calendar ({data.matchdays_prev} rounds)")
    listone = sum(1 for obs in data.observations if obs.price_initial is not None)
    if squad_source == "real" and listone < len(data.observations):
        notes.append(f"{len(data.observations) - listone} of {len(data.observations)} players are in a "
                     f"real squad but not in the {window.target_season} listone: no Qt.I exists for "
                     f"them yet, so the engine prices them at the role anchor (R0c) and their "
                     f"`price_initial` is empty by construction, not by omission")
    active = ("R0", *evaluate.ADOPTED.get(platform, ()))
    if fits is not None:
        usable = tuple(key for key in features.WINDOWS if key in fits)
    else:
        # The FIT windows keep the listone population on purpose: they are the gate's own windows, and
        # widening them would fit the coefficients on a different population than the one they were
        # validated on. Only the window being PRICED reads the real squads.
        usable = tuple(key for key in features.WINDOWS
                       if evaluate._window_is_usable(
                           features.prepare(conn, features.WINDOWS[key], platform, game), platform))
    if not usable:
        notes.append("no window has both a previous and an actual fantamedia, so no parameters could "
                     "be fitted: the engine columns fall back to the R0 core alone")
        return data, evaluate.predict_window(data, ("R0",)), "R0-core", notes
    fitted = dict(fits) if fits is not None else {key: evaluate.fit_params(
        features.prepare(conn, features.WINDOWS[key], platform, game),
        ("R0", *evaluate.CANDIDATES)) for key in usable}
    # The most recent usable window fits the parameters, and the pooled rules average over the others -
    # the same construction the auction simulation uses. For a LIVE target this is not cross-fitting
    # (there is nothing to cross-fit against yet): it is the freshest fit that does not read the season
    # being auctioned, which is the strongest thing available before it is played.
    source = usable[-1]
    params = evaluate.pool_params(fitted, "", fitted[source])
    if window.target_season == features.WINDOWS[source].target_season:
        notes.append(f"the target season {window.target_season} is also the season the parameters were "
                     f"fitted on ({source}): this run is a DRY RUN, not an out-of-sample statement")
    return data, evaluate.predict_window(data, active, None, params), params.source or source, notes


# ---------------------------------------------------------------- assembly
PLAYER_COLUMNS: tuple[str, ...] = (
    # identity and market facts
    "fc_id", "name", "club", "league", "role_classic", "roles_mantra",
    "price_initial", "price_initial_mantra", "fvm_reporting_only",
    # the gated engine valuation
    "engine_fm_pred", "engine_pv_pred", "engine_value", "engine_surplus", "engine_role_rank",
    # `engine_role_slot` is the role the two columns around it are measured in - the game's own
    # vocabulary, so 'D' on a classic sheet and 'dc'/'dd'/'e'/'b' on a mantra one (see `auction_slot`)
    "engine_role_slot", "engine_replacement_fm", "engine_anchor", "engine_unpriced_reason",
    # ESTIMATED, a third class next to engine_ (gated) and desc_ (measured): every player gets a surplus,
    # penalised for what we do not know about him, with the basis and the penalty on the row (engine/estimate.py)
    # `est_mv` is the base vote behind `est_fm`, derived from it and never guessed apart: FM - MV is the
    # bonus per appearance the row expects, so the two can never say different things about one player.
    "est_fm", "est_mv", "est_pv", "est_surplus", "est_basis", "est_confidence", "est_note",
    # Fpi: QUANTO VALE UNA SUA PARTITA secondo il calcio che ha davvero giocato, anche altrove.
    # Non e' `est_fm` con un altro nome: dove il core non lo prezza, `est_fm` scende sull'ANCORA del ruolo
    # («e' un attaccante della Juve»), mentre questa legge le sue partite vere all'estero - voto base
    # calibrato piu' gol e assist - e le regredisce verso l'ancora con il `b` misurato della sua coppia
    # piattaforma-gioco (`engine/projection.py`, +4.7%/+11.7% cross-fit su 6 e 5 finestre). Dove non c'e'
    # nulla da leggere resta `est_fm`, e `pi_basis` dice sempre quale delle due ha parlato: `core`,
    # `abroad` o il gradino di `estimate`. `pi_matches` porta su quante partite, perche' dieci non sono
    # una stagione e la riga non deve lasciarlo credere.
    "pi_fm", "pi_basis", "pi_matches",
    # L'ALTRO ZERO, e sono due DOMANDE diverse invece che due risposte alla stessa (metrica §21).
    # `engine_surplus` conta dal marginale di ROSA - l'ottantesimo centrocampista di dieci squadre - che
    # è la risposta a «chi conviene comprare»; queste due contano dal rimpiazzo che ENTRA, il rango
    # `squadre x posti che il regolamento SCHIERA`, che è la risposta a «quanto costa una giornata
    # saltata». Sui primi 25 del foglio Serie A la differenza è P5 D1 C0 A19 contro P3 D5 C8 A9, con 13
    # nomi in comune: non un dettaglio. REPORTING - `engine_surplus` non si tocca perché è gated e dieci
    # finestre ci stanno sopra - e la colonna prezza tutta la lista, motore dove c'è e stima altrove.
    "desc_replacement_fielded", "desc_surplus_fielded",
    # LA COPPA CONTINENTALE IN MEZZO AL CAMPIONATO. Tre fatti e una misura: quando si gioca e chi è
    # qualificato sono DICHIARATI (`config/international_cups.json`, dal registro pubblico), la
    # nazionalità è un'IDENTITÀ (`players.nationality`, dai payload che già pagavamo), e quanto perde
    # uno di quel profilo è MISURATO - il difference-in-differences di `engine/cups.py` su quattro
    # finestre, che contiene già la probabilità di essere convocato. Quindi nessuna lista di convocati,
    # che ad agosto non esiste. REPORTING: `engine_pv_pred` non si muove di un decimale, e `desc_pv_cup`
    # gli sta accanto come «Margine» sta accanto a «Surplus».
    "desc_cup", "desc_cup_country", "desc_cup_capped", "desc_cup_rounds", "desc_cup_share",
    # QUALE POPOLAZIONE il coefficiente descrive (`regular` | `rotation` | `fringe`, dalla quota di
    # calendario che gli è prevista) e se la convocazione è un FATTO invece di una probabilità: con la
    # rosa del torneo pubblicata la penalità diventa il costo di andarci, 0,53 invece di 0,53 x P(va).
    "desc_cup_band", "desc_cup_confirmed",
    "desc_pv_cup", "desc_value_cup", "desc_surplus_cup", "desc_surplus_fielded_cup", "desc_cup_note",
    # IL SURPLUS IN CREDITI e la sua distanza dal prezzo del listone (`evaluate.market_rates` /
    # `market_surplus`, la stessa coppia che il pannello Tk chiama - qui non c'è una seconda aritmetica).
    # Erano dentro il pannello soltanto, quindi l'app non poteva confrontare l'FVM con niente: la
    # domanda «l'FVM va confrontata coi fantapunti o col surplus?» ha una risposta sola (il surplus, che
    # è quello che un credito compra), ed è questa colonna. REPORTING, come l'FVM su cui è tarata.
    "desc_spm", "desc_dvm",
    # a TRANSFER says he has left the club this row shows him at (see `departures`): reported, never applied
    "desc_left_for", "desc_left_on",
    # DOVE LA FONTE LO VEDE oggi, con il giorno della lettura: l'autorita' su chi e' in rosa (regola
    # dell'operatore del 17/08/2026). Non e' il club della RIGA - i numeri del motore sono calcolati su
    # quello del listone - ed e' per questo che sono due colonne e non una sostituzione.
    "desc_live_club", "desc_live_club_on",
    # descriptive, NOT gated
    "desc_form_club_matches", "desc_form_measured", "desc_form_played", "desc_form_unused",
    # ...and the split of `unused` the bench rows made measurable: NAMED and not used, against not in
    # the squad at all. Two different facts about an auction - the first says the coach had him and
    # chose somebody else.
    "desc_form_bench", "desc_form_out",
    "desc_form_unknown", "desc_form_starts",
    "desc_form_minutes", "desc_form_minutes_per_club_match", "desc_form_rating",
    "desc_form_goals_league", "desc_form_assists_league",
    "desc_form_goals_other", "desc_form_assists_other",
    "desc_form_competitions", "desc_form_clubs", "desc_form_last_match", "desc_form_source",
    "desc_form_series", "desc_form_detail",
    # THE TREND: the club's last ten CHAMPIONSHIP matches, and what he collected in them. A second
    # window on purpose (`club_form`), because the euro calendar skips 3-7 real rounds a season and a
    # man read on his euro fantamedia alone is read on 82% of his football. `desc_trend_fp` is the mean
    # fantapunti - a match not played counts zero, a match nobody can score is not in the denominator,
    # which `desc_trend_matches` states. DESCRIPTIVE and never predictive: measured the same day, the
    # departure from one's own averages does not predict the next rounds (excess +0.0167/+0.0072/-0.0007
    # at 2, 3 and 5 matchdays against the reshuffled null, sign changing).
    "desc_trend_fp", "desc_trend_matches", "desc_trend_window", "desc_trend_played",
    "desc_trend_starts", "desc_trend_bench", "desc_trend_minutes", "desc_trend_goals",
    "desc_trend_assists", "desc_trend_outside_euro", "desc_trend_detail",
    # WHO GAINED A PLACE DURING THE MEASURED SEASON AND WHO LOST ONE, with the department control that
    # makes it honest: a man who plays because the starter in front of him is broken has not won the
    # place, and he goes back when the other returns. Dated, because the ORDER between the day the place
    # changed and the day a spell opened is the whole measurement. `desc_place_cause` is the vocabulary
    # (front_injured | won_then_injury | won_it | own_injury | benched | out_of_squad) and
    # `desc_place_note` says it in words, including what could NOT be checked - suspensions.
    "desc_place_change", "desc_place_on", "desc_place_md", "desc_place_minutes", "desc_place_sample",
    "desc_place_cause", "desc_place_who", "desc_place_missed", "desc_place_note",
    # ...and the screen for the man SOLD as a starter who is being rotated, over his club's last five
    # rounds. CALIBRATED (84.5% of the flagged end under 60 minutes a club match against 34.9% of the
    # pool, 2.42x on 15,897 readings) and EMPTY on a pre-season sheet by construction: it reads rounds
    # that have to have been played first.
    "desc_rotation_watch", "desc_rotation_minutes", "desc_rotation_starts", "desc_rotation_from",
    "desc_rotation_to", "desc_rotation_window", "desc_rotation_note",
    # ...and the MIRROR of it: quoted as a reserve, playing like a starter. A weaker claim than the one
    # above (79.1% against a 40.9% base, where the rotation mark reads 90.4% against 59.5%), because
    # losing a place is more predictable than winning one.
    "desc_riser_watch", "desc_riser_minutes", "desc_riser_starts", "desc_riser_window",
    # ...and whether it is about a GOALKEEPER, because for him the same reading is a different
    # sentence (and the strongest one this screen has). The fact travels; the app writes the words.
    "desc_riser_keeper", "desc_riser_note",
    "desc_squad_club", "desc_squad_source", "desc_real_role",
    # The granular real role: where on the pitch he belongs, in the twelve-code vocabulary.
    "desc_real_roles", "desc_real_role_primary", "desc_real_role_line", "desc_real_role_depth",
    "desc_real_role_side", "desc_mantra_real", "desc_foot", "desc_height", "desc_weight",
    "desc_real_role_observed",
    "desc_preseason_starts", "desc_preseason_matches",
    "desc_avg_x", "desc_avg_y", "desc_side_measured",
    "desc_starter_prob", "desc_starter_status", "desc_expected_minutes",
    # Titolarità: how often he STARTS. Two horizons, because they answer different questions - the
    # season's share is the coach's habit over a year, the recent one is the shape of the side now.
    "desc_season_starts", "desc_season_matches", "desc_start_share",
    # ...and how much of that season was played at the club he is at NOW: the two halves of it, so that a
    # reader can see that Marin R.'s 21 starts are Villarreal's and not Napoli's. The half made elsewhere
    # is DISCOUNTED where a shirt is handed out, never dropped: `SnapshotView.LOAN_DISCOUNT`.
    "desc_season_starts_club", "desc_season_starts_elsewhere",
    "desc_minutes_club", "desc_minutes_elsewhere", "desc_at_club_before",
    "desc_elsewhere_matches", "desc_elsewhere_minutes", "desc_elsewhere_where",
    "desc_duel_rivals", "desc_duel_names",
    # WHO HE DOES NOT COEXIST WITH. Per team-mate he SHARED A SQUAD WITH, the share of the matches
    # both were available for in which both STARTED - kept only where it is low, because that is the
    # only side a rule can read (`COSTART_LOW` in the builder). Format: "name:share;name:share".
    # The denominator is the point: a pair that never shared a squad has co-started nothing, and
    # reading that as «they do not coexist» would say it of every summer signing - «vuoto = ignoto».
    "desc_costart_low",
    "desc_injury_matches_missed", "desc_injury_weighted", "desc_injury_spells",
    # What he missed INSIDE the measured season, which is the only one of the injury numbers that is a
    # fact about this sample rather than a forecast: `desc_season_starts` are the starts he made while
    # absent for these, so it is what a start rate has to leave out of its denominator.
    "desc_injury_missed_measured",
    # ...and the same in ROUNDS of his own championship, counted on his club's fixtures by date instead of
    # taken from a source that counts every competition. This is the unit the shares in this sheet are
    # expressed in; `desc_injury_rounds_seasons` = 0 means unknown, never zero. `..._by_season` is most
    # recent first, aligned with the recency weights and with an empty entry for a season we could not
    # count: the weights are PROVISIONAL, and a pre-weighted total would freeze them.
    "desc_injury_rounds_weighted", "desc_injury_rounds_by_season", "desc_injury_rounds_measured",
    "desc_injury_rounds_seasons", "desc_injury_days_since_return",
    "desc_injury_worst_kind", "desc_injury_open", "desc_injury_source",
    "desc_availability_now",
    "desc_goals_p90", "desc_assists_p90", "desc_xg_p90", "desc_xa_p90", "desc_minutes_full_season",
    "desc_penalty_rank", "desc_penalty_confidence", "desc_set_piece_duty",
    "desc_cards_per_match", "desc_yellows", "desc_reds",
    "desc_contract_until", "desc_exit_risk", "desc_arrival", "desc_arrival_tier",
    "desc_arrival_origin", "desc_arrival_origin_rounds", "desc_transfer_fee", "desc_seasons_at_club",
    "desc_new_coach", "desc_u22",
    # WHAT THE CLUB PUT INTO HIM: the fee, its share of everything the club spent that window, and his Qt.I
    # percentile within his role. Two channels because they catch different players - the fee catches a big
    # signing, the stature catches a celebrity who arrived for nothing (Modric and De Bruyne, free). Both
    # are PRE-auction facts and legal to read; wages, which would be the best measure, do not exist in any
    # whitelisted source. The weight they carry in the selection is a PARAMETER, off until the gate speaks.
    "desc_investment_fee", "desc_investment_fee_share", "desc_investment_stature",
    # ...e il valore di mercato AL GIORNO DELL'ASTA, con la BASE da cui viene («curve» = il punto della
    # curva a quella data, «season» = la fotografia della stagione di input): due letture della stessa
    # grandezza, e una riga che non dicesse quale userebbe si farebbe leggere come una sola.
    "desc_market_value", "desc_market_value_basis",
    "desc_investment_value_share", "desc_level_elo", "desc_career_fm",
    # THE CALENDAR STILL TO BE PLAYED, from `fixtures` (§23.4, frozen 05/08/2026 and calculable since
    # 10/08/2026). Two readings of one measurement because the COUNT saturates and the mean does not:
    # `desc_easy_matches` is «k/n (p%)» - the count first, since on eight matches a percentage moves in
    # steps of 12.5 - and `desc_calendar_margin` is the mean Elo advantage, which still separates the
    # clubs the count files as 0/38 (Cagliari -100 against Frosinone -157).
    # DISPLAY-ONLY, and the reason is a verdict and not caution: the club-strength family has been
    # refused by the gate three times, and letting it back in through the side door of a percentage
    # would be the same mistake under another name (§23.3). It is a CLUB fact on a player row, like
    # Pair: it cannot tell two team-mates apart, and it joins by `club_key`, never by name.
    "desc_easy_matches", "desc_calendar_margin",
    # HIS AGE in the target season, from `players.birth_year`. On the sheet because the panel builds its
    # `presence.Inputs` from these columns, and a parameter whose input never reaches the caller is
    # switched on and blind (the `level_z` lesson). Empty where no birth year is on file - unknown, not
    # young. DESCRIPTIVE: the physical profile is the operator's to read, and the one thing measured on
    # it is a THRESHOLD decline past 30 (`presence.age_lift`), not «age matters».
    "desc_age",
    # A THIRD class, and the prefix is the whole point: `actual_*` is measured strictly AFTER the auction
    # date. It exists because a BACK-DATED sheet does not need a forecast of who plays - the eleven that was
    # fielded that week exists, and a forecast is only interesting while the outcome is unknown. Reporting
    # only: no rule, no prediction and no `desc_*` column may read them, which is why they are not called
    # `desc_`. Empty by construction on a sheet built today (the next match has not been played).
    "actual_next_match", "actual_next_started", "actual_next_minutes",
)


# A club you can buy a squad from fields at least an eleven. The listone perimeter counts each
# club's quoted contingent because a stray pairing exists by construction: `rosters` keeps the LAST
# read, so a man the listone still quotes after his move abroad is filed at his NEW club, and that
# club would ride into the sheet on his single row. Measured on 2026-27 `default`: real contingents
# run 21-43, the stray (Gutierrez, filed at Bayer Leverkusen, still quoted 8.0) is 1.
PERIMETER_SQUAD_MIN = 11


def perimeter_clubs(conn, platform: str, seasons: tuple[str, ...]) -> set[str]:
    """The clubs THIS PLATFORM plays in the TARGET season: who you can actually buy from.

    The TARGET listone is the authority: it exists on auction day and it is the only source that
    knows a promotion before a ball is kicked. Read from ratings alone, the perimeter was one
    season stale on every preseason sheet - in August the target season has no ratings, so the
    2026-27 Serie A sheet kept the relegated clubs' unquoted squads (94 rows of Cremonese, Pisa
    and Verona) and silently dropped all 74 quoted players of Frosinone, Monza and Venezia
    (found 08/08/2026, comparing the boards with the press's typical formations). Ratings remain
    the fallback for a window whose listone `listone_quotes` does not cover.
    """
    target = max(seasons) if seasons else None
    quoted = {club for (club, contingent) in conn.execute(
        "SELECT c.canonical_name, COUNT(*) FROM listone_quotes q "
        "JOIN rosters r ON r.fc_id = q.fc_id AND r.season = q.season "
        "JOIN clubs c ON c.fc_club_id = r.fc_club_id "
        "WHERE q.platform = ? AND q.season = ? GROUP BY c.canonical_name",
        (platform, target)) if contingent >= PERIMETER_SQUAD_MIN}
    if quoted:
        return quoted
    placeholders = ",".join("?" * len(seasons)) or "NULL"
    return {team for (team,) in conn.execute(
        f"SELECT DISTINCT team FROM match_ratings WHERE platform = ? AND team IS NOT NULL "
        f"AND season IN ({placeholders})", (platform, *seasons))}


def _level_of_other_club(found, club_target: str | None, elo_names: dict[str, str]) -> float | None:
    """The Elo of the club his MINUTES were played at - only if it is not the club he is at now.

    The guard is the whole function. `level_gap` measures what a man gains or loses BY MOVING, and its
    population is transfers; a promoted club's squad has the same club it always had, so handing it a
    level gap penalises eleven men for a step none of them took. Measured 08/08/2026: without this,
    Frosinone went from MATCH to DIFF against the press and was drawn as a 3-3-1-3.
    """
    if not found:
        return None
    value, elo_name = found
    if club_target and elo_names.get(matching.club_identity(club_target)) == elo_name:
        return None
    return value


def _easy_label(answer: dict | None) -> str | None:
    """«k/n (p%)»: the COUNT first, because on eight matches a percentage moves in steps of 12.5 and
    saying «75%» hides how many matches it was computed on (§22.3)."""
    if not answer or not answer.get("n"):
        return None
    return f"{answer['easy']}/{answer['n']} ({answer['share']:.0%})"


def build_rows(conn, data: features.WindowData, predictions, layers: dict,
               perimeter: set[str] | None = None, window: features.Window | None = None,
               platform: str = "euro", event_scoring: dict | None = None) -> list[dict]:
    """One row per purchasable player, engine columns first, descriptive after.

    `perimeter` filters the OUTPUT, never the model population. The engine's standardisations are
    computed over the whole listone - that is the population its rules were fitted and validated on -
    so trimming before predicting would quietly give a player a different number here than in the gate.
    Trimming after keeps every figure identical and only stops the sheet from listing a Verona squad at
    a EuroLeghe auction, where nobody can buy it.
    """
    by_id = {p.obs.fc_id: p for p in predictions}
    # The fallback valuation's inputs, gathered once for the whole sheet (`estimation_layer`): every player
    # must end up with a surplus, and the ones the core cannot price need the other platform, an older
    # season and their club's own level to get one.
    window = window or data.window
    estimation = estimation_layer(conn, window, platform, data.observations)
    left = departures(conn, window, window.auction_date)
    provider_known = observed_players(conn)
    live_squad = complete_squads(live_squads(conn, window.auction_date),
                                 data.observations, provider_known)
    # What each club's Elo was, keyed CANONICALLY, for EVERY club ClubElo publishes and not only the ~97
    # a listone carries (`club_levels`). It exists for one row of the sheet - `desc_level_elo` for a man
    # with no previous roster - and that man is precisely the one whose club is likely to be outside our
    # perimeter: Alajbegovic's window was played at Red Bull Salzburg, which `club_elo` cannot hold at all
    # because its key is `fc_club_id`. «Ogni calciatore DEVE avere il suo club_elo corretto» - the
    # operator, 08/08/2026, and Salzburg is the case that proves the point.
    from euroleghe_ingest.modules import elo as elo_module

    club_level = elo_module.levels_at(conn, window.input_season.split("-")[0])
    # ...and the level of the club a man actually PLAYED his minutes for, which is the only source that
    # can answer for somebody who was never in a listone (see `elo.levels_by_minutes`): 91 of 158
    # arrivals had no level at all, and this recovers 49 of them.
    level_by_minutes = elo_module.levels_by_minutes(conn, window.input_season)
    # THE CALENDAR STILL TO BE PLAYED, per club, computed ONCE for the whole sheet: it is a club fact and
    # every player of a club carries the same one. The window is the auction date to the end - what is
    # LEFT is the question an auction asks - and the whole thing is empty by design until `fixtures` has
    # been ingested, which is a state the manifest declares rather than a zero the row invents.
    # Per (club, CHAMPIONSHIP), and the championship is not optional: without it the count mixes the
    # cups in and the denominator stops meaning anything - measured 10/08/2026, Serie A clubs read 39 and
    # 40 matches instead of 38 depending on how far they were still in the Coppa Italia. The window a
    # sheet asks about is the PLATFORM's own calendar (§21.5), which per club is his own league.
    calendar: dict[str, dict] = {}
    for club, league in {(matching.club_identity(obs.club_target), obs.league)
                         for obs in data.observations if obs.club_target and obs.league}:
        answer = fixtures.easy_matches(conn, window.target_season, club, league=league,
                                       since=window.auction_date)
        if answer["n"]:
            calendar[club] = answer
    # ...and which ClubElo club each of OUR clubs is, so the fallback can refuse a man whose minutes
    # were played at the club he is still at: a promoted squad did not step up by moving.
    elo_names = {matching.club_identity(key): name for key, name in conn.execute(
        "SELECT club_key, elo_name FROM club_levels WHERE year = ?",
        (window.input_season.split("-")[0],))}
    # The rank belongs to the SLOT the row's surplus is measured against, not to the listone role: on a
    # mantra sheet those are two different populations (a 'w;a' forward competes with wingers, not with
    # every 'A'), and ranking inside the classic role printed a position that was in no list the panel
    # shows. One definition, read by both - see `auction_slot`.
    levels = {obs.fc_id: auction_level(obs, data) for obs in data.observations}
    slots = {fc_id: slot for fc_id, (slot, _level) in levels.items()}
    # ...e lo stesso, contato sui posti che un undici SCHIERA (`features.fielded_places`): il rimpiazzo
    # che ENTRA, letto sullo SLOT che la riga già dichiara (`slot=`), così le due colonne differiscono
    # per la profondità e per nient'altro. Vuoto quando il chiamante non ha passato il regolamento -
    # allora le due colonne `desc_*_fielded` restano vuote, che è la risposta onesta e non uno zero.
    fielded_levels = ({obs.fc_id: auction_level(obs, data, data.replacement_fielded,
                                                slot=slots.get(obs.fc_id))
                       for obs in data.observations} if data.replacement_fielded else {})
    # L'EQUIVALENTE SINTETICO delle partite che ognuno ha giocato altrove, una volta per foglio e non per
    # riga: e' una query sola sul layer per-partita. Serve al ramo `abroad` di Fpi, che e' la ragione per
    # cui un nuovo arrivo smette di essere «un attaccante della Juve» e diventa le sue trenta partite.
    # I termini PIATTI del punteggio (gol, assist, cartellini), non il dizionario per lega: e' quello che
    # `foreign_fm_equivalent` legge, ed e' lo stesso che usa `arrivals.enrich`.
    equivalents = (arrivals.foreign_fm_equivalent(conn, event_scoring, window.input_season)
                   if conn is not None and event_scoring else {})
    ranks: dict[int, int] = {}
    for role in {slot for slot in slots.values() if slot}:
        ranked = sorted(
            (p for p in predictions
             if slots.get(p.obs.fc_id) == role and p.value_pred is not None),
            key=lambda p: (-(_surplus(p, data) or 0.0), p.obs.fc_id))
        for index, prediction in enumerate(ranked, start=1):
            ranks[prediction.obs.fc_id] = index

    rows: list[dict] = []
    for obs in data.observations:
        if perimeter is not None and (obs.club_target or "") not in perimeter:
            continue
        prediction = by_id.get(obs.fc_id)
        form = layers["form"].get(obs.fc_id, {})
        place = layers["place"].get(obs.fc_id, {})
        rotation = layers["rotation"].get(obs.fc_id, {})
        riser = layers["riser"].get(obs.fc_id, {})
        injury = layers["injuries"].get(obs.fc_id, {})
        starter = layers["starters"].get(obs.fc_id, {})
        duel = layers["duels"].get(obs.fc_id, {})
        prop = layers["propensity"].get(obs.fc_id, {})
        season_play = layers["titolarita"].get(obs.fc_id, {})
        at_club = layers["at_club"].get(obs.fc_id, {})
        card = layers["discipline"].get(obs.fc_id, {})
        state = layers["contract"].get(obs.fc_id, {})
        role_detail = layers["real_role_detail"].get(obs.fc_id, {})
        recent = layers["elsewhere"].get(obs.fc_id, {})
        penalty = layers["penalties"].get(obs.fc_id)
        fielded = layers["fielded_next"].get(obs.fc_id, {})
        spend = layers["investment"].get(obs.fc_id, {})
        pv_pred = prediction.pv_pred if prediction else None
        guess = estimate_for(obs, prediction, estimation, data.anchors, data, window,
                             platform)
        gone_to, gone_on = left_his_club(obs, left.get(obs.fc_id), live_squad, provider_known)
        # The SAME level the gated surplus is measured against: the estimate's whole point is that one
        # column ranks the sheet, so a fallback row priced off another floor - or off none - would not
        # compare. That is not hypothetical: unlevelled estimates were 11 of the top 12 rows.
        slot, replacement = levels.get(obs.fc_id, (None, None))
        guess_surplus = est.surplus(guess.fm, guess.pv, replacement, guess.confidence)
        # Fpi: il valore di una sua partita dal calcio che ha davvero giocato. Il core quando c'e', poi
        # l'equivalente sintetico delle sue partite all'estero regredito verso l'ancora, poi la stima.
        # I portieri non passano dal ramo estero e la funzione lo sa (misurato -0.9%: il loro fantavoto e'
        # dominato dai gol subiti, che quell'equivalente non ha).
        pi_fm, pi_basis, pi_matches = guess.fm, guess.basis, None
        if prediction is not None and prediction.fm_pred is not None:
            pi_fm, pi_basis = prediction.fm_pred, "core"
        else:
            equivalent, matches = equivalents.get(obs.fc_id, (None, 0))
            # L'ANCORA E' QUELLA DELLA CASCATA, non `prediction.anchor`: per un uomo che il core non
            # prezza quella previsione spesso non esiste affatto, e passandola si spegneva il ramo
            # proprio sui nomi per cui e' stato costruito (Ramos leggeva `anchor` con trenta partite di
            # Ligue 1 sul groppone). Stessa riga di `_rung_for`, cosi' le due non possono divergere.
            role = obs.role_classic or ""
            anchor = est.club_anchor(
                data.anchors.get(role) or (prediction.anchor if prediction else None) or 6.0,
                *(estimation.get("club_level", {}).get((obs.club_target or "", role)) or (None, 0)))
            from_abroad = projection.fm_from_abroad(
                equivalent, matches, anchor, platform, data.game, obs.role_classic)
            if from_abroad is not None:
                pi_fm, pi_basis, pi_matches = from_abroad[0], "abroad", from_abroad[2]
        # L'ALTRO ZERO, sulla riga: il rimpiazzo che entra e il surplus misurato su di lui. Una colonna
        # sola per tutta la lista, quindi chi il motore non prezza la riceve dalla STIMA con la stessa
        # penale del suo `est_surplus` - ordinare per questa colonna deve poter ordinare l'intero foglio,
        # o si torna al difetto delle due liste (§7-undecies del gate).
        # LA COPPA: le presenze attese al netto del torneo che lo porta via, e il valore che ne segue.
        # Il pv del MOTORE quando c'è e quello della STIMA altrimenti, per la ragione di sempre - una
        # colonna deve poter ordinare tutta la lista - e la fantamedia che lo moltiplica è quella della
        # stessa fonte, o il valore mescolerebbe due modelli. La sottrazione è tappata dalla quota di
        # calendario che gli è prevista (`cups.adjusted_pv`): un riservista non può perdere più giornate
        # di quante ne avrebbe giocate.
        cup = layers["cups"].get(obs.fc_id, {})
        cup_fm = prediction.fm_pred if prediction and prediction.fm_pred is not None else guess.fm
        cup_pv_base = pv_pred if pv_pred is not None else guess.pv
        # LA BANDA si decide QUI, dove le presenze davvero usate sono note: il layer non poteva, perché
        # la STIMA di chi il motore non prezza nasce due passi più tardi - e senza questo un uomo da
        # undici giornate su trentotto pagava il coefficiente dei titolari (2,4 giornate invece di 0,6).
        cup_exposures = engine_cups.with_band(
            cup.get("exposures") or (),
            cup_pv_base / data.matchdays_target
            if cup_pv_base is not None and data.matchdays_target else None)
        cup_pv = engine_cups.adjusted_pv(cup_pv_base, cup_exposures, data.matchdays_target)
        cup_value = cup_fm * cup_pv if cup and cup_fm is not None and cup_pv is not None else None
        _fielded_slot, fielded_level = fielded_levels.get(obs.fc_id, (None, None))
        # ...e i DUE surplus rifatti sulle stesse presenze, perché la coppa toglie giornate e un surplus è
        # `(fm - rimpiazzo) x giornate`: senza questi, ordinare per surplus a un tavolo di gennaio conta
        # le giornate di chi non c'è. Stessa aritmetica dei due gated, stesso slot e stessi due livelli -
        # cambia solo il moltiplicatore, che è esattamente il punto.
        def _over(level):
            if not cup or cup_fm is None or cup_pv is None or level is None:
                return None
            # ...e con la STESSA PENALE DI CONFIDENZA dei due gated quando la base è la stima, o la
            # colonna accanto direbbe il contrario di quello che descrive: misurato su Jasim, il surplus
            # «al netto della coppa» risultava 9,6 contro i 5,1 della colonna gated - cioè la coppa
            # sembrava PAGARE, e la differenza non era la coppa, era la penale che io non applicavo.
            if prediction is None or prediction.fm_pred is None or pv_pred is None:
                return est.surplus(cup_fm, cup_pv, level, guess.confidence)
            return (cup_fm - level) * cup_pv
        cup_surplus, cup_surplus_fielded = _over(replacement), _over(fielded_level)
        fielded_surplus = _surplus_over(prediction, fielded_level)
        if fielded_surplus is None and fielded_level is not None:
            # Il motore non l'ha prezzato - la riga esiste comunque, con `fm_pred` vuota - quindi vale la
            # stima, con la stessa penale del suo `est_surplus`. Il test è sul NUMERO e non sull'oggetto:
            # una `prediction` esiste anche per chi il core rifiuta di prezzare.
            fielded_surplus = est.surplus(guess.fm, guess.pv, fielded_level, guess.confidence)
        rows.append({
            "fc_id": obs.fc_id, "name": obs.name, "club": obs.club_target, "league": obs.league,
            "role_classic": obs.role_classic, "roles_mantra": ";".join(obs.roles_mantra),
            "price_initial": obs.price_initial, "price_initial_mantra": obs.price_initial_mantra,
            "fvm_reporting_only": obs.fvm,
            "engine_fm_pred": _round(prediction.fm_pred if prediction else None, 3),
            "engine_pv_pred": _round(pv_pred, 1),
            "engine_value": _round(_value(prediction), 1),
            "engine_surplus": _round(_surplus(prediction, data), 1),
            "engine_role_rank": ranks.get(obs.fc_id),
            # WHICH slot the two numbers above belong to. Identical to `role_classic` on a classic
            # sheet; on mantra it is the one of his codes with the lowest replacement level, and
            # without it `engine_replacement_fm` is a number the row cannot explain.
            "engine_role_slot": slot,
            "engine_replacement_fm": _round(replacement, 3),
            "engine_anchor": _round(prediction.anchor if prediction else None, 3),
            # WHY this row has no valuation, per player. The note at the end says it for the sheet, and it
            # could only say ONE thing, while the cell hides three different ones: measured here and too
            # little of it (Boga 13 votes of 15, Pavard 1), or nothing measured on THIS platform at all
            # because his season was played on the other calendar (Kolo Muani 23 euro votes and no Serie A,
            # Stones 3). An empty cell is a statement; this is which statement.
            "engine_unpriced_reason": _unpriced_reason(prediction, obs),
            "est_fm": _round(guess.fm, 3),
            "est_mv": _round(guess.mv, 3),
            "est_pv": _round(guess.pv, 1),
            "est_surplus": _round(guess_surplus, 1),
            "est_basis": guess.basis,
            "est_confidence": _round(guess.confidence, 2),
            "est_note": guess.note,
            "pi_fm": _round(pi_fm, 3),
            "pi_basis": pi_basis,
            "pi_matches": pi_matches,
            # L'ALTRO ZERO: il rimpiazzo che ENTRA (rango `squadre x posti schierati`) e il surplus
            # misurato su di lui. Stesso slot e stessa aritmetica di `engine_surplus`, cambia solo la
            # profondità - vedi `features.fielded_places`.
            "desc_replacement_fielded": _round(fielded_level, 3),
            "desc_surplus_fielded": _round(fielded_surplus, 1),
            # LA COPPA CONTINENTALE che cade dentro il campionato. Vuote per chiunque nessun torneo
            # dichiarato tocchi - che nel 2026-27 è tutto il continente africano, perché la CAN è
            # estiva - e vuote anche per chi non ha nazionalità sul file: «vuoto = ignoto».
            "desc_cup": cup.get("name"),
            "desc_cup_country": cup.get("country"),
            "desc_cup_capped": ("yes" if cup["capped"] else "no") if cup else None,
            "desc_cup_rounds": cup.get("rounds"),
            # Lo share e la nota vengono dall'esposizione RI-BANDATA, non da quella del layer: la riga
            # deve poter spiegare la sottrazione che porta accanto, e due numeri diversi sotto lo stesso
            # nome sono il difetto che questo progetto ha già pagato.
            "desc_cup_share": _round(cup_exposures[0].share_lost if cup_exposures else None, 2),
            "desc_cup_band": cup_exposures[0].band if cup_exposures else None,
            "desc_cup_confirmed": (("yes" if cup_exposures[0].confirmed else "no")
                                   if cup_exposures else None),
            "desc_pv_cup": _round(cup_pv, 1) if cup else None,
            "desc_value_cup": _round(cup_value, 1),
            "desc_surplus_cup": _round(cup_surplus, 1),
            "desc_surplus_fielded_cup": _round(cup_surplus_fielded, 1),
            "desc_cup_note": " · ".join(one.note() for one in cup_exposures) or None,
            # A transfer dated in this window took him somewhere else, and no arrival brought him back:
            # the listone and the squad pages can be weeks behind in August, and this is the one source
            # that carries the event (`left_his_club` - an OUT alone is not a departure).
            "desc_left_for": gone_to,
            "desc_left_on": gone_on,
            "desc_form_club_matches": form.get("club_matches"),
            "desc_form_measured": form.get("measured"),
            "desc_form_played": form.get("played"), "desc_form_unused": form.get("unused"),
            "desc_form_bench": form.get("bench"), "desc_form_out": form.get("out"),
            "desc_form_unknown": form.get("unknown"),
            "desc_form_starts": form.get("starts"), "desc_form_minutes": form.get("minutes"),
            "desc_form_minutes_per_club_match": form.get("minutes_per_club_match"),
            "desc_form_rating": form.get("rating"),
            "desc_form_goals_league": form.get("goals_league"),
            "desc_form_assists_league": form.get("assists_league"),
            "desc_form_goals_other": form.get("goals_other"),
            "desc_form_assists_other": form.get("assists_other"),
            "desc_form_competitions": form.get("competitions"),
            "desc_form_clubs": form.get("clubs"), "desc_form_last_match": form.get("last_match"),
            "desc_form_source": form.get("source"),
            "desc_form_series": form.get("series"),
            "desc_form_detail": form.get("detail"),
            "desc_trend_fp": form.get("trend_fp"),
            "desc_trend_matches": form.get("trend_matches"),
            "desc_trend_window": form.get("trend_window"),
            "desc_trend_played": form.get("trend_played"),
            "desc_trend_starts": form.get("trend_starts"),
            "desc_trend_bench": form.get("trend_bench"),
            "desc_trend_minutes": form.get("trend_minutes"),
            "desc_trend_goals": form.get("trend_goals"),
            "desc_trend_assists": form.get("trend_assists"),
            "desc_trend_outside_euro": form.get("trend_outside_euro"),
            "desc_trend_detail": form.get("trend_detail"),
            "desc_place_change": place.get("change"),
            "desc_place_on": place.get("on"),
            "desc_place_md": place.get("md"),
            "desc_place_minutes": place.get("minutes"),
            "desc_place_sample": place.get("sample"),
            "desc_place_cause": place.get("cause"),
            "desc_place_who": place.get("who"),
            "desc_place_missed": place.get("missed"),
            "desc_place_note": place.get("note"),
            # `watch` from the fourth round (as strong as the fifth), `early` from the second - two
            # different sentences, because at two rounds one name in four or five is wrong.
            "desc_rotation_watch": rotation.get("strength"),
            "desc_rotation_minutes": rotation.get("minutes"),
            "desc_rotation_starts": rotation.get("starts"),
            "desc_rotation_from": rotation.get("from"),
            "desc_rotation_to": rotation.get("to"),
            "desc_rotation_window": rotation.get("window"),
            "desc_rotation_note": rotation.get("note"),
            "desc_riser_watch": "yes" if riser else None,
            "desc_riser_minutes": riser.get("minutes"),
            "desc_riser_starts": riser.get("starts"),
            "desc_riser_window": riser.get("window"),
            "desc_riser_keeper": "yes" if riser.get("keeper") else None,
            "desc_riser_note": riser.get("note"),
            "desc_squad_club": layers["squads"].get(obs.fc_id),
            "desc_squad_source": layers["squad_sources"].get(obs.fc_id),
            # The role he was REALLY used in, from the provider's own slot per match (positions.
            # derived_role). It answers a different question from the listone's: the listone says what
            # you buy him as, this says where the coach actually put him.
            "desc_real_role": layers["real_roles"].get(obs.fc_id),
            # And WHERE inside that line: the provider's own granular position, one to three of the
            # twelve codes, ordered with the most representative first. This is the only column that
            # tells a left back from a centre back - `role_classic` calls both 'D' and
            # `desc_real_role` calls both 'D' too. `depth`/`side` are where to DRAW him (0 = own goal
            # to 1 = the opponent's; -1 the team's left to +1 its right), so every reader places him
            # the same way. Observed on a DATE and not derivable for any other: see the manifest.
            "desc_real_roles": role_detail.get("roles"),
            "desc_real_role_primary": role_detail.get("primary"),
            "desc_real_role_line": role_detail.get("line"),
            "desc_real_role_depth": role_detail.get("depth"),
            "desc_real_role_side": role_detail.get("side"),
            # What a MANTRA auction would call him, derived from the same codes: Mantra simplifies
            # (ML/MR both 'e', LW/RW both 'w' - it does not name the flank), AM is 't' or 'a' by the
            # provider's own line, and 'b' (braccetto) comes from the code COMBINATION, a flank
            # defender who also plays DC. It never replaces `roles_mantra`, which is what the listone
            # sells him as: this column exists for the July case, where no listone row exists at all.
            "desc_mantra_real": role_detail.get("mantra"),
            "desc_foot": role_detail.get("foot"),
            # The physical profile, from the same provider payload as the codes. It is what separates a
            # punta centrale who plays as a TORRE from one who plays on the move - `ST` says neither - and
            # it is DESCRIPTIVE: measured, the more used of a club's two strikers is the taller one 44
            # times out of 92 (48%), so it decides nothing about who plays (gate §5-terdecies).
            "desc_height": role_detail.get("height"),
            "desc_weight": role_detail.get("weight"),
            "desc_real_role_observed": role_detail.get("observed"),
            # The TARGET season's PRE-SEASON, under the coach who is there now: started X of Y friendlies.
            # A reading for whoever is bidding and nothing else - `preseason_starts` carries the five
            # measured reasons why it cannot be a criterion (one pre-season only, so no out-of-sample test;
            # 1-3 matches; two of seven new-coach clubs with none; no minutes; and fixtures against a U23
            # side, where a starting eleven is not a competitive statement).
            "desc_preseason_starts": layers["preseason"].get(obs.fc_id, (None, None))[0],
            "desc_preseason_matches": layers["preseason"].get(obs.fc_id, (None, None))[1],
            "desc_avg_x": layers["positions"].get(obs.fc_id, (None, None))[0],
            "desc_avg_y": layers["positions"].get(obs.fc_id, (None, None))[1],
            "desc_side_measured": layers["sides"].get(obs.fc_id),
            "desc_starter_prob": starter.get("probability"),
            "desc_starter_status": starter.get("status"),
            # Expected minutes = minutes per CLUB match recently x the appearances the engine
            # predicts. The recent share is what carries bench time; the season-long one is the
            # fallback for a player whose club we have no recent matches for.
            "desc_expected_minutes": _round(_expected_minutes(obs, form, pv_pred), 0),
            "desc_season_starts": season_play.get("starts"),
            "desc_season_matches": season_play.get("matches"),
            "desc_start_share": season_play.get("share"),
            # Whose season it was. Empty for a player the per-match layer has no row for: unknown, and
            # an unknown split must not discount him.
            "desc_season_starts_club": at_club.get("starts"),
            "desc_season_starts_elsewhere": at_club.get("starts_elsewhere"),
            "desc_minutes_club": at_club.get("minutes"),
            "desc_minutes_elsewhere": at_club.get("minutes_elsewhere"),
            # The last season THIS club's listone already had him. Empty = it never did, so it has not
            # judged him: what a season measured elsewhere is worth toward the shirt depends on it.
            "desc_at_club_before": layers["was_here"].get(obs.fc_id),
            # THE WINDOW MEASURED ELSEWHERE, for a man with no season here at all: it is the engine's own
            # R13 sample (`features._recent_form`, adopted on Serie A), written into the sheet so the board
            # can stand on the same fact - a standing of zero for a man the engine predicts will play is the
            # panel disagreeing with the engine about the same player. The competition travels with it,
            # because ten matches somewhere are not a season here and the plate has to say where.
            "desc_elsewhere_matches": (recent.get("matches") or None) if recent else None,
            "desc_elsewhere_minutes": (recent.get("minutes") or None) if recent else None,
            "desc_elsewhere_where": recent.get("where") if recent else None,
            "desc_duel_rivals": duel.get("rivals"), "desc_duel_names": duel.get("names"),
            "desc_costart_low": (layers.get("costarts") or {}).get(obs.fc_id),
            "desc_injury_matches_missed": injury.get("matches_missed"),
            "desc_injury_weighted": injury.get("weighted"),
            "desc_injury_missed_measured": injury.get("missed_measured"),
            "desc_injury_rounds_weighted": injury.get("rounds_weighted"),
            "desc_injury_rounds_by_season": injury.get("rounds_by_season"),
            "desc_injury_rounds_measured": injury.get("rounds_measured"),
            "desc_injury_rounds_seasons": injury.get("rounds_seasons"),
            # Da quanti giorni e' rientrato dall'ultimo stop che gli e' costato una giornata. Vuoto =
            # non ne ha avuti o non lo sappiamo, mai zero.
            "desc_injury_days_since_return": injury.get("days_since_return"),
            "desc_injury_spells": injury.get("spells"),
            "desc_injury_worst_kind": injury.get("worst_kind"),
            "desc_injury_open": injury.get("open"),
            "desc_injury_source": injury.get("source", "no Transfermarkt id: unknown, not zero"),
            "desc_availability_now": layers["availability"].get(obs.fc_id),
            "desc_goals_p90": prop.get("goals_p90"), "desc_assists_p90": prop.get("assists_p90"),
            "desc_xg_p90": prop.get("xg_p90"), "desc_xa_p90": prop.get("xa_p90"),
            "desc_minutes_full_season": prop.get("minutes"),
            "desc_penalty_rank": penalty[0] if penalty else None,
            "desc_penalty_confidence": penalty[1] if penalty else None,
            "desc_set_piece_duty": "not available (assists_set_piece is NULL at the source)",
            "desc_cards_per_match": card.get("per_match"), "desc_yellows": card.get("yellows"),
            "desc_reds": card.get("reds"),
            "desc_contract_until": state.get("contract_until"),
            "desc_exit_risk": "yes" if state.get("exit_risk") else None,
            "desc_arrival": state.get("arrival"), "desc_arrival_tier": state.get("tier"),
            "desc_arrival_origin": state.get("origin"), "desc_transfer_fee": state.get("fee"),
            # ...and the CALENDAR that championship played, which is the denominator his measured season
            # has to be read against (`presence_inputs`). Empty for a man with no arrival on file, which
            # is the incumbent's own calendar and not a missing number.
            "desc_arrival_origin_rounds": (layers.get("league_rounds") or {}).get(state.get("origin")),
            "desc_seasons_at_club": state.get("seasons_at_club"),
            "desc_new_coach": "yes" if state.get("new_coach") else None,
            "desc_u22": "yes" if state.get("u22_trigger") else None,
            "desc_investment_fee": spend.get("fee"),
            "desc_investment_fee_share": spend.get("fee_share"),
            # The MARKET VALUE of the input season, and his share of his squad's: the third channel of the
            # investment hypothesis, and the only one that exists for a man who arrived free.
            "desc_market_value": spend.get("value"),
            "desc_market_value_basis": spend.get("value_basis"),
            "desc_investment_value_share": spend.get("value_share"),
            # THE LEVEL of the football behind his minutes: the Elo of the club he played them for, and only
            # for a man who CHANGED club - the population `presence.level_lift` was measured on. Without this
            # column the adopted channel is switched on and blind: the panel builds its `Inputs` from the
            # sheet, so a parameter whose input never reaches the row does nothing at all.
            # ...and for a man with NO previous roster, the club of his measured WINDOW - which is the same
            # question asked of the only football he has played. Alajbegovic had never been in a listone, so
            # he carried no level at all while his ten matches were Bayer Leverkusen's (1836.6, above
            # Juventus's own 1819.4). It is the origin level for an arrival either way; what changes is how
            # much football is behind it, and the shrinkage already says that.
            # THE LEVEL of the football behind his minutes, in three steps and the order is the
            # evidence's own: the club he LEFT where the roster knows it, then the club of his measured
            # WINDOW (the Alajbegovic case), then the club his season AGGREGATE says he played for -
            # which is what reaches a man who was never in a listone at all, and whose window was never
            # fetched. Empty only where none of the three can name a club with a level: «vuoto = ignoto».
            "desc_level_elo": (obs.elo_prev if obs.club_change else
                               (club_level.get(matching.club_identity(recent.get("club")))
                                if recent.get("club") else None)
                               or _level_of_other_club(level_by_minutes.get(obs.fc_id),
                                                       obs.club_target, elo_names)),
            # What he had shown BEFORE last season - the career channel's input, forwards only because
            # that is the population it was measured on (`presence.career_lift`).
            "desc_career_fm": (obs.fm_career if obs.role_classic == "A" else None),
            # How many EASY matches his club has left, and by how much on average. The count carries its
            # own denominator because a percentage without it is not a fact, and both are empty rather
            # than zero where the calendar or an opponent's level is missing.
            "desc_easy_matches": _easy_label(calendar.get(matching.club_identity(obs.club_target or ""))),
            "desc_calendar_margin": _round(
                (calendar.get(matching.club_identity(obs.club_target or "")) or {}).get("margin"), 1),
            "desc_age": obs.age(window),
            "desc_investment_stature": spend.get("stature"),
            # AFTER the auction date, reporting only (see PLAYER_COLUMNS): what really happened in the
            # club's first match of the week that followed.
            "actual_next_match": fielded.get("match"),
            "actual_next_started": fielded.get("started"),
            "actual_next_minutes": fielded.get("minutes"),
        })
    rows.sort(key=lambda row: (row["role_classic"] or "Z", -(row["engine_surplus"] or -1e9)))
    return rows


def _market_money(rows: list[dict], setup: dict) -> None:
    """Scrive `desc_spm` e `desc_dvm` su ogni riga: il surplus in crediti, e quanto dista dall'FVM.

    PERCHÉ QUI. L'FVM è un PREZZO con un monte crediti noto, e quello che un credito compra è il margine
    sopra chi giocherebbe al posto suo - cioè il SURPLUS, non i fantapunti, che contano da zero e da zero
    nessuno paga. La conversione è quindi un problema di budget e non una scala da scegliere
    (`metrica-asta-surplus-v1.md` §14). Viveva solo nel pannello Tk; il foglio la porta perché l'app legge
    il foglio e non ricalcola una definizione misurata.

    IL SURPLUS È QUELLO CHE LA RIGA MOSTRA - il motore dove c'è, la stima altrove - perché è la lista che
    l'operatore guarda davvero e gli stimati stanno nel fit per decisione misurata (§14.3: toglierli muove
    i tassi di ≤5% su Serie A e di zero su euro). Chi non ha nemmeno una stima non entra e non riceve
    niente: «vuoto = ignoto».

    Nessuna aritmetica nuova: le due funzioni sono quelle del pannello, chiamate su righe-ponte che
    portano i nomi che si aspettano (`fvm` qui si chiama `fvm_reporting_only`).
    """
    teams = setup.get("teams") or 0
    roster = {role: teams * slots
              for role, slots in (setup.get("squad_slots") or {}).items()} if teams else None
    bridge = [{
        "role_classic": row.get("role_classic"),
        "fvm": row.get("fvm_reporting_only"),
        "surplus_shown": row.get("engine_surplus") if row.get("engine_surplus") is not None
        else row.get("est_surplus"),
    } for row in rows]
    rates = evaluate.market_rates(bridge, key="surplus_shown", roster=roster)
    evaluate.market_surplus(bridge, rates, key="surplus_shown")
    for row, one in zip(rows, bridge, strict=True):
        row["desc_spm"] = one["spm"]
        row["desc_dvm"] = one["dvm"]


def _expected_minutes(obs, form: dict, pv_pred) -> float | None:
    """Minutes per appearance x the appearances the engine predicts.

    The recent share is preferred because it carries bench time - but only when he actually played in
    the sample. A keeper who sat out his club's last ten has a recent share of zero, and answering
    "0 minutes" for a man the engine expects to play twenty games is worse than answering with his
    season-long share, which is what the fallback is for.
    """
    if not pv_pred:
        return None
    share = form.get("minutes_per_club_match") if form.get("played") else None
    if share is None and obs.minutes_prev and obs.matches_prev:
        share = obs.minutes_prev / obs.matches_prev
    return share * pv_pred if share is not None else None


def _round(value, digits=3):
    return None if value is None else round(value, digits)


def _value(prediction) -> float | None:
    if not prediction or prediction.fm_pred is None or prediction.pv_pred is None:
        return None
    return prediction.fm_pred * prediction.pv_pred


def auction_level(obs, data: features.WindowData, levels: Mapping[str, float] | None = None, *,
                  slot: str | None = None) -> tuple[str | None, float | None]:
    """(the slot this row's SURPLUS is measured against, its replacement level).

    The levels come out of `features.replacement_levels` keyed on the roles the GAME is played with:
    'P'/'D'/'C'/'A' on classic, the twelve codes on mantra. Asking for them with `role_classic` on a
    mantra sheet matched nothing at all, so every reader took the documented "no level, fall back to
    VALUE" branch - which is the bug this function exists to make impossible to write again.

    Three cases, and the third is the one that bites:

    * classic - one role per player, and the two vocabularies are the same one.
    * mantra, codes known - each code has its own level ('por' 4.33 against 'pc' 7.19 on the 2026-27
      euro window), so the row picks the slot he is worth MOST in: the lowest level among his own
      codes, because that is the slot an auction fields him in. `evaluate.auction_view` still ranks
      him in every list he belongs to against that list's own floor; this is the same arithmetic
      collapsed to the row's single answer, and `engine_role_slot` names it so the two cannot be read
      as disagreeing.
    * mantra, NO code - a man the listone does not carry has no mantra role, because that is where the
      codes come from. Leaving him without a floor is not neutral: his `est_surplus` stays a VALUE
      while every row around it is a surplus, and on the 2026-27 euro sheet that put 11 estimated men
      in the top 12. He gets his classic group's MEAN level - we do not know which of its slots he
      would take, and that is a different statement from the case above, where he picks his best.
      His `engine_role_slot` is the listone role, next to an empty `roles_mantra`, so nobody reads a
      code that was never observed.

    A level of None is still possible and still means VALUE: the gate prepares its windows without a
    league on purpose, so `data.replacement` is empty and every published number stays what it was.

    `levels` says WHICH zero to read, and it is one line rather than a second function: the sheet also
    carries the replacement counted on the places an eleven FIELDS (`features.fielded_places`), which is
    the same question asked at another depth - «quanto costa una giornata saltata» instead of «chi
    conviene comprare» (metrica-asta-surplus-v1.md §21). Two cascades would eventually disagree about
    which slot a man belongs to, which is exactly the defect this function was written to make
    impossible.

    ...and `slot` is what keeps them from disagreeing, MEASURED and not feared: asked to choose freely,
    the deeper zero moves every `dd`/`ds` of both mantra sheets into the `dc` list, because at that
    depth the centre-backs' floor is the lowest of the three. The row would then show one slot and a
    level belonging to another - a number the row cannot explain, which is this function's own sin.
    So the slot is decided ONCE, on the sheet's own zero, and the second column prices that same slot:
    the two differ by the DEPTH and by nothing else, which is the only way their difference is readable.
    """
    levels = data.replacement if levels is None else levels
    if slot is not None:
        # The slot is already decided. Three shapes and the same three answers as below: a role this map
        # prices, a CLASSIC group (the man with no mantra code, levelled on his group's mean), or a code
        # this map does not carry - and then no level, never a fabricated one.
        if slot in levels:
            return slot, levels[slot]
        group = [levels[role] for role in MANTRA_BY_CLASSIC.get(slot, ()) if role in levels]
        return slot, (sum(group) / len(group) if group else None)
    if data.game != "mantra":
        role = obs.role_classic or None
        return role, levels.get(role or "")
    priced = [role for role in obs.roles_mantra if role in levels]
    if priced:
        best = min(priced, key=lambda role: levels[role])
        return best, levels[best]
    if obs.roles_mantra:
        return obs.roles_mantra[0], None
    group = [levels[role]
             for role in MANTRA_BY_CLASSIC.get(obs.role_classic or "", ())
             if role in levels]
    if group:
        return obs.role_classic, sum(group) / len(group)
    return obs.role_classic or None, None


def _surplus(prediction, data: features.WindowData) -> float | None:
    """(FM - the slot's replacement level) x appearances. Falls back to VALUE without a level.

    THE SHEET'S SURPLUS IS THE UNWEIGHTED EXPECTATION, and that is a decision rather than an omission
    (operator, 17/08/2026). The league declares a `reliability_exponent` and the Auction TAB applies it
    to its own ranking - «quello che incassi non sono le sue presenze, sono quelle che potevi vedere
    arrivare» - but the weight belongs to whoever ranks and not to the column, which is the position
    `estimate.surplus` had already written down. Both go through `model.surplus_of` now, with the
    exponent as an explicit argument, so the two can no longer drift under one name: they used to, and
    it cost 2-3 names of every top 25 (rho 0.989-0.998 over the three sheets).
    """
    if not prediction:
        return None
    _slot, level = auction_level(prediction.obs, data)
    return model.surplus_of(prediction.fm_pred, prediction.pv_pred, level)


def _surplus_over(prediction, level: float | None) -> float | None:
    """The same arithmetic over a level GIVEN, and empty without one.

    No VALUE fallback here, and that is the difference from `_surplus`: the gated column has to price
    every row it can, while the second zero is reporting - where the rulebook cannot say how deep the
    league fields, the cell is empty and says nothing, «vuoto = ignoto». A fallback would put a value
    among surpluses, which is the defect that once made 11 of a sheet's top 12 rows estimates.
    """
    if not prediction or level is None:
        return None
    return model.surplus_of(prediction.fm_pred, prediction.pv_pred, level)


def _write_csv(path: Path, columns, rows) -> None:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=list(columns), extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(buffer.getvalue(), encoding="utf-8-sig")   # -sig: Excel reads the accents right
    os.replace(tmp, path)


# ---------------------------------------------------------------- orchestration
def refresh_editorial(ctx: Context) -> str | None:
    """Today's probabili + indisponibili snapshot. Three requests, and it cannot be done later."""
    from euroleghe_ingest.modules import fc_site

    try:
        fc_site.run(ctx, pages=("probabili", "indisponibili"))
    except Exception as exc:   # noqa: BLE001 - a snapshot must still be produced without the refresh
        return f"editorial refresh failed ({exc}) - the sheet uses the most recent stored snapshot"
    return None


def refresh_listone_for(ctx: Context, platform: str, season: str) -> tuple[str | None, dict]:
    """The target season's official list, re-read. One login + one request; never raises.

    A thin wrapper so the import stays where the other two refreshes keep theirs, and so a caller that
    does not want the network (a back-dated sheet, a test) simply does not call it. The measurement that
    put it here is in `ratings.refresh_listone`.
    """
    from euroleghe_ingest.modules import ratings

    try:
        return ratings.refresh_listone(ctx, platform, season)
    except Exception as exc:   # noqa: BLE001 - a snapshot must still be produced without the refresh
        return f"listone refresh failed ({exc}) - the sheet uses the listone already in the DB", {}


def refresh_official_sources(ctx: Context, platform: str, window: features.Window,
                             progress: Progress | None = None) -> list[str]:
    """EVERY official channel a sheet stands on, refreshed in one place. Returns the notes it earned.

    «Vorrei che quando si esegue lo snapshot tutte queste cose avvengano in automatico» (operatore,
    18/08/2026), after a day in which an official transfer was in no sheet because NOTHING inside a
    snapshot re-read the sources that carry one. The five channels, in the order the spec's own
    dependency table gives them - not a preference:

      editorial   today's probabili + indisponibili (fantacalcio.it, 2 requests)
      listone     the club the GAME says a man is at, and his ask price (1 login + 1 request)
      market      the target season's transfers, per perimeter club (Transfermarkt, 59 pages/day)
      contracts   today's squad page per club - the third squad source + the contract expiries
      strength    today's ClubElo snapshot, which `desc_level_elo` (R19, adopted) is built on
      derive      what a re-read listone OBLIGES offline: `arrivals`, a diff between rosters

    ONE DOOR, and that is the point of the function rather than a tidiness. Each of these was added by
    appending a call to `run`, and the second one broke a test in a way worth keeping: the test stubbed
    the two network doors it knew about, the third one was not among them, and the run really logged in
    and downloaded a season's listone into a temporary database. A caller that must not touch the
    network - a test, a back-dated sheet - now has exactly one name to stub, and cannot fall behind
    when a sixth channel arrives.

    NOTHING HERE IS ALLOWED TO COST A SHEET. Every step returns its failure as a note instead of
    raising: an auction sheet built on slightly older evidence, with the age written on it, beats no
    sheet at all - and a source that refuses is a measurement the operator must read, not a silence.
    Every step is also bounded by the PERIMETER and cached per DAY, so the second and third sheet of an
    afternoon pay for none of it.
    """
    notes: list[str] = []
    if progress:
        progress.stage("refresh")
    failure = refresh_editorial(ctx)
    if failure:
        notes.append(failure)
    failure, listone = refresh_listone_for(ctx, platform, window.target_season)
    if failure:
        notes.append(failure)
    elif listone.get("moved"):
        movers = " · ".join(f"{name} {was}→{now}" for name, was, now in listone["moved"][:12])
        notes.append(f"the {window.target_season} listone was re-read today: {listone['new']} players "
                     f"are new to it and {len(listone['moved'])} changed club ({movers}"
                     + (" …" if len(listone["moved"]) > 12 else "") + ").")
    if progress:
        progress.stage("market")
    failure, _market = refresh_market(ctx, window.target_season)
    if failure:
        notes.append(failure)
    if progress:
        progress.stage("contracts")
    failure, _squads = refresh_squad_pages(ctx)
    if failure:
        notes.append(failure)
    if progress:
        progress.stage("strength")
    failure = refresh_club_strength(ctx, window.auction_date)
    if failure:
        notes.append(failure)
    # ...and the offline re-derivation, whenever `arrivals` is BEHIND the listone - not merely when this
    # run moved something, which forgets a move made by the run before it.
    stale, read_on, derived_on = arrivals_are_stale(ctx.require_conn())
    if stale:
        if progress:
            progress.stage("derive")
        print(f"[snapshot] arrivals were derived {derived_on or 'never'} and the listone was read "
              f"{read_on}: re-deriving")
        failure = rederive_after_listone(ctx)
        if failure:
            notes.append(failure)
    return notes


def refresh_market(ctx: Context, season: str) -> tuple[str | None, dict]:
    """The summer market: the target season's transfer page per perimeter club, once a day."""
    from euroleghe_ingest.modules import transfers

    try:
        return transfers.refresh_current_season(ctx, season)
    except Exception as exc:   # noqa: BLE001 - a snapshot must still be produced without the refresh
        return f"transfer refresh failed ({exc}) - the sheet uses the transfers already in the DB", {}


def refresh_squad_pages(ctx: Context) -> tuple[str | None, dict]:
    """The third squad source and the contract expiries: today's Transfermarkt squad page per club."""
    from euroleghe_ingest.modules import injuries

    try:
        return injuries.refresh_current_squads(ctx)
    except Exception as exc:   # noqa: BLE001 - a snapshot must still be produced without the refresh
        return f"squad-page refresh failed ({exc}) - the sheet uses the squads already in the DB", {}


def refresh_club_strength(ctx: Context, auction_date: str) -> str | None:
    """Today's ClubElo snapshot, asked for AT MOST ONCE A DAY. `elo.auction_dates` picks the days.

    `desc_level_elo` is R19, ADOPTED on `default`, and the club card is built on it - and when this was
    added the newest snapshot in the DB was 2026-01-14, seven months and two transfer windows old,
    because the only date anybody asked for was a convention that had already passed.

    The once-a-day guard is not caution, it is a measurement: on 18/08/2026 the endpoint TIMED OUT on
    both dates and the mirror had nothing newer, so the stage cost **68 seconds of waiting per sheet**
    and brought nothing - three sheets an afternoon would pay it three times. `fetch_snapshots` cannot
    prevent that on its own: it skips a date whose FILE exists, and a failed fetch leaves no file.
    The attempt is remembered in `ingest_runs` and NOT as an empty cache file - a marker that says
    «the source answered nothing» when the source did not answer at all is the defect of 17/08/2026.
    """
    from euroleghe_ingest.db.database import record_run
    from euroleghe_ingest.modules import elo

    conn = ctx.require_conn()
    today = dt.datetime.now(tz=dt.UTC).date().isoformat()
    asked = conn.execute("SELECT MAX(started_at) FROM ingest_runs WHERE module = 'elo'").fetchone()[0]
    if not (asked and asked[:10] >= today):    # not asked today yet - whatever today's answer turns out
        started = dt.datetime.now(tz=dt.UTC).isoformat(timespec="seconds")
        try:
            elo.run(ctx)
        except Exception as exc:   # noqa: BLE001 - a snapshot is still produced without the refresh
            record_run(conn, "elo", started, "error", f"from snapshot: {exc}")
            return (f"club-strength refresh failed ({exc}) - the sheet uses the newest Elo already in "
                    f"the DB")
        record_run(conn, "elo", started, "ok", "from snapshot")
    # ...and the AGE is reported whether or not this run is the one that asked. The guard is about the
    # REQUEST - not paying 70 seconds of timeouts three times an afternoon - and the note is about the
    # STATE, which is the same for every sheet built that day. Conflating them made the second and third
    # sheet of 19/08/2026 silent about an Elo 217 days old, which is the defect this whole session is
    # about: a sheet that cannot say how old its evidence is invites trust it has not earned.
    newest = conn.execute("SELECT MAX(date) FROM club_elo").fetchone()[0]
    if newest and newest < auction_date:
        days = (dt.date.fromisoformat(auction_date) - dt.date.fromisoformat(newest)).days
        return (f"CLUB STRENGTH is {days} days old: ClubElo served nothing for {auction_date} and the "
                f"newest snapshot on file is {newest}. `desc_level_elo` (R19, adopted on default) and "
                f"the club card are built on it, so they describe the clubs as they were then.")
    return None


def arrivals_are_stale(conn) -> tuple[bool, str | None, str | None]:
    """(stale?, when the listone was last read, when `arrivals` was last derived).

    Read from the DATA and not from a flag, which is what makes it survive a run that dies halfway: the
    listone's reading day is `fvm_history.observed_on` (the fantavalore moves at every salient event, so
    every re-read leaves a dated row) and the re-derivation's is its own line in `ingest_runs`.

    Asking THIS run's diff instead was the first version and it was wrong in the case that matters: the
    listone moved 13 men on 18/08/2026, the re-derivation did not happen in the same command, and every
    later run saw «0 moved» and skipped it - so `arrivals` would have stayed at its 08/08 state, ten days
    and two markets behind, with nothing saying so. A condition on an EVENT forgets; a condition on the
    two dates cannot.
    """
    listone = conn.execute("SELECT MAX(observed_on) FROM fvm_history").fetchone()[0]
    derived = conn.execute(
        "SELECT MAX(started_at) FROM ingest_runs WHERE module = 'arrivals' AND status = 'ok'"
    ).fetchone()[0]
    if not listone:
        return False, listone, derived           # no listone reading on file: nothing to be behind
    return (derived is None or derived[:10] < listone), listone, derived


def rederive_after_listone(ctx: Context) -> str | None:
    """What a re-read listone OBLIGES, from the spec's own dependency table («se cambia il listone»).

    `arrivals` is a diff between rosters, so a listone that moves a man's club invents or hides an
    arrival until it is re-derived - and `desc_arrival`, the arrival tiers, the FM-equivalent and the
    arrival discount all hang off it. It is OFFLINE, which is the whole reason it can be automatic where
    the rest of that table cannot.

    `stats` is in the same row of the table and is deliberately NOT run here: it reads the Drive raw
    exports (`iter_records`), not `rosters`, so a listone re-read cannot move it. Verify the function,
    not the row that looks like it.

    The `ingest_runs` line is written HERE because this command OWNS the invocation - the project's rule
    is that a module never logs its own run - and because that line is what `arrivals_are_stale` reads
    next time.
    """
    from euroleghe_ingest.db.database import record_run
    from euroleghe_ingest.modules import arrivals

    started = dt.datetime.now(tz=dt.UTC).isoformat(timespec="seconds")
    try:
        arrivals.run(ctx)
    except Exception as exc:   # noqa: BLE001 - a snapshot must still be produced without it
        record_run(ctx.require_conn(), "arrivals", started, "error", f"from snapshot: {exc}")
        return (f"arrivals could not be re-derived ({exc}): a listone that moved a club leaves "
                f"`desc_arrival` and the arrival tiers describing yesterday's rosters")
    record_run(ctx.require_conn(), "arrivals", started, "ok", "re-derived by snapshot")
    return None


def refresh_real_roles(ctx: Context, clubs, date: str,
                       progress: Progress | None = None) -> tuple[str | None, dict]:
    """Today's granular real role for every player of the perimeter. One request per CLUB.

    THE THIRD FACT THAT CANNOT BE BACKFILLED. The provider serves only "now": asking its player
    endpoint for a season three years old returns today's codes (`?seasonId=` answers 200 and is
    ignored), so a role not observed on a given day is a role that day will never have. Same reason
    the probabili are refreshed here and not derived later.

    Cheap enough to run every time: the squad endpoint answers for a whole club at once, so the
    perimeter costs ~80 requests, and the cache is keyed by the observation date - a second run on the
    same day is free. Never raises: a sheet without the roles is worse than no sheet, but only just.
    """
    try:
        positions.derive_club_xref(ctx)
        counts = positions.fetch_roles(
            ctx, clubs=sorted(clubs) if clubs else None, date=date,
            on_club=(lambda done, total: progress.tick(done, total, "clubs observed"))
            if progress else None)
    except Exception as exc:   # noqa: BLE001 - a snapshot must still be produced without the refresh
        return (f"real-role refresh failed ({exc}) - the sheet uses the most recent stored "
                f"observation, and there is no way to reconstruct today's"), {}
    # A SOURCE THAT REFUSES IS A MEASUREMENT, and it must reach the sheet. `fetch_roles` asks and moves
    # on when a club's page is unavailable, which is right for a long resumable acquisition and silent
    # for the operator: on 16/08/2026 the provider went back to 403 `challenge` on every endpoint, and a
    # run against a closed door produces a sheet whose LIVE SQUAD - the authority on who is in a squad
    # since the operator's 17/08 ruling - is as old as the last day it answered, with nothing on screen.
    if counts.get("requests") and not counts.get("clubs"):
        return (f"the live-squad provider refused all {counts['requests']} requests: today's squads and "
                f"granular roles were NOT observed, so the sheet stands on the most recent stored "
                f"reading and a man transferred since then is still drawn where he was"), counts
    return None, counts


def run(ctx: Context, *, season: str | None = None, platform: str = "euro",
        game: str = "classic", refresh: bool = True, out: str | None = None,
        date: str | None = None, clubs=None, league: str | None = None,
        keep_departed: bool = False, listone_only: bool = False, **kwargs) -> dict:
    """Build the auction snapshot. Read-only on the DB except for the editorial refresh.

    `league` names one of the leagues declared in `config/league_config.json`, and it is the whole
    parameterisation of a sheet: a played league STATES its platform and its game, so naming it fixes
    both, and its squad size fixes the replacement level surplus is measured against. Given a league,
    `platform` and `game` come from it and the arguments are ignored - one name cannot mean two sheets.
    Without one, the two dimensions are read straight and the league setup is whatever the config file
    states at top level, which is what this module did before leagues had names.

    `listone_only` goes back to a sheet of the QUOTED men alone. By default the rows are the OBSERVED
    SQUADS - «tutti i calciatori in rosa a prescindere se è quotato o meno nel listone» (the operator,
    17/08/2026) - so a man the listone has not moved yet appears at the club the provider sees him in, and a
    man nobody quotes appears with no price and his declared estimate. Measured on the Serie A window of
    that day: 499 quoted rows against 730 observed.

    `keep_departed` puts back the men who are no longer in the squad the listone lists them at. By default
    they are OUT: the authority on who is in a squad is the provider that reads it every day, not the listone
    (the operator's rule of 17/08/2026, which reverses the previous one - the sheet used to keep them with a
    `⇥` and let the board exclude them alone). The flag exists because the live-squad signal is 83.1%
    precise, not 100%, and a decision that costs something must stay revocable at every run.

    `date` stands the whole sheet on a chosen DAY: the last ten matches are the ten before it, the squads
    and the availability are the ones known then, and the descriptive layers are measured on the season so
    far instead of on its total (see `measured_season`). What it cannot back-date is the editorial
    refresh - the probabili exist only from the day the weekly job recorded them - and the heatmap, which
    is a season-long cloud and is therefore read from the season BEFORE, never from the one in progress.

    `clubs` narrows the sheet to the clubs named. The engine's population is untouched: a replacement
    level measured on one squad is not a replacement level, so the numbers are the same ones the full run
    would print - only the rows are fewer.
    """
    conn = ctx.require_conn()
    # The league is resolved FIRST, because it is what decides the other two. `load_league` raises on a
    # name that is not declared: silently falling back would hand this sheet another league's
    # replacement level, which is a wrong sort order with nothing on screen to show it.
    setup = (ctx.config.load_league(league) if league
             else ctx.config.load_league(platform=platform, game=game))
    if league:
        platform, game = setup["platform"], setup["game"]
    if platform not in ("euro", "default"):
        raise RuntimeError(f"Unknown platform {platform!r}; choose euro|default")
    if game not in ("classic", "mantra"):
        raise RuntimeError(f"Unknown game {game!r}; choose classic|mantra")

    if isinstance(clubs, str):
        clubs = [clubs]
    notes: list[str] = []
    # The window FIRST, because it is the day the sheet stands on that decides whether refreshing makes
    # sense at all. THE THREE VOLATILE STATES ARE STATES OF NOW: today's probabili describe today's team,
    # the live squad is the squad today, and the listone is the list on sale today. Pasting any of them
    # onto a sheet dated otherwise is exactly the look-ahead this whole module is dated to avoid - so a
    # sheet that does not stand on today does not refresh, and says so. The guard used to read `if date`,
    # which covered `--date` and missed `--season 2025-26`: that combination refreshed all three onto a
    # season already played (found by a test on 18/08/2026, which downloaded a real listone into a
    # temporary database - the second reason a guard belongs here rather than at each call site).
    window, note = resolve_window(conn, season, as_of=date)
    if note:
        notes.append(note)
    if refresh and window.auction_date != dt.datetime.now(tz=dt.UTC).date().isoformat():
        refresh = False
        notes.append(f"as of {window.auction_date}: the refresh of the volatile states (probabili, live "
                     f"squads, listone) was skipped, because today's are not that day's. Whatever was "
                     f"recorded at or before {window.auction_date} is used instead - possibly nothing.")
    # The percentage the panel shows: the stages this run will actually walk, so a build with no network
    # step does not stall the bar at the two stages it is skipping.
    progress = Progress(skip=() if refresh else SKIPPED_WITHOUT_REFRESH)
    print(f"[snapshot] {setup['name'] or f'{platform}/{game}'} ({platform}/{game}, "
          f"{setup['teams']} teams) · auctioning {window.target_season} from "
          f"{window.input_season} · as of {window.auction_date}")
    if refresh:
        notes += refresh_official_sources(ctx, platform, window, progress)

    # The real squads first: the row set of the sheet is who is in a club TODAY, listone or not.
    progress.stage("squads")
    derive_squads(ctx, window.auction_date, window.target_season)
    # Then the granular real role, which needs the squads (the per-player top-up walks them) and is
    # observed for the PERIMETER - the clubs this platform actually lets you buy from.
    if refresh:
        progress.stage("roles")
        # Dated with the day of the OBSERVATION, not with the sheet's: the provider serves "now" and
        # nothing else, so a payload downloaded today is a fact about today whatever day the sheet
        # stands on. Passing the sheet's date used to do two harmful things at once - it filed today's
        # squads under a past date on a back-dated run (a forgery the whole dating discipline exists to
        # prevent), and from 16/08/2026 it asked for a date whose cache files already existed, which is
        # how the refresh became a no-op that reported "0 clubs to fetch" and looked like nothing to do.
        observed_on = dt.datetime.now(tz=dt.UTC).date().isoformat()
        failure, role_counts = refresh_real_roles(
            ctx, clubs or perimeter_clubs(conn, platform,
                                          (window.input_season, window.target_season)),
            observed_on, progress=progress)
        if failure:
            notes.append(failure)
        # ...and then the squads AGAIN, because the roles step is what DOWNLOADS `/team/{id}/players`,
        # and that payload IS the live squad. Derived only before it, `squad_snapshot` read the newest
        # cache file on disk - yesterday's - on every single run: measured 07/08/2026, the 35 payloads
        # were written at 14:24 by a sheet whose squads had been derived at 14:22, so the ⇥ of a
        # departure and `eleven()`'s exclusion were always one day stale (the sheet's own evidence note
        # said `sofascore last observed` the day before, which is how it was found). The first pass
        # stays: the per-player roles top-up walks the squads to know whom to ask about.
        derive_squads(ctx, window.auction_date, window.target_season)
    progress.stage("prepare")
    data = features.prepare(conn, window, platform, game, league=setup,
                            # «TUTTI i calciatori in rosa, a prescindere se è quotato o meno nel listone»
                            # (operatore, 17/08/2026): la rosa OSSERVATA decide chi c'è e in che club, il
                            # listone dà il prezzo a chi ce l'ha. Era `real`, che aggiungeva solo i NON
                            # quotati e lasciava il club del listone a tutti gli altri - quindi Molina
                            # restava all'Atlético su euro e non esisteva affatto sul foglio Serie A, pur
                            # essendo alla Roma dal 14/08. `--listone-only` torna al foglio dei soli quotati.
                            squad_source="listone" if listone_only else "squad",
                            # Il regolamento del GIOCO, per il secondo zero (`features.fielded_places`):
                            # quanti posti per ruolo schiera un undici. È configurazione letta, non una
                            # misura, e serve solo alle due colonne `desc_*_fielded`.
                            rulebook=ctx.config.load_modules(game))
    # The empty target calendar is patched inside `engine_predictions` - where the price is decided, so
    # every caller gets it - and its note arrives with the engine's own.
    progress.stage("predict")
    data, predictions, params_source, engine_notes = engine_predictions(
        conn, window, platform, game, setup, prepared=data)
    notes += engine_notes
    if not data.observations:
        raise RuntimeError(f"no players in the {window.target_season} listone for platform "
                           f"{platform} - nothing to snapshot")

    # Which season the descriptive layers measure, and up to which day. `before` is None for the usual
    # pre-season run: there the season total IS everything that happened.
    # HOW OLD the squad and transfer evidence is, said out loud before anything reads it (see
    # `evidence_age`): the operator's case was a sheet that was right about what it had, and what it had
    # was days old with the whole summer market missing.
    evidence, evidence_notes = evidence_age(conn, window, platform)
    notes += evidence_notes
    measured, measured_note = measured_season(conn, window)
    before = window.auction_date if measured == window.target_season else None
    if measured_note:
        notes.append(measured_note)
    seasons = [row[0] for row in conn.execute(
        "SELECT DISTINCT season FROM rosters WHERE season <= ? ORDER BY season",
        (window.target_season,))]
    starters, starters_date = latest_starters(conn, window.auction_date,   # notes is already open
                                              window.target_season)
    if not starters:
        notes.append(
            "no probabili snapshot at or before the auction date: the starter and duel columns are empty. "
            + ("For a back-dated sheet this costs nothing and is not a gap to fill: a forecast of who "
               "plays is only interesting while the outcome is unknown, and for that day the eleven that "
               "was actually FIELDED exists - it is in the `actual_*` columns, and the pitch draws it. The "
               "editors' probabilities are worth fetching only for a sheet standing on TODAY, where they "
               "carry what we cannot compute: the coach's own words."
               if date else
               "They are a state of NOW and cannot be backfilled, so they exist only from the day a run "
               "records them - which is why a sheet for today refreshes them."))
    squads, squad_sources = squad_as_of(conn, window.auction_date)
    # The club's last ten has a stage of its own: it walks every observation against its club's fixture
    # list and it is the single most expensive descriptive layer, so folding it in with the cheap lookups
    # would make a quarter of the bar move in one step.
    progress.stage("form")
    # The bonus values are a CHAMPIONSHIP's, so they are read per championship and never hard-coded:
    # a synthetic fantapunto for a Bundesliga round is built with the Bundesliga's own goal bonus, and
    # `""` is the fallback for a competition `scoring_config` does not name (a cup, another league).
    scoring = {league: ctx.config.load_scoring(league) for league in config.CHAMPIONSHIPS}
    scoring[""] = ctx.config.load_scoring()
    form = club_form(conn, window.auction_date, data.observations, squads, scoring=scoring,
                     target_season=window.target_season)
    # The GRANULAR real role, read once: the sheet shows it, and the department control of `place_changes`
    # needs the LINE - a right back does not cover a centre back, and `role_classic` calls both D.
    role_detail = positions.roles_as_of(conn, window.auction_date, fallback=bool(date))
    # ...and WHERE each man was, season by season: the two layers that walk his own season read it, and
    # one walk means they cannot disagree about which matches were his.
    belongs = player_clubs(conn, club_index(conn))
    progress.stage("layers")
    layers = {
        "form": form,
        # WHO TOOK A SHIRT during the measured season and who lost one, with the order between the day
        # the place changed and the day a spell opened. Reporting only: the predictive form of this
        # idea was measured on 14/08/2026 and came out at +0.049 over 8 instances, 6/8.
        "place": place_changes(conn, measured, data.observations, squads, belongs, role_detail, before),
        # ...and who was SOLD as a starter and is being rotated, in the season being played. Empty on a
        # pre-season sheet by construction: it reads rounds that have to exist first.
        "rotation": rotation_watch(conn, measured, data.observations, belongs,
                                   role_percentiles(data.observations), before),
        # ...and its MIRROR: given as a reserve, playing like a starter. Same window, opposite
        # direction, and a weaker claim - which its own note says.
        "riser": starter_signs(conn, measured, data.observations, belongs,
                               role_percentiles(data.observations), before),
        "squads": squads, "squad_sources": squad_sources,
        "injuries": injury_history(conn, window.auction_date, seasons, measured),
        "starters": starters,
        "availability": availability_now(conn, window.auction_date),
        "propensity": propensity(conn, measured, before),
        "titolarita": titolarita(conn, measured, before),
        # The same season, split by WHOSE it was: what he played at the club he is at now, and what
        # somewhere else. The totals cannot say it - only the per-match layer stores a club.
        "at_club": at_current_club(conn, measured, data.observations, squads, before),
        # The engine's OWN recent sample (R13's input), so the sheet and the engine stand on one fact
        "elsewhere": measured_elsewhere(conn, window),
        # What the club has PUT INTO him - fee share and stature. A pre-auction fact; whether it weighs on
        # who is selected is a parameter of `engine.presence`, and it starts at zero.
        "investment": investment(conn, window, data.observations, squads, platform),
        # ...and whether the club he is at now had already had him: the only measured difference between
        # a man it sent away and a man it has just taken on (no source of ours marks a loan).
        "was_here": previously_at_club(conn, data.observations, squads, measured),
        # Cards stay on the season aggregate of the season BEFORE: the per-match layer does not store
        # yellows and reds, so there is nothing to bound by a date - and last season's total is at least
        # a fact that was known by then.
        "discipline": discipline(conn, window.input_season, platform),
        "contract": contract_state(conn, window.target_season, platform),
        "penalties": penalty_duty(conn, window.auction_date),
        # Chi una COPPA CONTINENTALE in mezzo al campionato porta via, e quanto costa. Il calendario e
        # la nazionalità sono fatti; quanto perde uno di quel profilo è misurato (`engine/cups.py`).
        # Vuoto quando nessun torneo dichiarato cade dopo la data d'asta - in una stagione senza coppe
        # in mezzo la colonna è muta, e nel 2026-27 la Coppa d'Africa è per la prima volta estiva.
        "cups": cup_exposure(ctx, conn, window, data.observations, data.matchdays_target,
                             {p.obs.fc_id: p.pv_pred for p in predictions if p.pv_pred is not None}),
        # Where he really stood on the pitch last season (the positional heatmap). Empty until
        # `positions --layer heatmap` has run; the view falls back to the Mantra roles, which name a
        # side for defenders but not for wingers.
        "real_roles": {fc_id: role for fc_id, role in conn.execute(
            "SELECT fc_id, derived_role FROM positions WHERE season = ? AND source = 'sofascore' "
            "AND derived_role IS NOT NULL", (window.input_season,))},
        # The GRANULAR real role: one to three of the provider's twelve codes (GK, DL/DC/DR, DM,
        # ML/MC/MR, AM, LW/RW, ST). It answers the question neither of the other two can - a left back
        # is not a centre back, and P/D/C/A and G/D/M/F both call them the same thing. Read as of the
        # auction date, because it is a dated observation and not a season fact.
        "real_role_detail": role_detail,
        "sides": measured_sides(conn, window.input_season, notes),
        # How many rounds each CHAMPIONSHIP played in the input season (34 in the Bundesliga and Ligue 1,
        # 38 elsewhere). It travels with an arrival because his measured season belongs to the calendar he
        # played it on: dividing 1320 Ligue 1 minutes by his new club's 38 rounds instead of Ligue 1's 34
        # reads 12% less of a season than he played, which is «a share of a season is a share of the
        # CHAMPIONSHIP» broken for exactly the men it was written for. From the per-match layer, per
        # season, so a league that changes size is not a constant anybody has to remember.
        "league_rounds": features.league_rounds(conn, window.input_season),
        "positions": {fc_id: (avg_x, avg_y) for fc_id, avg_x, avg_y in conn.execute(
            "SELECT fc_id, avg_x, avg_y FROM positions WHERE season = ? AND source = 'sofascore'",
            (window.input_season,))},
        # The TARGET season's pre-season: who the coach who is there NOW started in the friendlies. The
        # only football a new man has played by auction day - and a reading, never a criterion, for the
        # five measured reasons in `preseason_starts`.
        "preseason": preseason_starts(conn, window.target_season),
    }
    # The eleven the clubs actually FIELDED in the first match after the auction date. Empty for a sheet
    # built today, and for a back-dated one it is what makes the probabili unnecessary: the outcome exists.
    progress.stage("fielded")
    layers["fielded_next"], fielded_clubs = fielded_next(
        conn, window.auction_date, data.observations, squads)
    if fielded_clubs:
        # How many of those elevens the SHEET can actually show: a starter who is not in its rows (a
        # relegated club's man, an identity we cannot resolve, someone the listone never had) leaves a hole,
        # and counting the complete ones is the honest way to say how far the fact goes.
        started_per_club: dict[str, int] = {}
        for obs in data.observations:
            if (layers["fielded_next"].get(obs.fc_id) or {}).get("started"):
                started_per_club[obs.club_target or ""] = started_per_club.get(obs.club_target or "", 0) + 1
        complete = sum(1 for count in started_per_club.values() if count >= 11)
        notes.append(f"{len(fielded_clubs)} clubs have the eleven they really fielded after "
                     f"{window.auction_date} in the `actual_*` columns (first match: "
                     f"{min(entry['date'] for entry in fielded_clubs.values())}), and {complete} of them "
                     f"have all eleven men among the sheet's own rows. The others fielded somebody this "
                     f"sheet does not carry, and the reason is the row set rather than the fact: the "
                     f"squads are the ones of TODAY (a past day's squad page cannot be fetched either), so "
                     f"a man who has since left his club is missing - Inter's eleven of 2025-08-24 is "
                     f"complete except Pavard. Measured AFTER the auction date, so reporting ONLY: no "
                     f"engine_* or desc_* column reads them, and the pitch labels them as fielded rather "
                     f"than predicted.")
    # LA COPPA CONTINENTALE, e la nota è la provenance: il file dichiarato non viaggia nel bundle, quindi
    # è qui che il foglio dice quale finestra ha applicato, a quanti uomini e con quale coefficiente.
    if layers["cups"]:
        by_cup: dict[str, list[dict]] = {}
        for one in layers["cups"].values():
            by_cup.setdefault(one["name"], []).append(one)
        for name, men in sorted(by_cup.items()):
            capped = sum(1 for one in men if one["capped"])
            rounds = max(one["rounds"] for one in men)
            notes.append(
                f"⚽ {len(men)} players are exposed to {name} ({men[0]['exposures'][0].cup.start} .. "
                f"{men[0]['exposures'][0].cup.end}), {capped} of them already capped, up to {rounds} "
                f"rounds of this calendar inside the window. `desc_pv_cup` / `desc_value_cup` carry the "
                f"appearances and the fantapunti net of it, and `engine_pv_pred` is NOT touched - the "
                f"coefficient is measured (difference-in-differences over four tournament windows: AFC "
                f"0.59 · CAF 0.35 capped / 0.20 not) and the gate does not own these columns. WHEN it is "
                f"played and WHO is in it are declared in config/international_cups.json with their "
                f"source; the nationality is the provider's own `player.country`, which names the "
                f"national team a man really turned out for on 299 of 300 checkable cases - the "
                f"exceptions are the men who chose another country, and those are declared per player.")
    else:
        # UN VUOTO HA DUE CAUSE E VANNO DETTE SEPARATE, che è la regola di «non-vuoto non è completezza»
        # applicata a questa colonna: o nessun torneo dichiarato cade dentro la stagione (per
        # costruzione, ed è il caso del 2026-27 per l'Africa), o uno ci cade e il CALENDARIO di quella
        # stagione non è in `fixtures` - allora la colonna è IGNOTA, non vuota, e dirle uguali sarebbe
        # esattamente il difetto che un conteggio non sa distinguere.
        cups_declared, _membership = engine_cups.parse(ctx.config.load_international_cups())
        overlapping = [cup for cup in cups_declared.values()
                       if cup.end >= window.auction_date
                       and (not cup.seasons or window.target_season in cup.seasons)]
        if overlapping and not any(
                inside for cup in overlapping
                for inside, _total in cup_rounds_by_league(
                    conn, window.target_season, cup, after=window.auction_date).values()):
            notes.append(
                f"{len(overlapping)} declared continental cup(s) DO fall inside {window.target_season} "
                f"after {window.auction_date} ({', '.join(cup.name for cup in overlapping)}), and the "
                f"`desc_cup*` columns are still empty - because `fixtures` has no calendar for this "
                f"season, so how many rounds the window covers is UNKNOWN and not zero. A back-dated "
                f"sheet is the normal case for this: the calendar is scraped for the season being "
                f"played. `fixtures --season {window.target_season}` is what would fill it.")
        elif cups_declared:
            notes.append(
                f"no declared continental cup falls inside {window.target_season} after "
                f"{window.auction_date}, so the `desc_cup*` columns are empty BY CONSTRUCTION and not "
                f"by omission: of the {len(cups_declared)} windows on file none overlaps this calendar. "
                f"For 2026-27 that is the Africa Cup, which is played 19/06-17/07/2027 - the first "
                f"summer edition since 2019 - and it costs a PRESEASON instead (`post_torneo`).")
    # after the layers, because a duel is POSITIONAL: it needs the granular real roles, not the P/D/C/A
    layers["duels"] = duels(data.observations, starters, layers["real_role_detail"])
    # ...and who he does NOT coexist with, over the INPUT season and by the club he plays for THEN:
    # the question is whether a coach who could field them together did, so the pairs are last
    # season's team-mates and not this summer's.
    input_clubs = dict(conn.execute(
        """SELECT r.fc_id, c.canonical_name FROM rosters r
           JOIN clubs c ON c.fc_club_id = r.fc_club_id WHERE r.season = ?""",
        (window.input_season,)))
    layers["costarts"] = costarts(
        conn, window.input_season, {obs.fc_id for obs in data.observations}, input_clubs,
        before=date)
    covered = sum(1 for obs in data.observations if obs.fc_id in layers["real_role_detail"])
    if date:
        borrowed = sum(1 for detail in layers["real_role_detail"].values()
                       if (detail.get("observed") or "") > window.auction_date)
        if borrowed:
            notes.append(f"{borrowed} granular real roles were observed AFTER {window.auction_date} and "
                         f"are used anyway: the provider ignores the season it is asked for, so no "
                         f"role can be observed for a past date and the alternative is a sheet that "
                         f"cannot place anybody. A role is the slowest-moving fact here - a left back "
                         f"is still a left back - and desc_real_role_observed carries the real date.")
    if covered < len(data.observations):
        notes.append(f"{len(data.observations) - covered} of {len(data.observations)} players have no "
                     f"granular real role: the provider's squad pages did not list them, or their "
                     f"identity is not resolved to a provider id. Their line is still known from "
                     f"desc_real_role (G/D/M/F) - what is missing is the flank. "
                     f"`positions --layer roles` retries, and only for TODAY: the codes cannot be "
                     f"observed for a past date. It can only observe a player it can IDENTIFY, so where "
                     f"the sofascore id is missing from player_xref the cure is the identity, not the "
                     f"run. Consequence to read on purpose: a ballottaggio is a duel between REAL roles, "
                     f"so desc_duel_rivals/desc_duel_names are EMPTY for these men - unknown, never "
                     f"'no rival' - and the pitch offers them no alternative rather than one taken from "
                     f"the listone role, which calls a winger and a regista the same thing.")

    perimeter = perimeter_clubs(conn, platform, (window.input_season, window.target_season))
    if not perimeter:
        # An unknown perimeter is not an empty one: filtering on nothing would blank the whole sheet.
        notes.append(f"platform {platform} has no ratings for {window.input_season}/"
                     f"{window.target_season}, so the perimeter is unknown and nothing was filtered")
        perimeter = None
    progress.stage("rows")
    rows = build_rows(conn, data, predictions, layers, perimeter, window, platform,
                      ctx.config.load_scoring())
    # CHI NON E' PIU' IN ROSA ESCE DAL FOGLIO (operatore, 17/08/2026: «l'autorita' di chi e' in rosa e'
    # sofascore»). Prima restava con un `⇥` perche' l'autorita' era il listone; ora l'autorita' e' la fonte
    # che vede la rosa ogni giorno, e una riga che si puo' comprare da un club dove non c'e' e' peggio di una
    # riga in meno. La board lo escludeva gia': era il foglio a non obbedire.
    # L'AUTORITA' DICE DOVE E', NON SOLO CHE NON E' PIU' LI' (operatore, 17/08/2026, e la prima versione di
    # questa regola sbagliava proprio qui). Quindi si toglie dal foglio SOLTANTO chi la fonte vede in un club
    # che questa piattaforma non gioca: chi la fonte vede ancora al suo club resta (il marchio era un falso
    # positivo del payload di un giorno), e chi si e' spostato dentro il perimetro resta comprabile - la riga
    # porta il club del listone, perche' ogni numero del motore e' calcolato su quello, e `desc_live_club`
    # dice dove la fonte lo vede. Un'etichetta che dicesse Roma su numeri dell'Atletico sarebbe il difetto
    # «una lista mostrata i cui numeri descrivono un'altra lista».
    seen_at = live_club_of(conn, window.auction_date)
    for row in rows:
        where = seen_at.get(row["fc_id"])
        if where:
            row["desc_live_club"], row["desc_live_club_on"] = where
    def _still_buyable(row) -> bool:
        where = seen_at.get(row["fc_id"])
        if not where:
            return True            # la fonte non ha parlato: ignoto, non partito
        return perimeter is None or _club_key(where[0]) in {_club_key(one) for one in perimeter}
    departed = [row for row in rows
                if row.get("desc_left_for") and not _still_buyable(row)]
    stayed = [row for row in rows if row.get("desc_left_for") and _still_buyable(row)]
    if departed and not keep_departed:
        gone = {id(row) for row in departed}
        rows = [row for row in rows if id(row) not in gone]
        notes.append(
            f"⚑ {len(departed)} players were REMOVED from the sheet: the provider that reads the squads "
            f"every day has them at a club this platform does not play. The authority on who is in a squad "
            f"is that provider and not the listone (the operator's rule of 17/08/2026, which REVERSES the "
            f"previous one: the sheet used to keep them with a mark). What is NOT removed, and it is the "
            f"half the first version of this rule got wrong: {len(stayed)} men also carry a departure mark "
            f"and STAY, because the provider still sees them at their listone club (a later payload simply "
            f"did not list them) or at another club this platform plays - measured on this sheet, removing "
            f"them would have dropped men who are still buyable. `desc_live_club` says where the provider "
            f"sees each of them, and the engine's numbers stay those of the listone club, which is what "
            f"they are computed on. `--keep-departed` keeps everybody. Removed: " + " · ".join(
                f"{row['name']} -> {row['desc_left_for']}" for row in departed[:6])
            + (f" · and {len(departed) - 6} more" if len(departed) > 6 else ""))
    # I due conteggi sono due fatti diversi e non si sommano in silenzio: fuori perimetro = «il suo club non
    # gioca qui», partito = «non e' piu' in quel club». Il primo e' quello che questa nota racconta.
    outside = len(data.observations) - len(rows) - (0 if keep_departed else len(departed))
    dropped = outside if perimeter is not None else 0
    if dropped:
        notes.append(f"{dropped} players were left out of the sheet: their club is not one this "
                     f"platform plays ({len(perimeter)} clubs are). They stay in the engine's "
                     f"population, so every number here is the one the harness would give")
    # WHY a row can have no engine_* valuation at all, said out loud instead of leaving an empty cell to be
    # read as a zero. The core refuses to predict outside the domain its coefficients were fitted on
    # (`model.MIN_PV_PREV` = 15 votes in the input season), and what happens then depends on the PLATFORM:
    # on euro the adopted set contains R0c, the role anchor, which prices him anyway; on default it does not
    # (it never beat the anchor there), so there is nothing to fall back to. That is the Serie A coverage
    # hole the gate has been carrying, and it is worth seeing on the sheet that shows it.
    unpriced = [row for row in rows if not row.get("engine_fm_pred")]
    if unpriced:
        notes.append(
            f"{len(unpriced)} of {len(rows)} players have NO engine_* valuation (no predicted fantamedia, "
            f"so no VALUE and no SURPLUS): their {window.input_season} on platform {platform} is under "
            f"{evaluate.model.MIN_PV_PREV} votes, which is outside the domain the core's coefficients were "
            f"fitted on - the harness refuses to pretend otherwise. On euro the adopted set includes R0c "
            f"(the role anchor) and prices them at it; on default R0c is not adopted, because it never beat "
            f"the anchor there, so the cell is EMPTY and not a zero. `desc_*` columns are unaffected: they "
            f"are measured, not predicted. Examples: "
            f"{', '.join(row['name'] for row in unpriced[:5])}.")
        # ...and the same count SPLIT by reason, because the sentence above can only say one of them and
        # the cell hides three. Per row it is in `engine_unpriced_reason`.
        by_reason: dict[str, int] = {}
        for row in unpriced:
            key = (row.get("engine_unpriced_reason") or "no prediction").split(" votes")[0]
            key = "too few votes" if key.startswith("only") else key
            by_reason[key] = by_reason.get(key, 0) + 1
        # ...and what the sheet DOES give them instead, because «ogni calciatore DEVE avere il suo SURPLUS»:
        # the fallback valuation, penalised and labelled per row.
        estimated = [row for row in rows if row.get("est_basis") and row["est_basis"] != "core"]
        if estimated:
            by_basis: dict[str, int] = {}
            for row in estimated:
                by_basis[row["est_basis"]] = by_basis.get(row["est_basis"], 0) + 1
            worst = min((row.get("est_confidence") or 1.0) for row in estimated)
            notes.append(
                f"...and all of them DO have an `est_surplus`: {len(rows) - len(estimated)} rows carry the "
                f"gated valuation and {len(estimated)} carry an ESTIMATE, penalised by how little is known "
                f"(confidence down to {worst:g}). By basis: "
                + " · ".join(f"{count} {basis}" for basis, count in sorted(
                    by_basis.items(), key=lambda item: -item[1]))
                + ". Same arithmetic as `engine_surplus` times that confidence, so one column ranks the "
                  "whole sheet; `est_note` says per row what it is built from. NOT gated and not measured: "
                  "it is the third prefix, and the ladder is in `engine/estimate.py` with the measurement "
                  "behind each rung.")
        notes.append("...and WHY, per row (`engine_unpriced_reason`): "
                     + " · ".join(f"{count} {reason}" for reason, count in sorted(
                         by_reason.items(), key=lambda item: -item[1]))
                     + ". A man with no season on this platform played his football on the other calendar "
                       "(or outside the perimeter): his measured history exists and is not a Serie A one, "
                       "and converting it is R1, which the gate has refused twice (§7-octies).")
    gone = [row for row in rows if row.get("desc_left_for")]
    if gone:
        notes.append(
            f"⚑ {len(gone)} players are still listed at a club they are no longer in, by one of TWO "
            f"independent signals - a transfer that names where they went, or the club's LIVE SQUAD not "
            f"containing them (the provider's own team page, one request per club, re-read every day: it had "
            f"Gutierrez out of Napoli on 28/07 while the listone and both squad pages still had him days "
            f"later). The row keeps its club on purpose: the listone is the game's own authority on who is in "
            f"a squad, so the sheet reports the contradiction instead of overruling it. Absence is only read "
            f"for a man the provider can identify - otherwise 'not in the payload' would mean 'never matched' "
            f"- and a signing made after the payload's date will read as absent until it is re-read: "
            + " · ".join(f"{row['name']} -> {row['desc_left_for']} ({row['desc_left_on']})"
                         for row in gone[:6])
            + (f" · and {len(gone) - 6} more" if len(gone) > 6 else "")
            + ". `desc_left_for` / `desc_left_on` carry it per row.")
    # IL SURPLUS IN CREDITI, prima di qualunque restringimento: il tasso si fitta UNA VOLTA sulla lista
    # intera, o l'SpM di un uomo cambierebbe a seconda di chi altro è nel foglio (stessa regola del
    # pannello, `gui._market`). La lega decide solo QUANTO IN FONDO guarda la conversione - `teams x
    # squad_slots`, gli stessi numeri che fissano il rimpiazzo.
    _market_money(rows, setup)
    if clubs:
        wanted = {matching.club_key(name) for name in clubs}
        kept = [row for row in rows if matching.club_key(row.get("club") or "") in wanted]
        if not kept:
            raise RuntimeError(f"no players for {', '.join(clubs)} in this sheet - the club names are "
                               f"the canonical ones, e.g. 'Napoli', 'Inter'")
        notes.append(f"narrowed to {', '.join(sorted({row['club'] for row in kept}))}: "
                     f"{len(rows) - len(kept)} players of the other clubs were left out of the sheet, "
                     f"and the engine's numbers are unchanged (its population is the whole platform)")
        rows = kept
    club_rows = club_context(conn, data, starters_date,
                            sorted({row["club"] for row in rows if row.get("club")}),
                            measured, before, fielded_clubs, platform)

    # The folder carries the day the sheet STANDS ON, plus the club when it is one club: a back-dated
    # run must not overwrite today's, and two dates are two different sheets. And the LEAGUE, because two
    # leagues can be played on the same platform and game with different squad sizes: without the name
    # the second sheet would silently overwrite the first one, whose numbers are measured against another
    # replacement level.
    progress.stage("write")
    stamp = date or dt.datetime.now(tz=dt.UTC).date().isoformat()
    only = f"-{matching.club_key(clubs[0]).replace(' ', '')}" if clubs and len(clubs) == 1 else ""
    named = f"-{matching.club_key(setup['name']).replace(' ', '')}" if setup["name"] else ""
    folder = Path(out) if out else (
        ctx.config.data_dir / "reports" /
        f"auction-snapshot-{window.target_season}-{platform}-{game}{named}{only}-{stamp}")
    folder.mkdir(parents=True, exist_ok=True)
    _write_csv(folder / "players.csv", PLAYER_COLUMNS, rows)
    _write_csv(folder / "clubs.csv", list(club_rows[0]) if club_rows else ["club"], club_rows)

    # THE DRAWN BOARDS, produced from the folder that was just written and stored inside it.
    #
    # Beside the sheet on purpose: a board that could come from a different sheet than the one exported is a
    # mismatch nobody would ever see. And through the PANEL's own class (`boards.extract_boards` drives
    # `SnapshotView` headless), so what the app draws and what the screen draws are the same call - the
    # alternative was a second eleven, which is the defect of 08/08/2026.
    #
    # WITH the operator's rulings, unlike the two judges: `board_rulings.json` is his declared truth and has
    # the highest precedence for the drawn board, while a judge must never score his own answers.
    #
    # It needs Tk, which is an ENVIRONMENT and not a dependency of a sheet: without a display the sheet is
    # complete and only its boards are missing, so the failure is reported and never raised.
    board_summary = None
    try:
        from euroleghe_ingest.modules.boards import write_boards

        board_summary = write_boards(ctx.config, folder)
    except Exception as exc:                              # noqa: BLE001 - a display is not a sheet's problem
        print(f"[snapshot] note: boards.json not written ({exc!r}). The sheet is complete; the app's pitch"
              f" falls back to what the bundle carries. `python -m euroleghe_ingest snapshot` on a machine"
              f" with a display writes them.")
    if board_summary:
        print(f"[snapshot] boards: {board_summary['drawn']}/{board_summary['clubs']} clubs drawn"
              f" · {board_summary['men']} men · {board_summary['duels']} ballottaggi"
              f" · {board_summary['no_granular_role']} men with no granular real role, whose duels are"
              f" UNKNOWN and not absent")
        for club, why in board_summary["failed"].items():
            print(f"[snapshot] WARNING: board not drawn for {club}: {why}")
        for club, why in board_summary["disagreements"].items():
            print(f"[snapshot] WARNING: {club}: {' · '.join(why)}")

    filled = {column: sum(1 for row in rows if row.get(column) not in (None, ""))
              for column in PLAYER_COLUMNS}
    # One row's answer, re-read only to report the provenance the rows were built with.
    calendar_sample = next(
        (fixtures.easy_matches(conn, window.target_season, matching.club_identity(row["club"]),
                               league=row.get("league"))
         for row in rows if row.get("desc_easy_matches") and row.get("club")), None)

    manifest = {
        "generated_at": dt.datetime.now(tz=dt.UTC).isoformat(timespec="seconds"),
        "sheet_revision": SHEET_REVISION,
        # DOVE è finito, detto dall'artefatto stesso: il nome della cartella lo compone questa funzione
        # con la lega, il club e la data, e un chiamante che lo ricostruisse a mano lo sbaglierebbe il
        # giorno che una di quelle tre regole cambia (`timepack` lo legge invece di indovinarlo).
        "folder": str(folder),
        "platform": platform, "game": game,
        "target_season": window.target_season, "input_season": window.input_season,
        "auction_date": window.auction_date,
        "players": len(rows), "clubs": len(club_rows),
        # WHICH LEAGUE this sheet is for. Without it a reader cannot know what the surplus column is
        # measured against: the replacement level is the fantamedia of the marginal rostered player, so
        # it changes with the squad size, and two leagues on the same platform and game produce two
        # different sort orders from the same predictions. `declared: false` = not one of the operator's
        # leagues, i.e. platform and game were read straight and these are the config file's top-level
        # numbers.
        "league": {
            "name": setup["name"] or None,
            "declared": setup.get("declared", True),
            "teams": setup["teams"], "squad_slots": dict(setup["squad_slots"]),
            "mantra_slots": dict(setup["mantra_slots"]) or None,
            "reliability_exponent": setup["reliability_exponent"],
            "min_availability": setup["min_availability"],
            "_note": "The league the sheet was built for, from config/league_config.json. It fixes the "
                     "REPLACEMENT LEVEL that engine_surplus is measured against - a number quoted "
                     "without it is not comparable with another league's.",
            # ...and the two numbers that are recorded here WITHOUT being applied to a column, which is
            # worth saying: a reader who found them in the manifest could only conclude the columns used
            # them. `reliability_exponent` weights a RANKING (the Auction tab's, `evaluate.auction_view`)
            # and `min_availability` gates one; `engine_surplus` is the exact expected surplus and every
            # row is in the sheet. Operator's decision, 17/08/2026 - see `engine/model.surplus_of`.
            "_ranking_only": "reliability_exponent and min_availability describe the Auction tab's "
                             "RANKING, not the columns of this sheet: engine_surplus is the unweighted "
                             "expected surplus and no row is filtered out of the file.",
        },
        # The two CALENDARS, because a share of a season needs to say which one, and they are not the
        # same length: the platform's (31 euro rounds in 2025-26, 38 on default) is what engine_pv_pred
        # counts appearances on, while the descriptive shares are a share of the CLUB's championship
        # (clubs.csv `league_XIs`: 38 rounds in Serie A, 34 in the Bundesliga). Reading pv_pred against a
        # club's fixture list printed 53% for a man expected in 26.6 of 31 rounds.
        "matchdays": {
            "platform_target": data.matchdays_target,
            "platform_input": data.matchdays_prev,
            "_note": "engine_pv_pred is expressed on platform_target. The desc_* shares are shares of "
                     "the club's own championship calendar, which is clubs.csv `league_XIs`.",
        },
        "engine": {
            "rules": ["R0", *evaluate.ADOPTED.get(platform, ())],
            "params_from": params_source,
            "_note": "The `engine_*` columns are the valuation the gate validated. The parameters come "
                     "from a window that is not the season being auctioned. A coefficient quoted "
                     "without its platform, its residual baseline and its date is not a fact - the "
                     "numbers live in data/reports/engine_backtest.json.",
        },
        # The THIRD class of columns, and the only one that lives after the auction date.
        "actual": {
            "_note": "The `actual_*` columns are measured AFTER the auction date: the eleven the club "
                     "really fielded in its first match of the following week. They exist because a "
                     "BACK-DATED sheet has no use for a forecast of who plays - the outcome exists, and "
                     "the probabili of that day cannot be fetched anyway. Reporting ONLY: no rule, no "
                     "prediction and no desc_* column reads them, which is why they are not called "
                     "desc_. Empty on a sheet built today: the next match has not been played.",
            "clubs_with_a_fielded_eleven": len(fielded_clubs),
        },
        "descriptive": {
            "_note": "Every `desc_*` column is DESCRIPTIVE and NOT gated. It is there for the human "
                     "reading the sheet. Turning any of it into a coefficient requires a "
                     "pre-registered gate run - six families of fantamedia hypotheses have already "
                     "died that way.",
            "form_matches": FORM_MATCHES,
            "duel_margin": BALLOTTAGGIO_MARGIN,
            "injury_recency_weights": list(INJURY_WEIGHTS),
            "trend": {
                "_note": "desc_trend_* is the club's last "
                         f"{FORM_MATCHES} CHAMPIONSHIP matches - a second window beside desc_form_*, "
                         "which walks EVERY competition. The reason is measured: the euro calendar "
                         "leaves 3 to 7 real rounds a season out of each league, so a man read on his "
                         "euro fantamedia alone is read on about 82% of his football, and "
                         "desc_trend_outside_euro counts how many of these ten it never saw.",
                "height": "desc_trend_detail carries, per match, the VOTE from a declared cascade: the "
                          "real one when the game gave it, the calibrated synthetic base voto "
                          "(mv_synth) when the euro calendar skipped that round, and nothing at all "
                          "otherwise. Never a zero - a match nobody voted is not a bad match.",
                "judgement": "desc_trend_fp is the mean FANTAPUNTI over that window: a match he did "
                             "not play counts 0 (availability is half of what a fantamedia is worth), "
                             "a match nobody can score is not in the denominator, and "
                             "desc_trend_matches says how many were. It is a DESCRIPTION, not a "
                             "prediction: measured 14/08/2026, a player's departure from his own "
                             "averages does not predict his next rounds (true excess +0.0167 / "
                             "+0.0072 / -0.0007 at 2, 3 and 5 matchdays over the reshuffled null, "
                             "with the sign changing over ~65,000 windows).",
                "two_limits": "The synthetic side carries NO cards (the per-match layer has no "
                              "bookings at all) and NO goalkeeper fantapunti (their fantavoto is "
                              "dominated by the goals conceded, which no per-match row of ours "
                              "holds): a keeper's non-voted round therefore leaves the denominator "
                              "instead of entering it with a number inflated by a goal a game.",
            },
            "place": {
                "_note": "desc_place_* is who TOOK a shirt during the measured season and who lost "
                         "one: the day his minutes per match changed durably (at least "
                         f"{PLACE_MIN_SIDE} matches each side and {PLACE_MIN_JUMP:.0f} minutes of "
                         "step - display thresholds, nothing fits on them), and what was happening "
                         "on his line that day.",
                "control": "The department control is what makes it honest: a man who plays because "
                           "the starter in front of him is broken has NOT won the place, and he goes "
                           "back when the other returns. It is done on DATES and never on "
                           "co-occurrence - `front_injured` means the spell was already open on the "
                           "day the place changed, `won_then_injury` that it opened within "
                           f"{PLACE_FOLLOWS_DAYS} days AFTER it. The line is the GRANULAR role "
                           "(`player_roles`), because a right back does not cover a centre back and "
                           "role_classic calls both D - with that role's own limit: the provider "
                           "serves only today's codes, so a man's line is read from the roles he has "
                           "NOW.",
                "suspensions": "NOT CHECKED, and the note says so rather than implying their "
                               "absence: `availability` is a two-week snapshot of 2026 and `reds` is "
                               "0 on the whole 2025-26 of the per-match layer, so a team-mate's ban "
                               "is invisible. «Not looked at» is the honest word.",
                "reporting_only": "The predictive form of this idea was measured on 14/08/2026 as "
                                  "«promotion in minutes», controlling for the price and the minutes "
                                  "already seen: mean +0.049 over 8 instances, 6 of them positive - "
                                  "weak and not stable. Showing it is useful; ranking on it is not.",
            },
        },
        "real_role_note": {
            "_note": "desc_real_roles is the player's REAL position in the provider's own twelve-code "
                     "vocabulary, most representative first. It is the only column that separates a "
                     "left back from a centre back: role_classic calls both D, and desc_real_role "
                     "(the modal per-match slot) calls both D as well.",
            "vocabulary": {code: positions.REAL_ROLE_LABEL[code] for code in positions.REAL_ROLES},
            "drawing": "desc_real_role_depth 0 = his own goal, 1 = the opponent's (the axis avg_x is "
                       "measured on); desc_real_role_side -1 = the team's left, +1 = its right. They "
                       "are LAYOUT positions derived from the primary code, not measured and not "
                       "fitted; avg_x/avg_y from the heatmap is the measured version and wins where "
                       "it is filled.",
            "cannot_be_backfilled": "The provider serves only NOW - `?seasonId=` is accepted (HTTP "
                                    "200) and ignored, returning today's codes for any past season. "
                                    "So this is the THIRD snapshot-only fact, with probable_starter "
                                    "and flags.contract_until: every day it is not observed is a day "
                                    "that will never exist. It is stored dated in `player_roles` and "
                                    "read here as of the auction date.",
        },
        # What a formation IS, as opposed to what each coach does: every shape the season's complete
        # elevens used, league-wide, with counts. The board offers a club a shape it has never fielded
        # only if football plays it - a coach can try something new, and still not something invented.
        "formation_repertoire": league_repertoire(conn, measured, before),
        "formation_note": ("The lines are counted in the PROVIDER's vocabulary, where a winger is a "
                           "midfielder: a 4-3-3 with two wingers therefore reads 4-5-1. Measured "
                           "translation, provider slot -> listone role: G->P 100%, D->D 97%, M->C 80%, "
                           "F->A 80% (data/reports/role_crosstab.csv). Read the shape as who stands "
                           "where, not as the coach's declared module."),
        # THE FIVE THINGS A PERCENTAGE NEEDS to be a fact (§22.3/§23.4): the threshold, the home bonus
        # WITH the date it was measured on, the Elo snapshot, the window, and how many matches were
        # actually classified. Without them «6/8 (75%)» is a number nobody can audit.
        "calendar": {
            "easy_margin": fixtures.EASY_MARGIN,
            "home_away_gap": fixtures.HOME_AWAY_GAP,
            "home_bonus_applied": fixtures.HOME_ADVANTAGE,
            "home_bonus_measured_on": "1140 Serie A matches 2023-24..2025-26, home score share 0.5412; "
                                      "re-verified out of sample 10/08/2026 on 1140 held-out matches, "
                                      "where 29 beat both a refitted constant and a strength-banded "
                                      "version - the multiplicative form (x1.10/x0.80) is refuted",
            # The year the computation ACTUALLY read, and not the one the window suggests: the fixtures
            # are the TARGET season's while a sheet's input season is the one before, so stating
            # `input_season` here would have declared 2025 for a number computed on 2026. A manifest
            # that states the wrong provenance is worse than one that states none.
            "elo_year": (calendar_sample or {}).get("elo_year"),
            "window": f"{window.auction_date} -> end of {window.target_season}",
            "clubs_with_calendar": len({row.get("club") for row in rows
                                        if row.get("desc_easy_matches")}),
            "trimmed_mean": {
                "applied_to": "desc_calendar_margin",
                "rule": "a mean used to JUDGE drops its highest and lowest value when there are 5+ "
                        "samples (operator, 10/08/2026); the COUNT k/n stays whole",
            },
            "display_only": "the club-strength family was refused by the gate three times: this column "
                            "informs the decision and never enters a prediction (§23.3)",
        },
        "not_measurable": {
            "club_relationship": "no source in the whitelist states it. The proxies actually measured "
                                 "are desc_contract_until, desc_exit_risk, desc_arrival*, "
                                 "desc_transfer_fee, desc_seasons_at_club and desc_new_coach.",
            "set_piece_duty": "the votes API never fills assists_set_piece, so corners and free kicks "
                              "cannot be attributed. Penalties are, revealed from our own votes.",
            "coach_ideas": "not stated anywhere either. What is measured: who the coach is and since "
                           "when, whether he is new, the formation of today's probabili, and how many "
                           "players per line the club actually fielded last season.",
        },
        "column_coverage": filled,
        "evidence_age": evidence,
        "notes": notes,
    }
    (folder / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    progress.finish()
    print(f"[snapshot] {len(rows)} players · {len(club_rows)} clubs -> {folder}")
    thin = [column for column, count in filled.items()
            if column.startswith(("engine_", "desc_")) and count < len(rows) * 0.2]
    if thin:
        print(f"[snapshot] thin columns (<20% filled): {', '.join(thin)}")
    for line in notes:
        print(f"[snapshot] note: {line}")
    return manifest
