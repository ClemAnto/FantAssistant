import { Component, computed, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzSelectModule, NzSelectOptionInterface } from 'ng-zorro-antd/select';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import {
  COMPARE_OPS,
  CompareOp,
  FilterClause,
  FilterField,
  FilterKey,
  FilterSet,
  OP_SIGN,
  clauseSeason,
  describeClause,
} from '../../../core/strategy-filter';

/**
 * IL COSTRUTTORE DEI FILTRI della Strategia: i gettoni in barra e la finestra in cui si scrivono.
 *
 * Richiesta dell'operatore (12/09/2026): «+aggiungi filtro», si sceglie il valore, il criterio e un
 * riferimento numerico, piu' filtri vanno in AND, e un insieme si salva e si richiama.
 *
 * UNA FINESTRA E NON UN MENU' A TENDINA, ed e' una decisione presa sui controlli che ci vanno dentro: una
 * riga di filtro sono due `nz-select` e una casella numerica, e i menu' di quei tre vivono in un overlay
 * FUORI dal pannello che li contiene - quindi in una tendina ogni scelta e' un click «fuori» e chiuderebbe
 * il pannello mentre lo si sta compilando. Il menu' delle iconcine (`ui/flag-menu`) puo' permetterselo
 * perche' porta solo interruttori.
 *
 * I GETTONI STANNO FUORI DALLA FINESTRA, e questa e' la meta' che conta. Un filtro salvato e' un filtro
 * che alla prossima apertura nasconde meta' lista senza dire perche', e questa pagina ha gia' scelto di
 * NON ricordare la ricerca per blocco per quella ragione. Quello che rende diverso questo caso e' che
 * ogni condizione in vigore e' scritta in barra col suo segno, si toglie da se', e accanto c'e' quanti
 * nomi sta nascondendo: e' la stessa cura dei filtri per colonna della tabella (20/08/2026), dove un
 * filtro ricordato e' legittimo proprio perche' non puo' essere invisibile.
 *
 * NON POSSIEDE NIENTE: le condizioni e gli insiemi salvati sono della pagina (`model`), che e' l'unica
 * a sapere in che unita' si legge il gain e che li scrive su disco. Una copia qui dentro sarebbe una
 * seconda risposta a «quali filtri sono in vigore».
 */
@Component({
  selector: 'strategy-filters',
  templateUrl: './strategy-filters.html',
  imports: [
    FormsModule,
    NzButtonModule,
    NzIconModule,
    NzInputModule,
    NzInputNumberModule,
    NzModalModule,
    NzSelectModule,
    NzTagModule,
    NzTooltipModule,
  ],
  host: { class: 'contents' },
})
export class StrategyFilters {
  /** Su cosa si puo' filtrare, gia' con le etichette: il gain dipende dal tipo d'asta e lo sa la pagina. */
  readonly fields = input.required<FilterField[]>();
  /** Le condizioni in vigore, in AND. */
  readonly clauses = model.required<FilterClause[]>();
  /** Gli insiemi salvati, con il loro nome. */
  readonly sets = model.required<FilterSet[]>();
  /** Quanti nomi il filtro sta nascondendo: un filtro che non dice cosa toglie e' un filtro bugiardo. */
  readonly hidden = input(0);

  protected readonly open = signal(false);
  protected readonly draftName = signal('');

  protected readonly fieldOptions = computed<NzSelectOptionInterface[]>(() =>
    this.fields().map((one) => ({ label: one.label, value: one.key })),
  );

  /** I sei criteri col loro SEGNO: in un menu' di tre caratteri il simbolo si legge meglio della parola. */
  protected readonly opOptions: NzSelectOptionInterface[] = COMPARE_OPS.map((op) => ({
    label: OP_SIGN[op],
    value: op,
  }));

  /** I gettoni in barra: una condizione per gettone, col nome per esteso (vedi `describeClause`). */
  protected readonly chips = computed(() => {
    const named = new Map(this.fields().map((one) => [one.key, one.label]));
    return this.clauses().map((clause, at) => ({
      at,
      // LA STAGIONE SUL GETTONE, dove c'e': «MV 25/26 < 6» e «MV 26/27 > 7» sono due condizioni che
      // senza l'anno si leggerebbero come una contraddizione - ed e' esattamente la coppia che
      // l'operatore ha chiesto di poter scrivere.
      text: describeClause(clause, [named.get(clause.key) ?? clause.key, clauseSeason(clause)]
        .filter(Boolean).join(' ')),
    }));
  });

  /** Un nome serve per salvare, e un insieme vuoto non e' un filtro da richiamare. */
  protected readonly canSave = computed(() => !!this.draftName().trim() && !!this.clauses().length);

  /**
   * UNA CONDIZIONE NUOVA NASCE SULLA PRIMA VOCE E SU `≥`, con il valore a zero.
   *
   * Un default che non filtra niente sarebbe piu' prudente e anche inutile: la riga appena aggiunta
   * dev'essere subito modificabile, e «≥ 0» e' la condizione piu' innocua che si possa scrivere - toglie
   * dalla lista solo chi quel numero non ce l'ha, che e' esattamente quello che «vuoto = ignoto» dice.
   */
  protected add(): void {
    const first = this.fields()[0];
    if (!first) return;
    this.clauses.update((one) => [
      ...one,
      { key: first.key, season: this.defaultSeason(first), op: 'gte' as CompareOp, value: 0 },
    ]);
  }

  protected remove(at: number): void {
    this.clauses.update((one) => one.filter((_, index) => index !== at));
  }

  protected clear(): void {
    this.clauses.set([]);
  }

  /**
   * CAMBIARE LETTURA CAMBIA ANCHE LA STAGIONE, alla sua: una condizione su `Pa` non ha una stagione e
   * una su `MV` ne ha una, quindi tenere quella di prima lascerebbe una condizione che dice «media voto
   * di nessuna stagione» - o peggio, una stagione che quella lettura non offre.
   */
  protected setKey(at: number, key: FilterKey): void {
    const field = this.fields().find((one) => one.key === key);
    this.edit(at, { key, season: field?.season ?? null });
  }

  protected setSeason(at: number, season: string): void {
    this.edit(at, { season });
  }

  /** Le stagioni che una condizione puo' prendere: quelle della sua lettura. */
  protected seasonsOf(clause: FilterClause): { value: string; label: string }[] {
    return this.fields().find((one) => one.key === clause.key)?.seasons ?? [];
  }

  private defaultSeason(field: FilterField): string | null {
    return field.season ?? null;
  }

  protected setOp(at: number, op: CompareOp): void {
    this.edit(at, { op });
  }

  /** La casella numerica risponde `null` quando e' vuota: si tiene lo zero invece di scrivere un NaN. */
  protected setValue(at: number, value: number | null): void {
    this.edit(at, { value: value ?? 0 });
  }

  private edit(at: number, change: Partial<FilterClause>): void {
    this.clauses.update((one) =>
      one.map((clause, index) => (index === at ? { ...clause, ...change } : clause)),
    );
  }

  /**
   * SALVA L'INSIEME IN VIGORE col nome scritto, SOVRASCRIVENDO quello che ha lo stesso nome.
   *
   * Sovrascrivere e non accumulare, perche' due insiemi con lo stesso nome sono indistinguibili nella
   * lista da cui si richiamano - e la cosa che uno fa davvero e' correggere un filtro e risalvarlo.
   */
  protected save(): void {
    const name = this.draftName().trim();
    if (!name || !this.clauses().length) return;
    const clauses = this.clauses().map((one) => ({ ...one }));
    this.sets.update((all) => {
      const at = all.findIndex((one) => one.name.toLowerCase() === name.toLowerCase());
      const one: FilterSet = { id: at >= 0 ? all[at].id : newId(), name, clauses };
      return at >= 0 ? all.map((old, index) => (index === at ? one : old)) : [...all, one];
    });
    this.draftName.set('');
  }

  /** Richiamare SOSTITUISCE, non aggiunge: «richiama un set» e' «guarda la lista con quel filtro». */
  protected recall(one: FilterSet): void {
    this.clauses.set(one.clauses.map((clause) => ({ ...clause })));
    this.draftName.set(one.name);
  }

  protected drop(id: string): void {
    this.sets.update((all) => all.filter((one) => one.id !== id));
  }
}

/** Un'identita' che non dipende dal nome, cosi' rinominare un insieme non ne crea un secondo. */
function newId(): string {
  return `f${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}
