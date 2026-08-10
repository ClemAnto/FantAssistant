import { Component, computed, input } from '@angular/core';

/** Every role is drawn the same way everywhere: a coloured token with white text, one colour
 *  per code. The colour is the LISTONE's own language - a keeper is amber, a defender green, a
 *  midfielder blue, a forward red - so it is a vocabulary and not a verdict. That is the one
 *  place red does not mean danger in this app; see app/CLAUDE.md. */
const ROLE_COLOURS: Record<string, string> = {
  // Classic
  p: 'bg-role-keeper',
  d: 'bg-role-defence',
  c: 'bg-role-midfield',
  a: 'bg-role-attack',
  // Mantra
  por: 'bg-role-keeper',
  dd: 'bg-role-defence',
  dc: 'bg-role-defence',
  ds: 'bg-role-defence',
  b: 'bg-role-defence',
  e: 'bg-role-wingback',
  m: 'bg-role-midfield',
  w: 'bg-role-winger',
  t: 'bg-role-winger',
  pc: 'bg-role-attack',
};

/**
 * The PANEL's own markers, which are sided variants of the same jobs (`Td` is a trequartista drawn on the
 * right, `Ts` on the left) plus `Sp`, the seconda punta. They carry the colour of the job and not a new one:
 * a marker is a position, not a meaning. Anything else sided falls back generically below.
 */
const MARKER_BASE: Record<string, string> = { sp: 'a' };

const ROLE_TITLES: Record<string, string> = {
  p: 'Portiere',
  d: 'Difensore',
  c: 'Centrocampista',
  a: 'Attaccante',
  por: 'Portiere',
  dd: 'Difensore destro',
  dc: 'Difensore centrale',
  ds: 'Difensore sinistro',
  b: 'Braccetto',
  e: 'Esterno',
  m: 'Mediano',
  w: 'Ala',
  t: 'Trequartista',
  pc: 'Punta centrale',
};

@Component({
  selector: 'ui-role',
  templateUrl: './role-badge.html',
  host: { class: 'inline-flex' },
})
export class RoleBadge {
  readonly role = input.required<string>();
  readonly size = input<'sm' | 'md'>('sm');

  private readonly code = computed(() => this.role().trim().toLowerCase());

  protected readonly label = computed(() => this.role().trim());

  /** `c` is a Mantra centrale as well as a classic centrocampista, and both read the same to
   *  whoever is looking at this table, so one title serves both. */
  protected readonly title = computed(() => ROLE_TITLES[this.code()] ?? this.role().trim());

  /**
   * An unknown code is not painted as if it were known: it stays neutral and legible.
   *
   * A sided MARKER (`Td`, `Es`, `Ad`) is not unknown though - it is a known job drawn on a flank - so before
   * giving up, the trailing `d`/`s` is dropped and the base job's colour is used. Without this the panel's own
   * markers, which are exactly what the pitch shows, would all have read neutral.
   */
  protected readonly colour = computed(() => {
    const code = this.code();
    const base = MARKER_BASE[code] ?? (code.length > 1 && /[ds]$/.test(code) ? code.slice(0, -1) : code);
    return ROLE_COLOURS[code] ?? ROLE_COLOURS[base] ?? 'bg-role-unknown';
  });

  /** One character is a dot; two or three are a pill, because a circle that fits "Por" is a
   *  circle far too big for the "P" standing next to it. */
  protected readonly shape = computed(() => {
    const wide = this.label().length > 1;
    if (this.size() === 'md') return wide ? 'h-6 min-w-9 px-2 text-xs' : 'h-6 w-6 text-xs';
    return wide ? 'h-5 min-w-7 px-1.5 text-[10px]' : 'h-5 w-5 text-[10px]';
  });
}
