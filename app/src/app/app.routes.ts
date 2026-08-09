import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./views/players/players').then((m) => m.Players),
  },
  {
    path: 'hello',
    loadComponent: () => import('./views/hello/hello').then((m) => m.Hello),
  },
  { path: '**', redirectTo: '' },
];
