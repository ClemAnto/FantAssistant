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

/**
 * Una data come la legge un italiano: `2026-08-17` -> `17/08/2026`.
 *
 * SI LAVORA IN UTC E SI MOSTRA IN LOCALE (regola dell'operatore, 16/09/2026), e questa funzione è
 * dove la seconda metà accade. La distinzione sta QUI dentro e non nei punti di chiamata, perché è
 * quella che si sbaglia:
 *
 * - una DATA PURA (`2026-08-17`) non ha un fuso. È il giorno in cui una partita si è giocata, in cui
 *   una pagina è stata letta, in cui una dritta è stata dichiarata: convertirla vorrebbe dire
 *   inventarle un'ora che non ha, e a seconda del segno la sposterebbe di un giorno. Si riscrive e
 *   basta.
 * - un ISTANTE (`2026-09-16T06:45:27+00:00`) ce l'ha, ed è in UTC perché tutto quello che questo
 *   progetto scrive lo è. Il giorno da mostrare è quello che l'operatore stava vivendo in quel
 *   momento, non quello del meridiano di Greenwich — e i due differiscono per le due ore dopo la
 *   mezzanotte, cioè proprio quando il lavoro notturno gira.
 *
 * Il taglio a dieci caratteri di un istante (`iso.slice(0, 10)`) è la forma sbagliata di questa
 * funzione, ed era ripetuta in tre punti: la pastiglia della freschezza e le intestazioni di Squadre e
 * Grafici. Un pacchetto scritto all'01:30 italiane si sarebbe letto «del giorno prima».
 *
 * `localDay` e' la stessa cosa in forma ISO, per chi sui giorni deve CONTARE invece che stamparli (la
 * pastiglia conta l'eta'): una definizione e due formati, o le due meta' finirebbero per non essere
 * d'accordo. Una stringa che non si riesce a leggere torna com'e' da tutt'e due.
 */
export const localDay = (iso: string): string => {
  if (!iso.includes('T')) return iso;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso;
  const pad = (one: number) => String(one).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
};

export const itDate = (iso: string): string => {
  if (!iso.includes('T')) return iso.split('-').reverse().join('/');
  const when = new Date(iso);
  // Una stringa che non si riesce a leggere si mostra COM'E'. Tagliarla a dieci caratteri e girarla
  // produrrebbe un finto giorno da un valore incomprensibile (`non-una-data-T` -> `da/una/non`), e un
  // numero inventato e' peggio di un numero illeggibile: il secondo lo si va a guardare.
  if (Number.isNaN(when.getTime())) return iso;
  return localDay(iso).split('-').reverse().join('/');
};

/** Cuts a sentence at the last word that fits, and says that it was cut. */
export function short(text: string, max: number = TOOLTIP_MAX): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[·,;:]$/, '').trim()}…`;
}
