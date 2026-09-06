import { Component, signal } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';

import { AppHeader } from '../../ui/app-header/app-header';

@Component({
  selector: 'app-hello',
  imports: [AppHeader, NzButtonModule, NzIconModule],
  templateUrl: './hello.html',
  host: { class: 'view-host' },
})
export class Hello {
  protected readonly greeted = signal(false);

  protected greet(): void {
    this.greeted.update((done) => !done);
  }
}
