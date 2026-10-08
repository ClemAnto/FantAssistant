import { Component, DestroyRef, computed, inject, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzModalModule } from 'ng-zorro-antd/modal';

import { LEGHE, LegheError, LeghePlatform } from '../../core/leghe-api';
import { LegheSession } from '../../core/leghe-session';

/**
 * THE CONNECTION TO LEGHE, one modal for both platforms (08/10/2026).
 *
 * The two platforms log in differently and the modal SAYS so before anybody types, because what crosses
 * which wire is the whole difference: on Leghe the password goes into fantacalcio's own page (the
 * official embedded login, an iframe) and this app only receives the tokens; on EuroLeghe that login is
 * not deployed, so - by the operator's decision of 08/10/2026 - the credentials go through our
 * pass-through in one request and are kept nowhere.
 *
 * The embedded login posts its answer to ANY host page (`targetOrigin '*'`), so the listener here checks
 * the SENDER: only a message from `leghe.fantacalcio.it` is read, whatever it says.
 */
@Component({
  selector: 'ui-leghe-connect',
  templateUrl: './leghe-connect.html',
  imports: [FormsModule, NzAlertModule, NzButtonModule, NzIconModule, NzInputModule, NzModalModule],
})
export class LegheConnect {
  protected readonly session = inject(LegheSession);
  protected readonly sites = LEGHE;

  readonly open = model(false);

  /** The embedded login is on screen. */
  protected readonly embedding = signal(false);
  protected readonly embedUrl: SafeResourceUrl;

  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly problem = signal<{ platform: LeghePlatform; text: string } | null>(null);

  /** Under `ng serve` the dev server forwards; anywhere else somebody has to paste the Worker's address. */
  protected readonly needsProxy = computed(() => !this.session.base());
  protected readonly proxyDraft = signal('');

  constructor() {
    // A constant address of the platform's own login page, which is exactly what an iframe is for.
    this.embedUrl = inject(DomSanitizer).bypassSecurityTrustResourceUrl(`${LEGHE.classic.site}/embed`);
    const listener = (event: MessageEvent) => this.onMessage(event);
    window.addEventListener('message', listener);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('message', listener));
  }

  private onMessage(event: MessageEvent): void {
    if (event.origin !== LEGHE.classic.site) return;
    const data = (event.data ?? {}) as { type?: unknown; payload?: unknown };
    if (data.type === 'fc-login-success') {
      this.embedding.set(false);
      if (!this.session.acceptEmbed('classic', data.payload)) {
        this.problem.set({ platform: 'classic', text: 'Login riuscito, ma la risposta di Leghe non ha la forma attesa.' });
        return;
      }
      this.problem.set(null);
    } else if (data.type === 'fc-login-error') {
      this.problem.set({ platform: 'classic', text: 'Leghe ha rifiutato il login: controlla utente e password.' });
    }
  }

  protected startEmbed(): void {
    this.problem.set(null);
    this.embedding.set(true);
  }

  protected async loginEuro(): Promise<void> {
    const username = this.username().trim();
    const password = this.password();
    if (!username || !password) return;
    this.busy.set(true);
    this.problem.set(null);
    try {
      await this.session.loginDirect('euro', username, password);
    } catch (err) {
      this.problem.set({
        platform: 'euro',
        text: err instanceof LegheError ? err.message : `Errore imprevisto: ${String(err).slice(0, 120)}`,
      });
    } finally {
      // The password field empties whatever happened: it is not kept in a signal longer than one try.
      this.password.set('');
      this.busy.set(false);
    }
  }

  protected saveProxy(): void {
    this.session.proxyUrl.set(this.proxyDraft().trim());
  }
}
