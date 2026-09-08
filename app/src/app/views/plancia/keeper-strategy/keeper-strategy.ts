import { Component, computed, inject } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { BoardMan, PlanciaStore } from '../../../core/plancia-store';
import { KeeperThird, PlanKeeper } from '../../../core/keeper-pairs';

/** A chip the strip draws: a keeper to consider now, with the words that say why. */
interface Chip {
  id: number;
  label: string;
  club: string;
  offer: number;
  note: string;
}

/**
 * LA STRISCIA STRATEGIA PORTIERI: cosa conviene comprare ADESSO, capito dallo stato del tavolo.
 *
 * Sua richiesta dell'08/09/2026: la plancia deve suggerire da se' la strategia portieri migliore in
 * quel momento, senza che lui debba scegliere in astratto. Tutto il pensiero e' nel piano puro
 * (`planKeepers`); qui si traduce la fase in una riga e in qualche pastiglia. Le due strategie sono
 * la COPPIA complementare (due club che insieme fanno >= 32 facili) e i TRE di un supertop (un club
 * che da solo >= 32, come l'Inter). Il terzo economico mostra ENTRAMBI i tipi, «pari» per sua
 * istruzione. Una pastiglia apre gli accoppiamenti di quel portiere, che e' il dettaglio.
 *
 * Sottile e in `shrink-0`: la pagina non scorre, quindi la guida costa una riga sola e sparisce del
 * tutto quando non c'e' un calendario da contare.
 */
@Component({
  selector: 'plancia-keeper-strategy',
  templateUrl: './keeper-strategy.html',
  imports: [NzIconModule, NzTooltipModule],
})
export class KeeperStrategy {
  protected readonly store = inject(PlanciaStore);
  protected readonly plan = computed(() => this.store.keeperPlan());

  /** Il club supertop che sto completando, quando sono su quella strada. */
  private readonly superClub = computed(() => {
    const plan = this.plan();
    if (!plan || plan.phase !== 'single') return null;
    return plan.owned.find((o) => o.alone >= plan.target) ?? plan.owned[0] ?? null;
  });

  /** Il mio unico portiere, quando cerco il partner. */
  private readonly loneClub = computed(() => {
    const plan = this.plan();
    return plan && plan.phase === 'pair' ? (plan.owned[0] ?? null) : null;
  });

  protected readonly headline = computed<string>(() => {
    const plan = this.plan();
    if (!plan) return '';
    const w = plan.windowRounds;
    switch (plan.phase) {
      case 'choose':
        return 'Portieri: due strade';
      case 'single': {
        const club = this.superClub();
        return `Completa i tre del ${club?.club ?? '?'} — da solo ${club?.alone ?? 0}/${w}`;
      }
      case 'pair': {
        const mine = this.loneClub();
        return `Con ${mine?.club ?? '?'} (${mine?.alone ?? 0}/${w}): un secondo che arrivi a ≥${plan.target}`;
      }
      case 'third':
        return plan.met
          ? `Coppia ${plan.pairFacili}/${w} ✓ — il terzo a poco`
          : `Coppia ${plan.pairFacili}/${w} (sotto ${plan.target}) — il terzo a poco`;
      case 'done':
        return `Reparto portieri completo — ${plan.pairFacili ?? '—'}/${w}`;
    }
  });

  /** Le pastiglie della fase corrente. Vuote in «done»: non c'è più niente da comprare. */
  protected readonly chips = computed<Chip[]>(() => {
    const plan = this.plan();
    if (!plan) return [];
    const w = plan.windowRounds;
    const of = (k: PlanKeeper<BoardMan>, note: string): Chip => ({
      id: k.id,
      label: k.man.name,
      club: k.club,
      offer: k.offer,
      note,
    });

    if (plan.phase === 'choose') {
      const chips: Chip[] = [];
      const top = plan.singles[0];
      if (top && top.available[0]) {
        chips.push({
          ...of(top.available[0], `Supertop: il ${top.club} da solo copre ${top.alone}/${w}. Prendine tre e hai la porta garantita ogni giornata.`),
          label: `${top.club} ×3`,
        });
      }
      for (const pair of plan.pairs.slice(0, 2)) {
        chips.push({
          id: -1,
          label: `${pair.a} + ${pair.b}`,
          club: '',
          offer: 0,
          note: `Coppia complementare: insieme coprono ${pair.facili}/${w} giornate (${pair.gain} più del migliore dei due da solo).`,
        });
      }
      return chips;
    }
    if (plan.phase === 'single' || plan.phase === 'pair') {
      return plan.next
        .slice(0, 4)
        .map((k) =>
          of(
            k,
            plan.phase === 'single'
              ? `Altro portiere del ${k.club}: completarne tre chiude la sua porta ogni giornata.`
              : `Con il tuo, la coppia arriva a ≥${plan.target}/${w}.`,
          ),
        );
    }
    if (plan.phase === 'third') {
      return plan.thirds.slice(0, 5).map((t) => this.thirdChip(t));
    }
    return [];
  });

  private thirdChip(third: KeeperThird<BoardMan>): Chip {
    return {
      id: third.man.id,
      label: third.man.name,
      club: third.club,
      offer: third.offer,
      note:
        third.kind === 'deputy'
          ? `Il vice del ${third.locks}, di cui hai già il titolare: prenderlo chiude la porta del ${third.locks} ogni giornata.`
          : `Un terzo club a poco (${third.club}): diversifica la copertura.`,
    };
  }

  protected open(id: number): void {
    if (id > 0) this.store.openPairs(id);
  }
}
