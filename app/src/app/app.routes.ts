import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./views/players/players').then((m) => m.Players),
  },
  {
    path: 'auction',
    loadComponent: () => import('./views/auction/auction').then((m) => m.Auction),
  },
  {
    path: 'charts',
    loadComponent: () => import('./views/charts/charts').then((m) => m.Charts),
  },
  {
    path: 'clubs',
    loadComponent: () => import('./views/clubs/clubs').then((m) => m.Clubs),
  },
  {
    path: 'hello',
    loadComponent: () => import('./views/hello/hello').then((m) => m.Hello),
  },
  { path: '**', redirectTo: '' },
];
