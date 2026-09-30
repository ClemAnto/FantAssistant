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
  DEFAULT_HEAD,
  DEPTH_WEIGHT,
  HEAD_WORTH,
  TAIL_POSITIONS,
  TAIL_PRICE_FLOOR,
  SURVIVOR_DISCOUNT,
  capBlocks,
  classifyRivals,
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
  bestEleven,
  placesIn,
  placesOf,
} from '../../../app/src/app/core/mantra-legal';

export {
  lambdaOf,
  netOf,
  slotShares,
  surplusOf,
  valueOf,
} from '../../../app/src/app/core/auction-value';

/* The Draft Priority AS THE APP SHIPS IT (`manValue` = the SeSw of 30/09/2026) and RAR, the rarity of a free
 * man: the two halves of the new DP the operator asked to be measured here before it enters the panel. */
export {
  baseRole as priorityBaseRole, manValue, priorities as appPriorities, roleStats as priorityRoleStats,
} from '../../../app/src/app/core/draft-priority';
export { rarity } from '../../../app/src/app/core/draft-rarity';
