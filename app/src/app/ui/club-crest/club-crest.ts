import { Component, computed, input } from '@angular/core';

/* Deterministic palette: the same club is always the same colour, in this session and the
 * next, because the colour is a function of the name and not of the order rows arrived in. */
const CREST_COLOURS = [
  '#1d4ed8',
  '#b91c1c',
  '#15803d',
  '#a16207',
  '#6d28d9',
  '#0f766e',
  '#be185d',
  '#c2410c',
  '#0369a1',
  '#4d7c0f',
];

/**
 * A club's mark: the real badge when the bundle carries one, a MONOGRAM otherwise.
 *
 * The badges are downloaded ONCE by the toolkit (`positions --layer crests`, 93 clubs, 611 KB)
 * and travel inside the export, so the app still reads only what it is given - a public page of
 * ours never depends on a provider's CDN staying friendly. A club with no provider id, and every
 * OPPONENT (we hold its name and not its id), falls back to the monogram.
 */
@Component({
  selector: 'ui-crest',
  templateUrl: './club-crest.html',
  host: { class: 'inline-flex' },
})
export class ClubCrest {
  readonly club = input.required<string | null>();
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  /** The club's id and the bundle's index: without both, the monogram stands. */
  readonly clubId = input<number | null>(null);
  readonly crests = input<Record<string, string>>({});

  protected readonly badge = computed(() => {
    const id = this.clubId();
    const file = id == null ? undefined : this.crests()[String(id)];
    return file ? `data/crests/${file}` : null;
  });

  protected readonly initials = computed(() => {
    const name = (this.club() ?? '').trim();
    if (!name) return '?';
    const words = name.split(/[\s.'-]+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  });

  protected readonly colour = computed(() => {
    const name = (this.club() ?? '').trim();
    if (!name) return 'var(--color-role-unknown)';
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return CREST_COLOURS[hash % CREST_COLOURS.length];
  });

  protected readonly shape = computed(() => {
    switch (this.size()) {
      case 'sm':
        return 'h-5 w-5 text-[9px]';
      case 'lg':
        return 'h-12 w-12 text-base';
      default:
        return 'h-8 w-8 text-[11px]';
    }
  });
}
