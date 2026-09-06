import { Routes } from '@angular/router';

import { NavDeclaration } from './core/nav';

/**
 * LE ROTTE SONO ANCHE IL NAV: ogni pagina dichiara qui il suo nome, il suo titolo e la sua icona
 * (`data.nav`), e `core/nav.ts` le DERIVA da questo elenco - una lista scritta a mano accanto alle
 * rotte sarebbe la seconda definizione di «quali pagine esistono», e la prima cosa che una seconda
 * definizione fa e' restare indietro. Un test pretende che ogni rotta tranne il jolly ne dichiari uno.
 *
 * L'ORDINE E' QUELLO DEL NAV, ed e' l'ordine di lettura di una sessione: prima il listone (chi c'e',
 * come stanno le squadre, i grafici), poi l'asta (che si prepara, che si gioca, le buste), poi il
 * motore (perche' quel numero), e in fondo la pagina dei ponteggi. Per il router l'ordine conta solo
 * fra path che si sovrappongono - qui nessuno - quindi cambiarlo sposta il nav e nient'altro.
 */
export const routes: Routes = [
  {
    path: '',
    data: {
      nav: { label: 'Calciatori', title: 'Calciatori', icon: 'table' } satisfies NavDeclaration,
    },
    loadComponent: () => import('./views/players/players').then((m) => m.Players),
  },
  {
    path: 'clubs',
    data: { nav: { label: 'Squadre', title: 'Squadre', icon: 'team' } satisfies NavDeclaration },
    loadComponent: () => import('./views/clubs/clubs').then((m) => m.Clubs),
  },
  {
    path: 'charts',
    data: {
      nav: { label: 'Grafici', title: 'Grafici', icon: 'pie-chart' } satisfies NavDeclaration,
    },
    loadComponent: () => import('./views/charts/charts').then((m) => m.Charts),
  },
  {
    path: 'strategy',
    data: {
      nav: {
        label: 'Strategia',
        title: 'Strategia',
        icon: 'unordered-list',
      } satisfies NavDeclaration,
    },
    loadComponent: () => import('./views/strategy/strategy').then((m) => m.Strategy),
  },
  {
    path: 'plancia',
    data: { nav: { label: 'Plancia', title: 'Plancia', icon: 'aim' } satisfies NavDeclaration },
    loadComponent: () => import('./views/plancia/plancia').then((m) => m.Plancia),
  },
  {
    path: 'auction',
    data: {
      nav: {
        label: "Segui un'asta",
        title: "Segui un'asta",
        icon: 'wifi',
      } satisfies NavDeclaration,
    },
    loadComponent: () => import('./views/auction/auction').then((m) => m.Auction),
  },
  {
    path: 'sealed-bid',
    data: {
      nav: { label: 'Buste chiuse', title: 'Buste chiuse', icon: 'inbox' } satisfies NavDeclaration,
    },
    loadComponent: () => import('./views/sealed-bid/sealed-bid').then((m) => m.SealedBid),
  },
  {
    path: 'why',
    data: {
      // L'etichetta e' corta perche' e' il tooltip di un'icona; il titolo e' la domanda intera.
      nav: {
        label: 'Perché',
        title: 'Perché quel surplus',
        icon: 'question-circle',
      } satisfies NavDeclaration,
    },
    loadComponent: () => import('./views/why/why').then((m) => m.Why),
  },
  {
    path: 'hello',
    data: {
      nav: {
        label: 'Demo',
        title: 'Ciao, FantAssistant',
        icon: 'rocket',
        aside: true,
      } satisfies NavDeclaration,
    },
    loadComponent: () => import('./views/hello/hello').then((m) => m.Hello),
  },
  // Il jolly non e' una pagina, e' un rimando: e' l'unica rotta senza `nav`, e il test lo pretende.
  { path: '**', redirectTo: '' },
];
