import { Component, input } from '@angular/core';

import { RoleBadge } from '../role-badge/role-badge';

/**
 * A man's roles, drawn as ONE object: no space between the codes, the radius only at the two ends, and
 * never a line break - a set broken across two lines reads as two men in a table where the row below is
 * another player. Every list that shows more than one code goes through here, so the vocabulary is drawn
 * the same way in the auction, in the tables and on the pitch; a single code stays `ui-role`.
 */
@Component({
  selector: 'ui-roles',
  templateUrl: './role-set.html',
  imports: [RoleBadge],
  host: { class: 'inline-flex shrink-0 flex-nowrap items-center' },
})
export class RoleSet {
  readonly roles = input.required<readonly string[]>();
  readonly size = input<'xs' | 'sm' | 'md'>('sm');

  protected join(index: number): 'alone' | 'first' | 'middle' | 'last' {
    const count = this.roles().length;
    if (count < 2) return 'alone';
    if (index === 0) return 'first';
    return index === count - 1 ? 'last' : 'middle';
  }
}
