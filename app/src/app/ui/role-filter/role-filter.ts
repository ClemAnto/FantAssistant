import { Component, input, model } from '@angular/core';

import { RoleBadge } from '../role-badge/role-badge';

/**
 * THE ROLE FILTER, one chip per role of the game (09/10/2026, operator: the LINEUP's filter «deve essere
 * esattamente lo stesso di quello nella pagina Draft Assistant»). One component for both pages, so the two
 * cannot drift: a chip toggles its role, the roles are in OR, the ✕ clears them, and an unchosen chip fades
 * once something is chosen.
 *
 * `selected` holds LOWERCASE codes, the key the draft page already stores in its URL (`ruoli=d,dc`), so the
 * caller compares `role.toLowerCase()`. The host is `contents`: the chips sit in the caller's own flex row,
 * next to whatever else that row carries, exactly as they did before this was a component.
 */
@Component({
  selector: 'ui-role-filter',
  templateUrl: './role-filter.html',
  imports: [RoleBadge],
  host: { class: 'contents' },
})
export class RoleFilter {
  /** The game's roles, in the order to draw them: the rulebook's own vocabulary on Mantra. */
  readonly roles = input.required<readonly string[]>();
  readonly selected = model<ReadonlySet<string>>(new Set());

  protected on(role: string): boolean {
    return this.selected().has(role.toLowerCase());
  }

  protected toggle(role: string): void {
    const key = role.toLowerCase();
    const next = new Set(this.selected());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.selected.set(next);
  }

  protected clear(): void {
    this.selected.set(new Set());
  }
}
