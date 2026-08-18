import { Component, booleanAttribute, computed, input } from '@angular/core';

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
  readonly size = input<'xs' | 'sm' | 'md'>('sm');

  /** Where this token sits inside a SET of roles (`ui-roles`). A man's codes are one vocabulary and are
   *  read as one word, so the set is drawn as a single pill: the radius belongs to the two ends and the
   *  segments in between are square. Alone - which is the default and the case of every single-role
   *  column - it stays the round token it has always been. */
  readonly join = input<'alone' | 'first' | 'middle' | 'last'>('alone');

  /**
   * SPENTO, cioè disegnato in grigio invece che nel colore del ruolo (operatore, 18/08/2026: «sui campetti
   * il badge con il ruolo della posizione reale non lo colorare, fai un cerchio grigio con una scritta
   * grigia»).
   *
   * È per il RUOLO DI UN POSTO, che è una domanda diversa dal ruolo di un uomo: il posto è l'intestazione
   * dell'item e i colori del listone appartengono ai calciatori sotto, che sono quelli che si comprano. Un
   * marcatore acceso come loro faceva leggere il posto come un dodicesimo giocatore.
   */
  readonly quiet = input(false, { transform: booleanAttribute });

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
    if (this.quiet()) return 'bg-control text-muted';
    const code = this.code();
    const base = MARKER_BASE[code] ?? (code.length > 1 && /[ds]$/.test(code) ? code.slice(0, -1) : code);
    return `${ROLE_COLOURS[code] ?? ROLE_COLOURS[base] ?? 'bg-role-unknown'} text-white`;
  });

  /** One character is a dot; two or three are a pill, because a circle that fits "Por" is a
   *  circle far too big for the "P" standing next to it. `xs` is the PITCH's size: there a place
   *  carries a name, its rivals and their codes inside one column of a row of eleven, so the token
   *  has to be read beside the name and never instead of it. */
  protected readonly shape = computed(() => {
    const wide = this.label().length > 1;
    switch (this.size()) {
      case 'md':
        return wide ? 'h-6 min-w-9 px-2 text-xs' : 'h-6 w-6 text-xs';
      case 'xs':
        return wide ? 'h-4 min-w-5 px-1 text-[9px]' : 'h-4 w-4 text-[9px]';
      default:
        return wide ? 'h-5 min-w-7 px-1.5 text-[10px]' : 'h-5 w-5 text-[10px]';
    }
  });

  /**
   * The two ends of a set are round and the joins are square, so three codes read as one object instead
   * of three. The hairline between the segments is not a gap: two neighbouring codes of the same job wear
   * the SAME colour (`Dd Dc Ds` are all green), so without it the set would read `DdDcDs` as one word.
   */
  protected readonly corners = computed(() => {
    switch (this.join()) {
      case 'first':
        return 'rounded-l-full';
      case 'middle':
        return 'border-l border-white/25';
      case 'last':
        return 'rounded-r-full border-l border-white/25';
      default:
        return 'rounded-full';
    }
  });
}
