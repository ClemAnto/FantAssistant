/**
 * How long a tooltip may be, and where the rest of the sentence goes.
 *
 * The operator's rule of 15/08/2026: never more than a couple of lines. A hover is read standing at an
 * auction table with the clock running - it has to answer «cos'è questo numero?» in one breath - while
 * the long version is not thrown away: it moves into «Come si leggono queste colonne», the panel under
 * the table, where it can be read sitting down and re-read tomorrow.
 *
 * 140 characters is about two lines at the width ng-zorro gives a tooltip. It is a DISPLAY choice and
 * it is enforced by a test rather than by good intentions, because these strings grow one clause at a
 * time and nobody notices the day they stop being readable.
 */
export const TOOLTIP_MAX = 140;

/** Una data ISO come la legge un italiano: `2026-08-17` -> `17/08/2026`. */
export const itDate = (iso: string): string => iso.split('-').reverse().join('/');

/** Cuts a sentence at the last word that fits, and says that it was cut. */
export function short(text: string, max: number = TOOLTIP_MAX): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[·,;:]$/, '').trim()}…`;
}
