/* What the bench borrows from the APP. It is a re-export and not a copy, on purpose: the whole point of
 * the bench is to judge the code the panel really runs, and a second implementation of `needFor` would be
 * two policies and two truths (the repository's own rule about repeated definitions).
 *
 * A CANDIDATE policy is not in here - it lives in `policies.mjs` until it wins a verdict. The order is
 * the golden rule's: measure on the bench, then change the panel, then the bench reads it from the panel.
 *
 * Bundled by `build.mjs` into `appcode.mjs` with the app's own esbuild. Neither module touches Angular -
 * `auction-plan` imports only types and `slotShares` from `auction-value` - so the bundle is plain JS. */
export {
  COVER_COPIES,
  DEPTH_WEIGHT,
  TAIL_POSITIONS,
  TAIL_PRICE_FLOOR,
  SURVIVOR_DISCOUNT,
  coverNeedOf,
  goneBeforeOurNextTurn,
  lineOf,
  needFor,
  needForUs,
  pickForUs,
  predictRivalPick,
  startingPlaces,
} from '../../../app/src/app/core/auction-plan';

/* The legality itself. The bench has no copy of it: `legal.mjs` re-exports these and adds only the two
 * things the app never does - score a season's outcome, and pick the best eleven by a weight. */
export {
  assign,
  augments,
  bestCovered,
  placesOf,
} from '../../../app/src/app/core/mantra-legal';

export {
  lambdaOf,
  netOf,
  slotShares,
  surplusOf,
  valueOf,
} from '../../../app/src/app/core/auction-value';
