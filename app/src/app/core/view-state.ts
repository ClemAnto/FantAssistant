import { Signal, WritableSignal, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

/**
 * Where a setting lives, so that a refresh finds the page as it was left.
 *
 * TWO places and one rule, because they answer two different questions:
 *
 *  - the ADDRESS carries what the page is ABOUT - listone, squadra, stagione, filtri, ordinamento,
 *    quale delle due tabelle. It is the selection, so it must be shareable, re-openable and walkable
 *    with the Back button, and it is the rule this app already kept for the squads view: «the selection
 *    lives in the URL, and the URL is the only place it lives».
 *  - LOCAL STORAGE carries how you like to READ it - stelline o 0-99, filtri aperti o chiusi. Those are
 *    not about the page: they follow the operator from one view to the next and from one session to the
 *    next, and putting them in the address would make two screens disagree about one preference.
 *
 * The one thing neither may do is hold a value twice. Every field below is written by the binder and by
 * nobody else, so there is never a second writer that could say something different.
 */

/** One setting that travels in the address. */
export interface QueryField {
  /** Its name in the address bar. */
  param: string;
  /** What it says now, as text - null when it sits at its default and the address should stay clean. */
  read: () => string | null;
  /**
   * Take it from the address. `null` = the address does not carry it, so restore the default.
   *
   * It must be IDEMPOTENT and check before it writes: several of these are store methods with side
   * effects (choosing a listone empties the club filter, choosing a season resets the window), and a
   * blind re-apply on every navigation would wipe the very fields applied beside it.
   */
  apply: (raw: string | null) => void;
  /** True for a choice the Back button should walk through - a click. Everything else replaces. */
  push?: boolean;
}

/**
 * Binds a view's settings to the query string, in BOTH directions.
 *
 * The address is applied first and the state is written back after, never the other way round, so a link
 * that is opened decides what is on screen. `ready` holds both halves until the bundle is in: applying
 * `?club=Napoli` to a store with no clubs yet would resolve to nothing and then be written back as an
 * empty address - which is how a shared link loses what it was sharing.
 *
 * Call it from a component constructor (it needs an injection context).
 */
export function bindQuery(fields: QueryField[], ready: Signal<boolean>): void {
  const router = inject(Router);
  const route = inject(ActivatedRoute);
  const params = toSignal(route.queryParamMap);
  /** Nothing is written to the address before it has been read from it. */
  const restored = signal(false);
  let last: Record<string, string | null> = {};

  effect(() => {
    const map = params();
    if (!map || !ready()) return;
    /*
     * UNTRACKED, and this is the whole trick: every `apply` READS the signal it is about (it checks
     * before it writes), so without this the effect would depend on the state it applies - and then a
     * click would re-run it against the OLD address and be undone by a parameter that is not there yet.
     * Measured: choosing EuroLeghe snapped back to Serie A before the address was even written.
     */
    untracked(() => {
      for (const field of fields) field.apply(map.get(field.param));
    });
    restored.set(true);
  });

  effect(() => {
    // Read every field FIRST, so this effect depends on all of them however the guards below fall.
    const wanted: Record<string, string | null> = {};
    let push = false;
    for (const field of fields) {
      wanted[field.param] = field.read();
      if (field.push && field.param in last && last[field.param] !== wanted[field.param]) push = true;
    }
    if (!ready() || !restored()) return;
    last = wanted;
    void router.navigate([], {
      relativeTo: route,
      queryParams: wanted,
      queryParamsHandling: 'merge',
      // A click on another club is a step; dragging a slider is not, and a history full of matchday
      // windows would make the Back button useless.
      replaceUrl: !push,
    });
  });
}

/** `1` / `0` in the address: shorter than true/false and just as readable. */
export const asFlag = {
  read: (value: boolean): string | null => (value ? '1' : null),
  apply: (raw: string | null): boolean => raw === '1',
};

/**
 * A signal kept in `localStorage`, for the preferences that are not about the page.
 *
 * Storage can be unavailable or full (a private window, a quota), and a preference is never worth an
 * exception: a failed read falls back to the default and a failed write is dropped. What must NOT
 * happen is a stored value the code no longer understands - hence `accepts`, so an old «medium» left
 * over from another version cannot put the table in a state it has no rendering for.
 */
export function stored<T extends string>(
  key: string,
  initial: T,
  accepts: readonly T[],
): WritableSignal<T> {
  const saved = read(key);
  const value = signal<T>(accepts.includes(saved as T) ? (saved as T) : initial);
  effect(() => write(key, value()));
  return value;
}

/**
 * ...e lo stesso per una LISTA di cose, che è quello che sono i filtri salvati.
 *
 * Quello che è scritto sul disco può essere di una versione precedente dell'app, quindi si valida invece
 * di fidarsi: un JSON illeggibile, o che non è una lista, torna il valore iniziale. Un filtro salvato che
 * non si capisce più è un filtro perso, e va bene; una pagina che non si apre no.
 */
export function storedList<T>(key: string, accepts: (one: unknown) => one is T): WritableSignal<T[]> {
  let initial: T[] = [];
  try {
    const saved: unknown = JSON.parse(read(key) ?? '[]');
    if (Array.isArray(saved)) initial = saved.filter(accepts);
  } catch {
    // Scritto da un'altra versione, o corrotto: si riparte da vuoto.
  }
  const value = signal<T[]>(initial);
  effect(() => write(key, JSON.stringify(value())));
  return value;
}

/** ...and the same for a plain yes/no, which is what a collapsed panel is. */
export function storedFlag(key: string, initial: boolean): WritableSignal<boolean> {
  const saved = read(key);
  const value = signal<boolean>(saved == null ? initial : saved === '1');
  effect(() => write(key, value() ? '1' : '0'));
  return value;
}

const PREFIX = 'fantassistant.';

function read(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // No storage: the preference lasts for this session, which is better than a broken page.
  }
}
