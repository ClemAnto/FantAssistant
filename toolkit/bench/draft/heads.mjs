/* Item 1.4: can we tell what each rival RANKS BY, from the picks he has already made - and does knowing it
 * predict his next pick better than the one policy the panel uses for everybody?
 *
 * The panel assumes one head for all of them: «the dearest man he still needs» (`predictRivalPick`), which
 * is the engine's `prezzo` head bar the tail's currency. Here that assumption is the BASELINE and the
 * candidate is «guess his head from his history, then predict with the guess».
 *
 * WHAT IS IDENTIFIABLE, and it has to be said before the numbers. The table's `giudizio` head is
 * `price x (0.7 + 0.6 x noise)` with the noise FIXED PER PLAYER and private to him: nothing we can see
 * carries it, so that head is knowable only up to its systematic part, which is the price. So the classifier
 * is offered three heads (`prezzo`, `surplus`, `valore`) and a `giudizio` rival is expected to read as
 * `prezzo` - that is not a failure of the classifier, it is the information the table does not emit. The
 * report counts him apart, the way a baseline that cannot answer for a promoted club is counted apart.
 *
 *   node heads.mjs [league]
 */
import { EVERY_KIND, KIND, MIXED, bestUnder, makeDraft, rankUnder, setupFrom } from './engine.mjs';
import { appNeed } from './engine.mjs';
import { loadLeagues, loadShapes, loadWindows, NL, SEEDS } from './bench.mjs';

/** The heads a classifier may propose. `giudizio` is deliberately NOT here - see the note above. */
const HEADS = ['prezzo', 'surplus', 'valore'];

/** The panel's own single assumption, in the engine's vocabulary. */
const BASELINE = 'prezzo';

/**
 * How many of his picks we insist on seeing before trusting the guess.
 *
 * Below it the prediction falls back to the baseline, because «one pick suggests a head» is exactly the
 * kind of claim this project keeps retiring. Reported at three values so the answer carries its own
 * sensitivity instead of one arbitrary choice.
 */
const WARMUPS = [2, 4, 8];

/**
 * The app cannot see WHERE in the round a past pick happened - `feed.picks()` is a list, not a seating plan -
 * so its classifier scores the evidence with the tail rule OFF. That is a difference between what was
 * measured and what ships, and the way to settle it is to measure it: this row scores the evidence tail-free
 * and then predicts against the real state, which is exactly the shipped procedure.
 */
const SHIPPED_WARMUP = 2;

const table = setupFrom(loadLeagues(), process.argv[2] ?? 'EuroLeghe');
// `mixed` is the model of the real table; `every` puts all four heads at it, three seats each, so the
// classifier is also asked about a head the real table does not contain (a `valore` rival).
const SEATING = process.argv[3] === 'every' ? EVERY_KIND : MIXED;
const windows = loadWindows(process.argv[3] ?? 'windows.json');
const shapes = loadShapes(table.game);
const SEATS = [0, 1, 2];

const ask = (state, quality) => bestUnder({ ...state, quality, need: appNeed, ctx: state.ctx });
const rankOf = (state, quality, id) => {
  const rows = rankUnder({ ...state, quality, need: appNeed, ctx: state.ctx });
  const at = rows.findIndex((row) => row.player.id === id);
  return { rank: at < 0 ? rows.length : at + 1, of: rows.length };
};

const tally = () => ({ hits: 0, seen: 0 });
const results = {
  perWindow: new Map(),
  confusion: new Map(),          // true kind -> guessed kind -> count
  ranks: new Map(),              // predictor -> [ranks of the actual pick]
};

for (const key of Object.keys(windows)) {
  const w = windows[key];
  const draft = makeDraft(w.players, shapes, table);
  const cell = { baseline: tally(), guessed: new Map(WARMUPS.map((n) => [n, tally()])), shipped: tally() };
  results.perWindow.set(key, cell);

  for (const seed of SEEDS) for (const seat of SEATS) {
    // Evidence per rival: how many of his past picks each head would have called correctly. `blind` is the
    // same evidence scored WITHOUT the tail rule, which is all the app can do.
    const evidence = new Map();
    const blind = new Map();
    const guessFrom = (book, id, warmup) => {
      const scores = book.get(id);
      if (!scores || scores.picks < warmup) return BASELINE;
      let best = BASELINE;
      for (const head of HEADS) if (scores[head] > scores[best]) best = head;
      return best;
    };
    const guessFor = (id, warmup) => guessFrom(evidence, id, warmup);

    draft({
      seat,
      seed,
      policy: { need: appNeed, currency: (p) => p.value, floor: Infinity },
      table: SEATING,
      observe: (state) => {
        if (state.isMine || !state.choice) return;
        const id = state.team.id;
        const truth = state.kind;
        const args = {
          team: state.team, pool: state.pool, places: state.places,
          keeperCap: state.keeperCap, tail: state.fromEnd <= 2,
          ctx: { round: state.round, rounds: table.rounds, keepers: state.keeperCap, shapes,
                 pool: state.pool, slotsLeft: state.slotsLeft, teams: table.teams },
        };

        // What each predictor says, BEFORE this pick is used as evidence: predicting with a pick you have
        // already seen would be scoring the classifier on its own training row.
        const baselineSays = ask(args, (p) => KIND[BASELINE](p, 0));
        if (baselineSays) {
          cell.baseline.seen += 1;
          if (baselineSays.id === state.choice.id) cell.baseline.hits += 1;
          const r = rankOf(args, (p) => KIND[BASELINE](p, 0), state.choice.id);
          (results.ranks.get('baseline') ?? results.ranks.set('baseline', []).get('baseline'))
            .push(r.rank / r.of);
        }
        for (const warmup of WARMUPS) {
          const head = guessFor(id, warmup);
          const says = ask(args, (p) => KIND[head](p, 0));
          const scores = cell.guessed.get(warmup);
          if (says) {
            scores.seen += 1;
            if (says.id === state.choice.id) scores.hits += 1;
          }
        }
        // The shipped procedure: head guessed from tail-blind evidence, prediction against the real state.
        const shippedHead = guessFrom(blind, id, SHIPPED_WARMUP);
        const shippedSays = ask(args, (p) => KIND[shippedHead](p, 0));
        if (shippedSays) {
          cell.shipped.seen += 1;
          if (shippedSays.id === state.choice.id) cell.shipped.hits += 1;
        }

        // ...and only now does this pick become evidence, in both books.
        const noTail = { ...args, tail: false };
        for (const [book, at] of [[evidence, args], [blind, noTail]]) {
          let scores = book.get(id);
          if (!scores) {
            scores = { picks: 0, truth };
            for (const head of HEADS) scores[head] = 0;
            book.set(id, scores);
          }
          scores.picks += 1;
          for (const head of HEADS) {
            const says = ask(at, (p) => KIND[head](p, 0));
            if (says && says.id === state.choice.id) scores[head] += 1;
          }
        }
      },
    });

    // The classification itself, judged at the END of the draft: what would we have concluded about him?
    for (const [, scores] of evidence) {
      const guess = (() => {
        let best = BASELINE;
        for (const head of HEADS) if (scores[head] > scores[best]) best = head;
        return best;
      })();
      const row = results.confusion.get(scores.truth) ?? new Map();
      row.set(guess, (row.get(guess) ?? 0) + 1);
      results.confusion.set(scores.truth, row);
    }
  }
  console.log(`done ${key} (${w.target}, ${w.players.length} quoted)`);
}

const pct = (t) => (t.seen ? (100 * t.hits) / t.seen : NaN);
const keys = [...results.perWindow.keys()];

console.log(NL + '=== HIT RATE on the rivals\' next pick: the panel\'s single head against a guessed one');
console.log(`${'predictor'.padEnd(28)}${keys.map((k) => k.padStart(9)).join('')}${'mean'.padStart(9)}${'won'.padStart(7)}`);
const rows = [
  ['panel: sempre «il piu\' caro»', (cell) => cell.baseline],
  ...WARMUPS.map((n) => [`testa stimata, warmup ${n}`, (cell) => cell.guessed.get(n)]),
  ['APP: evidenza senza coda', (cell) => cell.shipped],
];
const base = keys.map((k) => pct(results.perWindow.get(k).baseline));
for (const [label, pick] of rows) {
  const xs = keys.map((k) => pct(pick(results.perWindow.get(k))));
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const wins = xs.filter((x, i) => x > base[i]).length;
  console.log(`${label.padEnd(28)}${xs.map((x) => `${x.toFixed(1)}%`.padStart(9)).join('')}`
    + `${`${mean.toFixed(1)}%`.padStart(9)}`
    + `${(label.startsWith('panel') ? '-' : `${wins}/${xs.length}`).padStart(7)}`);
}

console.log(NL + '=== WHAT THE CLASSIFIER CONCLUDES about a rival at the end of a draft');
console.log(`${'his TRUE head'.padEnd(16)}${HEADS.map((h) => h.padStart(11)).join('')}${'right'.padStart(9)}`);
for (const [truth, row] of results.confusion) {
  const total = [...row.values()].reduce((a, b) => a + b, 0);
  const right = truth === 'giudizio' ? row.get('prezzo') ?? 0 : row.get(truth) ?? 0;
  console.log(`${truth.padEnd(16)}${HEADS.map((h) => `${(100 * (row.get(h) ?? 0) / total).toFixed(0)}%`.padStart(11)).join('')}`
    + `${`${(100 * right / total).toFixed(0)}%`.padStart(9)}`);
}
console.log(NL + 'For `giudizio` «right» means `prezzo`: his noise is private, so the price is all of him'
  + ' that the table emits. Anything else about him is not measurable from the outside.');

const ranks = results.ranks.get('baseline') ?? [];
if (ranks.length) {
  const mean = ranks.reduce((a, b) => a + b, 0) / ranks.length;
  console.log(NL + `Where the actual pick sat under the panel's own head: mean percentile ${(100 * mean).toFixed(1)}%`
    + ` of the free pool over ${ranks.length} picks (1% = he took whom the panel expected).`);
}
