/**
 * ACCOPPIARE DUE PORTIERI: quante giornate della competizione ne hanno almeno uno con la porta al
 * sicuro. The operator's question of 03/09/2026, and the whole of it is about the CALENDAR.
 *
 * Nothing here predicts a footballer, and nothing here decides what «facile» means. Both of those are
 * measurements and live in the toolkit (`modules/fixtures.py`): the bundle's `calendar.json` arrives
 * with every match already carrying the home side's EDGE - its level, the venue and the opponent's
 * level in one subtraction - and, for the championship the coefficients were fitted on, the
 * probability that each side concedes nothing. What this file does is COUNT: which matchdays fall
 * inside the competition the operator declared, and what two clubs cover between them.
 *
 * WHY A PAIR IS THE UNIT. A fanta squad fields ONE keeper, so the second one is not depth in the sense
 * a fourth midfielder is: he is the man who plays on the matchdays the first one is a bad bet. That is
 * `metrica-asta-surplus-v1.md` §24 read from the calendar's side - «un'assicurazione si prezza contro
 * quello che ti copre gia'» - and it is why the two are ranked TOGETHER and never one at a time.
 *
 * TWO NUMBERS, TWO NAMES, and the reason is measured. `facili` is the operator's own rule applied to
 * the letter (edge over the frozen margin, at least one of the two); but on the 2026-27 calendar that
 * rule reads ZERO for twelve Serie A clubs of twenty, so most pairs tie at nothing and a ranking on it
 * alone would say «buy Inter's keeper» to everybody. `covered` is the same sentence with the
 * probability where the coin was - the expected number of matchdays on which at least one of the two
 * keeps a clean sheet - so it breaks the ties the count cannot. His rule decides, the expectation
 * orders inside it; the screen names both and never blends them into one figure.
 */

/** The bundle's calendar, as `fixtures.schedule` writes it. Read, never recomputed. */
export interface CalendarClub {
  key: string;
  /** OUR canonical name, resolved in the toolkit - null for a club outside the perimeter. */
  name: string | null;
  fcClubId: number | null;
  elo: number | null;
}

/** `[round, date, homeKey, awayKey, edgeHome, csHome, csAway]`, the toolkit's own column order. */
export type CalendarRow = [
  number,
  string,
  string,
  string,
  number | null,
  number | null,
  number | null,
];

export interface CalendarFile {
  season: string;
  elo_year: string;
  observed_on: string | null;
  easy_margin: number;
  /** The label's threshold on the PROBABILITY - see `LeagueCalendar`. Older bundles have none. */
  easy_probability?: number;
  home_advantage: number;
  clean_sheet: {
    intercept: number;
    slope_per_100: number;
    sample: number;
    leagues: string[];
    at_margin: number;
  };
  leagues: Record<
    string,
    {
      rounds: number;
      unclassified: number;
      clean_sheet_fitted: boolean;
      clubs: { key: string; name: string | null; fc_club_id: number | null; elo: number | null }[];
      columns: string[];
      matches: CalendarRow[];
    }
  >;
}

/** One match as a club sees it: whom, where, and how safe its own goal is. */
export interface ClubMatch {
  round: number;
  date: string;
  /** The opponent's canonical name where we have one, else the calendar's own key. */
  opponent: string;
  home: boolean;
  /** Level + venue - opponent, from the bundle. Null when a level was missing on either side. */
  edge: number | null;
  /** P(this club concedes nothing). Null outside the championship the coefficients were fitted on. */
  cleanSheet: number | null;
  /** The operator's own rule: the edge clears the frozen margin. */
  easy: boolean;
}

/**
 * The calendar of ONE championship, ready to be counted: per club, per matchday, one match.
 *
 * A club can carry two matches on one round only through a postponement the provider has already
 * moved, and `fixtures` is keyed on the match, so the last one written wins - stated rather than
 * silently averaged. The unit is the MATCH and the round is what the operator's window is expressed
 * in, which is why both travel on the row.
 */
export class LeagueCalendar {
  private readonly byClub = new Map<string, Map<number, ClubMatch>>();
  /** Canonical name -> the key the calendar is written in. The join, resolved in the toolkit. */
  private readonly keyByName = new Map<string, string>();
  private readonly nameByKey = new Map<string, string>();

  constructor(
    readonly league: string,
    readonly rounds: number,
    readonly cleanSheetFitted: boolean,
    clubs: CalendarClub[],
    matches: CalendarRow[],
    readonly easyMargin: number,
    /**
     * The threshold the label is decided by WHERE THE PROBABILITY EXISTS - and since 03/09/2026 the
     * probability reads the last ten matches' goals of both clubs, not only the Elo.
     *
     * So the verdict cannot live on the edge any more: two matches at the same edge against a side
     * scoring 0.8 and one scoring 2.0 are not the same match, which is the whole point of the channel
     * the operator asked for. The two thresholds are pinned together in the toolkit (`EASY_PROBABILITY`
     * is the edge-only model's answer at `EASY_MARGIN`), so a club whose form we cannot read - a
     * promoted side - is labelled exactly as before instead of changing colour for being new.
     */
    readonly easyProbability: number | null,
  ) {
    /** His rule, with the unit it is decided in: the probability where there IS one - a threshold in
     *  the file and a probability on the match - and the edge everywhere else. Never both, or one
     *  screen would answer «facile» in two ways. */
    const isEasy = (edge: number | null, cleanSheet: number | null) =>
      easyProbability != null && cleanSheet != null
        ? cleanSheet > easyProbability
        : edge != null && edge > easyMargin;
    for (const club of clubs) {
      if (club.name) {
        this.keyByName.set(club.name, club.key);
        this.nameByKey.set(club.key, club.name);
      }
    }
    for (const [round, date, home, away, edge, csHome, csAway] of matches) {
      this.put(home, {
        round,
        date,
        opponent: this.label(away),
        home: true,
        edge,
        cleanSheet: csHome,
        easy: isEasy(edge, csHome),
      });
      const awayEdge = edge == null ? null : -edge;
      this.put(away, {
        round,
        date,
        opponent: this.label(home),
        home: false,
        edge: awayEdge,
        cleanSheet: csAway,
        easy: isEasy(awayEdge, csAway),
      });
    }
  }

  private put(key: string, match: ClubMatch): void {
    const rounds = this.byClub.get(key) ?? this.byClub.set(key, new Map()).get(key)!;
    rounds.set(match.round, match);
  }

  private label(key: string): string {
    return this.nameByKey.get(key) ?? key;
  }

  /** Whether this calendar can say anything at all about a club - by the name a sheet row carries. */
  has(clubName: string): boolean {
    const key = this.keyByName.get(clubName);
    return key != null && this.byClub.has(key);
  }

  /** The clubs it knows, by OUR canonical name, in alphabetical order. */
  clubNames(): string[] {
    return [...this.keyByName.keys()].sort((a, b) => a.localeCompare(b, 'it'));
  }

  /**
   * A club's matches inside the declared competition window, one per matchday.
   *
   * A matchday the club has no fixture for is ABSENT and not a zero: at a free-extraction auction the
   * question is «how many of the competition's matchdays are covered», and a round nobody plays is not
   * a round somebody failed to cover.
   */
  window(clubName: string, from: number, to: number): ClubMatch[] {
    const key = this.keyByName.get(clubName);
    const rounds = key == null ? null : this.byClub.get(key);
    if (!rounds) return [];
    const out: ClubMatch[] = [];
    for (let round = Math.max(1, from); round <= to; round += 1) {
      const match = rounds.get(round);
      if (match) out.push(match);
    }
    return out;
  }
}

/** One matchday of a pair: what each of the two plays, and whether his rule fires. */
export interface PairRow {
  round: number;
  a: ClubMatch | null;
  b: ClubMatch | null;
  /** The operator's «FACILE»: at least one of the two is easy. */
  facile: boolean;
}

/** What a pair of clubs covers over the window - his count, and the expectation that breaks its ties. */
export interface PairCover {
  /** Matchdays on which at least one of the two has an EASY match: the operator's own rule. */
  facili: number;
  /** Matchdays either of them has a fixture in - the denominator, and never assumed to be `to - from`. */
  matchdays: number;
  /**
   * Expected matchdays with at least one clean sheet: `sum over md of 1 - (1-pA)(1-pB)`.
   *
   * Null where the championship has no fitted probability, because an unfitted pair must not be ranked
   * against a fitted one on a number that does not exist for it.
   */
  covered: number | null;
  /** The matchdays themselves, for the popover: what each of the two plays and which side is easy. */
  rows: PairRow[];
}

/**
 * What two clubs cover between them over the window.
 *
 * Passing the SAME club twice is legal and answers «what does this club alone cover», which is what a
 * grid's diagonal is: the two matches are then one match, so the union is that match and the
 * probability is not squared. `sameClub` says so explicitly rather than being guessed from the name.
 */
export function pairCover(a: ClubMatch[], b: ClubMatch[], sameClub = false): PairCover {
  const rounds = new Map<number, PairRow>();
  const take = (matches: ClubMatch[], side: 'a' | 'b') => {
    for (const match of matches) {
      const row = rounds.get(match.round) ?? { round: match.round, a: null, b: null, facile: false };
      row[side] = match;
      rounds.set(match.round, row);
    }
  };
  take(a, 'a');
  if (!sameClub) take(b, 'b');

  let facili = 0;
  let covered = 0;
  let known = 0;
  const rows = [...rounds.values()].sort((left, right) => left.round - right.round);
  for (const row of rows) {
    row.facile = Boolean(row.a?.easy || row.b?.easy);
    if (row.facile) facili += 1;
    const pa = row.a?.cleanSheet;
    const pb = row.b?.cleanSheet;
    if (pa == null && pb == null) continue;
    known += 1;
    covered += 1 - (1 - (pa ?? 0)) * (1 - (pb ?? 0));
  }

  return {
    facili,
    matchdays: rows.length,
    covered: rows.length > 0 && known === rows.length ? covered : null,
    rows,
  };
}

/**
 * WHAT ONE CLUB COVERS ON ITS OWN, which is a pair with itself and therefore already defined.
 *
 * Written once because three callers need it - the grid's own gain, a suggestion's gain, and the
 * operator's rule below - and three copies of a subtraction is how one screen ends up with two
 * answers to «quante ne ha da solo».
 */
export function aloneCover(calendar: LeagueCalendar, club: string, from: number, to: number): number {
  const own = calendar.window(club, from, to);
  return pairCover(own, own, true).facili;
}

/**
 * HIS RULE, 03/09/2026, in his own words and with his own number: «non consigliare i portieri di
 * squadre che da sole hanno già 25 o più partite facili».
 *
 * It replaced the first reading of «togli i TOP dai suggerimenti», which had been taken as «via il
 * primo SLOT» - i.e. by PRICE - and he retracted that himself («forse ti ho portato fuori strada
 * io»). The measurement agreed with him before he wrote it: on Butez, the price cut removed eleven of
 * the fourteen best partners, Skorupski among them, while Provedel came top not because he is dear
 * (FVM 5) but because he is Inter's, whose calendar carries 34 easy matchdays on its own.
 *
 * IT IS A QUOTA AND NOT A COUNT, and that is the only thing added to what he said: 25 is his number
 * on a whole championship, and on the three-matchday window of his other league nobody has 25 of
 * anything - «una soglia di scoring è una QUOTA del calendario che si sta prevedendo, non un numero»
 * (the R20 lesson, met on a screen). So the rule is «two thirds of his own window», which on 38
 * rounds IS his 25.
 */
export const EASY_ALREADY_SHARE = 25 / 38;

/**
 * L'OBIETTIVO DI UN BUON ACCOPPIAMENTO, come QUOTA della finestra: «prenderne due con un ottimo
 * accoppiamento, almeno 32 partite su 38» (operatore, 08/09/2026).
 *
 * 32 è il suo numero su una stagione intera, e va tenuto come quota per la stessa ragione di
 * `EASY_ALREADY_SHARE`: su una competizione di tre giornate nessuno ha 32 di niente (la lezione R20,
 * «una soglia di scoring è una QUOTA del calendario che si sta prevedendo»). Misurato sul calendario
 * 2026-27: 64 coppie di 190 arrivano a 32 `facili`, la migliore fa 38/38 — quindi la soglia è
 * raggiungibile e seleziona, cosa che sui «coperti» (porta inviolata attesa, max 24,8) non sarebbe.
 */
export const KEEPER_PAIR_TARGET_SHARE = 32 / 38;

/** Quale strategia porta un portiere: la COPPIA complementare o i TRE di un solo supertop. */
export type KeeperPathKind = 'choose' | 'single' | 'pair' | 'third' | 'done';

/** Che tipo di terzo portiere: il VICE di un mio titolare (chiude un club) o un club NUOVO a poco. */
export type KeeperThirdKind = 'deputy' | 'club';

/** Un portiere come il piano lo maneggia: l'uomo, il club, la mia max offerta, se è il primo del club. */
export interface PlanKeeper<T> {
  man: T;
  id: number;
  club: string;
  offer: number;
  /** True se è il portiere che il campetto schiera per quel club — un vice non è un'ancora. */
  first: boolean;
}

/**
 * LA STRATEGIA DEI TRE DI UN SOLO SUPERTOP (operatore, 08/09/2026: «tre portieri di una sola squadra
 * ma a livello supertop, come Inter»).
 *
 * Un club è «supertop» quando DA SOLO raggiunge già la soglia della coppia (`alone >= target`): non
 * è una soglia nuova, è la stessa. Misurato: Inter 35/38 da sola, Roma 34, Juventus 31 — quindi tre
 * dell'Inter danno la porta GARANTITA tutte le 38 giornate (giocano sempre, nessun rischio rotazione)
 * con 35 facili, contro le 38 della migliore coppia: tre in meno, ma senza il rischio che entrambi i
 * miei di una coppia saltino la stessa giornata. È anche il complemento esatto di `EASY_ALREADY_SHARE`:
 * un club auto-coperto è un cattivo PARTNER (ridondante) e una buona ANCORA singola.
 */
export interface KeeperSingle<T> {
  club: string;
  /** Le giornate facili del club da solo — il numero che lo rende supertop. */
  alone: number;
  /** Quanti di quel club ho già in rosa. */
  owned: number;
  /** Quelli ancora comprabili, dal più economico: quello che serve per arrivare a tre. */
  available: PlanKeeper<T>[];
}

/** Una coppia complementare candidata: due club e le giornate che coprono insieme. */
export interface KeeperPairTarget {
  a: string;
  b: string;
  facili: number;
  /** Quanto la coppia aggiunge al migliore dei due da solo: distingue due calendari medi da uno già alto. */
  gain: number;
}

/** Un terzo portiere economico, dei due tipi che l'operatore ha dichiarato «pari». */
export interface KeeperThird<T> {
  man: T;
  club: string;
  offer: number;
  kind: KeeperThirdKind;
  /** Per il vice: il club di cui chiude la porta (uno di cui ho già il titolare). Null per un club nuovo. */
  locks: string | null;
}

/** Il piano adattivo: cosa conviene fare ADESSO per i portieri, capito dallo stato del tavolo. */
export interface KeeperPlan<T> {
  target: number;
  windowRounds: number;
  owned: { man: T; club: string; alone: number }[];
  /** Le due strategie, sempre calcolate così il pannello mostra il menù di entrambe. */
  singles: KeeperSingle<T>[];
  pairs: KeeperPairTarget[];
  /** In che fase sono, capita da cosa possiedo. */
  phase: KeeperPathKind;
  /** I portieri concreti da comprare adesso, i migliori per primi. Vuoto in fase «choose»/«done». */
  next: PlanKeeper<T>[];
  /** I terzi economici, quando la coppia o il singolo è a posto. */
  thirds: KeeperThird<T>[];
  /** Le giornate della mia coppia (se ho due club diversi) o del mio blocco. Null altrimenti. */
  pairFacili: number | null;
  /** True quando quello che ho già raggiunge la soglia. */
  met: boolean;
}

/**
 * COSA CONVIENE FARE ADESSO PER I PORTIERI, valutando le DUE strategie e capendo dallo stato quale.
 *
 * Su richiesta dell'operatore (08/09/2026: «il sistema deve suggerirti queste strategie capendo al
 * momento quale sia la migliore»). Non sceglie una strategia in astratto: legge cosa possiedo e cosa
 * è ancora comprabile e propone la mossa. Le due strategie sono la COPPIA complementare (≥ target
 * insieme) e i TRE di un supertop (un club che da solo ≥ target); il terzo economico ha due tipi
 * mostrati «pari». Nessun numero è inventato: `facili` è la sua regola e la soglia è la sua quota.
 */
export function planKeepers<T>(
  calendar: LeagueCalendar,
  owned: PlanKeeper<T>[],
  available: PlanKeeper<T>[],
  from: number,
  to: number,
  share = KEEPER_PAIR_TARGET_SHARE,
): KeeperPlan<T> {
  const windowRounds = Math.max(0, to - from + 1);
  const target = Math.round(share * windowRounds);

  const aloneCache = new Map<string, number>();
  const aloneOf = (club: string): number => {
    let value = aloneCache.get(club);
    if (value == null) {
      value = calendar.has(club) ? aloneCover(calendar, club, from, to) : 0;
      aloneCache.set(club, value);
    }
    return value;
  };
  const win = (club: string) => calendar.window(club, from, to);

  const ownedIds = new Set(owned.map((k) => k.id));
  const ownedByClub = new Map<string, PlanKeeper<T>[]>();
  for (const keeper of owned) {
    const list = ownedByClub.get(keeper.club) ?? [];
    list.push(keeper);
    ownedByClub.set(keeper.club, list);
  }
  const ownedList = owned.map((k) => ({ man: k.man, club: k.club, alone: aloneOf(k.club) }));

  // The clubs that field a FIRST keeper I could still buy - the anchors of both strategies.
  const availByClub = new Map<string, PlanKeeper<T>[]>();
  for (const keeper of available) {
    const list = availByClub.get(keeper.club) ?? [];
    list.push(keeper);
    availByClub.set(keeper.club, list);
  }
  const firstAvailable = (club: string): PlanKeeper<T>[] =>
    (availByClub.get(club) ?? []).filter((k) => k.first);

  // SINGLES: super-top clubs (alone >= target) I can still build three of, or already hold some of.
  const superClubs = [...new Set([...availByClub.keys(), ...ownedByClub.keys()])]
    .filter((club) => calendar.has(club) && aloneOf(club) >= target);
  const singles: KeeperSingle<T>[] = superClubs
    .map((club) => ({
      club,
      alone: aloneOf(club),
      owned: (ownedByClub.get(club) ?? []).length,
      available: [...(availByClub.get(club) ?? [])].sort((a, b) => a.offer - b.offer),
    }))
    .filter((s) => s.owned + s.available.length >= 2)
    .sort((a, b) => b.alone - a.alone);

  // PAIRS: complementary clubs whose union reaches the target. A super-top club belongs to the single
  // menu, not here - a pair of two already-covered clubs is redundant, and its GAIN would be near zero.
  const pairClubs = [...new Set([...availByClub.keys(), ...ownedByClub.keys()])].filter(
    (club) => calendar.has(club) && firstAvailable(club).length + (ownedByClub.has(club) ? 1 : 0) > 0,
  );
  const pairs: KeeperPairTarget[] = [];
  for (let i = 0; i < pairClubs.length; i += 1) {
    for (let j = i + 1; j < pairClubs.length; j += 1) {
      const a = pairClubs[i];
      const b = pairClubs[j];
      const cover = pairCover(win(a), win(b), a === b);
      if (cover.facili < target) continue;
      const better = Math.max(aloneOf(a), aloneOf(b));
      if (better >= target) continue; // both/one already self-covered - that is the single strategy
      pairs.push({ a, b, facili: cover.facili, gain: cover.facili - better });
    }
  }
  pairs.sort((left, right) => right.gain - left.gain || right.facili - left.facili);

  // THIRDS: cheap coverage, both kinds shown «pari» (his instruction): the backup of a starter I own
  // (locks that club), or a first keeper of a new club. Never invented, never ranked one over the other.
  const thirds: KeeperThird<T>[] = [
    ...available
      .filter((k) => ownedByClub.has(k.club) && !ownedIds.has(k.id))
      .map<KeeperThird<T>>((k) => ({ man: k.man, club: k.club, offer: k.offer, kind: 'deputy', locks: k.club })),
    ...available
      .filter((k) => k.first && !ownedByClub.has(k.club))
      .map<KeeperThird<T>>((k) => ({ man: k.man, club: k.club, offer: k.offer, kind: 'club', locks: null })),
  ].sort((a, b) => a.offer - b.offer);

  // THE ADAPTIVE PHASE, read from what I hold and never chosen in the abstract.
  let phase: KeeperPathKind;
  let next: PlanKeeper<T>[] = [];
  let pairFacili: number | null = null;
  let met = false;

  const distinctClubs = [...ownedByClub.keys()];
  const superOwned = distinctClubs.find(
    (club) => aloneOf(club) >= target && (ownedByClub.get(club) ?? []).length < 3 && firstAvailable(club).length + (availByClub.get(club)?.length ?? 0) > 0,
  );

  if (owned.length >= 3) {
    phase = 'done';
    pairFacili = bestOwnedFacili(ownedByClub, win, aloneOf);
    met = pairFacili != null && pairFacili >= target;
  } else if (owned.length === 0) {
    phase = 'choose';
  } else if (superOwned) {
    // On the single-club path: complete the three of that super-top club.
    phase = 'single';
    next = [...(availByClub.get(superOwned) ?? [])].sort((a, b) => a.offer - b.offer);
  } else if (owned.length === 1) {
    // Pair path: the best partner that reaches the target, ranked by the union.
    phase = 'pair';
    const mine = owned[0].club;
    next = rankPairs(
      calendar,
      mine,
      available.filter((k) => k.first && k.club !== mine).map((k) => ({ man: k, club: k.club })),
      from,
      to,
    )
      .filter((s) => s.cover.facili >= target && aloneOf(s.club) < target)
      .map((s) => s.man);
  } else {
    // Two keepers of two clubs: the pair is what it is, and the third is cheap coverage.
    phase = 'third';
    if (distinctClubs.length >= 2) {
      pairFacili = pairCover(win(distinctClubs[0]), win(distinctClubs[1])).facili;
      met = pairFacili >= target;
    } else {
      pairFacili = aloneOf(distinctClubs[0]);
      met = pairFacili >= target;
    }
  }

  return { target, windowRounds, owned: ownedList, singles, pairs, phase, next, thirds, pairFacili, met };
}

/** The best facili among the pairs of clubs I already hold - what a finished department is worth. */
function bestOwnedFacili<T>(
  ownedByClub: Map<string, PlanKeeper<T>[]>,
  win: (club: string) => ClubMatch[],
  aloneOf: (club: string) => number,
): number | null {
  const clubs = [...ownedByClub.keys()];
  if (clubs.length === 0) return null;
  if (clubs.length === 1) return aloneOf(clubs[0]);
  let best = 0;
  for (let i = 0; i < clubs.length; i += 1) {
    for (let j = i + 1; j < clubs.length; j += 1) {
      best = Math.max(best, pairCover(win(clubs[i]), win(clubs[j])).facili);
    }
  }
  return best;
}

/** A candidate keeper, ranked. */
export interface PairSuggestion<T> {
  man: T;
  club: string;
  cover: PairCover;
  /**
   * WHAT THIS SECOND KEEPER ADDS TO MINE - the union minus MY OWN calendar, and nothing else.
   *
   * The operator's observation, 03/09/2026: «il Napoli e la Juve, singolarmente, hanno 31 partite
   * facili; il Como ne ha 22 e solo insieme al Bologna arriva a 33» - a pair's TOTAL hides who brought
   * it. Measured on this bundle: of the grid's 190 pairs, **111 add two matchdays or fewer** to the
   * better of their own two clubs and only **5** beat the best single club by three or more. Same
   * shape as «an insurance is priced against what already covers you, not against nothing».
   *
   * AND THE ZERO IS THE QUESTION, so there are two of them and they have two names. Here the man I
   * already have is FIXED - he is the one I clicked - so what I want to know is what a partner adds to
   * HIM (`gain`), which also means this cannot reorder the list: `aloneMine` is a constant, and
   * ranking by the union or by the union minus a constant is the same ranking. On the GRID neither
   * club is mine, so the reference is the better of the two (`GridCell.gain`) - and THAT one does
   * reorder, which is exactly the reading his observation is about. Subtracting the better of the two
   * here was tried first and a test caught it: it ranks a strong partner below a weak one, because it
   * silently answers «how much do I add to HIM».
   */
  gain: number;
  /** The two clubs on their own, so the row can be read without arithmetic. */
  aloneMine: number;
  aloneTheirs: number;
}

/**
 * The candidates, best first: the operator's COUNT decides, the expectation breaks its ties.
 *
 * The tie-break is not a refinement, it is what makes the list readable: at the frozen margin twelve
 * Serie A clubs of twenty have no easy match all season, so on his rule alone most of the list is one
 * long tie at zero. Where the expectation does not exist (an unfitted championship) the order falls
 * back to the count and then to the club's name, so it is reproducible rather than arbitrary.
 *
 * The cover is a fact about the two CLUBS, so it is computed once per club and shared by every keeper
 * of it - the same reasoning that computes the board's pairs 25 times and not 250.
 */
export function rankPairs<T>(
  calendar: LeagueCalendar,
  mine: string,
  candidates: { man: T; club: string }[],
  from: number,
  to: number,
): PairSuggestion<T>[] {
  const ours = calendar.window(mine, from, to);
  const aloneMine = pairCover(ours, ours, true).facili;
  const byClub = new Map<string, PairCover>();
  const aloneByClub = new Map<string, number>();
  const out: PairSuggestion<T>[] = [];
  for (const candidate of candidates) {
    if (!calendar.has(candidate.club)) continue;
    const theirs = calendar.window(candidate.club, from, to);
    let cover = byClub.get(candidate.club);
    if (!cover) {
      cover = pairCover(ours, theirs, candidate.club === mine);
      byClub.set(candidate.club, cover);
      aloneByClub.set(candidate.club, pairCover(theirs, theirs, true).facili);
    }
    const aloneTheirs = aloneByClub.get(candidate.club) ?? 0;
    out.push({
      man: candidate.man,
      club: candidate.club,
      cover,
      aloneMine,
      aloneTheirs,
      gain: cover.facili - aloneMine,
    });
  }
  return out.sort(
    (left, right) =>
      right.cover.facili - left.cover.facili ||
      (right.cover.covered ?? -1) - (left.cover.covered ?? -1) ||
      left.club.localeCompare(right.club, 'it'),
  );
}

/** One cell of the club x club grid. */
export interface GridCell {
  /**
   * WHOSE matches `PairRow.a` carries, and whose `b` - and they are on the cell because the cell is
   * SHARED with its mirror.
   *
   * Computing half the grid and letting both halves read one object is right (two passes over one
   * question is how a cell and its mirror end up disagreeing), and it has a price that was paid on
   * screen: `a` and `b` are the order the pair was BUILT in, not the row and the column of the cell
   * you are looking at, so below the diagonal a caller labelling them from its axes swaps them. It
   * did - the operator's «Com + Ata» drew Atalanta's fixtures under Como and Como's under Atalanta,
   * which puts the mark on the wrong side of the row. The labels now travel with the numbers.
   */
  clubA: string;
  clubB: string;
  facili: number;
  covered: number | null;
  rows: PairRow[];
  /**
   * The two clubs alone, and what the pair adds TO THE BETTER OF THEM.
   *
   * A different zero from `PairSuggestion.gain` and deliberately so: on the grid neither club is the
   * one I own, so the honest reference is the better calendar of the two - which is what says that
   * «Como + Bologna 34» is a pair of two middling calendars while «Bologna + Napoli 38» already had
   * 32 inside it. Two questions, two names, and neither borrows the other's number.
   */
  aloneA: number;
  aloneB: number;
  gain: number;
}

/**
 * The whole grid, clubs on both axes.
 *
 * Symmetric by construction, so only half of it is computed and both halves read the SAME object: two
 * passes over one question is how a cell and its mirror end up disagreeing. The diagonal is the club
 * ALONE - not paired with itself - which is the reading that makes it comparable with its own row.
 */
export function coverGrid(
  calendar: LeagueCalendar,
  clubs: string[],
  from: number,
  to: number,
): Map<string, Map<string, GridCell>> {
  const windows = new Map(clubs.map((club) => [club, calendar.window(club, from, to)]));
  const grid = new Map<string, Map<string, GridCell>>(clubs.map((club) => [club, new Map()]));
  // Each club ALONE, once: the diagonal computes it anyway, and the gain needs it for both sides.
  const alone = new Map(clubs.map((club) => {
    const own = windows.get(club) ?? [];
    return [club, pairCover(own, own, true).facili];
  }));
  for (let i = 0; i < clubs.length; i += 1) {
    for (let j = i; j < clubs.length; j += 1) {
      const cover = pairCover(windows.get(clubs[i]) ?? [], windows.get(clubs[j]) ?? [], i === j);
      const aloneA = alone.get(clubs[i]) ?? 0;
      const aloneB = alone.get(clubs[j]) ?? 0;
      const cell: GridCell = {
        clubA: clubs[i],
        clubB: clubs[j],
        facili: cover.facili,
        covered: cover.covered,
        rows: cover.rows,
        aloneA,
        aloneB,
        // On the diagonal the pair IS the club, so it adds nothing to itself: zero, and not a number
        // that would read as a gain.
        gain: i === j ? 0 : cover.facili - Math.max(aloneA, aloneB),
      };
      grid.get(clubs[i])!.set(clubs[j], cell);
      grid.get(clubs[j])!.set(clubs[i], cell);
    }
  }
  return grid;
}

/**
 * THE WHOLE BUNDLE'S CALENDAR: every championship it carries, and which one a club plays in.
 *
 * The league is read from the calendar ITSELF - a club is in the championship whose fixtures it
 * appears in - and never from the majority of its players' rows, which is the derivation this project
 * has already written down as wrong. Two clubs of two different championships cannot be paired at all
 * here and the caller must SAY so rather than align them by hand: a fanta matchday maps to a different
 * real round in each league (`matchday_map`), and for the target season that map carries five rows of
 * thirty-one - so aligning them would be inventing a calendar, not reading one.
 */
export class CalendarBook {
  private readonly byLeague = new Map<string, LeagueCalendar>();
  private readonly leagueByClub = new Map<string, string>();

  constructor(
    readonly file: CalendarFile,
    leagues: LeagueCalendar[],
  ) {
    for (const calendar of leagues) {
      this.byLeague.set(calendar.league, calendar);
      for (const club of calendar.clubNames()) this.leagueByClub.set(club, calendar.league);
    }
  }

  /** The championship a club plays in, by OUR canonical name. Null = the calendar has never seen it. */
  leagueOf(clubName: string): string | null {
    return this.leagueByClub.get(clubName) ?? null;
  }

  /** The calendar a club's matchdays are counted on. */
  forClub(clubName: string): LeagueCalendar | null {
    const league = this.leagueOf(clubName);
    return league == null ? null : (this.byLeague.get(league) ?? null);
  }
}

/**
 * LA QUOTA DI PORTE INVIOLATE ATTESA di un club sul calendario che resta: la media di `cleanSheet`
 * sulle sue partite ancora da giocare. Null dove il campionato non ha una probabilita' fittata o il
 * club non e' nel calendario — «vuoto = ignoto», e chi legge decide cosa farne.
 *
 * Serve al bonus porta inviolata dello SWING (`swing.ts`, opzione di lega `cleanSheet`), che la paga
 * al DIFFERENZIALE contro la media del campionato (`cleanSheetBaseline`): anche il portiere che
 * giocherebbe al posto suo incassa porte inviolate, quindi il totale conterebbe due volte quello che
 * la panchina restituisce — la stessa regola delle squalifiche, «si paga il differenziale e mai il
 * totale».
 */
export function cleanSheetOutlook(calendar: LeagueCalendar, clubName: string): number | null {
  const shares = calendar
    .window(clubName, 1, calendar.rounds)
    .map((match) => match.cleanSheet)
    .filter((share): share is number => share != null);
  if (!shares.length) return null;
  return shares.reduce((sum, one) => sum + one, 0) / shares.length;
}

/**
 * La stessa quota, mediata su TUTTO il campionato: il metro del portiere «qualunque» che entrerebbe
 * al posto del titolare. Ogni partita entra due volte (una per lato), che per una media e' corretto:
 * e' la quota media di porte inviolate per club-partita.
 */
export function cleanSheetBaseline(calendar: LeagueCalendar): number | null {
  const shares: number[] = [];
  for (const club of calendar.clubNames()) {
    for (const match of calendar.window(club, 1, calendar.rounds)) {
      if (match.cleanSheet != null) shares.push(match.cleanSheet);
    }
  }
  if (!shares.length) return null;
  return shares.reduce((sum, one) => sum + one, 0) / shares.length;
}

export function calendarBookFrom(file: CalendarFile | null): CalendarBook | null {
  if (!file?.leagues) return null;
  const leagues: LeagueCalendar[] = [];
  for (const name of Object.keys(file.leagues)) {
    const one = leagueCalendarFrom(file, name);
    if (one) leagues.push(one);
  }
  return leagues.length ? new CalendarBook(file, leagues) : null;
}

/** The bundle's file into the shape above. One reader, so nothing else parses the raw columns. */
export function leagueCalendarFrom(file: CalendarFile, league: string): LeagueCalendar | null {
  const one = file.leagues?.[league];
  if (!one) return null;
  return new LeagueCalendar(
    league,
    one.rounds,
    one.clean_sheet_fitted,
    one.clubs.map((club) => ({
      key: club.key,
      name: club.name,
      fcClubId: club.fc_club_id,
      elo: club.elo,
    })),
    one.matches,
    file.easy_margin,
    // A bundle written before 03/09/2026 carries no probability threshold, and NULL is the honest
    // answer: without it the label stays on the edge exactly as it was, because an older artefact is
    // read with the rule it was written under and never with today's. A number would have been worse
    // than nothing - a threshold nothing can clear reads as «no easy match anywhere».
    file.easy_probability ?? null,
  );
}
