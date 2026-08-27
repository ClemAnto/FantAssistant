// I TOKEN DI UN TEMA, letti dai file SPEDITI - una definizione sola, perché i lettori sono due.
//
// `audit-contrast.mjs` misura i rapporti di contrasto e `make-favicon.mjs` disegna l'icona con i colori
// del marchio: due domande diverse sullo stesso fatto. Con due parser lo stesso `--color-primary`
// finirebbe prima o poi per essere letto in due modi, e il primo a sbagliare sarebbe quello che nessuno
// guarda - il difetto che questo repo paga ogni volta che una quantità ha due definizioni.
//
// Il modello della cascata è quello del browser: il tema di DEFAULT è la tavolozza di base (il suo
// blocco `@theme static`), un tema in più è quella base con i propri `:root[data-theme="x"]` sopra.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const THEMES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles', 'themes');
export const DEFAULT_THEME = 'default.css';

/** Every `--color-x: #hex` in a file, whichever block it sits in. */
export function palette(css) {
  const found = new Map();
  for (const [, name, value] of css.matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    found.set(name, value);
  }
  return found;
}

/**
 * La tavolozza completa di un tema: la base più le sue sostituzioni.
 *
 * Un token che non c'è NON prende un ripiego: chi lo chiede riceve `undefined` e deve dirlo. Un'icona
 * disegnata con un colore inventato al posto di quello del marchio sarebbe indistinguibile da una
 * disegnata bene, ed è la ragione per cui questa funzione non ha un default.
 */
export function themeColors(file = DEFAULT_THEME) {
  const base = palette(readFileSync(join(THEMES_DIR, DEFAULT_THEME), 'utf8'));
  if (file === DEFAULT_THEME) return base;
  return new Map([...base, ...palette(readFileSync(join(THEMES_DIR, file), 'utf8'))]);
}

export function rgb(hex) {
  const h = hex.slice(1);
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
}

export function luminance(hex) {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1: il rapporto fra le due luminanze, il più chiaro sopra. */
export function ratio(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}
