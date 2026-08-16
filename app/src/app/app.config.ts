import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideNzNativeDateAdapter } from 'ng-zorro-antd/core/time';
import { it_IT, provideNzI18n } from 'ng-zorro-antd/i18n';
import { provideNzIcons } from 'ng-zorro-antd/icon';

import { routes } from './app.routes';
import { NZ_ICONS } from './nz-icons';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideNzIcons(NZ_ICONS),
    provideNzI18n(it_IT),
    // Il date picker di ng-zorro 22 vuole un adattatore di date dichiarato: quello nativo basta, e senza
    // di lui il componente non si costruisce affatto (NG0201). Lo usa il box del viaggio nel tempo.
    provideNzNativeDateAdapter(),
  ],
};
