import { Injectable, inject, signal } from '@angular/core';

import { NextRoundStore } from './next-round-store';
import { storedText } from './view-state';

/**
 * «INVIA AL WIDGET»: the men of a fantasquadra and their clubs, sent to the Sheet so an Android home-screen widget
 * (KWGT, free) can list the real matches of those clubs (operator, 10/10/2026: «dalla webapp dobbiamo creare un
 * sistema che a partire dalla pagina LINEUP ... scrivano da qualche parte i miei calciatori e le loro squadre in
 * modo che il widget possa leggerle»).
 *
 * WHERE: `scripts/gas/widget.gs`, a third file of the Apps Script project that already serves the probable
 * line-ups and the odds - same deployment, same URL (`NextRoundStore.url`), so there is ONE address to keep
 * current and not two. The Sheet asks SofaScore every 5 minutes and serves the list on `?what=widget`.
 *
 * WHAT TRAVELS: name, role, Leghe's club name and the SofaScore team id of the club - nothing of the Leghe
 * account. The id comes from the toolkit (`sofascore_clubs.json`, our `fc_club_id` -> the provider's team id):
 * the app never resolves a provider identity by name. A man whose club has no id is not sent, and the answer
 * COUNTS him, because a widget missing one club silently would read as «that club does not play».
 *
 * The POST is text/plain on purpose: a «simple» request, so the browser sends it without a CORS preflight that
 * Apps Script would not answer. The secret is the script property `WIDGET_SECRET`, typed here once and kept in
 * localStorage on this device.
 */
export interface WidgetMan {
  name: string;
  role: string;
  club: string;
  /** SofaScore team id of his club; null = the bundle has none for it. */
  team: number | null;
}

/** One man of the roster as the Lineup page has him, and the bundle's club id where the bundle knows him. */
export interface WidgetSource {
  name: string;
  role: string;
  club: string;
  clubId: number | null;
}

/** Joins each man to his club's SofaScore id, by OUR club id and never by a name. */
export function widgetMen(
  roster: readonly WidgetSource[],
  sofascore: Readonly<Record<string, number>> | null,
): { men: WidgetMan[]; missing: string[] } {
  const men = roster.map((r) => ({
    name: r.name,
    role: r.role,
    club: r.club,
    team: r.clubId !== null && sofascore ? (sofascore[String(r.clubId)] ?? null) : null,
  }));
  return { men, missing: men.filter((m) => m.team === null).map((m) => m.name) };
}

export type WidgetSendState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; text: string }
  | { kind: 'failed'; text: string };

/** The Sheet's answer to a POST, or null when it is not that shape. */
export function parseWidgetAnswer(raw: unknown): { ok: boolean; why?: string; matches?: number; teams?: number } | null {
  if (!raw || typeof raw !== 'object' || typeof (raw as { ok?: unknown }).ok !== 'boolean') return null;
  return raw as { ok: boolean; why?: string; matches?: number; teams?: number };
}

@Injectable({ providedIn: 'root' })
export class WidgetFeed {
  private readonly sheet = inject(NextRoundStore);

  /** The script property `WIDGET_SECRET`, as typed by the operator on this device. */
  readonly secret = storedText('widget-secret', '');
  readonly state = signal<WidgetSendState>({ kind: 'idle' });

  /** The address the KWGT widget reads: the same deployment, `?what=widget`. */
  readUrl(): string {
    const base = this.sheet.url().trim();
    return base ? `${base}${base.includes('?') ? '&' : '?'}what=widget` : '';
  }

  /** Sends one fantasquadra (`key` replaces what was sent before for it; no men removes it from the widget). */
  async send(key: string, label: string, men: readonly WidgetMan[], missing: readonly string[]): Promise<void> {
    const base = this.sheet.url().trim();
    const secret = this.secret().trim();
    if (!base) return this.state.set({ kind: 'failed', text: 'Nessun indirizzo del foglio.' });
    if (!secret) return this.state.set({ kind: 'failed', text: 'Scrivi la chiave segreta del widget.' });
    this.state.set({ kind: 'sending' });
    const players = men.filter((m) => m.team !== null);
    let last = '';
    // Three tries for the same reason `NextRoundStore` has them: Apps Script's second hop fails by itself now
    // and then, and a new request gets a new token. Re-sending is safe: the POST replaces, it does not add.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const res = await fetch(base, {
          method: 'POST',
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ secret, key, label, players }),
        });
        let raw: unknown = null;
        try {
          raw = JSON.parse(await res.text());
        } catch {
          raw = null;
        }
        const answer = parseWidgetAnswer(raw);
        if (answer?.ok) {
          const lost = missing.length ? ` · ${missing.length} senza id SofaScore: ${missing.join(', ')}` : '';
          return this.state.set({
            kind: 'sent',
            text: `${players.length} calciatori inviati · ${answer.matches ?? 0} partite nel widget${lost}`,
          });
        }
        if (answer) return this.state.set({ kind: 'failed', text: answer.why ?? 'il foglio ha rifiutato l\'invio' });
        last = res.ok ? 'il foglio non conosce ancora il widget (va aggiunto widget.gs e ridistribuito)' : `il foglio ha risposto ${res.status}`;
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
      if (attempt < 3) await new Promise((go) => setTimeout(go, 600));
    }
    this.state.set({ kind: 'failed', text: `Invio non riuscito dopo 3 tentativi: ${last}` });
  }
}
