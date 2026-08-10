/* Where the repository is, derived instead of typed.
 *
 * The scratchpad version of this bench hard-coded `D:/Projects/FantAssistant`, which is exactly the kind
 * of thing that stops a script from surviving the move it was written for. */
export const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
export const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
export const config = (name) => `${ROOT}config/${name}`;
export const work = (name) => `${HERE}${name}`;
